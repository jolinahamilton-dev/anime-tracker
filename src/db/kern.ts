// Plattformunabhängiger Teil der Datenbank: Schema, Migrationen, Änderungsprotokoll und
// Zugriffsfunktionen. Wie die Datenbank geladen und gespeichert wird, regelt die Plattform:
// am PC database.ts (Datei), in der Handy-Version src/web/datenbank.ts (Browser-Speicher).
import type { Database, SqlValue } from 'sql.js'

let db: Database | null = null
let speichern: () => void = () => {}

/** Von der Plattform aufgerufen, sobald die Datenbank geladen ist */
export function setzeDb(d: Database, speicherFunktion: () => void) {
  db = d
  speichern = speicherFunktion
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
export function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    try {
      speichern()
      persistTimer = null
    } catch (e) {
      // Nicht hängen bleiben (sonst würde nie wieder gespeichert) – in 2 s erneut versuchen
      console.error('Speichern fehlgeschlagen, neuer Versuch:', e)
      persistTimer = null
      setTimeout(schedulePersist, 2000)
    }
  }, 500)
}

export function getDb(): Database {
  if (!db) throw new Error('DB nicht initialisiert – initDb() zuerst aufrufen')
  return db
}

export function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anilist_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('ANIME','MANGA')),
      title TEXT NOT NULL,
      nickname TEXT,
      cover_url TEXT,
      genres TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      total_episodes INTEGER,
      total_chapters INTEGER,
      total_volumes INTEGER,
      progress_episodes INTEGER NOT NULL DEFAULT 0,
      progress_chapters INTEGER NOT NULL DEFAULT 0,
      progress_volumes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('started','completed','ongoing','planned','dropped','paused')),
      rating INTEGER CHECK(rating BETWEEN 1 AND 10),
      is_favorite INTEGER NOT NULL DEFAULT 0,
      review TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS list_entries (
      list_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      PRIMARY KEY (list_id, entry_id)
    );

    CREATE TABLE IF NOT EXISTS watch_order (
      entry_id INTEGER NOT NULL,
      related_anilist_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      position INTEGER NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      cover_url TEXT,
      total_episodes INTEGER,
      progress_episodes INTEGER NOT NULL DEFAULT 0,
      item_status TEXT NOT NULL DEFAULT 'planned',
      PRIMARY KEY (entry_id, related_anilist_id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anilist_id INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      airing_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0,
      UNIQUE(anilist_id, episode)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function migrateSchema(db: Database) {
  // Neue Spalten für watch_order (bestehende DBs)
  const cols = db.exec("PRAGMA table_info(watch_order)")[0]?.values?.map((r: any) => r[1]) ?? []
  if (!cols.includes('total_episodes'))     db.run('ALTER TABLE watch_order ADD COLUMN total_episodes INTEGER')
  if (!cols.includes('progress_episodes'))  db.run('ALTER TABLE watch_order ADD COLUMN progress_episodes INTEGER NOT NULL DEFAULT 0')
  if (!cols.includes('item_status'))        db.run('ALTER TABLE watch_order ADD COLUMN item_status TEXT NOT NULL DEFAULT "planned"')
  // Serien-Abgleich: bisher ausgestrahlte Folgen, AniList-Status, Zeitpunkt der automatischen Aufnahme
  if (!cols.includes('aired_episodes'))     db.run('ALTER TABLE watch_order ADD COLUMN aired_episodes INTEGER')
  if (!cols.includes('media_status'))       db.run('ALTER TABLE watch_order ADD COLUMN media_status TEXT')
  if (!cols.includes('neu_seit'))           db.run('ALTER TABLE watch_order ADD COLUMN neu_seit TEXT')

  const entryCols = db.exec("PRAGMA table_info(entries)")[0]?.values?.map((r: any) => r[1]) ?? []
  if (!entryCols.includes('nickname'))      db.run('ALTER TABLE entries ADD COLUMN nickname TEXT')
  // auto_offen: JSON-Liste der Staffel-IDs, wegen denen der Status automatisch auf „Ongoing"
  //   gesetzt wurde (NULL = Status nicht automatisch gesetzt)
  // bekannte_ids: alle AniList-IDs, die der Abgleich für diesen Eintrag schon kennt
  //   (nur wirklich neue Staffeln lösen eine Statusänderung aus)
  if (!entryCols.includes('auto_offen'))    db.run('ALTER TABLE entries ADD COLUMN auto_offen TEXT')
  if (!entryCols.includes('bekannte_ids'))  db.run('ALTER TABLE entries ADD COLUMN bekannte_ids TEXT')
  // Abo: nur abonnierte Anime werden auf News / neue Folgen / neue Staffeln geprüft.
  // Beim Einführen: alles abonnieren, was man schaut oder beendet hat.
  if (!entryCols.includes('abonniert')) {
    db.run('ALTER TABLE entries ADD COLUMN abonniert INTEGER NOT NULL DEFAULT 0')
    db.run("UPDATE entries SET abonniert = 1 WHERE type = 'ANIME' AND status IN ('ongoing', 'started', 'completed')")
  }

  // Wiederholungen (von Hand gezählt) und Zeitpunkt des Abschlusses (für „Beendet pro Monat")
  if (!entryCols.includes('rewatch_count')) db.run('ALTER TABLE entries ADD COLUMN rewatch_count INTEGER NOT NULL DEFAULT 0')
  if (!entryCols.includes('finished_at'))   db.run('ALTER TABLE entries ADD COLUMN finished_at TEXT')

  // Folgenlänge in Minuten je AniList-ID (Haupteinträge und Staffeln) – reiner Cache für die
  // Statistik, wird nicht synchronisiert
  db.run('CREATE TABLE IF NOT EXISTS media_dauer (anilist_id INTEGER PRIMARY KEY, minuten INTEGER NOT NULL)')

  // Reste gelöschter Einträge entfernen (früher hat entries:delete sie nicht mitgelöscht)
  db.run('DELETE FROM list_entries WHERE entry_id NOT IN (SELECT id FROM entries)')
  db.run('DELETE FROM watch_order WHERE entry_id NOT IN (SELECT id FROM entries)')

  richteSyncEin(db, entryCols)
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorbereitung für den Abgleich mit dem Handy (Cloud-Sync):
//  • stabile IDs (uuid) für Einträge und Listen – die Zahlen-IDs sind nur lokal eindeutig
//  • eine Geräte-ID
//  • sync_log: jede Änderung als (Zeit, Gerät, Tabelle, Zeile, Feld, Wert). Gelöschte Zeilen
//    stehen dort als Feld '-' (Löschvermerk), neu angelegte als '*'.
// Die Einträge schreiben SQLite-Trigger – die Handler müssen dafür nichts wissen.
// Solange app_meta.sync_pause gesetzt ist (beim späteren Einspielen fremder Änderungen),
// wird nichts protokolliert.
// ─────────────────────────────────────────────────────────────────────────────

/** Felder, die zwischen Geräten abgeglichen werden. Was jedes Gerät selbst von AniList holt und
 *  was die Staffel-Erkennung als Vergleichsstand braucht (ausgestrahlte Folgen, AniList-Status),
 *  gehört nicht dazu – sonst hielte das andere Gerät längst bekannte Folgen für neu. */
export const SYNC_FELDER = {
  entries: ['anilist_id', 'type', 'title', 'nickname', 'cover_url', 'genres', 'description', 'total_episodes',
    'total_chapters', 'total_volumes', 'progress_episodes', 'progress_chapters', 'progress_volumes', 'status',
    'rating', 'is_favorite', 'review', 'abonniert', 'auto_offen', 'bekannte_ids', 'rewatch_count', 'finished_at', 'created_at'],
  custom_lists: ['name', 'created_at'],
  watch_order: ['relation_type', 'position', 'is_custom', 'title', 'cover_url', 'progress_episodes', 'item_status', 'neu_seit', 'total_episodes'],
}
/** Einstellungen, die auf allen Geräten gleich sein sollen (alles andere in app_meta bleibt lokal) */
export const SYNC_META = ['akzentfarbe']

const NEUE_UUID = 'lower(hex(randomblob(16)))'
const ZEIT_MS = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)"
const GERAET = "(SELECT value FROM app_meta WHERE key = 'geraet_id')"
const NICHT_PAUSIERT = "(SELECT value FROM app_meta WHERE key = 'sync_pause') IS NULL"

function richteSyncEin(db: Database, entryCols: unknown[]) {
  if (!entryCols.includes('uuid')) db.run('ALTER TABLE entries ADD COLUMN uuid TEXT')
  const listCols = db.exec('PRAGMA table_info(custom_lists)')[0]?.values?.map((r: any) => r[1]) ?? []
  if (!listCols.includes('uuid')) db.run('ALTER TABLE custom_lists ADD COLUMN uuid TEXT')
  db.run(`UPDATE entries SET uuid = ${NEUE_UUID} WHERE uuid IS NULL`)
  db.run(`UPDATE custom_lists SET uuid = ${NEUE_UUID} WHERE uuid IS NULL`)
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_uuid ON entries(uuid)')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_uuid ON custom_lists(uuid)')
  db.run(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('geraet_id', ${NEUE_UUID})`)

  db.run(`CREATE TABLE IF NOT EXISTS sync_log (
    nr INTEGER PRIMARY KEY AUTOINCREMENT,
    zeit INTEGER NOT NULL,
    geraet TEXT NOT NULL,
    tabelle TEXT NOT NULL,
    zeile TEXT NOT NULL,
    feld TEXT NOT NULL,
    wert
  )`)
  // alt = Wert vor der Änderung: daran erkennt der Abgleich, ob beide Geräte dasselbe Feld
  // unabhängig voneinander geändert haben (Konflikt) oder nur eines (einfach übernehmen)
  const logCols = db.exec('PRAGMA table_info(sync_log)')[0]?.values?.map((r: any) => r[1]) ?? []
  if (!logCols.includes('alt')) db.run('ALTER TABLE sync_log ADD COLUMN alt')
  // Bis zu welcher Nummer die Änderungen jedes anderen Geräts schon eingespielt sind
  db.run('CREATE TABLE IF NOT EXISTS sync_geraete (geraet TEXT PRIMARY KEY, letzte_nr INTEGER NOT NULL)')

  // Trigger bei jedem Start neu anlegen – so passen sie immer zur aktuellen Feldliste
  const alt = db.exec("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync_%'")[0]?.values ?? []
  for (const [name] of alt) db.run(`DROP TRIGGER IF EXISTS ${name}`)

  // Zeilen ohne Schlüssel (verwaiste Reste, z. B. Listen-Zuordnung einer gelöschten Liste) werden
  // übersprungen – sonst schlüge das Schreiben/Löschen der Zeile selbst fehl (zeile ist NOT NULL)
  const log = (tabelle: string, zeile: string, feld: string, wert: string, bedingung = '', alt = 'NULL') =>
    `INSERT INTO sync_log (zeit, geraet, tabelle, zeile, feld, wert, alt)
       SELECT ${ZEIT_MS}, ${GERAET}, '${tabelle}', ${zeile}, '${feld}', ${wert}, ${alt}
       WHERE (${zeile}) IS NOT NULL${bedingung ? ` AND ${bedingung}` : ''};`

  // Einträge und Listen: uuid beim Anlegen vergeben, dann alle Felder protokollieren
  for (const tabelle of ['entries', 'custom_lists'] as const) {
    const felder = SYNC_FELDER[tabelle]
    const zeile = `(SELECT uuid FROM ${tabelle} WHERE id = NEW.id)`
    db.run(`CREATE TRIGGER sync_${tabelle}_neu AFTER INSERT ON ${tabelle} BEGIN
      UPDATE ${tabelle} SET uuid = ${NEUE_UUID} WHERE id = NEW.id AND uuid IS NULL;
      ${log(tabelle, zeile, '*', 'NULL', NICHT_PAUSIERT)}
      ${felder.map(f => log(tabelle, zeile, f, `NEW.${f}`, `NEW.${f} IS NOT NULL AND ${NICHT_PAUSIERT}`)).join('\n')}
    END`)
    db.run(`CREATE TRIGGER sync_${tabelle}_aend AFTER UPDATE ON ${tabelle} WHEN ${NICHT_PAUSIERT} BEGIN
      ${felder.map(f => log(tabelle, 'NEW.uuid', f, `NEW.${f}`, `OLD.${f} IS NOT NEW.${f}`, `OLD.${f}`)).join('\n')}
    END`)
    db.run(`CREATE TRIGGER sync_${tabelle}_weg AFTER DELETE ON ${tabelle} WHEN ${NICHT_PAUSIERT} BEGIN
      ${log(tabelle, 'OLD.uuid', '-', 'NULL')}
    END`)
  }

  // Watch-Order: Schlüssel = uuid des Eintrags + AniList-ID der Staffel
  const woZeile = (r: 'NEW' | 'OLD') => `(SELECT uuid FROM entries WHERE id = ${r}.entry_id) || ':' || ${r}.related_anilist_id`
  db.run(`CREATE TRIGGER sync_watch_order_neu AFTER INSERT ON watch_order WHEN ${NICHT_PAUSIERT} BEGIN
    ${log('watch_order', woZeile('NEW'), '*', 'NULL')}
    ${SYNC_FELDER.watch_order.map(f => log('watch_order', woZeile('NEW'), f, `NEW.${f}`, `NEW.${f} IS NOT NULL`)).join('\n')}
  END`)
  db.run(`CREATE TRIGGER sync_watch_order_aend AFTER UPDATE ON watch_order WHEN ${NICHT_PAUSIERT} BEGIN
    ${SYNC_FELDER.watch_order.map(f => log('watch_order', woZeile('NEW'), f, `NEW.${f}`, `OLD.${f} IS NOT NEW.${f}`, `OLD.${f}`)).join('\n')}
  END`)
  db.run(`CREATE TRIGGER sync_watch_order_weg AFTER DELETE ON watch_order WHEN ${NICHT_PAUSIERT} BEGIN
    ${log('watch_order', woZeile('OLD'), '-', 'NULL')}
  END`)

  // Listen-Zugehörigkeit: nur „drin" (*) oder „raus" (-)
  const leZeile = (r: 'NEW' | 'OLD') =>
    `(SELECT uuid FROM custom_lists WHERE id = ${r}.list_id) || ':' || (SELECT uuid FROM entries WHERE id = ${r}.entry_id)`
  db.run(`CREATE TRIGGER sync_list_entries_neu AFTER INSERT ON list_entries WHEN ${NICHT_PAUSIERT} BEGIN
    ${log('list_entries', leZeile('NEW'), '*', 'NULL')}
  END`)
  db.run(`CREATE TRIGGER sync_list_entries_weg AFTER DELETE ON list_entries WHEN ${NICHT_PAUSIERT} BEGIN
    ${log('list_entries', leZeile('OLD'), '-', 'NULL')}
  END`)

  // Achievements (Vereinigung) und gemeinsame Einstellungen
  db.run(`CREATE TRIGGER sync_achievements_neu AFTER INSERT ON achievements WHEN ${NICHT_PAUSIERT} BEGIN
    ${log('achievements', 'NEW.id', 'unlocked_at', 'NEW.unlocked_at')}
  END`)
  db.run(`CREATE TRIGGER sync_app_meta_neu AFTER INSERT ON app_meta
    WHEN ${NICHT_PAUSIERT} AND NEW.key IN (${SYNC_META.map(k => `'${k}'`).join(', ')}) BEGIN
    ${log('app_meta', 'NEW.key', 'value', 'NEW.value')}
  END`)
}

export function dbAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db_ = getDb()
  const stmt = db_.prepare(sql)
  stmt.bind(params as SqlValue[])
  const rows: Record<string, unknown>[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>)
  }
  stmt.free()
  return rows
}

export function dbGet(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  return dbAll(sql, params)[0]
}

export function dbRun(sql: string, params: unknown[] = []): void {
  const db_ = getDb()
  db_.run(sql, params as SqlValue[])
  schedulePersist()
}

export function dbRunGetId(sql: string, params: unknown[] = []): number {
  const db_ = getDb()
  db_.run(sql, params as SqlValue[])
  schedulePersist()
  return (dbGet('SELECT last_insert_rowid() as id') as { id: number }).id
}
