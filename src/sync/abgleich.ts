// Zusammenführen der Änderungen mehrerer Geräte (PC ↔ Handy).
// Grundlage ist das Änderungsprotokoll sync_log (siehe db/kern.ts). Jedes Gerät lädt seine eigenen
// Zeilen hoch und spielt die der anderen hier ein. Plattformunabhängig – läuft am PC und im Browser.
import { dbAll, dbGet, getDb, schedulePersist, SYNC_FELDER, SYNC_META } from '../db/kern'

export interface LogZeile {
  nr: number
  zeit: number
  geraet: string
  tabelle: string
  zeile: string
  feld: string // Spaltenname, '*' = angelegt, '-' = gelöscht
  wert: unknown
  alt?: unknown // Wert vor der Änderung (fehlt bei Gesamtständen)
}

// Fortschritt: bei gleichzeitigen Änderungen gewinnt der höhere Wert (zweimal „+1" geht nicht verloren)
const MAXIMUM = new Set(['progress_episodes', 'progress_chapters', 'progress_volumes', 'rewatch_count'])

export function eigeneGeraeteId(): string {
  return String(dbGet("SELECT value FROM app_meta WHERE key = 'geraet_id'")?.value)
}

const meta = (key: string) => dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value as string | undefined
const setzeMeta = (key: string, value: string) => getDb().run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, value])

export function hochgeladenBis(): number | null {
  const v = meta('sync_hochgeladen_bis')
  return v == null ? null : Number(v)
}
export function setzeHochgeladenBis(nr: number) { setzeMeta('sync_hochgeladen_bis', String(nr)); schedulePersist() }

/** Neuanfang (Trennen, neues Passwort, Drive geleert): beim nächsten Abgleich wieder den kompletten
 *  eigenen Stand hochladen und die anderen Geräte von vorn einspielen */
export function setzeAbgleichZurueck() {
  getDb().run("DELETE FROM app_meta WHERE key = 'sync_hochgeladen_bis'")
  getDb().run('DELETE FROM sync_geraete')
  schedulePersist()
}

export function letzteNr(geraet: string): number | null {
  const r = dbGet('SELECT letzte_nr FROM sync_geraete WHERE geraet = ?', [geraet])
  return r ? Number(r.letzte_nr) : null
}

export function hoechsteEigeneNr(): number {
  return Number(dbGet('SELECT MAX(nr) AS n FROM sync_log WHERE geraet = ?', [eigeneGeraeteId()])?.n ?? 0)
}

/** Eigene Änderungen, die noch nicht hochgeladen sind */
export function neueEigeneAenderungen(seit: number): LogZeile[] {
  return dbAll('SELECT nr, zeit, geraet, tabelle, zeile, feld, wert, alt FROM sync_log WHERE geraet = ? AND nr > ? ORDER BY nr',
    [eigeneGeraeteId(), seit]) as unknown as LogZeile[]
}

/**
 * Gesamtstand aller abzugleichenden Daten als Protokollzeilen (beim ersten Abgleich jedes Geräts –
 * alles von vor Version 1.1 steht ja noch nicht im Protokoll – und beim Zusammenfassen).
 * Jedes Feld trägt Zeit und Gerät seiner letzten echten Änderung (unprotokollierte Altdaten: Zeit 0),
 * damit ein Gesamtstand nie neuere Änderungen eines anderen Geräts überstimmt.
 */
