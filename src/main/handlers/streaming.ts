import { IpcMain, shell } from 'electron'
import { dbAll, dbGet, getDb, schedulePersist } from '../../db/database'
import { anilistAbfrage } from './anilist'
import { aktuelleStaffel, HAUPTLINIE } from './entries'

// ─────────────────────────────────────────────────────────────────────────────
// „Wo schauen“ (Plan Nr. 8): Streaming-Dienste aus AniList (externalLinks, Typ STREAMING) für die
// aktuelle Staffel des Anime. Lokaler Cache streaming_cache (nicht synchronisiert, nicht gesichert),
// je Titel höchstens alle 7 Tage neu; ohne Netz zeigt der Cache an. Nichts davon läuft beim Start –
// nur beim Öffnen der Detailseite.
// ─────────────────────────────────────────────────────────────────────────────

const GUELTIG_TAGE = 7
const QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { id externalLinks { type site url language color icon } } }`

export interface StreamingLink { site: string; url: string; language: string | null; color: string | null }
export interface StreamingAntwort {
  links: StreamingLink[]
  /** Zeitpunkt der letzten Prüfung bei AniList (UTC, „YYYY-MM-DD HH:MM:SS“) oder null */
  geprueft: string | null
  /** AniList war nicht erreichbar – gezeigt wird der (ggf. ältere) Zwischenspeicher */
  offline: boolean
}

/** Nur https-Adressen, nur Streaming, je Dienst + Adresse einmal */
export function bereinigeLinks(roh: unknown): StreamingLink[] {
  if (!Array.isArray(roh)) return []
  const gesehen = new Set<string>()
  const aus: StreamingLink[] = []
  for (const l of roh) {
    if (!l || (l.type != null && l.type !== 'STREAMING')) continue
    const site = typeof l.site === 'string' ? l.site.trim() : ''
    let url = ''
    try { const u = new URL(String(l.url)); if (u.protocol === 'https:') url = u.href } catch { /* ungültig */ }
    if (!site || !url) continue
    const key = `${site}|${url}`
    if (gesehen.has(key)) continue
    gesehen.add(key)
    aus.push({ site, url, language: typeof l.language === 'string' ? l.language : null,
      color: typeof l.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(l.color) ? l.color : null })
  }
  return aus
}

/** Welche AniList-ID gilt: die aktuelle Staffel, sonst die Hauptstaffel, sonst der Eintrag selbst */
export function waehleStaffelId(entryAnilistId: number | null, zeilen: Array<Record<string, unknown>>): number | null {
  const haupt = zeilen.filter(z => HAUPTLINIE.has(String(z.relation_type)))
  const i = haupt.length ? aktuelleStaffel(haupt) : -1
  if (i >= 0) return Number(haupt[i].related_anilist_id)
  const main = haupt.find(z => z.relation_type === 'MAIN')
  return main ? Number(main.related_anilist_id) : entryAnilistId
}

const alsAntwort = (r: Record<string, unknown> | undefined, offline: boolean): StreamingAntwort => {
  let links: StreamingLink[] = []
  try { links = bereinigeLinks(JSON.parse(String(r?.json ?? '[]'))) } catch { /* kaputter Cache = leer */ }
  return { links, geprueft: (r?.geprueft as string) ?? null, offline }
}

export async function ladeStreaming(entryId: number, abfrage: typeof anilistAbfrage = anilistAbfrage): Promise<StreamingAntwort> {
  const e = dbGet('SELECT anilist_id, type FROM entries WHERE id = ?', [entryId])
  if (!e || e.type !== 'ANIME') return { links: [], geprueft: null, offline: false }
  const id = waehleStaffelId((e.anilist_id as number | null) ?? null, dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId]))
  if (id == null) return { links: [], geprueft: null, offline: false }

  const cache = dbGet(`SELECT json, geprueft, geprueft > datetime('now', '-${GUELTIG_TAGE} days') AS frisch
    FROM streaming_cache WHERE anilist_id = ?`, [id])
  if (cache?.frisch) return alsAntwort(cache, false)
  try {
    const res = await abfrage(QUERY, { id })
    // Bei AniList gelöscht/unbekannt (404 → data: null): nichts zu zeigen, aber nicht ständig neu fragen
    const links = bereinigeLinks(res?.data?.Media?.externalLinks)
    getDb().run("INSERT OR REPLACE INTO streaming_cache (anilist_id, json, geprueft) VALUES (?, ?, datetime('now'))", [id, JSON.stringify(links)])
    schedulePersist()
    return alsAntwort(dbGet('SELECT json, geprueft FROM streaming_cache WHERE anilist_id = ?', [id]), false)
  } catch {
    return cache ? alsAntwort(cache, true) : { links: [], geprueft: null, offline: true }
  }
}

export function registerStreamingHandlers(ipcMain: IpcMain) {
  ipcMain.handle('streaming:get', (_, entryId: number) => ladeStreaming(Number(entryId)))
  // Nur https-Adressen im Standardbrowser öffnen
  ipcMain.handle('streaming:oeffne', (_, url: string) => {
    try { if (new URL(String(url)).protocol === 'https:') { shell.openExternal(String(url)); return true } } catch { /* ungültig */ }
    return false
  })
}
