// Tests für Sortieren/Filtern der Listenseite (Welle 3, Nr. 10) und Mehrfachauswahl-Regeln (Nr. 11).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
const L = require(path.join(BUILD, 'renderer/listenLogik.js'))
const Z = require(path.join(BUILD, 'renderer/listenZustand.js'))

let nr = 0
const e = (teil = {}) => ({
  id: ++nr, anilist_id: 1, type: 'ANIME', title: 'T' + nr, nickname: null, genres: '[]', total_episodes: 12, total_chapters: null,
  progress_episodes: 0, progress_chapters: 0, status: 'ongoing', rating: null, created_at: '2026-01-01 10:00:00', updated_at: '2026-01-01 10:00:00',
  ...teil,
})
const ids = l => l.map(x => x.id)
const titel = x => x.title

test('Sortieren: Hinzugefügt auf- und absteigend', () => {
  const a = e({ created_at: '2026-01-01 10:00:00' }), b = e({ created_at: '2026-03-01 10:00:00' }), c = e({ created_at: '2026-02-01 10:00:00' })
  assert.deepEqual(ids(L.sortiere([a, b, c], 'hinzugefuegt', 'ab', titel)), [b.id, c.id, a.id])
  assert.deepEqual(ids(L.sortiere([a, b, c], 'hinzugefuegt', 'auf', titel)), [a.id, c.id, b.id])
})

test('Sortieren: Fortschritt in % – Beendet 100, unbekannte Gesamtzahl immer am Ende', () => {
  const halb = e({ progress_episodes: 6, total_episodes: 12 })
  const fast = e({ progress_episodes: 9, total_episodes: 10 })
  const fertig = e({ status: 'completed', progress_episodes: 0 })
  const unbekannt = e({ total_episodes: null, progress_episodes: 4 })
  const manga = e({ type: 'MANGA', progress_chapters: 1, total_chapters: 4, total_episodes: null })
  assert.equal(L.fortschrittProzent(halb), 50)
  assert.equal(L.fortschrittProzent(unbekannt), null)
  assert.deepEqual(ids(L.sortiere([unbekannt, halb, fertig, fast, manga], 'fortschritt', 'ab', titel)), [fertig.id, fast.id, halb.id, manga.id, unbekannt.id])
  assert.deepEqual(ids(L.sortiere([unbekannt, halb, fertig, fast, manga], 'fortschritt', 'auf', titel)), [manga.id, halb.id, fast.id, fertig.id, unbekannt.id])
})

test('Sortieren: Nächste Folge – ohne Termin zuletzt, in beide Richtungen', () => {
  const frueh = e({ naechste_folge_um: 1000 }), spaet = e({ naechste_folge_um: 5000 }), keiner = e()
  assert.deepEqual(ids(L.sortiere([keiner, spaet, frueh], 'naechste', 'auf', titel)), [frueh.id, spaet.id, keiner.id])
  assert.deepEqual(ids(L.sortiere([keiner, spaet, frueh], 'naechste', 'ab', titel)), [spaet.id, frueh.id, keiner.id])
})

test('Sortieren: Zuletzt geschaut fällt ohne Verlauf auf „Zuletzt bearbeitet“ zurück', () => {
  const mitVerlauf = e({ zuletzt_geschaut: new Date('2026-05-01T10:00:00Z').getTime(), updated_at: '2026-01-01 10:00:00' })
  const ohneNeu = e({ updated_at: '2026-06-01 10:00:00' })
  const ohneAlt = e({ updated_at: '2025-06-01 10:00:00' })
  assert.deepEqual(ids(L.sortiere([ohneAlt, mitVerlauf, ohneNeu], 'geschaut', 'ab', titel)), [ohneNeu.id, mitVerlauf.id, ohneAlt.id])
})

test('Sortieren: Bewertung und Alphabet; Gleichstand nach Titel', () => {
  const a = e({ title: 'Beta', rating: 3 }), b = e({ title: 'Alpha', rating: 3 }), c = e({ title: 'Gamma', rating: 5 }), d = e({ title: 'Delta' })
  assert.deepEqual(ids(L.sortiere([a, b, c, d], 'bewertung', 'ab', titel)), [c.id, b.id, a.id, d.id])
  assert.deepEqual(ids(L.sortiere([a, b, c, d], 'alphabetisch', 'ab', titel)), [c.id, d.id, a.id, b.id])
})