export function gesamtstand(): { bisNr: number; zeilen: LogZeile[] } {
  const geraet = eigeneGeraeteId()
  const herkunft = new Map<string, { zeit: number; geraet: string }>()
  for (const r of dbAll('SELECT tabelle, zeile, feld, zeit, geraet FROM sync_log ORDER BY zeit, nr')) {
    herkunft.set(`${r.tabelle}|${r.zeile}|${r.feld}`, { zeit: Number(r.zeit), geraet: String(r.geraet) })
  }
  const vorhanden = new Set<string>()
  const zeilen: LogZeile[] = []
  const neu = (tabelle: string, zeile: string, feld: string, wert: unknown) => {
    const h = herkunft.get(`${tabelle}|${zeile}|${feld}`)
    zeilen.push({ nr: 0, zeit: h?.zeit ?? 0, geraet: h?.geraet ?? geraet, tabelle, zeile, feld, wert })
    if (feld === '*') vorhanden.add(`${tabelle}|${zeile}`)
  }

  for (const e of dbAll('SELECT * FROM entries')) {
    neu('entries', String(e.uuid), '*', null)
    for (const f of SYNC_FELDER.entries) if (e[f] != null) neu('entries', String(e.uuid), f, e[f])
  }
  for (const l of dbAll('SELECT * FROM custom_lists')) {
    neu('custom_lists', String(l.uuid), '*', null)
    for (const f of SYNC_FELDER.custom_lists) if (l[f] != null) neu('custom_lists', String(l.uuid), f, l[f])
  }
  for (const w of dbAll('SELECT w.*, e.uuid AS e_uuid FROM watch_order w JOIN entries e ON e.id = w.entry_id')) {
    const z = `${w.e_uuid}:${w.related_anilist_id}`
    neu('watch_order', z, '*', null)
    for (const f of SYNC_FELDER.watch_order) if (w[f] != null) neu('watch_order', z, f, w[f])
  }
  for (const le of dbAll(`SELECT l.uuid AS l_uuid, e.uuid AS e_uuid FROM list_entries x
      JOIN custom_lists l ON l.id = x.list_id JOIN entries e ON e.id = x.entry_id`)) {
    neu('list_entries', `${le.l_uuid}:${le.e_uuid}`, '*', null)
  }
  for (const a of dbAll('SELECT id, unlocked_at FROM achievements')) neu('achievements', String(a.id), 'unlocked_at', a.unlocked_at)
  for (const k of SYNC_META) { const v = meta(k); if (v != null) neu('app_meta', k, 'value', v) }
  // Löschvermerke für Zeilen, die es nicht mehr gibt – sonst blieben sie auf einem Gerät, das die
  // Einzeldatei mit der Löschung verpasst hat, für immer stehen
  for (const r of dbAll("SELECT DISTINCT tabelle, zeile FROM sync_log WHERE feld = '-'")) {
    if (!vorhanden.has(`${r.tabelle}|${r.zeile}`)) neu(String(r.tabelle), String(r.zeile), '-', null)
  }
  return { bisNr: hoechsteEigeneNr(), zeilen }
}

const gleich = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && String(a) === String(b))

/** Letzte bekannte Änderung eines Felds (eigene oder schon eingespielte fremde) */
function letzteAenderung(tabelle: string, zeile: string, feld: string): { zeit: number; geraet: string } | null {
  const r = dbGet(`SELECT zeit, geraet FROM sync_log WHERE tabelle = ? AND zeile = ? AND feld = ?
    ORDER BY zeit DESC, nr DESC LIMIT 1`, [tabelle, zeile, feld])
  return r ? { zeit: Number(r.zeit), geraet: String(r.geraet) } : null
}
/** Letzte Änderung irgendeines Felds der Zeile (für „Löschen gegen Bearbeiten") */
function letzteZeilenAenderung(tabelle: string, zeile: string, ausser: string): number {
  return Number(dbGet('SELECT MAX(zeit) AS z FROM sync_log WHERE tabelle = ? AND zeile = ? AND feld != ?', [tabelle, zeile, ausser])?.z ?? 0)
}
const neuer = (r: LogZeile, l: { zeit: number; geraet: string } | null) =>
  !l || r.zeit > l.zeit || (r.zeit === l.zeit && r.geraet > l.geraet)

/** Soll der fremde Wert für ein Feld übernommen werden? */
function entscheide(r: LogZeile, aktuell: unknown, tabelle: string): { uebernehmen: boolean; wert: unknown } {
  if (gleich(aktuell, r.wert)) return { uebernehmen: false, wert: aktuell }
  // Das andere Gerät hat genau unseren Stand geändert → einfach übernehmen
  if (r.alt !== undefined && r.alt !== null && gleich(aktuell, r.alt)) return { uebernehmen: true, wert: r.wert }
  // Beide haben geändert (oder unbekannter Ausgangsstand): Fortschritt → Maximum, sonst letzte Änderung
  if (MAXIMUM.has(r.feld) && typeof r.wert === 'number' && typeof aktuell === 'number') {
    return { uebernehmen: r.wert > aktuell, wert: Math.max(r.wert, aktuell) }
  }
  return { uebernehmen: neuer(r, letzteAenderung(tabelle, r.zeile, r.feld)), wert: r.wert }
}

