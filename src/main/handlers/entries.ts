import { IpcMain, BrowserWindow } from 'electron'
import { dbAll, dbGet, dbRun, dbRunGetId, getDb, schedulePersist } from '../../db/database'
import { pruefeAchievements } from './achievements'
import { pruefeAutoBeendet } from './serien'

// Fortschritt beim Anlegen; bei „Beendet" wie in entries:update auf das Maximum setzen
function fortschrittBeimAnlegen(data: Record<string, unknown>): [number, number, number] {
  const zahl = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0)
  const fertig = data.status === 'completed'
  return [
    fertig && data.type === 'ANIME' && data.total_episodes ? zahl(data.total_episodes) : zahl(data.progress_episodes),
    fertig && data.type === 'MANGA' && data.total_chapters ? zahl(data.total_chapters) : zahl(data.progress_chapters),
    fertig && data.type === 'MANGA' && data.total_volumes ? zahl(data.total_volumes) : zahl(data.progress_volumes),
  ]
}

type Zeile = Record<string, unknown>

// Rückgängig-Speicher (nur im Arbeitsspeicher, ein paar Sekunden lang gebraucht):
// gelöschte Einträge samt Listen/Watch-Order und der Stand vor einem „+1"
const rueckgaengig = new Map<string, { zeit: number; wiederherstellen: () => void }>()
function merkeRueckgaengig(wiederherstellen: () => void): string {
  const jetzt = Date.now()
  for (const [k, v] of rueckgaengig) if (jetzt - v.zeit > 5 * 60_000) rueckgaengig.delete(k)
  const token = `${jetzt}-${Math.random().toString(36).slice(2)}`
  rueckgaengig.set(token, { zeit: jetzt, wiederherstellen })
  return token
}

function fuegeEin(tabelle: string, zeile: Zeile) {
  const spalten = Object.keys(zeile)
  getDb().run(`INSERT INTO ${tabelle} (${spalten.join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`,
    spalten.map(s => zeile[s]) as any[])
}

const HAUPTLINIE = new Set(['MAIN', 'PREQUEL', 'SEQUEL'])
const naechsteFrei = (z: Zeile) => z.item_status !== 'completed' && z.media_status !== 'NOT_YET_RELEASED' &&
  (z.progress_episodes as number) < ((z.total_episodes as number | null) ?? Infinity)

/**
 * Staffel, an der man gerade ist: die zuletzt angefangene/geschaute, solange sie nicht fertig ist,
 * sonst die nächste freie danach. Ein nie geschautes Prequel davor wird so nicht weitergezählt,
 * wenn man mit der Hauptstaffel eingestiegen ist. Gibt -1 zurück, wenn alles geschaut ist.
 */
function aktuelleStaffel(zeilen: Zeile[]): number {
  let letzte = -1
  zeilen.forEach((z, i) => { if ((z.progress_episodes as number) > 0 || z.item_status === 'completed') letzte = i })
  if (letzte >= 0 && naechsteFrei(zeilen[letzte])) return letzte
  const danach = zeilen.findIndex((z, i) => i > letzte && naechsteFrei(z))
  return danach >= 0 ? danach : zeilen.findIndex(naechsteFrei)
}

/**
 * Fortschritt um `delta` (±1) ändern, ohne die Detailseite zu öffnen.
 * Anime mit Watch-Order: zählt die erste noch nicht fertige Staffel der Hauptlinie
 * (Prequel → Hauptstaffel → Sequels); bei −1 die zuletzt geschaute davor.
 */
