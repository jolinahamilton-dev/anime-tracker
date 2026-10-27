// Erstellt die Export-Datei (CSV, Excel, PDF) als Bytes – ohne Dateisystem, damit PC (Speichern-Dialog)
// und Handy (Download) denselben Code nutzen.
import { dbAll, dbRun } from '../../db/database'

export type ExportFormat = 'csv' | 'excel' | 'pdf'

export interface ExportOptions {
  format: ExportFormat
  felder: string[]
  statusFilter?: string[]
}

export interface ExportDatei {
  name: string
  mime: string
  daten: Uint8Array
}

const FELD_LABEL: Record<string, string> = {
  title: 'Titel',
  type: 'Typ',
  genres: 'Genre',
  status: 'Status',
  rating: 'Bewertung',
  progress_episodes: 'Folgen (aktuell)',
  total_episodes: 'Folgen (gesamt)',
  progress_chapters: 'Kapitel (aktuell)',
  total_chapters: 'Kapitel (gesamt)',
  anilist_id: 'AniList-ID',
  rewatch_count: 'Wiederholungen',
}

const STATUS_LABEL: Record<string, string> = {
  started: 'Angefangen',
  ongoing: 'Laufend',
  completed: 'Beendet',
  planned: 'Geplant',
  dropped: 'Abgebrochen',
  paused: 'Pausiert',
}

export const EXPORT_TYP: Record<ExportFormat, { ext: string; mime: string; filterName: string }> = {
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8', filterName: 'CSV' },
  excel: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filterName: 'Excel' },
  pdf: { ext: 'pdf', mime: 'application/pdf', filterName: 'PDF' },
}

const ALLOWED_FELDER = new Set(Object.keys(FELD_LABEL))

function formatWert(key: string, wert: unknown): string {
  if (wert === null || wert === undefined) return ''
  if (key === 'status') return STATUS_LABEL[String(wert)] ?? String(wert)
  if (key === 'genres') {
    try { return JSON.parse(String(wert)).join(', ') } catch { return String(wert) }
  }
  if (key === 'rating') return wert ? `${wert}/5` : ''
  return String(wert)
}

function holeDaten(felder: string[], statusFilter?: string[]): Record<string, unknown>[] {
  const cols = felder.filter(f => ALLOWED_FELDER.has(f)).join(', ')
  if (!cols) return []
  if (statusFilter && statusFilter.length > 0) {
    const platzhalter = statusFilter.map(() => '?').join(', ')
    return dbAll(`SELECT ${cols} FROM entries WHERE status IN (${platzhalter}) ORDER BY title`, statusFilter)
  }
  return dbAll(`SELECT ${cols} FROM entries ORDER BY title`)
}

function exportCSV(felder: string[], statusFilter?: string[]): Uint8Array {
  const daten = holeDaten(felder, statusFilter)
  const header = felder.map(f => FELD_LABEL[f] ?? f).join(';')
  const zeilen = daten.map(row =>
    felder.map(f => {
      // Beginnt ein Wert mit = + - @, würde Excel ihn als Formel ausführen → als Text markieren
      const v = formatWert(f, row[f]).replace(/^[=+\-@\t\r]/, "'$&")
      return `"${v.replace(/"/g, '""')}"`
    }).join(';')
  )
  return new TextEncoder().encode('﻿' + [header, ...zeilen].join('\r\n'))
}

async function exportExcel(felder: string[], statusFilter?: string[]): Promise<Uint8Array> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet('Anime & Manga Liste')

  ws.columns = felder.map(f => ({
    header: FELD_LABEL[f] ?? f,
    key: f,
    width: 20,
  }))

  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF1A1A24' },
  }

  const daten = holeDaten(felder, statusFilter)
  for (const row of daten) {
    const mapped: Record<string, string> = {}
    for (const f of felder) mapped[f] = formatWert(f, row[f])
    ws.addRow(mapped)
  }

  return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
}

async function exportPDF(felder: string[], statusFilter?: string[]): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  doc.setFontSize(16)
  doc.text('Anime & Manga Liste', 14, 16)
  doc.setFontSize(9)

  const daten = holeDaten(felder, statusFilter)
  const headers = felder.map(f => FELD_LABEL[f] ?? f)
  const colW = Math.floor((doc.internal.pageSize.width - 28) / felder.length)

  let y = 26
  doc.setFont('helvetica', 'bold')
  headers.forEach((h, i) => doc.text(h.slice(0, 18), 14 + i * colW, y))
  y += 6
  doc.setFont('helvetica', 'normal')

  for (const row of daten) {
    if (y > doc.internal.pageSize.height - 14) {
      doc.addPage()
      y = 16
    }
    felder.forEach((f, i) => {
      const v = formatWert(f, row[f]).slice(0, 22)
      doc.text(v, 14 + i * colW, y)
    })
    y += 6
  }

  // output('arraybuffer') statt doc.save(): im Main-Prozess gibt es kein DOM
  return new Uint8Array(doc.output('arraybuffer'))
}

export async function erstelleExport(opts: ExportOptions): Promise<ExportDatei> {
  const typ = EXPORT_TYP[opts.format] ?? EXPORT_TYP.csv
  const daten =
    opts.format === 'excel' ? await exportExcel(opts.felder, opts.statusFilter) :
    opts.format === 'pdf' ? await exportPDF(opts.felder, opts.statusFilter) :
    exportCSV(opts.felder, opts.statusFilter)
  return { name: `anime-tracker-export.${typ.ext}`, mime: typ.mime, daten }
}

export function merkeExport() {
  dbRun("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_export', ?)", [new Date().toISOString()])
}
