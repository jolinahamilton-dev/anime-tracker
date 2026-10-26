import { dbGet, dbRun } from '../db/database'

export function trackAppOpen() {
  // Lokales Datum (toISOString wäre UTC → Öffnen um 0:30 Uhr zählte als Vortag)
  const d = new Date()
  const heute = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const firstOpen = dbGet("SELECT value FROM app_meta WHERE key = 'first_open'")
  if (!firstOpen) {
    dbRun("INSERT INTO app_meta (key, value) VALUES ('first_open', ?)", [new Date().toISOString()])
  }

  const row = dbGet("SELECT value FROM app_meta WHERE key = 'open_days'")
  let tage: string[] = []
  try { tage = JSON.parse((row?.value as string) ?? '[]') } catch {}

  if (!tage.includes(heute)) {
    tage.push(heute)
    if (tage.length > 400) tage = tage.slice(-400)
    dbRun("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('open_days', ?)", [JSON.stringify(tage)])
  }
}
