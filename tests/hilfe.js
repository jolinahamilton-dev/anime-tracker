// Gemeinsame Hilfen für die Abgleich-Tests: ein Google Drive im Speicher (fetch-Attrappe),
// simulierte Geräte mit eigener sql.js-Datenbank und eine Attrappe der SyncPlattform.
// Die übersetzten Quellen legt scripts/test.js in ANIME_TRACKER_TEST_BUILD ab.
const path = require('path')
const initSqlJs = require('sql.js')

const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
if (!BUILD) throw new Error('Tests bitte über „npm test“ (scripts/test.js) starten')
const kern = require(path.join(BUILD, 'db/kern.js'))
const { erstelleSyncDienst } = require(path.join(BUILD, 'sync/dienst.js'))
const krypto = require(path.join(BUILD, 'sync/krypto.js'))
const abgleich = require(path.join(BUILD, 'sync/abgleich.js'))

let SQL = null
let schluesselCache = null
const SALZ = 'AAAAAAAAAAAAAAAAAAAAAA==' // fest – das Ableiten (PBKDF2) dauert, also nur einmal

/** Google Drive im Speicher. Ersetzt globalThis.fetch, solange die Umgebung lebt. */
function erstelleDrive() {
  const dateien = new Map() // id → { name, inhalt, createdTime }
  let zaehler = 0
  const geladen = [] // Namen aller heruntergeladenen Dateien (zum Prüfen, was gelesen wurde)
  let vorDemLaden = null // (id, datei) => void – z. B. um eine Datei „gleichzeitig“ verschwinden zu lassen

  const antwort = (body, status = 200) => ({
    ok: status < 400, status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })
  const nichtGefunden = () => antwort({ error: { message: 'File not found' } }, 404)

  async function fetch(url, init = {}) {
    const u = new URL(url)
    const id = u.pathname.split('/').pop()
    if (init.method === 'POST' && u.pathname.includes('/upload/')) {
      const grenze = /boundary=(\S+)/.exec(init.headers['Content-Type'])[1]
      const teile = init.body.split(`--${grenze}`)
      const inhaltVon = t => t.slice(t.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '')
      const meta = JSON.parse(inhaltVon(teile[1]))
      const neueId = 'f' + String(++zaehler).padStart(5, '0')
      dateien.set(neueId, { name: meta.name, inhalt: inhaltVon(teile[2]), createdTime: new Date(1e12 + zaehler * 1000).toISOString() })
      return antwort({ id: neueId })
    }
    if (init.method === 'DELETE') return dateien.delete(id) ? antwort('') : nichtGefunden()
    if (u.searchParams.get('alt') === 'media') {
      if (vorDemLaden) vorDemLaden(id, dateien.get(id))
      const d = dateien.get(id)
      if (!d) return nichtGefunden()
      geladen.push(d.name)
      return antwort(d.inhalt)
    }
    if (u.pathname.endsWith('/about')) return antwort({ user: { emailAddress: 'test@example.org' } })
    return antwort({ files: [...dateien].map(([fid, d]) => ({ id: fid, name: d.name, createdTime: d.createdTime })) })
  }

  return {
    fetch, dateien, geladen,
    namen: () => [...dateien.values()].map(d => d.name).sort(),
    setzeVorDemLaden: f => { vorDemLaden = f },
    lege: (name, inhalt) => { const fid = 'f' + String(++zaehler).padStart(5, '0'); dateien.set(fid, { name, inhalt, createdTime: new Date(1e12 + zaehler * 1000).toISOString() }) },
  }
}

/** Neue Testumgebung: leeres Drive mit salz.json; geraet(name) legt ein Gerät an */
async function erstelleUmgebung() {
  SQL ??= await initSqlJs()
  schluesselCache ??= await krypto.leiteSchluesselAb('testpasswort123', SALZ)
  const schluessel = schluesselCache
  const drive = erstelleDrive()
  globalThis.fetch = drive.fetch
  drive.lege('salz.json', JSON.stringify({ salz: SALZ, pruef: await krypto.erzeugePruefwert(schluessel) }))

  function geraet(name) {
    const db = new SQL.Database()
    kern.createSchema(db)
    kern.migrateSchema(db)
    const g = { name, db, meldungen: [] }
    const plattform = {
      istVerbunden: async () => true,
      holeToken: async () => 'token',
      verbinden: async () => {},
      trennen: async () => {},
      ladeSchluessel: async () => schluessel,
      speichereSchluessel: async () => {},
      benachrichtige: ids => { g.meldungen.push(ids) },
    }
    const dienst = erstelleSyncDienst(plattform)
    g.aktiv = () => { kern.setzeDb(db, () => {}); return g }
    g.id = () => { g.aktiv(); return String(kern.dbGet("SELECT value FROM app_meta WHERE key = 'geraet_id'").value) }
    g.abgleichen = async () => { g.aktiv(); return dienst.abgleichen() }
    g.alle = (sql, p = []) => { g.aktiv(); return kern.dbAll(sql, p) }
    g.eins = (sql, p = []) => { g.aktiv(); return kern.dbGet(sql, p) }
    g.aendere = (sql, p = []) => { g.aktiv(); kern.dbRun(sql, p) }
    g.neuerEintrag = titel => {
      g.aendere("INSERT INTO entries (type, title, status) VALUES ('ANIME', ?, 'planned')", [titel])
      return String(g.eins('SELECT uuid FROM entries WHERE title = ?', [titel]).uuid)
    }
    g.feld = (uuid, feld) => g.eins(`SELECT ${feld} AS v FROM entries WHERE uuid = ?`, [uuid])?.v
    g.letzteNr = geraetId => { g.aktiv(); return abgleich.letzteNr(geraetId) }
    return g
  }

  /** Dateien eines Geräts in Drive, aufgeteilt nach Art */
  const dateienVon = g => {
    const id = g.id()
    const n = drive.namen()
    return { staende: n.filter(x => x.startsWith(`stand_${id}_`)), logs: n.filter(x => x.startsWith(`log_${id}_`)) }
  }

  return { drive, geraet, dateienVon, schluessel }
}

module.exports = { erstelleUmgebung, kern }
