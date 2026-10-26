import { IpcMain, BrowserWindow } from 'electron'
import { dbGet, dbRun } from '../../db/database'
import { pruefeAchievements } from './achievements'

export function registerMetaHandlers(ipcMain: IpcMain) {
  ipcMain.handle('meta:get', (_, key: string) => {
    const row = dbGet('SELECT value FROM app_meta WHERE key = ?', [key])
    return (row?.value as string) ?? null
  })

  ipcMain.handle('meta:set', (event, key: string, value: string) => {
    dbRun('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, value])
    // Einstellungs-Achievements (Dunkelmodus, Akzentfarbe) sofort prüfen, nicht erst beim nächsten Eintrag
    pruefeAchievements(BrowserWindow.fromWebContents(event.sender))
    return { success: true }
  })
}
