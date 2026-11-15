// Sammlung: Bände als kompakte Bereichsliste („1-12,14,16-18") lesen, schreiben und auswerten.
// Reine Funktionen ohne Oberfläche – die Detailseite, die Karten und die Sammlungsseite nutzen sie,
// und die Tests laden sie direkt (scripts/test.js übersetzt diese Datei).

/** Höchste erlaubte Bandnummer – schützt vor Tippfehlern wie „1-99999999" */
export const MAX_BAND = 9999

export type BandStatus = 'besitz' | 'wunsch' | 'fehlt'

/** Liest „1-12, 14; 16–18" → sortierte, eindeutige Bandnummern. Unlesbares wird übersprungen. */
export function parseBaende(text: string | null | undefined): number[] {
  const menge = new Set<number>()
  for (const teil of String(text ?? '').split(/[,;\s]+/)) {
    const m = /^(\d{1,4})(?:[-–—](\d{1,4}))?$/.exec(teil.trim())
    if (!m) continue
    let von = Number(m[1])
    let bis = m[2] === undefined ? von : Number(m[2])
    if (von > bis) [von, bis] = [bis, von]
    if (von < 1) von = 1
    bis = Math.min(bis, MAX_BAND)
    for (let n = von; n <= bis; n++) menge.add(n)
  }
  return [...menge].sort((a, b) => a - b)
}

/** Schreibt Bandnummern kompakt: Folgen ab drei Bänden als Bereich, sonst einzeln; leer → null */
export function formatBaende(baende: Iterable<number>): string | null {
  const liste = [...new Set([...baende].filter(n => Number.isInteger(n) && n >= 1 && n <= MAX_BAND))].sort((a, b) => a - b)
  const teile: string[] = []
  for (let i = 0; i < liste.length;) {
    let j = i
    while (j + 1 < liste.length && liste[j + 1] === liste[j] + 1) j++
    if (j - i >= 2) teile.push(`${liste[i]}-${liste[j]}`)
    else for (let k = i; k <= j; k++) teile.push(String(liste[k]))
    i = j + 1
  }
  return teile.length ? teile.join(',') : null
}

/** Normalisiert eine Eingabe („3, 1-2 ,x") → kompakte Schreibweise (oder null) */
export function normalisiereBaende(text: string | null | undefined): string | null {
  return formatBaende(parseBaende(text))
}

/** Ein einzelner Band an/aus */
export function schalteBand(text: string | null | undefined, band: number, an: boolean): string | null {
  const menge = new Set(parseBaende(text))
  if (an) menge.add(band); else menge.delete(band)
  return formatBaende(menge)
}

/** Bereich von..bis an/aus (reihenfolge egal) */
export function setzeBereich(text: string | null | undefined, von: number, bis: number, an: boolean): string | null {
  if (von > bis) [von, bis] = [bis, von]
  von = Math.max(1, von); bis = Math.min(MAX_BAND, bis)
  const menge = new Set(parseBaende(text))
  for (let n = von; n <= bis; n++) { if (an) menge.add(n); else menge.delete(n) }
  return formatBaende(menge)
}

export function bandStatus(besitz: string | null | undefined, wunsch: string | null | undefined, band: number): BandStatus {
  if (parseBaende(besitz).includes(band)) return 'besitz'
  if (parseBaende(wunsch).includes(band)) return 'wunsch'
  return 'fehlt'
}

/** Setzt den Zustand eines Bands; „besitz" und „wunsch" bleiben dabei überschneidungsfrei */
export function setzeBandStatus(besitz: string | null | undefined, wunsch: string | null | undefined, band: number,
  status: BandStatus): { besitz: string | null; wunsch: string | null } {
  return { besitz: schalteBand(besitz, band, status === 'besitz'), wunsch: schalteBand(wunsch, band, status === 'wunsch') }
}

/** Antippen: fehlt → besitze ich → will ich → fehlt */
export const NAECHSTER_STATUS: Record<BandStatus, BandStatus> = { fehlt: 'besitz', besitz: 'wunsch', wunsch: 'fehlt' }

/** Bereich als „besitze ich" setzen (Wunsch-Bände darin entfallen, weil sie nun da sind) */
export function besitzBereich(besitz: string | null | undefined, wunsch: string | null | undefined, von: number, bis: number): { besitz: string | null; wunsch: string | null } {
  return { besitz: setzeBereich(besitz, von, bis, true), wunsch: setzeBereich(wunsch, von, bis, false) }
}

/** Eingabefeld „Übernehmen": die genannten Bände werden besessen (ersetzt den Besitz komplett) */
export function besitzAusText(text: string, wunsch: string | null | undefined): { besitz: string | null; wunsch: string | null } {
  const neu = parseBaende(text)
  const weg = new Set(neu)
  return { besitz: formatBaende(neu), wunsch: formatBaende(parseBaende(wunsch).filter(n => !weg.has(n))) }
}

export function anzahlBaende(text: string | null | undefined): number { return parseBaende(text).length }

/** Höchste erfasste Bandnummer (0 = keine) */
export function hoechsterBand(...texte: Array<string | null | undefined>): number {
  let h = 0
  for (const t of texte) for (const n of parseBaende(t)) if (n > h) h = n
  return h
}

/** Fehlende Bände unterhalb des höchsten besessenen (echte Lücken); bis = obere Grenze, sonst der höchste Besitz */
export function luecken(besitz: string | null | undefined, bis?: number): number[] {
  const hat = new Set(parseBaende(besitz))
  const ende = bis ?? hoechsterBand(besitz)
  const aus: number[] = []
  for (let n = 1; n <= ende; n++) if (!hat.has(n)) aus.push(n)
  return aus
}

/** Nächster Kauf: erster nicht besessene Band nach dem höchsten besessenen (mit Obergrenze total, falls bekannt) */
export function naechsterKauf(besitz: string | null | undefined, total?: number | null): number | null {
  const h = hoechsterBand(besitz)
  if (h === 0) return null
  const n = h + 1
  return total && n > total ? null : n
}

/** Besessene Bände, die noch nicht gelesen sind (Nummer größer als der Lesestand) */
export function ungelesen(besitz: string | null | undefined, gelesen: number): number[] {
  return parseBaende(besitz).filter(n => n > gelesen)
}

/** Kurzschreibweise für Listen von Bänden: „5, 9, 12–14" (Anzeige, nicht zum Speichern) */
export function anzeigeBaende(baende: number[]): string {
  return (formatBaende(baende) ?? '').split(',').join(', ').replace(/-/g, '–')
}
