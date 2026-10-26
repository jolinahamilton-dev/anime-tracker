import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import initSqlJs, { Database } from 'sql.js'
import { setzeDb, createSchema, migrateSchema } from './kern'

export * from './kern'

let db: Database | null = null
let dbPath: string

export async function initDb(): Promise<Database> {
  if (db) return db

  dbPath = path.join(app.getPath('userData'), 'anime-tracker.db')

  // Im gepackten Build liegt sql.js (per asarUnpack) NICHT mehr im app.asar-Archiv,
  // sondern daneben in app.asar.unpacked – sql.js braucht für die .wasm-Datei einen
  // echten Dateisystempfad, kein virtuelles asar-FS. Im Dev-Betrieb (kein asar)
  // zeigt app.getAppPath() weiterhin direkt auf den Projektstamm.
  const wasmDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist')
    : path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist')
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(wasmDir, file),
  })

  // Sicherungen, neueste zuerst: .bak (letzter Start), .bak.1, .bak.2
  const sicherungen = [dbPath + '.bak', dbPath + '.bak.1', dbPath + '.bak.2']

  // Öffnet eine DB-Datei und prüft sie gründlich. sql.js öffnet z. B. eine 0-Byte-Datei
  // klaglos als leere DB – die darf nie als „gesund" gelten.
  const oeffne = (datei: string): Database => {
    const inhalt = fs.readFileSync(datei)
    if (inhalt.length === 0) throw new Error('Datenbankdatei ist leer')
    const kandidat = new SQL.Database(inhalt)
    try {
      if (kandidat.exec('PRAGMA quick_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('Integritätsprüfung fehlgeschlagen')
      if (!kandidat.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entries'")[0]) {
        throw new Error('Tabelle „entries" fehlt')
      }
      createSchema(kandidat)
      return kandidat
    } catch (e) {
      kandidat.close()
      throw e
    }
  }
  const anzahlEintraege = (d: Database) => Number(d.exec('SELECT COUNT(*) FROM entries')[0]?.values[0]?.[0] ?? 0)

  if (fs.existsSync(dbPath)) {
    try {
      db = oeffne(dbPath)
    } catch (fehler) {
      // Hauptdatei beschädigt → neueste brauchbare Sicherung laden, kaputte Datei aufheben
      for (const datei of sicherungen) {
        if (!fs.existsSync(datei)) continue
        try { db = oeffne(datei); break } catch { /* nächste Sicherung probieren */ }
      }
      if (!db) throw fehler
      try { fs.copyFileSync(dbPath, dbPath + '.defekt') } catch { /* nur zur Analyse */ }
      wiederhergestelltAusBackup = true
    }

    // Sicherung des gesunden Stands (einmal pro Start). Fehler hier (z. B. Virenscanner-Sperre)
    // dürfen den Start nicht stören – die Hauptdatei ist ja in Ordnung.
    if (!wiederhergestelltAusBackup) {
      try {
        let alteAnzahl = -1
        if (fs.existsSync(sicherungen[0])) {
          try { const alt = oeffne(sicherungen[0]); alteAnzahl = anzahlEintraege(alt); alt.close() } catch { /* unbrauchbar */ }
        }
        // Eine plötzlich leere DB nicht über eine volle Sicherung schreiben
        if (anzahlEintraege(db) === 0 && alteAnzahl > 0) {
          console.warn('Datenbank leer, Sicherung enthält Einträge – Sicherung wird nicht überschrieben')
        } else {
          for (let i = sicherungen.length - 1; i > 0; i--) {
            if (fs.existsSync(sicherungen[i - 1])) fs.copyFileSync(sicherungen[i - 1], sicherungen[i])
          }
          fs.copyFileSync(dbPath, sicherungen[0])
        }
      } catch (e) {
        console.error('Sicherung konnte nicht angelegt werden:', e)
      }
    }
  } else {
    db = new SQL.Database()
    createSchema(db)
  }

  migrateSchema(db)
  setzeDb(db, persistDb)
  persistDb()
  return db
}

/** true, wenn beim Start die Sicherung statt der (beschädigten) Hauptdatei geladen wurde */
export let wiederhergestelltAusBackup = false

/** Schreibt Daten vollständig auf die Platte (fsync), nicht nur in den Schreibcache */
function schreibeSicher(datei: string, data: Buffer) {
  const fd = fs.openSync(datei, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

export function persistDb() {
  if (!db || !dbPath) return
  const data = Buffer.from(db.export())
  // Atomar speichern: erst vollständig in eine Temp-Datei schreiben, dann umbenennen.
  // Ein Absturz während des Schreibens trifft so nur die Temp-Datei, nie die echte DB.
  const tmpPath = dbPath + '.tmp'
  schreibeSicher(tmpPath, data)
  try {
    fs.renameSync(tmpPath, dbPath)
  } catch {
    // Umbenennen kann unter Windows scheitern, wenn ein Virenscanner die Datei sperrt.
    // Notlösung: direkt schreiben (die Temp-Datei bleibt bis dahin als vollständige Kopie liegen)
    schreibeSicher(dbPath, data)
    fs.rmSync(tmpPath, { force: true })
  }
}
