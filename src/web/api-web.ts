// window.api der Handy-Version – dieselben Methoden wie die Electron-Brücke (src/preload/preload.ts),
// nur ruft sie die Handler direkt auf statt über IPC. Import/Export laufen über src/web/dateien-web.ts.
import { hoere } from './electron-shim'
import { speicherDauerhaft } from './datenbank'
import { ablage, vorDemEinspielen, vorherInfo, zurueckholen, kopieListe, kopiePruefen, kopieEinspielen } from './sicherung-web'

type Handler = (event: unknown, ...args: any[]) => unknown
const handler = new Map<string, Handler>()

/** Wird den register…Handlers-Funktionen statt ipcMain übergeben */
export const registry = {
  handle(kanal: string, fn: Handler) { handler.set(kanal, fn) },
} as any

async function invoke(kanal: string, ...args: unknown[]) {
  const fn = handler.get(kanal)
  if (!fn) throw new Error(`Unbekannte Aktion: ${kanal}`)
  return fn({ sender: null }, ...args)
}

const ereignis = (kanal: string) => (cb: (daten: any) => void) => hoere(kanal, cb)

export function baueApi() {
  return {
    istHandy: true,
    getEntries: () => invoke('entries:getAll'),
    getEntry: (id: number) => invoke('entries:get', id),
    createEntry: (data: unknown) => invoke('entries:create', data),
    updateEntry: (id: number, data: unknown) => invoke('entries:update', id, data),
    deleteEntry: (id: number) => invoke('entries:delete', id),
    setAbo: (id: number, abonniert: boolean) => invoke('entries:abo', id, abonniert),
    aendereFortschritt: (id: number, delta: number) => invoke('entries:fortschritt', id, delta),
    getWeiterschauen: () => invoke('entries:weiterschauen'),
    rueckgaengig: (token: string) => invoke('entries:rueckgaengig', token),

    getLists: () => invoke('lists:getAll'),
    createList: (name: string) => invoke('lists:create', name),
    renameList: (id: number, name: string) => invoke('lists:rename', id, name),
    deleteList: (id: number) => invoke('lists:delete', id),
    addToList: (listId: number, entryId: number) => invoke('lists:addEntry', listId, entryId),
    removeFromList: (listId: number, entryId: number) => invoke('lists:removeEntry', listId, entryId),

    getNews: () => invoke('news:getAll'),
    getNewsUnseenCount: () => invoke('news:getUnseenCount'),
    markAllNewsSeen: () => invoke('news:markAllSeen'),
    refreshNews: () => invoke('news:refresh'),

    getMeta: (key: string) => invoke('meta:get', key),
    setMeta: (key: string, value: string) => invoke('meta:set', key, value),
    getStats: () => invoke('stats:get'),
    getAchievements: () => invoke('achievements:getAll'),
    pruefeAchievements: () => Promise.resolve(),
    onAchievementNeu: ereignis('achievements:neu'),

    searchAniList: (query: string, type: string) => invoke('anilist:search', query, type),
    abgleichAniList: () => invoke('anilist:abgleichen'),
    onAbgleichFortschritt: ereignis('anilist:abgleichFortschritt'),

    syncSerien: () => invoke('serien:sync'),
    getNeueStaffeln: () => invoke('serien:neueStaffeln'),
    onSerienAktualisiert: ereignis('serien:aktualisiert'),

    syncStatus: () => invoke('sync:status'),
    syncVerbinden: () => invoke('sync:verbinden'),
    syncPasswort: (passwort: string) => invoke('sync:passwort', passwort),
    syncJetzt: () => invoke('sync:jetzt'),
    syncTrennen: () => invoke('sync:trennen'),
    syncKonto: () => invoke('sync:konto'),

    startInfo: () => invoke('start:info'),
    startMerke: (was: string) => invoke('start:merke', was),
    speicherDauerhaft: () => speicherDauerhaft(),

    getWatchOrder: (entryId: number) => invoke('watchorder:get', entryId),
    getAniListRelations: (anilistId: number) => invoke('watchorder:getRelations', anilistId),
    saveWatchOrder: (entryId: number, items: unknown[]) => invoke('watchorder:save', entryId, items),
    deleteWatchOrder: (entryId: number) => invoke('watchorder:delete', entryId),

    exportStarten: (opts: unknown) => invoke('export:start', opts),
    importCsv: () => invoke('import:csv'),
    sicherungErstellen: () => invoke('sicherung:erstellen'),
    sicherungWaehlen: () => invoke('sicherung:waehlen'),
    // Vor dem Einspielen den bisherigen Stand als Sicherheitskopie ablegen (für „Rückgängig“)
    sicherungEinspielen: async () => {
      const zuruecklegen = await vorDemEinspielen()
      try {
        const r: any = await invoke('sicherung:einspielen')
        if (!r?.info) await zuruecklegen()
        return r
      } catch (e) {
        await zuruecklegen()
        throw e
      }
    },
    sicherungVorher: () => vorherInfo(ablage),
    sicherungZurueckholen: () => zurueckholen(),
    lokaleKopien: () => kopieListe(),
    lokaleKopiePruefen: (nr: number) => kopiePruefen(nr),
    lokaleKopieEinspielen: (nr: number) => kopieEinspielen(nr),
  }
}
