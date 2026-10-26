import { useEffect, useRef, useState, TouchEvent } from 'react'

/** true, wenn gerade in ein Eingabefeld getippt wird – dann keine Tastenkürzel auslösen */
export function istTippen(e: KeyboardEvent): boolean {
  const ziel = e.target as HTMLElement | null
  if (!ziel) return false
  return ziel.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ziel.tagName)
}

/** Ist gerade ein Overlay offen (Rückfrage, Bild-Vergrößerung, Filter-Fenster)? */
export function overlayOffen(): boolean {
  return !!document.querySelector('.dialog-hintergrund, .bild-overlay, .sheet-hintergrund')
}

/** Tastendruck-Handler, der immer den aktuellen Stand der Seite sieht */
export function useTasten(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const f = (e: KeyboardEvent) => ref.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
}

/** Handy-Breite (unter 640 px) – dort andere Bedienung (Filter-Fenster, große Knöpfe) */
const HANDY = '(max-width: 640px)'
export function useIstHandy(): boolean {
  const [handy, setHandy] = useState(() => window.matchMedia(HANDY).matches)
  useEffect(() => {
    const mq = window.matchMedia(HANDY)
    const f = () => setHandy(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return handy
}

/** Wischgeste nach links/rechts (Touch), z. B. zum Blättern auf der Detailseite */
export function useWischen(links: () => void, rechts: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY } },
    onTouchEnd: (e: TouchEvent) => {
      if (!start.current) return
      const t = e.changedTouches[0]
      const dx = t.clientX - start.current.x
      const dy = t.clientY - start.current.y
      start.current = null
      // Deutlich waagerecht und weit genug – sonst ist es Scrollen
      if (Math.abs(dx) < 80 || Math.abs(dx) < 2 * Math.abs(dy)) return
      if (dx < 0) links(); else rechts()
    },
  }
}
