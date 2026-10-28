// Tests für den Abgleich über Google Drive (src/sync): zwei bzw. drei simulierte Geräte,
// ein Drive im Speicher, echte Verschlüsselung und echte sql.js-Datenbanken.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { erstelleUmgebung } = require('./hilfe')

const MAX_EIGENE_LOGS = 40 // wie in src/sync/dienst.ts

/** Abgleichen und sicherstellen, dass dabei kein Fehler gemeldet wurde */
async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
  return s
}

test('erster Abgleich: neues Gerät übernimmt den Gesamtstand des anderen', async () => {
  const { geraet, dateienVon } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  const b = pc.neuerEintrag('Dandadan')
  pc.aendere('UPDATE entries SET progress_episodes = 5 WHERE uuid = ?', [a])

  await sync(pc)
  const { staende, logs } = dateienVon(pc)
  assert.equal(staende.length, 1, 'PC lädt beim ersten Mal einen Gesamtstand hoch')
  assert.equal(logs.length, 0)

  await sync(handy)
  assert.equal(handy.feld(a, 'title'), 'Frieren')
  assert.equal(handy.feld(a, 'progress_episodes'), 5)
  assert.equal(handy.feld(b, 'title'), 'Dandadan')
  const standBis = Number(/_(\d+)\.json$/.exec(staende[0])[1])
  assert.equal(handy.letzteNr(pc.id()), standBis, 'Handy merkt sich, bis wohin es den PC kennt')
})

test('laufender Abgleich: neue Änderungen kommen als Einzeldatei an, ohne den Gesamtstand neu zu laden', async () => {
  const { geraet, drive, dateienVon } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc)
  await sync(handy)

  pc.aendere('UPDATE entries SET progress_episodes = 7 WHERE uuid = ?', [a])
  await sync(pc)
  assert.equal(dateienVon(pc).logs.length, 1, 'PC lädt die Änderung als log_-Datei hoch')

  drive.geladen.length = 0
  await sync(handy)
  assert.equal(handy.feld(a, 'progress_episodes'), 7)
  assert.ok(drive.geladen.every(n => !n.startsWith(`stand_${pc.id()}_`)), `Handy hat unnötig den Gesamtstand geladen: ${drive.geladen}`)

  // Und zurück: Änderung am Handy kommt am PC an
  handy.aendere("UPDATE entries SET review = 'vom Handy' WHERE uuid = ?", [a])
  await sync(handy)
  await sync(pc)
  assert.equal(pc.feld(a, 'review'), 'vom Handy')
  assert.equal(pc.feld(a, 'progress_episodes'), 7)
})

test('Aufräumen: zu viele Einzeldateien werden zu einem neuen Gesamtstand zusammengefasst', async () => {
  const { geraet, dateienVon } = await erstelleUmgebung()
  const pc = geraet('pc')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc)
  for (let i = 1; i <= MAX_EIGENE_LOGS + 1; i++) {
    pc.aendere('UPDATE entries SET progress_episodes = ? WHERE uuid = ?', [i, a])
    await sync(pc)
  }
  assert.equal(dateienVon(pc).logs.length, MAX_EIGENE_LOGS + 1)

  await sync(pc) // ohne neue Änderung – räumt trotzdem auf
  const { staende, logs } = dateienVon(pc)
  assert.equal(logs.length, 0, 'alle zusammengefassten Einzeldateien sind gelöscht')
  assert.equal(staende.length, 1, 'genau ein (neuer) Gesamtstand')

  // Ein ganz neues Gerät bekommt trotzdem den aktuellen Stand
  const handy = geraet('handy')
  await sync(handy)
  assert.equal(handy.feld(a, 'progress_episodes'), MAX_EIGENE_LOGS + 1)
})

test('Lücke: Gerät, dessen Einzeldateien beim Aufräumen gelöscht wurden, lädt den neueren Gesamtstand', async () => {
  const { geraet, dateienVon } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc)
  await sync(handy)
  pc.aendere('UPDATE entries SET progress_episodes = 1 WHERE uuid = ?', [a])
  await sync(pc)
  await sync(handy) // Handy kennt den PC jetzt bis zur ersten Einzeldatei
  assert.equal(handy.feld(a, 'progress_episodes'), 1)

  // Handy ist offline, der PC ändert weiter und räumt dann (ohne neue Änderung) auf:
  // danach liegt vom PC nur noch der neue Gesamtstand in Drive, keine einzige log_-Datei
  for (let i = 2; i <= MAX_EIGENE_LOGS; i++) {
    pc.aendere('UPDATE entries SET progress_episodes = ? WHERE uuid = ?', [i, a])
    await sync(pc)
  }
  pc.aendere("UPDATE entries SET review = 'zuletzt am PC' WHERE uuid = ?", [a])
  await sync(pc)
  assert.equal(dateienVon(pc).logs.length, MAX_EIGENE_LOGS + 1)
  await sync(pc) // räumt auf, ohne neue Änderung
  assert.deepEqual(dateienVon(pc).logs, [], 'Voraussetzung: der PC hat alle Einzeldateien gelöscht')

  await sync(handy)
  assert.equal(handy.feld(a, 'progress_episodes'), MAX_EIGENE_LOGS)
  assert.equal(handy.feld(a, 'review'), 'zuletzt am PC')
})

