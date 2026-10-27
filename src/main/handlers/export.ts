import { IpcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { erstelleExport, merkeExport, EXPORT_TYP, ExportOptions } from './export-kern'

export function registerExportHandlers(ipcMain: IpcMain) {
  ipcMain.handle('export:start', async (event, opts: ExportOptions) => {
    const typ = EXPORT_TYP[opts.format] ?? EXPORT_TYP.csv

    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined as any, {
      title: 'Export speichern',
      defaultPath: `anime-tracker-export.${typ.ext}`,
      filters: [{ name: typ.filterName, extensions: [typ.ext] }],
    })

    if (result.canceled || !result.filePath) return { success: false }

    const datei = await erstelleExport(opts)
    fs.writeFileSync(result.filePath, datei.daten)
    merkeExport()

    return { success: true, pfad: result.filePath }
  })
}
