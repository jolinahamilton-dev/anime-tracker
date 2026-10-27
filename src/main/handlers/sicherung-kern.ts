// Komplette Sicherung als JSON-Datei: alle Einträge (mit Spitznamen, Bewertung, Fortschritt, Wiederholungen,
// Abschlussdatum), eigene Listen, Watch-Order, Achievements und die Daten hinter der Statistik.
// Verweise stehen als uuid statt als lokale Zahlen-ID drin – so passt die Datei auf jedes Gerät.
//
// Einspielen ersetzt den Stand: vorhandene Einträge (gleiche uuid) werden überschrieben, fehlende
// angelegt, nicht enthaltene gelöscht. Das läuft über die normalen Trigger, landet also im
// Änderungsprotokoll – der Abgleich überträgt den wiederhergestellten Stand aufs andere Gerät.
import { getDb, schedulePersist } from '../../db/database'
import type { SqlValue } from 'sql.js'

export const SICHERUNG_FORMAT = 'anime-tracker-sicherung'
const VERSION = 1

/** Lokale Einstellungen und Zähler, die mitgesichert werden (Geräte-ID, Abgleich und Google-Zugang nie) */
const META_SCHLUESSEL = ['darkMode', 'akzentfarbe', 'darstellung', 'first_open', 'open_days', 'last_export']

type Zeile = Record<string, unknown>

export interface Sicherung {
  format: typeof SICHERUNG_FORMAT
  version: number
  erstellt: string
  entries: Zeile[]
  custom_lists: Zeile[]
  list_entries: Array<{ list_uuid: string; entry_uuid: string }>
  watch_order: Zeile[]
  achievements: Zeile[]
  media_dauer: Zeile[]
  app_meta: Array<{ key: string; value: string }>
}

export interface SicherungInfo {
  erstellt: string
  eintraege: number
  listen: number
  achievements: number
}

function alle(sql: string, params: SqlValue[] = []): Zeile[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  const rows: Zeile[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as Zeile)
  stmt.free()
  return rows
}

function spalten(tabelle: string): string[] {
  return getDb().exec(`PRAGMA table_info(${tabelle})`)[0]?.values.map(r => String(r[1])) ?? []
}

export function erstelleSicherung(): Sicherung {
  const ohneId = (r: Zeile) => { const { id: _, ...rest } = r; return rest }
  return {
    format: SICHERUNG_FORMAT,
    version: VERSION,
    erstellt: new Date().toISOString(),
    entries: alle('SELECT * FROM entries ORDER BY title').map(ohneId),
    custom_lists: alle('SELECT * FROM custom_lists ORDER BY id').map(ohneId),
    list_entries: alle(`SELECT l.uuid AS list_uuid, e.uuid AS entry_uuid FROM list_entries le
      JOIN custom_lists l ON l.id = le.list_id JOIN entries e ON e.id = le.entry_id`) as any,
    watch_order: alle(`SELECT e.uuid AS entry_uuid, w.* FROM watch_order w JOIN entries e ON e.id = w.entry_id
      ORDER BY w.entry_id, w.position`).map(({ entry_id: _, ...rest }) => rest),
    achievements: alle('SELECT * FROM achievements'),
    media_dauer: alle('SELECT * FROM media_dauer'),
    app_meta: alle(`SELECT key, value FROM app_meta WHERE key IN (${META_SCHLUESSEL.map(() => '?').join(', ')})`,
      META_SCHLUESSEL) as any,
  }
}

/** Zeitpunkt der letzten Sicherung (für die Erinnerung) – erst aufrufen, wenn die Datei gespeichert ist */
export function merkeSicherung() {
  getDb().run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_backup', ?)", [new Date().toISOString()])
  schedulePersist()
}

export function sicherungAlsDatei(): { name: string; mime: string; daten: Uint8Array } {
  const s = erstelleSicherung()
  const d = new Date()
  const datum = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    name: `anime-tracker-sicherung-${datum}.json`,
    mime: 'application/json',
    daten: new TextEncoder().encode(JSON.stringify(s)),
  }
}

/** Prüft den Dateiinhalt; wirft eine verständliche Meldung, wenn es keine Sicherung ist */
export function leseSicherung(text: string): { sicherung: Sicherung; info: SicherungInfo } {
  let s: Sicherung
  try { s = JSON.parse(text.replace(/^﻿/, '')) } catch { throw new Error('Die Datei ist keine Sicherung des Anime Trackers.') }
  if (s?.format !== SICHERUNG_FORMAT || !Array.isArray(s.entries)) throw new Error('Die Datei ist keine Sicherung des Anime Trackers.')
  if (s.version > VERSION) throw new Error('Die Sicherung stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.')
  if (s.entries.some(e => typeof e.uuid !== 'string' || typeof e.title !== 'string')) throw new Error('Die Sicherung ist beschädigt.')
  for (const k of ['custom_lists', 'list_entries', 'watch_order', 'achievements', 'media_dauer', 'app_meta'] as const) {
    if (!Array.isArray(s[k])) (s as any)[k] = []
  }
  return {
    sicherung: s,
    info: { erstellt: s.erstellt, eintraege: s.entries.length, listen: s.custom_lists.length, achievements: s.achievements.length },
  }
}

