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

## Umsetzung (Version 1.2)

### Gemeinsamer Code für PC und Handy
- `src/db/kern.ts`: Schema, Migrationen, Änderungsprotokoll, Zugriffsfunktionen (plattformunabhängig).
  `src/db/database.ts` (PC, Datei) und `src/web/datenbank.ts` (Handy, IndexedDB) laden und speichern nur.
- Die Handler in `src/main/handlers` laufen unverändert auch im Browser. Der Web-Build (`vite.web.config.ts`)
  ersetzt `electron` durch `src/web/electron-shim.ts` und die PC-Datenbank durch `src/web/datenbank.ts`.
  `src/web/api-web.ts` stellt dasselbe `window.api` bereit wie die Electron-Brücke.
- AniList-Abfragen laufen über `fetch` (geht im Main-Prozess und im Browser).

### Abgleich (`src/sync`)
- `abgleich.ts`: Gesamtstand erzeugen, eigene Änderungen auslesen, fremde einspielen.
- `krypto.ts`: AES-GCM, Schlüssel aus dem Abgleich-Passwort.
- `drive.ts`: Google-Drive-REST im App-Ordner.
- `dienst.ts`: Ablauf und die Handler `sync:*`.
- Regeln pro Feld:
  - Hat das andere Gerät genau unseren Stand geändert (`alt` = aktueller Wert), wird übernommen.
  - Sonst bei Fortschritt und Wiederholungen das Maximum, bei allen anderen Feldern die spätere Änderung.
  - Löschen gegen spätere Bearbeitung: Die Bearbeitung gewinnt.
  - Listen-Zuordnung: Die spätere Aktion gewinnt.
  - Achievements: Vereinigung mit dem frühesten Datum.
- Dateien im App-Ordner: `salz.json`, `stand_<gerät>_<bisNr>.json` (Gesamtstand) und `log_<gerät>_<von>_<bis>.json`,
  alle verschlüsselt. Ab 40 eigenen Log-Dateien wird zu einem neuen Gesamtstand zusammengefasst.
- Eingespielte fremde Zeilen landen mit fremder Geräte-ID im eigenen Protokoll. So werden sie nicht zurückgeschickt,
  und spätere Konflikte lassen sich gegen sie entscheiden.
- Test: `synctest.js` (zwei simulierte Geräte, Drive-Attrappe), 18/18 bestanden.

### Absicherung (Version 1.3, nach Sicherheits-Review)
- Dateiname ist per AES-GCM `additionalData` mitverschlüsselt: umbenannte Dateien sind unlesbar.
- PBKDF2 mit 600.000 Durchläufen, Passwort mind. 12 Zeichen, Unicode-NFC-normalisiert.
- Vor jedem Abgleich wird der Schlüssel gegen `salz.json` geprüft; passt er nicht (Passwort anderswo neu
  festgelegt, Drive geleert), wird der Schlüssel verworfen und neu gefragt. Gibt es zwei `salz.json`, gilt die ältere.
- Eine unlesbare Datei hält nur das betroffene Gerät an, nicht den ganzen Abgleich.
- Gesamtstände tragen pro Feld Zeit und Gerät der letzten echten Änderung und enthalten Löschvermerke –
  Zusammenfassen überstimmt so keine neueren Änderungen. Jedes Gerät lädt beim ersten Abgleich seinen Gesamtstand hoch
  (Reihenfolge PC/Handy egal); Trennen, neues Passwort oder fehlende eigene Dateien starten neu.
- `meta:get/set` nur für `darkMode` und `akzentfarbe`; Electron verweigert alle Berechtigungsanfragen.
- Web-App mit CSP (`<meta>`), keine Google Fonts mehr (Systemschrift), Cover-Cache per CORS und auf 600 begrenzt,
  Speicherfehler (z. B. Speicher voll) werden angezeigt.
- Offen/bewusst so: Alle Pages-Seiten des Kontos teilen sich den Ursprung `jolinahamilton-dev.github.io`
  (localStorage, IndexedDB). Dort keine fremden oder ungeprüften Seiten veröffentlichen.

### Anmeldung
- PC (`src/main/sync-pc.ts`): OAuth „Desktop-App" mit PKCE, Rückleitung auf `http://127.0.0.1:<Port>`.
  Der dauerhafte Zugang wird mit `safeStorage` verschlüsselt gespeichert. Der Clientschlüssel liegt in `src/main/geheim.local.ts`
  (nicht im Repository). Ohne diese Datei funktioniert nur die PC-Anmeldung nicht.
- Handy (`src/web/sync-web.ts`): OAuth für Browser-Apps (Token per Weiterleitung, ca. 1 h gültig), stille Erneuerung beim Öffnen.

### Veröffentlichung
- `.github/workflows/handy-app.yml` baut bei jedem Push auf `main` die Web-App und veröffentlicht sie auf GitHub Pages.
- Die PC-App wird weiterhin lokal gebaut (electron-builder).

### Später: Benachrichtigungen am Handy (später, optional)
Eine Web-App kann bei geschlossener App nicht zuverlässig im Hintergrund prüfen. Neue Folgen erscheinen deshalb
beim Öffnen der App. Wer echte Benachrichtigungen bei ausgeschaltetem PC will: dieselbe App als Android-App mit
**Capacitor** verpacken. AniList liefert die Sendezeiten (`airingAt`), daraus lassen sich lokale Wecker
planen, ganz ohne Server. Dafür braucht es Android Studio (oder einen Cloud-Build).

## Entscheidungen
1. Cloud: **Google Drive** (entschieden, OneDrive geht mit privatem Microsoft-Konto nicht ohne Azure).
2. GitHub: **jolinahamilton-dev**, Repository `anime-tracker`, Web-App unter https://jolinahamilton-dev.github.io/anime-tracker/
3. Offen, später: echte Android-App mit Benachrichtigungen (Capacitor) oder genügt die Web-App?
