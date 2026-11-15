import { BrowserWindow } from 'electron'
import { dbAll, dbGet, getDb, schedulePersist } from '../../db/database'
import { anilistAbfrage } from './anilist'

// ─────────────────────────────────────────────────────────────────────────────
// Titelsprache: Einträge und Watch-Order behalten ihren Originaltitel (`title`, bei AniList-Titeln
// der romaji-Titel). Angezeigt wird `anzeige_titel`, gewählt nach der Einstellung „titelSprache"
// aus dem lokalen Cache titel_cache (je AniList-ID romaji/english/japanisch). Fehlt die Sprache
// oder die ID (manuelle Einträge, noch nicht geladen, offline), bleibt es beim Originaltitel.
// ─────────────────────────────────────────────────────────────────────────────

export type TitelSprache = 'englisch' | 'romaji' | 'japanisch'
export interface MediaTitel { romaji?: string | null; english?: string | null; native?: string | null }
type Zeile = Record<string, unknown>
interface CacheZeile { romaji: string | null; english: string | null; japanisch: string | null }

const STANDARD: TitelSprache = 'englisch'

export function titelSprache(): TitelSprache {
  const w = dbGet("SELECT value FROM app_meta WHERE key = 'titelSprache'")?.value
  return w === 'romaji' || w === 'japanisch' || w === 'englisch' ? w : STANDARD
}

const leer = (s: unknown): s is null | undefined | '' => s == null || String(s).trim() === ''

/** Anzeigetitel aus Originaltitel und Cache-Zeile (reine Funktion, gleiche Regeln wie anzeigeSql) */
export function waehleTitel(original: string | null | undefined, cache: CacheZeile | undefined, sprache: TitelSprache): string | null {
  const wunsch = sprache === 'englisch' ? cache?.english : sprache === 'japanisch' ? cache?.japanisch : null
  return !leer(wunsch) ? String(wunsch) : (original ?? null)
}

/** SQL-Ausdruck für den Anzeigetitel: `titel` = Originaltitel, `id` = AniList-ID – beide MIT Tabellenalias angeben (e.anilist_id), sonst meint die Unterabfrage ihre eigene Spalte */
export function anzeigeSql(titel: string, id: string, sprache: TitelSprache = titelSprache()): string {
  const spalte = sprache === 'englisch' ? 'english' : sprache === 'japanisch' ? 'japanisch' : null
  if (!spalte) return `(${titel})`
  return `COALESCE(NULLIF((SELECT c.${spalte} FROM titel_cache c WHERE c.anilist_id = ${id}), ''), ${titel})`
}

function ladeCache(): Map<number, CacheZeile> {
  return new Map(dbAll('SELECT anilist_id, romaji, english, japanisch FROM titel_cache')
    .map(r => [r.anilist_id as number, r as unknown as CacheZeile]))
}

/** Hilfsobjekt, das den Cache einmal lädt und danach Zeilen mit Anzeigetiteln versieht */
export function titelAnzeige() {
  const sprache = titelSprache()
  const cache = ladeCache()
  const anzeige = (original: unknown, anilistId: unknown) =>
    waehleTitel(original as string | null, anilistId != null ? cache.get(anilistId as number) : undefined, sprache)
  return {
    anzeige,
    /** Alle bekannten Titel kleingeschrieben (für die Suche: Original, romaji, englisch, japanisch) */
    alle: (original: unknown, anilistId: unknown) => {
      const c = anilistId != null ? cache.get(anilistId as number) : undefined
      return [...new Set([original, c?.romaji, c?.english, c?.japanisch].filter(t => !leer(t)).map(t => String(t).toLowerCase()))].join(' | ')
    },
  }
}

/** Einträge: anzeige_titel und titel_alle (Suche) ergänzen; staffel_titel/naechste_folge_staffel (nur gelesene Felder) ersetzen */
export function mitAnzeigeEintraege<T extends Zeile>(zeilen: T[], woZeilen: Zeile[] = []): T[] {
  const t = titelAnzeige()
  const staffelId = (entryId: unknown, titel: unknown) => {
    const z = woZeilen.find(w => w.entry_id === entryId && w.title === titel)
    return z?.related_anilist_id
  }
  return zeilen.map(e => {
    const r: Zeile = { ...e, anzeige_titel: t.anzeige(e.title, e.anilist_id), titel_alle: t.alle(e.title, e.anilist_id) }
    if (!leer(e.staffel_titel)) r.staffel_titel = t.anzeige(e.staffel_titel, staffelId(e.id, e.staffel_titel))
    if (!leer(e.naechste_folge_staffel)) r.naechste_folge_staffel = t.anzeige(e.naechste_folge_staffel, staffelId(e.id, e.naechste_folge_staffel))
    return r as T
  })
}

