// Tests für die Achievement-Stufen (src/main/handlers/achievements.ts): Schwellenwerte,
// Übertragung der alten Einzel-Achievements auf Stufen, Serien-Zählung und Nutzungstage.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const initSqlJs = require('sql.js')
const { kern } = require('./hilfe')

const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
const ach = require(path.join(BUILD, 'main/handlers/achievements.js'))
const { merkeTag } = require(path.join(BUILD, 'main/trackAppOpen.js'))

let SQL = null
async function neueDb() {
  SQL ??= await initSqlJs()
  const db = new SQL.Database()
  kern.createSchema(db)
  kern.migrateSchema(db)
  kern.setzeDb(db, () => {})
  return {
    db,
    alle: (sql, p = []) => kern.dbAll(sql, p),
    eins: (sql, p = []) => kern.dbGet(sql, p),
    run: (sql, p = []) => kern.dbRun(sql, p),
    datum: id => kern.dbGet('SELECT unlocked_at AS d FROM achievements WHERE id = ?', [id])?.d ?? null,
  }
}

// Schwellen der früheren Einzel-Achievements – die Zielstufe darf nicht höher liegen
const ALTE_SCHWELLEN = {
  zehn_eintraege: 10, fuenfzig_eintraege: 50, hundert_eintraege: 100, zweihundert_eintraege: 200,
  zehn_abschluesse: 10, fuenfzig_abschluesse: 50, zehn_bewertungen: 10,
  hundert_folgen: 100, tausend_folgen: 1000, hundert_kapitel: 100, tausend_kapitel: 1000,
  zehn_favoriten: 10, fuenfzig_favoriten: 50, vielseitig: 5, zwanzig_genres: 20,
  erste_liste: 1, fuenf_listen: 5, sieben_tage: 7, dreissig_tage: 30,
  vierundzwanzig_stunden: 24, hundert_stunden: 100,
}

test('Tracks: fünf aufsteigende Stufen, eindeutige IDs', () => {
  const ids = new Set()
  for (const t of ach.TRACKS) {
    assert.equal(t.schwellen.length, ach.STUFEN.length, t.id)
    for (let i = 1; i < t.schwellen.length; i++) assert.ok(t.schwellen[i] > t.schwellen[i - 1], `${t.id} aufsteigend`)
    assert.ok(!ids.has(t.id)); ids.add(t.id)
  }
  const folgen = ach.TRACKS.find(t => t.id === 'folgen')
  assert.deepEqual(folgen.schwellen.slice(0, 2), [100, 500], 'wie gewünscht: 100 = Bronze, 500 = Silber')
})

test('stufeFuer: zählt erreichte Stufen', () => {
  const s = [100, 500, 1000, 2500, 5000]
  assert.equal(ach.stufeFuer(0, s), 0)
  assert.equal(ach.stufeFuer(99, s), 0)
  assert.equal(ach.stufeFuer(100, s), 1)
  assert.equal(ach.stufeFuer(734, s), 2)
  assert.equal(ach.stufeFuer(5000, s), 5)
  assert.equal(ach.stufeFuer(99999, s), 5)
})

test('ALTE_IDS: jede alte ID zeigt auf eine existierende Stufe, deren Schwelle schon erreicht war', () => {
  for (const [alt, neu] of Object.entries(ach.ALTE_IDS)) {
    const [, trackId, nr] = /^(.+)_(\d)$/.exec(neu)
    const t = ach.TRACKS.find(x => x.id === trackId)
    assert.ok(t, `${alt} → unbekannter Track ${trackId}`)
    assert.ok(Number(nr) >= 1 && Number(nr) <= 5)
    assert.ok(alt in ALTE_SCHWELLEN, `Schwelle für ${alt} im Test nachtragen`)
    assert.ok(t.schwellen[Number(nr) - 1] <= ALTE_SCHWELLEN[alt], `${alt} (${ALTE_SCHWELLEN[alt]}) → ${neu} (${t.schwellen[Number(nr) - 1]})`)
  }
})

