# Anleitung: Anime Tracker aufs Handy (Android) mit Google-Drive-Abgleich

So soll es am Ende laufen: PC und Handy haben je eine eigene Datenbank. Beide gleichen sich
verschlüsselt über einen **versteckten App-Ordner in deinem Google Drive** ab. Der PC muss dafür nicht laufen.
Die Handy-App ist eine Web-App. Sie wird kostenlos über GitHub bereitgestellt und landet wie eine
normale App auf dem Startbildschirm.

> Warum nicht OneDrive? Microsoft lässt private Microsoft-Konten nur noch mit einem Azure-Konto
> (Kreditkarte zur Prüfung) Apps registrieren. Google geht mit dem normalen Google-Konto, ohne Karte.

Es gibt drei Teile:
- **Teil A** erledigst du einmalig.
- **Teil B** baue ich danach.
- **Teil C** ist die Einrichtung am Handy.

---

## Teil A: Was du einmalig erledigst

### A1. Programme ✅ erledigt
Git 2.56 und GitHub CLI 2.103 sind installiert.

### A2. Bei GitHub anmelden
Im Terminal ausführen:
```
gh auth login --hostname github.com --git-protocol https --web
```
- Bei „Authenticate Git with your GitHub credentials?“ **Y** wählen.
- Es erscheint ein Code wie `ABCD-1234`, der Browser öffnet sich. Dort als **jolinahamilton-dev** anmelden, den Code eingeben und **Authorize** klicken.

Das Repository `anime-tracker` und die Veröffentlichung (GitHub Pages) lege ich danach über die GitHub CLI an.
Öffentlich ist dabei nur der **Programmcode**, deine Daten landen nie auf GitHub.
Die Handy-App liegt später unter **https://jolinahamilton-dev.github.io/anime-tracker/**

### A3. App bei Google registrieren (ca. 15 Minuten)
Am besten am PC. Nimm **das Google-Konto, das auch auf deinem Handy ist**.

**1) Projekt anlegen**
1. https://console.cloud.google.com öffnen und anmelden. Beim ersten Mal den Nutzungsbedingungen zustimmen.
   Eine Testphase oder Kreditkarte brauchst du **nicht**. Solche Angebote einfach wegklicken.
2. Oben links auf die Projektauswahl klicken → **Neues Projekt** → Name `Anime Tracker` → **Erstellen**.
   Danach oben sicherstellen, dass „Anime Tracker“ ausgewählt ist.

**2) Google Drive API einschalten**
1. Links ☰ → **APIs & Dienste** → **Bibliothek**.
2. Nach `Google Drive API` suchen → anklicken → **Aktivieren**.

**3) Zustimmungsbildschirm (was du bei der Anmeldung siehst)**
1. Links ☰ → **APIs & Dienste** → **OAuth-Zustimmungsbildschirm**. Das heißt eventuell „Google Auth Platform“.
   Dort auf **Jetzt starten** klicken.
2. App-Informationen: App-Name `Anime Tracker`, Nutzersupport-E-Mail = deine Adresse → **Weiter**.
3. Zielgruppe: **Extern** → **Weiter**.
4. Kontaktdaten: deine E-Mail-Adresse → **Weiter** → den Richtlinien zustimmen → **Erstellen**.
5. Links **Datenzugriff** → **Bereiche hinzufügen oder entfernen** → im Filter `drive.appdata` eingeben →
   `.../auth/drive.appdata` anhaken („…eigene Konfigurationsdaten in Google Drive…“) → **Aktualisieren** → **Speichern**.
   Damit sieht die App **nur ihren eigenen versteckten Ordner**, nicht deine Dateien oder Fotos.
6. Links **Branding** ausfüllen (sonst lässt sich die App nicht veröffentlichen):
   - App-Name: `Anime Tracker`, Nutzersupport-E-Mail: deine Adresse
   - App-Logo: leer lassen. Mit Logo verlangt Google eine Prüfung.
   - Startseite der Anwendung: `https://jolinahamilton-dev.github.io/anime-tracker/`
   - Link zur Datenschutzerklärung: `https://jolinahamilton-dev.github.io/anime-tracker/datenschutz.html`
   - Link zu den Nutzungsbedingungen: leer lassen
   - Autorisierte Domains: **Domain hinzufügen** → `jolinahamilton-dev.github.io`
   - Kontaktdaten des Entwicklers: deine E-Mail → **Speichern**
   (Die beiden Seiten gehen erst mit dem ersten Upload online. Das stört nicht, Google ruft sie nur bei einer Prüfung ab.)
