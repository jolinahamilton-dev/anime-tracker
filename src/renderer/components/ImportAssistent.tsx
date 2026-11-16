import { useEffect, useState } from 'react'
import { api, ImportPruefung } from '../api'
import { bestaetigen, snackbar } from '../meldungen'
import { meldeAenderung } from '../aktionen'
import './ImportAssistent.css'

// Einstellungen → Erweitert → Liste importieren: von AniList-Benutzername oder aus anderer App (MyAnimeList, CSV).
// Immer erst „Prüfen“ (Trockenlauf, es wird nichts geschrieben), dann „Importieren“ (nur Neues), danach „zurücknehmen“.
type Quelle = 'anilist' | 'datei'
type Pruefung = ImportPruefung & { format?: string; zuordnung?: Array<{ spalte: string; feld: string }> }

const FELD_NAMEN: Record<string, string> = {
  titel: 'Titel', typ: 'Typ', status: 'Status', fortschritt: 'Fortschritt', baende: 'Bände', bewertung: 'Bewertung',
  wiederholungen: 'Wiederholungen', anilist_id: 'AniList-ID', mal_id: 'MAL-ID',
}
const STATUS_NAMEN: Record<string, string> = {
  ongoing: 'Laufend', planned: 'Geplant', completed: 'Beendet', paused: 'Pausiert', dropped: 'Abgebrochen', started: 'Schaut',
}
const RELATION_NAMEN: Record<string, string> = {
  MAIN: 'Hauptstaffel', PREQUEL: 'Vorgänger', SEQUEL: 'Fortsetzung', SIDE_STORY: 'Nebengeschichte', SPIN_OFF: 'Spin-off',
  PARENT: 'Hauptserie', ALTERNATIVE: 'Alternative',
}

