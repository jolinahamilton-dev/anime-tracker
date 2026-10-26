import { useEffect, useRef, useState } from 'react'
import { EntryStatus } from '../../types'
import { STATUS_FARBE } from './EintragKarte'
import './StatusFilter.css'

const STATUS: Array<{ key: EntryStatus; label: string }> = [
  { key: 'started', label: 'Angefangen' },
  { key: 'ongoing', label: 'Laufend' },
  { key: 'completed', label: 'Beendet' },
  { key: 'planned', label: 'Geplant' },
  { key: 'paused', label: 'Pausiert' },
  { key: 'dropped', label: 'Abgebrochen' },
]

interface Props {
  ausgewaehlt: EntryStatus[] // leer = alle
  anzahl: Record<string, number>
  onAendern: (status: EntryStatus[]) => void
  variante?: 'menue' | 'chips' // chips = alle Status nebeneinander (Filter-Fenster am Handy)
}

export default function StatusFilter({ ausgewaehlt, anzahl, onAendern, variante = 'menue' }: Props) {
  const [offen, setOffen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Schließen bei Klick außerhalb oder Esc
  useEffect(() => {
    if (!offen) return
    const klick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOffen(false) }
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') setOffen(false) }
    document.addEventListener('mousedown', klick)
    document.addEventListener('keydown', taste)
    return () => {
      document.removeEventListener('mousedown', klick)
      document.removeEventListener('keydown', taste)
    }
  }, [offen])

  function umschalten(s: EntryStatus) {
    onAendern(ausgewaehlt.includes(s) ? ausgewaehlt.filter(x => x !== s) : [...ausgewaehlt, s])
  }

  if (variante === 'chips') {
    return (
      <div className="sheet-chips">
        {STATUS.map(s => {
          const an = ausgewaehlt.includes(s.key)
          return (
            <button
              key={s.key}
              className={an ? 'filter-btn active status-chip' : 'filter-btn status-chip'}
              aria-pressed={an}
              onClick={() => umschalten(s.key)}
            >
              <span className="status-punkt" style={{ background: STATUS_FARBE[s.key] }} />
              {s.label}
              <span className="status-anzahl">{anzahl[s.key] ?? 0}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const erster = STATUS.find(s => s.key === ausgewaehlt[0])
  const beschriftung = ausgewaehlt.length === 0 ? 'Alle'
    : ausgewaehlt.length === 1 ? erster?.label
    : `${erster?.label} +${ausgewaehlt.length - 1}`
  const gesamt = Object.values(anzahl).reduce((a, b) => a + b, 0)

  return (
    <div className="status-filter" ref={ref}>
      <button
        className={ausgewaehlt.length ? 'status-filter-btn aktiv' : 'status-filter-btn'}
        onClick={() => setOffen(o => !o)}
        aria-expanded={offen}
      >
        <span className="status-filter-punkte">
          {ausgewaehlt.map(s => <span key={s} className="status-punkt" style={{ background: STATUS_FARBE[s] }} />)}
        </span>
        Status: {beschriftung}
        <span className="status-filter-pfeil">▾</span>
      </button>

      {offen && (
        <div className="status-filter-menue" role="menu">
          <button
            className={ausgewaehlt.length === 0 ? 'status-option gewaehlt' : 'status-option'}
            onClick={() => onAendern([])}
          >
            <span className="status-haken">{ausgewaehlt.length === 0 ? '✓' : ''}</span>
            Alle
            <span className="status-anzahl">{gesamt}</span>
          </button>
          <div className="status-trenner" />
          {STATUS.map(s => {
            const an = ausgewaehlt.includes(s.key)
            return (
              <button
                key={s.key}
                className={an ? 'status-option gewaehlt' : 'status-option'}
                onClick={() => umschalten(s.key)}
                role="menuitemcheckbox"
                aria-checked={an}
              >
                <span className="status-haken">{an ? '✓' : ''}</span>
                <span className="status-punkt" style={{ background: STATUS_FARBE[s.key] }} />
                {s.label}
                <span className="status-anzahl">{anzahl[s.key] ?? 0}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
