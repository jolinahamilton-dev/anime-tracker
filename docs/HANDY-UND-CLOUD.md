# Handy-Version mit Cloud-Abgleich (Android, ohne laufenden PC)

Ziel: Die App läuft auch auf einem Android-Handy, wenn der PC aus ist. PC und Handy haben je eine
eigene Datenbank und gleichen sich über einen Cloud-Ordner ab. Kosten: keine.

```
  PC (Electron)                         Handy (Web-App / PWA)
  SQLite-Datei                          SQLite im Browser (IndexedDB)
  sync_log  ── eigene Änderungen ──►  Google Drive (App-Ordner)  ◄── eigene Änderungen ── sync_log
            ◄── fremde Änderungen ──   verschlüsselte Dateien     ── fremde Änderungen ──►
```

## Schon erledigt (Version 1.1)

| Baustein | Wo | Wozu |
|---|---|---|
| Eine Datenschnittstelle für alle Seiten | `src/renderer/api.ts` (`TrackerApi`) | Die Handy-Version liefert eine eigene Umsetzung; alle Seiten bleiben unverändert |
| Handy-taugliche Oberfläche | CSS unter 640 px, `BottomSheet`, `useIstHandy`, `useWischen` | Filter-Fenster, große Knöpfe, „+1", Wischen zum Blättern, kein Zoomen beim Tippen |
| Stabile IDs | `entries.uuid`, `custom_lists.uuid` | Die Zahlen-IDs sind nur pro Gerät eindeutig |
| Geräte-ID | `app_meta.geraet_id` | Wer hat was geändert |
| Änderungsprotokoll | Tabelle `sync_log` + Trigger in `src/db/database.ts` | Jede Änderung mit Zeit, Gerät, Tabelle, Zeile, Feld, Wert; Löschungen als Feld `-` |
| Nur echte Änderungen | `schreibeWatchOrder()` (UPSERT statt Löschen+Einfügen) | Das Protokoll bleibt klein und eindeutig |
| Pause beim Einspielen | `app_meta.sync_pause` | Fremde Änderungen werden beim Einspielen nicht erneut protokolliert |
| Was synchronisiert wird | `SYNC_FELDER`, `SYNC_META` | Nur eigene Daten; was jedes Gerät selbst von AniList holt, bleibt lokal |

## Was noch fehlt (in dieser Reihenfolge)

### 1. Kern vom Electron-Teil trennen (Programmierung)
Die Handler in `src/main/handlers/*.ts` mischen Logik und Electron (`ipcMain`, `BrowserWindow`, `net`).
Aufteilen in
- `src/kern/*.ts`: reine Funktionen mit der Datenbank als Parameter (Einträge, +1, Watch-Order,
  Serien-Abgleich, News, Statistik, Achievements). AniList-Abfragen über `fetch` (erlaubt AniList auch im Browser).
- `src/main/handlers/*.ts`: nur noch `ipcMain.handle('…', (_, …a) => kern.funktion(db, …a))`.

Danach kann der Browser denselben Kern benutzen.

### 2. Abgleich-Logik `src/sync/merge.ts` (Programmierung)
Regeln beim Zusammenführen pro Feld:
- Fortschritt (`progress_*`): **höherer Wert gewinnt**. Zwei Geräte zählen gleichzeitig hoch, dann geht nichts verloren.
  Bewusstes Zurücksetzen wird als eigene Aktion markiert.
- Status, Bewertung, Favorit, Rezension, Spitzname, Abo, Reihenfolge: **letzte Änderung gewinnt**.
- `bekannte_ids`, `auto_offen`, Achievements: **Vereinigung** (nichts geht verloren).
- Löschen gegen Bearbeiten: die spätere Aktion gewinnt.
- Statusänderungen der automatischen Staffel-Erkennung verlieren immer gegen eine Änderung von dir.
- Uhrzeit: Hybrid-Uhr (Zeit + Zähler + Gerät), damit falsch gehende Handy-Uhren nichts durcheinanderbringen.

Ablauf eines Abgleichs (beim Start, alle 15 Minuten, beim Schließen):
1. Eigene neue `sync_log`-Zeilen in eine Datei schreiben, verschlüsseln, hochladen.
2. Neue Dateien der anderen Geräte herunterladen.
3. Mit `sync_pause` einspielen, Seite neu laden.
4. Ab und zu einen komprimierten Gesamtstand hochladen, damit ein neues Gerät nicht alles einzeln einspielen muss.
   **Der erste Abgleich ist immer ein Gesamtstand vom PC**, denn alles vor Version 1.1 steht noch nicht im Protokoll.

### 3. Cloud-Anbindung (Programmierung + einmalig du)
- **Google Drive, App-Ordner** (`spaces=appDataFolder`, Berechtigung `drive.appdata`):
  Die App sieht nur ihren eigenen versteckten Ordner, nicht deine Dateien.
  (OneDrive verworfen: Private Microsoft-Konten können Apps nur noch mit einem Azure-Konto registrieren.)
- Verschlüsselung (XChaCha20-Poly1305): Der Schlüssel entsteht am PC und kommt per **QR-Code** aufs Handy.
  Google sieht nur unlesbare Daten.
- Anmeldung:
  - Handy: Google Identity Services, Token-Modell. OAuth-Client „Webanwendung“, Quelle `https://jolinahamilton-dev.github.io`.
  - PC: OAuth-Client „Desktop-App“ mit PKCE und Rückleitung auf `http://127.0.0.1:<Port>`. Das Token liegt verschlüsselt über `safeStorage`.
- Die einmaligen Schritte für dich stehen in **ANLEITUNG-HANDY-GOOGLE-DRIVE.md**.

### 4. Die Handy-App selbst (Programmierung + einmalig du)
- **Web-App (PWA)**: derselbe React-Code, dazu `manifest.webmanifest` und ein Service Worker für die Offline-Nutzung.
  Am Handy in Chrome öffnen und „Zum Startbildschirm hinzufügen" wählen. Sie startet dann wie eine normale App, auch ohne Internet.
- Die Datenbank läuft im Browser (sql.js, dieselbe wie am PC) und wird in IndexedDB gespeichert.
- `src/renderer/api.ts` bekommt eine zweite Umsetzung (`BrowserApi`), die den Kern aus Schritt 1 direkt aufruft.
- **Hosting**: kostenlos über **GitHub Pages** (HTTPS ist Pflicht für installierbare Web-Apps).
  **Du brauchst dafür** ein kostenloses GitHub-Konto. Darüber ließen sich auch die PC-Updates verteilen.
  Deine Daten liegen dort nicht, nur der Programmcode.

### 5. Benachrichtigungen am Handy (später, optional)
Eine Web-App kann bei geschlossener App nicht zuverlässig im Hintergrund prüfen. Neue Folgen erscheinen deshalb
beim Öffnen der App. Wer echte Benachrichtigungen bei ausgeschaltetem PC will: dieselbe App als Android-App mit
**Capacitor** verpacken. AniList liefert die Sendezeiten (`airingAt`), daraus lassen sich lokale Wecker
planen, ganz ohne Server. Dafür braucht es Android Studio (oder einen Cloud-Build).

## Entscheidungen
1. Cloud: **Google Drive** (entschieden, OneDrive geht mit privatem Microsoft-Konto nicht ohne Azure).
2. GitHub: **jolinahamilton-dev**, Repository `anime-tracker`, Web-App unter https://jolinahamilton-dev.github.io/anime-tracker/
3. Offen, später: echte Android-App mit Benachrichtigungen (Capacitor) oder genügt die Web-App?
