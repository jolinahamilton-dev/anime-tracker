// Datenbank der Handy-Version: dieselbe SQLite (sql.js) wie am PC, gespeichert im Browser (IndexedDB).
// Ersetzt beim Bauen der Web-App die PC-Datei src/db/database.ts (siehe vite.web.config.ts).
//
// Wie am PC (.bak-Dateien) liegen daneben bis zu drei automatische Kopien (höchstens eine pro Tag).
// Ist der Hauptstand beschädigt oder fehlt er, startet die App mit der neuesten brauchbaren Kopie –
// auch ohne Abgleich mit Google Drive.
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { setzeDb, createSchema, migrateSchema } from '../db/kern'

export * from '../db/kern'

const IDB_NAME = 'anime-tracker'
const STORE = 'daten'
const SCHLUESSEL = 'db'

/** Automatische Kopien: kopie-0 ist die neueste */
const KOPIEN = ['kopie-0', 'kopie-1', 'kopie-2']
/** Mindestabstand zwischen zwei Kopien (etwas unter einem Tag, damit die tägliche Kopie nicht wandert) */
const KOPIE_ABSTAND = 20 * 60 * 60 * 1000

interface Kopie {
  erstellt: string
  eintraege: number
  daten: Uint8Array
}

function oeffneIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

let idbVerbindung: Promise<IDBDatabase> | null = null
const idb = () => (idbVerbindung ??= oeffneIdb())

/** Liest einen Wert aus dem Browser-Speicher (null, wenn nicht vorhanden) */
export async function leseWert<T = unknown>(schluessel: string): Promise<T | null> {
  const d = await idb()
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE).objectStore(STORE).get(schluessel)
    r.onsuccess = () => resolve(r.result ?? null)
    r.onerror = () => reject(r.error)
  })
}

