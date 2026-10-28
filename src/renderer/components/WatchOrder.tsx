import { useState, DragEvent } from 'react'
import './WatchOrder.css'

export interface WatchItem {
  related_anilist_id: number
  relation_type: string
  position: number
  is_custom?: number
  title?: string | null
  cover_url?: string | null
  total_episodes?: number | null
  progress_episodes: number
  item_status: 'planned' | 'started' | 'completed'
  // Vom Serien-Abgleich gepflegt
  aired_episodes?: number | null
  media_status?: string | null
  neu_seit?: string | null
}

/** Vom Abgleich in den letzten 14 Tagen ergänzt */
export const istNeueStaffel = (item: WatchItem) =>
  !!item.neu_seit && Date.now() - new Date(item.neu_seit).getTime() < 14 * 24 * 3600 * 1000

// Kontrollierte Komponente: Die Staffel-Liste gehört der DetailPage (eine einzige
// Quelle der Wahrheit). Früher hielten DetailPage und WatchOrder je eine eigene Kopie
// und überschrieben sich beim Speichern gegenseitig.
interface Props {
  items: WatchItem[]
  onAendern: (items: WatchItem[]) => void
  onReset: () => void
}

const RELATION_LABEL: Record<string, string> = {
  MAIN: 'Hauptstaffel',
  PREQUEL: 'Prequel',
  SEQUEL: 'Sequel',
  SIDE_STORY: 'Side Story',
  ALTERNATIVE: 'Alternativ',
  SPIN_OFF: 'Spin-off',
  PARENT: 'Hauptserie',
  SUMMARY: 'Zusammenfassung',
  CHARACTER: 'Charakter',
  OTHER: 'Sonstiges',
}

// Staffeln der Hauptgeschichte; alles andere (Side Stories, Alternativen, Spin-offs …) ist eingeklappt,
// solange man es nicht angefangen hat – zählt auch für „+1" und die Übersicht nicht mit
const HAUPTLINIE = new Set(['MAIN', 'PREQUEL', 'SEQUEL'])
const istNebensache = (item: WatchItem) =>
  !HAUPTLINIE.has(item.relation_type) && item.item_status === 'planned' && !item.progress_episodes

const ITEM_STATUS_LABEL: Record<string, string> = {
  planned: 'Geplant',
  started: 'Schaut',
  completed: 'Fertig',
}