/**
 * Spielt fremde Protokollzeilen ein. Liefert die IDs der geänderten Einträge (zum Neuladen der Seiten).
 * Die Zeilen werden mit ins eigene Protokoll übernommen (mit fremder Geräte-ID – sie werden also
 * nicht erneut hochgeladen), damit spätere Konflikte gegen sie entschieden werden können.
 */
export function spieleEin(zeilen: LogZeile[], stand?: { geraet: string; bisNr: number }): number[] {
  const db = getDb()
  const geaendert = new Set<number>()
  const hoechste = new Map<string, number>()
  const eigene = eigeneGeraeteId()
  // Gesamtstand: erst Einträge und Listen anlegen, dann was daran hängt, dann die Felder – die Zeiten
  // allein geben die Reihenfolge nicht her (Altdaten haben Zeit 0)
  const rang = (r: LogZeile) => !stand || r.feld !== '*' ? 2 : r.tabelle === 'entries' || r.tabelle === 'custom_lists' ? 0 : 1
  const sortiert = [...zeilen].sort((a, b) => rang(a) - rang(b) || a.zeit - b.zeit || a.nr - b.nr)
  const entryId = (uuid: string) => dbGet('SELECT id FROM entries WHERE uuid = ?', [uuid])?.id as number | undefined
  const listId = (uuid: string) => dbGet('SELECT id FROM custom_lists WHERE uuid = ?', [uuid])?.id as number | undefined

  db.run('BEGIN TRANSACTION')
  try {
    setzeMeta('sync_pause', '1') // Trigger schweigen – sonst würden fremde Änderungen als eigene protokolliert
    for (const r of sortiert) {
      // Eigene Änderungen (in fremden Gesamtständen enthalten) sind hier längst angewendet oder überholt
      if (r.geraet === eigene) continue
      if (stand === undefined) {
        const bekannt = letzteNr(r.geraet)
        if (bekannt !== null && r.nr <= bekannt) continue // schon eingespielt
      }
      wendeAn(r)
      db.run('INSERT INTO sync_log (zeit, geraet, tabelle, zeile, feld, wert, alt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.zeit, r.geraet, r.tabelle, r.zeile, r.feld, r.wert ?? null, r.alt ?? null] as any[])
      if (r.nr > (hoechste.get(r.geraet) ?? 0)) hoechste.set(r.geraet, r.nr)
    }
    if (stand) hoechste.set(stand.geraet, Math.max(stand.bisNr, hoechste.get(stand.geraet) ?? 0))
    for (const [geraet, nr] of hoechste) {
      db.run(`INSERT INTO sync_geraete (geraet, letzte_nr) VALUES (?, ?)
        ON CONFLICT (geraet) DO UPDATE SET letzte_nr = MAX(letzte_nr, excluded.letzte_nr)`, [geraet, nr])
    }
    db.run("DELETE FROM app_meta WHERE key = 'sync_pause'")
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  schedulePersist()
  return [...geaendert]

  function wendeAn(r: LogZeile) {
    const zeitSql = new Date(r.zeit).toISOString().replace('T', ' ').slice(0, 19)
    switch (r.tabelle) {
      case 'entries': {
        const id = entryId(r.zeile)
        if (r.feld === '*') {
          if (id || neuer(r, letzteAenderung('entries', r.zeile, '-')) === false) return
          // Platzhalter – die folgenden Feld-Zeilen derselben Änderung füllen ihn
          db.run("INSERT INTO entries (uuid, type, title, status, created_at, updated_at) VALUES (?, 'ANIME', '…', 'planned', ?, ?)",
            [r.zeile, zeitSql, zeitSql])
          geaendert.add(entryId(r.zeile)!)
        } else if (r.feld === '-') {
          if (!id || letzteZeilenAenderung('entries', r.zeile, '-') > r.zeit) return // später noch bearbeitet → bleibt
          db.run('DELETE FROM list_entries WHERE entry_id = ?', [id])
          db.run('DELETE FROM watch_order WHERE entry_id = ?', [id])
          db.run('DELETE FROM entries WHERE id = ?', [id])
          geaendert.add(id)
        } else if (id && SYNC_FELDER.entries.includes(r.feld)) {
          const aktuell = dbGet(`SELECT ${r.feld} AS v FROM entries WHERE id = ?`, [id])?.v
          const { uebernehmen, wert } = entscheide(r, aktuell, 'entries')
          if (!uebernehmen) return
          db.run(`UPDATE entries SET ${r.feld} = ?, updated_at = MAX(updated_at, ?) WHERE id = ?`, [wert as any, zeitSql, id])
          geaendert.add(id)
        }
        return
      }
      case 'custom_lists': {
        const id = listId(r.zeile)
        if (r.feld === '*') {
          if (id || neuer(r, letzteAenderung('custom_lists', r.zeile, '-')) === false) return
          db.run("INSERT INTO custom_lists (uuid, name, created_at) VALUES (?, '…', ?)", [r.zeile, zeitSql])
        } else if (r.feld === '-') {
          if (!id || letzteZeilenAenderung('custom_lists', r.zeile, '-') > r.zeit) return
          db.run('DELETE FROM list_entries WHERE list_id = ?', [id])
          db.run('DELETE FROM custom_lists WHERE id = ?', [id])
        } else if (id && SYNC_FELDER.custom_lists.includes(r.feld)) {
          const aktuell = dbGet(`SELECT ${r.feld} AS v FROM custom_lists WHERE id = ?`, [id])?.v
          const { uebernehmen, wert } = entscheide(r, aktuell, 'custom_lists')
          if (uebernehmen) db.run(`UPDATE custom_lists SET ${r.feld} = ? WHERE id = ?`, [wert as any, id])
        }
        return
      }
      case 'watch_order': {
        const trenner = r.zeile.lastIndexOf(':')
        const eId = entryId(r.zeile.slice(0, trenner))
        const anilistId = Number(r.zeile.slice(trenner + 1))
        if (!eId) return
        const vorhanden = dbGet('SELECT 1 AS x FROM watch_order WHERE entry_id = ? AND related_anilist_id = ?', [eId, anilistId])
        if (r.feld === '*') {
          if (vorhanden || neuer(r, letzteAenderung('watch_order', r.zeile, '-')) === false) return
          db.run(`INSERT INTO watch_order (entry_id, related_anilist_id, relation_type, position)
            VALUES (?, ?, 'SEQUEL', (SELECT COALESCE(MAX(position), -1) + 1 FROM watch_order WHERE entry_id = ?))`, [eId, anilistId, eId])
        } else if (r.feld === '-') {
          if (!vorhanden || letzteZeilenAenderung('watch_order', r.zeile, '-') > r.zeit) return
          db.run('DELETE FROM watch_order WHERE entry_id = ? AND related_anilist_id = ?', [eId, anilistId])
        } else if (vorhanden && SYNC_FELDER.watch_order.includes(r.feld)) {
          const aktuell = dbGet(`SELECT ${r.feld} AS v FROM watch_order WHERE entry_id = ? AND related_anilist_id = ?`, [eId, anilistId])?.v
          const { uebernehmen, wert } = entscheide(r, aktuell, 'watch_order')
          if (!uebernehmen) return
          db.run(`UPDATE watch_order SET ${r.feld} = ? WHERE entry_id = ? AND related_anilist_id = ?`, [wert as any, eId, anilistId])
        } else return
        geaendert.add(eId)
        return
      }
      case 'list_entries': {
        const [lUuid, eUuid] = r.zeile.split(':')
        const lId = listId(lUuid), eId = entryId(eUuid)
        if (!lId || !eId) return
        const gegenteil = letzteAenderung('list_entries', r.zeile, r.feld === '*' ? '-' : '*')
        if (!neuer(r, gegenteil)) return
        if (r.feld === '*') db.run('INSERT OR IGNORE INTO list_entries (list_id, entry_id) VALUES (?, ?)', [lId, eId])
        else db.run('DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?', [lId, eId])
        return
      }
      case 'achievements': {
        // Vereinigung: freigeschaltet ist freigeschaltet, das frühere Datum zählt
        db.run(`INSERT INTO achievements (id, name, unlocked_at) VALUES (?, '', ?)
          ON CONFLICT (id) DO UPDATE SET unlocked_at = MIN(unlocked_at, excluded.unlocked_at)`, [r.zeile, r.wert as any])
        return
      }
      case 'app_meta': {
        if (!SYNC_META.includes(r.zeile)) return
        const { uebernehmen, wert } = entscheide(r, meta(r.zeile), 'app_meta')
        if (uebernehmen) setzeMeta(r.zeile, String(wert))
        return
      }
    }
  }
}
