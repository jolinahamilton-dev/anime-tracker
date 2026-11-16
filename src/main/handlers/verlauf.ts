import { dbAll, dbGet, getDb, schedulePersist } from '../../db/database'

// ─────────────────────────────────────────────────────────────────────────────
// Verlauf „gesehen am“ (Plan Nr. 9): jede Änderung des Fortschritts hinterlässt eine Zeile in `verlauf`.
// Nur anfügen, nie ändern; die Tabelle wird zwischen Geräten vereinigt (db/kern.ts, sync/abgleich.ts).
//   plus         + / − auf der Karte oder per Taste       → zählt als gesehen
//   hand         Zähler der Detailseite, Eingabe          → zählt als gesehen
//   auto         „Beendet“ füllt auf, Anlegen mit Stand   → zählt nicht
//   wiederholung Zurücksetzen beim Wiederholen            → zählt nicht
//   import       Import                                   → zählt nicht
// ─────────────────────────────────────────────────────────────────────────────

export type VerlaufArt = 'folge' | 'kapitel' | 'band'
export type VerlaufQuelle = 'plus' | 'hand' | 'auto' | 'wiederholung' | 'import'
/** Quellen, die als wirklich gesehen/gelesen zählen */
export const ZAEHLT_ALS_GESEHEN: readonly VerlaufQuelle[] = ['plus', 'hand']

const neueId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

