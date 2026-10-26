// Build der Handy-Version (Web-App für GitHub Pages): dieselbe Oberfläche und dieselben Handler wie
// am PC. „electron" und die PC-Datenbankdatei werden durch Browser-Gegenstücke ersetzt.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  base: '/anime-tracker/',
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react()],
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
