// Tests für den Import (Plan 13 und 14): Serien zusammenfassen, Status, Punkteformate, Trockenlauf = echter Lauf,
// doppelter Lauf, Rücknahme, MAL-XML (auch .gz), CSV, Prüfliste. AniList ist eine Attrappe (fetch) – kein Netz.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const zlib = require('zlib')
const { erstelleUmgebung } = require('./hilfe')

const B = process.env.ANIME_TRACKER_TEST_BUILD
const G = require(path.join(B, 'main/handlers/import-gruppen.js'))
const F = require(path.join(B, 'main/handlers/import-fremd.js'))
const I = require(path.join(B, 'main/handlers/anilist-import.js'))
const O = { wartezeit: 0 }

// ── Attrappe: kleine AniList-Welt ────────────────────────────────────────────
let jahr = 2015
const media = (id, format, episodes, kanten = [], titel = `Titel ${id}`, extra = {}) => ({
  id, idMal: 1000 + id, type: 'ANIME', format, status: 'FINISHED', episodes, duration: 24, nextAiringEpisode: null,
  title: { romaji: titel, english: `${titel} (EN)`, native: null }, coverImage: { large: `c${id}.jpg` },
  genres: ['Action'], description: 'Text<br>zwei', isAdult: false,
  startDate: { year: jahr++, month: 1, day: 1 }, endDate: { year: jahr, month: 6, day: 1 },
  relations: { edges: kanten.map(([relationType, nid, nformat = 'TV']) => ({ relationType, node: { id: nid, type: 'ANIME', format: nformat, status: 'FINISHED', title: { romaji: `Titel ${nid}` }, coverImage: { large: `c${nid}.jpg` } } })) },
  ...extra,
})
const WELT = new Map([
  // Serie A: Staffel 1 → Film → Staffel 2 → Staffel 3 (Ankündigung), dazu eine Kurzserie als Nebengeschichte
  [1, media(1, 'TV', 24, [['SEQUEL', 4, 'MOVIE'], ['SIDE_STORY', 5, 'ONA']], 'Apothecary')],
  [4, media(4, 'MOVIE', 1, [['PREQUEL', 1], ['SEQUEL', 2]], 'Apothecary Film')],
  [2, media(2, 'TV', 24, [['PREQUEL', 4, 'MOVIE'], ['SEQUEL', 3]], 'Apothecary 2nd Season')],
  [3, media(3, 'TV', 12, [['PREQUEL', 2]], 'Apothecary 3rd Season', { status: 'NOT_YET_RELEASED' })],
  [5, media(5, 'ONA', 6, [['PARENT', 1]], 'Apothecary Kurz')],
  // Einzelfilm ohne Verknüpfungen
  [6, media(6, 'MOVIE', 1, [], 'Einzelfilm')],
  // Serie B: die Liste beginnt erst bei Staffel 2; OVA als Nebengeschichte
  [10, media(10, 'TV', 12, [['SEQUEL', 11], ['SIDE_STORY', 12, 'OVA']], 'Serie B')],
  [11, media(11, 'TV', 12, [['PREQUEL', 10]], 'Serie B 2')],
  [12, media(12, 'OVA', 2, [['PARENT', 10]], 'Serie B OVA')],
  // Kette mit OVA als Vorgänger der TV-Serie („Gaiden“)
  [20, media(20, 'OVA', 2, [['SEQUEL', 21]], 'Gaiden OVA')],
  [21, media(21, 'TV', 25, [['PREQUEL', 20, 'OVA'], ['SEQUEL', 22]], 'Titanen')],
  [22, media(22, 'TV', 12, [['PREQUEL', 21]], 'Titanen 2')],
])
const MANGA = new Map([
  [200, { id: 200, idMal: 2200, type: 'MANGA', format: 'MANGA', status: 'FINISHED', chapters: 50, volumes: 5, title: { romaji: 'Manga Eins', english: null, native: null }, coverImage: { large: 'm200.jpg' }, genres: ['Drama'], description: 'M', isAdult: false }],
  [201, { id: 201, idMal: 2201, type: 'MANGA', format: 'MANGA', status: 'RELEASING', chapters: null, volumes: null, title: { romaji: 'Manga Zwei', english: null, native: null }, coverImage: { large: 'm201.jpg' }, genres: [], description: null, isAdult: false }],
])
const eintrag = (media_id, status, progress, score, extra = {}) => ({ status, score, progress, progressVolumes: 0, repeat: 0, notes: null, completedAt: { year: null, month: null, day: null }, media: { ...(MANGA.get(media_id) ?? { id: media_id, idMal: 1000 + media_id, type: 'ANIME', title: WELT.get(media_id)?.title }) }, ...extra })
const datum = (y, m, d) => ({ year: y, month: m, day: d })
const LISTEN = {
  'jolina:ANIME': { format: 'POINT_100', eintraege: [
    eintrag(1, 'COMPLETED', 24, 80, { completedAt: datum(2020, 5, 1), repeat: 1, notes: 'Toll' }),
    eintrag(4, 'COMPLETED', 1, 100, { completedAt: datum(2021, 2, 3) }),
    eintrag(2, 'CURRENT', 10, 60),
    eintrag(5, 'COMPLETED', 6, 0),
    eintrag(6, 'PLANNING', 0, 0),
    eintrag(11, 'COMPLETED', 12, 70, { completedAt: datum(2022, 1, 1) }),
    eintrag(12, 'COMPLETED', 2, 0),
  ] },
  'jolina:MANGA': { format: 'POINT_100', eintraege: [eintrag(200, 'COMPLETED', 50, 90, { progressVolumes: 5, completedAt: datum(2023, 3, 3) }), eintrag(201, 'CURRENT', 12, 0)] },
}
const SUCHE = new Map() // normalisierter Titel → Kandidaten
let aufrufe = []
function mitAniList(f) {
  const echt = globalThis.fetch
  aufrufe = []
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body)
    aufrufe.push({ query, variables })
    const antwort = (status, json) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(json) })
    if (query.includes('MediaListCollection')) {
      if (variables.userName === 'privat') return antwort(404, { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 404 }] })
      const l = LISTEN[`${variables.userName}:${variables.type}`]
      if (!l) return antwort(404, { data: { MediaListCollection: null }, errors: [{ message: 'User not found', status: 404 }] })
      // zwei Blöcke, damit das Weiterblättern mitgetestet wird
      const hälfte = Math.ceil(l.eintraege.length / 2)
      const teil = variables.chunk === 1 ? l.eintraege.slice(0, hälfte) : l.eintraege.slice(hälfte)
      return antwort(200, { data: { MediaListCollection: { hasNextChunk: variables.chunk === 1 && l.eintraege.length > 1,
        user: { name: variables.userName, mediaListOptions: { scoreFormat: l.format } },
        lists: [{ isCustomList: false, entries: teil }, { isCustomList: true, entries: teil }] } } })
    }
    if (query.includes('idMal_in')) {
      const quelle = variables.type === 'MANGA' ? MANGA : WELT
      const treffer = [...quelle.values()].filter(m => variables.ids.includes(m.idMal)).map(m => ({ id: m.id, idMal: m.idMal }))
      return antwort(200, { data: { Page: { media: treffer } } })
    }
    if (query.includes('search:')) return antwort(200, { data: { Page: { media: SUCHE.get(String(variables.search).toLowerCase()) ?? [] } } })
    const quelle = query.includes('type: MANGA') ? MANGA : WELT
    assert.ok(variables.ids.length <= 25, 'höchstens 25 IDs je Anfrage')
    assert.ok(!('isAdult' in variables), 'isAdult wird nicht als Variable gesendet')
    return antwort(200, { data: { Page: { media: variables.ids.map(id => quelle.get(id)).filter(Boolean) } } })
  }
  return Promise.resolve(f()).finally(() => { globalThis.fetch = echt })
}
const ablage = () => { const m = new Map(); return { m, lies: async k => m.get(k) ?? null, schreib: async (k, t) => { m.set(k, t) } } }
const zaehle = (g, t) => g.eins(`SELECT COUNT(*) AS n FROM ${t}`).n

