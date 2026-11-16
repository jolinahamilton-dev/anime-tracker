// Kleine, reine Anzeige-Regeln (ohne React) – getrennt, damit sie getestet werden können.

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')

/** „n neu“ nur bei Staffeln, die gerade laufen; sonst liegen die Folgen schon länger bereit: „n offen“ */
export function offenText(anzahl: number, laeuft: boolean): string {
  return `${anzahl} ${laeuft ? 'neu' : 'offen'}`
}

/** Staffeltitel als zweite Zeile nur, wenn er sich vom Seriennamen unterscheidet (sonst „InuYasha / InuYasha“) */
export function staffelZeile(staffel: string | null | undefined, ...serienNamen: (string | null | undefined)[]): string | null {
  if (!staffel) return null
  const s = norm(staffel)
  if (!s) return null
  return serienNamen.some(n => norm(n) === s) ? null : staffel
}

/** Manga: ohne Gesamtzahl ist die Serie noch nicht abgeschlossen – nicht „von ?“ anzeigen */
export function kapitelStand(gelesen: number, gesamt: number | null | undefined, laeuft: boolean): string {
  if (gesamt) return `Kapitel ${gelesen}/${gesamt}`
  return laeuft ? `Kapitel ${gelesen} · läuft noch` : `Kapitel ${gelesen}`
}
