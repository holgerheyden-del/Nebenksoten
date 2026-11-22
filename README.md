# Nebenkosten – Strom, Gas, Wasser (Web-App für iPhone)

Läuft ohne Apple-Developer-Account als Web-App (PWA): einmal ins Internet stellen,
in Safari öffnen, „Teilen → Zum Home-Bildschirm“ – fertig.

## Kostenlos veröffentlichen mit GitHub Pages (ca. 5 Minuten)
1. Kostenloses Konto auf github.com anlegen.
2. „New repository“ → Name z. B. `nebenkosten` → Public → Create.
3. „uploading an existing file“ → alle Dateien aus diesem Ordner hineinziehen → Commit.
4. Settings → Pages → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
5. Nach ca. 1 Minute läuft die App unter `https://DEIN-NAME.github.io/nebenkosten/`.
6. Auf dem iPhone in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

Den Link kannst du an jeden weitergeben – jeder hat seine eigenen Daten auf seinem Gerät.
HTTPS ist Pflicht (für Kamera und Offline-Modus); GitHub Pages liefert das automatisch.

## Funktionen
- Rechnung (PDF oder Foto) hochladen → Zeitraum, Verbrauch, Zählerstände, Arbeitspreis,
  Grundpreis, Abschlag, Kosten und Nachzahlung/Guthaben werden erkannt und zur Prüfung angezeigt.
- Zähler per Kamera ablesen: Rahmen um die Ziffern ziehen → Ziffern werden erkannt → korrigierbar.
  Plausibilitätsprüfung gegen den letzten Stand.
- Übersicht: Verbrauch, Kosten bisher vs. bezahlte Abschläge, Prognose Nachzahlung/Guthaben,
  passender Abschlag. Gas mit Vorjahres-Saisonprofil.
- Statistik: Verbrauch pro Jahr, Vergleich zum Vorjahr, Monatsvergleich, Abrechnungen im Vergleich.
- Erinnerung: wiederkehrender Kalendertermin am 1. jedes Monats (.ics), App-Badge wenn Ablesung fällig.
- Sicherung: JSON-Datei über das Teilen-Menü in iCloud Drive; Wiederherstellen auf jedem Gerät. CSV-Export.

## Technik
Reines HTML/JS, kein Server, keine Anmeldung. Daten im lokalen Speicher des Geräts.
Texterkennung: Tesseract.js, PDF: pdf.js (beim ersten Gebrauch von jsDelivr geladen, danach im Cache).
Dateien: index.html, app.js, sw.js (Offline), manifest.webmanifest, Icons.