export default function ImportAssistent() {
  const [quelle, setQuelle] = useState<Quelle>('anilist')
  const [benutzer, setBenutzer] = useState('')
  const [anime, setAnime] = useState(true)
  const [manga, setManga] = useState(true)
  const [laeuft, setLaeuft] = useState(false)
  const [fortschritt, setFortschritt] = useState<{ phase: string; aktuell: number; gesamt: number } | null>(null)
  const [pruefung, setPruefung] = useState<Pruefung | null>(null)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState('')
  const [gewaehlt, setGewaehlt] = useState<Set<number>>(new Set())
  const [letzter, setLetzter] = useState<{ zeit: string; quelle: string; anzahl: number } | null>(null)

  useEffect(() => api.onImportFortschritt(setFortschritt), [])
  useEffect(() => { api.importLetzter().then(setLetzter).catch(() => {}) }, [])

  async function los(f: () => Promise<any>) {
    setLaeuft(true); setFehler(''); setFertig(''); setFortschritt(null)
    try {
      const r = await f()
      if (r?.abgebrochen) return
      if (r?.fehler) { setFehler(r.fehler); setPruefung(null); return }
      setPruefung(r); setGewaehlt(new Set())
    } catch (e: any) {
      setFehler(String(e?.message ?? e)); setPruefung(null)
    } finally {
      setLaeuft(false); setFortschritt(null)
    }
  }

  const pruefeAnilist = () => los(() => api.importAnilist({ benutzer, anime, manga }))
  const pruefeDatei = () => los(() => api.importDatei())
  const uebernehmen = () => los(() => api.importUebernehmen([...gewaehlt]))

  async function importieren() {
    if (!pruefung) return
    setLaeuft(true); setFehler('')
    try {
      const r = await api.importStarten()
      if ('fehler' in r) { setFehler(r.fehler); return }
      meldeAenderung()
      setFertig(`✅ ${r.ergebnis.angelegt} Serien angelegt${r.ergebnis.vorhanden ? `, ${r.ergebnis.vorhanden} waren schon vorhanden und blieben unverändert` : ''}.`)
      setPruefung(null)
      setLetzter(await api.importLetzter())
    } catch (e: any) {
      setFehler(String(e?.message ?? e))
    } finally {
      setLaeuft(false)
    }
  }

  async function zuruecknehmen() {
    if (!letzter) return
    const ja = await bestaetigen('Import zurücknehmen?', {
      text: `Löscht die ${letzter.anzahl} Einträge, die dieser Import angelegt hat (${letzter.quelle}). Alles andere bleibt. Eine Sicherheitskopie von vorher liegt im Programmordner.`,
      ok: 'Zurücknehmen', abbrechen: 'Behalten',
    })
    if (!ja) return
    setLaeuft(true)
    try {
      const r = await api.importZurueck()
      if ('fehler' in r) { setFehler(r.fehler); return }
      meldeAenderung()
      snackbar(`${r.geloescht} Einträge entfernt`)
      setFertig(''); setLetzter(null)
    } finally {
      setLaeuft(false)
    }
  }

  const schalte = (nr: number) => setGewaehlt(s => { const n = new Set(s); if (n.has(nr)) n.delete(nr); else n.add(nr); return n })

  return (
    <section className="einstell-section import-assistent">
      <h3 className="section-titel">Liste importieren</h3>
      <p className="einstell-sub" style={{ marginBottom: 10 }}>
        Holt deine Liste von AniList oder aus einer anderen App. Staffeln, Filme und Specials einer Serie werden
        zu <strong>einem</strong> Eintrag zusammengefasst. Vorhandene Einträge bleiben unberührt. Erst „Prüfen“ (es wird nichts gespeichert).
      </p>

      <div className="import-tabs" role="tablist">
        <button role="tab" aria-selected={quelle === 'anilist'} className={quelle === 'anilist' ? 'aktiv' : ''} onClick={() => setQuelle('anilist')} disabled={laeuft}>AniList-Benutzername</button>
        <button role="tab" aria-selected={quelle === 'datei'} className={quelle === 'datei' ? 'aktiv' : ''} onClick={() => setQuelle('datei')} disabled={laeuft}>Aus anderer App</button>
      </div>

      {quelle === 'anilist' ? (
        <div className="import-form">
          <input className="import-eingabe" placeholder="AniList-Benutzername" value={benutzer} disabled={laeuft}
            onChange={e => setBenutzer(e.target.value)} onKeyDown={e => e.key === 'Enter' && !laeuft && pruefeAnilist()} aria-label="AniList-Benutzername" />
          <label className="import-haken"><input type="checkbox" checked={anime} disabled={laeuft} onChange={e => setAnime(e.target.checked)} /> Anime</label>
          <label className="import-haken"><input type="checkbox" checked={manga} disabled={laeuft} onChange={e => setManga(e.target.checked)} /> Manga</label>
          <button className="btn-primary" onClick={pruefeAnilist} disabled={laeuft || !benutzer.trim() || (!anime && !manga)}>Prüfen</button>
          <p className="einstell-sub import-hinweis">Nur öffentliche Listen, eine Anmeldung ist nicht nötig. Bei ca. 160 Serien dauert das einige Minuten (AniList-Limit), die App bleibt benutzbar.</p>
        </div>
      ) : (
        <div className="import-form">
          <button className="btn-primary" onClick={pruefeDatei} disabled={laeuft}>Datei wählen und prüfen</button>
          <p className="einstell-sub import-hinweis">MyAnimeList-Export (XML, auch .xml.gz) oder CSV mit Titel, Typ, Status, Fortschritt, Bewertung.</p>
        </div>
      )}

      {laeuft && fortschritt && (
        <div className="import-fortschritt" role="status">
          <span>{fortschritt.phase}{fortschritt.gesamt > 0 ? `: ${fortschritt.aktuell} / ${fortschritt.gesamt}` : '…'}</span>
          <button className="btn-secondary" onClick={() => api.importAbbrechen()}>Abbrechen</button>
        </div>
      )}
      {laeuft && !fortschritt && <p className="einstell-sub" role="status">Bitte warten…</p>}

      {fehler && <p className="fehler-text" style={{ marginTop: 10 }}>{fehler}</p>}
      {fertig && <p className="export-ok" style={{ marginTop: 10 }}>{fertig}</p>}

      {pruefung && (
        <div className="import-ergebnis">
          <p className="import-zahlen">
            <strong>{pruefung.eintraegeQuelle}</strong> Einträge ({pruefung.format ?? pruefung.quelle}) →{' '}
            <strong>{pruefung.serien}</strong> Serien
            {pruefung.zusammengefasst > 0 && <> ({pruefung.zusammengefasst} Staffeln/Filme zusammengefasst)</>},{' '}
            {pruefung.vorhanden} schon vorhanden, <strong>{pruefung.neu} neu</strong>
            {pruefung.nichtZugeordnet.length > 0 && <>, {pruefung.nichtZugeordnet.length} nicht zugeordnet</>}
            {pruefung.uebersprungen18 > 0 && <>, {pruefung.uebersprungen18} mit 18+ übersprungen</>}
          </p>
          {pruefung.zuordnung && pruefung.zuordnung.length > 0 && (
            <p className="einstell-sub">Erkannte Spalten: {pruefung.zuordnung.map(z => `${z.spalte} → ${FELD_NAMEN[z.feld] ?? z.feld}`).join(' · ')}</p>
          )}

          {pruefung.pruefen.length > 0 && (
            <details open className="import-block">
              <summary>Bitte prüfen ({pruefung.pruefen.length})</summary>
              <p className="einstell-sub">Kein eindeutiger Treffer – nichts wird geraten. Hake an, was übernommen werden soll.</p>
              <ul className="import-liste">
                {pruefung.pruefen.map(p => (
                  <li key={p.nr}><label><input type="checkbox" checked={gewaehlt.has(p.nr)} onChange={() => schalte(p.nr)} disabled={laeuft} /> „{p.titel}“ → {p.vorschlag.titel}</label></li>
                ))}
              </ul>
              <button className="btn-secondary" onClick={uebernehmen} disabled={laeuft || gewaehlt.size === 0}>Ausgewählte übernehmen ({gewaehlt.size})</button>
            </details>
          )}

          {pruefung.nichtZugeordnet.length > 0 && (
            <details className="import-block">
              <summary>Nicht zugeordnet ({pruefung.nichtZugeordnet.length})</summary>
              <ul className="import-liste">
                {pruefung.nichtZugeordnet.map(n => <li key={n.nr}>{n.titel || '(ohne Titel)'} <span className="einstell-sub">– {n.grund}</span></li>)}
              </ul>
            </details>
          )}

          <details className="import-block">
            <summary>Alle Serien ansehen ({pruefung.liste.length})</summary>
            <ul className="import-liste import-serien">
              {pruefung.liste.map((s, i) => (
                <li key={i} className={s.vorhanden ? 'vorhanden' : ''}>
                  <details>
                    <summary>
                      {s.titel}
                      <span className="einstell-sub"> · {STATUS_NAMEN[s.status] ?? s.status}{s.bewertung ? ` · ${'★'.repeat(s.bewertung)}` : ''}
                        {s.vorhanden ? ' · schon vorhanden' : ''}{s.quellZeilen > 1 ? ` · ${s.quellZeilen} Teile` : ''}</span>
                    </summary>
                    {s.staffeln.length > 0 ? (
                      <ul>
                        {s.staffeln.map((st, j) => (
                          <li key={j}>{st.titel ?? '?'} <span className="einstell-sub">· {RELATION_NAMEN[st.relation] ?? st.relation} · {STATUS_NAMEN[st.status] ?? st.status}
                            {st.fortschritt ? ` · ${st.fortschritt}${st.total ? `/${st.total}` : ''}` : ''}{st.inListe ? '' : ' · nicht in der Liste'}</span></li>
                        ))}
                      </ul>
                    ) : <p className="einstell-sub">Einzelner Titel</p>}
                  </details>
                </li>
              ))}
            </ul>
          </details>

          <div className="import-knoepfe">
            <button className="btn-primary" onClick={importieren} disabled={laeuft || pruefung.neu === 0}>
              {pruefung.neu === 0 ? 'Nichts Neues' : `Importieren (${pruefung.neu} neu)`}
            </button>
            <button className="btn-secondary" onClick={() => setPruefung(null)} disabled={laeuft}>Verwerfen</button>
          </div>
          <p className="einstell-sub">Vorher wird automatisch eine Sicherheitskopie gespeichert. Danach kannst du den Import zurücknehmen.</p>
        </div>
      )}

      {letzter && !laeuft && (
        <div className="import-zurueck">
          <span className="einstell-sub">Letzter Import: {letzter.quelle}, {letzter.anzahl} Einträge ({new Date(letzter.zeit).toLocaleString('de-DE')})</span>
          <button className="btn-secondary" onClick={zuruecknehmen}>Import zurücknehmen</button>
        </div>
      )}
    </section>
  )
}
