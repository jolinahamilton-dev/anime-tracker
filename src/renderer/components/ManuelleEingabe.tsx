import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EntryStatus, MediaType } from '../../types'
import Sterne from './Sterne'
import './ManuelleEingabe.css'
import { api } from '../api'

const STATUS_LABEL: Partial<Record<EntryStatus, string>> = {
  started: 'Angefangen',
  completed: 'Beendet',
  ongoing: 'Ongoing',
}

const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror',
  'Isekai', 'Mecha', 'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life',
  'Sports', 'Supernatural', 'Thriller',
]

export default function ManuelleEingabe() {
  const navigate = useNavigate()
  const [typ, setTyp] = useState<MediaType>('ANIME')
  const [titel, setTitel] = useState('')
  const [status, setStatus] = useState<EntryStatus>('started')
  const [gesamtFolgen, setGesamtFolgen] = useState('')
  const [fortschritt, setFortschritt] = useState(0)
  const [gesamtKapitel, setGesamtKapitel] = useState('')
  const [kapitel, setKapitel] = useState(0)
  const [gesamtBaende, setGesamtBaende] = useState('')
  const [baende, setBaende] = useState(0)
  const [genres, setGenres] = useState<string[]>([])
  const [beschreibung, setBeschreibung] = useState('')
  const [bewertung, setBewertung] = useState<number | null>(null)
  const [favorit, setFavorit] = useState(false)
  const [speichern, setSpeichern] = useState(false)
  const [fehler, setFehler] = useState('')

  function toggleGenre(g: string) {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  async function onSpeichern() {
    if (!titel.trim()) { setFehler('Bitte einen Titel eingeben.'); return }
    setFehler('')
    setSpeichern(true)
    try {
      await api.createEntry({
        anilist_id: null,
        type: typ,
        title: titel.trim(),
        cover_url: null,
        genres: JSON.stringify(genres),
        description: beschreibung || null,
        total_episodes: typ === 'ANIME' ? (gesamtFolgen ? Number(gesamtFolgen) : null) : null,
        total_chapters: typ === 'MANGA' ? (gesamtKapitel ? Number(gesamtKapitel) : null) : null,
        total_volumes: typ === 'MANGA' ? (gesamtBaende ? Number(gesamtBaende) : null) : null,
        progress_episodes: typ === 'ANIME' ? fortschritt : 0,
        progress_chapters: typ === 'MANGA' ? kapitel : 0,
        progress_volumes: typ === 'MANGA' ? baende : 0,
        status,
        rating: bewertung,
        is_favorite: favorit ? 1 : 0,
        review: null,
      })
      navigate('/')
    } finally {
      setSpeichern(false)
    }
  }

  return (
    <div className="manuelle-eingabe">
      <div className="manuelle-formular">

        <div className="formular-zeile">
          <label>Typ *</label>
          <div className="status-buttons">
            {(['ANIME', 'MANGA'] as MediaType[]).map(t => (
              <button key={t} className={typ === t ? 'filter-btn active' : 'filter-btn'} onClick={() => setTyp(t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="formular-zeile">
          <label>Titel *</label>
          <input
            type="text"
            placeholder="Titel eingeben..."
            value={titel}
            onChange={e => setTitel(e.target.value)}
            className="manuelle-input"
          />
        </div>

        <div className="formular-zeile">
          <label>Status</label>
          <div className="status-buttons">
            {(['started', 'ongoing', 'completed'] as EntryStatus[]).map(s => (
              <button key={s} className={status === s ? 'filter-btn active' : 'filter-btn'} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {typ === 'ANIME' ? (
          <div className="formular-zeile">
            <label>Folgen</label>
            <div className="zaehler-row">
              <button className="zaehler-btn" onClick={() => setFortschritt(Math.max(0, fortschritt - 1))}>−</button>
              <input type="number" min={0} value={fortschritt} onChange={e => setFortschritt(Number(e.target.value))} className="zaehler-input" />
              <span className="zaehler-von">von</span>
              <input type="number" min={0} placeholder="?" value={gesamtFolgen} onChange={e => setGesamtFolgen(e.target.value)} className="zaehler-input" />
              <button className="zaehler-btn" onClick={() => setFortschritt(fortschritt + 1)}>+</button>
            </div>
          </div>
        ) : (
          <>
            <div className="formular-zeile">
              <label>Kapitel</label>
              <div className="zaehler-row">
                <button className="zaehler-btn" onClick={() => setKapitel(Math.max(0, kapitel - 1))}>−</button>
                <input type="number" min={0} value={kapitel} onChange={e => setKapitel(Number(e.target.value))} className="zaehler-input" />
                <span className="zaehler-von">von</span>
                <input type="number" min={0} placeholder="?" value={gesamtKapitel} onChange={e => setGesamtKapitel(e.target.value)} className="zaehler-input" />
                <button className="zaehler-btn" onClick={() => setKapitel(kapitel + 1)}>+</button>
              </div>
            </div>
            <div className="formular-zeile">
              <label>Bände</label>
              <div className="zaehler-row">
                <button className="zaehler-btn" onClick={() => setBaende(Math.max(0, baende - 1))}>−</button>
                <input type="number" min={0} value={baende} onChange={e => setBaende(Number(e.target.value))} className="zaehler-input" />
                <span className="zaehler-von">von</span>
                <input type="number" min={0} placeholder="?" value={gesamtBaende} onChange={e => setGesamtBaende(e.target.value)} className="zaehler-input" />
                <button className="zaehler-btn" onClick={() => setBaende(baende + 1)}>+</button>
              </div>
            </div>
          </>
        )}

        <div className="formular-zeile formular-zeile--top">
          <label>Genres</label>
          <div className="genre-picker">
            {GENRES.map(g => (
              <button
                key={g}
                className={genres.includes(g) ? 'genre-tag genre-tag--aktiv' : 'genre-tag'}
                onClick={() => toggleGenre(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="formular-zeile formular-zeile--top">
          <label>Beschreibung</label>
          <textarea
            placeholder="Optionale Kurzbeschreibung..."
            value={beschreibung}
            onChange={e => setBeschreibung(e.target.value)}
            className="manuelle-textarea"
            rows={3}
          />
        </div>

        <div className="formular-zeile">
          <label>Bewertung</label>
          <Sterne wert={bewertung} onChange={setBewertung} />
        </div>

        <div className="formular-zeile">
          <label>Favorit</label>
          <button className={favorit ? 'favorit-btn aktiv' : 'favorit-btn'} onClick={() => setFavorit(!favorit)}>
            {favorit ? '⭐ Favorit' : '☆ Als Favorit markieren'}
          </button>
        </div>

        {fehler && <p className="fehler-text">{fehler}</p>}

        <button className="btn-primary btn-speichern" onClick={onSpeichern} disabled={speichern}>
          {speichern ? 'Wird gespeichert…' : '✓ Zur Liste hinzufügen'}
        </button>
      </div>
    </div>
  )
}
