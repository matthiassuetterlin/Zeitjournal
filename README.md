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

## Passwortschutz

Die Zeiten werden mit dem Passwort verschlüsselt (AES-GCM, Schlüssel per PBKDF2) im Browser gespeichert und nie an einen Server geschickt. Wer die Seite öffnet, sieht ohne Passwort nur die Anmeldung, und auch direkt aus dem Browser-Speicher lassen sich die Daten ohne Passwort nicht lesen. Der Programmcode selbst bleibt öffentlich, er enthält aber keine Daten. Ohne Passwort sind die Daten verloren; „Passwort vergessen?“ löscht sie und beginnt neu. Eine gespeicherte Sicherung (JSON) ist nicht verschlüsselt.

