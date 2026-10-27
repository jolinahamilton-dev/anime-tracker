import { Routes, Route, NavLink, useLocation, useParams, useNavigate } from 'react-router-dom'
import ListePage from './pages/ListePage'
import EinpflegenPage from './pages/EinpflegenPage'
import NewsPage from './pages/NewsPage'
import EinstellungenPage from './pages/EinstellungenPage'
import DetailPage from './pages/DetailPage'
import StatistikPage from './pages/StatistikPage'
import AchievementToast from './components/AchievementToast'
import SerienToast from './components/SerienToast'
import Meldungen from './components/Meldungen'
import { useState, useEffect } from 'react'
import { useSettings } from './hooks/useSettings'
import { istTippen, overlayOffen, useTasten } from './tastatur'
import './styles/App.css'
import { api } from './api'

// key={id}: Beim Blättern (‹ ›) wird die Detailseite komplett neu aufgebaut. So können
// verspätete Antworten (AniList) des vorherigen Eintrags nicht im neuen landen, und
// offene Editoren/States werden zurückgesetzt.
function DetailPageNeu() {
  const { id } = useParams()
  return <DetailPage key={id} />
}

export default function App() {
  useSettings() // lädt Settings und wendet CSS-Variablen an
  const location = useLocation()
  const navigate = useNavigate()
  const showNav = ['/', '/einpflegen', '/news'].includes(location.pathname)
  const [newsCount, setNewsCount] = useState(0)

  useEffect(() => {
    const lade = () => api.getNewsUnseenCount().then(setNewsCount)
    lade()
    const interval = setInterval(lade, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Badge zurücksetzen wenn News-Tab besucht
  useEffect(() => {
    if (location.pathname === '/news') {
      api.markAllNewsSeen().then(() => setNewsCount(0))
    }
  }, [location.pathname])

  // Globale Tastenkürzel (seitenspezifische stehen in der jeweiligen Seite)
  useTasten(e => {
    if (istTippen(e) || overlayOffen() || e.ctrlKey || e.metaKey || e.altKey) return
    const ziel = ({ '1': '/', '2': '/einpflegen', '3': '/news', n: '/einpflegen', s: '/statistiken' } as Record<string, string>)[e.key.toLowerCase()]
    if (ziel && location.pathname !== ziel) { e.preventDefault(); navigate(ziel) }
    else if (e.key === 'Escape' && ['/einpflegen', '/news', '/statistiken', '/einstellungen'].includes(location.pathname)) navigate('/')
  })

  return (
    <div className="app">
      <header className="top-bar">
        <h1 className="app-title">Anime & Manga Tracker</h1>
        <div className="top-actions">
          {location.pathname !== '/' && (
            <NavLink to="/" end className="icon-btn" title="Zur Liste (Esc)" aria-label="Zur Liste">
              🏠
            </NavLink>
          )}
          <NavLink to="/statistiken" className="icon-btn" title="Statistiken (S)" aria-label="Statistiken">
            📊
          </NavLink>
          <NavLink to="/einstellungen" className="icon-btn" title="Einstellungen" aria-label="Einstellungen">
            ⚙️
          </NavLink>
        </div>
      </header>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<ListePage />} />
          <Route path="/einpflegen" element={<EinpflegenPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/einstellungen" element={<EinstellungenPage />} />
          <Route path="/detail/:id" element={<DetailPageNeu />} />
          <Route path="/statistiken" element={<StatistikPage />} />
        </Routes>
      </main>

      <AchievementToast />
      <SerienToast />
      <Meldungen />

      {showNav && (
        <nav className="bottom-nav" aria-label="Hauptnavigation">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} title="Liste (1)">
            <span className="nav-icon" aria-hidden="true">📋</span>
            <span>Liste</span>
          </NavLink>
          <NavLink to="/einpflegen" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} title="Einpflegen (2 oder N)">
            <span className="nav-icon" aria-hidden="true">➕</span>
            <span>Einpflegen</span>
          </NavLink>
          <NavLink to="/news" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} title="News (3)"
            aria-label={newsCount > 0 ? `News, ${newsCount} neu` : 'News'}>
            <span className="nav-icon" aria-hidden="true">
              📰{newsCount > 0 && <span className="nav-badge">{newsCount > 99 ? '99+' : newsCount}</span>}
            </span>
            <span>News</span>
          </NavLink>
        </nav>
      )}
    </div>
  )
}
