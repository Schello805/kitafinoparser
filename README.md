# Kitafino-Wächter

Prüft morgens, ob für deine Tochter bei Kitafino ein Essen bestellt ist, zeigt
den aktuellen Tages- und Wochenstatus inklusive Guthaben auf einer modernen
Webseite, schickt zur eingestellten Uhrzeit eine Push-Nachricht an deinen
ntfy-Server und kann eine Homematic-Systemvariable für Alexa-Sprachausgaben befüllen.

## Starten

```bash
npm install
npm start
```

Die lokale Webseite ist erreichbar unter:

- **http://localhost:3010**

## Funktionen der Webseite

- **Tagesstatus auf einen Blick**:
  - Zeigt sofort an, ob für heute ein Essen bestellt ist (inkl. Menüname, Preis und Storno-/Bestellfristen).
  - Erkennt schulfreie Tage und Tage ohne Angebot (z. B. *„Freitags kein Essensangebot“*), ohne Fehlalarm zu schlagen.
- **Konto & Guthaben**: Zeigt Name des Kindes, Einrichtung und aktuelles Kitafino-Guthaben mit Warnstatus bei niedrigem Stand.
- **Wochenübersicht**: Zeigt alle Tage der aktuellen Woche, hebt den heutigen Tag hervor und listet die ausgewählten Gerichte.
- **📅 Familienkalender-Abo (iCal / .ics)**:
  - Generiert einen dynamischen iCal-Kalenderfeed aller bestellten und angebotenen Essen der Woche.
  - Per Klick direkt in Apple Kalender, Google Kalender, Outlook oder Thunderbird als abonnierter Kalender (`webcal://` oder `http://.../calendar.ics`) einbindbar.
  - Zeigt im Kalendertermin sofort, welches Menü bestellt ist und ob der Tag bestellt oder abbestellt ist.
- **💰 Guthaben-Wächter & Auflade-Warnung**:
  - Überwacht das Kitafino-Konto bei jedem Abruf.
  - Fällt das Guthaben unter den Schwellenwert (z. B. `10,00 €`), wird automatisch eine ntfy-Warnung (*„💰 Kitafino Guthaben niedrig: Bitte Konto aufladen!“*) gesendet.
  - Kann optional eine Homematic-Logikvariable (`Kitafino_Guthaben_Warnung`) auf `true` setzen oder den exakten Betrag in eine Zahl-Variable schreiben.
- **Manuelle Aktionen**:
  - *Jetzt prüfen*: Ruft Kitafino sofort live ab.
  - *Prüfen & ntfy*: Prüft Kitafino und sendet direkt eine ntfy-Nachricht und Homematic-Aktualisierung.
  - *ntfy Test*: Sendet eine Test-Benachrichtigung an ntfy.
  - *Guthaben-Test*: Sendet eine Test-Guthabenwarnung an ntfy und Homematic.
- **Settings (direkt im Browser einstellbar)**:
  - **Uhrzeit der Nachricht (Zeitplan)**: Morgendliche Prüfzeit (z. B. `06:30`) mit Option *Nur Schultage (Mo–Fr)*.
  - **Kitafino-Zugangsdaten**: Benutzername und Passwort (mit Anzeigen/Verbergen) und Button *Login testen*.
  - **ntfy-Server & Zugangsdaten**: Topic-URL (z. B. `https://ntfy.schellenberger.biz/kitafino`), optionaler Token oder Basic Auth.
  - **Guthaben-Wächter**: Schwellenwert in Euro (Standard: `10.00 €`), ntfy-Alarm aktivieren/deaktivieren, Homematic-Warnvariable.
  - **Homematic & Alexa-Sprachausgabe**:
    - CCU-IP oder Hostname (z. B. `192.168.1.50` oder `ccu3.local`).
    - Name der Text-Systemvariable (Standard: `Kitafino_Essen`).
    - Optionale Logik-Systemvariable (z. B. `Kitafino_Bestellt`, wahr/falsch).
    - Format für Alexa: Entweder **Ganzer Satz** (*„Frieda hat heute Essen bestellt: Nudeln in Schinkensahnesauce...“*) oder **Nur Menüname**.
    - Button *Homematic testen* zum direkten Ausprobieren.

## Kalender-Abo einbinden

Den Kalender findest du unter:
- `http://<deine-ip>:3010/calendar.ics`

Auf der Weboberfläche gibt es im Bereich **Familienkalender-Abo** einen Button **Abonnieren**, der den Kalender direkt in Apple Kalender / Outlook öffnet, sowie einen Button zum einfachen Kopieren der Feed-URL.

## Homematic CCU & Alexa Einrichtung

1. In der CCU unter *Einstellungen → Systemvariable* eine Variable vom Typ **Zeichenkette** mit dem Namen `Kitafino_Essen` anlegen.
2. (Optional) Eine Variable vom Typ **Logikwert** mit dem Namen `Kitafino_Bestellt` anlegen.
3. (Optional für Guthaben-Alarm) Eine Variable vom Typ **Logikwert** mit dem Namen `Kitafino_Guthaben_Warnung` anlegen.
4. In den Settings der Kitafino-Webseite die IP-Adresse deiner CCU eintragen und den Haken bei *Homematic-Systemvariable bei jedem Abruf aktualisieren* setzen.
5. Per Button **📢 Homematic testen** prüfen.
6. In deiner Alexa-App kannst du die Systemvariable nun z. B. über das Homematic-Alexa-Skill oder Home Assistant / ioBroker / RedMatic in Routinen morgens vorlesen lassen!

## Konfiguration

Alle Einstellungen werden automatisch mit Dateirechten `0600` in `config/config.json` gespeichert.

## Projektstruktur

```
src/server.js              Lokaler HTTP-Server & REST-API (/api/state, /api/check, /api/settings, /calendar.ics, etc.)
src/checker.js             Kombinierter Abruf-, ntfy-, Homematic- und Guthaben-Wächter-Lauf
src/calendar.js            iCal (.ics) RFC 5545 Kalender-Feed Generator
src/homematic.js           Homematic ReGaHss Client & Alexa-Sprachtext-Generator
src/scheduler.js           Zeitplan-Steuerung (Europe/Berlin)
src/notify.js              Erzeugung und Versand der ntfy-Nachrichten (Tagesinfo & Guthabenwarnung)
src/config.js              Konfiguration laden und speichern (config/config.json)
src/state.js               Status-Persistierung (data/state.json)
src/kitafino/http.js       HTTP-Client mit eigenem Cookie-Jar
src/kitafino/login.js      Login-Ablauf gegen auth.kitafino.de (multipart/form-data)
src/kitafino/orders.js     Parser für Menüs, Wochenplan, Fristen & Guthaben
web/index.html             Lokale Weboberfläche mit modernem 90%-Design, Kalender-Box & Settings
web/app.js                 Frontend-Logik
web/styles.css             Modernes Design (Light & Dark Mode, Farbverläufe, Badges, 90% Breite)
```
