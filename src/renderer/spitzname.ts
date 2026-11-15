// Spitzname-Vorschlag aus dem Suchtext beim Einpflegen – reine Logik (ohne React/DOM),
// damit sie in tests/spitzname.test.js direkt getestet werden kann.
//
// Regel: Der Suchtext wird nur dann als Spitzname angeboten, wenn er sich deutlich von ALLEN
// Titeln des Treffers unterscheidet. „naruto“ für NARUTO oder „kusuriya“ für „Kusuriya no
// Hitorigoto“ ist nur eine Tipp-/Kurzform des Titels – „Tagebücher der Apothekerin“ oder „AoT“ nicht.

/** Mindestlänge des Suchtexts (ohne Leerzeichen am Rand) */
export const MIN_LAENGE = 3
/** Ab dieser Ähnlichkeit (0–1) zu einem Titel gilt der Suchtext als bloße Schreibvariante */
export const MAX_AEHNLICHKEIT = 0.5

/** Klein, ohne Akzente/Umlaut-Punkte, nur Buchstaben und Ziffern (Leerzeichen/Satzzeichen fallen weg) */
export function normalisiere(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Levenshtein-Abstand (zwei Zeilen, Zeichen für Zeichen) */
function editDistanz(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let vorher = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const aktuell = [i]
    for (let j = 1; j <= y.length; j++) {
      aktuell[j] = Math.min(vorher[j] + 1, aktuell[j - 1] + 1, vorher[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    vorher = aktuell
  }
  return vorher[y.length]
}

/** Ähnlichkeit 0–1 (1 = gleich) der normalisierten Texte */
export function aehnlichkeit(a: string, b: string): number {
  const laenge = Math.max(Array.from(a).length, Array.from(b).length)
  return laenge === 0 ? 1 : 1 - editDistanz(a, b) / laenge
}

/**
 * Spitzname aus dem Suchtext oder '' – wenn der Text zu kurz ist oder (normalisiert) in einem
 * Titel steckt, einen Titel enthält oder einem Titel zu ähnlich ist.
 */
export function spitznameAusSuche(
  suchtext: string,
  titel: Array<string | null | undefined>,
): string {
  const text = suchtext.trim().replace(/\s+/g, ' ')
  if (text.length < MIN_LAENGE) return ''
  const n = normalisiere(text)
  if (n.length < MIN_LAENGE) return ''
  for (const t of titel) {
    if (!t) continue
    const nt = normalisiere(t)
    if (!nt) continue
    if (nt.includes(n) || n.includes(nt)) return ''
    if (aehnlichkeit(n, nt) > MAX_AEHNLICHKEIT) return ''
  }
  return text
}
