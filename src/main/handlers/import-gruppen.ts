// Reine Logik für die Importe (AniList-Benutzername, MAL, CSV): Werte umrechnen und die Titel einer Liste
// zu SERIEN zusammenfassen (eine Serie = ein Eintrag, die Staffeln stehen in der Watch-Order).
// Kein Netz, keine Datenbank – das macht anilist-import.ts. Die Watch-Order kommt aus demselben Code wie beim
// normalen Hinzufügen (serien.ts: kandidatenFuer), damit Import und manuelles Anlegen gleich aussehen.
import { Kandidat, MediaInfo, ausgestrahlt, kandidatenFuer } from './serien'

export type ListenStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'REPEATING'
export type EintragStatus = 'ongoing' | 'planned' | 'completed' | 'paused' | 'dropped'
export type MedienTyp = 'ANIME' | 'MANGA'

/** Eine Zeile der Quelle (AniList-Liste, MAL-Export, CSV) in einheitlicher Form */
export interface QuellZeile {
  nr: number
  typ: MedienTyp
  anilistId: number | null
  malId: number | null
  titel: string
  status: ListenStatus
  /** Folgen (Anime) bzw. Kapitel (Manga) */
  fortschritt: number
  baende: number
  /** schon auf 1–5 Sterne umgerechnet, null = nicht bewertet */
  bewertung: number | null
  wiederholungen: number
  notiz: string | null
  /** Datum der Fertigstellung (JJJJ-MM-TT) */
  beendet: string | null
}

export const HAUPTLINIE = new Set(['MAIN', 'PREQUEL', 'SEQUEL'])

// ── Werte umrechnen ──────────────────────────────────────────────────────────

export const STATUS_EINTRAG: Record<ListenStatus, EintragStatus> = {
  CURRENT: 'ongoing', REPEATING: 'ongoing', PLANNING: 'planned', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped',
}

/** Status einer Staffel in der Watch-Order: fertig / „Schaut“ (started) / geplant */
export function staffelStatusVon(s: ListenStatus): 'completed' | 'started' | 'planned' {
  return s === 'COMPLETED' ? 'completed' : s === 'CURRENT' || s === 'REPEATING' || s === 'PAUSED' ? 'started' : 'planned'
}

/** Bewertung nach dem Punkteformat der Nutzerin auf 1–5 Sterne (0/leer = nicht bewertet) */
export function sterneAus(score: number | null | undefined, format: string): number | null {
  const s = Number(score)
  if (!Number.isFinite(s) || s <= 0) return null
  const rund = (x: number) => Math.min(5, Math.max(1, Math.round(x)))
  switch (format) {
    case 'POINT_100': return rund(s / 20)
    case 'POINT_10_DECIMAL':
    case 'POINT_10': return rund(s / 2)
    case 'POINT_5': return rund(s)
    case 'POINT_3': return s <= 1 ? 1 : s === 2 ? 3 : 5
    default: return null
  }
}

/** MAL-Bewertung 1–10 → 1–5 Sterne */
export const sterneAus10 = (score: number | null | undefined) => sterneAus(score, 'POINT_10')

interface StatusZeile { status: ListenStatus | null; hauptlinie: boolean; erschienen: boolean }

/**
 * Status der ganzen Serie aus ihren Staffeln (null = nicht in der Liste, zählt als geplant).
 * Es zählen alle schon erschienenen Staffeln der Hauptlinie sowie jede gelistete Nebengeschichte, die nicht nur „geplant“ ist:
 *  • läuft irgendeine (Schaut/Wiederholt) → Laufend
 *  • alle zählenden fertig → Beendet
 *  • keine angefangen/fertig/pausiert/abgebrochen → Geplant
 *  • sonst Abgebrochen, wenn mehr abgebrochen als pausiert, sonst Pausiert (auch „eine fertig, die nächste erschienen, nicht gesehen“)
 */