// ── Werte ────────────────────────────────────────────────────────────────────
test('Bewertung: alle fünf Punkteformate → 1–5 Sterne, 0 = nicht bewertet', () => {
  const s = G.sterneAus
  assert.deepEqual([100, 90, 70, 50, 30, 10, 0].map(x => s(x, 'POINT_100')), [5, 5, 4, 3, 2, 1, null])
  assert.deepEqual([10, 8.5, 7.5, 5, 1, 0].map(x => s(x, 'POINT_10_DECIMAL')), [5, 4, 4, 3, 1, null].map(x => x))
  assert.deepEqual([10, 7, 4, 1].map(x => s(x, 'POINT_10')), [5, 4, 2, 1])
  assert.deepEqual([5, 3, 1, 0].map(x => s(x, 'POINT_5')), [5, 3, 1, null])
  assert.deepEqual([1, 2, 3, 0].map(x => s(x, 'POINT_3')), [1, 3, 5, null])
  assert.equal(s(5, 'UNBEKANNT'), null)
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(G.sterneAus10), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
})

test('Status der Serie aus den Staffeln', () => {
  const z = (status, hauptlinie = true, erschienen = true) => ({ status, hauptlinie, erschienen })
  assert.equal(G.serienStatus([z('COMPLETED'), z('CURRENT')]), 'ongoing')
  assert.equal(G.serienStatus([z('REPEATING')]), 'ongoing')
  assert.equal(G.serienStatus([z('COMPLETED'), z('COMPLETED')]), 'completed')
  assert.equal(G.serienStatus([z('COMPLETED'), z(null, true, false)]), 'completed', 'Angekündigtes zählt nicht')
  assert.equal(G.serienStatus([z('COMPLETED'), z('PLANNING', false)]), 'completed', 'geplanter Film verhindert Beendet nicht')
  assert.equal(G.serienStatus([z('COMPLETED'), z(null)]), 'paused', 'nächste Staffel erschienen, nicht gesehen')
  assert.equal(G.serienStatus([z('PLANNING'), z(null)]), 'planned')
  assert.equal(G.serienStatus([z('DROPPED'), z('DROPPED'), z('PAUSED')]), 'dropped')
  assert.equal(G.serienStatus([z('DROPPED'), z('PAUSED')]), 'paused')
  assert.equal(G.serienStatus([z('PAUSED')]), 'paused')
  assert.equal(G.serienStatus([z('DROPPED')]), 'dropped')
  assert.deepEqual(['CURRENT', 'REPEATING', 'COMPLETED', 'PLANNING', 'PAUSED', 'DROPPED'].map(s => G.staffelStatusVon(s)),
    ['started', 'started', 'completed', 'planned', 'started', 'planned'])
})