test('Lücke bei drei Geräten: Zähler gelten je Gerät, Änderungen dazwischen bringen nichts durcheinander', async () => {
  const { geraet, drive, dateienVon } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy'), tablet = geraet('tablet')
  const a = pc.neuerEintrag('Frieren')
  const b = handy.neuerEintrag('Dandadan')
  for (const g of [pc, handy, tablet, pc, handy]) await sync(g)
  await sync(tablet)
  assert.equal(tablet.feld(b, 'title'), 'Dandadan')

  // PC und Handy ändern abwechselnd. Der PC spielt dabei Handy-Zeilen ein – seine eigenen Nummern
  // sind also nicht fortlaufend (log_pc_5_5, log_pc_9_9, …), ohne dass etwas fehlt.
  for (let i = 1; i <= MAX_EIGENE_LOGS + 1; i++) {
    pc.aendere('UPDATE entries SET progress_episodes = ? WHERE uuid = ?', [i, a])
    await sync(pc)
    if (i % 10 === 0) {
      handy.aendere('UPDATE entries SET progress_episodes = ? WHERE uuid = ?', [i, b])
      await sync(handy)
      await sync(tablet) // Tablet bleibt zwischendurch auf dem Laufenden
    }
  }
  await sync(pc) // räumt auf
  assert.deepEqual(dateienVon(pc).logs, [])

  handy.aendere("UPDATE entries SET review = 'Handy zuletzt' WHERE uuid = ?", [b])
  await sync(handy)
  await sync(tablet)
  assert.equal(tablet.feld(a, 'progress_episodes'), MAX_EIGENE_LOGS + 1, 'PC-Stand kommt trotz Aufräumen an')
  assert.equal(tablet.feld(b, 'progress_episodes'), 40)
  assert.equal(tablet.feld(b, 'review'), 'Handy zuletzt')
  await sync(handy)
  assert.equal(handy.feld(a, 'progress_episodes'), MAX_EIGENE_LOGS + 1)

  // Danach läuft es wieder normal über Einzeldateien weiter
  pc.aendere("UPDATE entries SET review = 'danach' WHERE uuid = ?", [a])
  await sync(pc)
  drive.geladen.length = 0
  await sync(tablet)
  assert.equal(tablet.feld(a, 'review'), 'danach')
  assert.ok(drive.geladen.every(n => !n.startsWith('stand_')), `unnötig einen Gesamtstand geladen: ${drive.geladen}`)
})

test('Datei verschwindet zwischen Auflisten und Laden (anderes Gerät räumt gerade auf): kein Entschlüsselungsfehler', async () => {
  const { geraet, drive } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc)
  await sync(handy)
  pc.aendere('UPDATE entries SET progress_episodes = 3 WHERE uuid = ?', [a])
  await sync(pc)

  // Beim nächsten Laden ist die log_-Datei des PCs (kurz) weg – Drive antwortet 404
  const vorher = handy.letzteNr(pc.id())
  let weg = null
  drive.setzeVorDemLaden((id, d) => {
    if (d?.name.startsWith('log_')) { weg = [id, d]; drive.dateien.delete(id); drive.setzeVorDemLaden(null) }
  })
  const s = await handy.abgleichen()
  assert.ok(weg, 'Voraussetzung: die Datei wurde beim Laden entfernt')
  assert.equal(s.fehler, null, `404 darf nicht als Fehler gemeldet werden: ${s.fehler}`)
  assert.equal(handy.letzteNr(pc.id()), vorher, 'nichts übersprungen – beim nächsten Mal geht es dort weiter')

  // Beim nächsten Abgleich (Datei wieder lesbar) kommt die Änderung an
  drive.dateien.set(...weg)
  await sync(handy)
  assert.equal(handy.feld(a, 'progress_episodes'), 3)
})
