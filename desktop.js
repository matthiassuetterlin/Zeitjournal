'use strict';
// Desktop-Ansicht für die Windows-Version (Electron): ein kompakter Block aus Modulen mit durchsichtigen Zwischenräumen.
// Anordnung (Variante B): oben Uhr | Kategorien, dann die Zeitleiste quer, darunter Monat | Summen, darunter Woche | Notizen.
// Zwischenräume ziehen verteilt den Platz zwischen Nachbarmodulen, Ränder und Ecken ziehen ändern die ganze App.
// Ein Modul schließt man mit dem × oben rechts; ausgeblendete Module stehen als „+ Name“ in der Kopfleiste.
// Im Browser tut diese Datei nichts: nur die Desktop-Hülle stellt window.zeitjournalDesktop bereit.
// Im Claude-Seitenfenster (window.zeitjournalPanel) gibt es dieselben Module, aber über die ganze Breite
// und auf normalem Hintergrund; ist es schmal, stehen alle Module untereinander.
(() => {
  const PANEL = !window.zeitjournalDesktop && !!window.zeitjournalPanel;
  const host = window.zeitjournalDesktop || (PANEL && { setInteractive() {}, reportTiles() {}, onCommand() {} });
  if (!host) return;
  const PAD = 12, NARROW = 640;
  const BOARD_KEY = 'zeitjournal.boardB';
  const GAP = 12, MIN_H = 70, MIN_W = 150;
  const DEFS = {
    uhr: { name: 'Uhr', el: () => document.querySelector('.topbar') },
    kategorien: { name: 'Kategorien', el: () => $('palette') },
    tag: { name: 'Tag', el: () => document.querySelector('.day') },
    monat: { name: 'Monat', el: () => document.querySelector('.month') },
    summen: { name: 'Summen', el: () => document.querySelector('.summary') },
    woche: { name: 'Woche', el: () => document.querySelector('.week') },
    notizen: { name: 'Notizen', el: () => document.querySelector('.notes') },
    extras: { name: 'Extras', el: () => document.querySelector('.footer') },
  };
  // Zeilen des Rasters mit Standardhöhe; Zeilen mit zwei Modulen teilen sich die Breite
  const ROWS = [
    { id: 'r1', mods: ['uhr', 'kategorien'], h: 190 },
    { id: 'r2', mods: ['tag'], h: 225 },
    { id: 'r3', mods: ['monat', 'summen'], h: 400 },
    { id: 'r4', mods: ['woche', 'notizen'], h: 130 },
    { id: 'r5', mods: ['extras'], h: 80 },
  ];

  document.documentElement.classList.add('desktop');
  if (PANEL) document.documentElement.classList.add('panel');

  // ---------- Gerüst ----------
  const board = document.createElement('div');
  board.id = 'board';
  board.innerHTML = `
    <div class="board-bar" title="Ziehen = ganze App verschieben">
      <span class="board-title">Zeitjournal</span>
      <span class="board-restore"></span>
    </div>
    <div class="board-mods"></div>
    <div class="board-edge l" data-e="l"></div><div class="board-edge r" data-e="r"></div><div class="board-edge b" data-e="b"></div>
    <div class="board-edge bl" data-e="bl"></div><div class="board-edge br" data-e="br"></div>`;
  document.body.prepend(board);
  const mods = board.querySelector('.board-mods');
  const restore = board.querySelector('.board-restore');
  // Ausgeblendete Module bleiben im Dokument (die App greift auf ihre Elemente zu), nur unsichtbar
  const stash = document.createElement('div');
  stash.hidden = true;
  board.append(stash);

  const tiles = {};
  for (const [id, d] of Object.entries(DEFS)) {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.tile = id;
    t.innerHTML = `<div class="tile-bar"><span>${d.name}</span>`
      + '<button class="tile-close" title="Modul schließen (oben in der Leiste mit „+“ wieder öffnen)">×</button></div>'
      + '<div class="tile-body"></div>';
    t.querySelector('.tile-body').append(d.el());
    t.querySelector('.tile-close').onclick = () => setHidden(id, true);
    // Griff unten am Modul (nur wenn die Module untereinander stehen)
    const grip = document.createElement('div');
    grip.className = 'tile-grip';
    grip.title = 'Ziehen = Modul höher/niedriger · Doppelklick = passend zum Inhalt';
    grip.addEventListener('pointerdown', ev => begin(ev, { kind: 'flowH', id, h0: t.offsetHeight, y0: ev.clientY }));
    grip.addEventListener('dblclick', () => { if (L.flowH) delete L.flowH[id]; layout(); });
    t.append(grip);
    tiles[id] = t;
  }
  // Monat und Woche liegen jetzt in eigenen Modulen, die alte Übersicht samt Trenngriff wird nicht mehr gebraucht
  document.querySelector('.overview')?.remove();
  document.querySelector('main')?.remove();

  // ---------- Gespeicherte Anordnung ----------
  const fresh = () => ({
    w: 900,
    pos: null,
    hidden: { woche: true, extras: true },
    rowH: Object.fromEntries(ROWS.map(r => [r.id, r.h])),
    split: { r1: 0.5, r3: 0.5, r4: 0.6 },
  });
  let L = fresh();
  try {
    const s = JSON.parse(localStorage.getItem(BOARD_KEY));
    if (s && s.rowH) L = Object.assign(fresh(), s);
  } catch (e) { /* Standard */ }
  function store() {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(L)); } catch (e) { /* ignorieren */ }
    host.reportTiles({ tiles: Object.entries(DEFS).map(([id, d]) => ({ id, name: d.name, visible: !L.hidden[id] })) });
  }

  // ---------- Anordnen ----------
  const boardW = () => PANEL ? Math.max(2 * MIN_W + GAP, document.documentElement.clientWidth - 2 * PAD) : L.w;
  // Schmal (nur im Seitenfenster): jedes Modul bekommt eine eigene Zeile
  const visibleRows = () => {
    const rows = ROWS.map(r => ({ ...r, mods: r.mods.filter(id => !L.hidden[id]) })).filter(r => r.mods.length);
    if (!narrow()) return rows;
    return rows.flatMap(r => r.mods.length < 2 ? [r] : r.mods.map(m => ({ id: 'n_' + m, mods: [m], h: r.h })));
  };
  const narrow = () => PANEL && boardW() < NARROW;
  const rowH = r => L.rowH[r.id] ?? r.h;
  let geo = [];   // berechnete Zeilen für das Ziehen an den Zwischenräumen
  function layout() {
    const rows = visibleRows();
    const W = boardW();
    mods.textContent = '';
    // Schmal: Module einfach untereinander, jedes so hoch wie sein Inhalt
    const flow = narrow();
    document.documentElement.classList.toggle('narrow', flow);
    for (const id of Object.keys(DEFS)) if (L.hidden[id]) stash.append(tiles[id]);
    let y = 0;
    geo = [];
    rows.forEach((r, i) => {
      const h = Math.round(rowH(r));
      if (flow) {
        // Untereinander: jedes Modul so hoch wie sein Inhalt, außer man hat es am Griff unten anders gezogen
        const id = r.mods[0], t = tiles[id], fh = L.flowH?.[id];
        put(id, 0, 0, W, 0);
        t.style.cssText = fh ? `height:${fh}px` : '';
        t.classList.toggle('sized', !!fh);
        return;
      }
      if (i) {
        const g = gutter('row', i);
        Object.assign(g.style, { left: '0px', top: (y - GAP) + 'px', width: W + 'px', height: GAP + 'px' });
      }
      if (r.mods.length === 2) {
        const wa = Math.round((W - GAP) * (L.split[r.id] ?? 0.5));
        put(r.mods[0], 0, y, wa, h);
        put(r.mods[1], wa + GAP, y, W - wa - GAP, h);
        const g = gutter('col', r.id);
        Object.assign(g.style, { left: wa + 'px', top: y + 'px', width: GAP + 'px', height: h + 'px' });
      } else {
        put(r.mods[0], 0, y, W, h);
      }
      geo.push({ id: r.id, y, h });
      y += h + GAP;
    });
    const H = Math.max(0, y - GAP);
    mods.style.width = W + 'px';
    mods.style.height = flow ? '' : H + 'px';
    board.style.width = W + 'px';
    // Ausgeblendete Module als „+ Name“ in der Kopfleiste
    restore.textContent = '';
    for (const [id, d] of Object.entries(DEFS)) {
      if (!L.hidden[id]) continue;
      const b = document.createElement('button');
      b.textContent = '+ ' + d.name;
      b.title = d.name + ' wieder einblenden';
      b.onclick = () => setHidden(id, false);
      restore.append(b);
    }
    if (PANEL) { board.style.left = board.style.top = ''; }
    else {
      const p = L.pos || { x: innerWidth - W - 24, y: 16 };
      // Wird die App höher als der Bildschirm, rückt sie so weit wie möglich nach oben
      place(p.x, Math.min(p.y, innerHeight - board.offsetHeight - 8));
    }
    window.dispatchEvent(new Event('resize'));   // Zeitleiste an die neue Breite anpassen
    store();
  }
  function put(id, x, y, w, h) {
    const t = tiles[id];
    Object.assign(t.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    mods.append(t);
  }
  function gutter(kind, ref) {
    const g = document.createElement('div');
    g.className = 'gutter ' + kind;
    g.title = 'Ziehen = Nachbarmodule größer oder kleiner';
    g.addEventListener('pointerdown', ev => begin(ev, kind === 'row' ? rowDrag(ref, ev) : colDrag(ref, ev)));
    mods.append(g);
    return g;
  }
  function place(x, y) {
    x = Math.round(Math.min(Math.max(0, x), Math.max(0, innerWidth - 120)));
    y = Math.round(Math.min(Math.max(0, y), Math.max(0, innerHeight - 40)));
    board.style.left = x + 'px';
    board.style.top = y + 'px';
    L.pos = { x, y };
  }
  function setHidden(id, hidden) { L.hidden[id] = hidden; layout(); }

  // ---------- Ziehen ----------
  let drag = null;
  function begin(ev, d) {
    if (!d || ev.button !== 0 || ev.target.closest('button')) return;
    ev.preventDefault();
    drag = d;
    host.setInteractive(true);
    document.documentElement.classList.add('board-dragging');
  }
  // Zwischenraum zwischen zwei Zeilen: die obere wächst, die untere schrumpft
  function rowDrag(i, ev) {
    const a = geo[i - 1], b = geo[i];
    return { kind: 'row', a: a.id, b: b.id, total: a.h + b.h, ha: a.h, y0: ev.clientY };
  }
  // Zwischenraum in einer Zeile: links breiter, rechts schmaler
  function colDrag(rowId, ev) {
    return { kind: 'col', row: rowId, s0: L.split[rowId] ?? 0.5, x0: ev.clientX };
  }
  if (!PANEL) board.querySelector('.board-bar').addEventListener('pointerdown', ev =>
    begin(ev, { kind: 'move', dx: ev.clientX - board.offsetLeft, dy: ev.clientY - board.offsetTop }));
  // Ränder und Ecken: ganze App breiter/schmaler und höher/niedriger (alle Zeilen anteilig)
  board.querySelectorAll('.board-edge').forEach(e => e.addEventListener('pointerdown', ev =>
    begin(ev, { kind: 'edge', e: e.dataset.e, x0: ev.clientX, y0: ev.clientY, w0: L.w, left0: board.offsetLeft,
      rows0: Object.fromEntries(visibleRows().map(r => [r.id, rowH(r)])) })));

  window.addEventListener('pointermove', ev => {
    if (!drag) return;
    if (drag.kind === 'move') {
      place(ev.clientX - drag.dx, ev.clientY - drag.dy);
      return;
    }
    if (drag.kind === 'flowH') {
      L.flowH = L.flowH || {};
      L.flowH[drag.id] = Math.max(MIN_H, Math.round(drag.h0 + ev.clientY - drag.y0));
    } else if (drag.kind === 'row') {
      const ha = Math.max(MIN_H, Math.min(drag.total - MIN_H, drag.ha + ev.clientY - drag.y0));
      L.rowH[drag.a] = ha;
      L.rowH[drag.b] = drag.total - ha;
    } else if (drag.kind === 'col') {
      const avail = L.w - GAP;
      const s = drag.s0 + (ev.clientX - drag.x0) / avail;
      L.split[drag.row] = Math.max(MIN_W / avail, Math.min(1 - MIN_W / avail, s));
    } else if (drag.kind === 'edge') {
      const e = drag.e;
      if (e.includes('l') || e === 'r' || e === 'br') {
        const dx = (ev.clientX - drag.x0) * (e.includes('l') ? -1 : 1);
        L.w = Math.round(Math.max(2 * MIN_W + GAP, Math.min(innerWidth, drag.w0 + dx)));
        if (e.includes('l')) L.pos = { x: drag.left0 - (L.w - drag.w0), y: L.pos.y };
      }
      if (e.includes('b')) {
        const ids = Object.keys(drag.rows0);
        const sum0 = ids.reduce((s, id) => s + drag.rows0[id], 0);
        const f = Math.max(MIN_H * ids.length / sum0, (sum0 + ev.clientY - drag.y0) / sum0);
        for (const id of ids) L.rowH[id] = Math.max(MIN_H, drag.rows0[id] * f);
      }
    }
    layout();
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    document.documentElement.classList.remove('board-dragging');
    store();
  });

  // ---------- Maus-Durchlass: leere Flächen lassen Klicks zum Desktop durch ----------
  let interactive = null;
  function updateInteractive(x, y) {
    if (drag) return;
    const el = document.elementFromPoint(x, y);
    const on = !!el && el !== document.documentElement && el !== document.body;
    if (on !== interactive) { interactive = on; host.setInteractive(on); }
  }
  window.addEventListener('mousemove', ev => updateInteractive(ev.clientX, ev.clientY));

  // ---------- Sperren: nur ein kleines Etikett oben rechts, ein Klick öffnet das Ziffernfeld ----------
  // (im Seitenfenster bleibt das Ziffernfeld wie auf der Webseite stehen)
  const lock = $('lock');
  const badge = document.createElement('button');
  badge.id = 'lockBadge';
  badge.title = 'Zeitjournal entsperren';
  badge.innerHTML = '<span>Zeitjournal</span><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">'
    + '<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/>'
    + '<path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
  document.body.append(badge);
  const collapse = document.createElement('button');
  collapse.className = 'lock-collapse';
  collapse.textContent = '×';
  collapse.title = 'Ziffernfeld schließen';
  document.querySelector('.lock-card').append(collapse);
  const setCollapsed = on => {
    if (PANEL) on = false;
    document.documentElement.classList.toggle('lock-collapsed', on);
    interactive = null;   // Maus-Durchlass beim nächsten Bewegen neu bestimmen
  };
  badge.onclick = () => setCollapsed(false);
  collapse.onclick = () => setCollapsed(true);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !lock.hidden && lockMode === 'unlock') setCollapsed(true);
  });
  let laidOut = false, wasLocked = null;
  const syncLock = () => {
    const locked = !lock.hidden;
    document.documentElement.classList.toggle('locked', locked);
    if (locked && wasLocked !== true) setCollapsed(lockMode === 'unlock');
    if (!locked) setCollapsed(false);
    wasLocked = locked;
    // Erst nach dem Entsperren ist alles gezeichnet
    if (!locked && !laidOut) { laidOut = true; requestAnimationFrame(layout); }
  };
  new MutationObserver(syncLock).observe(lock, { attributes: true, attributeFilter: ['hidden'] });
  syncLock();

  // ---------- Befehle aus dem Taskleisten-Menü ----------
  host.onCommand(cmd => {
    if (cmd.type === 'toggle') setHidden(cmd.id, !L.hidden[cmd.id]);
    else if (cmd.type === 'reset') { L = fresh(); layout(); }
    else if (cmd.type === 'lock') $('lockNow').click();
  });
  window.addEventListener('resize', () => {
    // Bildschirm kleiner geworden: App in den sichtbaren Bereich holen
    if (PANEL) { if (!drag && laidOut && board.offsetWidth !== boardW()) layout(); }
    else if (!drag && L.pos) place(board.offsetLeft, board.offsetTop);
  });
  layout();

  // Die Hilfe am i-Symbol schwebt frei, damit sie nicht vom Modulrand abgeschnitten wird
  const info = $('infoBtn'), tip = $('infoTip');
  const placeTip = () => {
    const r = info.getBoundingClientRect(), h = tip.offsetHeight, w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    tip.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6) + 'px';
  };
  info.addEventListener('mouseenter', placeTip);
  info.addEventListener('focus', placeTip);
})();
