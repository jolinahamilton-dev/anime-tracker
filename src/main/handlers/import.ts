import { IpcMain, dialog } from 'electron'
import fs from 'fs'
import { importiereCsv } from './import-kern'

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
}