// ── Gruppierung ──────────────────────────────────────────────────────────────
const zeile = (nr, id, status, fortschritt = 0, extra = {}) => ({ nr, typ: 'ANIME', anilistId: id, malId: null, titel: `Titel ${id}`, status, fortschritt, baende: 0, bewertung: null, wiederholungen: 0, notiz: null, beendet: null, ...extra })

test('Gruppierung: Kette über Staffeln mit Film, Nebengeschichte, Einzelfilm, Liste ab Staffel 2', () => {
  const cache = new Map(WELT)
  const { serien, fehlend } = G.ordneAnime([
    zeile(1, 1, 'COMPLETED', 24), zeile(2, 4, 'COMPLETED', 1), zeile(3, 2, 'CURRENT', 10), zeile(4, 5, 'COMPLETED', 6),
    zeile(5, 6, 'PLANNING'), zeile(6, 11, 'COMPLETED', 12), zeile(7, 12, 'COMPLETED', 2),
  ], cache)
  assert.equal(fehlend.length, 0)
  assert.equal(serien.length, 3, 'sieben Zeilen → drei Serien')
  const a = serien.find(s => s.hauptId === 1)
  assert.equal(a.titel, 'Apothecary', 'Titel der ersten Staffel')
  assert.deepEqual(a.staffeln.map(s => [s.id, s.relation]), [[1, 'MAIN'], [4, 'SEQUEL'], [2, 'SEQUEL'], [3, 'SEQUEL'], [5, 'SIDE_STORY']])
  assert.equal(a.quellZeilen, 4)
  assert.deepEqual(a.staffeln.map(s => [s.itemStatus, s.fortschritt]), [['completed', 24], ['completed', 1], ['started', 10], ['planned', 0], ['completed', 6]])
  assert.equal(a.status, 'ongoing')
  assert.equal(a.fortschritt, 24, 'Eintrag zeigt die Hauptstaffel')
  // Serie B: Liste beginnt bei Staffel 2, Staffel 1 kommt als „geplant“ dazu, die OVA ist Nebengeschichte
  const b = serien.find(s => s.hauptId === 10)
  assert.equal(b.titel, 'Serie B')
  assert.deepEqual(b.staffeln.map(s => [s.id, s.relation, s.itemStatus]), [[10, 'MAIN', 'planned'], [11, 'SEQUEL', 'completed'], [12, 'SIDE_STORY', 'completed']])
  assert.equal(b.quellZeilen, 2)
  // Einzelfilm bleibt ein eigener Eintrag ohne Staffeln
  const film = serien.find(s => s.hauptId === 6)
  assert.deepEqual(film.staffeln, [])
  assert.equal(film.status, 'planned')
})

