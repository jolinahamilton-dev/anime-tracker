import { app, BrowserWindow, IpcMain, nativeImage, shell } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

// Gleiche Namen wie src/renderer/logos.ts – nur bekannte Namen werden zu Dateipfaden
const LOGO_IDS = ['buecherhuegel', 'original', 'himmelswal', 'buecherkatze', 'igel', 'manta', 'frosch', 'sommerhuegel', 'sternennacht']
const STANDARD_LOGO = 'buecherhuegel'

const gueltig = (id: unknown): id is string => typeof id === 'string' && LOGO_IDS.includes(id)
const logoPng = (id: string) => path.join(__dirname, '../../renderer/logos', `${id}.png`)

/** Fenstersymbol zum gewählten Logo; undefined = Symbol der .exe */
export function logoIcon(id: unknown) {
  if (!gueltig(id) || !fs.existsSync(logoPng(id))) return undefined
  return nativeImage.createFromPath(logoPng(id))
}

// .ico mit einem einzigen PNG-Eintrag (256 px, von Windows seit Vista unterstützt)
function icoAusPng(png: Buffer) {
  const kopf = Buffer.alloc(22)
  kopf.writeUInt16LE(1, 2) // Typ: Symbol
  kopf.writeUInt16LE(1, 4) // ein Eintrag
  kopf.writeUInt16LE(1, 10) // Farbebenen
  kopf.writeUInt16LE(32, 12) // Bit pro Pixel
  kopf.writeUInt32LE(png.length, 14)
  kopf.writeUInt32LE(22, 18) // Bilddaten direkt hinter dem Kopf
  return Buffer.concat([kopf, png])
}

/** Symboldatei für Verknüpfungen; undefined = Symbol der .exe (Standardlogo) */
function logoIco(id: string) {
  if (id === STANDARD_LOGO || !fs.existsSync(logoPng(id))) return undefined
  const ziel = path.join(app.getPath('userData'), 'logos', `${id}.ico`)
  // Neu erzeugen, wenn ein App-Update das Logo geändert hat (PNG jünger als die .ico)
  if (!fs.existsSync(ziel) || fs.statSync(logoPng(id)).mtimeMs > fs.statSync(ziel).mtimeMs) {
    fs.mkdirSync(path.dirname(ziel), { recursive: true })
    fs.writeFileSync(ziel, icoAusPng(fs.readFileSync(logoPng(id))))
  }
  return ziel
}

function verknuepfungen(ordner: string, tiefe = 3): string[] {
  let eintraege: fs.Dirent[]
  try { eintraege = fs.readdirSync(ordner, { withFileTypes: true }) } catch { return [] }
  return eintraege.flatMap(e => {
    const voll = path.join(ordner, e.name)
    if (e.isDirectory()) return tiefe > 0 ? verknuepfungen(voll, tiefe - 1) : []
    return /anime/i.test(e.name) && e.name.toLowerCase().endsWith('.lnk') ? [voll] : []
  })
}

/**
 * Windows zeigt in Taskleiste und Startmenü das Symbol der Verknüpfung (von Scoop bzw. vom
 * Installer angelegt), nicht das des Fensters – deshalb zeigen die eigenen Verknüpfungen auf das
 * gewählte Logo. Läuft bei jedem Start erneut, weil Scoop die Verknüpfung bei Updates neu anlegt.
 * Exportiert mit Ordnerliste, damit es sich ohne echte Verknüpfungen testen lässt.
 */
export function passeVerknuepfungenAn(id: unknown, orte = verknuepfungsOrte(), exe = process.execPath) {
  const logo = gueltig(id) ? id : STANDARD_LOGO
  const ico = logoIco(logo)
  let geaendert = 0
  for (const lnk of orte.flatMap(o => verknuepfungen(o))) {
    try {
      const v = shell.readShortcutLink(lnk)
      if (path.basename(v.target).toLowerCase() !== path.basename(exe).toLowerCase()) continue
      const icon = ico ?? v.target
      if (v.icon?.toLowerCase() === icon.toLowerCase()) continue
      if (shell.writeShortcutLink(lnk, 'update', { ...v, icon, iconIndex: 0 })) geaendert++
    } catch { /* fremde oder kaputte Verknüpfung – überspringen */ }
  }
  return geaendert
}

function verknuepfungsOrte() {
  const roaming = app.getPath('appData')
  return [
    path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    app.getPath('desktop'),
  ]
}

/** Nur in der installierten Windows-App; danach den Symbol-Zwischenspeicher von Windows auffrischen */
export function aktualisiereVerknuepfungen(id: unknown) {
  if (process.platform !== 'win32' || !app.isPackaged) return
  if (passeVerknuepfungenAn(id) > 0) {
    try { spawn('ie4uinit.exe', ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).unref() } catch { /* nicht schlimm */ }
  }
}

export function registerLogoHandlers(ipcMain: IpcMain) {
  ipcMain.handle('fenster:logo', (_, id: unknown) => {
    if (!gueltig(id)) return
    const bild = logoIcon(id)
    if (bild) for (const w of BrowserWindow.getAllWindows()) w.setIcon(bild)
    aktualisiereVerknuepfungen(id)
  })
}