test('Filter: Genre (alle gewählten), Bewertung, Spitzname, Länge, ohne AniList', () => {
  const g = e({ genres: '["Action","Drama"]' }), h = e({ genres: '["Action"]' }), kaputt = e({ genres: 'kein json' })
  const f = (teil) => ({ ...L.STANDARD_NEUE_FILTER, ...teil })
  const pass = (liste, teil) => ids(liste.filter(x => L.passtZuNeuenFiltern(x, f(teil))))
  assert.deepEqual(pass([g, h, kaputt], { filterGenres: ['Action'] }), [g.id, h.id])
  assert.deepEqual(pass([g, h, kaputt], { filterGenres: ['Action', 'Drama'] }), [g.id])
  assert.deepEqual(L.alleGenres([g, h, kaputt]), ['Action', 'Drama'])

  const r4 = e({ rating: 4 }), r2 = e({ rating: 2 }), r0 = e()
  assert.deepEqual(pass([r4, r2, r0], { filterMinBewertung: 3 }), [r4.id])
  assert.deepEqual(pass([r4, r2, r0], { filterOhneBewertung: true }), [r0.id])
  assert.deepEqual(pass([r4, r2, r0], { filterMinBewertung: 3, filterOhneBewertung: true }), [r4.id, r0.id])

  const sp = e({ nickname: 'Liebling' }), leer = e({ nickname: '  ' }), keinen = e()
  assert.deepEqual(pass([sp, leer, keinen], { filterSpitzname: true }), [sp.id])

  const kurz = e({ total_episodes: 13 }), mittel = e({ total_episodes: 24 }), lang = e({ total_episodes: 25 }),
    unbek = e({ total_episodes: null }), mg = e({ type: 'MANGA', total_episodes: null, total_chapters: 5 })
  assert.deepEqual(pass([kurz, mittel, lang, unbek, mg], { filterLaenge: 'kurz' }), [kurz.id])
  assert.deepEqual(pass([kurz, mittel, lang, unbek, mg], { filterLaenge: 'lang' }), [lang.id])

  const ohne = e({ anilist_id: null }), mit = e()
  assert.deepEqual(pass([ohne, mit], { filterOhneAnilist: true }), [ohne.id])
  assert.equal(L.anzahlNeueFilter(f({ filterGenres: ['A'], filterLaenge: 'kurz', filterSpitzname: true })), 3)
})

test('Gespeicherte Filter: unbekannte Werte werden zu Standardwerten', () => {
  const speicher = new Map()
  globalThis.localStorage = { getItem: k => speicher.get(k) ?? null, setItem: (k, v) => speicher.set(k, v) }
  try {
    speicher.set('liste.filter', JSON.stringify({ sortierung: 'quatsch', sortRichtung: 'seitwaerts', filterGenres: 'Action', filterMinBewertung: 9,
      filterLaenge: 'riesig', filterSpitzname: 'ja', filterStatus: 'started' }))
    const f = Z.ladeFilter()
    assert.equal(f.sortierung, 'zuletzt')
    assert.equal(f.sortRichtung, 'ab')
    assert.deepEqual(f.filterGenres, [])
    assert.equal(f.filterMinBewertung, 0)
    assert.equal(f.filterLaenge, 'alle')
    assert.equal(f.filterSpitzname, false)
    assert.deepEqual(f.filterStatus, ['ongoing'])
    // Alter Speicherstand ohne die neuen Felder
    speicher.set('liste.filter', JSON.stringify({ sortierung: 'alphabetisch', filterFavorit: true }))
    const alt = Z.ladeFilter()
    assert.equal(alt.sortierung, 'alphabetisch')
    assert.equal(alt.sortRichtung, 'auf')
    assert.equal(alt.filterFavorit, true)
    assert.deepEqual(alt.filterGenres, [])
  } finally { delete globalThis.localStorage }
})
