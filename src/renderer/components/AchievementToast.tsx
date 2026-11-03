import { useState, useEffect } from 'react'
import './AchievementToast.css'
import { api } from '../api'
import { Medaille } from './AchievementBereich'
import type { NeuesAchievement } from '../../types'

// Ältere Hauptprozesse schickten nur Namen – beides annehmen
const alsAchievement = (a: NeuesAchievement | string): NeuesAchievement =>
  typeof a === 'string' ? { id: a, name: a, icon: '🎉', beschreibung: '' } : a

export default function AchievementToast() {
  const [queue, setQueue] = useState<NeuesAchievement[]>([])
  const [aktuell, setAktuell] = useState<NeuesAchievement | null>(null)
  const [ausblenden, setAusblenden] = useState(false)

  useEffect(() => {
    const cleanup = api.onAchievementNeu((neu: (NeuesAchievement | string)[]) => {
      setQueue(prev => [...prev, ...neu.map(alsAchievement)])
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

  const stufe = aktuell.stufe ?? 0
  return (
    <div className={ausblenden ? 'achievement-toast toast-out' : 'achievement-toast'} role="status">
      {stufe > 0
        ? <Medaille stufe={stufe} icon={aktuell.icon} groesse="gross" />
        : <span className="toast-icon">{aktuell.icon || '🎉'}</span>}
      <div className="toast-text">
        <span className="toast-label">{stufe > 0 ? 'Neue Stufe erreicht' : 'Achievement freigeschaltet'}</span>
        <span className="toast-name">
          {aktuell.name}
          {aktuell.stufenName && <> · <span className={`ach-t${stufe}`}>{aktuell.stufenName}</span></>}
        </span>
        {aktuell.beschreibung && <span className="toast-beschreibung">{aktuell.beschreibung}</span>}
      </div>
    </div>
  )
}
