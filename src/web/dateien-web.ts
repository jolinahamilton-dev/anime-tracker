// Import, Export und Sicherung der Handy-Version: statt der Windows-Dateidialoge öffnet sich die
// Dateiauswahl des Handys, Exporte und Sicherungen landen als Download (Ordner „Downloads“).
import { importiereCsv } from '../main/handlers/import-kern'
import { erstelleExport, merkeExport, ExportOptions } from '../main/handlers/export-kern'
import { persistDb, leseWert, schreibeWert } from './datenbank'
import { registerImportLaufHandlers, ImportAblage } from '../main/handlers/anilist-import'
import { istGzip } from '../main/handlers/import-fremd'
import { sicherungAlsDatei, leseSicherung, spieleSicherungEin, merkeSicherung, Sicherung } from '../main/handlers/sicherung-kern'

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

  let ausgewaehlt: Sicherung | null = null

  registry.handle('sicherung:erstellen', async () => {
    const { name, mime, daten } = sicherungAlsDatei()
    speichereDownload(name, new Blob([daten as BlobPart], { type: mime }))
    merkeSicherung()
    return { success: true, pfad: `${name} (im Ordner „Downloads“)` }
  })

  registry.handle('sicherung:waehlen', async () => {
    const datei = await waehleDatei('.json,application/json')
    if (!datei) return { abgebrochen: true }
    try {
      const { sicherung, info } = leseSicherung(await datei.text())
      ausgewaehlt = sicherung
      return { info }
    } catch (e: any) {
      return { fehler: String(e?.message ?? e) }
    }
  })

  registry.handle('sicherung:einspielen', async () => {
    if (!ausgewaehlt) return { fehler: 'Keine Sicherung ausgewählt.' }
    const info = spieleSicherungEin(ausgewaehlt)
    ausgewaehlt = null
    await persistDb() // vor dem Neuladen der Seite sicher im Browser-Speicher
    return { info }
  })
}

// Sicherheitskopie vor einem Import und Merkzettel des letzten Laufs im Browser-Speicher
const importAblage: ImportAblage = {
  lies: s => leseWert<string>(s === 'sicherung' ? 'vor-import' : 'import-lauf'),
  schreib: (s, text) => schreibeWert(s === 'sicherung' ? 'vor-import' : 'import-lauf', text),
}

/** Entpackt .gz mit dem Browser (DecompressionStream), sonst Text unverändert */
async function alsText(datei: File): Promise<string> {
  const bytes = new Uint8Array(await datei.arrayBuffer())
  if (!istGzip(bytes)) return new TextDecoder().decode(bytes)
  if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann .gz nicht entpacken – bitte die Datei vorher entpacken.')
  try {
    const strom = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
    return await new Response(strom).text()
  } catch {
    throw new Error('Die Datei ließ sich nicht entpacken (kaputte .gz-Datei?).')
  }
}

export function registerImportLauf(registry: { handle(kanal: string, fn: (...args: any[]) => unknown): void }) {
  registerImportLaufHandlers(registry as any, {
    ablage: importAblage,
    async waehleDatei() {
      const datei = await waehleDatei('.xml,.gz,.csv,text/xml,text/csv,application/gzip,application/x-gzip,text/plain')
      return datei ? { name: datei.name, text: await alsText(datei) } : null
    },
  })
}
