import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Entries
  getEntries: () => ipcRenderer.invoke('entries:getAll'),
  getEntry: (id: number) => ipcRenderer.invoke('entries:get', id),
  createEntry: (data: unknown) => ipcRenderer.invoke('entries:create', data),
  updateEntry: (id: number, data: unknown) => ipcRenderer.invoke('entries:update', id, data),
  deleteEntry: (id: number) => ipcRenderer.invoke('entries:delete', id),
  setAbo: (id: number, abonniert: boolean) => ipcRenderer.invoke('entries:abo', id, abonniert),
  aendereFortschritt: (id: number, delta: number) => ipcRenderer.invoke('entries:fortschritt', id, delta),
  getWeiterschauen: () => ipcRenderer.invoke('entries:weiterschauen'),
  wiederholen: (id: number) => ipcRenderer.invoke('entries:wiederholen', id),
  rueckgaengig: (token: string) => ipcRenderer.invoke('entries:rueckgaengig', token),
  mehrere: (ids: number[], aktion: unknown) => ipcRenderer.invoke('entries:mehrere', ids, aktion),
  verknuepfungSuchen: (text: string) => ipcRenderer.invoke('verknuepfung:suchen', text),
  verknuepfungVorschau: (entryId: number, anilistId: number) => ipcRenderer.invoke('verknuepfung:vorschau', entryId, anilistId),
  verknuepfungAnwenden: (entryId: number, anilistId: number) => ipcRenderer.invoke('verknuepfung:anwenden', entryId, anilistId),
  staffelHinzufuegen: (entryId: number, anilistId: number, wo: string) => ipcRenderer.invoke('verknuepfung:staffelHinzufuegen', entryId, anilistId, wo),
  verknuepfungenPruefen: () => ipcRenderer.invoke('verknuepfung:pruefen'),
  verknuepfungenErgebnis: () => ipcRenderer.invoke('verknuepfung:ergebnis'),
  verknuepfungIgnorieren: (entryId: number) => ipcRenderer.invoke('verknuepfung:ignorieren', entryId),

  // Custom Lists
  getLists: () => ipcRenderer.invoke('lists:getAll'),
  createList: (name: string) => ipcRenderer.invoke('lists:create', name),
  renameList: (id: number, name: string) => ipcRenderer.invoke('lists:rename', id, name),
  deleteList: (id: number) => ipcRenderer.invoke('lists:delete', id),
  addToList: (listId: number, entryId: number) => ipcRenderer.invoke('lists:addEntry', listId, entryId),
  removeFromList: (listId: number, entryId: number) => ipcRenderer.invoke('lists:removeEntry', listId, entryId),

  // News
  getNews: () => ipcRenderer.invoke('news:getAll'),
  getNewsUnseenCount: () => ipcRenderer.invoke('news:getUnseenCount'),
  markAllNewsSeen: () => ipcRenderer.invoke('news:markAllSeen'),
  refreshNews: () => ipcRenderer.invoke('news:refresh'),

  // App Meta
  getMeta: (key: string) => ipcRenderer.invoke('meta:get', key),
  setMeta: (key: string, value: string) => ipcRenderer.invoke('meta:set', key, value),
  fensterLogo: (id: string) => ipcRenderer.invoke('fenster:logo', id),
  fensterNeuLaden: () => ipcRenderer.invoke('fenster:neuLaden'),

  // Statistiken
  getStats: () => ipcRenderer.invoke('stats:get'),
  getStreaming: (entryId: number) => ipcRenderer.invoke('streaming:get', entryId),
  oeffneStreaming: (url: string) => ipcRenderer.invoke('streaming:oeffne', url),

  // Achievements
  getAchievements: () => ipcRenderer.invoke('achievements:getAll'),
  pruefeAchievements: () => ipcRenderer.invoke('achievements:pruefen'),
  // Fix #13: Cleanup-Funktion zurückgeben damit React den Listener entfernen kann
  onAchievementNeu: (cb: (neu: unknown[]) => void) => {
    const handler = (_: unknown, neu: unknown[]) => cb(neu)
    ipcRenderer.on('achievements:neu', handler)
    return () => ipcRenderer.removeListener('achievements:neu', handler)
  },

  // AniList
  searchAniList: (query: string, type: string) => ipcRenderer.invoke('anilist:search', query, type),
  abgleichAniList: () => ipcRenderer.invoke('anilist:abgleichen'),
  onAbgleichFortschritt: (cb: (p: { aktuell: number; gesamt: number; titel: string }) => void) => {
    const handler = (_: unknown, p: { aktuell: number; gesamt: number; titel: string }) => cb(p)
    ipcRenderer.on('anilist:abgleichFortschritt', handler)
    return () => ipcRenderer.removeListener('anilist:abgleichFortschritt', handler)
  },

  // Vorschläge („✨ Für dich“)
  getVorschlaege: (neuBerechnen?: boolean) => ipcRenderer.invoke('vorschlaege:get', neuBerechnen),
  vorschlagAusblenden: (anilistId: number) => ipcRenderer.invoke('vorschlaege:ausblenden', anilistId),

  // Export
  exportStarten: (opts: unknown) => ipcRenderer.invoke('export:start', opts),

  // Import
  importCsv: () => ipcRenderer.invoke('import:csv'),

  // Begrüßung, Erinnerung an die Sicherung
  startInfo: () => ipcRenderer.invoke('start:info'),
  startMerke: (was: string) => ipcRenderer.invoke('start:merke', was),

  // Komplette Sicherung
  sicherungErstellen: () => ipcRenderer.invoke('sicherung:erstellen'),
  sicherungWaehlen: () => ipcRenderer.invoke('sicherung:waehlen'),
  sicherungEinspielen: () => ipcRenderer.invoke('sicherung:einspielen'),
  sicherungVorher: () => ipcRenderer.invoke('sicherung:vorher'),
  sicherungZurueckholen: () => ipcRenderer.invoke('sicherung:zurueckholen'),

  // Serien-Abgleich (neue Folgen/Staffeln)
  syncSerien: () => ipcRenderer.invoke('serien:sync'),
  getNeueStaffeln: () => ipcRenderer.invoke('serien:neueStaffeln'),
  onSerienAktualisiert: (cb: (daten: unknown) => void) => {
    const handler = (_: unknown, daten: unknown) => cb(daten)
    ipcRenderer.on('serien:aktualisiert', handler)
    return () => ipcRenderer.removeListener('serien:aktualisiert', handler)
  },

  // Abgleich mit dem Handy (Google Drive)
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncVerbinden: () => ipcRenderer.invoke('sync:verbinden'),
  syncPasswort: (passwort: string) => ipcRenderer.invoke('sync:passwort', passwort),
  syncJetzt: () => ipcRenderer.invoke('sync:jetzt'),
  syncTrennen: () => ipcRenderer.invoke('sync:trennen'),
  syncKonto: () => ipcRenderer.invoke('sync:konto'),

  // Watch Order
  getWatchOrder: (entryId: number) => ipcRenderer.invoke('watchorder:get', entryId),
  getAniListRelations: (anilistId: number) => ipcRenderer.invoke('watchorder:getRelations', anilistId),
  saveWatchOrder: (entryId: number, items: unknown[], quelle?: string) => ipcRenderer.invoke('watchorder:save', entryId, items, quelle),
  deleteWatchOrder: (entryId: number) => ipcRenderer.invoke('watchorder:delete', entryId),
})
