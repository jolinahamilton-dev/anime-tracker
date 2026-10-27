// Einzige Stelle, an der die Oberfläche auf Daten zugreift.
// Am PC reicht sie die Electron-Brücke (preload.ts → Main-Prozess) durch. Eine Handy-Version
// liefert hier eine eigene Umsetzung derselben Schnittstelle (z. B. Datenbank im Browser) –
// alle Seiten und Komponenten bleiben dabei unverändert.
import type { Entry, EntryStatus } from '../types'

export interface CustomListMitEintraegen {
  id: number
  name: string
  created_at: string
  entries?: Array<{ entry_id: number }>
}

export interface FortschrittErgebnis {
  entry: Entry
  keinZiel?: boolean
  beschreibung?: string
  rueckgaengig?: string
  fertigVorschlag?: boolean
}

export interface WeiterschauenEintrag {
  entry_id: number
  title: string
  cover_url: string | null
  staffel: string | null
  gesehen: number
  verfuegbar: number
  total: number | null
  laeuft: boolean
}

export interface SyncStatus {
  verbunden: boolean
  passwortGesetzt: boolean
  laeuft: boolean
  letzterAbgleich: string | null
  fehler: string | null
  konto: string | null
}

export interface StartInfo {
  willkommenGesehen: boolean
  eintraege: number
  ersterStart: string | null
  letzteSicherung: string | null
  erinnertAm: string | null
}

type Abmelden = () => void

export interface TrackerApi {
  // Einträge
  getEntries(): Promise<Entry[]>
  getEntry(id: number): Promise<Entry>
  createEntry(data: Partial<Entry>): Promise<Entry & { schonVorhanden?: boolean }>
  updateEntry(id: number, data: Partial<Entry>): Promise<Entry>
  deleteEntry(id: number): Promise<{ success: boolean; rueckgaengig: string | null }>
  setAbo(id: number, abonniert: boolean): Promise<Entry>
  aendereFortschritt(id: number, delta: 1 | -1): Promise<FortschrittErgebnis | null>
  getWeiterschauen(): Promise<WeiterschauenEintrag[]>
  rueckgaengig(token: string): Promise<{ success: boolean }>

  // Eigene Listen
  getLists(): Promise<CustomListMitEintraegen[]>
  createList(name: string): Promise<CustomListMitEintraegen>
  renameList(id: number, name: string): Promise<{ success: boolean }>
  deleteList(id: number): Promise<{ success: boolean }>
  addToList(listId: number, entryId: number): Promise<{ success: boolean }>
  removeFromList(listId: number, entryId: number): Promise<{ success: boolean }>

  // News und Serien-Abgleich
  getNews(): Promise<any[]>
  getNewsUnseenCount(): Promise<number>
  markAllNewsSeen(): Promise<{ success: boolean }>
  refreshNews(): Promise<{ success: boolean }>
  syncSerien(): Promise<unknown>
  getNeueStaffeln(): Promise<any[]>
  onSerienAktualisiert(cb: (daten: any) => void): Abmelden

  // Einstellungen, Statistik, Achievements
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<unknown>
  /** Nur PC: Fenster-/Taskleistensymbol auf das gewählte Logo setzen */
  fensterLogo?(id: string): Promise<unknown>
  getStats(): Promise<any>
  getAchievements(): Promise<any[]>
  pruefeAchievements(): Promise<unknown>
  onAchievementNeu(cb: (namen: string[]) => void): Abmelden

  // AniList
  searchAniList(query: string, type: string): Promise<any>
  abgleichAniList(): Promise<any>
  onAbgleichFortschritt(cb: (p: { aktuell: number; gesamt: number; titel: string }) => void): Abmelden

  // Watch-Order
  getWatchOrder(entryId: number): Promise<any[]>
  getAniListRelations(anilistId: number): Promise<any[]>
  saveWatchOrder(entryId: number, items: unknown[]): Promise<{ success: boolean; status: EntryStatus | null; items: any[] }>
  deleteWatchOrder(entryId: number): Promise<{ success: boolean }>

  // Abgleich PC ↔ Handy über Google Drive
  syncStatus(): Promise<SyncStatus>
  syncVerbinden(): Promise<SyncStatus>
  syncPasswort(passwort: string): Promise<{ ok: boolean; neu?: boolean; fehler?: string }>
  syncJetzt(): Promise<SyncStatus>
  syncTrennen(): Promise<SyncStatus>
  /** Nach dem Verbinden: Konto und ob dort schon eine Sicherung liegt; null bei Fehler */
  syncKonto(): Promise<{ konto: string | null; hatSicherung: boolean } | null>

  // Begrüßung beim ersten Start, Erinnerung an die Sicherung
  startInfo(): Promise<StartInfo>
  startMerke(was: 'willkommen' | 'erinnert'): Promise<{ success: boolean }>
  /** Nur Handy: schützt der Browser den Speicher vor automatischem Löschen? (null = unbekannt) */
  speicherDauerhaft?(): Promise<boolean | null>

  // Dateien (PC: Windows-Dialoge, Handy: Dateiauswahl bzw. Download)
  exportStarten(opts: unknown): Promise<any>
  importCsv(): Promise<any>

  // Komplette Sicherung: wählen prüft die Datei, einspielen ersetzt danach den Stand
  sicherungErstellen(): Promise<{ success: boolean; pfad?: string }>
  sicherungWaehlen(): Promise<{ abgebrochen?: boolean; fehler?: string; info?: SicherungInfo }>
  sicherungEinspielen(): Promise<{ fehler?: string; info?: SicherungInfo }>
}

export interface SicherungInfo {
  erstellt: string
  eintraege: number
  listen: number
  achievements: number
}

export const api: TrackerApi = (window as any).api

/** Was die aktuelle Plattform kann */
export const kann = {
  dateien: typeof (window as any).api?.importCsv === 'function',
}
/** Läuft gerade die Handy-Version (Web-App) statt der PC-App? */
export const istHandyApp = (window as any).api?.istHandy === true
