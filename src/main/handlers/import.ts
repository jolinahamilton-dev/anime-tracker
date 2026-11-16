import { IpcMain, dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { importiereCsv } from './import-kern'
import { istGzip } from './import-fremd'
import { ImportAblage, registerImportLaufHandlers } from './anilist-import'

// Sicherheitskopie vor einem Import und Merkzettel des letzten Laufs – neben der Datenbank im Benutzerordner
const dateiFuer = (schluessel: 'sicherung' | 'lauf') =>
  path.join(app.getPath('userData'), schluessel === 'sicherung' ? 'vor-import.json' : 'import-lauf.json')
const ablage: ImportAblage = {
  async lies(schluessel) { try { return fs.readFileSync(dateiFuer(schluessel), 'utf8') } catch { return null } },
  async schreib(schluessel, text) {
    // Erst vollständig schreiben, dann umbenennen – ein Absturz trifft nie die alte Kopie
    fs.writeFileSync(dateiFuer(schluessel) + '.tmp', text)
    fs.renameSync(dateiFuer(schluessel) + '.tmp', dateiFuer(schluessel))
  },
}

export function registerImportHandlers(ipcMain: IpcMain) {
  ipcMain.handle('import:csv', async () => {
    const result = await dialog.showOpenDialog({
      title: 'CSV importieren',
      filters: [{ name: 'CSV-Dateien', extensions: ['csv'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) return { success: false, abgebrochen: true }

    return importiereCsv(fs.readFileSync(result.filePaths[0], 'utf8'))
  })

  // Import aus anderer App (MyAnimeList-XML, auch .xml.gz, oder CSV) und per AniList-Benutzername
  registerImportLaufHandlers(ipcMain, {
    ablage,
    async waehleDatei() {
      const result = await dialog.showOpenDialog({
        title: 'Liste aus anderer App importieren',
        filters: [{ name: 'Listen (MyAnimeList-XML, CSV)', extensions: ['xml', 'gz', 'csv'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      const bytes = fs.readFileSync(result.filePaths[0])
      let text: string
      try {
        text = (istGzip(bytes) ? zlib.gunzipSync(bytes) : bytes).toString('utf8')
      } catch {
        throw new Error('Die Datei ließ sich nicht entpacken (kaputte .gz-Datei?).')
      }
      return { name: path.basename(result.filePaths[0]), text }
    },
  })
}