export function serienStatus(zeilen: StatusZeile[]): EintragStatus {
  const st = (z: StatusZeile) => z.status ?? 'PLANNING'
  if (zeilen.some(z => z.status === 'CURRENT' || z.status === 'REPEATING')) return 'ongoing'
  const zaehlt = zeilen.filter(z => z.erschienen && (z.hauptlinie || (z.status !== null && z.status !== 'PLANNING')))
  if (zaehlt.length > 0 && zaehlt.every(z => st(z) === 'COMPLETED')) return 'completed'
  const begonnen = zeilen.filter(z => ['COMPLETED', 'PAUSED', 'DROPPED'].includes(st(z)))
  if (begonnen.length === 0) return 'planned'
  const abgebrochen = zeilen.filter(z => z.status === 'DROPPED').length
  const pausiert = zeilen.filter(z => z.status === 'PAUSED').length
  return abgebrochen > pausiert ? 'dropped' : 'paused'
}

export const datumText = (d?: { year?: number | null; month?: number | null; day?: number | null } | null): string | null =>
  d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}` : null

const keinHtml = (s: string | null | undefined) =>
  (s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim() || null

// ── Serien bilden ────────────────────────────────────────────────────────────

export interface GeplanteStaffel {
  id: number
  relation: string
  titel: string | null
  cover: string | null
  titles: { romaji?: string | null; english?: string | null; native?: string | null } | null
  total: number | null
  aired: number | null
  mediaStatus: string | null
  itemStatus: 'completed' | 'started' | 'planned'
  fortschritt: number
  /** Zeile der Quelle, die zu dieser Staffel gehört (null = nicht in der Liste, kommt als „geplant“ dazu) */
  zeile: QuellZeile | null
}

export interface GeplanteSerie {
  typ: MedienTyp
  /** AniList-ID der Hauptstaffel (= des Eintrags) */
  hauptId: number
  titel: string
  titelAlle: { romaji?: string | null; english?: string | null; native?: string | null }
  cover: string | null
  genres: string[]
  beschreibung: string | null
  adult: boolean
  status: EintragStatus
  bewertung: number | null
  wiederholungen: number
  notiz: string | null
  beendet: string | null
  /** Folgen/Kapitel/Bände des Eintrags (bei Anime mit Staffeln: die der Hauptstaffel) */
  fortschritt: number
  baende: number
  total: number | null
  totalKapitel: number | null
  totalBaende: number | null
  /** Staffeln und Nebengeschichten in Watch-Order-Reihenfolge; bei einer einzelnen Staffel ohne Verknüpfungen leer */
  staffeln: GeplanteStaffel[]
  /** Alle IDs, die zur Serie gehören (Hauptlinie, Nebengeschichten) – zum Erkennen „schon vorhanden“ */
  ids: number[]
  /** Nur die Hauptlinie (Staffeln) – gegen Watch-Order-Zeilen vorhandener Einträge geprüft */
  kettenIds: number[]
  /** Kette ohne TV-Staffel (Film, OVA, Special, ONA): kann schon als Nebengeschichte eines vorhandenen Eintrags stehen */
  nurNeben: boolean
  /** Wie viele Zeilen der Quelle zu dieser Serie zusammengefasst wurden */
  quellZeilen: number
}

const NEBEN_KANTEN = new Set(['PREQUEL', 'SEQUEL'])
const SERIENFORMATE = new Set(['TV', 'TV_SHORT'])

const startKey = (m: MediaInfo) => {
  const d = m.startDate
  return d?.year ? d.year * 10000 + (d.month ?? 1) * 100 + (d.day ?? 1) : 99999999
}
const formatRang = (m: MediaInfo) => (SERIENFORMATE.has(String(m.format)) ? 0 : m.format === 'MOVIE' ? 1 : 2)

/** Alle Medien, die über PREQUEL/SEQUEL zusammenhängen (Kette einer Serie) */
function kette(start: number, cache: Map<number, MediaInfo>, belegt: Set<number>): Map<number, MediaInfo> {
  const glieder = new Map<number, MediaInfo>()
  const warteschlange = [start]
  while (warteschlange.length) {
    const id = warteschlange.shift()!
    if (glieder.has(id) || belegt.has(id)) continue
    const m = cache.get(id)
    if (!m) { continue }
    glieder.set(id, m)
    // nicht abrufbare Glieder (AniList lieferte sie nicht) fehlen einfach in der Kette
    for (const k of m.relations?.edges ?? []) {
      if (k.node.type === 'ANIME' && NEBEN_KANTEN.has(k.relationType) && !glieder.has(k.node.id)) warteschlange.push(k.node.id)
    }
  }
  return glieder
}

/**
 * Erste Staffel einer Kette: ohne Prequel in der Kette; bei mehreren Anfängen TV vor Film vor Rest, dann der früheste.
 * Hat die Kette TV-Staffeln, ist es die erste TV-Staffel – ein vorgelagerter Film/OVA („Gaiden“) gibt der Serie nicht den
 * Namen, er steht als Vorgänger davor.
 */
export function ersteStaffel(glieder: Map<number, MediaInfo>): MediaInfo {
  const alle = [...glieder.values()]
  const hatVorgaenger = (m: MediaInfo, nur: (x: MediaInfo) => boolean) =>
    (m.relations?.edges ?? []).some(k => k.relationType === 'PREQUEL' && glieder.has(k.node.id) && nur(glieder.get(k.node.id)!))
  const tv = alle.filter(m => SERIENFORMATE.has(String(m.format)))
  const ohneVorgaenger = tv.length
    ? tv.filter(m => !hatVorgaenger(m, x => SERIENFORMATE.has(String(x.format))))
    : alle.filter(m => !hatVorgaenger(m, () => true))
  const kandidaten = ohneVorgaenger.length ? ohneVorgaenger : (tv.length ? tv : alle)
  return [...kandidaten].sort((a, b) => formatRang(a) - formatRang(b) || startKey(a) - startKey(b) || a.id - b.id)[0]
}

interface Teilnehmer { haupt: MediaInfo; glieder: Map<number, MediaInfo>; kandidaten: Map<number, Kandidat>; reihenfolge: Kandidat[]; extra: Kandidat[]; zeilen: QuellZeile[] }

export interface AnimeErgebnis { serien: GeplanteSerie[]; fehlend: QuellZeile[] }

/**
 * Fasst Anime-Zeilen zu Serien zusammen.
 *  1. Kette: alles, was über PREQUEL/SEQUEL zusammenhängt, ist eine Serie; die erste Staffel ist die Hauptstaffel.
 *  2. Ketten ohne TV-Staffel (Filme, OVA, Specials, ONA), die zu einer anderen Serie gehören (SIDE_STORY, SPIN_OFF, PARENT …),
 *     werden Nebengeschichten dieser Serie; ohne Zuordnung bleiben sie ein eigener Eintrag.
 *  3. Die Watch-Order kommt aus kandidatenFuer (wie beim normalen Hinzufügen); Zeilen der Liste legen ihren Stand darüber.
 * `cache` muss die Ketten schon enthalten (ladeKetten).
 */
export function ordneAnime(zeilen: QuellZeile[], cache: Map<number, MediaInfo>): AnimeErgebnis {
  const fehlend: QuellZeile[] = []
  const nachId = new Map<number, QuellZeile>()
  for (const z of zeilen) {
    if (z.anilistId == null || !cache.get(z.anilistId)) { fehlend.push(z); continue }
    // dieselbe AniList-ID zweimal: die erste Zeile gilt
    if (!nachId.has(z.anilistId)) nachId.set(z.anilistId, z)
  }

  // 1) Ketten bilden (Reihenfolge der Liste, jede ID nur einmal)
  const belegt = new Set<number>()
  const ketten: Array<{ glieder: Map<number, MediaInfo>; haupt: MediaInfo; mitTV: boolean }> = []
  for (const id of nachId.keys()) {
    if (belegt.has(id)) continue
    const glieder = kette(id, cache, belegt)
    glieder.forEach((_, gid) => belegt.add(gid))
    ketten.push({ glieder, haupt: ersteStaffel(glieder), mitTV: [...glieder.values()].some(m => SERIENFORMATE.has(String(m.format))) })
  }
  const echte = ketten.filter(k => k.mitTV).sort((a, b) => startKey(a.haupt) - startKey(b.haupt) || a.haupt.id - b.haupt.id)
  const anhang = ketten.filter(k => !k.mitTV).sort((a, b) => startKey(a.haupt) - startKey(b.haupt) || a.haupt.id - b.haupt.id)

  const teilnehmer: Teilnehmer[] = []
  // Zeilen der Liste gehören der Serie, deren Kette (oder Anhang) sie sind – nie zwei Serien zugleich
  const eigner = new Map<number, Teilnehmer>()
  const bauen = (k: { glieder: Map<number, MediaInfo>; haupt: MediaInfo }) => {
    const { kandidaten, reihenfolge } = kandidatenFuer(k.haupt, cache)
    const t: Teilnehmer = { haupt: k.haupt, glieder: k.glieder, kandidaten, reihenfolge: [...reihenfolge], extra: [], zeilen: [] }
    teilnehmer.push(t)
    k.glieder.forEach((_, id) => eigner.set(id, t))
    return t
  }
  for (const k of echte) bauen(k)

  // 2) Anhänge: an die erste Serie, deren Watch-Order eines ihrer Glieder enthält; sonst eigener Eintrag
  for (const a of anhang) {
    const ziel = teilnehmer.find(t => [...a.glieder.keys()].some(id => t.kandidaten.has(id)))
    if (!ziel) { bauen(a); continue }
    a.glieder.forEach((_, id) => eigner.set(id, ziel))
    for (const [id, m] of a.glieder) {
      if (ziel.kandidaten.has(id)) continue
      // Glied ohne eigene Verknüpfung zur Serie (z. B. 2. Film der Nebengeschichte): als Nebengeschichte anhängen
      const wurzel = [...a.glieder.keys()].find(g => ziel.kandidaten.has(g)) ?? ziel.haupt.id
      const k: Kandidat = { id, media: m, relation: 'SIDE_STORY', quelle: wurzel }
      ziel.kandidaten.set(id, k)
      ziel.extra.push(k)
    }
  }

  // 3) Zeilen der Liste den Serien zuordnen
  for (const [id, z] of nachId) eigner.get(id)?.zeilen.push(z)

  return { serien: teilnehmer.map(t => baueSerie(t)), fehlend }
}

function baueSerie(t: Teilnehmer): GeplanteSerie {
  const haupt = t.haupt
  const nachId = new Map(t.zeilen.map(z => [z.anilistId!, z]))
  const alle = [...t.reihenfolge, ...t.extra]
  const staffeln: GeplanteStaffel[] = alle.map(k => {
    const z = nachId.get(k.id) ?? null
    const total = k.media.episodes ?? null
    const itemStatus = z ? staffelStatusVon(z.status) : 'planned'
    let fortschritt = z?.fortschritt ?? 0
    if (itemStatus === 'completed' && total) fortschritt = total
    else if (total != null) fortschritt = Math.min(fortschritt, total)
    return {
      id: k.id, relation: k.relation, titel: k.media.title?.romaji ?? k.media.title?.english ?? null,
      cover: k.media.coverImage?.large ?? null, titles: k.media.title ?? null, total, aired: ausgestrahlt(k.media, null), mediaStatus: k.media.status ?? null,
      itemStatus, fortschritt, zeile: z,
    }
  })
  const mehrere = staffeln.length > 1
  const hauptZeile = staffeln.find(s => s.id === haupt.id)

  const bewertet = t.zeilen.map(z => z.bewertung).filter((b): b is number => b != null)
  const fertig = t.zeilen.filter(z => z.status === 'COMPLETED' && z.beendet).map(z => z.beendet!).sort()
  const notizen = t.zeilen.filter(z => z.notiz?.trim())
  const titelDe = (id: number) => staffeln.find(s => s.id === id)?.titel ?? ''

  return {
    typ: 'ANIME',
    hauptId: haupt.id,
    titel: haupt.title?.romaji ?? haupt.title?.english ?? haupt.title?.native ?? `AniList ${haupt.id}`,
    titelAlle: haupt.title ?? {},
    cover: haupt.coverImage?.large ?? null,
    genres: haupt.genres ?? [],
    beschreibung: keinHtml(haupt.description),
    adult: !!haupt.isAdult,
    status: serienStatus(staffeln.map(s => ({
      status: s.zeile?.status ?? null, hauptlinie: HAUPTLINIE.has(s.relation), erschienen: s.mediaStatus !== 'NOT_YET_RELEASED',
    }))),
    bewertung: bewertet.length ? Math.min(5, Math.max(1, Math.round(bewertet.reduce((a, b) => a + b, 0) / bewertet.length))) : null,
    wiederholungen: Math.max(0, ...t.zeilen.map(z => z.wiederholungen)),
    notiz: notizen.length === 0 ? null
      : notizen.length === 1 && !mehrere ? notizen[0].notiz!.trim()
      : notizen.map(z => `${titelDe(z.anilistId!) || z.titel}: ${z.notiz!.trim()}`).join('\n\n'),
    beendet: fertig.length ? fertig[fertig.length - 1] : null,
    fortschritt: hauptZeile?.fortschritt ?? 0,
    baende: 0,
    total: haupt.episodes ?? null,
    totalKapitel: null,
    totalBaende: null,
    staffeln: mehrere ? staffeln : [],
    ids: [...new Set([...alle.map(k => k.id), ...t.glieder.keys()])],
    kettenIds: [...new Set([...t.glieder.keys(), ...staffeln.filter(s => HAUPTLINIE.has(s.relation)).map(s => s.id)])],
    nurNeben: ![...t.glieder.values()].some(m => SERIENFORMATE.has(String(m.format))),
    quellZeilen: t.zeilen.length,
  }
}

/** Manga: je Titel ein Eintrag (keine Staffeln, Verknüpfungen werden nicht zusammengeführt) */
export function ordneManga(zeilen: QuellZeile[], cache: Map<number, MediaInfo>): AnimeErgebnis {
  const fehlend: QuellZeile[] = []
  const serien: GeplanteSerie[] = []
  const gesehen = new Set<number>()
  for (const z of zeilen) {
    const m = z.anilistId != null ? cache.get(z.anilistId) : undefined
    if (!m) { fehlend.push(z); continue }
    if (gesehen.has(m.id)) continue
    gesehen.add(m.id)
    const fertig = z.status === 'COMPLETED'
    serien.push({
      typ: 'MANGA', hauptId: m.id,
      titel: m.title?.romaji ?? m.title?.english ?? m.title?.native ?? `AniList ${m.id}`,
      titelAlle: m.title ?? {}, cover: m.coverImage?.large ?? null, genres: m.genres ?? [],
      beschreibung: keinHtml(m.description), adult: !!m.isAdult,
      status: STATUS_EINTRAG[z.status], bewertung: z.bewertung, wiederholungen: z.wiederholungen,
      notiz: z.notiz?.trim() || null, beendet: fertig ? z.beendet : null,
      fortschritt: fertig && m.chapters ? m.chapters : z.fortschritt,
      baende: fertig && m.volumes ? m.volumes : z.baende,
      total: null, totalKapitel: m.chapters ?? null, totalBaende: m.volumes ?? null,
      staffeln: [], ids: [m.id], kettenIds: [m.id], nurNeben: false, quellZeilen: 1,
    })
  }
  return { serien, fehlend }
}