test('Gruppierung: Bewertung = gerundeter Durchschnitt, Wiederholungen = Höchstwert, Notizen mit Staffelhinweis, Beendet = letztes Datum', () => {
  const { serien } = G.ordneAnime([
    zeile(1, 1, 'COMPLETED', 24, { bewertung: 4, wiederholungen: 1, notiz: 'Toll', beendet: '2020-05-01' }),
    zeile(2, 2, 'COMPLETED', 24, { bewertung: 5, wiederholungen: 3, notiz: 'Noch besser', beendet: '2021-01-02' }),
    zeile(3, 4, 'COMPLETED', 1),
  ], new Map(WELT))
  const a = serien[0]
  assert.equal(a.bewertung, 5, '4,5 wird aufgerundet')
  assert.equal(a.wiederholungen, 3)
  assert.equal(a.beendet, '2021-01-02')
  assert.equal(a.notiz, 'Apothecary: Toll\n\nApothecary 2nd Season: Noch besser')
  assert.equal(a.status, 'completed', 'Staffel 3 ist nur angekündigt und zählt nicht')
})

test('Gruppierung: eine OVA allein mit Elternserie bleibt eigener Eintrag (Kette von der Elternserie)', () => {
  const cache = new Map(WELT)
  const { serien } = G.ordneAnime([zeile(1, 12, 'COMPLETED', 2)], cache)
  assert.equal(serien.length, 1)
  assert.equal(serien[0].hauptId, 12)
  assert.ok(serien[0].staffeln.some(s => s.id === 10), 'Elternserie steht als Vorgänger in der Watch-Order')
})

