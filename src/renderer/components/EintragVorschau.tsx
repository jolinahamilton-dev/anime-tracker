import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AniListSearchResult, EntryStatus } from '../../types'
import Sterne from './Sterne'
import './EintragVorschau.css'
import { snackbar } from '../meldungen'
import { api } from '../api'

interface Props {
  data: AniListSearchResult
  onZurueck: () => void
}

const STATUS_LABEL: Partial<Record<EntryStatus, string>> = {
  started: 'Angefangen',
  completed: 'Beendet',
  ongoing: 'Ongoing',
}

export default function EintragVorschau({ data, onZurueck }: Props) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<EntryStatus>('started')
  const [fortschritt, setFortschritt] = useState(0)
  const [kapitel, setKapitel] = useState(0)
  const [baende, setBaende] = useState(0)
  const [bewertung, setBewertung] = useState<number | null>(null)
  const [favorit, setFavorit] = useState(false)
  const [speichern, setSpeichern] = useState(false)

  const isAnime = data.type === 'ANIME'
  const beschreibung = data.description?.replace(/<[^>]*>/g, '') ?? ''

  async function onSpeichern() {
    setSpeichern(true)
    try {
      const ergebnis = await api.createEntry({
        anilist_id: data.id,
        type: data.type,
        title: data.title.romaji,
        cover_url: data.coverImage.large,
        genres: JSON.stringify(data.genres),
        description: beschreibung,
        total_episodes: data.episodes ?? null,
        total_chapters: data.chapters ?? null,
        total_volumes: data.volumes ?? null,
        progress_episodes: isAnime ? fortschritt : 0,
        progress_chapters: !isAnime ? kapitel : 0,
        progress_volumes: !isAnime ? baende : 0,
        status,
        rating: bewertung,
        is_favorite: favorit ? 1 : 0,
        review: null,
      })
      if (ergebnis.schonVorhanden) {
        // Gleicher AniList-Titel ist schon in der Liste → keinen Doppelten anlegen, dorthin springen
        snackbar(`„${ergebnis.title}" ist schon in deiner Liste`)
        navigate(`/detail/${ergebnis.id}`)
        return
      }
      navigate('/')
    } finally {
      setSpeichern(false)
    }
  }

  return (
    <div className="page vorschau-seite">
      <div className="page-header">
        <button className="back-btn" onClick={onZurueck}>← Zurück</button>
        <h2>Eintrag hinzufügen</h2>
      </div>

      <div className="vorschau-inhalt">
        <div className="vorschau-oben">
          <img src={data.coverImage.large} alt={data.title.romaji} className="vorschau-cover" />
          <div className="vorschau-meta">
            <span className="ergebnis-typ">{data.type}</span>
            <h3 className="vorschau-titel">{data.title.romaji}</h3>
            {data.title.english && data.title.english !== data.title.romaji && (
              <p className="vorschau-titel-en">{data.title.english}</p>
            )}
            <div className="ergebnis-genres">
              {data.genres.map(g => <span key={g} className="genre-tag">{g}</span>)}
            </div>
          </div>
        </div>

        {beschreibung && (
          <p className="vorschau-beschreibung">{beschreibung.slice(0, 300)}{beschreibung.length > 300 ? '…' : ''}</p>
        )}

        <div className="vorschau-formular">
          <div className="formular-zeile">
            <label>Status</label>
            <div className="status-buttons">
              {(['started', 'ongoing', 'completed'] as EntryStatus[]).map(s => (
                <button
                  key={s}
                  className={status === s ? 'filter-btn active' : 'filter-btn'}
                  onClick={() => setStatus(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {isAnime ? (
            <div className="formular-zeile">
              <label>Folgen gesehen</label>
              <div className="zaehler-row">
                <button className="zaehler-btn" onClick={() => setFortschritt(Math.max(0, fortschritt - 1))}>−</button>
                <input
                  type="number"
                  min={0}
                  max={data.episodes ?? 9999}
                  value={fortschritt}
                  onChange={e => setFortschritt(Number(e.target.value))}
                  className="zaehler-input"
                />
                <span className="zaehler-von">von {data.episodes ?? '?'}</span>
                <button className="zaehler-btn" onClick={() => setFortschritt(Math.min(data.episodes ?? 9999, fortschritt + 1))}>+</button>
              </div>
            </div>
          ) : (
            <>
              <div className="formular-zeile">
                <label>Kapitel gelesen</label>
                <div className="zaehler-row">
                  <button className="zaehler-btn" onClick={() => setKapitel(Math.max(0, kapitel - 1))}>−</button>
                  <input type="number" min={0} value={kapitel} onChange={e => setKapitel(Number(e.target.value))} className="zaehler-input" />
                  <span className="zaehler-von">von {data.chapters ?? '?'}</span>
                  <button className="zaehler-btn" onClick={() => setKapitel(kapitel + 1)}>+</button>
                </div>
              </div>
              <div className="formular-zeile">
                <label>Bände gelesen</label>
                <div className="zaehler-row">
                  <button className="zaehler-btn" onClick={() => setBaende(Math.max(0, baende - 1))}>−</button>
                  <input type="number" min={0} value={baende} onChange={e => setBaende(Number(e.target.value))} className="zaehler-input" />
                  <span className="zaehler-von">von {data.volumes ?? '?'}</span>
                  <button className="zaehler-btn" onClick={() => setBaende(baende + 1)}>+</button>
                </div>
              </div>
            </>
          )}

          <div className="formular-zeile">
            <label>Bewertung</label>
            <Sterne wert={bewertung} onChange={setBewertung} />
          </div>

          <div className="formular-zeile">
            <label>Favorit</label>
            <button
              className={favorit ? 'favorit-btn aktiv' : 'favorit-btn'}
              onClick={() => setFavorit(!favorit)}
            >
              {favorit ? '⭐ Favorit' : '☆ Als Favorit markieren'}
            </button>
          </div>
        </div>

        <button className="btn-primary btn-speichern" onClick={onSpeichern} disabled={speichern}>
          {speichern ? 'Wird gespeichert…' : '✓ Zur Liste hinzufügen'}
        </button>
      </div>
    </div>
  )
}
