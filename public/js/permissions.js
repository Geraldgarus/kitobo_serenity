(function () {
  'use strict';

  // ── Hardcoded defaults (used when no DB permissions have been saved yet) ──
  var DEFAULT_PERMISSIONS = {
    admin:        { type: 'all' },
    director:     { type: 'all' },
    manager:      { type: 'deny',  pages: ['rooms-list', 'store-main', 'users'] },
    reception:    { type: 'allow', pages: ['dashboard', 'reservations', 'rooms', 'guest-database'] },
    housekeeping: { type: 'allow', pages: ['housekeeping', 'store-outlets'] },
    bar:          { type: 'allow', pages: ['bar', 'restaurant', 'point-of-sale', 'store-outlets'] },
    restaurant:   { type: 'allow', pages: ['bar', 'restaurant', 'point-of-sale', 'store-outlets'] },
    store:        { type: 'allow', pages: ['store-main', 'store-outlets', 'purchase-orders', 'goods-receipt'] }
  };

  var PUBLIC_PAGES  = ['', 'login', 'register'];
  var CACHE_PREFIX  = 'pms_perm_';
  var CACHE_TTL     = 5 * 60 * 1000; // 5 min

  // ── Helpers ──
  function getUser() {
    try { return JSON.parse(sessionStorage.getItem('pms_user') || 'null'); } catch (e) { return null; }
  }
  function getToken() { return sessionStorage.getItem('token') || ''; }

  function pageFromHref(href) {
    return (href || '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\//, '')
      .split('/')[0].split('?')[0].split('#')[0];
  }

  // canAccess works for both old-style {type,pages} objects AND new allow-list arrays
  function canAccess(perm, page) {
    if (!page || PUBLIC_PAGES.indexOf(page) !== -1) return true;
    if (!perm) return false;
    if (perm.type === 'all')   return true;
    if (perm.type === 'deny')  return perm.pages.indexOf(page) === -1;
    if (perm.type === 'allow') return perm.pages.indexOf(page) !== -1;
    return false;
  }

  function fallbackHref(perm) {
    if (!perm || perm.type === 'all' || perm.type === 'deny') return '/dashboard';
    if (perm.type === 'allow' && perm.pages.length) {
      // prefer dashboard if allowed, else first in list
      if (perm.pages.indexOf('dashboard') !== -1) return '/dashboard';
      return '/' + perm.pages[0];
    }
    return '/dashboard';
  }

  // ── sessionStorage cache ──
  function getCached(role) {
    try {
      var raw = sessionStorage.getItem(CACHE_PREFIX + role);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CACHE_TTL) { sessionStorage.removeItem(CACHE_PREFIX + role); return null; }
      return obj.perm;
    } catch (e) { return null; }
  }

  function setCache(role, perm) {
    try { sessionStorage.setItem(CACHE_PREFIX + role, JSON.stringify({ ts: Date.now(), perm: perm })); } catch (e) {}
  }

  // Expose so permissions.html can bust the cache after saving
  window.pmsClearPermCache = function(role) {
    if (role) sessionStorage.removeItem(CACHE_PREFIX + role);
    else {
      ['director','manager','reception','housekeeping','bar','restaurant','store'].forEach(function(r) {
        sessionStorage.removeItem(CACHE_PREFIX + r);
      });
    }
  };

  // ── Fetch from API ──
  function fetchPermissions(role) {
    return fetch('/api/permissions/' + encodeURIComponent(role), {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(res) { if (!res.ok) throw new Error('not ok'); return res.json(); })
    .then(function(data) {
      if (data && Array.isArray(data.pages) && data.pages.length > 0) {
        // DB has permissions set — use them as allow-list
        return { type: 'allow', pages: data.pages };
      }
      // DB empty for this role — fall back to hardcoded default
      return DEFAULT_PERMISSIONS[role] || { type: 'allow', pages: ['dashboard'] };
    })
    .catch(function() {
      return DEFAULT_PERMISSIONS[role] || { type: 'allow', pages: ['dashboard'] };
    });
  }

  // ── Lock element ──
  function lockElement(el) {
    if (el.classList.contains('pms-locked')) return;
    el.classList.add('pms-locked');
    if (el.hasAttribute('onclick')) el.removeAttribute('onclick');
    if (!el.querySelector('.pms-lock-icon')) {
      var icon = document.createElement('i');
      icon.className = 'fas fa-lock pms-lock-icon';
      el.appendChild(icon);
    }
    el.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof showToast === 'function') showToast('Access restricted for your role', '<i class="fas fa-lock"></i>');
    }, true);
  }

  // ── CSS ──
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '.pms-locked { cursor:not-allowed !important; opacity:0.45; pointer-events:all !important; position:relative; }',
    '.pms-locked:hover { opacity:0.7; transform:none !important; }',
    '.pms-lock-icon { display:none !important; font-size:11px; color:#f87171; flex-shrink:0; }',
    '.pms-locked:hover .pms-lock-icon { display:inline-block !important; }',
    '.sidebar-nav .pms-locked { display:flex; }',
    '.sidebar-nav .pms-locked:hover { background:rgba(239,68,68,0.18) !important; color:rgba(255,255,255,0.45) !important; }',
    '.sidebar-nav .pms-lock-icon { margin-left:auto; }',
    '.nav-icon-btn.pms-locked:hover { background:rgba(239,68,68,0.2) !important; color:#ef4444 !important; }',
    '.nav-icon-btn .pms-lock-icon { position:absolute; bottom:-2px; right:-2px; font-size:9px; background:#fff; border-radius:50%; padding:1px; color:#ef4444; display:none !important; }',
    '.nav-icon-btn.pms-locked:hover .pms-lock-icon { display:inline-block !important; }',
    '.btn-add-reservation.pms-locked { display:inline-flex; align-items:center; gap:6px; }',
    '.btn-add-reservation.pms-locked:hover { background:rgba(239,68,68,0.15) !important; color:#ef4444 !important; border-color:#ef4444 !important; }',
    '.btn-add-reservation .pms-lock-icon { margin-left:4px; }',
    'button.pos-navbar-btn.pms-locked { display:inline-flex; align-items:center; gap:6px; }',
    'button.pos-navbar-btn.pms-locked:hover { background:rgba(239,68,68,0.15) !important; color:#ef4444 !important; }',
    'button.pos-navbar-btn .pms-lock-icon { margin-left:4px; }',
    '.dropdown-menu .pms-locked { display:flex !important; align-items:center; gap:12px; }',
    '.dropdown-menu .pms-locked:hover { background:#fee2e2 !important; color:#ef4444 !important; }',
    '.dropdown-menu .pms-lock-icon { margin-left:auto; }'
  ].join('\n');
  document.head.appendChild(styleEl);

  // ── Apply permissions to the DOM ──
  function applyPermissions(perm) {
    var user = getUser();
    if (!user || !user.role) return;

    var currentPage = pageFromHref(window.location.pathname);

    // Page-level redirect
    if (currentPage && PUBLIC_PAGES.indexOf(currentPage) === -1 && !canAccess(perm, currentPage)) {
      window.location.replace(fallbackHref(perm));
      return;
    }

    // 1. Sidebar nav items
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(item) {
      var page = pageFromHref(item.getAttribute('href') || '');
      if (page && !canAccess(perm, page)) lockElement(item);
    });

    // 2. Navbar icon buttons
    document.querySelectorAll('.nav-icon-btn[href]').forEach(function(btn) {
      var page = pageFromHref(btn.getAttribute('href') || '');
      if (page && !canAccess(perm, page)) lockElement(btn);
    });

    // 3. Add Reservation button
    var addResBtn = document.querySelector('.btn-add-reservation');
    if (addResBtn && !canAccess(perm, 'reservations')) lockElement(addResBtn);

    // 4. POS button
    var posBtn = document.querySelector('.pos-navbar-btn');
    if (posBtn && !canAccess(perm, 'bar') && !canAccess(perm, 'restaurant')) lockElement(posBtn);

    // 5. Dropdown links
    document.querySelectorAll('.dropdown-menu a[href]').forEach(function(link) {
      var page = pageFromHref(link.getAttribute('href') || '');
      if (page && !canAccess(perm, page)) lockElement(link);
    });
  }

  // ── Initialise ──
  function run(perm) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { applyPermissions(perm); });
    } else {
      applyPermissions(perm);
    }
  }

  function hidePermissionsLink() {
    var hide = function() {
      var links = document.querySelectorAll('.sidebar-nav a[href="/permissions"]');
      for (var i = 0; i < links.length; i++) { links[i].style.display = 'none'; }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      hide();
    }
  }

  function init() {
    var user = getUser();
    if (!user || !user.role) return;
    var role = user.role;

    // Admin always has full access — skip API call, and keep permissions link visible
    if (role === 'admin') return;

    // Non-admin: hide the Permissions & Access sidebar link entirely
    hidePermissionsLink();

    // Try cache first (instant)
    var cached = getCached(role);
    if (cached) {
      run(cached);
      // Refresh cache silently in background
      fetchPermissions(role).then(function(perm) { setCache(role, perm); });
      return;
    }

    // No cache — fetch, cache, then apply
    fetchPermissions(role).then(function(perm) {
      setCache(role, perm);
      run(perm);
    });
  }

  init();
})();
