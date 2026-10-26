// Ersatz für das Modul „electron" in der Handy-Version (Browser). Die Handler aus src/main laufen
// dadurch unverändert: Was sie ans Fenster „senden", geht an die Zuhörer der Oberfläche.
type Zuhoerer = (daten: unknown) => void
const zuhoerer = new Map<string, Set<Zuhoerer>>()

export function sende(kanal: string, daten: unknown) {
  zuhoerer.get(kanal)?.forEach(f => { try { f(daten) } catch (e) { console.error(e) } })
}

export function hoere(kanal: string, f: Zuhoerer): () => void {
  if (!zuhoerer.has(kanal)) zuhoerer.set(kanal, new Set())
  zuhoerer.get(kanal)!.add(f)
  return () => { zuhoerer.get(kanal)?.delete(f) }
}

const fenster = {
  isDestroyed: () => false,
  isMinimized: () => false,
  restore() {},
  focus() {},
  webContents: { send: (kanal: string, daten: unknown) => sende(kanal, daten) },
}

export const BrowserWindow = {
  fromWebContents: () => fenster,
  getAllWindows: () => [fenster],
}

export const shell = { openExternal: (url: string) => { window.open(url, '_blank') } }
export const ipcMain = { handle() {} }
export const app = {}
export const dialog = {}
export const net = {}
export const safeStorage = { isEncryptionAvailable: () => false }
