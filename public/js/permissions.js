(function () {
  'use strict';

  // ============================================================
  // ROLE PERMISSIONS
  // type:'all'   → access everything
  // type:'deny'  → access everything EXCEPT listed pages
  // type:'allow' → access ONLY listed pages
  // ============================================================
  var PERMISSIONS = {
    // Full access
    admin:     { type: 'all' },
    director:  { type: 'all' },

    // All pages EXCEPT rooms-list, main-store, user-management
    manager:   { type: 'deny',  pages: ['rooms-list', 'store-main', 'users'] },

    // Dashboard, Reservations, Rooms view, Guest database
    reception: { type: 'allow', pages: ['dashboard', 'reservations', 'rooms', 'guest-database'] },

    // Housekeeping + Outlet store only
    housekeeping: { type: 'allow', pages: ['housekeeping', 'store-outlets'] },

    // Whole POS: Bar, Restaurant, Point-of-Sale terminal (no sales report)
    bar:        { type: 'allow', pages: ['bar', 'restaurant', 'point-of-sale'] },
    restaurant: { type: 'allow', pages: ['bar', 'restaurant', 'point-of-sale'] },

    // Whole Inventory: Main store, Outlets, Purchase orders, Goods receipt (no reports)
    store:      { type: 'allow', pages: ['store-main', 'store-outlets', 'purchase-orders', 'goods-receipt'] }
  };

  var PUBLIC_PAGES = ['', 'login', 'register'];

  // ============================================================
  // HELPERS
  // ============================================================
  function getUser() {
    try { return JSON.parse(sessionStorage.getItem('pms_user') || 'null'); } catch (e) { return null; }
  }

  function pageFromHref(href) {
    if (!href) return '';
    return (href || '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\//, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0];
  }

  function canAccess(role, page) {
    if (!page || PUBLIC_PAGES.indexOf(page) !== -1) return true;
    var perm = PERMISSIONS[role];
    if (!perm) return false;
    if (perm.type === 'all')   return true;
    if (perm.type === 'deny')  return perm.pages.indexOf(page) === -1;
    if (perm.type === 'allow') return perm.pages.indexOf(page) !== -1;
    return false;
  }

  function fallbackHref(role) {
    var perm = PERMISSIONS[role];
    if (!perm || perm.type === 'all' || perm.type === 'deny') return '/dashboard';
    if (perm.type === 'allow' && perm.pages.length) return '/' + perm.pages[0];
    return '/dashboard';
  }

  // ============================================================
  // LOCK AN ELEMENT
  // ============================================================
  function lockElement(el) {
    el.classList.add('pms-locked');

    // Remove inline onclick so it cannot fire
    if (el.hasAttribute('onclick')) {
      el.removeAttribute('onclick');
    }

    // Add lock icon once
    if (!el.querySelector('.pms-lock-icon')) {
      var icon = document.createElement('i');
      icon.className = 'fas fa-lock pms-lock-icon';
      el.appendChild(icon);
    }

    // Block click in capture phase (fires before onclick / href)
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof showToast === 'function') {
        showToast('Access restricted for your role', '<i class="fas fa-lock"></i>');
      }
    }, true);
  }

  // ============================================================
  // CSS INJECTION
  // ============================================================
  var css = [
    /* ---- base locked style ---- */
    '.pms-locked {',
    '  cursor: not-allowed !important;',
    '  opacity: 0.45;',
    '  pointer-events: all !important;',
    '  position: relative;',
    '}',
    '.pms-locked:hover { opacity: 0.7; transform: none !important; }',
    '.pms-lock-icon { display: none !important; font-size: 11px; color: #f87171; flex-shrink: 0; }',
    '.pms-locked:hover .pms-lock-icon { display: inline-block !important; }',

    /* ---- sidebar nav items ---- */
    '.sidebar-nav .pms-locked { display: flex; }',
    '.sidebar-nav .pms-locked:hover { background: rgba(239,68,68,0.18) !important; color: rgba(255,255,255,0.45) !important; }',
    '.sidebar-nav .pms-lock-icon { margin-left: auto; }',

    /* ---- navbar icon buttons (Reservations / Reports circles) ---- */
    '.nav-icon-btn.pms-locked:hover { background: rgba(239,68,68,0.2) !important; color: #ef4444 !important; }',
    '.nav-icon-btn .pms-lock-icon { position: absolute; bottom: -2px; right: -2px; font-size: 9px; background: #fff; border-radius: 50%; padding: 1px; color: #ef4444; display: none !important; }',
    '.nav-icon-btn.pms-locked:hover .pms-lock-icon { display: inline-block !important; }',

    /* ---- Add Reservation button ---- */
    '.btn-add-reservation.pms-locked { display: inline-flex; align-items: center; gap: 6px; }',
    '.btn-add-reservation.pms-locked:hover { background: rgba(239,68,68,0.15) !important; color: #ef4444 !important; border-color: #ef4444 !important; }',
    '.btn-add-reservation .pms-lock-icon { margin-left: 4px; }',

    /* ---- navbar POS button ---- */
    'button.pos-navbar-btn.pms-locked { display: inline-flex; align-items: center; gap: 6px; }',
    'button.pos-navbar-btn.pms-locked:hover { background: rgba(239,68,68,0.15) !important; color: #ef4444 !important; }',
    'button.pos-navbar-btn .pms-lock-icon { margin-left: 4px; }',

    /* ---- dropdown menu links ---- */
    '.dropdown-menu .pms-locked { display: flex !important; align-items: center; gap: 12px; }',
    '.dropdown-menu .pms-locked:hover { background: #fee2e2 !important; color: #ef4444 !important; }',
    '.dropdown-menu .pms-lock-icon { margin-left: auto; }'
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ============================================================
  // APPLY PERMISSIONS
  // ============================================================
  function applyPermissions() {
    var user = getUser();
    if (!user || !user.role) return;

    var role = user.role;
    var currentPage = pageFromHref(window.location.pathname);

    // ---- Page-level redirect ----
    if (currentPage && PUBLIC_PAGES.indexOf(currentPage) === -1 && !canAccess(role, currentPage)) {
      window.location.replace(fallbackHref(role));
      return;
    }

    // ---- 1. Sidebar nav items ----
    var navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    for (var i = 0; i < navItems.length; i++) {
      var item = navItems[i];
      var page = pageFromHref(item.getAttribute('href') || '');
      if (!canAccess(role, page)) {
        lockElement(item);
      }
    }

    // ---- 2. Navbar icon buttons (Reservations / Reports etc.) ----
    var iconBtns = document.querySelectorAll('.nav-icon-btn[href]');
    for (var j = 0; j < iconBtns.length; j++) {
      var btn = iconBtns[j];
      var btnPage = pageFromHref(btn.getAttribute('href') || '');
      if (btnPage && !canAccess(role, btnPage)) {
        lockElement(btn);
      }
    }

    // ---- 3. Add Reservation button ----
    var addResBtn = document.querySelector('.btn-add-reservation');
    if (addResBtn && !canAccess(role, 'reservations')) {
      lockElement(addResBtn);
    }

    // ---- 4. Navbar POS button ----
    var posBtn = document.querySelector('.pos-navbar-btn');
    if (posBtn && !canAccess(role, 'bar') && !canAccess(role, 'restaurant')) {
      lockElement(posBtn);
    }

    // ---- 5. Dropdown menu links ----
    var dropLinks = document.querySelectorAll('.dropdown-menu a[href]');
    for (var k = 0; k < dropLinks.length; k++) {
      var link = dropLinks[k];
      var linkPage = pageFromHref(link.getAttribute('href') || '');
      if (linkPage && !canAccess(role, linkPage)) {
        lockElement(link);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPermissions);
  } else {
    applyPermissions();
  }

})();
