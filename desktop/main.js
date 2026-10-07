// Zeitjournal als Desktop-App: ein durchsichtiges, rahmenloses Fenster über dem Arbeitsbereich.
// Leere Flächen lassen Mausklicks zum Desktop durch, nur die Module selbst sind bedienbar.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

// Windows erklärt das durchsichtige Vollbild-Fenster oft für „verdeckt“, sobald ein anderes Programm aktiv ist,
// und zeichnet es dann erst beim nächsten Anklicken neu. Diese Sparmaßnahmen hier abschalten.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Build-Nummer aus der Release-Pipeline (fehlt beim lokalen Start)
let build = '';
try { build = String(require('./build-info.json').build || ''); } catch (e) { /* lokal */ }
const versionLabel = build ? `Version ${build}` : 'Entwicklerversion';

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
    // Auch im Hintergrund (nicht aktiv, verdeckt) weiterlaufen, damit Uhr und Abgleich live bleiben
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  // Nach jedem Laden den Maus-Durchlass neu setzen, sonst kommen die Mausbewegungen nicht mehr an
  win.webContents.on('did-finish-load', () => win.setIgnoreMouseEvents(true, { forward: true }));
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
    { label: 'Module', submenu: tiles.map(t => ({ label: t.name, type: 'checkbox', checked: t.visible, click: () => send({ type: 'toggle', id: t.id }) })) },
    { label: 'Anordnung zurücksetzen', click: () => send({ type: 'reset' }) },
    { type: 'separator' },
    { label: 'Immer im Vordergrund', type: 'checkbox', checked: settings.onTop, click: item => {
      settings.onTop = item.checked; saveSettings(); win.setAlwaysOnTop(settings.onTop);
    } },
    { label: 'Mit Windows starten', type: 'checkbox', checked: autostart, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Sperren', click: () => send({ type: 'lock' }) },
    { label: 'Beenden', click: () => app.quit() },
    { type: 'separator' },
    { label: versionLabel, enabled: false },
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
  tray.setToolTip(`Zeitjournal (${versionLabel})`);
  tray.on('click', () => { win.show(); win.focus(); });
  refreshMenu();

  ipcMain.on('interactive', (_e, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
  // Nach einem Abgleich neu zeichnen, auch wenn das Fenster gerade nicht aktiv ist
  ipcMain.on('repaint', () => { if (win && !win.isDestroyed()) win.webContents.invalidate(); });
  ipcMain.on('tiles', (_e, info) => { tiles = info.tiles || []; refreshMenu(); });
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
});

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
