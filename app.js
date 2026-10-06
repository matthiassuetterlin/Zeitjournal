'use strict';

// ---------- Kategorien ----------
const CATEGORIES = [
  { id: 'projekte', name: 'Projekte', color: '#2563eb' },
  { id: 'it-frankfurt', name: 'IT Frankfurt', color: '#0d9488' },
  { id: 'it-group', name: 'IT Group', color: '#7c3aed' },
  { id: 'intern', name: 'Intern allgemein', color: '#d97706' },
  { id: 'krankheit', name: 'Krankheit', color: '#dc2626' },
];
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
// Blautöne für einzelne Projekte, damit sie zur Kategorie „Projekte“ passen
const PROJECT_COLORS = ['#0ea5e9', '#1e40af', '#0891b2', '#60a5fa', '#0369a1', '#1d4ed8', '#155e75', '#38bdf8'];

// ---------- Zustand & Speicher ----------
const STORAGE_KEY = 'zeitjournal.v1';
const DAY_MIN = 24 * 60;

const state = {
  entries: [],      // { id, date: 'YYYY-MM-DD', start, end (Minuten ab 0:00), cat, project, title }
  projects: [],     // { id, name, color } – Unterprojekte der Kategorie „Projekte“
  running: null,    // id des laufenden Blocks
  cat: CATEGORIES[0].id,
  project: null,    // gewähltes Projekt für neue Blöcke
  snap: 15,
};
const projById = id => state.projects.find(p => p.id === id) || null;
// Farbe und Name eines Blocks: Projektblöcke zeigen ihr Projekt
const entryColor = e => (e.cat === 'projekte' && projById(e.project)?.color) || catById(e.cat).color;
const entryLabel = e => (e.cat === 'projekte' && projById(e.project)?.name) || catById(e.cat).name;
let viewDate = toDateStr(new Date());
let selectedId = null;
const history = [];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.entries)) Object.assign(state, saved);
  } catch (e) { /* leerer Start */ }
  if (!Array.isArray(state.projects)) state.projects = [];
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
}
function snapshot() {
  history.push(JSON.stringify({ entries: state.entries, projects: state.projects }));
  if (history.length > 100) history.shift();
}
function undo() {
  if (!history.length) return;
  Object.assign(state, JSON.parse(history.pop()));
  if (state.running && !state.entries.some(e => e.id === state.running)) state.running = null;
  save();
  render();
}

