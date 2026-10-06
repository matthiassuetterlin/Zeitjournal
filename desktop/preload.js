// Schmale Brücke zwischen Kachel-Ansicht (desktop.js) und Hauptprozess
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zeitjournalDesktop', {
  setInteractive: on => ipcRenderer.send('interactive', !!on),
  reportTiles: list => ipcRenderer.send('tiles', list),
  onCommand: fn => ipcRenderer.on('command', (_e, cmd) => fn(cmd)),
});
