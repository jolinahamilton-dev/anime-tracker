import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AniListSuche from '../components/AniListSuche'
import ManuelleEingabe from '../components/ManuelleEingabe'
import EintragVorschau from '../components/EintragVorschau'
import Vorschlaege, { meldeHinzugefuegt, vorschlagErledigt } from '../components/Vorschlaege'
import { AniListSearchResult } from '../../types'
import { einpflegenSitzung, EinpflegenTab } from '../einpflegenZustand'
import './Page.css'
import './EinpflegenPage.css'

const TABS: Array<{ key: EinpflegenTab; label: string }> = [
  { key: 'suche', label: 'AniList-Suche' },
  { key: 'manuell', label: 'Manuelle Eingabe' },
  { key: 'fuerdich', label: '✨ Für dich' },
]

export default function EinpflegenPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<EinpflegenTab>(einpflegenSitzung.tab)
  // Die Vorschau ersetzt die Suche bzw. die Vorschläge (die Komponente wird dabei ausgehängt) –
  // Suchbegriff, Treffer & Scrollposition liegen deshalb in einpflegenSitzung / vorschlagSitzung
  const [ausgewaehlt, setAusgewaehlt] = useState<AniListSearchResult | null>(null)

  useEffect(() => { einpflegenSitzung.tab = tab }, [tab])

  if (ausgewaehlt) {
    // Aus „✨ Für dich“: „Geplant“ vorausgewählt, danach zurück zu den Vorschlägen statt zur Liste
    const ausVorschlag = tab === 'fuerdich'
    return (
      <EintragVorschau
        data={ausgewaehlt}
        onZurueck={() => setAusgewaehlt(null)}
        startStatus={ausVorschlag ? 'planned' : undefined}
        onHinzugefuegt={ausVorschlag ? (entry, schonVorhanden) => {
          vorschlagErledigt(ausgewaehlt.id)
          setAusgewaehlt(null)
          meldeHinzugefuegt(entry, schonVorhanden, navigate)
        } : undefined}
      />
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Einpflegen</h2>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab active' : 'tab'}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'suche' ? (
          <AniListSuche onAuswaehlen={setAusgewaehlt} />
        ) : tab === 'manuell' ? (
          <ManuelleEingabe />
        ) : (
          <Vorschlaege onAuswaehlen={setAusgewaehlt} />
        )}
      </div>
    </div>
  )
}