// ---------- Helfer ----------
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function mondayOf(s) {
  const d = parseDate(s);
  return addDays(s, -((d.getDay() + 6) % 7));
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
function fmtTime(m) {
  m = Math.round(m);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function fmtDur(m) {
  m = Math.round(m);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}\u00a0h`;
}
const snapTo = m => Math.round(m / state.snap) * state.snap;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dayEntries = date => state.entries.filter(e => e.date === date).sort((a, b) => a.start - b.start);

// Freie Lücken eines Tages (ohne den Block `exceptId`)
function gaps(date, exceptId) {
  const res = [];
  let cur = 0;
  for (const e of dayEntries(date)) {
    if (e.id === exceptId) continue;
    if (e.start > cur) res.push({ lo: cur, hi: e.start });
    cur = Math.max(cur, e.end);
  }
  if (cur < DAY_MIN) res.push({ lo: cur, hi: DAY_MIN });
  return res;
}
function gapAt(date, m, exceptId) {
  return gaps(date, exceptId).find(g => m >= g.lo && m <= g.hi) || null;
}

// ---------- Sichtbarer Bereich der Zeitleiste ----------
function viewRange() {
  let lo = 6 * 60, hi = 20 * 60;
  for (const e of dayEntries(viewDate)) { lo = Math.min(lo, e.start); hi = Math.max(hi, e.end); }
  if (viewDate === toDateStr(new Date())) { const n = nowMinutes(); lo = Math.min(lo, n); hi = Math.max(hi, n + 30); }
  return { lo: Math.floor(lo / 60) * 60, hi: Math.min(DAY_MIN, Math.ceil(hi / 60) * 60) };
}

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const track = $('track');

function render() {
  // Die Monatsansicht folgt dem gewählten Tag, bis man selbst blättert
  if (viewDate !== lastViewDate) { monthView = viewDate.slice(0, 7); lastViewDate = viewDate; }
  renderHeader();
  renderPalette();
  renderTrack();
  renderMonth();
  renderWeek();
  renderSummary();
}

function renderHeader() {
  const d = parseDate(viewDate);
  $('dateLabel').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const btn = $('startStop');
  const run = state.entries.find(e => e.id === state.running);
  btn.classList.toggle('running', !!run);
  btn.textContent = run ? '■ Stopp' : '▶ Start';
  if (run) {
    const dur = run.end - run.start;
    const secs = Math.floor((dur * 60) % 60);
    $('runningInfo').textContent = `${entryLabel(run)} läuft seit ${fmtTime(run.start)} · ${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    $('runningInfo').textContent = '';
  }
}

function renderPalette() {
  const p = $('palette');
  p.innerHTML = '';
  CATEGORIES.forEach((c, i) => {
    const active = state.cat === c.id;
    const b = document.createElement('button');
    b.className = 'cat' + (active ? ' active' : '');
    b.style.borderColor = active ? c.color : '';
    const proj = c.id === 'projekte' ? projById(state.project) : null;
    b.innerHTML = `<span class="dot" style="background:${proj ? proj.color : c.color}"></span>${c.name}<span class="sub"></span><kbd>${i + 1}</kbd>`;
    if (proj) b.querySelector('.sub').textContent = '· ' + proj.name;
    b.title = 'Kategorie wählen. Ist ein Block markiert, wird er umgefärbt. Läuft die Uhr, wird auf diese Kategorie gewechselt.';
    b.onclick = () => chooseCategory(c.id, c.id === 'projekte' ? state.project : undefined);
    if (c.id !== 'projekte') { p.appendChild(b); return; }
    // „Projekte“ bekommt ein Aufklappmenü für einzelne Projekte
    const group = document.createElement('div');
    group.className = 'cat-group';
    const more = document.createElement('button');
    more.className = 'cat-more' + (active ? ' active' : '');
    more.style.borderColor = active ? c.color : '';
    more.textContent = projMenuOpen ? '▴' : '▾';
    more.title = 'Projekt auswählen oder neu anlegen';
    more.onclick = () => { projMenuOpen = !projMenuOpen; renderPalette(); };
    group.append(b, more);
    if (projMenuOpen) group.appendChild(renderProjectMenu());
    p.appendChild(group);
  });
}

let projMenuOpen = false;
let renamingProject = null;
function renderProjectMenu() {
  const m = document.createElement('div');
  m.className = 'projmenu';
  if (!state.projects.length) m.insertAdjacentHTML('beforeend', '<div class="empty">Noch keine Projekte angelegt.</div>');
  const none = document.createElement('div');
  none.className = 'item' + (state.cat === 'projekte' && !state.project ? ' active' : '');
  none.innerHTML = `<span class="dot" style="background:${catById('projekte').color}"></span><span class="name">Ohne Projekt</span>`;
  none.onclick = () => { projMenuOpen = false; chooseCategory('projekte', null); };
  m.appendChild(none);
  for (const pr of state.projects) {
    const it = document.createElement('div');
    it.className = 'item' + (state.cat === 'projekte' && state.project === pr.id ? ' active' : '');
    it.innerHTML = `<span class="dot" style="background:${pr.color}"></span>`;
    if (renamingProject === pr.id) {
      const inp = document.createElement('input');
      inp.value = pr.name;
      const done = commit => {
        if (renamingProject !== pr.id) return;
        renamingProject = null;
        const v = inp.value.trim();
        if (commit && v && v !== pr.name) { snapshot(); pr.name = v; save(); }
        render();
      };
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      inp.onclick = ev => ev.stopPropagation();
      it.appendChild(inp);
      queueMicrotask(() => { inp.focus(); inp.select(); });
    } else {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = pr.name;
      it.appendChild(name);
      it.insertAdjacentHTML('beforeend', '<button class="act" data-a="ren" title="Umbenennen">✎</button><button class="act" data-a="del" title="Löschen">✕</button>');
    }
    it.onclick = ev => {
      const a = ev.target.dataset.a;
      if (a === 'ren') { renamingProject = pr.id; renderPalette(); return; }
      if (a === 'del') { deleteProject(pr.id); return; }
      if (renamingProject === pr.id) return;
      projMenuOpen = false;
      chooseCategory('projekte', pr.id);
    };
    m.appendChild(it);
  }
  const row = document.createElement('div');
  row.className = 'newrow';
  const inp = document.createElement('input');
  inp.placeholder = '+ Neues Projekt (Enter)';
  inp.onkeydown = ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { projMenuOpen = false; renderPalette(); }
    if (ev.key !== 'Enter' || !inp.value.trim()) return;
    snapshot();
    const pr = { id: uid(), name: inp.value.trim(), color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length] };
    state.projects.push(pr);
    projMenuOpen = false;
    chooseCategory('projekte', pr.id);
  };
  row.appendChild(inp);
  m.appendChild(row);
  return m;
}
async function deleteProject(id) {
  const pr = projById(id);
  const used = state.entries.filter(e => e.project === id).length;
  if (!await askConfirm(`Projekt „${pr.name}“ löschen?` + (used ? ` ${used} Block/Blöcke bleiben unter „Projekte“ ohne Projektnamen erhalten.` : ''), 'Löschen')) return;
  snapshot();
  state.projects = state.projects.filter(p => p.id !== id);
  for (const e of state.entries) if (e.project === id) e.project = null;
  if (state.project === id) state.project = null;
  save();
  render();
}

