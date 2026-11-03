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
  // ── Nur gelesen (entries:getAll/get berechnen sie, keine DB-Spalten) ──
  // Aktuelle Staffel der Hauptlinie (Prequel/Haupt/Sequels) – dieselbe, die „+1" zählt;
  // nur gesetzt, wenn die Hauptlinie mehr als eine Staffel hat
  staffel_titel?: string | null
  staffel_nr?: number // 1-basiert
  staffel_anzahl?: number // ohne nur angekündigte Staffeln
  staffel_gesehen?: number
  staffel_total?: number | null
  // Nächste Ausstrahlung (aus dem News-Cache, nur für abonnierte Anime)
  naechste_folge?: number
  naechste_folge_um?: number // Unix-Sekunden
  naechste_folge_staffel?: string | null // Staffeltitel, falls die Serie mehrere Staffeln hat
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

/** Einmaliges Achievement (Erster Schritt, Meisterwerk …) */
export interface Achievement {
  id: string
  name: string
  beschreibung: string
  icon: string
  unlocked_at: string | null
}

/** Eine Stufe eines Achievement-Tracks (Bronze … Diamant), eigene Zeile in der Tabelle achievements */
export interface AchievementStufe {
  id: string // z. B. 'folgen_2'
  nr: number // 1 = Bronze … 5 = Diamant
  name: string // 'Bronze', 'Silber', …
  schwelle: number
  beschreibung: string // z. B. '500 Folgen geschaut'
  unlocked_at: string | null
}

/** Achievement-Track mit aufbauenden Stufen und aktuellem Fortschritt */
export interface AchievementTrackInfo {
  id: string
  name: string
  icon: string
  einheit: string
  wert: number
  zusatz: string | null
  erreicht: number // höchste freigeschaltete Stufe, 0 = noch keine
  naechste: { nr: number; name: string; schwelle: number } | null
  stufen: AchievementStufe[]
}

/** Antwort von api.getAchievements() */
export interface AchievementUebersicht {
  tracks: AchievementTrackInfo[]
  einzeln: Achievement[]
  freigeschaltet: number
  gesamt: number
}

/** Ereignis 'achievements:neu' (Toast) */
export interface NeuesAchievement {
  id: string
  name: string
  icon: string
  beschreibung: string
  stufe?: number
  stufenName?: string
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

// ── Vorschläge („✨ Für dich“ auf der Einpflegen-Seite) ──
// media hat dieselbe Form wie ein Suchergebnis, damit „+ Geplant“ und die Vorschau wie bei der Suche funktionieren
export interface Vorschlag {
  media: AniListSearchResult
  quelle: 'empfehlung' | 'adaption' | 'saison'
  /** Warum der Titel vorgeschlagen wird, z. B. „Weil du Death Note (5★) und Psycho-Pass (5★) mochtest“ */
  grund: string
  /** Sortiergewicht (höher = besser) */
  gewicht: number
  /** AniList-Durchschnitt 0–100, falls bekannt */
  score: number | null
  /** Saison/Jahr für die Anzeige, z. B. „Herbst 2026“ */
  zeitraum: string | null
}

/** Titel aus der eigenen Geplant-Liste mit Einschätzung, wie gut er passt */
export interface GeplantVorschlag {
  entry_id: number
  title: string
  cover_url: string | null
  type: MediaType
  folgen: number | null
  kapitel: number | null
  genres: string[]
  /** 0–100: Übereinstimmung mit den eigenen Bewertungen (Genres) */
  passt: number
  grund: string
}

export interface VorschlagAntwort {
  empfehlungen: Vorschlag[]
  adaptionen: Vorschlag[]
  saison: Vorschlag[]
  geplant: GeplantVorschlag[]
  /** ISO-Zeit der Berechnung (zwischengespeichert, höchstens einmal am Tag neu) */
  stand: string | null
  /** Fehlermeldung, wenn AniList nicht erreichbar war (dann ggf. alter Stand) */
  fehler?: string
}
