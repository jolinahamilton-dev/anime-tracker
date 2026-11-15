import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './Page.css'
import './NewsPage.css'
import { api } from '../api'
import { anzeigeTitel } from '../titel'

interface NewsItem {
  id: number
  anilist_id: number
  episode: number
  airing_at: number
  seen: number
  title: string | null
  anzeige_titel?: string | null
  cover_url: string | null
  entry_id: number | null
}

interface NeueStaffel {
  entry_id: number
  related_anilist_id: number
  title: string | null
  anzeige_titel?: string | null
  cover_url: string | null
  media_status: string | null
  neu_seit: string
  serie: string
  anzeige_serie?: string
}

type Gruppe = 'erschienen' | 'bald' | 'angekuendigt'

// Gewählte Gruppe und Scrollposition des Feeds: beim Zurückkommen von einer Detailseite wie vorher (Modulzustand)
const sitzung: { scroll: number; gruppe: Gruppe | null } = { scroll: 0, gruppe: null }

function formatDatum(unix: number): string {
  const d = new Date(unix * 1000)
  const jetzt = Date.now()
  const diff = unix * 1000 - jetzt

  if (diff > 0) {
    const stunden = Math.floor(diff / 3_600_000)
    if (stunden < 24) return `in ${stunden} Std.`
    const tage = Math.floor(diff / 86_400_000)
    return `in ${tage} Tag${tage !== 1 ? 'en' : ''}`
  }

  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Kommende Folgen nach Tag gruppiert („Heute", „Morgen", „Mittwoch, 29.10." …), früheste zuerst
function sendeplan(items: NewsItem[]) {
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  const tage = new Map<string, { schluessel: string; ueberschrift: string; folgen: NewsItem[] }>()
  for (const item of [...items].sort((a, b) => a.airing_at - b.airing_at)) {
    const d = new Date(item.airing_at * 1000)
    const tag = new Date(d); tag.setHours(0, 0, 0, 0)
    const abstand = Math.round((tag.getTime() - heute.getTime()) / 86_400_000)
    const schluessel = tag.toISOString()
    const datum = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })
    const ueberschrift = abstand === 0 ? `Heute · ${datum}` : abstand === 1 ? `Morgen · ${datum}` : datum
    if (!tage.has(schluessel)) tage.set(schluessel, { schluessel, ueberschrift, folgen: [] })
    tage.get(schluessel)!.folgen.push(item)
  }
  return [...tage.values()]
}

