import { IpcMain, BrowserWindow } from 'electron'
import { dbAll, dbGet, dbRun } from '../../db/database'

const ANILIST_URL = 'https://graphql.anilist.co'

const SEARCH_QUERY = `
query ($search: String, $type: MediaType) {
  Page(perPage: 30) {
    media(search: $search, type: $type, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
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
      relations {
        edges {
          relationType
          node {
            id
            type
            title { romaji }
            coverImage { large }
          }
        }
      }
    }
  }
}
`

// Abgleich: schlanke Abfragen ohne Relationen
const ABGLEICH_FELDER = `
  id
  title { romaji native english }
  synonyms
  coverImage { large }
  genres
  description(asHtml: false)
  episodes
  chapters
  volumes
`

const ABGLEICH_SUCHE_QUERY = `
query ($search: String, $type: MediaType) {
  Page(perPage: 10) {
    media(search: $search, type: $type, sort: [SEARCH_MATCH, POPULARITY_DESC]) {${ABGLEICH_FELDER}}
  }
}
`

const ABGLEICH_ID_QUERY = `
query ($id: Int) {
  Media(id: $id) {${ABGLEICH_FELDER}}
}
`

interface AnilistAntwort {
  status: number
  retryAfter: number | null
  json: any
}

const TIMEOUT_MS = 15_000

// fetch statt electron.net: läuft genauso im Main-Prozess wie in der Handy-Version (Browser)
async function anilistRequest(query: string, variables: Record<string, unknown>): Promise<AnilistAntwort> {
  // Ohne Timeout könnte eine hängende Verbindung z. B. den Abgleich dauerhaft blockieren
  const abbruch = new AbortController()
  const timer = setTimeout(() => abbruch.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: abbruch.signal,
    })
    const retryAfter = parseInt(response.headers.get('retry-after') ?? '')
    let json: any = null
    try { json = JSON.parse(await response.text()) } catch { /* leer lassen */ }
    return { status: response.status, retryAfter: isNaN(retryAfter) ? null : retryAfter, json }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('AniList antwortet nicht (Zeitüberschreitung)')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

const warte = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Gemeinsame AniList-Abfrage für alle Handler. Wirft bei Netzwerkfehlern, HTTP-Fehlern
 * und GraphQL-`errors`, damit Störungen nicht als „nichts gefunden" erscheinen.
 * HTTP 404 (z. B. gelöschte Media-ID) gilt als gültige Antwort mit `data: null`.
 * Mit `wiederholen` wird bei Rate-Limit (429) gewartet und erneut versucht.
 */
export async function anilistAbfrage(query: string, variables: Record<string, unknown>, wiederholen = false): Promise<any> {
  for (let versuch = 0; versuch < (wiederholen ? 4 : 1); versuch++) {
    const antwort = await anilistRequest(query, variables)
    if (antwort.status === 429) {
      if (!wiederholen) throw new Error('AniList-Limit erreicht – bitte kurz warten')
      await warte(((antwort.retryAfter ?? 60) + 1) * 1000)
      continue
    }
    if (antwort.json === null) throw new Error(`AniList-Antwort ungültig (HTTP ${antwort.status})`)
    if (antwort.status === 404) return antwort.json
    if (antwort.status >= 400 || antwort.json.errors?.length) {
      throw new Error(`AniList-Fehler: ${antwort.json.errors?.[0]?.message ?? `HTTP ${antwort.status}`}`)
    }
    return antwort.json
  }
  throw new Error('AniList-Limit erreicht – bitte später erneut versuchen')
}

function normalisiere(s: string | null | undefined) {
  return (s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')
}

function findeTreffer(titel: string, kandidaten: any[]) {
  const ziel = normalisiere(titel)
  if (!ziel) return null
  return kandidaten.find(m =>
    [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms ?? [])]
      .some(t => normalisiere(t) === ziel)
  ) ?? null
}

interface AbgleichErgebnis {
  aktualisiert: number
  nichtGefunden: string[]
  fehler: string[]
}

let abgleichLaeuft = false

async function gleicheEintraegeAb(win: BrowserWindow | null): Promise<AbgleichErgebnis> {
  const offen = dbAll(
    `SELECT id, anilist_id, type, title, genres, description, total_episodes, total_chapters, total_volumes
     FROM entries WHERE anilist_id IS NULL OR cover_url IS NULL OR cover_url = ''`
  )
  const ergebnis: AbgleichErgebnis = { aktualisiert: 0, nichtGefunden: [], fehler: [] }

  for (let i = 0; i < offen.length; i++) {
    const e = offen[i]
    win?.webContents.send('anilist:abgleichFortschritt', { aktuell: i + 1, gesamt: offen.length, titel: e.title })
    try {
      let media: any = null
      if (e.anilist_id) {
        const res = await anilistAbfrage(ABGLEICH_ID_QUERY, { id: e.anilist_id }, true)
        media = res?.data?.Media ?? null
      } else {
        const res = await anilistAbfrage(ABGLEICH_SUCHE_QUERY, { search: e.title, type: e.type }, true)
        media = findeTreffer(String(e.title), res?.data?.Page?.media ?? [])
      }

      if (!media) {
        ergebnis.nichtGefunden.push(String(e.title))
      } else {
        // Nicht mit einem bereits vorhandenen Eintrag derselben AniList-ID kollidieren
        const doppelt = !e.anilist_id && dbGet('SELECT id FROM entries WHERE anilist_id = ? AND id != ?', [media.id, e.id])
        if (doppelt) {
          ergebnis.fehler.push(`${e.title}: bereits als eigener Eintrag vorhanden`)
        } else {
          const genresLeer = !e.genres || e.genres === '[]'
          dbRun(
            `UPDATE entries SET anilist_id = ?, cover_url = ?, genres = ?, description = ?,
               total_episodes = ?, total_chapters = ?, total_volumes = ?
             WHERE id = ?`,
            [media.id, media.coverImage?.large ?? null,
             genresLeer ? JSON.stringify(media.genres ?? []) : e.genres,
             e.description ?? media.description?.replace(/<[^>]*>/g, '') ?? null,
             e.total_episodes ?? media.episodes ?? null,
             e.total_chapters ?? media.chapters ?? null,
             e.total_volumes ?? media.volumes ?? null,
             e.id]
          )
          ergebnis.aktualisiert++
        }
      }
    } catch (err: any) {
      ergebnis.fehler.push(`${e.title}: ${err?.message ?? err}`)
    }
    // AniList erlaubt aktuell ~30 Anfragen/Minute
    if (i < offen.length - 1) await warte(2100)
  }
  return ergebnis
}

export function registerAniListHandlers(ipcMain: IpcMain) {
  ipcMain.handle('anilist:search', async (_, search: string, type: string) => {
    // Fehler (Netz, Limit, Störung) werden an die Suche weitergereicht und dort
    // angezeigt, statt als „Keine Ergebnisse" zu erscheinen
    const result = await anilistAbfrage(SEARCH_QUERY, { search, type })
    return result?.data?.Page?.media ?? []
  })

  ipcMain.handle('anilist:abgleichen', async (event) => {
    if (abgleichLaeuft) return { success: false, laeuftBereits: true }
    abgleichLaeuft = true
    try {
      const ergebnis = await gleicheEintraegeAb(BrowserWindow.fromWebContents(event.sender))
      return { success: true, ...ergebnis }
    } finally {
      abgleichLaeuft = false
    }
  })
}
