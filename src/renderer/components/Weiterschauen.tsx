import { ReactNode, useCallback, useEffect, useState } from 'react'
import { api, WeiterschauenEintrag } from '../api'
import { aendereFortschritt, useBeiAenderung } from '../aktionen'
import { Entry, MediaType } from '../../types'
import './Weiterschauen.css'

interface Props {
  onOeffnen: (entryId: number) => void
  entries: Entry[] // alle Einträge der Liste – daraus die Manga für „Weiterlesen"
  filterTyp: MediaType | 'ALLE' // ANIME → nur Weiterschauen, MANGA → nur Weiterlesen
}

/** Angefangene/laufende Manga, die noch nicht zu Ende gelesen sind – zuletzt bearbeitete zuerst */
export function weiterlesen(entries: Entry[]): Entry[] {
  return entries
    .filter(e => e.type === 'MANGA' && (e.status === 'started' || e.status === 'ongoing') &&
      (e.total_chapters == null || e.progress_chapters < e.total_chapters))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
}

// Auf-/Zuklappbare Leiste; ob sie zu ist, merkt sich jede Leiste einzeln
function Leiste({ symbol, titel, zuKey, anzahl, children }: { symbol: string; titel: string; zuKey: string; anzahl: number; children: ReactNode }) {
  const [zu, setZu] = useState(() => { try { return localStorage.getItem(zuKey) === '1' } catch { return false } })

  function umschalten() {
    setZu(!zu)
    try { localStorage.setItem(zuKey, zu ? '0' : '1') } catch { /* egal */ }
  }

  return (
    <section className="weiterschauen" aria-label={titel}>
      <button className="weiterschauen-kopf" onClick={umschalten} aria-expanded={!zu}>
        <span>{symbol} {titel}</span>
        <span className="weiterschauen-zahl">{anzahl}</span>
        <span className="weiterschauen-pfeil">{zu ? '▸' : '▾'}</span>
      </button>
      {!zu && <div className="weiterschauen-leiste">{children}</div>}
    </section>
  )
}

// Eine Karte: Cover, Titel, Stand und „+1"
function Karte({ id, titel, cover, leer, unter, stand, plusLabel, plusTitel, onOeffnen }: {
  id: number; titel: string; cover: string | null; leer: string; unter?: string | null
  stand: ReactNode; plusLabel: string; plusTitel: string; onOeffnen: (id: number) => void
}) {
  return (
    <div className="ws-karte" role="button" tabIndex={0}
      onClick={() => onOeffnen(id)}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOeffnen(id) }}
    >
      {cover ? <img src={cover} alt="" className="ws-cover" loading="lazy" /> : <div className="ws-cover ws-cover--leer">{leer}</div>}
      <div className="ws-info">
        <span className="ws-titel">{titel}</span>
        {unter && <span className="ws-staffel">{unter}</span>}
        <span className="ws-stand">{stand}</span>
      </div>
      <button
        className="ws-plus"
        aria-label={plusLabel}
        title={plusTitel}
        onClick={e => { e.stopPropagation(); aendereFortschritt(id, 1) }}
      >+1</button>
    </div>
  )
}

// Leisten „Weiterschauen" (angefangene/laufende Anime, bei denen schon ungesehene Folgen bereitliegen)
// und „Weiterlesen" (angefangene/laufende Manga – verfügbare Kapitel kennt man meist nicht)
export default function Weiterschauen({ onOeffnen, entries, filterTyp }: Props) {
  const [eintraege, setEintraege] = useState<WeiterschauenEintrag[]>([])

  const laden = useCallback(() => { api.getWeiterschauen().then(setEintraege) }, [])
  useEffect(() => { laden() }, [laden])
  useEffect(() => api.onSerienAktualisiert(laden), [laden])
  useBeiAenderung(laden)

  const anime = filterTyp === 'MANGA' ? [] : eintraege
  const manga = filterTyp === 'ANIME' ? [] : weiterlesen(entries)

  return (
    <>
      {anime.length > 0 && (
        <Leiste symbol="▶" titel="Weiterschauen" zuKey="liste.weiterschauenZu" anzahl={anime.length}>
          {anime.map(w => (
            <Karte key={w.entry_id} id={w.entry_id} titel={w.title} cover={w.cover_url} leer="🎬" unter={w.staffel}
              stand={<>Folge {w.gesehen}/{w.total ?? w.verfuegbar}<span className="ws-offen">{w.verfuegbar - w.gesehen} neu</span></>}
              plusLabel={`${w.title}: eine Folge weiter`} plusTitel="+1 Folge" onOeffnen={onOeffnen} />
          ))}
        </Leiste>
      )}
      {manga.length > 0 && (
        <Leiste symbol="📖" titel="Weiterlesen" zuKey="liste.weiterlesenZu" anzahl={manga.length}>
          {manga.map(e => {
            const titel = e.nickname || e.title
            return (
              <Karte key={e.id} id={e.id} titel={titel} cover={e.cover_url} leer="📖"
                stand={<>Kapitel {e.progress_chapters}{e.total_chapters ? `/${e.total_chapters}` : ''}</>}
                plusLabel={`${titel}: ein Kapitel weiter`} plusTitel="+1 Kapitel" onOeffnen={onOeffnen} />
            )
          })}
        </Leiste>
      )}
    </>
  )
}
