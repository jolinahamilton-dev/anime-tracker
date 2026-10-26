import { useEffect, useState } from 'react'
import { api, istHandyApp, SyncStatus } from '../api'
import { bestaetigen, snackbar } from '../meldungen'
import { meldeAenderung } from '../aktionen'
import { MIN_PASSWORT } from '../../sync/krypto'

// Einstellungen → Abgleich zwischen PC und Handy über Google Drive (gleich auf beiden Geräten)
export default function SyncBereich() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [passwort, setPasswort] = useState('')
  const [zeigen, setZeigen] = useState(false)
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const [meldung, setMeldung] = useState('')

  useEffect(() => { api.syncStatus().then(setStatus) }, [])
  // Während ein Abgleich läuft, Stand nachladen
  useEffect(() => {
    if (!status?.laeuft) return
    const t = setInterval(() => api.syncStatus().then(setStatus), 1500)
    return () => clearInterval(t)
  }, [status?.laeuft])

  async function verbinden() {
    setBeschaeftigt(true); setMeldung('')
    if (!istHandyApp) setMeldung('Im Browser bei Google anmelden und „Zulassen" klicken …')
    setStatus(await api.syncVerbinden()) // Handy: leitet zu Google weiter
    setBeschaeftigt(false); setMeldung('')
  }

  async function passwortSetzen() {
    setBeschaeftigt(true); setMeldung('')
    const r = await api.syncPasswort(passwort)
    setBeschaeftigt(false)
    if (!r.ok) { setMeldung('❌ ' + r.fehler); return }
    setPasswort('')
    snackbar(r.neu ? 'Abgleich eingerichtet – deine Liste liegt jetzt verschlüsselt in Google Drive' : 'Passwort stimmt – deine Liste wurde übernommen')
    setStatus(await api.syncStatus())
    meldeAenderung()
  }

  async function jetzt() {
    setBeschaeftigt(true)
    const s = await api.syncJetzt()
    setStatus(s); setBeschaeftigt(false)
    if (!s.fehler) { snackbar('Abgeglichen ✓'); meldeAenderung() }
  }

  async function trennen() {
    const ja = await bestaetigen('Abgleich trennen?', {
      text: 'Die Daten auf diesem Gerät bleiben erhalten. Zum erneuten Verbinden brauchst du wieder dein Abgleich-Passwort.',
      ok: 'Trennen', gefahr: true,
    })
    if (ja) setStatus(await api.syncTrennen())
  }

  if (!status) return null
  const anderes = istHandyApp ? 'PC' : 'Handy'
  const abgelaufen = status.fehler?.includes('abgelaufen')

  return (
    <section className="einstell-section">
      <h3 className="section-titel">Abgleich mit dem {anderes}</h3>

      {!status.verbunden || abgelaufen ? (
        <>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            {abgelaufen
              ? 'Die Anmeldung bei Google ist abgelaufen.'
              : `PC und Handy gleichen deine Liste über einen versteckten App-Ordner in deinem Google Drive ab – verschlüsselt, auch wenn das andere Gerät aus ist. Die App sieht nur diesen Ordner, nicht deine Dateien.`}
          </p>
          <button className="btn-primary" onClick={verbinden} disabled={beschaeftigt}>
            {beschaeftigt ? 'Warte auf Google …' : abgelaufen ? '🔄 Neu verbinden' : '☁ Mit Google Drive verbinden'}
          </button>
        </>
      ) : !status.passwortGesetzt ? (
        <>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            ✅ Mit Google Drive verbunden. Jetzt das <strong>Abgleich-Passwort</strong>: Auf dem ersten Gerät legst du es fest,
            auf dem {anderes} gibst du später <strong>dasselbe</strong> ein. Damit wird alles verschlüsselt – ohne das Passwort
            kann niemand die Daten lesen, auch Google nicht. <strong>Gut merken</strong> (mind. {MIN_PASSWORT} Zeichen).
          </p>
          <div className="sync-passwort">
            <input
              type={zeigen ? 'text' : 'password'}
              value={passwort}
              onChange={e => setPasswort(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && passwort.length >= MIN_PASSWORT) passwortSetzen() }}
              placeholder="Abgleich-Passwort"
              autoComplete="new-password"
              aria-label="Abgleich-Passwort"
            />
            <button className="dialog-btn" onClick={() => setZeigen(!zeigen)} aria-label={zeigen ? 'Passwort verbergen' : 'Passwort zeigen'}>
              {zeigen ? '🙈' : '👁'}
            </button>
          </div>
          <button className="btn-primary" style={{ marginTop: 10 }} onClick={passwortSetzen} disabled={beschaeftigt || passwort.length < MIN_PASSWORT}>
            {beschaeftigt ? 'Wird eingerichtet …' : 'Abgleich starten'}
          </button>
        </>
      ) : (
        <>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            ✅ Abgleich aktiv – automatisch beim Start und alle 5 Minuten.
            {status.letzterAbgleich && <> Zuletzt: {new Date(status.letzterAbgleich).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.</>}
          </p>
          <div className="sync-knoepfe">
            <button className="btn-primary" onClick={jetzt} disabled={beschaeftigt || status.laeuft}>
              {beschaeftigt || status.laeuft ? 'Gleicht ab …' : '🔄 Jetzt abgleichen'}
            </button>
            <button className="dialog-btn" onClick={trennen}>Trennen</button>
          </div>
        </>
      )}

      {status.fehler && !abgelaufen && <p className="fehler-text" style={{ marginTop: 10 }}>❌ {status.fehler}</p>}
      {meldung && <p className={meldung.startsWith('❌') ? 'fehler-text' : 'einstell-sub'} style={{ marginTop: 10 }}>{meldung}</p>}
    </section>
  )
}