// ── Lauf mit AniList-Benutzername ────────────────────────────────────────────
test('AniList-Benutzername: Prüfen = Importieren, nur Neues, zweiter Lauf legt nichts an, Rücknahme löscht genau den Lauf', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  // ein schon vorhandener Eintrag mit eigenem Stand – darf nie verändert werden
  g.aendere("INSERT INTO entries (anilist_id, type, title, status, rating, review) VALUES (200, 'MANGA', 'Mein Manga', 'dropped', 2, 'alt')")
  const vorher = g.eins('SELECT * FROM entries WHERE anilist_id = 200')

  const { plan } = await mitAniList(() => I.planAusBenutzer('jolina', true, true, O))
  const e = I.alsErgebnis(plan)
  assert.equal(e.eintraegeQuelle, 9)
  assert.equal(e.serien, 5, 'drei Anime-Serien + zwei Manga')
  assert.equal(e.zusammengefasst, 4)
  assert.equal(e.vorhanden, 1, 'Manga 200 gibt es schon')
  assert.equal(e.neu, 4)
  assert.ok(aufrufe.every(a => !a.query.includes('relations') || (a.variables.ids?.length ?? 0) <= 25))

  const ab = ablage()
  const r = await I.fuehreImportAus(plan, ab)
  assert.equal(r.angelegt, e.neu, 'Trockenlauf = tatsächlicher Lauf')
  assert.equal(r.vorhanden, 1)
  assert.equal(zaehle(g, 'entries'), 1 + 4)
  assert.deepEqual(g.eins('SELECT * FROM entries WHERE anilist_id = 200'), vorher, 'vorhandener Eintrag bleibt unberührt')
  assert.equal(JSON.parse(ab.m.get('sicherung')).format, 'anime-tracker-sicherung', 'Sicherheitskopie vorher')

  // Eintrag der Serie A
  const a = g.eins('SELECT * FROM entries WHERE anilist_id = 1')
  assert.equal(a.title, 'Apothecary')
  assert.equal(a.status, 'ongoing')
  assert.equal(a.abonniert, 1)
  assert.equal(a.progress_episodes, 24)
  assert.equal(a.total_episodes, 24)
  assert.equal(a.rating, 4)
  assert.equal(a.rewatch_count, 1)
  assert.equal(a.finished_at, '2021-02-03 12:00:00')
  assert.equal(a.genres, '["Action"]')
  assert.equal(a.description, 'Text\nzwei')
  assert.deepEqual(g.alle('SELECT related_anilist_id AS id, relation_type AS r, progress_episodes AS p, item_status AS s FROM watch_order WHERE entry_id = ? ORDER BY position', [a.id]),
    [{ id: 1, r: 'MAIN', p: 24, s: 'completed' }, { id: 4, r: 'SEQUEL', p: 1, s: 'completed' }, { id: 2, r: 'SEQUEL', p: 10, s: 'started' }, { id: 3, r: 'SEQUEL', p: 0, s: 'planned' }, { id: 5, r: 'SIDE_STORY', p: 6, s: 'completed' }])
  // kein Eintrag je Staffel
  for (const id of [4, 2, 5, 11, 12, 3]) assert.equal(g.eins('SELECT 1 AS x FROM entries WHERE anilist_id = ?', [id]), undefined, `Staffel ${id} hat keinen eigenen Eintrag`)
  // Einzelfilm ohne Watch-Order, Manga mit Kapiteln/Bänden
  assert.equal(g.alle('SELECT 1 FROM watch_order WHERE entry_id = (SELECT id FROM entries WHERE anilist_id = 6)').length, 0)
  const m = g.eins('SELECT * FROM entries WHERE anilist_id = 201')
  assert.equal(m.type, 'MANGA'); assert.equal(m.progress_chapters, 12); assert.equal(m.status, 'ongoing')
  // Verlauf zählt nicht als gesehen
  assert.ok(g.alle('SELECT quelle FROM verlauf').every(v => v.quelle === 'import'))
  assert.ok(zaehle(g, 'verlauf') > 0)

  // Zweiter Lauf: alles vorhanden, nichts Neues
  const { plan: plan2 } = await mitAniList(() => I.planAusBenutzer('jolina', true, true, O))
  assert.equal(I.alsErgebnis(plan2).neu, 0)
  assert.equal(I.alsErgebnis(plan2).vorhanden, 5)
  const r2 = await I.fuehreImportAus(plan2, ab)
  assert.equal(r2.angelegt, 0)
  assert.equal(zaehle(g, 'entries'), 5)
  // der Merkzettel des ersten Laufs bleibt (der zweite hat nichts angelegt)
  assert.equal((await I.letzterLauf(ab)).anzahl, 4)

  // Rücknahme: genau die vier neuen Einträge weg, der alte bleibt
  const z = await I.nimmZurueck(ab)
  assert.equal(z.geloescht, 4)
  assert.equal(zaehle(g, 'entries'), 1)
  assert.equal(zaehle(g, 'watch_order'), 0)
  assert.equal(zaehle(g, 'verlauf'), 0)
  assert.deepEqual(g.eins('SELECT * FROM entries WHERE anilist_id = 200'), vorher)
  assert.equal(await I.letzterLauf(ab), null)
  assert.deepEqual(await I.nimmZurueck(ab), { geloescht: 0 })
})

