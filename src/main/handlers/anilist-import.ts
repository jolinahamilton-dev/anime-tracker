import { IpcMain, BrowserWindow } from 'electron'
import { dbAll, dbGet, dbRunGetId, getDb, schedulePersist } from '../../db/database'
import { anilistAbfrage, normalisiere, sucheTitel } from './anilist'
import { adultAnzeigen } from './einstellungen-kern'
import { LadeOptionen, MediaInfo, ladeKetten } from './serien'
import { schreibeWatchOrder } from './watchorder'
import { merkeTitel } from './titel'
import { schreibeVerlauf } from './verlauf'
import { loescheKern } from './entries'
import { erstelleSicherung } from './sicherung-kern'
import { FremdListe, leseFremdeListe } from './import-fremd'
import {
  GeplanteSerie, ListenStatus, MedienTyp, QuellZeile, datumText, ordneAnime, ordneManga, sterneAus,
} from './import-gruppen'

// ─────────────────────────────────────────────────────────────────────────────
// Import (Plan Nr. 13 und 14): Listen von AniList (Benutzername) oder aus Dateien (MyAnimeList, CSV).
// Ablauf für alle Quellen gleich:
//   QuellZeilen → AniList-IDs (idMal → id, Titelsuche) → Ketten laden → zu Serien zusammenfassen
//   → „Prüfen“ (Trockenlauf, nichts wird geschrieben) → „Importieren“ (nur Neues, vorher Sicherheitskopie)
//   → „Import zurücknehmen“ (löscht genau die Einträge dieses Laufs).
// Der Plan aus „Prüfen“ wird beim Importieren unverändert geschrieben (Trockenlauf = tatsächlicher Lauf).
// Vorhandene Einträge werden nie angefasst oder doppelt angelegt.
// ─────────────────────────────────────────────────────────────────────────────

const PAKET = 25 // id_in je Anfrage (AniList-Komplexität), Pause 2,1 s → ~28 Anfragen/min

const NODE = `id type format status episodes duration nextAiringEpisode { episode }
  title { romaji english native } coverImage { large }
  startDate { year month day } endDate { year month day }`
const ANIME_QUERY = `
query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: ${PAKET}) {
    media(id_in: $ids, type: ANIME) {
      ${NODE} idMal genres description(asHtml: false) isAdult
      relations { edges { relationType node { ${NODE} } } }
    }
  }
}`
const MANGA_FELDER = `id idMal type format status chapters volumes title { romaji english native } coverImage { large }
  genres description(asHtml: false) isAdult`
const MANGA_QUERY = `
query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: ${PAKET}) { media(id_in: $ids, type: MANGA) { ${MANGA_FELDER} } }
}`
const MAL_QUERY = `
query ($ids: [Int], $type: MediaType) {
  Page(page: 1, perPage: 50) { media(idMal_in: $ids, type: $type) { id idMal } }
}`
// Listenabfrage: Anime brauchen hier nur die ID (Verknüpfungen holt ladeKetten), Manga alles
const listenQuery = (typ: MedienTyp) => `
query ($userName: String, $type: MediaType, $chunk: Int) {
  MediaListCollection(userName: $userName, type: $type, chunk: $chunk, perChunk: 100) {
    hasNextChunk
    user { name mediaListOptions { scoreFormat } }
    lists {
      isCustomList
      entries {
        status score progress progressVolumes repeat notes completedAt { year month day }
        media { ${typ === 'MANGA' ? MANGA_FELDER : 'id idMal type title { romaji english native }'} }
      }
    }
  }
}`

// ── Zustand eines Laufs ──────────────────────────────────────────────────────

export interface Fortschritt { phase: string; aktuell: number; gesamt: number }
export interface ImportOptionen {
  /** Pause zwischen AniList-Anfragen in ms (Standard 2100; Tests 0) */
  wartezeit?: number
  melde?: (p: Fortschritt) => void
  abbrechen?: () => boolean
}

export interface Vorschlag { nr: number; titel: string; typ: MedienTyp; vorschlag: { id: number; titel: string; cover: string | null } }
export interface NichtZugeordnet { nr: number; titel: string; typ: MedienTyp; grund: string }

export interface PlanSerie extends GeplanteSerie { vorhanden: boolean }

