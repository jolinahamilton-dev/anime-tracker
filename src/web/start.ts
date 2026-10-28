// Einstieg der Handy-Version (Web-App): Datenbank im Browser laden, dieselben Handler wie am PC
// registrieren, window.api bereitstellen – danach startet die unveränderte Oberfläche.
import { stilleErneuerung, verarbeiteRueckkehr, webPlattform } from './sync-web'
import { initDb, persistDb, wiederhergestelltAusKopie } from './datenbank'
import { registry, baueApi } from './api-web'
import { BrowserWindow } from './electron-shim'
import { registerEntryHandlers } from '../main/handlers/entries'
import { registerListHandlers } from '../main/handlers/lists'
import { registerAchievementHandlers } from '../main/handlers/achievements'
import { registerNewsHandlers, aktualisiereNews } from '../main/handlers/news'
import { registerMetaHandlers } from '../main/handlers/meta'
import { registerAniListHandlers } from '../main/handlers/anilist'
import { registerWatchOrderHandlers } from '../main/handlers/watchorder'
import { registerStatsHandlers, ergaenzeFolgenlaengen } from '../main/handlers/stats'
import { registerSerienHandlers, aktualisiereSerien } from '../main/handlers/serien'
import { trackAppOpen } from '../main/trackAppOpen'
import { erstelleSyncDienst } from '../sync/dienst'
import { registerDateiHandlers } from './dateien-web'
import { registerBegruessungHandlers } from '../main/handlers/begruessung'

async function start() {
  verarbeiteRueckkehr()
  if (stilleErneuerung()) return // leitet kurz zu Google und wieder zurück

  try {
    await initDb()
  } catch (e) {
    const p = document.createElement('p')
    p.style.cssText = 'padding:24px;font-family:system-ui;color:#f0f0f5'
    p.textContent = `Die Daten konnten nicht geladen werden: ${String(e)}`
    document.getElementById('root')!.replaceChildren(p)
    return
  }

  for (const registriere of [registerEntryHandlers, registerListHandlers, registerAchievementHandlers, registerNewsHandlers,
    registerMetaHandlers, registerAniListHandlers, registerWatchOrderHandlers, registerStatsHandlers, registerSerienHandlers]) {
    registriere(registry)
  }
  const sync = erstelleSyncDienst(webPlattform)
  sync.registriere(registry)
  registerDateiHandlers(registry)
  registerBegruessungHandlers(registry)
  ;(window as any).api = baueApi()
  trackAppOpen()

  await import('../renderer/main')

  const { hinweis, snackbar } = await import('../renderer/meldungen')
  if (wiederhergestelltAusKopie) {
    hinweis('Liste aus Kopie geladen', `Der Speicher der App war beschädigt. Geladen wurde die Kopie vom ` +
      `${new Date(wiederhergestelltAusKopie).toLocaleString('de-DE')} – Änderungen danach fehlen, falls sie nicht über ` +
      `den Abgleich zurückkommen. Weitere Kopien findest du unter Einstellungen → Sicherung.`)
  }
  window.addEventListener('neue-version', () => snackbar('Neue Version der App geladen', { label: 'Neu laden', ausfuehren: () => location.reload() }, 15000))
  let gemeldet = false
  window.addEventListener('speicherfehler', e => {
    if (gemeldet) return
    gemeldet = true
    const voll = String((e as CustomEvent).detail).includes('Quota')
    hinweis('Speichern fehlgeschlagen', voll
      ? 'Der Speicher des Browsers ist voll – die letzten Änderungen sind nur bis zum Schließen der App da. Bitte etwas Speicher freigeben.'
      : 'Die letzten Änderungen konnten nicht gespeichert werden. Bitte die App neu laden.')
      .then(() => { gemeldet = false })
  })

  // Hintergrund wie am PC: erst mit dem PC abgleichen, dann neue Folgen/Staffeln und News prüfen
  const fenster = BrowserWindow.getAllWindows()[0] as any
  const serienUndNews = () => aktualisiereSerien(fenster).catch(console.error)
    .then(() => aktualisiereNews()).catch(console.error)
    .then(() => ergaenzeFolgenlaengen()).catch(console.error)
  setTimeout(async () => {
    await sync.abgleichen().catch(console.error)
    serienUndNews()
  }, 1500)
  setInterval(() => sync.abgleichen().catch(console.error), 5 * 60 * 1000)
  setInterval(serienUndNews, 6 * 60 * 60 * 1000)

  // App wird verlassen → sofort speichern und eigene Änderungen hochladen;
  // zurück nach längerer Pause → Anmeldung ggf. still erneuern und abgleichen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistDb()
      sync.abgleichen().catch(console.error)
    } else if (!stilleErneuerung()) {
      sync.abgleichen().catch(console.error)
    }
  })

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    // Neue Version übernommen (sw.js aktiviert, alte Seite läuft noch) → als Ereignis „neue-version" weiterreichen;
    // die Oberfläche kann darauf z. B. einen Neu-laden-Hinweis zeigen. Spätestens beim nächsten Start ist sie da.
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.typ === 'neue-version') window.dispatchEvent(new CustomEvent('neue-version', { detail: e.data.version }))
    })
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').then(reg => {
      // Handy-Apps laufen oft tagelang im Hintergrund weiter: beim Zurückkehren höchstens stündlich nach Updates sehen
      let geprueft = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - geprueft < 60 * 60 * 1000) return
        geprueft = Date.now()
        reg.update().catch(() => {})
      })
    }).catch(console.error)
  }
}

start()
