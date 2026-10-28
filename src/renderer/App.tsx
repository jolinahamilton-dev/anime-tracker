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
import Begruessung from './components/Begruessung'
import { snackbar } from './meldungen'
import { useState, useEffect } from 'react'
import { useSettings } from './hooks/useSettings'
import { logoBild, useLogo } from './logos'
import './installieren' // fängt das Installationsangebot des Browsers früh ab
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
  const logo = useLogo()
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

  // Erster Start → Begrüßung; sonst ohne Cloud-Sicherung alle 14 Tage an eine Sicherungsdatei erinnern
  const [begruessung, setBegruessung] = useState(false)
  useEffect(() => {
    Promise.all([api.startInfo(), api.syncStatus()]).then(([info, sync]) => {
      if (!info.willkommenGesehen && info.eintraege === 0 && !sync.verbunden) { setBegruessung(true); return }
      if (sync.passwortGesetzt || info.eintraege < 5) return
      const tage = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity
      if (tage(info.letzteSicherung ?? info.ersterStart) < 14 || tage(info.erinnertAm) < 7) return
      api.startMerke('erinnert')
      snackbar(info.letzteSicherung
        ? `Letzte Sicherung vor ${Math.floor(tage(info.letzteSicherung))} Tagen – deine Liste liegt nur auf diesem Gerät.`
        : 'Deine Liste liegt nur auf diesem Gerät – lege eine Sicherung an oder melde dich mit Google an.',
        { label: 'Sichern', ausfuehren: () => navigate('/einstellungen') }, 12_000)
    }).catch(console.error)
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
        {/* Logo und Name führen von jeder Seite zurück zur Liste */}
        <h1 className="app-title">
          <NavLink to="/" end className="app-title-link" title="Zur Liste (Esc)">
            <img src={logoBild(logo)} alt="" className="app-logo" />
            <span>Anime & Manga Tracker</span>
          </NavLink>
        </h1>
        <div className="top-actions">
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

      {begruessung && <Begruessung onFertig={() => setBegruessung(false)} />}

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
