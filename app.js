'use strict';

// ---------- Kategorien ----------
const CATEGORIES = [
  { id: 'projekte', name: 'Projekte', color: '#4f7cac' },
  { id: 'it-frankfurt', name: 'IT Frankfurt', color: '#5e9c8f' },
  { id: 'it-group', name: 'IT Group', color: '#8a6fb0' },
  { id: 'intern', name: 'Intern allgemein', color: '#d08c4a' },
  { id: 'krankheit', name: 'Krankheit', color: '#c2564b' },
];
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
const DEFAULT_COLORS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.color]));
// Blautöne für einzelne Projekte, damit sie zur Kategorie „Projekte“ passen
const PROJECT_COLORS = ['#7fa7cf', '#3f6a93', '#6c93b8', '#2f5577', '#9bbbd9', '#4c789f', '#5f86ae', '#2a4a6b'];
// Frühere, grellere Projektfarben werden beim Zeichnen durch die neuen an gleicher Stelle ersetzt
const OLD_PROJECT_COLORS = ['#0ea5e9', '#1e40af', '#0891b2', '#60a5fa', '#0369a1', '#1d4ed8', '#155e75', '#38bdf8'];
// Gut lesbare Schrift auf einer Blockfarbe: dunkel auf hellen Farben, sonst weiß
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), lin = c => { c /= 255; return c <= 0.04 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#1f1f1d' : '#fff';
}

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
  catColors: {},   // selbst gewählte Farben der Kategorien
};
const projById = id => state.projects.find(p => p.id === id) || null;
// Farbe und Name eines Blocks: Projektblöcke zeigen ihr Projekt
const entryColor = e => (e.cat === 'projekte' && projById(e.project)?.color) || catById(e.cat).color;
const entryLabel = e => (e.cat === 'projekte' && projById(e.project)?.name) || catById(e.cat).name;
let viewDate = toDateStr(new Date());
let selectedId = null;
const history = [];   // Zustände vor einer Änderung
const future = [];    // für Wiederholen zurückgelegte Zustände

