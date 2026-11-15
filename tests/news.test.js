// Tests für die News-Regel (src/main/handlers/news-regel.ts): standardmäßig nur die Hauptlinie
// abonnierter Serien, Nebengeschichten (z. B. „Maomao no Hitorigoto") nur mit der Einstellung.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const initSqlJs = require('sql.js')
const { kern } = require('./hilfe')

const regel = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'main/handlers/news-regel.js'))

async function neueDb() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  kern.createSchema(db)
  kern.migrateSchema(db)
  kern.setzeDb(db, () => {})
  const jetzt = Math.floor(Date.now() / 1000)
  kern.dbRun("INSERT INTO entries (title, type, anilist_id, abonniert) VALUES ('Kusuriya', 'ANIME', 161645, 1)")
  kern.dbRun("INSERT INTO entries (title, type, anilist_id, abonniert) VALUES ('Egal', 'ANIME', 999, 0)")
  const id = kern.dbGet("SELECT id FROM entries WHERE anilist_id = 161645").id
  const wo = (aid, rel, status) => kern.dbRun(
    'INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, media_status) VALUES (?, ?, ?, 0, ?)', [id, aid, rel, status])
  wo(161645, 'MAIN', 'FINISHED'); wo(195516, 'SEQUEL', 'RELEASING'); wo(170508, 'SIDE_STORY', 'FINISHED'); wo(218532, 'SIDE_STORY', 'RELEASING')
  for (const aid of [161645, 195516, 170508, 218532, 999]) {
    kern.dbRun('INSERT INTO news_cache (anilist_id, episode, airing_at, seen) VALUES (?, 7, ?, 0)', [aid, jetzt])
  }
}
const ids = neben => kern.dbAll(`SELECT anilist_id FROM news_cache WHERE anilist_id IN (${regel.aboIdsSql(neben)}) ORDER BY anilist_id`).map(r => r.anilist_id)

test('News: ohne Einstellung nur Hauptlinie, mit Einstellung auch Nebengeschichten', async () => {
  await neueDb()
  assert.equal(regel.nebenInNews(), false)
  assert.deepEqual(ids(false), [161645, 195516])
  assert.deepEqual(ids(true), [161645, 170508, 195516, 218532])
  kern.dbRun("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('newsNeben', 'true')")
  assert.equal(regel.nebenInNews(), true)
  assert.deepEqual(ids(), [161645, 170508, 195516, 218532])
})

test('News: Bedingung für Watch-Order-Zeilen und Relationsprüfung', async () => {
  await neueDb()
  const sel = neben => kern.dbAll(`SELECT w.related_anilist_id AS id FROM watch_order w WHERE 1 = 1${regel.newsWatchOrderBedingung('w', neben)} ORDER BY id`).map(r => r.id)
  assert.deepEqual(sel(false), [161645, 195516])
  assert.equal(sel(true).length, 4)
  assert.equal(regel.newsRelationErlaubt('SEQUEL', false), true)
  assert.equal(regel.newsRelationErlaubt('SIDE_STORY', false), false)
  assert.equal(regel.newsRelationErlaubt('SIDE_STORY', true), true)
})

test('News: newsNeben wird zwischen Geräten abgeglichen', () => {
  assert.ok(kern.SYNC_META.includes('newsNeben'))
})