function aendereFortschritt(id: number, delta: number) {
  const e = dbGet('SELECT * FROM entries WHERE id = ?', [id])
  if (!e) return null
  const db = getDb()
  const vorher = { ...e }
  const zeilen = e.type === 'ANIME'
    ? dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [id]).filter(z => HAUPTLINIE.has(String(z.relation_type)))
    : []
  let ziel: Zeile | null = null
  // Alle Staffeln merken: pruefeAutoBeendet kann neben der gezählten auch andere als fertig markieren
  const woVorher = dbAll('SELECT related_anilist_id, progress_episodes, item_status FROM watch_order WHERE entry_id = ?', [id])
  let neuerWert: number
  let beschreibung: string

  if (zeilen.length) {
    const plusIdx = aktuelleStaffel(zeilen)
    if (delta > 0) {
      ziel = plusIdx >= 0 ? zeilen[plusIdx] : null
    } else {
      const bis = plusIdx >= 0 ? plusIdx : zeilen.length - 1
      for (let i = bis; i >= 0 && !ziel; i--) if ((zeilen[i].progress_episodes as number) > 0) ziel = zeilen[i]
    }
    if (!ziel) return { entry: e, keinZiel: true }
    const total = ziel.total_episodes as number | null
    neuerWert = Math.max(0, Math.min(total ?? Infinity, (ziel.progress_episodes as number) + delta))
    const itemStatus = total != null && neuerWert >= total ? 'completed' : neuerWert > 0 ? 'started' : 'planned'
    db.run('UPDATE watch_order SET progress_episodes = ?, item_status = ? WHERE entry_id = ? AND related_anilist_id = ?',
      [neuerWert, itemStatus, id, ziel.related_anilist_id as number])
    if (ziel.relation_type === 'MAIN') db.run('UPDATE entries SET progress_episodes = ? WHERE id = ?', [neuerWert, id])
    beschreibung = `${ziel.title ?? 'Staffel'} · Folge ${neuerWert}${total ? `/${total}` : ''}`
  } else {
    const feld = e.type === 'ANIME' ? 'progress_episodes' : 'progress_chapters'
    const total = (e.type === 'ANIME' ? e.total_episodes : e.total_chapters) as number | null
    neuerWert = Math.max(0, Math.min(total ?? Infinity, (e[feld] as number) + delta))
    db.run(`UPDATE entries SET ${feld} = ? WHERE id = ?`, [neuerWert, id])
    beschreibung = `${e.type === 'ANIME' ? 'Folge' : 'Kapitel'} ${neuerWert}${total ? `/${total}` : ''}`
  }

  // Wer weiterschaut, hat angefangen
  if (delta > 0 && ['planned', 'paused'].includes(String(e.status))) {
    db.run("UPDATE entries SET status = 'started', auto_offen = NULL WHERE id = ?", [id])
  }
  db.run("UPDATE entries SET updated_at = datetime('now') WHERE id = ?", [id])
  schedulePersist()
  pruefeAutoBeendet(id)

  // Alles Verfügbare geschaut? → Rückfrage „Als Beendet markieren?" anbieten
  const nachher = dbGet('SELECT * FROM entries WHERE id = ?', [id])!
  let allesGeschaut: boolean
  if (zeilen.length) {
    const jetzt = dbAll('SELECT * FROM watch_order WHERE entry_id = ?', [id]).filter(z => HAUPTLINIE.has(String(z.relation_type)))
    // Nur Angekündigtes zählt nicht (sonst käme die Frage nie, solange eine Staffel angekündigt ist)
    allesGeschaut = jetzt.filter(z => z.media_status !== 'NOT_YET_RELEASED').every(z => z.media_status !== 'RELEASING' &&
      (z.item_status === 'completed' || (z.total_episodes != null && (z.progress_episodes as number) >= (z.total_episodes as number))))
  } else {
    const total = (e.type === 'ANIME' ? e.total_episodes : e.total_chapters) as number | null
    allesGeschaut = total != null && neuerWert >= total
  }

  const token = merkeRueckgaengig(() => {
    db.run(`UPDATE entries SET progress_episodes = ?, progress_chapters = ?, status = ?, auto_offen = ?, finished_at = ?,
      updated_at = ? WHERE id = ?`, [vorher.progress_episodes, vorher.progress_chapters, vorher.status,
      vorher.auto_offen, vorher.finished_at, vorher.updated_at, id] as any[])
    for (const w of woVorher) db.run('UPDATE watch_order SET progress_episodes = ?, item_status = ? WHERE entry_id = ? AND related_anilist_id = ?',
      [w.progress_episodes, w.item_status, id, w.related_anilist_id] as any[])
  })
  return {
    entry: nachher,
    beschreibung,
    rueckgaengig: token,
    fertigVorschlag: delta > 0 && allesGeschaut && nachher.status !== 'completed',
  }
}

