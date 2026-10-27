// Rendert alle wählbaren Logos (build/logos/*.svg) zu public/logos/*.png – für Kopfzeile,
// Einstellungen und das Fenstersymbol am PC. Aufruf: electron scripts/generate-logos.js
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const QUELLE = path.join(__dirname, '..', 'build', 'logos')
const ZIEL = path.join(__dirname, '..', 'public', 'logos')
const GROESSE = 256

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  fs.mkdirSync(ZIEL, { recursive: true })
  const win = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true, frame: false, show: false, transparent: true })
  const tmp = path.join(QUELLE, '.tmp-logo.html')
  try {
    for (const datei of fs.readdirSync(QUELLE).filter(d => d.endsWith('.svg'))) {
      // 100vmin wie in generate-icon.js: unabhängig von Anzeigeskalierung und Bildschirmhöhe
      fs.writeFileSync(tmp, `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}
        svg{width:100vmin;height:100vmin;display:block}</style>${fs.readFileSync(path.join(QUELLE, datei), 'utf-8')}`)
      await win.loadFile(tmp)
      await new Promise(r => setTimeout(r, 300))
      const seite = await win.webContents.executeJavaScript('Math.min(innerWidth, innerHeight)')
      const bild = await win.webContents.capturePage({ x: 0, y: 0, width: seite, height: seite })
      const name = datei.replace(/\.svg$/, '.png')
      fs.writeFileSync(path.join(ZIEL, name), bild.resize({ width: GROESSE, height: GROESSE, quality: 'best' }).toPNG())
      console.log(`✓ public/logos/${name}`)
    }
  } finally {
    win.destroy()
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    app.quit()
  }
})
