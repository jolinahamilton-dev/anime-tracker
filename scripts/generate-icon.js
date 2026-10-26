// Rendert build/icon.svg über ein unsichtbares Electron-Fenster in PNGs verschiedener
// Größen und packt sie zu einem gültigen Windows .ico (PNG-komprimierte ICO-Einträge,
// von Vista+ unterstützt). Kein zusätzliches npm-Paket nötig – nutzt nur Electron selbst.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SVG_PATH = path.join(__dirname, '..', 'build', 'icon.svg')
const OUT_DIR = path.join(__dirname, '..', 'build')

// Rendert die SVG EINMAL in voller Größe (1024) und skaliert danach im Speicher
// herunter — ein einziges BrowserWindow vermeidet Hänger bei wiederholter
// Fenstererzeugung/-zerstörung.
async function renderMaster() {
  const MASTER = 1024
  const win = new BrowserWindow({ width: MASTER, height: MASTER, show: false, transparent: true })
  const svg = fs.readFileSync(SVG_PATH, 'utf-8')
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden;}
    svg{width:${MASTER}px;height:${MASTER}px;display:block;}
  </style></head><body>${svg}</body></html>`
  const tmpHtml = path.join(OUT_DIR, '.tmp-icon-master.html')
  fs.writeFileSync(tmpHtml, html)
  try {
    await win.loadFile(tmpHtml)
    await new Promise(r => setTimeout(r, 400))
    const image = await win.webContents.capturePage()
    return image
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

  app.quit()
})
