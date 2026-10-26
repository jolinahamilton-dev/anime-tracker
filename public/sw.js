// Service Worker der Handy-Version: App startet auch ohne Internet, Cover bleiben offline sichtbar.
// (Wird nur in der Web-App registriert, nicht in der PC-App.)
const APP = 'anime-tracker-app-v1'
const COVER = 'anime-tracker-cover-v1'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP).then(c => c.addAll(['./', './index.html', './manifest.webmanifest'])))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(namen =>
    Promise.all(namen.filter(n => n !== APP && n !== COVER).map(n => caches.delete(n)))
  ).then(() => self.clients.claim()))
})

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

  // Cover von AniList und Schriften: einmal laden, dann aus dem Speicher
  if (url.hostname.endsWith('anilist.co') && anfrage.destination === 'image' || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(caches.open(COVER).then(async c => {
      const treffer = await c.match(anfrage)
      if (treffer) return treffer
      const antwort = await fetch(anfrage)
      if (antwort.ok || antwort.type === 'opaque') c.put(anfrage, antwort.clone())
      return antwort
    }))
  }
  // Alles andere (AniList-Daten, Google Drive, Anmeldung) immer direkt übers Netz
})