/** Watch-Order-Zeilen (related_anilist_id): anzeige_titel ergänzen */
export function mitAnzeigeStaffeln<T extends Zeile>(zeilen: T[]): T[] {
  const t = titelAnzeige()
  return zeilen.map(z => ({ ...z, anzeige_titel: t.anzeige(z.title, z.related_anilist_id) }))
}

/** Titel einer Staffel (Watch-Order-Zeile) für Texte im Main-Prozess */
export function staffelAnzeige(titel: unknown, anilistId: unknown): string | null {
  return titelAnzeige().anzeige(titel, anilistId)
}

/** Titel eines Mediums merken (z. B. beim Anlegen eines Eintrags oder aus dem Serien-Abgleich) */
export function merkeTitel(anilistId: number | null | undefined, t: MediaTitel | null | undefined) {
  if (anilistId == null || !t) return
  const nn = (s: unknown) => (leer(s) ? null : String(s))
  // Ein Aufruf ohne irgendeinen Titel (z. B. nur romaji bekannt) überschreibt keine vollständigere Zeile
  const alt = dbGet('SELECT english, japanisch FROM titel_cache WHERE anilist_id = ?', [anilistId])
  getDb().run(`INSERT OR REPLACE INTO titel_cache (anilist_id, romaji, english, japanisch, geprueft) VALUES (?, ?, ?, ?, datetime('now'))`,
    [anilistId, nn(t.romaji), nn(t.english) ?? (alt?.english as string | null) ?? null, nn(t.native) ?? (alt?.japanisch as string | null) ?? null])
  schedulePersist()
}

const ABFRAGE_GROESSE = 25
const NEU_PRUEFEN_TAGE = 30
const TITEL_QUERY = `query ($ids: [Int]) {
  Page(page: 1, perPage: ${ABFRAGE_GROESSE}) { media(id_in: $ids) { id title { romaji english native } } }
}`

const warte = (ms: number) => new Promise(r => setTimeout(r, ms))
let laeuft = false

/** Alle AniList-IDs der Einträge und Staffeln, deren Titel noch fehlen (oder ohne englischen Titel länger als 30 Tage her sind) */
function fehlendeIds(): number[] {
  return dbAll(`
    SELECT id FROM (
      SELECT anilist_id AS id FROM entries WHERE anilist_id IS NOT NULL
      UNION SELECT related_anilist_id FROM watch_order
    ) WHERE id NOT IN (SELECT anilist_id FROM titel_cache)
       OR id IN (SELECT anilist_id FROM titel_cache WHERE english IS NULL AND geprueft < datetime('now', '-${NEU_PRUEFEN_TAGE} days'))`)
    .map(r => r.id as number)
}

/**
 * Holt die Titel aller Einträge/Staffeln, die noch nicht im Cache sind, von AniList (im Hintergrund,
 * wenige Anfragen). IDs, die AniList nicht kennt, bekommen eine leere Zeile und werden nicht erneut
 * angefragt. Danach bekommen offene Seiten den Hinweis „aktualisiert". Gibt die Zahl der Titel zurück.
 */
export async function ergaenzeTitel(
  win: BrowserWindow | null = null,
  abfrage: typeof anilistAbfrage = anilistAbfrage,
  pauseMs = 700,
): Promise<number> {
  if (laeuft) return 0
  laeuft = true
  try {
    const ids = fehlendeIds()
    let neu = 0
    try {
      for (let i = 0; i < ids.length; i += ABFRAGE_GROESSE) {
        if (i > 0) await warte(pauseMs)
        const paket = ids.slice(i, i + ABFRAGE_GROESSE)
        const res = await abfrage(TITEL_QUERY, { ids: paket }, true)
        const medien = new Map<number, MediaTitel>((res?.data?.Page?.media ?? []).map((m: any) => [m.id as number, m.title as MediaTitel]))
        const db = getDb()
        db.run('BEGIN TRANSACTION')
        try {
          for (const id of paket) {
            const t = medien.get(id)
            if (t) merkeTitel(id, t)
            else db.run('INSERT OR REPLACE INTO titel_cache (anilist_id, romaji, english, japanisch, geprueft) VALUES (?, NULL, NULL, NULL, datetime(\'now\'))', [id])
          }
          db.run('COMMIT')
        } catch (e) {
          db.run('ROLLBACK')
          throw e
        }
        neu += medien.size
      }
    } finally {
      // Auch nach einem Abbruch (offline, Limit) melden, was schon geladen ist; der Rest kommt beim nächsten Start
      if (neu && win && !win.isDestroyed()) {
        const geaendert = dbAll('SELECT id FROM entries WHERE anilist_id IN (SELECT anilist_id FROM titel_cache)').map(r => r.id as number)
        win.webContents.send('serien:aktualisiert', { aenderungen: [], zurueckAufBeendet: [], geaendert })
      }
    }
    return neu
  } finally {
    laeuft = false
  }
}
