// Handy-Seite des Google-Drive-Abgleichs: Anmeldung per Weiterleitung zu Google (OAuth für
// Browser-Apps, nur Berechtigung drive.appdata). Zugang und Schlüssel liegen im Browser-Speicher.
import { SyncPlattform } from '../sync/dienst'
import { sende } from './electron-shim'

const CLIENT_ID = '1099263928901-ppqtsdmnhmmadtdjjtt7qppr5iuqbo4o.apps.googleusercontent.com'
const BEREICH = 'https://www.googleapis.com/auth/drive.appdata'
const ZURUECK = location.origin + import.meta.env.BASE_URL

const K = { token: 'drive_token', verbunden: 'drive_verbunden', schluessel: 'sync_schluessel', state: 'drive_state', still: 'drive_still_versucht' }
const lies = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const setze = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* privat */ } }

function zuGoogle(stumm: boolean) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(K.state, state)
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: ZURUECK, response_type: 'token', scope: BEREICH,
    include_granted_scopes: 'true', state, prompt: stumm ? 'none' : 'select_account',
  })
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`)
}

function tokenGueltig(): string | null {
  try {
    const t = JSON.parse(lies(K.token) ?? 'null')
    return t && t.ablauf > Date.now() ? t.token : null
  } catch { return null }
}

/**
 * Vor dem Start der Oberfläche aufrufen: Google leitet mit #access_token=… zurück. Den Teil
 * auswerten und aus der Adresse entfernen (die App nutzt # selbst für ihre Seiten).
 */
export function verarbeiteRueckkehr(): 'verbunden' | 'fehler' | null {
  const h = location.hash
  if (!h.includes('access_token=') && !h.includes('error=')) return null
  const p = new URLSearchParams(h.slice(1))
  const erwartet = sessionStorage.getItem(K.state)
  sessionStorage.removeItem(K.state)
  history.replaceState(null, '', location.pathname + '#/einstellungen')
  if (!erwartet || p.get('state') !== erwartet) return 'fehler'
  const token = p.get('access_token')
  if (token) {
    setze(K.token, JSON.stringify({ token, ablauf: Date.now() + (Number(p.get('expires_in') ?? 3600) - 120) * 1000 }))
    setze(K.verbunden, '1')
    sessionStorage.removeItem(K.still)
    return 'verbunden'
  }
  return 'fehler'
}

/**
 * Zugang abgelaufen (nach ~1 Stunde)? Dann einmal still bei Google erneuern – solange man dort
 * angemeldet ist, geht das ohne Klick. Gibt true zurück, wenn gerade weitergeleitet wird.
 */
export function stilleErneuerung(): boolean {
  if (lies(K.verbunden) !== '1' || tokenGueltig() || sessionStorage.getItem(K.still) || !navigator.onLine) return false
  sessionStorage.setItem(K.still, '1')
  zuGoogle(true)
  return true
}

export const webPlattform: SyncPlattform = {
  async istVerbunden() { return lies(K.verbunden) === '1' },

  async holeToken() {
    const t = tokenGueltig()
    if (t) return t
    throw new Error('Die Anmeldung bei Google ist abgelaufen – bitte „Neu verbinden" tippen.')
  },

  async verbinden() { zuGoogle(false) },

  async trennen() {
    const t = tokenGueltig()
    if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => {})
    setze(K.token, null)
    setze(K.verbunden, null)
  },

  async ladeSchluessel() { return lies(K.schluessel) },
  async speichereSchluessel(s) { setze(K.schluessel, s) },

  benachrichtige(geaendert) {
    sende('serien:aktualisiert', { aenderungen: [], zurueckAufBeendet: [], geaendert })
  },
}

/** Für die Einstellungen: ist die Anmeldung gerade abgelaufen (Neu verbinden nötig)? */
export const zugangAbgelaufen = () => lies(K.verbunden) === '1' && !tokenGueltig()
