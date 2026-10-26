import { IpcMain } from 'electron'
import { dbAll, dbGet, dbRun, dbRunGetId } from '../../db/database'

export function registerListHandlers(ipcMain: IpcMain) {
  ipcMain.handle('lists:getAll', () => {
    const lists = dbAll('SELECT * FROM custom_lists ORDER BY created_at')
    return lists.map(list => ({
      ...list,
      entries: dbAll('SELECT entry_id FROM list_entries WHERE list_id = ?', [list.id as number]),
    }))
  })

  ipcMain.handle('lists:create', (_, name: string) => {
    const id = dbRunGetId('INSERT INTO custom_lists (name) VALUES (?)', [name])
    return dbGet('SELECT * FROM custom_lists WHERE id = ?', [id])
  })

  ipcMain.handle('lists:rename', (_, id: number, name: string) => {
    dbRun('UPDATE custom_lists SET name = ? WHERE id = ?', [name, id])
    return { success: true }
  })

  ipcMain.handle('lists:delete', (_, id: number) => {
    dbRun('DELETE FROM list_entries WHERE list_id = ?', [id])
    dbRun('DELETE FROM custom_lists WHERE id = ?', [id])
    return { success: true }
  })

  ipcMain.handle('lists:addEntry', (_, listId: number, entryId: number) => {
    dbRun('INSERT OR IGNORE INTO list_entries (list_id, entry_id) VALUES (?, ?)', [listId, entryId])
    return { success: true }
  })

  ipcMain.handle('lists:removeEntry', (_, listId: number, entryId: number) => {
    dbRun('DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?', [listId, entryId])
    return { success: true }
  })
}
