/** Text in die Zwischenablage kopieren; true, wenn es geklappt hat (PC-App und Handy-Browser) */
export async function kopiereText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* kein Zugriff (z. B. ohne Fokus/HTTPS) → Ersatzweg über ein unsichtbares Textfeld */ }
  try {
    const feld = document.createElement('textarea')
    feld.value = text
    feld.setAttribute('readonly', '')
    feld.style.cssText = 'position:fixed;top:0;left:0;opacity:0;user-select:text'
    document.body.appendChild(feld)
    feld.select()
    const ok = document.execCommand('copy')
    feld.remove()
    return ok
  } catch {
    return false
  }
}
