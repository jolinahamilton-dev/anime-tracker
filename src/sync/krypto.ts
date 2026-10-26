// Ende-zu-Ende-Verschlüsselung der Abgleich-Dateien (AES-256-GCM, Web Crypto – im Browser und in
// Electron/Node gleich verfügbar). Der Schlüssel wird aus dem Abgleich-Passwort abgeleitet und
// verlässt die Geräte nie; Google Drive sieht nur unlesbare Daten.

const ITERATIONEN = 310_000
const PRUEFTEXT = 'anime-tracker-abgleich-v1'

const subtle = () => globalThis.crypto.subtle
const zuB64 = (b: Uint8Array) => { let s = ''; b.forEach(x => { s += String.fromCharCode(x) }); return btoa(s) }
const ausB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export function neuesSalz(): string {
  return zuB64(globalThis.crypto.getRandomValues(new Uint8Array(16)))
}

/** Schlüssel aus Passwort + Salz ableiten (PBKDF2-SHA256). Ergebnis als Base64 zum Speichern. */
export async function leiteSchluesselAb(passwort: string, salz: string): Promise<string> {
  const basis = await subtle().importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: ausB64(salz), iterations: ITERATIONEN }, basis, 256)
  return zuB64(new Uint8Array(bits))
}

const aesSchluessel = (b64: string) => subtle().importKey('raw', ausB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt'])

export async function verschluessele(schluessel: string, daten: unknown): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const klar = new TextEncoder().encode(JSON.stringify(daten))
  const geheim = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aesSchluessel(schluessel), klar))
  return JSON.stringify({ v: 1, iv: zuB64(iv), d: zuB64(geheim) })
}

/** Wirft, wenn der Schlüssel nicht passt oder die Datei verändert wurde */
export async function entschluessele<T = unknown>(schluessel: string, text: string): Promise<T> {
  const { iv, d } = JSON.parse(text)
  const klar = await subtle().decrypt({ name: 'AES-GCM', iv: ausB64(iv) }, await aesSchluessel(schluessel), ausB64(d))
  return JSON.parse(new TextDecoder().decode(klar))
}

/** Prüfwert, mit dem ein weiteres Gerät erkennt, ob das eingegebene Passwort stimmt */
export const erzeugePruefwert = (schluessel: string) => verschluessele(schluessel, PRUEFTEXT)
export async function passtSchluessel(schluessel: string, pruefwert: string): Promise<boolean> {
  try { return (await entschluessele(schluessel, pruefwert)) === PRUEFTEXT } catch { return false }
}
