import { useEffect, useRef, useState } from 'react'
import { api, SuchTreffer, VerknuepfungVorschau } from '../api'
import { meldeAenderung } from '../aktionen'
import { hinweis, snackbar } from '../meldungen'
import './VerknuepfenDialog.css'

// Zwei Aufgaben mit derselben Suche:
//  • 'umhaengen': „Falscher Titel? Neu verknüpfen" – AniList-Suche → Auswahl → Vorschau der Staffeln → übernehmen
//  • 'staffel':   „Staffel hinzufügen" – AniList-Suche → Auswahl → als Vorgänger/Nachfolger einfügen
// Beide Wege sind danach 30 Sekunden lang (Token gilt 10 Minuten) über die Meldung „Rückgängig" zurückzunehmen.

export type VerknuepfenModus = 'umhaengen' | 'staffel'

interface Props {
  modus: VerknuepfenModus
  entryId: number
  /** Titel des Eintrags (nur für die Überschrift) */
  titel: string
  /** Startbegriff der Suche (z. B. Spitzname) */
  suche?: string
  /** Gleich zur Vorschau dieses AniList-Titels springen (Vorschlag aus „Verknüpfungen prüfen") */
  zielId?: number
  onSchliessen: () => void
  onFertig?: () => void
}

const FORMAT_NAME: Record<string, string> = {
  TV: 'Serie', TV_SHORT: 'Kurzserie', MOVIE: 'Film', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Musikvideo',
}
const formatText = (f: string | null) => (f ? (FORMAT_NAME[f] ?? f) : 'Format unbekannt')
const folgenText = (n: number | null) => (n ? `${n} Folge${n === 1 ? '' : 'n'}` : 'Folgenzahl unbekannt')

function fehlerText(e: any): string {
  const grund = String(e?.message ?? '').split('Error: ').pop()
  return `Das hat nicht geklappt${grund ? ` (${grund})` : ''}. Internetverbindung prüfen.`
}

