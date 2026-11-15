// Tests für die Abschaffung des Eintrags-Status „Angefangen" (started → ongoing):
// Migration, Abgleich mit einem Gerät in alter Version, Sicherung und CSV-Import.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const initSqlJs = require('sql.js')
const { erstelleUmgebung, kern } = require('./hilfe')
const BUILD = process.env.ANIME_TRACKER_TEST_BUILD

test('Migration: Angefangen → Laufend, protokolliert, updated_at bleibt, zweiter Lauf ändert nichts', async () => {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  kern.setzeDb(db, () => {})
  kern.createSchema(db) // Stand vor dem Abgleich: noch ohne Trigger/uuid
  const zeiten = ['2024-01-01 10:00:00', '2024-02-02 10:00:00', '2024-03-03 10:00:00']
  zeiten.forEach((z, i) => db.run(
    "INSERT INTO entries (type, title, status, updated_at) VALUES (?, ?, 'started', ?)", [i === 2 ? 'MANGA' : 'ANIME', `Alt${i}`, z]))
  db.run("INSERT INTO entries (type, title, status, updated_at) VALUES ('ANIME', 'Läuft', 'ongoing', '2024-04-04 10:00:00')")
  db.run("INSERT INTO entries (type, title, status, updated_at) VALUES ('ANIME', 'Fertig', 'completed', '2024-05-05 10:00:00')")

  kern.migrateSchema(db)
  const stand = () => kern.dbAll('SELECT title, status, updated_at FROM entries ORDER BY title')
  assert.deepEqual(stand().map(e => e.status), ['ongoing', 'ongoing', 'ongoing', 'completed', 'ongoing']) // Alt0-2, Fertig, Läuft
  assert.deepEqual(stand().filter(e => e.title.startsWith('Alt')).map(e => e.updated_at), zeiten, 'updated_at unberührt')
  const log = () => kern.dbAll("SELECT zeile, wert, alt FROM sync_log WHERE tabelle = 'entries' AND feld = 'status'")
  assert.equal(log().length, 3, 'genau eine Zeile je geändertem Eintrag')
  assert.ok(log().every(l => l.wert === 'ongoing' && l.alt === 'started'))
  assert.equal(new Set(log().map(l => l.zeile)).size, 3)

  const vorher = kern.dbGet('SELECT COUNT(*) AS n FROM sync_log').n
  kern.migrateSchema(db)
  assert.equal(kern.dbGet('SELECT COUNT(*) AS n FROM sync_log').n, vorher, 'idempotent')
  assert.equal(stand().filter(e => e.status === 'started').length, 0)
})

test('Abgleich: migriertes Gerät überträgt Laufend; Altwert von einem alten Gerät wird als Laufend gespeichert', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Alt')
  pc.aendere("UPDATE entries SET status = 'started' WHERE uuid = ?", [a]) // wie die alte App-Version
  await pc.abgleichen(); await handy.abgleichen()
  assert.equal(handy.feld(a, 'status'), 'ongoing', 'eingehendes „started" wird zu „ongoing"')
  assert.equal(pc.feld(a, 'status'), 'started') // das alte Gerät behält seinen Wert, bis es aktualisiert wird

  // Handy noch auf „started" (ohne Protokoll), PC migriert → Handy übernimmt die Änderung
  handy.aendere("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('sync_pause', '1')")
  handy.aendere("UPDATE entries SET status = 'started' WHERE uuid = ?", [a])
  handy.aendere("DELETE FROM app_meta WHERE key = 'sync_pause'")
  assert.equal(handy.feld(a, 'status'), 'started')
  pc.aktiv(); kern.migrateSchema(pc.db)
  assert.equal(pc.feld(a, 'status'), 'ongoing')
  await pc.abgleichen(); await handy.abgleichen()
  assert.equal(handy.feld(a, 'status'), 'ongoing')
})

test('Sicherung: Status „started" einer alten Sicherung wird beim Einspielen zu „ongoing"', async () => {
  const sicherung = require(path.join(BUILD, 'main/handlers/sicherung-kern.js'))
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const a = g.neuerEintrag('Alt')
  g.aendere("UPDATE entries SET status = 'started' WHERE uuid = ?", [a])
  g.aktiv()
  const text = JSON.stringify(sicherung.erstelleSicherung())
  assert.ok(text.includes('"status":"started"'))
  g.aendere("UPDATE entries SET status = 'planned' WHERE uuid = ?", [a])
  g.aktiv(); sicherung.spieleSicherungEin(sicherung.leseSicherung(text).sicherung)
  assert.equal(g.feld(a, 'status'), 'ongoing')
  // Eintrag, den es noch nicht gibt (Neuanlage über die Sicherung)
  g.aendere('DELETE FROM entries WHERE uuid = ?', [a])
  g.aktiv(); sicherung.spieleSicherungEin(sicherung.leseSicherung(text).sicherung)
  assert.equal(g.feld(a, 'status'), 'ongoing')
})

test('CSV-Import: „Angefangen" und „started" werden zu „ongoing"', async () => {
  const { importiereCsv } = require(path.join(BUILD, 'main/handlers/import-kern.js'))
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc'); g.aktiv()
  const csv = ['Titel;Typ;Status', 'A;ANIME;Angefangen', 'B;ANIME;started', 'C;ANIME;Laufend', 'D;ANIME;Beendet', 'E;MANGA;Geplant', 'F;ANIME;Quatsch'].join('\n')
  assert.equal(importiereCsv(csv).importiert, 6)
  const status = Object.fromEntries(g.alle('SELECT title, status FROM entries').map(e => [e.title, e.status]))
  assert.deepEqual(status, { A: 'ongoing', B: 'ongoing', C: 'ongoing', D: 'completed', E: 'planned', F: 'planned' })
})
