// Tests für die Sammlung (physische Manga-Bände): Bereichslisten (src/renderer/baende.ts),
// Abgleich der neuen Felder zwischen zwei Geräten und Sicherung/Wiederherstellung.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung, kern } = require('./hilfe')
const b = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'renderer/baende.js'))

test('parseBaende: Bereiche, Einzelwerte, Trenner und Unsinn', () => {
  assert.deepEqual(b.parseBaende('1-3, 5'), [1, 2, 3, 5])
  assert.deepEqual(b.parseBaende('5;3 3,1–2'), [1, 2, 3, 5]) // Semikolon, Leerzeichen, Duplikate, Gedankenstrich
  assert.deepEqual(b.parseBaende('7-5'), [5, 6, 7]) // verdrehter Bereich
  assert.deepEqual(b.parseBaende('x, 0, -3, 2-, abc, 4'), [4]) // nur 4 bleibt
  assert.deepEqual(b.parseBaende('0-2'), [1, 2]) // 0 wird auf 1 beschnitten
  assert.deepEqual(b.parseBaende(null), [])
  assert.deepEqual(b.parseBaende(''), [])
  assert.equal(b.parseBaende('1-99999').length, 0, 'mehr als vier Ziffern: nicht lesbar') // Schutz vor Riesenbereichen
  assert.equal(b.parseBaende('1-9999').length, 9999)
})

test('formatBaende: kompakte Bereiche ab drei Bänden', () => {
  assert.equal(b.formatBaende([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17, 18]), '1-12,14,16-18')
  assert.equal(b.formatBaende([1, 2]), '1,2')
  assert.equal(b.formatBaende([3, 1, 2, 2]), '1-3')
  assert.equal(b.formatBaende([]), null)
  assert.equal(b.formatBaende([0, -1, 1.5, 10000]), null)
  assert.equal(b.normalisiereBaende('3, 1-2 ,x'), '1-3')
  assert.equal(b.normalisiereBaende('nix'), null)
})

test('schalteBand / setzeBereich / Zustand je Band', () => {
  assert.equal(b.schalteBand('1-3', 5, true), '1-3,5')
  assert.equal(b.schalteBand('1-3,5', 2, false), '1,3,5')
  assert.equal(b.schalteBand('1', 1, false), null)
  assert.equal(b.schalteBand(null, 4, true), '4')
  assert.equal(b.setzeBereich('1,5', 2, 4, true), '1-5')
  assert.equal(b.setzeBereich('1-10', 8, 3, false), '1,2,9,10')

  assert.equal(b.bandStatus('1-3', '5', 2), 'besitz')
  assert.equal(b.bandStatus('1-3', '5', 5), 'wunsch')
  assert.equal(b.bandStatus('1-3', '5', 4), 'fehlt')

  // Zyklus fehlt → besitz → wunsch → fehlt, ohne dass ein Band in beiden Listen steht
  let s = { besitz: null, wunsch: null }
  const reihe = []
  for (let i = 0; i < 3; i++) {
    const neu = b.NAECHSTER_STATUS[b.bandStatus(s.besitz, s.wunsch, 7)]
    s = b.setzeBandStatus(s.besitz, s.wunsch, 7, neu)
    reihe.push([neu, s.besitz, s.wunsch])
  }
  assert.deepEqual(reihe, [['besitz', '7', null], ['wunsch', null, '7'], ['fehlt', null, null]])
})

test('Übernehmen und „Alle bis Band X“ nehmen Wunsch-Bände heraus, die nun da sind', () => {
  assert.deepEqual(b.besitzAusText('1-3, 6', '3,4'), { besitz: '1-3,6', wunsch: '4' })
  assert.deepEqual(b.besitzBereich('9', '2,12', 1, 5), { besitz: '1-5,9', wunsch: '12' })
})

test('Auswertung: Lücken, nächster Kauf, ungelesen', () => {
  assert.deepEqual(b.luecken('1-4,6,10'), [5, 7, 8, 9])
  assert.deepEqual(b.luecken('1-3', 5), [4, 5])
  assert.deepEqual(b.luecken(null), [])
  assert.equal(b.naechsterKauf('1-12'), 13)
  assert.equal(b.naechsterKauf('1-12', 12), null, 'Serie komplett')
  assert.equal(b.naechsterKauf(null), null)
  assert.equal(b.hoechsterBand('1-3', '7', null), 7)
  assert.deepEqual(b.ungelesen('1-6,8', 4), [5, 6, 8])
  assert.deepEqual(b.ungelesen('1-3', 3), [])
  assert.equal(b.anzeigeBaende([5, 9, 12, 13, 14]), '5, 9, 12–14')
})

