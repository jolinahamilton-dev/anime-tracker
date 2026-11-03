import { AniListSearchResult } from '../types'

// Zustand der Einpflegen-Seite, der das Öffnen der Vorschau (und einen
// Seitenwechsel) überdauern soll – wie `sitzung` in listenZustand.ts nur im
// Speicher, gilt also, solange die App offen ist.

export type MediaFilter = 'ANIME' | 'MANGA' | 'ALLE'

export const einpflegenSitzung = {
  tab: 'suche' as 'suche' | 'manuell',
  suchbegriff: '',
  filter: 'ALLE' as MediaFilter,
  ergebnisse: [] as AniListSearchResult[],
  scrollPosition: 0,
}

// Nach erfolgreichem Hinzufügen geht es zur Liste – die Suche ist damit erledigt,
// beim nächsten Einpflegen startet man wieder mit einem leeren Suchfeld
export function sucheZuruecksetzen() {
  einpflegenSitzung.suchbegriff = ''
  einpflegenSitzung.ergebnisse = []
  einpflegenSitzung.scrollPosition = 0
}
