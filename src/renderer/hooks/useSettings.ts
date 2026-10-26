import { useState, useEffect } from 'react'
import { api } from '../api'

export interface Settings {
  darkMode: boolean
  akzentfarbe: string
}

const STANDARD: Settings = { darkMode: true, akzentfarbe: '#e85d8a' }
// Kopie der Darstellung im localStorage: wird beim Start sofort (synchron) angewendet,
// damit nicht erst das dunkle Standard-Design aufblitzt, bis die DB geantwortet hat
const CACHE_KEY = 'darstellung'

export function anwenden(s: Settings) {
  const stil = document.documentElement.style
  stil.setProperty('--accent', s.akzentfarbe)
  stil.setProperty('--accent-hover', s.akzentfarbe + 'cc')
  if (!s.darkMode) {
    stil.setProperty('--bg', '#f5f5f8')
    stil.setProperty('--bg-card', '#ffffff')
    stil.setProperty('--bg-nav', '#ececf0')
    stil.setProperty('--border', '#d8d8e0')
    stil.setProperty('--text', '#111118')
    stil.setProperty('--text-muted', '#666677')
  } else {
    stil.setProperty('--bg', '#0f0f13')
    stil.setProperty('--bg-card', '#1a1a24')
    stil.setProperty('--bg-nav', '#13131c')
    stil.setProperty('--border', '#2a2a3a')
    stil.setProperty('--text', '#f0f0f5')
    stil.setProperty('--text-muted', '#888899')
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)) } catch { /* egal */ }
}

/** Vor dem ersten Rendern aufrufen (main.tsx) */
export function anwendenAusCache() {
  try {
    const roh = localStorage.getItem(CACHE_KEY)
    if (roh) anwenden({ ...STANDARD, ...JSON.parse(roh) })
  } catch { /* dann eben Standard */ }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(STANDARD)

  useEffect(() => {
    async function laden() {
      const dark = await api.getMeta('darkMode')
      const farbe = await api.getMeta('akzentfarbe')
      const s: Settings = {
        darkMode: dark !== 'false',
        akzentfarbe: farbe ?? STANDARD.akzentfarbe,
      }
      setSettings(s)
      anwenden(s)
    }
    laden()
  }, [])

  async function speichern(neu: Partial<Settings>) {
    const aktuell = { ...settings, ...neu }
    setSettings(aktuell)
    anwenden(aktuell)
    // Nur geänderte Werte speichern – sonst gilt die Akzentfarbe als „geändert",
    // sobald nur der Dark Mode umgeschaltet wird (Achievement „Individualist")
    if (neu.darkMode !== undefined) await api.setMeta('darkMode', String(aktuell.darkMode))
    if (neu.akzentfarbe !== undefined) await api.setMeta('akzentfarbe', aktuell.akzentfarbe)
  }

  return { settings, speichern }
}
