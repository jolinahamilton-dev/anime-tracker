// Tests für die Mehrfachauswahl (Welle 3, Nr. 11): entries:mehrere – eine Transaktion, ein Rückgängig-Token,
// Abgleich auf ein zweites Gerät, Prüfung der Eingaben.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')
const BUILD = process.env.ANIME_TRACKER_TEST_BUILD

const { registerEntryHandlers } = require(path.join(BUILD, 'main/handlers/entries.js'))
const { registerMehrfachHandlers } = require(path.join(BUILD, 'main/handlers/mehrfach.js'))
const { registerListHandlers } = require(path.join(BUILD, 'main/handlers/lists.js'))

const kanaele = {}
const ipc = { handle: (name, f) => { kanaele[name] = f } }
registerEntryHandlers(ipc)
registerMehrfachHandlers(ipc)
registerListHandlers(ipc)
const EVENT = { sender: {} }
const aufruf = (g, name, ...a) => { g.aktiv(); return kanaele[name](EVENT, ...a) }
const mehrere = (g, ids, aktion) => aufruf(g, 'entries:mehrere', ids, aktion)
const zurueck = (g, token) => aufruf(g, 'entries:rueckgaengig', token)

async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
}
const idsVon = g => g.alle('SELECT id FROM entries ORDER BY id').map(r => r.id)

/** n Anime mit 12 Folgen, laufend, 3 Folgen gesehen (uuid → Titel) */
function legeAn(g, n, art = 'ANIME') {
  for (let i = 0; i < n; i++) {
    g.aendere(`INSERT INTO entries (type, title, status, total_episodes, total_chapters, progress_episodes, progress_chapters)
      VALUES (?, ?, 'ongoing', 12, 40, 3, 3)`, [art, `${art}-${i}`])
  }
  return idsVon(g)
}

test('50 Einträge auf „Beendet“: Fortschritt aufgefüllt, ein Token macht alles rückgängig (auch das Verlaufs-Auffüllen)', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const ids = legeAn(g, 50)
  const r = mehrere(g, ids, { art: 'status', status: 'completed' })
  assert.equal(r.success, true)
  assert.equal(r.geaendert, 50)
  assert.equal(r.uebersprungen, 0)
  assert.ok(r.token)
  const z = g.eins("SELECT COUNT(*) AS n, MIN(progress_episodes) AS p FROM entries WHERE status = 'completed' AND finished_at IS NOT NULL")
  assert.equal(z.n, 50)
  assert.equal(z.p, 12)
  // Das Auffüllen steht im Verlauf als „auto“ (zählt nicht als gesehen)
  assert.equal(g.eins("SELECT COUNT(*) AS n FROM verlauf WHERE quelle = 'auto'").n, 50)

  assert.deepEqual(zurueck(g, r.token), { success: true })
  const danach = g.eins("SELECT COUNT(*) AS n FROM entries WHERE status = 'ongoing' AND progress_episodes = 3 AND finished_at IS NULL")
  assert.equal(danach.n, 50)
  // Gegenbuchung im Verlauf: Summe aller auto-Zeilen ergibt wieder keine Änderung
  assert.equal(g.eins("SELECT COALESCE(SUM(bis - von), 0) AS s FROM verlauf WHERE quelle = 'auto'").s, 0)
  assert.deepEqual(zurueck(g, r.token), { success: false }, 'Token nur einmal einlösbar')
})

test('Schon im Zielzustand wird übersprungen; nichts zu ändern → kein Token', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const ids = legeAn(g, 3)
  g.aendere("UPDATE entries SET status = 'planned' WHERE id = ?", [ids[0]])
  const r = mehrere(g, ids, { art: 'status', status: 'planned' })
  assert.equal(r.geaendert, 2)
  assert.equal(r.uebersprungen, 1)
  const r2 = mehrere(g, ids, { art: 'status', status: 'planned' })
  assert.equal(r2.geaendert, 0)
  assert.equal(r2.token, null)
})

test('Favorit und Abo (nur Anime); Rückgängig stellt beides her', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const animeIds = legeAn(g, 2)
  const mangaIds = legeAn(g, 2, 'MANGA').filter(i => !animeIds.includes(i))
  const alle = [...animeIds, ...mangaIds]

  const f = mehrere(g, alle, { art: 'favorit', wert: true })
  assert.equal(f.geaendert, 4)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries WHERE is_favorite = 1').n, 4)

  const a = mehrere(g, alle, { art: 'abo', wert: true })
  assert.equal(a.geaendert, 2)
  assert.equal(a.uebersprungen, 2, 'Manga werden nicht abonniert')
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries WHERE abonniert = 1').n, 2)

  zurueck(g, a.token)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries WHERE abonniert = 1').n, 0)
  zurueck(g, f.token)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries WHERE is_favorite = 1').n, 0)
})