export default function WatchOrder({ items, onAendern, onReset }: Props) {
  // Während des Ziehens nur eine Vorschau umsortieren; übernommen wird erst beim Drop
  const [vorschau, setVorschau] = useState<WatchItem[] | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [alleZeigen, setAlleZeigen] = useState(false)
  const angezeigt = vorschau ?? items
  const versteckt = items.filter(istNebensache).length
  const sichtbar = (item: WatchItem) => alleZeigen || !istNebensache(item)

  function updateItem(index: number, changes: Partial<WatchItem>) {
    onAendern(items.map((item, i) => {
      if (i !== index) return item
      let updated = { ...item, ...changes }
      // Auto-complete: bei completed → Folgen auf Maximum
      if (changes.item_status === 'completed' && updated.total_episodes) {
        updated = { ...updated, progress_episodes: updated.total_episodes }
      }
      if (changes.progress_episodes !== undefined) {
        // Bis zur letzten Folge gezählt → „fertig"; darunter verringert → nicht mehr „fertig";
        // vom geplanten Stand aus weitergezählt → „schaut"
        if (updated.total_episodes && updated.progress_episodes >= updated.total_episodes) {
          updated = { ...updated, item_status: 'completed' }
        } else if (updated.item_status === 'completed' && updated.total_episodes) {
          updated = { ...updated, item_status: 'started' }
        } else if (updated.item_status === 'planned' && updated.progress_episodes > 0) {
          updated = { ...updated, item_status: 'started' }
        }
      }
      return updated
    }))
  }

  function onDragStart(i: number) {
    setDragIndex(i)
    setVorschau(items)
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === i || !vorschau) return
    const neu = [...vorschau]
    const [verschoben] = neu.splice(dragIndex, 1)
    neu.splice(i, 0, verschoben)
    setDragIndex(i)
    setVorschau(neu)
  }

  function onDrop() {
    if (vorschau) onAendern(vorschau.map(item => ({ ...item, is_custom: 1 })))
    setVorschau(null)
    setDragIndex(null)
  }

  // Außerhalb losgelassen oder mit Esc abgebrochen → alte Reihenfolge behalten
  function onDragEnd() {
    setVorschau(null)
    setDragIndex(null)
  }

  if (items.length === 0) return null

  return (
    <div className="watch-order">
      <div className="section-header">
        <h3 className="section-titel">Watch Order</h3>
        <button className="edit-btn" onClick={onReset} title="Automatische Reihenfolge wiederherstellen">↺ Reset</button>
      </div>
      {/* Drop auf der ganzen Liste annehmen – auch im Spalt zwischen zwei Einträgen */}
      <div className="watch-liste" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        {angezeigt.map((item, i) => sichtbar(item) && (
          <div
            key={item.related_anilist_id}
            className={[
              'watch-item',
              dragIndex === i ? 'dragging' : '',
              item.item_status === 'completed' ? 'item-completed' : '',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={() => onDragStart(i)}
            onDragOver={e => onDragOver(e, i)}
            onDragEnd={onDragEnd}
          >
            <span className="watch-pos">{angezeigt.slice(0, i + 1).filter(sichtbar).length}</span>
            {item.cover_url && (
              <img src={item.cover_url} alt="" className="watch-cover" />
            )}
            <div className="watch-info">
              <span className="watch-titel">{item.title ?? `ID ${item.related_anilist_id}`}</span>
              <span className="watch-relation">
                {RELATION_LABEL[item.relation_type] ?? item.relation_type}
                {istNeueStaffel(item) && <span className="staffel-badge staffel-badge--neu">NEU</span>}
                {item.media_status === 'NOT_YET_RELEASED' && <span className="staffel-badge">Angekündigt</span>}
              </span>

              {/* Fortschritt */}
              <div className="watch-progress-row">
                <button
                  className="zaehler-btn-sm"
                  onClick={() => updateItem(i, { progress_episodes: Math.max(0, (item.progress_episodes ?? 0) - 1) })}
                >−</button>
                <span className="watch-ep">
                  {item.progress_episodes ?? 0}
                  <span className="watch-ep-von">/{item.total_episodes || '?'}</span>
                </span>
                <button
                  className="zaehler-btn-sm"
                  onClick={() => updateItem(i, { progress_episodes: Math.min(item.total_episodes || 9999, (item.progress_episodes ?? 0) + 1) })}
                >+</button>
              </div>
            </div>

            {/* Status-Toggle */}
            <div className="watch-status-wrap">
              {(['planned', 'started', 'completed'] as const).map(s => (
                <button
                  key={s}
                  className={['watch-status-btn', item.item_status === s ? 'aktiv' : ''].filter(Boolean).join(' ')}
                  onClick={() => updateItem(i, { item_status: s })}
                  title={ITEM_STATUS_LABEL[s]}
                >
                  {s === 'planned' ? '📌' : s === 'started' ? '▶' : '✓'}
                </button>
              ))}
            </div>

            <span className="drag-handle">⠿</span>
          </div>
        ))}
      </div>
      {versteckt > 0 && (
        <button className="watch-mehr" onClick={() => setAlleZeigen(!alleZeigen)} aria-expanded={alleZeigen}>
          {alleZeigen ? 'Nebengeschichten ausblenden' : `+ ${versteckt} Nebengeschichte${versteckt === 1 ? '' : 'n'} (Side Stories, Alternativen …)`}
        </button>
      )}
    </div>
  )
}
