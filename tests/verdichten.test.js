// Tests für das Verdichten des Änderungsprotokolls sync_log (Plan Nr. 17): wächst nicht mehr ohne Grenze,
// der Abgleich bleibt dabei richtig (Konflikte, Gesamtstand, noch nicht hochgeladene Zeilen).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')
const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
const abgleich = require(path.join(BUILD, 'sync/abgleich.js'))

async function sync(g) {
  const s = await g.abgleichen()
  assert.equal(s.fehler, null, `Abgleich auf ${g.name} meldet: ${s.fehler}`)
}
const zeilen = g => Number(g.eins('SELECT COUNT(*) AS n FROM sync_log').n)
const verdichte = g => { g.aktiv(); return abgleich.verdichteSyncLog() }
let zaehler = 0
const verlaufEinfuegen = (g, uuid, n) => {
  for (let i = 0; i < n; i++) {
    g.aendere(`INSERT INTO verlauf (id, eintrag, staffel, art, von, bis, zeit, quelle) VALUES (?, ?, NULL, 'folge', ?, ?, ?, 'plus')`,
      [`${g.name}-${uuid}-${i}-${++zaehler}`, uuid, i, i + 1, 1700000000000 + i])
  }
}

test('Protokoll schrumpft: je Feld bleibt nur die letzte Änderung, Zustand und Abgleich unverändert', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc); await sync(handy)
  for (let i = 1; i <= 30; i++) pc.aendere('UPDATE entries SET progress_episodes = ? WHERE uuid = ?', [i, a])
  const vorher = zeilen(pc)
  await sync(pc) // lädt hoch und verdichtet
  assert.ok(zeilen(pc) < vorher - 25, `nur ${vorher} → ${zeilen(pc)} Zeilen`)
  assert.equal(pc.eins("SELECT COUNT(*) AS n FROM sync_log WHERE feld = 'progress_episodes'").n, 1)
  assert.equal(pc.feld(a, 'progress_episodes'), 30)
  await sync(handy)
  assert.equal(handy.feld(a, 'progress_episodes'), 30, 'Handy bekommt trotzdem den Endstand (Drive-Dateien unberührt)')
  await sync(handy); await sync(pc)
  assert.equal(pc.feld(a, 'progress_episodes'), 30)
  assert.ok(Number(abgleich.hoechsteEigeneNr()) >= 0)
})

test('noch nicht hochgeladene eigene Zeilen bleiben stehen (auch wenn überholt)', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc); await sync(handy)
  pc.aendere('UPDATE entries SET review = ? WHERE uuid = ?', ['eins', a])
  pc.aendere('UPDATE entries SET review = ? WHERE uuid = ?', ['zwei', a])
  const offen = zeilen(pc)
  assert.equal(verdichte(pc), 0, 'nichts gelöscht: beide Zeilen sind noch nicht hochgeladen')
  assert.equal(zeilen(pc), offen)
  await sync(pc); await sync(handy)
  assert.equal(handy.feld(a, 'review'), 'zwei')
  // jetzt ist alles hochgeladen: nur die letzte bleibt
  assert.equal(pc.eins("SELECT COUNT(*) AS n FROM sync_log WHERE feld = 'review'").n, 1)
})

test('Konflikte nach dem Verdichten wie vorher: letzte Änderung gewinnt, Fortschritt = Maximum', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Frieren')
  for (let i = 0; i < 5; i++) pc.aendere('UPDATE entries SET review = ?, progress_episodes = ? WHERE uuid = ?', [`r${i}`, i, a])
  await sync(pc); await sync(handy); await sync(pc); await sync(handy)
  assert.ok(zeilen(pc) < 20 && zeilen(handy) < 20, 'beide Protokolle sind klein')
  // gleichzeitig am selben Feld: Text → später gewinnt, Fortschritt → höher gewinnt
  handy.aendere('UPDATE entries SET review = ?, progress_episodes = 9 WHERE uuid = ?', ['vom Handy', a])
  await new Promise(r => setTimeout(r, 5))
  pc.aendere('UPDATE entries SET review = ?, progress_episodes = 6 WHERE uuid = ?', ['vom PC', a])
  await sync(handy); await sync(pc); await sync(handy); await sync(pc)
  for (const g of [pc, handy]) {
    assert.equal(g.feld(a, 'review'), 'vom PC', `${g.name}: spätere Änderung gewinnt`)
    assert.equal(g.feld(a, 'progress_episodes'), 9, `${g.name}: Maximum gewinnt`)
  }
  // gleiche Änderung in beide Richtungen mehrfach: bleibt stabil
  for (let i = 0; i < 3; i++) { await sync(pc); await sync(handy) }
  assert.equal(pc.feld(a, 'review'), handy.feld(a, 'review'))
})

