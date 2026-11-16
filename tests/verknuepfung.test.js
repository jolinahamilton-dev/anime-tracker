// Tests für „Falsche AniList-Verknüpfung": Treffer-Auswahl (TV vor OVA), Kette von der Elternserie,
// Neu verknüpfen (Fortschritt/Listen bleiben, Rückgängig, Zwei-Geräte-Abgleich), Staffel hinzufügen
// und die Verdachtsliste. AniList ist eine Attrappe (fetch) – kein Netz.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')

const B = process.env.ANIME_TRACKER_TEST_BUILD
const { findeTreffer } = require(path.join(B, 'main/handlers/anilist.js'))
const { kandidatenFuer } = require(path.join(B, 'main/handlers/serien.js'))
const { registerEntryHandlers } = require(path.join(B, 'main/handlers/entries.js'))
const V = require(path.join(B, 'main/handlers/verknuepfung.js'))

const kanaele = {}
registerEntryHandlers({ handle: (name, f) => { kanaele[name] = f } })
const rueckgaengig = (g, token) => { g.aktiv(); return kanaele['entries:rueckgaengig']({ sender: {} }, token) }

// ── Attrappe: kleine AniList-Welt ────────────────────────────────────────────
const media = (id, format, episodes, kanten = [], titel = `Titel ${id}`) => ({
  id, type: 'ANIME', format, status: 'FINISHED', episodes, duration: 24, nextAiringEpisode: null,
  title: { romaji: titel, english: null, native: null }, coverImage: { large: `c${id}.jpg` },
  startDate: { year: 2013, month: 1, day: 1 }, endDate: { year: 2013, month: 6, day: 1 },
  relations: { edges: kanten.map(([relationType, nid, nformat = 'TV']) => ({ relationType, node: { id: nid, type: 'ANIME', format: nformat, title: { romaji: `Titel ${nid}` }, coverImage: { large: `c${nid}.jpg` } } })) },
})
const WELT = new Map([
  // Attack on Titan: OVA (falscher Treffer) → Elternserie → 2. Staffel
  [18397, media(18397, 'OVA', 3, [['PARENT', 16498]], 'Shingeki no Kyojin OVA')],
  [16498, media(16498, 'TV', 25, [['SIDE_STORY', 18397, 'OVA'], ['SEQUEL', 25777]], 'Shingeki no Kyojin')],
  [25777, media(25777, 'TV', 12, [['PREQUEL', 16498]], 'Shingeki no Kyojin Season 2')],
  // Baki: Crossover (ohne Elternserie) ↔ richtige Serie
  [176287, media(176287, 'ONA', 1, [], 'Hanma Baki VS Kengan Ashura')],
  [100, media(100, 'TV', 26, [['SEQUEL', 101]], 'Baki')],
  [101, media(101, 'TV', 13, [['PREQUEL', 100]], 'Baki 2nd Season')],
  // Edgerunners: Staffel 1 nur „OTHER"
  [195539, media(195539, 'ONA', 10, [], 'Edgerunners 2')],
  [120377, media(120377, 'ONA', 10, [], 'Cyberpunk: Edgerunners')],
])
function mitAniList(f) {
  const echt = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const { variables } = JSON.parse(init.body)
    const treffer = (variables.ids ?? []).map(id => WELT.get(id)).filter(Boolean)
    const body = JSON.stringify({ data: { Page: { media: treffer } } })
    return { status: 200, headers: { get: () => null }, text: async () => body }
  }
  return Promise.resolve(f()).finally(() => { globalThis.fetch = echt })
}