export interface Plan {
  quelle: string
  eintraegeQuelle: number
  serien: PlanSerie[]
  zusammengefasst: number
  nichtZugeordnet: NichtZugeordnet[]
  pruefen: Vorschlag[]
  uebersprungen18: number
  uebersprungenDatei: number
}

/** Zwischenstand, damit „Übernehmen“ bei der Prüfliste nur noch die neuen Titel nachladen muss */
export interface PlanZustand {
  quelle: string
  zeilen: QuellZeile[]
  uebersprungenDatei: number
  cache: Map<number, MediaInfo>
  versucht: Set<number>
  mangaCache: Map<number, MediaInfo>
  vorschlaege: Map<number, { id: number; titel: string; cover: string | null }>
  nichtZugeordnet: NichtZugeordnet[]
}

const warte = (ms: number) => new Promise(r => setTimeout(r, ms))
const ABGEBROCHEN = 'Abgebrochen'

function ladeOpt(o: ImportOptionen, phase: string, gesamt: number, query: string): LadeOptionen {
  let abgefragt = 0
  return {
    query, paket: PAKET, wartezeit: o.wartezeit, abbrechen: o.abbrechen,
    fortschritt: n => { abgefragt += n; o.melde?.({ phase, aktuell: Math.min(abgefragt, gesamt), gesamt }) },
  }
}
const pruefeAbbruch = (o: ImportOptionen) => { if (o.abbrechen?.()) throw new Error(ABGEBROCHEN) }

// ── Quelle 1: AniList-Benutzername ───────────────────────────────────────────

/** Liste eines öffentlichen AniList-Profils (Anime oder Manga). Manga-Angaben kommen gleich mit (mangaCache). */
export async function holeBenutzerListe(benutzer: string, typ: MedienTyp, mangaCache: Map<number, MediaInfo>, o: ImportOptionen = {}): Promise<QuellZeile[]> {
  const nachId = new Map<number, QuellZeile>()
  let format = 'POINT_10'
  for (let chunk = 1; chunk < 200; chunk++) {
    pruefeAbbruch(o)
    if (chunk > 1) await warte(o.wartezeit ?? 2100)
    let res: any
    try {
      res = await anilistAbfrage(listenQuery(typ), { userName: benutzer, type: typ, chunk }, true)
    } catch (e: any) {
      throw new Error(listenFehler(String(e?.message ?? e), benutzer))
    }
    const fehler = res?.errors?.[0]?.message
    if (fehler || !res?.data?.MediaListCollection) throw new Error(listenFehler(String(fehler ?? 'not found'), benutzer))
    const sammlung = res.data.MediaListCollection
    format = sammlung.user?.mediaListOptions?.scoreFormat ?? format
    // Eigene Listen (isCustomList) wiederholen nur Einträge der Status-Listen
    for (const liste of sammlung.lists ?? []) {
      if (liste.isCustomList) continue
      for (const e of liste.entries ?? []) {
        const m = e.media
        if (!m?.id || nachId.has(m.id)) continue
        if (typ === 'MANGA') mangaCache.set(m.id, m)
        nachId.set(m.id, {
          nr: nachId.size + 1, typ, anilistId: m.id, malId: m.idMal ?? null,
          titel: m.title?.romaji ?? m.title?.english ?? m.title?.native ?? String(m.id),
          status: e.status as ListenStatus,
          fortschritt: Math.max(0, Number(e.progress) || 0), baende: Math.max(0, Number(e.progressVolumes) || 0),
          bewertung: sterneAus(e.score, format), wiederholungen: Math.max(0, Number(e.repeat) || 0),
          notiz: typeof e.notes === 'string' && e.notes.trim() ? e.notes.trim() : null,
          beendet: e.status === 'COMPLETED' ? datumText(e.completedAt) : null,
        })
      }
    }
    o.melde?.({ phase: typ === 'ANIME' ? 'Anime-Liste laden' : 'Manga-Liste laden', aktuell: nachId.size, gesamt: nachId.size })
    if (!sammlung.hasNextChunk) break
  }
  return [...nachId.values()]
}

