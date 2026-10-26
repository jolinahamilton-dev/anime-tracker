import { IpcMain, BrowserWindow } from 'electron'
import { dbAll, dbGet, getDb, schedulePersist } from '../../db/database'
import { anilistAbfrage } from './anilist'
import { schreibeWatchOrder } from './watchorder'

// ─────────────────────────────────────────────────────────────────────────────
// Serien-Abgleich: erkennt neue Folgen und neue Staffeln (eigene AniList-IDs) über
// die AniList-Verknüpfungen (SEQUEL/PREQUEL-Kette), ergänzt sie in der Watch-Order
// und stellt „Beendet" automatisch auf „Ongoing". Andere Status bleiben unberührt.
// ─────────────────────────────────────────────────────────────────────────────

// Welche Verknüpfungen als Teil der Serie gelten (Filme/Specials hängen als SIDE_STORY o. ä. dran).
// Muss zur Auswahl der Detailseite passen (RELEVANTE_RELATIONEN in DetailPage.tsx).
const RELEVANTE = new Set(['MAIN', 'PREQUEL', 'SEQUEL', 'SIDE_STORY', 'SPIN_OFF', 'PARENT', 'ALTERNATIVE'])
const REIHENFOLGE: Record<string, number> = { PREQUEL: 0, MAIN: 1, SEQUEL: 2, PARENT: 3, SIDE_STORY: 4, SPIN_OFF: 5, ALTERNATIVE: 6 }
// Obergrenze nur als Schutz – die Kette wird vollständig abgearbeitet (lange Reihen wie
// Attack on Titan haben 6+ Glieder; eine abgeschnittene Kette ließe alte Staffeln später „neu" wirken)
const MAX_RUNDEN = 20
const BATCH = 50
// Als „neue Staffel" zählt nur, was läuft oder vor kurzem erschienen ist – nicht eine
// alte OVA, die AniList-Redakteure nachträglich verknüpfen
const AKTUELL_TAGE = 180

const MEDIA_FELDER = `id type status episodes duration nextAiringEpisode { episode }
  title { romaji } coverImage { large }
  startDate { year month day } endDate { year month day }`

const BATCH_QUERY = `
query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: ${BATCH}) {
    media(id_in: $ids, type: ANIME) {
      ${MEDIA_FELDER}
      relations { edges { relationType node { ${MEDIA_FELDER} } } }
    }
  }
}
`

interface Datum { year: number | null; month: number | null; day: number | null }

interface MediaInfo {
  id: number
  type?: string
  status: string | null
  episodes: number | null
  duration?: number | null
  nextAiringEpisode: { episode: number } | null
  title: { romaji: string | null } | null
  coverImage: { large: string | null } | null
  startDate?: Datum | null
  endDate?: Datum | null
  relations?: { edges: Array<{ relationType: string; node: MediaInfo }> }
}

interface WoZeile {
  entry_id: number
  related_anilist_id: number
  relation_type: string
  position: number
  is_custom: number
  title: string | null
  cover_url: string | null
  total_episodes: number | null
  progress_episodes: number
  item_status: string
  aired_episodes: number | null
  media_status: string | null
  neu_seit: string | null
}

interface Kandidat { id: number; media: MediaInfo; relation: string; quelle: number }

export interface SerienAenderung {
  entryId: number
  titel: string
  art: 'folge' | 'staffel'
  statusGeaendert: boolean
}

const TAG_MS = 24 * 3600 * 1000
const warte = (ms: number) => new Promise(r => setTimeout(r, ms))

function alsDatum(d?: Datum | null): Date | null {
  return d?.year ? new Date(d.year, (d.month ?? 1) - 1, d.day ?? 1) : null
}

/**
 * Bisher ausgestrahlte Folgen laut AniList (null = unbekannt).
 * `alt` = zuletzt bekannter Wert – bei laufenden Serien ohne Sendeplan (Pause zwischen
 * zwei Cours) wird er beibehalten, statt auf die geplante Gesamtzahl zu springen.
 */
function ausgestrahlt(m: MediaInfo, alt: number | null): number | null {
  if (m.nextAiringEpisode) return Math.max(0, m.nextAiringEpisode.episode - 1)
  if (m.status === 'NOT_YET_RELEASED') return 0
  if (m.status === 'RELEASING') return alt
  if (m.status === 'CANCELLED') return m.episodes ?? 0
  return m.episodes ?? null
}

