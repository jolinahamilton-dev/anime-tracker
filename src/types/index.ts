export type MediaType = 'ANIME' | 'MANGA'
export type EntryStatus = 'ongoing' | 'completed' | 'started' | 'planned' | 'dropped' | 'paused'

export interface Entry {
  id: number
  anilist_id: number | null
  type: MediaType
  title: string
  nickname: string | null
  cover_url: string | null
  genres: string // JSON array
  description: string | null
  total_episodes: number | null
  total_chapters: number | null
  total_volumes: number | null
  progress_episodes: number
  progress_chapters: number
  progress_volumes: number
  status: EntryStatus
  rating: number | null // 1-5
  is_favorite: number // 0 or 1
  abonniert: number // 0 or 1 – nur abonnierte Anime werden auf News/neue Folgen/Staffeln geprüft
  review: string | null
  rewatch_count: number // wie oft erneut geschaut/gelesen (von Hand gezählt)
  finished_at: string | null // wann zuletzt auf „Beendet" gesetzt
  uuid: string // geräteübergreifend eindeutig (für den Handy-Abgleich)
  created_at: string
  updated_at: string
}

export interface CustomList {
  id: number
  name: string
  created_at: string
}

export interface WatchOrderItem {
  entry_id: number
  related_anilist_id: number
  relation_type: string
  position: number
  is_custom: number
}

export interface Achievement {
  id: number
  key: string
  unlocked_at: string
}

export interface NewsItem {
  id: number
  anilist_id: number
  episode: number
  airing_at: number // unix timestamp
  seen: number
}

export interface AniListSearchResult {
  id: number
  title: { romaji: string; native: string | null; english: string | null }
  type: MediaType
  format: string | null
  coverImage: { large: string }
  genres: string[]
  description: string | null
  episodes: number | null
  chapters: number | null
  volumes: number | null
  status: string
  relations: {
    edges: Array<{
      relationType: string
      node: { id: number; title: { romaji: string }; type: string; coverImage: { large: string } }
    }>
  }
}
