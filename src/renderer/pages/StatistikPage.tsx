import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './Page.css'
import './StatistikPage.css'
import { api } from '../api'
import { STATUS_TEXTFARBE } from '../components/EintragKarte'

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
}

const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

interface Achievement {
  id: string
  name: string
  beschreibung: string
  icon: string
  unlocked_at: string | null
}

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

type DetailFilter =
  | { typ: 'mediatyp'; wert: string; label: string }
  | { typ: 'status'; wert: string; label: string }
  | { typ: 'genre'; wert: string; label: string }
  | { typ: 'alle'; wert: ''; label: string }
  | { typ: 'wiederholt'; wert: ''; label: string }

export default function StatistikPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [alleEintraege, setAlleEintraege] = useState<Eintrag[]>([])
  const [detailFilter, setDetailFilter] = useState<DetailFilter | null>(null)
  const [genreAufgeklappt, setGenreAufgeklappt] = useState(false)

  useEffect(() => {
    api.getStats().then(setStats)
    api.getAchievements().then(setAchievements)
    api.getEntries().then(setAlleEintraege)
  }, [])

  // Die Trefferliste steht weit unten → nach dem Antippen dorthin scrollen, „↑ Zurück“ führt
  // wieder zur angetippten Karte bzw. Zeile
  const panelRef = useRef<HTMLElement>(null)
  const herkunft = useRef<HTMLElement | null>(null)

  function toggleFilter(f: DetailFilter, ev?: React.MouseEvent<HTMLElement>) {
    herkunft.current = ev?.currentTarget ?? null
    setDetailFilter(prev => prev?.typ === f.typ && prev?.wert === f.wert ? null : f)
  }

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
  const freigeschaltet = achievements.filter(a => a.unlocked_at !== null)

  return (
    <div className="page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>← Zurück</button>
        <h2>Statistiken</h2>
      </div>

      <div className="statistik-inhalt">

        {/* Übersicht */}
        <section className="stat-section">
          <h3 className="section-titel">Übersicht</h3>
          <div className="stat-grid">
            <button
              className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'alle' ? 'aktiv' : ''}`}
              onClick={ev => toggleFilter({ typ: 'alle', wert: '', label: 'Alle Einträge' }, ev)}
            >
              <span className="stat-zahl">{stats.gesamt}</span>
              <span className="stat-label">Einträge gesamt</span>
            </button>
            <button
              className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'mediatyp' && detailFilter.wert === 'ANIME' ? 'aktiv' : ''}`}
              onClick={ev => toggleFilter({ typ: 'mediatyp', wert: 'ANIME', label: 'Anime' }, ev)}
            >
              <span className="stat-zahl">{stats.anime}</span>
              <span className="stat-label">Anime</span>
            </button>
            <button
              className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'mediatyp' && detailFilter.wert === 'MANGA' ? 'aktiv' : ''}`}
              onClick={ev => toggleFilter({ typ: 'mediatyp', wert: 'MANGA', label: 'Manga' }, ev)}
            >
              <span className="stat-zahl">{stats.manga}</span>
              <span className="stat-label">Manga</span>
            </button>
            <button
              className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'status' && detailFilter.wert === 'completed' ? 'aktiv' : ''}`}
              onClick={ev => toggleFilter({ typ: 'status', wert: 'completed', label: 'Beendet' }, ev)}
            >
              <span className="stat-zahl">{stats.beendet}</span>
              <span className="stat-label">Beendet</span>
            </button>
            <div className="stat-karte">
              <span className="stat-zahl">{stats.folgenGesehen.toLocaleString('de-DE')}</span>
              <span className="stat-label">Folgen gesehen</span>
            </div>
            <div className="stat-karte">
              <span className="stat-zahl">{stats.kapitelGelesen.toLocaleString('de-DE')}</span>
              <span className="stat-label">Kapitel gelesen</span>
            </div>
            <div className="stat-karte" title="Mit der echten Folgenlänge jeder Staffel laut AniList (fehlt sie, zählen 24 Min.)">
              <span className="stat-zahl">{formatWatchtime(stats.watchtimeMinuten)}</span>
              <span className="stat-label">Watchtime</span>
            </div>
            <div className="stat-karte" title="Noch ungesehene, schon verfügbare Folgen von geplanten, angefangenen, laufenden und pausierten Anime">
              <span className="stat-zahl">{stats.offeneFolgen.toLocaleString('de-DE')}</span>
              <span className="stat-label">Folgen offen (≈ {formatWatchtime(stats.offeneMinuten)})</span>
            </div>
            <button
              className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'status' && detailFilter.wert === 'planned' ? 'aktiv' : ''}`}
              onClick={ev => toggleFilter({ typ: 'status', wert: 'planned', label: 'Geplant' }, ev)}
            >
              <span className="stat-zahl">{stats.geplant}</span>
              <span className="stat-label">Geplant (Rückstau)</span>
            </button>
            <button
              className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'wiederholt' ? 'aktiv' : ''}`}
              onClick={ev => toggleFilter({ typ: 'wiederholt', wert: '', label: 'Wiederholt' }, ev)}
            >
              <span className="stat-zahl">{stats.wiederholungen}</span>
              <span className="stat-label">Wiederholungen</span>
            </button>
            {stats.topGenre && (
              <button
                className={`stat-karte stat-karte--klickbar ${detailFilter?.typ === 'genre' && detailFilter.wert === stats.topGenre ? 'aktiv' : ''}`}
                onClick={ev => toggleFilter({ typ: 'genre', wert: stats.topGenre!, label: stats.topGenre! }, ev)}
              >
                <span className="stat-zahl">{stats.topGenre}</span>
                <span className="stat-label">Top-Genre</span>
              </button>
            )}
            {!stats.topGenre && (
              <div className="stat-karte">
                <span className="stat-zahl">–</span>
                <span className="stat-label">Top-Genre</span>
              </div>
            )}
          </div>
        </section>

        {/* Bewertungen */}
        <section className="stat-section">
          <h3 className="section-titel">Ø Bewertung</h3>
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
        </section>

        {/* Bewertungsverteilung */}
        {stats.bewertungsVerteilung.some(b => b.n > 0) && (() => {
          const max = Math.max(...stats.bewertungsVerteilung.map(b => b.n))
          return (
            <section className="stat-section">
              <h3 className="section-titel">Bewertungen</h3>
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
            </section>
          )
        })()}

        {/* Ø Bewertung je Genre */}
        {stats.bewertungJeGenre.length > 0 && (
          <section className="stat-section">
            <h3 className="section-titel">Ø Bewertung je Genre</h3>
            <div className="status-chart">
              {stats.bewertungJeGenre.map(g => (
                <button
                  key={g.genre}
                  className={`status-row status-row--klickbar ${detailFilter?.typ === 'genre' && detailFilter.wert === g.genre ? 'aktiv' : ''}`}
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
          </section>
        )}

        {/* Beendet pro Monat */}
        {(() => {
          const max = Math.max(1, ...stats.beendetProMonat.map(m => m.n))
          const summe = stats.beendetProMonat.reduce((s, m) => s + m.n, 0)
          return (
            <section className="stat-section">
              <h3 className="section-titel">Beendet pro Monat <span className="achievement-count">{summe} in 12 Monaten</span></h3>
              <div className="monats-chart" role="img" aria-label={`Beendete Titel pro Monat, insgesamt ${summe}`}>
                {stats.beendetProMonat.map(m => (
                  <div key={m.monat} className="monats-spalte" title={`${m.n} beendet`}>
                    <span className="monats-zahl">{m.n || ''}</span>
                    <div className="monats-balken" style={{ height: `${m.n / max * 100}%` }} />
                    <span className="monats-name">{MONAT_KURZ[Number(m.monat.slice(5)) - 1]}</span>
                  </div>
                ))}
              </div>
              {summe === 0 && <p className="empty-hint">Wird ab jetzt aufgezeichnet: Jeder Titel, den du auf „Beendet" stellst, erscheint hier.</p>}
            </section>
          )
        })()}

        {/* Statusverteilung */}
        {gesamtStatus > 0 && (
          <section className="stat-section">
            <h3 className="section-titel">Statusverteilung</h3>
            <div className="status-chart">
              {stats.statusVerteilung.map(row => {
                const pct = Math.round((row.n / gesamtStatus) * 100)
                const aktiv = detailFilter?.typ === 'status' && detailFilter.wert === row.status
                return (
                  <button
                    key={row.status}
                    className={`status-row status-row--klickbar ${aktiv ? 'aktiv' : ''}`}
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
          </section>
        )}

        {/* Genre-Verteilung */}
        {genreVerteilung.length > 0 && (
          <section className="stat-section">
            <h3 className="section-titel">Genres</h3>
            <div className="status-chart">
              {(genreAufgeklappt ? genreVerteilung : genreVerteilung.slice(0, 4)).map(([genre, anzahl]) => {
                const pct = Math.round((anzahl / alleEintraege.length) * 100)
                const balken = Math.round((anzahl / genreMax) * 100)
                const aktiv = detailFilter?.typ === 'genre' && detailFilter.wert === genre
                return (
                  <button
                    key={genre}
                    className={`status-row status-row--klickbar ${aktiv ? 'aktiv' : ''}`}
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
              {genreVerteilung.length > 4 && (
                <button className="genre-mehr-btn" onClick={() => setGenreAufgeklappt(v => !v)}>
                  {genreAufgeklappt ? '▲ Weniger anzeigen' : `▼ ${genreVerteilung.length - 4} weitere Genres`}
                </button>
              )}
            </div>
          </section>
        )}

        {/* Detail-Panel */}
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
        <section className="stat-section">
          <h3 className="section-titel">
            Achievements <span className="achievement-count">{freigeschaltet.length}/{achievements.length} freigeschaltet</span>
          </h3>
          {achievements.length === 0 ? (
            <p className="empty-hint">Wird geladen…</p>
          ) : (
            <div className="achievement-grid">
              {achievements.map(a => (
                <div
                  key={a.id}
                  className={a.unlocked_at ? 'achievement-item freigeschaltet' : 'achievement-item gesperrt'}
                  title={a.unlocked_at
                    ? `Freigeschaltet: ${new Date(a.unlocked_at).toLocaleDateString('de-DE')}`
                    : a.beschreibung}
                >
                  <span className="achievement-icon">{a.unlocked_at ? a.icon : '🔒'}</span>
                  <div className="achievement-info">
                    <span className="achievement-name">{a.name}</span>
                    <span className="achievement-desc">{a.beschreibung}</span>
                    {a.unlocked_at && (
                      <span className="achievement-datum">
                        {new Date(a.unlocked_at).toLocaleDateString('de-DE')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
