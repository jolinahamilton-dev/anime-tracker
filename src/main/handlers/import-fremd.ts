// Einlesen fremder Listen (Punkt 14, Stufe 1): MyAnimeList-XML (auch .xml.gz, entpackt wird im Aufrufer) und eine
// allgemeine CSV. Beides wird zu einfachen QuellZeilen; Zuordnung zu AniList und Serien-Zusammenfassung
// macht dieselbe Pipeline wie beim Import per Benutzername (anilist-import.ts). Reine Funktionen, kein Netz.
import { ListenStatus, MedienTyp, QuellZeile, sterneAus, sterneAus10 } from './import-gruppen'
import { parseCSV } from './import-kern'

export interface FremdListe {
  format: 'MyAnimeList (XML)' | 'CSV'
  zeilen: QuellZeile[]
  /** Nur bei CSV: erkannte Spalten (Spaltenname in der Datei → Feld) zur Anzeige vor dem Import */
  zuordnung: Array<{ spalte: string; feld: string }>
  /** Einträge der Datei ohne Titel/ID (nicht übernehmbar) */
  uebersprungen: number
}

const MAL_STATUS: Record<string, ListenStatus> = {
  watching: 'CURRENT', reading: 'CURRENT', '1': 'CURRENT',
  completed: 'COMPLETED', '2': 'COMPLETED',
  'on-hold': 'PAUSED', 'on hold': 'PAUSED', onhold: 'PAUSED', '3': 'PAUSED',
  dropped: 'DROPPED', '4': 'DROPPED',
  'plan to watch': 'PLANNING', 'plan to read': 'PLANNING', '6': 'PLANNING',
}

const entitaeten: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function entschluessle(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return entitaeten[e.toLowerCase()] ?? m
  })
}

/** Inhalt eines Tags im Block (CDATA und Entitäten aufgelöst); null, wenn das Tag fehlt */
function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  if (!m) return null
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1])
  return (cdata ? cdata[1] : entschluessle(m[1])).trim()
}

const zahl = (s: string | null | undefined): number => {
  const n = parseInt(s ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** MAL-Datum JJJJ-MM-TT; „0000-00-00“ = unbekannt */
const malDatum = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !s.startsWith('0000') ? s.replace(/-00/g, '-01') : null)

/** MyAnimeList-Export (Anime oder Manga) lesen. Wirft eine verständliche Meldung bei kaputten/leeren Dateien. */
export function leseMalXml(text: string): FremdListe {
  if (!/<myanimelist[\s>]/i.test(text)) throw new Error('Das ist keine MyAnimeList-Datei (es fehlt <myanimelist>).')
  const zeilen: QuellZeile[] = []
  let uebersprungen = 0
  for (const typ of ['ANIME', 'MANGA'] as MedienTyp[]) {
    const wurzel = typ === 'ANIME' ? 'anime' : 'manga'
    const re = new RegExp(`<${wurzel}>([\\s\\S]*?)</${wurzel}>`, 'g')
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const b = m[1]
      const malId = zahl(tag(b, typ === 'ANIME' ? 'series_animedb_id' : 'manga_mangadb_id'))
      const titel = tag(b, typ === 'ANIME' ? 'series_title' : 'manga_title') ?? ''
      const status = MAL_STATUS[(tag(b, 'my_status') ?? '').toLowerCase()]
      if (!malId || !status) { uebersprungen++; continue }
      const fertig = status === 'COMPLETED'
      zeilen.push({
        nr: zeilen.length + 1, typ, anilistId: null, malId, titel, status,
        fortschritt: zahl(tag(b, typ === 'ANIME' ? 'my_watched_episodes' : 'my_read_chapters')),
        baende: typ === 'MANGA' ? zahl(tag(b, 'my_read_volumes')) : 0,
        bewertung: sterneAus10(zahl(tag(b, 'my_score'))),
        wiederholungen: zahl(tag(b, typ === 'ANIME' ? 'my_times_watched' : 'my_times_read')),
        notiz: null,
        beendet: fertig ? malDatum(tag(b, 'my_finish_date')) : null,
      })
    }
  }
  if (zeilen.length === 0) throw new Error('Die MyAnimeList-Datei enthält keine Einträge.')
  return { format: 'MyAnimeList (XML)', zeilen, zuordnung: [], uebersprungen }
}

// ── Allgemeine CSV ───────────────────────────────────────────────────────────

const SPALTEN: Array<[feld: string, namen: string[]]> = [
  ['titel', ['titel', 'title', 'name', 'anime title', 'series_title', 'manga_title']],
  ['typ', ['typ', 'type', 'medium', 'art']],
  ['status', ['status', 'my_status', 'list status']],
  ['fortschritt', ['fortschritt', 'progress', 'folgen (aktuell)', 'kapitel (aktuell)', 'episodes watched', 'watched episodes',
    'chapters read', 'my_watched_episodes', 'my_read_chapters', 'folgen', 'kapitel']],
  ['baende', ['bände (aktuell)', 'baende (aktuell)', 'volumes read', 'my_read_volumes', 'bände', 'baende']],
  ['bewertung', ['bewertung', 'rating', 'score', 'my_score', 'my score']],
  ['wiederholungen', ['wiederholungen', 'rewatches', 'repeat', 'times watched', 'my_times_watched', 'rewatch_count']],
  ['anilist_id', ['anilist-id', 'anilist_id', 'anilist id', 'anilist']],
  ['mal_id', ['mal-id', 'mal_id', 'mal id', 'myanimelist id', 'series_animedb_id', 'manga_mangadb_id', 'mal']],
]

