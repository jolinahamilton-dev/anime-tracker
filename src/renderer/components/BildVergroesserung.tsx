import { useEffect, useState } from 'react'
import './BildVergroesserung.css'

interface Props {
  url: string
  alt: string
  onSchliessen: () => void
}

// AniList liefert unter /cover/large/ die hochauflösende Variante (extraLarge) der
// gespeicherten /cover/medium/-Adresse – existiert nicht für jedes Cover, daher Fallback
function hochaufloesend(url: string) {
  return url.replace('/cover/medium/', '/cover/large/')
}

export default function BildVergroesserung({ url, alt, onSchliessen }: Props) {
  const [src, setSrc] = useState(hochaufloesend(url))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSchliessen() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSchliessen])

  return (
    <div className="bild-overlay" onClick={onSchliessen}>
      <img
        src={src}
        alt={alt}
        className="bild-gross"
        onClick={e => e.stopPropagation()}
        onError={() => { if (src !== url) setSrc(url) }}
      />
      <button className="bild-schliessen" onClick={onSchliessen} title="Schließen (Esc)">✕</button>
    </div>
  )
}
