import { useCallback, useEffect, useState } from 'react'
import './AchievementBereich.css'
import { api } from '../api'
import { useBeiAenderung } from '../aktionen'
import type { AchievementTrackInfo, AchievementUebersicht } from '../../types'

const STUFEN = ['Bronze', 'Silber', 'Gold', 'Platin', 'Diamant']
const zahl = (n: number) => n.toLocaleString('de-DE')
const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE')

/** Medaille in der Farbe der Stufe (0 = noch keine → grau) mit dem Symbol des Tracks */
export function Medaille({ stufe, icon, groesse = 'normal' }: { stufe: number; icon: string; groesse?: 'klein' | 'normal' | 'gross' }) {
  return (
    <span className={`ach-medaille ach-${groesse} ach-s${stufe}`} aria-hidden="true">
      <span className="ach-medaille-icon">{icon}</span>
    </span>
  )
}

function Track({ t, offen, umschalten }: { t: AchievementTrackInfo; offen: boolean; umschalten: () => void }) {
  const ziel = t.naechste?.schwelle ?? t.stufen[t.stufen.length - 1].schwelle
  const anteil = t.naechste ? Math.min(1, t.wert / ziel) : 1
  const stufenName = t.erreicht ? STUFEN[t.erreicht - 1] : 'Noch keine Stufe'
  return (
    <div className={`ach-track${t.erreicht ? '' : ' ach-gesperrt'}${offen ? ' ach-offen' : ''}`}>
      <button type="button" className="ach-track-kopf" onClick={umschalten} aria-expanded={offen}
        aria-label={`${t.name}: ${stufenName}, ${zahl(t.wert)} ${t.einheit}${t.naechste ? `, nächste Stufe ${t.naechste.name} bei ${zahl(ziel)}` : ''}`}>
        <Medaille stufe={t.erreicht} icon={t.icon} />
        <span className="ach-track-info">
          <span className="ach-track-zeile">
            <span className="ach-track-name">{t.name}</span>
            {t.erreicht > 0 && <span className={`ach-stufe-text ach-t${t.erreicht}`}>{stufenName}</span>}
          </span>
          <span className="ach-balken" aria-hidden="true">
            <span className={`ach-balken-fuellung ach-b${t.naechste ? t.naechste.nr : 5}`} style={{ width: `${Math.round(anteil * 100)}%` }} />
          </span>
          <span className="ach-track-zeile ach-klein">
            <span>
              {t.naechste
                ? <>{zahl(t.wert)} / {zahl(ziel)} {t.einheit}</>
                : <>{zahl(t.wert)} {t.einheit} · alle Stufen erreicht</>}
            </span>
            <span className="ach-punkte" aria-hidden="true">
              {t.stufen.map(s => <span key={s.id} className={s.unlocked_at ? `ach-punkt ach-p${s.nr}` : 'ach-punkt'} />)}
            </span>
          </span>
          {t.zusatz && <span className="ach-zusatz">{t.zusatz}</span>}
        </span>
      </button>
      {offen && (
        <ol className="ach-stufen">
          {t.stufen.map(s => (
            <li key={s.id} className={s.unlocked_at ? 'ach-stufe frei' : 'ach-stufe'}>
              <Medaille stufe={s.unlocked_at ? s.nr : 0} icon={s.unlocked_at ? t.icon : '🔒'} groesse="klein" />
              <span className="ach-stufe-info">
                <span className={`ach-stufe-name${s.unlocked_at ? ` ach-t${s.nr}` : ''}`}>{s.name}</span>
                <span className="ach-stufe-beschreibung">{s.beschreibung}</span>
              </span>
              <span className="ach-stufe-datum">{s.unlocked_at ? datum(s.unlocked_at) : `${zahl(Math.min(t.wert, s.schwelle))} / ${zahl(s.schwelle)}`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function AchievementBereich() {
  const [daten, setDaten] = useState<AchievementUebersicht | null>(null)
  const [fehler, setFehler] = useState(false)
  const [offen, setOffen] = useState<string | null>(null)

  const laden = useCallback(() => {
    api.getAchievements()
      .then(d => { setDaten(d); setFehler(false) })
      .catch(e => { console.error(e); setFehler(true) })
  }, [])

  useEffect(() => { laden() }, [laden])
  useBeiAenderung(laden)
  useEffect(() => api.onSerienAktualisiert(laden), [laden])
  useEffect(() => api.onAchievementNeu(laden), [laden])

  if (fehler && !daten) return <p className="empty-hint">Achievements konnten nicht geladen werden.</p>
  if (!daten) return <p className="empty-hint">Achievements werden geladen…</p>

  // Medaillenspiegel: wie viele Tracks stehen auf welcher Stufe
  const spiegel = STUFEN.map((_, i) => daten.tracks.filter(t => t.erreicht === i + 1).length)
  const einzelnFrei = daten.einzeln.filter(a => a.unlocked_at).length

  return (
    <div className="ach-bereich">
      <div className="ach-kopfzeile">
        <span className="ach-zaehler"><strong>{daten.freigeschaltet}</strong> / {daten.gesamt} freigeschaltet</span>
        <span className="ach-spiegel" aria-label="Höchste Stufe je Track">
          {spiegel.map((n, i) => n > 0 && (
            <span key={i} className="ach-spiegel-eintrag" title={`${n}× ${STUFEN[i]}`}>
              <span className={`ach-punkt ach-p${i + 1}`} aria-hidden="true" />
              <span>{n}× {STUFEN[i]}</span>
            </span>
          ))}
        </span>
      </div>

      <div className="ach-tracks">
        {daten.tracks.map(t => (
          <Track key={t.id} t={t} offen={offen === t.id} umschalten={() => setOffen(o => o === t.id ? null : t.id)} />
        ))}
      </div>

      <h4 className="ach-unterkopf">Einzelne Meilensteine <span>{einzelnFrei}/{daten.einzeln.length}</span></h4>
      <div className="ach-einzeln">
        {daten.einzeln.map(a => (
          <div key={a.id} className={a.unlocked_at ? 'ach-einzel frei' : 'ach-einzel ach-gesperrt'}
            title={a.unlocked_at ? `Freigeschaltet: ${datum(a.unlocked_at)}` : a.beschreibung}>
            <span className="ach-einzel-icon" aria-hidden="true">{a.unlocked_at ? a.icon : '🔒'}</span>
            <span className="ach-einzel-info">
              <span className="ach-einzel-name">{a.name}</span>
              <span className="ach-einzel-beschreibung">{a.beschreibung}</span>
              {a.unlocked_at && <span className="ach-einzel-datum">{datum(a.unlocked_at)}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