/** Schreibt mehrere Werte in einer Transaktion (ganz oder gar nicht) */
function schreibeWerte(werte: Record<string, unknown>): Promise<void> {
  return idb().then(d => new Promise<void>((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite')
    for (const [k, v] of Object.entries(werte)) t.objectStore(STORE).put(v, k)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

let schreibtGerade: Promise<void> = Promise.resolve()
/** Reiht einen Schreibvorgang ein – nacheinander, damit nie ein älterer Stand einen neueren überholt */
function nacheinander(werte: Record<string, unknown>): Promise<void> {
  const lauf = schreibtGerade.then(() => schreibeWerte(werte))
  schreibtGerade = lauf.catch(() => {})
  return lauf
}

function schreibe(daten: Uint8Array): Promise<void> {
  return nacheinander({ [SCHLUESSEL]: daten }).catch(e => {
    console.error('Speichern fehlgeschlagen:', e)
    // Sichtbar machen (z. B. Speicher voll) – sonst gingen Änderungen still verloren
    window.dispatchEvent(new CustomEvent('speicherfehler', { detail: String(e?.name ?? e) }))
  })
}

/** Speichert einen Wert neben der Datenbank (z. B. die Sicherheitskopie vor einer Wiederherstellung) */
export function schreibeWert(schluessel: string, wert: unknown): Promise<void> {
  return nacheinander({ [schluessel]: wert })
}

let SQL: SqlJsStatic | null = null
let db: Database | null = null

const anzahlEintraege = (d: Database) => Number(d.exec('SELECT COUNT(*) FROM entries')[0]?.values[0]?.[0] ?? 0)

/** Öffnet einen gespeicherten Stand und prüft ihn gründlich (eine leere/kaputte DB gilt nie als „gesund") */
function oeffneGeprueft(daten: Uint8Array, streng = true): Database {
  if (!daten?.length) throw new Error('Gespeicherter Stand ist leer')
  const kandidat = new SQL!.Database(daten)
  try {
    if (streng && kandidat.exec('PRAGMA quick_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('Integritätsprüfung fehlgeschlagen')
    if (!kandidat.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entries'")[0]) {
      throw new Error('Tabelle „entries" fehlt')
    }
    createSchema(kandidat)
    migrateSchema(kandidat)
    return kandidat
  } catch (e) {
    kandidat.close()
    throw e
  }
}

/** Datum der Kopie, mit der gestartet wurde, weil der Hauptstand fehlte oder beschädigt war (sonst null) */
export let wiederhergestelltAusKopie: string | null = null
export let wiederhergestelltAusBackup = false

export async function initDb(): Promise<Database> {
  if (db) return db
  SQL = await initSqlJs({ locateFile: () => wasmUrl })
  let vorhanden: Uint8Array | null = null
  let lesefehler: unknown = null
  try { vorhanden = await leseWert<Uint8Array>(SCHLUESSEL) } catch (e) { lesefehler = e }

  if (vorhanden) {
    try { db = oeffneGeprueft(vorhanden) } catch (e) { lesefehler = e }
  }
  if (!db) {
    // Hauptstand beschädigt oder weg → neueste brauchbare Kopie
    for (const k of KOPIEN) {
      try {
        const kopie = await leseWert<Kopie>(k)
        if (!kopie) continue
        db = oeffneGeprueft(kopie.daten)
        wiederhergestelltAusKopie = kopie.erstellt
        wiederhergestelltAusBackup = true
        console.warn('Hauptstand unbrauchbar, Kopie vom', kopie.erstellt, 'geladen:', lesefehler)
        break
      } catch { /* nächste Kopie probieren */ }
    }
  }
  if (!db && vorhanden) {
    // Keine brauchbare Kopie: den Hauptstand trotz Prüfungsfehler laden, solange er sich öffnen lässt
    // (wie bisher) – ein beschädigter Stand wird nie still durch eine leere DB ersetzt
    db = oeffneGeprueft(vorhanden, false)
  }
  if (!db) {
    if (lesefehler) throw lesefehler
    db = new SQL.Database()
    createSchema(db)
    migrateSchema(db)
  }
  setzeDb(db, persistDb)
  // Danach die tägliche Kopie – nicht, wenn gerade aus einer Kopie geladen wurde (die übrigen Kopien
  // sollen erhalten bleiben, bis der Stand wieder gesund gespeichert ist)
  persistDb().then(() => wiederhergestelltAusBackup ? undefined : legeKopieAn())
    .catch(e => console.error('Kopie konnte nicht angelegt werden:', e))
  // Browser bitten, die Daten nicht bei Speicherknappheit zu löschen
  navigator.storage?.persist?.().catch(() => {})
  return db
}

/** Speichert sofort; das Promise ist erfüllt, sobald der Stand im Browser-Speicher liegt */
export function persistDb(): Promise<void> {
  if (!db) return Promise.resolve()
  const fertig = schreibe(db.export())
  // App bleibt am Handy oft tagelang offen → auch nach Änderungen höchstens einmal am Tag kopieren
  if (Date.now() >= naechsteKopie) fertig.then(() => legeKopieAn()).catch(e => console.error('Kopie konnte nicht angelegt werden:', e))
  return fertig
}

let naechsteKopie = Infinity // erst nach initDb prüfen
let kopiertGerade = false

/** Neue automatische Kopie, wenn die letzte älter als KOPIE_ABSTAND ist; rotiert kopie-0 → 1 → 2 */
async function legeKopieAn(): Promise<void> {
  if (!db || kopiertGerade) return
  kopiertGerade = true
  try {
    const [k0, k1] = await Promise.all([leseWert<Kopie>(KOPIEN[0]), leseWert<Kopie>(KOPIEN[1])])
    const letzte = k0 ? new Date(k0.erstellt).getTime() : 0
    if (Date.now() - letzte < KOPIE_ABSTAND) { naechsteKopie = letzte + KOPIE_ABSTAND; return }
    const eintraege = anzahlEintraege(db)
    // Eine plötzlich leere Liste nicht über eine Kopie mit Einträgen schieben
    if (eintraege === 0 && k0 && k0.eintraege > 0) { naechsteKopie = Date.now() + KOPIE_ABSTAND; return }
    const neu: Kopie = { erstellt: new Date().toISOString(), eintraege, daten: db.export() }
    const werte: Record<string, unknown> = { [KOPIEN[0]]: neu }
    if (k0) werte[KOPIEN[1]] = k0
    if (k1) werte[KOPIEN[2]] = k1
    await nacheinander(werte)
    naechsteKopie = Date.now() + KOPIE_ABSTAND
  } catch (e) {
    // z. B. Speicher voll: die eigentlichen Daten sind davon nicht betroffen, später erneut versuchen
    naechsteKopie = Date.now() + 60 * 60 * 1000
    throw e
  } finally {
    kopiertGerade = false
  }
}

/** Übersicht der automatischen Kopien, neueste zuerst (nr = Position, für leseKopie) */
export async function lokaleKopien(): Promise<Array<{ nr: number; erstellt: string; eintraege: number }>> {
  const liste = []
  for (let nr = 0; nr < KOPIEN.length; nr++) {
    const k = await leseWert<Kopie>(KOPIEN[nr]).catch(() => null)
    if (k) liste.push({ nr, erstellt: k.erstellt, eintraege: k.eintraege })
  }
  return liste
}

/** Öffnet eine Kopie als eigene (geprüfte) Datenbank – zum Auslesen; danach close() aufrufen */
export async function oeffneKopie(nr: number): Promise<Database> {
  const k = KOPIEN[nr] ? await leseWert<Kopie>(KOPIEN[nr]) : null
  if (!k || !SQL) throw new Error('Diese Kopie gibt es nicht (mehr).')
  try { return oeffneGeprueft(k.daten) } catch { throw new Error('Diese Kopie ist beschädigt.') }
}

/** Schützt der Browser die Daten vor automatischem Löschen bei Speicherknappheit? null = unbekannt */
export async function speicherDauerhaft(): Promise<boolean | null> {
  try { return (await navigator.storage?.persisted?.()) ?? null } catch { return null }
}
