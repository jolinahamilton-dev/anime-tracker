import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import { LOGOS, logoBild } from '../logos'
import { installieren, useInstallierbar } from '../installieren'
import './Page.css'
import './EinstellungenPage.css'
import { api, kann, istHandyApp, SicherungInfo, LokaleKopie } from '../api'
import SyncBereich from '../components/SyncBereich'
import { bestaetigen, snackbar } from '../meldungen'

/** Merkt sich über das Neuladen hinweg, dass gerade wiederhergestellt wurde (für den Hinweis mit „Rückgängig“) */
const NACH_WIEDERHERSTELLUNG = 'nach-wiederherstellung'

const datumZeit = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const anzahl = (n: number) => `${n} ${n === 1 ? 'Eintrag' : 'Einträge'}`

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
  const installierbar = useInstallierbar()

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

  const [sicherungLaeuft, setSicherungLaeuft] = useState(false)
  const [sicherungMeldung, setSicherungMeldung] = useState('')

  async function sicherungErstellen() {
    setSicherungLaeuft(true)
    setSicherungMeldung('')
    try {
      const r = await api.sicherungErstellen()
      if (r.success) setSicherungMeldung(`✅ Gespeichert: ${r.pfad}`)
    } catch {
      setSicherungMeldung('❌ Sicherung fehlgeschlagen.')
    } finally {
      setSicherungLaeuft(false)
    }
  }

  // Stand vor der letzten Wiederherstellung (Sicherheitskopie) und – nur Handy – automatische Kopien
  const [vorher, setVorher] = useState<SicherungInfo | null>(null)
  const [kopien, setKopien] = useState<LokaleKopie[]>([])
  const [geladenAusKopie, setGeladenAusKopie] = useState<string | null>(null)

  useEffect(() => {
    api.sicherungVorher?.().then(setVorher).catch(() => {})
    api.lokaleKopien?.().then(r => { setKopien(r.kopien); setGeladenAusKopie(r.geladenAus) }).catch(() => {})
    // Nach dem Neuladen: Hinweis mit „Rückgängig“ (die Sicherheitskopie bleibt auch danach über den Knopf erreichbar)
    let nachricht: string | null = null
    try { nachricht = sessionStorage.getItem(NACH_WIEDERHERSTELLUNG); sessionStorage.removeItem(NACH_WIEDERHERSTELLUNG) } catch { /* egal */ }
    if (nachricht) snackbar(nachricht, { label: 'Rückgängig', ausfuehren: () => { zurueckholen(false) } }, 20000)
  }, [])

  /** Rückfrage mit dem Vergleich zum aktuellen Stand – eine falsche (alte) Sicherung soll sofort auffallen */
  function frageNachVergleich(titel: string, wovon: string, info: SicherungInfo, ok: string) {
    const teile = [`${wovon} vom ${datumZeit(info.erstellt)}: ${anzahl(info.eintraege)}, ${info.listen} Listen, ${info.achievements} Achievements.`]
    if (info.aktuell !== undefined) {
      teile.push(`Deine Liste hat jetzt ${anzahl(info.aktuell)}.`)
      if (info.fehlen) {
        const titelListe = info.fehlendeTitel?.length
          ? ` (${info.fehlendeTitel.join(', ')}${info.fehlen > info.fehlendeTitel.length ? ', …' : ''})` : ''
        teile.push(`⚠ ${anzahl(info.fehlen)} von jetzt ${info.fehlen === 1 ? 'fehlt' : 'fehlen'} darin und ${info.fehlen === 1 ? 'ginge' : 'gingen'} verloren${titelListe}.`)
      } else {
        teile.push('Kein jetziger Eintrag geht verloren.')
      }
      if (info.neu) teile.push(`${anzahl(info.neu)} ${info.neu === 1 ? 'käme' : 'kämen'} hinzu.`)
    }
    teile.push('Der aktuelle Stand wird ersetzt, lässt sich danach aber mit „Rückgängig“ zurückholen. ' +
      'Ist der Abgleich eingerichtet, übernimmt ihn auch das andere Gerät.')
    return bestaetigen(titel, { text: teile.join(' '), ok, gefahr: true })
  }

  /** Führt eine Wiederherstellung aus und lädt danach alle Seiten frisch (Hinweis mit „Rückgängig“ folgt) */
  async function stelleWiederHer(aktion: () => Promise<{ fehler?: string; info?: SicherungInfo }>, nachricht: string) {
    setSicherungLaeuft(true)
    setSicherungMeldung('')
    try {
      const r = await aktion()
      if (!r.info) { setSicherungMeldung(`❌ ${r.fehler ?? 'Wiederherstellen fehlgeschlagen.'}`); return }
      try { sessionStorage.setItem(NACH_WIEDERHERSTELLUNG, `${nachricht} (${anzahl(r.info.eintraege)})`) } catch { /* nur der Hinweis fehlt */ }
      // Alle Seiten frisch laden, damit überall der wiederhergestellte Stand zu sehen ist
      window.location.reload()
    } catch {
      setSicherungMeldung('❌ Wiederherstellen fehlgeschlagen – der bisherige Stand ist unverändert.')
    } finally {
      setSicherungLaeuft(false)
    }
  }

  async function sicherungWiederherstellen() {
    setSicherungMeldung('')
    // Dateiauswahl zuerst – am Handy darf sie nur direkt nach dem Tippen aufgehen
    const gewaehlt = await api.sicherungWaehlen()
    if (gewaehlt.abgebrochen) return
    if (!gewaehlt.info) { setSicherungMeldung(`❌ ${gewaehlt.fehler ?? 'Datei konnte nicht gelesen werden.'}`); return }
    if (!await frageNachVergleich('Sicherung wiederherstellen?', 'Sicherung', gewaehlt.info, 'Wiederherstellen')) return
    await stelleWiederHer(() => api.sicherungEinspielen(), 'Sicherung wiederhergestellt')
  }

  /** Stand vor der letzten Wiederherstellung zurückholen – aus dem Hinweis direkt, über den Knopf mit Rückfrage */
  async function zurueckholen(fragen: boolean) {
    if (fragen) {
      const info = await api.sicherungVorher()
      if (!info) { setVorher(null); setSicherungMeldung('❌ Es gibt keinen Stand vor einer Wiederherstellung.'); return }
      if (!await frageNachVergleich('Vorherigen Stand zurückholen?', 'Stand', info, 'Zurückholen')) return
    }
    await stelleWiederHer(() => api.sicherungZurueckholen(), 'Vorheriger Stand zurückgeholt')
  }

  async function kopieEinspielen(nr: number) {
    if (!api.lokaleKopiePruefen || !api.lokaleKopieEinspielen) return
    setSicherungMeldung('')
    const geprueft = await api.lokaleKopiePruefen(nr)
    if (!geprueft.info) { setSicherungMeldung(`❌ ${geprueft.fehler ?? 'Kopie konnte nicht gelesen werden.'}`); return }
    if (!await frageNachVergleich('Automatische Kopie einspielen?', 'Kopie', geprueft.info, 'Einspielen')) return
    await stelleWiederHer(() => api.lokaleKopieEinspielen!(nr), 'Automatische Kopie eingespielt')
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

          <div className="einstell-zeile einstell-zeile--top einstell-zeile--block">
            <div className="einstell-info">
              <span className="einstell-label">App-Logo</span>
              <span className="einstell-sub">
                {istHandyApp
                  ? 'Erscheint in der Kopfzeile und auf dem Startbildschirm, wenn du die App (neu) dort hinzufügst'
                  : 'Erscheint in der Kopfzeile, im Fenster, im Startmenü und in der Taskleiste (dort spätestens nach einem Neustart der App)'}
              </span>
            </div>
            <div className="logo-auswahl" role="radiogroup" aria-label="App-Logo">
              {LOGOS.map(l => (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={settings.logo === l.id}
                  className={settings.logo === l.id ? 'logo-btn aktiv' : 'logo-btn'}
                  onClick={() => speichern({ logo: l.id })}
                >
                  <img src={logoBild(l.id)} alt="" />
                  <span>{l.name}</span>
                </button>
              ))}
            </div>
            {istHandyApp && <div className="logo-handy-hinweis">
              {installierbar
                ? <button className="btn-secondary" onClick={installieren}>Mit diesem Logo zum Startbildschirm hinzufügen</button>
                : <p className="einstell-sub">
                    <strong>Startbildschirm:</strong> Ein neues Logo übernimmt das Handy nur beim Hinzufügen. Vorher
                    abgleichen oder sichern (beim Entfernen löscht das iPhone die Daten der App), dann die App entfernen
                    und im Browser neu zum Startbildschirm hinzufügen.
                  </p>}
            </div>}
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

        {/* Komplette Sicherung */}
        {kann.dateien && <section className="einstell-section">
          <h3 className="section-titel">Komplette Sicherung</h3>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            Speichert alles in einer Datei: Einträge mit Spitznamen, Bewertungen und Fortschritt, eigene Listen,
            Watch-Order, Achievements und den Stand der Statistik. Damit lässt sich die App auf jedem Gerät
            (PC oder Handy) genau so wiederherstellen.
          </p>
          {sicherungMeldung && (
            <p className={sicherungMeldung.startsWith('✅') ? 'export-ok' : 'fehler-text'} style={{ marginBottom: 10 }}>
              {sicherungMeldung}
            </p>
          )}
          <div className="sicherung-knoepfe">
            <button className="btn-primary" onClick={sicherungErstellen} disabled={sicherungLaeuft}>
              ⬇ Sicherung speichern
            </button>
            <button className="btn-secondary" onClick={sicherungWiederherstellen} disabled={sicherungLaeuft}>
              ⬆ Sicherung wiederherstellen
            </button>
          </div>

          {vorher && <div className="sicherung-vorher">
            <p className="einstell-sub">
              Vor jeder Wiederherstellung wird der bisherige Stand aufgehoben – zuletzt vom {datumZeit(vorher.erstellt)} ({anzahl(vorher.eintraege)}).
            </p>
            <button className="btn-secondary" onClick={() => zurueckholen(true)} disabled={sicherungLaeuft}>
              ↶ Stand vor der letzten Wiederherstellung zurückholen
            </button>
          </div>}

          {istHandyApp && <div className="sicherung-kopien">
            <span className="einstell-label">Automatische Kopien auf diesem Handy</span>
            <p className="einstell-sub">
              Höchstens eine pro Tag, die letzten drei werden aufbewahrt – auch ohne Abgleich. Ist der Speicher der App
              beschädigt, startet sie automatisch mit der neuesten Kopie.
            </p>
            {geladenAusKopie && (
              <p className="fehler-text">
                Der Speicher der App war beschädigt – geladen wurde die Kopie vom {datumZeit(geladenAusKopie)}.
                Änderungen danach fehlen eventuell (ist der Abgleich eingerichtet, kommen sie vom anderen Gerät zurück).
              </p>
            )}
            {kopien.length === 0
              ? <p className="einstell-sub">Noch keine Kopie vorhanden.</p>
              : <ul className="kopien-liste">
                  {kopien.map(k => (
                    <li key={k.nr} className="kopie-zeile">
                      <span>{datumZeit(k.erstellt)} · {anzahl(k.eintraege)}</span>
                      <button className="btn-secondary" onClick={() => kopieEinspielen(k.nr)} disabled={sicherungLaeuft}>
                        Einspielen
                      </button>
                    </li>
                  ))}
                </ul>}
          </div>}
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
