import { useSyncExternalStore } from 'react'

// Gleiche Namen wie src/main/logo.ts; die Bilder liegen in public/logos (Quellen: build/logos/*.svg)
export const LOGOS = [
  { id: 'buecherhuegel', name: 'Bücherhügel' },
  { id: 'himmelswal', name: 'Himmelswal' },
  { id: 'buecherkatze', name: 'Bücherkatze' },
  { id: 'igel', name: 'Herbstigel' },
  { id: 'manta', name: 'Leuchtturm-Manta' },
  { id: 'frosch', name: 'Seerosenfrosch' },
  { id: 'sommerhuegel', name: 'Sommerhügel' },
  { id: 'sternennacht', name: 'Sternennacht' },
] as const

export const STANDARD_LOGO = 'buecherhuegel'

const gueltig = (id: string | null | undefined) => LOGOS.some(l => l.id === id) ? id! : STANDARD_LOGO
export const logoBild = (id: string) => `logos/${gueltig(id)}.png`

// Kleiner globaler Speicher: Kopfzeile, Begrüßung und Einstellungen zeigen sofort dasselbe Logo
let aktuell = STANDARD_LOGO
const hoerer = new Set<() => void>()

export function setzeLogo(id: string | null | undefined) {
  const neu = gueltig(id)
  if (neu === aktuell) return
  aktuell = neu
  // Web-App: Tab-Symbol mitziehen (das Symbol auf dem Startbildschirm bleibt das installierte)
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', logoBild(neu))
  hoerer.forEach(f => f())
}

export function useLogo() {
  return useSyncExternalStore(f => { hoerer.add(f); return () => { hoerer.delete(f) } }, () => aktuell)
}
