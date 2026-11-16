import { useEffect, useRef, useState } from 'react'
import { FilterWerte, LaengeFilter, STANDARD_NEUE_FILTER, anzahlNeueFilter } from '../listenLogik'
import './MehrFilter.css'

// Weitere Filter der Listenseite (Plan Nr. 10): Genre, Bewertung, Spitzname, Länge, AniList-Verknüpfung.
// Am Laptop ein Menü neben dem Status-Filter, am Handy dieselben Knöpfe im „Filter & Ansicht“-Fenster.

interface Props extends FilterWerte {
  genres: string[] // alle vorhandenen Genres
  onAendern: (teil: Partial<FilterWerte>) => void
  variante?: 'menue' | 'chips'
}

const LAENGEN: Array<[LaengeFilter, string]> = [['alle', 'Alle'], ['kurz', 'Kurz (≤ 13 Folgen)'], ['lang', 'Lang (> 24 Folgen)']]

function Inhalt(p: Props) {
  const { genres, onAendern } = p
  const umschaltenGenre = (g: string) =>
    onAendern({ filterGenres: p.filterGenres.includes(g) ? p.filterGenres.filter(x => x !== g) : [...p.filterGenres, g] })
  return (
    <>
      {genres.length > 0 && (
        <div className="mf-gruppe" role="group" aria-label="Genre (alle gewählten müssen passen)">
          <span className="sheet-gruppe-titel">Genre <small>(alle gewählten)</small></span>
          <div className="sheet-chips mf-genres">
            {genres.map(g => (
              <button key={g} className={p.filterGenres.includes(g) ? 'filter-btn active' : 'filter-btn'}
                aria-pressed={p.filterGenres.includes(g)} onClick={() => umschaltenGenre(g)}>{g}</button>
            ))}
          </div>
        </div>
      )}
      <div className="mf-gruppe" role="group" aria-label="Bewertung">
        <span className="sheet-gruppe-titel">Bewertung</span>
        <div className="sheet-chips">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} className={p.filterMinBewertung === n ? 'filter-btn active' : 'filter-btn'}
              aria-pressed={p.filterMinBewertung === n} aria-label={`Ab ${n} Stern${n > 1 ? 'en' : ''}`}
              onClick={() => onAendern({ filterMinBewertung: p.filterMinBewertung === n ? 0 : n })}>
              ★ {n}+
            </button>
          ))}
          <button className={p.filterOhneBewertung ? 'filter-btn active' : 'filter-btn'} aria-pressed={p.filterOhneBewertung}
            onClick={() => onAendern({ filterOhneBewertung: !p.filterOhneBewertung })}>Ohne Bewertung</button>
        </div>
      </div>
      <div className="mf-gruppe" role="group" aria-label="Länge (nur Anime)">
        <span className="sheet-gruppe-titel">Länge <small>(nur Anime)</small></span>
        <div className="sheet-chips">
          {LAENGEN.map(([k, t]) => (
            <button key={k} className={p.filterLaenge === k ? 'filter-btn active' : 'filter-btn'} aria-pressed={p.filterLaenge === k}
              onClick={() => onAendern({ filterLaenge: k })}>{t}</button>
          ))}
        </div>
      </div>
      <div className="mf-gruppe" role="group" aria-label="Weitere">
        <span className="sheet-gruppe-titel">Weitere</span>
        <div className="sheet-chips">
          <button className={p.filterSpitzname ? 'filter-btn active' : 'filter-btn'} aria-pressed={p.filterSpitzname}
            onClick={() => onAendern({ filterSpitzname: !p.filterSpitzname })}>Mit Spitzname</button>
          <button className={p.filterOhneAnilist ? 'filter-btn active' : 'filter-btn'} aria-pressed={p.filterOhneAnilist}
            onClick={() => onAendern({ filterOhneAnilist: !p.filterOhneAnilist })}>Ohne AniList-Verknüpfung</button>
        </div>
      </div>
    </>
  )
}

export default function MehrFilter(p: Props) {
  const [offen, setOffen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!offen) return
    const klick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOffen(false) }
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') setOffen(false) }
    document.addEventListener('mousedown', klick)
    document.addEventListener('keydown', taste)
    return () => { document.removeEventListener('mousedown', klick); document.removeEventListener('keydown', taste) }
  }, [offen])

  if (p.variante === 'chips') return <div className="mf-chips"><Inhalt {...p} /></div>

  const n = anzahlNeueFilter(p)
  return (
    <div className="status-filter mehr-filter" ref={ref}>
      <button className={n ? 'status-filter-btn aktiv' : 'status-filter-btn'} onClick={() => setOffen(o => !o)}
        aria-expanded={offen} aria-haspopup="dialog">
        Mehr Filter{n > 0 && <span className="filter-zahl">{n}</span>}
        <span className="status-filter-pfeil">▾</span>
      </button>
      {offen && (
        <div className="mf-menue" role="dialog" aria-label="Weitere Filter">
          <Inhalt {...p} />
          <button className="dialog-btn mf-reset" disabled={n === 0} onClick={() => p.onAendern({ ...STANDARD_NEUE_FILTER })}>Diese Filter zurücksetzen</button>
        </div>
      )}
    </div>
  )
}
