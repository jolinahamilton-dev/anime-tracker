import { useSyncExternalStore } from 'react'
import { api } from './api'

// Titelsprache („englisch" ist Standard): Einträge, Staffeln und News bringen ihren Anzeigetitel
// selbst mit (`anzeige_titel`, im Main-Prozess nach der Einstellung gewählt) – AniList-Treffer aus
// Suche/Vorschlägen haben dagegen alle Titel und werden hier nach der Einstellung gewählt.

export type TitelSprache = 'englisch' | 'romaji' | 'japanisch'
export const TITEL_STANDARD: TitelSprache = 'englisch'

let sprache: TitelSprache = TITEL_STANDARD
const hoerer = new Set<() => void>()

function setze(neu: TitelSprache) {
  if (neu === sprache) return
  sprache = neu
  hoerer.forEach(f => f())
}

function lade() {
  api.getMeta('titelSprache').then(w => {
    setze(w === 'romaji' || w === 'japanisch' || w === 'englisch' ? w : TITEL_STANDARD)
  }).catch(() => { /* bleibt beim bisherigen Wert */ })
}

// Beim Start lesen und bei jeder Änderung der Daten (die Einstellung löst sie aus) bzw. des Hintergrund-Abgleichs neu
lade()
window.addEventListener('tracker:daten-geaendert', lade)
api.onSerienAktualisiert(lade)

/** Aktuelle Titelsprache; lässt die Komponente neu zeichnen, wenn sie sich ändert (für AniList-Treffer) */
export function useTitelSprache(): TitelSprache {
  return useSyncExternalStore(f => { hoerer.add(f); return () => { hoerer.delete(f) } }, () => sprache)
}

/** Titel eines Eintrags/einer Staffel/einer Meldung in der gewählten Sprache (sonst der Originaltitel) */
export function anzeigeTitel(x: { title?: string | null; anzeige_titel?: string | null }): string {
  return x.anzeige_titel || x.title || ''
}

export interface MediaTitelObjekt { romaji?: string | null; english?: string | null; native?: string | null }

/** Titel eines AniList-Treffers nach der Einstellung; fehlt die Sprache, gilt romaji */
export function mediaTitel(media: { title?: MediaTitelObjekt | null }, s: TitelSprache = sprache): string {
  const t = media.title
  const wunsch = s === 'englisch' ? t?.english : s === 'japanisch' ? t?.native : t?.romaji
  return wunsch?.trim() || t?.romaji || t?.english || t?.native || ''
}

/** Der Titel eines Treffers in einer anderen Sprache als der angezeigten (Nebenzeile), sonst null */
export function mediaNebentitel(media: { title?: MediaTitelObjekt | null }, s: TitelSprache = sprache): string | null {
  const haupt = mediaTitel(media, s)
  const t = media.title
  const kandidat = [t?.romaji, t?.english].find(x => x && x !== haupt)
  return kandidat ?? null
}
