import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Content-Security-Policy nur im gepackten Build: erlaubt eigene Skripte, Bilder
// (AniList-Cover per https) und die Schrift „Inter" von Google Fonts, sonst nichts.
// Im Dev-Modus braucht Vite Inline-Skripte für Hot-Reload, daher dort nicht aktiv.
const CSP = "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' https: data:; connect-src 'self'"

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