7. Links **Zielgruppe** → unter *Veröffentlichungsstatus* **App veröffentlichen** → bestätigen.
   Warum: Im Status „Testen“ müsstest du dich alle 7 Tage neu anmelden.
   Eine Überprüfung durch Google ist für die private Nutzung nicht nötig, siehe A4.

**4) Zwei Zugangskennungen anlegen** (eine fürs Handy, eine für den PC)
1. Links **Clients** (bzw. *APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID*).
2. **Fürs Handy:** **Client erstellen**
   - Anwendungstyp: **Webanwendung**, Name `Anime Tracker Handy`
   - *Autorisierte JavaScript-Quellen*: `https://jolinahamilton-dev.github.io` (ohne `/` am Ende)
   - *Autorisierte Weiterleitungs-URIs*: `https://jolinahamilton-dev.github.io/anime-tracker/`
   - **Erstellen** → die **Client-ID** notieren (endet auf `.apps.googleusercontent.com`).
3. **Für den PC:** noch einmal **Client erstellen**
   - Anwendungstyp: **Desktop-App**, Name `Anime Tracker PC`
   - **Erstellen** → **Client-ID** und **Clientschlüssel** notieren.

### A4. Mir Bescheid geben
Schick mir:
- die Client-ID **Handy** (Webanwendung)
- die Client-ID **PC** (Desktop-App) und den Clientschlüssel dazu.
  Bei Desktop-Apps gilt dieser Schlüssel laut Google **nicht als geheim**, er steckt in jeder Desktop-App im Programm.
  Er gibt niemandem Zugriff auf dein Drive. Dafür ist immer zusätzlich deine Anmeldung nötig.

Gut zu wissen: Weil die App nicht von Google überprüft ist, zeigt Google bei der ersten Anmeldung
**„Google hat diese App nicht überprüft“**. Das ist bei selbst gebauten Apps normal.
Dann **Erweitert** → **Weiter zu Anime Tracker (unsicher)** klicken. Es ist deine eigene App.

---

## Teil B: Was ich dann baue

| Schritt | Was passiert | Stand |
|---|---|---|
| B1 | Repository https://github.com/jolinahamilton-dev/anime-tracker, GitHub Pages eingeschaltet | ✅ |
| B2 | Automatischer Build: Bei jedem Upload wird die Handy-App neu gebaut und veröffentlicht | ✅ online |
| B3 | Programmlogik vom PC-Teil getrennt, damit sie auch im Handy-Browser läuft | ✅ |
| B4 | Abgleich-Regeln: Fortschritt = höherer Wert, Status/Bewertung = letzte Änderung, Löschen gilt auf beiden Geräten | ✅ 12/12 Tests |
| B5 | Google-Drive-Anbindung in der PC-App (Version 1.2.0) | ✅ |
| B6 | Verschlüsselung mit einem **Abgleich-Passwort**: Daraus entsteht der Schlüssel, Google sieht nur unlesbare Daten | ✅ |
| B7 | Die Handy-App (Web-App mit Offline-Speicher) | ✅ |
| B8 | Erster echter Abgleich | **→ Teil C, das machst du** |

---

## Teil C: Einrichten (ab Version 1.4.0)

Ab 1.4.0 heißt der Bereich in den Einstellungen **„Konto & Cloud-Sicherung“** und das Passwort **Sicherungs-Passwort**
(früher „Abgleich-Passwort“ – es ist dasselbe). Welches Gerät zuerst kommt, ist egal; es geht auch mit **nur einem Gerät**.

### C1. Erstes Gerät (PC oder Handy)
1. Handy: In **Chrome** **https://jolinahamilton-dev.github.io/anime-tracker/** öffnen → **⋮ → „App installieren“**,
   ab dann über das Symbol starten. PC: App über UniGetUI/Scoop installieren.
2. Beim allerersten Start (leere Liste) erscheint die **Begrüßung** → **„☁ Mit Google anmelden“**.
   Sonst: **⚙️ → „Konto & Cloud-Sicherung“ → „☁ Mit Google anmelden“**.
