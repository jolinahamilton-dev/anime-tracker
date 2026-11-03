import { BrowserWindow } from 'electron'
import { dbGet, dbRun } from '../db/database'
import { lokalesDatum, pruefeAchievements } from './handlers/achievements'

// Nutzungstage für die Achievements „Stammgast" (verschiedene Tage) und „Am Ball" (Tage in Folge).
// open_days ist eine JSON-Liste lokaler Daten ('JJJJ-MM-TT'), höchstens 400 Stück, und bleibt
// auf dem Gerät (wird nicht abgeglichen) – abgeglichen werden nur die freigeschalteten Stufen.

let ueberwachung = false

/** Heutigen Tag eintragen; true, wenn er neu war */
export function merkeTag(heute = lokalesDatum()): boolean {
  const row = dbGet("SELECT value FROM app_meta WHERE key = 'open_days'")
  let tage: string[] = []
  try { tage = JSON.parse((row?.value as string) ?? '[]') } catch {}
  if (!Array.isArray(tage)) tage = []
  if (tage.includes(heute)) return false
  tage.push(heute)
  if (tage.length > 400) tage = tage.slice(-400)
  dbRun("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('open_days', ?)", [JSON.stringify(tage)])
  return true
}

function tagPruefen() {
  if (!merkeTag()) return
  // Neue Stufe (z. B. „Am Ball · Silber") gleich melden; etwas verzögert, damit die Oberfläche
  // beim Start schon zuhört
  const t = setTimeout(() => {
    try { pruefeAchievements((BrowserWindow.getAllWindows()[0] as BrowserWindow | undefined) ?? null) } catch (e) { console.error(e) }
  }, 5000)
  ;(t as { unref?: () => void }).unref?.()
}

export function trackAppOpen() {
  const firstOpen = dbGet("SELECT value FROM app_meta WHERE key = 'first_open'")
  if (!firstOpen) {
    dbRun("INSERT INTO app_meta (key, value) VALUES ('first_open', ?)", [new Date().toISOString()])
  }

  tagPruefen()

  // Bleibt die App über Mitternacht offen (PC im Tray, Handy-App im Hintergrund), zählt der
  // neue Tag trotzdem: stündlich und beim Zurückkehren in die Handy-App nachsehen
  if (ueberwachung) return
  ueberwachung = true
  const i = setInterval(tagPruefen, 60 * 60 * 1000)
  ;(i as { unref?: () => void }).unref?.()
  // (Im Main-Prozess gibt es kein document – daher über globalThis, ohne DOM-Typen)
  const doc = (globalThis as { document?: { visibilityState: string; addEventListener: (e: string, f: () => void) => void } }).document
  doc?.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') tagPruefen() })
}
