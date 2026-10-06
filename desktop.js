'use strict';
// Desktop-Ansicht für die Windows-Version (Electron): eine App aus Modulen mit durchsichtigen Zwischenräumen.
// Die Module hängen zusammen: Zieht man einen Zwischenraum, wird das eine Modul größer und das andere kleiner.
// Anordnung einspaltig (hochkant) oder als eine Zeile (querformatig).
// Im Browser tut diese Datei nichts: nur die Desktop-Hülle stellt window.zeitjournalDesktop bereit.
(() => {
  const host = window.zeitjournalDesktop;
  if (!host) return;
  const BOARD_KEY = 'zeitjournal.board';
  const MIN = { col: 70, row: 180 };     // kleinste Modulgröße entlang der Anordnung
  const DEFS = [
    { id: 'uhr', name: 'Uhr', el: () => document.querySelector('.topbar'), w: 380 },
    { id: 'kategorien', name: 'Kategorien', el: () => $('palette'), w: 330 },
    { id: 'tag', name: 'Tag', el: () => document.querySelector('.day'), w: 760 },
    { id: 'summen', name: 'Summen', el: () => document.querySelector('.summary'), w: 480 },
    { id: 'woche', name: 'Woche', el: () => document.querySelector('.week'), w: 360 },
    { id: 'monat', name: 'Monat', el: () => document.querySelector('.month'), w: 360 },
    { id: 'extras', name: 'Extras', el: () => document.querySelector('.footer'), w: 330, hidden: true },
  ];
  const byId = Object.fromEntries(DEFS.map(d => [d.id, d]));

  document.documentElement.classList.add('desktop');

  // ---------- Gerüst ----------
  const board = document.createElement('div');
  board.id = 'board';
  board.innerHTML = `
    <div class="board-bar" title="Ziehen = ganze App verschieben">
      <span class="board-title">Zeitjournal</span>
      <span class="board-modes">
        <button data-mode="col" title="Einspaltig (hochkant)">▯ Spalte</button>
        <button data-mode="row" title="Eine Zeile (querformatig)">▭ Zeile</button>
      </span>
    </div>
    <div class="board-mods"></div>
    <div class="board-edge start" title="Ziehen = breiter oder schmaler"></div><div class="board-edge end" title="Ziehen = breiter oder schmaler"></div>`;
  document.body.prepend(board);
  const mods = board.querySelector('.board-mods');
  // Ausgeblendete Module bleiben im Dokument (die App greift auf ihre Elemente zu), nur unsichtbar
  const stash = document.createElement('div');
  stash.hidden = true;
  board.append(stash);

  const tiles = {};
  for (const d of DEFS) {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.tile = d.id;
    t.innerHTML = `<div class="tile-bar" title="Ziehen = Modul an eine andere Stelle schieben"><span>${d.name}</span>`
      + '<button class="tile-close" title="Modul ausblenden (über das Symbol in der Taskleiste wieder einblenden)">×</button></div>'
      + '<div class="tile-body"></div>';
    t.querySelector('.tile-body').append(d.el());
    t.querySelector('.tile-close').onclick = () => setHidden(d.id, true);
    t.querySelector('.tile-bar').addEventListener('pointerdown', ev => startReorder(ev, d.id));
    tiles[d.id] = t;
  }
  // Monat und Woche liegen jetzt in eigenen Modulen, die alte Übersicht samt Trenngriff wird nicht mehr gebraucht
  document.querySelector('.overview')?.remove();
  document.querySelector('main')?.remove();

  // ---------- Gespeicherte Anordnung ----------
  const fresh = () => ({
    mode: 'col',
    order: DEFS.map(d => d.id),
    hidden: Object.fromEntries(DEFS.map(d => [d.id, !!d.hidden])),
    size: { col: {}, row: {} },     // Größe je Modul entlang der Anordnung (Spalte: Höhe, Zeile: Breite)
    cross: { col: 480, row: 330 },  // Breite der Spalte bzw. Höhe der Zeile
    pos: { col: null, row: null },
  });
  let L = fresh();
  try {
    const s = JSON.parse(localStorage.getItem(BOARD_KEY));
    if (s && s.order) {
      L = Object.assign(fresh(), s);
      for (const d of DEFS) if (!L.order.includes(d.id)) L.order.push(d.id);
    }
  } catch (e) { /* Standard */ }
  function store() {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(L)); } catch (e) { /* ignorieren */ }
    host.reportTiles({ mode: L.mode, tiles: DEFS.map(d => ({ id: d.id, name: d.name, visible: !L.hidden[d.id] })) });
  }

  // ---------- Anordnen ----------
  const visible = () => L.order.filter(id => !L.hidden[id]);
  function defaultPos(mode) {
    return mode === 'col'
      ? { x: innerWidth - L.cross.col - 24, y: 16 }
      : { x: 16, y: innerHeight - L.cross.row - 40 };
  }
  function layout() {
    const m = L.mode;
    board.dataset.mode = m;
    board.querySelectorAll('.board-modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    mods.textContent = '';
    for (const id of L.order) if (L.hidden[id]) stash.append(tiles[id]);
    visible().forEach((id, i) => {
      if (i) {
        const g = document.createElement('div');
        g.className = 'gutter';
        g.title = 'Ziehen = Nachbarmodule größer oder kleiner';
        g.addEventListener('pointerdown', ev => startGutter(ev, i));
        mods.append(g);
      }
      const t = tiles[id], s = L.size[m][id];
      t.style.width = t.style.height = '';
      if (m === 'col') t.style.height = s ? s + 'px' : '';
      else t.style.width = (s || byId[id].w) + 'px';
      t.classList.toggle('sized', m === 'row' || !!s);
      mods.append(t);
    });
    if (m === 'col') { board.style.width = L.cross.col + 'px'; board.style.height = ''; }
    else { board.style.height = L.cross.row + 'px'; board.style.width = ''; }
    const p = L.pos[m] || defaultPos(m);
    place(p.x, p.y);
    window.dispatchEvent(new Event('resize'));   // Zeitleiste an die neue Breite anpassen
    store();
  }
  function place(x, y) {
    x = Math.round(Math.min(Math.max(0, x), Math.max(0, innerWidth - 120)));
    y = Math.round(Math.min(Math.max(0, y), Math.max(0, innerHeight - 40)));
    board.style.left = x + 'px';
    board.style.top = y + 'px';
    // Passt nicht alles auf den Bildschirm, lassen sich die Module innerhalb der App rollen
    board.style.maxWidth = (innerWidth - x - 8) + 'px';
    board.style.maxHeight = (innerHeight - y - 8) + 'px';
    L.pos[L.mode] = { x, y };
  }
  function setHidden(id, hidden) { L.hidden[id] = hidden; layout(); }
  function setMode(mode) { L.mode = mode; layout(); }
  board.querySelectorAll('.board-modes button').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });

  // ---------- Ziehen ----------
  let drag = null;
  const mainPos = ev => (L.mode === 'col' ? ev.clientY : ev.clientX);
  const mainSize = el => (L.mode === 'col' ? el.offsetHeight : el.offsetWidth);
  function begin(ev, d) {
    if (ev.button !== 0 || ev.target.closest('button')) return false;
    ev.preventDefault();
    drag = d;
    host.setInteractive(true);
    document.documentElement.classList.add('board-dragging');
    return true;
  }
  // Ganze App verschieben
  board.querySelector('.board-bar').addEventListener('pointerdown', ev => {
    begin(ev, { kind: 'move', dx: ev.clientX - board.offsetLeft, dy: ev.clientY - board.offsetTop });
  });
  // Zwischenraum ziehen: das Modul davor wächst, das danach schrumpft (oder umgekehrt)
  function startGutter(ev, i) {
    const ids = visible(), a = ids[i - 1], b = ids[i];
    begin(ev, { kind: 'gutter', a, b, p0: mainPos(ev), sa: mainSize(tiles[a]), sb: mainSize(tiles[b]) });
  }
  // Rand der App: Spalte breiter / Zeile höher
  board.querySelectorAll('.board-edge').forEach(e => e.addEventListener('pointerdown', ev => {
    begin(ev, { kind: 'edge', start: e.classList.contains('start'), p0: L.mode === 'col' ? ev.clientX : ev.clientY,
      c0: L.cross[L.mode], x0: board.offsetLeft, y0: board.offsetTop });
  }));
  // Modul an der Titelleiste an eine andere Stelle ziehen
  function startReorder(ev, id) {
    if (begin(ev, { kind: 'reorder', id })) tiles[id].classList.add('dragging');
  }
  window.addEventListener('pointermove', ev => {
    if (!drag) return;
    const m = L.mode;
    if (drag.kind === 'move') {
      place(ev.clientX - drag.dx, ev.clientY - drag.dy);
    } else if (drag.kind === 'gutter') {
      const total = drag.sa + drag.sb;
      const sa = Math.max(MIN[m], Math.min(total - MIN[m], drag.sa + mainPos(ev) - drag.p0));
      L.size[m][drag.a] = Math.round(sa);
      L.size[m][drag.b] = Math.round(total - sa);
      for (const id of [drag.a, drag.b]) {
        tiles[id].style[m === 'col' ? 'height' : 'width'] = L.size[m][id] + 'px';
        tiles[id].classList.add('sized');
      }
    } else if (drag.kind === 'edge') {
      const p = m === 'col' ? ev.clientX : ev.clientY;
      const d = (p - drag.p0) * (drag.start ? -1 : 1);
      const c = Math.round(Math.max(m === 'col' ? 300 : 160, drag.c0 + d));
      L.cross[m] = c;
      board.style[m === 'col' ? 'width' : 'height'] = c + 'px';
      if (drag.start) place(m === 'col' ? drag.x0 - (c - drag.c0) : drag.x0, m === 'col' ? drag.y0 : drag.y0 - (c - drag.c0));
    } else if (drag.kind === 'reorder') {
      // Einfügestelle: vor dem ersten Modul, dessen Mitte hinter dem Mauszeiger liegt
      const ids = visible().filter(id => id !== drag.id);
      const p = mainPos(ev);
      let at = ids.findIndex(id => {
        const r = tiles[id].getBoundingClientRect();
        return p < (m === 'col' ? r.top + r.height / 2 : r.left + r.width / 2);
      });
      if (at < 0) at = ids.length;
      const next = [...ids.slice(0, at), drag.id, ...ids.slice(at)];
      if (next.join() !== visible().join()) {
        L.order = [...next, ...L.order.filter(id => L.hidden[id])];
        layout();
        tiles[drag.id].classList.add('dragging');
      }
    }
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.kind === 'reorder') tiles[drag.id].classList.remove('dragging');
    drag = null;
    document.documentElement.classList.remove('board-dragging');
    window.dispatchEvent(new Event('resize'));
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
    else if (cmd.type === 'mode') setMode(cmd.mode);
    else if (cmd.type === 'reset') { const mode = L.mode; L = fresh(); L.mode = mode; layout(); }
    else if (cmd.type === 'lock') $('lockNow').click();
  });
  window.addEventListener('resize', () => {
    // Bildschirm kleiner geworden: App in den sichtbaren Bereich holen
    if (!drag && board.style.left) place(board.offsetLeft, board.offsetTop);
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
