import { useState, useEffect, useMemo, useRef, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import './Page.css'
import './StatistikPage.css'
import { api } from '../api'
import { STATUS_TEXTFARBE } from '../components/EintragKarte'
import AchievementBereich from '../components/AchievementBereich'

interface Stats {
  gesamt: number
  anime: number
  manga: number
  beendet: number
  kapitelGelesen: number
  folgenGesehen: number
  watchtimeMinuten: number
  bewertungGesamt: number | null
  bewertungAnime: number | null
  bewertungManga: number | null
  topGenre: string | null
  statusVerteilung: Array<{ status: string; n: number }>
  wiederholungen: number
  bewertungsVerteilung: Array<{ sterne: number; n: number }>
  bewertungJeGenre: Array<{ genre: string; schnitt: number; n: number }>
  beendetProMonat: Array<{ monat: string; n: number }>
  geplant: number
  offeneFolgen: number
  offeneMinuten: number
  animeBeendet: number
  mangaBeendet: number
  mangaAktiv: number
  baendeGelesen: number
  offeneKapitel: number
  schnittKapitel: number | null
  topManga: Array<{ id: number; title: string; cover_url: string | null; kapitel: number; gesamt: number | null }>
  mangaBeendetProMonat: Array<{ monat: string; n: number; kapitel: number }>
}

const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

interface Eintrag {
  id: number
  title: string
  type: string
  cover_url: string | null
  rating: number | null
  status: string
  genres: string
  rewatch_count: number | null
}

const STATUS_LABEL: Record<string, string> = {
  started: 'Angefangen',
  ongoing: 'Laufend',
  completed: 'Beendet',
  planned: 'Geplant',
  dropped: 'Abgebrochen',
  paused: 'Pausiert',
}

const STATUS_FARBE: Record<string, string> = {
  started: '#4a9eff',
  ongoing: '#4adb6f',
  completed: '#a259ff',
  planned: '#f5a623',
  dropped: '#e74c3c',
  paused: '#95a5a6',
}

function formatWatchtime(min: number): string {
  if (min < 60) return `${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} Std.`
  const d = Math.floor(h / 24)
  return `${d} Tage ${h % 24} Std.`
}


/** Knappe Form für die kleinen Kacheln im Kurzüberblick (ab einem Tag: „32,5 Tage") */
function formatWatchtimeKurz(min: number): string {
  if (min < 24 * 60) return formatWatchtime(min)
  return `${(min / 60 / 24).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tage`
}
const zahlText = (n: number) => n.toLocaleString('de-DE')
const schnittText = (x: number | null) => (x ? `${x.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ★` : '–')

type DetailFilter =
  | { typ: 'mediatyp'; wert: string; label: string }
  | { typ: 'status'; wert: string; label: string }
  | { typ: 'genre'; wert: string; label: string }
  | { typ: 'alle'; wert: ''; label: string }
  | { typ: 'wiederholt'; wert: ''; label: string }

// ── Auf-/zugeklappte Bereiche: für die Sitzung merken (Modulzustand, zusätzlich sessionStorage,
//    damit es auch ein Neuladen der Seite übersteht) ──
const PANEL_SCHLUESSEL = 'statistik-offen'
let offenePanels: string[] | null = null

function ladeOffenePanels(): string[] {
  if (offenePanels) return offenePanels
  try {
    const gespeichert = JSON.parse(sessionStorage.getItem(PANEL_SCHLUESSEL) ?? '[]')
    offenePanels = Array.isArray(gespeichert) ? gespeichert.filter(x => typeof x === 'string') : []
  } catch {
    offenePanels = []
  }
  return offenePanels
}

function merkeOffenePanels(liste: string[]) {
  offenePanels = liste
  try { sessionStorage.setItem(PANEL_SCHLUESSEL, JSON.stringify(liste)) } catch {}
}

function Panel({ id, titel, info, offen, onToggle, children }: {
  id: string
  titel: string
  info?: ReactNode
  offen: boolean
  onToggle: (id: string) => void
  children: ReactNode
}) {
  return (
    <section className={`stat-panel ${offen ? 'offen' : ''}`}>
      <h3 className="stat-panel-titel">
        <button
          className="stat-panel-kopf"
          aria-expanded={offen}
          aria-controls={`stat-panel-${id}`}
          onClick={() => onToggle(id)}
        >
          <span className="stat-panel-pfeil" aria-hidden="true">▸</span>
          <span className="stat-panel-name">{titel}</span>
          {info != null && <span className="stat-panel-info">{info}</span>}
        </button>
      </h3>
      {offen && <div className="stat-panel-inhalt" id={`stat-panel-${id}`}>{children}</div>}
    </section>
  )
}

function Kachel({ zahl, label, title, aktiv, onClick }: {
  zahl: ReactNode
  label: string
  title?: string
  aktiv?: boolean
  onClick?: (ev: React.MouseEvent<HTMLElement>) => void
}) {
  if (onClick) {
    return (
      <button className={`stat-karte stat-karte--klickbar ${aktiv ? 'aktiv' : ''}`} title={title} onClick={onClick} aria-pressed={!!aktiv}>
        <span className="stat-zahl">{zahl}</span>
        <span className="stat-label">{label}</span>
      </button>
    )
  }
  return (
    <div className="stat-karte" title={title}>
      <span className="stat-zahl">{zahl}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function MonatsChart({ daten, beschriftung, ariaLabel }: {
  daten: Array<{ monat: string; wert: number; tooltip: string }>
  beschriftung?: (wert: number) => string
  ariaLabel: string
}) {
  const max = Math.max(1, ...daten.map(m => m.wert))
  return (
    <div className="monats-chart" role="img" aria-label={ariaLabel}>
      {daten.map(m => (
        <div key={m.monat} className="monats-spalte" title={m.tooltip}>
          <span className="monats-zahl">{m.wert ? (beschriftung ? beschriftung(m.wert) : m.wert) : ''}</span>
          <div className="monats-balken" style={{ height: `${m.wert / max * 100}%` }} />
          <span className="monats-name">{MONAT_KURZ[Number(m.monat.slice(5)) - 1]}</span>
        </div>
      ))}
    </div>
  )
}

/** Kurzform für enge Balkenbeschriftungen (1234 → „1,2k") */
const kurzZahl = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : String(n))

export default function StatistikPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [alleEintraege, setAlleEintraege] = useState<Eintrag[]>([])
  const [detailFilter, setDetailFilter] = useState<DetailFilter | null>(null)
  const [genreAufgeklappt, setGenreAufgeklappt] = useState(false)
  const [offen, setOffen] = useState<string[]>(ladeOffenePanels)

  useEffect(() => {
    api.getStats().then(setStats)
    api.getEntries().then(setAlleEintraege)
  }, [])

  function togglePanel(id: string) {
    setOffen(prev => {
      const neu = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
      merkeOffenePanels(neu)
      return neu
    })
  }
  const istOffen = (id: string) => offen.includes(id)

  // Die Trefferliste steht weiter unten → nach dem Antippen dorthin scrollen, „↑ Zurück“ führt
  // wieder zur angetippten Karte bzw. Zeile
  const panelRef = useRef<HTMLElement>(null)
  const herkunft = useRef<HTMLElement | null>(null)

  function toggleFilter(f: DetailFilter, ev?: React.MouseEvent<HTMLElement>) {
    herkunft.current = ev?.currentTarget ?? null
    setDetailFilter(prev => prev?.typ === f.typ && prev?.wert === f.wert ? null : f)
  }
  const istFilter = (typ: DetailFilter['typ'], wert = '') => detailFilter?.typ === typ && detailFilter.wert === wert

  useEffect(() => {
    if (detailFilter) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [detailFilter])

  function zurueckNachOben() {
    herkunft.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function schliessen() {
    zurueckNachOben()
    setDetailFilter(null)
  }

  const detailEintraege = detailFilter === null ? [] : alleEintraege.filter(e => {
    if (detailFilter.typ === 'alle') return true
    if (detailFilter.typ === 'wiederholt') return (e.rewatch_count ?? 0) > 0
    if (detailFilter.typ === 'mediatyp') return e.type === detailFilter.wert
    if (detailFilter.typ === 'status') return e.status === detailFilter.wert
    if (detailFilter.typ === 'genre') {
      try { return (JSON.parse(e.genres) as string[]).includes(detailFilter.wert) } catch { return false }
    }
    return false
  }).sort((a, b) => a.title.localeCompare(b.title))

  const { genreVerteilung, genreMax } = useMemo(() => {
    const zaehler = new Map<string, number>()
    for (const e of alleEintraege) {
      try {
        for (const g of JSON.parse(e.genres) as string[]) {
          zaehler.set(g, (zaehler.get(g) ?? 0) + 1)
        }
      } catch {}
    }
    const verteilung = [...zaehler.entries()].sort((a, b) => b[1] - a[1])
    return { genreVerteilung: verteilung, genreMax: verteilung[0]?.[1] ?? 1 }
  }, [alleEintraege])

  if (!stats) return <div className="page"><div className="empty-state"><p>Wird geladen…</p></div></div>

  const gesamtStatus = stats.statusVerteilung.reduce((s, r) => s + r.n, 0)
  const beendetSumme = stats.beendetProMonat.reduce((s, m) => s + m.n, 0)
  const mangaMonatKapitel = stats.mangaBeendetProMonat.reduce((s, m) => s + m.kapitel, 0)
  const mangaMonatTitel = stats.mangaBeendetProMonat.reduce((s, m) => s + m.n, 0)
  const topMangaMax = stats.topManga[0]?.kapitel ?? 1

  return (
    <div className="page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>← Zurück</button>
        <h2>Statistiken</h2>
      </div>

      <div className="statistik-inhalt">

        {/* Kurzüberblick */}
        <section className="stat-section" aria-label="Überblick">
          <div className="stat-grid stat-grid--kompakt">
            <Kachel
              zahl={zahlText(stats.gesamt)} label="Titel"
              aktiv={istFilter('alle')}
              onClick={ev => toggleFilter({ typ: 'alle', wert: '', label: 'Alle Einträge' }, ev)}
            />
            <Kachel
              zahl={zahlText(stats.beendet)} label="Beendet"
              aktiv={istFilter('status', 'completed')}
              onClick={ev => toggleFilter({ typ: 'status', wert: 'completed', label: 'Beendet' }, ev)}
            />
            <Kachel zahl={zahlText(stats.folgenGesehen)} label="Folgen" />
            <Kachel
              zahl={formatWatchtimeKurz(stats.watchtimeMinuten)} label="Watchtime"
              title="Mit der echten Folgenlänge jeder Staffel laut AniList (fehlt sie, zählen 24 Min.)"
            />
            <Kachel zahl={zahlText(stats.kapitelGelesen)} label="Kapitel" />
            <Kachel zahl={schnittText(stats.bewertungGesamt)} label="Ø Bewertung" />
          </div>
        </section>

        <div className="stat-panels">

          {/* Anime */}
          <Panel
            id="anime" titel="Anime" offen={istOffen('anime')} onToggle={togglePanel}
            info={`${zahlText(stats.anime)} · ${formatWatchtime(stats.watchtimeMinuten)}`}
          >
            <div className="stat-grid">
              <Kachel
                zahl={zahlText(stats.anime)} label="Anime"
                aktiv={istFilter('mediatyp', 'ANIME')}
                onClick={ev => toggleFilter({ typ: 'mediatyp', wert: 'ANIME', label: 'Anime' }, ev)}
              />
              <Kachel zahl={zahlText(stats.animeBeendet)} label="Beendet" />
              <Kachel zahl={zahlText(stats.folgenGesehen)} label="Folgen gesehen" />
              <Kachel
                zahl={formatWatchtime(stats.watchtimeMinuten)} label="Watchtime"
                title="Mit der echten Folgenlänge jeder Staffel laut AniList (fehlt sie, zählen 24 Min.)"
              />
              <Kachel
                zahl={zahlText(stats.offeneFolgen)} label={`Folgen offen (≈ ${formatWatchtime(stats.offeneMinuten)})`}
                title="Noch ungesehene, schon verfügbare Folgen von geplanten, angefangenen, laufenden und pausierten Anime"
              />
              <Kachel zahl={schnittText(stats.bewertungAnime)} label="Ø Bewertung" />
            </div>
          </Panel>

          {/* Manga */}
          <Panel
            id="manga" titel="Manga" offen={istOffen('manga')} onToggle={togglePanel}
            info={`${zahlText(stats.manga)} · ${zahlText(stats.kapitelGelesen)} Kap.`}
          >
            <div className="stat-grid">
              <Kachel
                zahl={zahlText(stats.manga)} label="Manga"
                aktiv={istFilter('mediatyp', 'MANGA')}
                onClick={ev => toggleFilter({ typ: 'mediatyp', wert: 'MANGA', label: 'Manga' }, ev)}
              />
              <Kachel zahl={zahlText(stats.mangaBeendet)} label="Beendet" />
              <Kachel zahl={zahlText(stats.mangaAktiv)} label="Am Lesen" title="Angefangene und laufende Manga" />
              <Kachel zahl={zahlText(stats.kapitelGelesen)} label="Kapitel gelesen" />
              {stats.baendeGelesen > 0 && <Kachel zahl={zahlText(stats.baendeGelesen)} label="Bände gelesen" />}
              <Kachel
                zahl={stats.schnittKapitel != null ? zahlText(stats.schnittKapitel) : '–'} label="Ø Kapitel je Manga"
                title="Durchschnitt über alle Manga, in denen schon mindestens ein Kapitel gelesen ist"
              />
              {stats.offeneKapitel > 0 && (
                <Kachel
                  zahl={zahlText(stats.offeneKapitel)} label="Kapitel offen"
                  title="Noch ungelesene Kapitel von geplanten, angefangenen, laufenden und pausierten Manga – nur, wo die Kapitelzahl bekannt ist"
                />
              )}
              <Kachel zahl={schnittText(stats.bewertungManga)} label="Ø Bewertung" />
            </div>

            {stats.topManga.length > 0 && (
              <>
                <h4 className="stat-unter-titel">Meiste Kapitel</h4>
                <div className="status-chart">
                  {stats.topManga.map(m => (
                    <button
                      key={m.id}
                      className="status-row status-row--klickbar top-manga-zeile"
                      onClick={() => navigate(`/detail/${m.id}`)}
                      title={`${m.title}: ${m.gesamt ? `${m.kapitel} von ${m.gesamt} Kapiteln` : `${m.kapitel} Kapitel`}`}
                    >
                      <span className="status-name top-manga-titel">{m.title}</span>
                      <div className="status-bar-wrap">
                        <div className="status-bar-fill" style={{ width: `${Math.round(m.kapitel / topMangaMax * 100)}%`, background: 'var(--text-lila, var(--accent))' }} />
                      </div>
                      <span className="status-zahl">{zahlText(m.kapitel)}{m.gesamt ? ` / ${zahlText(m.gesamt)}` : ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <h4 className="stat-unter-titel">
              Kapitel pro Monat (beendete Manga)
              {mangaMonatTitel > 0 && <span className="achievement-count">{zahlText(mangaMonatKapitel)} in 12 Monaten</span>}
            </h4>
            {mangaMonatTitel > 0 ? (
              <MonatsChart
                daten={stats.mangaBeendetProMonat.map(m => ({
                  monat: m.monat, wert: m.kapitel,
                  tooltip: `${m.n} Manga beendet, zusammen ${m.kapitel} Kapitel`,
                }))}
                beschriftung={kurzZahl}
                ariaLabel={`Kapitel beendeter Manga pro Monat, insgesamt ${mangaMonatKapitel}`}
              />
            ) : null}
            <p className="empty-hint">
              {mangaMonatTitel > 0
                ? 'Nach dem Abschlussdatum: Die Kapitel eines Manga zählen in dem Monat, in dem du ihn auf „Beendet" gestellt hast. Einzelne Lesetage werden nicht aufgezeichnet.'
                : 'Noch kein Manga in den letzten 12 Monaten beendet. Gezählt werden die Kapitel eines Manga in dem Monat, in dem du ihn auf „Beendet" stellst.'}
            </p>
          </Panel>

          {/* Beendet pro Monat */}
          <Panel
            id="monat" titel="Beendet pro Monat" offen={istOffen('monat')} onToggle={togglePanel}
            info={`${beendetSumme} in 12 Monaten`}
          >
            <MonatsChart
              daten={stats.beendetProMonat.map(m => ({ monat: m.monat, wert: m.n, tooltip: `${m.n} beendet` }))}
              ariaLabel={`Beendete Titel pro Monat, insgesamt ${beendetSumme}`}
            />
            {beendetSumme === 0 && <p className="empty-hint">Wird ab jetzt aufgezeichnet: Jeder Titel, den du auf „Beendet" stellst, erscheint hier.</p>}
          </Panel>

          {/* Status */}
          <Panel
            id="status" titel="Status" offen={istOffen('status')} onToggle={togglePanel}
            info={`${zahlText(stats.geplant)} geplant`}
          >
            <div className="stat-grid">
              <Kachel
                zahl={zahlText(stats.geplant)} label="Geplant (Rückstau)"
                aktiv={istFilter('status', 'planned')}
                onClick={ev => toggleFilter({ typ: 'status', wert: 'planned', label: 'Geplant' }, ev)}
              />
              <Kachel
                zahl={zahlText(stats.wiederholungen)} label="Wiederholungen"
                aktiv={istFilter('wiederholt')}
                onClick={ev => toggleFilter({ typ: 'wiederholt', wert: '', label: 'Wiederholt' }, ev)}
              />
            </div>
            {gesamtStatus > 0 && (
              <div className="status-chart">
                {stats.statusVerteilung.map(row => {
                  const pct = Math.round((row.n / gesamtStatus) * 100)
                  return (
                    <button
                      key={row.status}
                      className={`status-row status-row--klickbar ${istFilter('status', row.status) ? 'aktiv' : ''}`}
                      onClick={ev => toggleFilter({ typ: 'status', wert: row.status, label: STATUS_LABEL[row.status] ?? row.status }, ev)}
                    >
                      <span className="status-name" style={{ color: STATUS_TEXTFARBE[row.status] ?? 'var(--text-muted)' }}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                      <div className="status-bar-wrap">
                        <div
                          className="status-bar-fill"
                          style={{ width: `${pct}%`, background: STATUS_FARBE[row.status] ?? 'var(--accent)' }}
                        />
                      </div>
                      <span className="status-zahl">{row.n} ({pct}%)</span>
                    </button>
                  )
                })}
              </div>
            )}
          </Panel>

          {/* Genres */}
          {genreVerteilung.length > 0 && (
            <Panel
              id="genres" titel="Genres" offen={istOffen('genres')} onToggle={togglePanel}
              info={stats.topGenre ? `Top: ${stats.topGenre}` : `${genreVerteilung.length}`}
            >
              <div className="status-chart">
                {(genreAufgeklappt ? genreVerteilung : genreVerteilung.slice(0, 5)).map(([genre, anzahl]) => {
                  const pct = Math.round((anzahl / alleEintraege.length) * 100)
                  const balken = Math.round((anzahl / genreMax) * 100)
                  return (
                    <button
                      key={genre}
                      className={`status-row status-row--klickbar ${istFilter('genre', genre) ? 'aktiv' : ''}`}
                      onClick={ev => toggleFilter({ typ: 'genre', wert: genre, label: genre }, ev)}
                    >
                      <span className="status-name" style={{ color: 'var(--text)' }}>{genre}</span>
                      <div className="status-bar-wrap">
                        <div className="status-bar-fill" style={{ width: `${balken}%`, background: 'var(--accent)' }} />
                      </div>
                      <span className="status-zahl">{anzahl} ({pct}%)</span>
                    </button>
                  )
                })}
                {genreVerteilung.length > 5 && (
                  <button className="genre-mehr-btn" aria-expanded={genreAufgeklappt} onClick={() => setGenreAufgeklappt(v => !v)}>
                    {genreAufgeklappt ? '▲ Weniger anzeigen' : `▼ ${genreVerteilung.length - 5} weitere Genres`}
                  </button>
                )}
              </div>

              {stats.bewertungJeGenre.length > 0 && (
                <>
                  <h4 className="stat-unter-titel">Ø Bewertung je Genre</h4>
                  <div className="status-chart">
                    {stats.bewertungJeGenre.map(g => (
                      <button
                        key={g.genre}
                        className={`status-row status-row--klickbar ${istFilter('genre', g.genre) ? 'aktiv' : ''}`}
                        onClick={ev => toggleFilter({ typ: 'genre', wert: g.genre, label: g.genre }, ev)}
                      >
                        <span className="status-name" style={{ color: 'var(--text)' }}>{g.genre}</span>
                        <div className="status-bar-wrap">
                          <div className="status-bar-fill" style={{ width: `${g.schnitt / 5 * 100}%`, background: 'var(--accent)' }} />
                        </div>
                        <span className="status-zahl">{g.schnitt.toLocaleString('de-DE')} ★ ({g.n})</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          )}

          {/* Bewertungen */}
          <Panel
            id="bewertungen" titel="Bewertungen" offen={istOffen('bewertungen')} onToggle={togglePanel}
            info={stats.bewertungGesamt ? `Ø ${schnittText(stats.bewertungGesamt)}` : undefined}
          >
            <div className="bewertung-liste">
              {[
                { label: 'Gesamt', wert: stats.bewertungGesamt },
                { label: 'Anime', wert: stats.bewertungAnime },
                { label: 'Manga', wert: stats.bewertungManga },
              ].map(({ label, wert }) => (
                <div key={label} className="bewertung-zeile">
                  <span className="bewertung-label">{label}</span>
                  {wert
                    ? <span className="stat-wert">
                        {'★'.repeat(Math.round(wert))}{'☆'.repeat(Math.max(0, 5 - Math.round(wert)))}
                        {' '}<span className="stat-sub">({wert.toLocaleString('de-DE', { maximumFractionDigits: 1 })}/5)</span>
                      </span>
                    : <span className="stat-wert muted">–</span>
                  }
                </div>
              ))}
            </div>

            {stats.bewertungsVerteilung.some(b => b.n > 0) && (() => {
              const max = Math.max(...stats.bewertungsVerteilung.map(b => b.n))
              return (
                <>
                  <h4 className="stat-unter-titel">Verteilung</h4>
                  <div className="status-chart">
                    {[...stats.bewertungsVerteilung].reverse().map(b => (
                      <div key={b.sterne} className="status-row">
                        <span className="status-name stat-sterne">{'★'.repeat(b.sterne)}</span>
                        <div className="status-bar-wrap">
                          <div className="status-bar-fill" style={{ width: `${max ? Math.round(b.n / max * 100) : 0}%`, background: '#f5c518' }} />
                        </div>
                        <span className="status-zahl">{b.n}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </Panel>
        </div>

        {/* Detail-Panel (Trefferliste der angetippten Karte/Zeile) */}
        {detailFilter && (
          <section className="stat-section stat-detail-panel" ref={panelRef}>
            <div className="section-header">
              <h3 className="section-titel">{detailFilter.label} <span className="achievement-count">{detailEintraege.length}</span></h3>
              <div className="detail-panel-aktionen">
                <button className="edit-btn" onClick={zurueckNachOben}>↑ Zurück</button>
                <button className="edit-btn" onClick={schliessen}>✕ Schließen</button>
              </div>
            </div>
            {detailEintraege.length === 0 ? (
              <p className="empty-hint">Keine Einträge gefunden.</p>
            ) : (
              <div className="detail-eintraege-liste">
                {detailEintraege.map(e => (
                  <button
                    key={e.id}
                    className="detail-eintrag-zeile"
                    onClick={() => navigate(`/detail/${e.id}`)}
                  >
                    {e.cover_url
                      ? <img src={e.cover_url} alt="" className="detail-eintrag-cover" />
                      : <div className="detail-eintrag-cover detail-eintrag-cover--placeholder">{e.type === 'ANIME' ? '🎬' : '📚'}</div>
                    }
                    <div className="detail-eintrag-info">
                      <span className="detail-eintrag-titel">{e.title}</span>
                      <span className={`detail-eintrag-typ typ-${e.type.toLowerCase()}`}>{e.type}</span>
                    </div>
                    {e.rating && (
                      <span className="detail-eintrag-rating">
                        {'★'.repeat(e.rating)}{'☆'.repeat(Math.max(0, 5 - e.rating))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Achievements */}
        <div className="stat-panels">
          <Panel id="achievements" titel="Achievements" offen={istOffen('achievements')} onToggle={togglePanel}>
            <AchievementBereich />
          </Panel>
        </div>

      </div>
    </div>
  )
}
