import { useSyncExternalStore } from 'react'
import { Ansicht, ladeAnsichten } from './listenZustand'

// Die zuletzt auf der Startseite gewählte Ansicht (klein / mittel / groß) gilt auch für die Titel auf
// Einpflegen, News und Statistik: html[data-kachel] steuert dort die Größen (--kachel-* in global.css).
// Die Startseite behält je Liste ihre eigene Ansicht – dieser Speicher merkt sich nur die letzte Wahl.

const KEY = 'ansicht.global'
const GROESSE: Record<Ansicht, string> = { liste: 'klein', kacheln: 'mittel', gross: 'gross' }
const gueltig = (a: unknown): a is Ansicht => a === 'liste' || a === 'kacheln' || a === 'gross'

const HANDY = '(max-width: 640px)'
// Noch nie gewählt: so wie die Startseite selbst (Handy: Liste, PC: Kacheln)
const standard = (): Ansicht => (window.matchMedia(HANDY).matches ? 'liste' : 'kacheln')

function gespeichert(): Ansicht | null {
  try {
    const a = localStorage.getItem(KEY)
    if (gueltig(a)) return a
  } catch { /* ignorieren */ }
  // Bisherige Wahl für „Alle“ übernehmen, damit sich für Bestandsnutzer nichts überraschend ändert
  const alle = ladeAnsichten().alle
  return gueltig(alle) ? alle : null
}

let gewaehlt = gespeichert()
let aktuell: Ansicht = gewaehlt ?? standard()
const hoerer = new Set<() => void>()

const anwenden = () => { document.documentElement.dataset.kachel = GROESSE[aktuell] }
anwenden() // beim Laden des Moduls, damit nichts aufblitzt

function setze(neu: Ansicht) {
  if (neu === aktuell) return
  aktuell = neu
  anwenden()
  hoerer.forEach(f => f())
}

export function setzeAnsichtGlobal(a: Ansicht) {
  gewaehlt = a
  try { localStorage.setItem(KEY, a) } catch { /* ignorieren */ }
  setze(a)
}

// Ohne eigene Wahl folgt die Größe der Fensterbreite (Fenster auf Handy-Breite ziehen → klein)
window.matchMedia(HANDY).addEventListener('change', () => { if (!gewaehlt) setze(standard()) })

export function useAnsichtGlobal(): Ansicht {
  return useSyncExternalStore(f => { hoerer.add(f); return () => { hoerer.delete(f) } }, () => aktuell)
}