function listenFehler(msg: string, benutzer: string): string {
  if (/private/i.test(msg)) return `Die Liste von „${benutzer}“ ist privat. Bitte bei AniList unter Einstellungen → Datenschutz auf öffentlich stellen.`
  if (/not found|404/i.test(msg)) return `Der Benutzer „${benutzer}“ wurde bei AniList nicht gefunden.`
  return msg
}

// ── Zuordnen: MAL-ID → AniList-ID, Titelsuche ────────────────────────────────

async function loeseMalIds(zeilen: QuellZeile[], o: ImportOptionen) {
  for (const typ of ['ANIME', 'MANGA'] as MedienTyp[]) {
    const offen = [...new Set(zeilen.filter(z => z.typ === typ && z.anilistId == null && z.malId != null).map(z => z.malId!))]
    const zuId = new Map<number, number>()
    for (let i = 0; i < offen.length; i += 50) {
      pruefeAbbruch(o)
      if (i > 0) await warte(o.wartezeit ?? 2100)
      const res = await anilistAbfrage(MAL_QUERY, { ids: offen.slice(i, i + 50), type: typ }, true)
      for (const m of res?.data?.Page?.media ?? []) if (m.idMal != null) zuId.set(m.idMal, m.id)
      o.melde?.({ phase: 'MAL-IDs zuordnen', aktuell: Math.min(i + 50, offen.length), gesamt: offen.length })
    }
    for (const z of zeilen) if (z.typ === typ && z.anilistId == null && z.malId != null) z.anilistId = zuId.get(z.malId) ?? null
    if (offen.length && typ === 'ANIME') await warte(o.wartezeit ?? 2100)
  }
}

/** Titelsuche für Zeilen ganz ohne ID: nur ein eindeutiger Treffer wird übernommen, sonst Vorschlag zur Prüfung (nichts wird geraten) */
async function sucheOhneId(z: PlanZustand, o: ImportOptionen) {
  const offen = z.zeilen.filter(r => r.anilistId == null && r.malId == null && r.titel.trim())
  for (let i = 0; i < offen.length; i++) {
    pruefeAbbruch(o)
    const r = offen[i]
    if (i > 0) await warte(o.wartezeit ?? 2100)
    o.melde?.({ phase: 'Titel suchen', aktuell: i + 1, gesamt: offen.length })
    try {
      const { treffer, kandidaten } = await sucheTitel(r.titel, r.typ)
      if (treffer) r.anilistId = treffer.id
      else if (kandidaten[0]) z.vorschlaege.set(r.nr, { id: kandidaten[0].id, titel: kandidaten[0].title?.romaji ?? kandidaten[0].title?.english ?? '?', cover: kandidaten[0].coverImage?.large ?? null })
    } catch (e: any) {
      if (e?.message === ABGEBROCHEN) throw e
      z.nichtZugeordnet.push({ nr: r.nr, titel: r.titel, typ: r.typ, grund: `Suche fehlgeschlagen: ${e?.message ?? e}` })
    }
  }
}

async function holeManga(ids: number[], cache: Map<number, MediaInfo>, o: ImportOptionen) {
  const offen = [...new Set(ids)].filter(id => !cache.has(id))
  const opt = ladeOpt(o, 'Manga laden', offen.length, MANGA_QUERY)
  for (let i = 0; i < offen.length; i += PAKET) {
    pruefeAbbruch(o)
    if (i > 0) await warte(o.wartezeit ?? 2100)
    const res = await anilistAbfrage(MANGA_QUERY, { ids: offen.slice(i, i + PAKET), page: 1 }, true)
    for (const m of res?.data?.Page?.media ?? []) cache.set(m.id, m)
    opt.fortschritt?.(Math.min(PAKET, offen.length - i))
  }
}

// ── Plan bauen (Trockenlauf) ─────────────────────────────────────────────────

const neuerZustand = (quelle: string, zeilen: QuellZeile[], uebersprungenDatei = 0): PlanZustand => ({
  quelle, zeilen, uebersprungenDatei, cache: new Map(), versucht: new Set(), mangaCache: new Map(),
  vorschlaege: new Map(), nichtZugeordnet: [],
})

