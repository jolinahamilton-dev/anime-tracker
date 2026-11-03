// Vorschläge („✨ Für dich“ auf der Einpflegen-Seite):
//  • empfehlungen – AniList-Empfehlungen zu den Lieblingstiteln, gewichtet nach eigener Bewertung
//  • adaptionen   – Manga zum gesehenen Anime und Anime zum gelesenen Manga
//  • saison       – laufende Saison, sortiert nach dem eigenen Genre-Profil
//  • geplant      – die eigene Geplant-Liste, eingeschätzt nach dem Genre-Profil (ohne AniList)
// Die AniList-Teile werden höchstens einmal am Tag berechnet und lokal zwischengespeichert
// (app_meta 'vorschlaege_cache', wird weder abgeglichen noch gesichert). „Kein Interesse“ steht in
// der Tabelle vorschlag_aus und wird als Vereinigung zwischen den Geräten abgeglichen.
import type { IpcMain } from 'electron'
import { dbAll, dbGet, dbRun } from '../../db/database'
import { anilistAbfrage, normalisiere } from './anilist'
import type { AniListSearchResult, GeplantVorschlag, MediaType, Vorschlag, VorschlagAntwort } from '../../types'

const CACHE_SCHLUESSEL = 'vorschlaege_cache'
const CACHE_DAUER_MS = 24 * 60 * 60 * 1000
// Nach einem Fehler nicht bei jedem Öffnen der Seite erneut anfragen (AniList-Limit)
const FEHLER_PAUSE_MS = 10 * 60 * 1000
const ANFRAGE_ABSTAND_MS = 700

const MAX_SAMEN = 15
const EMPFEHLUNGEN_JE_SAMEN = 10
const MAX_JE_LISTE = 20
// Für Hauptserien typische Formate (Fortsetzungen erkennt man an einem PREQUEL dieser Art)
const SERIEN_FORMATE = new Set(['TV', 'TV_SHORT', 'ONA', 'MOVIE'])

// ── AniList-Abfragen ──

// Dieselben Felder wie bei der Suche (anilist:search), dazu Bewertung, Beliebtheit und Saison.
// Zusatzfelder werden in alsSuchergebnis() wieder entfernt.
const DETAIL_FELDER = `
  id
  type
  format
  title { romaji native english }
  coverImage { large }
  genres
  description(asHtml: false)
  episodes
  chapters
  volumes
  status
  isAdult
  averageScore
  popularity
  season
  seasonYear
  startDate { year }
  relations {
    edges {
      relationType
      node {
        id
        type
        format
        title { romaji }
        coverImage { large }
      }
    }
  }
`

const EMPFEHLUNG_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      recommendations(sort: RATING_DESC, perPage: ${EMPFEHLUNGEN_JE_SAMEN}) {
        nodes {
          rating
          mediaRecommendation { id type isAdult }
        }
      }
    }
  }
}
`

const RELATIONEN_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      format
      startDate { year month }
      relations {
        edges {
          relationType
          node { id type format status chapters episodes popularity isAdult startDate { year month } }
        }
      }
    }
  }
}
`

