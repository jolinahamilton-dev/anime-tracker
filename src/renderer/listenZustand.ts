import { EntryStatus, MediaType } from '../types'

// Zustand der Listenseite, der das Öffnen eines Eintrags überdauern soll.
// Filter + Ansichten liegen dauerhaft im localStorage, Suche/Scrollposition/
// Blätter-Reihenfolge nur im Speicher (gelten, solange die App offen ist).

export type SortOption = 'alphabetisch' | 'zuletzt' | 'bewertung'
export type Ansicht = 'liste' | 'kacheln' | 'gross'

export interface ListenFilter {
  filterTyp: MediaType | 'ALLE'
  filterStatus: EntryStatus[] // leer = alle Status
  filterFavorit: boolean
  filterAbo: boolean // nur abonnierte Anime
  sortierung: SortOption
  aktiveListe: number | null
}

export const STANDARD_FILTER: ListenFilter = {
  filterTyp: 'ALLE',
  filterStatus: [],
  filterFavorit: false,
  filterAbo: false,
  sortierung: 'zuletzt',
  aktiveListe: null,
}

const GUELTIGE_STATUS: EntryStatus[] = ['started', 'ongoing', 'completed', 'planned', 'dropped', 'paused']

const FILTER_KEY = 'liste.filter'
const ANSICHTEN_KEY = 'liste.ansichten'

function lese<T>(key: string, fallback: T): T {
  try {
    const roh = localStorage.getItem(key)
    return roh ? { ...fallback, ...JSON.parse(roh) } : fallback
  } catch {
    return fallback
  }
}

function schreibe(key: string, wert: unknown) {
  try { localStorage.setItem(key, JSON.stringify(wert)) } catch { /* ignorieren */ }
}

export function ladeFilter(): ListenFilter {
  const f = lese<any>(FILTER_KEY, STANDARD_FILTER)
  // Früher war filterStatus ein einzelner Wert ('ALLE' oder ein Status) → in Liste umwandeln
  const roh: unknown[] = Array.isArray(f.filterStatus) ? f.filterStatus
    : typeof f.filterStatus === 'string' && f.filterStatus !== 'ALLE' ? [f.filterStatus] : []
  return { ...f, filterStatus: roh.filter((s): s is EntryStatus => GUELTIGE_STATUS.includes(s as EntryStatus)) }
}
export const speichereFilter = (f: ListenFilter) => schreibe(FILTER_KEY, f)

// Ansicht pro Liste: Schlüssel 'alle' oder die ID der eigenen Liste
export type Ansichten = Record<string, Ansicht>
export const ansichtKey = (listeId: number | null) => (listeId === null ? 'alle' : String(listeId))
export const ladeAnsichten = () => lese<Ansichten>(ANSICHTEN_KEY, {})
export const speichereAnsichten = (a: Ansichten) => schreibe(ANSICHTEN_KEY, a)

export const sitzung = {
  suche: '',
  scrollPosition: 0,
  // Reihenfolge der zuletzt angezeigten (gefilterten) Liste – für ‹ › auf der Detailseite
  blaetterIds: null as number[] | null,
}
