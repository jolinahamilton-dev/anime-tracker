import { BrowserWindow, IpcMain } from 'electron'
import { dbAll, dbGet, dbRun } from '../../db/database'
import { geschauteFolgen } from './stats'
import type { AchievementUebersicht, AchievementTrackInfo, NeuesAchievement } from '../../types'

// Achievements gibt es in zwei Arten:
//  • Stufen-Tracks: ein Zähler (Folgen, Kapitel, Einträge …) mit fünf Stufen Bronze → Diamant.
//    Jede Stufe ist eine eigene Zeile in der Tabelle achievements (id z. B. 'folgen_2'), damit
//    Abgleich (Vereinigung, früheres Datum zählt) und Freischaltdaten unverändert funktionieren.
//  • Einzelne Achievements: einmalige Meilensteine (Erster Schritt, Meisterwerk, Dunkelmodus …).
// Frühere Einzel-Achievements wie 'tausend_folgen' werden auf die passende Stufe übertragen
// (ALTE_IDS); die alten Zeilen bleiben stehen (ein anderes Gerät könnte sie erneut schicken)
// und werden in der Oberfläche einfach nicht mehr angezeigt.

export const STUFEN = ['Bronze', 'Silber', 'Gold', 'Platin', 'Diamant'] as const

interface Track {
  id: string
  name: string
  icon: string
  /** Einheit für die Fortschrittsanzeige („734 / 1000 Folgen") */
  einheit: string
  /** Beschreibung einer Stufe, z. B. „500 Folgen geschaut" */
  beschreibung: (schwelle: number) => string
  /** Schwellenwerte der fünf Stufen, aufsteigend */
  schwellen: number[]
  wert: () => number
  /** Optionale Zusatzzeile (z. B. aktuelle Serie) */
  zusatz?: () => string | null
}

interface Einzeln {
  id: string
  name: string
  beschreibung: string
  icon: string
  pruefe: () => boolean
}

const zahl = (sql: string, p: unknown[] = []) => Number((dbGet(sql, p as any)?.n as number) ?? 0) || 0
const meta = (key: string) => dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value as string | undefined

function genreAnzahl() {
  const g = new Set<string>()
  for (const r of dbAll('SELECT genres FROM entries')) {
    try { (JSON.parse(r.genres as string) as string[]).forEach(x => g.add(x)) } catch {}
  }
  return g.size
}

/** Verschiedene Tage, an denen die App geöffnet wurde (gerätelokal, siehe trackAppOpen.ts) */
export function nutzungsTage(): string[] {
  try {
    const tage = JSON.parse(meta('open_days') ?? '[]')
    return Array.isArray(tage) ? tage.filter((t): t is string => typeof t === 'string') : []
  } catch { return [] }
}

const tagNr = (iso: string) => {
  const [j, m, t] = iso.split('-').map(Number)
  return Math.round(Date.UTC(j, m - 1, t) / 86400000)
}

/** Längste Folge aufeinanderfolgender Tage (Daten als 'JJJJ-MM-TT', Reihenfolge egal) */
export function laengsteSerie(tage: string[]): number {
  const nr = [...new Set(tage.map(tagNr).filter(n => Number.isFinite(n)))].sort((a, b) => a - b)
  let beste = 0, lauf = 0
  for (let i = 0; i < nr.length; i++) {
    lauf = i > 0 && nr[i] === nr[i - 1] + 1 ? lauf + 1 : 1
    if (lauf > beste) beste = lauf
  }
  return beste
}

/** Aktuelle Serie: endet heute oder gestern (heute noch nicht geöffnet unterbricht sie nicht) */
export function aktuelleSerie(tage: string[], heute: string): number {
  const menge = new Set(tage.map(tagNr))
  let tag = tagNr(heute)
  if (!menge.has(tag)) tag -= 1
  let n = 0
  while (menge.has(tag)) { n++; tag-- }
  return n
}

