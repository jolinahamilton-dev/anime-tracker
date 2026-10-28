import { useSyncExternalStore } from 'react'

// Android/Chrome bietet die Installation per Ereignis an. Früh mitschneiden (Import in App.tsx),
// damit die Einstellungen später „Zum Startbildschirm hinzufügen“ mit dem gewählten Logo anbieten können.
// Am PC und auf dem iPhone kommt das Ereignis nie – dann bleibt nur der Hinweis.
interface InstallEreignis extends Event { prompt(): Promise<void> }

let angebot: InstallEreignis | null = null
const hoerer = new Set<() => void>()
const melden = () => hoerer.forEach(f => f())

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  angebot = e as InstallEreignis
  melden()
})
window.addEventListener('appinstalled', () => { angebot = null; melden() })

export function useInstallierbar() {
  return useSyncExternalStore(f => { hoerer.add(f); return () => { hoerer.delete(f) } }, () => angebot !== null)
}

export async function installieren() {
  const e = angebot
  if (!e) return
  angebot = null
  melden()
  await e.prompt()
}
