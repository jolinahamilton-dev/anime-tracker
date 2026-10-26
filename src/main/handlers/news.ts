import { IpcMain } from 'electron'
import { dbAll, dbGet, dbRun } from '../../db/database'
import { anilistAbfrage } from './anilist'

const ZWEI_MONATE_SEKUNDEN = 60 * 24 * 3600 * 2
const ZWEI_WOCHEN_SEKUNDEN = 14 * 24 * 3600
const MAX_SEITEN = 10

// Zeitfenster: 2 Monate zurück bis 2 Wochen voraus. Ohne obere Grenze füllten
// weit in der Zukunft geplante Folgen die Seite, aktuelle fielen heraus.
const AIRING_QUERY = `
query ($ids: [Int], $page: Int, $seit: Int, $bis: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(mediaId_in: $ids, airingAt_greater: $seit, airingAt_lesser: $bis, sort: TIME_DESC) {
      mediaId
      episode
      airingAt
    }
  }
}
`

type Ausstrahlung = { mediaId: number, episode: number, airingAt: number }

// AniList-IDs aller abonnierten Anime samt ihrer Staffeln – News anderer Anime werden
// ausgeblendet (z. B. ältere Einträge von inzwischen abbestellten Anime)
const ABO_IDS = `
  SELECT anilist_id FROM entries WHERE abonniert = 1 AND anilist_id IS NOT NULL
  UNION
  SELECT w.related_anilist_id FROM watch_order w JOIN entries e ON e.id = w.entry_id WHERE e.abonniert = 1`

async function fetchAiringSchedule(anilistIds: number[], seit: number, bis: number) {
  const alle: Ausstrahlung[] = []
  for (let page = 1; page <= MAX_SEITEN; page++) {
    const res = await anilistAbfrage(AIRING_QUERY, { ids: anilistIds, page, seit, bis }, true)
    alle.push(...(res?.data?.Page?.airingSchedules ?? []))
    if (!res?.data?.Page?.pageInfo?.hasNextPage) break
  }
  return alle
}

function bereinigeAlteNews() {
  const grenze = Math.floor(Date.now() / 1000) - ZWEI_MONATE_SEKUNDEN
  dbRun('DELETE FROM news_cache WHERE airing_at < ?', [grenze])
}

export async function aktualisiereNews() {
  bereinigeAlteNews()

  // Abonnierte Haupteinträge UND ihre noch laufenden/angekündigten Staffeln
  // (neue Staffeln haben eigene AniList-IDs)
  const rows = dbAll(`
    SELECT anilist_id AS id FROM entries
      WHERE type = 'ANIME' AND anilist_id IS NOT NULL AND abonniert = 1
    UNION
    SELECT w.related_anilist_id FROM watch_order w JOIN entries e ON e.id = w.entry_id
      WHERE e.type = 'ANIME' AND e.abonniert = 1
        AND (w.media_status IS NULL OR w.media_status IN ('RELEASING', 'NOT_YET_RELEASED'))`)
  if (rows.length === 0) return

  const ids = rows.map(r => r.id as number)
  const jetzt = Math.floor(Date.now() / 1000)
  const schedules = await fetchAiringSchedule(ids, jetzt - ZWEI_MONATE_SEKUNDEN, jetzt + ZWEI_WOCHEN_SEKUNDEN)

  for (const s of schedules) {
    dbRun('INSERT OR IGNORE INTO news_cache (anilist_id, episode, airing_at, seen) VALUES (?, ?, ?, 0)',
      [s.mediaId, s.episode, s.airingAt])
  }
}

export function registerNewsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('news:getAll', () => {
    bereinigeAlteNews()
    const grenze = Math.floor(Date.now() / 1000) - ZWEI_MONATE_SEKUNDEN
    return dbAll(`
      SELECT n.*,
        COALESCE(e.title, (SELECT w.title FROM watch_order w WHERE w.related_anilist_id = n.anilist_id LIMIT 1)) AS title,
        COALESCE(e.cover_url, (SELECT w.cover_url FROM watch_order w WHERE w.related_anilist_id = n.anilist_id LIMIT 1)) AS cover_url,
        COALESCE(e.id, (SELECT w.entry_id FROM watch_order w WHERE w.related_anilist_id = n.anilist_id LIMIT 1)) AS entry_id
      FROM news_cache n
      LEFT JOIN entries e ON e.anilist_id = n.anilist_id
      WHERE n.airing_at >= ? AND n.anilist_id IN (${ABO_IDS})
      ORDER BY n.airing_at DESC
      LIMIT 100
    `, [grenze])
  })

  ipcMain.handle('news:getUnseenCount', () => {
    const now = Math.floor(Date.now() / 1000)
    const row = dbGet(`SELECT COUNT(*) as count FROM news_cache WHERE seen = 0 AND airing_at <= ? AND anilist_id IN (${ABO_IDS})`, [now])
    return (row?.count as number) ?? 0
  })

  ipcMain.handle('news:markAllSeen', () => {
    // Nur bereits ausgestrahlte Folgen – künftige sollen später als „neu" zählen
    dbRun('UPDATE news_cache SET seen = 1 WHERE seen = 0 AND airing_at <= ?', [Math.floor(Date.now() / 1000)])
    return { success: true }
  })

  ipcMain.handle('news:refresh', async () => {
    await aktualisiereNews()
    return { success: true }
  })
}
