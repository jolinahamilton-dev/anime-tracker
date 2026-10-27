import { BrowserWindow, IpcMain, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'

// Gleiche Namen wie src/renderer/logos.ts – nur bekannte Namen werden zu Dateipfaden
const LOGO_IDS = ['buecherhuegel', 'himmelswal', 'buecherkatze', 'igel', 'manta', 'frosch', 'sommerhuegel', 'sternennacht']

/** Fenster-/Taskleistensymbol zum gewählten Logo; undefined = Symbol der .exe */
export function logoIcon(id: unknown) {
  if (typeof id !== 'string' || !LOGO_IDS.includes(id)) return undefined
  const datei = path.join(__dirname, '../../renderer/logos', `${id}.png`)
  return fs.existsSync(datei) ? nativeImage.createFromPath(datei) : undefined
}

export function registerLogoHandlers(ipcMain: IpcMain) {
  ipcMain.handle('fenster:logo', (_, id: unknown) => {
    const bild = logoIcon(id)
    if (bild) for (const w of BrowserWindow.getAllWindows()) w.setIcon(bild)
  })
}
