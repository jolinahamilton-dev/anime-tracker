// Google Drive als Ablage: nur der versteckte App-Ordner (appDataFolder, Berechtigung drive.appdata).
// Reine REST-Aufrufe per fetch – gleich am PC und im Browser. Den Zugangstoken liefert die Plattform.

export interface DriveDatei { id: string; name: string; createdTime: string }

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export class DriveFehler extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function drive(holeToken: () => Promise<string>) {
  async function anfrage(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await holeToken()
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })
    if (res.status === 401) throw new DriveFehler('Die Anmeldung bei Google ist abgelaufen – bitte neu verbinden.', 401)
    if (!res.ok) {
      let text = ''
      try { text = (await res.json())?.error?.message ?? '' } catch { /* egal */ }
      throw new DriveFehler(`Google Drive: ${text || `HTTP ${res.status}`}`, res.status)
    }
    return res
  }

  return {
    /** Alle Dateien im App-Ordner */
    async liste(): Promise<DriveDatei[]> {
      const dateien: DriveDatei[] = []
      let seite: string | undefined
      do {
        const p = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken, files(id, name, createdTime)', pageSize: '1000' })
        if (seite) p.set('pageToken', seite)
        const j = await (await anfrage(`${API}?${p}`)).json()
        dateien.push(...j.files)
        seite = j.nextPageToken
      } while (seite)
      return dateien
    },

    async lade(id: string): Promise<string> {
      return (await anfrage(`${API}/${id}?alt=media`)).text()
    },

    /** Liefert die ID der neuen Datei */
    async speichere(name: string, inhalt: string): Promise<string> {
      const grenze = 'trenner' + Math.random().toString(36).slice(2)
      const body = `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: ['appDataFolder'] }) +
        `\r\n--${grenze}\r\nContent-Type: application/json\r\n\r\n${inhalt}\r\n--${grenze}--`
      const res = await anfrage(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${grenze}` },
        body,
      })
      return (await res.json()).id
    },

    async loesche(id: string): Promise<void> {
      await anfrage(`${API}/${id}`, { method: 'DELETE' })
    },
  }
}
