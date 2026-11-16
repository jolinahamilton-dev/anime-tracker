import { useEffect, useRef, useState } from 'react'
import { MehrfachAktion } from '../../types'
import { STATUS_FARBE } from './EintragKarte'
import './Auswahlleiste.css'

// Leiste unten für die Mehrfachauswahl (Plan Nr. 11): Status, Liste, Favorit, Abo, Löschen.

const STATUS: Array<{ key: 'ongoing' | 'completed' | 'planned' | 'paused' | 'dropped'; label: string }> = [
  { key: 'ongoing', label: 'Laufend' },
  { key: 'completed', label: 'Beendet' },
  { key: 'planned', label: 'Geplant' },
  { key: 'paused', label: 'Pausiert' },
  { key: 'dropped', label: 'Abgebrochen' },
]

type Menue = 'status' | 'liste' | 'favorit' | 'abo' | null

interface Props {
  anzahl: number // ausgewählt (und sichtbar)
  sichtbar: number // alle sichtbaren Einträge
  listen: Array<{ id: number; name: string }>
  beschaeftigt: boolean
  onAktion: (a: MehrfachAktion) => void
  onAlle: () => void
  onKeine: () => void
  onFertig: () => void
}

export default function Auswahlleiste({ anzahl, sichtbar, listen, beschaeftigt, onAktion, onAlle, onKeine, onFertig }: Props) {
  const [menue, setMenue] = useState<Menue>(null)
  const ref = useRef<HTMLDivElement>(null)
  const keine = anzahl === 0 || beschaeftigt

  // Menü schließt bei Klick daneben und mit Esc (Esc schließt nur das Menü, nicht den Auswahlmodus)
  useEffect(() => {
    if (!menue) return
    const klick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenue(null) }
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenue(null) } }
    document.addEventListener('mousedown', klick)
    document.addEventListener('keydown', taste, true)
    return () => { document.removeEventListener('mousedown', klick); document.removeEventListener('keydown', taste, true) }
  }, [menue])

  const los = (a: MehrfachAktion) => { setMenue(null); onAktion(a) }
  const knopf = (m: Exclude<Menue, null>, text: string, label: string) => (
    <button className={menue === m ? 'al-knopf aktiv' : 'al-knopf'} disabled={keine} aria-haspopup="menu"
      aria-expanded={menue === m} aria-label={label} onClick={() => setMenue(menue === m ? null : m)}>{text}</button>
  )

  return (
    <div className="auswahl-leiste" role="toolbar" aria-label="Aktionen für ausgewählte Einträge" ref={ref}>
      <div className="al-kopf">
        <span className="al-zahl" role="status" aria-live="polite">
          {anzahl === 0 ? 'Nichts ausgewählt' : `${anzahl} ausgewählt`}
        </span>
        <button className="al-link" onClick={onAlle} disabled={sichtbar === 0 || anzahl === sichtbar} aria-label={`Alle ${sichtbar} sichtbaren Einträge auswählen`}>Alle<span className="al-nur-gross"> sichtbaren</span> ({sichtbar})</button>
        <button className="al-link" onClick={onKeine} disabled={anzahl === 0}>Keine</button>
        <button className="al-fertig" onClick={onFertig} aria-label="Auswahl beenden">✕ Fertig</button>
      </div>
      <div className="al-knoepfe">
        {knopf('status', 'Status ▾', 'Status ändern')}
        {knopf('liste', 'Liste ▾', 'Zu Liste hinzufügen oder entfernen')}
        {knopf('favorit', '⭐ ▾', 'Favorit')}
        {knopf('abo', '🔔 ▾', 'Abo (nur Anime)')}
        <button className="al-knopf al-loeschen" disabled={keine} onClick={() => los({ art: 'loeschen' })} aria-label="Ausgewählte löschen">🗑 Löschen</button>
      </div>

      {menue && (
        <div className="al-menue" role="menu" aria-label={menue === 'status' ? 'Status setzen' : menue === 'liste' ? 'Liste' : menue === 'favorit' ? 'Favorit' : 'Abo'}>
          {menue === 'status' && STATUS.map(s => (
            <button key={s.key} role="menuitem" className="al-option" onClick={() => los({ art: 'status', status: s.key })}>
              <span className="status-punkt" style={{ background: STATUS_FARBE[s.key] }} />Setzen auf „{s.label}“
            </button>
          ))}
          {menue === 'liste' && (listen.length === 0
            ? <p className="al-leer">Noch keine eigene Liste. Lege oben mit „+ Neu“ eine an.</p>
            : listen.map(l => (
              <div key={l.id} className="al-liste-zeile">
                <span className="al-liste-name" title={l.name}>{l.name}</span>
                <button role="menuitem" className="al-option al-option--klein" aria-label={`Zu „${l.name}“ hinzufügen`} onClick={() => los({ art: 'liste', listeId: l.id, hinzu: true })}>+ Hinzufügen</button>
                <button role="menuitem" className="al-option al-option--klein" aria-label={`Aus „${l.name}“ entfernen`} onClick={() => los({ art: 'liste', listeId: l.id, hinzu: false })}>− Entfernen</button>
              </div>
            )))}
          {menue === 'favorit' && <>
            <button role="menuitem" className="al-option" onClick={() => los({ art: 'favorit', wert: true })}>⭐ Zu Favoriten hinzufügen</button>
            <button role="menuitem" className="al-option" onClick={() => los({ art: 'favorit', wert: false })}>☆ Aus Favoriten entfernen</button>
          </>}
          {menue === 'abo' && <>
            <button role="menuitem" className="al-option" onClick={() => los({ art: 'abo', wert: true })}>🔔 Abonnieren (nur Anime)</button>
            <button role="menuitem" className="al-option" onClick={() => los({ art: 'abo', wert: false })}>🔕 Abo beenden</button>
          </>}
        </div>
      )}
    </div>
  )
}