export function lokalesDatum(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const tage = (n: number) => n === 1 ? '1 Tag' : `${n} Tage`

export const TRACKS: Track[] = [
  {
    id: 'folgen', name: 'Folgen-Marathon', icon: '📺', einheit: 'Folgen',
    schwellen: [100, 500, 1000, 2500, 5000],
    beschreibung: n => `${n.toLocaleString('de-DE')} Folgen geschaut`,
    wert: () => geschauteFolgen().folgen,
  },
  {
    id: 'stunden', name: 'Zeitreisender', icon: '⏰', einheit: 'Stunden',
    // etwa im Gleichschritt mit den Folgen (24 min je Folge: 500 h ≈ 1250 Folgen)
    schwellen: [24, 100, 500, 1000, 2000],
    beschreibung: n => `${n.toLocaleString('de-DE')} Stunden Anime geschaut`,
    wert: () => Math.floor(geschauteFolgen().minuten / 60),
  },
  {
    id: 'kapitel', name: 'Leseratte', icon: '📖', einheit: 'Kapitel',
    schwellen: [100, 500, 1000, 2500, 5000],
    beschreibung: n => `${n.toLocaleString('de-DE')} Kapitel gelesen`,
    wert: () => zahl("SELECT SUM(progress_chapters) as n FROM entries WHERE type='MANGA'"),
  },
  {
    id: 'eintraege', name: 'Sammler', icon: '📚', einheit: 'Einträge',
    schwellen: [10, 50, 100, 200, 500],
    beschreibung: n => `${n} Einträge in der Liste`,
    wert: () => zahl('SELECT COUNT(*) as n FROM entries'),
  },
  {
    id: 'abschluesse', name: 'Durchhalter', icon: '🏆', einheit: 'beendet',
    schwellen: [10, 50, 100, 250, 500],
    beschreibung: n => `${n} Titel beendet`,
    wert: () => zahl("SELECT COUNT(*) as n FROM entries WHERE status='completed'"),
  },
  {
    id: 'bewertungen', name: 'Rezensent', icon: '⭐', einheit: 'bewertet',
    schwellen: [10, 50, 100, 250, 500],
    beschreibung: n => `${n} Einträge bewertet`,
    wert: () => zahl('SELECT COUNT(*) as n FROM entries WHERE rating IS NOT NULL'),
  },
  {
    id: 'favoriten', name: 'Herzenssammlung', icon: '💖', einheit: 'Favoriten',
    schwellen: [10, 25, 50, 100, 200],
    beschreibung: n => `${n} Favoriten gesetzt`,
    wert: () => zahl('SELECT COUNT(*) as n FROM entries WHERE is_favorite = 1'),
  },
  {
    // AniList kennt 19 Genres – Diamant heißt also „alle"
    id: 'genres', name: 'Genre-Entdecker', icon: '🔭', einheit: 'Genres',
    schwellen: [5, 8, 12, 16, 19],
    beschreibung: n => n >= 19 ? `${n} Genres – alle von AniList` : `${n} verschiedene Genres in der Liste`,
    wert: genreAnzahl,
  },
  {
    id: 'listen', name: 'Organisator', icon: '📋', einheit: 'Listen',
    schwellen: [1, 3, 5, 10, 15],
    beschreibung: n => n === 1 ? 'Erste eigene Liste erstellt' : `${n} eigene Listen erstellt`,
    wert: () => zahl('SELECT COUNT(*) as n FROM custom_lists'),
  },
  {
    id: 'tage', name: 'Stammgast', icon: '📅', einheit: 'Tage',
    schwellen: [7, 30, 100, 200, 365],
    beschreibung: n => `App an ${n} verschiedenen Tagen genutzt`,
    wert: () => nutzungsTage().length,
  },
  {
    id: 'serie', name: 'Am Ball', icon: '🔥', einheit: 'Tage in Folge',
    schwellen: [3, 7, 14, 30, 100],
    beschreibung: n => `App ${n} Tage in Folge genutzt`,
    wert: () => laengsteSerie(nutzungsTage()),
    zusatz: () => {
      const n = aktuelleSerie(nutzungsTage(), lokalesDatum())
      return n > 0 ? `Aktuell ${tage(n)} in Folge` : null
    },
  },
]

const EINZELN: Einzeln[] = [
  { id: 'erster_eintrag', name: 'Erster Schritt', beschreibung: 'Ersten Eintrag erstellt', icon: '🌟', pruefe: () => zahl('SELECT COUNT(*) as n FROM entries') >= 1 },
  { id: 'erster_anime', name: 'Anime-Fan', beschreibung: 'Ersten Anime hinzugefügt', icon: '📺', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE type='ANIME'") >= 1 },
  { id: 'erster_manga', name: 'Manga-Leser', beschreibung: 'Ersten Manga hinzugefügt', icon: '📖', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE type='MANGA'") >= 1 },
  { id: 'anime_und_manga', name: 'Allrounder', beschreibung: 'Sowohl Anime als auch Manga in der Liste', icon: '🎭', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE type='ANIME'") >= 1 && zahl("SELECT COUNT(*) as n FROM entries WHERE type='MANGA'") >= 1 },
  { id: 'erste_bewertung', name: 'Kritiker', beschreibung: 'Erste Bewertung vergeben', icon: '⭐', pruefe: () => zahl('SELECT COUNT(*) as n FROM entries WHERE rating IS NOT NULL') >= 1 },
  // Die Sterne-UI (Sterne.tsx) vergibt nur 1-5, das CHECK-Constraint in der DB erlaubt
  // zwar bis 10, das wird aber von keiner UI genutzt – Schwellenwerte daher auf die
  // tatsächlich erreichbare 1-5-Skala bezogen (vorher: rating=10 / AVG>=8, nie erreichbar)
  { id: 'perfekte_bewertung', name: 'Meisterwerk', beschreibung: 'Eintrag mit 5/5 bewertet', icon: '💯', pruefe: () => zahl('SELECT COUNT(*) as n FROM entries WHERE rating = 5') >= 1 },
  { id: 'hohe_bewertung', name: 'Qualitätsbewusst', beschreibung: 'Bewertungen im Schnitt über 4', icon: '⚡', pruefe: () => zahl('SELECT AVG(rating) as n FROM entries WHERE rating IS NOT NULL') >= 4 },
  { id: 'erster_abschluss', name: 'Durchgehalten', beschreibung: 'Ersten Eintrag abgeschlossen', icon: '✅', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE status='completed'") >= 1 },
  { id: 'erste_notiz', name: 'Tagebuch', beschreibung: 'Erste Notiz verfasst', icon: '✏️', pruefe: () => zahl('SELECT COUNT(*) as n FROM entries WHERE review IS NOT NULL AND review != ""') >= 1 },
  { id: 'erster_favorit', name: 'Liebling', beschreibung: 'Ersten Favoriten gesetzt', icon: '❤️', pruefe: () => zahl('SELECT COUNT(*) as n FROM entries WHERE is_favorite = 1') >= 1 },
  { id: 'erster_tag', name: 'App-Nutzer', beschreibung: 'App zum ersten Mal geöffnet', icon: '🚀', pruefe: () => meta('first_open') !== undefined },
  { id: 'erster_plan', name: 'Planer', beschreibung: 'Ersten Eintrag auf „Geplant" gesetzt', icon: '📌', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE status='planned'") >= 1 },
  { id: 'laufend_verfolgt', name: 'Auf dem Laufenden', beschreibung: '5 laufende Serien verfolgt', icon: '📡', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE status='ongoing'") >= 5 },
  { id: 'pausiert', name: 'Pausen-Profi', beschreibung: 'Ersten Eintrag pausiert', icon: '⏸️', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE status='paused'") >= 1 },
  { id: 'fuenf_abgebrochen', name: 'Selektiv', beschreibung: '5 Einträge abgebrochen', icon: '🚫', pruefe: () => zahl("SELECT COUNT(*) as n FROM entries WHERE status='dropped'") >= 5 },
  { id: 'erster_export', name: 'Exporteur', beschreibung: 'Daten exportiert', icon: '💾', pruefe: () => meta('last_export') !== undefined },
  { id: 'dunkelmodus', name: 'Nachtfalter', beschreibung: 'Dunkelmodus aktiviert', icon: '🦇', pruefe: () => meta('darkMode') === 'true' },
  { id: 'farbe_geaendert', name: 'Individualist', beschreibung: 'Akzentfarbe geändert', icon: '🎨', pruefe: () => { const f = meta('akzentfarbe'); return f !== undefined && f !== '#e85d8a' } },
]

/**
 * Frühere Einzel-Achievements → Stufe, die damit sicher erreicht war. Die Stufe und alle
 * darunter bekommen das alte Freischaltdatum. 'zwoelf_stunden' (12 h) liegt unter Bronze
 * (24 h) und wird nur ausgeblendet.
 */
export const ALTE_IDS: Record<string, string> = {
  zehn_eintraege: 'eintraege_1',
  fuenfzig_eintraege: 'eintraege_2',
  hundert_eintraege: 'eintraege_3',
  zweihundert_eintraege: 'eintraege_4',
  zehn_abschluesse: 'abschluesse_1',
  fuenfzig_abschluesse: 'abschluesse_2',
  zehn_bewertungen: 'bewertungen_1',
  hundert_folgen: 'folgen_1',
  tausend_folgen: 'folgen_3',
  hundert_kapitel: 'kapitel_1',
  tausend_kapitel: 'kapitel_3',
  zehn_favoriten: 'favoriten_1',
  fuenfzig_favoriten: 'favoriten_3',
  vielseitig: 'genres_1',
  zwanzig_genres: 'genres_5',
  erste_liste: 'listen_1',
  fuenf_listen: 'listen_3',
  sieben_tage: 'tage_1',
  dreissig_tage: 'tage_2',
  vierundzwanzig_stunden: 'stunden_1',
  hundert_stunden: 'stunden_2',
}

export const stufenId = (track: string, nr: number) => `${track}_${nr}`
const stufenName = (t: Track, nr: number) => `${t.name} · ${STUFEN[nr - 1]}`

/** Anzahl erreichter Stufen für einen Wert (0 = noch keine) */
export function stufeFuer(wert: number, schwellen: number[]): number {
  let n = 0
  for (const s of schwellen) if (wert >= s) n++; else break
  return n
}

/** Freischalten bzw. ein früheres Datum übernehmen (wie beim Abgleich: das frühere Datum zählt) */
function freischalten(id: string, name: string, datum: string) {
  const vorhanden = dbGet('SELECT unlocked_at FROM achievements WHERE id = ?', [id])
  if (!vorhanden) {
    // INSERT löst den Abgleich-Trigger aus → die neue Stufe kommt auch auf dem anderen Gerät an
    dbRun('INSERT INTO achievements (id, name, unlocked_at) VALUES (?, ?, ?)', [id, name, datum])
  } else if (!vorhanden.unlocked_at || String(vorhanden.unlocked_at) > datum) {
    // Kein Abgleich nötig: das andere Gerät überträgt dieselbe alte Zeile genauso
    dbRun('UPDATE achievements SET unlocked_at = ? WHERE id = ?', [datum, id])
  }
}

/**
 * Überträgt freigeschaltete alte Einzel-Achievements auf die Stufen. Läuft bei jeder Prüfung
 * (billig) – so werden auch alte Zeilen erfasst, die später per Abgleich von einem Gerät mit
 * älterer App-Version ankommen.
 */
export function migriereAlteAchievements() {
  const alt = new Map(dbAll('SELECT id, unlocked_at FROM achievements WHERE unlocked_at IS NOT NULL')
    .map(r => [r.id as string, r.unlocked_at as string]))
  for (const [altId, neu] of Object.entries(ALTE_IDS)) {
    const datum = alt.get(altId)
    if (!datum) continue
    const trennung = neu.lastIndexOf('_')
    const trackId = neu.slice(0, trennung), bis = Number(neu.slice(trennung + 1))
    const track = TRACKS.find(t => t.id === trackId)
    if (!track) continue
    for (let nr = 1; nr <= bis; nr++) freischalten(stufenId(trackId, nr), stufenName(track, nr), datum)
  }
}

function freigeschaltetMap() {
  return new Map(dbAll('SELECT id, unlocked_at FROM achievements WHERE unlocked_at IS NOT NULL')
    .map(r => [r.id as string, r.unlocked_at as string]))
}

/** Prüft alle Achievements, schaltet neue frei und meldet sie dem Fenster (Toast) */
export function pruefeAchievements(win: BrowserWindow | null): NeuesAchievement[] {
  try { migriereAlteAchievements() } catch (e) { console.error('Achievement-Übertragung:', e) }
  const bereits = freigeschaltetMap()
  const jetzt = new Date().toISOString()
  const neu: NeuesAchievement[] = []

  for (const t of TRACKS) {
    let wert: number
    try { wert = t.wert() } catch { continue }
    const erreicht = stufeFuer(wert, t.schwellen)
    let hoechste = 0
    for (let nr = 1; nr <= erreicht; nr++) {
      const id = stufenId(t.id, nr)
      if (bereits.has(id)) continue
      dbRun('INSERT OR IGNORE INTO achievements (id, name, unlocked_at) VALUES (?, ?, ?)', [id, stufenName(t, nr), jetzt])
      hoechste = nr
    }
    // Mehrere Stufen auf einmal (z. B. nach einem Import) → nur die höchste als Toast
    if (hoechste) {
      neu.push({ id: stufenId(t.id, hoechste), name: t.name, icon: t.icon, stufe: hoechste, stufenName: STUFEN[hoechste - 1], beschreibung: t.beschreibung(t.schwellen[hoechste - 1]) })
    }
  }

  for (const a of EINZELN) {
    if (bereits.has(a.id)) continue
    try {
      if (a.pruefe()) {
        dbRun('INSERT OR IGNORE INTO achievements (id, name, unlocked_at) VALUES (?, ?, ?)', [a.id, a.name, jetzt])
        neu.push({ id: a.id, name: a.name, icon: a.icon, beschreibung: a.beschreibung })
      }
    } catch {}
  }

  if (neu.length > 0 && win) {
    win.webContents.send('achievements:neu', neu)
  }
  return neu
}

/** Übersicht für die Oberfläche: Tracks mit Stufen und Fortschritt, dazu die Einzel-Achievements */
export function achievementUebersicht(): AchievementUebersicht {
  const frei = freigeschaltetMap()
  const tracks: AchievementTrackInfo[] = TRACKS.map(t => {
    let wert = 0
    try { wert = t.wert() } catch {}
    const stufen = t.schwellen.map((schwelle, i) => ({
      id: stufenId(t.id, i + 1),
      nr: i + 1,
      name: STUFEN[i],
      schwelle,
      beschreibung: t.beschreibung(schwelle),
      unlocked_at: frei.get(stufenId(t.id, i + 1)) ?? null,
    }))
    const erreicht = stufen.reduce((m, s) => s.unlocked_at ? s.nr : m, 0)
    const naechste = stufen.find(s => s.nr > erreicht && !s.unlocked_at) ?? null
    let zusatz: string | null = null
    try { zusatz = t.zusatz?.() ?? null } catch {}
    return {
      id: t.id, name: t.name, icon: t.icon, einheit: t.einheit, wert, zusatz, erreicht,
      naechste: naechste ? { nr: naechste.nr, name: naechste.name, schwelle: naechste.schwelle } : null,
      stufen,
    }
  })
  const einzeln = EINZELN.map(a => ({
    id: a.id, name: a.name, beschreibung: a.beschreibung, icon: a.icon,
    unlocked_at: frei.get(a.id) ?? null,
  }))
  const gesamt = tracks.length * STUFEN.length + einzeln.length
  const freigeschaltet = tracks.reduce((n, t) => n + t.stufen.filter(s => s.unlocked_at).length, 0)
    + einzeln.filter(a => a.unlocked_at).length
  return { tracks, einzeln, freigeschaltet, gesamt }
}

export function registerAchievementHandlers(ipcMain: IpcMain) {
  ipcMain.handle('achievements:getAll', event => {
    // Vorher prüfen: übernimmt alte Achievements und schaltet z. B. Nutzungstage-Stufen frei,
    // die seit dem letzten Eintrag dazugekommen sind
    try { pruefeAchievements(BrowserWindow.fromWebContents(event.sender)) } catch (e) { console.error(e) }
    return achievementUebersicht()
  })
  ipcMain.handle('achievements:pruefen', event => {
    pruefeAchievements(BrowserWindow.fromWebContents(event.sender))
  })
}
