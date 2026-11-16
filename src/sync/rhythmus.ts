// Takt des Handy-Abgleichs: nur bei sichtbarer App, bei Ruhe stufenweise seltener (5 → 15 Minuten).
export const MIN = 60 * 1000
export const TAKT = 5 * MIN
export const TAKT_RUHE = 15 * MIN
export const RUHE_NACH_LAEUFEN = 3
export const NACH_AENDERUNG = 10 * 1000

export interface Rhythmus {
  /** Nach jedem Lauf aufrufen: hatte er Änderungen (eingespielt oder hochgeladen)? Liefert die Wartezeit bis zum nächsten Lauf. */
  nachLauf(hatteAenderung: boolean): number
  /** Eigene Änderung gemacht oder App wieder sichtbar: Zähler zurücksetzen, nächster Lauf nach `NACH_AENDERUNG`. */
  aktivitaet(): number
  wartezeit(): number
}

export function erstelleRhythmus(): Rhythmus {
  let ruhig = 0
  const wartezeit = () => (ruhig >= RUHE_NACH_LAEUFEN ? TAKT_RUHE : TAKT)
  return {
    nachLauf(hatteAenderung) { ruhig = hatteAenderung ? 0 : ruhig + 1; return wartezeit() },
    aktivitaet() { ruhig = 0; return NACH_AENDERUNG },
    wartezeit,
  }
}
