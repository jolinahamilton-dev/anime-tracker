import { IpcMain } from 'electron'
import { dbAll, dbRun, getDb, schedulePersist } from '../../db/database'
import { anilistAbfrage } from './anilist'
import { pruefeAutoBeendet } from './serien'

const RELATIONS_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    id
    type
    title { romaji }
    coverImage { large }
    episodes
    relations {
      edges {
        relationType
        node { id type title { romaji } coverImage { large } episodes }
      }
    }
  }
}
`

// Reihenfolge in der Watch-Order: Prequels vor der Hauptstaffel, danach Sequels usw.
const REIHENFOLGE: Record<string, number> = { PREQUEL: 0, MAIN: 1, SEQUEL: 2, PARENT: 3, SIDE_STORY: 4, SPIN_OFF: 5, ALTERNATIVE: 6, SUMMARY: 7, CHARACTER: 8, OTHER: 9 }

// Liefert die Einstiegsserie selbst (relation_type MAIN) + alle Relationen DESSELBEN
// Medientyps (Anime-Reihen sollen keine Manga-Spinoffs enthalten und umgekehrt).
// Wirft bei Netzwerk-/AniList-Fehlern, damit der Aufrufer nichts Leeres speichert.
async function fetchRelations(anilistId: number): Promise<unknown[]> {
  const res = await anilistAbfrage(RELATIONS_QUERY, { id: anilistId })
  const media = res?.data?.Media
  if (!media) return []
  const eigenerTyp = media.type
  const edges = media.relations?.edges ?? []

  const selbst = {
    related_anilist_id: media.id,
    relation_type: 'MAIN',
    title: media.title?.romaji ?? null,
    cover_url: media.coverImage?.large ?? null,
    total_episodes: media.episodes ?? null,
  }

  const verwandte = edges
    .filter((e: any) => e?.node?.id != null && e.node.type === eigenerTyp && e.node.id !== media.id)
    .map((e: any) => ({
      related_anilist_id: e.node.id,
      relation_type: e.relationType,
      title: e.node.title?.romaji ?? null,
      cover_url: e.node.coverImage?.large ?? null,
      total_episodes: e.node.episodes ?? null,
    }))

  return [selbst, ...verwandte]
    .sort((a, b) => (REIHENFOLGE[a.relation_type] ?? 99) - (REIHENFOLGE[b.relation_type] ?? 99))
    .map((item, i) => ({ ...item, position: i, is_custom: 0, progress_episodes: 0, item_status: 'planned' }))
}

export interface WoSpeicherZeile {
  related_anilist_id: number
  relation_type: string
  is_custom?: number | null
  title: string | null
  cover_url: string | null
  total_episodes: number | null
  progress_episodes: number
  item_status: string
  aired_episodes: number | null
  media_status: string | null
  neu_seit: string | null
}

/**
 * Schreibt die komplette Watch-Order eines Eintrags (Position = Reihenfolge im Array).
 * Nur geänderte Zeilen werden angefasst (UPSERT statt „alles löschen, neu einfügen"),
 * damit das Änderungsprotokoll für den Handy-Abgleich nur echte Änderungen enthält.
 * Läuft in der Transaktion des Aufrufers.
 */
export function schreibeWatchOrder(entryId: number, zeilen: WoSpeicherZeile[]) {
  const db_ = getDb()
  const ids = zeilen.map(z => z.related_anilist_id)
  // (NOT IN (NULL) träfe nie zu – bei leerer Liste daher alles löschen)
  if (ids.length === 0) db_.run('DELETE FROM watch_order WHERE entry_id = ?', [entryId])
  else db_.run(`DELETE FROM watch_order WHERE entry_id = ? AND related_anilist_id NOT IN (${ids.map(() => '?').join(',')})`,
    [entryId, ...ids])
  zeilen.forEach((z, position) => db_.run(
    `INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position, is_custom, title, cover_url,
       total_episodes, progress_episodes, item_status, aired_episodes, media_status, neu_seit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (entry_id, related_anilist_id) DO UPDATE SET
       relation_type = excluded.relation_type, position = excluded.position, is_custom = excluded.is_custom,
       title = excluded.title, cover_url = excluded.cover_url, total_episodes = excluded.total_episodes,
       progress_episodes = excluded.progress_episodes, item_status = excluded.item_status,
       aired_episodes = excluded.aired_episodes, media_status = excluded.media_status, neu_seit = excluded.neu_seit`,
    [entryId, z.related_anilist_id, z.relation_type, position, z.is_custom ?? 0, z.title ?? null, z.cover_url ?? null,
     z.total_episodes ?? null, z.progress_episodes ?? 0, z.item_status ?? 'planned',
     z.aired_episodes ?? null, z.media_status ?? null, z.neu_seit ?? null]
  ))
}

export function registerWatchOrderHandlers(ipcMain: IpcMain) {
  ipcMain.handle('watchorder:get', (_, entryId: number) => {
    return dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId])
  })

  ipcMain.handle('watchorder:getRelations', async (_, anilistId: number) => {
    return fetchRelations(anilistId)
  })

  ipcMain.handle('watchorder:save', (_, entryId: number, items: any[]) => {
    const db_ = getDb()
    // Was der Serien-Abgleich pflegt (Folgenzahlen, AniList-Status, NEU-Markierung), kommt aus
    // der DB – eine länger offene Detailseite hätte sonst einen veralteten Stand zurückgeschrieben
    const inDb = new Map((dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId]) as any[])
      .map(z => [z.related_anilist_id, z]))
    const ids = new Set(items.map(i => i.related_anilist_id))
    // Vom Abgleich ergänzte Staffeln, die die Seite noch nicht kennt, nicht wegwerfen
    const alle = [...items, ...[...inDb.values()].filter(z => !ids.has(z.related_anilist_id))]

    db_.run('BEGIN TRANSACTION')
    try {
      schreibeWatchOrder(entryId, alle.map(item => {
        const db = inDb.get(item.related_anilist_id)
        const total = db?.total_episodes ?? item.total_episodes ?? null
        // Seite kennt die neue Folgenzahl noch nicht → „fertig" bezog sich auf die alte Zahl
        let status = item.item_status === 'completed' && item.total_episodes != null && total != null && total > item.total_episodes
          ? 'started' : (item.item_status ?? 'planned')
        // Alle Folgen gesehen (z. B. 25/25) → fertig, auch wenn der Status nicht von Hand gesetzt wurde
        if (total && (item.progress_episodes ?? 0) >= total) status = 'completed'
        const progress = status === 'completed' && total ? total : (item.progress_episodes ?? 0)
        return {
          ...item, total_episodes: total, progress_episodes: progress, item_status: status,
          aired_episodes: db ? db.aired_episodes : (item.aired_episodes ?? null),
          media_status: db ? db.media_status : (item.media_status ?? null),
          neu_seit: db ? db.neu_seit : (item.neu_seit ?? null),
        }
      }))
      db_.run('COMMIT')
      schedulePersist()
    } catch (e) {
      db_.run('ROLLBACK')
      throw e
    }
    // Automatisch auf „Ongoing" gesetzt und jetzt alles geschaut? → zurück auf „Beendet"
    const zurueck = pruefeAutoBeendet(entryId)
    // Gespeicherten Stand zurückgeben – die Seite übernimmt ihn (inkl. vom Abgleich ergänzter Daten)
    return {
      success: true,
      status: zurueck.length ? 'completed' : null,
      items: dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId]),
    }
  })

  ipcMain.handle('watchorder:delete', (_, entryId: number) => {
    dbRun('DELETE FROM watch_order WHERE entry_id = ?', [entryId])
    return { success: true }
  })
}
