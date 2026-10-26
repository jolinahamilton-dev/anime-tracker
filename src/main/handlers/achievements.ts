import { BrowserWindow, IpcMain } from 'electron'
import { dbAll, dbGet, dbRun } from '../../db/database'
import { geschauteFolgen } from './stats'

interface Achievement {
  id: string
  name: string
  beschreibung: string
  icon: string
  pruefe: () => boolean
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'erster_eintrag', name: 'Erster Schritt', beschreibung: 'Ersten Eintrag erstellt', icon: '🌟', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries')?.n as number) ?? 0) >= 1 },
  { id: 'zehn_eintraege', name: 'Sammler', beschreibung: '10 Einträge erstellt', icon: '📚', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries')?.n as number) ?? 0) >= 10 },
  { id: 'fuenfzig_eintraege', name: 'Bibliothek', beschreibung: '50 Einträge erstellt', icon: '🏛️', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries')?.n as number) ?? 0) >= 50 },
  { id: 'hundert_eintraege', name: 'Archiv', beschreibung: '100 Einträge erstellt', icon: '🗃️', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries')?.n as number) ?? 0) >= 100 },
  { id: 'zweihundert_eintraege', name: 'Legende', beschreibung: '200 Einträge erstellt', icon: '👑', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries')?.n as number) ?? 0) >= 200 },
  { id: 'erster_anime', name: 'Anime-Fan', beschreibung: 'Ersten Anime hinzugefügt', icon: '📺', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE type='ANIME'")?.n as number) ?? 0) >= 1 },
  { id: 'erster_manga', name: 'Manga-Leser', beschreibung: 'Ersten Manga hinzugefügt', icon: '📖', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE type='MANGA'")?.n as number) ?? 0) >= 1 },
  { id: 'anime_und_manga', name: 'Allrounder', beschreibung: 'Sowohl Anime als auch Manga in der Liste', icon: '🎭', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE type='ANIME'")?.n as number) ?? 0) >= 1 && ((dbGet("SELECT COUNT(*) as n FROM entries WHERE type='MANGA'")?.n as number) ?? 0) >= 1 },
  { id: 'erste_bewertung', name: 'Kritiker', beschreibung: 'Erste Bewertung vergeben', icon: '⭐', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE rating IS NOT NULL')?.n as number) ?? 0) >= 1 },
  { id: 'zehn_bewertungen', name: 'Rezensent', beschreibung: '10 Einträge bewertet', icon: '🌟', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE rating IS NOT NULL')?.n as number) ?? 0) >= 10 },
  // Die Sterne-UI (Sterne.tsx) vergibt nur 1-5, das CHECK-Constraint in der DB erlaubt
  // zwar bis 10, das wird aber von keiner UI genutzt – Schwellenwerte daher auf die
  // tatsächlich erreichbare 1-5-Skala bezogen (vorher: rating=10 / AVG>=8, nie erreichbar)
  { id: 'perfekte_bewertung', name: 'Meisterwerk', beschreibung: 'Eintrag mit 5/5 bewertet', icon: '💯', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE rating = 5')?.n as number) ?? 0) >= 1 },
  { id: 'hohe_bewertung', name: 'Qualitätsbewusst', beschreibung: 'Durchschnittsbewertung über 4', icon: '⚡', pruefe: () => ((dbGet('SELECT AVG(rating) as n FROM entries WHERE rating IS NOT NULL')?.n as number) ?? 0) >= 4 },
  { id: 'erster_abschluss', name: 'Durchgehalten', beschreibung: 'Ersten Eintrag abgeschlossen', icon: '✅', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='completed'")?.n as number) ?? 0) >= 1 },
  { id: 'zehn_abschluesse', name: 'Ausdauernd', beschreibung: '10 Einträge abgeschlossen', icon: '🏆', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='completed'")?.n as number) ?? 0) >= 10 },
  { id: 'fuenfzig_abschluesse', name: 'Veteran', beschreibung: '50 Einträge abgeschlossen', icon: '🎖️', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='completed'")?.n as number) ?? 0) >= 50 },
  { id: 'hundert_folgen', name: 'Marathon-Zuschauer', beschreibung: '100 Folgen geschaut', icon: '📡', pruefe: () => geschauteFolgen().folgen >= 100 },
  { id: 'tausend_folgen', name: 'Anime-Veteran', beschreibung: '1000 Folgen geschaut', icon: '🎯', pruefe: () => geschauteFolgen().folgen >= 1000 },
  { id: 'hundert_kapitel', name: 'Leseratte', beschreibung: '100 Kapitel gelesen', icon: '📝', pruefe: () => ((dbGet("SELECT SUM(progress_chapters) as n FROM entries WHERE type='MANGA'")?.n as number) ?? 0) >= 100 },
  { id: 'tausend_kapitel', name: 'Manga-Meister', beschreibung: '1000 Kapitel gelesen', icon: '📜', pruefe: () => ((dbGet("SELECT SUM(progress_chapters) as n FROM entries WHERE type='MANGA'")?.n as number) ?? 0) >= 1000 },
  // Fix #5: 'notes' → 'review'
  { id: 'erste_notiz', name: 'Tagebuchschreiber', beschreibung: 'Erste Notiz verfasst', icon: '✏️', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE review IS NOT NULL AND review != ""')?.n as number) ?? 0) >= 1 },
  { id: 'erster_favorit', name: 'Liebling', beschreibung: 'Ersten Favoriten gesetzt', icon: '❤️', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE is_favorite = 1')?.n as number) ?? 0) >= 1 },
  { id: 'zehn_favoriten', name: 'Herzenssammlung', beschreibung: '10 Favoriten gesetzt', icon: '💖', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE is_favorite = 1')?.n as number) ?? 0) >= 10 },
  { id: 'fuenfzig_favoriten', name: 'Favoritenjäger', beschreibung: '50 Favoriten gesetzt', icon: '💝', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM entries WHERE is_favorite = 1')?.n as number) ?? 0) >= 50 },
  { id: 'erster_tag', name: 'App-Nutzer', beschreibung: 'App zum ersten Mal geöffnet', icon: '🚀', pruefe: () => dbGet("SELECT value FROM app_meta WHERE key='first_open'") !== undefined },
  // Fix #8: JSON.parse statt split(',')
  { id: 'sieben_tage', name: 'Wochennutzer', beschreibung: 'App an 7 verschiedenen Tagen genutzt', icon: '📅', pruefe: () => { try { return (JSON.parse((dbGet("SELECT value FROM app_meta WHERE key='open_days'")?.value as string) ?? '[]') as string[]).length >= 7 } catch { return false } } },
  { id: 'dreissig_tage', name: 'Monatsnutzer', beschreibung: 'App an 30 verschiedenen Tagen genutzt', icon: '🗓️', pruefe: () => { try { return (JSON.parse((dbGet("SELECT value FROM app_meta WHERE key='open_days'")?.value as string) ?? '[]') as string[]).length >= 30 } catch { return false } } },
  { id: 'erste_liste', name: 'Organisator', beschreibung: 'Erste benutzerdefinierte Liste erstellt', icon: '📋', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM custom_lists')?.n as number) ?? 0) >= 1 },
  { id: 'fuenf_listen', name: 'Listenprofi', beschreibung: '5 Listen erstellt', icon: '📊', pruefe: () => ((dbGet('SELECT COUNT(*) as n FROM custom_lists')?.n as number) ?? 0) >= 5 },
  { id: 'vielseitig', name: 'Vielseitig', beschreibung: '5 verschiedene Genres in der Liste', icon: '🎨', pruefe: () => { const rows = dbAll('SELECT genres FROM entries'); const g = new Set<string>(); for (const r of rows) { try { (JSON.parse(r.genres as string) as string[]).forEach(x => g.add(x)) } catch {} } return g.size >= 5 } },
  { id: 'zwanzig_genres', name: 'Genre-Entdecker', beschreibung: '20 verschiedene Genres entdeckt', icon: '🔭', pruefe: () => { const rows = dbAll('SELECT genres FROM entries'); const g = new Set<string>(); for (const r of rows) { try { (JSON.parse(r.genres as string) as string[]).forEach(x => g.add(x)) } catch {} } return g.size >= 20 } },
  // Fix #3: 'planned', 'dropped', 'paused' jetzt im Schema erlaubt
  { id: 'erster_plan', name: 'Planer', beschreibung: 'Ersten Eintrag auf "Geplant" gesetzt', icon: '📌', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='planned'")?.n as number) ?? 0) >= 1 },
  { id: 'fuenf_abgebrochen', name: 'Selektiv', beschreibung: '5 Einträge abgebrochen', icon: '🚫', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='dropped'")?.n as number) ?? 0) >= 5 },
  { id: 'laufend_verfolgt', name: 'Auf dem Laufenden', beschreibung: '5 laufende Serien verfolgt', icon: '📡', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='ongoing'")?.n as number) ?? 0) >= 5 },
  { id: 'pausiert', name: 'Pausen-Profi', beschreibung: 'Ersten Eintrag pausiert', icon: '⏸️', pruefe: () => ((dbGet("SELECT COUNT(*) as n FROM entries WHERE status='paused'")?.n as number) ?? 0) >= 1 },
  { id: 'zwoelf_stunden', name: 'Zeitinvestor', beschreibung: 'Über 12 Stunden Anime geschaut', icon: '⏰', pruefe: () => geschauteFolgen().minuten >= 720 },
  { id: 'vierundzwanzig_stunden', name: 'Tag und Nacht', beschreibung: 'Über 24 Stunden Anime geschaut', icon: '🌙', pruefe: () => geschauteFolgen().minuten >= 1440 },
  { id: 'hundert_stunden', name: 'Hundert-Stunden-Held', beschreibung: 'Über 100 Stunden Anime geschaut', icon: '💪', pruefe: () => geschauteFolgen().minuten >= 6000 },
  { id: 'erster_export', name: 'Exporteur', beschreibung: 'Daten exportiert', icon: '💾', pruefe: () => dbGet("SELECT value FROM app_meta WHERE key='last_export'") !== undefined },
  { id: 'dunkelmodus', name: 'Nachtfalter', beschreibung: 'Dunkelmodus aktiviert', icon: '🦇', pruefe: () => (dbGet("SELECT value FROM app_meta WHERE key='darkMode'")?.value as string) === 'true' },
  { id: 'farbe_geaendert', name: 'Individualist', beschreibung: 'Akzentfarbe geändert', icon: '🎨', pruefe: () => { const f = dbGet("SELECT value FROM app_meta WHERE key='akzentfarbe'")?.value; return f !== undefined && f !== '#e85d8a' } },
]

export function pruefeAchievements(win: BrowserWindow | null) {
  const bereitsFreigeschaltet = new Set(
    dbAll('SELECT id FROM achievements WHERE unlocked_at IS NOT NULL').map(r => r.id as string)
  )

  const neu: string[] = []

  for (const ach of ACHIEVEMENTS) {
    if (bereitsFreigeschaltet.has(ach.id)) continue
    try {
      if (ach.pruefe()) {
        dbRun(
          'INSERT OR IGNORE INTO achievements (id, name, unlocked_at) VALUES (?, ?, ?)',
          [ach.id, ach.name, new Date().toISOString()]
        )
        neu.push(ach.name)
      }
    } catch {}
  }

  if (neu.length > 0 && win) {
    win.webContents.send('achievements:neu', neu)
  }
}

export function registerAchievementHandlers(ipcMain: IpcMain) {
  ipcMain.handle('achievements:getAll', () => {
    const freigeschaltet = dbAll('SELECT id, name, unlocked_at FROM achievements WHERE unlocked_at IS NOT NULL')
    const freigeschaltetMap = new Map(freigeschaltet.map(r => [r.id as string, r.unlocked_at as string]))

    return ACHIEVEMENTS.map(ach => ({
      id: ach.id,
      name: ach.name,
      beschreibung: ach.beschreibung,
      icon: ach.icon,
      unlocked_at: freigeschaltetMap.get(ach.id) ?? null,
    }))
  })
}
