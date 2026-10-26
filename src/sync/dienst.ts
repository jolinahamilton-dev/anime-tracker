// Ablauf des Abgleichs über Google Drive und die zugehörigen Handler (sync:*).
// Plattformunabhängig – Anmeldung und Schlüssel-Ablage liefert die Plattform (PC bzw. Handy).
import type { IpcMain } from 'electron'
import { drive, DriveDatei } from './drive'
import { entschluessele, erzeugePruefwert, leiteSchluesselAb, neuesSalz, passtSchluessel, verschluessele } from './krypto'
import {
  eigeneGeraeteId, gesamtstand, hochgeladenBis, letzteNr, LogZeile, neueEigeneAenderungen, setzeHochgeladenBis, spieleEin,
} from './abgleich'
import { dbGet, getDb, schedulePersist } from '../db/kern'

export interface SyncPlattform {
  istVerbunden(): Promise<boolean>
  /** Gültiger Zugangstoken; wirft, wenn nicht (mehr) verbunden */
  holeToken(): Promise<string>
  verbinden(): Promise<void>
  trennen(): Promise<void>
  ladeSchluessel(): Promise<string | null>
  speichereSchluessel(schluessel: string | null): Promise<void>
  /** Seiten neu laden lassen (geänderte Eintrags-IDs) */
  benachrichtige(geaendert: number[]): void
}

export interface SyncStatus {
  verbunden: boolean
  passwortGesetzt: boolean
  laeuft: boolean
  letzterAbgleich: string | null
  fehler: string | null
}

const MAX_EIGENE_LOGS = 40

interface Name { art: 'stand' | 'log'; geraet: string; von: number; bis: number; datei: DriveDatei }
function zerlege(d: DriveDatei): Name | null {
  let m = /^stand_([0-9a-f]+)_(\d+)\.json$/.exec(d.name)
  if (m) return { art: 'stand', geraet: m[1], von: 0, bis: Number(m[2]), datei: d }
  m = /^log_([0-9a-f]+)_(\d+)_(\d+)\.json$/.exec(d.name)
  if (m) return { art: 'log', geraet: m[1], von: Number(m[2]), bis: Number(m[3]), datei: d }
  return null
}

