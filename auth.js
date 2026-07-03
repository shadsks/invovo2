"use strict";
/* ============================== LICENSING + PRE-AUTH EXPERIENCE ==============================
   The serial-key gate AND the product's public face. Unauthenticated visitors see a full landing
   page (hero, feature story, activation, FAQ); a key activates on up to 2 devices, shared across
   the web app and the installable PWA. Enforcement is server-side (_worker.js + AUTH.md); this
   file is the client: stable device id, activation/verify flow, landing render, setup diagnosis.

   Local development (file:// or localhost) runs in PREVIEW mode, no backend gate.

   Assigned onto window (a top-level const would NOT become a window property, and the boot gate in
   actions.js checks window.Auth).                                                                  */
window.Auth = (function () {
  const PREVIEW = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SKEY = 'is_session', DKEY = 'is_device_id';
  let _devices = null;   // last-known device roster, for the Settings panel

  /* ---------------- identity + session ---------------- */
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
      setSession({ token: res.data.token, exp: Date.now() + 30 * 864e5 });
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

  /* First-run hook: actions.js defines App.maybeOnboard (welcome wizard). App always exists by the
     time these run, because boot() is invoked from actions.js after App is built. */
  function afterAuth() { if (typeof App !== 'undefined' && App.maybeOnboard) App.maybeOnboard(); }

  /* ---------------- boot gate: called after state is loaded ---------------- */
  async function boot() {
    if (PREVIEW) { document.documentElement.setAttribute('data-preview', '1'); render(); afterAuth(); return; }
    const s = session();
    if (s && s.exp > Date.now()) {
      render(); afterAuth();                        // optimistic: open immediately
      const res = await api('verify', { token: s.token, deviceId: deviceId() });
      if (res.status === 401 || res.status === 403) { clearSession(); showLogin(res.data.error === 'revoked' ? 'This license was revoked.' : 'This device is no longer authorized. Enter your key to reactivate.'); }
      else if (res.ok) { _devices = res.data.devices || _devices; }
    } else {
      showLogin();
    }
  }

  /* ============================== LANDING PAGE (unauthenticated view) ============================== */
  function escd(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function ic(n) { return (typeof ico === 'function') ? ico(n) : ''; }

  function heroVisual() {
    return `
    <div class="ld-hero-visual reveal" aria-hidden="true">
      <div class="mock mock-a">
        <div class="mock-kpis">
          <div><span>Outstanding</span><b class="mono">₱163,000</b></div>
          <div><span>Overdue</span><b class="mono is-red">₱49,500</b></div>
          <div><span>Recoverable now</span><b class="mono is-grn">₱86,400</b></div>
        </div>
      </div>
      <div class="mock mock-b">
        <div class="mock-alert"><i class="red"></i><div><b>Invoice INV-1021 overdue 23 days</b><span>Atlas Land Group. Next step: re-watermark delivered files.</span></div><em class="mono">+₱49,500</em></div>
        <div class="mock-alert"><i class="amber"></i><div><b>Rush surcharge unbilled</b><span>48-hour delivery premium is not on an invoice.</span></div><em class="mono">+₱15,750</em></div>
      </div>
      <div class="mock mock-c">
        <div class="mock-tax"><div><span>Set aside per ₱100 collected</span><b class="mono">₱6</b></div><span class="d">8% flat option. Q2 1701Q in 43 days.</span></div>
      </div>
    </div>`;
  }

  function featureSection() {
    const feat = (icon, title, body, vig, flip) => `
      <div class="feat ${flip ? 'flip' : ''} reveal">
        <div class="feat-copy">
          <div class="feat-ico">${ic(icon)}</div>
          <h3>${title}</h3>
          <p>${body}</p>
        </div>
        <div class="feat-vig">${vig}</div>
      </div>`;
    return `
    <section id="features" class="ld-feats">
      <div class="ld-sec-head reveal"><h2>Built around how creatives here actually get paid</h2>
      <p>Not a generic invoice tool with the currency swapped. Every screen assumes GCash screenshots, hulugan, ninongs who pay their share late, and a BIR deadline you'd rather not think about.</p></div>
      ${feat('bolt', 'An Action Center, not a todo list',
        'Overdue invoices, unbilled overtime, rush premiums, revision overages, crew payouts. Everything you could bill or collect is surfaced with the amount and a one-tap next step.',
        `<div class="mock-alert"><i class="amber"></i><div><b>Revision overage to bill</b><span>2 rounds beyond the 2 included, ₱4,500 each.</span></div><em class="mono">+₱9,000</em></div>
         <div class="mock-alert"><i class="blue"></i><div><b>Crew payout owed</b><span>Project cleared. You owe your second shooter.</span></div><em class="mono">₱12,000</em></div>`, false)}
      ${feat('qr', 'GCash-first, screenshot-friendly',
        'Your QR and numbers print on every invoice. When the "paid na po" screenshot arrives, paste the reference and it reconciles to the right invoice. Hulugan plans gate file delivery until the balance clears.',
        `<div class="vig-rows">
          <div class="vig-row"><span>GCash</span><b class="mono">0917 555 0142</b></div>
          <div class="vig-row"><span>Maya</span><b class="mono">0998 555 0142</b></div>
          <div class="vig-row"><span>Reference GC8842137</span><b class="vig-ok">${ic('check')} matched to INV-1014</b></div>
        </div>`, true)}
      ${feat('scale', 'Taxes stop being a surprise',
        'It reads your actual paid invoices and compares the 8% flat option against graduated rates with OSD, tells you which is cheaper, how much to set aside from every payment, and when the next 1701Q is due.',
        `<div class="vig-rows">
          <div class="vig-row"><span>8% flat option</span><b class="mono">₱60,000 <em class="vig-pill">cheaper</em></b></div>
          <div class="vig-row"><span>Graduated + 40% OSD</span><b class="mono">₱92,500</b></div>
          <div class="vig-row"><span>Q2 1701Q</span><b>Aug 15, in 43 days</b></div>
        </div>`, false)}
      ${feat('chat', 'The awkward messages, drafted',
        'Deposit asks, late-payment follow-ups, scope-creep pushback, discount requests. Drafts match your client’s register, protect the relationship, and still get you paid. A tone guard flags anything that could burn a bridge.',
        `<div class="vig-draft">
          <p>"Hi Ms. Andrea! Gentle follow-up po on INV-1021 (₱49,500), due last week. The final files are ready to release as soon as it clears. GCash and bank details are on the invoice po. Thank you!"</p>
          <span class="vig-ok">${ic('check')} Tone: reads well</span>
        </div>`, true)}
    </section>`;
  }

  function stepsSection() {
    const step = (n, t, d) => `<div class="step reveal"><div class="step-n mono">${n}</div><h4>${t}</h4><p>${d}</p></div>`;
    return `
    <section class="ld-steps">
      ${step('01', 'Get your serial key', 'One key is your whole login. No email, no password, nothing to reset.')}
      ${step('02', 'Activate up to 2 devices', 'Laptop plus phone, web app plus installed app. Manage or swap slots yourself, anytime.')}
      ${step('03', 'Run your money in one place', 'Invoices, follow-ups, taxes, payouts. Your data stays on your device.')}
    </section>`;
  }

  function activationCard(msg, limitDevices) {
    const devicesHtml = limitDevices && limitDevices.length ? `
      <div class="lg-devices">
        <div class="lg-devices-h">This key is on ${limitDevices.length} devices. Free a slot to continue:</div>
        ${limitDevices.map(d => `<div class="lg-dev"><div><b>${escd(d.label)}</b><span>last active ${when(d.lastSeen)}</span></div><button class="btn btn-sm" onclick="Auth._evict('${d.id}')">Use this slot</button></div>`).join('')}
      </div>` : '';
    return `
    <div class="login-card">
      <h2>Activate your copy</h2>
      <p class="login-sub">Enter the serial key from your purchase. It binds to this device (max 2 per key).</p>
      <div id="lg-setup"></div>
      ${msg ? `<div class="login-msg">${escd(msg)}</div>` : ''}
      <label class="login-label" for="lg-key">Serial key</label>
      <input id="lg-key" class="login-input" spellcheck="false" autocomplete="off" placeholder="IS-XXXX-XXXX-XXXX-XXXX-XXXX-XX" oninput="Auth._fmt(this)" onkeydown="if(event.key==='Enter')Auth._submit()">
      <div id="lg-err" class="login-err"></div>
      ${devicesHtml}
      <button id="lg-btn" class="login-go" onclick="Auth._submit()">Activate this device</button>
      <div class="login-foot">This device: <b>${escd(deviceLabel())}</b></div>
    </div>`;
  }

  function faqSection() {
    const qa = (q, a) => `<div class="faq-item reveal"><h4>${q}</h4><p>${a}</p></div>`;
    return `
    <section id="faq" class="ld-faq">
      <div class="ld-sec-head reveal"><h2>Questions, answered straight</h2></div>
      <div class="faq-grid">
        ${qa('Where does my data live?', 'On your device, in your browser’s local storage. Nothing about your clients or money sits on our servers. Download a JSON backup anytime from Settings.')}
        ${qa('What does one key cover?', 'Up to 2 devices at once, shared between the web app and the installed app. Remove a device in Settings, or swap one out right on this screen when you hit the limit.')}
        ${qa('Does it work offline?', 'The installed app opens and works offline. Activation, verification, and the smart drafting features need a connection.')}
        ${qa('What if I lose my key?', 'Your activated devices keep working. Keep the key somewhere safe like a password manager; it is the only proof of ownership for managing device slots.')}
      </div>
    </section>`;
  }

  function showLogin(msg, limitDevices) {
    const app = document.getElementById('app');
    app.innerHTML = `
    <div class="landing">
      <header class="ld-nav">
        <div class="ld-brand"><div class="ld-mark">${ic('bolt')}</div><span>Invoice Studio</span></div>
        <nav class="ld-nav-r">
          <a class="ld-link" href="#features">Features</a>
          <a class="ld-link" href="#faq">FAQ</a>
          <button class="btn btn-primary" onclick="Auth._toActivate()">Enter serial key</button>
        </nav>
      </header>
      <section class="ld-hero">
        <div class="ld-hero-copy reveal">
          <div class="ld-eyebrow">Billing for Filipino creative freelancers</div>
          <h1>Get paid like a studio, not an afterthought.</h1>
          <p>Invoices, follow-ups, hulugan plans, crew payouts, and BIR tax estimates in one place. GCash-first, peso-native, and honest about how projects here really run.</p>
          <div class="ld-cta">
            <button class="login-go btn-hero" onclick="Auth._toActivate()">Activate your key</button>
            <a class="btn btn-lg" href="#features">See what's inside</a>
          </div>
          <div class="ld-facts">PHP-native &nbsp;·&nbsp; GCash / Maya / InstaPay &nbsp;·&nbsp; 1 key, 2 devices &nbsp;·&nbsp; installs as an app</div>
        </div>
        ${heroVisual()}
      </section>
      ${featureSection()}
      ${stepsSection()}
      <section id="activate" class="ld-activate reveal">
        <div class="act-panel">
          <div class="act-copy">
            <h2>Ready when you are</h2>
            <p>Activation takes ten seconds. Your studio's numbers will finally live in one calm place.</p>
            <ul class="act-points">
              <li>${ic('check')} Every peso you're owed, surfaced</li>
              <li>${ic('check')} GCash reminders clients actually answer</li>
              <li>${ic('check')} Tax set-aside guidance from real invoices</li>
            </ul>
          </div>
          ${activationCard(msg, limitDevices)}
        </div>
      </section>
      ${faqSection()}
      <footer class="ld-foot">
        <div class="ld-brand"><div class="ld-mark">${ic('bolt')}</div><span>Invoice Studio</span></div>
        <p>Made for Filipino creative freelancers. Your clients, projects, and money stay on your device.</p>
        <span class="ld-foot-meta">© ${new Date().getFullYear()} Invoice Studio</span>
      </footer>
    </div>`;
    revealInit();
    checkSetup();
    if (msg || (limitDevices && limitDevices.length)) _toActivate();
  }

  /* Scroll-reveal: opt-in via a root class so content is NEVER hidden if the observer can't run
     (no IntersectionObserver, reduced motion, headless). */
  function revealInit() {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('reveal-on');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  }

  /* Diagnose an unconfigured server BEFORE the user wastes a key attempt: /api/health reports
     which piece (secret, DB binding) is missing, and the fix is spelled out on-screen. */
  async function checkSetup() {
    if (PREVIEW) return;
    try {
      const r = await fetch('/api/health'); const h = await r.json();
      if (!h || h.licensing !== false) return;
      const missing = [];
      if (!h.secret) missing.push('the <b>LICENSE_SECRET</b> secret (Settings → Variables and Secrets)');
      if (!h.db) missing.push('the <b>DB</b> database binding (Settings → Bindings → D1)');
      const el = document.getElementById('lg-setup');
      if (el) el.innerHTML = `<div class="login-setup">${ic('alertT')}<div><b>This server isn't fully set up yet</b>, so activation will fail until it is. Site owner: in the Cloudflare dashboard, add ${missing.join(' and ')}, then go to <b>Deployments → Retry deployment</b>. Settings only apply to deployments made after they're added.</div></div>`;
    } catch (e) {}
  }

  function when(ts) { if (!ts) return 'unknown'; const d = Math.round((Date.now() - ts) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }
  function _toActivate() {
    const el = document.getElementById('activate');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const inp = document.getElementById('lg-key'); if (inp && inp.focus) setTimeout(() => inp.focus({ preventScroll: true }), 350);
  }

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
    if (res.ok && res.data.token) { document.documentElement.removeAttribute('data-preview'); location.hash = location.hash || '#/'; render(); afterAuth(); return; }
    if (btn) { btn.disabled = false; btn.textContent = 'Activate this device'; }
    if (res.status === 409 && res.data.limit) { showLogin('', res.data.devices || []); return; }
    if (err) {
      const e = res.data.error || '';
      if (res.status === 500 && /LICENSE_SECRET|not configured|not bound/i.test(e)) err.textContent = 'The server setup is incomplete (see the note above). Your key is fine; this is a site configuration issue.';
      else err.textContent = e || (res.status === 0 ? 'Could not reach the licensing server. Check your connection.' : 'Activation failed.');
    }
  }
  function _submit() { const v = (document.getElementById('lg-key') || {}).value || ''; _do(v); }
  function _evict(shortId) { const v = (document.getElementById('lg-key') || {}).value || ''; if (!v) { const e = document.getElementById('lg-err'); if (e) e.textContent = 'Re-enter your key, then pick a slot.'; return; } _do(v, shortId); }

  return { PREVIEW, boot, session, signOut, deviceId, deviceLabel, devices, refreshStatus, removeDevice, showLogin,
           _fmt, _submit, _evict, _toActivate };
})();