/** Schreibt eine Zeile: vorhanden (laut wo) → UPDATE der übrigen Spalten, sonst INSERT */
function schreibe(tabelle: string, erlaubt: Set<string>, zeile: Zeile, wo: Record<string, SqlValue>) {
  const db = getDb()
  const felder = Object.keys(zeile).filter(k => erlaubt.has(k) && !(k in wo))
  const werte = felder.map(k => (zeile[k] ?? null) as SqlValue)
  const bedingung = Object.keys(wo).map(k => `${k} = ?`).join(' AND ')
  const vorhanden = db.exec(`SELECT 1 FROM ${tabelle} WHERE ${bedingung}`, Object.values(wo)).length > 0
  if (vorhanden) {
    if (felder.length) db.run(`UPDATE ${tabelle} SET ${felder.map(f => `${f} = ?`).join(', ')} WHERE ${bedingung}`,
      [...werte, ...Object.values(wo)])
  } else {
    const alleFelder = [...Object.keys(wo), ...felder]
    db.run(`INSERT INTO ${tabelle} (${alleFelder.join(', ')}) VALUES (${alleFelder.map(() => '?').join(', ')})`,
      [...Object.values(wo), ...werte])
  }
}

export function spieleSicherungEin(s: Sicherung): SicherungInfo {
  const db = getDb()
  const ohne = (tabelle: string, ...weg: string[]) => new Set(spalten(tabelle).filter(c => !weg.includes(c)))
  const entryFelder = ohne('entries', 'id', 'uuid')
  const listFelder = ohne('custom_lists', 'id', 'uuid')
  const woFelder = ohne('watch_order', 'entry_id', 'related_anilist_id')

  db.run('BEGIN')
  try {
    // Einträge und Listen: per uuid abgleichen
    const entryUuids = new Set(s.entries.map(e => e.uuid as string))
    for (const { uuid } of alle('SELECT uuid FROM entries')) {
      if (!entryUuids.has(uuid as string)) db.run('DELETE FROM entries WHERE uuid = ?', [uuid as string])
    }
    for (const e of s.entries) schreibe('entries', entryFelder, e, { uuid: e.uuid as string })

    const listUuids = new Set(s.custom_lists.map(l => l.uuid as string))
    for (const { uuid } of alle('SELECT uuid FROM custom_lists')) {
      if (!listUuids.has(uuid as string)) db.run('DELETE FROM custom_lists WHERE uuid = ?', [uuid as string])
    }
    for (const l of s.custom_lists) {
      if (typeof l.uuid === 'string') schreibe('custom_lists', listFelder, l, { uuid: l.uuid })
    }

    // Lokale IDs nach dem Schreiben
    const entryId = new Map(alle('SELECT id, uuid FROM entries').map(r => [r.uuid as string, r.id as number]))
    const listId = new Map(alle('SELECT id, uuid FROM custom_lists').map(r => [r.uuid as string, r.id as number]))

    // Listen-Zugehörigkeit
    const sollLe = new Set<string>()
    for (const le of s.list_entries) {
      const l = listId.get(le.list_uuid), e = entryId.get(le.entry_uuid)
      if (l === undefined || e === undefined) continue
      sollLe.add(`${l}:${e}`)
      db.run('INSERT OR IGNORE INTO list_entries (list_id, entry_id) VALUES (?, ?)', [l, e])
    }
    for (const r of alle('SELECT list_id, entry_id FROM list_entries')) {
      if (!sollLe.has(`${r.list_id}:${r.entry_id}`)) {
        db.run('DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?', [r.list_id as number, r.entry_id as number])
      }
    }

    // Watch-Order
    const sollWo = new Set<string>()
    for (const w of s.watch_order) {
      const e = entryId.get(w.entry_uuid as string)
      if (e === undefined || w.related_anilist_id == null) continue
      sollWo.add(`${e}:${w.related_anilist_id}`)
      schreibe('watch_order', woFelder, w, { entry_id: e, related_anilist_id: w.related_anilist_id as number })
    }
    for (const r of alle('SELECT entry_id, related_anilist_id FROM watch_order')) {
      if (!sollWo.has(`${r.entry_id}:${r.related_anilist_id}`)) {
        db.run('DELETE FROM watch_order WHERE entry_id = ? AND related_anilist_id = ?',
          [r.entry_id as number, r.related_anilist_id as number])
      }
    }

    // Achievements und Folgenlängen: ergänzen (freigeschaltet bleibt freigeschaltet)
    for (const a of s.achievements) {
      if (typeof a.id !== 'string') continue
      db.run('INSERT OR IGNORE INTO achievements (id, name, unlocked_at) VALUES (?, ?, ?)',
        [a.id, (a.name as string) ?? '', (a.unlocked_at as string) ?? new Date().toISOString()])
    }
    for (const m of s.media_dauer) {
      if (m.anilist_id == null || m.minuten == null) continue
      db.run('INSERT OR REPLACE INTO media_dauer (anilist_id, minuten) VALUES (?, ?)', [m.anilist_id as number, m.minuten as number])
    }

    // Einstellungen und Zähler; „seit" bleibt das frühere Datum, Öffnungstage werden vereinigt
    for (const { key, value } of s.app_meta) {
      if (!META_SCHLUESSEL.includes(key) || typeof value !== 'string') continue
      const jetzt = alle('SELECT value FROM app_meta WHERE key = ?', [key])[0]?.value as string | undefined
      let neu = value
      if (key === 'first_open' && jetzt && jetzt < value) neu = jetzt
      if (key === 'open_days' && jetzt) {
        try { neu = JSON.stringify([...new Set([...JSON.parse(jetzt), ...JSON.parse(value)])].sort().slice(-400)) } catch { /* Sicherung gewinnt */ }
      }
      db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, neu])
    }

    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  schedulePersist()
  return { erstellt: s.erstellt, eintraege: s.entries.length, listen: s.custom_lists.length, achievements: s.achievements.length }
}