/** Quelle AniList-Benutzername → Plan */
export async function planAusBenutzer(benutzer: string, anime: boolean, manga: boolean, o: ImportOptionen = {}): Promise<{ plan: Plan; zustand: PlanZustand }> {
  const name = benutzer.trim().replace(/^@/, '')
  if (!name) throw new Error('Bitte einen AniList-Benutzernamen eingeben.')
  if (!anime && !manga) throw new Error('Bitte Anime und/oder Manga auswählen.')
  const z = neuerZustand(`AniList-Benutzer „${name}“`, [])
  if (anime) z.zeilen.push(...await holeBenutzerListe(name, 'ANIME', z.mangaCache, o))
  if (anime && manga) await warte(o.wartezeit ?? 2100)
  if (manga) z.zeilen.push(...await holeBenutzerListe(name, 'MANGA', z.mangaCache, o))
  z.zeilen.forEach((r, i) => { r.nr = i + 1 })
  if (z.zeilen.length === 0) throw new Error(`Die Liste von „${name}“ ist leer.`)
  return { plan: await baueAusZustand(z, o), zustand: z }
}

/** Quelle Datei (MAL, CSV) → Plan */
export async function planAusDatei(liste: FremdListe, dateiname: string, o: ImportOptionen = {}): Promise<{ plan: Plan; zustand: PlanZustand }> {
  const z = neuerZustand(`${liste.format}${dateiname ? ` · ${dateiname}` : ''}`, liste.zeilen.map(r => ({ ...r })), liste.uebersprungen)
  await loeseMalIds(z.zeilen, o)
  await sucheOhneId(z, o)
  return { plan: await baueAusZustand(z, o), zustand: z }
}

/** Nimmt Vorschläge der Prüfliste an (Nummern der Zeilen) und baut den Plan neu – nur die neuen Titel werden nachgeladen */
export async function plusVorschlaege(z: PlanZustand, nummern: number[], o: ImportOptionen = {}): Promise<Plan> {
  for (const nr of nummern) {
    const v = z.vorschlaege.get(nr)
    const r = z.zeilen.find(x => x.nr === nr)
    if (v && r && r.anilistId == null) { r.anilistId = v.id; z.vorschlaege.delete(nr) }
  }
  return baueAusZustand(z, o)
}

async function baueAusZustand(z: PlanZustand, o: ImportOptionen): Promise<Plan> {
  const anime = z.zeilen.filter(r => r.typ === 'ANIME' && r.anilistId != null)
  const manga = z.zeilen.filter(r => r.typ === 'MANGA' && r.anilistId != null)
  const animeIds = anime.map(r => r.anilistId!)
  const ketten = ladeOpt(o, 'Staffeln und Verknüpfungen laden', animeIds.length, ANIME_QUERY)
  await ladeKetten(animeIds, z.cache, z.versucht, new Set(animeIds), ketten)
  if (manga.length) await holeManga(manga.map(r => r.anilistId!), z.mangaCache, o)

  o.melde?.({ phase: 'Serien zusammenfassen', aktuell: 0, gesamt: 0 })
  const a = ordneAnime(anime, z.cache)
  const m = ordneManga(manga, z.mangaCache)
  let serien: GeplanteSerie[] = [...a.serien, ...m.serien]

  // Ohne „18+ anzeigen“ werden 18+-Titel nicht übernommen
  let uebersprungen18 = 0
  if (!adultAnzeigen()) {
    uebersprungen18 = serien.filter(s => s.adult).length
    serien = serien.filter(s => !s.adult)
  }

  const nichtZugeordnet = [
    ...z.nichtZugeordnet,
    ...z.zeilen.filter(r => r.anilistId == null && !z.vorschlaege.has(r.nr) && !z.nichtZugeordnet.some(n => n.nr === r.nr))
      .map(r => ({ nr: r.nr, titel: r.titel, typ: r.typ, grund: r.malId != null ? 'Die MAL-ID ist bei AniList unbekannt' : 'Kein Treffer bei AniList' })),
    ...[...a.fehlend, ...m.fehlend].filter(r => r.anilistId != null)
      .map(r => ({ nr: r.nr, titel: r.titel, typ: r.typ, grund: 'AniList liefert diesen Titel nicht (gelöscht?)' })),
  ].sort((x, y) => x.nr - y.nr)

  const mitStatus = markiereVorhandene(serien)
  return {
    quelle: z.quelle,
    eintraegeQuelle: z.zeilen.length,
    serien: mitStatus,
    zusammengefasst: mitStatus.reduce((n, s) => n + Math.max(0, s.quellZeilen - 1), 0),
    nichtZugeordnet,
    pruefen: [...z.vorschlaege].map(([nr, v]) => {
      const r = z.zeilen.find(x => x.nr === nr)!
      return { nr, titel: r.titel, typ: r.typ, vorschlag: v }
    }),
    uebersprungen18,
    uebersprungenDatei: z.uebersprungenDatei,
  }
}

