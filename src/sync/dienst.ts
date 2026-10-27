// Ablauf des Abgleichs über Google Drive und die zugehörigen Handler (sync:*).
// Plattformunabhängig – Anmeldung und Schlüssel-Ablage liefert die Plattform (PC bzw. Handy).
import type { IpcMain } from 'electron'
import { drive, DriveDatei } from './drive'
import { entschluessele, erzeugePruefwert, leiteSchluesselAb, MIN_PASSWORT, neuesSalz, passtSchluessel, verschluessele } from './krypto'
import {
  eigeneGeraeteId, gesamtstand, hochgeladenBis, letzteNr, LogZeile, neueEigeneAenderungen, setzeAbgleichZurueck,
  setzeHochgeladenBis, spieleEin,
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
  /** E-Mail-Adresse des verbundenen Google-Kontos (nur zur Anzeige, bleibt auf dem Gerät) */
  konto: string | null
}

export interface KontoInfo {
  konto: string | null
  /** Liegt in diesem Drive schon eine Sicherung (dann Passwort eingeben statt festlegen)? */
  hatSicherung: boolean
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

  const meta = (key: string) => (dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value as string) ?? null
  const setzeMeta = (key: string, wert: string | null) => {
    if (wert === null) getDb().run('DELETE FROM app_meta WHERE key = ?', [key])
    else getDb().run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, wert])
    schedulePersist()
  }

  async function status(): Promise<SyncStatus> {
    const verbunden = await plattform.istVerbunden()
    return {
      verbunden,
      passwortGesetzt: !!(await plattform.ladeSchluessel()),
      laeuft, letzterAbgleich: meta('sync_letzter'), fehler,
      konto: verbunden ? meta('sync_konto') : null,
    }
  }

  /** Nach dem Verbinden: welches Konto, und gibt es dort schon eine Sicherung? */
  async function kontoInfo(): Promise<KontoInfo> {
    const [konto, dateien] = await Promise.all([ablage.konto().catch(() => null), ablage.liste()])
    if (konto) setzeMeta('sync_konto', konto)
    return { konto: konto ?? meta('sync_konto'), hatSicherung: dateien.some(d => d.name === 'salz.json') }
  }

  /** Das gültige salz.json – haben zwei Geräte gleichzeitig eins angelegt, gilt das ältere */
  async function ladeSalz(dateien: DriveDatei[]): Promise<{ id: string; salz: string; pruef: string } | null> {
    const d = dateien.filter(x => x.name === 'salz.json')
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id))[0]
    if (!d) return null
    const { salz, pruef } = JSON.parse(await ablage.lade(d.id))
    return { id: d.id, salz, pruef }
  }

  /** Abgleich-Passwort festlegen (erstes Gerät) bzw. eingeben (weitere Geräte) */
  async function setzePasswort(passwort: string): Promise<{ ok: boolean; neu?: boolean; fehler?: string }> {
    if (passwort.length < MIN_PASSWORT) return { ok: false, fehler: `Das Passwort braucht mindestens ${MIN_PASSWORT} Zeichen.` }
    try {
      let s = await ladeSalz(await ablage.liste())
      let schluessel: string | null = null
      let neu = false
      if (!s) {
        const salz = neuesSalz()
        schluessel = await leiteSchluesselAb(passwort, salz)
        const id = await ablage.speichere('salz.json', JSON.stringify({ salz, pruef: await erzeugePruefwert(schluessel) }))
        s = await ladeSalz(await ablage.liste())
        if (s && s.id !== id) {
          // Ein anderes Gerät war im selben Moment schneller – dessen Passwort gilt
          await ablage.loesche(id)
          schluessel = null
        } else neu = true
      }
      if (!s) throw new Error('salz.json fehlt nach dem Anlegen')
      schluessel ??= await leiteSchluesselAb(passwort, s.salz)
      if (!(await passtSchluessel(schluessel, s.pruef))) {
        return { ok: false, fehler: 'Das Passwort passt nicht zu der Sicherung in diesem Google-Konto.' }
      }
      // Neuer Schlüssel = neuer Anfang: alles hochladen, alle anderen Geräte von vorn einspielen
      setzeAbgleichZurueck()
      await plattform.speichereSchluessel(schluessel)
      fehler = null
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
    const probleme: string[] = []
    try {
      const alle = await ablage.liste()

      // 0) Gilt unser Schlüssel noch? (Passwort auf einem anderen Gerät neu festgelegt oder Drive-Daten gelöscht)
      const salz = await ladeSalz(alle)
      if (!salz || !(await passtSchluessel(schluessel, salz.pruef))) {
        await plattform.speichereSchluessel(null)
        setzeAbgleichZurueck()
        throw new Error(salz
          ? 'Das Abgleich-Passwort wurde auf einem anderen Gerät neu festgelegt – bitte hier das neue Passwort eingeben.'
          : 'Die Abgleich-Daten in Google Drive fehlen – bitte das Abgleich-Passwort neu festlegen.')
      }

      const eigene = eigeneGeraeteId()
      const dateien = alle.map(zerlege).filter((n): n is Name => !!n)
      const lade = async <T>(n: Name) => entschluessele<T>(schluessel, await ablage.lade(n.datei.id), n.datei.name)

      // 1) Änderungen der anderen Geräte einspielen. Eine unlesbare Datei hält nur dieses Gerät an –
      //    es geht genau dort weiter, sobald sie lesbar ist; alle anderen Geräte laufen normal.
      const geaendert = new Set<number>()
      const fremde = [...new Set(dateien.filter(n => n.geraet !== eigene).map(n => n.geraet))]
      for (const g of fremde) {
        let bekannt = letzteNr(g)
        const stand = dateien.filter(n => n.geraet === g && n.art === 'stand').sort((a, b) => b.bis - a.bis)[0]
        const logs = dateien.filter(n => n.geraet === g && n.art === 'log').sort((a, b) => a.von - b.von)
        const neue: LogZeile[] = []
        try {
          // Gesamtstand nötig: Gerät noch nie gesehen, oder die nötigen Einzeldateien wurden schon zusammengefasst
          const luecke = bekannt !== null && !logs.some(l => l.von <= bekannt! + 1 && l.bis > bekannt!) && logs.some(l => l.bis > bekannt!)
          if (stand && (bekannt === null || luecke) && stand.bis > (bekannt ?? -1)) {
            const s = await lade<{ zeilen: LogZeile[] }>(stand)
            spieleEin(s.zeilen, { geraet: g, bisNr: stand.bis }).forEach(id => geaendert.add(id))
            bekannt = stand.bis
          }
          for (const l of logs) {
            if (l.bis <= (bekannt ?? 0)) continue
            // Nur Zeilen des Geräts, dem die Datei laut (mitverschlüsseltem) Namen gehört
            neue.push(...(await lade<{ zeilen: LogZeile[] }>(l)).zeilen.filter(z => z.geraet === g))
          }
        } catch (e) {
          console.error(`Abgleich: Datei von Gerät ${g} unlesbar`, e)
          probleme.push('Eine Datei des anderen Geräts ließ sich nicht entschlüsseln (beschädigt oder mit einem alten Passwort angelegt) und wurde übersprungen.')
        }
        if (neue.length) spieleEin(neue).forEach(id => geaendert.add(id))
      }

      // 2) Eigene Änderungen hochladen. Beim ersten Mal – oder wenn unsere Dateien in Drive fehlen –
      //    zuerst den kompletten Stand (alles von vor dem Protokoll ist sonst nicht dabei)
      let bis = hochgeladenBis()
      if (bis !== null && !dateien.some(n => n.geraet === eigene)) bis = null
      if (bis === null) {
        const gs = gesamtstand()
        const name = `stand_${eigene}_${gs.bisNr}.json`
        await ablage.speichere(name, await verschluessele(schluessel, gs, name))
        bis = gs.bisNr
        setzeHochgeladenBis(bis)
      }
      const zeilen = neueEigeneAenderungen(bis)
      if (zeilen.length) {
        const bisNeu = zeilen[zeilen.length - 1].nr
        const name = `log_${eigene}_${zeilen[0].nr}_${bisNeu}.json`
        await ablage.speichere(name, await verschluessele(schluessel, { zeilen }, name))
        setzeHochgeladenBis(bisNeu)
      }

      // 3) Aufräumen: viele kleine Dateien → ein neuer Gesamtstand, alte eigene Dateien weg
      const eigeneLogs = dateien.filter(n => n.geraet === eigene && n.art === 'log')
      if (eigeneLogs.length > MAX_EIGENE_LOGS) {
        const gs = gesamtstand()
        const name = `stand_${eigene}_${gs.bisNr}.json`
        await ablage.speichere(name, await verschluessele(schluessel, gs, name))
        for (const n of dateien.filter(n => n.geraet === eigene && n.bis <= gs.bisNr)) await ablage.loesche(n.datei.id)
      }

      setzeMeta('sync_letzter', new Date().toISOString())
      fehler = probleme.length ? probleme.join(' ') : null
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
    ipcMain.handle('sync:passwort', (_, passwort: string) => setzePasswort(String(passwort ?? '')))
    ipcMain.handle('sync:jetzt', () => abgleichen())
    ipcMain.handle('sync:konto', async () => {
      try { return await kontoInfo() } catch (e: any) { fehler = e?.message ?? String(e); return null }
    })
    ipcMain.handle('sync:trennen', async () => {
      await plattform.trennen()
      await plattform.speichereSchluessel(null)
      setzeMeta('sync_konto', null)
      // Beim erneuten Verbinden (evtl. mit geleertem Drive oder neuem Passwort) wieder alles hochladen
      setzeAbgleichZurueck()
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
