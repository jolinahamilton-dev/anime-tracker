import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Content-Security-Policy nur im gepackten Build: erlaubt eigene Skripte und Bilder
// (AniList-Cover per https), sonst nichts. Netzanfragen laufen alle über den Main-Prozess.
// Im Dev-Modus braucht Vite Inline-Skripte für Hot-Reload, daher dort nicht aktiv.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"

function cspPlugin(): Plugin {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: html =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  build: {
    outDir: 'dist/renderer',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
  },
})
