import { useState, useEffect } from 'react'
import './AchievementToast.css'
import { api } from '../api'

export default function AchievementToast() {
  const [queue, setQueue] = useState<string[]>([])
  const [aktuell, setAktuell] = useState<string | null>(null)
  const [ausblenden, setAusblenden] = useState(false)

  useEffect(() => {
    const cleanup = api.onAchievementNeu((namen: string[]) => {
      setQueue(prev => [...prev, ...namen])
    })
    return cleanup
  }, [])

  // Queue → aktuell: nur wenn nichts angezeigt wird
  useEffect(() => {
    if (aktuell !== null || queue.length === 0) return
    const [naechstes, ...rest] = queue
    setAktuell(naechstes)
    setQueue(rest)
    setAusblenden(false)
  }, [aktuell, queue])

  // Timer: unabhängig von queue, damit queue-Updates ihn nicht abbrechen
  useEffect(() => {
    if (!aktuell) return
    const ausblend = setTimeout(() => setAusblenden(true), 3200)
    const hide = setTimeout(() => setAktuell(null), 3700)
    return () => { clearTimeout(ausblend); clearTimeout(hide) }
  }, [aktuell])

  if (!aktuell) return null

  return (
    <div className={ausblenden ? 'achievement-toast toast-out' : 'achievement-toast'}>
      <span className="toast-icon">🎉</span>
      <div className="toast-text">
        <span className="toast-label">Achievement freigeschaltet</span>
        <span className="toast-name">{aktuell}</span>
      </div>
    </div>
  )
}
