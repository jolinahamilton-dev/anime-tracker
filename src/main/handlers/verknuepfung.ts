import { IpcMain } from 'electron'
import { dbAll, dbGet, getDb, schedulePersist } from '../../db/database'
import { anilistAbfrage, normalisiere } from './anilist'
import { adultFilter } from './einstellungen-kern'
import { schreibeWatchOrder, WoSpeicherZeile } from './watchorder'
import { merkeRueckgaengig } from './entries'
import { ausgestrahlt, elternSerieVon, holeMedien, kandidatenFuer, ladeKetten, MediaInfo } from './serien'
import { merkeTitel, mitAnzeigeEintraege, mitAnzeigeStaffeln, titelAnzeige } from './titel'

// ─────────────────────────────────────────────────────────────────────────────
// „Falsche AniList-Verknüpfung" korrigieren:
//  • Neu verknüpfen: Eintrag auf einen anderen AniList-Titel umhängen (Fortschritt, Status,
//    Bewertung, Spitzname, Listen bleiben; Staffeln werden neu aus der AniList-Kette gebildet)
//  • Staffel hinzufügen: einzelnen AniList-Titel als Vorgänger/Nachfolger in die Watch-Order einfügen
//  • Verknüpfungen prüfen: verdächtige Einträge auflisten (nur auf Knopfdruck, AniList in Blöcken)
// ─────────────────────────────────────────────────────────────────────────────

const SUCHE_QUERY = `
query ($search: String, $adult: Boolean) {
  Page(perPage: 15) {
    media(search: $search, type: ANIME, isAdult: $adult, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
      id format status episodes startDate { year }
      title { romaji english native }
      coverImage { medium }
    }
  }
}
`

type Zeile = Record<string, unknown>
const HAUPTLINIE = new Set(['MAIN', 'PREQUEL', 'SEQUEL'])
const MEHR_ALS_PLANUNG = (z: WoSpeicherZeile) => (z.progress_episodes ?? 0) > 0 || z.item_status !== 'planned'

export interface UmhaengPlan {
  zeilen: WoSpeicherZeile[]
  eintrag: { anilist_id: number; title: string | null; cover_url: string | null; total_episodes: number | null; progress_episodes: number; bekannte_ids: string }
  /** Vom alten Hauptmedium übrig: 'gleich', 'drin' (gehört zur neuen Kette), 'neben' (bleibt als Nebengeschichte, weil Fortschritt), 'weg' */
  alt: { id: number | null; schicksal: 'drin' | 'neben' | 'weg' | 'gleich' }
}

/**
 * Berechnet die Watch-Order nach dem Umhängen (reine Funktion, ohne Datenbank/Netz).
 * `alteZeilen`: bisherige Watch-Order des Eintrags (nach Position). `cache`: AniList-Medien samt Kette.
 */
