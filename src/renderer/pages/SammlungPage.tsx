import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Entry } from '../../types'
import { api } from '../api'
import { useBeiAenderung } from '../aktionen'
import { anzeigeTitel } from '../titel'
import { istTippen, overlayOffen, useTasten } from '../tastatur'
import { anzahlBaende, anzeigeBaende, luecken, naechsterKauf, parseBaende, ungelesen } from '../baende'
import './Page.css'
import './SammlungPage.css'

const plural = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`

interface Serie {
  entry: Entry
  besitz: number
  luecken: number[]
  naechster: number | null
  wuensche: number[]
  ungelesen: number[]
}

function auswerten(manga: Entry[]): Serie[] {
  return manga.map(entry => {
    const hat = new Set(parseBaende(entry.baende_besitz))
    return {
      entry,
      besitz: hat.size,
      luecken: luecken(entry.baende_besitz),
      naechster: naechsterKauf(entry.baende_besitz, entry.total_volumes),
      // Wunsch-Bände, die inzwischen im Regal stehen, zählen nicht mehr
      wuensche: parseBaende(entry.baende_wunsch).filter(n => !hat.has(n)),
      ungelesen: ungelesen(entry.baende_besitz, entry.progress_volumes),
    }
  })
}

const nachTitel = (a: Serie, b: Serie) => anzeigeTitel(a.entry).localeCompare(anzeigeTitel(b.entry), 'de')

/** Aufklappbarer Abschnitt mit Zähler */
function Abschnitt({ titel, anzahl, leer, children }: { titel: string; anzahl: number; leer: string; children: React.ReactNode }) {
  const [offen, setOffen] = useState(true)
  return (
    <section className="sammlung-abschnitt">
      <button className="sammlung-abschnitt-kopf" aria-expanded={offen} onClick={() => setOffen(o => !o)}>
        <span className="sammlung-pfeil" aria-hidden="true">{offen ? '▾' : '▸'}</span>
        <span className="sammlung-abschnitt-titel">{titel}</span>
        <span className="sammlung-abschnitt-zahl">{anzahl}</span>
      </button>
      {offen && (anzahl > 0 ? <ul className="sammlung-liste">{children}</ul> : <p className="sammlung-leer">{leer}</p>)}
    </section>
  )
}

export default function SammlungPage() {
  const navigate = useNavigate()
  // Von der Statistik geöffnet → „Zurück" führt dorthin (wie bei der Detailseite)
  const zurueck = (useLocation().state as { zurueck?: number } | null)?.zurueck
  const zurueckGehen = () => zurueck ? navigate(-zurueck) : navigate('/')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const lade = useCallback(() => { api.getEntries().then(setEntries) }, [])
  useEffect(lade, [lade])
  useEffect(() => api.onSerienAktualisiert(() => lade()), [lade])
  useBeiAenderung(lade)
  useTasten(e => {
    if (e.key === 'Escape' && !istTippen(e) && !overlayOffen()) { e.preventDefault(); zurueckGehen() }
  })

  const serien = useMemo(() => auswerten((entries ?? []).filter(e => e.type === 'MANGA')), [entries])
  if (!entries) return <div className="page"><div className="empty-state"><p>Wird geladen…</p></div></div>

  const imRegal = serien.filter(s => s.besitz > 0)
  const mitLuecken = serien.filter(s => s.luecken.length > 0).sort((a, b) => b.luecken.length - a.luecken.length || nachTitel(a, b))
  const einkauf = serien.filter(s => (s.besitz > 0 && s.naechster !== null) || s.wuensche.length > 0).sort(nachTitel)
  const ungelesenListe = serien.filter(s => s.ungelesen.length > 0).sort((a, b) => b.ungelesen.length - a.ungelesen.length || nachTitel(a, b))
  const baendeGesamt = imRegal.reduce((n, s) => n + s.besitz, 0)
  const ungelesenGesamt = ungelesenListe.reduce((n, s) => n + s.ungelesen.length, 0)

  // „Zurück“ auf der Detailseite führt wieder hierher
  const oeffne = (id: number) => navigate(`/detail/${id}`, { state: { zurueck: 1 } })
  const zeile = (s: Serie, text: React.ReactNode) => (
    <li key={s.entry.id}>
      <button className="sammlung-serie" onClick={() => oeffne(s.entry.id)}>
        {s.entry.cover_url
          ? <img className="sammlung-cover" src={s.entry.cover_url} alt="" loading="lazy" />
          : <span className="sammlung-cover sammlung-cover--leer">📚</span>}
        <span className="sammlung-serie-text">
          <span className="sammlung-serie-titel">{anzeigeTitel(s.entry)}</span>
          <span className="sammlung-serie-detail">{text}</span>
        </span>
        <span className="sammlung-serie-pfeil" aria-hidden="true">›</span>
      </button>
    </li>
  )

  const zahlen: Array<[number, string]> = [
    [baendeGesamt, 'Bände im Regal'],
    [imRegal.length, 'Serien mit Sammlung'],
    [mitLuecken.length, 'Serien mit Lücken'],
    [ungelesenGesamt, 'ungelesene Bände'],
  ]

  return (
    <div className="page sammlung-seite">
      <div className="page-header">
        <button className="back-btn" onClick={zurueckGehen}>← Zurück</button>
        <h2>📚 Sammlung</h2>
      </div>
      <div className="sammlung-inhalt">
        <div className="sammlung-zahlen">
          {zahlen.map(([n, label]) => (
            <div key={label} className="sammlung-zahl"><strong>{n}</strong><span>{label}</span></div>
          ))}
        </div>

        {imRegal.length === 0 && einkauf.length === 0 ? (
          <div className="sammlung-leer sammlung-leer--gross">
            <p>Noch nichts im Regal erfasst.</p>
            <p className="empty-hint">Öffne einen Manga und trage unter „📚 Sammlung“ ein, welche Bände du besitzt.</p>
          </div>
        ) : (
          <>
            <Abschnitt titel="Lücken" anzahl={mitLuecken.length} leer="Keine Lücken – alles lückenlos. 🎉">
              {mitLuecken.map(s => zeile(s, <>Fehlt: {anzeigeBaende(s.luecken)} <span className="sammlung-mut">({plural(s.luecken.length, 'Band', 'Bände')})</span></>))}
            </Abschnitt>
            <Abschnitt titel="Einkaufsliste" anzahl={einkauf.length} leer="Nichts zu kaufen.">
              {einkauf.map(s => zeile(s, <>
                {s.besitz > 0 && s.naechster !== null && <>Als Nächstes: Band {s.naechster}</>}
                {s.besitz > 0 && s.naechster !== null && s.wuensche.length > 0 && ' · '}
                {s.wuensche.length > 0 && <>Gewünscht: {anzeigeBaende(s.wuensche)}</>}
              </>))}
            </Abschnitt>
            <Abschnitt titel="Ungelesen im Regal" anzahl={ungelesenListe.length} leer="Alle Bände im Regal sind gelesen.">
              {ungelesenListe.map(s => zeile(s, <>
                {plural(s.ungelesen.length, 'Band', 'Bände')} ungelesen: {anzeigeBaende(s.ungelesen)}{' '}
                <span className="sammlung-mut">(gelesen bis Band {s.entry.progress_volumes})</span>
              </>))}
            </Abschnitt>
          </>
        )}
      </div>
    </div>
  )
}
