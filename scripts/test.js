// Automatische Tests (node:test, ohne zusätzliche Pakete).
// Übersetzt die benötigten TypeScript-Quellen mit dem TypeScript aus node_modules in einen
// temporären Ordner (außerhalb des Projekts) und führt dann alle tests/*.test.js aus.
//   npm test                 – alle Tests
//   npm test -- abgleich     – nur Testdateien, deren Name „abgleich“ enthält
const fs = require('fs')
const os = require('os')
const path = require('path')
const ts = require('typescript')

const WURZEL = path.join(__dirname, '..')
// Achievements samt Abhängigkeiten (database/stats/anilist) – „electron“ wird unten durch eine Attrappe ersetzt
const QUELLEN = ['src/sync', 'src/db/kern.ts', 'src/db/database.ts', 'src/main/handlers/achievements.ts',
  'src/main/handlers/stats.ts', 'src/main/handlers/anilist.ts', 'src/main/trackAppOpen.ts', 'src/main/handlers/vorschlaege.ts']

const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-tracker-tests-'))
process.on('exit', () => { try { fs.rmSync(ziel, { recursive: true, force: true }) } catch { /* egal */ } })

const dateien = QUELLEN.flatMap(q => {
  const voll = path.join(WURZEL, q)
  return fs.statSync(voll).isDirectory()
    ? fs.readdirSync(voll).filter(n => n.endsWith('.ts')).map(n => path.join(voll, n))
    : [voll]
})
for (const datei of dateien) {
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(datei, 'utf8'), {
    fileName: datei,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  })
  if (diagnostics?.length) {
    console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => WURZEL, getNewLine: () => '\n' }))
    process.exit(1)
  }
  const aus = path.join(ziel, path.relative(path.join(WURZEL, 'src'), datei)).replace(/\.ts$/, '.js')
  fs.mkdirSync(path.dirname(aus), { recursive: true })
  fs.writeFileSync(aus, outputText)
}
// Die übersetzten Dateien finden sql.js usw. über das node_modules des Projekts
process.env.NODE_PATH = path.join(WURZEL, 'node_modules')
require('module').Module._initPaths()
// Attrappe für „electron“: die übersetzten Main-Handler laden es, die Tests brauchen davon nichts
const Modul = require('module')
const ladeModul = Modul._load
Modul._load = function (name, ...rest) {
  if (name === 'electron') return { app: {}, ipcMain: { handle() {} }, net: {}, shell: {}, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null } }
  return ladeModul.call(this, name, ...rest)
}
process.env.ANIME_TRACKER_TEST_BUILD = ziel

const filter = process.argv[2]
const tests = fs.readdirSync(path.join(WURZEL, 'tests'))
  .filter(n => n.endsWith('.test.js') && (!filter || n.includes(filter)))
  .sort()
if (!tests.length) { console.error('Keine Testdateien gefunden.'); process.exit(1) }
// Im selben Prozess laden: node:test führt die Tests nacheinander aus und setzt den Exit-Code
for (const t of tests) require(path.join(WURZEL, 'tests', t))
