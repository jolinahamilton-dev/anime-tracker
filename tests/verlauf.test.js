// Tests für den Verlauf „gesehen am“ (Plan Nr. 9): Einträge bei +1/−1/Rückgängig/Wiederholen/Beendet,
// Abgleich zwischen Geräten (nur anfügen), Sicherung. Dazu die Auswertung (stats.ts).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')
const BUILD = process.env.ANIME_TRACKER_TEST_BUILD

const { registerEntryHandlers } = require(path.join(BUILD, 'main/handlers/entries.js'))
const { registerWatchOrderHandlers } = require(path.join(BUILD, 'main/handlers/watchorder.js'))
const { erstelleSicherung, spieleSicherungEin, leseSicherung } = require(path.join(BUILD, 'main/handlers/sicherung-kern.js'))

const kanaele = {}
const ipc = { handle: (name, f) => { kanaele[name] = f } }
registerEntryHandlers(ipc)
registerWatchOrderHandlers(ipc)
const EVENT = { sender: {} }
const aufruf = (g, name, ...a) => { g.aktiv(); return kanaele[name](EVENT, ...a) }

async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
}
const verlauf = g => g.alle('SELECT id, eintrag, staffel, art, von, bis, quelle FROM verlauf ORDER BY zeit, id')
const kurz = g => verlauf(g).map(v => `${v.art}:${v.staffel ?? '-'}:${v.von}>${v.bis}:${v.quelle}`)

function anime(g, titel, mitStaffeln = false) {
  const uuid = g.neuerEintrag(titel)
  g.aendere("UPDATE entries SET status = 'ongoing', total_episodes = 12 WHERE uuid = ?", [uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  if (mitStaffeln) {
    g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, total_episodes, progress_episodes, item_status)
      VALUES (?, 100, 'MAIN', 0, 12, 0, 'planned')`, [id])
    g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, total_episodes, progress_episodes, item_status)
      VALUES (?, 200, 'SEQUEL', 1, 12, 0, 'planned')`, [id])
  }
  return { uuid, id }
}

test('+1 und −1 schreiben je einen Eintrag, Rückgängig einen Gegeneintrag (nichts wird geändert)', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = anime(g, 'Frieren')
  aufruf(g, 'entries:fortschritt', id, 1)
  aufruf(g, 'entries:fortschritt', id, 1)
  const r = aufruf(g, 'entries:fortschritt', id, -1)
  assert.deepEqual(kurz(g), ['folge:-:0>1:plus', 'folge:-:1>2:plus', 'folge:-:2>1:plus'])
  aufruf(g, 'entries:rueckgaengig', r.rueckgaengig)
  assert.equal(kurz(g).length, 4)
  assert.equal(kurz(g)[3], 'folge:-:1>2:hand')
  assert.equal(g.eins('SELECT progress_episodes AS p FROM entries WHERE id = ?', [id]).p, 2)
  // −1 bei 0 ändert nichts → kein Eintrag
  const { id: id2, uuid: uuid2 } = anime(g, 'Dandadan')
  aufruf(g, 'entries:fortschritt', id2, -1)
  assert.equal(verlauf(g).filter(v => v.eintrag === uuid2).length, 0)
})

test('Anime mit Staffeln: Eintrag zählt die Staffel (AniList-ID); Detailseite (Staffel-Speichern) = hand', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = anime(g, 'Kusuriya', true)
  aufruf(g, 'entries:fortschritt', id, 1)
  const items = g.alle('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [id])
    .map(w => w.related_anilist_id === 200 ? { ...w, progress_episodes: 3, item_status: 'started' } : w)
  aufruf(g, 'watchorder:save', id, items)
  // die Detailseite spiegelt die Hauptstaffel zusätzlich in den Eintrag – das darf nicht doppelt zählen
  aufruf(g, 'entries:update', id, { progress_episodes: 1 })
  assert.deepEqual(kurz(g), ['folge:100:0>1:plus', 'folge:200:0>3:hand'])
})

test('„Beendet“ füllt auf = auto (Eintrag und Staffeln), zählt nicht als gesehen', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const m = g.neuerEintrag('Berserk')
  g.aendere("UPDATE entries SET type = 'MANGA', status = 'ongoing', total_chapters = 40, total_volumes = 4 WHERE uuid = ?", [m])
  const mid = g.eins('SELECT id FROM entries WHERE uuid = ?', [m]).id
  aufruf(g, 'entries:update', mid, { status: 'completed' })
  assert.deepEqual(kurz(g).sort(), ['band:-:0>4:auto', 'kapitel:-:0>40:auto'])

  const { id, uuid } = anime(g, 'Frieren', true)
  const items = g.alle('SELECT * FROM watch_order WHERE entry_id = ?', [id]).map(w => ({ ...w, progress_episodes: 12, item_status: 'completed' }))
  aufruf(g, 'watchorder:save', id, items, 'auto')
  aufruf(g, 'entries:update', id, { status: 'completed', progress_episodes: 12 })
  const frieren = verlauf(g).filter(v => v.eintrag === uuid)
  assert.equal(frieren.length, 2)
  assert.ok(frieren.every(v => v.quelle === 'auto'))
})