// ── Vorhandenes erkennen ─────────────────────────────────────────────────────

/** Eine Serie gilt als vorhanden, wenn ein Eintrag eine ihrer AniList-IDs hat, eine ihrer Staffeln in der Hauptlinie
 *  eines Eintrags steht oder ein Eintrag (ohne ID) genauso heißt – dann wird nichts angelegt oder verändert */
export function markiereVorhandene(serien: GeplanteSerie[]): PlanSerie[] {
  const eintraege = dbAll('SELECT anilist_id, type, title FROM entries')
  const eintragIds = new Set(eintraege.filter(e => e.anilist_id != null).map(e => e.anilist_id as number))
  const woIds = new Set(dbAll("SELECT related_anilist_id AS id FROM watch_order WHERE relation_type IN ('MAIN','PREQUEL','SEQUEL')").map(r => r.id as number))
  // Filme/OVAs/Specials stehen oft schon als Nebengeschichte (beliebige Zeile) im Eintrag ihrer Serie
  const alleWoIds = new Set(dbAll('SELECT related_anilist_id AS id FROM watch_order').map(r => r.id as number))
  const titel = new Set(eintraege.map(e => `${e.type}:${normalisiere(String(e.title))}`))
  return serien.map(s => {
    const gelistet = s.staffeln.filter(st => st.zeile).map(st => st.id)
    const ids = [...new Set([...s.kettenIds, ...gelistet, s.hauptId])]
    const namen = [s.titelAlle.romaji, s.titelAlle.english, s.titelAlle.native, s.titel].map(normalisiere).filter(Boolean)
    const vorhanden = ids.some(id => eintragIds.has(id))
      || s.kettenIds.some(id => woIds.has(id))
      || (s.nurNeben && ids.some(id => alleWoIds.has(id)))
      || namen.some(n => titel.has(`${s.typ}:${n}`))
    return { ...s, vorhanden }
  })
}

// ── Schreiben ────────────────────────────────────────────────────────────────

export interface ImportAblage {
  lies(schluessel: 'sicherung' | 'lauf'): Promise<string | null>
  schreib(schluessel: 'sicherung' | 'lauf', text: string): Promise<void>
}

export interface LaufInfo { zeit: string; quelle: string; anzahl: number; uuids: string[] }
export interface SchreibErgebnis { angelegt: number; vorhanden: number; staffeln: number }

