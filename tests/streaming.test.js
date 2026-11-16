// Tests für „Wo schauen“ (Plan Nr. 8): Links bereinigen, aktuelle Staffel wählen, 7-Tage-Cache, offline.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { erstelleUmgebung } = require('./hilfe')
const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
const { bereinigeLinks, waehleStaffelId, ladeStreaming } = require(path.join(BUILD, 'main/handlers/streaming.js'))

const antwortMit = links => async () => ({ data: { Media: { id: 1, externalLinks: links } } })
const CR = { type: 'STREAMING', site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/X', language: 'Japanese', color: '#f78b24' }
const NF = { type: 'STREAMING', site: 'Netflix', url: 'https://www.netflix.com/title/1', color: '#e50914' }

test('Links: nur Streaming und https, Dubletten raus, Farbe geprüft', () => {
  const l = bereinigeLinks([
    CR, CR, NF,
    { type: 'INFO', site: 'Official Site', url: 'https://example.org' },
    { type: 'STREAMING', site: 'Unsicher', url: 'http://example.org' },
    { type: 'STREAMING', site: 'Skript', url: 'javascript:alert(1)' },
    { type: 'STREAMING', site: '', url: 'https://example.org' },
    { type: 'STREAMING', site: 'Farbe', url: 'https://example.org/a', color: 'red;background:url(x)' },
  ])
  assert.deepEqual(l.map(x => x.site), ['Crunchyroll', 'Netflix', 'Farbe'])
  assert.equal(l[2].color, null)
  assert.deepEqual(bereinigeLinks(null), [])
})

test('Staffel: die laufende Staffel der Hauptlinie, sonst die Hauptstaffel, sonst der Eintrag', () => {
  const wo = (id, rel, p, total, status = 'planned') => ({ related_anilist_id: id, relation_type: rel, progress_episodes: p, total_episodes: total, item_status: status, media_status: 'FINISHED' })
  // S1 fertig, S2 angefangen → S2
  assert.equal(waehleStaffelId(1, [wo(1, 'MAIN', 12, 12, 'completed'), wo(2, 'SEQUEL', 3, 12, 'started'), wo(3, 'SEQUEL', 0, 12)]), 2)
  // nichts geschaut → erste freie
  assert.equal(waehleStaffelId(1, [wo(1, 'MAIN', 0, 12), wo(2, 'SEQUEL', 0, 12)]), 1)
  // alles fertig → Hauptstaffel
  assert.equal(waehleStaffelId(1, [wo(1, 'MAIN', 12, 12, 'completed'), wo(2, 'SEQUEL', 12, 12, 'completed')]), 1)
  // Nebengeschichten zählen nicht
  assert.equal(waehleStaffelId(1, [wo(1, 'MAIN', 12, 12, 'completed'), wo(9, 'SIDE_STORY', 0, 1)]), 1)
  // ohne Watch-Order: der Eintrag selbst
  assert.equal(waehleStaffelId(77, []), 77)
  assert.equal(waehleStaffelId(null, []), null)
})

test('Abruf: gecacht, 7 Tage gültig, danach neu; offline zeigt den Cache; Titel ohne Links = leer', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const uuid = g.neuerEintrag('Kusuriya')
  g.aendere("UPDATE entries SET anilist_id = 100, status = 'ongoing' WHERE uuid = ?", [uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  let aufrufe = 0, ids = []
  const abfrage = links => async (q, v) => { aufrufe++; ids.push(v.id); return antwortMit(links)() }

  g.aktiv()
  let r = await ladeStreaming(id, abfrage([CR, NF]))
  assert.deepEqual(r.links.map(l => l.site), ['Crunchyroll', 'Netflix'])
  assert.equal(r.offline, false)
  assert.equal(aufrufe, 1)
  assert.deepEqual(ids, [100])

  // zweiter Aufruf: aus dem Cache, keine neue Anfrage
  r = await ladeStreaming(id, abfrage([]))
  assert.equal(aufrufe, 1)
  assert.equal(r.links.length, 2)

  // 8 Tage alt: neu holen
  g.aendere("UPDATE streaming_cache SET geprueft = datetime('now', '-8 days')")
  r = await ladeStreaming(id, abfrage([NF]))
  assert.equal(aufrufe, 2)
  assert.deepEqual(r.links.map(l => l.site), ['Netflix'])

  // 8 Tage alt und kein Netz: Cache, als offline gekennzeichnet
  g.aendere("UPDATE streaming_cache SET geprueft = datetime('now', '-8 days')")
  r = await ladeStreaming(id, async () => { throw new Error('offline') })
  assert.equal(r.offline, true)
  assert.deepEqual(r.links.map(l => l.site), ['Netflix'])

  // Kein Cache und kein Netz: leer + offline
  g.aendere('DELETE FROM streaming_cache')
  r = await ladeStreaming(id, async () => { throw new Error('offline') })
  assert.deepEqual(r, { links: [], geprueft: null, offline: true })

  // Titel ohne Streaming-Links: nichts anzeigen, aber nicht bei jedem Öffnen neu fragen
  r = await ladeStreaming(id, abfrage([]))
  assert.deepEqual(r.links, [])
  const vorher = aufrufe
  await ladeStreaming(id, abfrage([CR]))
  assert.equal(aufrufe, vorher)
})

test('Staffelwechsel: für die aktuelle Staffel abfragen; Manga und unbekannte Einträge ohne Abruf', async () => {
  const { geraet } = await erstelleUmgebung()
  const g = geraet('pc')
  const uuid = g.neuerEintrag('Frieren')
  g.aendere("UPDATE entries SET anilist_id = 1 WHERE uuid = ?", [uuid])
  const id = g.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  g.aendere(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, total_episodes, progress_episodes, item_status)
    VALUES (?, 1, 'MAIN', 0, 12, 12, 'completed'), (?, 2, 'SEQUEL', 1, 12, 4, 'started')`, [id, id])
  const ids = []
  g.aktiv()
  await ladeStreaming(id, async (q, v) => { ids.push(v.id); return antwortMit([CR])() })
  assert.deepEqual(ids, [2])

  const m = g.neuerEintrag('Berserk')
  g.aendere("UPDATE entries SET type = 'MANGA', anilist_id = 5 WHERE uuid = ?", [m])
  const mid = g.eins('SELECT id FROM entries WHERE uuid = ?', [m]).id
  let aufgerufen = false
  const r = await ladeStreaming(mid, async () => { aufgerufen = true; return antwortMit([CR])() })
  assert.equal(aufgerufen, false)
  assert.deepEqual(r.links, [])
  assert.deepEqual(await ladeStreaming(99999, async () => { aufgerufen = true }), { links: [], geprueft: null, offline: false })
})

test('streaming_cache wird nicht synchronisiert und nicht protokolliert', async () => {
  const { geraet } = await erstelleUmgebung()
  const pc = geraet('pc'), handy = geraet('handy')
  const uuid = pc.neuerEintrag('Kusuriya')
  pc.aendere('UPDATE entries SET anilist_id = 100 WHERE uuid = ?', [uuid])
  const id = pc.eins('SELECT id FROM entries WHERE uuid = ?', [uuid]).id
  pc.aktiv()
  await ladeStreaming(id, antwortMit([CR]))
  assert.equal(pc.eins("SELECT COUNT(*) AS n FROM sync_log WHERE tabelle LIKE 'streaming%'").n, 0)
  await pc.abgleichen(); await handy.abgleichen()
  assert.equal(handy.eins('SELECT COUNT(*) AS n FROM streaming_cache').n, 0)
})
