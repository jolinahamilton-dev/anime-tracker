// Service Worker der Handy-Version: App startet schnell (auch bei schlechtem Netz) und ohne Internet,
// Cover bleiben offline sichtbar. (Wird nur in der Web-App registriert, nicht in der PC-App.)
//
// Strategie:
// - Gebaute Dateien (assets/*-<hash>.js/css/wasm): ändern sich nie → erst Speicher, sonst Netz.
//   Beim Installieren wird der ganze Build vorab geladen, damit auch selten genutzte Teile offline gehen.
// - Startseite (index.html): erst Netz, aber höchstens NETZ_WARTEN ms – danach die gespeicherte Seite.
//   Die gespeicherte Seite gehört immer genau zu den Dateien im Speicher dieser Version.
// - Logos, Symbole, Manifeste: sofort aus dem Speicher, im Hintergrund auffrischen.
// - Cover von AniList: einmal laden, dann aus dem Speicher. AniList-Daten und Google nie speichern.
//
// Neue Version: Der Browser holt sw.js bei jedem Start ohne HTTP-Cache. Beim Build schreibt das Vite-Plugin
// (vite.web.config.ts) Version und Dateiliste unten hinein → sw.js ändert sich → neuer Worker installiert
// den neuen Build und übernimmt sofort. Spätestens beim nächsten Start läuft dann die neue Version.
// Der Speicher der vorigen Version bleibt noch eine Generation erhalten: Eine noch offene alte Seite
// kann so weiter ihre alten Dateien nachladen (GitHub Pages hat sie nach dem Deploy nicht mehr).

// Wird beim Build ersetzt (nicht von Hand ändern, Marker stehen lassen)
const BUILD = /*BUILD*/ { version: 'dev', index: '', dateien: [] } /*BUILD*/

const PREFIX = 'anime-tracker-app-'
const APP = PREFIX + BUILD.version
const STATISCH = 'anime-tracker-statisch' // Logos, Symbole, Manifeste, sonstige eigene Dateien
const COVER = 'anime-tracker-cover-v2'
const META = 'anime-tracker-meta' // merkt sich die zuletzt aktive Version
const MAX_COVER = 600 // älteste fliegen raus, damit der Speicher nicht unbegrenzt wächst
const NETZ_WARTEN = 2500

const basis = new URL('./', self.location).href // …/anime-tracker/
const INDEX = basis + 'index.html'

async function sha256(text) {
  const puffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(puffer)].map(b => b.toString(16).padStart(2, '0')).join('')
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(APP)
    // Startseite frisch holen und prüfen, dass sie wirklich zu diesem Build gehört (ein CDN kann kurz
    // nach dem Deploy noch die alte liefern) – sonst schlägt die Installation fehl und wird später wiederholt.
    const antwort = await fetch(INDEX, { cache: 'reload' })
    if (!antwort.ok) throw new Error(`index.html: ${antwort.status}`)
    if (BUILD.index && await sha256(await antwort.clone().text()) !== BUILD.index) {
      throw new Error('index.html passt nicht zu dieser Version')
    }
    // Bereits gespeicherte Dateien (gleicher Hash) nicht erneut laden
    const fehlend = []
    for (const datei of BUILD.dateien) {
      const url = basis + datei
      const vorhanden = await caches.match(url)
      if (vorhanden) await c.put(url, vorhanden)
      else fehlend.push(new Request(url, { cache: 'reload' }))
    }
    await c.addAll(fehlend)
    await c.put(INDEX, antwort)
    // Manifest/Symbol nur nebenbei – darf die Installation nicht scheitern lassen
    caches.open(STATISCH).then(s => s.addAll(['manifest.webmanifest', 'icons/icon-192.png'].map(d => basis + d))).catch(() => {})
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Behalten: diese Version + die zuvor aktive (für noch offene alte Seiten). Ältere weg, ebenso Altlasten.
    const meta = await caches.open(META)
    const vorher = await meta.match('aktiv').then(a => a?.text()).catch(() => undefined)
    const behalten = new Set([APP, STATISCH, COVER, META])
    if (vorher && vorher !== BUILD.version) behalten.add(PREFIX + vorher)
    const namen = await caches.keys()
    await Promise.all(namen.filter(n => !behalten.has(n)).map(n => caches.delete(n)))
    await meta.put('aktiv', new Response(BUILD.version))
    await self.clients.claim()
    // Offenen Seiten Bescheid geben (nur wenn vorher schon eine andere Version lief)
    if (vorher && vorher !== BUILD.version) {
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        client.postMessage({ typ: 'neue-version', version: BUILD.version })
      }
    }
  })())
})

async function kuerzeCover(c) {
  const schluessel = await c.keys()
  for (const k of schluessel.slice(0, Math.max(0, schluessel.length - MAX_COVER))) await c.delete(k)
}