3. Mit dem **eigenen Google-Konto** anmelden.
   - Bei **„Google hat diese App nicht überprüft“**: **Erweitert** → **Weiter zu Anime Tracker (unsicher)**.
   - Dann **Zulassen**. (PC: Es erscheint „✅ Verbunden“, das Browserfenster kannst du schließen.)
4. Zurück in der App steht **„Angemeldet als …“**. Ein **Sicherungs-Passwort** festlegen (mind. 12 Zeichen,
   z. B. vier zufällige Wörter) → **„Sicherung starten“**. **Passwort aufschreiben** – ohne es lässt sich nichts wiederherstellen.

### C2. Weiteres Gerät oder Wiederherstellen (neues Handy, Daten gelöscht)
1. Wie C1, Schritte 1–3, mit **demselben Google-Konto**.
2. Die App erkennt die vorhandene Sicherung („In diesem Google-Konto liegt schon eine Sicherung“) →
   **dasselbe Sicherungs-Passwort** eingeben → **„Sicherung übernehmen“**. Die Liste erscheint.

### C3. Eine andere Person (eigene Liste)
- Sie macht C1 auf ihrem Handy – mit **ihrem eigenen** Google-Konto und **eigenem** Passwort. Ihre Daten liegen in
  ihrem Drive, getrennt von deinen. **Nie ein gemeinsames Google-Konto nutzen**, sonst werden die Listen zusammengeführt.
- Ohne Google geht es auch: Begrüßung → **„Ohne Konto starten“**. Dann ab und zu unter
  **⚙️ → „Komplette Sicherung“ → „⬇ Sicherung speichern“** eine Datei anlegen (die App erinnert alle 14 Tage daran).
- Voraussetzung bei dir: In der Google Cloud Console (Projekt „Anime Tracker“ → **Google Auth Platform → Zielgruppe**)
  muss der Status **„In Produktion“** sein. Im Status „Testen“ dürfen sich nur eingetragene Testnutzer anmelden,
  und die Anmeldung läuft alle 7 Tage ab.
## Im Alltag
- **Abgleich**: automatisch beim Start, alle 5 Minuten und beim Verlassen der Handy-App. Unter Einstellungen gibt es zusätzlich „Jetzt abgleichen".
  Ohne Internet geht alles weiter, der Abgleich kommt dann später nach.
- **Gleichzeitig geändert?** Beim Fortschritt gewinnt die höhere Folge. Bei Status, Bewertung, Notizen usw. gewinnt die letzte Änderung.
- **Neue Folgen/Staffeln** erkennt jedes Gerät selbst. Am Handy erscheinen sie beim Öffnen der App.
- **Anmeldung am Handy**: Google erneuert sie beim Öffnen der App automatisch (die Seite lädt dabei kurz neu).
  Falls doch einmal „Anmeldung abgelaufen" erscheint: in den Einstellungen auf **„Neu anmelden"** tippen.
- **Der App-Ordner** ist in Google Drive unsichtbar. Unter *Einstellungen → Apps verwalten* siehst du „Anime Tracker“ mit seinem Speicherplatz, nur wenige MB.
  Dort **nicht auf „Daten löschen“** klicken.
- **Handy verloren / Browserdaten gelöscht?** App neu öffnen, verbinden, Passwort eingeben, und alles kommt aus Google Drive zurück.
- **Passwort vergessen?** In den Einstellungen „Abmelden" → im Google-Drive-App-Ordner die Daten löschen (siehe oben) → neu verbinden und ein neues Passwort festlegen. Am Handy meldet die App danach, dass das Passwort geändert wurde: dort einfach das neue eingeben.
- **Zugriff entziehen**: jederzeit unter https://myaccount.google.com/permissions.

## Häufige Stolpersteine
- *„redirect_uri_mismatch“ / „origin_mismatch“*: In A3/4 müssen die Adressen **genau** so lauten.
  Die Quelle steht ohne `/` am Ende, die Weiterleitung mit `/anime-tracker/`.
- *„Zugriff blockiert: App wurde nicht veröffentlicht“*: In A3/3 Schritt 7 die App veröffentlichen
  (oder dich unter Zielgruppe als Testnutzer eintragen).
- *Die Seite zeigt „404"*: Die Veröffentlichung dauert nach jedem Upload 1–2 Minuten.
