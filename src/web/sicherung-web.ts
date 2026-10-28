// Schutz beim Wiederherstellen in der Handy-Version: Sicherheitskopie des bisherigen Stands im
// Browser-Speicher („Rückgängig“) und Einspielen der automatischen Kopien aus src/web/datenbank.ts.
// Beides läuft als normale Wiederherstellung (sicherung-kern) – also auch über den Abgleich.
import { leseWert, schreibeWert, persistDb, lokaleKopien, oeffneKopie, wiederhergestelltAusKopie } from './datenbank'
import {
  VorherAblage, erstelleSicherung, infoMitVergleich, spieleMitKopieEin, vorherInfo, holeVorherZurueck, Sicherung, SicherungInfo,
} from '../main/handlers/sicherung-kern'

const VORHER = 'vor-wiederherstellung'

export const ablage: VorherAblage = {
  lies: () => leseWert<string>(VORHER),
  schreib: text => schreibeWert(VORHER, text),
}

/**
 * Für das Einspielen einer Datei (Handler in dateien-web.ts): legt vorher die Sicherheitskopie ab.
 * Liefert eine Funktion, die bei einem Fehlschlag die vorige Sicherheitskopie zurücklegt.
 */
export async function vorDemEinspielen(): Promise<() => Promise<void>> {
  const bisher = await ablage.lies().catch(() => null)
  await ablage.schreib(JSON.stringify(erstelleSicherung()))
  return async () => { if (bisher) await ablage.schreib(bisher).catch(() => {}) }
}

export { vorherInfo }

export async function zurueckholen(): Promise<{ fehler?: string; info?: SicherungInfo }> {
  const r = await holeVorherZurueck(ablage)
  if (r.info) await persistDb() // vor dem Neuladen der Seite sicher im Browser-Speicher
  return r
}

async function kopieAlsSicherung(nr: number): Promise<Sicherung> {
  const d = await oeffneKopie(nr)
  try {
    const s = erstelleSicherung(d)
    // Zeitpunkt der Kopie statt „jetzt“ – sonst sähe sie in der Rückfrage brandneu aus
    const erstellt = (await lokaleKopien()).find(k => k.nr === nr)?.erstellt
    return erstellt ? { ...s, erstellt } : s
  } finally {
    d.close()
  }
}

export async function kopieListe() {
  return { kopien: await lokaleKopien(), geladenAus: wiederhergestelltAusKopie }
}

export async function kopiePruefen(nr: number): Promise<{ fehler?: string; info?: SicherungInfo }> {
  try { return { info: infoMitVergleich(await kopieAlsSicherung(nr)) } } catch (e: any) { return { fehler: String(e?.message ?? e) } }
}

export async function kopieEinspielen(nr: number): Promise<{ fehler?: string; info?: SicherungInfo }> {
  try {
    const info = await spieleMitKopieEin(await kopieAlsSicherung(nr), ablage)
    await persistDb()
    return { info }
  } catch (e: any) {
    return { fehler: String(e?.message ?? e) }
  }
}
