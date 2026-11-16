import type { Entry } from '../types'

// Reine Regeln für Sortieren und Filtern der Listenseite (Plan Nr. 10) – ohne React, damit testbar.

export type SortOption = 'alphabetisch' | 'zuletzt' | 'bewertung' | 'hinzugefuegt' | 'fortschritt' | 'naechste' | 'geschaut'
export type SortRichtung = 'auf' | 'ab'
export type LaengeFilter = 'alle' | 'kurz' | 'lang'

export const SORT_OPTIONEN: SortOption[] = ['zuletzt', 'alphabetisch', 'bewertung', 'hinzugefuegt', 'fortschritt', 'naechste', 'geschaut']

/** Richtung, die beim Wählen einer Sortierung zuerst gilt (A–Z, nächster Termin zuerst, sonst neueste/höchste zuerst) */
export const STANDARD_RICHTUNG: Record<SortOption, SortRichtung> = {
  alphabetisch: 'auf', naechste: 'auf', zuletzt: 'ab', bewertung: 'ab', hinzugefuegt: 'ab', fortschritt: 'ab', geschaut: 'ab',
}

export interface FilterWerte {
  filterGenres: string[] // alle gewählten müssen passen
  filterMinBewertung: number // 0 = aus, sonst ab ★
  filterOhneBewertung: boolean
  filterSpitzname: boolean
  filterLaenge: LaengeFilter // nur Anime mit bekannter Folgenzahl (wie in „Für dich“)
  filterOhneAnilist: boolean
}

export const STANDARD_NEUE_FILTER: FilterWerte = {
  filterGenres: [], filterMinBewertung: 0, filterOhneBewertung: false, filterSpitzname: false,
  filterLaenge: 'alle', filterOhneAnilist: false,
}

/** Anzahl aktiver neuer Filter (für die Zahl am Filter-Knopf) */
export function anzahlNeueFilter(f: FilterWerte): number {
  return (f.filterGenres.length > 0 ? 1 : 0) + (f.filterMinBewertung > 0 ? 1 : 0) + (f.filterOhneBewertung ? 1 : 0) +
    (f.filterSpitzname ? 1 : 0) + (f.filterLaenge !== 'alle' ? 1 : 0) + (f.filterOhneAnilist ? 1 : 0)
}

export function genresVon(e: Pick<Entry, 'genres'>): string[] {
  try {
    const g = JSON.parse(e.genres || '[]')
    return Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** Alle vorkommenden Genres, alphabetisch (für die Auswahl) */
export function alleGenres(entries: Array<Pick<Entry, 'genres'>>): string[] {
  const s = new Set<string>()
  for (const e of entries) for (const g of genresVon(e)) s.add(g)
  return [...s].sort((a, b) => a.localeCompare(b, 'de'))
}

export function passtZuNeuenFiltern(e: Entry, f: FilterWerte): boolean {
  if (f.filterGenres.length > 0) {
    const g = genresVon(e)
    if (!f.filterGenres.every(x => g.includes(x))) return false
  }
  // „Ab ★“ und „ohne Bewertung“ schließen sich aus: beide an → Einträge, die eines davon erfüllen
  const ab = f.filterMinBewertung > 0, ohne = f.filterOhneBewertung
  if (ab || ohne) {
    const hatAb = ab && (e.rating ?? 0) >= f.filterMinBewertung
    const hatOhne = ohne && !e.rating
    if (!hatAb && !hatOhne) return false
  }
  if (f.filterSpitzname && !(e.nickname ?? '').trim()) return false
  if (f.filterLaenge !== 'alle') {
    const n = e.total_episodes
    if (e.type !== 'ANIME' || n == null || n <= 0) return false
    if (f.filterLaenge === 'kurz' ? n > 13 : n <= 24) return false
  }
  if (f.filterOhneAnilist && e.anilist_id != null) return false
  return true
}

/** Fortschritt in Prozent (0–100) oder null, wenn die Gesamtzahl unbekannt ist. Beendet zählt immer 100. */
export function fortschrittProzent(e: Entry): number | null {
  if (e.status === 'completed') return 100
  const gesamt = e.type === 'ANIME' ? e.total_episodes : e.total_chapters
  const stand = e.type === 'ANIME' ? e.progress_episodes : e.progress_chapters
  if (!gesamt || gesamt <= 0) return null
  return Math.min(100, Math.max(0, (stand / gesamt) * 100))
}

const zeit = (s: string | null | undefined) => { const t = new Date(s ?? '').getTime(); return Number.isNaN(t) ? null : t }

/** Sortierwert eines Eintrags; null = unbekannt (steht immer am Ende, egal in welche Richtung) */
function wertFuer(e: Entry, s: SortOption): number | null {
  switch (s) {
    case 'zuletzt': return zeit(e.updated_at)
    case 'hinzugefuegt': return zeit(e.created_at)
    case 'bewertung': return e.rating ?? null
    case 'fortschritt': return fortschrittProzent(e)
    case 'naechste': return e.naechste_folge_um ?? null
    // Rückfall auf „Zuletzt bearbeitet“, solange es für den Eintrag keinen Verlauf gibt
    case 'geschaut': return e.zuletzt_geschaut ?? zeit(e.updated_at)
    default: return null
  }
}

export function sortiere(entries: Entry[], s: SortOption, richtung: SortRichtung, titel: (e: Entry) => string): Entry[] {
  const faktor = richtung === 'auf' ? 1 : -1
  const nachTitel = (a: Entry, b: Entry) => titel(a).localeCompare(titel(b), 'de')
  return [...entries].sort((a, b) => {
    if (s === 'alphabetisch') return faktor * nachTitel(a, b)
    const x = wertFuer(a, s), y = wertFuer(b, s)
    if (x === null && y === null) return nachTitel(a, b)
    if (x === null) return 1
    if (y === null) return -1
    return x === y ? nachTitel(a, b) : faktor * (x - y)
  })
}
