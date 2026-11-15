// Tests für „Wiederholen" (entries:wiederholen): nur bei Beendet, setzt den Fortschritt auf 0,
// Rückgängig, und dass der Abgleich zwischen zwei Geräten das nicht per Maximum wieder zurückdreht.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')

const { registerEntryHandlers } = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'main/handlers/entries.js'))
const { pruefeAutoBeendet } = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'main/handlers/serien.js'))

const kanaele = {}
registerEntryHandlers({ handle: (name, f) => { kanaele[name] = f } })
const EVENT = { sender: {} }
const wiederholen = (g, id) => { g.aktiv(); return kanaele['entries:wiederholen'](EVENT, id) }
const rueckgaengig = (g, token) => { g.aktiv(); return kanaele['entries:rueckgaengig'](EVENT, token) }

async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
}

/** Anime mit drei fertig geschauten Staffeln, bereits „Beendet" */
function fertigerAnime(g, titel = 'Kusuriya') {
  const uuid = g.neuerEintrag(titel)
  g.aendere(`UPDATE entries SET status = 'completed', progress_episodes = 24, total_episodes = 24, rating = 4,
    review = 'toll', finished_at = '2025-01-01 10:00:00', rewatch_count = 0 WHERE uuid = ?`, [uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  ;[[1, 'MAIN', 24], [2, 'SEQUEL', 24], [3, 'SEQUEL', 12]].forEach(([aid, rel, total], i) =>
    g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, total_episodes, progress_episodes, item_status)
      VALUES (?, ?, ?, ?, ?, ?, 'completed')`, [id, aid, rel, i, total, total]))
  return { uuid, id }
}
const staffeln = (g, id) => g.alle('SELECT related_anilist_id AS a, progress_episodes AS p, item_status AS s FROM watch_order WHERE entry_id = ? ORDER BY position', [id])
const eintrag = (g, id) => g.eins('SELECT * FROM entries WHERE id = ?', [id])

test('Wiederholen geht nur bei „Beendet"', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const uuid = g.neuerEintrag('Frieren')
  g.aendere("UPDATE entries SET status = 'ongoing', progress_episodes = 5 WHERE uuid = ?", [uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  const r = wiederholen(g, id)
  assert.ok(r.fehler, 'Fehlermeldung statt Zurücksetzen')
  assert.equal(eintrag(g, id).progress_episodes, 5)
  assert.equal(eintrag(g, id).rewatch_count, 0)
  assert.ok(wiederholen(g, 99999).fehler, 'unbekannte ID')
})

test('Anime: Eintrag und alle Staffeln auf 0, Wiederholung +1, Laufend; Rückgängig stellt alles her', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = fertigerAnime(g)
  const vorher = { e: eintrag(g, id), w: staffeln(g, id) }

  const r = wiederholen(g, id)
  assert.equal(r.entry.status, 'ongoing')
  assert.equal(r.entry.rewatch_count, 1)
  assert.equal(r.entry.progress_episodes, 0)
  assert.equal(r.entry.finished_at, '2025-01-01 10:00:00', 'Datum des ersten Abschlusses bleibt')
  assert.equal(r.entry.rating, 4); assert.equal(r.entry.review, 'toll')
  assert.deepEqual(staffeln(g, id).map(s => [s.p, s.s]), [[0, 'planned'], [0, 'planned'], [0, 'planned']])

  // Nichts dreht es von selbst zurück
  pruefeAutoBeendet(id); pruefeAutoBeendet()
  assert.equal(eintrag(g, id).status, 'ongoing')

  // Ein zweites Mal geht nicht (nicht mehr Beendet)
  assert.ok(wiederholen(g, id).fehler)

  assert.deepEqual(rueckgaengig(g, r.token), { success: true })
  assert.deepEqual(eintrag(g, id), vorher.e, 'Eintrag exakt wie vorher')
  assert.deepEqual(staffeln(g, id), vorher.w)
  assert.deepEqual(rueckgaengig(g, r.token), { success: false }, 'Token nur einmal einlösbar')
})

test('Manga: Kapitel und Bände auf 0, Sammlung (Regal) bleibt; Rückgängig', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const uuid = g.neuerEintrag('Berserk')
  g.aendere(`UPDATE entries SET type = 'MANGA', status = 'completed', progress_chapters = 100, progress_volumes = 10,
    total_chapters = 100, total_volumes = 10, baende_besitz = '[1,2,3]', baende_wunsch = '[4]', ausgabe = 'Deluxe' WHERE uuid = ?`, [uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  const vorher = eintrag(g, id)
  const r = wiederholen(g, id)
  const e = eintrag(g, id)
  assert.equal(e.progress_chapters, 0); assert.equal(e.progress_volumes, 0)
  assert.equal(e.status, 'ongoing'); assert.equal(e.rewatch_count, 1)
  assert.equal(e.baende_besitz, '[1,2,3]'); assert.equal(e.baende_wunsch, '[4]'); assert.equal(e.ausgabe, 'Deluxe')
  rueckgaengig(g, r.token)
  assert.deepEqual(eintrag(g, id), vorher)
})

test('auto_offen wird gelöscht und beim Rückgängig wiederhergestellt', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = fertigerAnime(g)
  g.aendere("UPDATE entries SET auto_offen = '[3]' WHERE id = ?", [id])
  const r = wiederholen(g, id)
  assert.equal(eintrag(g, id).auto_offen, null)
  rueckgaengig(g, r.token)
  assert.equal(eintrag(g, id).auto_offen, '[3]')
})

test('Rückgängig gilt 10 Minuten (Standard-Tokens nur 5)', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const echt = Date.now
  try {
    const { id } = fertigerAnime(g)
    const t0 = echt()
    Date.now = () => t0
    const r = wiederholen(g, id)
    Date.now = () => t0 + 9 * 60_000
    // Ein anderer Token (löscht abgelaufene) darf diesen nicht entfernen
    kanaele['entries:delete'](EVENT, fertigerAnime(g, 'Anderer').id)
    Date.now = () => t0 + 11 * 60_000
    assert.deepEqual(rueckgaengig(g, r.token), { success: false }, 'nach 10 Minuten abgelaufen')
    const r2 = (() => { Date.now = () => t0 + 12 * 60_000; g.aendere("UPDATE entries SET status = 'completed' WHERE id = ?", [id]); return wiederholen(g, id) })()
    Date.now = () => t0 + 12 * 60_000 + 9 * 60_000
    assert.deepEqual(rueckgaengig(g, r2.token), { success: true }, 'nach 9 Minuten noch gültig')
  } finally { Date.now = echt }
})

test('Abgleich: Wiederholen am PC kommt beim Handy als 0/Laufend/+1 an – das Maximum dreht nichts zurück', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const { uuid, id } = fertigerAnime(pc)
  await sync(pc); await sync(handy)
  const hid = handy.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  assert.deepEqual(staffeln(handy, hid).map(s => s.p), [24, 24, 12])

  const r = wiederholen(pc, id)
  await sync(pc); await sync(handy)
  const e = eintrag(handy, hid)
  assert.equal(e.progress_episodes, 0)
  assert.equal(e.status, 'ongoing')
  assert.equal(e.rewatch_count, 1)
  assert.deepEqual(staffeln(handy, hid).map(s => [s.p, s.s]), [[0, 'planned'], [0, 'planned'], [0, 'planned']])
  // Und der PC behält es nach dem nächsten Rundlauf
  await sync(handy); await sync(pc)
  assert.equal(eintrag(pc, id).progress_episodes, 0)

  // Rückgängig am PC → Handy wieder wie vorher
  rueckgaengig(pc, r.token)
  await sync(pc); await sync(handy)
  const e2 = eintrag(handy, hid)
  assert.equal(e2.progress_episodes, 24)
  assert.equal(e2.status, 'completed')
  assert.equal(e2.rewatch_count, 0)
  assert.equal(e2.finished_at, '2025-01-01 10:00:00')
  assert.deepEqual(staffeln(handy, hid).map(s => [s.p, s.s]), [[24, 'completed'], [24, 'completed'], [12, 'completed']])
})

test('Abgleich, bekannter Grenzfall: schaut das Handy gleichzeitig weiter, gewinnt dort das Maximum', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const { uuid, id } = fertigerAnime(pc)
  await sync(pc); await sync(handy)
  const hid = handy.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id

  wiederholen(pc, id)
  // Handy zählt in der Zwischenzeit (ohne vorher abzugleichen) die dritte Staffel weiter
  handy.aendere('UPDATE watch_order SET progress_episodes = 11 WHERE entry_id = ? AND related_anilist_id = 3', [hid])
  await sync(pc); await sync(handy); await sync(pc)
  for (const [g, gid] of [[pc, id], [handy, hid]]) {
    assert.equal(staffeln(g, gid)[2].p, 11, `${g.name}: höherer Wert bleibt (bewusst, so geht „+1" auf zwei Geräten nicht verloren)`)
    assert.equal(staffeln(g, gid)[0].p, 0, `${g.name}: unberührte Staffeln sind trotzdem auf 0`)
    assert.equal(eintrag(g, gid).rewatch_count, 1)
  }
})
