import { AniListSearchResult, VorschlagAntwort } from '../types'

// Zustand der Einpflegen-Seite, der das Öffnen der Vorschau (und einen
// Seitenwechsel) überdauern soll – wie `sitzung` in listenZustand.ts nur im
// Speicher, gilt also, solange die App offen ist.

export type MediaFilter = 'ANIME' | 'MANGA' | 'ALLE'
export type EinpflegenTab = 'suche' | 'manuell' | 'fuerdich'
export type VorschlagBereich = 'empfehlungen' | 'adaptionen' | 'saison' | 'geplant'

export const einpflegenSitzung = {
  tab: 'suche' as EinpflegenTab,
  suchbegriff: '',
  filter: 'ALLE' as MediaFilter,
  ergebnisse: [] as AniListSearchResult[],
  scrollPosition: 0,
}

// „✨ Für dich“: zuletzt geladene Vorschläge (→ nach „← Zurück“ aus Vorschau oder
// Detailseite sofort wieder da, ohne Ladeanzeige), gewählter Bereich, Filter, Scrollposition
export const vorschlagSitzung = {
  antwort: null as VorschlagAntwort | null,
  bereich: null as VorschlagBereich | null,
  scrollPosition: 0,
  geplantTyp: 'ALLE' as MediaFilter,
  geplantKurz: false,
  // Hinzugefügte / ausgeblendete Titel bleiben weg, auch wenn ein älterer Stand nachgeladen wird
  entfernt: new Set<string>(), // `a<anilistId>` bzw. `e<entryId>`
}

// Nach erfolgreichem Hinzufügen geht es zur Liste – die Suche ist damit erledigt,
// beim nächsten Einpflegen startet man wieder mit einem leeren Suchfeld
export function sucheZuruecksetzen() {
  einpflegenSitzung.suchbegriff = ''
  einpflegenSitzung.ergebnisse = []
  einpflegenSitzung.scrollPosition = 0
}
