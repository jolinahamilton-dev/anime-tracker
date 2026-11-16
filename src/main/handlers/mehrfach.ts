import { BrowserWindow, IpcMain } from 'electron'
import { dbAll, dbGet, dbRun, getDb, schedulePersist } from '../../db/database'
import { pruefeAchievements } from './achievements'
import { aktualisiereKern, loescheKern, merkeRueckgaengig } from './entries'
import type { MehrfachAktion, MehrfachErgebnis } from '../../types'
import { hatStaffeln, verlaufAusDifferenz } from './verlauf'

// ─────────────────────────────────────────────────────────────────────────────
// Mehrfachauswahl auf der Listenseite (Plan Nr. 11): eine Aktion für viele Einträge, alles in EINER
// Transaktion und mit EINEM Rückgängig-Token. Es werden nur bestehende Felder geändert, der Abgleich
// (sync_log-Trigger) läuft wie bei der Einzelaktion – nichts Neues im Datenmodell.
// ─────────────────────────────────────────────────────────────────────────────

export type { MehrfachAktion, MehrfachErgebnis }

const STATUS = ['ongoing', 'completed', 'planned', 'dropped', 'paused']
export const MAX_MEHRFACH = 5000
const SPALTEN_ZURUECK = ['status', 'progress_episodes', 'progress_chapters', 'progress_volumes', 'is_favorite', 'abonniert',
  'finished_at', 'auto_offen', 'bekannte_ids', 'updated_at']

type Zeile = Record<string, unknown>

export function fuehreMehrfachAus(idsRoh: unknown, aktion: MehrfachAktion): MehrfachErgebnis {
  const leer = (fehler: string): MehrfachErgebnis => ({ success: false, fehler, geaendert: 0, uebersprungen: 0, token: null })
  if (!Array.isArray(idsRoh)) return leer('Keine Einträge angegeben.')
  const ids = [...new Set(idsRoh.filter((x): x is number => Number.isInteger(x)))]
  if (ids.length === 0) return leer('Keine Einträge ausgewählt.')
  if (ids.length > MAX_MEHRFACH) return leer(`Zu viele Einträge (höchstens ${MAX_MEHRFACH}).`)
  if (!aktion || typeof aktion !== 'object') return leer('Unbekannte Aktion.')
  if (!['status', 'favorit', 'abo', 'liste', 'loeschen'].includes(aktion.art)) return leer('Unbekannte Aktion.')
  if (aktion.art === 'status' && !STATUS.includes(aktion.status)) return leer('Unbekannter Status.')
  if (aktion.art === 'liste' && !dbGet('SELECT 1 AS x FROM custom_lists WHERE id = ?', [aktion.listeId])) return leer('Liste nicht gefunden.')

  const db = getDb()
  const vorher = new Map<number, Zeile>()
  for (const id of ids) { const z = dbGet('SELECT * FROM entries WHERE id = ?', [id]); if (z) vorher.set(id, z) }
  const betroffen = ids.filter(id => vorher.has(id))
  let uebersprungen = ids.length - betroffen.length
  const rueckwaerts: Array<() => void> = []
  let geaendert = 0

  db.run('BEGIN TRANSACTION')
  try {
    if (aktion.art === 'liste') {
      for (const id of betroffen) {
        const drin = !!dbGet('SELECT 1 AS x FROM list_entries WHERE list_id = ? AND entry_id = ?', [aktion.listeId, id])
        if (aktion.hinzu === drin) { uebersprungen++; continue }
        if (aktion.hinzu) {
          dbRun('INSERT OR IGNORE INTO list_entries (list_id, entry_id) VALUES (?, ?)', [aktion.listeId, id])
          rueckwaerts.push(() => { dbRun('DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?', [aktion.listeId, id]) })
        } else {
          dbRun('DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?', [aktion.listeId, id])
          rueckwaerts.push(() => { dbRun('INSERT OR IGNORE INTO list_entries (list_id, entry_id) VALUES (?, ?)', [aktion.listeId, id]) })
        }
        geaendert++
      }
    } else if (aktion.art === 'loeschen') {
      for (const id of betroffen) {
        const zurueck = loescheKern(id)
        if (zurueck) { rueckwaerts.push(zurueck); geaendert++ }
      }
    } else {
      for (const id of betroffen) {
        const alt = vorher.get(id)!
        const woAlt = alt.type === 'ANIME' ? dbAll('SELECT related_anilist_id, aired_episodes FROM watch_order WHERE entry_id = ?', [id]) : []
        if (aktion.art === 'status') {
          if (alt.status === aktion.status) { uebersprungen++; continue }
          aktualisiereKern(id, { status: aktion.status })
        } else if (aktion.art === 'favorit') {
          if (!!alt.is_favorite === aktion.wert) { uebersprungen++; continue }
          aktualisiereKern(id, { is_favorite: aktion.wert ? 1 : 0 })
        } else {
          // Abo: nur Anime; „Zuletzt bearbeitet“ bleibt unverändert (wie entries:abo)
          if (alt.type !== 'ANIME' || !!alt.abonniert === aktion.wert) { uebersprungen++; continue }
          dbRun('UPDATE entries SET abonniert = ? WHERE id = ?', [aktion.wert ? 1 : 0, id])
          if (aktion.wert) {
            // Wie entries:abo: Ist-Stand beim nächsten Abgleich still neu erfassen
            dbRun('UPDATE entries SET bekannte_ids = NULL WHERE id = ?', [id])
            dbRun('UPDATE watch_order SET aired_episodes = NULL WHERE entry_id = ?', [id])
          }
        }
        rueckwaerts.push(() => {
          const aktuell = dbGet('SELECT * FROM entries WHERE id = ?', [id])
          if (!aktuell) return
          dbRun(`UPDATE entries SET ${SPALTEN_ZURUECK.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
            [...SPALTEN_ZURUECK.map(c => alt[c] ?? null), id] as any[])
          for (const w of woAlt) dbRun('UPDATE watch_order SET aired_episodes = ? WHERE entry_id = ? AND related_anilist_id = ?',
            [w.aired_episodes ?? null, id, w.related_anilist_id] as any[])
          // Das automatische Auffüllen bei „Beendet“ steht im Verlauf (zählt nicht als gesehen) – zurück ebenfalls
          const ohne = alt.type === 'ANIME' && hatStaffeln(id) ? ['progress_episodes'] : []
          verlaufAusDifferenz(id, aktuell, alt, 'auto', ohne)
        })
        geaendert++
      }
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  schedulePersist()
  const token = geaendert > 0
    ? merkeRueckgaengig(() => { for (const f of [...rueckwaerts].reverse()) f() }, 10 * 60_000)
    : null
  return { success: true, geaendert, uebersprungen, token }
}

export function registerMehrfachHandlers(ipcMain: IpcMain) {
  ipcMain.handle('entries:mehrere', (event, ids: unknown, aktion: MehrfachAktion) => {
    const r = fuehreMehrfachAus(ids, aktion)
    if (r.geaendert > 0 && aktion.art !== 'loeschen' && aktion.art !== 'liste') {
      try { pruefeAchievements(BrowserWindow.fromWebContents(event.sender)) } catch (e) { console.error(e) }
    }
    return r
  })
}
