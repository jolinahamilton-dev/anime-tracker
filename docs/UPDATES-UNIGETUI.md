# PC-App über UniGetUI installieren und aktualisieren

Neue Versionen der PC-App erscheinen als **GitHub-Release** (gebaut von `.github/workflows/pc-release.yml`).
Gleichzeitig wird das Scoop-Manifest `bucket/anime-tracker.json` in diesem Repository aktualisiert.
Dieses Repository ist also selbst ein Scoop-„Bucket“ – UniGetUI zeigt darüber neue Versionen an.

## Einmalig einrichten

### 1. Secret für den Build (einmal, im Browser)
Der Build auf GitHub braucht den Google-Clientschlüssel der PC-App (steht in `src/main/geheim.local.ts`, beginnt mit `GOCSPX-`).
1. https://github.com/jolinahamilton-dev/anime-tracker/settings/secrets/actions öffnen
2. **New repository secret** → Name: `GOOGLE_CLIENT_SECRET`, Secret: den Wert `GOCSPX-…` (ohne Anführungszeichen) → **Add secret**

### 2. UniGetUI: Scoop einschalten und den Bucket hinzufügen
1. UniGetUI → **Einstellungen → Paketmanager → Scoop**: aktivieren. Falls Scoop fehlt, bietet UniGetUI **„Scoop installieren“** an.
2. Im selben Scoop-Bereich unter **Buckets** → **Bucket hinzufügen**:
   - Name: `anime-tracker`
   - URL: `https://github.com/jolinahamilton-dev/anime-tracker`
   (Alternativ im Terminal: `scoop bucket add anime-tracker https://github.com/jolinahamilton-dev/anime-tracker`)
3. In UniGetUI nach **anime-tracker** suchen → Quelle **Scoop** → **Installieren**.
   Danach steht „Anime Tracker“ im Startmenü (Ordner *Scoop Apps*).
4. Die alte Version unter **Windows-Einstellungen → Apps → Anime Tracker → Deinstallieren** entfernen.
   Deine Liste bleibt erhalten – sie liegt getrennt von der App in `%APPDATA%\anime-tracker`.

## Im Alltag
- UniGetUI meldet neue Versionen unter **Updates**. Vor dem Aktualisieren die App schließen.
- Die Daten (Liste, Sicherungen, Abgleich) bleiben bei jedem Update unverändert.

## Neue Version veröffentlichen (macht Claude)
1. `version` in `package.json` erhöhen, committen.
2. Annotierten Tag mit den Änderungen anlegen und hochladen: `git tag -a v1.4.0 -m "…Änderungen…"` → `git push origin v1.4.0`
3. Der Workflow prüft, dass Tag und `package.json` übereinstimmen, baut Installer + Zip, legt das Release an
   (Text = Tag-Nachricht) und setzt Version + Prüfsumme im Scoop-Manifest.
