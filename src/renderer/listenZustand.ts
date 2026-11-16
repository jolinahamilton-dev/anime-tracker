import { EntryStatus, MediaType } from '../types'
import { FilterWerte, LaengeFilter, SORT_OPTIONEN, SortOption, SortRichtung, STANDARD_NEUE_FILTER, STANDARD_RICHTUNG } from './listenLogik'

// Zustand der Listenseite, der das Öffnen eines Eintrags überdauern soll.
// Filter + Ansichten liegen dauerhaft im localStorage, Suche/Scrollposition/
// Blätter-Reihenfolge nur im Speicher (gelten, solange die App offen ist).

export type { SortOption, SortRichtung }
export type Ansicht = 'liste' | 'kacheln' | 'gross'

export interface ListenFilter extends FilterWerte {
  filterTyp: MediaType | 'ALLE'
  filterStatus: EntryStatus[] // leer = alle Status
  filterFavorit: boolean
  filterAbo: boolean // nur abonnierte Anime
  filterRegal: boolean // nur Manga mit mindestens einem Band im Regal
  sortierung: SortOption
  sortRichtung: SortRichtung
  aktiveListe: number | null
}

export const STANDARD_FILTER: ListenFilter = {
  filterTyp: 'ALLE',
  filterStatus: [],
  filterFavorit: false,
  filterAbo: false,
  filterRegal: false,
  ...STANDARD_NEUE_FILTER,
  sortierung: 'zuletzt',
  sortRichtung: STANDARD_RICHTUNG.zuletzt,
  aktiveListe: null,
}

const GUELTIGE_STATUS: EntryStatus[] = ['ongoing','completed', 'planned', 'dropped', 'paused']

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
  const roh0 = lese<any>(FILTER_KEY, {})
  const f = { ...STANDARD_FILTER, ...roh0 }
  // Früher war filterStatus ein einzelner Wert ('ALLE' oder ein Status) → in Liste umwandeln
  const roh: unknown[] = Array.isArray(f.filterStatus) ? f.filterStatus
    : typeof f.filterStatus === 'string' && f.filterStatus !== 'ALLE' ? [f.filterStatus] : []
  // „Angefangen" (started) gibt es nicht mehr, es ist jetzt Laufend – ohne Doppelte ersetzen
  const status = roh.map(s => (s === 'started' ? 'ongoing' : s))
    .filter((s, i, alle): s is EntryStatus => GUELTIGE_STATUS.includes(s as EntryStatus) && alle.indexOf(s) === i)
  // Unbekannte Werte (ältere/neuere Version, kaputter Speicher) → Standard
  const sortierung: SortOption = SORT_OPTIONEN.includes(f.sortierung) ? f.sortierung : 'zuletzt'
  const sortRichtung: SortRichtung = roh0.sortRichtung === 'auf' || roh0.sortRichtung === 'ab' ? roh0.sortRichtung : STANDARD_RICHTUNG[sortierung]
  const genres: string[] = Array.isArray(f.filterGenres) ? f.filterGenres.filter((g: unknown) => typeof g === 'string') : []
  const min = Number.isInteger(f.filterMinBewertung) && f.filterMinBewertung >= 1 && f.filterMinBewertung <= 5 ? f.filterMinBewertung : 0
  const laenge: LaengeFilter = f.filterLaenge === 'kurz' || f.filterLaenge === 'lang' ? f.filterLaenge : 'alle'
  return {
    ...f, filterStatus: status, sortierung, sortRichtung, filterGenres: genres, filterMinBewertung: min, filterLaenge: laenge,
    filterOhneBewertung: f.filterOhneBewertung === true, filterSpitzname: f.filterSpitzname === true, filterOhneAnilist: f.filterOhneAnilist === true,
  }
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
