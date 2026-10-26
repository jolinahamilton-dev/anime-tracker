const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')

const electronPath = require('electron')

// Korrekter Pfad: src/main/main.ts → dist/main/main/main.js (rootDir=src, outDir=dist/main)
const mainJs = path.join(__dirname, '..', 'dist', 'main', 'main', 'main.js')

function waitForFile(filePath, retries = 60) {
  return new Promise((resolve, reject) => {
    function check() {
      try {
        const stat = fs.statSync(filePath)
        if (stat.size > 0) return resolve()
      } catch {}
      if (retries-- <= 0) return reject(new Error('TypeScript compilation timed out: ' + filePath))
      setTimeout(check, 500)
    }
    check()
  })
}

function waitForVite(port, retries = 60) {
  return new Promise((resolve, reject) => {
    function check() {
      http.get(`http://localhost:${port}`, (res) => {
        if (res.statusCode < 500) resolve(port)
        else retry()
      }).on('error', retry)
    }
    function retry() {
      if (retries-- <= 0) return reject(new Error('Vite did not start on port ' + port))
      setTimeout(check, 500)
    }
    check()
  })
}

console.log('Waiting for TypeScript compilation and Vite...')
console.log('Expecting main.js at:', mainJs)

Promise.all([
  waitForFile(mainJs),
  waitForVite(5173),
]).then(() => {
  console.log('Starting Electron...')
  const proc = spawn(String(electronPath), ['.'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  })
  proc.on('close', (code) => process.exit(code ?? 0))
}).catch((e) => {
  console.error('Startup failed:', e.message)
  process.exit(1)
})
