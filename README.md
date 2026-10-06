# Zeitjournal

Grafisches Zeitjournal: Zeiten als farbige Blöcke auf einer Tagesleiste erfassen, mit der Maus verschieben, verlängern, kürzen und benennen.

![Screenshot hell](docs/screenshot.png)

![Screenshot dunkel](docs/screenshot-dunkel.png)

Online: https://matthiassuetterlin.github.io/Zeitjournal/

## Benutzen

`index.html` im Browser öffnen, fertig. Es gibt keinen Server: die Daten bleiben im Browser (localStorage). Über „Sicherung speichern/laden“ lassen sie sich als Datei sichern oder auf einen anderen Rechner mitnehmen. Mit GitHub Pages läuft die App direkt aus dem Repo.

| Was | Wie |
| --- | --- |
| Block anlegen | Auf der leeren Leiste ziehen, oder klicken (1 Stunde) |
| Verschieben | Block ziehen (springt nicht über andere Blöcke, sondern in die nächste freie Lücke) |
| Länger/kürzer | Linken oder rechten Rand ziehen |
| Umbenennen | Doppelklick oder Enter |
| Kategorie ändern | Block anklicken, dann Kategorie oder Taste 1–5 |
| Projekt wählen | Pfeil ▾ neben „Projekte“: Projekt auswählen, neu anlegen (Enter), umbenennen ✎ oder löschen ✕ |
| Hell/Dunkel | ☾/☀ oben rechts (startet passend zur Systemeinstellung) |
| Löschen | Block anklicken, Entf |
| Stoppuhr | Start/Stopp oder Leertaste; Kategorie wechseln, während sie läuft, schließt den Block und beginnt einen neuen |
| Rückgängig | Strg+Z |
| Tage wechseln | ← / → / T, oder in der Wochenübersicht auf einen Tag klicken |