/** Neue Staffel, die eine Statusänderung rechtfertigt: läuft gerade oder ist kürzlich erschienen */
function istAktuell(m: MediaInfo): boolean {
  if (m.status === 'RELEASING') return true
  if (m.status === 'NOT_YET_RELEASED') return false // Ankündigung → nur Hinweis
  const d = alsDatum(m.endDate) ?? alsDatum(m.startDate)
  return d !== null && Date.now() - d.getTime() < AKTUELL_TAGE * TAG_MS
}

/** Holt Medien in Paketen; schlägt ein großes Paket fehl (z. B. Komplexitätslimit), wird es halbiert */
async function holePaket(ids: number[], cache: Map<number, MediaInfo>): Promise<void> {
  try {
    const res = await anilistAbfrage(BATCH_QUERY, { ids, page: 1 }, true)
    for (const m of res?.data?.Page?.media ?? []) cache.set(m.id, m)
  } catch (e) {
    if (ids.length <= 10) throw e
    const mitte = Math.ceil(ids.length / 2)
    await holePaket(ids.slice(0, mitte), cache)
    await warte(2100)
    await holePaket(ids.slice(mitte), cache)
  }
}

async function holeMedien(ids: number[], cache: Map<number, MediaInfo>, versucht: Set<number>) {
  // Jede ID nur einmal anfragen – auch wenn AniList sie nicht liefert (gelöscht o. ä.)
  const offen = [...new Set(ids)].filter(id => !versucht.has(id))
  offen.forEach(id => versucht.add(id))
  for (let i = 0; i < offen.length; i += BATCH) {
    if (i > 0) await warte(2100)
    await holePaket(offen.slice(i, i + BATCH), cache)
  }
}

/** Reihenfolge für eine neu angelegte Watch-Order: Prequel-Kette, Hauptstaffel, Sequel-Kette, Rest */
function ordne(kandidaten: Map<number, Kandidat>, hauptId: number): Kandidat[] {
  const liste = [...kandidaten.values()]
  const kette: Kandidat[] = [kandidaten.get(hauptId)!]
  const naechstes = (relation: string, von: number) =>
    liste.find(x => x.relation === relation && x.quelle === von && !kette.includes(x))
  for (let k = naechstes('PREQUEL', hauptId); k; k = naechstes('PREQUEL', k.id)) kette.unshift(k)
  for (let k = naechstes('SEQUEL', hauptId); k; k = naechstes('SEQUEL', k.id)) kette.push(k)
  const rest = liste.filter(x => !kette.includes(x))
    .sort((a, b) => (REIHENFOLGE[a.relation] ?? 99) - (REIHENFOLGE[b.relation] ?? 99))
  return [...kette, ...rest]
}

function itemStatusAus(status: string): string {
  return status === 'completed' ? 'completed' : status === 'started' || status === 'ongoing' ? 'started' : 'planned'
}

/**
 * Prüft für automatisch auf „Ongoing" gesetzte Einträge, ob alle auslösenden Staffeln
 * fertig geschaut sind und nichts mehr ausgestrahlt wird → zurück auf „Beendet".
 * Gibt die IDs der Einträge zurück, die zurückgesetzt wurden.
 */
