import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import './Page.css'
import './EinstellungenPage.css'
import { api, kann, istHandyApp } from '../api'
import SyncBereich from '../components/SyncBereich'

type ExportFormat = 'csv' | 'excel' | 'pdf'

const ALLE_STATUS = [
  { key: 'started', label: 'Angefangen' },
  { key: 'ongoing', label: 'Laufend' },
  { key: 'completed', label: 'Beendet' },
  { key: 'planned', label: 'Geplant' },
  { key: 'paused', label: 'Pausiert' },
  { key: 'dropped', label: 'Abgebrochen' },
]

const ALLE_FELDER = [
  { key: 'title', label: 'Titel' },
  { key: 'type', label: 'Typ' },
  { key: 'genres', label: 'Genre' },
  { key: 'status', label: 'Status' },
  { key: 'rating', label: 'Bewertung' },
  { key: 'progress_episodes', label: 'Folgen (aktuell)' },
  { key: 'total_episodes', label: 'Folgen (gesamt)' },
  { key: 'progress_chapters', label: 'Kapitel (aktuell)' },
  { key: 'total_chapters', label: 'Kapitel (gesamt)' },
  { key: 'anilist_id', label: 'AniList-ID (für Import)' },
  { key: 'rewatch_count', label: 'Wiederholungen' },
]

const KUERZEL: Array<[string, string]> = [
  ['1 / 2 / 3', 'Liste / Einpflegen / News'],
  ['N', 'Neuen Eintrag einpflegen'],
  ['S', 'Statistiken'],
  ['Strg + F  oder  /', 'In der Liste suchen'],
  ['Tab, Enter', 'Karten durchgehen und öffnen'],
  ['+', 'Auf einer Karte oder in der Detailansicht: eine Folge/ein Kapitel weiter'],
  ['−', 'In der Detailansicht: eine Folge/ein Kapitel zurück'],
  ['← / →', 'In der Detailansicht: vorheriger/nächster Eintrag'],
  ['Esc', 'Zurück zur Liste bzw. Fenster schließen'],
]

const VORAUSWAHL_FARBEN = [
  '#e85d8a', '#a259ff', '#4a9eff', '#4adb6f',
  '#ff6b35', '#ffcc00', '#00c9b1', '#ff4757',
]

