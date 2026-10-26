// App-eigene Rückfragen und kurze Hinweise („Snackbar") statt der blockierenden
// Windows-Fenster von confirm()/alert(). Angezeigt werden sie von <Meldungen /> in App.tsx.

export interface Rueckfrage {
  titel: string
  text?: string
  ok?: string
  abbrechen?: string | null // null = nur ein Knopf (Hinweis)
  gefahr?: boolean
  antwort: (ja: boolean) => void
}

export interface Snack {
  id: number
  text: string
  aktion?: { label: string; ausfuehren: () => void }
  dauer: number
}

type Zustand = { rueckfrage: Rueckfrage | null; snack: Snack | null }
let zustand: Zustand = { rueckfrage: null, snack: null }
const zuhoerer = new Set<(z: Zustand) => void>()

function setze(neu: Partial<Zustand>) {
  zustand = { ...zustand, ...neu }
  zuhoerer.forEach(f => f(zustand))
}

export function abonniereMeldungen(f: (z: Zustand) => void) {
  zuhoerer.add(f)
  f(zustand)
  return () => { zuhoerer.delete(f) }
}

/** Rückfrage mit Ja/Nein – liefert true bei „OK" */
export function bestaetigen(titel: string, opts: Omit<Rueckfrage, 'titel' | 'antwort'> = {}): Promise<boolean> {
  return new Promise(resolve => setze({
    rueckfrage: { titel, ...opts, antwort: ja => { setze({ rueckfrage: null }); resolve(ja) } },
  }))
}

/** Hinweis mit nur einem Knopf */
export function hinweis(titel: string, text?: string): Promise<void> {
  return bestaetigen(titel, { text, ok: 'OK', abbrechen: null }).then(() => undefined)
}

let snackNr = 0
/** Kurzer Hinweis unten, optional mit Aktion (z. B. „Rückgängig") */
export function snackbar(text: string, aktion?: Snack['aktion'], dauer = 6000) {
  setze({ snack: { id: ++snackNr, text, aktion, dauer } })
}

export function schliesseSnackbar(id: number) {
  if (zustand.snack?.id === id) setze({ snack: null })
}
