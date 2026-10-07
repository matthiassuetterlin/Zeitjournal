'use strict';
// Desktop-Ansicht für die Windows-Version (Electron): ein kompakter Block aus Modulen mit durchsichtigen Zwischenräumen.
// Anordnung (Variante B): oben Uhr | Kategorien, dann die Zeitleiste quer, darunter Monat | Summen, darunter Woche | Notizen.
// Zwischenräume ziehen verteilt den Platz zwischen Nachbarmodulen, Ränder und Ecken ziehen ändern die ganze App.
// Ein Modul schließt man mit dem × oben rechts; ausgeblendete Module stehen als „+ Name“ in der Kopfleiste.
// Module lassen sich an ihrer Titelleiste verschieben: neben ein anderes Modul, als eigene Zeile darüber oder
// darunter, oder auf ein Modul (dann tauschen beide den Platz). Es bleibt immer ein geschlossener Block.
// Auf der Webseite und im Claude-Seitenfenster gibt es dieselben Module, aber über die ganze Breite
// und auf normalem Hintergrund; ist es schmal, stehen alle Module untereinander.
(() => {
  const PANEL = !window.zeitjournalDesktop;
  const host = window.zeitjournalDesktop || { setInteractive() {}, reportTiles() {}, onCommand() {} };
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
  // Jede Zeile: Module von links nach rechts, Höhe und Breitenanteile (w) je Modul
  const SPLIT = { r1: 0.5, r3: 0.5, r4: 0.6 };
  const rowsFrom = (rowH = {}, split = {}) => ROWS.map(r => {
    const s = split[r.id] ?? SPLIT[r.id] ?? 0.5;
    return { id: r.id, mods: [...r.mods], h: rowH[r.id] ?? r.h, w: r.mods.length === 2 ? { [r.mods[0]]: s, [r.mods[1]]: 1 - s } : { [r.mods[0]]: 1 } };
  });
  const fresh = () => ({ w: 900, pos: null, hidden: { woche: true, extras: true }, rows: rowsFrom() });
  let L = fresh();
  try {
    const s = JSON.parse(localStorage.getItem(BOARD_KEY));
    if (s && (s.rows || s.rowH)) {
      L = Object.assign(fresh(), s);
      // Ältere Anordnung (feste Zeilen) übernehmen
      if (!s.rows) L.rows = rowsFrom(s.rowH, s.split);
      delete L.rowH; delete L.split;
    }
  } catch (e) { /* Standard */ }
  // Neue Module, die in der gespeicherten Anordnung noch fehlen, kommen als eigene Zeile ans Ende
  for (const id of Object.keys(DEFS)) {
    if (!L.rows.some(r => r.mods.includes(id))) L.rows.push({ id: 'r_' + id, mods: [id], h: 200, w: { [id]: 1 } });
  }
  const rowOf = id => L.rows.find(r => r.mods.includes(id));
  function store() {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(L)); } catch (e) { /* ignorieren */ }
    host.reportTiles({ tiles: Object.entries(DEFS).map(([id, d]) => ({ id, name: d.name, visible: !L.hidden[id] })) });
  }

  // ---------- Anordnen ----------
  const boardW = () => PANEL ? Math.max(2 * MIN_W + GAP, document.documentElement.clientWidth - 2 * PAD) : L.w;
  // Schmal (nur im Seitenfenster): jedes Modul bekommt eine eigene Zeile
  const visibleRows = () => {
    const rows = L.rows.map(r => ({ ...r, mods: r.mods.filter(id => !L.hidden[id]) })).filter(r => r.mods.length);
    if (!narrow()) return rows;
    return rows.flatMap(r => r.mods.length < 2 ? [r] : r.mods.map(m => ({ id: 'n_' + m, mods: [m], h: r.h })));
  };
  const narrow = () => PANEL && boardW() < NARROW;
  const rowH = r => r.h;
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
      // Module nebeneinander nach ihren Breitenanteilen
      const n = r.mods.length, avail = W - GAP * (n - 1);
      const wt = r.mods.map(m => r.w?.[m] ?? 1), sum = wt.reduce((a, b) => a + b, 0);
      let x = 0;
      r.mods.forEach((m, k) => {
        const w = k === n - 1 ? W - x : Math.round(avail * wt[k] / sum);
        put(m, x, y, w, h);
        x += w;
        if (k < n - 1) {
          const g = gutter('col', { row: r.id, a: m, b: r.mods[k + 1], pxPerW: avail / sum });
          Object.assign(g.style, { left: x + 'px', top: y + 'px', width: GAP + 'px', height: h + 'px' });
          x += GAP;
        }
      });
      geo.push({ id: r.id, y, h });
      y += h + GAP;
    });
    const H = Math.max(0, y - GAP);
    mods.style.width = W + 'px';
    mods.style.height = flow ? '' : H + 'px';
    board.style.width = W + 'px';
    // Ausgeblendete Module als „+ Name“ in der Kopfleiste
    restore.textContent = '';
    if (PANEL) {
      const b = document.createElement('button');
      b.textContent = '↺';
      b.title = 'Anordnung zurücksetzen';
      b.onclick = () => { L = fresh(); layout(); };
      restore.append(b);
    }
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
  function colDrag(c, ev) {
    const r = L.rows.find(x => x.id === c.row);
    return { kind: 'col', r, a: c.a, b: c.b, wa: r.w?.[c.a] ?? 1, wb: r.w?.[c.b] ?? 1, pxPerW: c.pxPerW, x0: ev.clientX };
  }
  if (!PANEL) board.querySelector('.board-bar').addEventListener('pointerdown', ev =>
    begin(ev, { kind: 'move', dx: ev.clientX - board.offsetLeft, dy: ev.clientY - board.offsetTop }));
  // Ränder und Ecken: ganze App breiter/schmaler und höher/niedriger (alle Zeilen anteilig)
  board.querySelectorAll('.board-edge').forEach(e => e.addEventListener('pointerdown', ev =>
    begin(ev, { kind: 'edge', e: e.dataset.e, x0: ev.clientX, y0: ev.clientY, w0: L.w, left0: board.offsetLeft,
      rows0: Object.fromEntries(visibleRows().map(r => [r.id, rowH(r)])) })));
  // Titelleiste eines Moduls: Modul an einen anderen Platz im Block ziehen
  for (const [id, t] of Object.entries(tiles)) {
    t.querySelector('.tile-bar').addEventListener('pointerdown', ev =>
      begin(ev, { kind: 'tile', id, x0: ev.clientX, y0: ev.clientY, started: false, target: null }));
  }

  window.addEventListener('pointermove', ev => {
    if (!drag) return;
    if (drag.kind === 'move') {
      place(ev.clientX - drag.dx, ev.clientY - drag.dy);
      return;
    }
    if (drag.kind === 'tile') {
      if (!drag.started && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return;
      drag.started = true;
      tiles[drag.id].classList.add('moving');
      drag.target = dropTarget(ev.clientX, ev.clientY);
      showMark(drag.target);
      return;
    }
    if (drag.kind === 'flowH') {
      L.flowH = L.flowH || {};
      L.flowH[drag.id] = Math.max(MIN_H, Math.round(drag.h0 + ev.clientY - drag.y0));
    } else if (drag.kind === 'row') {
      const ha = Math.max(MIN_H, Math.min(drag.total - MIN_H, drag.ha + ev.clientY - drag.y0));
      L.rows.find(r => r.id === drag.a).h = ha;
      L.rows.find(r => r.id === drag.b).h = drag.total - ha;
    } else if (drag.kind === 'col') {
      const min = MIN_W / drag.pxPerW, both = drag.wa + drag.wb;
      const wa = Math.max(min, Math.min(both - min, drag.wa + (ev.clientX - drag.x0) / drag.pxPerW));
      drag.r.w = { ...drag.r.w, [drag.a]: wa, [drag.b]: both - wa };
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
        for (const id of ids) { const r = L.rows.find(x => x.id === id); if (r) r.h = Math.max(MIN_H, drag.rows0[id] * f); }
      }
    }
    layout();
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.kind === 'tile') {
      tiles[drag.id].classList.remove('moving');
      showMark(null);
      if (drag.started && drag.target) moveTile(drag.id, drag.target);
      layout();
    }
    drag = null;
    document.documentElement.classList.remove('board-dragging');
    store();
  });

  // ---------- Module umstellen ----------
  // Wohin ein gezogenes Modul käme: Rand links/rechts eines Moduls = daneben, oben/unten = eigene Zeile,
  // Mitte = Platz tauschen. Über oder unter dem Block = ganz oben oder ganz unten.
  const maxPerRow = () => Math.max(1, Math.floor((boardW() + GAP) / (MIN_W + GAP)));
  function dropTarget(cx, cy) {
    const box = mods.getBoundingClientRect(), x = cx - box.left, y = cy - box.top;
    const flow = narrow();
    const vis = Object.keys(DEFS).filter(m => !L.hidden[m] && m !== drag.id);
    for (const m of vis) {
      const t = tiles[m], l = t.offsetLeft, tp = t.offsetTop, w = t.offsetWidth, h = t.offsetHeight;
      if (x < l - GAP / 2 || x > l + w + GAP / 2 || y < tp - GAP / 2 || y > tp + h + GAP / 2) continue;
      const fx = (x - l) / w, fy = (y - tp) / h;
      const row = rowOf(m);
      const others = row.mods.filter(k => !L.hidden[k] && k !== drag.id).length;
      if (!flow && others < maxPerRow() && (fx < 0.25 || fx > 0.75)) return { type: 'beside', ref: m, after: fx > 0.5 };
      if (fy < 0.3 || fy > 0.7) return { type: 'row', ref: m, after: fy > 0.5 };
      return { type: 'swap', ref: m };
    }
    if (!vis.length) return null;
    if (y < 0) return { type: 'row', ref: vis.reduce((a, m) => (tiles[m].offsetTop < tiles[a].offsetTop ? m : a)), after: false, edge: 'top' };
    if (y > mods.offsetHeight) {
      return { type: 'row', ref: vis.reduce((a, m) => (tiles[m].offsetTop >= tiles[a].offsetTop ? m : a)), after: true, edge: 'bottom' };
    }
    return null;
  }
  let mark = null;
  function showMark(t) {
    if (!t) { mark?.remove(); mark = null; return; }
    if (!mark) { mark = document.createElement('div'); }
    mods.append(mark);
    const r = tiles[t.ref], l = r.offsetLeft, tp = r.offsetTop, w = r.offsetWidth, h = r.offsetHeight;
    mark.className = 'drop-mark ' + t.type;
    let s;
    if (t.type === 'swap') s = { left: l, top: tp, width: w, height: h };
    else if (t.type === 'beside') s = { left: t.after ? l + w + GAP / 2 - 2 : l - GAP / 2 - 2, top: tp, width: 4, height: h };
    else {
      // Neue Zeile: Linie über die ganze Breite an der Zeilenkante
      const rowTiles = narrow() ? [r] : rowOf(t.ref).mods.filter(m => !L.hidden[m]).map(m => tiles[m]);
      const top = Math.min(...rowTiles.map(e => e.offsetTop)), bot = Math.max(...rowTiles.map(e => e.offsetTop + e.offsetHeight));
      s = { left: 0, top: t.after ? bot + GAP / 2 - 2 : top - GAP / 2 - 2, width: mods.offsetWidth, height: 4 };
    }
    for (const k in s) mark.style[k] = s[k] + 'px';
  }
  function moveTile(id, t) {
    const src = rowOf(id), dst = rowOf(t.ref);
    if (t.type === 'swap') {
      const i = src.mods.indexOf(id), j = dst.mods.indexOf(t.ref);
      const wa = src.w?.[id] ?? 1, wb = dst.w?.[t.ref] ?? 1;
      src.mods[i] = t.ref; dst.mods[j] = id;
      delete src.w[id]; delete dst.w[t.ref];
      src.w[t.ref] = wa; dst.w[id] = wb;
      return;
    }
    const h = Math.max(MIN_H, Math.round(tiles[id].offsetHeight));
    src.mods.splice(src.mods.indexOf(id), 1);
    delete src.w[id];
    if (!src.mods.length) L.rows.splice(L.rows.indexOf(src), 1);
    if (t.type === 'beside') {
      const vis = dst.mods.filter(m => !L.hidden[m]);
      dst.w[id] = vis.reduce((a, m) => a + (dst.w[m] ?? 1), 0) / Math.max(1, vis.length);
      dst.mods.splice(dst.mods.indexOf(t.ref) + (t.after ? 1 : 0), 0, id);
    } else {
      // Schmal steht jedes Modul für sich: die neue Zeile kommt direkt an das Ziel-Modul, eine Zeile mit
      // mehreren Modulen wird dafür an dieser Stelle geteilt
      let at = L.rows.indexOf(dst) + (t.after ? 1 : 0);
      const k = dst.mods.indexOf(t.ref) + (t.after ? 1 : 0);
      if (narrow() && !t.edge && k > 0 && k < dst.mods.length) {
        const rest = dst.mods.splice(k);
        L.rows.splice(L.rows.indexOf(dst) + 1, 0, { id: 'r' + Date.now().toString(36) + 'b', mods: rest, h: dst.h, w: Object.fromEntries(rest.map(m => [m, dst.w[m] ?? 1])) });
        at = L.rows.indexOf(dst) + 1;
      }
      L.rows.splice(at, 0, { id: 'r' + Date.now().toString(36), mods: [id], h, w: { [id]: 1 } });
    }
  }

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