export function planeUmhaengen(e: Zeile, alteZeilen: Zeile[], haupt: MediaInfo, cache: Map<number, MediaInfo>): UmhaengPlan {
  const { reihenfolge } = kandidatenFuer(haupt, cache)
  const alt = new Map(alteZeilen.map(z => [z.related_anilist_id as number, z]))
  const altId = (e.anilist_id as number | null) ?? null
  const altHaupt = altId != null ? alt.get(altId) : undefined

  const zeilen: WoSpeicherZeile[] = reihenfolge.map(k => {
    const vorher = alt.get(k.id)
    let progress = (vorher?.progress_episodes as number | undefined) ?? 0
    let status = (vorher?.item_status as string | undefined) ?? 'planned'
    // Das bisherige Hauptmedium kehrt in der neuen Kette wieder: Fortschritt aus dem Eintrag (falls höher)
    if (k.id === altId && (e.progress_episodes as number) > progress) {
      progress = e.progress_episodes as number
      status = status === 'planned' ? 'started' : status
    }
    const total = k.media.episodes ?? (vorher?.total_episodes as number | null | undefined) ?? null
    return {
      related_anilist_id: k.id,
      relation_type: k.relation,
      is_custom: 0,
      title: k.media.title?.romaji ?? (vorher?.title as string | null) ?? null,
      cover_url: k.media.coverImage?.large ?? (vorher?.cover_url as string | null) ?? null,
      total_episodes: total,
      progress_episodes: progress,
      item_status: status,
      aired_episodes: ausgestrahlt(k.media, (vorher?.aired_episodes as number | null | undefined) ?? null),
      media_status: k.media.status,
      neu_seit: null, // alte Teile nicht als „NEU" melden
    }
  })

  // Das alte Hauptmedium: nur behalten, wenn es nicht in der neuen Kette steckt und Fortschritt hat
  let schicksal: UmhaengPlan['alt']['schicksal'] = 'weg'
  const imNeuen = (id: number | null) => id != null && zeilen.some(z => z.related_anilist_id === id)
  if (altId === haupt.id) schicksal = 'gleich'
  else if (imNeuen(altId)) schicksal = 'drin'
  else if (altId != null && (altHaupt || (e.progress_episodes as number) > 0)) {
    const fortschritt = Math.max((altHaupt?.progress_episodes as number) ?? 0, (e.progress_episodes as number) ?? 0)
    const rest: WoSpeicherZeile = {
      related_anilist_id: altId, relation_type: 'SIDE_STORY', is_custom: 0,
      title: (altHaupt?.title as string | null) ?? (e.title as string | null),
      cover_url: (altHaupt?.cover_url as string | null) ?? (e.cover_url as string | null) ?? null,
      total_episodes: (altHaupt?.total_episodes as number | null) ?? (e.total_episodes as number | null) ?? null,
      progress_episodes: fortschritt,
      item_status: (altHaupt?.item_status as string) ?? (fortschritt > 0 ? 'started' : 'planned'),
      aired_episodes: (altHaupt?.aired_episodes as number | null) ?? null,
      media_status: (altHaupt?.media_status as string | null) ?? null,
      neu_seit: null,
    }
    if (MEHR_ALS_PLANUNG(rest)) { zeilen.push(rest); schicksal = 'neben' }
  }
  // Weitere alte Zeilen mit Fortschritt, die nicht in der neuen Kette sind, nicht verlieren
  for (const z of alteZeilen) {
    const id = z.related_anilist_id as number
    if (id === altId || zeilen.some(n => n.related_anilist_id === id)) continue
    const rest: WoSpeicherZeile = {
      related_anilist_id: id, relation_type: HAUPTLINIE.has(String(z.relation_type)) ? 'SIDE_STORY' : String(z.relation_type),
      is_custom: 0, title: z.title as string | null, cover_url: z.cover_url as string | null,
      total_episodes: z.total_episodes as number | null, progress_episodes: z.progress_episodes as number,
      item_status: z.item_status as string, aired_episodes: z.aired_episodes as number | null,
      media_status: z.media_status as string | null, neu_seit: null,
    }
    if (MEHR_ALS_PLANUNG(rest)) zeilen.push(rest)
  }

  const neuHaupt = zeilen.find(z => z.related_anilist_id === haupt.id)!
  let bekannt: number[] = []
  try { bekannt = e.bekannte_ids ? JSON.parse(String(e.bekannte_ids)) : [] } catch { bekannt = [] }
  const bekannteIds = JSON.stringify([...new Set([...bekannt, ...zeilen.map(z => z.related_anilist_id)])])
  return {
    zeilen,
    eintrag: {
      anilist_id: haupt.id,
      title: haupt.title?.romaji ?? (e.title as string | null),
      cover_url: haupt.coverImage?.large ?? (e.cover_url as string | null) ?? null,
      total_episodes: neuHaupt.total_episodes,
      progress_episodes: neuHaupt.progress_episodes,
      bekannte_ids: bekannteIds,
    },
    alt: { id: altId, schicksal },
  }
}

// ── AniList-Zugriff ──────────────────────────────────────────────────────────

// Vorschau → Übernehmen: die geholte Kette nicht noch einmal abfragen (10 Minuten)
let zwischen: { id: number; cache: Map<number, MediaInfo>; ablauf: number } | null = null

async function holeKette(anilistId: number): Promise<{ haupt: MediaInfo; cache: Map<number, MediaInfo> }> {
  if (zwischen && zwischen.id === anilistId && Date.now() < zwischen.ablauf && zwischen.cache.has(anilistId)) {
    return { haupt: zwischen.cache.get(anilistId)!, cache: zwischen.cache }
  }
  const cache = new Map<number, MediaInfo>()
  await ladeKetten([anilistId], cache, new Set(), new Set([anilistId]))
  const haupt = cache.get(anilistId)
  if (!haupt || haupt.type !== 'ANIME') throw new Error('Dieser Titel wurde bei AniList nicht gefunden (oder ist kein Anime).')
  zwischen = { id: anilistId, cache, ablauf: Date.now() + 10 * 60_000 }
  return { haupt, cache }
}

