import { IpcMain, dialog, BrowserWindow } from 'electron'
import { dbAll, dbRun } from '../../db/database'
import fs from 'fs'

type ExportFormat = 'csv' | 'excel' | 'pdf'

interface ExportOptions {
  format: ExportFormat
  felder: string[]
  statusFilter?: string[]
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

async function exportCSV(felder: string[], zielPfad: string, statusFilter?: string[]) {
  const daten = holeDaten(felder, statusFilter)
  const header = felder.map(f => FELD_LABEL[f] ?? f).join(';')
  const zeilen = daten.map(row =>
    felder.map(f => {
      const v = formatWert(f, row[f])
      return `"${v.replace(/"/g, '""')}"`
    }).join(';')
  )
  fs.writeFileSync(zielPfad, '﻿' + [header, ...zeilen].join('\r\n'), 'utf8')
}

async function exportExcel(felder: string[], zielPfad: string, statusFilter?: string[]) {
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

  await wb.xlsx.writeFile(zielPfad)
}

async function exportPDF(felder: string[], zielPfad: string, statusFilter?: string[]) {
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

  // Fix #4: Buffer-basierter Write statt doc.save() (kein DOM im Main-Prozess)
  const buffer = Buffer.from(doc.output('arraybuffer'))
  fs.writeFileSync(zielPfad, buffer)
}

export function registerExportHandlers(ipcMain: IpcMain) {
  ipcMain.handle('export:start', async (event, opts: ExportOptions) => {
    const ext = opts.format === 'csv' ? 'csv' : opts.format === 'excel' ? 'xlsx' : 'pdf'
    const filter =
      opts.format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] :
      opts.format === 'excel' ? [{ name: 'Excel', extensions: ['xlsx'] }] :
      [{ name: 'PDF', extensions: ['pdf'] }]

    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined as any, {
      title: 'Export speichern',
      defaultPath: `anime-tracker-export.${ext}`,
      filters: filter,
    })

    if (result.canceled || !result.filePath) return { success: false }

    const ziel = result.filePath

    if (opts.format === 'csv') await exportCSV(opts.felder, ziel, opts.statusFilter)
    else if (opts.format === 'excel') await exportExcel(opts.felder, ziel, opts.statusFilter)
    else await exportPDF(opts.felder, ziel, opts.statusFilter)

    dbRun("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_export', ?)", [new Date().toISOString()])

    return { success: true, pfad: ziel }
  })
}