export default function EinstellungenPage() {
  const navigate = useNavigate()
  const { settings, speichern } = useSettings()

  const [importLaeuft, setImportLaeuft] = useState(false)
  const [importMeldung, setImportMeldung] = useState('')

  const [abgleichLaeuft, setAbgleichLaeuft] = useState(false)
  const [abgleichFortschritt, setAbgleichFortschritt] = useState<{ aktuell: number; gesamt: number; titel: string } | null>(null)
  const [abgleichMeldung, setAbgleichMeldung] = useState('')
  const [nichtGefunden, setNichtGefunden] = useState<string[]>([])

  useEffect(() => {
    return api.onAbgleichFortschritt(setAbgleichFortschritt)
  }, [])

  async function startAbgleich() {
    setAbgleichLaeuft(true)
    setAbgleichMeldung('')
    setNichtGefunden([])
    setAbgleichFortschritt(null)
    try {
      const result = await api.abgleichAniList()
      if (result.laeuftBereits) {
        setAbgleichMeldung('Abgleich läuft bereits.')
      } else if (result.success) {
        const teile = [`✅ ${result.aktualisiert} Einträge mit AniList verknüpft`]
        if (result.nichtGefunden.length > 0) teile.push(`${result.nichtGefunden.length} nicht gefunden`)
        if (result.fehler.length > 0) teile.push(`${result.fehler.length} Fehler`)
        setAbgleichMeldung(teile.join(' · '))
        setNichtGefunden([...result.nichtGefunden, ...result.fehler])
      }
    } catch {
      setAbgleichMeldung('❌ Abgleich fehlgeschlagen. Internetverbindung prüfen.')
    } finally {
      setAbgleichLaeuft(false)
      setAbgleichFortschritt(null)
    }
  }

  async function startImport() {
    setImportLaeuft(true)
    setImportMeldung('')
    let importiert = 0
    try {
      const result = await api.importCsv()
      if (result.abgebrochen) {
        setImportMeldung('')
      } else if (result.success) {
        importiert = result.importiert
        const teile = [`✅ ${result.importiert} Einträge importiert`]
        if (result.uebersprungen > 0) teile.push(`${result.uebersprungen} übersprungen (Duplikat)`)
        if (result.fehler?.length > 0) teile.push(`${result.fehler.length} Fehler`)
        setImportMeldung(teile.join(' · '))
      } else {
        setImportMeldung('❌ Import fehlgeschlagen.')
      }
    } catch (e) {
      setImportMeldung('❌ Import fehlgeschlagen.')
    } finally {
      setImportLaeuft(false)
    }
    // Importierte Einträge haben noch keine Cover/AniList-Verknüpfung → direkt nachladen
    if (importiert > 0) await startAbgleich()
  }

  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
  const [exportFelder, setExportFelder] = useState<string[]>(['title', 'type', 'status', 'rating', 'anilist_id'])
  const [exportStatus, setExportStatus] = useState<string[]>(['started', 'ongoing', 'completed', 'planned'])
  const [exportLaeuft, setExportLaeuft] = useState(false)
  const [exportMeldung, setExportMeldung] = useState('')

  function toggleFeld(key: string) {
    setExportFelder(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  function toggleStatus(key: string) {
    setExportStatus(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  async function startExport() {
    if (exportFelder.length === 0) {
      setExportMeldung('Bitte mindestens ein Feld auswählen.')
      return
    }
    if (exportStatus.length === 0) {
      setExportMeldung('Bitte mindestens einen Status auswählen.')
      return
    }
    setExportLaeuft(true)
    setExportMeldung('')
    try {
      const result = await api.exportStarten({
        format: exportFormat,
        felder: exportFelder,
        statusFilter: exportStatus,
      })
      if (result.success) {
        setExportMeldung(`✅ Exportiert: ${result.pfad}`)
      } else {
        setExportMeldung('Export abgebrochen.')
      }
    } catch (e) {
      setExportMeldung('❌ Export fehlgeschlagen.')
    } finally {
      setExportLaeuft(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>← Zurück</button>
        <h2>Einstellungen</h2>
      </div>

      <div className="einstellungen-inhalt">

        {/* Darstellung */}
        <section className="einstell-section">
          <h3 className="section-titel">Darstellung</h3>

          <div className="einstell-zeile">
            <div className="einstell-info">
              <span className="einstell-label">Dark Mode</span>
              <span className="einstell-sub">Dunkles Erscheinungsbild</span>
            </div>
            <button
              className={settings.darkMode ? 'toggle aktiv' : 'toggle'}
              onClick={() => speichern({ darkMode: !settings.darkMode })}
            >
              <span className="toggle-knopf" />
            </button>
          </div>

          <div className="einstell-zeile einstell-zeile--top">
            <div className="einstell-info">
              <span className="einstell-label">Akzentfarbe</span>
              <span className="einstell-sub">Hauptfarbe der App</span>
            </div>
            <div className="farb-picker">
              <div className="farb-vorauswahl">
                {VORAUSWAHL_FARBEN.map(f => (
                  <button
                    key={f}
                    className={settings.akzentfarbe === f ? 'farb-btn aktiv' : 'farb-btn'}
                    style={{ background: f }}
                    onClick={() => speichern({ akzentfarbe: f })}
                    title={f}
                  />
                ))}
              </div>
              <div className="farb-custom">
                <label className="einstell-sub">Eigene Farbe:</label>
                <input
                  type="color"
                  value={settings.akzentfarbe}
                  onChange={e => speichern({ akzentfarbe: e.target.value })}
                  className="color-input"
                />
                <span className="einstell-sub">{settings.akzentfarbe}</span>
              </div>
            </div>
          </div>
        </section>

        <SyncBereich />

        {/* Tastenkürzel (nicht am Handy) */}
        {!istHandyApp && <section className="einstell-section">
          <h3 className="section-titel">Tastenkürzel</h3>
          <dl className="kuerzel-liste">
            {KUERZEL.map(([taste, wirkung]) => (
              <div key={taste} className="kuerzel-zeile">
                <dt><kbd>{taste}</kbd></dt>
                <dd>{wirkung}</dd>
              </div>
            ))}
          </dl>
        </section>}

        {/* Import */}
        {kann.dateien && <section className="einstell-section">
          <h3 className="section-titel">Import</h3>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            Importiere Einträge aus einer CSV-Datei (z.&thinsp;B. zuvor exportiert). Bestehende Einträge
            mit gleichem Titel und Typ werden übersprungen.
          </p>
          {importMeldung && (
            <p className={importMeldung.startsWith('✅') ? 'export-ok' : 'fehler-text'} style={{ marginBottom: 10 }}>
              {importMeldung}
            </p>
          )}
          <button
            className="btn-primary"
            onClick={startImport}
            disabled={importLaeuft}
          >
            {importLaeuft ? 'Wird importiert…' : '⬆ CSV importieren'}
          </button>
        </section>}

        {/* AniList-Abgleich */}
        <section className="einstell-section">
          <h3 className="section-titel">Mit AniList abgleichen</h3>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            Sucht für Einträge ohne Cover (z.&thinsp;B. aus einem CSV-Import) den passenden AniList-Eintrag
            und lädt Cover, Genres und Beschreibung nach. Status, Fortschritt und Bewertung bleiben erhalten.
            Wegen des AniList-Limits dauert das ca. 2 Sekunden pro Eintrag.
          </p>
          {abgleichFortschritt && (
            <p className="einstell-sub" style={{ marginBottom: 10 }}>
              {abgleichFortschritt.aktuell} / {abgleichFortschritt.gesamt}: {abgleichFortschritt.titel}
            </p>
          )}
          {abgleichMeldung && (
            <p className={abgleichMeldung.startsWith('✅') ? 'export-ok' : 'fehler-text'} style={{ marginBottom: 10 }}>
              {abgleichMeldung}
            </p>
          )}
          {nichtGefunden.length > 0 && (
            <details style={{ marginBottom: 10 }}>
              <summary className="einstell-sub">Nicht zugeordnet – bitte manuell prüfen ({nichtGefunden.length})</summary>
              <ul className="einstell-sub">
                {nichtGefunden.map(t => <li key={t}>{t}</li>)}
              </ul>
            </details>
          )}
          <button
            className="btn-primary"
            onClick={startAbgleich}
            disabled={abgleichLaeuft || importLaeuft}
          >
            {abgleichLaeuft ? 'Wird abgeglichen…' : '🔄 Jetzt abgleichen'}
          </button>
        </section>

        {/* Export */}
        {kann.dateien && <section className="einstell-section">
          <h3 className="section-titel">Export</h3>

          <div className="einstell-zeile">
            <span className="einstell-label">Format</span>
            <div className="status-buttons">
              {(['csv', 'excel', 'pdf'] as ExportFormat[]).map(f => (
                <button
                  key={f}
                  className={exportFormat === f ? 'filter-btn active' : 'filter-btn'}
                  onClick={() => setExportFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="einstell-zeile einstell-zeile--top">
            <span className="einstell-label">Felder</span>
            <div className="felder-liste">
              {ALLE_FELDER.map(({ key, label }) => (
                <label key={key} className="feld-checkbox">
                  <input
                    type="checkbox"
                    checked={exportFelder.includes(key)}
                    onChange={() => toggleFeld(key)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="einstell-zeile einstell-zeile--top">
            <span className="einstell-label">Status</span>
            <div className="felder-liste">
              {ALLE_STATUS.map(({ key, label }) => (
                <label key={key} className="feld-checkbox">
                  <input
                    type="checkbox"
                    checked={exportStatus.includes(key)}
                    onChange={() => toggleStatus(key)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {exportMeldung && (
            <p className={exportMeldung.startsWith('✅') ? 'export-ok' : 'fehler-text'}>
              {exportMeldung}
            </p>
          )}

          <button
            className="btn-primary"
            onClick={startExport}
            disabled={exportLaeuft || exportFelder.length === 0}
          >
            {exportLaeuft ? 'Wird exportiert…' : '⬇ Export starten'}
          </button>
        </section>}

      </div>
    </div>
  )
}
