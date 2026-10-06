// Zeitjournal als Desktop-Kacheln: ein durchsichtiges, rahmenloses Fenster über dem Arbeitsbereich.
// Leere Flächen lassen Mausklicks zum Desktop durch, nur die Kacheln selbst sind bedienbar.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const settingsFile = () => path.join(app.getPath('userData'), 'einstellungen.json');
let settings = { onTop: false, firstRunDone: false };
try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch (e) { /* Standard */ }
const saveSettings = () => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { /* ignorieren */ } };

let win = null, tray = null, tiles = [];

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: settings.onTop,
    show: false,
    title: 'Zeitjournal',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  // Links öffnen im Browser, nicht im Kachel-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('file:')) ev.preventDefault(); });
}

function fitToScreen() {
  if (win) win.setBounds(screen.getPrimaryDisplay().workArea);
}

const send = cmd => { if (win) { win.showInactive(); win.webContents.send('command', cmd); } };

function buildMenu() {
  const autostart = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Kacheln', submenu: tiles.map(t => ({ label: t.name, type: 'checkbox', checked: t.visible, click: () => send({ type: 'toggle', id: t.id }) })) },
    { label: 'Kacheln neu anordnen', click: () => send({ type: 'reset' }) },
    { type: 'separator' },
    { label: 'Immer im Vordergrund', type: 'checkbox', checked: settings.onTop, click: item => {
      settings.onTop = item.checked; saveSettings(); win.setAlwaysOnTop(settings.onTop);
    } },
    { label: 'Mit Windows starten', type: 'checkbox', checked: autostart, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Sperren', click: () => send({ type: 'lock' }) },
    { label: 'Beenden', click: () => app.quit() },
  ]);
}
const refreshMenu = () => { if (tray) tray.setContextMenu(buildMenu()); };

app.whenReady().then(() => {
  app.setAppUserModelId('de.suetterlin.zeitjournal');
  // Beim ersten Start automatisch mit Windows starten lassen (im Tray-Menü abschaltbar)
  if (!settings.firstRunDone) {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
    settings.firstRunDone = true;
    saveSettings();
  }
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Zeitjournal');
  tray.on('click', () => { win.show(); win.focus(); });
  refreshMenu();

  ipcMain.on('interactive', (_e, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('tiles', (_e, list) => { tiles = list; refreshMenu(); });
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
});

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
