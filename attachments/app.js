/**
 * ============================================================
 *  Approval Bot — shared frontend helpers (app.js)
 *  Load AFTER gas-bridge.js, BEFORE the page's own script:
 *    <script src="gas-bridge.js"></script>
 *    <script src="app.js"></script>
 *  Exposes window.AB (and a global signOut helper).
 * ============================================================
 */
(function () {
  if (window.AB) return;
  var AB = {};

  AB.escapeHtml = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  AB.parseBody = function (body) {
    var out = {};
    String(body || '').split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^([^:\n]{2,40}):\s*(.+)$/);
      if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
    });
    return out;
  };

  AB.fmtDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  AB.shortToken = function (token) {
    return String(token || '').replace(/^APR-/i, '');
  };

  AB.statusLabel = function (s) {
    if (s === 'approved') return 'Approved';
    if (s === 'rejected') return 'Rejected';
    if (s === 'escalated') return 'Escalated';
    return 'Pending';
  };

  AB.ago = function (iso) {
    if (!iso) return '';
    var s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  };

  AB.setUpdated = function (el) {
    if (!el) return;
    el.textContent = 'Updated ' + AB.ago(new Date().toISOString());
  };

  /**
   * fetch() wrapper for the GAS backend.
   * - routes through gas-bridge.js (patched window.fetch)
   * - retries ONCE on network failure (never on API errors)
   * - GAS web apps always answer HTTP 200, so errors are detected
   *   via the JSON body (data.error / missing data.ok).
   * - a missing/expired session answers 401 semantics (httpStatus or
   *   an Unauthorized error) and bounces the visitor to login.html.
   * Returns { status, ok, data, error }.
   */
  AB.api = function (path, opts) {
    opts = opts || {};
    var bounced = false;
    function attempt() {
      return window.fetch(path, opts)
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            var err = (data && data.error) ? data.error : null;
            if (!bounced && err && (/^Unauthorized/.test(err) || /Session expired/.test(err) ||
                (data && data.httpStatus === 401))) {
              bounced = true;
              if (window.location.pathname.indexOf('login.html') < 0) {
                window.location.href = 'login.html';
              }
            }
            return { status: res.status, ok: res.ok && !err && data.ok !== false, data: data, error: err };
          });
        });
    }
    return attempt().catch(function (_err) {
      return attempt().catch(function (err2) {
        return { status: 0, ok: false, data: null, error: String((err2 && err2.message) || err2 || 'Network error') };
      });
    });
  };

  AB.toast = function (msg, isError) {
    var el = document.createElement('div');
    el.className = 'toast ' + (isError ? 'toast-error' : 'toast-success');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  };

  /**
   * Toggles a CSS spinner on a button while an async action runs.
   * The original label is restored on setBusy(btn, false).
   */
  AB.setBusy = function (btn, busy) {
    if (!btn) return;
    if (busy && !btn.classList.contains('is-loading')) {
      btn.dataset.abLabel = btn.innerHTML;
      btn.classList.add('is-loading');
      btn.disabled = true;
    } else if (!busy && btn.classList.contains('is-loading')) {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      if (btn.dataset.abLabel !== undefined) {
        btn.innerHTML = btn.dataset.abLabel;
        delete btn.dataset.abLabel;
      }
    }
  };

  AB.signOut = function () {
    window.fetch('/logout', { method: 'POST' })
      .catch(function () {})
      .finally(function () { window.location.href = 'login.html'; });
  };
  window.signOut = AB.signOut;

  /** Fills #userChip (the navbar profile pill) with the logged-in user. */
  AB.initUserChip = function () {
    var el = document.getElementById('userChip');
    if (!el) return;
    AB.api('/api/me').then(function (r) {
      var me = r.data || {};
      if (!me || !me.email) { el.style.display = 'none'; return; }
      var role = (me.roles && me.roles[0]) ? me.roles[0].charAt(0).toUpperCase() + me.roles[0].slice(1) : 'User';
      while (el.firstChild) el.removeChild(el.firstChild);
      var av = document.createElement('div');
      av.className = 'profile-avatar';
      av.textContent = String(me.name || me.email || '?').charAt(0).toUpperCase();
      var tx = document.createElement('div');
      tx.className = 'profile-text';
      var nm = document.createElement('span');
      nm.className = 'profile-name';
      nm.textContent = me.name || me.email;
      var rl = document.createElement('span');
      rl.className = 'profile-role';
      rl.textContent = role;
      tx.appendChild(nm);
      tx.appendChild(rl);
      el.appendChild(av);
      el.appendChild(tx);
      el.style.display = '';
    }).catch(function () { el.style.display = 'none'; });
  };

  /** Poll with auto-pause while the tab is hidden. Calls fn() immediately. */
  AB.startPolling = function (fn, ms) {
    fn();
    setInterval(function () { if (!document.hidden) fn(); }, ms);
  };

  AB.skeleton = function (n, small) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<div class="skeleton' + (small ? ' skeleton-sm' : '') + '"></div>';
    return out;
  };

  AB.getUserPermissions = function (me) {
    if (!me || !me.email) {
      return { isPublic: true, isStore: false, isMd: false, isPurchase: false, isShopfloor: false, canAccessAll: false };
    }
    var roles = (me.roles || []).map(function (r) { return String(r).toLowerCase(); });
    var dept = String(me.department || '').toLowerCase();
    var isMd = roles.indexOf('admin') >= 0 || roles.indexOf('management') >= 0 || roles.indexOf('md') >= 0 || dept === 'md' || dept === 'management';
    var isStore = !isMd && (roles.indexOf('store') >= 0 || dept.indexOf('store') >= 0);
    var isPurchase = !isMd && (roles.indexOf('purchase') >= 0 || dept.indexOf('purchase') >= 0);
    return {
      isPublic: false,
      isStore: isStore,
      isMd: isMd,
      isPurchase: isPurchase,
      isShopfloor: !isMd && !isStore && !isPurchase,
      canAccessAll: isMd
    };
  };

  /** Route an authenticated user to their portal: shopfloor -> item, store -> store, purchase -> purchase dashboard, admin/management -> management. */
  AB.routeForRole = function (me, perms) {
    perms = perms || AB.getUserPermissions(me);
    if (perms.isShopfloor) return 'item.html';
    if (perms.isStore) return 'store.html';
    if (perms.isPurchase) return 'Purchase dashboard.html';
    return 'management.html';
  };

  /**
   * Page-level access matrix — role gates per page.
   * item portal: all authenticated users; store/inventory: store + management;
   * management: everyone except store; purchase dashboard: purchase + management.
   */
  AB.pageAccess = function (perms) {
    perms = perms || {};
    return {
      'item.html': true,
      'store.html': !!perms.isStore || !!perms.isMd,
      'inventory.html': !!perms.isStore || !!perms.isMd,
      'management.html': !perms.isStore,
      'purchase dashboard.html': !!perms.isPurchase || !!perms.isMd
    };
  };

  AB.canVisit = function (page, perms) {
    var key = String(page || '').split('/').pop().toLowerCase();
    if (key.indexOf('?') >= 0) key = key.slice(0, key.indexOf('?'));
    var map = AB.pageAccess(perms);
    return map[key] !== false;
  };

  /** Hides navbar links the current role may not open. Call after /api/me resolves. */
  AB.applyNavPermissions = function (me) {
    var perms = AB.getUserPermissions(me);
    document.querySelectorAll('.nav-links .nav-link[href]').forEach(function (link) {
      var allowed = AB.canVisit(link.getAttribute('href'), perms);
      link.style.display = allowed ? '' : 'none';
    });
  };

  /** Redirects the user to their portal when the current page is off-limits. Returns false when redirected. */
  AB.guardPage = function (me, page) {
    var here = String(page || (window.location.pathname.split('/').pop() || 'management.html'));
    if (!AB.canVisit(here, AB.getUserPermissions(me))) {
      window.location.href = AB.routeForRole(me);
      return false;
    }
    return true;
  };

  window.AB = AB;
})();