function merkeAlleTitel(cache: Map<number, MediaInfo>) {
  for (const m of cache.values()) {
    merkeTitel(m.id, m.title)
    for (const k of m.relations?.edges ?? []) merkeTitel(k.node.id, k.node.title)
  }
}

function umhaengenFehler(entryId: number, anilistId: number): string | null {
  const e = dbGet('SELECT id, type FROM entries WHERE id = ?', [entryId])
  if (!e) return 'Eintrag nicht gefunden.'
  if (e.type !== 'ANIME') return 'Neu verknüpfen geht nur bei Anime.'
  const doppelt = dbGet('SELECT id, title FROM entries WHERE anilist_id = ? AND id != ?', [anilistId, entryId])
  if (doppelt) return `Für diesen Titel gibt es schon einen eigenen Eintrag („${doppelt.title}“). Bitte erst den doppelten Eintrag zusammenführen oder löschen.`
  return null
}

const RELATION_NAME: Record<string, string> = { MAIN: 'Hauptstaffel', PREQUEL: 'Vorgänger', SEQUEL: 'Fortsetzung', SIDE_STORY: 'Nebengeschichte',
  SPIN_OFF: 'Spin-off', PARENT: 'Hauptserie', ALTERNATIVE: 'Alternative' }

/** Vorschau für die Oberfläche (Staffelliste, was bleibt, was ändert sich) */
export async function vorschauUmhaengen(entryId: number, anilistId: number) {
  const fehler = umhaengenFehler(entryId, anilistId)
  if (fehler) return { fehler }
  const { haupt, cache } = await holeKette(anilistId)
  merkeAlleTitel(cache)
  const e = dbGet('SELECT * FROM entries WHERE id = ?', [entryId])!
  const alte = dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId])
  const plan = planeUmhaengen(e, alte, haupt, cache)
  const t = titelAnzeige()
  const vorher = new Set(alte.map(z => z.related_anilist_id as number))
  return {
    haupt: { id: haupt.id, titel: t.anzeige(haupt.title?.romaji, haupt.id), format: haupt.format ?? null, folgen: haupt.episodes ?? null, jahr: haupt.startDate?.year ?? null },
    staffeln: plan.zeilen.map(z => ({
      id: z.related_anilist_id, titel: t.anzeige(z.title, z.related_anilist_id), relation: RELATION_NAME[z.relation_type] ?? z.relation_type,
      format: cache.get(z.related_anilist_id)?.format ?? null, folgen: z.total_episodes, gesehen: z.progress_episodes,
      neu: !vorher.has(z.related_anilist_id), nebengeschichte: z.relation_type === 'SIDE_STORY' && plan.alt.schicksal === 'neben' && z.related_anilist_id === plan.alt.id,
    })),
    alt: { schicksal: plan.alt.schicksal, titel: t.anzeige(e.title, e.anilist_id) },
  }
}

/** Hängt den Eintrag um. Gibt den Rückgängig-Token zurück. */
export async function haengeUm(entryId: number, anilistId: number) {
  const fehler = umhaengenFehler(entryId, anilistId)
  if (fehler) return { fehler }
  const { haupt, cache } = await holeKette(anilistId)
  merkeAlleTitel(cache)
  const db = getDb()
  const e = dbGet('SELECT * FROM entries WHERE id = ?', [entryId])!
  const alte = dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId])
  const plan = planeUmhaengen(e, alte, haupt, cache)

  db.run('BEGIN TRANSACTION')
  try {
    db.run(`UPDATE entries SET anilist_id = ?, title = ?, cover_url = ?, total_episodes = ?, progress_episodes = ?,
      bekannte_ids = ?, updated_at = datetime('now') WHERE id = ?`,
      [plan.eintrag.anilist_id, plan.eintrag.title, plan.eintrag.cover_url, plan.eintrag.total_episodes,
       plan.eintrag.progress_episodes, plan.eintrag.bekannte_ids, entryId] as any[])
    schreibeWatchOrder(entryId, plan.zeilen)
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  schedulePersist()
  zwischen = null

  const token = merkeRueckgaengig(() => {
    db.run(`UPDATE entries SET anilist_id = ?, title = ?, cover_url = ?, total_episodes = ?, progress_episodes = ?,
      bekannte_ids = ?, updated_at = ? WHERE id = ?`,
      [e.anilist_id, e.title, e.cover_url, e.total_episodes, e.progress_episodes, e.bekannte_ids, e.updated_at, entryId] as any[])
    schreibeWatchOrder(entryId, alte as unknown as WoSpeicherZeile[])
  }, 10 * 60_000)
  const neu = dbGet('SELECT * FROM entries WHERE id = ?', [entryId])
  return { entry: neu ? mitAnzeigeEintraege([neu])[0] : null, token, staffeln: plan.zeilen.length }
}