test('Übertragung: alte Achievements → Stufen mit altem Datum, untere Stufen inklusive, alte Zeilen bleiben', async () => {
  const d = await neueDb()
  const D0 = '2026-01-01T10:00:00.000Z', D1 = '2026-03-01T10:00:00.000Z'
  d.run("INSERT INTO achievements (id, name, unlocked_at) VALUES ('hundert_folgen', 'Marathon-Zuschauer', ?)", [D0])
  d.run("INSERT INTO achievements (id, name, unlocked_at) VALUES ('tausend_folgen', 'Anime-Veteran', ?)", [D1])
  d.run("INSERT INTO achievements (id, name, unlocked_at) VALUES ('zwoelf_stunden', 'Zeitinvestor', ?)", [D0])
  d.run("INSERT INTO achievements (id, name, unlocked_at) VALUES ('fuenf_listen', 'Listenprofi', ?)", [D1])

  ach.migriereAlteAchievements()
  assert.equal(d.datum('folgen_1'), D0, 'Bronze: das frühere der beiden alten Daten')
  assert.equal(d.datum('folgen_2'), D1, 'Silber: von tausend_folgen mit abgedeckt')
  assert.equal(d.datum('folgen_3'), D1)
  assert.equal(d.datum('folgen_4'), null)
  assert.equal(d.datum('listen_1'), D1)
  assert.equal(d.datum('listen_3'), D1)
  assert.equal(d.datum('stunden_1'), null, '12 Stunden reichen nicht für Bronze')
  assert.equal(d.datum('zwoelf_stunden'), D0, 'alte Zeilen werden nie gelöscht')
  assert.match(d.eins("SELECT name FROM achievements WHERE id = 'folgen_2'").name, /Folgen-Marathon · Silber/)

  // Neue Stufen landen im Abgleich-Protokoll (INSERT-Trigger)
  const geloggt = d.alle("SELECT zeile FROM sync_log WHERE tabelle = 'achievements'").map(r => r.zeile)
  assert.ok(geloggt.includes('folgen_2'), 'neue Stufe wird abgeglichen')

  // Mehrfach ausführen ändert nichts
  const vorher = d.alle('SELECT * FROM achievements ORDER BY id')
  ach.migriereAlteAchievements()
  assert.deepEqual(d.alle('SELECT * FROM achievements ORDER BY id'), vorher)

  // Eine alte Zeile mit früherem Datum kommt später per Abgleich an → Datum wird übernommen
  d.run("UPDATE achievements SET unlocked_at = '2025-12-01T00:00:00.000Z' WHERE id = 'tausend_folgen'")
  ach.migriereAlteAchievements()
  assert.equal(d.datum('folgen_3'), '2025-12-01T00:00:00.000Z')
  assert.equal(d.datum('folgen_1'), '2025-12-01T00:00:00.000Z')
})

test('Prüfung: schaltet Stufen frei, meldet je Track nur die höchste', async () => {
  const d = await neueDb()
  for (let i = 0; i < 55; i++) d.run("INSERT INTO entries (type, title, status) VALUES ('MANGA', ?, 'completed')", ['M' + i])
  d.run("UPDATE entries SET progress_chapters = 20") // 55 × 20 = 1100 Kapitel

  const gesendet = []
  const neu = ach.pruefeAchievements({ webContents: { send: (k, x) => gesendet.push([k, x]) } })
  assert.ok(d.datum('eintraege_1') && d.datum('eintraege_2'), '10 und 50 Einträge')
  assert.equal(d.datum('eintraege_3'), null)
  assert.ok(d.datum('kapitel_3'), '1000 Kapitel = Gold')
  assert.equal(d.datum('kapitel_4'), null)
  const kapitel = neu.filter(n => n.id.startsWith('kapitel_'))
  assert.equal(kapitel.length, 1, 'nur ein Toast für den Kapitel-Track')
  assert.equal(kapitel[0].stufenName, 'Gold')
  assert.equal(kapitel[0].name, 'Leseratte')
  assert.ok(neu.some(n => n.id === 'erster_eintrag' && !n.stufe), 'Einzel-Achievement ohne Stufe')
  assert.equal(gesendet.length, 1)
  assert.equal(gesendet[0][0], 'achievements:neu')

  // Zweiter Lauf: nichts Neues
  assert.equal(ach.pruefeAchievements(null).length, 0)

  const u = ach.achievementUebersicht()
  const k = u.tracks.find(t => t.id === 'kapitel')
  assert.equal(k.wert, 1100)
  assert.equal(k.erreicht, 3)
  assert.deepEqual(k.naechste, { nr: 4, name: 'Platin', schwelle: 2500 })
  assert.equal(u.gesamt, ach.TRACKS.length * 5 + u.einzeln.length)
  assert.equal(u.freigeschaltet, d.alle('SELECT id FROM achievements').length)
  assert.ok(!u.einzeln.some(a => a.id in ach.ALTE_IDS), 'alte IDs tauchen nicht mehr auf')
})

test('Serien: längste und aktuelle Folge aufeinanderfolgender Tage', () => {
  const tage = ['2026-10-20', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-31', '2026-11-01', '2026-11-02']
  assert.equal(ach.laengsteSerie(tage), 3)
  assert.equal(ach.laengsteSerie([]), 0)
  assert.equal(ach.laengsteSerie(['2026-02-28', '2026-03-01']), 2, 'über Monatsgrenzen')
  assert.equal(ach.laengsteSerie(['2025-12-31', '2026-01-01', '2026-01-01']), 2, 'Doppelte zählen einmal')
  assert.equal(ach.aktuelleSerie(tage, '2026-11-02'), 3, 'heute geöffnet')
  assert.equal(ach.aktuelleSerie(tage, '2026-11-03'), 3, 'heute noch nicht geöffnet – Serie läuft noch')
  assert.equal(ach.aktuelleSerie(tage, '2026-11-04'), 0, 'gestern verpasst')
})

test('Nutzungstage: jeder Tag einmal, höchstens 400', async () => {
  const d = await neueDb()
  assert.equal(merkeTag('2026-11-01'), true)
  assert.equal(merkeTag('2026-11-01'), false)
  assert.equal(merkeTag('2026-11-02'), true)
  assert.deepEqual(ach.nutzungsTage(), ['2026-11-01', '2026-11-02'])
  const viele = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10))
  d.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('open_days', ?)", [JSON.stringify(viele)])
  merkeTag('2027-06-01')
  const jetzt = ach.nutzungsTage()
  assert.equal(jetzt.length, 400)
  assert.equal(jetzt[jetzt.length - 1], '2027-06-01')
})
