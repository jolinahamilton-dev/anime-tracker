// Rendert alle wählbaren Logos (build/logos/*.svg) für die Apps. Aufruf: electron scripts/generate-logos.js
//   public/logos/<id>.png          256 px, abgerundet – Kopfzeile, Einstellungen, Fenstersymbol am PC
//   public/logos/<id>-maskable.png 512 px, randlos – Startbildschirm Android
//   public/logos/<id>-touch.png    180 px, randlos – Startbildschirm iPhone
//   public/manifest-<id>.webmanifest – die Web-App hängt beim Logowechsel das passende Manifest ein
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const QUELLE = path.join(__dirname, '..', 'build', 'logos')
const PUBLIC = path.join(__dirname, '..', 'public')
const ZIEL = path.join(PUBLIC, 'logos')
// Randlos: die Rundung des Rahmens (clipPath „rahmen“ bzw. „roundFrame“ beim Original) aufheben
const RANDLOS = '#rahmen rect, #roundFrame rect { rx: 0; ry: 0; }'

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  fs.mkdirSync(ZIEL, { recursive: true })
  const basis = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf-8'))
  const win = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true, frame: false, show: false, transparent: true })
  const tmp = path.join(QUELLE, '.tmp-logo.html')

  // 100vmin wie in generate-icon.js: unabhängig von Anzeigeskalierung und Bildschirmhöhe
  async function rendern(svg, zusatzCss = '') {
    fs.writeFileSync(tmp, `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}
      svg{width:100vmin;height:100vmin;display:block}${zusatzCss}</style>${svg}`)
    await win.loadFile(tmp)
    await new Promise(r => setTimeout(r, 300))
    const seite = await win.webContents.executeJavaScript('Math.min(innerWidth, innerHeight)')
    return win.webContents.capturePage({ x: 0, y: 0, width: seite, height: seite })
  }
  const png = (bild, groesse) => bild.resize({ width: groesse, height: groesse, quality: 'best' }).toPNG()

  try {
    for (const datei of fs.readdirSync(QUELLE).filter(d => d.endsWith('.svg'))) {
      const id = datei.replace(/\.svg$/, '')
      const svg = fs.readFileSync(path.join(QUELLE, datei), 'utf-8')
      fs.writeFileSync(path.join(ZIEL, `${id}.png`), png(await rendern(svg), 256))
      const voll = await rendern(svg, RANDLOS)
      fs.writeFileSync(path.join(ZIEL, `${id}-maskable.png`), png(voll, 512))
      fs.writeFileSync(path.join(ZIEL, `${id}-touch.png`), png(voll, 180))
      fs.writeFileSync(path.join(PUBLIC, `manifest-${id}.webmanifest`), JSON.stringify({
        ...basis,
        icons: [
          { src: `logos/${id}.png`, sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: `logos/${id}-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }, null, 2) + '\n')
      console.log(`✓ ${id}`)
    }
  } finally {
    win.destroy()
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    app.quit()
  }
})