test('Abgleich: Bände und Ausgabe, an einem Gerät eingetragen, kommen am anderen an', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const a = pc.neuerEintrag('Berserk')
  await pc.abgleichen(); await handy.abgleichen()

  pc.aendere("UPDATE entries SET baende_besitz = '1-12,14', baende_wunsch = '13', ausgabe = 'Carlsen' WHERE uuid = ?", [a])
  await pc.abgleichen(); await handy.abgleichen()
  assert.equal(handy.feld(a, 'baende_besitz'), '1-12,14')
  assert.equal(handy.feld(a, 'baende_wunsch'), '13')
  assert.equal(handy.feld(a, 'ausgabe'), 'Carlsen')

  // Handy ändert den Besitz, PC den Wunsch → beides bleibt (verschiedene Felder)
  handy.aendere("UPDATE entries SET baende_besitz = '1-14' WHERE uuid = ?", [a])
  pc.aendere('UPDATE entries SET baende_wunsch = NULL WHERE uuid = ?', [a])
  await handy.abgleichen(); await pc.abgleichen(); await handy.abgleichen()
  for (const g of [pc, handy]) {
    assert.equal(g.feld(a, 'baende_besitz'), '1-14')
    assert.equal(g.feld(a, 'baende_wunsch'), null)
  }

  // Ein Gerät, das erst später dazukommt, bekommt die Felder über den Gesamtstand
  const tablet = geraet('tablet')
  await tablet.abgleichen()
  assert.equal(tablet.feld(a, 'baende_besitz'), '1-14')
  assert.equal(tablet.feld(a, 'ausgabe'), 'Carlsen')
})

test('Migration: bestehende Datenbank ohne die Spalten bekommt sie, Daten bleiben', async () => {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  kern.createSchema(db)
  kern.migrateSchema(db)
  // Zustand vor der Sammlung nachstellen: Spalten entfernen
  for (const trigger of db.exec("SELECT name FROM sqlite_master WHERE type = 'trigger'")[0].values) db.run(`DROP TRIGGER ${trigger[0]}`)
  for (const c of ['baende_besitz', 'baende_wunsch', 'ausgabe']) db.run(`ALTER TABLE entries DROP COLUMN ${c}`)
  db.run("INSERT INTO entries (type, title, status) VALUES ('MANGA', 'Vinland Saga', 'started')")
  kern.migrateSchema(db)
  const spalten = db.exec('PRAGMA table_info(entries)')[0].values.map(r => r[1])
  for (const c of ['baende_besitz', 'baende_wunsch', 'ausgabe']) assert.ok(spalten.includes(c), c)
  assert.equal(db.exec('SELECT title FROM entries')[0].values[0][0], 'Vinland Saga')
})

test('Sicherung: Sammlung wird gesichert und wiederhergestellt, ältere Sicherungen laden weiter', async () => {
  const sicherung = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'main/handlers/sicherung-kern.js'))
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const a = g.neuerEintrag('Vagabond')
  g.aendere("UPDATE entries SET baende_besitz = '1-5', baende_wunsch = '8', ausgabe = 'Tokyopop' WHERE uuid = ?", [a])

  g.aktiv()
  const s = JSON.parse(JSON.stringify(sicherung.erstelleSicherung()))
  const e = s.entries.find(x => x.uuid === a)
  assert.equal(e.baende_besitz, '1-5'); assert.equal(e.baende_wunsch, '8'); assert.equal(e.ausgabe, 'Tokyopop')

  g.aendere("UPDATE entries SET baende_besitz = NULL, baende_wunsch = NULL, ausgabe = NULL WHERE uuid = ?", [a])
  g.aktiv(); sicherung.spieleSicherungEin(sicherung.leseSicherung(JSON.stringify(s)).sicherung)
  assert.equal(g.feld(a, 'baende_besitz'), '1-5')
  assert.equal(g.feld(a, 'baende_wunsch'), '8')
  assert.equal(g.feld(a, 'ausgabe'), 'Tokyopop')

  // Sicherung aus der Zeit vor der Sammlung: lädt ohne Fehler (Felder fehlen einfach)
  for (const x of s.entries) { delete x.baende_besitz; delete x.baende_wunsch; delete x.ausgabe }
  g.aktiv(); sicherung.spieleSicherungEin(sicherung.leseSicherung(JSON.stringify(s)).sicherung)
  assert.equal(g.feld(a, 'title'), 'Vagabond')
})