/** Einzelnen AniList-Titel als Vorgänger/Nachfolger in die Watch-Order einfügen */
export async function fuegeStaffelEin(entryId: number, anilistId: number, wo: 'vorgaenger' | 'nachfolger') {
  const e = dbGet('SELECT * FROM entries WHERE id = ?', [entryId])
  if (!e) return { fehler: 'Eintrag nicht gefunden.' }
  if (e.type !== 'ANIME') return { fehler: 'Staffeln gibt es nur bei Anime.' }
  const alte = dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId])
  if (alte.some(z => z.related_anilist_id === anilistId) || e.anilist_id === anilistId) return { fehler: 'Dieser Titel steht schon in der Watch-Order.' }
  const cache = new Map<number, MediaInfo>()
  await holeMedien([anilistId], cache, new Set())
  const m = cache.get(anilistId)
  if (!m || m.type !== 'ANIME') throw new Error('Dieser Titel wurde bei AniList nicht gefunden (oder ist kein Anime).')
  merkeTitel(m.id, m.title)

  const zeile: WoSpeicherZeile = {
    related_anilist_id: m.id, relation_type: wo === 'vorgaenger' ? 'PREQUEL' : 'SEQUEL', is_custom: 0,
    title: m.title?.romaji ?? null, cover_url: m.coverImage?.large ?? null, total_episodes: m.episodes ?? null,
    progress_episodes: 0, item_status: 'planned', aired_episodes: ausgestrahlt(m, null), media_status: m.status, neu_seit: null,
  }
  const liste = alte as unknown as WoSpeicherZeile[]
  const hauptIdx = liste.map((z, i) => HAUPTLINIE.has(z.relation_type) ? i : -1).filter(i => i >= 0)
  const stelle = wo === 'vorgaenger' ? (hauptIdx[0] ?? 0) : (hauptIdx.length ? hauptIdx[hauptIdx.length - 1] + 1 : liste.length)
  const neu = [...liste.slice(0, stelle), zeile, ...liste.slice(stelle)]
  let bekannt: number[] = []
  try { bekannt = e.bekannte_ids ? JSON.parse(String(e.bekannte_ids)) : [] } catch { bekannt = [] }
  const bekannteIds = JSON.stringify([...new Set([...bekannt, m.id])])

  const db = getDb()
  db.run('BEGIN TRANSACTION')
  try {
    schreibeWatchOrder(entryId, neu)
    db.run("UPDATE entries SET bekannte_ids = ?, updated_at = datetime('now') WHERE id = ?", [bekannteIds, entryId])
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  schedulePersist()
  const token = merkeRueckgaengig(() => {
    schreibeWatchOrder(entryId, liste)
    db.run('UPDATE entries SET bekannte_ids = ?, updated_at = ? WHERE id = ?', [e.bekannte_ids, e.updated_at, entryId] as any[])
  }, 10 * 60_000)
  return { token, items: mitAnzeigeStaffeln(dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [entryId])) }
}

// ── Verknüpfungen prüfen ─────────────────────────────────────────────────────

export interface Verdacht {
  entryId: number
  titel: string
  nickname: string | null
  gruende: string[]
  /** AniList-ID, auf die umgehängt werden sollte (null = von Hand suchen) */
  vorschlagId: number | null
  vorschlagTitel: string | null
}
export interface PruefErgebnis { zeit: string; geprueft: number; verdaechtig: Verdacht[] }

const META_ERGEBNIS = 'verknuepfungen_pruefung'
const META_IGNORIERT = 'verknuepfungen_ignoriert'
const NEBENFORMATE = new Set(['OVA', 'SPECIAL', 'MUSIC'])
const SERIE = new Set(['TV', 'TV_SHORT', 'MOVIE', 'ONA'])

function meta(key: string): string | null { return (dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value as string) ?? null }
function setzeMeta(key: string, wert: string) { getDb().run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, wert]); schedulePersist() }
function ignorierte(): number[] { try { return JSON.parse(meta(META_IGNORIERT) ?? '[]') } catch { return [] } }