/** Legt die neuen Serien aus dem Plan an (in einer Transaktion). Vorhandenes wird übersprungen. */
export function schreibePlan(plan: Plan): { ergebnis: SchreibErgebnis; uuids: string[] } {
  const db = getDb()
  // Frisch prüfen: seit „Prüfen“ kann etwas hinzugekommen sein
  const serien = markiereVorhandene(plan.serien)
  const uuids: string[] = []
  let staffeln = 0
  db.run('BEGIN TRANSACTION')
  try {
    for (const s of serien) {
      if (s.vorhanden) continue
      const mitStaffeln = s.staffeln.length > 1
      const abo = s.typ === 'ANIME' && s.status === 'ongoing' ? 1 : 0
      const id = dbRunGetId(
        `INSERT INTO entries (anilist_id, type, title, cover_url, genres, description, total_episodes, total_chapters, total_volumes,
           progress_episodes, progress_chapters, progress_volumes, status, rating, is_favorite, review, abonniert, finished_at, rewatch_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [s.hauptId, s.typ, s.titel, s.cover, JSON.stringify(s.genres), s.beschreibung, s.total, s.totalKapitel, s.totalBaende,
         s.typ === 'ANIME' ? s.fortschritt : 0, s.typ === 'MANGA' ? s.fortschritt : 0, s.typ === 'MANGA' ? s.baende : 0,
         s.status, s.bewertung, s.notiz, abo, s.beendet ? `${s.beendet} 12:00:00` : null, s.wiederholungen])
      const uuid = String(dbGet('SELECT uuid FROM entries WHERE id = ?', [id])?.uuid)
      uuids.push(uuid)
      merkeTitel(s.hauptId, s.titelAlle)
      if (mitStaffeln) {
        schreibeWatchOrder(id, s.staffeln.map(st => ({
          related_anilist_id: st.id, relation_type: st.relation, is_custom: 0, title: st.titel, cover_url: st.cover,
          total_episodes: st.total, progress_episodes: st.fortschritt, item_status: st.itemStatus,
          aired_episodes: st.aired, media_status: st.mediaStatus, neu_seit: null,
        })))
        for (const st of s.staffeln) {
          merkeTitel(st.id, st.titles)
          if (st.fortschritt > 0) schreibeVerlauf(id, st.id, 'folge', 0, st.fortschritt, 'import')
        }
        staffeln += s.staffeln.length
      } else if (s.typ === 'ANIME') {
        schreibeVerlauf(id, null, 'folge', 0, s.fortschritt, 'import')
      } else {
        schreibeVerlauf(id, null, 'kapitel', 0, s.fortschritt, 'import')
        schreibeVerlauf(id, null, 'band', 0, s.baende, 'import')
      }
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  schedulePersist()
  return { ergebnis: { angelegt: uuids.length, vorhanden: serien.filter(s => s.vorhanden).length, staffeln }, uuids }
}

/** Importiert den Plan: erst Sicherheitskopie, dann schreiben, dann den Lauf für „zurücknehmen“ merken */
export async function fuehreImportAus(plan: Plan, ablage: ImportAblage): Promise<SchreibErgebnis> {
  await ablage.schreib('sicherung', JSON.stringify(erstelleSicherung()))
  const { ergebnis, uuids } = schreibePlan(plan)
  if (uuids.length) {
    const info: LaufInfo = { zeit: new Date().toISOString(), quelle: plan.quelle, anzahl: uuids.length, uuids }
    await ablage.schreib('lauf', JSON.stringify(info))
  }
  return ergebnis
}

export async function letzterLauf(ablage: ImportAblage): Promise<Omit<LaufInfo, 'uuids'> | null> {
  const text = await ablage.lies('lauf').catch(() => null)
  if (!text) return null
  try {
    const i = JSON.parse(text) as LaufInfo
    return i.uuids?.length ? { zeit: i.zeit, quelle: i.quelle, anzahl: i.uuids.length } : null
  } catch { return null }
}

/** Löscht genau die Einträge des letzten Imports (Listen, Staffeln, Verlauf dazu) – nichts anderes */
export async function nimmZurueck(ablage: ImportAblage): Promise<{ geloescht: number }> {
  const text = await ablage.lies('lauf')
  if (!text) return { geloescht: 0 }
  const info = JSON.parse(text) as LaufInfo
  const db = getDb()
  let geloescht = 0
  db.run('BEGIN TRANSACTION')
  try {
    for (const uuid of info.uuids) {
      const e = dbGet('SELECT id FROM entries WHERE uuid = ?', [uuid])
      if (!e) continue
      loescheKern(e.id as number)
      db.run('DELETE FROM verlauf WHERE eintrag = ?', [uuid])
      geloescht++
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  await ablage.schreib('lauf', '')
  schedulePersist()
  return { geloescht }
}

// ── Antwort für die Oberfläche (ohne die schweren Felder) ────────────────────

export function alsErgebnis(plan: Plan) {
  const neu = plan.serien.filter(s => !s.vorhanden)
  return {
    quelle: plan.quelle,
    eintraegeQuelle: plan.eintraegeQuelle,
    serien: plan.serien.length,
    zusammengefasst: plan.zusammengefasst,
    vorhanden: plan.serien.length - neu.length,
    neu: neu.length,
    staffelnNeu: neu.reduce((n, s) => n + (s.staffeln.length > 1 ? s.staffeln.length : 0), 0),
    nichtZugeordnet: plan.nichtZugeordnet,
    pruefen: plan.pruefen,
    uebersprungen18: plan.uebersprungen18,
    uebersprungenDatei: plan.uebersprungenDatei,
    liste: plan.serien.map(s => ({
      titel: s.titel, typ: s.typ, vorhanden: s.vorhanden, status: s.status, bewertung: s.bewertung, quellZeilen: s.quellZeilen,
      staffeln: s.staffeln.map(st => ({ titel: st.titel, relation: st.relation, status: st.itemStatus, fortschritt: st.fortschritt, total: st.total, inListe: !!st.zeile })),
    })),
  }
}

// ── Handler (PC: IPC, Handy: direkter Aufruf) ────────────────────────────────

export interface ImportDeps {
  ablage: ImportAblage
  /** Dateiauswahl → Text (bei .gz schon entpackt); null = abgebrochen. Wirft bei unlesbaren Dateien. */
  waehleDatei(): Promise<{ name: string; text: string } | null>
}

export function registerImportLaufHandlers(ipcMain: IpcMain, deps: ImportDeps) {
  let aktuell: { plan: Plan; zustand: PlanZustand } | null = null
  let laeuft = false
  let abbruch = false

  /** Führt einen Lauf mit Fortschrittsmeldung, Abbrechen und Sperre gegen Doppelstart aus */
  async function lauf<T>(event: { sender?: unknown }, aufgabe: (o: ImportOptionen) => Promise<T>): Promise<T | { fehler: string }> {
    if (laeuft) return { fehler: 'Es läuft schon ein Import.' }
    laeuft = true
    abbruch = false
    const win = BrowserWindow.fromWebContents(event?.sender as any)
    const o: ImportOptionen = {
      abbrechen: () => abbruch,
      melde: p => { if (win && !win.isDestroyed()) win.webContents.send('importlauf:fortschritt', p) },
    }
    try {
      return await aufgabe(o)
    } catch (e: any) {
      return { fehler: e?.message === ABGEBROCHEN ? 'Abgebrochen – es wurde nichts importiert.' : String(e?.message ?? e) }
    } finally {
      laeuft = false
    }
  }

  ipcMain.handle('importlauf:anilist', (event, opts: { benutzer: string; anime: boolean; manga: boolean }) =>
    lauf(event, async o => {
      aktuell = await planAusBenutzer(opts.benutzer, !!opts.anime, !!opts.manga, o)
      return alsErgebnis(aktuell.plan)
    }))

  ipcMain.handle('importlauf:datei', async event => {
    // Dateiauswahl zuerst und ohne Umweg (am Handy nur direkt nach dem Tippen erlaubt)
    let datei: { name: string; text: string } | null
    try { datei = await deps.waehleDatei() } catch (e: any) { return { fehler: String(e?.message ?? e) } }
    if (!datei) return { abgebrochen: true }
    let liste: FremdListe
    try { liste = leseFremdeListe(datei.text) } catch (e: any) { return { fehler: String(e?.message ?? e) } }
    return lauf(event, async o => {
      aktuell = await planAusDatei(liste, datei!.name, o)
      return { format: liste.format, zuordnung: liste.zuordnung, ...alsErgebnis(aktuell.plan) }
    })
  })

  ipcMain.handle('importlauf:uebernehmen', (event, nummern: number[]) =>
    lauf(event, async o => {
      if (!aktuell) throw new Error('Bitte zuerst „Prüfen“.')
      aktuell.plan = await plusVorschlaege(aktuell.zustand, nummern ?? [], o)
      return alsErgebnis(aktuell.plan)
    }))

  ipcMain.handle('importlauf:starten', async event => {
    if (!aktuell) return { fehler: 'Bitte zuerst „Prüfen“.' }
    if (laeuft) return { fehler: 'Es läuft schon ein Import.' }
    laeuft = true
    try {
      const ergebnis = await fuehreImportAus(aktuell.plan, deps.ablage)
      aktuell = null
      return { ergebnis }
    } catch (e: any) {
      return { fehler: String(e?.message ?? e) }
    } finally {
      laeuft = false
    }
  })

  ipcMain.handle('importlauf:abbrechen', () => { abbruch = true; return true })
  ipcMain.handle('importlauf:letzter', () => letzterLauf(deps.ablage))
  ipcMain.handle('importlauf:zurueck', async () => {
    try { return await nimmZurueck(deps.ablage) } catch (e: any) { return { fehler: String(e?.message ?? e) } }
  })
}
