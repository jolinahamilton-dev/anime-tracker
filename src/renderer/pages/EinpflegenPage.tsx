import { useState } from 'react'
import AniListSuche from '../components/AniListSuche'
import ManuelleEingabe from '../components/ManuelleEingabe'
import EintragVorschau from '../components/EintragVorschau'
import { AniListSearchResult } from '../../types'
import './Page.css'
import './EinpflegenPage.css'

type Tab = 'suche' | 'manuell'

export default function EinpflegenPage() {
  const [tab, setTab] = useState<Tab>('suche')
  const [ausgewaehlt, setAusgewaehlt] = useState<AniListSearchResult | null>(null)

  if (ausgewaehlt) {
    return (
      <EintragVorschau
        data={ausgewaehlt}
        onZurueck={() => setAusgewaehlt(null)}
      />
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Einpflegen</h2>
      </div>

      <div className="tab-bar">
        <button
          className={tab === 'suche' ? 'tab active' : 'tab'}
          onClick={() => setTab('suche')}
        >
          AniList-Suche
        </button>
        <button
          className={tab === 'manuell' ? 'tab active' : 'tab'}
          onClick={() => setTab('manuell')}
        >
          Manuelle Eingabe
        </button>
      </div>

      <div className="tab-content">
        {tab === 'suche' ? (
          <AniListSuche onAuswaehlen={setAusgewaehlt} />
        ) : (
          <ManuelleEingabe />
        )}
      </div>
    </div>
  )
}
