# Zeitjournal

Grafisches Zeitjournal: Zeiten als farbige Blöcke auf einer Tagesleiste erfassen, mit der Maus verschieben, verlängern, kürzen und benennen.

![Screenshot hell](docs/screenshot.png)

![Screenshot dunkel](docs/screenshot-dunkel.png)

Online: https://matthiassuetterlin.github.io/Zeitjournal/

## Benutzen

`index.html` im Browser öffnen, fertig. Beim ersten Öffnen legst du ein Passwort fest; danach fragt die App bei jedem Öffnen danach. Es gibt keinen Server: die Daten bleiben im Browser (localStorage). Über „Sicherung speichern/laden“ lassen sie sich als Datei sichern oder auf einen anderen Rechner mitnehmen. Mit GitHub Pages läuft die App direkt aus dem Repo.

| Was | Wie |
| --- | --- |
| Block anlegen | Auf der leeren Leiste ziehen, oder klicken (1 Stunde) |
| Verschieben | Block ziehen (springt nicht über andere Blöcke, sondern in die nächste freie Lücke) |
| Länger/kürzer | Linken oder rechten Rand ziehen; der Nachbarblock wird dabei automatisch kürzer, liegen zwei Blöcke aneinander, wandert die gemeinsame Grenze |
| Umbenennen | Doppelklick oder Enter |
| Kategorie ändern | Block anklicken, dann Kategorie oder Taste 1–5 |
| Projekt wählen | Pfeil ▾ neben „Projekte“: Projekt auswählen, neu anlegen (Enter), umbenennen ✎ oder löschen ✕ |
| Hell/Dunkel | ☾/☀ oben rechts (startet passend zur Systemeinstellung) |
| Löschen | Block anklicken, Entf |
| Stoppuhr | Start/Stopp oder Leertaste; Kategorie wechseln, während sie läuft, schließt den Block und beginnt einen neuen |
| Zoom | + / − oben an der Zeitleiste, Strg+Mausrad oder Tasten +/−; „Ganzer Tag“ zeigt wieder alles |
| Bereiche größer ziehen | Griff unter der Zeitleiste nach unten ziehen; Trenner zwischen Monat und Woche seitlich ziehen; Doppelklick setzt zurück |
| Rückgängig / Wiederholen | Knöpfe über der Zeitleiste, oder Strg+Z und Strg+Umschalt+Z |
| Hilfe | Das i-Symbol über der Zeitleiste zeigt beim Darüberfahren, wie alles funktioniert |
| Tage wechseln | ← / → / T, oder in der Monats- oder Wochenübersicht auf einen Tag klicken |
| Monatsübersicht | Jeder Tag zeigt Stunden und einen Farbstreifen, was gearbeitet wurde; ‹ › blättert die Monate |

## Windows-Desktop-Version

Das Zeitjournal gibt es auch als Desktop-Programm für Windows. Es liegt durchsichtig über dem Desktop. Sichtbar ist eine App aus Modulen (Uhr, Kategorien, Tag, Summen, Woche, Monat) mit durchsichtigen Zwischenräumen.

![Desktop-Version](docs/desktop.png)

- **Installieren:** unter [Releases](https://github.com/matthiassuetterlin/Zeitjournal/releases) die neueste `Zeitjournal-Setup-….exe` herunterladen und doppelklicken. Weil der Installer nicht signiert ist, warnt Windows beim ersten Mal; dann „Weitere Informationen“ und „Trotzdem ausführen“ wählen.
- **Anordnung:** oben Uhr und Kategorien, darunter die Tages-Zeitleiste quer, darunter Monat und Summen; Woche und Extras lassen sich dazuholen.
- **Größen:** einen Zwischenraum ziehen, dann wird das eine Modul größer und das Nachbarmodul kleiner. An den Rändern und unteren Ecken zieht man die ganze App breiter, schmaler, länger oder kürzer.
- **Module schließen:** das × oben rechts am Modul blendet es aus. Oben in der Leiste „Zeitjournal“ holt „+ Name“ es zurück. Die ganze App verschiebt man an dieser Leiste.
- **Farben:** Rechtsklick auf einen Block oder eine Kategorie, oder „⋯“ an der Kategorie. Projekte bekommen ihre Farbe über „●“ im Projektmenü. Das geht auch auf der Webseite.
- **Symbol in der Taskleiste** (rechts unten): Module ein- und ausblenden, Anordnung zurücksetzen, immer im Vordergrund, mit Windows starten, sperren, beenden.
- **Gesperrt** bleibt oben rechts nur ein kleines Etikett mit Schloss; ein Klick darauf öffnet das Ziffernfeld.
- Klicks auf freie Flächen gehen zum Desktop durch. Die Daten liegen auf dem Rechner und sind mit dem Code verschlüsselt, getrennt von der Webseite.

Selbst bauen: im Ordner `desktop` `npm install` und `npm run dist`. Zum Ausprobieren ohne Installer: `npm start`.

## Abgleich zwischen Geräten

Die Windows-App und die Webseite können ihre Zeiten über einen kleinen Online-Speicher (Supabase, kostenloser Plan) abgleichen. Der Knopf ☁ neben „Sperren“ richtet das ein: auf dem ersten Gerät „Neu einrichten“, auf jedem weiteren „Schlüssel eingeben“ und den Sync-Schlüssel vom ersten Gerät einfügen.

- Hochgeladen wird nur ein mit dem Sync-Schlüssel verschlüsselter Block. Der Schlüssel bleibt auf den Geräten, mit dem Code verschlüsselt.
- Ändern zwei Geräte gleichzeitig etwas, werden beide Änderungen zusammengeführt. Gelöschte Blöcke bleiben gelöscht.
- Das Claude-Seitenfenster gleicht nicht mit ab, weil es keine fremden Server erreichen kann.
- Einrichtung des Speichers: `docs/sync-setup.sql` im Supabase-SQL-Editor ausführen und in `sync.js` die Project URL und den anon key eintragen.

## Code-Sperre

Beim Öffnen fragt das Zeitjournal nach einem 4-stelligen Code, eingegeben über ein Ziffernfeld wie beim Telefon (Maus, Finger oder Zifferntasten). Die Zeiten werden mit dem Code verschlüsselt (AES-GCM, Schlüssel per PBKDF2) im Browser gespeichert und nie an einen Server geschickt. Nach drei falschen Codes muss man 30 Sekunden warten, danach jeweils doppelt so lange.

Ein 4-stelliger Code schützt vor neugierigen Blicken, aber nicht vor jemandem, der den Rechner in die Hand bekommt und gezielt alle 10.000 Codes durchprobiert. Ohne Code sind die Daten verloren; „Code vergessen?“ löscht sie und beginnt neu. Eine gespeicherte Sicherung (JSON) ist nicht verschlüsselt.
