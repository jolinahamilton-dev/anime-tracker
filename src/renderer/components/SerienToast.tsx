import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './AchievementToast.css'
import { api } from '../api'

interface Aenderung { entryId: number; titel: string; art: 'folge' | 'staffel'; statusGeaendert: boolean }

// Hinweis nach dem Serien-Abgleich: „Neue Folgen: A, B · Neue Staffel: C"
export default function SerienToast() {
  const navigate = useNavigate()
  const [text, setText] = useState<{ label: string; namen: string } | null>(null)
  const [ausblenden, setAusblenden] = useState(false)

  useEffect(() => api.onSerienAktualisiert((d: { aenderungen: Aenderung[] }) => {
    if (!d.aenderungen.length) return
    const staffeln = d.aenderungen.filter(a => a.art === 'staffel')
    const folgen = d.aenderungen.filter(a => a.art === 'folge')
    const label = staffeln.length && folgen.length ? 'Neue Staffeln & Folgen'
      : staffeln.length ? (staffeln.length === 1 ? 'Neue Staffel' : 'Neue Staffeln')
      : 'Neue Folgen'
    const namen = d.aenderungen.map(a => a.titel)
    setText({ label, namen: namen.slice(0, 3).join(', ') + (namen.length > 3 ? ` +${namen.length - 3}` : '') })
    setAusblenden(false)
  }), [])

  useEffect(() => {
    if (!text) return
    const aus = setTimeout(() => setAusblenden(true), 7000)
    const weg = setTimeout(() => setText(null), 7500)
    return () => { clearTimeout(aus); clearTimeout(weg) }
  }, [text])

  if (!text) return null

  return (
    <div
      className={ausblenden ? 'achievement-toast toast-out' : 'achievement-toast'}
      style={{ bottom: 206, cursor: 'pointer' }}
      onClick={() => { setText(null); navigate('/news') }}
      title="Zu den News"
    >
      <span className="toast-icon">📺</span>
      <div className="toast-text">
        <span className="toast-label">{text.label}</span>
        <span className="toast-name">{text.namen}</span>
      </div>
    </div>
  )
}