test('Gelöschte Einträge: Löschvermerk bleibt, ein neues Gerät sieht den Eintrag nicht', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy'), neu = geraet('neu')
  const a = pc.neuerEintrag('Frieren'), b = pc.neuerEintrag('Dandadan')
  await sync(pc); await sync(handy)
  pc.aendere('UPDATE entries SET review = ? WHERE uuid = ?', ['x', a])
  pc.aendere('DELETE FROM entries WHERE uuid = ?', [a])
  await sync(pc); await sync(handy)
  assert.equal(handy.eins('SELECT COUNT(*) AS n FROM entries WHERE uuid = ?', [a]).n, 0)
  await sync(neu)
  assert.equal(neu.eins('SELECT COUNT(*) AS n FROM entries WHERE uuid = ?', [a]).n, 0)
  assert.equal(neu.eins('SELECT COUNT(*) AS n FROM entries WHERE uuid = ?', [b]).n, 1)
  assert.equal(pc.eins("SELECT COUNT(*) AS n FROM sync_log WHERE feld = '-' AND zeile = ?", [a]).n, 1)
})

test('Verlauf: Zeilen verlassen das Protokoll nach dem Hochladen, der Gesamtstand liest sie aus der Tabelle', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy'), neu = geraet('neu')
  const a = pc.neuerEintrag('Frieren')
  await sync(pc)
  verlaufEinfuegen(pc, a, 50)
  await sync(pc)
  assert.ok(Number(pc.eins("SELECT COUNT(*) AS n FROM sync_log WHERE tabelle = 'verlauf'").n) <= 1, 'höchstens die letzte Nummer bleibt')
  assert.equal(pc.eins('SELECT COUNT(*) AS n FROM verlauf').n, 50)
  await sync(handy)
  assert.equal(handy.eins('SELECT COUNT(*) AS n FROM verlauf').n, 50)
  assert.ok(Number(handy.eins("SELECT COUNT(*) AS n FROM sync_log WHERE tabelle = 'verlauf'").n) <= 1)

  // Neuanfang am PC (z. B. neues Passwort): der Gesamtstand enthält den Verlauf trotz leerem Protokoll
  pc.aktiv()
  abgleich.setzeAbgleichZurueck()
  await sync(pc)
  await sync(neu)
  assert.equal(neu.eins('SELECT COUNT(*) AS n FROM verlauf').n, 50)
  // und weiterer Verlauf nach dem Verdichten kommt ebenfalls an
  verlaufEinfuegen(handy, a, 3)
  await sync(handy); await sync(pc); await sync(neu)
  assert.equal(pc.eins('SELECT COUNT(*) AS n FROM verlauf').n, 53)
  assert.equal(neu.eins('SELECT COUNT(*) AS n FROM verlauf').n, 53)
})

test('Größe: viele Änderungen und Verlauf erzeugen nur ein kleines Protokoll', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const uuids = []
  for (let i = 0; i < 20; i++) uuids.push(pc.neuerEintrag(`Titel ${i}`))
  await sync(pc); await sync(handy)
  for (let runde = 1; runde <= 10; runde++) {
    for (const u of uuids) {
      pc.aendere('UPDATE entries SET progress_episodes = ?, status = ? WHERE uuid = ?', [runde, runde % 2 ? 'ongoing' : 'paused', u])
      verlaufEinfuegen(pc, u, 1)
    }
    pc.aendere('DELETE FROM verlauf WHERE id LIKE ?', ['x%'])
    await sync(pc); await sync(handy)
  }
  const proFeld = pc.alle('SELECT tabelle, zeile, feld, COUNT(*) AS n FROM sync_log GROUP BY tabelle, zeile, feld HAVING COUNT(*) > 1')
  assert.deepEqual(proFeld, [], 'je Feld höchstens eine Zeile')
  assert.ok(zeilen(pc) < 20 * 30, `Protokoll hat ${zeilen(pc)} Zeilen`)
  for (const u of uuids) assert.equal(handy.feld(u, 'progress_episodes'), 10)
})
