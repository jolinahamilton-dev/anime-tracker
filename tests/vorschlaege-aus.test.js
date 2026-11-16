// Ausgeblendete Vorschläge verwalten (Plan Nr. 12): wieder einblenden, Abgleich zwischen zwei/drei Geräten,
// Migration einer bestehenden Datenbank ohne die Spalte `aktiv`.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung, kern } = require('./hilfe')

const vorschlaege = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'main/handlers/vorschlaege.js'))
const warte = ms => new Promise(r => setTimeout(r, ms))

async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
}
const stand = g => g.alle('SELECT anilist_id AS id, aktiv FROM vorschlag_aus ORDER BY anilist_id').map(r => `${r.id}:${r.aktiv}`)
const sichtbar = g => g.alle('SELECT anilist_id AS id FROM vorschlag_aus WHERE aktiv = 1 ORDER BY anilist_id').map(r => r.id)

test('Wieder einblenden: ausgeblendet auf A, wieder gezeigt auf B – danach gilt es überall und kommt nicht zurück', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  pc.neuerEintrag('Frieren')
  pc.aktiv(); vorschlaege.blendeVorschlagAus(101); vorschlaege.blendeVorschlagAus(202)
  await sync(pc); await sync(handy)
  assert.deepEqual(sichtbar(handy), [101, 202])

  await warte(5)
  handy.aktiv(); vorschlaege.blendeVorschlagEin(101)
  assert.deepEqual(sichtbar(handy), [202])
  await sync(handy); await sync(pc); await sync(handy)
  assert.deepEqual(stand(pc), ['101:0', '202:1'])
  assert.deepEqual(stand(handy), ['101:0', '202:1'])

  // Ein neues Gerät (Gesamtstand) und weitere Abgleiche bringen 101 nicht zurück
  const tablet = geraet('tablet')
  await sync(tablet); await sync(pc)
  assert.deepEqual(stand(tablet), ['101:0', '202:1'])
  assert.deepEqual(sichtbar(pc), [202])
})

test('Erneut ausblenden nach dem Einblenden: der spätere Schalter gewinnt', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  pc.neuerEintrag('Frieren')
  pc.aktiv(); vorschlaege.blendeVorschlagAus(101)
  await sync(pc); await sync(handy)
  await warte(5)
  handy.aktiv(); vorschlaege.blendeVorschlagEin(101)
  await sync(handy); await sync(pc)
  assert.deepEqual(sichtbar(pc), [])
  await warte(5)
  pc.aktiv(); vorschlaege.blendeVorschlagAus(101)
  assert.deepEqual(sichtbar(pc), [101])
  await sync(pc); await sync(handy); await sync(pc)
  assert.deepEqual(stand(handy), ['101:1'])
  assert.deepEqual(stand(pc), ['101:1'])
})

test('Gleichzeitig ohne Abgleich: A blendet wieder ein, B blendet (später) erneut aus → die spätere Änderung gewinnt', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  pc.neuerEintrag('Frieren')
  pc.aktiv(); vorschlaege.blendeVorschlagAus(101)
  await sync(pc); await sync(handy)
  await warte(5)
  pc.aktiv(); vorschlaege.blendeVorschlagEin(101)          // früher
  await warte(5)
  handy.aktiv(); vorschlaege.blendeVorschlagEin(101); await warte(5); vorschlaege.blendeVorschlagAus(101) // später: wieder aus
  await sync(pc); await sync(handy); await sync(pc)
  assert.deepEqual(stand(pc), ['101:1'])
  assert.deepEqual(stand(handy), ['101:1'])
})

test('Einblenden verwirft den Zwischenspeicher; Ausblenden eines unbekannten/ungültigen Titels ändert nichts', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc')
  pc.aktiv(); vorschlaege.blendeVorschlagAus(7)
  pc.aendere("INSERT INTO app_meta (key, value) VALUES ('vorschlaege_cache', '{}')")
  vorschlaege.blendeVorschlagEin(999)          // war nie ausgeblendet: kein Fehler
  vorschlaege.blendeVorschlagEin(-1)
  vorschlaege.blendeVorschlagEin(7)
  assert.equal(pc.eins("SELECT COUNT(*) AS n FROM app_meta WHERE key = 'vorschlaege_cache'").n, 0)
  assert.deepEqual(stand(pc), ['7:0'])
})

test('Liste der ausgeblendeten Vorschläge: Titel aus dem Cache, Cover nachgeladen, offline nur die ID', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc')
  pc.aktiv(); vorschlaege.blendeVorschlagAus(11); vorschlaege.blendeVorschlagAus(12)
  pc.aendere("INSERT INTO titel_cache (anilist_id, romaji, english) VALUES (11, 'Sousou no Frieren', 'Frieren')")
  // Ohne Nachladen (nur Zahl): keine Anfrage
  let anfragen = 0
  const ohne = await vorschlaege.holeAusgeblendete(false, async () => { anfragen++; return {} })
  assert.equal(ohne.length, 2); assert.equal(anfragen, 0)
  // Offline: Titel nur, wo bekannt; kein Fehler
  const offline = await vorschlaege.holeAusgeblendete(true, async () => { throw new Error('offline') })
  assert.equal(offline.find(v => v.anilistId === 11).titel, 'Frieren')
  assert.equal(offline.find(v => v.anilistId === 12).titel, null)
  // Online: eine Anfrage, Titel und Cover kommen dazu
  const res = { data: { Page: { media: [
    { id: 11, title: { romaji: 'Sousou no Frieren', english: 'Frieren', native: null }, coverImage: { large: 'http://x/11.jpg' } },
    { id: 12, title: { romaji: 'Zwölf', english: null, native: null }, coverImage: { large: 'http://x/12.jpg' } }] } } }
  const online = await vorschlaege.holeAusgeblendete(true, async () => { anfragen++; return res })
  assert.equal(anfragen, 1)
  assert.equal(online.find(v => v.anilistId === 12).cover, 'http://x/12.jpg')
  // Danach vollständig im lokalen Speicher: keine weitere Anfrage; der Cover-Speicher wird nicht abgeglichen
  await vorschlaege.holeAusgeblendete(true, async () => { anfragen++; return res })
  assert.equal(anfragen, 1)
  assert.equal(pc.eins("SELECT COUNT(*) AS n FROM sync_log WHERE zeile = 'vorschlag_aus_cover'").n, 0)
})

test('Migration: bestehende Tabelle ohne aktiv bekommt die Spalte, alle Ausblendungen bleiben aktiv', async () => {
  const SQL = await require('sql.js')()
  const db = new SQL.Database()
  kern.createSchema(db); kern.migrateSchema(db)
  for (const t of db.exec("SELECT name FROM sqlite_master WHERE type = 'trigger'")[0].values) db.run(`DROP TRIGGER ${t[0]}`)
  db.run('ALTER TABLE vorschlag_aus DROP COLUMN aktiv')
  db.run("INSERT INTO vorschlag_aus (anilist_id, zeit) VALUES (5, '2026-01-01 10:00:00'), (6, '2026-01-02 10:00:00')")
  kern.migrateSchema(db); kern.migrateSchema(db) // zweimal: ohne Fehler
  const r = db.exec('SELECT anilist_id, zeit, aktiv FROM vorschlag_aus ORDER BY anilist_id')[0].values
  assert.deepEqual(r, [[5, '2026-01-01 10:00:00', 1], [6, '2026-01-02 10:00:00', 1]])
})
