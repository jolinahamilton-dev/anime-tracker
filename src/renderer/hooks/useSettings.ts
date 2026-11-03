import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../api'
import { useBeiAenderung } from '../aktionen'
import { setzeLogo, STANDARD_LOGO } from '../logos'

export interface Settings {
  darkMode: boolean
  akzentfarbe: string
  logo: string
}

const STANDARD: Settings = { darkMode: true, akzentfarbe: '#e85d8a', logo: STANDARD_LOGO }
// Kopie der Darstellung im localStorage: wird beim Start sofort (synchron) angewendet,
// damit nicht erst das dunkle Standard-Design aufblitzt, bis die DB geantwortet hat
const CACHE_KEY = 'darstellung'

function ausCache(): Settings {
  try {
    const roh = localStorage.getItem(CACHE_KEY)
    if (roh) return { ...STANDARD, ...JSON.parse(roh) }
  } catch { /* dann eben Standard */ }
  return STANDARD
}

// Gemeinsamer Stand aller useSettings()-Aufrufe (App und Einstellungen): beginnt mit der zuletzt
// benutzten Darstellung statt dem Standard – sonst zeigte der Schalter kurz „dunkel“, und ein
// schneller Klick schaltete vom falschen Wert aus um
let aktuell: Settings = ausCache()
const hoerer = new Set<() => void>()
let ladeNr = 0 // jedes Laden und Speichern zählt hoch – ältere Antworten der DB werden verworfen
let geladen = false

export function anwenden(s: Settings) {
  const stil = document.documentElement.style
  stil.setProperty('--accent', s.akzentfarbe)
  stil.setProperty('--accent-hover', s.akzentfarbe + 'cc')
  document.documentElement.dataset.theme = s.darkMode ? 'dark' : 'light' // für die hellen Schriftfarben (global.css)
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
  setzeLogo(s.logo)
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)) } catch { /* egal */ }
  if (s.darkMode !== aktuell.darkMode || s.akzentfarbe !== aktuell.akzentfarbe || s.logo !== aktuell.logo) {
    aktuell = s
    hoerer.forEach(f => f())
  }
}

/** Vor dem ersten Rendern aufrufen (main.tsx) */
export function anwendenAusCache() {
  anwenden(ausCache())
}

/** Stand aus der Datenbank holen – beim Start und nach einem Abgleich (Einstellungen vom anderen Gerät) */
async function laden() {
  const nr = ++ladeNr
  const [dark, farbe, logo] = await Promise.all([api.getMeta('darkMode'), api.getMeta('akzentfarbe'), api.getMeta('logo')])
  // Inzwischen umgeschaltet oder neuer geladen: diese Antwort ist schon überholt
  if (nr !== ladeNr) return
  const s: Settings = {
    // Noch nie gewählt (neues Gerät, Abgleich noch nicht gelaufen): bei der zuletzt benutzten Darstellung bleiben
    darkMode: dark == null ? aktuell.darkMode : dark !== 'false',
    akzentfarbe: farbe ?? aktuell.akzentfarbe,
    logo: logo ?? aktuell.logo,
  }
  const logoNeu = s.logo !== aktuell.logo
  anwenden(s)
  if (logoNeu) await api.fensterLogo?.(s.logo)
}

export function useSettings() {
  const settings = useSyncExternalStore(f => { hoerer.add(f); return () => { hoerer.delete(f) } }, () => aktuell)

  // Einmal beim Start – weitere Aufrufer (Einstellungen) teilen den Stand und laden nicht erneut
  useEffect(() => { if (!geladen) { geladen = true; laden() } }, [])
  // Abgleich (automatisch oder „Jetzt abgleichen“) kann Dunkelmodus, Farbe und Logo geändert haben
  useEffect(() => api.onSerienAktualisiert(() => { laden() }), [])
  useBeiAenderung(laden)

  async function speichern(neu: Partial<Settings>) {
    ladeNr++
    const s = { ...aktuell, ...neu }
    anwenden(s)
    // Nur geänderte Werte speichern – sonst gilt die Akzentfarbe als „geändert",
    // sobald nur der Dark Mode umgeschaltet wird (Achievement „Individualist")
    if (neu.darkMode !== undefined) await api.setMeta('darkMode', String(s.darkMode))
    if (neu.akzentfarbe !== undefined) await api.setMeta('akzentfarbe', s.akzentfarbe)
    if (neu.logo !== undefined) {
      await api.setMeta('logo', s.logo)
      await api.fensterLogo?.(s.logo)
    }
  }

  return { settings, speichern }
}
