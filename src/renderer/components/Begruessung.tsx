import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, istHandyApp } from '../api'
import './Begruessung.css'

// Einmal beim allerersten Start (leere Liste, kein Abgleich): mit Google anmelden oder ohne Konto loslegen
export default function Begruessung({ onFertig }: { onFertig: () => void }) {
  const navigate = useNavigate()
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const geraet = istHandyApp ? 'diesem Handy' : 'diesem PC'

  async function mitGoogle() {
    setBeschaeftigt(true)
    await api.startMerke('willkommen')
    // Handy: leitet zu Google weiter und kommt in den Einstellungen zurück (Passwort-Schritt).
    // PC: Anmeldung im Browser, danach geht es in den Einstellungen weiter.
    await api.syncVerbinden()
    setBeschaeftigt(false)
    onFertig()
    navigate('/einstellungen')
  }

  async function ohneKonto() {
    await api.startMerke('willkommen')
    onFertig()
  }

  return (
    <div className="begruessung" role="dialog" aria-modal="true" aria-labelledby="begruessung-titel">
      <div className="begruessung-karte">
        <div className="begruessung-logo" aria-hidden="true">📺📚</div>
        <h2 id="begruessung-titel">Willkommen beim Anime&nbsp;Tracker</h2>
        <p className="begruessung-text">
          Behalte den Überblick über deine Anime und Manga: Fortschritt, Bewertungen, eigene Listen und neue Folgen.
        </p>

        <button className="begruessung-wahl begruessung-wahl--haupt" onClick={mitGoogle} disabled={beschaeftigt}>
          <span className="begruessung-wahl-titel">{beschaeftigt ? 'Warte auf Google …' : '☁ Mit Google anmelden'}</span>
          <span className="begruessung-wahl-text">
            Deine Liste wird automatisch und verschlüsselt in deinem eigenen Google Drive gesichert –
            so ist sie auch auf einem neuen Handy oder am PC wieder da.
          </span>
        </button>

        <button className="begruessung-wahl" onClick={ohneKonto} disabled={beschaeftigt}>
          <span className="begruessung-wahl-titel">Ohne Konto starten</span>
          <span className="begruessung-wahl-text">
            Die Liste wird nur auf {geraet} gespeichert. Anmelden kannst du dich später jederzeit in den Einstellungen.
          </span>
        </button>

        <p className="begruessung-fuss">
          Die App sieht nur ihren eigenen, versteckten Ordner in deinem Drive – nicht deine Dateien.{' '}
          <a href={istHandyApp ? './datenschutz.html' : 'https://jolinahamilton-dev.github.io/anime-tracker/datenschutz.html'}
            target="_blank" rel="noopener noreferrer">Datenschutz</a>
        </p>
      </div>
    </div>
  )
}
