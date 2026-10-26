import { useState, useEffect, useCallback } from 'react'
import { Entry } from '../../types'
import { api } from '../api'

export function useEntries() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [laden, setLaden] = useState(true)

  const laden_ = useCallback(async () => {
    setLaden(true)
    const data = await api.getEntries()
    setEntries(data)
    setLaden(false)
  }, [])

  useEffect(() => { laden_() }, [laden_])

  const aktualisieren = laden_

  // Ohne Ladeanzeige neu laden (z. B. nach Hintergrund-Abgleich) – Scrollposition bleibt
  const stillAktualisieren = useCallback(async () => {
    setEntries(await api.getEntries())
  }, [])

  return { entries, laden, aktualisieren, stillAktualisieren }
}
