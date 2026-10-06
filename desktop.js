'use strict';
// Kachel-Ansicht für die Windows-Desktop-Version (Electron).
// Im Browser tut diese Datei nichts: nur die Desktop-Hülle stellt window.zeitjournalDesktop bereit.
(() => {
  const host = window.zeitjournalDesktop;
  if (!host) return;
  const TILES_KEY = 'zeitjournal.tiles';
  const GAP = 12, GRID = 8;
  const DEFS = [
    { id: 'uhr', name: 'Uhr', el: () => document.querySelector('.topbar'), col: 'a' },
    { id: 'kategorien', name: 'Kategorien', el: () => $('palette'), col: 'a' },
    { id: 'monat', name: 'Monat', el: () => document.querySelector('.month'), col: 'b' },
    { id: 'summen', name: 'Summen', el: () => document.querySelector('.summary'), col: 'a' },
    { id: 'woche', name: 'Woche', el: () => document.querySelector('.week'), col: 'b' },
    { id: 'tag', name: 'Tag', el: () => document.querySelector('.day'), col: 'bottom' },
    { id: 'extras', name: 'Extras', el: () => document.querySelector('.footer'), col: 'a', hidden: true },
  ];

  document.documentElement.classList.add('desktop');
  const root = document.createElement('div');
  root.id = 'tiles';
  document.body.prepend(root);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(TILES_KEY)) || {}; } catch (e) { /* Standard */ }
  const tiles = {};
  let zTop = 1;

  for (const d of DEFS) {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.tile = d.id;
    const bar = document.createElement('div');
    bar.className = 'tile-bar';
    bar.title = 'Ziehen zum Verschieben';
    bar.innerHTML = `<span>${d.name}</span>`;
    const close = document.createElement('button');
    close.className = 'tile-close';
    close.textContent = '×';
    close.title = 'Kachel ausblenden (über das Symbol in der Taskleiste wieder einblenden)';
    close.onclick = () => setHidden(d.id, true);
    bar.append(close);
    const body = document.createElement('div');
    body.className = 'tile-body';
    body.append(d.el());
    const grip = document.createElement('div');
    grip.className = 'tile-grip';
    grip.title = 'Ziehen = Kachel breiter oder schmaler';
    grip.addEventListener('pointerdown', ev => startDrag(ev, t, 'width'));
    t.append(bar, body, grip);
    root.append(t);
    tiles[d.id] = t;
    bar.addEventListener('pointerdown', ev => startDrag(ev, t));
    t.addEventListener('pointerdown', () => { t.style.zIndex = ++zTop; });
  }
  // Monat und Woche liegen jetzt in eigenen Kacheln, die alte Übersicht samt Trenngriff wird nicht mehr gebraucht
  document.querySelector('.overview')?.remove();
  document.querySelector('main')?.remove();

  function store() {
    const out = {};
    for (const [id, t] of Object.entries(tiles)) {
      out[id] = { x: parseFloat(t.style.left) || 0, y: parseFloat(t.style.top) || 0, w: parseFloat(t.style.width) || t.offsetWidth, hidden: t.hidden };
    }
    try { localStorage.setItem(TILES_KEY, JSON.stringify(out)); } catch (e) { /* ignorieren */ }
    report();
  }
  function report() {
    host.reportTiles(DEFS.map(d => ({ id: d.id, name: d.name, visible: !tiles[d.id].hidden })));
  }
  function place(t, x, y) {
    const maxX = Math.max(0, innerWidth - t.offsetWidth), maxY = Math.max(0, innerHeight - 40);
    t.style.left = Math.min(maxX, Math.max(0, Math.round(x / GRID) * GRID)) + 'px';
    t.style.top = Math.min(maxY, Math.max(0, Math.round(y / GRID) * GRID)) + 'px';
  }
  // Standardanordnung: zwei Spalten am rechten Bildschirmrand, der Tag breit darunter
  function defaultLayout() {
    const W = innerWidth, H = innerHeight;
    const wa = 470, wb = 380;
    const xa = W - wa - 24, xb = xa - wb - GAP;
    const ys = { a: 24, b: 24 };
    for (const d of DEFS) {
      const t = tiles[d.id];
      t.hidden = !!d.hidden;
      if (d.col === 'bottom') continue;
      t.style.width = (d.col === 'a' ? wa : wb) + 'px';
      if (t.hidden) { place(t, d.col === 'a' ? xa : xb, ys[d.col]); continue; }
      place(t, d.col === 'a' ? xa : xb, ys[d.col]);
      ys[d.col] += t.offsetHeight + GAP;
    }
    const day = tiles.tag;
    day.style.width = (wa + wb + GAP) + 'px';
    place(day, xb, Math.min(H - day.offsetHeight - 8, Math.max(ys.a, ys.b, H - day.offsetHeight - 24)));
    window.dispatchEvent(new Event('resize'));
    store();
  }
  function applySaved() {
    for (const d of DEFS) {
      const s = saved[d.id], t = tiles[d.id];
      if (!s) return false;
      t.hidden = !!s.hidden;
      t.style.width = s.w + 'px';
      place(t, s.x, s.y);
    }
    window.dispatchEvent(new Event('resize'));
    report();
    return true;
  }
  function setHidden(id, hidden) {
    tiles[id].hidden = hidden;
    if (!hidden) { tiles[id].style.zIndex = ++zTop; place(tiles[id], parseFloat(tiles[id].style.left) || 0, parseFloat(tiles[id].style.top) || 0); }
    window.dispatchEvent(new Event('resize'));
    store();
  }

  // Verschieben an der Titelleiste, Breite am rechten Rand
  let drag = null;
  function startDrag(ev, t, mode = 'move') {
    if (ev.button !== 0 || ev.target.closest('button')) return;
    ev.preventDefault();
    t.style.zIndex = ++zTop;
    drag = { t, mode, dx: ev.clientX - t.offsetLeft, dy: ev.clientY - t.offsetTop, w: t.offsetWidth, x0: ev.clientX };
    t.classList.add('dragging');
    host.setInteractive(true);
  }
  window.addEventListener('pointermove', ev => {
    if (!drag) return;
    if (drag.mode === 'width') {
      const w = Math.round((drag.w + ev.clientX - drag.x0) / GRID) * GRID;
      drag.t.style.width = Math.max(220, Math.min(innerWidth - drag.t.offsetLeft, w)) + 'px';
    } else place(drag.t, ev.clientX - drag.dx, ev.clientY - drag.dy);
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag.t.classList.remove('dragging');
    drag = null;
    store();
  });
  // Breitere Kachel: Zeitleiste neu zeichnen
  let sizeTimer = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  });
  Object.values(tiles).forEach(t => ro.observe(t));

  // Leere Flächen lassen Klicks zum Desktop durch, nur Kacheln (und Dialoge) fangen die Maus
  let interactive = null;
  function updateInteractive(x, y) {
    if (drag) return;
    const el = document.elementFromPoint(x, y);
    const on = !!el && el !== document.documentElement && el !== document.body && el !== root;
    if (on !== interactive) { interactive = on; host.setInteractive(on); }
  }
  window.addEventListener('mousemove', ev => updateInteractive(ev.clientX, ev.clientY));

  // Gesperrt: Kacheln verbergen, nur das Ziffernfeld zeigen
  const lock = $('lock');
  let laidOut = false;
  const syncLock = () => {
    document.documentElement.classList.toggle('locked', !lock.hidden);
    // Erst nach dem Entsperren ist alles gezeichnet und die Kachelhöhen stimmen
    if (lock.hidden && !laidOut) { laidOut = true; requestAnimationFrame(() => { if (!applySaved()) defaultLayout(); }); }
  };
  new MutationObserver(syncLock).observe(lock, { attributes: true, attributeFilter: ['hidden'] });
  syncLock();

  host.onCommand(cmd => {
    if (cmd.type === 'toggle') setHidden(cmd.id, !tiles[cmd.id].hidden);
    else if (cmd.type === 'reset') defaultLayout();
    else if (cmd.type === 'lock') $('lockNow').click();
  });
  window.addEventListener('resize', () => {
    // Bildschirm kleiner geworden: Kacheln in den sichtbaren Bereich holen
    for (const t of Object.values(tiles)) if (!t.hidden) place(t, t.offsetLeft, t.offsetTop);
  });
})();