test('Liste: hinzufügen/entfernen, Rückgängig stellt genau den Vorzustand her', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const ids = legeAn(g, 4)
  const liste = aufruf(g, 'lists:create', 'Wochenende')
  g.aendere('INSERT INTO list_entries (list_id, entry_id) VALUES (?, ?)', [liste.id, ids[0]])

  const hin = mehrere(g, ids, { art: 'liste', listeId: liste.id, hinzu: true })
  assert.equal(hin.geaendert, 3)
  assert.equal(hin.uebersprungen, 1)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM list_entries WHERE list_id = ?', [liste.id]).n, 4)
  zurueck(g, hin.token)
  assert.deepEqual(g.alle('SELECT entry_id FROM list_entries WHERE list_id = ?', [liste.id]).map(r => r.entry_id), [ids[0]])

  const weg = mehrere(g, ids, { art: 'liste', listeId: liste.id, hinzu: false })
  assert.equal(weg.geaendert, 1)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM list_entries WHERE list_id = ?', [liste.id]).n, 0)
  zurueck(g, weg.token)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM list_entries WHERE list_id = ?', [liste.id]).n, 1)

  assert.equal(mehrere(g, ids, { art: 'liste', listeId: 9999, hinzu: true }).success, false, 'unbekannte Liste')
})

test('Löschen mit Watch-Order und Liste; Rückgängig holt alles zurück', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const ids = legeAn(g, 5)
  const liste = aufruf(g, 'lists:create', 'L')
  g.aendere('INSERT INTO list_entries (list_id, entry_id) VALUES (?, ?)', [liste.id, ids[1]])
  g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, total_episodes, progress_episodes, item_status)
    VALUES (?, 100, 'MAIN', 0, 12, 5, 'ongoing')`, [ids[1]])
  const r = mehrere(g, [ids[0], ids[1], ids[2]], { art: 'loeschen' })
  assert.equal(r.geaendert, 3)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries').n, 2)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM list_entries').n, 0)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM watch_order').n, 0)

  zurueck(g, r.token)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries').n, 5)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM list_entries').n, 1)
  assert.equal(g.eins('SELECT progress_episodes AS p FROM watch_order').p, 5)
})

test('Abgleich: Mehrfachaktion kommt auf dem zweiten Gerät an, Rückgängig ebenfalls (auch nach Löschen)', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const ids = legeAn(pc, 6)
  await sync(pc); await sync(handy)
  assert.equal(handy.eins('SELECT COUNT(*) AS n FROM entries').n, 6)

  const st = mehrere(pc, ids, { art: 'status', status: 'dropped' })
  await sync(pc); await sync(handy)
  assert.equal(handy.eins("SELECT COUNT(*) AS n FROM entries WHERE status = 'dropped'").n, 6)
  zurueck(pc, st.token)
  await sync(pc); await sync(handy)
  assert.equal(handy.eins("SELECT COUNT(*) AS n FROM entries WHERE status = 'ongoing'").n, 6)

  const del = mehrere(pc, ids.slice(0, 4), { art: 'loeschen' })
  await sync(pc); await sync(handy)
  assert.equal(handy.eins('SELECT COUNT(*) AS n FROM entries').n, 2)
  zurueck(pc, del.token)
  await sync(pc); await sync(handy)
  assert.equal(pc.eins('SELECT COUNT(*) AS n FROM entries').n, 6)
  assert.equal(handy.eins('SELECT COUNT(*) AS n FROM entries').n, 6, 'zurückgeholte Einträge erscheinen auch auf dem Handy wieder')
})

test('Eingaben werden geprüft', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const ids = legeAn(g, 2)
  assert.equal(mehrere(g, [], { art: 'loeschen' }).success, false)
  assert.equal(mehrere(g, 'x', { art: 'loeschen' }).success, false)
  assert.equal(mehrere(g, ids, { art: 'quatsch' }).success, false)
  assert.equal(mehrere(g, ids, { art: 'status', status: 'started' }).success, false)
  assert.equal(mehrere(g, ids, null).success, false)
  assert.equal(mehrere(g, new Array(5001).fill(0).map((_, i) => i + 1), { art: 'loeschen' }).success, false)
  // Unbekannte und doppelte IDs stören nicht
  const r = mehrere(g, [ids[0], ids[0], 99999, 'a', 1.5], { art: 'favorit', wert: true })
  assert.equal(r.geaendert, 1)
  assert.equal(r.uebersprungen, 1)
  assert.equal(g.eins('SELECT COUNT(*) AS n FROM entries').n, 2)
})