test('Vorhanden erkannt über Watch-Order-ID (Staffel 2 hat schon einen eigenen Eintrag) und über Titel', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  g.aendere("INSERT INTO entries (anilist_id, type, title, status) VALUES (2, 'ANIME', 'Eigener Titel', 'ongoing')")
  const id = g.eins('SELECT id FROM entries').id
  g.aendere("INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position) VALUES (?, 11, 'SEQUEL', 0)", [id])
  g.aendere("INSERT INTO entries (type, title, status) VALUES ('ANIME', 'Einzelfilm', 'completed')")
  const { plan } = await mitAniList(() => I.planAusBenutzer('jolina', true, false, O))
  const e = I.alsErgebnis(plan)
  assert.equal(e.serien, 3)
  assert.equal(e.vorhanden, 3, 'A über Staffel 2, B über die Watch-Order-Zeile, Film über den Titel')
  assert.equal(e.neu, 0)
  const r = await I.fuehreImportAus(plan, ablage())
  assert.equal(r.angelegt, 0)
  assert.equal(zaehle(g, 'entries'), 2)
})

test('Benutzername: private Liste, unbekannter Benutzer, leere Eingabe → klare Meldungen', async () => {
  await assert.rejects(mitAniList(() => I.planAusBenutzer('privat', true, false, O)), /privat/)
  await assert.rejects(mitAniList(() => I.planAusBenutzer('gibtsnicht', true, false, O)), /nicht gefunden/)
  await assert.rejects(I.planAusBenutzer('  ', true, false, O), /Benutzernamen/)
  await assert.rejects(I.planAusBenutzer('x', false, false, O), /Anime und\/oder Manga/)
})

test('Abbrechen: nichts wird angelegt', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  await assert.rejects(mitAniList(() => I.planAusBenutzer('jolina', true, true, { ...O, abbrechen: () => true })), /Abgebrochen/)
  assert.equal(zaehle(g, 'entries'), 0)
})

test('18+: ohne „18+ anzeigen“ werden 18+-Titel nicht übernommen', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  g.aendere("INSERT INTO app_meta (key, value) VALUES ('adultAnzeigen', 'false')")
  WELT.get(6).isAdult = true
  try {
    const { plan } = await mitAniList(() => I.planAusBenutzer('jolina', true, false, O))
    assert.equal(I.alsErgebnis(plan).serien, 2)
    assert.equal(plan.uebersprungen18, 1)
  } finally { WELT.get(6).isAdult = false }
})

// ── Fremde Dateien ───────────────────────────────────────────────────────────
const xml = (anime, manga = '') => `<?xml version="1.0" encoding="UTF-8" ?><myanimelist><myinfo><user_export_type>1</user_export_type></myinfo>${anime}${manga}</myanimelist>`
const malAnime = (id, titel, status, ep, score, extra = '') => `<anime><series_animedb_id>${id}</series_animedb_id><series_title><![CDATA[${titel}]]></series_title><series_type>TV</series_type><my_watched_episodes>${ep}</my_watched_episodes><my_start_date>0000-00-00</my_start_date><my_finish_date>${extra || '0000-00-00'}</my_finish_date><my_score>${score}</my_score><my_status>${status}</my_status><my_times_watched>0</my_times_watched></anime>`

test('MAL-XML: alle Status, Bewertung 1–10 → Sterne, Datum, Sonderzeichen, Manga', () => {
  const l = F.leseMalXml(xml(
    malAnime(1001, 'A & B', 'Watching', 3, 0) + malAnime(1002, 'Zwei', 'Completed', 12, 9, '2020-02-03') + malAnime(1003, 'Drei', 'On-Hold', 1, 5) +
    malAnime(1004, 'Vier', 'Dropped', 2, 1) + malAnime(1005, 'Fünf', 'Plan to Watch', 0, 10) + malAnime(0, 'Ohne ID', 'Completed', 1, 1),
    `<manga><manga_mangadb_id>2200</manga_mangadb_id><manga_title><![CDATA[Manga Eins]]></manga_title><my_read_chapters>7</my_read_chapters><my_read_volumes>2</my_read_volumes><my_score>8</my_score><my_status>Reading</my_status><my_times_read>1</my_times_read></manga>`))
  assert.equal(l.format, 'MyAnimeList (XML)')
  assert.equal(l.uebersprungen, 1)
  assert.deepEqual(l.zeilen.map(z => [z.malId, z.typ, z.status, z.fortschritt, z.bewertung]), [
    [1001, 'ANIME', 'CURRENT', 3, null], [1002, 'ANIME', 'COMPLETED', 12, 5], [1003, 'ANIME', 'PAUSED', 1, 3],
    [1004, 'ANIME', 'DROPPED', 2, 1], [1005, 'ANIME', 'PLANNING', 0, 5], [2200, 'MANGA', 'CURRENT', 7, 4]])
  assert.equal(l.zeilen[0].titel, 'A & B')
  assert.equal(l.zeilen[1].beendet, '2020-02-03')
  assert.equal(l.zeilen[5].baende, 2); assert.equal(l.zeilen[5].wiederholungen, 1)
})

