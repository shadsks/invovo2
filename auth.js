"use strict";
/* ============================== LICENSING (serial-key login, device binding) ==============================
   Turns the local tool into a licensed SaaS. A key activates on up to 2 devices, shared across the web app
   and the installable PWA. Enforcement is server-side (see _worker.js + AUTH.md); this file is the client:
   it holds a stable device id, runs the activation/verify flow, and gates the app behind a login screen.

   Local development (file:// or localhost) runs in PREVIEW mode — the app opens without a backend so you can
   build. On a real deployed origin the gate is active and every session is verified against the Worker.

   Assigned onto window (a top-level const would NOT become a window property, and the boot gate in
   actions.js checks window.Auth).                                                                              */
window.Auth = (function () {
  const PREVIEW = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SKEY = 'is_session', DKEY = 'is_device_id';
  let _devices = null;   // last-known device roster, for the Settings panel

  function deviceId() {
    let d = null; try { d = localStorage.getItem(DKEY); } catch (e) {}
    if (!d) { d = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(DKEY, d); } catch (e) {} }
    return d;
  }
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
    const br = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
    const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ? ' (app)' : '';
    return br + ' on ' + os + app;
  }
  function session() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } }
  function setSession(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SKEY); } catch (e) {} }
  function devices() { return _devices; }

  async function api(path, body) {
    try {
      const r = await fetch('/api/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, status: 0, data: { error: 'offline' } }; }
  }

  async function activate(key, evict) {
    const res = await api('activate', { key, deviceId: deviceId(), label: deviceLabel(), evict });
    if (res.ok && res.data.token) {
      setSession({ token: res.data.token, exp: Date.now() + 30 * 864e5, biz: '' });
      _devices = res.data.devices || null;
    }
    return res;
  }
  async function refreshStatus() {
    const s = session(); if (!s) return null;
    const res = await api('status', { token: s.token, deviceId: deviceId() });
    if (res.ok) _devices = res.data.devices || [];
    return res;
  }
  async function removeDevice(shortId) {
    const s = session(); if (!s) return { ok: false };
    const res = await api('release', { token: s.token, deviceId: deviceId(), removeId: shortId });
    if (res.ok) _devices = res.data.devices || [];
    return res;
  }
  async function signOut() {
    // Free this device's slot on the server first, so signing out actually returns the slot to the key.
    const s = session();
    if (s) await api('release', { token: s.token, deviceId: deviceId() });
    clearSession();
    location.hash = '#/';
    showLogin('This device was signed out and its slot freed. Enter your key to activate it again.');
  }

  /* ---- boot gate: called after state is loaded ---- */
  async function boot() {
    if (PREVIEW) { document.documentElement.setAttribute('data-preview', '1'); render(); return; }
    const s = session();
    if (s && s.exp > Date.now()) {
      render();                                   // optimistic: open immediately
      const res = await api('verify', { token: s.token, deviceId: deviceId() });
      if (res.status === 401 || res.status === 403) { clearSession(); showLogin(res.data.error === 'revoked' ? 'This license was revoked.' : 'This device is no longer authorized. Enter your key to reactivate.'); }
      else if (res.ok) { _devices = res.data.devices || _devices; }
    } else {
      showLogin();
    }
  }

  /* ---- login / activation screen ---- */
  function iconMark() { return (typeof ico === 'function') ? ico('bolt') : '★'; }
  function showLogin(msg, limitDevices) {
    const app = document.getElementById('app');
    const devicesHtml = limitDevices && limitDevices.length ? `
      <div class="lg-devices">
        <div class="lg-devices-h">This key is on ${limitDevices.length} devices. Free a slot to continue:</div>
        ${limitDevices.map(d => `<div class="lg-dev"><div><b>${escd(d.label)}</b><span>last active ${when(d.lastSeen)}</span></div><button class="btn btn-sm" onclick="Auth._evict('${d.id}')">Use this slot</button></div>`).join('')}
      </div>` : '';
    app.innerHTML = `
    <div class="login-wrap">
      <div class="login-aside">
        <div class="login-brand"><div class="login-mark">${iconMark()}</div><span>Invoice Studio</span></div>
        <h1>Get paid like<br>a studio, not<br>an afterthought.</h1>
        <p>Billing, follow-ups, and cash-flow built for Filipino creative freelancers. One key unlocks the web app and the installable app on up to two devices.</p>
        <ul class="login-points">
          <li>${tick()} Action Center chases every peso you're owed</li>
          <li>${tick()} GCash / Maya reminders that clients actually answer</li>
          <li>${tick()} Smart quotes, scope checks, and cash-flow reads</li>
        </ul>
      </div>
      <div class="login-panel">
        <div class="login-card">
          <h2>Activate your copy</h2>
          <p class="login-sub">Enter the serial key from your purchase. It binds to this device (max 2 per key).</p>
          ${msg ? `<div class="login-msg">${escd(msg)}</div>` : ''}
          <label class="login-label" for="lg-key">Serial key</label>
          <input id="lg-key" class="login-input" spellcheck="false" autocomplete="off" placeholder="IS-XXXX-XXXX-XXXX-XXXX-XXXX-XX" oninput="Auth._fmt(this)" onkeydown="if(event.key==='Enter')Auth._submit()">
          <div id="lg-err" class="login-err"></div>
          ${devicesHtml}
          <button id="lg-btn" class="login-go" onclick="Auth._submit()">Activate this device</button>
          <div class="login-foot">This device: <b>${escd(deviceLabel())}</b></div>
        </div>
      </div>
    </div>`;
    const inp = document.getElementById('lg-key'); if (inp) inp.focus();
  }
  function tick() { return (typeof ico === 'function') ? ico('check') : '✓'; }
  function escd(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function when(ts) { if (!ts) return 'unknown'; const d = Math.round((Date.now() - ts) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }

  function _fmt(el) {
    let v = el.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (v.startsWith('IS')) v = v.slice(2);
    v = v.slice(0, 22);
    const groups = v.match(/.{1,4}/g) || [];
    el.value = v ? 'IS-' + groups.join('-') : '';
  }
  async function _do(key, evict) {
    const btn = document.getElementById('lg-btn'), err = document.getElementById('lg-err');
    if (btn) { btn.disabled = true; btn.textContent = 'Activating…'; }
    if (err) err.textContent = '';
    const res = await activate(key, evict);
    if (res.ok && res.data.token) { document.documentElement.removeAttribute('data-preview'); location.hash = location.hash || '#/'; render(); return; }
    if (btn) { btn.disabled = false; btn.textContent = 'Activate this device'; }
    if (res.status === 409 && res.data.limit) { showLogin('', res.data.devices || []); return; }
    if (err) err.textContent = res.data.error || (res.status === 0 ? 'Could not reach the licensing server. Check your connection.' : 'Activation failed.');
  }
  function _submit() { const v = (document.getElementById('lg-key') || {}).value || ''; _do(v); }
  function _evict(shortId) { const v = (document.getElementById('lg-key') || {}).value || ''; if (!v) { const e = document.getElementById('lg-err'); if (e) e.textContent = 'Re-enter your key, then pick a slot.'; return; } _do(v, shortId); }

  return { PREVIEW, boot, session, signOut, deviceId, deviceLabel, devices, refreshStatus, removeDevice, showLogin,
           _fmt, _submit, _evict };
})();
