import { useEffect, useRef, useState } from 'react'
import { api, istHandyApp, SyncStatus } from '../api'
import { bestaetigen, snackbar } from '../meldungen'
import { meldeAenderung } from '../aktionen'
import { MIN_PASSWORT } from '../../sync/krypto'

// Einstellungen → Konto & Cloud-Sicherung: Anmeldung mit Google, Sicherung in Google Drive und
// Abgleich zwischen den Geräten (gleich auf PC und Handy, funktioniert auch mit nur einem Gerät)
export default function SyncBereich() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [passwort, setPasswort] = useState('')
  const [zeigen, setZeigen] = useState(false)
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const [meldung, setMeldung] = useState('')

  // undefined = noch nicht geprüft, null = Prüfung fehlgeschlagen
  const [konto, setKonto] = useState<{ konto: string | null; hatSicherung: boolean } | null | undefined>(undefined)
  const [speicherUnsicher, setSpeicherUnsicher] = useState(false)
  const bereichRef = useRef<HTMLElement>(null)

  useEffect(() => {
    api.syncStatus().then(setStatus)
    api.speicherDauerhaft?.().then(d => setSpeicherUnsicher(d === false))
  }, [])

  // Gerade angemeldet, Passwort fehlt noch: Konto prüfen und den Bereich ins Bild holen
  const passwortSchritt = !!status?.verbunden && !status.passwortGesetzt && !status.fehler?.includes('abgelaufen')
  useEffect(() => {
    if (!passwortSchritt) return
    bereichRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    api.syncKonto().then(k => {
      setKonto(k)
      api.syncStatus().then(setStatus)
    })
  }, [passwortSchritt])
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
    snackbar(r.neu ? 'Cloud-Sicherung eingerichtet – deine Liste liegt jetzt verschlüsselt in deinem Google Drive' : 'Passwort stimmt – deine Liste wurde übernommen')
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
    const ja = await bestaetigen('Von Google abmelden?', {
      text: 'Die Liste auf diesem Gerät und die Sicherung in Google Drive bleiben erhalten, es wird nur nicht mehr gesichert. ' +
        'Zum erneuten Anmelden brauchst du wieder dein Sicherungs-Passwort.',
      ok: 'Abmelden', gefahr: true,
    })
    if (ja) { setStatus(await api.syncTrennen()); setKonto(undefined) }
  }

  if (!status) return null
  const abgelaufen = status.fehler?.includes('abgelaufen')

  return (
    <section className="einstell-section" ref={bereichRef}>
      <h3 className="section-titel">Konto & Cloud-Sicherung</h3>

      {!status.verbunden || abgelaufen ? (
        <>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            {abgelaufen
              ? 'Die Anmeldung bei Google ist abgelaufen – dein Passwort bleibt gespeichert, nur neu anmelden.'
              : 'Melde dich mit deinem Google-Konto an: Deine Liste wird dann automatisch und verschlüsselt in einem versteckten ' +
                'App-Ordner in deinem eigenen Google Drive gesichert und zwischen deinen Geräten (Handy, PC) abgeglichen. ' +
                'Die App sieht nur diesen Ordner, nicht deine Dateien. Jede Person braucht ihr eigenes Google-Konto.'}
          </p>
          {!abgelaufen && speicherUnsicher && (
            <p className="einstell-sub hinweis-text" style={{ marginBottom: 10 }}>
              ⚠ Dieser Browser schützt die Daten nicht dauerhaft. Installiere die App auf dem Startbildschirm und nutze die
              Cloud-Sicherung oder speichere regelmäßig eine Sicherungsdatei.
            </p>
          )}
          <button className="btn-primary" onClick={verbinden} disabled={beschaeftigt}>
            {beschaeftigt ? 'Warte auf Google …' : abgelaufen ? '🔄 Neu anmelden' : '☁ Mit Google anmelden'}
          </button>
        </>
      ) : !status.passwortGesetzt ? (
        <>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            ✅ Angemeldet{status.konto && <> als <strong>{status.konto}</strong></>}.{' '}
            {konto === undefined
              ? 'Prüfe, ob es schon eine Sicherung gibt …'
              : konto === null
                ? <>Gib dein <strong>Sicherungs-Passwort</strong> ein – oder lege eins fest (mind. {MIN_PASSWORT} Zeichen),
                    wenn du die Cloud-Sicherung zum ersten Mal nutzt. Gut aufschreiben!</>
              : konto.hatSicherung
                ? <>In diesem Google-Konto liegt schon eine Sicherung. Gib dein <strong>Sicherungs-Passwort</strong> ein,
                    dann wird deine Liste übernommen und mit diesem Gerät zusammengeführt.</>
                : <>Lege jetzt ein <strong>Sicherungs-Passwort</strong> fest (mind. {MIN_PASSWORT} Zeichen). Damit wird alles
                    verschlüsselt – ohne das Passwort kann niemand die Daten lesen, auch Google nicht. Auf weiteren Geräten
                    gibst du <strong>dasselbe</strong> ein. <strong>Unbedingt aufschreiben</strong> – ohne Passwort lässt sich
                    die Sicherung nicht wiederherstellen.</>}
          </p>
          <div className="sync-passwort">
            <input
              type={zeigen ? 'text' : 'password'}
              value={passwort}
              onChange={e => setPasswort(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && passwort.length >= MIN_PASSWORT) passwortSetzen() }}
              placeholder="Sicherungs-Passwort"
              autoComplete={konto?.hatSicherung ? 'current-password' : 'new-password'}
              aria-label="Sicherungs-Passwort"
            />
            <button className="dialog-btn" onClick={() => setZeigen(!zeigen)} aria-label={zeigen ? 'Passwort verbergen' : 'Passwort zeigen'}>
              {zeigen ? '🙈' : '👁'}
            </button>
          </div>
          <button className="btn-primary" style={{ marginTop: 10 }} onClick={passwortSetzen} disabled={beschaeftigt || passwort.length < MIN_PASSWORT}>
            {beschaeftigt ? 'Wird eingerichtet …' : konto?.hatSicherung ? 'Sicherung übernehmen' : 'Sicherung starten'}
          </button>
        </>
      ) : (
        <>
          <p className="einstell-sub" style={{ marginBottom: 10 }}>
            ✅ Cloud-Sicherung aktiv{status.konto && <> für <strong>{status.konto}</strong></>} – automatisch beim Start,
            alle 5 Minuten und beim Schließen.
            {status.letzterAbgleich && <> Zuletzt: {new Date(status.letzterAbgleich).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.</>}
          </p>
          <div className="sync-knoepfe">
            <button className="btn-primary" onClick={jetzt} disabled={beschaeftigt || status.laeuft}>
              {beschaeftigt || status.laeuft ? 'Gleicht ab …' : '🔄 Jetzt abgleichen'}
            </button>
            <button className="dialog-btn" onClick={trennen}>Abmelden</button>
          </div>
        </>
      )}

      {status.fehler && !abgelaufen && <p className="fehler-text" style={{ marginTop: 10 }}>❌ {status.fehler}</p>}
      {meldung && <p className={meldung.startsWith('❌') ? 'fehler-text' : 'einstell-sub'} style={{ marginTop: 10 }}>{meldung}</p>}
    </section>
  )
}
