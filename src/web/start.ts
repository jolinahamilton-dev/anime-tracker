// Einstieg der Handy-Version (Web-App): Datenbank im Browser laden, dieselben Handler wie am PC
// registrieren, window.api bereitstellen – danach startet die unveränderte Oberfläche.
import { stilleErneuerung, verarbeiteRueckkehr, webPlattform } from './sync-web'
import { initDb, persistDb } from './datenbank'
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

async function start() {
  verarbeiteRueckkehr()
  if (stilleErneuerung()) return // leitet kurz zu Google und wieder zurück

  try {
    await initDb()
  } catch (e) {
    document.getElementById('root')!.innerHTML =
      `<p style="padding:24px;font-family:system-ui">Die Daten konnten nicht geladen werden: ${String(e)}</p>`
    return
  }

  for (const registriere of [registerEntryHandlers, registerListHandlers, registerAchievementHandlers, registerNewsHandlers,
    registerMetaHandlers, registerAniListHandlers, registerWatchOrderHandlers, registerStatsHandlers, registerSerienHandlers]) {
    registriere(registry)
  }
  const sync = erstelleSyncDienst(webPlattform)
  sync.registriere(registry)
  ;(window as any).api = baueApi()
  trackAppOpen()

  await import('../renderer/main')

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
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(console.error)
  }
}

start()