function renderTrack() {
  const { lo, hi } = viewRange();
  const span = hi - lo;
  const pct = m => ((m - lo) / span) * 100;
  // Zoom: Breite pro Stunde; 0 = ganzer Bereich passt ins Fenster
  const scroller = $('trackScroll');
  const fitPx = scroller.clientWidth / (span / 60);
  const hourPx = Math.max(fitPx, layout.hourPx || 0);
  $('trackInner').style.width = hourPx > fitPx + 0.5 ? `${(span / 60) * hourPx}px` : '100%';
  $('zoomFit').classList.toggle('active', !(hourPx > fitPx + 0.5));
  track.innerHTML = '';
  const scale = $('scale');
  scale.innerHTML = '';
  for (let m = lo; m <= hi; m += 30) {
    const g = document.createElement('div');
    g.className = 'gridline' + (m % 60 ? ' half' : '');
    g.style.left = pct(m) + '%';
    track.appendChild(g);
    if (m % 60 === 0) {
      const s = document.createElement('span');
      s.textContent = `${m / 60}:00`;
      s.style.left = pct(m) + '%';
      if (m === lo) s.style.transform = 'none';           // Randbeschriftung nicht abschneiden
      if (m === hi) s.style.transform = 'translateX(-100%)';
      scale.appendChild(s);
    }
  }
  if (viewDate === toDateStr(new Date())) {
    const n = document.createElement('div');
    n.className = 'now';
    n.style.left = pct(nowMinutes()) + '%';
    track.appendChild(n);
  }
  const trackW = track.clientWidth;
  for (const e of dayEntries(viewDate)) {
    const c = catById(e.cat);
    const el = document.createElement('div');
    // Schmale Blöcke: einzeilig mit „…“ (voller Text im Tooltip), sehr schmale nur Farbe
    const wPx = ((e.end - e.start) / span) * trackW;
    const size = wPx < 28 ? ' tiny' : wPx < 110 ? ' narrow' : '';
    el.className = 'block' + size + (e.id === selectedId ? ' selected' : '') + (e.id === state.running ? ' running' : '');
    el.dataset.id = e.id;
    el.style.left = pct(e.start) + '%';
    el.style.width = Math.max(0.3, pct(e.end) - pct(e.start)) + '%';
    el.style.background = entryColor(e);
    el.title = `${e.title || entryLabel(e)}${e.title && e.cat === 'projekte' ? ' (' + entryLabel(e) + ')' : ''}\n${fmtTime(e.start)}–${fmtTime(e.end)} (${fmtDur(e.end - e.start)})`;
    el.innerHTML = `<span class="title"></span><span class="meta">${fmtTime(e.start)}–${fmtTime(e.end)} · ${fmtDur(e.end - e.start)}</span>
      <div class="handle l" data-h="l"></div>${e.id === state.running ? '' : '<div class="handle r" data-h="r"></div>'}`;
    el.querySelector('.title').textContent = e.title || entryLabel(e);
    track.appendChild(el);
  }
  track._range = { lo, hi };
  // Beim Tageswechsel an die interessante Stelle scrollen (jetzt bzw. erster Block)
  if (scroller._date !== viewDate) {
    scroller._date = viewDate;
    const first = dayEntries(viewDate)[0];
    const target = viewDate === toDateStr(new Date()) ? nowMinutes() - 120 : first ? first.start - 30 : lo;
    scroller.scrollLeft = Math.max(0, ((target - lo) / span) * trackW);
  }
}