test('MAL-XML: mit und ohne .gz gleich; kaputte und leere Dateien → klare Meldung', () => {
  const text = xml(malAnime(1001, 'Eins', 'Completed', 24, 8))
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'))
  assert.ok(F.istGzip(gz)); assert.ok(!F.istGzip(Buffer.from(text)))
  assert.deepEqual(F.leseFremdeListe(zlib.gunzipSync(gz).toString('utf8')), F.leseFremdeListe(text))
  assert.throws(() => F.leseFremdeListe(''), /leer/)
  assert.throws(() => F.leseFremdeListe('<html><body>Kaputt</body></html>'), /keine MyAnimeList-Datei/)
  assert.throws(() => F.leseFremdeListe(xml('')), /keine Einträge/)
  assert.throws(() => F.leseFremdeListe('Titel;Typ\n'), /leer|Kopfzeile/)
  assert.throws(() => F.leseFremdeListe('Foo;Bar\n1;2'), /Spalte/)
})

test('MAL-Import: Staffeln einzeln aufgeführt → eine Serie, nicht zugeordnete Titel, zweiter Lauf legt nichts an', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  const liste = F.leseFremdeListe(xml(
    malAnime(1001, 'Apothecary', 'Completed', 24, 8, '2020-05-01') + malAnime(1002, 'Apothecary 2nd Season', 'Watching', 5, 6) +
    malAnime(1006, 'Einzelfilm', 'Plan to Watch', 0, 0) + malAnime(777777, 'Unbekannt bei AniList', 'Completed', 1, 5)))
  const { plan } = await mitAniList(() => I.planAusDatei(liste, 'mal.xml', O))
  const e = I.alsErgebnis(plan)
  assert.equal(e.eintraegeQuelle, 4)
  assert.equal(e.serien, 2, 'Staffeln 1 und 2 sind eine Serie, dazu der Film')
  assert.equal(e.zusammengefasst, 1)
  assert.deepEqual(e.nichtZugeordnet.map(n => [n.titel, n.grund]), [['Unbekannt bei AniList', 'Die MAL-ID ist bei AniList unbekannt']])
  assert.equal(e.neu, 2)
  const ab = ablage()
  assert.equal((await I.fuehreImportAus(plan, ab)).angelegt, 2)
  const a = g.eins('SELECT * FROM entries WHERE anilist_id = 1')
  assert.equal(a.status, 'ongoing'); assert.equal(a.rating, 4)
  assert.equal(g.alle('SELECT 1 FROM watch_order WHERE entry_id = ?', [a.id]).length, 5)
  const { plan: p2 } = await mitAniList(() => I.planAusDatei(liste, 'mal.xml', O))
  assert.equal((await I.fuehreImportAus(p2, ab)).angelegt, 0)
  assert.equal(zaehle(g, 'entries'), 2)
})

