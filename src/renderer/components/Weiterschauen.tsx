import { useCallback, useEffect, useState } from 'react'
import { api, WeiterschauenEintrag } from '../api'
import { aendereFortschritt, useBeiAenderung } from '../aktionen'
import './Weiterschauen.css'

const ZU_KEY = 'liste.weiterschauenZu'

interface Props {
  onOeffnen: (entryId: number) => void
}

// Leiste „Weiterschauen": angefangene/laufende Anime, bei denen schon ungesehene Folgen bereitliegen
export default function Weiterschauen({ onOeffnen }: Props) {
  const [eintraege, setEintraege] = useState<WeiterschauenEintrag[]>([])
  const [zu, setZu] = useState(() => { try { return localStorage.getItem(ZU_KEY) === '1' } catch { return false } })

  const laden = useCallback(() => { api.getWeiterschauen().then(setEintraege) }, [])
  useEffect(() => { laden() }, [laden])
  useEffect(() => api.onSerienAktualisiert(laden), [laden])
  useBeiAenderung(laden)

  function umschalten() {
    setZu(!zu)
    try { localStorage.setItem(ZU_KEY, zu ? '0' : '1') } catch { /* egal */ }
  }

  if (eintraege.length === 0) return null

  return (
    <section className="weiterschauen" aria-label="Weiterschauen">
      <button className="weiterschauen-kopf" onClick={umschalten} aria-expanded={!zu}>
        <span>▶ Weiterschauen</span>
        <span className="weiterschauen-zahl">{eintraege.length}</span>
        <span className="weiterschauen-pfeil">{zu ? '▸' : '▾'}</span>
      </button>
      {!zu && (
        <div className="weiterschauen-leiste">
          {eintraege.map(w => {
            const offen = w.verfuegbar - w.gesehen
            return (
              <div key={w.entry_id} className="ws-karte" role="button" tabIndex={0}
                onClick={() => onOeffnen(w.entry_id)}
                onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOeffnen(w.entry_id) }}
              >
                {w.cover_url ? <img src={w.cover_url} alt="" className="ws-cover" loading="lazy" /> : <div className="ws-cover ws-cover--leer">🎬</div>}
                <div className="ws-info">
                  <span className="ws-titel">{w.title}</span>
                  {w.staffel && <span className="ws-staffel">{w.staffel}</span>}
                  <span className="ws-stand">
                    Folge {w.gesehen}/{w.total ?? w.verfuegbar}
                    <span className="ws-offen">{offen} neu</span>
                  </span>
                </div>
                <button
                  className="ws-plus"
                  aria-label={`${w.title}: eine Folge weiter`}
                  title="+1 Folge"
                  onClick={e => { e.stopPropagation(); aendereFortschritt(w.entry_id, 1) }}
                >+1</button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
