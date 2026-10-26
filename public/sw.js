// Service Worker der Handy-Version: App startet auch ohne Internet, Cover bleiben offline sichtbar.
// (Wird nur in der Web-App registriert, nicht in der PC-App.)
const APP = 'anime-tracker-app-v2'
const COVER = 'anime-tracker-cover-v2'
const MAX_COVER = 600 // älteste fliegen raus, damit der Speicher nicht unbegrenzt wächst

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP).then(c => c.addAll(['./', './index.html', './manifest.webmanifest'])))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(namen =>
    Promise.all(namen.filter(n => n !== APP && n !== COVER).map(n => caches.delete(n)))
  ).then(() => self.clients.claim()))
})

async function kuerzeCover(c) {
  const schluessel = await c.keys()
  for (const k of schluessel.slice(0, Math.max(0, schluessel.length - MAX_COVER))) await c.delete(k)
}

self.addEventListener('fetch', event => {
  const anfrage = event.request
  if (anfrage.method !== 'GET') return
  const url = new URL(anfrage.url)

  // Eigene Dateien: erst Netz (immer die neueste Version), ohne Netz aus dem Speicher
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(anfrage).then(antwort => {
        if (antwort.ok) { const kopie = antwort.clone(); caches.open(APP).then(c => c.put(anfrage, kopie)) }
        return antwort
      }).catch(() => caches.match(anfrage).then(t => t ?? (anfrage.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    )
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
