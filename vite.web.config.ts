// Build der Handy-Version (Web-App für GitHub Pages): dieselbe Oberfläche und dieselben Handler wie
// am PC. „electron" und die PC-Datenbankdatei werden durch Browser-Gegenstücke ersetzt.
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'

// Content-Security-Policy (GitHub Pages kann keine Header setzen, das <meta> wirkt trotzdem): nur eigene
// Skripte (+ WebAssembly für SQLite), Netz nur zu AniList und Google Drive. Im Dev-Modus nicht aktiv.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "img-src 'self' data: blob: https://*.anilist.co https://img.anili.st; " +
  'connect-src \'self\' https://graphql.anilist.co https://www.googleapis.com https://oauth2.googleapis.com; ' +
  "worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"

function cspPlugin(): Plugin {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: html =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }
}

// Service Worker (public/sw.js): Version und Liste der gebauten Dateien hineinschreiben. So ändert sich sw.js
// mit jedem Build (→ Handy holt das Update), der Worker lädt den ganzen Build vorab und prüft, dass die
// Startseite dazu passt. public/ ist beim writeBundle schon ins Ausgabeverzeichnis kopiert.
function swBuildPlugin(): Plugin {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  return {
    name: 'sw-build',
    apply: 'build',
    writeBundle(options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') throw new Error('sw-build: index.html fehlt im Build')
      const index = hash(String(html.source))
      const dateien = Object.keys(bundle).filter(d => d !== 'index.html' && !d.endsWith('.map')).sort()
      const version = hash(index + dateien.join('\n')).slice(0, 12)
      const ziel = path.join(options.dir!, 'sw.js')
      const quelle = fs.readFileSync(ziel, 'utf8')
      const marker = /\/\*BUILD\*\/[\s\S]*?\/\*BUILD\*\//
      if (!marker.test(quelle)) throw new Error('sw-build: Marker /*BUILD*/ in sw.js fehlt')
      fs.writeFileSync(ziel, quelle.replace(marker, () => JSON.stringify({ version, index, dateien })))
    },
  }
}

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  base: '/anime-tracker/',
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react(), cspPlugin(), swBuildPlugin()],
  resolve: {
    alias: [
      { find: /^electron$/, replacement: path.resolve(__dirname, 'src/web/electron-shim.ts') },
      { find: /^(\.\.\/)+db\/database$/, replacement: path.resolve(__dirname, 'src/web/datenbank.ts') },
      { find: '@', replacement: path.resolve(__dirname, 'src/renderer') },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
  },
  server: { port: 5174 },
})
