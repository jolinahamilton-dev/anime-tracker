import { KeyboardEvent, MouseEvent } from 'react'
import { Entry } from '../../types'
import { Ansicht } from '../listenZustand'
import './EintragKarte.css'

export const STATUS_FARBE: Record<string, string> = {
  started: '#4a9eff',
  ongoing: '#4adb6f',
  completed: '#a259ff',
  planned: '#f5a623',
  dropped: '#e74c3c',
  paused: '#95a5a6',
}

const STATUS_LABEL: Record<string, string> = {
  started: 'Angefangen',
  ongoing: 'Ongoing',
  completed: 'Beendet',
  planned: 'Geplant',
  dropped: 'Abgebrochen',
  paused: 'Pausiert',
}

interface Props {
  entry: Entry
  onClick: () => void
  ansicht?: Ansicht
  onVergroessern?: () => void
  onAboUmschalten?: () => void
  onPlusEins?: () => void
}

// Klick auf einen Knopf in der Karte soll die Karte nicht öffnen
const nurKnopf = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f() }

export default function EintragKarte({ entry, onClick, ansicht = 'kacheln', onVergroessern, onAboUmschalten, onPlusEins }: Props) {
  const aboMoeglich = entry.type === 'ANIME' && entry.anilist_id != null && !!onAboUmschalten
  const plusMoeglich = !!onPlusEins && entry.status !== 'completed' && entry.status !== 'dropped'
  const einheit = entry.type === 'ANIME' ? 'Folge' : 'Kapitel'
  const fortschritt = entry.type === 'ANIME'
    ? { aktuell: entry.progress_episodes, gesamt: entry.total_episodes }
    : { aktuell: entry.progress_chapters, gesamt: entry.total_chapters }

  const prozent = fortschritt.gesamt
    ? Math.min(100, Math.round((fortschritt.aktuell / fortschritt.gesamt) * 100))
    : null

  // Karte ist ein div (kein button), damit echte Knöpfe darin erlaubt sind – per Tastatur
  // trotzdem mit Tab erreichbar und mit Enter/Leertaste zu öffnen
  function taste(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
    if ((e.key === '+' || e.key === 'Add') && plusMoeglich) { e.preventDefault(); onPlusEins!() }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${entry.title}, ${STATUS_LABEL[entry.status]}`}
      className={`eintrag-karte karte--${ansicht}${entry.status === 'completed' ? ' karte--beendet' : ''}`}
      onClick={onClick}
      onKeyDown={taste}
    >
      <div className="karte-cover-wrap">
        {entry.cover_url ? (
          <img src={entry.cover_url} alt="" className="karte-cover" loading="lazy" />
        ) : (
          <div className="karte-cover karte-cover--placeholder">
            <span>{entry.type === 'ANIME' ? '🎬' : '📚'}</span>
          </div>
        )}
        <span className="karte-icons">
          {aboMoeglich && (
            <button
              className={entry.abonniert ? 'karte-abo karte-abo--an' : 'karte-abo'}
              title={entry.abonniert ? 'Abonniert – klicken zum Abbestellen' : 'Abonnieren (News & neue Folgen)'}
              aria-label={entry.abonniert ? 'Abo beenden' : 'Abonnieren'}
              aria-pressed={!!entry.abonniert}
              onClick={nurKnopf(onAboUmschalten!)}
            >{entry.abonniert ? '🔔' : '🔕'}</button>
          )}
          {entry.is_favorite ? <span className="karte-favorit" aria-label="Favorit">⭐</span> : null}
        </span>
        <span className={`karte-typ typ-${entry.type.toLowerCase()}`}>{entry.type}</span>
        {entry.cover_url && onVergroessern && (
          <button className="karte-zoom" title="Bild vergrößern" aria-label="Bild vergrößern" onClick={nurKnopf(onVergroessern)}>🔍</button>
        )}
      </div>

      <div className="karte-info">
        <div className="karte-titel-block">
          <p className="karte-titel">{entry.title}</p>
          {entry.nickname && <p className="karte-nickname">„{entry.nickname}"</p>}
        </div>
        <span className={`karte-typ-inline typ-${entry.type.toLowerCase()}`}>{entry.type}</span>
        <span className="karte-status" style={{ color: STATUS_FARBE[entry.status] }}>
          {STATUS_LABEL[entry.status]}
          {entry.rewatch_count > 0 && <span className="karte-rewatch" title={`${entry.rewatch_count}× wiederholt`}> ↻{entry.rewatch_count}</span>}
        </span>
        {prozent !== null ? (
          <div className="karte-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${prozent}%` }} />
            </div>
            <span className="progress-text">{fortschritt.aktuell}/{fortschritt.gesamt}</span>
          </div>
        ) : ansicht === 'liste' && <div className="karte-progress" />}
        {entry.rating ? (
          <div className="karte-sterne" aria-label={`${Math.min(5, entry.rating)} von 5 Sternen`}>
            {/* Sterne-UI vergibt nur 1-5, DB lässt aus historischen Gründen bis 10 zu –
                hier defensiv auf 0-5 clampen, sonst würde repeat() mit negativer Zahl crashen */}
            {'★'.repeat(Math.min(5, entry.rating))}{'☆'.repeat(Math.max(0, 5 - entry.rating))}
          </div>
        ) : ansicht === 'liste' && <div className="karte-sterne" />}
        {/* Leere Platzhalter halten die Spalten in der Listenansicht bündig */}
        {plusMoeglich ? (
          <button
            className="karte-plus"
            title={`+1 ${einheit} (Taste +)`}
            aria-label={`Eine ${einheit} weiter`}
            onClick={nurKnopf(onPlusEins!)}
          >+1</button>
        ) : ansicht === 'liste' && onPlusEins && <div className="karte-plus karte-plus--leer" />}
      </div>
    </div>
  )
}