const CSV_STATUS: Record<string, ListenStatus> = {
  laufend: 'CURRENT', angefangen: 'CURRENT', ongoing: 'CURRENT', started: 'CURRENT', current: 'CURRENT',
  watching: 'CURRENT', reading: 'CURRENT', schaut: 'CURRENT', 'liest': 'CURRENT', repeating: 'CURRENT',
  beendet: 'COMPLETED', completed: 'COMPLETED', fertig: 'COMPLETED', gesehen: 'COMPLETED', gelesen: 'COMPLETED',
  geplant: 'PLANNING', planned: 'PLANNING', planning: 'PLANNING', 'plan to watch': 'PLANNING', 'plan to read': 'PLANNING',
  pausiert: 'PAUSED', paused: 'PAUSED', 'on hold': 'PAUSED', 'on-hold': 'PAUSED',
  abgebrochen: 'DROPPED', dropped: 'DROPPED',
}

/** Allgemeine CSV lesen: deutsche und englische Spaltennamen werden erkannt, fehlender Status = geplant */
export function leseCsvListe(text: string): FremdListe {
  const rohZeilen = parseCSV(text)
  if (rohZeilen.length === 0) throw new Error('Die CSV-Datei ist leer oder hat nur eine Kopfzeile.')
  const kopf = Object.keys(rohZeilen[0])
  const spalteZu = new Map<string, string>() // Feld → Spaltenname in der Datei
  for (const [feld, namen] of SPALTEN) {
    const treffer = namen.map(n => kopf.find(k => k === n)).find(Boolean)
    if (treffer) spalteZu.set(feld, treffer)
  }
  if (!spalteZu.has('titel') && !spalteZu.has('anilist_id') && !spalteZu.has('mal_id')) {
    throw new Error('In der CSV wurde keine Spalte „Titel“ (oder AniList-/MAL-ID) gefunden.')
  }
  const feldVon = new Map([...spalteZu].map(([f, s]) => [s, f]))
  const zuordnung = kopf.filter(k => feldVon.has(k)).map(k => ({ spalte: k, feld: feldVon.get(k)! }))

  // Bewertung: bis 5 = Sterne, darüber 0–10 (oder 0–100) → Sterne; „3/5“ zählt als 3
  const rohWerte = rohZeilen.map(z => parseFloat(z[spalteZu.get('bewertung') ?? ''] ?? '')).filter(Number.isFinite)
  const hoechst = Math.max(0, ...rohWerte)
  const format = hoechst > 10 ? 'POINT_100' : hoechst > 5 ? 'POINT_10' : 'POINT_5'

  const zeilen: QuellZeile[] = []
  let uebersprungen = 0
  const hole = (z: Record<string, string>, feld: string) => (z[spalteZu.get(feld) ?? ''] ?? '').trim()
  for (const z of rohZeilen) {
    const titel = hole(z, 'titel')
    const anilistId = zahl(hole(z, 'anilist_id')) || null
    const malId = zahl(hole(z, 'mal_id')) || null
    if (!titel && !anilistId && !malId) { uebersprungen++; continue }
    const typRoh = hole(z, 'typ').toLowerCase()
    const typ: MedienTyp = typRoh.startsWith('manga') ? 'MANGA' : 'ANIME'
    const status = CSV_STATUS[hole(z, 'status').toLowerCase()] ?? 'PLANNING'
    zeilen.push({
      nr: zeilen.length + 1, typ, anilistId, malId, titel, status,
      fortschritt: zahl(hole(z, 'fortschritt')), baende: zahl(hole(z, 'baende')),
      bewertung: sterneAus(parseFloat(hole(z, 'bewertung')), format),
      wiederholungen: zahl(hole(z, 'wiederholungen')), notiz: null, beendet: null,
    })
  }
  if (zeilen.length === 0) throw new Error('Die CSV-Datei enthält keine verwertbaren Zeilen.')
  return { format: 'CSV', zeilen, zuordnung, uebersprungen }
}


/** Erkennt das Format am Inhalt und liest die Datei (Text, bei .gz schon entpackt) */
export function leseFremdeListe(text: string): FremdListe {
  const t = text.replace(/^﻿/, '').trimStart()
  if (!t) throw new Error('Die Datei ist leer.')
  if (t.startsWith('<')) return leseMalXml(t)
  return leseCsvListe(text)
}

/** Sind die Bytes gzip-gepackt (Kennung 1F 8B)? */
export const istGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b