export default function VerknuepfenDialog({ modus, entryId, titel, suche = '', zielId, onSchliessen, onFertig }: Props) {
  const [begriff, setBegriff] = useState(suche)
  const [treffer, setTreffer] = useState<SuchTreffer[] | null>(null)
  const [gewaehlt, setGewaehlt] = useState<number | null>(zielId ?? null)
  const [vorschau, setVorschau] = useState<VerknuepfungVorschau | null>(null)
  const [laden, setLaden] = useState(false)
  const [fehler, setFehler] = useState('')
  // Reihenfolge der Antworten: nur die zuletzt gestartete Anfrage zählt
  const anfrage = useRef(0)

  async function suchen(text = begriff) {
    const q = text.trim()
    if (!q) return
    const nr = ++anfrage.current
    setLaden(true); setFehler(''); setGewaehlt(null); setVorschau(null)
    try {
      const r = await api.verknuepfungSuchen(q)
      if (nr === anfrage.current) setTreffer(r)
    } catch (e) {
      if (nr === anfrage.current) setFehler(fehlerText(e))
    } finally {
      if (nr === anfrage.current) setLaden(false)
    }
  }

  async function waehle(id: number) {
    setGewaehlt(id)
    if (modus === 'staffel') return
    const nr = ++anfrage.current
    setLaden(true); setFehler(''); setVorschau(null)
    try {
      const v = await api.verknuepfungVorschau(entryId, id)
      if (nr !== anfrage.current) return
      if ('fehler' in v) { setFehler(v.fehler); setGewaehlt(null) } else setVorschau(v)
    } catch (e) {
      if (nr === anfrage.current) { setFehler(fehlerText(e)); setGewaehlt(null) }
    } finally {
      if (nr === anfrage.current) setLaden(false)
    }
  }

  // Beim Öffnen: mit Vorschlag gleich zur Vorschau, sonst mit dem Spitznamen suchen
  useEffect(() => {
    if (zielId) waehle(zielId)
    else if (suche.trim()) suchen(suche)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onSchliessen() } }
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [onSchliessen])

  function rueckgaengigMeldung(text: string, token: string, zurueckText: string) {
    snackbar(text, {
      label: 'Rückgängig',
      ausfuehren: async () => {
        const u = await api.rueckgaengig(token)
        meldeAenderung()
        snackbar(u.success ? zurueckText : 'Rückgängig nicht mehr möglich')
      },
    }, 30000)
  }

  async function uebernehmen() {
    if (gewaehlt == null || laden) return
    setLaden(true); setFehler('')
    try {
      const r = await api.verknuepfungAnwenden(entryId, gewaehlt)
      if ('fehler' in r) { setFehler(r.fehler); return }
      onFertig?.()
      meldeAenderung()
      onSchliessen()
      rueckgaengigMeldung(`Neu verknüpft – ${r.staffeln} Titel in der Watch-Order`, r.token, 'Verknüpfung zurückgenommen')
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaden(false)
    }
  }

  async function einfuegen(wo: 'vorgaenger' | 'nachfolger') {
    if (gewaehlt == null || laden) return
    setLaden(true); setFehler('')
    try {
      const r = await api.staffelHinzufuegen(entryId, gewaehlt, wo)
      if ('fehler' in r) { setFehler(r.fehler); return }
      onFertig?.()
      meldeAenderung()
      onSchliessen()
      rueckgaengigMeldung(wo === 'vorgaenger' ? 'Als Vorgänger eingefügt' : 'Als Nachfolger eingefügt', r.token, 'Staffel wieder entfernt')
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaden(false)
    }
  }

  const gewaehlterTreffer = treffer?.find(t => t.id === gewaehlt) ?? null
  const inVorschau = modus === 'umhaengen' && vorschau !== null

  return (
    <div className="dialog-hintergrund" onMouseDown={e => { if (e.target === e.currentTarget) onSchliessen() }}>
      <div className="dialog vk-dialog" role="dialog" aria-modal="true" aria-label={modus === 'umhaengen' ? 'Neu verknüpfen' : 'Staffel hinzufügen'}>
        <div className="dialog-titel">{modus === 'umhaengen' ? 'Falscher Titel? Neu verknüpfen' : 'Staffel hinzufügen'}</div>
        <p className="dialog-text vk-text">
          {modus === 'umhaengen'
            ? <>„{titel}“ an einen anderen AniList-Titel hängen. Fortschritt, Status, Bewertung, Spitzname und Listen bleiben.</>
            : <>Einen AniList-Titel zu „{titel}“ hinzufügen, den AniList nicht selbst verbindet.</>}
        </p>

        {!inVorschau && (
          <>
            <div className="vk-suche">
              <input
                type="text" className="vk-eingabe" value={begriff} placeholder="Anime suchen…" autoFocus={!zielId}
                onChange={e => setBegriff(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') suchen() }}
              />
              <button className="dialog-btn dialog-btn--ok" onClick={() => suchen()} disabled={laden || !begriff.trim()}>
                {laden && treffer === null ? '…' : 'Suchen'}
              </button>
            </div>
            {treffer !== null && treffer.length === 0 && !laden && <p className="vk-leer">Nichts gefunden.</p>}
            {treffer !== null && treffer.length > 0 && (
              <div className="vk-liste" role="listbox" aria-label="Treffer">
                {treffer.map(t => (
                  <button key={t.id} role="option" aria-selected={gewaehlt === t.id}
                    className={gewaehlt === t.id ? 'vk-treffer aktiv' : 'vk-treffer'} onClick={() => waehle(t.id)} disabled={laden}>
                    {t.cover ? <img src={t.cover} alt="" className="vk-cover" /> : <span className="vk-cover" />}
                    <span className="vk-info">
                      <span className="vk-titel">{t.titel}</span>
                      <span className="vk-meta">{formatText(t.format)} · {folgenText(t.folgen)}{t.jahr ? ` · ${t.jahr}` : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {modus === 'staffel' && gewaehlterTreffer && (
          <div className="vk-wohin">
            <p className="vk-text"><strong>{gewaehlterTreffer.titel}</strong> einfügen:</p>
            <div className="vk-knoepfe">
              <button className="dialog-btn" disabled={laden} onClick={() => einfuegen('vorgaenger')}>Als Vorgänger (davor)</button>
              <button className="dialog-btn" disabled={laden} onClick={() => einfuegen('nachfolger')}>Als Nachfolger (danach)</button>
            </div>
          </div>
        )}

        {laden && modus === 'umhaengen' && gewaehlt != null && !vorschau && <p className="vk-leer">Staffeln werden bei AniList geholt – bei langen Reihen kann das bis zu 30 Sekunden dauern …</p>}

        {inVorschau && vorschau && (
          <div className="vk-vorschau">
            <p className="vk-text">
              Neu: <strong>{vorschau.haupt.titel}</strong> ({formatText(vorschau.haupt.format)}, {folgenText(vorschau.haupt.folgen)}{vorschau.haupt.jahr ? `, ${vorschau.haupt.jahr}` : ''})
            </p>
            <ul className="vk-staffeln">
              {vorschau.staffeln.map(s => (
                <li key={s.id} className={s.neu ? 'neu' : ''}>
                  <span className="vk-s-titel">{s.titel ?? `ID ${s.id}`}</span>
                  <span className="vk-s-meta">
                    {s.nebengeschichte ? 'bleibt als Nebengeschichte' : s.relation} · {s.gesehen}/{s.folgen ?? '?'}
                    {s.neu && <span className="vk-neu">neu</span>}
                  </span>
                </li>
              ))}
            </ul>
            {vorschau.alt.schicksal === 'neben' && <p className="vk-hinweis">Der bisherige Titel „{vorschau.alt.titel}“ bleibt mit deinem Fortschritt als Nebengeschichte.</p>}
            {vorschau.alt.schicksal === 'weg' && <p className="vk-hinweis">Der bisherige Titel „{vorschau.alt.titel}“ wird entfernt (dort war nichts gesehen).</p>}
            {vorschau.alt.schicksal === 'gleich' && <p className="vk-hinweis">Das ist schon der aktuelle Titel – es ändert sich nur die Staffelliste.</p>}
          </div>
        )}

        {fehler && <p className="fehler-text vk-fehler" role="alert">{fehler}</p>}

        <div className="dialog-knoepfe">
          {inVorschau && <button className="dialog-btn" onClick={() => { setVorschau(null); setGewaehlt(null); setFehler('') }} disabled={laden}>← Andere Auswahl</button>}
          <button className="dialog-btn" onClick={onSchliessen}>Abbrechen</button>
          {inVorschau && <button className="dialog-btn dialog-btn--ok" onClick={uebernehmen} disabled={laden}>{laden ? '…' : 'Übernehmen'}</button>}
        </div>
      </div>
    </div>
  )
}
