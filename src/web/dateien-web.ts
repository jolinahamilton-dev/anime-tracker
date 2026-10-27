// Import und Export der Handy-Version: statt der Windows-Dateidialoge öffnet der Import die Dateiauswahl
// des Handys, der Export landet als Download (Ordner „Downloads“).
import { importiereCsv } from '../main/handlers/import-kern'
import { erstelleExport, merkeExport, ExportOptions } from '../main/handlers/export-kern'

/** Öffnet die Dateiauswahl; null, wenn abgebrochen. Muss direkt aus einem Tippen heraus aufgerufen werden. */
function waehleDatei(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

function speichereDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function registerDateiHandlers(registry: { handle(kanal: string, fn: (...args: any[]) => unknown): void }) {
  registry.handle('import:csv', async () => {
    const datei = await waehleDatei('.csv,text/csv,text/comma-separated-values,text/plain')
    if (!datei) return { success: false, abgebrochen: true }
    return importiereCsv(await datei.text())
  })

  registry.handle('export:start', async (_event: unknown, opts: ExportOptions) => {
    const { name, mime, daten } = await erstelleExport(opts)
    const blob = new Blob([daten as BlobPart], { type: mime })
    speichereDownload(name, blob)
    merkeExport()
    return { success: true, pfad: `${name} (im Ordner „Downloads“)` }
  })
}
