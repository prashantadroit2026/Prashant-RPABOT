/* global AB */
/**
 * ============================================================
 *  Approval Bot — Google Sheets bridge (gas-bridge.js)
 * ============================================================
 *  Include this single script on every frontend page and all
 *  relative fetch('/api/...') calls are re-routed to the GAS
 *  web app, which reads/writes the connected Google Sheet.
 *
 *  SETUP: edit CONFIG below (URL from Apps Script > Deploy >
 *  Web app), then add:
 *    <script src="gas-bridge.js"></script>
 *  before your page's <script> block.
 *
 *  AUTH: the shared signing KEY never ships to the browser. After
 *  /login the backend returns an HMAC-signed, expiring SESSION token
 *  which is stored in localStorage and sent with every request.
 * ============================================================
 */
(function () {
  if (window.GAS_BRIDGE) return;
  window.GAS_BRIDGE = true;

  var CONFIG = {
    // Local Flask backend — the bridge routes every relative /api call to
    // this URL with ?path=... exactly as it did to GAS.
    URL: 'http://127.0.0.1:5000/_rpc',
    SESSION_STORAGE: 'approval_bot_session',
    EMAIL_STORAGE: 'approval_bot_email',
    DEMO_ACCOUNTS: [
      { role: 'Admin', email: 'admin@adroitindustries.com', password: 'ChangeMe123' },
      { role: 'Store', email: 'store@adroitindustries.com', password: 'ChangeMe123' },
      { role: 'Shopfloor', email: 'shopfloor@adroitindustries.com', password: 'ChangeMe123' },
      { role: 'Purchase', email: 'purchase@adroitindustries.com', password: 'ChangeMe123' }
    ]
  };

  function getStore(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
  function setStore(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore quota */ } }
  function session() { return getStore(CONFIG.SESSION_STORAGE); }
  function _email() { return getStore(CONFIG.EMAIL_STORAGE); }

  function buildUrl(path, params) {
    var q = ['path=' + encodeURIComponent(path)];
    if (params) Object.keys(params).forEach(function (k) {
      q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return CONFIG.URL + '?' + q.join('&');
  }

  function fromPath(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url || url.indexOf('http') === 0 || url.indexOf('//') === 0) return null;
    return url.split('?')[0];
  }

  var origFetch = window.fetch;

  window.fetch = function (input, init) {
    init = init || {};
    var path = fromPath(input);
    if (!path) return origFetch(input, init);

    var method = (init.method || 'GET').toUpperCase();
    var body = {};
    if (init.body instanceof URLSearchParams) {
      init.body.forEach(function (v, k) { body[k] = v; });
    }

    if (path === '/login') {
      return origFetch(buildUrl('login', {}), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.assign({}, body))
      }).then(r => r.json()).then(j => {
        if (j.ok && j.session) {
          setStore(CONFIG.SESSION_STORAGE, j.session);
          if (j.email) setStore(CONFIG.EMAIL_STORAGE, j.email);
        } else {
          setStore(CONFIG.SESSION_STORAGE, '');
        }
        return new Response(JSON.stringify(j), { status: j.ok ? 200 : 401, headers: { 'Content-Type': 'application/json' } });
      });
    }

    if (path === '/logout') {
      try { localStorage.removeItem(CONFIG.SESSION_STORAGE); localStorage.removeItem(CONFIG.EMAIL_STORAGE); } catch { /* ignore */ }
      return origFetch(buildUrl('logout', {}), { method: 'POST' });
    }

    if (method === 'DELETE') {
      // Apps Script has no DELETE — rewrite as POST path=api/users&delete=1
      var who = '';
      if (typeof input === 'string') {
        var m = input.match(/[?&]email=([^&]*)/);
        if (m) who = decodeURIComponent(m[1]);
      } else if (input && input.url) {
        var m2 = input.url.match(/[?&]email=([^&]*)/);
        if (m2) who = decodeURIComponent(m2[1]);
      }
      var sess = session();
      var d = { delete: 1, email: who };
      if (sess) d.session = sess;
      return origFetch(buildUrl('api/users', d), { method: 'POST' });
    }

    // GET/POST -> GAS with the signed session token.
    // `email` is sent by callers only when it is the TARGET of an
    // operation (e.g. api/users add) — it is never trusted as identity.
    var sess2 = session();
    var params = {};
    if (sess2) params.session = sess2;
    if (method === 'GET') {
      return origFetch(buildUrl(path.replace(/^\//, ''), Object.assign(params, body)), { method: 'GET' });
    }
    return origFetch(buildUrl(path.replace(/^\//, ''), params), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    });
  };

  // ---- login.html: store the email so dashboard actions appear under the right actor
  function attachLogin() {
    var form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn && typeof AB !== 'undefined' && AB.setBusy) AB.setBusy(btn, true);
      var fd = new FormData(form);
      fetch('/login', {
        method: 'POST',
        body: new URLSearchParams(fd)
      }).then(function (res) {
        if (!res.ok) { document.getElementById('errorBox').style.display = 'block'; return null; }
        return res.json();
      }).then(function (j) {
        if (!j || !j.ok) return;
        if (typeof AB !== 'undefined' && AB.routeForRole) {
          window.location.href = AB.routeForRole({ email: j.email, roles: j.roles, department: j.department });
        } else {
          window.location.href = 'management.html';
        }
      }).catch(function () {
        document.getElementById('errorBox').style.display = 'block';
      }).finally(function () {
        if (btn && typeof AB !== 'undefined' && AB.setBusy) AB.setBusy(btn, false);
      });
    });
  }

  // ---- Store/Management dashboards call relative endpoints too — nothing to do, fetch is patched.

  // ---- login.html: one-click demo sign-in fills the form and submits via the normal flow.
  function attachDemo() {
    var form = document.getElementById('loginForm');
    if (!form) return;
    (CONFIG.DEMO_ACCOUNTS || []).forEach(function (acc) {
      var btn = document.getElementById('demo_' + acc.role.toLowerCase());
      if (!btn) return;
      btn.addEventListener('click', function () {
        var emailEl = document.getElementById('email');
        var passEl = document.getElementById('password');
        if (emailEl) emailEl.value = acc.email;
        if (passEl) passEl.value = acc.password;
        document.getElementById('errorBox').style.display = 'none';
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { attachLogin(); attachDemo(); });
  } else {
    attachLogin();
    attachDemo();
  }
})();