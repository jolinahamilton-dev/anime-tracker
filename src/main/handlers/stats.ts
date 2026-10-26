import { IpcMain } from 'electron'
import { dbAll, dbGet, dbRun } from '../../db/database'
import { anilistAbfrage } from './anilist'

const STANDARD_MINUTEN = 24
const DAUER_QUERY = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id duration } } }`

/**
 * Holt einmalig die Folgenlänge aller Anime (auch nicht abonnierter und ihrer Staffeln),
 * die noch keine haben. Der Serien-Abgleich hält sie danach für abonnierte Anime aktuell.
 */
export async function ergaenzeFolgenlaengen() {
  const ids = dbAll(`
    SELECT anilist_id AS id FROM entries WHERE type = 'ANIME' AND anilist_id IS NOT NULL
    UNION SELECT related_anilist_id FROM watch_order`)
    .map(r => r.id as number)
    .filter(id => !dbGet('SELECT 1 FROM media_dauer WHERE anilist_id = ?', [id]))
  for (let i = 0; i < ids.length; i += 50) {
    if (i > 0) await new Promise(r => setTimeout(r, 2100))
    const res = await anilistAbfrage(DAUER_QUERY, { ids: ids.slice(i, i + 50) }, true)
    for (const m of res?.data?.Page?.media ?? []) {
      if (m.duration) dbRun('INSERT OR REPLACE INTO media_dauer (anilist_id, minuten) VALUES (?, ?)', [m.id, m.duration])
    }
  }
}

/**
 * Geschaute Folgen und Minuten aller Anime. Hat ein Eintrag eine Watch-Order, zählen die
 * Staffeln einzeln (die Hauptstaffel steckt darin, also nichts doppelt) – jede mit ihrer
 * eigenen Folgenlänge, sonst die des Eintrags, sonst 24 Minuten.
 */
export function geschauteFolgen(): { folgen: number; minuten: number } {
  const dauer = new Map(dbAll('SELECT anilist_id, minuten FROM media_dauer').map(r => [r.anilist_id as number, r.minuten as number]))
  const zeilen = dbAll('SELECT entry_id, related_anilist_id, progress_episodes FROM watch_order')
  const proEintrag = new Map<number, typeof zeilen>()
  for (const z of zeilen) {
    const liste = proEintrag.get(z.entry_id as number)
    if (liste) liste.push(z); else proEintrag.set(z.entry_id as number, [z])
  }

  let folgen = 0, minuten = 0
  for (const e of dbAll("SELECT id, anilist_id, progress_episodes FROM entries WHERE type = 'ANIME'")) {
    const eigeneDauer = dauer.get(e.anilist_id as number) ?? STANDARD_MINUTEN
    const staffeln = proEintrag.get(e.id as number)
    if (staffeln?.length) {
      for (const z of staffeln) {
        const n = (z.progress_episodes as number) ?? 0
        folgen += n
        minuten += n * (dauer.get(z.related_anilist_id as number) ?? eigeneDauer)
      }
    } else {
      const n = (e.progress_episodes as number) ?? 0
      folgen += n
      minuten += n * eigeneDauer
    }
  }
  return { folgen, minuten }
}

function rueckstau() {
  // Noch offene Folgen: geplante, angefangene, laufende und pausierte Anime
  const dauer = new Map(dbAll('SELECT anilist_id, minuten FROM media_dauer').map(r => [r.anilist_id as number, r.minuten as number]))
  let folgen = 0, minuten = 0
  for (const e of dbAll(`SELECT id, anilist_id, total_episodes, progress_episodes FROM entries
      WHERE type = 'ANIME' AND status IN ('planned', 'started', 'ongoing', 'paused')`)) {
    const eigeneDauer = dauer.get(e.anilist_id as number) ?? STANDARD_MINUTEN
    const staffeln = dbAll(`SELECT related_anilist_id, total_episodes, aired_episodes, progress_episodes, media_status
      FROM watch_order WHERE entry_id = ? AND relation_type IN ('MAIN', 'PREQUEL', 'SEQUEL')`, [e.id as number])
    const teile = staffeln.length ? staffeln : [{ ...e, related_anilist_id: e.anilist_id, aired_episodes: null }]
    for (const z of teile) {
      const verfuegbar = (z.media_status === 'RELEASING' ? z.aired_episodes : z.total_episodes ?? z.aired_episodes) as number | null
      const offen = Math.max(0, (verfuegbar ?? 0) - ((z.progress_episodes as number) ?? 0))
      folgen += offen
      minuten += offen * (dauer.get(z.related_anilist_id as number) ?? eigeneDauer)
    }
  }
  return { folgen, minuten }
}

export function registerStatsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('stats:get', () => {
    const zahl = (sql: string) => (dbGet(sql)?.n as number) ?? 0
    const gesamt = zahl('SELECT COUNT(*) as n FROM entries')
    const anime = zahl("SELECT COUNT(*) as n FROM entries WHERE type = 'ANIME'")
    const manga = zahl("SELECT COUNT(*) as n FROM entries WHERE type = 'MANGA'")
    const beendet = zahl("SELECT COUNT(*) as n FROM entries WHERE status = 'completed'")
    const kapitel = zahl("SELECT SUM(progress_chapters) as n FROM entries WHERE type = 'MANGA'")
    const wiederholungen = zahl('SELECT SUM(rewatch_count) as n FROM entries')
    const bewAnime = dbGet("SELECT AVG(rating) as n FROM entries WHERE type = 'ANIME' AND rating IS NOT NULL")?.n as number | null
    const bewManga = dbGet("SELECT AVG(rating) as n FROM entries WHERE type = 'MANGA' AND rating IS NOT NULL")?.n as number | null
    const bewGesamt = dbGet('SELECT AVG(rating) as n FROM entries WHERE rating IS NOT NULL')?.n as number | null
    const runde = (x: number | null) => (x ? Math.round(x * 10) / 10 : null)

    const genreZahl: Record<string, number> = {}
    const genreBewertung: Record<string, number[]> = {}
    for (const row of dbAll('SELECT genres, rating FROM entries')) {
      try {
        for (const g of JSON.parse(row.genres as string) as string[]) {
          genreZahl[g] = (genreZahl[g] ?? 0) + 1
          if (row.rating != null) (genreBewertung[g] ??= []).push(row.rating as number)
        }
      } catch {}
    }
    const topGenre = Object.entries(genreZahl).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    // Bewertungsverteilung 1–5 (ältere Werte über 5 zählen als 5)
    const bewertungsVerteilung = [1, 2, 3, 4, 5].map(sterne => ({
      sterne,
      n: zahl(`SELECT COUNT(*) as n FROM entries WHERE ${sterne === 5 ? 'rating >= 5' : `rating = ${sterne}`}`),
    }))

    // Ø Bewertung je Genre – nur Genres mit mindestens 2 bewerteten Einträgen
    const bewertungJeGenre = Object.entries(genreBewertung)
      .filter(([, werte]) => werte.length >= 2)
      .map(([genre, werte]) => ({ genre, schnitt: runde(werte.reduce((s, w) => s + Math.min(5, w), 0) / werte.length)!, n: werte.length }))
      .sort((a, b) => b.schnitt - a.schnitt || b.n - a.n)
      .slice(0, 8)

    // Beendet pro Monat (letzte 12 Monate) – Abschlussdatum wird seit Version 1.1 aufgezeichnet
    const monate: Array<{ monat: string; n: number }> = []
    const heute = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(heute.getFullYear(), heute.getMonth() - i, 1)
      const monat = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monate.push({ monat, n: zahl(`SELECT COUNT(*) as n FROM entries WHERE finished_at IS NOT NULL AND strftime('%Y-%m', finished_at, 'localtime') = '${monat}'`) })
    }

    const { folgen, minuten } = geschauteFolgen()
    const offen = rueckstau()

    return {
      gesamt, anime, manga, beendet, wiederholungen,
      kapitelGelesen: kapitel,
      folgenGesehen: folgen,
      watchtimeMinuten: minuten,
      bewertungGesamt: runde(bewGesamt),
      bewertungAnime: runde(bewAnime),
      bewertungManga: runde(bewManga),
      topGenre,
      statusVerteilung: dbAll('SELECT status, COUNT(*) as n FROM entries GROUP BY status'),
      bewertungsVerteilung,
      bewertungJeGenre,
      beendetProMonat: monate,
      geplant: zahl("SELECT COUNT(*) as n FROM entries WHERE status = 'planned'"),
      offeneFolgen: offen.folgen,
      offeneMinuten: offen.minuten,
    }
  })
}
