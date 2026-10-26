import { ReactNode, useEffect } from 'react'
import './BottomSheet.css'

interface Props {
  titel: string
  onSchliessen: () => void
  children: ReactNode
  fuss?: ReactNode
}

// Fenster, das am Handy von unten hereinfährt (z. B. die Filter der Liste)
export default function BottomSheet({ titel, onSchliessen, children, fuss }: Props) {
  useEffect(() => {
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') onSchliessen() }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [onSchliessen])

  return (
    <div className="sheet-hintergrund" onClick={onSchliessen}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={titel} onClick={e => e.stopPropagation()}>
        <div className="sheet-griff" />
        <div className="sheet-kopf">
          <h3>{titel}</h3>
          <button className="sheet-zu" aria-label="Schließen" onClick={onSchliessen}>✕</button>
        </div>
        <div className="sheet-inhalt">{children}</div>
        {fuss && <div className="sheet-fuss">{fuss}</div>}
      </div>
    </div>
  )
}
