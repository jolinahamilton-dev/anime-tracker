import { IpcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { sicherungAlsDatei, leseSicherung, spieleSicherungEin, merkeSicherung, Sicherung } from './sicherung-kern'

// Gewählte, geprüfte Sicherung bis zur Bestätigung in der Oberfläche
let ausgewaehlt: Sicherung | null = null

export function registerSicherungHandlers(ipcMain: IpcMain) {
  ipcMain.handle('sicherung:erstellen', async event => {
    const datei = sicherungAlsDatei()
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined as any, {
      title: 'Sicherung speichern',
      defaultPath: datei.name,
      filters: [{ name: 'Sicherung', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { success: false }
    fs.writeFileSync(result.filePath, datei.daten)
    merkeSicherung()
    return { success: true, pfad: result.filePath }
  })

  ipcMain.handle('sicherung:waehlen', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined as any, {
      title: 'Sicherung wiederherstellen',
      filters: [{ name: 'Sicherung', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { abgebrochen: true }
    try {
      const { sicherung, info } = leseSicherung(fs.readFileSync(result.filePaths[0], 'utf8'))
      ausgewaehlt = sicherung
      return { info }
    } catch (e: any) {
      return { fehler: String(e?.message ?? e) }
    }
  })

  ipcMain.handle('sicherung:einspielen', async () => {
    if (!ausgewaehlt) return { fehler: 'Keine Sicherung ausgewählt.' }
    const info = spieleSicherungEin(ausgewaehlt)
    ausgewaehlt = null
    return { info }
  })
}