function renderWeek() {
  const mon = mondayOf(viewDate);
  const sun = addDays(mon, 6);
  $('weekLabel').textContent = `${parseDate(mon).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} – ${parseDate(sun).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`;
  const rows = $('weekRows');
  rows.innerHTML = '';
  const lo = 6 * 60, hi = 20 * 60;
  let wlo = lo, whi = hi;
  for (let i = 0; i < 7; i++) for (const e of dayEntries(addDays(mon, i))) { wlo = Math.min(wlo, e.start); whi = Math.max(whi, e.end); }
  wlo = Math.floor(wlo / 60) * 60; whi = Math.ceil(whi / 60) * 60;
  for (let i = 0; i < 7; i++) {
    const date = addDays(mon, i);
    const row = document.createElement('div');
    row.className = 'weekrow' + (date === viewDate ? ' current' : '');
    const label = parseDate(date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    let total = 0;
    const mini = document.createElement('div');
    mini.className = 'minitrack';
    for (const e of dayEntries(date)) {
      total += e.end - e.start;
      const b = document.createElement('div');
      b.style.left = ((e.start - wlo) / (whi - wlo)) * 100 + '%';
      b.style.width = ((e.end - e.start) / (whi - wlo)) * 100 + '%';
      b.style.background = entryColor(e);
      mini.appendChild(b);
    }
    row.innerHTML = `<span class="label">${label}</span>`;
    row.appendChild(mini);
    row.insertAdjacentHTML('beforeend', `<span class="total">${total ? fmtDur(total) : ''}</span>`);
    row.onclick = () => { viewDate = date; selectedId = null; render(); };
    rows.appendChild(row);
  }
}

// ---------- Monatsübersicht ----------
let monthView = null;      // 'YYYY-MM'
let lastViewDate = null;
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return toDateStr(d).slice(0, 7);
}
function renderMonth() {
  const [y, m] = monthView.split('-').map(Number);
  $('monthLabel').textContent = new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const grid = $('monthGrid');
  grid.innerHTML = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<span class="wd">${d}</span>`).join('');
  const first = `${monthView}-01`;
  const start = mondayOf(first);
  const today = toDateStr(new Date());
  let monthTotal = 0;
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    if (i >= 35 && date.slice(0, 7) !== monthView) break; // keine leere sechste Zeile
    const inMonth = date.slice(0, 7) === monthView;
    const dow = i % 7;
    // Minuten je Farbe, damit Projekte und Kategorien als Streifen erkennbar sind
    const parts = new Map();
    let total = 0;
    for (const e of dayEntries(date)) {
      const c = entryColor(e);
      parts.set(c, (parts.get(c) || 0) + (e.end - e.start));
      total += e.end - e.start;
    }
    if (inMonth) monthTotal += total;
    const cell = document.createElement('button');
    cell.className = 'mday' + (inMonth ? '' : ' other') + (dow >= 5 ? ' weekend' : '') +
      (date === viewDate ? ' current' : '') + (date === today ? ' today' : '');
    cell.title = parseDate(date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + (total ? ` · ${fmtDur(total)}` : '');
    const bar = total ? `<span class="mbar">${[...parts].map(([c, v]) => `<span style="flex:${v};background:${c}"></span>`).join('')}</span>` : '<span class="mbar empty"></span>';
    cell.innerHTML = `<span class="num">${Number(date.slice(8))}</span><span class="hrs">${total ? fmtDur(total).replace('\u00a0h', '') : ''}</span>${bar}`;
    cell.onclick = () => { viewDate = date; selectedId = null; render(); };
    grid.appendChild(cell);
  }
  $('monthTotal').textContent = monthTotal ? `Summe im Monat: ${fmtDur(monthTotal)}` : 'In diesem Monat ist noch nichts erfasst.';
}
$('prevMonth').onclick = () => { monthView = shiftMonth(monthView, -1); renderMonth(); };
$('nextMonth').onclick = () => { monthView = shiftMonth(monthView, 1); renderMonth(); };

function sums(dates) {
  const s = Object.fromEntries(CATEGORIES.map(c => [c.id, 0]));
  const proj = {}; // Minuten je Projekt (Schlüssel '' = ohne Projekt)
  for (const e of state.entries) {
    if (!dates.includes(e.date)) continue;
    s[e.cat] = (s[e.cat] || 0) + (e.end - e.start);
    if (e.cat === 'projekte') { const k = projById(e.project) ? e.project : ''; proj[k] = (proj[k] || 0) + (e.end - e.start); }
  }
  return { s, proj };
}
const esc = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
function renderSums(el, { s, proj }) {
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const row = (cls, name, v, color) => `
    <div class="sumrow ${cls}"><span>${esc(name)}</span>
      <div class="sumbar"><div style="width:${total ? (v / total) * 100 : 0}%;background:${color}"></div></div>
      <span class="v">${fmtDur(v)}</span></div>`;
  el.innerHTML = CATEGORIES.map(c => {
    let h = row('', c.name, s[c.id], c.color);
    if (c.id === 'projekte' && state.projects.length) {
      for (const pr of state.projects) if (proj[pr.id]) h += row('subrow', pr.name, proj[pr.id], pr.color);
      if (proj['']) h += row('subrow', 'ohne Projekt', proj[''], c.color);
    }
    return h;
  }).join('') +
    `<div class="sumrow sumtotal"><span>Gesamt</span><span></span><span class="v">${fmtDur(total)}</span></div>`;
}
function renderSummary() {
  renderSums($('sumDay'), sums([viewDate]));
  const mon = mondayOf(viewDate);
  renderSums($('sumWeek'), sums([0, 1, 2, 3, 4, 5, 6].map(i => addDays(mon, i))));
}

// ---------- Aktionen ----------
// project: bei „Projekte“ das gewählte Projekt (null = ohne), sonst undefined
function chooseCategory(id, project) {
  state.cat = id;
  if (id === 'projekte' && project !== undefined) state.project = project;
  const proj = id === 'projekte' ? state.project : null;
  const sel = state.entries.find(e => e.id === selectedId);
  if (sel) {
    snapshot();
    sel.cat = id;
    sel.project = proj;
  } else if (state.running) {
    const run = state.entries.find(e => e.id === state.running);
    if (run && (run.cat !== id || (run.project || null) !== proj)) { stopTimer(); startTimer(); }
  }
  save();
  render();
}
const currentProject = () => (state.cat === 'projekte' ? state.project : null);

function startTimer() {
  const today = toDateStr(new Date());
  const n = nowMinutes();
  snapshot();
  // Läuft der Timer direkt im Anschluss an einen Block derselben Kategorie, wird dieser verlängert.
  const prev = dayEntries(today).find(e => e.cat === state.cat && (e.project || null) === currentProject() && n - e.end >= 0 && n - e.end < 1);
  let e = prev;
  // Läuft gerade ein anderer Block über „jetzt“ hinaus, endet er jetzt.
  for (const o of dayEntries(today)) if (o !== e && o.start < n && o.end > n) o.end = Math.max(o.start, Math.floor(n));
  if (!e) {
    e = { id: uid(), date: today, start: n, end: n, cat: state.cat, project: currentProject(), title: '' };
    state.entries.push(e);
  }
  state.running = e.id;
  viewDate = today;
  save();
  render();
}
function stopTimer() {
  const e = state.entries.find(x => x.id === state.running);
  state.running = null;
  if (e) {
    e.start = Math.round(e.start);
    e.end = Math.max(e.start, Math.floor(e.end));
    if (e.end - e.start < 1) state.entries = state.entries.filter(x => x !== e);
  }
  save();
  render();
}
function tick() {
  const e = state.entries.find(x => x.id === state.running);
  if (e) {
    const today = toDateStr(new Date());
    if (e.date !== today) {
      // Über Mitternacht: alten Block um 24:00 abschließen und heute weiterlaufen lassen.
      e.end = DAY_MIN;
      const n = { id: uid(), date: today, start: 0, end: nowMinutes(), cat: e.cat, project: e.project, title: e.title };
      state.entries.push(n);
      state.running = n.id;
    } else {
      e.end = Math.max(e.start, nowMinutes());
    }
    save();
  }
  if (!drag) { renderHeader(); renderTrack(); if (e) { renderMonth(); renderWeek(); renderSummary(); } }
}

function deleteSelected() {
  if (!selectedId) return;
  snapshot();
  state.entries = state.entries.filter(e => e.id !== selectedId);
  if (state.running === selectedId) state.running = null;
  selectedId = null;
  save();
  render();
}

// ---------- Maus-Interaktion auf der Zeitleiste ----------
let drag = null;
let lastClick = { id: null, t: 0 };
let pendingEdit = null;

function minutesAt(clientX) {
  const r = track.getBoundingClientRect();
  const { lo, hi } = track._range;
  return lo + clamp((clientX - r.left) / r.width, 0, 1) * (hi - lo);
}

track.addEventListener('pointerdown', ev => {
  ev.stopPropagation(); // sonst hebt der Dokument-Handler die Markierung gleich wieder auf
  if (ev.button !== 0) return;
  closeEditor(true);
  projMenuOpen = false;
  const blockEl = ev.target.closest('.block');
  const m = minutesAt(ev.clientX);
  if (blockEl) {
    const e = state.entries.find(x => x.id === blockEl.dataset.id);
    selectedId = e.id;
    // Doppelklick selbst erkennen, weil die Leiste jede Sekunde neu gezeichnet wird
    const dbl = lastClick.id === e.id && ev.timeStamp - lastClick.t < 400;
    lastClick = { id: e.id, t: ev.timeStamp };
    if (dbl) { pendingEdit = e.id; return; }
    const h = ev.target.dataset.h;
    const isRunning = e.id === state.running;
    if (isRunning && !h) { render(); return; } // laufenden Block nicht verschieben
    snapshot();
    drag = { mode: h === 'l' ? 'left' : h === 'r' ? 'right' : 'move', id: e.id, x0: ev.clientX, m0: m, start0: e.start, end0: e.end, moved: false };
  } else {
    const g = gapAt(viewDate, m);
    if (!g) return;
    snapshot();
    const anchor = clamp(snapTo(m), g.lo, g.hi);
    const e = { id: uid(), date: viewDate, start: anchor, end: anchor, cat: state.cat, project: currentProject(), title: '' };
    state.entries.push(e);
    selectedId = e.id;
    drag = { mode: 'create', id: e.id, x0: ev.clientX, anchor, gap: g, moved: false };
  }
  track.setPointerCapture(ev.pointerId);
  render();
});

track.addEventListener('pointermove', ev => {
  if (!drag) return;
  if (Math.abs(ev.clientX - drag.x0) > 3) drag.moved = true;
  if (!drag.moved) return;
  const e = state.entries.find(x => x.id === drag.id);
  const m = minutesAt(ev.clientX);
  if (drag.mode === 'create') {
    const t = clamp(snapTo(m), drag.gap.lo, drag.gap.hi);
    e.start = Math.min(drag.anchor, t);
    e.end = Math.max(drag.anchor, t);
  } else if (drag.mode === 'move') {
    const dur = drag.end0 - drag.start0;
    const want = snapTo(drag.start0 + (m - drag.m0));
    // nächstgelegene freie Lücke, in die der Block passt
    let best = null;
    for (const g of gaps(viewDate, e.id)) {
      if (g.hi - g.lo < dur) continue;
      const s = clamp(want, g.lo, g.hi - dur);
      if (!best || Math.abs(s - want) < Math.abs(best - want)) best = s;
    }
    if (best !== null) { e.start = best; e.end = best + dur; }
  } else if (drag.mode === 'left') {
    const g = gapAt(viewDate, drag.start0, e.id);
    e.start = clamp(snapTo(m), g ? g.lo : 0, e.end - state.snap);
  } else if (drag.mode === 'right') {
    const g = gapAt(viewDate, drag.end0, e.id);
    e.end = clamp(snapTo(m), e.start + state.snap, g ? g.hi : DAY_MIN);
  }
  renderTrack();
});

function endDrag() {
  if (!drag) return;
  const e = state.entries.find(x => x.id === drag.id);
  if (drag.mode === 'create' && e) {
    if (!drag.moved || e.end - e.start < state.snap) {
      // Einfacher Klick: Block mit 1 Stunde (soweit Platz ist)
      e.start = drag.anchor;
      e.end = Math.min(drag.anchor + 60, drag.gap.hi);
      if (e.end - e.start < state.snap) { e.start = Math.max(drag.gap.lo, e.end - 60); }
      if (e.end - e.start < 1) state.entries = state.entries.filter(x => x !== e);
    }
  } else if (!drag.moved) {
    history.pop(); // reiner Klick zum Markieren ist keine Änderung
  }
  drag = null;
  save();
  render();
}
track.addEventListener('pointerup', () => {
  endDrag();
  // Editor erst nach dem Loslassen öffnen, sonst nimmt der Klick ihm den Fokus
  if (pendingEdit) { const id = pendingEdit; pendingEdit = null; render(); openEditor(id); }
});
track.addEventListener('pointercancel', endDrag);


// ---------- Umbenennen ----------
let editingId = null;
function openEditor(id) {
  const blockEl = track.querySelector(`.block[data-id="${id}"]`);
  const e = state.entries.find(x => x.id === id);
  if (!blockEl || !e) return;
  editingId = id;
  const r = blockEl.getBoundingClientRect();
  const ed = $('editor');
  ed.hidden = false;
  ed.style.left = Math.min(r.left, window.innerWidth - 260) + 'px';
  ed.style.top = r.bottom + 6 + 'px';
  const inp = $('editorInput');
  inp.value = e.title || '';
  inp.focus();
  inp.select();
}
function closeEditor(commit) {
  if (!editingId) return;
  const e = state.entries.find(x => x.id === editingId);
  if (commit && e && e.title !== $('editorInput').value.trim()) {
    snapshot();
    e.title = $('editorInput').value.trim();
    save();
  }
  editingId = null;
  selectedId = null;
  $('editorInput').blur();
  $('editor').hidden = true;
  render();
}
$('editorInput').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') closeEditor(true);
  if (ev.key === 'Escape') closeEditor(false);
  ev.stopPropagation();
});
$('editorInput').addEventListener('blur', () => closeEditor(true));

// ---------- Tastatur ----------
document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
  if (ev.key === ' ') { ev.preventDefault(); $('startStop').click(); }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') deleteSelected();
  else if (ev.key === 'Escape') { selectedId = null; render(); }
  else if (ev.key === 'Enter' && selectedId) openEditor(selectedId);
  else if (ev.key === 'ArrowLeft') $('prevDay').click();
  else if (ev.key === 'ArrowRight') $('nextDay').click();
  else if (ev.key.toLowerCase() === 't') $('today').click();
  else if (ev.key === '+') zoomTimeline(1.6);
  else if (ev.key === '-') zoomTimeline(1 / 1.6);
  else if (/^[1-9]$/.test(ev.key) && CATEGORIES[ev.key - 1]) chooseCategory(CATEGORIES[ev.key - 1].id);
});

// Klick ins Leere hebt die Markierung auf
document.addEventListener('pointerdown', ev => {
  if (projMenuOpen && !ev.target.closest('.cat-group')) { projMenuOpen = false; renderPalette(); }
  if (!ev.target.closest('.track, .palette, .editor') && selectedId) { selectedId = null; render(); }
});

// ---------- Knöpfe ----------
$('startStop').onclick = () => (state.running ? stopTimer() : startTimer());
$('prevDay').onclick = () => { viewDate = addDays(viewDate, -1); selectedId = null; render(); };
$('nextDay').onclick = () => { viewDate = addDays(viewDate, 1); selectedId = null; render(); };
$('today').onclick = () => { viewDate = toDateStr(new Date()); selectedId = null; render(); };
$('snap').onchange = ev => { state.snap = Number(ev.target.value); save(); };

$('copyYesterday').onclick = async () => {
  const src = [...new Set(state.entries.map(e => e.date))].filter(d => d < viewDate).sort().pop();
  if (!src) { toast('Kein früherer Tag mit Einträgen gefunden.'); return; }
  if (dayEntries(viewDate).length && !await askConfirm('Für diesen Tag gibt es schon Blöcke. Trotzdem Blöcke vom ' + parseDate(src).toLocaleDateString('de-DE') + ' dazu übernehmen (nur in freie Lücken)?', 'Übernehmen')) return;
  snapshot();
  for (const e of dayEntries(src)) {
    const g = gapAt(viewDate, e.start);
    if (!g || g.hi < e.end || e.start === g.hi) continue;
    state.entries.push({ ...e, id: uid(), date: viewDate });
  }
  save();
  render();
};

// In eine fremde Seite eingebettet (z. B. als Artifact) sind Downloads gesperrt: dann in die Zwischenablage kopieren.
const embedded = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
async function download(name, text, type) {
  if (embedded) {
    try { await navigator.clipboard.writeText(text.replace(/^\ufeff/, '')); toast(`${name} in die Zwischenablage kopiert.`); }
    catch (e) { toast('Herunterladen ist hier nicht möglich. Öffne das Zeitjournal im Browser.'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('exportCsv').onclick = () => {
  const rows = [['Datum', 'Start', 'Ende', 'Dauer (h)', 'Kategorie', 'Projekt', 'Bezeichnung']];
  for (const e of [...state.entries].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    rows.push([e.date, fmtTime(e.start), fmtTime(e.end), ((e.end - e.start) / 60).toFixed(2).replace('.', ','), catById(e.cat).name, (e.cat === 'projekte' && projById(e.project)?.name) || '', e.title || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download('zeitjournal.csv', '﻿' + csv, 'text/csv');
};
$('exportJson').onclick = () => download(`zeitjournal-${toDateStr(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
$('importJson').onchange = async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.entries)) throw new Error();
    if (!await askConfirm(`${data.entries.length} Einträge laden? Die aktuellen Daten werden ersetzt.`, 'Laden')) return;
    snapshot();
    Object.assign(state, { projects: [] }, data);
    save();
    render();
  } catch (e) {
    toast('Die Datei konnte nicht gelesen werden.');
  } finally {
    ev.target.value = '';
  }
};