export function erstelleSyncDienst(plattform: SyncPlattform) {
  const ablage = drive(() => plattform.holeToken())
  let laeuft = false
  let fehler: string | null = null

  const letzterAbgleich = () => (dbGet("SELECT value FROM app_meta WHERE key = 'sync_letzter'")?.value as string) ?? null

  async function status(): Promise<SyncStatus> {
    return {
      verbunden: await plattform.istVerbunden(),
      passwortGesetzt: !!(await plattform.ladeSchluessel()),
      laeuft, letzterAbgleich: letzterAbgleich(), fehler,
    }
  }

  /** Abgleich-Passwort festlegen (erstes Gerät) bzw. eingeben (weitere Geräte) */
  async function setzePasswort(passwort: string): Promise<{ ok: boolean; neu?: boolean; fehler?: string }> {
    if (passwort.length < 8) return { ok: false, fehler: 'Das Passwort braucht mindestens 8 Zeichen.' }
    try {
      const dateien = await ablage.liste()
      const salzDatei = dateien.find(d => d.name === 'salz.json')
      let schluessel: string
      let neu = false
      if (salzDatei) {
        const { salz, pruef } = JSON.parse(await ablage.lade(salzDatei.id))
        schluessel = await leiteSchluesselAb(passwort, salz)
        if (!(await passtSchluessel(schluessel, pruef))) {
          return { ok: false, fehler: 'Das Passwort passt nicht zu dem, das auf dem anderen Gerät festgelegt wurde.' }
        }
      } else {
        const salz = neuesSalz()
        schluessel = await leiteSchluesselAb(passwort, salz)
        await ablage.speichere('salz.json', JSON.stringify({ salz, pruef: await erzeugePruefwert(schluessel) }))
        neu = true
      }
      await plattform.speichereSchluessel(schluessel)
      await abgleichen()
      return { ok: true, neu }
    } catch (e: any) {
      return { ok: false, fehler: e?.message ?? String(e) }
    }
  }

  async function abgleichen(): Promise<SyncStatus> {
    if (laeuft) return status()
    const schluessel = await plattform.ladeSchluessel()
    if (!schluessel || !(await plattform.istVerbunden())) return status()
    laeuft = true
    try {
      const eigene = eigeneGeraeteId()
      const dateien = (await ablage.liste()).map(zerlege).filter((n): n is Name => !!n)
      const lade = async <T>(n: Name) => entschluessele<T>(schluessel, await ablage.lade(n.datei.id))

      // 1) Änderungen der anderen Geräte einspielen
      const geaendert = new Set<number>()
      const fremde = [...new Set(dateien.filter(n => n.geraet !== eigene).map(n => n.geraet))]
      for (const g of fremde) {
        let bekannt = letzteNr(g)
        const stand = dateien.filter(n => n.geraet === g && n.art === 'stand').sort((a, b) => b.bis - a.bis)[0]
        const logs = dateien.filter(n => n.geraet === g && n.art === 'log').sort((a, b) => a.von - b.von)
        // Gesamtstand nötig: Gerät noch nie gesehen, oder die nötigen Einzeldateien wurden schon zusammengefasst
        const luecke = bekannt !== null && !logs.some(l => l.von <= bekannt! + 1 && l.bis > bekannt!) && logs.some(l => l.bis > bekannt!)
        if (stand && (bekannt === null || luecke) && stand.bis > (bekannt ?? -1)) {
          const s = await lade<{ zeilen: LogZeile[] }>(stand)
          spieleEin(s.zeilen, { geraet: g, bisNr: stand.bis }).forEach(id => geaendert.add(id))
          bekannt = stand.bis
        }
        const neue: LogZeile[] = []
        for (const l of logs) if (l.bis > (bekannt ?? 0)) neue.push(...(await lade<{ zeilen: LogZeile[] }>(l)).zeilen)
        if (neue.length) spieleEin(neue).forEach(id => geaendert.add(id))
      }

      // 2) Eigene Änderungen hochladen
      let bis = hochgeladenBis()
      if (bis === null) {
        if (!dateien.some(n => n.geraet !== eigene)) {
          // Erstes Gerät: kompletter Stand (alles von vor dem Protokoll ist sonst nicht dabei)
          const gs = gesamtstand()
          await ablage.speichere(`stand_${eigene}_${gs.bisNr}.json`, await verschluessele(schluessel, gs))
          bis = gs.bisNr
        } else bis = 0
        setzeHochgeladenBis(bis)
      }
      const zeilen = neueEigeneAenderungen(bis)
      if (zeilen.length) {
        const bisNeu = zeilen[zeilen.length - 1].nr
        await ablage.speichere(`log_${eigene}_${zeilen[0].nr}_${bisNeu}.json`, await verschluessele(schluessel, { zeilen }))
        setzeHochgeladenBis(bisNeu)
      }

      // 3) Aufräumen: viele kleine Dateien → ein neuer Gesamtstand, alte eigene Dateien weg
      const eigeneLogs = dateien.filter(n => n.geraet === eigene && n.art === 'log')
      if (eigeneLogs.length > MAX_EIGENE_LOGS) {
        const gs = gesamtstand()
        await ablage.speichere(`stand_${eigene}_${gs.bisNr}.json`, await verschluessele(schluessel, gs))
        for (const n of dateien.filter(n => n.geraet === eigene && n.bis <= gs.bisNr)) await ablage.loesche(n.datei.id)
      }

      getDb().run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', ['sync_letzter', new Date().toISOString()])
      schedulePersist()
      fehler = null
      if (geaendert.size) plattform.benachrichtige([...geaendert])
    } catch (e: any) {
      fehler = e?.message ?? String(e)
      console.error('Abgleich fehlgeschlagen:', e)
    } finally {
      laeuft = false
    }
    return status()
  }

  function registriere(ipcMain: IpcMain) {
    ipcMain.handle('sync:status', () => status())
    ipcMain.handle('sync:verbinden', async () => {
      try { await plattform.verbinden(); fehler = null } catch (e: any) { fehler = e?.message ?? String(e) }
      return status()
    })
    ipcMain.handle('sync:passwort', (_, passwort: string) => setzePasswort(passwort))
    ipcMain.handle('sync:jetzt', () => abgleichen())
    ipcMain.handle('sync:trennen', async () => {
      await plattform.trennen()
      await plattform.speichereSchluessel(null)
      fehler = null
      return status()
    })
  }

  /** Regelmäßig im Hintergrund abgleichen (nur wenn verbunden und Passwort gesetzt) */
  function starteAutomatik(abstandMs: number) {
    const lauf = () => { abgleichen().catch(console.error) }
    lauf()
    return setInterval(lauf, abstandMs)
  }

  return { status, abgleichen, setzePasswort, registriere, starteAutomatik }
}