// ---------- Speichern: mit dem Code verschlüsselt (AES-GCM, Schlüssel per PBKDF2) ----------
const ENC_KEY = 'zeitjournal.v1.enc';  // { salt, iv, data } als Base64
let cryptoKey = null;                  // gesetzt, sobald entsperrt
let cryptoSalt = null;
const te = new TextEncoder(), td = new TextDecoder();
const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function readEncrypted() {
  try { return JSON.parse(localStorage.getItem(ENC_KEY)); } catch (e) { return null; }
}
// Alte, unverschlüsselte Daten (vor dem Passwortschutz)
function loadPlain() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.entries)) Object.assign(state, saved);
  } catch (e) { /* leerer Start */ }
  if (!Array.isArray(state.projects)) state.projects = [];
}
async function persist() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, te.encode(JSON.stringify(state)));
  localStorage.setItem(ENC_KEY, JSON.stringify({ v: 1, kind: 'pin', salt: toB64(cryptoSalt), iv: toB64(iv), data: toB64(data) }));
}
let saving = null, saveAgain = false;
function save() {
  if (!cryptoKey) return;
  if (saving) { saveAgain = true; return; }
  saving = persist().catch(() => toast('Speichern hat nicht geklappt.')).finally(() => {
    saving = null;
    if (saveAgain) { saveAgain = false; save(); }
  });
}
async function flushSave() {
  while (saving) await saving;
}
async function unlockWith(pw) {
  const rec = readEncrypted();
  const salt = fromB64(rec.salt);
  const key = await deriveKey(pw, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, key, fromB64(rec.data)); // wirft bei falschem Passwort
  Object.assign(state, { catColors: {}, sync: undefined }, JSON.parse(td.decode(plain)));
  if (!Array.isArray(state.projects)) state.projects = [];
  cryptoKey = key; cryptoSalt = salt;
}
async function setPassword(pw) {
  cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
  cryptoKey = await deriveKey(pw, cryptoSalt);
  await flushSave();
  await persist();
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignorieren */ }
}
const snapState = () => JSON.stringify({ entries: state.entries, projects: state.projects });
function snapshot() {
  history.push(snapState());
  if (history.length > 100) history.shift();
  future.length = 0;   // nach einer neuen Änderung gibt es nichts mehr zu wiederholen
}
function stepHistory(from, to) {
  if (!from.length) return;
  to.push(snapState());
  Object.assign(state, JSON.parse(from.pop()));
  if (state.running && !state.entries.some(e => e.id === state.running)) state.running = null;
  selectedId = null;
  save();
  render();
}
const undo = () => stepHistory(history, future);
const redo = () => stepHistory(future, history);
function renderHistoryButtons() {
  $('undo').disabled = !history.length;
  $('redo').disabled = !future.length;
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
  // Selbst gewählte Farben übernehmen
  CATEGORIES.forEach(c => { c.color = state.catColors?.[c.id] || DEFAULT_COLORS[c.id]; });
  for (const pr of state.projects) { const i = OLD_PROJECT_COLORS.indexOf(pr.color); if (i >= 0) pr.color = PROJECT_COLORS[i]; }
  renderHistoryButtons();
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
  // Inneres Raster, damit sich die Spaltenzahl nach der Breite der Kachel richten kann
  const p = document.createElement('div');
  p.className = 'cats';
  $('palette').replaceChildren(p);
  CATEGORIES.forEach((c, i) => {
    const active = state.cat === c.id;
    const b = document.createElement('button');
    b.className = 'cat' + (active ? ' active' : '');
    b.style.borderColor = active ? c.color : '';
    const proj = c.id === 'projekte' ? projById(state.project) : null;
    b.innerHTML = `<span class="dot" style="background:${proj ? proj.color : c.color}"></span><span class="name">${c.name}<span class="sub"></span></span><kbd>${i + 1}</kbd><span class="dots" title="Farbe ändern">⋯</span>`;
    if (proj) b.querySelector('.sub').textContent = '· ' + proj.name;
    b.title = 'Kategorie wählen. Ist ein Block markiert, wird er umgefärbt. Läuft die Uhr, wird auf diese Kategorie gewechselt.';
    b.onclick = ev => {
      if (ev.target.closest('.dots')) { const r = ev.target.getBoundingClientRect(); openColorMenu(r.left, r.bottom + 4, { type: 'cat', id: c.id }); return; }
      chooseCategory(c.id, c.id === 'projekte' ? state.project : undefined);
    };
    b.oncontextmenu = ev => { ev.preventDefault(); openColorMenu(ev.clientX, ev.clientY, { type: 'cat', id: c.id }); };
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
      it.insertAdjacentHTML('beforeend', '<button class="act" data-a="col" title="Farbe ändern">●</button><button class="act" data-a="ren" title="Umbenennen">✎</button><button class="act" data-a="del" title="Löschen">✕</button>');
    }
    it.onclick = ev => {
      const a = ev.target.dataset.a;
      if (a === 'col') { const r = ev.target.getBoundingClientRect(); openColorMenu(r.left, r.bottom + 4, { type: 'proj', id: pr.id }); return; }
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
  // Bei wenig Platz nur jede zweite (bzw. dritte) Stunde beschriften
  const pxPerHour = track.clientWidth / (span / 60);
  const labelStep = pxPerHour < 26 ? 180 : pxPerHour < 42 ? 120 : 60;
  for (let m = lo; m <= hi; m += 30) {
    const g = document.createElement('div');
    g.className = 'gridline' + (m % 60 ? ' half' : '');
    g.style.left = pct(m) + '%';
    track.appendChild(g);
    if (m % labelStep === 0) {
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
    el.style.color = textOn(entryColor(e));
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

// Summen in der Reihenfolge ihres ersten Blocks in der Zeitleiste. Jedes Projekt ist eine eigene Zeile
// („Projekte · 01“), damit z. B. 01, IT Frankfurt, 02 genau so untereinander stehen wie am Tag.
// Kategorien ohne Zeit stehen mit 0:00 am Ende.
function sums(dates) {
  const rows = new Map();
  const list = state.entries.filter(e => dates.includes(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  for (const e of list) {
    const c = catById(e.cat);
    const pr = c.id === 'projekte' ? projById(e.project) : null;
    const k = pr ? 'p:' + pr.id : c.id;
    if (!rows.has(k)) rows.set(k, pr ? { name: `${c.name} · ${pr.name}`, color: pr.color, v: 0 } : { name: c.name, color: c.color, v: 0 });
    rows.get(k).v += e.end - e.start;
  }
  for (const c of CATEGORIES) {
    const used = c.id === 'projekte' ? [...rows.keys()].some(k => k === 'projekte' || k.startsWith('p:')) : rows.has(c.id);
    if (!used) rows.set(c.id, { name: c.name, color: c.color, v: 0 });
  }
  return [...rows.values()];
}
const esc = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
function renderSums(el, rows) {
  const total = rows.reduce((a, r) => a + r.v, 0);
  const row = (cls, r) => `
    <div class="sumrow ${cls}"><span>${esc(r.name)}</span>
      <div class="sumbar"><div style="width:${total ? (r.v / total) * 100 : 0}%;background:${r.color}"></div></div>
      <span class="v">${fmtDur(r.v)}</span></div>`;
  el.innerHTML = rows.map(r => row(r.v ? '' : 'zero', r)).join('') +
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
  if (!cryptoKey) return;
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
    // Nachbar auf der gezogenen Seite: wird mitverkleinert bzw. folgt, wenn er direkt anliegt
    const others = dayEntries(viewDate).filter(o => o.id !== e.id && o.id !== state.running);
    const nb = h === 'l' ? others.filter(o => o.end <= e.start + 0.5).pop()
             : h === 'r' ? others.find(o => o.start >= e.end - 0.5) : null;
    if (nb) drag.nb = { id: nb.id, start0: nb.start, end0: nb.end, touching: Math.abs(h === 'l' ? nb.end - e.start : nb.start - e.end) < 0.5 };
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
    const nb = drag.nb && state.entries.find(x => x.id === drag.nb.id);
    // in den Nachbarn hinein darf man ziehen, bis von ihm noch ein Rasterschritt übrig ist
    const lo = nb ? drag.nb.start0 + state.snap : (gapAt(viewDate, drag.start0, e.id)?.lo ?? 0);
    e.start = clamp(snapTo(m), Math.min(lo, e.end - state.snap), e.end - state.snap);
    if (nb) nb.end = drag.nb.touching ? e.start : Math.min(drag.nb.end0, e.start);
  } else if (drag.mode === 'right') {
    const nb = drag.nb && state.entries.find(x => x.id === drag.nb.id);
    const hi = nb ? drag.nb.end0 - state.snap : (gapAt(viewDate, drag.end0, e.id)?.hi ?? DAY_MIN);
    e.end = clamp(snapTo(m), e.start + state.snap, Math.max(hi, e.start + state.snap));
    if (nb) nb.start = drag.nb.touching ? e.end : Math.max(drag.nb.start0, e.end);
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
    renderHistoryButtons();
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
  if (!cryptoKey || !$('lock').hidden) return;
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
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
$('undo').onclick = undo;
$('redo').onclick = redo;
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
$('exportJson').onclick = () => download(`zeitjournal-${toDateStr(new Date())}.json`, JSON.stringify({ ...state, sync: undefined }, null, 2), 'application/json');
$('importJson').onchange = async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.entries)) throw new Error();
    if (!await askConfirm(`${data.entries.length} Einträge laden? Die aktuellen Daten werden ersetzt.`, 'Laden')) return;
    snapshot();
    Object.assign(state, { projects: [], catColors: {} }, data);
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

// ---------- Farben ändern (Rechtsklick auf Block oder Kategorie, ⋯ an der Kategorie) ----------
// Abgestimmte, gedeckte Farben (warm → kühl), die auf hellem und dunklem Grund ruhig wirken
const SWATCHES = ['#c2564b', '#d9765f', '#d08c4a', '#d6b25e', '#a3a65b', '#6f9e6a', '#5e9c8f', '#4e8a9a',
  '#4f7cac', '#7fa7cf', '#3f5f8a', '#8a6fb0', '#a8668e', '#c27a8f', '#8c7b6b', '#7a7a75'];
const colorMenu = document.createElement('div');
colorMenu.className = 'colormenu';
colorMenu.hidden = true;
document.body.appendChild(colorMenu);
function openColorMenu(x, y, target) {
  const proj = target.type === 'proj' ? projById(target.id) : null;
  if (target.type === 'proj' && !proj) return;
  const cat = catById(target.id);
  const current = proj ? proj.color : cat.color;
  colorMenu.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Farbe für ' + (proj ? proj.name : cat.name);
  const grid = document.createElement('div');
  grid.className = 'swatches';
  for (const col of SWATCHES) {
    const sw = document.createElement('button');
    sw.style.background = col;
    sw.title = col;
    if (col.toLowerCase() === current.toLowerCase()) sw.classList.add('current');
    sw.onclick = () => setColor(target, col);
    grid.appendChild(sw);
  }
  const own = document.createElement('label');
  own.className = 'own';
  own.innerHTML = '<input type="color"> Eigene Farbe …';
  const inp = own.querySelector('input');
  inp.value = current;
  inp.oninput = () => setColor(target, inp.value, true);
  inp.onchange = () => closeColorMenu();
  colorMenu.append(title, grid, own);
  if (!proj && state.catColors[target.id]) {
    const reset = document.createElement('button');
    reset.className = 'reset';
    reset.textContent = 'Standardfarbe';
    reset.onclick = () => setColor(target, null);
    colorMenu.appendChild(reset);
  }
  colorMenu.hidden = false;
  const w = colorMenu.offsetWidth, h = colorMenu.offsetHeight;
  colorMenu.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
  colorMenu.style.top = (y + h > innerHeight - 8 ? Math.max(8, y - h) : y) + 'px';
}
function closeColorMenu() { colorMenu.hidden = true; }
function setColor(target, col, keepOpen) {
  if (target.type === 'proj') {
    const pr = projById(target.id);
    if (!pr || pr.color === col) return;
    if (!keepOpen) snapshot();
    pr.color = col;
  } else {
    if (col) state.catColors[target.id] = col; else delete state.catColors[target.id];
  }
  save();
  render();
  if (!keepOpen) closeColorMenu();
}
document.addEventListener('pointerdown', ev => { if (!colorMenu.hidden && !colorMenu.contains(ev.target)) closeColorMenu(); }, true);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !colorMenu.hidden) { ev.stopPropagation(); closeColorMenu(); } }, true);
// Rechtsklick auf einen Block: Farbe seines Projekts bzw. seiner Kategorie, auf freier Leiste: gewählte Kategorie
track.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  const blockEl = ev.target.closest('.block');
  const e = blockEl && state.entries.find(x => x.id === blockEl.dataset.id);
  const cat = e ? e.cat : state.cat, project = e ? e.project : state.project;
  openColorMenu(ev.clientX, ev.clientY, cat === 'projekte' && projById(project) ? { type: 'proj', id: project } : { type: 'cat', id: cat });
});

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

// ---------- Anmeldung mit 4-stelligem Code ----------
const PIN_LEN = 4;
const WAIT_KEY = 'zeitjournal.pinwait';  // { fails, until } – Wartezeit nach falschen Codes
let lockMode = 'unlock'; // 'create' | 'confirm' | 'unlock' | 'change' | 'legacy'
let pin = '', firstPin = '', checking = false, waitTimer = null;
const LOCK_TEXT = {
  create: 'Wähle einen 4-stelligen Code. Deine Zeiten werden damit verschlüsselt in diesem Browser gespeichert.',
  change: 'Neuen 4-stelligen Code wählen.',
  confirm: 'Code zur Sicherheit wiederholen.',
  unlock: 'Code eingeben',
  legacy: 'Bitte einmal das bisherige Passwort eingeben, danach wählst du einen Code.',
};
function readWait() {
  try { return JSON.parse(localStorage.getItem(WAIT_KEY)) || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; }
}
function writeWait(w) { try { localStorage.setItem(WAIT_KEY, JSON.stringify(w)); } catch (e) { /* ignorieren */ } }
function renderPin() {
  $('pinDots').querySelectorAll('span').forEach((d, i) => d.classList.toggle('on', i < pin.length));
}
// Nach 3 falschen Codes 30 Sekunden warten, danach jeweils doppelt so lange
function applyWait() {
  clearTimeout(waitTimer);
  const left = lockMode === 'unlock' ? Math.ceil((readWait().until - Date.now()) / 1000) : 0;
  const blocked = left > 0;
  $('pinpad').querySelectorAll('button[data-d], #pinBack').forEach(b => { b.disabled = blocked || checking; });
  if (blocked) {
    $('lockError').textContent = `Zu viele falsche Versuche. Bitte ${left} s warten.`;
    waitTimer = setTimeout(applyWait, 1000);
  } else if ($('lockError').textContent.startsWith('Zu viele')) {
    $('lockError').textContent = '';
  }
  return blocked;
}
function showLock(mode) {
  lockMode = mode;
  pin = '';
  $('lockText').textContent = LOCK_TEXT[mode];
  $('lockCancel').hidden = mode !== 'change' && !(mode === 'confirm' && cryptoKey);
  $('lockForgot').hidden = mode !== 'unlock' && mode !== 'legacy';
  $('legacyForm').hidden = mode !== 'legacy';
  $('pinDots').hidden = $('pinpad').hidden = mode === 'legacy';
  $('lockError').textContent = '';
  $('lock').hidden = false;
  renderPin();
  applyWait();
  if (mode === 'legacy') $('legacyPw').focus();
  else if (document.activeElement && !$('lock').contains(document.activeElement)) document.activeElement.blur();
}
function pinError(text) {
  $('lockError').textContent = text;
  const dots = $('pinDots');
  dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
  pin = '';
  renderPin();
}
let started = false;
function startApp() {
  $('lock').hidden = true;
  $('snap').value = String(state.snap);
  render();
  if (!started) { started = true; setInterval(tick, 1000); }
}
async function pinComplete() {
  const code = pin;
  if (lockMode === 'create' || lockMode === 'change') {
    firstPin = code;
    showLock('confirm');
    return;
  }
  if (lockMode === 'confirm') {
    if (code !== firstPin) { const back = cryptoKey ? 'change' : 'create'; showLock(back); pinError('Die Codes waren nicht gleich. Bitte noch einmal.'); return; }
    checking = true; applyWait();
    try {
      const wasChange = !!cryptoKey;
      if (!wasChange) loadPlain();
      await setPassword(code);
      writeWait({ fails: 0, until: 0 });
      if (wasChange) toast('Code geändert.');
      startApp();
    } catch (e) {
      pinError('Das hat nicht geklappt. Bitte noch einmal.');
    } finally { checking = false; applyWait(); }
    return;
  }
  // entsperren
  checking = true; applyWait();
  let ok = false;
  try {
    await unlockWith(code);
    ok = true;
    writeWait({ fails: 0, until: 0 });
  } catch (e) {
    const w = readWait();
    w.fails++;
    if (w.fails >= 3) w.until = Date.now() + 30000 * 2 ** (w.fails - 3);
    writeWait(w);
    pinError('Falscher Code.');
  } finally { checking = false; applyWait(); }
  if (ok) startApp();   // außerhalb von try: ein Fehler beim Zeichnen ist kein falscher Code
}
function pressDigit(d) {
  if ($('lock').hidden || lockMode === 'legacy' || checking || applyWait() || pin.length >= PIN_LEN) return;
  pin += d;
  if ($('lockError').textContent && pin.length === 1) $('lockError').textContent = '';
  renderPin();
  if (pin.length === PIN_LEN) setTimeout(pinComplete, 120); // letzten Punkt kurz zeigen
}
$('pinpad').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-d]');
  if (b) pressDigit(b.dataset.d);
});
$('pinBack').onclick = () => { if (!checking) { pin = pin.slice(0, -1); renderPin(); } };
document.addEventListener('keydown', ev => {
  if ($('lock').hidden || lockMode === 'legacy') return;
  if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); pressDigit(ev.key); }
  else if (ev.key === 'Backspace') { ev.preventDefault(); $('pinBack').click(); }
  else if (ev.key === 'Escape' && !$('lockCancel').hidden) $('lockCancel').click();
});
// Ältere Version mit Textpasswort: einmal entsperren, dann Code festlegen
$('legacyForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  try {
    await unlockWith($('legacyPw').value);
    $('legacyPw').value = '';
    showLock('change');
    $('lockText').textContent = 'Entsperrt. Wähle jetzt einen 4-stelligen Code.';
  } catch (e) {
    $('lockError').textContent = 'Das Passwort stimmt nicht.';
  }
});
$('lockCancel').onclick = () => { if (started) $('lock').hidden = true; else startApp(); };
$('lockForgot').onclick = async () => {
  if (!await askConfirm('Ohne Code lassen sich die gespeicherten Zeiten nicht entschlüsseln. Alle Daten in diesem Browser löschen und mit einem neuen Code neu beginnen?', 'Alles löschen')) return;
  try { [ENC_KEY, STORAGE_KEY, WAIT_KEY].forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignorieren */ }
  showLock('create');
};
// Sperren ohne Neuladen: entschlüsselte Daten aus dem Speicher werfen und das Ziffernfeld zeigen
async function lockApp() {
  await flushSave();
  cryptoKey = null;
  cryptoSalt = null;
  Object.assign(state, { entries: [], projects: [], running: null, catColors: {}, sync: undefined });
  closeColorMenu();
  history.length = 0;
  future.length = 0;
  selectedId = null;
  $('editor').hidden = true;
  render();
  showLock('unlock');
}
$('lockNow').onclick = lockApp;
$('changePw').onclick = () => showLock('change');

// ---------- Start ----------
renderThemeToggle();
if (!window.crypto?.subtle) {
  $('lockText').textContent = 'Dieser Browser unterstützt keine Verschlüsselung. Bitte die Seite über https öffnen.';
  $('pinpad').querySelectorAll('button').forEach(el => { el.disabled = true; });
} else {
  const rec = readEncrypted();
  showLock(!rec ? 'create' : rec.kind === 'pin' ? 'unlock' : 'legacy');
}