const lege = (g, titel, anilistId, zeilen, extra = {}) => {
  const uuid = g.neuerEintrag(titel)
  g.aendere(`UPDATE entries SET anilist_id = ?, status = ?, nickname = ?, progress_episodes = ?, total_episodes = ?, rating = 5, cover_url = 'alt.jpg' WHERE uuid = ?`,
    [anilistId, extra.status ?? 'ongoing', extra.nickname ?? null, extra.progress ?? 0, extra.total ?? null, uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  zeilen.forEach(([aid, rel, total, p, st], i) => g.aendere(
    `INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, total_episodes, progress_episodes, item_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, aid, rel, i, total, p, st]))
  return { uuid, id }
}
const wo = (g, id) => g.alle('SELECT related_anilist_id AS a, relation_type AS r, progress_episodes AS p, item_status AS s FROM watch_order WHERE entry_id = ? ORDER BY position', [id])
const eintrag = (g, id) => g.eins('SELECT * FROM entries WHERE id = ?', [id])

// ── Treffer-Auswahl ──────────────────────────────────────────────────────────
test('findeTreffer: TV vor OVA, auch wenn die OVA zuerst kommt; Gleichstand wird nicht geraten', () => {
  const ova = { id: 1, format: 'OVA', popularity: 9000, title: { romaji: 'Shingeki no Kyojin OVA' }, synonyms: ['Attack on Titan'] }
  const tv = { id: 2, format: 'TV', popularity: 500, title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' }, synonyms: [] }
  const film = { id: 3, format: 'MOVIE', popularity: 100, title: { romaji: 'x' }, synonyms: ['attack on titan'] }
  assert.equal(findeTreffer('Attack on Titan', [ova, tv]).id, 2)
  assert.equal(findeTreffer('Attack on Titan', [ova, film]).id, 3, 'Film vor OVA')
  assert.equal(findeTreffer('Attack on Titan', [film, tv]).id, 2, 'TV vor Film')
  assert.equal(findeTreffer('Attack on Titan', [ova]).id, 1, 'ein einziger Treffer bleibt')
  assert.equal(findeTreffer('Nichts', [ova, tv]), null)
  const a = { id: 5, format: 'TV', popularity: 10, title: { romaji: 'Gleich' } }
  const b = { id: 6, format: 'TV', popularity: 10, title: { romaji: 'Gleich' } }
  assert.equal(findeTreffer('Gleich', [a, b]), null, 'Gleichstand → nicht raten')
  assert.equal(findeTreffer('Gleich', [a, { ...b, popularity: 11 }]).id, 6, 'Beliebtheit entscheidet bei gleichem Format')
})

test('Kette von der Elternserie: OVA bleibt Hauptzeile, Serie davor, Fortsetzungen danach', () => {
  const cache = new Map([[18397, WELT.get(18397)], [16498, WELT.get(16498)], [25777, WELT.get(25777)]])
  const { reihenfolge } = kandidatenFuer(WELT.get(18397), cache)
  assert.deepEqual(reihenfolge.map(k => [k.id, k.relation]), [[16498, 'PREQUEL'], [18397, 'MAIN'], [25777, 'SEQUEL']])
  // Ohne Elternserie bleibt alles wie bisher
  const normal = kandidatenFuer(WELT.get(16498), cache).reihenfolge
  assert.deepEqual(normal.map(k => k.id), [16498, 25777, 18397].sort((a, b) => normal.findIndex(k => k.id === a) - normal.findIndex(k => k.id === b)))
  assert.equal(normal[0].id, 16498)
})

// ── Umhängen ─────────────────────────────────────────────────────────────────
const haengeUm = (g, ...a) => { g.aktiv(); return mitAniList(() => V.haengeUm(...a)) }
const vorschau = (g, ...a) => { g.aktiv(); return mitAniList(() => V.vorschauUmhaengen(...a)) }
const staffelEin = (g, ...a) => { g.aktiv(); return mitAniList(() => V.fuegeStaffelEin(...a)) }
async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
}
function mitListe(g, entryId) {
  g.aendere("INSERT INTO custom_lists (name) VALUES ('Lieblinge')")
  const listId = g.eins("SELECT id FROM custom_lists WHERE name = 'Lieblinge'").id
  g.aendere('INSERT INTO list_entries (list_id, entry_id) VALUES (?, ?)', [listId, entryId])
  return listId
}
const aot = g => lege(g, 'Attack on Titan', 18397,
  [[18397, 'MAIN', 3, 3, 'completed'], [16498, 'PARENT', 25, 25, 'completed']],
  { status: 'ongoing', nickname: 'AoT', progress: 3, total: 3 })

test('Umhängen (Attack on Titan): alle Staffeln, Staffel 1 bleibt 25/25, nichts doppelt, Listen/Spitzname/Bewertung bleiben', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = aot(g)
  const listId = mitListe(g, id)

  const v = await vorschau(g, id, 16498)
  assert.equal(v.fehler, undefined)
  assert.equal(v.alt.schicksal, 'drin', 'die OVA gehört zur Serie')
  assert.deepEqual(v.staffeln.map(s => s.id).sort(), [16498, 18397, 25777])
  assert.equal(eintrag(g, id).anilist_id, 18397, 'Vorschau ändert nichts')

  const r = await haengeUm(g, id, 16498)
  assert.equal(r.fehler, undefined)
  const e = eintrag(g, id)
  assert.equal(e.anilist_id, 16498)
  assert.equal(e.nickname, 'AoT'); assert.equal(e.rating, 5); assert.equal(e.status, 'ongoing')
  assert.equal(e.progress_episodes, 25, 'Hauptstaffel = Serie 25/25'); assert.equal(e.total_episodes, 25)
  assert.equal(e.cover_url, 'c16498.jpg')
  const zeilen = wo(g, id)
  assert.equal(zeilen.length, 3, 'keine doppelten Zeilen')
  assert.equal(new Set(zeilen.map(z => z.a)).size, 3)
  assert.deepEqual(zeilen.find(z => z.a === 16498), { a: 16498, r: 'MAIN', p: 25, s: 'completed' })
  assert.equal(zeilen.find(z => z.a === 25777).r, 'SEQUEL'); assert.equal(zeilen.find(z => z.a === 25777).p, 0)
  assert.deepEqual(zeilen.find(z => z.a === 18397), { a: 18397, r: 'SIDE_STORY', p: 3, s: 'completed' }, 'OVA behält ihren Fortschritt')
  assert.equal(g.alle('SELECT 1 FROM list_entries WHERE list_id = ? AND entry_id = ?', [listId, id]).length, 1, 'Liste bleibt')

  // nochmal umhängen auf dasselbe: nichts doppelt
  const nochmal = await haengeUm(g, id, 16498)
  assert.equal(nochmal.fehler, undefined)
  assert.equal(wo(g, id).length, 3)
})

test('Umhängen (Baki): falscher Treffer ohne Elternserie; Fortschritt des Crossovers bleibt als Nebengeschichte', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = lege(g, 'Hanma Baki VS Kengan Ashura', 176287, [[176287, 'MAIN', 1, 1, 'completed']],
    { status: 'completed', nickname: 'Baki', progress: 1, total: 1 })
  const r = await haengeUm(g, id, 100)
  assert.equal(r.fehler, undefined)
  const e = eintrag(g, id)
  assert.equal(e.anilist_id, 100); assert.equal(e.status, 'completed', 'Status bleibt'); assert.equal(e.nickname, 'Baki')
  assert.equal(e.progress_episodes, 0, 'Hauptstaffel neu: nichts gesehen')
  assert.deepEqual(wo(g, id).map(z => [z.a, z.r, z.p]), [[100, 'MAIN', 0], [101, 'SEQUEL', 0], [176287, 'SIDE_STORY', 1]])
})

test('Umhängen ohne Fortschritt am alten Treffer: der alte Treffer entfällt', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = lege(g, 'Hanma Baki VS Kengan Ashura', 176287, [[176287, 'MAIN', 1, 0, 'planned']], { status: 'planned' })
  const r = await haengeUm(g, id, 100)
  assert.equal(r.fehler, undefined)
  assert.deepEqual(wo(g, id).map(z => z.a), [100, 101])
})

test('Umhängen auf einen Titel, den ein anderer Eintrag schon hat: Fehlermeldung, nichts passiert', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const a = aot(g)
  lege(g, 'Schon da', 25777, [[25777, 'MAIN', 12, 0, 'planned']])
  const vorher = wo(g, a.id)
  const r = await haengeUm(g, a.id, 25777)
  assert.ok(r.fehler)
  assert.equal(eintrag(g, a.id).anilist_id, 18397)
  assert.deepEqual(wo(g, a.id), vorher)
})

test('Rückgängig stellt Eintrag und Watch-Order exakt wieder her', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = aot(g)
  const vorher = { e: eintrag(g, id), w: wo(g, id) }
  const r = await haengeUm(g, id, 16498)
  assert.notDeepEqual(eintrag(g, id), vorher.e)
  assert.deepEqual(rueckgaengig(g, r.token), { success: true })
  assert.deepEqual(eintrag(g, id), vorher.e)
  assert.deepEqual(wo(g, id), vorher.w)
  assert.deepEqual(rueckgaengig(g, r.token), { success: false })
})

test('Zwei Geräte: Umhängen am PC kommt beim Handy an (auch die neuen Staffeln), Rückgängig ebenso', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const { uuid, id } = aot(pc)
  await sync(pc); await sync(handy)
  const hid = handy.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  assert.equal(eintrag(handy, hid).anilist_id, 18397)

  const r = await haengeUm(pc, id, 16498)
  await sync(pc); await sync(handy)
  assert.equal(eintrag(handy, hid).anilist_id, 16498)
  assert.equal(eintrag(handy, hid).title, 'Shingeki no Kyojin')
  assert.deepEqual(wo(handy, hid).map(z => [z.a, z.r, z.p]).sort((a, b) => a[0] - b[0]),
    [[16498, 'MAIN', 25], [18397, 'SIDE_STORY', 3], [25777, 'SEQUEL', 0]])

  rueckgaengig(pc, r.token)
  await sync(pc); await sync(handy)
  assert.equal(eintrag(handy, hid).anilist_id, 18397)
  assert.deepEqual(wo(handy, hid).map(z => z.a).sort(), [16498, 18397])
})

test('Staffel hinzufügen (Edgerunners): als Vorgänger vor die Hauptzeile, kein zweites Mal, Rückgängig', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = lege(g, 'Edgerunners 2', 195539, [[195539, 'MAIN', 10, 0, 'planned']])
  const vorher = wo(g, id)
  const r = await staffelEin(g, id, 120377, 'vorgaenger')
  assert.equal(r.fehler, undefined)
  assert.deepEqual(wo(g, id).map(z => [z.a, z.r]), [[120377, 'PREQUEL'], [195539, 'MAIN']])
  assert.ok((await staffelEin(g, id, 120377, 'vorgaenger')).fehler, 'schon drin')
  assert.ok(JSON.parse(eintrag(g, id).bekannte_ids ?? '[]').includes(120377), 'gilt nicht als neue Staffel')
  rueckgaengig(g, r.token)
  assert.deepEqual(wo(g, id), vorher)
  await staffelEin(g, id, 120377, 'nachfolger')
  assert.deepEqual(wo(g, id).map(z => [z.a, z.r]), [[195539, 'MAIN'], [120377, 'SEQUEL']])
})

test('Serien-Abgleich: Eintrag an einer OVA mit Elternserie bekommt die Staffeln der Serie, Fortschritt bleibt', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = aot(g)
  g.aendere('UPDATE entries SET abonniert = 1 WHERE id = ?', [id])
  const { aktualisiereSerien } = require(path.join(B, 'main/handlers/serien.js'))
  g.aktiv()
  await mitAniList(() => aktualisiereSerien(null))
  assert.deepEqual(wo(g, id).map(z => [z.a, z.r, z.p]), [[16498, 'PREQUEL', 25], [18397, 'MAIN', 3], [25777, 'SEQUEL', 0]])
  assert.equal(eintrag(g, id).anilist_id, 18397, 'der Abgleich hängt nichts von selbst um')
  // Neuer Eintrag ohne Watch-Order: gleiche Kette
  const { id: id2 } = lege(g, 'AoT ohne Order', 18397, [])
  g.aendere('UPDATE entries SET abonniert = 1, anilist_id = NULL WHERE id = ?', [id])
  g.aendere('UPDATE entries SET abonniert = 1, anilist_id = 18397 WHERE id = ?', [id2])
  g.aktiv()
  await mitAniList(() => aktualisiereSerien(null))
  assert.deepEqual(wo(g, id2).map(z => [z.a, z.r]), [[16498, 'PREQUEL'], [18397, 'MAIN'], [25777, 'SEQUEL']])
})

// ── Verdachtsliste ───────────────────────────────────────────────────────────
test('Verdachtsliste: OVA mit Elternserie, Crossover mit falschem Spitznamen, einzeilige Watch-Order, Fortsetzung nur über Alternative', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  const berserk = media(33, 'TV', 25, [['ALTERNATIVE', 7, 'MOVIE']], 'Berserk')
  const film = media(7, 'MOVIE', 1, [['ALTERNATIVE', 33], ['SEQUEL', 21560, 'TV']], 'Berserk Film')
  const medien = new Map([[18397, WELT.get(18397)], [176287, WELT.get(176287)], [33, berserk], [16498, WELT.get(16498)], [195539, WELT.get(195539)]])
  const eintraege = [
    { id: 1, title: 'Attack on Titan', nickname: null, anilist_id: 18397, total_episodes: 3 },
    { id: 2, title: 'Hanma Baki VS Kengan Ashura', nickname: 'Baki', anilist_id: 176287, total_episodes: 1 },
    { id: 3, title: 'Berserk', nickname: null, anilist_id: 33, total_episodes: 25 },
    { id: 4, title: 'Shingeki no Kyojin', nickname: null, anilist_id: 16498, total_episodes: 25 },
    { id: 5, title: 'Edgerunners 2', nickname: 'Edge', anilist_id: 195539, total_episodes: 10 },
  ]
  const woAnzahl = new Map([[1, 2], [2, 1], [3, 4], [4, 1], [5, 1]])
  const ergebnis = V.findeVerdaechtige(eintraege, woAnzahl, medien, new Map([[7, film]]))
  const nach = id => ergebnis.find(v => v.entryId === id)
  assert.equal(nach(1).vorschlagId, 16498, 'OVA → Serie')
  assert.ok(nach(2).gruende.some(t => t.includes('Spitzname')), 'Baki ↔ Crossover')
  assert.equal(nach(3).vorschlagId, 21560, 'Berserk: Fortsetzung nur über Alternative')
  assert.equal(nach(4).gruende.length, 1, 'eine Zeile, aber AniList kennt Fortsetzungen')
  assert.equal(nach(5), undefined, 'Edgerunners 2: Spitzname bei 10 Folgen ist unverdächtig')
  assert.deepEqual(V.findeVerdaechtige(eintraege, woAnzahl, medien, new Map([[7, film]]), [1, 2, 3, 4]).map(v => v.entryId), [], 'Ignorierte fehlen')
  // Filme (1 Folge, deutscher Spitzname) und Alternativen, deren Fortsetzung nur eine OVA ist, sind unverdächtig
  const film1 = media(900, 'MOVIE', 1, [], 'Mononoke-hime')
  const hxh = media(901, 'TV', 148, [['ALTERNATIVE', 902]], 'Hunter x Hunter 2011')
  const hxhAlt = media(902, 'TV', 62, [['SEQUEL', 903, 'OVA']], 'Hunter x Hunter 1999')
  const ruhig = V.findeVerdaechtige(
    [{ id: 8, title: 'Princess Mononoke', nickname: 'Prinzessin Mononoke', anilist_id: 900, total_episodes: 1 },
     { id: 9, title: 'HxH', nickname: null, anilist_id: 901, total_episodes: 148 }],
    new Map([[8, 1], [9, 3]]), new Map([[900, film1], [901, hxh]]), new Map([[902, hxhAlt]]))
  assert.deepEqual(ruhig, [])
  // Film als Hauptzeile, Serie dazu gesehen (Free!) -> Vorschlag Serie
  const freeFilm = media(910, 'MOVIE', 1, [], 'Free Film')
  const free = V.findeVerdaechtige([{ id: 10, title: 'Free!', nickname: null, anilist_id: 910, total_episodes: 1 }],
    new Map([[10, 2]]), new Map([[910, freeFilm]]), new Map(), [], new Map([[10, { id: 911, titel: 'Free! Dive' }]]))
  assert.equal(free[0].vorschlagId, 911)
  assert.equal(V.spitznamePasst('Baki', ['Hanma Baki VS Kengan Ashura']), false)
  assert.equal(V.spitznamePasst('Baki', ['Baki']), true)
  assert.equal(V.spitznamePasst('Attack on Titan', ['Shingeki no Kyojin', 'attack on titan']), true)
})