test('Wiederholen: Zurücksetzen steht als „wiederholung“ im Verlauf (zählt nicht), danach zählt +1 wieder', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const { id } = anime(g, 'Kusuriya', true)
  g.aendere("UPDATE watch_order SET progress_episodes = 12, item_status = 'completed' WHERE entry_id = ?", [id])
  g.aendere("UPDATE entries SET status = 'completed', progress_episodes = 12 WHERE id = ?", [id])
  const r = aufruf(g, 'entries:wiederholen', id)
  // Gleiche Millisekunde = Reihenfolge nach zufälliger ID: Einfügereihenfolge (rowid) ist hier die verlässliche
  const lokal = () => g.alle('SELECT staffel, art, von, bis, quelle FROM verlauf ORDER BY rowid').map(v => `${v.art}:${v.staffel ?? '-'}:${v.von}>${v.bis}:${v.quelle}`)
  assert.deepEqual(lokal(), ['folge:100:12>0:wiederholung', 'folge:200:12>0:wiederholung'])
  aufruf(g, 'entries:fortschritt', id, 1)
  assert.equal(lokal()[2], 'folge:100:0>1:plus')
  aufruf(g, 'entries:rueckgaengig', r.token)
  assert.ok(lokal().slice(3).every(k => k.endsWith(':wiederholung')))
})

test('Abgleich: Verlauf wird vereinigt, auch auf einem neuen Gerät; Rückgängig und −1 stimmen auf beiden', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const { id, uuid } = anime(pc, 'Frieren')
  aufruf(pc, 'entries:fortschritt', id, 1)
  aufruf(pc, 'entries:fortschritt', id, 1)
  await sync(pc)
  await sync(handy)
  assert.deepEqual(kurz(handy), kurz(pc), 'Handy übernimmt den Verlauf des PC')

  // Beide schauen unabhängig weiter und zählen zurück
  const hid = handy.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  aufruf(handy, 'entries:fortschritt', hid, 1)
  aufruf(pc, 'entries:fortschritt', id, -1)
  await sync(pc); await sync(handy); await sync(pc)
  assert.equal(verlauf(pc).length, 4)
  assert.deepEqual(verlauf(pc).map(v => v.id).sort(), verlauf(handy).map(v => v.id).sort(), 'beide zeigen denselben Verlauf')
  assert.ok(verlauf(pc).some(v => v.bis < v.von), '„−1“ ist ein eigener Eintrag')

  // Ein drittes Gerät sieht nur den Gesamtstand
  const tablet = geraet('tablet')
  await sync(tablet)
  assert.equal(verlauf(tablet).length, 4)
  // erneutes Einspielen ändert nichts (nur anfügen, keine Doppelten)
  await sync(tablet); await sync(handy)
  assert.equal(verlauf(tablet).length, 4)
  assert.equal(verlauf(handy).length, 4)
})

test('Sicherung enthält den Verlauf; Einspielen ergänzt nur (keine Doppelten); alte Sicherung ohne Verlauf geht', async () => {
  const { geraet } = await erstelleUmgebung()
  const a = geraet('a'), b = geraet('b')
  const { id } = anime(a, 'Frieren')
  aufruf(a, 'entries:fortschritt', id, 1)
  aufruf(a, 'entries:fortschritt', id, 1)
  a.aktiv()
  const s = JSON.parse(JSON.stringify(erstelleSicherung()))
  assert.equal(s.verlauf.length, 2)
  b.aktiv()
  spieleSicherungEin(s)
  spieleSicherungEin(s)
  assert.deepEqual(verlauf(b).map(v => v.id), verlauf(a).map(v => v.id))
  const alt = { ...s }
  delete alt.verlauf
  assert.deepEqual(leseSicherung(JSON.stringify(alt)).sicherung.verlauf, [])
})

test('Auswertung: nur plus/hand zählen, −1 zieht ab (nie unter 0), Serien und aktive Tage', () => {
  const { wertVerlaufAus } = require(path.join(BUILD, 'main/handlers/verlauf.js'))
  const t = (tag, h = 12) => new Date(2026, 10, tag, h).getTime() // November 2026
  const z = (art, von, bis, zeit, quelle = 'plus') => ({ art, von, bis, zeit, quelle })
  const zeilen = [
    z('folge', 0, 1, t(10)), z('folge', 1, 2, t(10, 20)), z('folge', 2, 3, t(11)), z('kapitel', 5, 8, t(12)),
    z('folge', 0, 24, t(13), 'auto'), z('folge', 12, 0, t(13), 'wiederholung'), z('folge', 0, 12, t(14), 'import'),
    z('folge', 3, 2, t(15)), // nur ein −1 an einem Tag: zählt 0, kein aktiver Tag
    z('folge', 2, 3, t(16)),
  ]
  const a = wertVerlaufAus(zeilen, new Date(2026, 10, 16, 18))
  assert.equal(a.folgenGesamt, 3)
  assert.equal(a.kapitelGesamt, 3)
  assert.equal(a.folgenProMonat.at(-1).monat, '2026-11')
  assert.equal(a.folgenProMonat.at(-1).wert, 3, '4 Schritte vor, 1 zurück')
  assert.equal(a.kapitelProMonat.at(-1).wert, 3)
  assert.equal(a.aktiveTage, 4, '10., 11., 12. und 16.')
  assert.equal(a.laengsteSerie, 3)
  assert.equal(a.aktuelleSerie, 1, 'heute (16.) schon geschaut, gestern nicht')
  assert.equal(a.seit, '2026-11-10')
  // Wochen: 9.–15. Nov. und 16.–22. Nov.
  const w = Object.fromEntries(a.folgenProWoche.map(x => [x.woche, x.wert]))
  assert.equal(w['2026-11-09'], 2, '3 Folgen minus 1 Rückschritt')
  assert.equal(w['2026-11-16'], 1)
  assert.equal(a.folgenProWoche.length, 12)
  // Ohne Daten
  const leer = wertVerlaufAus([], new Date(2026, 10, 16))
  assert.equal(leer.seit, null)
  assert.equal(leer.aktiveTage, 0)
})
