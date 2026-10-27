// Datenbank der Handy-Version: dieselbe SQLite (sql.js) wie am PC, gespeichert im Browser (IndexedDB).
// Ersetzt beim Bauen der Web-App die PC-Datei src/db/database.ts (siehe vite.web.config.ts).
import initSqlJs, { Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { setzeDb, createSchema, migrateSchema } from '../db/kern'

export * from '../db/kern'

const IDB_NAME = 'anime-tracker'
const STORE = 'daten'
const SCHLUESSEL = 'db'

function oeffneIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function lese(): Promise<Uint8Array | null> {
  const idb = await oeffneIdb()
  return new Promise((resolve, reject) => {
    const r = idb.transaction(STORE).objectStore(STORE).get(SCHLUESSEL)
    r.onsuccess = () => resolve(r.result ?? null)
    r.onerror = () => reject(r.error)
  })
}

let idbVerbindung: Promise<IDBDatabase> | null = null
let schreibtGerade: Promise<void> = Promise.resolve()
function schreibe(daten: Uint8Array): Promise<void> {
  idbVerbindung ??= oeffneIdb()
  // Nacheinander schreiben, damit nie ein älterer Stand einen neueren überholt
  schreibtGerade = schreibtGerade.then(() => idbVerbindung!).then(idb => new Promise<void>((resolve, reject) => {
    const t = idb.transaction(STORE, 'readwrite')
    t.objectStore(STORE).put(daten, SCHLUESSEL)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })).catch(e => {
    console.error('Speichern fehlgeschlagen:', e)
    // Sichtbar machen (z. B. Speicher voll) – sonst gingen Änderungen still verloren
    window.dispatchEvent(new CustomEvent('speicherfehler', { detail: String(e?.name ?? e) }))
  })
  return schreibtGerade
}

let db: Database | null = null

export async function initDb(): Promise<Database> {
  if (db) return db
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const vorhanden = await lese()
  db = vorhanden ? new SQL.Database(vorhanden) : new SQL.Database()
  createSchema(db)
  migrateSchema(db)
  setzeDb(db, persistDb)
  persistDb()
  // Browser bitten, die Daten nicht bei Speicherknappheit zu löschen
  navigator.storage?.persist?.().catch(() => {})
  return db
}

/** Speichert sofort; das Promise ist erfüllt, sobald der Stand im Browser-Speicher liegt */
export function persistDb(): Promise<void> {
  return db ? schreibe(db.export()) : Promise.resolve()
}

/** Schützt der Browser die Daten vor automatischem Löschen bei Speicherknappheit? null = unbekannt */
export async function speicherDauerhaft(): Promise<boolean | null> {
  try { return (await navigator.storage?.persisted?.()) ?? null } catch { return null }
}

export const wiederhergestelltAusBackup = false
