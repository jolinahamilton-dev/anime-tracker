import { useEffect, useRef, useState } from 'react'
import { useWischen } from '../tastatur'
import './BildVergroesserung.css'

export interface Bild {
  id: number
  url: string
  titel: string
}

interface Props {
  url: string
  alt: string
  onSchliessen: () => void
  // Optional (Liste): alle Cover der sichtbaren Liste – dann ◀ ▶, ←/→ und Wischen zum Blättern.
  // `url`/`alt` sind das Startbild; ohne `bilder` bleibt es beim Einzelbild (Detailseite).
  bilder?: Bild[]
  startId?: number
  onOeffnen?: (id: number) => void // „Details" – öffnet den gerade gezeigten Eintrag
}

// AniList liefert unter /cover/large/ die hochauflösende Variante (extraLarge) der
// gespeicherten /cover/medium/-Adresse – existiert nicht für jedes Cover, daher Fallback
function hochaufloesend(url: string) {
  return url.replace('/cover/medium/', '/cover/large/')
}

// Eigene Komponente je Bild (key = url), damit der Fallback-Zustand beim Blättern neu beginnt
function GrossesBild({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState(hochaufloesend(url))
  return (
    <img
      src={src}
      alt={alt}
      className="bild-gross"
      onClick={e => e.stopPropagation()}
      onError={() => { if (src !== url) setSrc(url) }}
    />
  )
}

export default function BildVergroesserung({ url, alt, onSchliessen, bilder, startId, onOeffnen }: Props) {
  const [aktuellId, setAktuellId] = useState(startId)
  const schliessenRef = useRef<HTMLButtonElement>(null)

  const idx = bilder && aktuellId != null ? bilder.findIndex(b => b.id === aktuellId) : -1
  const blaettern = idx >= 0 && bilder!.length > 1
  const aktuell = idx >= 0 ? bilder![idx] : null
  const vorher = blaettern && idx > 0 ? bilder![idx - 1] : null
  const nachher = blaettern && idx < bilder!.length - 1 ? bilder![idx + 1] : null

  const zurueck = () => { if (vorher) setAktuellId(vorher.id) }
  const weiter = () => { if (nachher) setAktuellId(nachher.id) }
  const wischen = useWischen(weiter, zurueck)

  // Fokus in das Overlay holen und beim Schließen dorthin zurückgeben, wo er vorher war
  useEffect(() => {
    const vorherFokus = document.activeElement as HTMLElement | null
    schliessenRef.current?.focus()
    return () => vorherFokus?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSchliessen()
      else if (e.key === 'ArrowLeft' && vorher) setAktuellId(vorher.id)
      else if (e.key === 'ArrowRight' && nachher) setAktuellId(nachher.id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSchliessen, vorher, nachher])

  // Nachbarbilder vorladen, damit das Blättern ohne Wartezeit geht
  useEffect(() => {
    for (const b of [vorher, nachher]) if (b) new Image().src = hochaufloesend(b.url)
  }, [vorher, nachher])

  const zeigeUrl = aktuell?.url ?? url
  const zeigeTitel = aktuell?.titel ?? alt

  return (
    <div className={aktuell ? 'bild-overlay bild-overlay--leiste' : 'bild-overlay'} onClick={onSchliessen} role="dialog" aria-modal="true"
      aria-label={`Cover: ${zeigeTitel}`} {...(blaettern ? wischen : {})}>
      <GrossesBild key={zeigeUrl} url={zeigeUrl} alt={zeigeTitel} />
      <button ref={schliessenRef} className="bild-schliessen" onClick={onSchliessen} title="Schließen (Esc)" aria-label="Schließen">✕</button>

      {blaettern && (
        <>
          <button className="bild-pfeil bild-pfeil--links" disabled={!vorher} aria-label="Vorheriges Cover"
            title="Vorheriges (←)" onClick={e => { e.stopPropagation(); zurueck() }}>◀</button>
          <button className="bild-pfeil bild-pfeil--rechts" disabled={!nachher} aria-label="Nächstes Cover"
            title="Nächstes (→)" onClick={e => { e.stopPropagation(); weiter() }}>▶</button>
        </>
      )}

      {aktuell && (
        <div className="bild-leiste" onClick={e => e.stopPropagation()}>
          <span className="bild-titel" aria-live="polite">{aktuell.titel}</span>
          {blaettern && <span className="bild-position">{idx + 1}/{bilder!.length}</span>}
          {onOeffnen && (
            <button className="bild-details" onClick={() => onOeffnen(aktuell.id)}>Details öffnen</button>
          )}
        </div>
      )}
    </div>
  )
}