// Netzanfrage mit Zeitlimit: nach ms ohne Antwort → undefined (die Anfrage läuft im Hintergrund weiter)
function mitZeitlimit(versprechen, ms) {
  return new Promise(fertig => {
    const t = setTimeout(() => fertig(undefined), ms)
    versprechen.then(a => { clearTimeout(t); fertig(a) }, () => { clearTimeout(t); fertig(undefined) })
  })
}

// Startseite: Netz mit Zeitlimit, sonst die zu dieser Version gespeicherte Seite. Die Netz-Antwort wird
// bewusst nicht gespeichert – sie kann schon zu einem neueren Build gehören, dessen Dateien noch fehlen;
// den übernimmt der neue Worker samt Dateien.
async function startseite(anfrage) {
  // „no-cache": am HTTP-Cache vorbei nachfragen (GitHub Pages schickt max-age=600, sonst käme bis zu
  // 10 Minuten lang die alte Seite; mit ETag kostet die Nachfrage ohne Änderung kaum etwas)
  const netz = fetch(new Request(anfrage, { cache: 'no-cache' }))
  const gespeichert = (await caches.open(APP).then(c => c.match(INDEX))) ?? await caches.match(INDEX)
  if (!gespeichert) return netz // erster Start: ohne Zeitlimit warten
  if (self.navigator && self.navigator.onLine === false) { netz.catch(() => {}); return gespeichert } // sicher offline: nicht warten
  const antwort = await mitZeitlimit(netz, NETZ_WARTEN)
  return antwort && antwort.ok ? antwort : gespeichert
}

// Gehashte Build-Datei: Speicher (egal welche Version), sonst Netz und in die aktuelle Version legen
async function buildDatei(anfrage) {
  const treffer = await caches.match(anfrage, { ignoreSearch: true })
  if (treffer) return treffer
  const antwort = await fetch(anfrage)
  if (antwort.ok) { const kopie = antwort.clone(); caches.open(APP).then(c => c.put(anfrage, kopie)) }
  return antwort
}

// Sofort aus dem Speicher, im Hintergrund auffrischen
async function ausSpeicherUndAuffrischen(event, anfrage) {
  const c = await caches.open(STATISCH)
  const treffer = await c.match(anfrage, { ignoreSearch: true })
  const netz = fetch(anfrage).then(antwort => {
    if (antwort.ok) return c.put(anfrage, antwort.clone()).then(() => antwort)
    return antwort
  })
  if (treffer) {
    event.waitUntil(netz.catch(() => {}))
    return treffer
  }
  return netz
}

// Sonstige eigene Dateien (z. B. datenschutz.html): Netz mit Zeitlimit, sonst Speicher
async function netzZuerst(anfrage) {
  const c = await caches.open(STATISCH)
  const netz = fetch(anfrage).then(antwort => {
    if (antwort.ok) c.put(anfrage, antwort.clone())
    return antwort
  })
  const treffer = await c.match(anfrage)
  if (!treffer) {
    // Ohne Netz und ohne gespeicherte Datei: Seitenaufruf bekommt wenigstens die App
    return netz.catch(async fehler => (anfrage.mode === 'navigate' && await caches.match(INDEX)) || Promise.reject(fehler))
  }
  const antwort = await mitZeitlimit(netz, NETZ_WARTEN)
  return antwort ?? treffer
}

self.addEventListener('fetch', event => {
  const anfrage = event.request
  if (anfrage.method !== 'GET') return
  const url = new URL(anfrage.url)

  if (url.origin === location.origin) {
    if (!url.href.startsWith(basis)) return
    const pfad = url.pathname.slice(new URL(basis).pathname.length) // relativ zu /anime-tracker/
    if (pfad === 'sw.js') return
    if (pfad === '' || pfad === 'index.html') event.respondWith(startseite(anfrage))
    else if (pfad.startsWith('assets/')) event.respondWith(buildDatei(anfrage))
    else if (pfad.startsWith('logos/') || pfad.startsWith('icons/') || pfad.endsWith('.webmanifest')) {
      event.respondWith(ausSpeicherUndAuffrischen(event, anfrage))
    } else event.respondWith(netzZuerst(anfrage))
    return
  }

  // Cover von AniList: einmal laden, dann aus dem Speicher. Per CORS abgerufen – so zählt nur die echte
  // Dateigröße (undurchsichtige Antworten rechnet Chrome mit mehreren MB an) und Fehlerseiten erkennt man.
  if (url.hostname.endsWith('anilist.co') && anfrage.destination === 'image') {
    event.respondWith(caches.open(COVER).then(async c => {
      const treffer = await c.match(anfrage.url)
      if (treffer) return treffer
      try {
        const antwort = await fetch(anfrage.url, { mode: 'cors', credentials: 'omit' })
        if (antwort.ok) {
          await c.put(anfrage.url, antwort.clone())
          kuerzeCover(c)
          return antwort
        }
      } catch { /* kein CORS oder offline → normal laden, ohne zu speichern */ }
      return fetch(anfrage)
    }))
  }
  // Alles andere (AniList-Daten, Google Drive, Anmeldung) immer direkt übers Netz
})
