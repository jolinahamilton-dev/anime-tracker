// Begrüßung beim ersten Start und Erinnerung an die Sicherung. Die Oberfläche entscheidet anhand
// dieser Angaben (plus Abgleich-Status), was sie zeigt; gemerkt wird es lokal in app_meta.
import type { IpcMain } from 'electron'
import { dbGet, dbRun } from '../../db/database'

const MERKBAR: Record<string, string> = { willkommen: 'willkommen_gesehen', erinnert: 'sicherung_erinnert' }

const meta = (key: string) => (dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value as string) ?? null

export interface StartInfo {
  willkommenGesehen: boolean
  eintraege: number
  ersterStart: string | null
  letzteSicherung: string | null
  erinnertAm: string | null
}

export function registerBegruessungHandlers(ipcMain: IpcMain) {
  ipcMain.handle('start:info', (): StartInfo => ({
    willkommenGesehen: meta('willkommen_gesehen') !== null,
    eintraege: (dbGet('SELECT COUNT(*) AS n FROM entries')?.n as number) ?? 0,
    ersterStart: meta('first_open'),
    letzteSicherung: meta('last_backup'),
    erinnertAm: meta('sicherung_erinnert'),
  }))

  ipcMain.handle('start:merke', (_, was: string) => {
    const key = MERKBAR[was]
    if (!key) return { success: false }
    dbRun('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, new Date().toISOString()])
    return { success: true }
  })
}
