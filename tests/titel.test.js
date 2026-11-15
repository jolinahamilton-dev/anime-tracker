// Tests für die Titelsprache: Anzeigetitel (englisch/romaji/japanisch, Standard englisch) aus dem lokalen
// Cache titel_cache, Rückfall auf den Originaltitel, die Handler (anzeige_titel) und das Nachladen von AniList.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')

const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
const titel = require(path.join(BUILD, 'main/handlers/titel.js'))
const { registerEntryHandlers } = require(path.join(BUILD, 'main/handlers/entries.js'))
const { registerNewsHandlers } = require(path.join(BUILD, 'main/handlers/news.js'))
const { registerWatchOrderHandlers } = require(path.join(BUILD, 'main/handlers/watchorder.js'))
const { registerSerienHandlers } = require(path.join(BUILD, 'main/handlers/serien.js'))
const { registerStatsHandlers } = require(path.join(BUILD, 'main/handlers/stats.js'))

const kanaele = {}
const ipc = { handle: (name, f) => { kanaele[name] = f } }
for (const r of [registerEntryHandlers, registerNewsHandlers, registerWatchOrderHandlers, registerSerienHandlers, registerStatsHandlers]) r(ipc)
const EVENT = { sender: {} }
const rufe = (g, kanal, ...args) => { g.aktiv(); return kanaele[kanal](EVENT, ...args) }

const KUSURIYA = { romaji: 'Kusuriya no Hitorigoto', english: 'The Apothecary Diaries', native: '薬屋のひとりごと' }

async function umgebung() {
  const { geraet } = await erstelleUmgebung()
  return geraet('pc')
}
const sprache = (g, s) => g.aendere("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('titelSprache', ?)", [s])
const eintrag = (g, anilistId, t, status = 'ongoing', typ = 'ANIME') => {
  g.aendere('INSERT INTO entries (anilist_id, type, title, status) VALUES (?, ?, ?, ?)', [anilistId, typ, t, status])
  return g.eins('SELECT id FROM entries WHERE title = ?', [t]).id
}
const cache = (g, id, t) => { g.aktiv(); titel.merkeTitel(id, t) }

test('Standard ist Englisch, wenn die Einstellung fehlt; unbekannte Werte zählen als Standard', async () => {
  const g = await umgebung()
  g.aktiv()
  assert.equal(titel.titelSprache(), 'englisch')
  sprache(g, 'quatsch')
  assert.equal(titel.titelSprache(), 'englisch')
  sprache(g, 'japanisch')
  assert.equal(titel.titelSprache(), 'japanisch')
})