export default function NewsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<NewsItem[]>([])
  const [staffeln, setStaffeln] = useState<NeueStaffel[]>([])
  const [laden, setLaden] = useState(true)
  const [aktualisieren, setAktualisieren] = useState(false)
  const [gewaehlt, setGewaehlt] = useState<Gruppe | null>(sitzung.gruppe)
  const inhaltRef = useRef<HTMLDivElement>(null)
  const wiederhergestellt = useRef(false)
  // „Zurück“ auf der Detailseite führt hierher (1 Schritt) – siehe DetailPage (zurueck)
  const oeffne = (id: number) => navigate(`/detail/${id}`, { state: { zurueck: 1 } })

  // Sobald der Feed gerendert ist, an die alte Stelle springen
  useLayoutEffect(() => {
    if (wiederhergestellt.current || laden || !inhaltRef.current) return
    wiederhergestellt.current = true
    inhaltRef.current.scrollTop = sitzung.scroll  }, [laden])

  useEffect(() => { ladeNews() }, [])
  // Hintergrund-Abgleich fertig → neue Staffeln/Folgen anzeigen
  useEffect(() => api.onSerienAktualisiert(() => ladeNews()), [])

  async function ladeNews() {
    const [news, neu] = await Promise.all([api.getNews(), api.getNeueStaffeln()])
    setItems(news)
    setStaffeln(neu)
    setLaden(false)
  }

  const [fehler, setFehler] = useState('')

  async function refresh() {
    setAktualisieren(true)
    setFehler('')
    try {
      // Erst neue Staffeln/Folgen suchen (ergänzt die Watch-Orders), dann deren Ausstrahlungstermine holen
      await api.syncSerien()
      await api.refreshNews()
      await ladeNews()
    } catch {
      setFehler('Aktualisieren fehlgeschlagen – AniList nicht erreichbar.')
    } finally {
      setAktualisieren(false)
    }
  }

  const erschienen = items.filter(i => i.airing_at <= Date.now() / 1000)
  const bald = items.filter(i => i.airing_at > Date.now() / 1000)
  // Staffeln, die schon laufen (neue Staffel gestartet), und solche, die nur angekündigt sind
  const neueStaffeln = staffeln.filter(s => s.media_status !== 'NOT_YET_RELEASED')
  const angekuendigt = staffeln.filter(s => s.media_status === 'NOT_YET_RELEASED')

  const GRUPPEN: { key: Gruppe; chip: string; titel: string; hinweis: string; anzahl: number }[] = [
    { key: 'erschienen', chip: 'Erschienen', titel: 'Neu erschienen', hinweis: 'Folgen, die schon gelaufen sind, und gerade gestartete Staffeln', anzahl: erschienen.length + neueStaffeln.length },
    { key: 'bald', chip: 'Erscheint bald', titel: 'Erscheint in den nächsten zwei Wochen', hinweis: 'Der Sendeplan deiner abonnierten Serien', anzahl: bald.length },
    { key: 'angekuendigt', chip: 'Angekündigt', titel: 'Angekündigt', hinweis: 'Neue Staffeln und Fortsetzungen, die noch nicht gestartet sind', anzahl: angekuendigt.length },
  ]
  const vorhanden = GRUPPEN.filter(g => g.anzahl > 0)
  // Gewählte Gruppe leer (z. B. nichts mehr angekündigt) → die erste mit Inhalt
  const aktiv = vorhanden.find(g => g.key === gewaehlt) ?? vorhanden[0] ?? null

  function waehleGruppe(g: Gruppe) {
    setGewaehlt(g)
    sitzung.gruppe = g
    sitzung.scroll = 0
    if (inhaltRef.current) inhaltRef.current.scrollTop = 0
  }

  const staffelKarte = (s: NeueStaffel) => (
    <button
      key={`${s.entry_id}-${s.related_anilist_id}`}
      className="news-karte news-karte--klickbar"
      onClick={() => oeffne(s.entry_id)}
    >
      {s.cover_url && <img src={s.cover_url} alt="" className="news-cover" />}
      <div className="news-info">
        <p className="news-titel">{anzeigeTitel(s) || `AniList #${s.related_anilist_id}`}</p>
        <p className="news-folge">zu „{s.anzeige_serie ?? s.serie}"</p>
      </div>
      <div className="news-datum">
        <span>{new Date(s.neu_seit).toLocaleDateString('de-DE')}</span>
        {s.media_status === 'NOT_YET_RELEASED'
          ? <span className="news-badge news-badge--bald">Angekündigt</span>
          : <span className="news-badge">Neue Staffel</span>}
      </div>
    </button>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2>News</h2>
        <button className="edit-btn" onClick={refresh} disabled={aktualisieren}>
          {aktualisieren ? '…' : '↻ Aktualisieren'}
        </button>
      </div>

      {fehler && <p className="fehler-text" style={{ padding: '0 20px' }}>{fehler}</p>}

      {laden ? (
        <div className="empty-state"><p>Wird geladen…</p></div>
      ) : items.length === 0 && staffeln.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📰</div>
          <p>Keine News vorhanden.</p>
          <p className="empty-hint">Abonniere Anime mit 🔔 (auf der Karte oder in der Detailansicht), um News zu neuen Folgen und Staffeln zu bekommen.</p>
        </div>
      ) : (
        <>
          {/* Wie in „Für dich“: kleine Auswahl der Gruppe, darunter immer nur eine Gruppe */}
          <div className="news-filter" role="group" aria-label="Art der News">
            {vorhanden.map(g => (
              <button
                key={g.key}
                className={aktiv?.key === g.key ? 'filter-btn active' : 'filter-btn'}
                aria-pressed={aktiv?.key === g.key}
                aria-label={`${g.chip}: ${g.anzahl}`}
                onClick={() => waehleGruppe(g.key)}
              >
                {g.chip} <span className="news-anzahl">{g.anzahl}</span>
              </button>
            ))}
          </div>
          <div className="news-inhalt" ref={inhaltRef} onScroll={e => { sitzung.scroll = e.currentTarget.scrollTop }}>
            {aktiv && (
              <section>
                <h3 className="news-gruppe-titel">{aktiv.titel}</h3>
                <p className="news-gruppe-hinweis">{aktiv.hinweis}</p>

                {aktiv.key === 'erschienen' && (
                  <>
                    {neueStaffeln.length > 0 && (
                      <>
                        <h4 className="sendeplan-datum">Neue Staffeln</h4>
                        {neueStaffeln.map(staffelKarte)}
                      </>
                    )}
                    {erschienen.length > 0 && (
                      <>
                        {neueStaffeln.length > 0 && <h4 className="sendeplan-datum">Neue Folgen</h4>}
                        {erschienen.map(item => <NewsKarte key={item.id} item={item} onOeffnen={oeffne} />)}
                      </>
                    )}
                  </>
                )}

                {aktiv.key === 'bald' && sendeplan(bald).map(tag => (
                  <div key={tag.schluessel} className="sendeplan-tag">
                    <h4 className="sendeplan-datum">{tag.ueberschrift}</h4>
                    {tag.folgen.map(item => <NewsKarte key={item.id} item={item} onOeffnen={oeffne} />)}
                  </div>
                ))}

                {aktiv.key === 'angekuendigt' && angekuendigt.map(staffelKarte)}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function NewsKarte({ item, onOeffnen }: { item: NewsItem, onOeffnen: (entryId: number) => void }) {
  const istNeu = !item.seen && item.airing_at <= Date.now() / 1000
  const istBald = item.airing_at > Date.now() / 1000

  return (
    <div
      className={`news-karte ${istNeu ? 'news-karte--neu' : ''} ${istBald ? 'news-karte--bald' : ''} ${item.entry_id ? 'news-karte--klickbar' : ''}`}
      onClick={() => item.entry_id && onOeffnen(item.entry_id)}
    >
      {item.cover_url && (
        <img src={item.cover_url} alt={anzeigeTitel(item)} className="news-cover" />
      )}
      <div className="news-info">
        <p className="news-titel">{anzeigeTitel(item) || `AniList #${item.anilist_id}`}</p>
        <p className="news-folge">Folge {item.episode}</p>
      </div>
      <div className="news-datum">
        <span>{istBald
          ? new Date(item.airing_at * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
          : formatDatum(item.airing_at)}</span>
        {istNeu && <span className="news-badge">Neu</span>}
        {istBald && <span className="news-badge news-badge--bald">Bald</span>}
      </div>
    </div>
  )
}