// ---------- Bereiche größer/kleiner ziehen ----------
const LAYOUT_KEY = 'zeitjournal.layout';
const LAYOUT_DEFAULT = { trackH: 120, monthW: 340, hourPx: 0 };
let layout = { ...LAYOUT_DEFAULT };
try { Object.assign(layout, JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}); } catch (e) { /* Standard */ }
function applyLayout() {
  layout.trackH = clamp(Math.round(layout.trackH), 70, 520);
  layout.monthW = clamp(Math.round(layout.monthW), 240, 760);
  layout.hourPx = Math.max(0, Number(layout.hourPx) || 0);
  document.documentElement.style.setProperty('--track-h', layout.trackH + 'px');
  document.documentElement.style.setProperty('--month-w', layout.monthW + 'px');
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) { /* ignorieren */ }
}
// key: Wert in layout, axis: 'y' oder 'x', step: Pfeiltasten-Schritt
function makeResizer(el, key, axis, step) {
  el.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const start = axis === 'y' ? ev.clientY : ev.clientX;
    const v0 = layout[key];
    el.setPointerCapture(ev.pointerId);
    el.classList.add('dragging');
    document.body.classList.add('resizing');
    document.body.style.cursor = axis === 'y' ? 'ns-resize' : 'ew-resize';
    const move = e => { layout[key] = v0 + ((axis === 'y' ? e.clientY : e.clientX) - start); applyLayout(); };
    const up = () => {
      el.classList.remove('dragging');
      document.body.classList.remove('resizing');
      document.body.style.cursor = '';
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => { layout[key] = LAYOUT_DEFAULT[key]; applyLayout(); });
  el.addEventListener('keydown', ev => {
    const d = { ArrowDown: step, ArrowRight: step, ArrowUp: -step, ArrowLeft: -step }[ev.key];
    if (!d) return;
    ev.preventDefault();
    ev.stopPropagation(); // sonst wechselt ←/→ den Tag
    layout[key] += d;
    applyLayout();
  });
}
makeResizer($('trackResize'), 'trackH', 'y', 20);