/** Passt der Spitzname zu einem der Titel? (fast gleich, nicht nur ein kurzes Stück darin) */
export function spitznamePasst(nick: string, titel: Array<string | null | undefined>): boolean {
  const n = normalisiere(nick)
  if (!n) return true
  return titel.map(normalisiere).filter(Boolean).some(t => t === n || (t.includes(n) && n.length >= t.length * 0.6) || (n.includes(t) && t.length >= n.length * 0.6))
}

/**
 * Bewertet alle Anime-Einträge (reine Funktion): `medien` = Hauptmedien samt Relationen,
 * `alternativen` = die per ALTERNATIVE verbundenen Titel (mit ihren Relationen).
 */
export function findeVerdaechtige(eintraege: Zeile[], woAnzahl: Map<number, number>, medien: Map<number, MediaInfo>,
  alternativen: Map<number, MediaInfo>, ignoriert: number[] = []): Verdacht[] {
  const raus: Verdacht[] = []
  const t = titelAnzeige()
  for (const e of eintraege) {
    const id = e.id as number
    const m = medien.get(e.anilist_id as number)
    if (!m || ignoriert.includes(id)) continue
    const gruende: string[] = []
    let vorschlag: { id: number; titel: string | null } | null = null

    const eltern = elternSerieVon(m)
    if (eltern) {
      gruende.push(`Hängt an einer ${m.format === 'OVA' ? 'OVA' : m.format === 'MUSIC' ? 'Musikvideo' : 'Special'}, nicht an der Serie „${eltern.title?.romaji ?? eltern.id}“.`)
      vorschlag = { id: eltern.id, titel: eltern.title?.romaji ?? null }
    } else if (NEBENFORMATE.has(String(m.format))) {
      gruende.push('Hängt an einer OVA/einem Special – vermutlich nicht die Serie.')
    }
    const kanten = m.relations?.edges ?? []
    const folgen = m.episodes ?? (e.total_episodes as number | null)
    if (e.nickname && folgen != null && folgen <= 3 && !spitznamePasst(String(e.nickname), [m.title?.romaji, m.title?.english, m.title?.native])) {
      gruende.push(`Nur ${folgen} Folge${folgen === 1 ? '' : 'n'}, und der Spitzname „${e.nickname}“ passt nicht zu „${m.title?.romaji ?? m.id}“.`)
    }
    const fortsetzungen = kanten.filter(k => k.node.type === 'ANIME' && (k.relationType === 'SEQUEL' || k.relationType === 'PREQUEL'))
    if ((woAnzahl.get(id) ?? 0) <= 1 && fortsetzungen.length > 0) {
      gruende.push('Die Watch-Order hat nur eine Zeile, obwohl AniList Fortsetzungen/Vorgänger kennt.')
    }
    if (fortsetzungen.length === 0) {
      // Fortsetzungen nur über eine Alternative (z. B. Berserk 1997 → Filme → Berserk 2016)
      for (const k of kanten.filter(k => k.relationType === 'ALTERNATIVE' && k.node.type === 'ANIME')) {
        const alt = alternativen.get(k.node.id)
        const folge = (alt?.relations?.edges ?? []).filter(x => x.relationType === 'SEQUEL' && x.node.type === 'ANIME' && x.node.id !== m.id)
        if (folge.length) {
          const bester = folge.find(x => x.node.format === 'TV') ?? folge[0]
          gruende.push(`Fortsetzungen sind nur über die Alternative „${alt?.title?.romaji ?? alt?.id}“ erreichbar (z. B. „${bester.node.title?.romaji ?? bester.node.id}“).`)
          if (!vorschlag && SERIE.has(String(bester.node.format))) vorschlag = { id: bester.node.id, titel: bester.node.title?.romaji ?? null }
          break
        }
      }
    }
    if (gruende.length) {
      raus.push({ entryId: id, titel: String(t.anzeige(e.title, e.anilist_id) ?? e.title), nickname: (e.nickname as string | null) ?? null,
        gruende, vorschlagId: vorschlag?.id ?? null, vorschlagTitel: vorschlag?.titel ?? null })
    }
  }
  return raus
}