test('waehleTitel: drei Sprachen mit Rückfall auf den Originaltitel bei leeren/fehlenden Werten', () => {
  const c = { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", japanisch: '葬送のフリーレン' }
  assert.equal(titel.waehleTitel('Sousou no Frieren', c, 'englisch'), "Frieren: Beyond Journey's End")
  assert.equal(titel.waehleTitel('Sousou no Frieren', c, 'japanisch'), '葬送のフリーレン')
  assert.equal(titel.waehleTitel('Sousou no Frieren', c, 'romaji'), 'Sousou no Frieren')
  const ohne = { romaji: 'X', english: null, japanisch: '' }
  assert.equal(titel.waehleTitel('X', ohne, 'englisch'), 'X', 'kein englischer Titel → Original')
  assert.equal(titel.waehleTitel('X', ohne, 'japanisch'), 'X', 'leerer japanischer Titel → Original')
  assert.equal(titel.waehleTitel('Manuell', undefined, 'englisch'), 'Manuell', 'nicht im Cache → Original')
  assert.equal(titel.waehleTitel(null, undefined, 'englisch'), null)
})

test('anzeigeSql wählt wie waehleTitel (SQL), auch für Einträge ohne AniList-ID', async () => {
  const g = await umgebung()
  eintrag(g, 154587, 'Sousou no Frieren')
  eintrag(g, 1, 'Ohne Englisch')
  eintrag(g, null, 'Manuell')
  cache(g, 154587, { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン' })
  cache(g, 1, { romaji: 'Ohne Englisch', english: null, native: '日本語' })
  const ergebnis = s => {
    g.aktiv()
    return Object.fromEntries(g.alle(`SELECT e.title AS title, ${titel.anzeigeSql('e.title', 'e.anilist_id', s)} AS a FROM entries e`).map(r => [r.title, r.a]))
  }
  assert.deepEqual(ergebnis('englisch'), { 'Sousou no Frieren': "Frieren: Beyond Journey's End", 'Ohne Englisch': 'Ohne Englisch', Manuell: 'Manuell' })
  assert.deepEqual(ergebnis('japanisch'), { 'Sousou no Frieren': '葬送のフリーレン', 'Ohne Englisch': '日本語', Manuell: 'Manuell' })
  assert.deepEqual(ergebnis('romaji'), { 'Sousou no Frieren': 'Sousou no Frieren', 'Ohne Englisch': 'Ohne Englisch', Manuell: 'Manuell' })
})

test('entries:getAll/get liefern anzeige_titel und titel_alle; title bleibt das Original', async () => {
  const g = await umgebung()
  const id = eintrag(g, 150672, 'Kusuriya no Hitorigoto')
  const manuell = eintrag(g, null, 'Mein Manga', 'ongoing', 'MANGA')
  cache(g, 150672, KUSURIYA)

  let alle = rufe(g, 'entries:getAll')
  let k = alle.find(e => e.id === id), m = alle.find(e => e.id === manuell)
  assert.equal(k.title, 'Kusuriya no Hitorigoto')
  assert.equal(k.anzeige_titel, 'The Apothecary Diaries', 'Standard: Englisch')
  for (const t of ['apothecary', 'kusuriya', '薬屋']) assert.ok(k.titel_alle.includes(t), `Suche findet „${t}"`)
  assert.equal(m.anzeige_titel, 'Mein Manga')

  sprache(g, 'japanisch')
  assert.equal(rufe(g, 'entries:get', id).anzeige_titel, '薬屋のひとりごと')
  sprache(g, 'romaji')
  assert.equal(rufe(g, 'entries:get', id).anzeige_titel, 'Kusuriya no Hitorigoto')
  assert.equal(rufe(g, 'entries:getAll').find(e => e.id === id).title, 'Kusuriya no Hitorigoto')
  // Ergebnisse von update/Abo tragen den Anzeigetitel ebenfalls
  sprache(g, 'englisch')
  assert.equal(rufe(g, 'entries:update', id, { rating: 4 }).anzeige_titel, 'The Apothecary Diaries')
  assert.equal(rufe(g, 'entries:abo', id, true).anzeige_titel, 'The Apothecary Diaries')
})

test('entries:create merkt die mitgegebenen Titel sofort (auch bei schon vorhandenem Eintrag)', async () => {
  const g = await umgebung()
  const neu = rufe(g, 'entries:create', { anilist_id: 150672, type: 'ANIME', title: KUSURIYA.romaji, titles: KUSURIYA })
  assert.equal(neu.anzeige_titel, 'The Apothecary Diaries')
  assert.equal(g.eins('SELECT english FROM titel_cache WHERE anilist_id = 150672').english, 'The Apothecary Diaries')
  assert.equal(neu.title, KUSURIYA.romaji, 'Original bleibt gespeichert')

  // Ohne Titelobjekt: keine Cache-Zeile, Anzeige = Original
  const ohne = rufe(g, 'entries:create', { anilist_id: 99, type: 'ANIME', title: 'Nur Romaji' })
  assert.equal(ohne.anzeige_titel, 'Nur Romaji')
  assert.equal(g.eins('SELECT 1 AS x FROM titel_cache WHERE anilist_id = 99'), undefined)

  // Schon vorhanden: ergänzt den Cache, ändert aber nichts am Eintrag
  const doppelt = rufe(g, 'entries:create', { anilist_id: 99, type: 'ANIME', title: 'Nur Romaji', titles: { romaji: 'Nur Romaji', english: 'Only Romaji' } })
  assert.equal(doppelt.schonVorhanden, true)
  assert.equal(doppelt.anzeige_titel, 'Only Romaji')
})

test('Weiterschauen, Staffeln (watchorder) und Fortschrittstext nutzen den Anzeigetitel', async () => {
  const g = await umgebung()
  const id = eintrag(g, 10, 'Show Romaji')
  g.aendere("UPDATE entries SET progress_episodes = 1, total_episodes = 12 WHERE id = ?", [id])
  ;[[10, 'MAIN', 'Show Romaji'], [11, 'SEQUEL', 'Show Romaji 2']].forEach(([aid, rel, t], i) =>
    g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, title, total_episodes, progress_episodes, item_status, media_status, aired_episodes)
      VALUES (?, ?, ?, ?, ?, 12, ?, 'started', 'FINISHED', 12)`, [id, aid, rel, i, t, i === 0 ? 1 : 0]))
  cache(g, 10, { romaji: 'Show Romaji', english: 'Show English' })
  cache(g, 11, { romaji: 'Show Romaji 2', english: 'Show English 2' })

  const w = rufe(g, 'entries:weiterschauen')[0]
  assert.equal(w.title, 'Show Romaji')
  assert.equal(w.anzeige_titel, 'Show English')

  const staffeln = rufe(g, 'watchorder:get', id)
  assert.deepEqual(staffeln.map(s => [s.title, s.anzeige_titel]), [['Show Romaji', 'Show English'], ['Show Romaji 2', 'Show English 2']])
  assert.deepEqual(rufe(g, 'watchorder:save', id, staffeln).items.map(s => s.anzeige_titel), ['Show English', 'Show English 2'])
  assert.deepEqual(g.alle('SELECT title FROM watch_order ORDER BY position').map(r => r.title), ['Show Romaji', 'Show Romaji 2'], 'gespeichert wird nur das Original')

  const r = rufe(g, 'entries:fortschritt', id, 1)
  assert.ok(r.beschreibung.startsWith('Show English'), r.beschreibung)
  assert.equal(r.entry.anzeige_titel, 'Show English')

  // Alle Staffelzeilen in der Liste der Einträge: aktuelle Staffel mit Anzeigetitel
  const e = rufe(g, 'entries:get', id)
  assert.ok(!e.staffel_titel || e.staffel_titel.startsWith('Show English'))
})

test('News und neue Staffeln: anzeige_titel aus dem Cache', async () => {
  const g = await umgebung()
  const id = eintrag(g, 20, 'Serie Romaji')
  g.aendere('UPDATE entries SET abonniert = 1 WHERE id = ?', [id])
  cache(g, 20, { romaji: 'Serie Romaji', english: 'Series English' })
  g.aendere('INSERT INTO news_cache (anilist_id, episode, airing_at, seen) VALUES (20, 3, ?, 0)', [Math.floor(Date.now() / 1000) - 3600])
  const n = rufe(g, 'news:getAll')
  assert.equal(n.length, 1)
  assert.equal(n[0].title, 'Serie Romaji')
  assert.equal(n[0].anzeige_titel, 'Series English')
  sprache(g, 'romaji')
  assert.equal(rufe(g, 'news:getAll')[0].anzeige_titel, 'Serie Romaji')

  sprache(g, 'englisch')
  g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, title, media_status, neu_seit)
    VALUES (?, 21, 'SEQUEL', 1, 'Serie Romaji 2', 'NOT_YET_RELEASED', ?)`, [id, new Date().toISOString()])
  cache(g, 21, { romaji: 'Serie Romaji 2', english: 'Series English 2' })
  const s = rufe(g, 'serien:neueStaffeln')
  assert.equal(s.length, 1)
  assert.equal(s[0].anzeige_titel, 'Series English 2')
  assert.equal(s[0].anzeige_serie, 'Series English')
  assert.equal(s[0].serie, 'Serie Romaji')
})

test('Statistik: Top-Manga mit Anzeigetitel', async () => {
  const g = await umgebung()
  const id = eintrag(g, 30, 'Manga Romaji', 'ongoing', 'MANGA')
  g.aendere('UPDATE entries SET progress_chapters = 10 WHERE id = ?', [id])
  cache(g, 30, { romaji: 'Manga Romaji', english: 'Manga English' })
  const m = rufe(g, 'stats:get').topManga[0]
  assert.equal(m.title, 'Manga Romaji')
  assert.equal(m.anzeige_titel, 'Manga English')
})

test('ergaenzeTitel: Pakete à 25, unbekannte IDs als leere Zeile, nur Fehlendes, danach Hinweis an die Seite', async () => {
  const g = await umgebung()
  g.aktiv()
  for (let i = 1; i <= 40; i++) eintrag(g, i, `Titel ${i}`)
  g.aendere("INSERT INTO entries (type, title, status) VALUES ('MANGA', 'Ohne ID', 'planned')")
  // Staffel einer Serie (ID 100) und eine Staffel mit schon bekannter ID (1)
  const e1 = g.eins("SELECT id FROM entries WHERE title = 'Titel 1'").id
  for (const aid of [100, 1]) g.aendere("INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position) VALUES (?, ?, 'SEQUEL', 0)", [e1, aid])
  cache(g, 1, { romaji: 'Titel 1', english: 'Title 1' })

  const anfragen = []
  const abfrage = async (query, variablen) => {
    anfragen.push(variablen.ids)
    // AniList kennt 100 nicht; Titel 7 hat keinen englischen Titel
    return { data: { Page: { media: variablen.ids.filter(i => i !== 100).map(i => ({ id: i, title: { romaji: `Titel ${i}`, english: i === 7 ? null : `Title ${i}`, native: `タイトル${i}` } })) } } }
  }
  const gesendet = []
  const fenster = { isDestroyed: () => false, webContents: { send: (kanal, daten) => gesendet.push([kanal, daten]) } }

  const n = await titel.ergaenzeTitel(fenster, abfrage, 0)
  assert.equal(n, 39, '39 Titel neu (ID 1 war schon da, 100 unbekannt)')
  assert.deepEqual(anfragen.map(a => a.length), [25, 15], '40 fehlende IDs (2..40 und 100) in Paketen à 25: 25 + 15')
  assert.equal(anfragen.flat().includes(1), false, 'bekannte ID wird nicht erneut angefragt')
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM titel_cache').n, 41)
  const unbekannt = g.eins('SELECT * FROM titel_cache WHERE anilist_id = 100')
  assert.equal(unbekannt.english, null); assert.equal(unbekannt.romaji, null)
  assert.equal(g.eins('SELECT english, japanisch FROM titel_cache WHERE anilist_id = 5').japanisch, 'タイトル5')
  assert.equal(gesendet.length, 1)
  assert.equal(gesendet[0][0], 'serien:aktualisiert')
  assert.ok(gesendet[0][1].geaendert.length >= 40)

  // Idempotent: nichts mehr zu holen → keine Anfrage, kein Hinweis
  anfragen.length = 0; gesendet.length = 0
  assert.equal(await titel.ergaenzeTitel(fenster, abfrage, 0), 0)
  assert.equal(anfragen.length, 0)
  assert.equal(gesendet.length, 0)

  // Zeilen ohne englischen Titel werden nach 30 Tagen noch einmal geprüft – frühere nicht
  g.aendere("UPDATE titel_cache SET geprueft = datetime('now', '-31 days') WHERE anilist_id IN (7, 100)")
  g.aendere("UPDATE titel_cache SET geprueft = datetime('now', '-31 days') WHERE anilist_id = 8") // hat Englisch → nicht erneut
  await titel.ergaenzeTitel(fenster, abfrage, 0)
  assert.deepEqual(anfragen.flat().sort((a, b) => a - b), [7, 100])
})

test('ergaenzeTitel: Netzfehler bricht ab, bereits geholte Pakete bleiben, der Rest kommt beim nächsten Mal', async () => {
  const g = await umgebung()
  g.aktiv()
  for (let i = 1; i <= 30; i++) eintrag(g, i, `Titel ${i}`)
  let aufrufe = 0
  const abfrage = async (q, v) => {
    if (++aufrufe === 2) throw new Error('offline')
    return { data: { Page: { media: v.ids.map(i => ({ id: i, title: { romaji: `T${i}`, english: `E${i}`, native: null } })) } } }
  }
  await assert.rejects(titel.ergaenzeTitel(null, abfrage, 0), /offline/)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM titel_cache').n, 25)
  assert.equal(await titel.ergaenzeTitel(null, abfrage, 0), 5, 'nächster Versuch holt nur den Rest')
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM titel_cache').n, 30)
})
