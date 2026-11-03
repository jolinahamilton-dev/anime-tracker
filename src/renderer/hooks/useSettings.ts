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

// ── Lesbarkeit der Akzentfarbe (WCAG-Kontrast) ──
// Die Akzentfarbe ist frei wählbar – ein helles Gelb (#ffcc00) wäre als Schrift auf hellem Grund
// unlesbar (~1,6:1), weiße Schrift auf gelben Knöpfen ebenso. Darum zwei abgeleitete Farben:
//   --accent-text: Akzent als SCHRIFT (im hellen Design so weit abgedunkelt, dass ≥ 4,5:1 erreicht
//                  wird; im dunklen Design der Akzent selbst, bei sehr dunklen Farben aufgehellt)
//   --on-accent:   Schrift AUF Akzentflächen (dunkel oder weiß, je nachdem, was besser kontrastiert)
type Rgb = [number, number, number]
const DUNKLE_SCHRIFT = '#111118'

function hexZuRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbZuHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(k => Math.round(Math.min(255, Math.max(0, k))).toString(16).padStart(2, '0')).join('')
}

/** Relative Leuchtdichte nach WCAG 2.x */
function leuchtdichte([r, g, b]: Rgb): number {
  const lin = (k: number) => { const c = k / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function kontrast(a: Rgb, b: Rgb): number {
  const la = leuchtdichte(a), lb = leuchtdichte(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Mischt schrittweise Richtung Ziel (Schwarz/Weiß), bis die Farbe gegen alle Hintergründe ≥ minKontrast hat */
function anpassen(farbe: Rgb, hintergruende: Rgb[], ziel: Rgb, minKontrast = 4.5): Rgb {
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const c: Rgb = [0, 1, 2].map(k => farbe[k] + (ziel[k] - farbe[k]) * t) as Rgb
    const gerundet = hexZuRgb(rgbZuHex(c))!
    if (hintergruende.every(bg => kontrast(gerundet, bg) >= minKontrast)) return gerundet
  }
  return ziel
}

// Hintergründe, auf denen Akzent-Schrift steht: Karte, Seite, Navigation (die getönten
// Chip-/Filterflächen ergänzt akzentAbleitungen)
const HELLE_FLAECHEN: Rgb[] = [[0xff, 0xff, 0xff], [0xf5, 0xf5, 0xf8], [0xec, 0xec, 0xf0]]
const DUNKLE_FLAECHEN: Rgb[] = [[0x1a, 0x1a, 0x24], [0x0f, 0x0f, 0x13], [0x13, 0x13, 0x1c]]

/** Abgeleitete Akzentfarben für Schrift (--accent-text) und Schrift auf Akzentflächen (--on-accent) */
export function akzentAbleitungen(akzent: string, dunkel: boolean): { text: string; aufAkzent: string } {
  const rgb = hexZuRgb(akzent)
  if (!rgb) return { text: akzent, aufAkzent: '#ffffff' }
  // Auch auf den mit dem Akzent getönten Flächen (Chips, aktive Filter: color-mix bis 15 %) lesbar bleiben
  const flaechen = dunkel ? DUNKLE_FLAECHEN : HELLE_FLAECHEN
  const getoent = flaechen.map(bg => [0, 1, 2].map(k => Math.round(bg[k] + (rgb[k] - bg[k]) * 0.15)) as Rgb)
  const text = anpassen(rgb, [...flaechen, ...getoent], dunkel ? [255, 255, 255] : [0, 0, 0])
  // Weiß bleibt (wie bisher), solange es gut lesbar ist – sonst die besser kontrastierende Farbe
  const weiss = kontrast(rgb, [255, 255, 255])
  const dunkelSchrift = kontrast(rgb, hexZuRgb(DUNKLE_SCHRIFT)!)
  const aufAkzent = weiss >= 4.5 || weiss >= dunkelSchrift ? '#ffffff' : DUNKLE_SCHRIFT
  return { text: rgbZuHex(text), aufAkzent }
}

export function anwenden(s: Settings) {
  const stil = document.documentElement.style
  stil.setProperty('--accent', s.akzentfarbe)
  stil.setProperty('--accent-hover', s.akzentfarbe + 'cc')
  const { text, aufAkzent } = akzentAbleitungen(s.akzentfarbe, s.darkMode)
  stil.setProperty('--accent-text', text)
  stil.setProperty('--on-accent', aufAkzent)
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