let pruefungLaeuft = false
const warte = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function pruefeVerknuepfungen(): Promise<PruefErgebnis> {
  if (pruefungLaeuft) throw new Error('Die Prüfung läuft schon.')
  pruefungLaeuft = true
  try {
    const eintraege = dbAll("SELECT id, title, nickname, anilist_id, total_episodes FROM entries WHERE type = 'ANIME' AND anilist_id IS NOT NULL")
    const medien = new Map<number, MediaInfo>()
    await holeMedien(eintraege.map(e => e.anilist_id as number), medien, new Set())
    // Titel, die nur über ALTERNATIVE hängen und keine eigene Fortsetzung haben: deren Relationen in einem Block nachladen
    const altIds = new Set<number>()
    for (const e of eintraege) {
      const m = medien.get(e.anilist_id as number)
      const kanten = m?.relations?.edges ?? []
      if (m && !kanten.some(k => k.node.type === 'ANIME' && (k.relationType === 'SEQUEL' || k.relationType === 'PREQUEL'))) {
        for (const k of kanten) if (k.relationType === 'ALTERNATIVE' && k.node.type === 'ANIME') altIds.add(k.node.id)
      }
    }
    const alternativen = new Map<number, MediaInfo>()
    if (altIds.size) {
      await warte(2100)
      await holeMedien([...altIds], alternativen, new Set())
    }
    const woAnzahl = new Map(dbAll('SELECT entry_id, COUNT(*) AS n FROM watch_order GROUP BY entry_id').map(z => [z.entry_id as number, z.n as number]))
    const ergebnis: PruefErgebnis = {
      zeit: new Date().toISOString(),
      geprueft: eintraege.length,
      verdaechtig: findeVerdaechtige(eintraege, woAnzahl, medien, alternativen, ignorierte()),
    }
    for (const m of medien.values()) merkeTitel(m.id, m.title)
    setzeMeta(META_ERGEBNIS, JSON.stringify(ergebnis))
    return ergebnis
  } finally {
    pruefungLaeuft = false
  }
}

/** Letztes Ergebnis ohne Netz; Einträge, die es nicht mehr gibt, ignoriert oder inzwischen umgehängt wurden, fallen heraus */
function gespeichertesErgebnis(): PruefErgebnis | null {
  const roh = meta(META_ERGEBNIS)
  if (!roh) return null
  let erg: PruefErgebnis
  try { erg = JSON.parse(roh) } catch { return null }
  const ign = ignorierte()
  const t = titelAnzeige()
  erg.verdaechtig = erg.verdaechtig
    .filter(v => !ign.includes(v.entryId) && dbGet('SELECT 1 FROM entries WHERE id = ?', [v.entryId]))
    .map(v => { const e = dbGet('SELECT title, anilist_id FROM entries WHERE id = ?', [v.entryId])!; return { ...v, titel: String(t.anzeige(e.title, e.anilist_id) ?? e.title) } })
  return erg
}

export function registerVerknuepfungHandlers(ipcMain: IpcMain) {
  ipcMain.handle('verknuepfung:suchen', async (_, text: string) => {
    const q = String(text ?? '').trim()
    if (!q) return []
    const res = await anilistAbfrage(SUCHE_QUERY, { search: q, ...adultFilter() })
    const t = titelAnzeige()
    return (res?.data?.Page?.media ?? []).map((m: any) => {
      merkeTitel(m.id, m.title)
      return { id: m.id, titel: t.anzeige(m.title?.romaji, m.id) ?? m.title?.romaji, format: m.format, folgen: m.episodes ?? null,
        jahr: m.startDate?.year ?? null, status: m.status, cover: m.coverImage?.medium ?? null }
    })
  })
  ipcMain.handle('verknuepfung:vorschau', (_, entryId: number, anilistId: number) => vorschauUmhaengen(entryId, anilistId))
  ipcMain.handle('verknuepfung:anwenden', (_, entryId: number, anilistId: number) => haengeUm(entryId, anilistId))
  ipcMain.handle('verknuepfung:staffelHinzufuegen', (_, entryId: number, anilistId: number, wo: 'vorgaenger' | 'nachfolger') =>
    fuegeStaffelEin(entryId, anilistId, wo))
  ipcMain.handle('verknuepfung:pruefen', () => pruefeVerknuepfungen())
  ipcMain.handle('verknuepfung:ergebnis', () => gespeichertesErgebnis())
  ipcMain.handle('verknuepfung:ignorieren', (_, entryId: number) => {
    setzeMeta(META_IGNORIERT, JSON.stringify([...new Set([...ignorierte(), entryId])]))
    return { success: true }
  })
}
