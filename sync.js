'use strict';
// Online-Abgleich zwischen Windows-App und Webseite über einen kleinen Supabase-Speicher.
// Hochgeladen wird nur ein mit dem Sync-Schlüssel verschlüsselter Block; der Schlüssel bleibt auf den Geräten
// (verschlüsselt mit dem Code im lokalen Speicher). Der Server sieht nur eine daraus abgeleitete Kennung.
// Ändern zwei Geräte gleichzeitig, werden die Änderungen beider zusammengeführt (pro Block, Projekt und Farbe).
(() => {
  const SYNC_URL = 'https://yovmtxtinbgypvvwvcnk.supabase.co';   // Project URL des Supabase-Projekts
  const SYNC_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlvdm10eHRpbmJneXB2dnd2Y25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyOTkwOTMsImV4cCI6MjEwNjg3NTA5M30.cpQ54UX-FKzIUsL9a815SoUNCGrQikFLnuON303soos';  // anon key (öffentlich, Rolle anon)
  const POLL_MS = 5000, FULL_MS = 30000, PUSH_DELAY = 1000;
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford-Base32, ohne I, L, O, U

  const cfg = window.zeitjournalSyncConfig || { url: SYNC_URL, key: SYNC_ANON };
  if (!cfg.url || !cfg.key) return;

  // ---------- Schlüssel ----------
  const newCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(20));
    let bits = 0, val = 0, out = '';
    for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5) { out += ALPHABET[(val >> (bits - 5)) & 31]; bits -= 5; } }
    return out.match(/.{4}/g).join('-');
  };
  const normCode = s => s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const validCode = s => { const n = normCode(s); return n.length === 32 && [...n].every(c => ALPHABET.includes(c)); };
  const sha = async (tag, code) => new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(tag + normCode(code))));
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  let keyFor = null, keyCache = null;
  async function keys(code) {
    if (keyFor !== code) {
      const id = hex(await sha('zeitjournal-id:', code));
      const key = await crypto.subtle.importKey('raw', await sha('zeitjournal-key:', code), 'AES-GCM', false, ['encrypt', 'decrypt']);
      keyCache = { id, key }; keyFor = code;
    }
    return keyCache;
  }

  // ---------- Server ----------
  async function rpc(fn, body) {
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      // Neue Schlüssel (sb_publishable_…) gehen nur als apikey, alte JWT-Schlüssel zusätzlich als Bearer
      headers: { apikey: cfg.key, ...(cfg.key.startsWith('eyJ') ? { Authorization: `Bearer ${cfg.key}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Object.assign(new Error(`${fn}: ${r.status}`), { status: r.status });
    return r.json();
  }
  async function pull(code) {
    const { id, key } = await keys(code);
    const rows = await rpc('zj_pull', { p_id: id });
    if (!rows.length) return { rev: 0, data: null };
    const box = JSON.parse(rows[0].data);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
    return { rev: Number(rows[0].rev), data: JSON.parse(td.decode(plain)) };
  }
  async function push(code, data, rev) {
    const { id, key } = await keys(code);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(data)));
    return Number(await rpc('zj_push', { p_id: id, p_data: JSON.stringify({ v: 1, iv: toB64(iv), data: toB64(enc) }), p_rev: rev }));
  }

  // ---------- Was abgeglichen wird ----------
  const shared = () => ({
    entries: state.entries,
    projects: state.projects,
    catColors: state.catColors || {},
    running: state.running || null,
  });
  // Das Ende des laufenden Blocks wächst jede Sekunde; das allein ist keine Änderung
  const norm = (e, running) => (e && e.id === running ? { ...e, end: null } : e);
  const fingerprint = d => JSON.stringify({
    e: [...d.entries].sort((a, b) => (a.id < b.id ? -1 : 1)).map(e => norm(e, d.running)),
    p: d.projects, c: d.catColors, r: d.running,
  });
  const byId = list => new Map(list.map(x => [x.id, x]));
  const same = (a, b, running) => JSON.stringify(norm(a, running)) === JSON.stringify(norm(b, running));
  // Dreiwege-Zusammenführung: was hier seit dem letzten Abgleich geändert wurde, kommt auf den Serverstand
  function merge(remote, local, base) {
    const out = JSON.parse(JSON.stringify(remote));
    for (const key of ['entries', 'projects']) {
      const R = byId(out[key]), L = byId(local[key]), B = byId(base[key] || []);
      for (const id of new Set([...L.keys(), ...B.keys()])) {
        const l = L.get(id), b = B.get(id);
        if (same(l, b, local.running)) continue;
        if (l) R.set(id, l); else R.delete(id);
      }
      out[key] = [...R.values()];
    }
    for (const k of new Set([...Object.keys(local.catColors), ...Object.keys(base.catColors || {})])) {
      if (local.catColors[k] === base.catColors?.[k]) continue;
      if (local.catColors[k]) out.catColors[k] = local.catColors[k]; else delete out.catColors[k];
    }
    if (local.running !== (base.running || null)) out.running = local.running;
    if (out.running && !out.entries.some(e => e.id === out.running)) out.running = null;
    return out;
  }
  function apply(d) {
    const sel = selectedId;
    Object.assign(state, { entries: d.entries, projects: d.projects, catColors: d.catColors || {}, running: d.running || null });
    if (state.project && !projById(state.project)) state.project = null;
    if (sel && !state.entries.some(e => e.id === sel)) selectedId = null;
    history.length = 0; future.length = 0;   // Rückgängig würde sonst Änderungen anderer Geräte überschreiben
    render();
    window.zeitjournalDesktop?.repaint?.();
  }

  // ---------- Ablauf ----------
  let busy = false, again = false, timer = null, pushTimer = null, lastOk = 0, lastErr = '';
  const active = () => !!cryptoKey && !!state.sync?.code;
  const dirty = () => fingerprint(shared()) !== state.sync.baseFp;
  function remember(d, rev) {
    state.sync.rev = rev;
    state.sync.base = JSON.parse(JSON.stringify(d));
    state.sync.baseFp = fingerprint(d);
    lastOk = Date.now(); lastErr = '';
  }
  async function syncNow() {
    if (!active()) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const code = state.sync.code;
      for (let tries = 0; tries < 5; tries++) {
        const remote = await pull(code);
        if (state.sync?.code !== code) return;
        let next = shared();
        if (remote.rev !== state.sync.rev && remote.data) {
          // Ein anderes Gerät hat hochgeladen: dessen Stand übernehmen, eigene Änderungen obendrauf
          next = dirty() ? merge(remote.data, shared(), state.sync.base || { entries: [], projects: [], catColors: {} }) : remote.data;
          apply(next);
        }
        if (remote.data && fingerprint(next) === fingerprint(remote.data)) { remember(remote.data, remote.rev); break; }
        const rev = await push(code, next, remote.rev);
        if (rev > 0) { remember(next, rev); break; }
      }
      origSave();
    } catch (e) {
      lastErr = navigator.onLine === false ? 'offline' : 'Fehler';
    } finally {
      busy = false;
      renderSync();
      if (again) { again = false; syncNow(); }
    }
  }
  // Nicht bei jedem Speichern neu warten: die laufende Uhr speichert jede Sekunde
  // Alle paar Sekunden nur die Revision fragen (winzige Antwort); geholt wird erst, wenn sich etwas geändert hat.
  // Fehlt die Funktion zj_rev auf dem Server (ältere Einrichtung), wird wie früher alle 30 Sekunden ganz abgeglichen.
  let revMissing = false, revOk = false, lastFull = 0;
  async function poll() {
    // Auch „versteckt“ weiter fragen: Windows meldet ein sichtbares Browserfenster als versteckt, sobald ein
    // anderes Fenster (z. B. die Desktop-App über den ganzen Bildschirm) davor liegt. Die Abfrage ist winzig.
    if (!active() || busy) return;
    if (dirty()) return syncNow();
    if (revMissing) { if (Date.now() - lastFull >= FULL_MS) { lastFull = Date.now(); syncNow(); } return; }
    try {
      const { id } = await keys(state.sync.code);
      const rev = Number(await rpc('zj_rev', { p_id: id }));
      revOk = true;
      if (lastErr) { lastErr = ''; renderSync(); }
      if (rev !== state.sync.rev) syncNow();
    } catch (e) {
      // Fehlt zj_rev oder darf anon sie nicht aufrufen (alte Einrichtung): auf den langsamen Abgleich ausweichen
      if (e.status >= 400 && e.status < 500 && e.status !== 429) { revMissing = true; syncNow(); }
      else { lastErr = navigator.onLine === false ? 'offline' : 'Fehler'; renderSync(); }
    }
  }
  const schedulePush = () => { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; syncNow(); }, PUSH_DELAY); };

  // Speichern und Starten der App mithören
  const origSave = save;
  save = function () {
    origSave();
    if (active() && dirty()) { if (busy) again = true; else schedulePush(); }
  };
  const origStart = startApp;
  startApp = function () {
    origStart();
    renderSync();
    syncNow();
    clearInterval(timer);
    timer = setInterval(poll, POLL_MS);
  };
  window.addEventListener('focus', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());

  // ---------- Anzeige ----------
  const btn = document.createElement('button');
  btn.id = 'syncBtn';
  btn.className = 'sync-btn';
  $('lockNow').before(btn);
  function renderSync() {
    const on = !!state.sync?.code;
    btn.classList.toggle('off', !on);
    btn.classList.toggle('err', on && !!lastErr);
    btn.textContent = '☁';
    btn.title = !on ? 'Abgleich einrichten'
      : lastErr ? `Abgleich: ${lastErr === 'offline' ? 'keine Verbindung' : 'hat nicht geklappt'}, neuer Versuch läuft`
      : lastOk ? `Abgeglichen um ${new Date(lastOk).toLocaleTimeString('de-DE')}${revMissing ? ' (langsamer Abgleich, siehe ☁)' : ''}` : 'Abgleich läuft';
  }
  setInterval(renderSync, 30000);

  const dlg = document.createElement('div');
  dlg.className = 'dialog-backdrop';
  dlg.hidden = true;
  dlg.innerHTML = `<div class="dialog sync-dialog" role="dialog" aria-modal="true" aria-label="Abgleich">
    <h2>Abgleich zwischen Geräten</h2>
    <div class="sync-on">
      <p>Dieses Gerät gleicht seine Zeiten mit allen Geräten ab, die denselben Sync-Schlüssel haben.</p>
      <label>Sync-Schlüssel <input class="sync-code" readonly></label>
      <p class="sync-note">Auf dem anderen Gerät unter ☁ „Schlüssel eingeben“ wählen und diesen Schlüssel einfügen. Wer den Schlüssel hat, kann die Zeiten lesen.</p>
      <p class="sync-note sync-mode"></p>
      <div class="dialog-actions"><button data-a="off">Abgleich beenden</button><button data-a="copy">Kopieren</button><button data-a="close" class="primary">Fertig</button></div>
    </div>
    <div class="sync-off">
      <p>Die Zeiten werden verschlüsselt online abgelegt und zwischen der Windows-App und der Webseite abgeglichen. Lesen kann sie nur, wer den Sync-Schlüssel hat.</p>
      <div class="dialog-actions sync-choice"><button data-a="new" class="primary">Neu einrichten</button><button data-a="enter">Schlüssel eingeben</button></div>
      <label class="sync-enter" hidden>Sync-Schlüssel vom anderen Gerät <input class="sync-input" placeholder="XXXX-XXXX-…" spellcheck="false" autocomplete="off"></label>
      <p class="sync-note sync-msg" role="alert"></p>
      <div class="dialog-actions"><button data-a="close">Abbrechen</button><button data-a="join" class="primary" hidden>Verbinden</button></div>
    </div>
  </div>`;
  document.body.append(dlg);
  const q = s => dlg.querySelector(s);
  function openDialog() {
    const on = !!state.sync?.code;
    q('.sync-on').hidden = !on;
    q('.sync-off').hidden = on;
    q('.sync-enter').hidden = true; q('[data-a=join]').hidden = true; q('.sync-choice').hidden = false;
    q('.sync-msg').textContent = '';
    if (on) q('.sync-code').value = state.sync.code;
    const t = lastOk ? ` Zuletzt abgeglichen um ${new Date(lastOk).toLocaleTimeString('de-DE')}.` : '';
    q('.sync-mode').textContent = revMissing
      ? 'Langsamer Abgleich, nur alle 30 Sekunden: Auf dem Server fehlt die Funktion zj_rev. Bitte docs/sync-setup.sql in Supabase noch einmal ausführen.' + t
      : revOk ? 'Schneller Abgleich alle 5 Sekunden ist aktiv.' + t : t.trim();
    dlg.hidden = false;
  }
  btn.onclick = openDialog;
  async function begin(code, fresh) {
    q('.sync-msg').textContent = 'Verbinde …';
    try {
      const remote = await pull(code);
      if (fresh && remote.data) throw new Error('belegt');
      if (!fresh && !remote.data) { q('.sync-msg').textContent = 'Zu diesem Schlüssel gibt es noch keine Daten. Bitte den Schlüssel prüfen.'; return; }
      if (!fresh && state.entries.length
        && !await askConfirm('Die Zeiten dieses Geräts werden mit denen vom anderen Gerät zusammengeführt. Weiter?', 'Zusammenführen')) return;
      // Erster Abgleich: alles von hier gilt als neu und kommt zu den Daten vom Server dazu
      state.sync = { code: normCode(code).match(/.{4}/g).join('-'), rev: fresh ? 0 : remote.rev,
        base: { entries: [], projects: [], catColors: {}, running: null }, baseFp: '' };
      if (!fresh) apply(merge(remote.data, shared(), state.sync.base));
      origSave();
      await syncNow();
      if (lastErr) throw new Error(lastErr);
      openDialog();
      toast('Abgleich eingerichtet.');
    } catch (e) {
      q('.sync-msg').textContent = e.message === 'belegt' ? 'Bitte noch einmal versuchen.'
        : 'Keine Verbindung zum Online-Speicher. Bitte später noch einmal versuchen.';
    }
  }
  dlg.addEventListener('click', async ev => {
    const a = ev.target.dataset?.a;
    if (ev.target === dlg || a === 'close') dlg.hidden = true;
    else if (a === 'copy') {
      try { await navigator.clipboard.writeText(state.sync.code); toast('Sync-Schlüssel kopiert.'); }
      catch (e) { q('.sync-code').select(); }
    } else if (a === 'off') {
      if (!await askConfirm('Abgleich auf diesem Gerät beenden? Die Zeiten bleiben hier und online erhalten.', 'Beenden')) return;
      delete state.sync; origSave(); renderSync(); dlg.hidden = true;
    } else if (a === 'new') begin(newCode(), true);
    else if (a === 'enter') {
      q('.sync-choice').hidden = true; q('.sync-enter').hidden = false; q('[data-a=join]').hidden = false;
      q('.sync-input').focus();
    } else if (a === 'join') {
      const v = q('.sync-input').value;
      if (!validCode(v)) { q('.sync-msg').textContent = 'Der Schlüssel hat 32 Zeichen in Vierergruppen. Bitte prüfen.'; return; }
      begin(v, false);
    }
  });
  q('.sync-input').addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') q('[data-a=join]').click(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !dlg.hidden) dlg.hidden = true; });
  renderSync();
})();
