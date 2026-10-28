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
const QUELLEN = ['src/sync', 'src/db/kern.ts']

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
process.env.ANIME_TRACKER_TEST_BUILD = ziel

const filter = process.argv[2]
const tests = fs.readdirSync(path.join(WURZEL, 'tests'))
  .filter(n => n.endsWith('.test.js') && (!filter || n.includes(filter)))
  .sort()
if (!tests.length) { console.error('Keine Testdateien gefunden.'); process.exit(1) }
// Im selben Prozess laden: node:test führt die Tests nacheinander aus und setzt den Exit-Code
for (const t of tests) require(path.join(WURZEL, 'tests', t))
