// Rendert build/icon.svg über ein unsichtbares Electron-Fenster in PNGs verschiedener
// Größen und packt sie zu einem gültigen Windows .ico (PNG-komprimierte ICO-Einträge,
// von Vista+ unterstützt). Kein zusätzliches npm-Paket nötig – nutzt nur Electron selbst.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SVG_PATH = path.join(__dirname, '..', 'build', 'icon.svg')
// Randlose Variante für Android (maskable) und iPhone (apple-touch-icon)
const SVG_MASKABLE = path.join(__dirname, '..', 'build', 'icon-maskable.svg')
const OUT_DIR = path.join(__dirname, '..', 'build')
const WEB_DIR = path.join(__dirname, '..', 'public', 'icons')

// Rendert die SVG EINMAL in voller Größe (1024) und skaliert danach im Speicher
// herunter — ein einziges BrowserWindow vermeidet Hänger bei wiederholter
// Fenstererzeugung/-zerstörung.
async function renderMaster(svgPfad = SVG_PATH) {
  const MASTER = 1024
  const win = new BrowserWindow({ width: MASTER, height: MASTER, useContentSize: true, frame: false, show: false, transparent: true })
  const svg = fs.readFileSync(svgPfad, 'utf-8')
  // 100vmin: Windows verkleinert das Fenster bei Anzeigeskalierung bzw. auf die Bildschirmhöhe –
  // so passt die Grafik trotzdem immer ganz hinein und wird danach auf 1024 gebracht
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden;}
    svg{width:100vmin;height:100vmin;display:block;}
  </style></head><body>${svg}</body></html>`
  const tmpHtml = path.join(OUT_DIR, '.tmp-icon-master.html')
  fs.writeFileSync(tmpHtml, html)
  try {
    await win.loadFile(tmpHtml)
    await new Promise(r => setTimeout(r, 400))
    const seite = await win.webContents.executeJavaScript('Math.min(innerWidth, innerHeight)')
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: seite, height: seite })
    return image.resize({ width: MASTER, height: MASTER, quality: 'best' })
  } finally {
    win.destroy()
    if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml)
  }
}

// Minimaler ICO-Writer mit PNG-komprimierten Einträgen
function buildIco(entries) {
  const count = entries.length
  const headerSize = 6
  const dirEntrySize = 16
  const offsetStart = headerSize + dirEntrySize * count

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const dirEntries = []
  const imageBuffers = []
  let offset = offsetStart

  for (const { size, png } of entries) {
    const dir = Buffer.alloc(dirEntrySize)
    dir.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, 1) // height
    dir.writeUInt8(0, 2) // color palette
    dir.writeUInt8(0, 3) // reserved
    dir.writeUInt16LE(1, 4) // color planes
    dir.writeUInt16LE(32, 6) // bits per pixel
    dir.writeUInt32LE(png.length, 8) // size of image data
    dir.writeUInt32LE(offset, 12) // offset of image data
    dirEntries.push(dir)
    imageBuffers.push(png)
    offset += png.length
  }

  return Buffer.concat([header, ...dirEntries, ...imageBuffers])
}

// Nicht beenden, wenn das erste Renderfenster zu ist – die randlose Variante folgt noch
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const masterImage = await renderMaster()
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), masterImage.toPNG())
  console.log('✓ icon.png (1024) erzeugt')

  const renders = SIZES.map(size => {
    const png = masterImage.resize({ width: size, height: size }).toPNG()
    fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), png)
    console.log(`✓ icon-${size}.png erzeugt`)
    return { size, png }
  })

  const ico = buildIco(renders)
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico)
  console.log('✓ icon.ico erzeugt')

  // Web-App (Handy) und Logo in der Kopfzeile
  for (const size of [192, 512]) {
    fs.writeFileSync(path.join(WEB_DIR, `icon-${size}.png`), masterImage.resize({ width: size, height: size, quality: 'best' }).toPNG())
    console.log(`✓ public/icons/icon-${size}.png erzeugt`)
  }
  if (fs.existsSync(SVG_MASKABLE)) {
    const voll = await renderMaster(SVG_MASKABLE)
    fs.writeFileSync(path.join(WEB_DIR, 'icon-maskable-512.png'), voll.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
    fs.writeFileSync(path.join(WEB_DIR, 'apple-touch-icon.png'), voll.resize({ width: 180, height: 180, quality: 'best' }).toPNG())
    console.log('✓ public/icons/icon-maskable-512.png und apple-touch-icon.png erzeugt')
  }

  app.quit()
})