/** Titel, bei denen schon Folgen bereitliegen, die man noch nicht gesehen hat */
function weiterschauen() {
  const ergebnis: Zeile[] = []
  for (const e of dbAll(`SELECT * FROM entries WHERE type = 'ANIME' AND status IN ('started', 'ongoing') ORDER BY updated_at DESC`)) {
    const zeilen = dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [e.id as number])
      .filter(z => HAUPTLINIE.has(String(z.relation_type)))
    // Dieselbe Staffel, die „+1" weiterzählen würde
    const idx = zeilen.length ? aktuelleStaffel(zeilen) : 0
    const z: Zeile | undefined = zeilen.length ? zeilen[idx]
      : { title: null, total_episodes: e.total_episodes, aired_episodes: null, progress_episodes: e.progress_episodes, media_status: null }
    if (!z) continue
    const verfuegbar = (z.media_status === 'RELEASING' ? z.aired_episodes : z.total_episodes ?? z.aired_episodes) as number | null
    const gesehen = (z.progress_episodes as number) ?? 0
    if (verfuegbar == null || gesehen >= verfuegbar) continue
    ergebnis.push({
      entry_id: e.id, title: e.title, cover_url: e.cover_url,
      staffel: zeilen.length > 1 ? z.title : null,
      gesehen, verfuegbar, total: z.total_episodes ?? null, laeuft: z.media_status === 'RELEASING',
    })
  }
  return ergebnis
}

/** Nächste ausgestrahlte Folge je AniList-ID (aus dem News-Cache, gefüllt nur für Abos) */
function naechsteAusstrahlungen(): Map<number, { episode: number; airing_at: number }> {
  const jetzt = Math.floor(Date.now() / 1000)
  // SQLite: bei MIN() kommen die übrigen Spalten aus derselben Zeile
  const zeilen = dbAll('SELECT anilist_id, episode, MIN(airing_at) AS airing_at FROM news_cache WHERE airing_at > ? GROUP BY anilist_id', [jetzt])
  return new Map(zeilen.map(z => [z.anilist_id as number, { episode: z.episode as number, airing_at: z.airing_at as number }]))
}

/**
 * Ergänzt Einträge um die aktuelle Staffel (dieselbe, die „+1" und „Weiterschauen" zählen) und die
 * nächste Ausstrahlung. Alle Watch-Order-Zeilen und Termine mit je EINER Abfrage, Gruppierung in JS.
 */
function ergaenzeEintraege(eintraege: Zeile[], woZeilen: Zeile[]): Zeile[] {
  const hauptlinie = new Map<number, Zeile[]>()
  for (const z of woZeilen) {
    if (!HAUPTLINIE.has(String(z.relation_type))) continue
    const liste = hauptlinie.get(z.entry_id as number)
    if (liste) liste.push(z); else hauptlinie.set(z.entry_id as number, [z])
  }
  const termine = naechsteAusstrahlungen()

  return eintraege.map(e => {
    if (e.type !== 'ANIME') return e
    const zeilen = hauptlinie.get(e.id as number) ?? []
    const extra: Zeile = {}

    // Aktuelle Staffel – nur bei mehr als einer (schon erschienenen) Staffel in der Hauptlinie
    let aktuell: Zeile | null = null
    const erschienen = zeilen.filter(z => z.media_status !== 'NOT_YET_RELEASED')
    if (erschienen.length > 1) {
      let idx = aktuelleStaffel(zeilen)
      if (idx < 0) idx = zeilen.indexOf(erschienen[erschienen.length - 1]) // alles gesehen → letzte Staffel
      aktuell = zeilen[idx]
      const anzahl = erschienen.length
      Object.assign(extra, {
        staffel_titel: aktuell.title ?? null,
        staffel_nr: Math.max(1, Math.min(anzahl, zeilen.slice(0, idx + 1).filter(z => z.media_status !== 'NOT_YET_RELEASED').length)),
        staffel_anzahl: anzahl,
        staffel_gesehen: (aktuell.progress_episodes as number) ?? 0,
        staffel_total: (aktuell.total_episodes as number | null) ?? null,
      })
    }

    // Nächste Folge: bevorzugt die der aktuellen Staffel, sonst die früheste der Serie (z. B. Start der nächsten Staffel)
    if (e.abonniert && termine.size) {
      let treffer: { episode: number; airing_at: number } | undefined
      let staffel: Zeile | null = null
      if (aktuell) { treffer = termine.get(aktuell.related_anilist_id as number); staffel = aktuell }
      if (!treffer) {
        const kandidaten: [number, Zeile | null][] = zeilen.map(z => [z.related_anilist_id as number, z])
        if (e.anilist_id != null) kandidaten.push([e.anilist_id as number, null])
        for (const [aid, z] of kandidaten) {
          const t = termine.get(aid)
          if (t && (!treffer || t.airing_at < treffer.airing_at)) { treffer = t; staffel = z }
        }
      }
      if (treffer) {
        extra.naechste_folge = treffer.episode
        extra.naechste_folge_um = treffer.airing_at
        extra.naechste_folge_staffel = zeilen.length > 1 ? staffel?.title ?? null : null
      }
    }
    return Object.keys(extra).length ? { ...e, ...extra } : e
  })
}

