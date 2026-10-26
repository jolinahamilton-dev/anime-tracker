// Ende-zu-Ende-Verschlüsselung der Abgleich-Dateien (AES-256-GCM, Web Crypto – im Browser und in
// Electron/Node gleich verfügbar). Der Schlüssel wird aus dem Abgleich-Passwort abgeleitet und
// verlässt die Geräte nie; Google Drive sieht nur unlesbare Daten.
// Der Dateiname ist mitverschlüsselt (additionalData): Eine umbenannte Datei lässt sich nicht mehr
// entschlüsseln – Gerät und Nummern im Namen können also nicht untergeschoben werden.

const ITERATIONEN = 600_000
const PRUEFTEXT = 'anime-tracker-abgleich-v2'
export const MIN_PASSWORT = 12

const subtle = () => globalThis.crypto.subtle
const zuB64 = (b: Uint8Array) => { let s = ''; b.forEach(x => { s += String.fromCharCode(x) }); return btoa(s) }
const ausB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const text = (s: string) => new TextEncoder().encode(s)

export function neuesSalz(): string {
  return zuB64(globalThis.crypto.getRandomValues(new Uint8Array(16)))
}

/** Schlüssel aus Passwort + Salz ableiten (PBKDF2-SHA256). Ergebnis als Base64 zum Speichern. */
export async function leiteSchluesselAb(passwort: string, salz: string): Promise<string> {
  // NFC: Umlaute werden auf jedem Gerät gleich kodiert (sonst passt das Passwort z. B. vom iPhone nicht)
  const basis = await subtle().importKey('raw', text(passwort.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: ausB64(salz), iterations: ITERATIONEN }, basis, 256)
  return zuB64(new Uint8Array(bits))
}

const aesSchluessel = (b64: string) => subtle().importKey('raw', ausB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt'])

/** `name` = Dateiname in Google Drive (wird beim Entschlüsseln geprüft) */
export async function verschluessele(schluessel: string, daten: unknown, name: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const geheim = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: text(name) }, await aesSchluessel(schluessel), text(JSON.stringify(daten))))
  return JSON.stringify({ v: 2, iv: zuB64(iv), d: zuB64(geheim) })
}

/** Wirft, wenn der Schlüssel nicht passt, die Datei verändert oder umbenannt wurde */
export async function entschluessele<T = unknown>(schluessel: string, inhalt: string, name: string): Promise<T> {
  const { v, iv, d } = JSON.parse(inhalt)
  if (v !== 2) throw new Error(`Unbekanntes Dateiformat (${name})`)
  const klar = await subtle().decrypt({ name: 'AES-GCM', iv: ausB64(iv), additionalData: text(name) }, await aesSchluessel(schluessel), ausB64(d))
  return JSON.parse(new TextDecoder().decode(klar))
}

/** Prüfwert, mit dem ein weiteres Gerät erkennt, ob das eingegebene Passwort stimmt */
export const erzeugePruefwert = (schluessel: string) => verschluessele(schluessel, PRUEFTEXT, 'salz.json')
export async function passtSchluessel(schluessel: string, pruefwert: string): Promise<boolean> {
  try { return (await entschluessele(schluessel, pruefwert, 'salz.json')) === PRUEFTEXT } catch { return false }
}