/** Schreibt einen Verlauf-Eintrag (nichts bei gleichem von/bis oder unbekanntem Eintrag). Läuft in der Transaktion des Aufrufers. */
export function schreibeVerlauf(entryId: number, staffel: number | null, art: VerlaufArt, von: number, bis: number, quelle: VerlaufQuelle) {
  if (!Number.isFinite(von) || !Number.isFinite(bis) || von === bis) return
  const e = dbGet('SELECT uuid FROM entries WHERE id = ?', [entryId])
  if (!e?.uuid) return
  getDb().run('INSERT INTO verlauf (id, eintrag, staffel, art, von, bis, zeit, quelle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [neueId(), String(e.uuid), staffel, art, von, bis, Date.now(), quelle])
  schedulePersist()
}

const FELD_ART: Array<[string, VerlaufArt]> = [
  ['progress_episodes', 'folge'], ['progress_chapters', 'kapitel'], ['progress_volumes', 'band'],
]

/** Vergleicht zwei Zeilen des Eintrags (alt/neu) und schreibt je geänderten Zähler einen Verlauf-Eintrag.
 *  `ohne`: Felder, die nicht protokolliert werden sollen (z. B. Folgen bei Anime mit Staffeln: dort zählt die Staffel). */
export function verlaufAusDifferenz(entryId: number, alt: Record<string, unknown>, neu: Record<string, unknown>,
  quelle: VerlaufQuelle, ohne: string[] = []) {
  for (const [feld, art] of FELD_ART) {
    if (ohne.includes(feld)) continue
    schreibeVerlauf(entryId, null, art, Number(alt[feld] ?? 0), Number(neu[feld] ?? 0), quelle)
  }
}

/** Hat der Anime Staffeln in der Watch-Order? Dann wird der Folgenstand dort (je Staffel) protokolliert. */
export function hatStaffeln(entryId: number): boolean {
  return !!dbGet('SELECT 1 AS x FROM watch_order WHERE entry_id = ? LIMIT 1', [entryId])
}

/** Vergleicht den Stand der Staffeln vor und nach einer Änderung (related_anilist_id → Folgen) */
export function verlaufAusStaffeln(entryId: number, vorher: Array<{ related_anilist_id: unknown; progress_episodes: unknown }>,
  nachher: Array<{ related_anilist_id: unknown; progress_episodes: unknown }>, quelle: VerlaufQuelle) {
  const alt = new Map(vorher.map(z => [Number(z.related_anilist_id), Number(z.progress_episodes ?? 0)]))
  for (const z of nachher) {
    const id = Number(z.related_anilist_id)
    schreibeVerlauf(entryId, id, 'folge', alt.get(id) ?? 0, Number(z.progress_episodes ?? 0), quelle)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auswertung für die Statistik („Aktivität“). Zählt nur plus und hand; je Zeitraum die Summe aller
// Änderungen (ein −1 zieht ab, nie unter 0), Zeiten nach der Ortszeit.
// ─────────────────────────────────────────────────────────────────────────────

export interface VerlaufZeile { art: string; von: number; bis: number; zeit: number; quelle: string }
export interface Aktivitaet {
  /** Beginn des Verlaufs (Datum des ältesten Eintrags, „YYYY-MM-DD“) oder null, wenn es noch keinen gibt */
  seit: string | null
  folgenProMonat: Array<{ monat: string; wert: number }>
  kapitelProMonat: Array<{ monat: string; wert: number }>
  folgenProWoche: Array<{ woche: string; wert: number }>
  kapitelProWoche: Array<{ woche: string; wert: number }>
  /** Tage mit gesehenen Folgen oder gelesenen Kapiteln */
  aktiveTage: number
  laengsteSerie: number
  aktuelleSerie: number
  folgenGesamt: number
  kapitelGesamt: number
}

const p2 = (n: number) => String(n).padStart(2, '0')
const tagKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const monatKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`
/** Montag der Woche (Ortszeit) */
const wochenStart = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }

/** Reine Funktion (testbar): Verlaufszeilen → Auswertung. `jetzt` nur für die letzten 12 Monate/Wochen und die aktuelle Serie. */
export function wertVerlaufAus(zeilen: VerlaufZeile[], jetzt = new Date(), wochen = 12, monate = 12): Aktivitaet {
  const netto = (art: string, key: (d: Date) => string) => {
    const m = new Map<string, number>()
    for (const z of zeilen) {
      if (!ZAEHLT_ALS_GESEHEN.includes(z.quelle as VerlaufQuelle) || z.art !== art) continue
      const k = key(new Date(z.zeit))
      m.set(k, (m.get(k) ?? 0) + (z.bis - z.von))
    }
    return m
  }
  const positiv = (m: Map<string, number>, k: string) => Math.max(0, m.get(k) ?? 0)

  const monatsListe: string[] = []
  for (let i = monate - 1; i >= 0; i--) monatsListe.push(monatKey(new Date(jetzt.getFullYear(), jetzt.getMonth() - i, 1)))
  const wochenListe: string[] = []
  const diese = wochenStart(jetzt)
  for (let i = wochen - 1; i >= 0; i--) wochenListe.push(tagKey(new Date(diese.getFullYear(), diese.getMonth(), diese.getDate() - 7 * i)))

  const tag = new Map<string, number>() // Tage mit Aktivität (Folgen + Kapitel, je Art netto)
  for (const art of ['folge', 'kapitel']) for (const [k, v] of netto(art, tagKey)) if (v > 0) tag.set(k, (tag.get(k) ?? 0) + v)

  const tage = [...tag.keys()].sort()
  let laengste = 0, lauf = 0, vorher: Date | null = null
  for (const t of tage) {
    const [y, m, d] = t.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    lauf = vorher && Math.round((dt.getTime() - vorher.getTime()) / 86_400_000) === 1 ? lauf + 1 : 1
    laengste = Math.max(laengste, lauf)
    vorher = dt
  }
  // Aktuelle Serie: bis heute oder gestern (heute darf noch offen sein)
  let aktuell = 0
  const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate())
  let cursor = tag.has(tagKey(heute)) ? heute : new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 1)
  while (tag.has(tagKey(cursor))) { aktuell++; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1) }

  const mFolge = netto('folge', monatKey), mKapitel = netto('kapitel', monatKey)
  const wFolge = netto('folge', d => tagKey(wochenStart(d))), wKapitel = netto('kapitel', d => tagKey(wochenStart(d)))
  const frueh = zeilen.reduce((m, z) => Math.min(m, z.zeit), Infinity)
  const summe = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + Math.max(0, v), 0)
  return {
    seit: Number.isFinite(frueh) ? tagKey(new Date(frueh)) : null,
    folgenProMonat: monatsListe.map(monat => ({ monat, wert: positiv(mFolge, monat) })),
    kapitelProMonat: monatsListe.map(monat => ({ monat, wert: positiv(mKapitel, monat) })),
    folgenProWoche: wochenListe.map(woche => ({ woche, wert: positiv(wFolge, woche) })),
    kapitelProWoche: wochenListe.map(woche => ({ woche, wert: positiv(wKapitel, woche) })),
    aktiveTage: tage.length,
    laengsteSerie: laengste,
    aktuelleSerie: aktuell,
    folgenGesamt: summe(mFolge),
    kapitelGesamt: summe(mKapitel),
  }
}

export function verlaufAuswertung(): Aktivitaet {
  const zeilen = dbAll('SELECT art, von, bis, zeit, quelle FROM verlauf') as unknown as VerlaufZeile[]
  return wertVerlaufAus(zeilen)
}
