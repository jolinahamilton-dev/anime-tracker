// PC-Seite des Google-Drive-Abgleichs: Anmeldung im System-Browser (OAuth mit PKCE und
// Rückleitung auf 127.0.0.1) und Ablage von Zugang und Schlüssel – verschlüsselt mit dem
// Windows-Konto (Electron safeStorage).
import { BrowserWindow, safeStorage, shell } from 'electron'
import http from 'http'
import { AddressInfo } from 'net'
import { dbGet, dbRun } from '../db/database'
import { SyncPlattform } from '../sync/dienst'

const CLIENT_ID = '1099263928901-8ppirrv5vbrn56h94ejjrvqaj08dljmc.apps.googleusercontent.com'
const BEREICH = 'https://www.googleapis.com/auth/drive.appdata'

// Der „Clientschlüssel" einer Desktop-App ist laut Google nicht geheim – trotzdem liegt er nicht im
// öffentlichen Repository, sondern in der lokalen, von git ausgeschlossenen Datei geheim.local.ts
function clientSecret(): string {
  try { return require('./geheim.local').GOOGLE_CLIENT_SECRET } catch { return '' }
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function speichereGeheim(key: string, wert: string | null) {
  if (wert === null) { dbRun('DELETE FROM app_meta WHERE key = ?', [key]); return }
  const daten = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(wert).toString('base64') : 'roh:' + wert
  dbRun('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, daten])
}
function ladeGeheim(key: string): string | null {
  const v = dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value as string | undefined
  if (!v) return null
  if (v.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) } catch { return null }
  }
  return v.slice(4)
}

let zugang: { token: string; ablauf: number } | null = null

async function tokenAnfrage(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: clientSecret(), ...params }),
  })
  const j = await res.json()
  if (!res.ok) throw Object.assign(new Error(`Google-Anmeldung: ${j.error_description ?? j.error ?? res.status}`), { code: j.error })
  return j as { access_token: string; expires_in: number; refresh_token?: string }
}

/** Anmeldung im Browser; wartet, bis Google zur App zurückleitet (max. 5 Minuten) */
async function anmelden(): Promise<void> {
  const verifier = b64url(globalThis.crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64url(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)))

  const server = http.createServer()
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Anmeldung abgebrochen (keine Antwort innerhalb von 5 Minuten)')), 5 * 60_000)
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirect)
        if (url.pathname !== '/') { res.writeHead(404); res.end(); return }
        // Anfragen ohne passenden state (nicht von Google) ignorieren – sie dürfen die Anmeldung nicht abbrechen
        if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end(); return }
        const ok = url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><meta charset="utf-8"><title>Anime Tracker</title>
          <body style="font-family:system-ui;background:#0f0f13;color:#f0f0f5;display:grid;place-items:center;height:100vh;margin:0">
          <div style="text-align:center"><h2>${ok ? '✅ Verbunden' : '❌ Anmeldung fehlgeschlagen'}</h2>
          <p>${ok ? 'Du kannst dieses Fenster schließen und zur App zurückkehren.' : 'Bitte in der App erneut versuchen.'}</p></div>`)
        clearTimeout(timer)
        if (ok) resolve(url.searchParams.get('code')!)
        else reject(new Error(url.searchParams.get('error') === 'access_denied' ? 'Zugriff wurde nicht erlaubt.' : 'Anmeldung fehlgeschlagen.'))
      })
      const p = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: BEREICH,
        code_challenge: challenge, code_challenge_method: 'S256', state,
        access_type: 'offline', prompt: 'consent',
      })
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${p}`)
    })
    const t = await tokenAnfrage({ code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' })
    if (!t.refresh_token) throw new Error('Google hat keinen dauerhaften Zugang geliefert – bitte erneut verbinden.')
    speichereGeheim('drive_zugang', t.refresh_token)
    zugang = { token: t.access_token, ablauf: Date.now() + (t.expires_in - 60) * 1000 }
  } finally {
    server.close()
  }
  // Fenster wieder nach vorne holen
  const win = BrowserWindow.getAllWindows()[0]
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
}

export const pcPlattform: SyncPlattform = {
  async istVerbunden() { return !!ladeGeheim('drive_zugang') },

  async holeToken() {
    if (zugang && zugang.ablauf > Date.now()) return zugang.token
    const refresh = ladeGeheim('drive_zugang')
    if (!refresh) throw new Error('Nicht mit Google Drive verbunden.')
    try {
      const t = await tokenAnfrage({ refresh_token: refresh, grant_type: 'refresh_token' })
      zugang = { token: t.access_token, ablauf: Date.now() + (t.expires_in - 60) * 1000 }
      return zugang.token
    } catch (e: any) {
      // Zugang widerrufen oder abgelaufen → als getrennt behandeln
      if (e?.code === 'invalid_grant') { speichereGeheim('drive_zugang', null); zugang = null }
      throw e
    }
  },

  verbinden: anmelden,

  async trennen() {
    const refresh = ladeGeheim('drive_zugang')
    if (refresh) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {})
    speichereGeheim('drive_zugang', null)
    zugang = null
  },

  async ladeSchluessel() { return ladeGeheim('sync_schluessel') },
  async speichereSchluessel(s) { speichereGeheim('sync_schluessel', s) },

  benachrichtige(geaendert) {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) win.webContents.send('serien:aktualisiert', { aenderungen: [], zurueckAufBeendet: [], geaendert })
  },
}
