import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Page.css'
import './NewsPage.css'
import { api } from '../api'

interface NewsItem {
  id: number
  anilist_id: number
  episode: number
  airing_at: number
  seen: number
  title: string | null
  cover_url: string | null
  entry_id: number | null
}

interface NeueStaffel {
  entry_id: number
  related_anilist_id: number
  title: string | null
  cover_url: string | null
  media_status: string | null
  neu_seit: string
  serie: string
}

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
        <div className="news-inhalt">
          {staffeln.length > 0 && (
            <section>
              <h3 className="news-gruppe-titel">Neue Staffeln & Ankündigungen</h3>
              {staffeln.map(s => (
                <button
                  key={`${s.entry_id}-${s.related_anilist_id}`}
                  className="news-karte news-karte--klickbar"
                  onClick={() => navigate(`/detail/${s.entry_id}`)}
                >
                  {s.cover_url && <img src={s.cover_url} alt="" className="news-cover" />}
                  <div className="news-info">
                    <p className="news-titel">{s.title ?? `AniList #${s.related_anilist_id}`}</p>
                    <p className="news-folge">zu „{s.serie}"</p>
                  </div>
                  <div className="news-datum">
                    <span>{new Date(s.neu_seit).toLocaleDateString('de-DE')}</span>
                    {s.media_status === 'NOT_YET_RELEASED'
                      ? <span className="news-badge news-badge--bald">Angekündigt</span>
                      : <span className="news-badge">Neue Staffel</span>}
                  </div>
                </button>
              ))}
            </section>
          )}
          {bald.length > 0 && (
            <section>
              <h3 className="news-gruppe-titel">Sendeplan</h3>
              {sendeplan(bald).map(tag => (
                <div key={tag.schluessel} className="sendeplan-tag">
                  <h4 className="sendeplan-datum">{tag.ueberschrift}</h4>
                  {tag.folgen.map(item => <NewsKarte key={item.id} item={item} onOeffnen={id => navigate(`/detail/${id}`)} />)}
                </div>
              ))}
            </section>
          )}
          {erschienen.length > 0 && (
            <section>
              <h3 className="news-gruppe-titel">Neue Folgen</h3>
              {erschienen.map(item => <NewsKarte key={item.id} item={item} onOeffnen={id => navigate(`/detail/${id}`)} />)}
            </section>
          )}
        </div>
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
        <img src={item.cover_url} alt={item.title ?? ''} className="news-cover" />
      )}
      <div className="news-info">
        <p className="news-titel">{item.title ?? `AniList #${item.anilist_id}`}</p>
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
