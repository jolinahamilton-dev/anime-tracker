// Tests für die Einstellungen „18+-Titel anzeigen“ und „Sprache der Titel“ (Standardwerte, Abgleich,
// Sicherung) und dafür, dass die Vorschläge und die Suche die Adult-Einstellung beachten.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const initSqlJs = require('sql.js')
const { kern } = require('./hilfe')

const B = process.env.ANIME_TRACKER_TEST_BUILD
const einst = require(path.join(B, 'main/handlers/einstellungen-kern.js'))
const sicherung = require(path.join(B, 'main/handlers/sicherung-kern.js'))
const vorschlaege = require(path.join(B, 'main/handlers/vorschlaege.js'))

async function neueDb() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  kern.createSchema(db)
  kern.migrateSchema(db)
  kern.setzeDb(db, () => {})
  return db
}
const setzeMeta = (k, v) => kern.dbRun('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [k, v])

test('Einstellungen: beide Schlüssel werden abgeglichen und gesichert', async () => {
  for (const k of ['adultAnzeigen', 'titelSprache']) assert.ok(kern.SYNC_META.includes(k), `${k} im Abgleich`)
  await neueDb()
  setzeMeta('adultAnzeigen', 'false')
  setzeMeta('titelSprache', 'japanisch')
  const meta = Object.fromEntries(sicherung.erstelleSicherung().app_meta.map(r => [r.key, r.value]))
  assert.equal(meta.adultAnzeigen, 'false')
  assert.equal(meta.titelSprache, 'japanisch')
})

test('Einstellungen: ohne Wert ist 18+ an und die Titelsprache Englisch', async () => {
  await neueDb()
  assert.equal(einst.adultAnzeigen(), true)
  assert.equal(einst.titelSprache(), 'englisch')
  setzeMeta('adultAnzeigen', 'false')
  assert.equal(einst.adultAnzeigen(), false)
  setzeMeta('adultAnzeigen', 'true')
  assert.equal(einst.adultAnzeigen(), true)
  setzeMeta('titelSprache', 'romaji')
  assert.equal(einst.titelSprache(), 'romaji')
  setzeMeta('titelSprache', 'klingonisch')
  assert.equal(einst.titelSprache(), 'englisch', 'ungültiger Wert → Standard')
})

test('Einstellungen: Änderung der Adult-Einstellung macht den Für-dich-Zwischenspeicher ungültig', async () => {
  await neueDb()
  const gesendet = []
  const altesFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    gesendet.push(JSON.parse(init.body))
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { Page: { media: [] } } }) }
  }
  try {
    setzeMeta('vorschlaege_cache', JSON.stringify({
      empfehlungen: [], adaptionen: [], saison: [], stand: new Date().toISOString(), v: 3, adult: true, sprache: 'englisch',
    }))
    await vorschlaege.holeVorschlaege()
    assert.equal(gesendet.length, 0, 'gleiche Einstellung → Zwischenspeicher gilt')
    setzeMeta('adultAnzeigen', 'false')
    await vorschlaege.holeVorschlaege()
    assert.ok(gesendet.length > 0, 'andere Einstellung → neu berechnet')
    const saison = gesendet.find(g => /seasonYear/.test(g.query))
    assert.equal(saison.variables.adult, false, 'AniList bekommt isAdult: false')
    assert.equal(JSON.parse(kern.dbGet("SELECT value FROM app_meta WHERE key = 'vorschlaege_cache'").value).adult, false)
  } finally { globalThis.fetch = altesFetch }
})

test('Einstellungen: Vorschläge filtern Adult-Titel nur bei ausgeschalteter Einstellung', async () => {
  const antwortFuer = query => {
    const mediaEintrag = { id: 500, type: 'MANGA', format: 'MANGA', status: 'FINISHED', isAdult: true, popularity: 10, startDate: { year: 2010, month: 1 },
      title: { romaji: 'Adult Manga', english: null, native: null }, genres: [], relations: { edges: [] } }
    if (/recommendations/.test(query)) return { data: { Page: { media: [] } } }
    if (/relations/.test(query) && /popularity isAdult/.test(query)) {
      return { data: { Page: { media: [{ id: 100, format: 'TV', startDate: { year: 2015, month: 1 },
        relations: { edges: [{ relationType: 'SOURCE', node: mediaEintrag }] } }] } } }
    }
    if (/seasonYear/.test(query) && /season:/.test(query)) return { data: { Page: { media: [] } } }
    return { data: { Page: { media: [mediaEintrag] } } } // Details
  }
  const altesFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => ({
    status: 200, headers: { get: () => null },
    text: async () => JSON.stringify(antwortFuer(JSON.parse(init.body).query)),
  })
  try {
    for (const [wert, erwartet] of [[undefined, true], ['true', true], ['false', false]]) {
      await neueDb()
      kern.dbRun("INSERT INTO entries (title, type, anilist_id, status) VALUES ('Anime', 'ANIME', 100, 'completed')")
      if (wert) setzeMeta('adultAnzeigen', wert)
      const antwort = await vorschlaege.holeVorschlaege(true)
      assert.equal(antwort.fehler, undefined)
      assert.equal(antwort.adaptionen.some(v => v.media.id === 500), erwartet, `Einstellung ${wert}`)
    }
  } finally { globalThis.fetch = altesFetch }
})

test('Einstellungen: bei „18+ anzeigen“ fehlt die AniList-Variable ganz (adult: null liefert dort 0 Treffer)', async () => {
  await neueDb()
  assert.deepEqual(einst.adultFilter(), {}, 'ohne Wert: keine Variable')
  assert.equal('adult' in { season: 'FALL', ...einst.adultFilter() }, false)
  assert.equal(JSON.stringify({ search: 'x', ...einst.adultFilter() }).includes('adult'), false)
  setzeMeta('adultAnzeigen', 'true')
  assert.deepEqual(einst.adultFilter(), {})
  setzeMeta('adultAnzeigen', 'false')
  assert.deepEqual(einst.adultFilter(), { adult: false }, 'ausgeschaltet: isAdult false')
})
