// Liest CSV-Text ein und legt neue Einträge an – ohne Dateisystem, damit PC und Handy denselben Code nutzen.
import { dbGet, dbRunGetId } from '../../db/database'

const STATUS_MAP: Record<string, string> = {
  'angefangen': 'started',
  'laufend': 'ongoing',
  'beendet': 'completed',
  'geplant': 'planned',
  'abgebrochen': 'dropped',
  'pausiert': 'paused',
  'started': 'started',
  'ongoing': 'ongoing',
  'completed': 'completed',
  'planned': 'planned',
  'dropped': 'dropped',
  'paused': 'paused',
}

const HEADER_MAP: Record<string, string> = {
  'titel': 'title',
  'title': 'title',
  'typ': 'type',
  'type': 'type',
  'genre': 'genres',
  'genres': 'genres',
  'status': 'status',
  'bewertung': 'rating',
  'rating': 'rating',
  'folgen (aktuell)': 'progress_episodes',
  'folgen (gesamt)': 'total_episodes',
  'kapitel (aktuell)': 'progress_chapters',
  'kapitel (gesamt)': 'total_chapters',
  'anilist-id': 'anilist_id',
  'anilist_id': 'anilist_id',
}

function parseCSV(inhalt: string): Array<Record<string, string>> {
  const zeilen = inhalt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(z => z.trim())
  if (zeilen.length < 2) return []

  function splitZeile(zeile: string, trenner: string): string[] {
    const felder: string[] = []
    let aktuell = ''
    let inAnfuehrung = false
    for (let i = 0; i < zeile.length; i++) {
      const c = zeile[i]
      if (c === '"') {
        if (inAnfuehrung && zeile[i + 1] === '"') { aktuell += '"'; i++ }
        else inAnfuehrung = !inAnfuehrung
      } else if (c === trenner && !inAnfuehrung) {
        felder.push(aktuell); aktuell = ''
      } else {
        aktuell += c
      }
    }
    felder.push(aktuell)
    return felder
  }

  // Trennzeichen erkennen (Semikolon oder Komma)
  const trenner = zeilen[0].includes(';') ? ';' : ','
  const headers = splitZeile(zeilen[0].replace(/^﻿/, ''), trenner).map(h => h.trim().toLowerCase())

  return zeilen.slice(1).map(zeile => {
    const werte = splitZeile(zeile, trenner)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (werte[i] ?? '').trim() })
    return obj
  })
}

export function importiereCsv(inhalt: string) {
  const zeilen = parseCSV(inhalt)

  let importiert = 0
  let uebersprungen = 0
  const fehler: string[] = []

  for (const zeile of zeilen) {
    try {
      // Header auf interne Feldnamen mappen
      const mapped: Record<string, string> = {}
      for (const [key, val] of Object.entries(zeile)) {
        const intern = HEADER_MAP[key]
        if (intern) mapped[intern] = val
      }

      const title = mapped['title']?.trim()
      if (!title) { uebersprungen++; continue }

      // Typ normalisieren
      const typRoh = (mapped['type'] ?? '').toUpperCase()
      const typ = typRoh === 'MANGA' ? 'MANGA' : 'ANIME'

      // Status normalisieren
      const statusRoh = (mapped['status'] ?? '').toLowerCase()
      const status = STATUS_MAP[statusRoh] ?? 'planned'

      // Bewertung: "3/5" → 3, oder direkte Zahl
      let rating: number | null = null
      if (mapped['rating']) {
        const match = mapped['rating'].match(/^(\d+)/)
        if (match) {
          const n = parseInt(match[1])
          if (n >= 1 && n <= 5) rating = n
        }
      }

      // Genres: "Action, Comedy" → JSON-Array
      let genres = '[]'
      if (mapped['genres']) {
        const liste = mapped['genres'].split(',').map(g => g.trim()).filter(Boolean)
        genres = JSON.stringify(liste)
      }

      const toInt = (v: string | undefined) => {
        const n = parseInt(v ?? '')
        return isNaN(n) ? null : n
      }

      const anilistId = toInt(mapped['anilist_id'])

      // Duplikat prüfen (gleiche AniList-ID oder gleicher Titel + Typ)
      const duplikat = dbGet(
        'SELECT id FROM entries WHERE (anilist_id IS NOT NULL AND anilist_id = ?) OR (title = ? AND type = ?)',
        [anilistId, title, typ]
      )
      if (duplikat) { uebersprungen++; continue }

      dbRunGetId(
        `INSERT INTO entries (anilist_id, type, title, genres, status, rating,
          progress_episodes, total_episodes, progress_chapters, total_chapters)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [anilistId, typ, title, genres, status, rating,
         // progress_* sind NOT NULL – ein explizites NULL würde den DEFAULT 0 umgehen
         toInt(mapped['progress_episodes']) ?? 0, toInt(mapped['total_episodes']),
         toInt(mapped['progress_chapters']) ?? 0, toInt(mapped['total_chapters'])]
      )
      importiert++
    } catch (e: any) {
      fehler.push(String(e?.message ?? e))
    }
  }

  return { success: true, importiert, uebersprungen, fehler }
}