export function pruefeAutoBeendet(entryId?: number): number[] {
  const kandidaten = dbAll(
    `SELECT id, auto_offen FROM entries WHERE status = 'ongoing' AND auto_offen IS NOT NULL${entryId ? ' AND id = ?' : ''}`,
    entryId ? [entryId] : []
  )
  const zurueck: number[] = []
  for (const e of kandidaten) {
    let offen: number[] = []
    try { offen = JSON.parse(String(e.auto_offen)) } catch { continue }
    const zeilen = dbAll('SELECT * FROM watch_order WHERE entry_id = ?', [e.id as number]) as unknown as WoZeile[]
    const fertig = offen.every(id => {
      // Staffel hat einen eigenen Eintrag und ist dort beendet → zählt auch hier als geschaut
      if (dbGet("SELECT 1 FROM entries WHERE anilist_id = ? AND id != ? AND status = 'completed'", [id, e.id as number])) return true
      const z = zeilen.find(w => w.related_anilist_id === id)
      if (!z) return false // fehlt (z. B. nach Reset) – der nächste Abgleich ergänzt sie wieder
      if (z.media_status === 'RELEASING') return false // es kommen noch Folgen
      if (z.item_status === 'completed') return true
      return z.aired_episodes != null && z.aired_episodes > 0 && z.progress_episodes >= z.aired_episodes
    })
    if (fertig) {
      getDb().run("UPDATE entries SET status = 'completed', auto_offen = NULL, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [e.id as number])
      // Komplett geschaute Staffeln auch in der Watch-Order als fertig markieren
      getDb().run(`UPDATE watch_order SET item_status = 'completed'
        WHERE entry_id = ? AND aired_episodes > 0 AND progress_episodes >= aired_episodes`, [e.id as number])
      zurueck.push(e.id as number)
    }
  }
  if (zurueck.length) schedulePersist()
  return zurueck
}

let laeuft = false

// Nur abonnierte Anime werden geprüft (spart AniList-Anfragen, keine ungewollten Hinweise)
const ANIME_SQL = `SELECT id, title, status, anilist_id, total_episodes, progress_episodes, auto_offen, bekannte_ids
  FROM entries WHERE type = 'ANIME' AND anilist_id IS NOT NULL AND abonniert = 1`

export async function aktualisiereSerien(win: BrowserWindow | null): Promise<SerienAenderung[]> {
  if (laeuft) return []
  laeuft = true
  try {
    // 1) Hauptlinie aller Einträge (MAIN + komplette Prequel/Sequel-Kette) von AniList holen.
    //    Nur dieser Teil wartet aufs Netz.
    const start = dbAll(ANIME_SQL)
    if (start.length === 0) return []
    const startZeilen = dbAll('SELECT entry_id, related_anilist_id, relation_type FROM watch_order')
    const cache = new Map<number, MediaInfo>()
    const versucht = new Set<number>()
    let zuHolen = [
      ...start.map(e => e.anilist_id as number),
      ...startZeilen.filter(z => ['MAIN', 'PREQUEL', 'SEQUEL'].includes(String(z.relation_type))).map(z => z.related_anilist_id as number),
    ]
    for (let runde = 0; runde < MAX_RUNDEN && zuHolen.length > 0; runde++) {
      if (runde > 0) await warte(2100)
      await holeMedien(zuHolen, cache, versucht)
      zuHolen = []
      for (const m of cache.values()) {
        for (const kante of m.relations?.edges ?? []) {
          if (kante.node.type === 'ANIME' && (kante.relationType === 'SEQUEL' || kante.relationType === 'PREQUEL') && !versucht.has(kante.node.id)) {
            zuHolen.push(kante.node.id)
          }
        }
      }
    }

    // 2) Ab hier synchron (kein await): Einträge und Watch-Orders FRISCH lesen, damit
    //    Änderungen der Nutzerin während der Netzwerkabfragen (Fortschritt, Status,
    //    Löschen) nicht mit einem veralteten Stand überschrieben werden.
    const eintraege = dbAll(ANIME_SQL)
    const alleZeilen = dbAll('SELECT * FROM watch_order') as unknown as WoZeile[]
    const aenderungen: SerienAenderung[] = []
    const geaendert = new Set<number>()
    const jetzt = new Date().toISOString()
    const db = getDb()

    // Folgenlängen nebenbei für die Statistik merken (kostet keine zusätzliche Anfrage)
    const dauern = new Map<number, number>()
    for (const m of cache.values()) {
      if (m.duration) dauern.set(m.id, m.duration)
      for (const k of m.relations?.edges ?? []) if (k.node.duration) dauern.set(k.node.id, k.node.duration)
    }
    for (const [id, min] of dauern) db.run('INSERT OR REPLACE INTO media_dauer (anilist_id, minuten) VALUES (?, ?)', [id, min])

    for (const e of eintraege) {
      const entryId = e.id as number
      const haupt = cache.get(e.anilist_id as number)
      if (!haupt) continue // nicht abrufbar (gelöscht/Fehler) → Eintrag unverändert lassen

      // Alle zur Serie gehörenden Medien: Kette ablaufen, je Kettenglied alle relevanten Verknüpfungen
      const kandidaten = new Map<number, Kandidat>()
      kandidaten.set(haupt.id, { id: haupt.id, media: haupt, relation: 'MAIN', quelle: haupt.id })
      const warteschlange = [haupt.id]
      while (warteschlange.length) {
        const glied = cache.get(warteschlange.shift()!)
        if (!glied) continue
        for (const kante of glied.relations?.edges ?? []) {
          const n = kante.node
          if (n.type !== 'ANIME' || !RELEVANTE.has(kante.relationType) || kandidaten.has(n.id)) continue
          kandidaten.set(n.id, { id: n.id, media: cache.get(n.id) ?? n, relation: kante.relationType, quelle: glied.id })
          if (kante.relationType === 'SEQUEL' || kante.relationType === 'PREQUEL') warteschlange.push(n.id)
        }
      }

      // Neue Staffeln: nur IDs, die der Abgleich für diesen Eintrag noch nie gesehen hat.
      // Beim allerersten Abgleich (bekannte_ids leer) wird nur der Ist-Stand gemerkt.
      let bekannt: number[] | null = null
      try { bekannt = e.bekannte_ids ? JSON.parse(String(e.bekannte_ids)) : null } catch { bekannt = null }
      const ersterAbgleich = bekannt === null
      const bekanntSet = new Set(bekannt ?? [])
      const istNeu = (id: number) => !ersterAbgleich && !bekanntSet.has(id)

      const vorher = alleZeilen.filter(z => z.entry_id === entryId).sort((a, b) => a.position - b.position)
      let neu: WoZeile[]
      const ausloeser: number[] = []
      let art: 'folge' | 'staffel' | null = null

      const neueZeile = (k: Kandidat, istHaupt: boolean): WoZeile => ({
        entry_id: entryId, related_anilist_id: k.id, relation_type: k.relation, position: 0, is_custom: 0,
        title: k.media.title?.romaji ?? null, cover_url: k.media.coverImage?.large ?? null,
        total_episodes: k.media.episodes ?? (istHaupt ? (e.total_episodes as number | null) : null),
        progress_episodes: istHaupt ? ((e.progress_episodes as number) ?? 0) : 0,
        item_status: istHaupt ? itemStatusAus(String(e.status)) : 'planned',
        aired_episodes: ausgestrahlt(k.media, null), media_status: k.media.status,
        // NEU-Markierung/News nur für Aktuelles oder Ankündigungen – nicht für alte, nachträglich verknüpfte Teile
        neu_seit: !istHaupt && istNeu(k.id) && (istAktuell(k.media) || k.media.status === 'NOT_YET_RELEASED') ? jetzt : null,
      })

      if (vorher.length === 0) {
        // Noch keine Watch-Order → hier anlegen, damit Folgen/Staffeln künftig verfolgt werden können
        neu = ordne(kandidaten, haupt.id).map(k => neueZeile(k, k.id === haupt.id))
        for (const z of neu) {
          const k = kandidaten.get(z.related_anilist_id)!
          if (z.neu_seit && istAktuell(k.media)) { ausloeser.push(k.id); art = 'staffel' }
        }
      } else {
        neu = vorher.map(z => ({ ...z }))
        // Vorhandene Staffeln aktualisieren (Fortschritt, Status und Reihenfolge bleiben)
        for (const z of neu) {
          const k = kandidaten.get(z.related_anilist_id)
          if (!k) continue
          const m = k.media
          const alt = z.aired_episodes
          const jetztAusgestrahlt = ausgestrahlt(m, alt)
          if (m.episodes != null && m.episodes !== z.total_episodes) {
            // Mehr Folgen als bisher → eine als „fertig" markierte Staffel ist es nicht mehr
            // (der Speicher-Handler würde sonst den Fortschritt auf das neue Maximum setzen)
            if (z.item_status === 'completed' && z.total_episodes != null && m.episodes > z.total_episodes) z.item_status = 'started'
            z.total_episodes = m.episodes
          }
          z.media_status = m.status
          z.title = z.title ?? m.title?.romaji ?? null
          z.cover_url = z.cover_url ?? m.coverImage?.large ?? null
          if (jetztAusgestrahlt != null) {
            // Nur wirklich ungesehene neue Folgen zählen
            if (alt != null && jetztAusgestrahlt > alt && z.progress_episodes < jetztAusgestrahlt) {
              ausloeser.push(z.related_anilist_id)
              // Angekündigte Staffel hat angefangen (0 → 1+) = neue Staffel (mit NEU-Markierung), sonst neue Folge
              if (alt === 0) { art = 'staffel'; z.neu_seit = jetzt } else art = art ?? 'folge'
              if (z.item_status === 'completed') z.item_status = 'started'
            }
            z.aired_episodes = jetztAusgestrahlt
          }
        }
        // Fehlende Staffeln ergänzen: Sequel hinter, Prequel vor seine Quelle; bei eigener Reihenfolge ans Ende
        const eigeneReihenfolge = vorher.some(z => z.is_custom)
        for (const k of ordne(kandidaten, haupt.id)) {
          if (neu.some(z => z.related_anilist_id === k.id)) continue
          const item = neueZeile(k, false)
          const quellIdx = neu.findIndex(z => z.related_anilist_id === k.quelle)
          if (!eigeneReihenfolge && quellIdx >= 0 && k.relation === 'SEQUEL') neu.splice(quellIdx + 1, 0, item)
          else if (!eigeneReihenfolge && quellIdx >= 0 && k.relation === 'PREQUEL') neu.splice(quellIdx, 0, item)
          else neu.push(item)
          // Ankündigungen landen in der Watch-Order, ändern aber den Status nicht
          if (item.neu_seit && istAktuell(k.media)) { ausloeser.push(k.id); art = 'staffel' }
        }
      }

      const watchOrderGeaendert = JSON.stringify(neu.map((z, i) => ({ ...z, position: i }))) !== JSON.stringify(vorher)
      // Gesamtfolgen der Hauptstaffel nachziehen – nur aus einer echten Folgenzahl
      // (nie aus „0 ausgestrahlt" bei Ankündigungen, sonst klemmt der Zähler bei 0)
      const totalNeu = haupt.episodes != null && haupt.episodes !== e.total_episodes ? haupt.episodes : null
      const bekanntNeu = JSON.stringify([...new Set([...bekanntSet, ...kandidaten.keys()])])

      db.run('BEGIN TRANSACTION')
      try {
        if (watchOrderGeaendert) {
          schreibeWatchOrder(entryId, neu)
          geaendert.add(entryId)
        }
        if (totalNeu != null) { db.run('UPDATE entries SET total_episodes = ? WHERE id = ?', [totalNeu, entryId]); geaendert.add(entryId) }
        if (bekanntNeu !== e.bekannte_ids) db.run('UPDATE entries SET bekannte_ids = ? WHERE id = ?', [bekanntNeu, entryId])

        if (ausloeser.length > 0) {
          let statusGeaendert = false
          if (e.status === 'completed') {
            // Nur „Beendet" wird umgestellt – Angefangen, Pausiert, Abgebrochen, Geplant bleiben
            db.run("UPDATE entries SET status = 'ongoing', auto_offen = ?, updated_at = datetime('now') WHERE id = ?",
              [JSON.stringify(ausloeser), entryId])
            statusGeaendert = true
            geaendert.add(entryId)
          } else if (e.status === 'ongoing' && e.auto_offen) {
            // Bereits automatisch auf Ongoing: weitere Auslöser merken
            let alt: number[] = []
            try { alt = JSON.parse(String(e.auto_offen)) } catch { /* leer */ }
            db.run('UPDATE entries SET auto_offen = ? WHERE id = ?', [JSON.stringify([...new Set([...alt, ...ausloeser])]), entryId])
          }
          // Abonniert = ausdrücklich gewünscht → immer Hinweis (unabhängig vom Status)
          aenderungen.push({ entryId, titel: String(e.title), art: art ?? 'folge', statusGeaendert })
        }
        db.run('COMMIT')
      } catch (err) {
        db.run('ROLLBACK')
        throw err
      }
    }

    // Automatisch gesetzte Einträge, die inzwischen komplett geschaut sind → zurück auf „Beendet"
    const zurueck = pruefeAutoBeendet()
    zurueck.forEach(id => geaendert.add(id))

    db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', ['letzter_serien_abgleich', jetzt])
    schedulePersist()

    // Offene Seiten informieren – auch über stille Änderungen (z. B. neue Ankündigung),
    // damit eine geöffnete Detailseite nicht den alten Stand zurückspeichert
    if ((geaendert.size || aenderungen.length) && win && !win.isDestroyed()) {
      win.webContents.send('serien:aktualisiert', { aenderungen, zurueckAufBeendet: zurueck, geaendert: [...geaendert] })
    }
    return aenderungen
  } finally {
    laeuft = false
  }
}

export function registerSerienHandlers(ipcMain: IpcMain) {
  ipcMain.handle('serien:sync', async (event) => {
    return aktualisiereSerien(BrowserWindow.fromWebContents(event.sender))
  })

  // Neue Staffeln und Ankündigungen der letzten 60 Tage für die News-Seite –
  // nur abonnierte Serien, jede Staffel einmal (auch wenn sie zu mehreren Einträgen gehört)
  ipcMain.handle('serien:neueStaffeln', () => {
    return dbAll(`
      SELECT MIN(w.entry_id) AS entry_id, w.related_anilist_id, w.title, w.cover_url, w.media_status,
             MAX(w.neu_seit) AS neu_seit, MIN(e.title) AS serie
      FROM watch_order w JOIN entries e ON e.id = w.entry_id
      WHERE w.neu_seit IS NOT NULL AND w.neu_seit >= ?
        AND e.abonniert = 1
      GROUP BY w.related_anilist_id
      ORDER BY neu_seit DESC
    `, [new Date(Date.now() - 60 * TAG_MS).toISOString()])
  })

  ipcMain.handle('serien:letzterAbgleich', () => {
    return (dbGet("SELECT value FROM app_meta WHERE key = 'letzter_serien_abgleich'")?.value as string) ?? null
  })
}
