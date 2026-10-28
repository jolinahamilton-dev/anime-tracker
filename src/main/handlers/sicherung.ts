import { IpcMain, dialog, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  sicherungAlsDatei, leseSicherung, merkeSicherung, Sicherung, VorherAblage, spieleMitKopieEin, vorherInfo, holeVorherZurueck,
} from './sicherung-kern'

// Gewählte, geprüfte Sicherung bis zur Bestätigung in der Oberfläche
let ausgewaehlt: Sicherung | null = null

// Stand vor der letzten Wiederherstellung – neben der Datenbank im Benutzerordner
const vorherDatei = () => path.join(app.getPath('userData'), 'vor-wiederherstellung.json')
const ablage: VorherAblage = {
  async lies() { try { return fs.readFileSync(vorherDatei(), 'utf8') } catch { return null } },
  async schreib(text) {
    // Erst vollständig schreiben, dann umbenennen – ein Absturz trifft nie die alte Kopie
    fs.writeFileSync(vorherDatei() + '.tmp', text)
    fs.renameSync(vorherDatei() + '.tmp', vorherDatei())
  },
}

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
    const info = await spieleMitKopieEin(ausgewaehlt, ablage)
    ausgewaehlt = null
    return { info }
  })

  ipcMain.handle('sicherung:vorher', () => vorherInfo(ablage))
  ipcMain.handle('sicherung:zurueckholen', () => holeVorherZurueck(ablage))
}
