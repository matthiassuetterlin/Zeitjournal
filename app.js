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

// ---------- Zustand & Speicher ----------
const STORAGE_KEY = 'zeitjournal.v1';
const DAY_MIN = 24 * 60;

const state = {
  entries: [],      // { id, date: 'YYYY-MM-DD', start, end (Minuten ab 0:00), cat, title }
  running: null,    // id des laufenden Blocks
  cat: CATEGORIES[0].id,
  snap: 15,
};
let viewDate = toDateStr(new Date());
let selectedId = null;
const history = [];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.entries)) Object.assign(state, saved);
  } catch (e) { /* leerer Start */ }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
}
function snapshot() {
  history.push(JSON.stringify(state.entries));
  if (history.length > 100) history.shift();
}
function undo() {
  if (!history.length) return;
  state.entries = JSON.parse(history.pop());
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
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
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
  renderHeader();
  renderPalette();
  renderTrack();
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
    $('runningInfo').textContent = `${catById(run.cat).name} läuft seit ${fmtTime(run.start)} · ${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    $('runningInfo').textContent = '';
  }
}

function renderPalette() {
  const p = $('palette');
  p.innerHTML = '';
  CATEGORIES.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'cat' + (state.cat === c.id ? ' active' : '');
    b.style.borderColor = state.cat === c.id ? c.color : '';
    b.innerHTML = `<span class="dot" style="background:${c.color}"></span>${c.name}<kbd>${i + 1}</kbd>`;
    b.title = 'Kategorie wählen. Ist ein Block markiert, wird er umgefärbt. Läuft die Uhr, wird auf diese Kategorie gewechselt.';
    b.onclick = () => chooseCategory(c.id);
    p.appendChild(b);
  });
}

function renderTrack() {
  const { lo, hi } = viewRange();
  const span = hi - lo;
  const pct = m => ((m - lo) / span) * 100;
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
      scale.appendChild(s);
    }
  }
  if (viewDate === toDateStr(new Date())) {
    const n = document.createElement('div');
    n.className = 'now';
    n.style.left = pct(nowMinutes()) + '%';
    track.appendChild(n);
  }
  for (const e of dayEntries(viewDate)) {
    const c = catById(e.cat);
    const el = document.createElement('div');
    el.className = 'block' + (e.id === selectedId ? ' selected' : '') + (e.id === state.running ? ' running' : '');
    el.dataset.id = e.id;
    el.style.left = pct(e.start) + '%';
    el.style.width = Math.max(0.3, pct(e.end) - pct(e.start)) + '%';
    el.style.background = c.color;
    el.title = `${e.title || c.name}\n${fmtTime(e.start)}–${fmtTime(e.end)} (${fmtDur(e.end - e.start)})`;
    el.innerHTML = `<span class="title"></span><span class="meta">${fmtTime(e.start)}–${fmtTime(e.end)} · ${fmtDur(e.end - e.start)}</span>
      <div class="handle l" data-h="l"></div>${e.id === state.running ? '' : '<div class="handle r" data-h="r"></div>'}`;
    el.querySelector('.title').textContent = e.title || c.name;
    track.appendChild(el);
  }
  track._range = { lo, hi };
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
      b.style.background = catById(e.cat).color;
      mini.appendChild(b);
    }
    row.innerHTML = `<span class="label">${label}</span>`;
    row.appendChild(mini);
    row.insertAdjacentHTML('beforeend', `<span class="total">${total ? fmtDur(total) : ''}</span>`);
    row.onclick = () => { viewDate = date; selectedId = null; render(); };
    rows.appendChild(row);
  }
}

function sums(dates) {
  const s = Object.fromEntries(CATEGORIES.map(c => [c.id, 0]));
  for (const e of state.entries) if (dates.includes(e.date)) s[e.cat] = (s[e.cat] || 0) + (e.end - e.start);
  return s;
}
function renderSums(el, s) {
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  el.innerHTML = CATEGORIES.map(c => `
    <div class="sumrow"><span>${c.name}</span>
      <div class="sumbar"><div style="width:${total ? (s[c.id] / total) * 100 : 0}%;background:${c.color}"></div></div>
      <span class="v">${fmtDur(s[c.id])}</span></div>`).join('') +
    `<div class="sumrow sumtotal"><span>Gesamt</span><span></span><span class="v">${fmtDur(total)}</span></div>`;
}
function renderSummary() {
  renderSums($('sumDay'), sums([viewDate]));
  const mon = mondayOf(viewDate);
  renderSums($('sumWeek'), sums([0, 1, 2, 3, 4, 5, 6].map(i => addDays(mon, i))));
}

// ---------- Aktionen ----------
function chooseCategory(id) {
  state.cat = id;
  const sel = state.entries.find(e => e.id === selectedId);
  if (sel) {
    snapshot();
    sel.cat = id;
  } else if (state.running) {
    const run = state.entries.find(e => e.id === state.running);
    if (run && run.cat !== id) { stopTimer(); startTimer(); }
  }
  save();
  render();
}

function startTimer() {
  const today = toDateStr(new Date());
  const n = nowMinutes();
  snapshot();
  // Läuft der Timer direkt im Anschluss an einen Block derselben Kategorie, wird dieser verlängert.
  const prev = dayEntries(today).find(e => e.cat === state.cat && n - e.end >= 0 && n - e.end < 1);
  let e = prev;
  if (!e) {
    e = { id: uid(), date: today, start: n, end: n, cat: state.cat, title: '' };
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
      const n = { id: uid(), date: today, start: 0, end: nowMinutes(), cat: e.cat, title: e.title };
      state.entries.push(n);
      state.running = n.id;
    } else {
      e.end = Math.max(e.start, nowMinutes());
    }
    save();
  }
  if (!drag) { renderHeader(); renderTrack(); if (e) renderSummary(); }
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
    const e = { id: uid(), date: viewDate, start: anchor, end: anchor, cat: state.cat, title: '' };
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
  else if (/^[1-9]$/.test(ev.key) && CATEGORIES[ev.key - 1]) chooseCategory(CATEGORIES[ev.key - 1].id);
});

// Klick ins Leere hebt die Markierung auf
document.addEventListener('pointerdown', ev => {
  if (!ev.target.closest('.track, .palette, .editor') && selectedId) { selectedId = null; render(); }
});

// ---------- Knöpfe ----------
$('startStop').onclick = () => (state.running ? stopTimer() : startTimer());
$('prevDay').onclick = () => { viewDate = addDays(viewDate, -1); selectedId = null; render(); };
$('nextDay').onclick = () => { viewDate = addDays(viewDate, 1); selectedId = null; render(); };
$('today').onclick = () => { viewDate = toDateStr(new Date()); selectedId = null; render(); };
$('snap').onchange = ev => { state.snap = Number(ev.target.value); save(); };

$('copyYesterday').onclick = () => {
  const src = [...new Set(state.entries.map(e => e.date))].filter(d => d < viewDate).sort().pop();
  if (!src) { alert('Kein früherer Tag mit Einträgen gefunden.'); return; }
  if (dayEntries(viewDate).length && !confirm('Für diesen Tag gibt es schon Blöcke. Trotzdem Blöcke vom ' + parseDate(src).toLocaleDateString('de-DE') + ' dazu übernehmen (nur in freie Lücken)?')) return;
  snapshot();
  for (const e of dayEntries(src)) {
    const g = gapAt(viewDate, e.start);
    if (!g || g.hi < e.end || e.start === g.hi) continue;
    state.entries.push({ ...e, id: uid(), date: viewDate });
  }
  save();
  render();
};

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('exportCsv').onclick = () => {
  const rows = [['Datum', 'Start', 'Ende', 'Dauer (h)', 'Kategorie', 'Bezeichnung']];
  for (const e of [...state.entries].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    rows.push([e.date, fmtTime(e.start), fmtTime(e.end), ((e.end - e.start) / 60).toFixed(2).replace('.', ','), catById(e.cat).name, e.title || '']);
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
    if (!confirm(`${data.entries.length} Einträge laden? Die aktuellen Daten werden ersetzt.`)) return;
    snapshot();
    Object.assign(state, data);
    save();
    render();
  } catch (e) {
    alert('Die Datei konnte nicht gelesen werden.');
  } finally {
    ev.target.value = '';
  }
};

// ---------- Start ----------
load();
$('snap').value = String(state.snap);
render();
setInterval(tick, 1000);
