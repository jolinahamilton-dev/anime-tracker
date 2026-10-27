import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { initDb, wiederhergestelltAusBackup } from '../db/database'
import { registerEntryHandlers } from './handlers/entries'
import { registerListHandlers } from './handlers/lists'
import { registerAchievementHandlers } from './handlers/achievements'
import { registerNewsHandlers } from './handlers/news'
import { registerMetaHandlers } from './handlers/meta'
import { registerAniListHandlers } from './handlers/anilist'
import { registerWatchOrderHandlers } from './handlers/watchorder'
import { aktualisiereNews } from './handlers/news'
import { trackAppOpen } from './trackAppOpen'
import { persistDb, dbGet } from '../db/database'
import { registerStatsHandlers, ergaenzeFolgenlaengen } from './handlers/stats'
import { registerExportHandlers } from './handlers/export'
import { registerImportHandlers } from './handlers/import'
import { registerSicherungHandlers } from './handlers/sicherung'
import { registerBegruessungHandlers } from './handlers/begruessung'
import { registerSerienHandlers, aktualisiereSerien } from './handlers/serien'
import { erstelleSyncDienst } from '../sync/dienst'
import { pcPlattform } from './sync-pc'

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  // Hintergrund passend zum gespeicherten Design – sonst blitzt beim Start kurz Dunkel auf
  const hell = dbGet("SELECT value FROM app_meta WHERE key = 'darkMode'")?.value === 'false'
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: hell ? '#f5f5f8' : '#0f0f13',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'default',
    title: 'Anime & Manga Tracker',
  })

  // Das Fenster darf die App nie verlassen (z. B. wenn eine Datei hineingezogen wird) –
  // fremde Seiten bekämen sonst ebenfalls Zugriff auf window.api
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Neue Fenster nie in der App; nur die eigene Datenschutzseite darf im System-Browser aufgehen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://jolinahamilton-dev.github.io/anime-tracker/datenschutz.html') shell.openExternal(url)
    return { action: 'deny' }
  })
  // Kamera, Mikrofon, Standort usw. braucht die App nie
  win.webContents.session.setPermissionRequestHandler((_wc, _recht, antwort) => antwort(false))

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }
  return win
}

app.whenReady().then(async () => {
  try {
    await initDb()
  } catch (e: any) {
    dialog.showErrorBox(
      'Datenbank konnte nicht geladen werden',
      `Die Datenbank ist beschädigt und es gibt keine Sicherung.\n\n${e?.message ?? e}\n\nOrdner: ${app.getPath('userData')}`
    )
    app.quit()
    return
  }
  if (wiederhergestelltAusBackup) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Datenbank wiederhergestellt',
      message: 'Die Datenbank war beschädigt. Die neueste funktionierende Sicherung (von einem früheren App-Start) wurde geladen.',
      detail: 'Änderungen seit dem letzten Start können fehlen. Die beschädigte Datei liegt als „anime-tracker.db.defekt" im Datenordner.',
    })
  }

  registerEntryHandlers(ipcMain)
  registerListHandlers(ipcMain)
  registerAchievementHandlers(ipcMain)
  registerNewsHandlers(ipcMain)
  registerMetaHandlers(ipcMain)
  registerAniListHandlers(ipcMain)
  registerWatchOrderHandlers(ipcMain)
  registerStatsHandlers(ipcMain)
  registerExportHandlers(ipcMain)
  registerImportHandlers(ipcMain)
  registerSicherungHandlers(ipcMain)
  registerBegruessungHandlers(ipcMain)
  registerSerienHandlers(ipcMain)
  const sync = erstelleSyncDienst(pcPlattform)
  sync.registriere(ipcMain)
  const win = createWindow()

  trackAppOpen()

  // News und Serien-Abgleich beim Start und alle 6 Stunden (nacheinander, schont das AniList-Limit)
  const abgleich = () => aktualisiereSerien(BrowserWindow.getAllWindows()[0] ?? null)
    .catch(console.error) // ein Fehler im Abgleich soll die News nicht verhindern
    .then(() => aktualisiereNews())
    .catch(console.error)
    .then(() => ergaenzeFolgenlaengen()) // nur beim ersten Mal nennenswert, danach fehlt kaum etwas
    .catch(console.error)
  // Erst starten, wenn die Oberfläche geladen ist – sonst ginge der Hinweis-Toast verloren
  win.webContents.once('did-finish-load', () => {
    abgleich()
    // Abgleich mit dem Handy über Google Drive: beim Start und alle 5 Minuten (nur wenn eingerichtet)
    sync.starteAutomatik(5 * 60 * 1000)
  })
  setInterval(abgleich, 6 * 60 * 60 * 1000)
})

app.on('before-quit', () => {
  try { persistDb() } catch (e) { console.error('Speichern beim Beenden fehlgeschlagen:', e) }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