const DETAIL_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids) {${DETAIL_FELDER}}
  }
}
`

const SAISON_QUERY = `
query ($season: MediaSeason, $jahr: Int) {
  Page(perPage: 50) {
    media(season: $season, seasonYear: $jahr, type: ANIME, format_in: [TV, TV_SHORT, ONA], isAdult: false, sort: POPULARITY_DESC) {${DETAIL_FELDER}}
  }
}
`

const warte = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Zählt die Anfragen einer Berechnung und hält etwas Abstand zwischen ihnen */
function erstelleAbfrage() {
  let anzahl = 0
  const abfrage = async (query: string, variables: Record<string, unknown>) => {
    if (anzahl > 0) await warte(ANFRAGE_ABSTAND_MS)
    anzahl++
    return anilistAbfrage(query, variables, true)
  }
  return { abfrage, anzahl: () => anzahl }
}

/** Anzahl der AniList-Anfragen der letzten vollständigen Berechnung (zur Kontrolle) */
export let letzteAnfragenAnzahl = 0

// ── Eigene Daten ──

interface EigenerEintrag {
  id: number
  anilist_id: number | null
  type: MediaType
  title: string
  nickname: string | null
  cover_url: string | null
  genres: string[]
  total_episodes: number | null
  total_chapters: number | null
  status: string
  rating: number | null
  is_favorite: number
  zuletzt: string
}

function leseEintraege(): EigenerEintrag[] {
  return dbAll(`SELECT id, anilist_id, type, title, nickname, cover_url, genres, total_episodes, total_chapters,
      status, rating, is_favorite, COALESCE(finished_at, updated_at, created_at) AS zuletzt FROM entries`)
    .map(r => {
      let genres: string[] = []
      try { const g = JSON.parse(String(r.genres ?? '[]')); if (Array.isArray(g)) genres = g.map(String) } catch { /* leer lassen */ }
      return { ...r, genres, rating: r.rating == null ? null : Number(r.rating), is_favorite: Number(r.is_favorite) } as EigenerEintrag
    })
}

const anzeigeName = (e: EigenerEintrag) => e.nickname || e.title

/** AniList-IDs, die nicht vorgeschlagen werden: alles in der Liste (auch Staffeln) und „Kein Interesse“.
 *  bekannt() prüft zusätzlich den Titel – falls ein Eintrag mit einer anderen AniList-ID verknüpft ist. */
function ausgeschlossen() {
  const inListe = new Set<number>()
  const titel = new Set<string>()
  for (const r of dbAll('SELECT anilist_id AS id, type, title, nickname FROM entries')) {
    if (r.id != null) inListe.add(Number(r.id))
    for (const t of [r.title, r.nickname]) if (t) titel.add(`${r.type}|${normalisiere(String(t))}`)
  }
  for (const r of dbAll('SELECT related_anilist_id AS id FROM watch_order')) inListe.add(Number(r.id))
  const aus = new Set(dbAll('SELECT anilist_id AS id FROM vorschlag_aus').map(r => Number(r.id)))
  const bekannt = (m: { id: number; type: string; title?: { romaji?: string | null; english?: string | null; native?: string | null } }) =>
    inListe.has(m.id) || aus.has(m.id) ||
    [m.title?.romaji, m.title?.english, m.title?.native].some(t => t && titel.has(`${m.type}|${normalisiere(t)}`))
  return { inListe, aus, bekannt }
}

// ── Genre-Profil ──

interface Profil {
  /** Abweichung der Genre-Durchschnittsbewertung vom Gesamtdurchschnitt (gedämpft nach Anzahl) */
  abweichung: Map<string, number>
  /** Genres der Favoriten */
  lieblinge: Set<string>
}

const MIN_JE_GENRE = 3
const DAEMPFUNG = 3 // bei n Bewertungen zählt die Abweichung n / (n + 3)

function genreProfil(eintraege: EigenerEintrag[]): Profil {
  const bewertet = eintraege.filter(e => e.rating != null)
  const abweichung = new Map<string, number>()
  if (bewertet.length) {
    const mittel = bewertet.reduce((s, e) => s + e.rating!, 0) / bewertet.length
    const jeGenre = new Map<string, { summe: number; n: number }>()
    for (const e of bewertet) {
      for (const g of new Set(e.genres)) {
        const x = jeGenre.get(g) ?? { summe: 0, n: 0 }
        x.summe += e.rating!
        x.n++
        jeGenre.set(g, x)
      }
    }
    for (const [g, { summe, n }] of jeGenre) {
      if (n < MIN_JE_GENRE) continue
      abweichung.set(g, (summe / n - mittel) * n / (n + DAEMPFUNG))
    }
  }
  const lieblinge = new Set(eintraege.filter(e => e.is_favorite).flatMap(e => e.genres))
  return { abweichung, lieblinge }
}

/** Wie gut passen die Genres zum Profil? wert ≈ −1…+1 (Durchschnitt der bekannten Genres) */
function passung(genres: string[], profil: Profil): { wert: number; passend: string[]; unpassend: string[] } {
  const bekannt = genres.filter(g => profil.abweichung.has(g)).map(g => ({ g, a: profil.abweichung.get(g)! }))
  const wert = bekannt.length ? bekannt.reduce((s, x) => s + x.a, 0) / bekannt.length : 0
  const passend = bekannt.filter(x => x.a > 0.1).sort((a, b) => b.a - a.a).slice(0, 2).map(x => x.g)
  const unpassend = bekannt.filter(x => x.a < -0.1).sort((a, b) => a.a - b.a).slice(0, 2).map(x => x.g)
  return { wert, passend, unpassend }
}

// ── Hilfen ──

const SAISON_NAME: Record<string, string> = { WINTER: 'Winter', SPRING: 'Frühling', SUMMER: 'Sommer', FALL: 'Herbst' }

function aktuelleSaison(jetzt = new Date()): { season: string; jahr: number } {
  const m = jetzt.getMonth() // 0 = Januar
  return { season: m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL', jahr: jetzt.getFullYear() }
}

function zeitraumVon(m: any): string | null {
  if (m.season && m.seasonYear) return `${SAISON_NAME[m.season] ?? m.season} ${m.seasonYear}`
  const jahr = m.seasonYear ?? m.startDate?.year
  return jahr ? String(jahr) : null
}

/** Genau die Form eines Suchergebnisses – die Oberfläche nutzt dafür denselben Hinzufügen-Ablauf */
function alsSuchergebnis(m: any): AniListSearchResult {
  return {
    id: m.id,
    title: { romaji: m.title?.romaji ?? '', native: m.title?.native ?? null, english: m.title?.english ?? null },
    type: m.type,
    format: m.format ?? null,
    coverImage: { large: m.coverImage?.large ?? '' },
    genres: m.genres ?? [],
    description: m.description ?? null,
    episodes: m.episodes ?? null,
    chapters: m.chapters ?? null,
    volumes: m.volumes ?? null,
    status: m.status ?? '',
    relations: {
      edges: (m.relations?.edges ?? []).filter((e: any) => e?.node).map((e: any) => ({
        relationType: e.relationType,
        node: { id: e.node.id, title: { romaji: e.node.title?.romaji ?? '' }, type: e.node.type, coverImage: { large: e.node.coverImage?.large ?? '' } },
      })),
    },
  }
}

function vorschlag(m: any, quelle: Vorschlag['quelle'], grund: string, gewicht: number): Vorschlag {
  return {
    media: alsSuchergebnis(m),
    quelle,
    grund,
    gewicht: Math.round(gewicht * 1000) / 1000,
    score: typeof m.averageScore === 'number' ? m.averageScore : null,
    zeitraum: zeitraumVon(m),
  }
}

/** Fortsetzung einer Anime-Serie? (hat einen Vorgänger als Serie/Film) – liefert die Vorgänger-IDs */
function vorgaenger(m: any): number[] {
  if (m.type !== 'ANIME') return []
  return (m.relations?.edges ?? [])
    .filter((e: any) => e?.relationType === 'PREQUEL' && e.node?.type === 'ANIME' && SERIEN_FORMATE.has(e.node.format))
    .map((e: any) => e.node.id as number)
}

function teile<T>(liste: T[], groesse: number): T[][] {
  const t: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) t.push(liste.slice(i, i + groesse))
  return t
}

type Abfrage = ReturnType<typeof erstelleAbfrage>['abfrage']

async function holeDetails(abfrage: Abfrage, ids: number[]): Promise<Map<number, any>> {
  const details = new Map<number, any>()
  for (const stueck of teile([...new Set(ids)], 50)) {
    const res = await abfrage(DETAIL_QUERY, { ids: stueck })
    for (const m of res?.data?.Page?.media ?? []) if (m?.id) details.set(m.id, m)
  }
  return details
}

// ── 1. Empfehlungen zu den Lieblingstiteln ──

function samenGewicht(e: EigenerEintrag): number {
  const sterne = e.rating == null ? 0 : e.rating >= 5 ? 1 : e.rating >= 4 ? 0.7 : e.rating >= 3 ? 0.3 : 0
  if (e.rating == null && !e.is_favorite) return e.status === 'completed' ? 0.4 : 0
  return sterne + (e.is_favorite ? 0.5 : 0)
}

function waehleSamen(eintraege: EigenerEintrag[]): EigenerEintrag[] {
  const mitId = eintraege.filter(e => e.anilist_id && e.status !== 'planned' && e.status !== 'dropped')
  let kandidaten = mitId.filter(e => (e.rating ?? 0) >= 4 || e.is_favorite)
  // Wenig bewertet → beendete Titel dazunehmen (ohne die schlecht bewerteten)
  if (kandidaten.length < 5) {
    kandidaten = [...kandidaten, ...mitId.filter(e => e.status === 'completed' && !kandidaten.includes(e) && (e.rating == null || e.rating >= 3))]
  }
  const sortiert = kandidaten
    .map(e => ({ e, w: samenGewicht(e) }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.w - a.w || b.e.zuletzt.localeCompare(a.e.zuletzt))
    .map(x => x.e)
  // Gemischt: bis zu 10 Anime und 5 Manga, dann mit dem Rest auffüllen
  const anime = sortiert.filter(e => e.type === 'ANIME').slice(0, 10)
  const manga = sortiert.filter(e => e.type === 'MANGA').slice(0, 5)
  const samen = [...anime, ...manga]
  for (const e of sortiert) {
    if (samen.length >= MAX_SAMEN) break
    if (!samen.includes(e)) samen.push(e)
  }
  // Dieselbe AniList-ID nur einmal (z. B. doppelt angelegt)
  const gesehen = new Set<number>()
  return samen.filter(e => !gesehen.has(e.anilist_id!) && gesehen.add(e.anilist_id!)).slice(0, MAX_SAMEN)
}

interface EmpfehlungsKandidat {
  id: number
  summe: number
  beitraege: Array<{ samen: EigenerEintrag; wert: number }>
}

async function sammleEmpfehlungen(abfrage: Abfrage, eintraege: EigenerEintrag[], gesperrt: Set<number>): Promise<EmpfehlungsKandidat[]> {
  const samen = waehleSamen(eintraege)
  if (!samen.length) return []
  const samenVonId = new Map(samen.map(e => [e.anilist_id!, e]))
  const kandidaten = new Map<number, EmpfehlungsKandidat>()
  const res = await abfrage(EMPFEHLUNG_QUERY, { ids: samen.map(e => e.anilist_id) })
  for (const m of res?.data?.Page?.media ?? []) {
    const s = samenVonId.get(m?.id)
    if (!s) continue
    const knoten = (m.recommendations?.nodes ?? []).filter((n: any) =>
      n?.rating > 0 && n.mediaRecommendation && !n.mediaRecommendation.isAdult &&
      (n.mediaRecommendation.type === 'ANIME' || n.mediaRecommendation.type === 'MANGA'))
    if (!knoten.length) continue
    const hoechste = Math.max(...knoten.map((n: any) => n.rating as number))
    const gewicht = samenGewicht(s)
    for (const n of knoten) {
      const id = n.mediaRecommendation.id as number
      if (gesperrt.has(id)) continue
      // Wurzel: auch die weniger stark empfohlenen Titel eines Samens zählen spürbar
      const wert = gewicht * Math.sqrt(n.rating / hoechste)
      const k = kandidaten.get(id) ?? { id, summe: 0, beitraege: [] }
      k.summe += wert
      k.beitraege.push({ samen: s, wert })
      kandidaten.set(id, k)
    }
  }
  return [...kandidaten.values()].sort((a, b) => b.summe - a.summe)
}

function empfehlungsGrund(k: EmpfehlungsKandidat): string {
  const namen: string[] = []
  const gesehen = new Set<number>()
  for (const b of [...k.beitraege].sort((a, b) => b.wert - a.wert)) {
    if (gesehen.has(b.samen.id)) continue
    gesehen.add(b.samen.id)
    const s = b.samen
    const zeichen = s.is_favorite ? '♥' : s.rating != null ? `${s.rating}★` : null
    namen.push(zeichen ? `${anzeigeName(s)} (${zeichen})` : anzeigeName(s))
    if (namen.length === 2) break
  }
  return `Weil du ${namen.join(' und ')} mochtest`
}

// ── 2. Adaptionen (Manga zum Anime, Anime zum Manga) ──

// AniList nennt die Verbindung Anime ↔ Manga meist in beide Richtungen ADAPTATION – was zuerst da
// war, verrät erst das Startdatum
const ADAPTIONS_BEZIEHUNG = new Set(['SOURCE', 'ADAPTATION'])
const startMonat = (m: any): number | null => m?.startDate?.year ? m.startDate.year * 12 + (m.startDate.month ?? 12) : null
const ANIME_FORMAT_RANG: Record<string, number> = { TV: 0, ONA: 1, TV_SHORT: 2, MOVIE: 3 }

interface AdaptionsKandidat {
  id: number
  quelle: EigenerEintrag
  knoten: any
  /** Nur bei Manga zum Anime: erschien der Manga vor dem Anime (also seine Vorlage)? */
  vorlage: boolean
  /** Format des eigenen Titels (TV, MOVIE …) */
  quellFormat: string | null
  gewicht: number
  /** Nur bei Manga zum Anime: geht der Manga sicher über den Anime hinaus? */
  gehtWeiter: boolean
}

/** Folgen der ganzen Hauptlinie (Vorgänger, Serie, Fortsetzungen) – laut Watch-Order, sonst des Eintrags */
function folgenDerHauptlinie(e: EigenerEintrag): number | null {
  const r = dbGet(`SELECT SUM(total_episodes) AS n FROM watch_order
    WHERE entry_id = ? AND relation_type IN ('MAIN', 'PREQUEL', 'SEQUEL')`, [e.id])
  const n = Number(r?.n ?? 0)
  return n > 0 ? n : e.total_episodes
}

async function sammleAdaptionen(abfrage: Abfrage, eintraege: EigenerEintrag[], inListe: Set<number>, aus: Set<number>): Promise<AdaptionsKandidat[]> {
  const quellen = eintraege.filter(e => e.anilist_id && (e.type === 'ANIME'
    ? ['completed', 'ongoing', 'started'].includes(e.status)
    : !['planned', 'dropped'].includes(e.status)))
  const quelleVonId = new Map<number, EigenerEintrag>()
  for (const e of quellen) if (!quelleVonId.has(e.anilist_id!)) quelleVonId.set(e.anilist_id!, e)

  const kandidaten = new Map<number, AdaptionsKandidat>()
  for (const stueck of teile([...quelleVonId.keys()], 50)) {
    const res = await abfrage(RELATIONEN_QUERY, { ids: stueck })
    for (const m of res?.data?.Page?.media ?? []) {
      const q = quelleVonId.get(m?.id)
      if (!q) continue
      const gegenseite = (m.relations?.edges ?? []).filter((e: any) => e?.node && e.node.type !== q.type)
      // Schon ein Gegenstück in der Liste (z. B. eine andere Manga-Fassung) → nichts vorschlagen
      if (gegenseite.some((e: any) => inListe.has(e.node.id))) continue
      const passende = gegenseite
        .filter((e: any) => ADAPTIONS_BEZIEHUNG.has(e.relationType) && !e.node.isAdult && e.node.status !== 'CANCELLED' && !aus.has(e.node.id))
        .filter((e: any) => q.type === 'ANIME' ? e.node.format === 'MANGA' : e.node.format in ANIME_FORMAT_RANG)
      if (!passende.length) continue
      // Vorlage = Manga ist vor dem Anime erschienen (gleicher Monat: eher eine Manga-Fassung zum Anime)
      const animeStart = startMonat(m)
      const istVorlage = (e: any) => e.relationType === 'SOURCE' ||
        (animeStart !== null && startMonat(e.node) !== null && startMonat(e.node)! < animeStart)
      // Bei mehreren Fassungen: beim Anime die Vorlage vor späteren Manga-Fassungen, beim Manga
      // Serie vor Film – dann jeweils die bekannteste
      const rang = (e: any) => q.type === 'ANIME' ? (istVorlage(e) ? 0 : 1) : ANIME_FORMAT_RANG[e.node.format]
      passende.sort((a: any, b: any) => rang(a) - rang(b) || (b.node.popularity ?? 0) - (a.node.popularity ?? 0))
      const n = passende[0].node
      const vorlage = q.type === 'ANIME' && istVorlage(passende[0])
      let gehtWeiter = false
      if (vorlage) {
        // Faustregel: ein Anime verarbeitet etwa 2–4 Kapitel pro Folge – erst mehr als 5 Kapitel je Folge
        // zählen als „mehr Stoff“ (Erased: 49 Kapitel auf 12 Folgen ist komplett verfilmt). Bei Filmen,
        // Kurzem (Crossover, Specials) und ohne Folgenzahl wird das nicht behauptet.
        const folgen = m.format === 'MOVIE' ? null : folgenDerHauptlinie(q)
        gehtWeiter = n.status === 'RELEASING' ||
          (!!folgen && folgen >= 10 && typeof n.chapters === 'number' && n.chapters > folgen * 5)
      }
      const basis = (q.rating ?? 3) / 5 + (q.is_favorite ? 0.5 : 0)
      const gewicht = basis + (gehtWeiter ? 0.3 : 0) + (n.status === 'NOT_YET_RELEASED' ? -0.2 : 0) + Math.log10((n.popularity ?? 0) + 1) / 10
      const alt = kandidaten.get(n.id)
      if (!alt || alt.gewicht < gewicht) kandidaten.set(n.id, { id: n.id, quelle: q, knoten: n, vorlage, quellFormat: m.format ?? null, gewicht, gehtWeiter })
    }
  }
  return [...kandidaten.values()].sort((a, b) => b.gewicht - a.gewicht)
}

function adaptionsGrund(k: AdaptionsKandidat): string {
  const name = anzeigeName(k.quelle)
  if (k.quelle.type === 'ANIME') {
    const film = k.quellFormat === 'MOVIE'
    if (!k.vorlage) return film ? `Manga zum Film ${name}` : `Manga zu ${name}`
    if (k.gehtWeiter) return `Manga zu ${name} – geht weiter, wo der Anime aufhört`
    return `Manga zu ${name} – die Vorlage zum ${film ? 'Film' : 'Anime'}`
  }
  const n = k.knoten
  const zusatz = n.status === 'NOT_YET_RELEASED' ? ' – angekündigt'
    : n.status === 'RELEASING' ? ' – läuft gerade'
    : n.format === 'MOVIE' ? ' – als Film'
    : n.episodes ? ` · ${n.episodes} Folgen` : ''
  return `Anime zu deinem Manga ${name}${zusatz}`
}

// ── 3. Diese Saison ──

function saisonVorschlaege(medien: any[], eintraege: EigenerEintrag[], profil: Profil, inListe: Set<number>, aus: Set<number>): Vorschlag[] {
  // Vorgänger in der eigenen Liste → zu welchem Eintrag gehört er (auch als Staffel in der Watch-Order)?
  const eintragZuId = new Map<number, EigenerEintrag>()
  const eintragVonId = new Map(eintraege.map(e => [e.id, e]))
  for (const r of dbAll('SELECT entry_id, related_anilist_id FROM watch_order')) {
    const e = eintragVonId.get(Number(r.entry_id))
    if (e) eintragZuId.set(Number(r.related_anilist_id), e)
  }
  for (const e of eintraege) if (e.anilist_id) eintragZuId.set(e.anilist_id, e)

  const ergebnis: Vorschlag[] = []
  medien.forEach((m, i) => {
    if (!m?.id || m.isAdult || inListe.has(m.id) || aus.has(m.id)) return
    const vor = vorgaenger(m)
    let fortsetzungVon: EigenerEintrag | null = null
    if (vor.length) {
      // Fortsetzungen nur, wenn man den Vorgänger kennt (und nicht abgebrochen hat)
      fortsetzungVon = vor.map(id => eintragZuId.get(id)).find(e => e && e.status !== 'dropped' && e.status !== 'planned') ?? null
      if (!fortsetzungVon) return
    }
    const p = passung(m.genres ?? [], profil)
    const beliebtheit = medien.length > 1 ? 1 - i / (medien.length - 1) : 1
    const gewicht = 1.2 * p.wert + 3 * ((m.averageScore ?? 65) - 65) / 100 + 0.6 * beliebtheit + (fortsetzungVon ? 1 : 0)
    const lage = m.status === 'NOT_YET_RELEASED' ? 'Startet bald' : m.status === 'FINISHED' ? 'Diese Saison' : 'Läuft gerade'
    const grund = fortsetzungVon ? `${lage} · Fortsetzung von ${anzeigeName(fortsetzungVon)}`
      : p.passend.length ? `${lage} · passt zu ${p.passend.join(', ')}`
      : m.averageScore ? `${lage} · ${m.averageScore} % auf AniList`
      : `${lage} · beliebt diese Saison`
    ergebnis.push(vorschlag(m, 'saison', grund, gewicht))
  })
  return ergebnis.sort((a, b) => b.gewicht - a.gewicht).slice(0, MAX_JE_LISTE)
}

// ── 4. Eigene Geplant-Liste ──

function geplantVorschlaege(eintraege: EigenerEintrag[], profil: Profil): GeplantVorschlag[] {
  return eintraege.filter(e => e.status === 'planned').map(e => {
    const p = passung(e.genres, profil)
    const lieblingsAnteil = profil.lieblinge.size && e.genres.length
      ? e.genres.filter(g => profil.lieblinge.has(g)).length / e.genres.length : 0
    const passt = Math.max(0, Math.min(100, Math.round(50 + p.wert * 80 + lieblingsAnteil * 10)))
    const umfang = e.type === 'ANIME'
      ? (e.total_episodes ? `${e.total_episodes} ${e.total_episodes === 1 ? 'Folge' : 'Folgen'}` : null)
      : (e.total_chapters ? `${e.total_chapters} Kapitel` : null)
    const einschaetzung = p.passend.length && p.wert > 0 ? `Passt zu deinen Lieblingsgenres ${p.passend.join(', ')}`
      : p.unpassend.length && p.wert < 0 ? `Eher nicht dein Fall: ${p.unpassend.join(', ')}`
      : 'Noch wenig Bewertungen zu diesen Genres'
    return {
      entry_id: e.id,
      title: anzeigeName(e),
      cover_url: e.cover_url,
      type: e.type,
      folgen: e.total_episodes,
      kapitel: e.total_chapters,
      genres: e.genres,
      passt,
      grund: umfang ? `${einschaetzung} · ${umfang}` : einschaetzung,
    }
  }).sort((a, b) => b.passt - a.passt || a.title.localeCompare(b.title))
}

// ── Berechnung und Zwischenspeicher ──

type AniListTeil = Pick<VorschlagAntwort, 'empfehlungen' | 'adaptionen' | 'saison'> & { stand: string }

async function berechneAniListTeil(): Promise<AniListTeil> {
  const { abfrage, anzahl } = erstelleAbfrage()
  const eintraege = leseEintraege()
  const profil = genreProfil(eintraege)
  const { inListe, aus, bekannt } = ausgeschlossen()
  const gesperrt = new Set([...inListe, ...aus])

  const empfKandidaten = await sammleEmpfehlungen(abfrage, eintraege, gesperrt)
  const adaptKandidaten = (await sammleAdaptionen(abfrage, eintraege, inListe, aus)).filter(k => !gesperrt.has(k.id))
  const { season, jahr } = aktuelleSaison()
  const saisonRes = await abfrage(SAISON_QUERY, { season, jahr })

  // Details der besten Kandidaten in einem Rutsch (Fortsetzungen fallen danach noch heraus, daher etwas mehr)
  const empfTop = empfKandidaten.slice(0, 32)
  const adaptTop = adaptKandidaten.slice(0, MAX_JE_LISTE)
  const details = await holeDetails(abfrage, [...empfTop.map(k => k.id), ...adaptTop.map(k => k.id)])

  // Was schon als Adaption kommt, hat dort den genaueren Grund
  const alsAdaption = new Set(adaptTop.map(k => k.id))
  const empfehlungen: Vorschlag[] = []
  for (const k of empfTop) {
    const m = details.get(k.id)
    if (!m || m.isAdult || bekannt(m) || alsAdaption.has(k.id)) continue
    // Fortsetzungen ohne den Anfang zu kennen ergeben keinen Sinn – und mit Anfang meldet sie schon der Serien-Abgleich
    if (vorgaenger(m).length) continue
    const p = passung(m.genres ?? [], profil)
    empfehlungen.push(vorschlag(m, 'empfehlung', empfehlungsGrund(k), k.summe + 0.25 * p.wert))
  }
  empfehlungen.sort((a, b) => b.gewicht - a.gewicht)

  const adaptionen: Vorschlag[] = []
  for (const k of adaptTop) {
    const m = details.get(k.id)
    if (!m || m.isAdult || bekannt(m)) continue
    adaptionen.push(vorschlag(m, 'adaption', adaptionsGrund(k), k.gewicht))
  }

  const saison = saisonVorschlaege((saisonRes?.data?.Page?.media ?? []).filter((m: any) => m?.id && !bekannt(m)), eintraege, profil, inListe, aus)
    .map(v => ({ ...v, zeitraum: v.zeitraum ?? `${SAISON_NAME[season]} ${jahr}` }))

  letzteAnfragenAnzahl = anzahl()
  console.log(`Vorschläge berechnet: ${anzahl()} AniList-Anfragen`)
  return {
    empfehlungen: empfehlungen.slice(0, MAX_JE_LISTE),
    adaptionen,
    saison,
    stand: new Date().toISOString(),
  }
}

function leseCache(): AniListTeil | null {
  const v = dbGet('SELECT value FROM app_meta WHERE key = ?', [CACHE_SCHLUESSEL])?.value
  if (typeof v !== 'string') return null
  try {
    const c = JSON.parse(v)
    if (!c || typeof c.stand !== 'string' || !Array.isArray(c.empfehlungen) || !Array.isArray(c.adaptionen) || !Array.isArray(c.saison)) return null
    return c
  } catch { return null }
}

function speichereCache(c: AniListTeil) {
  dbRun('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [CACHE_SCHLUESSEL, JSON.stringify(c)])
}

/** Inzwischen hinzugefügte oder ausgeblendete Titel aus einem (älteren) Stand entfernen */
function bereinige(c: AniListTeil): AniListTeil {
  const { bekannt } = ausgeschlossen()
  const ok = (v: Vorschlag) => !bekannt(v.media)
  return { ...c, empfehlungen: c.empfehlungen.filter(ok), adaptionen: c.adaptionen.filter(ok), saison: c.saison.filter(ok) }
}

let laufend: Promise<AniListTeil> | null = null
let letzterFehler: { zeit: number; meldung: string } | null = null

export async function holeVorschlaege(neuBerechnen = false): Promise<VorschlagAntwort> {
  const eintraege = leseEintraege()
  const geplant = geplantVorschlaege(eintraege, genreProfil(eintraege))
  const cache = leseCache()
  const alt = cache ? bereinige(cache) : { empfehlungen: [], adaptionen: [], saison: [], stand: null }

  if (!neuBerechnen && cache && Date.now() - Date.parse(cache.stand) < CACHE_DAUER_MS) return { ...alt, geplant }
  if (!neuBerechnen && letzterFehler && Date.now() - letzterFehler.zeit < FEHLER_PAUSE_MS) {
    return { ...alt, geplant, fehler: letzterFehler.meldung }
  }
  try {
    // Gleichzeitige Aufrufe (z. B. zweimal geöffnet) teilen sich eine Berechnung
    laufend ??= berechneAniListTeil().finally(() => { laufend = null })
    const neu = await laufend
    speichereCache(neu)
    letzterFehler = null
    return { ...bereinige(neu), geplant }
  } catch (e: any) {
    // Netzwerkfehler (z. B. „fetch failed“) verständlich machen; AniList-Meldungen bleiben, wie sie sind
    const roh = String(e?.message ?? e)
    const meldung = roh.startsWith('AniList') ? roh : `AniList nicht erreichbar (${roh})`
    letzterFehler = { zeit: Date.now(), meldung }
    return { ...alt, geplant, fehler: meldung }
  }
}

export function blendeVorschlagAus(anilistId: number) {
  const id = Number(anilistId)
  if (!Number.isInteger(id) || id <= 0) return
  dbRun('INSERT OR IGNORE INTO vorschlag_aus (anilist_id) VALUES (?)', [id])
  const cache = leseCache()
  if (cache) speichereCache(bereinige(cache))
}

export function registerVorschlagHandlers(ipcMain: IpcMain) {
  ipcMain.handle('vorschlaege:get', (_, neuBerechnen?: boolean) => holeVorschlaege(!!neuBerechnen))
  ipcMain.handle('vorschlaege:ausblenden', (_, anilistId: number) => { blendeVorschlagAus(anilistId) })
}