export function registerEntryHandlers(ipcMain: IpcMain) {
  ipcMain.handle('entries:getAll', () => {
    return ergaenzeEintraege(dbAll('SELECT * FROM entries ORDER BY updated_at DESC'),
      dbAll('SELECT * FROM watch_order ORDER BY entry_id, position'))
  })

  ipcMain.handle('entries:get', (_, id: number) => {
    const e = dbGet('SELECT * FROM entries WHERE id = ?', [id])
    if (!e) return e
    return ergaenzeEintraege([e], dbAll('SELECT * FROM watch_order WHERE entry_id = ? ORDER BY position', [id]))[0]
  })

  ipcMain.handle('entries:create', (event, data: Record<string, unknown>) => {
    // Gleicher AniList-Titel schon vorhanden → keinen Doppelten anlegen
    if (data.anilist_id != null) {
      const vorhanden = dbGet('SELECT * FROM entries WHERE anilist_id = ?', [data.anilist_id])
      if (vorhanden) return { ...vorhanden, schonVorhanden: true }
    }
    const id = dbRunGetId(`
      INSERT INTO entries (anilist_id, type, title, nickname, cover_url, genres, description,
        total_episodes, total_chapters, total_volumes, progress_episodes, progress_chapters, progress_volumes,
        status, rating, is_favorite, review, abonniert, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.anilist_id ?? null, data.type, data.title, data.nickname ?? null, data.cover_url ?? null,
       data.genres ?? '[]', data.description ?? null, data.total_episodes ?? null,
       data.total_chapters ?? null, data.total_volumes ?? null,
       ...fortschrittBeimAnlegen(data),
       data.status ?? 'started', data.rating ?? null, data.is_favorite ?? 0, data.review ?? null,
       // Neue Anime: automatisch abonniert, wenn man sie gerade schaut
       data.abonniert ?? (data.type === 'ANIME' && ['started', 'ongoing'].includes(String(data.status ?? 'started')) ? 1 : 0),
       // Abschlussdatum: beim Anlegen unbekannt (der Titel kann vor Jahren beendet worden sein)
       null]
    )
    pruefeAchievements(BrowserWindow.fromWebContents(event.sender))
    return dbGet('SELECT * FROM entries WHERE id = ?', [id])
  })

  ipcMain.handle('entries:update', (event, id: number, data: Record<string, unknown>) => {
    const ALLOWED = new Set(['type','title','nickname','cover_url','genres','description','total_episodes',
      'total_chapters','total_volumes','progress_episodes','progress_chapters','progress_volumes',
      'status','rating','is_favorite','review','rewatch_count'])

    const current = dbGet('SELECT status, type, total_episodes, total_chapters, total_volumes FROM entries WHERE id = ?', [id])
    // Fix #5: Bei status=completed → Fortschritt automatisch auf Maximalwert setzen
    if (data.status === 'completed') {
      if (current) {
        if (current.type === 'ANIME' && current.total_episodes && !('progress_episodes' in data))
          data = { ...data, progress_episodes: current.total_episodes }
        if (current.type === 'MANGA') {
          if (current.total_chapters && !('progress_chapters' in data))
            data = { ...data, progress_chapters: current.total_chapters }
          if (current.total_volumes && !('progress_volumes' in data))
            data = { ...data, progress_volumes: current.total_volumes }
        }
      }
    }

    const keys = Object.keys(data).filter(k => ALLOWED.has(k))
    if (keys.length === 0) return dbGet('SELECT * FROM entries WHERE id = ?', [id])
    const sets = keys.map(k => `${k} = ?`).join(', ')
    const vals = keys.map(k => data[k])
    dbRun(`UPDATE entries SET ${sets}, updated_at = datetime('now') WHERE id = ?`, [...vals, id])
    // Status von Hand gesetzt → keine automatische Rückkehr auf „Beendet" mehr
    if ('status' in data) dbRun('UPDATE entries SET auto_offen = NULL WHERE id = ?', [id])
    // Gerade beendet → Abschlussdatum merken (Statistik „Beendet pro Monat")
    if (data.status === 'completed' && current?.status !== 'completed') {
      dbRun("UPDATE entries SET finished_at = datetime('now') WHERE id = ?", [id])
    }
    pruefeAchievements(BrowserWindow.fromWebContents(event.sender))
    return dbGet('SELECT * FROM entries WHERE id = ?', [id])
  })

  // Abo umschalten – eigener Handler, damit „Zuletzt bearbeitet" (updated_at) unverändert bleibt
  ipcMain.handle('entries:abo', (_, id: number, abonniert: boolean) => {
    dbRun('UPDATE entries SET abonniert = ? WHERE id = ?', [abonniert ? 1 : 0, id])
    if (abonniert) {
      // Neu (wieder) abonniert: Ist-Stand beim nächsten Abgleich still neu erfassen, statt
      // alles, was in der Zwischenzeit erschienen ist, rückwirkend als „neu" zu melden
      dbRun('UPDATE entries SET bekannte_ids = NULL WHERE id = ?', [id])
      dbRun('UPDATE watch_order SET aired_episodes = NULL WHERE entry_id = ?', [id])
    }
    return dbGet('SELECT * FROM entries WHERE id = ?', [id])
  })

  ipcMain.handle('entries:fortschritt', (event, id: number, delta: number) => {
    const ergebnis = aendereFortschritt(id, delta >= 0 ? 1 : -1)
    pruefeAchievements(BrowserWindow.fromWebContents(event.sender))
    return ergebnis
  })

  ipcMain.handle('entries:weiterschauen', () => weiterschauen())

  ipcMain.handle('entries:delete', (_, id: number) => {
    // Alles Zugehörige merken, damit „Rückgängig" den Eintrag vollständig zurückholt
    const eintrag = dbGet('SELECT * FROM entries WHERE id = ?', [id])
    const listen = dbAll('SELECT * FROM list_entries WHERE entry_id = ?', [id])
    const staffeln = dbAll('SELECT * FROM watch_order WHERE entry_id = ?', [id])
    dbRun('DELETE FROM list_entries WHERE entry_id = ?', [id])
    dbRun('DELETE FROM watch_order WHERE entry_id = ?', [id])
    dbRun('DELETE FROM entries WHERE id = ?', [id])
    const token = eintrag ? merkeRueckgaengig(() => {
      fuegeEin('entries', eintrag)
      for (const l of listen) fuegeEin('list_entries', l)
      for (const s of staffeln) fuegeEin('watch_order', s)
    }) : null
    return { success: true, rueckgaengig: token }
  })

  ipcMain.handle('entries:rueckgaengig', (_, token: string) => {
    const r = rueckgaengig.get(token)
    if (!r) return { success: false }
    rueckgaengig.delete(token)
    const db = getDb()
    db.run('BEGIN TRANSACTION')
    try {
      r.wiederherstellen()
      db.run('COMMIT')
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }
    schedulePersist()
    return { success: true }
  })
}