// Zoom der Zeitleiste; der Punkt unter der Maus (oder die Mitte) bleibt stehen
function zoomTimeline(factor, clientX) {
  const sc = $('trackScroll');
  const { lo, hi } = track._range;
  const fitPx = sc.clientWidth / ((hi - lo) / 60);
  const cur = Math.max(fitPx, layout.hourPx || 0);
  const r = sc.getBoundingClientRect();
  const anchorX = clientX === undefined ? sc.clientWidth / 2 : clientX - r.left;
  const anchorMin = lo + ((sc.scrollLeft + anchorX) / (cur * (hi - lo) / 60)) * (hi - lo);
  let next = clamp(cur * factor, fitPx, 900);
  layout.hourPx = next <= fitPx + 0.5 ? 0 : next;
  applyLayout();
  renderTrack();
  const w = (hi - lo) / 60 * Math.max(fitPx, layout.hourPx);
  sc.scrollLeft = ((anchorMin - lo) / (hi - lo)) * w - anchorX;
}
$('zoomIn').onclick = () => zoomTimeline(1.6);
$('zoomOut').onclick = () => zoomTimeline(1 / 1.6);
$('zoomFit').onclick = () => { layout.hourPx = 0; applyLayout(); renderTrack(); };
$('trackScroll').addEventListener('wheel', ev => {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  zoomTimeline(ev.deltaY < 0 ? 1.25 : 0.8, ev.clientX);
}, { passive: false });
window.addEventListener('resize', () => renderTrack());
makeResizer($('monthResize'), 'monthW', 'x', 20);
applyLayout();

// ---------- Rückfragen & Hinweise (statt confirm/alert, die eingebettet nicht funktionieren) ----------
function askConfirm(text, okLabel = 'OK') {
  return new Promise(resolve => {
    const d = $('confirmDialog');
    $('confirmText').textContent = text;
    $('confirmOk').textContent = okLabel;
    d.hidden = false;
    $('confirmOk').focus();
    const done = v => { d.hidden = true; document.removeEventListener('keydown', key, true); resolve(v); };
    const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    $('confirmOk').onclick = () => done(true);
    $('confirmCancel').onclick = () => done(false);
  });
}
let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- Hell / Dunkel ----------
function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function renderThemeToggle() {
  const dark = currentTheme() === 'dark';
  $('themeToggle').textContent = dark ? '☀' : '☾';
  $('themeToggle').title = dark ? 'Helles Design' : 'Dunkles Design';
}
$('themeToggle').onclick = () => {
  const t = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('zeitjournal.theme', t); } catch (e) { /* ignorieren */ }
  renderThemeToggle();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderThemeToggle);

// ---------- Start ----------
load();
$('snap').value = String(state.snap);
renderThemeToggle();
render();
setInterval(tick, 1000);