test('CSV: deutsche und englische Spalten, Zuordnung, Titelsuche eindeutig / Prüfliste / nicht gefunden', async () => {
  const csv = 'Titel;Typ;Status;Fortschritt;Bewertung\nApothecary;Anime;Beendet;24;4\nZweideutig;Anime;Laufend;3;8\nNirgends;Manga;Geplant;0;\nOhne Treffer;Anime;Pausiert;1;5\n'
  const l = F.leseFremdeListe(csv)
  assert.equal(l.format, 'CSV')
  assert.deepEqual(l.zuordnung.map(z => z.feld), ['titel', 'typ', 'status', 'fortschritt', 'bewertung'])
  assert.deepEqual(l.zeilen.map(z => [z.typ, z.status, z.fortschritt, z.bewertung]), [
    ['ANIME', 'COMPLETED', 24, 2], ['ANIME', 'CURRENT', 3, 4], ['MANGA', 'PLANNING', 0, null], ['ANIME', 'PAUSED', 1, 3]], 'höchste Bewertung 8 → Datei gilt als 0–10')
  const en = F.leseFremdeListe('title,type,status,progress,score,mal_id\nFoo,manga,reading,5,3,2200\n')
  assert.deepEqual([en.zeilen[0].typ, en.zeilen[0].status, en.zeilen[0].malId, en.zeilen[0].bewertung], ['MANGA', 'CURRENT', 2200, 3])

  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  SUCHE.set('apothecary', [{ id: 1, format: 'TV', popularity: 5, title: { romaji: 'Apothecary' }, synonyms: [] }])
  SUCHE.set('zweideutig', [{ id: 6, format: 'MOVIE', popularity: 5, title: { romaji: 'Zweideutig' }, synonyms: [] }, { id: 10, format: 'MOVIE', popularity: 5, title: { romaji: 'Zweideutig' }, synonyms: [] }])
  SUCHE.set('ohne treffer', [])
  SUCHE.set('nirgends', [])
  const { plan, zustand } = await mitAniList(() => I.planAusDatei(l, 'liste.csv', O))
  let e = I.alsErgebnis(plan)
  assert.equal(e.serien, 1, 'nur der eindeutige Treffer ist zugeordnet')
  assert.deepEqual(e.pruefen.map(p => [p.titel, p.vorschlag.id]), [['Zweideutig', 6]], 'Gleichstand → Vorschlag, nicht geraten')
  assert.deepEqual(e.nichtZugeordnet.map(n => n.titel), ['Nirgends', 'Ohne Treffer'])
  // Vorschlag übernehmen → nur der neue Titel wird nachgeladen
  const plan2 = await mitAniList(() => I.plusVorschlaege(zustand, [e.pruefen[0].nr], O))
  e = I.alsErgebnis(plan2)
  assert.equal(e.serien, 2); assert.equal(e.pruefen.length, 0)
  assert.equal((await I.fuehreImportAus(plan2, ablage())).angelegt, 2)
  assert.equal(g.eins('SELECT status FROM entries WHERE anilist_id = 6').status, 'ongoing')
})

test('Eine OVA, die schon Nebengeschichte im Eintrag ihrer Serie ist, wird nicht noch einmal angelegt', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  g.aendere("INSERT INTO entries (anilist_id, type, title, status) VALUES (10, 'ANIME', 'Serie B', 'ongoing')")
  const id = g.eins('SELECT id FROM entries').id
  g.aendere("INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position) VALUES (?, 10, 'MAIN', 0), (?, 12, 'SIDE_STORY', 1)", [id, id])
  const l = [{ nr: 1, typ: 'ANIME', anilistId: 12, malId: null, titel: 'Serie B OVA', status: 'COMPLETED', fortschritt: 2, baende: 0, bewertung: null, wiederholungen: 0, notiz: null, beendet: null }]
  const { plan } = await mitAniList(() => I.planAusDatei({ format: 'CSV', zeilen: l, zuordnung: [], uebersprungen: 0 }, 'x.csv', O))
  assert.equal(I.alsErgebnis(plan).vorhanden, 1)
  assert.equal((await I.fuehreImportAus(plan, ablage())).angelegt, 0)
  assert.equal(zaehle(g, 'entries'), 1)
})

test('Gruppierung: ein OVA-Vorgänger gibt der Serie nicht den Namen – Hauptstaffel ist die erste TV-Staffel', () => {
  const { serien } = G.ordneAnime([zeile(1, 20, 'COMPLETED', 2), zeile(2, 21, 'COMPLETED', 25), zeile(3, 22, 'CURRENT', 3)], new Map(WELT))
  assert.equal(serien.length, 1)
  assert.equal(serien[0].hauptId, 21)
  assert.equal(serien[0].titel, 'Titanen')
  assert.deepEqual(serien[0].staffeln.map(s => [s.id, s.relation]), [[20, 'PREQUEL'], [21, 'MAIN'], [22, 'SEQUEL']])
  assert.equal(serien[0].fortschritt, 25)
})
