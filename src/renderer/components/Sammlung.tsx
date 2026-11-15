import { useEffect, useState } from 'react'
import { Entry } from '../../types'
import {
  BandStatus, NAECHSTER_STATUS, MAX_BAND, anzahlBaende, anzeigeBaende, bandStatus, besitzAusText, besitzBereich,
  hoechsterBand, luecken, naechsterKauf, setzeBandStatus, ungelesen,
} from '../baende'
import './Sammlung.css'

const STATUS_TEXT: Record<BandStatus, string> = { besitz: 'besitze ich', wunsch: 'will ich', fehlt: 'fehlt' }
const plural = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`

/** Detailseite (Manga): welche Bände stehen als Buch im Regal? Antippen wechselt fehlt → besitze ich → will ich. */
export default function Sammlung({ entry, speichere }: {
  entry: Entry
  speichere: (daten: Partial<Entry>) => Promise<void> | void
}) {
  // Lokaler Stand: mehrere Taps hintereinander bauen aufeinander auf, ohne auf die Antwort zu warten
  const [besitz, setBesitz] = useState(entry.baende_besitz)
  const [wunsch, setWunsch] = useState(entry.baende_wunsch)
  const [ausgabe, setAusgabe] = useState(entry.ausgabe ?? '')
  const [eingabe, setEingabe] = useState(anzeigeText(entry.baende_besitz))
  const [bis, setBis] = useState('')
  const [extra, setExtra] = useState(0) // per „+ Band“ angehängte Kacheln über das Bekannte hinaus
  useEffect(() => { setBesitz(entry.baende_besitz); setEingabe(anzeigeText(entry.baende_besitz)) }, [entry.baende_besitz])
  useEffect(() => { setWunsch(entry.baende_wunsch) }, [entry.baende_wunsch])
  useEffect(() => { setAusgabe(entry.ausgabe ?? '') }, [entry.ausgabe])
  useEffect(() => { setExtra(0) }, [entry.id])

  const anzahl = Math.min(MAX_BAND, Math.max(entry.total_volumes ?? 0, entry.progress_volumes, hoechsterBand(besitz, wunsch), extra))
  const gehoert = anzahlBaende(besitz)
  const fehlend = luecken(besitz)
  const naechster = naechsterKauf(besitz, entry.total_volumes)
  const offen = ungelesen(besitz, entry.progress_volumes).length
  const wuensche = anzahlBaende(wunsch)

  const setze = (b: string | null, w: string | null) => {
    setBesitz(b); setWunsch(w)
    speichere({ baende_besitz: b, baende_wunsch: w })
  }
  const tippe = (n: number) => {
    const neu = setzeBandStatus(besitz, wunsch, n, NAECHSTER_STATUS[bandStatus(besitz, wunsch, n)])
    setze(neu.besitz, neu.wunsch)
  }
  const uebernehmen = () => { const r = besitzAusText(eingabe, wunsch); setze(r.besitz, r.wunsch) }
  const alleBis = () => {
    const x = Math.min(MAX_BAND, Math.floor(Number(bis || entry.total_volumes || anzahl)))
    if (!(x >= 1)) return
    const r = besitzBereich(besitz, wunsch, 1, x)
    setze(r.besitz, r.wunsch)
    setBis('')
  }
  const speichereAusgabe = () => {
    const neu = ausgabe.trim() || null
    if (neu !== (entry.ausgabe ?? null)) speichere({ ausgabe: neu })
  }

  const teile = [
    entry.total_volumes ? `${gehoert} von ${entry.total_volumes} Bänden` : plural(gehoert, 'Band', 'Bände'),
    ...(fehlend.length ? [`Lücken: ${anzeigeBaende(fehlend)}`] : []),
    ...(naechster ? [`als Nächstes: Band ${naechster}`] : []),
    ...(wuensche ? [`${wuensche} gewünscht`] : []),
  ]

  return (
    <div className="detail-section sammlung">
      <h3 className="section-titel">📚 Sammlung</h3>
      <p className="sammlung-summe" aria-live="polite">{gehoert === 0 && !wuensche ? 'Noch kein Band im Regal erfasst.' : teile.join(' · ')}</p>
      {offen > 0 && <p className="sammlung-ungelesen">📖 {plural(offen, 'Band', 'Bände')} ungelesen im Regal</p>}

      {anzahl > 0 && (
        <div className="band-raster" role="group" aria-label="Bände antippen: besitze ich, will ich, fehlt">
          {Array.from({ length: anzahl }, (_, i) => i + 1).map(n => {
            const s = bandStatus(besitz, wunsch, n)
            return (
              <button key={n} type="button" className={`band-kachel band-${s}`}
                aria-label={`Band ${n}: ${STATUS_TEXT[s]}. Antippen: ${STATUS_TEXT[NAECHSTER_STATUS[s]]}`}
                aria-pressed={s === 'besitz'}
                onClick={() => tippe(n)}>{n}</button>
            )
          })}
        </div>
      )}

      <div className="band-legende">
        <span><i className="band-punkt band-besitz" /> besitze ich</span>
        <span><i className="band-punkt band-wunsch" /> will ich</span>
        <span><i className="band-punkt band-fehlt" /> fehlt</span>
        <button type="button" className="band-plus" disabled={anzahl >= MAX_BAND} onClick={() => setExtra(anzahl + 1)}
          aria-label="Einen weiteren Band hinzufügen">+ Band</button>
      </div>

      <div className="band-eingabe">
        <label className="band-label" htmlFor="band-text">Bände im Besitz</label>
        <div className="band-zeile">
          <input id="band-text" type="text" inputMode="text" value={eingabe} placeholder="z. B. 1-12, 14"
            onChange={e => setEingabe(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') uebernehmen() }} />
          <button type="button" className="filter-btn" onClick={uebernehmen}>Übernehmen</button>
        </div>
        <div className="band-zeile">
          <label className="band-label band-label-inline" htmlFor="band-bis">Alle bis Band</label>
          <input id="band-bis" type="number" min={1} max={MAX_BAND} className="band-bis" value={bis}
            placeholder={String(entry.total_volumes ?? anzahl ?? '')}
            onChange={e => setBis(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') alleBis() }} />
          <button type="button" className="filter-btn" onClick={alleBis}>Setzen</button>
        </div>
        <div className="band-zeile">
          <label className="band-label band-label-inline" htmlFor="band-ausgabe">Ausgabe / Verlag</label>
          <input id="band-ausgabe" type="text" value={ausgabe} placeholder="z. B. Carlsen" maxLength={80}
            onChange={e => setAusgabe(e.target.value)} onBlur={speichereAusgabe}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        </div>
      </div>
    </div>
  )
}

/** Bereichsliste fürs Eingabefeld: „1-12, 14“ */
function anzeigeText(besitz: string | null): string {
  return (besitz ?? '').split(',').filter(Boolean).join(', ')
}

