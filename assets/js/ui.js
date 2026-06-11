/* ============================================================================
 * MCQ Café POS — UI layer
 * Renders all views and wires interactions. Framework-free.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const S = global.Store;

  /* ---- helpers ----------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = (n) => S.money(n);
  const ITEM_ASSET_VERSION = 12;
  const itemAsset = (id) => 'assets/images/items/' + id + '.jpg?v=' + ITEM_ASSET_VERSION;
  const itemImage = (item) => item.img || itemAsset(item.id);

  const ui = {
    view: 'register', currentUser: null, adminUnlocked: false,
    category: S.getCategories()[0].id, drinkSub: 'juice', search: '',
    menuTab: 'items', reportFrom: '', reportTo: '', reportCat: '', historyDay: null, orderQuery: '',
    // loyalty member attached to the current counter ticket (scanned at checkout)
    counterMember: null,
    // Standing Order Tree (self-service kiosk)
    kioskStage: 'attract', kioskCat: null, kioskPayStage: 'review', member: null, kioskCartOpen: false,
    kioskLang: 'en', kioskFilter: 'all'
  };

  // Top-level category navigation; the Drinks group reveals its sub-categories.
  const DRINKS_GROUP = { id: 'g:drinks', name: 'Drinks', icon: '🥤', accent: '#0fa3a0', subs: ['juice', 'smoothies', 'coffee', 'lemonade'] };
  const CAT_NAV = ['banh-mi', 'pho-bun', 'dry-noodles', 'rice', 'sizzling', DRINKS_GROUP, 'combo', 'bakery'];
  const effectiveCat = () => (ui.category === 'g:drinks' ? ui.drinkSub : ui.category);

  /* ---- item promo preview (reuses the pricing engine) -------------------- */
  function itemPromo(item) {
    return S.linePromo({ cat: item.cat, isCombo: item.isCombo, itemId: item.id, unitPrice: item.price, qty: 1, noDiscount: item.noDiscount });
  }

  /* ---- promotion helpers (shared by banner, section head, info panel) ---- */
  const activePromos = () => S.getPromotions().filter((p) => S.promotionActiveNow(p));
  function promoValidity(p) {
    if (p.startDate && p.endDate) return fmtDay(p.startDate) + ' – ' + fmtDay(p.endDate);
    if (p.endDate) return 'until ' + fmtDay(p.endDate);
    if (p.startDate) return 'from ' + fmtDay(p.startDate);
    return 'ongoing';
  }
  function renderPromoBanner() {
    const active = activePromos();
    if (!active.length) return '';
    return `<div class="promo-banner" onclick="UI.openPromoInfo()" title="View all promotions">
      <span class="pb-ico">🏷️</span>
      <div class="pb-list">
        ${active.slice(0, 2).map((p) => `<span class="pb-item"><b>${esc(p.name)}</b><em>${esc(promoValidity(p))}</em></span>`).join('')}
        ${active.length > 2 ? `<span class="pb-more">+${active.length - 2} more</span>` : ''}
      </div>
      <span class="pb-cta">Details ›</span>
    </div>`;
  }

  /* ====================================================================== *
   * SHELL & ROUTING
   * ====================================================================== */
  function init() {
    S.load();
    document.body.innerHTML = `
      <div id="app">
        <div id="main">
          <header id="topbar"></header>
          <section id="view"></section>
        </div>
      </div>
      <div id="modal-root"></div>
      <div id="print-area"></div>
      <div id="toast"></div>`;
    ui.reportFrom = S.dayKey(Date.now());
    ui.reportTo = S.dayKey(Date.now());
    ui.historyDay = S.dayKey(Date.now());
    applyModeClasses();
    S.subscribe(renderDynamic);
    renderTopbar();
    render();
    setInterval(renderClock, 1000 * 30);
  }

  // Re-render parts that depend on state (called on every commit).
  // On the register we surgically refresh ONLY the cart panel, leaving the menu
  // grid (and its images) and the top bar untouched — no flicker, no "reload".
  function renderDynamic() {
    applyModeClasses();
    if (ui.view === 'register' && document.getElementById('pos-cart')) { refreshCart(); return; }
    // Customer display mirrors the live counter cart without a full reflow.
    if (ui.view === 'backscreen') { paintBackScreen(); return; }
    // The kiosk drives its own renders (its cart lives in UI state, not the store),
    // so a store emit here shouldn't blow away the current stage / playing video.
    if (ui.view === 'kiosk') return;
    renderTopbar(); render();
  }
  function applyModeClasses() {
    document.body.classList.toggle('training-mode', S.isTrainingMode());
    document.body.classList.remove('touch-mode');
  }
  function refreshCart() {
    const el = $('#pos-cart'); if (!el) return;
    const list = el.querySelector('.cart-list');
    const scroll = list ? list.scrollTop : 0;
    el.innerHTML = renderCart();
    const nl = el.querySelector('.cart-list'); if (nl) nl.scrollTop = scroll;
  }
  function refreshGrid() { const el = $('#menu-grid'); if (el) el.innerHTML = renderGrid(); }

  // Views that need a Manager to ENTER. Transaction History (orders) is open to
  // everyone — only the Refund action inside it is gated.
  const ADMIN_VIEWS = ['admin', 'orders', 'dashboard', 'menu', 'settings', 'audit'];
  const GATED_VIEWS = ['admin', 'dashboard', 'menu', 'settings', 'audit'];
  const isAdminUser = () => !!(ui.currentUser && ui.currentUser.role === 'admin');
  function go(view) { ui.view = view; renderTopbar(); render(); }

  // Run cb if the operator may use admin features. Admins pass freely; a cashier
  // is asked for a Manager PIN ONCE per session (then stays unlocked).
  function requireAdmin(cb, hint) {
    if (isAdminUser() || ui.adminUnlocked) return cb();
    openPinPad({
      title: 'Admin access', hint: hint || 'Manager PIN (once per shift)',
      onSubmit: (pin) => { if (!S.verifyAdminPin(pin)) return false; ui.adminUnlocked = true; closeModal(); cb(); return true; }
    });
  }
  // Always ask for a Manager PIN — used for discounts (every time).
  function requireAdminAlways(cb, hint) {
    openPinPad({
      title: 'Manager approval', hint: hint || 'Manager PIN required',
      onSubmit: (pin) => { if (!S.verifyAdminPin(pin)) return false; closeModal(); cb(); return true; }
    });
  }

  function renderTopbar() {
    const c = S.getConfig();
    const tb = $('#topbar'); if (!tb) return;
    if (!ui.currentUser) {   // login screen — minimal bar
      tb.innerHTML = `<div class="tb-left"><h1>${esc(c.storeName)} <span class="tb-tag">${esc(c.tagline)}</span></h1></div>`;
      tb.classList.add('plain');
      return;
    }
    tb.classList.remove('plain');
    const inAdmin = ADMIN_VIEWS.includes(ui.view);
    const right = inAdmin
      ? `<button class="tb-action" onclick="UI.exitAdmin()">🖥️ Register</button>`
      : `<button class="tb-action mode ${S.isTrainingMode() ? 'on' : ''}" title="Training sales do not count in reports" onclick="UI.toggleTrainingMode()">🎓 <span>${S.isTrainingMode() ? 'Training ON' : 'Training'}</span></button>
         <button class="tb-action" title="Transaction history" onclick="UI.go('orders')">📑 <span>History</span></button>
         <button class="tb-action" title="Reprint" onclick="UI.reprintLast()">🖨 <span>Reprint</span></button>
         <button class="tb-action key" onclick="UI.openAdmin()">🔑 <span>Admin</span></button>`;
    tb.innerHTML = `
      <div class="tb-left">
        ${c.logo ? `<img class="tb-logo" src="${c.logo}" alt="">` : ''}
        <h1>${esc(c.storeName)}${inAdmin ? ' <span class="tb-tag">Admin</span>' : `<span class="tb-tag">${esc(c.tagline)}</span>`}</h1>
      </div>
      <div class="tb-right">
        ${right}
        <div class="tb-clock" id="tb-clock">${nowLabel()}</div>
        <button class="tb-cashier" onclick="UI.logout()" title="Log out">
          <span class="dot ${ui.currentUser.role === 'admin' ? 'admin' : ''}"></span><span class="tb-cashier-name">${esc(ui.currentUser.name)}</span> ⏻
        </button>
      </div>`;
  }
  function nowLabel() {
    const d = new Date();
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function renderClock() { const el = $('#tb-clock'); if (el) el.textContent = nowLabel(); }

  function toggleTrainingMode() {
    S.setTrainingMode(!S.isTrainingMode());
    renderTopbar();
    render();
    toast(S.isTrainingMode() ? 'Training mode on — sales are not counted' : 'Training mode off');
  }
  function render() {
    const v = $('#view'); if (!v) return;
    document.body.classList.toggle('login-view', !ui.currentUser);
    document.body.classList.toggle('screen-view', ui.view === 'backscreen' || ui.view === 'kiosk');
    if (!ui.currentUser) { v.innerHTML = renderLogin(); return; }
    if (GATED_VIEWS.includes(ui.view) && !(ui.adminUnlocked || isAdminUser())) { ui.view = 'register'; }
    if (ui.view === 'register') v.innerHTML = renderPOS();
    else if (ui.view === 'admin') v.innerHTML = renderAdminHub();
    else if (ui.view === 'orders') v.innerHTML = renderOrders();
    else if (ui.view === 'dashboard') v.innerHTML = renderDashboard();
    else if (ui.view === 'menu') v.innerHTML = renderMenuManager();
    else if (ui.view === 'settings') v.innerHTML = renderSettings();
    else if (ui.view === 'audit') v.innerHTML = renderAuditLog();
    else if (ui.view === 'backscreen') v.innerHTML = renderBackScreen();
    else if (ui.view === 'kiosk') v.innerHTML = renderKiosk();
    if (ui.view === 'register' && ui.search) { const s = $('#search'); if (s) s.value = ui.search; }
    if (ui.view === 'orders' && ui.orderQuery) {
      const s = $('#order-search'); if (s) { s.focus(); const n = s.value.length; s.setSelectionRange(n, n); }
    }
  }

  /* ====================================================================== *
   * LOGIN  (choose cashier → PIN)
   * ====================================================================== */
  function renderLogin() {
    const c = S.getConfig();
    const users = S.getUsers();
    return `<div class="login">
      <div class="login-collage" aria-hidden="true">
        <div class="lc-panel"><img src="assets/images/login-bg.jpg?v=27" alt=""></div>
        <div class="lc-panel lc-video">
          <video src="${LOGIN_VIDS[0]}" autoplay muted playsinline preload="auto"
            poster="assets/images/food-spread.jpg"
            onended="UI.loginNextVid(this)" onerror="this.classList.add('gone')"></video>
        </div>
        <div class="lc-panel"><img src="assets/images/food-spread.jpg" alt=""></div>
      </div>
      <div class="login-scrim" aria-hidden="true"></div>
      <div class="login-card">
        <div class="login-brand">
          ${c.logo ? `<img src="${c.logo}" alt="MCQ">` : '<div class="brand-mark">MCQ</div>'}
          <span class="login-eyebrow">Point of Sale</span>
          <h2>${esc(c.storeName)}</h2>
          <p>${esc(c.tagline)} · Select your account</p>
        </div>
        <div class="login-users">
          ${users.map((u) => `
            <button class="login-user" onclick="UI.chooseCashier('${u.id}')">
              <span class="lu-avatar ${u.role === 'admin' ? 'admin' : ''}">${esc(u.name.charAt(0).toUpperCase())}</span>
              <span class="lu-name">${esc(u.name)}</span>
              <span class="lu-role">${u.role === 'admin' ? 'Manager' : 'Cashier'}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  }
  function chooseCashier(id) {
    const u = S.getUsers().find((x) => x.id === id);
    if (!u) return;
    openPinPad({
      title: 'Enter PIN', hint: u.name + ' · ' + (u.role === 'admin' ? 'Manager' : 'Cashier'),
      onSubmit: (pin) => {
        const v = S.verifyUser(id, pin);
        if (!v) return false;
        ui.currentUser = v; ui.view = 'register'; ui.adminUnlocked = false;
        closeModal(); S.setActiveCashier(v.name);
        return true;
      }
    });
  }
  function logout() {
    ui.currentUser = null; ui.adminUnlocked = false; ui.view = 'register';
    closeModal(); renderTopbar(); render();
  }

  /* ====================================================================== *
   * ADMIN  (password gate → hub)
   * ====================================================================== */
  function openAdmin() { requireAdmin(() => go('admin')); }
  function exitAdmin() { ui.view = 'register'; renderTopbar(); render(); }   // stays unlocked for the shift

  function renderAdminHub() {
    const tiles = [
      { v: 'orders', icon: '📑', label: 'Transaction History', desc: 'Look up, reprint, refund' },
      { v: 'dashboard', icon: '📊', label: 'Report', desc: 'Sales, till reading & ring off' },
      { v: 'menu', icon: '🍽️', label: 'Menu', desc: 'Items, add-ons, promotions' },
      { v: 'audit', icon: '🧾', label: 'Audit Log', desc: 'Refunds, discounts, sold out' },
      { v: 'settings', icon: '⚙️', label: 'Settings', desc: 'Store, staff, tax, data' }
    ];
    return `<div class="page admin-hub">
      <div class="page-head"><h2>Admin</h2>
        <div class="page-tools"><button class="ghost-btn" onclick="UI.exitAdmin()">🖥️ Back to Register</button></div>
      </div>
      <div class="hub-grid">
        ${tiles.map((t) => `<button class="hub-tile" onclick="UI.go('${t.v}')">
          <span class="hub-ico">${t.icon}</span>
          <span class="hub-label">${t.label}</span>
          <span class="hub-desc">${t.desc}</span>
        </button>`).join('')}
        <button class="hub-tile credit" onclick="UI.openCredit()">
          <span class="hub-ico">💸</span>
          <span class="hub-label">Credit / Goodwill Refund</span>
          <span class="hub-desc">Refund without a receipt</span>
        </button>
        <button class="hub-tile screen-tile" onclick="UI.openBackScreen()">
          <span class="hub-ico">🖥️</span>
          <span class="hub-label">Customer Display</span>
          <span class="hub-desc">Back-screen the guest reads & pays by</span>
        </button>
        <button class="hub-tile kiosk-tile" onclick="UI.openKiosk()">
          <span class="hub-ico">🛎️</span>
          <span class="hub-label">Standing Order Tree</span>
          <span class="hub-desc">Self-order kiosk · ads, membership, queue tickets</span>
        </button>
      </div>
    </div>`;
  }
  function adminBack() {
    const toAdmin = ui.adminUnlocked || isAdminUser();
    return toAdmin
      ? `<button class="ghost-btn" onclick="UI.go('admin')">← Admin</button>`
      : `<button class="ghost-btn" onclick="UI.exitAdmin()">🖥️ Register</button>`;
  }

  function auditLabel(action) {
    const labels = {
      'training.on': 'Training enabled',
      'training.off': 'Training disabled',
      'sale.training': 'Training sale',
      'discount.order': 'Order discount',
      'discount.items': 'Item discount',
      'discount.clear': 'Discounts cleared',
      'order.void': 'Order voided',
      'order.refund': 'Refund processed',
      'credit.issue': 'Credit issued',
      'menu.create': 'Menu item created',
      'menu.update': 'Menu item updated',
      'menu.delete': 'Menu item deleted',
      'menu.sold_out': 'Marked sold out',
      'menu.available': 'Marked available',
      'settings.update': 'Settings updated',
      'promotion.create': 'Promotion created',
      'promotion.update': 'Promotion updated',
      'promotion.delete': 'Promotion deleted',
      'promotion.enable': 'Promotion enabled',
      'promotion.disable': 'Promotion disabled',
      'staff.create': 'Staff created',
      'staff.update': 'Staff updated',
      'staff.delete': 'Staff deleted',
      'till.ring_off': 'Ring off',
      'data.import': 'Data imported',
      'data.reset': 'Data reset'
    };
    return labels[action] || action;
  }
  function auditDetail(detail) {
    if (!detail || !Object.keys(detail).length) return '—';
    if (detail.name && detail.amount) return `${detail.name} · ${money(detail.amount)}`;
    if (detail.code && detail.amount) return `Order ${detail.code} · ${money(detail.amount)}`;
    if (detail.code && detail.total) return `Order ${detail.code} · ${money(detail.total)}`;
    if (detail.keys) return detail.keys.join(', ');
    if (detail.name) return detail.name;
    if (detail.amount) return money(detail.amount);
    return Object.entries(detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');
  }
  function renderAuditLog() {
    const rows = S.getAuditLog().slice(0, 300);
    const body = rows.length ? rows.map((a) => {
      const d = new Date(a.at);
      return `<tr>
        <td><b>${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}</b><span class="row-sub">${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></td>
        <td>${esc(a.by || 'System')}</td>
        <td><span class="audit-action">${esc(auditLabel(a.action))}</span><span class="row-sub">${esc(a.action)}</span></td>
        <td class="audit-detail">${esc(auditDetail(a.detail))}</td>
        <td><span class="audit-level ${esc(a.level || 'info')}">${esc(a.level || 'info')}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="empty-cell">No audit activity yet.</td></tr>`;
    return `<div class="page">
      <div class="page-head">
        <div class="page-title">${adminBack()}<h2>Audit Log</h2></div>
        <div class="page-tools"><button class="ghost-btn" onclick="UI.exportAuditLog()">⬇ Export CSV</button></div>
      </div>
      <div class="orders-summary">
        <div class="pill">Logged actions: <b>${S.getAuditLog().length}</b></div>
        <div class="pill warn">Manager-sensitive changes only</div>
      </div>
      <div class="table-wrap">
        <table class="data-table audit-table">
          <thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Detail</th><th>Level</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function exportAuditLog() {
    const rows = [['Time', 'Staff', 'Action', 'Level', 'Detail']].concat(S.getAuditLog().map((a) => [
      new Date(a.at).toLocaleString(), a.by || 'System', auditLabel(a.action), a.level || 'info', auditDetail(a.detail)
    ]));
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mcq-audit-' + S.dayKey(Date.now()) + '.csv';
    a.click();
    toast('Audit log exported');
  }

  /* ====================================================================== *
   * PIN PAD  (shared: login, admin, discount)
   * ====================================================================== */
  let pinState = null;
  function openPinPad(opts) {
    pinState = { value: '', opts, error: false };
    renderPinPad();
  }
  function pinDotsHTML() {
    return Array.from({ length: 4 }).map((_, i) =>
      `<span class="pin-dot ${i < pinState.value.length ? 'on' : ''}"></span>`).join('');
  }
  function renderPinPad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
    openModal(modalShell(esc(pinState.opts.title), `
      <div id="pinpad" class="pinpad ${pinState.error ? 'err' : ''}">
        <div class="pin-hint">${esc(pinState.opts.hint || '')}</div>
        <div id="pin-dots" class="pin-dots">${pinDotsHTML()}</div>
        <div class="pin-keys">
          ${keys.map((k) => k === 'clear'
            ? `<button class="pin-key fn" onclick="UI.pinClear()">C</button>`
            : k === 'back'
              ? `<button class="pin-key fn" onclick="UI.pinBack()">⌫</button>`
              : `<button class="pin-key" onclick="UI.pinKey('${k}')">${k}</button>`).join('')}
        </div>
      </div>`, {
      size: 'sm',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>`
    }));
  }
  // Surgical update — only the dots change, the keypad never rebuilds.
  function syncPin() {
    const d = $('#pin-dots'); if (d) d.innerHTML = pinDotsHTML();
    const p = $('#pinpad'); if (p) p.classList.toggle('err', pinState.error);
  }
  function pinKey(k) {
    if (pinState.value.length >= 4) return;
    pinState.value += k; pinState.error = false; syncPin();
    if (pinState.value.length === 4) { setTimeout(pinSubmit, 140); }
  }
  function pinClear() { pinState.value = ''; pinState.error = false; syncPin(); }
  function pinBack() { pinState.value = pinState.value.slice(0, -1); pinState.error = false; syncPin(); }
  function pinSubmit() {
    if (!pinState) return;
    const ok = pinState.opts.onSubmit(pinState.value);
    if (!ok) { pinState.value = ''; pinState.error = true; syncPin(); }
  }

  /* ====================================================================== *
   * POS VIEW
   * ====================================================================== */
  function renderPOS() {
    return `
      <div class="pos">
        <div class="pos-menu">
          ${renderTrainingBanner()}
          ${renderPromoBanner()}
          ${renderCatBar()}
          <div id="sec-head">${renderSectionHead()}</div>
          <div id="menu-grid" class="menu-grid">${renderGrid()}</div>
        </div>
        <div id="pos-cart" class="pos-cart">${renderCart()}</div>
      </div>`;
  }

  function renderTrainingBanner() {
    if (!S.isTrainingMode()) return '';
    return `<div class="training-banner">
      <strong>Training mode is ON</strong>
      <span>Practice sales print as training receipts and are excluded from revenue, till, top sellers and staff reports.</span>
    </div>`;
  }

  function renderCatBar() {
    const cats = S.getCategories();
    const byId = (id) => cats.find((c) => c.id === id) || {};
    const drinksActive = ui.category === 'g:drinks';
    const chips = CAT_NAV.map((entry) => {
      if (typeof entry === 'string') {
        const c = byId(entry);
        return `<button class="cat-chip ${ui.category === entry && !ui.search ? 'active' : ''}"
          style="--accent:${c.accent}" onclick="UI.setCategory('${entry}')">
          <span class="cat-ico">${c.icon}</span><span>${esc(c.name)}</span></button>`;
      }
      return `<button class="cat-chip ${drinksActive && !ui.search ? 'active' : ''}"
        style="--accent:${entry.accent}" onclick="UI.setCategory('g:drinks')">
        <span class="cat-ico">${entry.icon}</span><span>${esc(entry.name)} ▾</span></button>`;
    }).join('');
    let sub = '';
    if (drinksActive && !ui.search) {
      sub = `<div class="subcat-bar">${DRINKS_GROUP.subs.map((sid) => {
        const c = byId(sid);
        return `<button class="subcat-chip ${ui.drinkSub === sid ? 'active' : ''}" style="--accent:${c.accent}" onclick="UI.setDrinkSub('${sid}')">${c.icon} ${esc(c.name)}</button>`;
      }).join('')}</div>`;
    }
    return `<div class="cat-bar">${chips}</div>${sub}`;
  }

  function renderSectionHead() {
    const eid = effectiveCat();
    const c = S.getCategories().find((x) => x.id === eid);
    if (!c) return '';
    const count = S.itemsByCategory(eid).length;
    const catPromos = activePromos().filter((p) => p.type === 'category_percent' && p.category === eid);
    const promo = catPromos.length
      ? `<span class="sec-promo">🏷️ ${esc(catPromos[0].name)} · ${esc(promoValidity(catPromos[0]))}</span>` : '';
    return `<div class="sec-head-row" style="--accent:${c.accent}">
      <div class="sec-title"><span class="sec-ico">${c.icon}</span>${esc(c.name)}<span class="sec-count">${count}</span></div>
      ${promo}
    </div>`;
  }

  function renderGrid() {
    const cart = S.getCart();
    let items;
    if (ui.search) {
      const q = ui.search.toLowerCase();
      items = S.getMenu().filter((m) => m.name.toLowerCase().includes(q));
    } else {
      items = S.itemsByCategory(effectiveCat());
    }
    if (!items.length) return `<div class="empty-grid">No items found.</div>`;

    return items.map((item) => {
      const promo = itemPromo(item);
      const soldOut = item.available === false;
      const blockedTakeaway = item.takeawayOnly && cart.orderType === 'dine-in';
      const disabled = soldOut || blockedTakeaway;
      const cat = S.getCategories().find((c) => c.id === item.cat) || {};
      const img = itemImage(item);
      return `
        <article class="m-card ${disabled ? 'disabled' : ''} ${item.isCombo ? 'combo' : ''}"
          style="--accent:${cat.accent || '#c79a3f'}"
          ${disabled ? 'aria-disabled="true"' : `role="button" tabindex="0" onclick="UI.addItem('${item.id}', event)" onkeydown="UI.itemCardKey(event,'${item.id}')"`}>
          <div class="m-thumb">
            <span class="m-thumb-ico">${cat.icon || '🍽️'}</span>
            <img src="${esc(img)}" alt="${esc(item.name)}" width="480" height="360" loading="lazy" decoding="async" onerror="this.remove();this.parentNode.classList.add('noimg')">
            <span class="m-thumb-scrim"></span>
            ${promo ? `<span class="m-badge">−${promo.perUnit ? Math.round(promo.perUnit / item.price * 100) : 15}%</span>` : ''}
            ${item.takeawayOnly ? `<span class="m-tag takeaway">Take-away</span>` : ''}
            ${soldOut ? `<span class="m-tag sold">Sold out</span>` : ''}
            <div class="sold-slider ${soldOut ? 'restore' : ''}" role="button"
              aria-label="${soldOut ? 'Slide right to restore item' : 'Slide right to mark sold out'}"
              title="${soldOut ? 'Slide right to restore' : 'Slide right to mark sold out'}"
              onpointerdown="UI.soldSwipeStart(event,'${item.id}')">
              <span class="sold-slider-knob">${soldOut ? '↺' : '»'}</span>
            </div>
          </div>
          <div class="m-body">
            <div class="m-name">${esc(item.name)}</div>
            <div class="m-price">
              ${promo ? `<span class="m-old">${money(item.price)}</span><span class="m-new">${money(item.price - promo.perUnit)}</span>`
                : `<span>${money(item.price)}</span>`}
            </div>
          </div>
        </article>`;
    }).join('');
  }

  function renderCart() {
    const cart = S.getCart();
    const t = S.computeTotals(cart);
    const held = S.getHeld();
    const cm = ui.counterMember;
    const memberRow = cm
      ? `<div class="cart-member on">
           <span class="cm-star">⭐</span>
           <span class="cm-info"><b>${esc(cm.name)}</b><em>${esc(cm.code)} · ${cm.points || 0} pts</em></span>
           <button class="cm-x" title="Remove member" onclick="UI.clearCounterMember()">✕</button>
         </div>`
      : `<button class="cart-member" onclick="UI.openMemberScan()">
           <span class="cm-star">⭐</span><span>Scan / add member</span>
         </button>`;

    const lines = cart.lines.length ? cart.lines.map((line) => {
      const lt = t.lines.find((x) => x.uid === line.uid);
      const comps = line.components && line.components.length
        ? `<div class="ci-comp">${line.components.map((c) => `• ${esc(c.name)}`).join('<br>')}</div>` : '';
      const addons = (line.addons && line.addons.length)
        ? `<div class="ci-comp">${line.addons.map((a) => `+ ${esc(a.name)}${a.qty > 1 ? ' ×' + a.qty : ''} <span class="ci-addprice">+${money(a.price * a.qty)}</span>`).join('<br>')}</div>` : '';
      const mods = (line.mods && line.mods.length)
        ? `<div class="ci-mods">${line.mods.map((mm) => `<span>${esc(mm)}</span>`).join('')}</div>` : '';
      const note = line.note ? `<div class="ci-note">📝 ${esc(line.note)}</div>` : '';
      const promoTag = lt.promo ? `<span class="ci-promo">${lt.promo.name}</span>` : '';
      const customized = (line.addons && line.addons.length) || (line.mods && line.mods.length) || line.note;
      return `
        <div class="cart-item">
          <div class="ci-main">
            <div class="ci-head">
              <span class="ci-name">${esc(line.name)}</span>
              <span class="ci-amt">${money(lt.lineNet)}</span>
            </div>
            ${comps}${addons}${mods}${note}
            <div class="ci-meta">
              <span class="ci-unit">${money(lt.unitPrice)} ea ${promoTag}${lt.lineManual > 0 ? `<span class="ci-disc">−${line.discount.mode === 'percent' ? line.discount.value + '%' : money(line.discount.value)}</span>` : ''}</span>
            </div>
            <div class="ci-actions">
              <div class="stepper">
                <button onclick="UI.inc('${line.uid}',-1)">−</button>
                <span>${line.qty}</span>
                <button onclick="UI.inc('${line.uid}',1)">+</button>
              </div>
              <div class="qty-shortcuts" aria-label="Quick quantity">
                ${[2, 3, 5].map((n) => `<button class="${line.qty === n ? 'on' : ''}" onclick="UI.setQty('${line.uid}',${n})">x${n}</button>`).join('')}
              </div>
              <button class="ci-customize ${customized ? 'on' : ''}" onclick="UI.openCustomize('${line.uid}')">✎ ${customized ? 'Edit' : 'Customize'}</button>
              <button class="ci-ico danger" title="Remove" onclick="UI.remove('${line.uid}')">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('') : `<div class="cart-empty">
        <div class="cart-empty-ico">🧾</div>
        <p>No items yet</p><span>Tap a product to start an order</span>
      </div>`;

    const discountRow = t.manualDiscount > 0
      ? `<div class="tot-row"><span>Discount${t.lineManual > 0 && t.orderManual > 0 ? ' (items + order)' : (t.lineManual > 0 ? ' (items)' : (cart.discount.mode === 'percent' ? ' (' + cart.discount.value + '%)' : ''))}</span><span>−${money(t.manualDiscount)}</span></div>` : '';
    const promoNames = [...new Set(t.lines.filter((l) => l.promo).map((l) => l.promo.name))];
    const promoLabel = promoNames.length === 1 ? promoNames[0] : 'Promotions';
    const promoRow = t.promoDiscount > 0
      ? `<div class="tot-row promo"><span>🏷️ ${esc(promoLabel)}</span><span>−${money(t.promoDiscount)}</span></div>` : '';
    const taxRow = `<div class="tot-row muted"><span>${esc(S.getConfig().taxLabel)} ${(S.getConfig().taxRate * 100).toFixed(0)}%${S.getConfig().taxInclusive ? ' (incl.)' : ''}</span><span>${money(t.tax)}</span></div>`;

    return `
      <div class="cart-head">
        <div class="seg">
          <button class="${cart.orderType === 'dine-in' ? 'on' : ''}" onclick="UI.setType('dine-in')">🍽️ Dine-in</button>
          <button class="${cart.orderType === 'take-away' ? 'on' : ''}" onclick="UI.setType('take-away')">🥡 Take-away</button>
        </div>
        ${held.length ? `<button class="ghost-btn sm" onclick="UI.openHeld()">Suspended · ${held.length}</button>` : ''}
      </div>

      ${memberRow}

      <div class="cart-meta">
        <input class="meta-in" placeholder="Pager number" value="${esc(cart.pager || '')}" onchange="UI.setPager(this.value)">
        <input class="meta-in" placeholder="Order note (optional)" value="${esc(cart.note)}" onchange="UI.setNote(this.value)">
      </div>

      <div class="cart-list">${lines}</div>

      <div class="cart-totals">
        <div class="tot-row"><span>Subtotal (<span id="cart-count" class="cart-count">${t.itemCount}</span> item${t.itemCount !== 1 ? 's' : ''})</span><span>${money(t.gross)}</span></div>
        ${promoRow}${discountRow}${taxRow}
        ${t.roundingAdj ? `<div class="tot-row muted"><span>Rounding</span><span>${money(t.roundingAdj)}</span></div>` : ''}
        <div class="tot-row grand"><span>Total</span><span>${money(t.total)}</span></div>
      </div>

      <div class="cart-foot">
        <div class="cart-foot-row">
          <button class="ghost-btn" ${cart.lines.length ? '' : 'disabled'} onclick="UI.openDiscount()">% Discount</button>
          <button class="ghost-btn" ${cart.lines.length ? '' : 'disabled'} onclick="UI.hold()">⏸ Suspend</button>
          <button class="ghost-btn danger" ${cart.lines.length ? '' : 'disabled'} onclick="UI.clear()">Clear</button>
        </div>
        <button class="charge-btn" ${cart.lines.length ? '' : 'disabled'} onclick="UI.openPayment()">
          <span>Charge</span><span class="charge-amt">${money(t.total)}</span>
        </button>
      </div>`;
  }

  /* ---- POS interactions -------------------------------------------------- */
  function setCategory(id) { ui.category = id; ui.search = ''; render(); }
  function setDrinkSub(id) { ui.drinkSub = id; render(); }
  function onSearch(v) {
    ui.search = v;
    // Update only the grid + clear button so the search field keeps focus.
    const grid = $('#menu-grid'); if (grid) grid.innerHTML = renderGrid();
    const clr = $('#search-clear'); if (clr) clr.style.display = v ? '' : 'none';
    const sh = $('#sec-head'); if (sh) sh.style.display = v ? 'none' : '';
  }
  function clearSearch() {
    ui.search = '';
    const s = $('#search'); if (s) { s.value = ''; s.focus(); }
    onSearch('');
  }
  function addItem(id, event) {
    const item = S.findItem(id);
    if (!item) return;
    if (item.isCombo) return openCombo(item);
    animateTap(event);
    S.addItem(id);
    flashCart();
    toast(item.name + ' added');
  }
  function animateTap(event) {
    const card = event && event.currentTarget && event.currentTarget.classList.contains('m-card') ? event.currentTarget : null;
    if (!card) return;
    card.classList.remove('tap-pop');
    void card.offsetWidth;
    card.classList.add('tap-pop');
    setTimeout(() => card.classList.remove('tap-pop'), 260);
  }
  function flashCart() {
    requestAnimationFrame(() => {
      const cart = $('#pos-cart');
      if (cart) {
        cart.classList.remove('cart-flash');
        void cart.offsetWidth;
        cart.classList.add('cart-flash');
        setTimeout(() => cart.classList.remove('cart-flash'), 520);
      }
      const count = $('#cart-count');
      if (count) {
        count.classList.remove('count-pulse');
        void count.offsetWidth;
        count.classList.add('count-pulse');
        setTimeout(() => count.classList.remove('count-pulse'), 520);
      }
    });
  }
  let soldSwipe = null;
  function soldSwipeStart(event, id) {
    event.preventDefault();
    event.stopPropagation();
    const item = S.findItem(id);
    if (!item) return;
    const el = event.currentTarget;
    const knob = el.querySelector('.sold-slider-knob');
    const thumb = el.parentNode;
    const max = Math.max(88, (thumb ? thumb.clientWidth : 220) - 64);
    soldSwipe = { id, el, knob, start: event.clientX, max, dx: 0, armed: false };
    el.classList.add('dragging');
    if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
    document.addEventListener('pointermove', soldSwipeMove);
    document.addEventListener('pointerup', soldSwipeEnd, { once: true });
    document.addEventListener('pointercancel', soldSwipeEnd, { once: true });
  }
  function soldSwipeMove(event) {
    if (!soldSwipe) return;
    const dx = Math.max(0, Math.min(soldSwipe.max, event.clientX - soldSwipe.start));
    soldSwipe.dx = dx;
    soldSwipe.armed = dx >= soldSwipe.max * 0.7;
    soldSwipe.el.style.setProperty('--sold-dx', dx.toFixed(0) + 'px');
    soldSwipe.el.classList.toggle('armed', soldSwipe.armed);
    if (soldSwipe.knob) soldSwipe.knob.style.transform = `translateX(${dx}px)`;
  }
  function soldSwipeEnd() {
    if (!soldSwipe) return;
    const s = soldSwipe;
    document.removeEventListener('pointermove', soldSwipeMove);
    document.removeEventListener('pointerup', soldSwipeEnd);
    document.removeEventListener('pointercancel', soldSwipeEnd);
    s.el.classList.remove('dragging', 'armed');
    s.el.style.removeProperty('--sold-dx');
    if (s.knob) s.knob.style.transform = '';
    soldSwipe = null;
    if (!s.armed) return;
    const item = S.findItem(s.id);
    if (!item) return;
    requireAdmin(() => {
      S.toggleAvailability(s.id);
      refreshGrid();
      toast(item.available === false ? item.name + ' marked sold out' : item.name + ' available');
    }, 'Manager PIN to change sold-out status');
  }
  function itemCardKey(event, id) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    addItem(id, event);
  }
  const inc = (uid, d) => S.incQty(uid, d);
  const setQty = (uid, n) => S.setQty(uid, n);
  const remove = (uid) => S.removeLine(uid);
  const setType = (t) => { S.setOrderType(t); refreshGrid(); };  // grid reflects take-away-only blocking
  const setTable = (v) => S.setTable(v);
  const setCustomer = (v) => S.setCustomer(v);
  const setPager = (v) => S.setPager(v);
  const setNote = (v) => S.setCartNote(v);
  const hold = () => { S.holdOrder(); toast('Order suspended'); };
  function clear() {
    confirmModal('Clear order?', 'All items in the current ticket will be removed.', () => { ui.counterMember = null; S.clearCart(); });
  }

  /* ---- counter loyalty member (scan at checkout) ------------------------- */
  function openMemberScan() {
    const members = S.getMembers();
    openModal(modalShell('⭐ Loyalty member', `
      <div class="member-scan">
        <p class="hint">Scan the membership card or type a code / phone number. Points are earned automatically on payment, and the customer's name shows on the customer display.</p>
        <input id="member-code" class="big-input" placeholder="MCQ1001 or phone…" autocomplete="off"
          onkeydown="if(event.key==='Enter'){UI.memberScanLookup();}">
        <button class="solid-btn full" onclick="UI.memberScanLookup()">Look up member</button>
        ${members.length ? `<div class="member-quick">
          ${members.slice(0, 6).map((m) => `<button class="chip-btn" onclick="UI.attachCounterMember('${esc(m.code)}')">${esc(m.name)} · ${esc(m.code)}</button>`).join('')}
        </div>` : ''}
      </div>`, { size: 'sm' }));
    setTimeout(() => { const el = $('#member-code'); if (el && !KBD_TOUCH) el.focus(); }, 60);
  }
  function memberScanLookup() { const el = $('#member-code'); attachCounterMember(el ? el.value : ''); }
  function attachCounterMember(code) {
    const m = S.findMember(code);
    if (!m) return toast('Membership not found — check the code');
    ui.counterMember = m;
    closeModal();
    refreshCart();
    toast('⭐ ' + String(m.name).split(' ')[0] + ' added · ' + (m.points || 0) + ' pts');
    if (payState) renderPaymentModal();   // reflect on an open checkout
    broadcastLive();
  }
  function clearCounterMember() {
    ui.counterMember = null;
    refreshCart();
    if (payState) renderPaymentModal();
    broadcastLive();
  }

  /* ====================================================================== *
   * CASHIER PROMOTIONS PANEL
   * ====================================================================== */
  function openPromoInfo() {
    const cats = S.getCategories();
    const catName = (id) => { const c = cats.find((x) => x.id === id); return c ? c.name : id; };
    const groups = { active: [], scheduled: [], expired: [], disabled: [] };
    S.getPromotions().forEach((p) => groups[S.promotionStatus(p)].push(p));

    const card = (p, status) => `<div class="promo-info ${status}">
      <div class="pi-top"><span class="pi-name">${esc(p.name)}</span><span class="pi-badge ${status}">${cap(status)}</span></div>
      <div class="pi-detail">${p.percent}% off <b>${esc(catName(p.category))}</b>${p.excludeCombos ? ' · excl. combos' : ''}${(p.excludeItemIds && p.excludeItemIds.length) ? ' · ' + p.excludeItemIds.length + ' item(s) excluded' : ''}</div>
      <div class="pi-dates">📅 ${esc(promoValidity(p))}</div>
      ${p.note ? `<div class="pi-note">📣 ${esc(p.note)}</div>` : ''}
    </div>`;
    const section = (title, arr, status) => arr.length ? `<div class="pi-section"><h4>${title}</h4>${arr.map((p) => card(p, status)).join('')}</div>` : '';

    const any = groups.active.length || groups.scheduled.length || groups.expired.length || groups.disabled.length;
    const body = any
      ? `${section('🟢 Active now — apply these', groups.active, 'active')}
         ${section('🟡 Scheduled — not yet started', groups.scheduled, 'scheduled')}
         ${section('⚪ Expired — do NOT apply', groups.expired, 'expired')}
         ${section('⚫ Disabled', groups.disabled, 'disabled')}`
      : '<p class="confirm-msg">No promotions configured yet.</p>';

    openModal(modalShell('🏷️ Promotions — cashier guide', body, {
      size: 'md',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Close</button>
        <button class="solid-btn" onclick="UI.gotoPromos()">Manage promotions</button>`
    }));
  }
  function gotoPromos() {
    closeModal();
    requireAdmin(() => { ui.view = 'menu'; ui.menuTab = 'promos'; renderTopbar(); render(); }, 'Manager PIN to manage promotions');
  }

  /* ====================================================================== *
   * MODALS — generic
   * ====================================================================== */
  function openModal(html) {
    const root = $('#modal-root');
    // If a modal is already open, this is a content refresh — suppress the
    // entrance animation so it doesn't flash like a page reload.
    root.classList.toggle('reopen', root.classList.contains('show'));
    root.innerHTML = html;
    root.classList.add('show');
  }
  function closeModal() {
    const root = $('#modal-root');
    root.classList.remove('show', 'reopen'); root.innerHTML = '';
    // Abandoning a checkout clears the live guest screen; completing it leaves the
    // 'done' thank-you broadcast in place (completeSale set it before closing).
    if (payState && S.getLive().mode === 'pay') S.clearLive();
    payState = null;     // stops any in-flight EFTPOS timer from re-opening the modal
    cardFlowTok = null;  // stops a refund/credit card animation from re-opening
  }
  function modalShell(title, body, opts = {}) {
    return `
      <div class="overlay" onclick="UI.closeModal()">
        <div class="modal ${opts.size || ''} ${opts.paper ? 'paper-modal' : ''}" onclick="event.stopPropagation()">
          <div class="modal-head">
            <h3>${title}</h3>
            <button class="x" onclick="UI.closeModal()">✕</button>
          </div>
          <div class="modal-body">${body}</div>
          ${opts.foot ? `<div class="modal-foot">${opts.foot}</div>` : ''}
        </div>
      </div>`;
  }
  function confirmModal(title, msg, onYes) {
    confirmCb = onYes;
    openModal(modalShell(esc(title), `<p class="confirm-msg">${esc(msg)}</p>`, {
      size: 'sm',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
             <button class="solid-btn danger" onclick="UI.confirmYes()">Confirm</button>`
    }));
  }
  let confirmCb = null;
  function confirmYes() { if (confirmCb) confirmCb(); confirmCb = null; closeModal(); }

  /* ====================================================================== *
   * CUSTOMIZE  (Add-ons + Preferences + Note)
   * ====================================================================== */
  let custState = null;
  function openCustomize(uid) {
    const line = S.getCart().lines.find((l) => l.uid === uid);
    if (!line) return;
    const item = S.findItem(line.itemId) || { id: line.itemId, cat: line.cat, name: line.name, price: line.basePrice };
    custState = {
      uid, item,
      basePrice: line.basePrice != null ? line.basePrice : (item.price || 0),
      addons: (line.addons || []).map((a) => ({ ...a })),
      mods: [...(line.mods || [])],
      note: line.note || ''
    };
    renderCustomize();
  }

  function custAddonQty(name, price) {
    const r = custState.addons.find((a) => a.name === name && a.price === price);
    return r ? r.qty : 0;
  }
  function custUnitTotal() {
    return custState.basePrice + custState.addons.reduce((s, a) => s + a.price * a.qty, 0);
  }

  function renderCustomize() {
    const groups = S.groupsForItem(custState.item);
    const priced = groups.filter((g) => !g.free);
    const free = groups.filter((g) => g.free);

    const pricedHtml = priced.map((g) => `
      <div class="cz-group">
        <div class="cz-group-title">${esc(g.name)}</div>
        <div class="cz-rows">
          ${g.options.map((o) => {
            const q = custAddonQty(o.name, o.price);
            return `<div class="cz-row ${q ? 'active' : ''}">
              <div class="cz-opt"><span>${esc(o.name)}</span><span class="cz-price">+${money(o.price)}</span></div>
              <div class="stepper sm">
                <button onclick="UI.custAdd('${esc(o.name)}',${o.price},-1)" ${q ? '' : 'disabled'}>−</button>
                <span>${q}</span>
                <button onclick="UI.custAdd('${esc(o.name)}',${o.price},1)">+</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');

    const freeHtml = free.map((g) => `
      <div class="cz-group">
        <div class="cz-group-title">${esc(g.name)}</div>
        <div class="cz-chips">
          ${g.options.map((o) => `<button class="cz-chip ${custState.mods.includes(o.name) ? 'on' : ''}" onclick="UI.custMod('${esc(o.name)}')">${esc(o.name)}</button>`).join('')}
        </div>
      </div>`).join('');

    openModal(modalShell('Customize · ' + esc(custState.item.name), `
      <div class="cz-wrap">
        ${pricedHtml}
        ${freeHtml}
        <div class="cz-group">
          <div class="cz-group-title">Note for kitchen</div>
          <input id="cz-note" class="meta-in full" placeholder="Anything else… e.g. cut in half, well done"
            value="${esc(custState.note)}" oninput="UI.custNote(this.value)">
        </div>
      </div>`, {
      size: 'md',
      foot: `<div class="cz-total">Item total <b>${money(custUnitTotal())}</b></div>
        <button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
        <button class="solid-btn" onclick="UI.custSave()">Save</button>`
    }));
  }
  function custAdd(name, price, delta) {
    let row = custState.addons.find((a) => a.name === name && a.price === price);
    if (!row) { if (delta < 0) return; row = { name, price, qty: 0 }; custState.addons.push(row); }
    row.qty += delta;
    if (row.qty <= 0) custState.addons = custState.addons.filter((a) => a !== row);
    renderCustomize();
  }
  function custMod(name) {
    const i = custState.mods.indexOf(name);
    if (i >= 0) custState.mods.splice(i, 1); else custState.mods.push(name);
    renderCustomize();
  }
  function custNote(v) { custState.note = v; }   // no re-render — keep focus
  function custSave() {
    S.updateLine(custState.uid, {
      addons: custState.addons,
      mods: custState.mods,
      note: (custState.note || '').trim()
    });
    closeModal();
  }

  /* ---- discount (admin-gated, per-item or whole-order) ------------------- */
  let discDraft = null;
  function openDiscount() {
    if (!S.getCart().lines.length) return;
    requireAdminAlways(() => {   // discounts ALWAYS require a Manager PIN
      const d = S.getCart().discount;
      discDraft = { mode: d.mode !== 'none' ? d.mode : 'percent', value: d.value || 15, target: 'order', selected: new Set() };
      renderDiscountModal();
    }, 'Manager PIN to apply a discount');
  }
  function renderDiscountModal() {
    const cart = S.getCart();
    const cur = S.getConfig().currency;
    const itemsHtml = cart.lines.map((l) => {
      const on = discDraft.selected.has(l.uid);
      const has = l.discount && l.discount.mode !== 'none';
      return `<label class="disc-item ${on ? 'on' : ''}">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="UI.discToggleItem('${l.uid}')">
        <span class="di-name">${esc(l.name)} <em>×${l.qty}</em></span>
        ${has ? `<span class="di-cur">now −${l.discount.mode === 'percent' ? l.discount.value + '%' : money(l.discount.value)}</span>` : ''}
      </label>`;
    }).join('');
    openModal(modalShell('🏷️ Discount', `
      <div class="disc-grid">
        <div class="seg full">
          <button class="${discDraft.mode === 'percent' ? 'on' : ''}" onclick="UI.discMode('percent')">Percent %</button>
          <button class="${discDraft.mode === 'amount' ? 'on' : ''}" onclick="UI.discMode('amount')">Amount ${esc(cur)}</button>
        </div>
        <input id="disc-val" class="big-in" type="number" min="0" step="0.5" value="${discDraft.value || ''}" placeholder="0" oninput="UI.discVal(this.value)">
        <div class="quick-notes">
          ${[5, 10, 15, 20, 50].map((v) => `<button class="chip-btn" onclick="UI.discQuick(${v})">${v}${discDraft.mode === 'percent' ? '%' : ''}</button>`).join('')}
        </div>
        <div class="seg full">
          <button class="${discDraft.target === 'order' ? 'on' : ''}" onclick="UI.discTarget('order')">Whole order</button>
          <button class="${discDraft.target === 'items' ? 'on' : ''}" onclick="UI.discTarget('items')">Selected items</button>
        </div>
        ${discDraft.target === 'items'
          ? `<div class="disc-items">${itemsHtml}</div><p class="hint">Tick the items to discount, e.g. 15% off just the Bánh Mì.</p>`
          : '<p class="hint">Applies to the whole order, after the automatic promotion.</p>'}
      </div>`, {
      foot: `<button class="ghost-btn danger" onclick="UI.discRemoveAll()">Remove all</button>
             <button class="solid-btn" onclick="UI.discApply()">Apply</button>`
    }));
  }
  function discMode(m) { discDraft.mode = m; renderDiscountModal(); }
  function discTarget(t) { discDraft.target = t; renderDiscountModal(); }
  function discVal(v) { discDraft.value = parseFloat(v) || 0; }   // no re-render (keep focus)
  function discQuick(v) { discDraft.value = v; renderDiscountModal(); }
  function discToggleItem(uid) {
    if (discDraft.selected.has(uid)) discDraft.selected.delete(uid); else discDraft.selected.add(uid);
    renderDiscountModal();
  }
  function discApply() {
    const val = discDraft.value || 0;
    if (val <= 0) return toast('Enter a discount value');
    if (discDraft.target === 'order') { S.setDiscount(discDraft.mode, val); }
    else {
      if (!discDraft.selected.size) return toast('Select at least one item');
      S.setLineDiscount([...discDraft.selected], discDraft.mode, val);
    }
    closeModal(); toast('Discount applied');
  }
  function discRemoveAll() { S.clearAllDiscounts(); closeModal(); toast('Discounts removed'); }

  /* ====================================================================== *
   * COMBO BUILDER
   * ====================================================================== */
  let comboState = null;
  function openCombo(item) {
    comboState = { item, picks: item.combo.slots.map(() => null) };
    renderComboModal();
  }
  function renderComboModal() {
    const { item, picks } = comboState;
    const slots = item.combo.slots.map((slot, i) => {
      const opts = S.getMenu().filter((m) => slot.from.includes(m.cat) && m.available !== false && !m.isCombo);
      return `
        <div class="combo-slot">
          <div class="combo-slot-head"><span>${slot.label}</span>${picks[i] ? `<span class="ok">✓ ${esc(picks[i].name)}</span>` : '<span class="req">Required</span>'}</div>
          <div class="combo-opts">
            ${opts.map((o) => `
              <button class="combo-opt ${picks[i] && picks[i].itemId === o.id ? 'sel' : ''}"
                onclick="UI.comboPick(${i},'${o.id}')">${esc(o.name)}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
    const ready = picks.every((p) => p);
    openModal(modalShell('🎁 ' + esc(item.name), `
      <div class="combo-price-tag">Combo price <strong>${money(item.price)}</strong>
        <span class="combo-note">Bánh Mì 15% promo does not apply to combos.</span></div>
      ${slots}`, {
      size: 'lg',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
             <button class="solid-btn" ${ready ? '' : 'disabled'} onclick="UI.comboConfirm()">Add combo · ${money(item.price)}</button>`
    }));
  }
  function comboPick(slotIdx, itemId) {
    const m = S.findItem(itemId);
    comboState.picks[slotIdx] = { itemId, name: S.displayName(m), slot: comboState.item.combo.slots[slotIdx].label };
    renderComboModal();
  }
  function comboConfirm() {
    const { item, picks } = comboState;
    S.addItem(item.id, { components: picks.map((p) => ({ name: p.name, itemId: p.itemId, slot: p.slot })) });
    flashCart();
    closeModal();
    toast('Combo added');
  }

  /* ====================================================================== *
   * HELD / PARKED ORDERS
   * ====================================================================== */
  function openHeld() {
    const held = S.getHeld();
    const body = held.length ? `<div class="held-list">
      ${held.map((h) => {
        const t = S.computeTotals(h.cart);
        return `<div class="held-card">
          <div class="held-info">
            <strong>${esc(h.label)}</strong>
            <span>${t.itemCount} items · ${money(t.total)} · ${new Date(h.heldAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="held-actions">
            <button class="solid-btn sm" onclick="UI.recall('${h.id}')">Recall</button>
            <button class="ghost-btn sm danger" onclick="UI.voidHeld('${h.id}')">Void</button>
          </div>
        </div>`; }).join('')}
    </div>` : `<p class="confirm-msg">No suspended tickets.</p>`;
    openModal(modalShell('⏸ Suspended tickets', body, { size: 'md' }));
  }
  function recall(id) { S.recallHeld(id); closeModal(); ui.view = 'register'; renderTopbar(); render(); }
  function delHeld(id) { S.deleteHeld(id); openHeld(); }
  // Void a suspended ticket — requires a Manager.
  function voidHeld(id) {
    requireAdmin(() => {
      S.deleteHeld(id);
      toast('Suspended ticket voided');
      if (ui.view === 'orders') render(); else openHeld();
    }, 'Manager PIN to void a suspended ticket');
  }

  /* ====================================================================== *
   * PAYMENT
   * ====================================================================== */
  let payState = null;
  let liveDoneTimer = null;
  function openPayment() {
    const cart = S.getCart();
    if (!cart.lines.length) return;
    clearTimeout(liveDoneTimer);
    const t = S.computeTotals(cart);
    payState = {
      total: t.total,
      cashTotal: t.cashTotal != null ? t.cashTotal : t.total,
      cashRoundingAdj: t.cashRoundingAdj || 0,
      tenders: [],
      method: 'cash',
      cashInput: ''
    };
    renderPaymentModal();
  }
  function paymentDueTotal() {
    const hasCashTender = payState.tenders.some((p) => p.method === 'cash');
    const hasNonCashTender = payState.tenders.some((p) => p.method !== 'cash');
    if (hasNonCashTender || (hasCashTender && payState.method !== 'cash')) return payState.total;
    if (hasCashTender || payState.method === 'cash') return payState.cashTotal;
    return payState.total;
  }
  function paymentRoundingActive(dueTotal) {
    return payState.cashRoundingAdj && Math.abs(dueTotal - payState.total) > 0.0001;
  }
  // Mirror the live checkout to the customer-facing second screen.
  function broadcastLive() {
    if (!payState) return;
    const dueTotal = paymentDueTotal();
    const paid = payState.tenders.reduce((s, p) => s + p.amount, 0);
    const cm = ui.counterMember;
    S.setLive({
      mode: 'pay',
      total: dueTotal,
      rounding: paymentRoundingActive(dueTotal) ? payState.cashRoundingAdj : 0,
      tenders: payState.tenders.map((p) => ({ method: p.method, amount: p.amount })),
      paid: S.round2(paid),
      remaining: S.round2(Math.max(0, dueTotal - paid)),
      change: S.round2(Math.max(0, paid - dueTotal)),
      settled: paid >= dueTotal - 0.0001,
      method: payState.method,
      cashEntry: payState.cashInput ? (parseFloat(payState.cashInput) || 0) : null,
      cardStage: payState.cardStage || null,
      cardAmount: payState.cardStage ? (payState.cardAmount || 0) : null,
      member: cm ? { name: cm.name, code: cm.code, points: cm.points || 0 } : null
    });
  }
  function renderPaymentModal() {
    const cfg = S.getConfig();
    const cart = S.getCart();
    const t = S.computeTotals(cart);
    const dueTotal = paymentDueTotal();
    const paid = payState.tenders.reduce((s, p) => s + p.amount, 0);
    const remaining = S.round2(Math.max(0, dueTotal - paid));
    const change = S.round2(Math.max(0, paid - dueTotal));
    const settled = paid >= dueTotal - 0.0001;
    const cm = ui.counterMember;

    // --- left: live order recap so the cashier & guest see what's being paid ---
    const recapLines = t.lines.map((l) => `
      <div class="pr-line">
        <span class="pr-q">${l.qty}×</span>
        <span class="pr-n">${esc(l.name)}${(l.addons && l.addons.length) ? `<em>+ ${l.addons.map((a) => esc(a.name)).join(', ')}</em>` : ''}</span>
        <span class="pr-a">${money(l.lineNet)}</span>
      </div>`).join('');
    const estPts = Math.max(0, Math.floor(dueTotal * (cfg.pointsPerDollar || 1)));
    const recapMember = cm
      ? `<div class="pr-member">⭐ <b>${esc(cm.name)}</b> · ${cm.points || 0} pts <span>earns +${estPts}</span></div>`
      : `<button class="pr-addmember" onclick="UI.openMemberScan()">⭐ Add loyalty member</button>`;

    // --- right: tender pads (cash keypad / EFTPOS / other) ---
    const denoms = [5, 10, 20, 50, 100];
    const cashPad = `
      <div class="pay-cash">
        <div id="cash-display" class="cash-display">${cfg.currency}${(payState.cashInput || '0')}</div>
        <div class="quick-cash">
          <button class="chip-btn accent" onclick="UI.payExact()">Exact ${money(remaining)}</button>
          ${denoms.map((d) => `<button class="chip-btn" onclick="UI.payAddCash(${d})">${cfg.currency}${d}</button>`).join('')}
        </div>
        <div class="keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) =>
            `<button onclick="UI.payKey('${k}')">${k}</button>`).join('')}
        </div>
        <button class="solid-btn full" onclick="UI.payTenderCash()">Add cash tender</button>
      </div>`;

    const otherPad = `
      <div class="pay-other">
        <p class="hint">Bank transfer, voucher or any other tender.</p>
        <button class="solid-btn full" onclick="UI.payTenderFull('other')">
          Charge ${money(remaining)} to Other
        </button>
      </div>`;

    const cardPad = renderCardPad(remaining);

    const tendersList = payState.tenders.length ? `<div class="tender-list">
      ${payState.tenders.map((p, i) => `<div class="tender-row">
        <span>${p.method === 'cash' ? '💵' : p.method === 'card' ? '💳' : '🏦'} ${cap(p.method)}</span>
        <span>${money(p.amount)} <button class="mini-x" onclick="UI.payRemove(${i})">✕</button></span>
      </div>`).join('')}
    </div>` : '';
    const roundingRow = paymentRoundingActive(dueTotal)
      ? `<div class="tender-row muted"><span>Cash rounding</span><span>${money(payState.cashRoundingAdj)}</span></div>` : '';

    openModal(modalShell('💳 Checkout', `
      <div class="pay2">
        <aside class="pay2-recap">
          <div class="pay2-recap-head">
            <span>🧾 Order · ${t.itemCount} item${t.itemCount !== 1 ? 's' : ''}</span>
            <span class="pay2-type">${cart.orderType === 'dine-in' ? '🍽️ Dine-in' : '🥡 Take-away'}${cart.pager ? ' · #' + esc(cart.pager) : ''}</span>
          </div>
          <div class="pay2-recap-list">${recapLines}</div>
          ${recapMember}
        </aside>

        <section class="pay2-money">
          <div class="pay2-due">
            <span>Total due</span><strong>${money(dueTotal)}</strong>
          </div>
          ${tendersList}${roundingRow}
          <div class="pay2-stat">
            <div class="received"><span>Tendered</span><b>${money(paid)}</b></div>
            <div class="${change > 0 ? 'change' : 'remain'}">
              <span>${change > 0 ? '💸 Change due' : 'Remaining'}</span>
              <b>${money(change > 0 ? change : remaining)}</b>
            </div>
          </div>
          <button class="complete-btn" ${settled ? '' : 'disabled'} onclick="UI.completeSale()">
            ✓ Complete sale · ${money(dueTotal)}
          </button>
        </section>

        <section class="pay2-method">
          <div class="seg full">
            <button class="${payState.method === 'cash' ? 'on' : ''}" onclick="UI.payMethod('cash')">💵 Cash</button>
            <button class="${payState.method === 'card' ? 'on' : ''}" onclick="UI.payMethod('card')">💳 Card</button>
            <button class="${payState.method === 'other' ? 'on' : ''}" onclick="UI.payMethod('other')">🏦 Other</button>
          </div>
          ${payState.method === 'cash' ? cashPad : (payState.method === 'card' ? cardPad : otherPad)}
        </section>
      </div>`, { size: 'xl' }));
    broadcastLive();
  }

  // EFTPOS terminal simulation — the amount is "pushed" to the card machine.
  // Supports SPLIT payments: charge part of the bill to card, settle the rest
  // with cash / other. The amount field is editable (defaults to remaining).
  function renderCardPad(remaining) {
    const cfg = S.getConfig();
    if (remaining <= 0) return `<div class="pay-other"><p class="hint">Balance fully tendered. Press <b>Complete sale</b>.</p></div>`;
    const stage = payState.cardStage;
    if (stage === 'waiting') return `
      <div class="eftpos">
        <div class="eftpos-screen waiting">
          <div class="eftpos-brand">EFTPOS</div>
          <div class="eftpos-amt">${money(payState.cardAmount)}</div>
          <div class="eftpos-status"><span class="eftpos-spin"></span> Tap, insert or swipe card…</div>
          <div class="eftpos-card">💳</div>
        </div>
        <button class="ghost-btn full" onclick="UI.payCardCancel()">Cancel transaction</button>
      </div>`;
    if (stage === 'approved') return `
      <div class="eftpos">
        <div class="eftpos-screen approved">
          <div class="eftpos-check">✓</div>
          <div class="eftpos-amt">${money(payState.cardAmount)}</div>
          <div class="eftpos-status">APPROVED</div>
        </div>
      </div>`;
    const half = S.round2(remaining / 2);
    return `
      <div class="eftpos">
        <div class="eftpos-screen idle">
          <div class="eftpos-brand">EFTPOS terminal</div>
          <div class="eftpos-amt-wrap">
            <span class="eftpos-cur">${esc(cfg.currency)}</span>
            <input id="card-amt" class="eftpos-amt-in" type="number" min="0" max="${remaining}" step="0.05" value="${remaining}" onfocus="this.select()">
          </div>
          <div class="eftpos-status">Amount to charge · edit for split</div>
        </div>
        <div class="quick-cash">
          <button class="chip-btn accent" onclick="UI.cardSetAmt(${remaining})">Full ${money(remaining)}</button>
          <button class="chip-btn" onclick="UI.cardSetAmt(${half})">Half ${money(half)}</button>
        </div>
        <button class="solid-btn full eftpos-send" onclick="UI.payCardSend()">📟 Send to terminal</button>
        <p class="hint">Charge part of the bill to card and settle the rest with cash / other — true split payments.</p>
      </div>`;
  }
  function cardSetAmt(v) { const el = document.getElementById('card-amt'); if (el) el.value = v; }
  function payCardSend() {
    const paid = payState.tenders.reduce((s, p) => s + p.amount, 0);
    const remaining = S.round2(Math.max(0, paymentDueTotal() - paid));
    if (remaining <= 0) return;
    const el = document.getElementById('card-amt');
    let amt = el ? (parseFloat(el.value) || 0) : remaining;
    amt = S.round2(Math.min(Math.max(0, amt), remaining));   // never overcharge the card
    if (amt <= 0) return toast('Enter an amount to charge');
    payState.cardAmount = amt;
    payState.cardStage = 'waiting';
    const token = Math.random().toString(36).slice(2);
    payState.cardToken = token;
    renderPaymentModal();
    // simulate the terminal returning an approval
    setTimeout(() => {
      if (!payState || payState.cardToken !== token || payState.cardStage !== 'waiting') return;
      payState.cardStage = 'approved';
      renderPaymentModal();
      setTimeout(() => {
        if (!payState || payState.cardToken !== token) return;
        payState.tenders.push({ method: 'card', amount: payState.cardAmount });
        payState.cardStage = null;
        payState.cardToken = null;
        renderPaymentModal();
        toast('Card approved · ' + money(payState.cardAmount));
      }, 950);
    }, 2200);
  }
  function payCardCancel() { payState.cardStage = null; payState.cardToken = null; renderPaymentModal(); }

  function payMethod(m) { payState.method = m; payState.cashInput = ''; payState.cardStage = null; payState.cardToken = null; renderPaymentModal(); }
  // Surgical — only the cash display changes while keying in an amount, but the
  // guest's second screen is updated live so they watch their cash being entered.
  function syncCashDisplay() {
    const el = $('#cash-display'); if (el) el.textContent = S.getConfig().currency + (payState.cashInput || '0');
    broadcastLive();
  }
  function payKey(k) {
    if (k === '⌫') { payState.cashInput = payState.cashInput.slice(0, -1); }
    else if (k === '.') { if (!payState.cashInput.includes('.')) payState.cashInput += payState.cashInput ? '.' : '0.'; }
    else { payState.cashInput += k; }
    syncCashDisplay();
  }
  function payAddCash(v) {
    payState.cashInput = String((parseFloat(payState.cashInput) || 0) + v);
    syncCashDisplay();
  }
  function payExact() {
    const paid = payState.tenders.reduce((s, p) => s + p.amount, 0);
    payState.cashInput = String(S.round2(Math.max(0, paymentDueTotal() - paid)));
    syncCashDisplay();
  }
  function payTenderCash() {
    const amt = parseFloat(payState.cashInput) || 0;
    if (amt <= 0) return;
    payState.tenders.push({ method: 'cash', amount: S.round2(amt) });
    payState.cashInput = '';
    renderPaymentModal();
  }
  function payTenderFull(method) {
    const paid = payState.tenders.reduce((s, p) => s + p.amount, 0);
    const remaining = S.round2(Math.max(0, paymentDueTotal() - paid));
    if (remaining <= 0) return;
    payState.tenders.push({ method, amount: remaining });
    renderPaymentModal();
  }
  function payRemove(i) { payState.tenders.splice(i, 1); renderPaymentModal(); }
  function completeSale() {
    const cm = ui.counterMember;
    const order = S.completeOrder(payState.tenders, {
      training: S.isTrainingMode(),
      memberId: cm ? cm.id : null
    });
    if (!order) return toast('Payment is not fully tendered');
    // Push a big THANK-YOU (with the member's name) to the guest screen, then
    // auto-return it to the welcome/order screen a few seconds later.
    const change = order.change || 0;
    S.setLive({
      mode: 'done',
      code: order.code,
      pager: order.pager || '',
      orderType: order.orderType,
      total: order.totals.total,
      paid: order.paid,
      change,
      payments: (order.payments || []).map((p) => ({ method: p.method, amount: p.amount })),
      customerName: cm ? cm.name : (order.customer || ''),
      points: order.pointsEarned || 0,
      memberPoints: cm ? (S.findMember(cm.code) || cm).points : null
    });
    ui.counterMember = null;
    closeModal();
    clearTimeout(liveDoneTimer);
    liveDoneTimer = setTimeout(() => S.clearLive(), 9000);
    showReceipt(order, true);
  }

  /* ====================================================================== *
   * RECEIPT
   * ====================================================================== */
  function receiptHTML(order, forPrint) {
    const c = S.getConfig();
    const d = new Date(order.createdAt);
    const lines = order.lines.map((l) => {
      const comps = l.components && l.components.length
        ? `<div class="r-comp">${l.components.map((x) => '+ ' + esc(x.name)).join('<br>')}</div>` : '';
      const addons = l.addons && l.addons.length
        ? `<div class="r-comp">${l.addons.map((a) => `+ ${esc(a.name)}${a.qty > 1 ? ' ×' + a.qty : ''} (${money(a.price * a.qty)})`).join('<br>')}</div>` : '';
      const mods = l.mods && l.mods.length ? `<div class="r-note">${l.mods.map(esc).join(', ')}</div>` : '';
      const note = l.note ? `<div class="r-note">* ${esc(l.note)}</div>` : '';
      const promoLine = l.promoName ? `<div class="r-disc">${esc(l.promoName)} −${money((l.lineDiscount || 0) - (l.lineManual || 0))}</div>` : '';
      const lineDisc = l.lineManual ? `<div class="r-disc">Discount ${l.discount && l.discount.mode === 'percent' ? '(' + l.discount.value + '%)' : ''} −${money(l.lineManual)}</div>` : '';
      return `<div class="r-line">
        <div class="r-line-top"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.lineNet)}</span></div>
        ${comps}${addons}${mods}${note}${promoLine}${lineDisc}
      </div>`;
    }).join('');

    const tot = order.totals;
    const contact = [c.phone, c.abn].filter(Boolean).map(esc).join(' · ');
    return `<div class="receipt">
      <div class="r-head">
        ${c.logo ? `<img class="r-logo" src="${c.logo}" alt="">` : ''}
        <div class="r-store">${esc(c.storeName)}</div>
        <div class="r-tag">${esc(c.tagline)}</div>
        <div class="r-meta">${esc(c.address)}${contact ? '<br>' + contact : ''}</div>
      </div>
      <div class="r-sep"></div>
      ${order.training ? '<div class="r-training">TRAINING RECEIPT · NOT A REAL SALE</div><div class="r-sep"></div>' : ''}
      <div class="r-ordercode">ORDER ${order.code || ('#' + order.id)}</div>
      <div class="r-info">
        <div><span>Type</span><b>${order.orderType === 'dine-in' ? 'Dine-in' : 'Take-away'}${order.pager ? ' · Pager ' + esc(order.pager) : ''}</b></div>
        <div><span>Ref</span><b>#${order.id}</b></div>
        <div><span>Cashier</span><b>${esc(order.cashier)}</b></div>
        <div><span>Date</span><b>${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-lines">${lines}</div>
      ${order.note ? `<div class="r-ordernote">Note: ${esc(order.note)}</div>` : ''}
      <div class="r-sep"></div>
      <div class="r-totals">
        <div class="r-row"><span>Subtotal</span><span>${money(tot.gross)}</span></div>
        ${tot.promoDiscount ? `<div class="r-row"><span>Promotion</span><span>−${money(tot.promoDiscount)}</span></div>` : ''}
        ${tot.manualDiscount ? `<div class="r-row"><span>Discount</span><span>−${money(tot.manualDiscount)}</span></div>` : ''}
        <div class="r-row muted"><span>${esc(c.taxLabel)} ${(c.taxRate * 100).toFixed(0)}%${tot.taxInclusive ? ' (incl.)' : ''}</span><span>${money(tot.tax)}</span></div>
        ${tot.roundingAdj ? `<div class="r-row muted"><span>Rounding</span><span>${money(tot.roundingAdj)}</span></div>` : ''}
        <div class="r-row grand"><span>TOTAL</span><span>${money(tot.total)}</span></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-pay">
        ${order.payments.map((p) => `<div class="r-row"><span>${cap(p.method)}</span><span>${money(p.amount)}</span></div>`).join('')}
        ${order.change ? `<div class="r-row"><span>Change</span><span>${money(order.change)}</span></div>` : ''}
      </div>
      ${(order.refunds && order.refunds.length) ? `
        <div class="r-sep"></div>
        <div class="r-pay">
          <div class="r-row"><b>Refunds</b><b>−${money(order.refundedTotal)}</b></div>
          ${order.refunds.map((rf) => `<div class="r-row muted"><span>${new Date(rf.at).toLocaleDateString()} · ${cap(rf.method)}</span><span>−${money(rf.amount)}</span></div>`).join('')}
          <div class="r-row grand"><span>NET PAID</span><span>${money(order.totals.total - order.refundedTotal)}</span></div>
        </div>` : ''}
      <div class="r-sep"></div>
      <div class="r-foot">${esc(c.receiptFooter)}</div>
      ${order.status === 'voided' ? '<div class="r-void">*** VOIDED ***</div>' : ''}
      ${order.training ? '<div class="r-void training">*** TRAINING ONLY ***</div>' : ''}
      ${order.status === 'refunded' ? '<div class="r-void">*** FULLY REFUNDED ***</div>' : ''}
      ${order.status === 'partial-refund' ? '<div class="r-void partial">*** PARTIALLY REFUNDED ***</div>' : ''}
    </div>`;
  }

  // A dedicated refund voucher (printed when money is returned).
  function refundReceiptHTML(order, rec) {
    const c = S.getConfig();
    const d = new Date(rec.at);
    return `<div class="receipt">
      <div class="r-head">
        <div class="r-store">${esc(c.storeName)}</div>
        <div class="r-tag">Refund Voucher</div>
        <div class="r-meta">${esc(c.address)}<br>${esc(c.phone)}</div>
      </div>
      <div class="r-sep"></div>
      <div class="r-info">
        <div><span>Refund</span><b>${esc(rec.id)}</b></div>
        <div><span>Order</span><b>#${order.id}</b></div>
        <div><span>Cashier</span><b>${esc(rec.by)}</b></div>
        <div><span>Date</span><b>${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-lines">
        ${rec.items.map((it) => `<div class="r-line"><div class="r-line-top"><span>${it.qty} × ${esc(it.name)}</span><span>−${money(it.amount)}</span></div></div>`).join('')}
      </div>
      ${rec.reason ? `<div class="r-ordernote">Reason: ${esc(rec.reason)}</div>` : ''}
      <div class="r-sep"></div>
      <div class="r-totals">
        <div class="r-row grand"><span>REFUNDED (${cap(rec.method)})</span><span>−${money(rec.amount)}</span></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-foot">Refund processed. Thank you.</div>
    </div>`;
  }

  function showReceipt(order, fresh) {
    const canRefund = !order.training && (order.status === 'paid' || order.status === 'partial-refund');
    const refundBtn = (!fresh && canRefund)
      ? `<button class="ghost-btn danger" onclick="UI.openRefund(${order.id})">↩ Refund</button>` : '';
    openModal(modalShell(order.training ? '🎓 Training receipt' : (fresh ? '✓ Sale complete' : 'Receipt #' + order.id), `
      <div class="receipt-frame">${receiptHTML(order)}</div>`, {
      size: 'sm',
      paper: true,
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">${fresh ? 'New order' : 'Close'}</button>
        ${refundBtn}
        <button class="solid-btn" onclick="UI.printReceipt(${order.id})">🖨 Print</button>`
    }));
  }
  function printReceipt(orderId) {
    const order = S.findOrder(orderId);
    if (!order) return;
    $('#print-area').innerHTML = receiptHTML(order, true);
    window.print();
    toast('Receipt #' + order.id + ' sent to printer');
  }
  function printRefund(order, rec) {
    $('#print-area').innerHTML = refundReceiptHTML(order, rec);
    window.print();
  }
  // Topbar quick action — reprint the most recent (non-voided) sale.
  function reprintLast() {
    const o = S.lastOrder();
    if (!o) return toast('No sales yet to reprint');
    showReceipt(o, false);
  }

  /* ====================================================================== *
   * ORDERS / HISTORY
   * ====================================================================== */
  function renderOrders() {
    const day = ui.historyDay;
    const searching = !!ui.orderQuery;
    const all = searching ? S.searchOrders(ui.orderQuery)
      : S.getOrders().filter((o) => !day || S.dayKey(o.createdAt) === day);

    const statusLabel = { 'paid': 'Paid', 'partial-refund': 'Part. refund', 'refunded': 'Refunded', 'voided': 'Voided' };

    const rows = all.length ? all.map((o) => {
      const d = new Date(o.createdAt);
      const methods = [...new Set(o.payments.map((p) => p.method))].map(cap).join(', ');
      const refunded = o.refundedTotal || 0;
      const net = o.totals.total - refunded;
      const canRefund = !o.training && (o.status === 'paid' || o.status === 'partial-refund');
      const statusText = o.training ? 'Training' : (statusLabel[o.status] || cap(o.status));
      const statusCls = o.training ? 'training' : o.status;
      return `<tr class="${o.status === 'voided' ? 'voided' : ''} ${o.training ? 'training' : ''}">
        <td><b>${o.code || ('#' + o.id)}</b><span class="row-sub">#${o.id}</span></td>
        <td>${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${o.orderType === 'dine-in' ? '🍽️ Dine-in' : '🥡 Take-away'}${o.pager ? ' · P' + esc(o.pager) : ''}</td>
        <td>${o.totals.itemCount}</td>
        <td>${esc(methods)}</td>
        <td class="num">${refunded ? `<span class="num-refunded">−${money(refunded)}</span> ` : ''}<b>${money(net)}</b></td>
        <td><span class="status ${statusCls}">${statusText}</span></td>
        <td class="actions">
          <button class="mini-btn" title="Reprint" onclick="UI.printReceipt(${o.id})">🖨</button>
          <button class="mini-btn" onclick="UI.viewReceipt(${o.id})">Receipt</button>
          ${canRefund ? `<button class="mini-btn warn" onclick="UI.openRefund(${o.id})">Refund</button>` : ''}
        </td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty-cell">${searching ? 'No orders match “' + esc(ui.orderQuery) + '”.' : 'No orders for this day.'}</td></tr>`;

    const realOrders = all.filter((o) => !o.training && o.status !== 'voided');
    const dayTotal = realOrders.reduce((s, o) => s + (o.totals.total - (o.refundedTotal || 0)), 0);
    const refTotal = realOrders.reduce((s, o) => s + (o.refundedTotal || 0), 0);
    const trainingCount = all.filter((o) => o.training).length;

    return `
      <div class="page">
        <div class="page-head">
          <div class="page-title">${adminBack()}<h2>Transaction History</h2></div>
          <div class="page-tools">
            <div class="lookup">
              <span class="search-ico">🔎</span>
              <input id="order-search" type="text" placeholder="Lookup code, amount, time, pager…"
                value="${esc(ui.orderQuery)}" oninput="UI.onOrderSearch(this.value)" autocomplete="off">
              ${searching ? `<button class="search-clear" onclick="UI.clearOrderSearch()">✕</button>` : ''}
            </div>
            <button class="ghost-btn sm" onclick="UI.reprintLast()">🖨 Reprint last</button>
            <input type="date" class="date-in" value="${day}" ${searching ? 'disabled' : ''} onchange="UI.setHistoryDay(this.value)">
          </div>
        </div>
        <div class="orders-summary">
          <div class="pill">${searching ? 'Results' : 'Day'} takings: <b>${money(dayTotal)}</b></div>
          ${refTotal ? `<div class="pill warn">Refunds: <b>−${money(refTotal)}</b></div>` : ''}
          <div class="pill">Orders: <b>${realOrders.length}</b></div>
          ${trainingCount ? `<div class="pill training">Training: <b>${trainingCount}</b></div>` : ''}
        </div>
        ${renderSuspendedSection()}
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Order</th><th>Date / time</th><th>Type</th><th>Items</th><th>Payment</th><th class="num">Net total</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }
  function renderSuspendedSection() {
    const held = S.getHeld();
    if (!held.length) return '';
    const rows = held.map((h) => {
      const t = S.computeTotals(h.cart);
      return `<tr>
        <td><b>⏸ ${esc(h.label)}</b></td>
        <td>${new Date(h.heldAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${new Date(h.heldAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${h.cart.orderType === 'dine-in' ? '🍽️ Dine-in' : '🥡 Take-away'}</td>
        <td>${t.itemCount}</td>
        <td class="num"><b>${money(t.total)}</b></td>
        <td class="actions">
          <button class="mini-btn" onclick="UI.recall('${h.id}')">Recall</button>
          <button class="mini-btn danger" onclick="UI.voidHeld('${h.id}')">Void</button>
        </td>
      </tr>`;
    }).join('');
    return `<div class="suspend-block">
      <h3 class="suspend-title">⏸ Suspended tickets <span class="pill">${held.length}</span></h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Ticket</th><th>Suspended at</th><th>Type</th><th>Items</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }
  function setHistoryDay(v) { ui.historyDay = v; render(); }
  function onOrderSearch(v) { ui.orderQuery = v; render(); }
  function clearOrderSearch() { ui.orderQuery = ''; render(); }
  function viewReceipt(id) { const o = S.findOrder(id); if (o) showReceipt(o, false); }

  /* ====================================================================== *
   * CREDIT / GOODWILL REFUND (no linked receipt)
   * ====================================================================== */
  let creditDraft = null;
  function openCredit() {
    creditDraft = { amount: '', method: 'cash', description: '' };
    renderCreditModal();
  }
  function renderCreditModal() {
    const cur = S.getConfig().currency;
    openModal(modalShell('💸 Credit / Goodwill Refund', `
      <p class="hint">Use when a customer deserves a refund but neither side can find the receipt (e.g. quality complaint). This pays out of the till and is logged for the Z report.</p>
      <div class="form">
        <label>Reason / description
          <input id="cr-desc" value="${esc(creditDraft.description)}" placeholder="e.g. Customer felt unwell — manager approved" oninput="UI.creditSet('description',this.value)">
        </label>
        <label>Refund amount
          <div class="cr-amt"><span>${esc(cur)}</span><input id="cr-amt" type="number" min="0" step="0.5" value="${creditDraft.amount}" placeholder="0.00" oninput="UI.creditSet('amount',this.value)"></div>
        </label>
        <label>Pay back via</label>
        <div class="seg full">
          <button class="${creditDraft.method === 'cash' ? 'on' : ''}" onclick="UI.creditMethod('cash')">💵 Cash</button>
          <button class="${creditDraft.method === 'card' ? 'on' : ''}" onclick="UI.creditMethod('card')">💳 Card</button>
          <button class="${creditDraft.method === 'other' ? 'on' : ''}" onclick="UI.creditMethod('other')">🏦 Other</button>
        </div>
      </div>`, {
      size: 'md',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
        <button class="solid-btn danger" onclick="UI.creditConfirm()">Issue credit</button>`
    }));
  }
  function creditSet(f, v) { creditDraft[f] = v; }
  function creditMethod(m) { creditDraft.method = m; renderCreditModal(); }
  function creditConfirm() {
    const amt = parseFloat(creditDraft.amount) || 0;
    if (amt <= 0) return toast('Enter an amount');
    if (!creditDraft.description.trim()) return toast('A reason is required');
    const method = creditDraft.method;
    const rec = S.addCredit({ amount: amt, method, description: creditDraft.description.trim() });
    closeModal();
    if (!rec) return;
    const showVoucher = () => {
      openModal(modalShell('💸 Credit issued', `<div class="receipt-frame">${creditReceiptHTML(rec)}</div>`, {
        size: 'sm',
        paper: true,
        foot: `<button class="ghost-btn" onclick="UI.closeModal()">Done</button>
          <button class="solid-btn" onclick="UI.printCredit('${rec.id}')">🖨 Print voucher</button>`
      }));
      toast('Credit ' + money(rec.amount) + ' issued');
    };
    if (method === 'card') cardFlow(rec.amount, 'Credit', showVoucher); else showVoucher();
  }
  function creditReceiptHTML(rec) {
    const c = S.getConfig();
    const d = new Date(rec.at);
    return `<div class="receipt">
      <div class="r-head">${c.logo ? `<img class="r-logo" src="${c.logo}">` : ''}<div class="r-store">${esc(c.storeName)}</div><div class="r-tag">Credit Voucher</div></div>
      <div class="r-sep"></div>
      <div class="r-info"><div><span>Credit</span><b>${esc(rec.id)}</b></div><div><span>Cashier</span><b>${esc(rec.by)}</b></div>
        <div><span>Method</span><b>${cap(rec.method)}</b></div><div><span>Date</span><b>${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b></div></div>
      <div class="r-sep"></div>
      <div class="r-ordernote">${esc(rec.description)}</div>
      <div class="r-sep"></div>
      <div class="r-totals"><div class="r-row grand"><span>CREDIT (${cap(rec.method)})</span><span>−${money(rec.amount)}</span></div></div>
      <div class="r-sep"></div><div class="r-foot">Goodwill credit. Manager approved.</div>
    </div>`;
  }
  function printCredit(id) {
    const rec = S.getCredits().find((c) => c.id === id);
    if (rec) { $('#print-area').innerHTML = creditReceiptHTML(rec); window.print(); }
  }

  /* ====================================================================== *
   * REFUND / RETURN
   * ====================================================================== */
  let refundState = null;
  function openRefund(id) {
    const o = S.findOrder(id);
    if (!o) return;
    requireAdmin(() => {   // refund needs a Manager
      refundState = { order: o, picks: {}, reason: '', method: 'cash' };
      renderRefundModal();
    }, 'Manager PIN to refund');
  }
  function renderRefundModal() {
    const o = refundState.order;
    const rows = o.lines.map((l, i) => {
      const remaining = S.refundableQty(o, i);
      const picked = refundState.picks[i] || 0;
      const perUnit = l.lineNet / l.qty;
      if (remaining <= 0 && (l.refundedQty || 0) > 0) {
        return `<div class="rf-row done"><div class="rf-name">${esc(l.name)} <span class="rf-tag">returned</span></div>
          <div class="rf-amt">${money(perUnit * l.qty)}</div></div>`;
      }
      return `<div class="rf-row">
        <div class="rf-name">${esc(l.name)}<span class="rf-sub">${money(perUnit)} ea · ${remaining} returnable</span></div>
        <div class="stepper sm">
          <button onclick="UI.refundPick(${i},-1)" ${picked <= 0 ? 'disabled' : ''}>−</button>
          <span>${picked}</span>
          <button onclick="UI.refundPick(${i},1)" ${picked >= remaining ? 'disabled' : ''}>+</button>
        </div>
        <div class="rf-amt">${money(perUnit * picked)}</div>
      </div>`;
    }).join('');

    const amount = refundComputeAmount();
    const ready = amount > 0 && refundState.reason.trim();

    openModal(modalShell('↩ Refund · Order #' + o.id, `
      <div class="rf-head">
        <span>Refundable balance: <b>${money(S.remainingRefundable(o))}</b></span>
        <button class="chip-btn accent" onclick="UI.refundAll()">Return everything</button>
      </div>
      <div class="rf-list">${rows}</div>
      <div class="rf-controls">
        <label class="rf-label">Reason (required)</label>
        <input id="rf-reason" class="meta-in full" placeholder="Why is this being refunded?"
          value="${esc(refundState.reason)}" oninput="UI.refundReason(this.value)">
        <div class="quick-notes">
          ${['Wrong order', 'Customer changed mind', 'Quality issue', 'Out of stock', 'Overcharged'].map((q) =>
            `<button class="chip-btn" onclick="UI.refundReasonSet('${esc(q)}')">${q}</button>`).join('')}
        </div>
        <label class="rf-label">Refund to</label>
        <div class="seg full">
          <button class="${refundState.method === 'cash' ? 'on' : ''}" onclick="UI.refundMethod('cash')">💵 Cash</button>
          <button class="${refundState.method === 'card' ? 'on' : ''}" onclick="UI.refundMethod('card')">💳 Card</button>
          <button class="${refundState.method === 'other' ? 'on' : ''}" onclick="UI.refundMethod('other')">🏦 Other</button>
        </div>
      </div>`, {
      size: 'md',
      foot: `<div class="rf-total">Refund <b>${money(amount)}</b></div>
        <button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
        <button class="solid-btn danger" ${ready ? '' : 'disabled'} onclick="UI.refundConfirm()">Process refund</button>`
    }));
  }
  function refundComputeAmount() {
    const o = refundState.order;
    const totalLineNet = o.lines.reduce((s, l) => s + l.lineNet, 0) || 1;
    let refundLineNet = 0;
    Object.entries(refundState.picks).forEach(([i, q]) => {
      const l = o.lines[i];
      refundLineNet += (l.lineNet / l.qty) * q;
    });
    let amount = S.round2(o.totals.total * (refundLineNet / totalLineNet));
    return Math.min(amount, S.remainingRefundable(o));
  }
  function refundPick(i, delta) {
    const remaining = S.refundableQty(refundState.order, i);
    const cur = refundState.picks[i] || 0;
    refundState.picks[i] = Math.max(0, Math.min(remaining, cur + delta));
    if (!refundState.picks[i]) delete refundState.picks[i];
    renderRefundModal();
  }
  function refundAll() {
    refundState.picks = {};
    refundState.order.lines.forEach((l, i) => {
      const r = S.refundableQty(refundState.order, i);
      if (r > 0) refundState.picks[i] = r;
    });
    renderRefundModal();
  }
  function refundReason(v) { refundState.reason = v; }
  function refundReasonSet(v) { refundState.reason = v; renderRefundModal(); }
  function refundMethod(m) { refundState.method = m; renderRefundModal(); }
  function refundConfirm() {
    const o = refundState.order;
    const items = Object.entries(refundState.picks).map(([idx, qty]) => ({ idx: Number(idx), qty }));
    const method = refundState.method;
    const rec = S.refundOrder(o.id, { items, reason: refundState.reason.trim(), method });
    closeModal();
    if (!rec) return toast('Nothing to refund');
    const showVoucher = () => {
      openModal(modalShell('↩ Refund processed', `
        <div class="receipt-frame">${refundReceiptHTML(S.findOrder(o.id), rec)}</div>`, {
        size: 'sm',
        paper: true,
        foot: `<button class="ghost-btn" onclick="UI.closeModal()">Done</button>
          <button class="solid-btn" onclick="UI.printRefundVoucher(${o.id},'${rec.id}')">🖨 Print voucher</button>`
      }));
      toast('Refunded ' + money(rec.amount));
    };
    if (method === 'card') cardFlow(rec.amount, 'Refund', showVoucher); else showVoucher();
  }

  // EFTPOS animation for money going BACK to a card (refunds & credits).
  let cardFlowTok = null;
  function cardFlow(amount, label, cb) {
    const tok = Math.random(); cardFlowTok = tok;
    const screen = (cls, status, extra) => openModal(modalShell(label + ' → EFTPOS', `
      <div class="eftpos"><div class="eftpos-screen ${cls}">
        <div class="eftpos-brand">EFTPOS · ${esc(label)}</div>
        <div class="eftpos-amt">−${money(amount)}</div>
        <div class="eftpos-status">${status}</div>
        ${extra || ''}
      </div></div>`, { size: 'sm' }));
    screen('waiting', '<span class="eftpos-spin"></span> Insert / tap card to refund…', '<div class="eftpos-card">💳</div>');
    setTimeout(() => {
      if (cardFlowTok !== tok) return;
      screen('approved', label.toUpperCase() + ' APPROVED', '<div class="eftpos-check">✓</div>');
      setTimeout(() => { if (cardFlowTok === tok) { cardFlowTok = null; cb(); } }, 950);
    }, 1900);
  }
  function printRefundVoucher(orderId, recId) {
    const o = S.findOrder(orderId);
    const rec = o && o.refunds.find((r) => r.id === recId);
    if (rec) printRefund(o, rec);
  }

  /* ====================================================================== *
   * DASHBOARD
   * ====================================================================== */
  function reportRange() {
    return { from: ui.reportFrom || '', to: ui.reportTo || '' };
  }
  function rangeLabel() {
    const { from, to } = reportRange();
    if (!from && !to) return 'All time';
    if (from === to) return fmtDay(from);
    return fmtDay(from) + ' → ' + fmtDay(to);
  }
  function fmtDay(key) {
    if (!key) return '—';
    const [y, m, d] = key.split('-');
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function shiftDay(days) {
    const d = new Date(); d.setDate(d.getDate() + days); return S.dayKey(d);
  }
  function setQuickRange(kind) {
    const today = S.dayKey(Date.now());
    if (kind === 'today') { ui.reportFrom = today; ui.reportTo = today; }
    else if (kind === '7') { ui.reportFrom = shiftDay(-6); ui.reportTo = today; }
    else if (kind === '30') { ui.reportFrom = shiftDay(-29); ui.reportTo = today; }
    else if (kind === 'month') { const d = new Date(); ui.reportFrom = S.dayKey(new Date(d.getFullYear(), d.getMonth(), 1)); ui.reportTo = today; }
    else if (kind === 'all') { ui.reportFrom = ''; ui.reportTo = ''; }
    render();
  }
  const setReportFrom = (v) => { ui.reportFrom = v; render(); };
  const setReportTo = (v) => { ui.reportTo = v; render(); };
  const setReportCat = (v) => { ui.reportCat = v; render(); };

  function topListHTML(items, emptyText) {
    return items.length ? items.map((it, i) => `
      <div class="top-row"><span class="rank">${i + 1}</span><span class="top-name">${esc(it.name)}</span>
        <span class="top-qty">${it.qty} sold</span><span class="top-rev">${money(it.revenue)}</span></div>`).join('')
      : `<p class="muted-p">${emptyText || 'No items sold.'}</p>`;
  }

  function hourlyHeatmapHTML(r) {
    const max = Math.max(1, ...Object.values(r.byHour));
    return `<div class="heatmap">
      ${Array.from({ length: 24 }).map((_, hr) => {
        const val = r.byHour[hr] || 0;
        const pct = val / max;
        const bg = 0.12 + pct * 0.54;
        const border = 0.18 + pct * 0.38;
        const label = String(hr).padStart(2, '0') + ':00';
        const tip = `${label} · ${money(val)} · ${r.byHourOrders[hr] || 0} orders`;
        return `<div class="heat-cell" style="--heat-bg:${bg.toFixed(2)};--heat-border:${border.toFixed(2)}" data-tip="${esc(tip)}">
          <span>${label}</span><b>${money(val)}</b><em>${r.byHourOrders[hr] || 0} orders</em>
        </div>`;
      }).join('')}
    </div>`;
  }

  function staffSalesHTML(r) {
    return r.staffRows.length ? `<div class="staff-report">
      ${r.staffRows.map((s, i) => `<div class="staff-report-row">
        <span class="rank">${i + 1}</span>
        <span class="staff-name-report">${esc(s.name)}</span>
        <span>${s.orders} orders</span>
        <span>${s.items} items</span>
        <span class="top-rev">${money(s.sales)}</span>
        ${s.refunds ? `<span class="staff-refund">−${money(s.refunds)} refunds</span>` : '<span class="muted-p">No refunds</span>'}
      </div>`).join('')}
    </div>` : '<p class="muted-p">No staff sales in this period.</p>';
  }

  function renderDashboard() {
    const { from, to } = reportRange();
    const r = S.report(from, to);
    const cats = S.getCategories();
    const catFilter = ui.reportCat || '';
    const todayKey = S.dayKey(Date.now());
    const todayReport = S.report(todayKey, todayKey);
    const weekReport = S.report(shiftDay(-6), todayKey);

    const kpi = (label, val, sub) => `
      <div class="kpi"><div class="kpi-val">${val}</div><div class="kpi-label">${label}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

    const maxCat = Math.max(1, ...Object.values(r.byCategory));
    const catBars = cats.filter((c) => r.byCategory[c.id]).sort((a, b) => (r.byCategory[b.id] || 0) - (r.byCategory[a.id] || 0))
      .map((c) => `<div class="bar-row ${catFilter && catFilter !== c.id ? 'dim' : ''}">
        <span class="bar-label">${c.icon} ${esc(c.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.byCategory[c.id] / maxCat * 100).toFixed(1)}%;background:${c.accent}"></div></div>
        <span class="bar-val">${money(r.byCategory[c.id])}</span>
      </div>`).join('') || '<p class="muted-p">No sales in this period.</p>';

    const pays = Object.entries(r.byPayment);
    const payTotal = pays.reduce((s, [, v]) => s + Math.abs(v), 0) || 1;
    const payRows = pays.length ? pays.map(([m, v]) => `
      <div class="bar-row">
        <span class="bar-label">${m === 'cash' ? '💵' : m === 'card' ? '💳' : '🏦'} ${cap(m)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(Math.abs(v) / payTotal * 100).toFixed(1)}%"></div></div>
        <span class="bar-val">${money(v)}</span>
      </div>`).join('') : '<p class="muted-p">No payments yet.</p>';

    // top sellers, optionally filtered to a category
    const items = (catFilter ? r.itemRows.filter((it) => it.cat === catFilter) : r.itemRows).slice(0, 12);
    const topRows = topListHTML(items, 'No items sold.');

    // category focus strip
    let focus = '';
    if (catFilter) {
      const c = cats.find((x) => x.id === catFilter) || {};
      const rev = r.byCategory[catFilter] || 0;
      const qty = r.itemRows.filter((it) => it.cat === catFilter).reduce((s, it) => s + it.qty, 0);
      const totalCat = Object.values(r.byCategory).reduce((s, v) => s + v, 0) || 1;
      focus = `<div class="cat-focus" style="--accent:${c.accent}">
        <div><span>${c.icon} ${esc(c.name)} revenue</span><b>${money(rev)}</b></div>
        <div><span>Items sold</span><b>${qty}</b></div>
        <div><span>Share of sales</span><b>${(rev / totalCat * 100).toFixed(1)}%</b></div>
      </div>`;
    }

    const dateBar = `
      <div class="report-bar">
        <div class="range-inputs">
          <input type="date" class="date-in" value="${from}" onchange="UI.setReportFrom(this.value)">
          <span class="range-arrow">→</span>
          <input type="date" class="date-in" value="${to}" onchange="UI.setReportTo(this.value)">
        </div>
        <div class="quick-range">
          ${[['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['all', 'All time']]
            .map(([k, l]) => `<button class="chip-btn" onclick="UI.setQuickRange('${k}')">${l}</button>`).join('')}
        </div>
        <select class="date-in cat-select" onchange="UI.setReportCat(this.value)">
          <option value="">All categories</option>
          ${cats.map((c) => `<option value="${c.id}" ${catFilter === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}
        </select>
        <div class="export-btns">
          <button class="ghost-btn sm" onclick="UI.exportReportPDF()">⬇ PDF</button>
          <button class="ghost-btn sm" onclick="UI.exportReportExcel()">⬇ Excel</button>
        </div>
      </div>`;

    return `
      <div class="page">
        <div class="page-head">
          <div class="page-title">${adminBack()}<h2>Report <span class="range-tag">${esc(rangeLabel())}</span></h2></div>
          <div class="page-tools">
            <button class="ghost-btn" onclick="UI.openTill('read')">🧾 Till Reading (X)</button>
            <button class="solid-btn danger" onclick="UI.openTill('ringoff')">🔔 Ring Off (Z)</button>
          </div>
        </div>
        ${dateBar}
        ${focus}
        <div class="kpi-grid">
          ${kpi('Net Sales', money(r.total), `${r.orders} orders`)}
          ${kpi('Avg. Order', money(r.avgOrder), `${r.items} items sold`)}
          ${kpi('Refunds', '−' + money(r.refunds), `${r.refundCount} refund${r.refundCount !== 1 ? 's' : ''}`)}
          ${kpi('Discounts', money(r.promoDiscount + r.manualDiscount), 'promos + manual')}
          ${kpi(S.getConfig().taxLabel + ' Collected', money(r.tax), `${(S.getConfig().taxRate * 100).toFixed(0)}%`)}
          ${kpi('Dine-in', r.dineIn, 'orders')}
          ${kpi('Take-away', r.takeAway, 'orders')}
        </div>
        <div class="dash-grid">
          <div class="panel wide"><h3>Hourly sales heatmap</h3>${hourlyHeatmapHTML(r)}</div>
          <div class="panel"><h3>Best sellers today</h3><div class="top-list">${topListHTML(todayReport.itemRows.slice(0, 8), 'No items sold today.')}</div></div>
          <div class="panel"><h3>Best sellers last 7 days</h3><div class="top-list">${topListHTML(weekReport.itemRows.slice(0, 8), 'No items sold this week.')}</div></div>
          <div class="panel wide"><h3>Staff sales report</h3>${staffSalesHTML(r)}</div>
          <div class="panel"><h3>Sales by category</h3><div class="bars">${catBars}</div></div>
          <div class="panel"><h3>Payment methods (net of refunds)</h3><div class="bars">${payRows}</div></div>
          <div class="panel wide"><h3>Top sellers${catFilter ? ' — ' + esc((cats.find((c) => c.id === catFilter) || {}).name) : ''}</h3><div class="top-list">${topRows}</div></div>
        </div>
      </div>`;
  }
  function setReportDay(v) { ui.reportFrom = v; ui.reportTo = v; render(); }

  /* ---- Report exports (PDF via print, Excel via .xls) -------------------- */
  function reportDocHTML() {
    const c = S.getConfig();
    const { from, to } = reportRange();
    const r = S.report(from, to);
    const cats = S.getCategories();
    const catFilter = ui.reportCat || '';
    const catName = (id) => { const x = cats.find((k) => k.id === id); return x ? x.name : id; };
    const items = (catFilter ? r.itemRows.filter((it) => it.cat === catFilter) : r.itemRows);
    const categoryRows = cats.filter((cc) => r.byCategory[cc.id])
      .sort((a, b) => (r.byCategory[b.id] || 0) - (r.byCategory[a.id] || 0));
    const maxCategory = Math.max(1, ...categoryRows.map((cc) => r.byCategory[cc.id] || 0));
    const repKpis = [
      ['Net sales', money(r.total), `${r.orders} orders`],
      ['Gross', money(r.grossSales), 'before refunds'],
      ['Refunds', '−' + money(r.refunds), `${r.refundCount} refund${r.refundCount !== 1 ? 's' : ''}`],
      ['Average order', money(r.avgOrder), `${r.items} items sold`]
    ];
    return `<div class="report-doc">
      <div class="rep-head">
        ${c.logo ? `<img class="rep-logo" src="${c.logo}">` : ''}
        <div>
          <div class="rep-store">${esc(c.storeName)}</div>
          <div class="rep-sub">Sales Report · ${esc(rangeLabel())}${catFilter ? ' · ' + esc(catName(catFilter)) : ''}</div>
          <div class="rep-sub">${esc(c.address)}</div>
          <div class="rep-sub">Generated ${new Date().toLocaleString()}</div>
        </div>
      </div>
      <div class="rep-kpis">
        ${repKpis.map(([label, value, sub]) => `<div class="rep-kpi"><span>${esc(label)}</span><b>${esc(value)}</b><em>${esc(sub)}</em></div>`).join('')}
      </div>
      <div class="rep-cat-strip">
        ${categoryRows.slice(0, 6).map((cc) => `<div class="rep-cat" style="--accent:${cc.accent}">
          <span>${esc(cc.name)}</span><b>${money(r.byCategory[cc.id])}</b>
          <i style="width:${(r.byCategory[cc.id] / maxCategory * 100).toFixed(1)}%"></i>
        </div>`).join('') || '<div class="rep-empty">No category sales.</div>'}
      </div>
      <table class="rep-table">
        <tr><th>Metric</th><th class="num">Value</th></tr>
        <tr><td>Orders</td><td class="num">${r.orders}</td></tr>
        <tr><td>Net sales</td><td class="num">${money(r.total)}</td></tr>
        <tr><td>Gross (before refunds)</td><td class="num">${money(r.grossSales)}</td></tr>
        <tr><td>Refunds</td><td class="num">−${money(r.refunds)}</td></tr>
        <tr><td>Discounts (promo + manual)</td><td class="num">${money(r.promoDiscount + r.manualDiscount)}</td></tr>
        <tr><td>${esc(c.taxLabel)} collected</td><td class="num">${money(r.tax)}</td></tr>
        <tr><td>Average order</td><td class="num">${money(r.avgOrder)}</td></tr>
        <tr><td>Items sold</td><td class="num">${r.items}</td></tr>
        <tr><td>Dine-in / Take-away</td><td class="num">${r.dineIn} / ${r.takeAway}</td></tr>
      </table>
      <h4>Sales by category</h4>
      <table class="rep-table"><tr><th>Category</th><th class="num">Revenue</th></tr>
        ${categoryRows.map((cc) => `<tr><td>${esc(cc.name)}</td><td class="num">${money(r.byCategory[cc.id])}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
      </table>
      <h4>Payment methods</h4>
      <table class="rep-table"><tr><th>Method</th><th class="num">Net</th></tr>
        ${Object.entries(r.byPayment).map(([m, v]) => `<tr><td>${cap(m)}</td><td class="num">${money(v)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
      </table>
      <h4>Hourly sales</h4>
      <table class="rep-table"><tr><th>Hour</th><th class="num">Orders</th><th class="num">Net sales</th></tr>
        ${Array.from({ length: 24 }).map((_, hr) => `<tr><td>${String(hr).padStart(2, '0')}:00</td><td class="num">${r.byHourOrders[hr] || 0}</td><td class="num">${money(r.byHour[hr] || 0)}</td></tr>`).join('')}
      </table>
      <h4>Staff sales</h4>
      <table class="rep-table"><tr><th>Cashier</th><th class="num">Orders</th><th class="num">Items</th><th class="num">Net sales</th><th class="num">Refunds</th></tr>
        ${r.staffRows.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.orders}</td><td class="num">${s.items}</td><td class="num">${money(s.sales)}</td><td class="num">−${money(s.refunds)}</td></tr>`).join('') || '<tr><td colspan="5">—</td></tr>'}
      </table>
      <h4>Items${catFilter ? ' — ' + esc(catName(catFilter)) : ''}</h4>
      <table class="rep-table"><tr><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Revenue</th></tr>
        ${items.map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(catName(it.cat))}</td><td class="num">${it.qty}</td><td class="num">${money(it.revenue)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
      </table>
    </div>`;
  }
  function exportReportPDF() {
    $('#print-area').innerHTML = reportDocHTML();
    $('#print-area').classList.add('report-mode');
    window.print();
    setTimeout(() => $('#print-area').classList.remove('report-mode'), 500);
  }
  function exportReportExcel() {
    const c = S.getConfig();
    const { from, to } = reportRange();
    const r = S.report(from, to);
    const cats = S.getCategories();
    const catName = (id) => { const x = cats.find((k) => k.id === id); return x ? x.name : id; };
    const catFilter = ui.reportCat || '';
    const items = (catFilter ? r.itemRows.filter((it) => it.cat === catFilter) : r.itemRows);
    const cur = c.currency;
    const esc2 = (s) => esc(s);
    const num = (n) => (Math.round(n * 100) / 100).toFixed(2);
    let html = `<table border="1"><tr><th colspan="4" style="background:#1d1916;color:#c79a3f;font-size:16px">${esc2(c.storeName)} — Sales Report</th></tr>`;
    html += `<tr><td colspan="4">Period: ${esc2(rangeLabel())}${catFilter ? ' | Category: ' + esc2(catName(catFilter)) : ''} | Generated: ${new Date().toLocaleString()}</td></tr>`;
    html += `<tr><td></td></tr>`;
    html += `<tr><th>Metric</th><th>Value (${cur})</th></tr>`;
    html += `<tr><td>Orders</td><td>${r.orders}</td></tr>`;
    html += `<tr><td>Net sales</td><td>${num(r.total)}</td></tr>`;
    html += `<tr><td>Gross before refunds</td><td>${num(r.grossSales)}</td></tr>`;
    html += `<tr><td>Refunds</td><td>-${num(r.refunds)}</td></tr>`;
    html += `<tr><td>Discounts</td><td>${num(r.promoDiscount + r.manualDiscount)}</td></tr>`;
    html += `<tr><td>${esc2(c.taxLabel)} collected</td><td>${num(r.tax)}</td></tr>`;
    html += `<tr><td>Average order</td><td>${num(r.avgOrder)}</td></tr>`;
    html += `<tr><td>Items sold</td><td>${r.items}</td></tr>`;
    html += `<tr><td>Dine-in</td><td>${r.dineIn}</td></tr><tr><td>Take-away</td><td>${r.takeAway}</td></tr>`;
    html += `<tr><td></td></tr><tr><th>Category</th><th>Revenue (${cur})</th></tr>`;
    cats.filter((cc) => r.byCategory[cc.id]).forEach((cc) => { html += `<tr><td>${esc2(cc.name)}</td><td>${num(r.byCategory[cc.id])}</td></tr>`; });
    html += `<tr><td></td></tr><tr><th>Payment</th><th>Net (${cur})</th></tr>`;
    Object.entries(r.byPayment).forEach(([m, v]) => { html += `<tr><td>${cap(m)}</td><td>${num(v)}</td></tr>`; });
    html += `<tr><td></td></tr><tr><th>Hour</th><th>Orders</th><th>Net (${cur})</th></tr>`;
    Array.from({ length: 24 }).forEach((_, hr) => { html += `<tr><td>${String(hr).padStart(2, '0')}:00</td><td>${r.byHourOrders[hr] || 0}</td><td>${num(r.byHour[hr] || 0)}</td></tr>`; });
    html += `<tr><td></td></tr><tr><th>Cashier</th><th>Orders</th><th>Items</th><th>Net (${cur})</th><th>Refunds (${cur})</th></tr>`;
    r.staffRows.forEach((s) => { html += `<tr><td>${esc2(s.name)}</td><td>${s.orders}</td><td>${s.items}</td><td>${num(s.sales)}</td><td>-${num(s.refunds)}</td></tr>`; });
    html += `<tr><td></td></tr><tr><th>Item</th><th>Category</th><th>Qty</th><th>Revenue (${cur})</th></tr>`;
    items.forEach((it) => { html += `<tr><td>${esc2(it.name)}</td><td>${esc2(catName(it.cat))}</td><td>${it.qty}</td><td>${num(it.revenue)}</td></tr>`; });
    html += `</table>`;
    const blob = new Blob(['﻿<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>'],
      { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mcq-report-' + (from || 'all') + (to && to !== from ? '_to_' + to : '') + '.xls';
    a.click();
    toast('Excel report downloaded');
  }

  /* ====================================================================== *
   * TILL — X reading / Z ring-off
   * ====================================================================== */
  function openTill(kind) {
    const day = ui.reportFrom && ui.reportFrom === ui.reportTo ? ui.reportFrom : S.dayKey(Date.now());
    const isZ = kind === 'ringoff';
    const proceed = () => {
      const rep = isZ ? S.ringOff(day).report : S.tillReport(day);
      openModal(modalShell(isZ ? '🔔 Ring Off (Z report)' : '🧾 Till Reading (X report)', `
        <div class="receipt-frame">${tillReceiptHTML(rep, isZ)}</div>`, {
        size: 'sm',
        paper: true,
        foot: `<button class="ghost-btn" onclick="UI.closeModal()">Close</button>
          <button class="solid-btn" onclick="UI.printTill('${day}','${isZ ? 'z' : 'x'}')">🖨 Print</button>`
      }));
    };
    if (isZ) { requireAdmin(proceed, 'Manager PIN to ring off'); } else { proceed(); }
  }
  function tillReceiptHTML(rep, isZ) {
    const c = S.getConfig();
    const d = new Date(rep.generatedAt);
    const k = rep.dayKey.split('-');
    const dayLabel = new Date(k[0], k[1] - 1, k[2]).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const row = (label, val, cls) => `<div class="r-row ${cls || ''}"><span>${label}</span><span>${val}</span></div>`;
    return `<div class="receipt">
      <div class="r-head">${c.logo ? `<img class="r-logo" src="${c.logo}">` : ''}
        <div class="r-store">${esc(c.storeName)}</div>
        <div class="r-tag">${isZ ? 'Z — Ring Off' : 'X — Till Reading'}</div>
      </div>
      <div class="r-sep"></div>
      <div class="r-info">
        <div><span>Business day</span><b>${dayLabel}</b></div>
        <div><span>Printed</span><b>${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b></div>
        <div><span>Cashier</span><b>${esc(rep.cashier)}</b></div>
        <div><span>Orders</span><b>${rep.orders}</b></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-totals">
        <div class="r-row sec"><b>SALES</b><b></b></div>
        ${row('Gross sales', money(rep.grossSales))}
        ${row('Discounts', '−' + money(rep.discount), 'muted')}
        ${row('Refunds', '−' + money(rep.refunds), 'muted')}
        ${row('Credits (goodwill)', '−' + money(rep.credits), 'muted')}
        ${row('Rounding', money(rep.rounding), 'muted')}
        <div class="r-row grand"><span>NET SALES</span><span>${money(rep.netSales)}</span></div>
        ${row(c.taxLabel + ' included', money(rep.gst), 'muted')}
      </div>
      <div class="r-sep"></div>
      <div class="r-totals">
        <div class="r-row sec"><b>TILL / DRAWER</b><b></b></div>
        ${row('💵 Cash', money(rep.cash))}
        ${row('💳 Card', money(rep.card))}
        ${row('🏦 Other', money(rep.other))}
        <div class="r-row grand"><span>DRAWER TOTAL</span><span>${money(rep.drawerTotal)}</span></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-info">
        <div><span>Dine-in</span><b>${rep.dineIn}</b></div>
        <div><span>Take-away</span><b>${rep.takeAway}</b></div>
        <div><span>Refund count</span><b>${rep.refundCount}</b></div>
        <div><span>Credit count</span><b>${rep.creditCount}</b></div>
      </div>
      <div class="r-sep"></div>
      <div class="r-foot">${isZ ? 'Count the cash drawer against CASH above.' : 'Reading only — drawer not closed.'}</div>
      ${isZ ? '<div class="r-ordercode">*** TILL CLOSED ***</div>' : ''}
    </div>`;
  }
  function printTill(day, kind) {
    const rep = S.tillReport(day);
    $('#print-area').innerHTML = tillReceiptHTML(rep, kind === 'z');
    window.print();
  }

  /* ====================================================================== *
   * MENU MANAGER
   * ====================================================================== */
  function renderMenuManager() {
    const tab = ui.menuTab || 'items';
    const head = `<div class="page-head">
      <div class="page-title">${adminBack()}<h2>Menu Manager</h2></div>
      <div class="page-tools">
        <div class="seg">
          <button class="${tab === 'items' ? 'on' : ''}" onclick="UI.setMenuTab('items')">🍽️ Menu Items</button>
          <button class="${tab === 'modifiers' ? 'on' : ''}" onclick="UI.setMenuTab('modifiers')">🧩 Add-ons &amp; Notes</button>
          <button class="${tab === 'promos' ? 'on' : ''}" onclick="UI.setMenuTab('promos')">🏷️ Promotions</button>
        </div>
        <span class="pill">${tab === 'items' ? S.getMenu().length + ' items'
          : tab === 'modifiers' ? S.getModifierGroups().length + ' groups'
          : S.getPromotions().length + ' promotions'}</span>
      </div>
    </div>`;
    const bodyHtml = tab === 'items' ? renderItemsManager()
      : tab === 'modifiers' ? renderModifierManager()
      : renderPromotionsManager();
    return `<div class="page">${head}${bodyHtml}</div>`;
  }
  function setMenuTab(t) { ui.menuTab = t; render(); }

  function renderItemsManager() {
    const cats = S.getCategories();
    const sections = cats.map((c) => {
      const items = S.itemsByCategory(c.id);
      return `<div class="mm-section">
        <div class="mm-head"><h3>${c.icon} ${esc(c.name)}</h3>
          <button class="ghost-btn sm" onclick="UI.newItem('${c.id}')">+ Add item</button></div>
        <div class="mm-list">
          ${items.map((m) => `<div class="mm-row mm-item ${m.available === false ? 'off' : ''}">
            <button class="mm-thumb" title="Upload / change photo" onclick="UI.uploadItemImage('${m.id}')">
              <img src="${esc(itemImage(m))}" alt="${esc(m.name)}" width="480" height="360" onerror="this.style.display='none';this.parentNode.classList.add('noimg')">
              <span class="mm-thumb-ico">📷</span>
            </button>
            <span class="mm-name">${esc(m.name)}
              ${m.noDiscount ? '<span class="mm-flag">no promo</span>' : ''}
              ${m.takeawayOnly ? '<span class="mm-flag">take-away</span>' : ''}
              ${m.isCombo ? '<span class="mm-flag combo">combo</span>' : ''}</span>
            <div class="mm-price">${esc(S.getConfig().currency)}<input type="number" min="0" step="0.5" value="${m.price}" onchange="UI.setPrice('${m.id}', this.value)"></div>
            <button class="mini-btn" onclick="UI.toggleAvail('${m.id}')">${m.available === false ? 'Enable' : 'Disable'}</button>
            <button class="mini-btn" onclick="UI.editItem('${m.id}')">Edit</button>
            <button class="mini-btn danger" onclick="UI.delItem('${m.id}')">Delete</button>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');
    return `<div class="mm-wrap">${sections}</div>`;
  }

  /* ---- Modifiers (add-ons & note options) manager ------------------------ */
  function appliesLabel(g) {
    if (g.appliesTo.all) return 'All items';
    const names = (g.appliesTo.categories || []).map((id) => {
      const c = S.getCategories().find((x) => x.id === id); return c ? c.name : id;
    });
    return names.length ? names.join(', ') : 'No items';
  }
  function renderModifierManager() {
    const groups = S.getModifierGroups();
    const cur = S.getConfig().currency;
    const sections = groups.map((g) => `
      <div class="mm-section">
        <div class="mm-head">
          <div class="mg-head-left">
            <input class="mg-name" value="${esc(g.name)}" onchange="UI.mgGroupName('${g.id}', this.value)">
            <span class="mm-flag ${g.free ? '' : 'combo'}">${g.free ? 'free note' : 'paid add-on'}</span>
            <span class="mg-applies">→ ${esc(appliesLabel(g))}</span>
          </div>
          <div>
            <button class="mini-btn" onclick="UI.mgEditGroup('${g.id}')">Applies to…</button>
            <button class="mini-btn danger" onclick="UI.mgDelGroup('${g.id}')">Delete group</button>
          </div>
        </div>
        <div class="mm-list">
          ${g.options.map((o, i) => `<div class="mm-row">
            <input class="mg-opt-name" value="${esc(o.name)}" onchange="UI.mgOptName('${g.id}',${i},this.value)">
            ${g.free ? '<span class="mg-free">no charge</span>'
              : `<div class="mm-price">${esc(cur)}<input type="number" min="0" step="0.5" value="${o.price != null ? o.price : 0}" onchange="UI.mgOptPrice('${g.id}',${i},this.value)"></div>`}
            <button class="mini-btn danger" onclick="UI.mgDelOpt('${g.id}',${i})">Remove</button>
          </div>`).join('') || '<div class="mm-empty">No options yet.</div>'}
          <button class="ghost-btn sm mg-add-opt" onclick="UI.mgAddOpt('${g.id}')">+ Add option</button>
        </div>
      </div>`).join('');
    return `<div class="mm-wrap">
      <p class="hint mg-intro">Add-ons charge extra and are added to the bill. Free notes are kitchen instructions only. Changes apply instantly across the register.</p>
      ${sections}
      <button class="solid-btn mg-add-group" onclick="UI.mgAddGroup()">+ New option group</button>
    </div>`;
  }
  const mgGroupName = (id, v) => S.updateModifierGroup(id, { name: v.trim() || 'Group' });
  const mgOptName = (gid, i, v) => S.updateModifierOption(gid, i, { name: v.trim() || 'Option' });
  const mgOptPrice = (gid, i, v) => S.updateModifierOption(gid, i, { price: parseFloat(v) || 0 });
  const mgDelOpt = (gid, i) => S.deleteModifierOption(gid, i);
  const mgAddOpt = (gid) => S.addModifierOption(gid, {});
  function mgDelGroup(id) {
    const g = S.getModifierGroups().find((x) => x.id === id);
    confirmModal('Delete option group?', 'Remove "' + (g ? g.name : '') + '" and all its options?', () => S.deleteModifierGroup(id));
  }
  function mgAddGroup() { groupForm(null); }
  function mgEditGroup(id) { groupForm(S.getModifierGroups().find((g) => g.id === id)); }
  function groupForm(group) {
    const isNew = !group;
    const cats = S.getCategories();
    const all = group ? !!group.appliesTo.all : false;
    const selCats = group ? (group.appliesTo.categories || []) : [];
    openModal(modalShell(isNew ? 'New option group' : 'Edit · ' + esc(group.name), `
      <div class="form">
        <label>Group name<input id="g-name" value="${esc(group ? group.name : '')}" placeholder="e.g. Sauce options"></label>
        <label>Type
          <select id="g-type" ${isNew ? '' : ''}>
            <option value="paid" ${group && !group.free ? 'selected' : ''}>Paid add-on (has price)</option>
            <option value="free" ${group && group.free ? 'selected' : ''}>Free note (no charge)</option>
          </select>
        </label>
        <label class="ck"><input id="g-all" type="checkbox" ${all ? 'checked' : ''} onchange="document.getElementById('g-cats').style.opacity=this.checked?0.4:1"> Apply to ALL items</label>
        <div id="g-cats" class="g-cats" style="opacity:${all ? 0.4 : 1}">
          ${cats.map((c) => `<label class="ck sm"><input type="checkbox" class="g-cat" value="${c.id}" ${selCats.includes(c.id) ? 'checked' : ''}> ${c.icon} ${esc(c.name)}</label>`).join('')}
        </div>
      </div>`, {
      size: 'md',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
        <button class="solid-btn" onclick="UI.mgSaveGroup('${group ? group.id : ''}')">${isNew ? 'Create' : 'Save'}</button>`
    }));
  }
  function mgSaveGroup(id) {
    const name = $('#g-name').value.trim();
    if (!name) return toast('Group name is required');
    const free = $('#g-type').value === 'free';
    const all = $('#g-all').checked;
    const categories = [...document.querySelectorAll('.g-cat:checked')].map((x) => x.value);
    const appliesTo = all ? { all: true } : { categories };
    if (id) S.updateModifierGroup(id, { name, free, appliesTo });
    else S.addModifierGroup({ name, free, appliesTo, options: [] });
    closeModal();
  }

  /* ---- Promotions manager ------------------------------------------------ */
  function renderPromotionsManager() {
    const promos = S.getPromotions();
    const cats = S.getCategories();
    const catName = (id) => { const c = cats.find((x) => x.id === id); return c ? c.name : id; };
    const rows = promos.map((p) => {
      const st = S.promotionStatus(p);
      return `<div class="mm-section promo-card ${st}">
        <div class="mm-head">
          <div class="mg-head-left">
            <span class="promo-title">${esc(p.name)}</span>
            <span class="pi-badge ${st}">${cap(st)}</span>
          </div>
          <div class="promo-actions">
            <label class="switch" title="Enable/disable"><input type="checkbox" ${p.active ? 'checked' : ''} onchange="UI.togglePromo('${p.id}')"><span class="slider"></span></label>
            <button class="mini-btn" onclick="UI.promoEdit('${p.id}')">Edit</button>
            <button class="mini-btn danger" onclick="UI.promoDel('${p.id}')">Delete</button>
          </div>
        </div>
        <div class="promo-body">
          <span class="promo-pct">${p.percent}% off <b>${esc(catName(p.category))}</b></span>
          <span>📅 ${esc(promoValidity(p))}</span>
          ${p.excludeCombos ? '<span>Excl. combos</span>' : ''}
          ${(p.excludeItemIds && p.excludeItemIds.length) ? `<span>Excl. ${p.excludeItemIds.length} item(s)</span>` : ''}
        </div>
        ${p.note ? `<div class="promo-note">📣 ${esc(p.note)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="mm-wrap">
      <p class="hint mg-intro">Set the discount, the dates it runs and what it excludes. Only <b>Active now</b> promotions are applied at the register — coordinate dates with your marketing campaigns here.</p>
      ${rows || '<p class="muted-p">No promotions yet.</p>'}
      <button class="solid-btn mg-add-group" onclick="UI.promoNew()">+ New promotion</button>
    </div>`;
  }
  let promoDraft = null;
  function promoNew() {
    promoDraft = { id: '', name: '', category: S.getCategories()[0].id, percent: 10, startDate: '', endDate: '', excludeCombos: true, excludeItemIds: [], active: true, note: '' };
    renderPromoForm(true);
  }
  function promoEdit(id) {
    const p = S.getPromotions().find((x) => x.id === id);
    if (!p) return;
    promoDraft = { id: p.id, name: p.name, category: p.category, percent: p.percent, startDate: p.startDate || '', endDate: p.endDate || '', excludeCombos: !!p.excludeCombos, excludeItemIds: [...(p.excludeItemIds || [])], active: p.active, note: p.note || '' };
    renderPromoForm(false);
  }
  function renderPromoForm(isNew) {
    const cats = S.getCategories();
    const items = S.itemsByCategory(promoDraft.category).filter((m) => !m.isCombo);
    openModal(modalShell(isNew ? 'New promotion' : 'Edit promotion', `
      <div class="form">
        <label>Promotion name<input value="${esc(promoDraft.name)}" oninput="UI.promoSet('name',this.value)" placeholder="e.g. Winter 10% OFF Pho"></label>
        <div class="form-row">
          <label>Applies to category
            <select onchange="UI.promoSetCat(this.value)">${cats.map((c) => `<option value="${c.id}" ${promoDraft.category === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
          </label>
          <label>Discount %<input type="number" min="0" max="100" step="1" value="${promoDraft.percent}" oninput="UI.promoSet('percent',this.value)"></label>
        </div>
        <div class="form-row">
          <label>Start date<input type="date" value="${promoDraft.startDate}" onchange="UI.promoSet('startDate',this.value)"></label>
          <label>End date<input type="date" value="${promoDraft.endDate}" onchange="UI.promoSet('endDate',this.value)"></label>
        </div>
        <p class="hint">Leave dates blank for an ongoing promotion. The discount only applies between Start and End.</p>
        <label class="ck"><input type="checkbox" ${promoDraft.excludeCombos ? 'checked' : ''} onchange="UI.promoSet('excludeCombos',this.checked)"> Exclude combos from this promotion</label>
        <div>
          <div class="cz-group-title">Exclude specific items (optional)</div>
          <div class="g-cats">${items.length ? items.map((it) => `<label class="ck sm"><input type="checkbox" ${promoDraft.excludeItemIds.includes(it.id) ? 'checked' : ''} onchange="UI.promoExcl('${it.id}',this.checked)"> ${esc(it.name)}</label>`).join('') : '<span class="muted-p">No items in this category.</span>'}</div>
        </div>
        <label>Note for cashier<input value="${esc(promoDraft.note)}" oninput="UI.promoSet('note',this.value)" placeholder="Shown on the cashier promotions panel"></label>
      </div>`, {
      size: 'md',
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
        <button class="solid-btn" onclick="UI.promoSave()">${isNew ? 'Create' : 'Save'}</button>`
    }));
  }
  function promoSet(field, val) { if (field === 'percent') val = parseFloat(val) || 0; promoDraft[field] = val; }
  function promoSetCat(val) { promoDraft.category = val; promoDraft.excludeItemIds = []; renderPromoForm(!promoDraft.id); }
  function promoExcl(id, checked) {
    const s = new Set(promoDraft.excludeItemIds);
    if (checked) s.add(id); else s.delete(id);
    promoDraft.excludeItemIds = [...s];
  }
  function promoSave() {
    if (!promoDraft.name.trim()) return toast('Promotion name is required');
    const data = {
      name: promoDraft.name.trim(), type: 'category_percent', category: promoDraft.category,
      percent: promoDraft.percent, startDate: promoDraft.startDate, endDate: promoDraft.endDate,
      excludeCombos: promoDraft.excludeCombos, excludeItemIds: promoDraft.excludeItemIds,
      active: promoDraft.active, note: promoDraft.note.trim()
    };
    if (promoDraft.startDate && promoDraft.endDate && promoDraft.endDate < promoDraft.startDate) return toast('End date is before start date');
    if (promoDraft.id) S.updatePromotion(promoDraft.id, data); else S.addPromotion(data);
    closeModal();
  }
  function promoDel(id) {
    const p = S.getPromotions().find((x) => x.id === id);
    confirmModal('Delete promotion?', 'Remove "' + (p ? p.name : '') + '"? This cannot be undone.', () => S.deletePromotion(id));
  }

  function setPrice(id, v) { S.upsertMenuItem({ id, price: parseFloat(v) || 0 }); }
  const toggleAvail = (id) => S.toggleAvailability(id);
  function delItem(id) {
    const m = S.findItem(id);
    confirmModal('Delete item?', 'Remove "' + (m ? m.name : '') + '" from the menu?', () => S.deleteMenuItem(id));
  }
  function newItem(cat) { itemForm(null, cat); }
  function editItem(id) { itemForm(S.findItem(id)); }
  let itemImgDraft = null;   // null = unchanged, '' = reset to default, dataURL = new
  function itemForm(item, cat) {
    const isNew = !item;
    itemImgDraft = null;
    const cats = S.getCategories();
    const previewSrc = item ? itemImage(item) : '';
    openModal(modalShell(isNew ? 'New item' : 'Edit · ' + esc(item.name), `
      <div class="form">
        <div class="form-img">
          <div class="form-img-preview ${previewSrc ? '' : 'noimg'}">
            <img id="f-img" src="${previewSrc}" alt="" onerror="this.style.display='none';this.parentNode.classList.add('noimg')">
            <span class="form-img-ico">📷</span>
          </div>
          <div class="form-img-actions">
            <button class="ghost-btn sm" onclick="UI.itemFormUpload()">⬆ Upload photo</button>
            <button class="ghost-btn sm" onclick="UI.itemFormResetImg('${item ? item.id : ''}')">Reset to default</button>
            <p class="hint">JPG / PNG — auto-resized so the register stays fast.</p>
          </div>
        </div>
        <label>Name<input id="f-name" value="${esc(item ? item.name : '')}"></label>
        <div class="form-row">
          <label>Price<input id="f-price" type="number" min="0" step="0.5" value="${item ? item.price : ''}"></label>
          <label>Category
            <select id="f-cat">${cats.map((c) => `<option value="${c.id}" ${(item ? item.cat : cat) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="form-checks">
          <label class="ck"><input id="f-noDiscount" type="checkbox" ${item && item.noDiscount ? 'checked' : ''}> Exclude from promotions</label>
          <label class="ck"><input id="f-takeaway" type="checkbox" ${item && item.takeawayOnly ? 'checked' : ''}> Take-away only</label>
        </div>
      </div>`, {
      foot: `<button class="ghost-btn" onclick="UI.closeModal()">Cancel</button>
             <button class="solid-btn" onclick="UI.saveItem('${item ? item.id : ''}')">${isNew ? 'Create' : 'Save'}</button>`
    }));
  }
  function setFormImg(src) {
    const el = $('#f-img'); if (!el) return;
    el.src = src; el.style.display = src ? '' : 'none';
    const wrap = el.parentNode; wrap.classList.toggle('noimg', !src);
  }
  function itemFormUpload() {
    pickImageScaled(640, (dataURL) => { itemImgDraft = dataURL; setFormImg(dataURL); });
  }
  function itemFormResetImg(id) {
    itemImgDraft = '';
    setFormImg(id ? itemAsset(id) : '');
  }
  function saveItem(id) {
    const name = $('#f-name').value.trim();
    const price = parseFloat($('#f-price').value) || 0;
    if (!name) return toast('Name is required');
    const data = {
      name, price, cat: $('#f-cat').value,
      noDiscount: $('#f-noDiscount').checked,
      takeawayOnly: $('#f-takeaway').checked
    };
    if (id) data.id = id;
    if (itemImgDraft !== null) data.img = itemImgDraft;   // only touch the photo if changed
    S.upsertMenuItem(data);
    closeModal();
  }
  // Quick photo change straight from a menu row.
  function uploadItemImage(id) {
    pickImageScaled(640, (dataURL) => { S.upsertMenuItem({ id, img: dataURL }); toast('Photo updated'); });
  }
  // Pick an image file and downscale it client-side (keeps localStorage small).
  function pickImageScaled(maxDim, cb) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          try { cb(cv.toDataURL('image/jpeg', 0.72)); } catch (e) { cb(reader.result); }
        };
        img.onerror = () => toast('Could not read that image');
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  /* ====================================================================== *
   * SETTINGS
   * ====================================================================== */
  function renderSettings() {
    const c = S.getConfig();
    const promos = S.getPromotions();
    return `<div class="page">
      <div class="page-head"><div class="page-title">${adminBack()}<h2>Settings</h2></div></div>
      <div class="settings-grid">
        <div class="panel">
          <h3>Store details</h3>
          <div class="logo-setting">
            <div class="logo-preview">${c.logo ? `<img src="${c.logo}" alt="logo">` : '<span>No logo</span>'}</div>
            <div class="logo-actions">
              <button class="ghost-btn sm" onclick="UI.uploadLogo()">⬆ Upload logo</button>
              ${c.logo ? `<button class="ghost-btn sm danger" onclick="UI.removeLogo()">Remove</button>` : ''}
              <p class="hint">PNG/JPG, shown on the screen rail and printed receipts.</p>
            </div>
          </div>
          <div class="form">
            <label>Store name<input id="s-storeName" value="${esc(c.storeName)}"></label>
            <label>Tagline<input id="s-tagline" value="${esc(c.tagline)}"></label>
            <label>Address<input id="s-address" value="${esc(c.address)}"></label>
            <div class="form-row">
              <label>Phone<input id="s-phone" value="${esc(c.phone)}"></label>
              <label>ABN / Reg.<input id="s-abn" value="${esc(c.abn)}"></label>
            </div>
            <label>Receipt footer<input id="s-receiptFooter" value="${esc(c.receiptFooter)}"></label>
            <label>Cashier name<input id="s-cashier" value="${esc(c.cashier)}"></label>
          </div>
        </div>
        <div class="panel">
          <h3>Tax & currency</h3>
          <div class="form">
            <div class="form-row">
              <label>Currency symbol<input id="s-currency" value="${esc(c.currency)}"></label>
              <label>Tax label<input id="s-taxLabel" value="${esc(c.taxLabel)}"></label>
            </div>
            <div class="form-row">
              <label>Tax rate %<input id="s-taxRate" type="number" min="0" step="0.5" value="${(c.taxRate * 100)}"></label>
              <label>Cash rounding<select id="s-cashRounding">
                <option value="0" ${!c.cashRounding ? 'selected' : ''}>Off</option>
                <option value="0.05" ${c.cashRounding === 0.05 ? 'selected' : ''}>Nearest 0.05</option>
                <option value="0.10" ${c.cashRounding === 0.10 ? 'selected' : ''}>Nearest 0.10</option>
              </select></label>
            </div>
            <label class="ck"><input id="s-taxInclusive" type="checkbox" ${c.taxInclusive ? 'checked' : ''}> Menu prices include tax</label>
            <button class="solid-btn" onclick="UI.saveSettings()">Save settings</button>
          </div>
          <h3 style="margin-top:18px">Promotions</h3>
          <div class="promo-list">
            ${promos.map((p) => `<div class="promo-row">
              <div><strong>${esc(p.name)}</strong><span>${esc(p.note || '')}</span></div>
              <label class="switch"><input type="checkbox" ${p.active ? 'checked' : ''} onchange="UI.togglePromo('${p.id}')"><span class="slider"></span></label>
            </div>`).join('')}
          </div>
        </div>
        <div class="panel wide">
          <h3>Staff accounts &amp; roles</h3>
          <p class="hint">Admins can open the Admin area, discounts, refunds, credits and ring-off. Users get the Register only.</p>
          <div class="staff-list">
            ${S.getUsers().map((u) => `<div class="staff-row">
              <span class="lu-avatar ${u.role === 'admin' ? 'admin' : ''}">${esc(u.name.charAt(0).toUpperCase())}</span>
              <input class="staff-name" value="${esc(u.name)}" onchange="UI.userSet('${u.id}','name',this.value)">
              <input class="staff-pin" value="${esc(u.pin)}" maxlength="4" onchange="UI.userSet('${u.id}','pin',this.value)" title="4-digit PIN">
              <select class="staff-role" onchange="UI.userSet('${u.id}','role',this.value)">
                <option value="user" ${u.role === 'user' ? 'selected' : ''}>Cashier</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Manager (admin)</option>
              </select>
              <button class="mini-btn danger" onclick="UI.userDel('${u.id}')">Remove</button>
            </div>`).join('')}
          </div>
          <button class="ghost-btn sm" onclick="UI.userAdd()">+ Add staff</button>
        </div>
        <div class="panel wide">
          <h3>Data management</h3>
          <p class="hint">Everything is stored locally in this browser. Export to back up or move to another device.</p>
          <div class="form-row btns">
            <button class="ghost-btn" onclick="UI.exportData()">⬇ Export data (JSON)</button>
            <button class="ghost-btn" onclick="UI.importPrompt()">⬆ Import data</button>
            <button class="ghost-btn danger" onclick="UI.resetData()">Reset everything</button>
          </div>
        </div>
      </div>
    </div>`;
  }
  function userSet(id, field, val) {
    if (field === 'role' && val !== 'admin') {
      const admins = S.getUsers().filter((u) => u.role === 'admin');
      const target = S.getUsers().find((u) => u.id === id);
      if (target && target.role === 'admin' && admins.length <= 1) return toast('Keep at least one Manager');
    }
    S.updateUser(id, { [field]: val });
  }
  function userAdd() { S.addUser({ name: 'New staff', pin: '0000', role: 'user' }); }
  function userDel(id) {
    const u = S.getUsers().find((x) => x.id === id);
    confirmModal('Remove staff?', 'Remove "' + (u ? u.name : '') + '"?', () => {
      if (S.deleteUser(id) === false) toast('Cannot remove the last Manager');
    });
  }
  function saveSettings() {
    S.updateConfig({
      storeName: $('#s-storeName').value, tagline: $('#s-tagline').value,
      address: $('#s-address').value, phone: $('#s-phone').value, abn: $('#s-abn').value,
      receiptFooter: $('#s-receiptFooter').value, cashier: $('#s-cashier').value,
      currency: $('#s-currency').value || '$', taxLabel: $('#s-taxLabel').value || 'Tax',
      taxRate: (parseFloat($('#s-taxRate').value) || 0) / 100,
      cashRounding: parseFloat($('#s-cashRounding').value) || 0,
      taxInclusive: $('#s-taxInclusive').checked
    });
    toast('Settings saved');
  }
  const togglePromo = (id) => S.togglePromotion(id);

  function uploadLogo() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0]; if (!file) return;
      if (file.size > 1.5 * 1024 * 1024) return toast('Image too large (max ~1.5MB)');
      const reader = new FileReader();
      reader.onload = () => { S.updateConfig({ logo: reader.result }); toast('Logo updated'); };
      reader.readAsDataURL(file);
    };
    input.click();
  }
  function removeLogo() { S.updateConfig({ logo: '' }); toast('Logo removed'); }

  function exportData() {
    const blob = new Blob([S.exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mcq-pos-backup-' + S.dayKey(Date.now()) + '.json';
    a.click();
    toast('Backup exported');
  }
  function importPrompt() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { try { S.importData(reader.result); toast('Data imported'); } catch (e) { toast('Invalid file'); } };
      reader.readAsText(file);
    };
    input.click();
  }
  function resetData() {
    confirmModal('Reset everything?', 'This wipes all orders, settings and menu edits and restores the default MCQ menu. This cannot be undone.', () => { S.resetAll(); ui.currentUser = null; ui.adminUnlocked = false; ui.view = 'register'; });
  }

  /* ====================================================================== *
   * CUSTOMER DISPLAY  (back screen the guest reads — mirrors the live cart)
   * ====================================================================== */
  function openBackScreen() { ui.view = 'backscreen'; renderTopbar(); render(); }
  function exitScreen() { clearTimeout(kioskDoneTimer); ui.view = 'admin'; renderTopbar(); render(); }

  // A live broadcast is only honoured for a short window so a window that loads
  // with a stale payment/thank-you in storage falls back to the order screen.
  let backScreenTimer = null;
  function liveFresh(live) {
    if (!live || !live.ts) return false;
    const age = Date.now() - live.ts;
    if (live.mode === 'done') return age < 12000;
    if (live.mode === 'pay') return age < 180000;
    return false;
  }
  const tenderIcon = (m) => (m === 'cash' ? '💵' : m === 'card' ? '💳' : '🏦');

  // Full shell — the brand/video half is static so surgical repaints
  // (paintBackScreen) never restart the looping video during live payment.
  function renderBackScreen() {
    const c = S.getConfig();
    const parts = backScreenParts();
    return `<div class="cust2${parts.rootClass}">
      <button class="screen-exit" onclick="UI.exitScreen()" title="Exit to admin">✕</button>
      <div class="cust2-media">
        <video class="cust2-vid" src="assets/videos/vid-847.mp4" autoplay muted loop playsinline preload="auto" poster="assets/images/backscreen-bg.jpg" onerror="this.classList.add('gone')"></video>
        <div class="cust2-media-scrim" aria-hidden="true"></div>
        <div class="cust2-brand">
          ${c.logo ? `<img class="cust2-logo" src="${esc(c.logo)}" alt="">` : ''}
          <div class="cust2-name">${esc(c.storeName)}</div>
          <div class="cust2-tag">${esc(c.tagline)}</div>
          <div class="cust2-lanterns" aria-hidden="true"><span>🏮</span><span>🏮</span><span>🏮</span></div>
          <div class="cust2-welcome">Xin chào · Welcome 🌸</div>
        </div>
      </div>
      <div class="cust2-order">${parts.order}</div>
    </div>`;
  }
  // Repaint just the dynamic half + root class — keeps the <video> element alive.
  function paintBackScreen() {
    const root = $('#view'); if (!root) return;
    const shell = root.querySelector('.cust2');
    const order = shell && shell.querySelector('.cust2-order');
    if (!shell || !order) { root.innerHTML = renderBackScreen(); return; }
    const parts = backScreenParts();
    shell.className = 'cust2' + parts.rootClass;
    order.innerHTML = parts.order;
  }

  // Returns { rootClass, order } for the customer display's right (order) half.
  function backScreenParts() {
    const cart = S.getCart();
    const t = S.computeTotals(cart);
    const c = S.getConfig();
    const live = S.getLive();
    const fresh = liveFresh(live);
    const bg = `<img class="cust2-order-bg" src="assets/images/food-spread.jpg" alt="" aria-hidden="true">
      <div class="cust2-order-veil" aria-hidden="true"></div>`;

    // Self-revert the thank-you even if the counter window is closed.
    clearTimeout(backScreenTimer);
    if (fresh && live.mode === 'done') {
      backScreenTimer = setTimeout(() => { if (ui.view === 'backscreen') paintBackScreen(); },
        Math.max(600, 12000 - (Date.now() - live.ts)));
    }

    // ---- THANK YOU (payment complete) ------------------------------------
    if (fresh && live.mode === 'done') {
      const name = (live.customerName || '').trim();
      const firstName = name ? esc(name.split(' ')[0]) : '';
      return { rootClass: ' is-thanks', order: `${bg}
        <div class="thanks-card">
          <div class="thanks-check">✓</div>
          <div class="thanks-store">${esc(c.storeName)}</div>
          <h1 class="thanks-title">Thank you${firstName ? ', ' + firstName : ''}! 🌸</h1>
          <div class="thanks-sub">Cảm ơn quý khách đã ghé ${esc(c.storeName)}</div>
          <div class="thanks-meta">
            <span class="tm-order">Order #${esc(live.code || '')}</span>
            ${live.pager ? `<span class="tm-pager">📟 Pager ${esc(live.pager)}</span>` : ''}
            <span class="tm-type">${live.orderType === 'dine-in' ? '🍜 Dine-in' : '🥡 Take-away'}</span>
          </div>
          <div class="thanks-money">
            <div class="tmo paid"><span>Paid</span><b>${money(live.paid != null ? live.paid : live.total)}</b></div>
            ${live.change > 0 ? `<div class="tmo change"><span>💸 Your change</span><b>${money(live.change)}</b></div>` : ''}
          </div>
          ${(live.payments && live.payments.length) ? `<div class="thanks-tenders">
            ${live.payments.map((p) => `<span>${tenderIcon(p.method)} ${cap(p.method)} ${money(p.amount)}</span>`).join('')}
          </div>` : ''}
          ${live.points ? `<div class="thanks-points">⭐ +${live.points} points earned${live.memberPoints != null ? ` · ${live.memberPoints} total` : ''}</div>` : ''}
          <div class="thanks-foot">Hẹn gặp lại quý khách · See you again 💛</div>
        </div>` };
    }

    // ---- ORDER / LIVE PAYMENT --------------------------------------------
    const paying = fresh && live.mode === 'pay';
    const empty = !t.lines.length && !paying;
    const dueTotal = paying ? live.total : t.total;

    if (empty) {
      return { rootClass: '', order: `${bg}
        <div class="cust2-card is-empty">
          <div class="cust2-empty">
            <div class="cust2-empty-ico">🥢</div>
            <h2>Welcome to ${esc(c.storeName)}</h2>
            <p>Your items will appear here as we add them.</p>
          </div>
        </div>` };
    }

    const memberBadge = (paying && live.member)
      ? `<div class="cust2-member">⭐ Welcome back, ${esc(String(live.member.name).split(' ')[0])} · ${live.member.points} pts</div>` : '';

    let foot;
    if (paying) {
      const ledger = (live.tenders || []).map((p) =>
        `<div class="cpl-row"><span>${tenderIcon(p.method)} ${cap(p.method)}</span><b>${money(p.amount)}</b></div>`).join('');
      const entry = live.cashEntry ? `<div class="cpl-row entry"><span>💵 Counting…</span><b>${money(live.cashEntry)}</b></div>` : '';
      const cardWaiting = live.cardStage === 'waiting'
        ? `<div class="cpl-row entry"><span>💳 Card · tap or insert…</span><b>${money(live.cardAmount)}</b></div>` : '';
      let status;
      if (live.change > 0) status = `<div class="cps change"><span>💸 Change due</span><b>${money(live.change)}</b></div>`;
      else if (live.remaining > 0) status = `<div class="cps remain"><span>Left to pay</span><b>${money(live.remaining)}</b></div>`;
      else status = `<div class="cps settled">✓ Paid in full · Cảm ơn!</div>`;
      foot = `
        <div class="cust2-foot paying">
          <div class="cust-total-row"><span>Total to pay</span><b>${money(dueTotal)}</b></div>
          ${ledger || entry || cardWaiting ? `<div class="cust-ledger">${ledger}${entry}${cardWaiting}
            ${(live.tenders && live.tenders.length) ? `<div class="cpl-row sum"><span>Received</span><b>${money(live.paid)}</b></div>` : ''}
          </div>` : ''}
          ${status}
        </div>`;
    } else {
      foot = `
        <div class="cust2-foot">
          ${t.totalDiscount > 0 ? `<div class="cust-save">🎉 You save ${money(t.totalDiscount)}</div>` : ''}
          <div class="cust-total-row"><span>Total ${t.taxInclusive ? `<em>incl. ${esc(c.taxLabel)}</em>` : ''}</span><b>${money(dueTotal)}</b></div>
          <div class="cust-pay">Please pay at the counter · Cảm ơn quý khách 🌸</div>
        </div>`;
    }

    return { rootClass: paying ? ' is-paying' : '', order: `${bg}
      <div class="cust2-card">
        <div class="cust2-card-top">
          <span class="cust2-card-title">${paying ? '💳 Payment' : '🧾 Your order'}</span>
          <span class="cust2-type">${cart.orderType === 'dine-in' ? '🍜 Dine-in' : '🥡 Take-away'}${cart.pager ? ' · #' + esc(cart.pager) : ''}</span>
        </div>
        ${memberBadge}
        <div class="cust2-list">
          ${t.lines.map((l) => `
            <div class="cust-line">
              <span class="cust-q">${l.qty}×</span>
              <span class="cust-n">${esc(l.name)}${(l.addons && l.addons.length) ? `<em>+ ${l.addons.map((a) => esc(a.name)).join(', ')}</em>` : ''}${l.note ? `<em>“${esc(l.note)}”</em>` : ''}</span>
              <span class="cust-amt">${money(l.lineNet)}</span>
            </div>`).join('')}
        </div>
        ${foot}
      </div>` };
  }

  /* ====================================================================== *
   * STANDING ORDER TREE  (self-service kiosk)
   * attract(video) → home → menu(+cart) → member → pay → done(queue ticket)
   * Orders share the SAME daily queue number as the counter (nextDailyNo).
   * ====================================================================== */
  const KIOSK_ADS = ['assets/videos/ad1.mp4', 'assets/videos/ad2.mp4'];
  const KIOSK_HOME_VIDS = ['assets/videos/vid-180.mp4', 'assets/videos/vid-223.mp4'];
  const LOGIN_VIDS = ['assets/videos/vid-952.mp4', 'assets/videos/vid-847.mp4'];
  let kioskCart = newKioskCart();
  let kioskOrder = null, kioskAdIdx = 0, kioskHomeIdx = 0, kioskPayTok = null, kioskDoneTimer = null;
  let kioskSheet = null, kioskIdleTimer = null;
  // advance a looping <video> through a playlist of clips
  function cycleVid(v, list, key) {
    const i = ((v.__i || 0) + 1) % list.length; v.__i = i; v.src = list[i];
    const p = v.play(); if (p && p.catch) p.catch(() => {});
  }
  function kioskNextHomeAd(v) { cycleVid(v, KIOSK_HOME_VIDS); }
  function loginNextVid(v) { cycleVid(v, LOGIN_VIDS); }
  function newKioskCart() { return { lines: [], orderType: 'take-away', table: '', customer: '', pager: '', discount: { mode: 'none', value: 0 }, note: '' }; }

  function openKiosk() {
    kioskCart = newKioskCart(); kioskOrder = null; ui.member = null;
    ui.kioskStage = 'attract'; ui.kioskCat = S.getCategories()[0].id; ui.kioskPayStage = 'review'; ui.kioskCartOpen = false;
    ui.view = 'kiosk'; renderTopbar(); render();
  }
  function kioskPaint() { const v = $('#view'); if (v) v.innerHTML = renderKiosk(); armKioskIdle(); }

  // Inactivity → return to the attract loop so an abandoned order never lingers.
  function armKioskIdle() {
    clearTimeout(kioskIdleTimer);
    if (ui.view !== 'kiosk' || ui.kioskStage === 'attract' || ui.kioskStage === 'done') return;
    kioskIdleTimer = setTimeout(() => {
      if (ui.view === 'kiosk' && ui.kioskStage !== 'attract' && ui.kioskStage !== 'done') {
        kioskCart = newKioskCart(); ui.member = null; ui.kioskFilter = 'all'; kioskSheet = null;
        closeModal(); ui.kioskStage = 'attract'; kioskPaint();
      }
    }, 70000);
  }

  function kioskGo(stage) { if (stage !== 'done') clearTimeout(kioskDoneTimer); if (stage !== 'menu') ui.kioskCartOpen = false; ui.kioskStage = stage; kioskPaint(); }
  function kioskToggleCart() { ui.kioskCartOpen = !ui.kioskCartOpen; kioskPaint(); }
  function kioskBack() { ui.kioskStage = kioskCart.lines.length ? 'menu' : 'home'; kioskPaint(); }
  function kioskNextAd(v) { kioskAdIdx = (kioskAdIdx + 1) % KIOSK_ADS.length; v.src = KIOSK_ADS[kioskAdIdx]; const p = v.play(); if (p && p.catch) p.catch(() => {}); }
  function kioskLangToggle() { ui.kioskLang = ui.kioskLang === 'en' ? 'vi' : 'en'; kioskPaint(); }
  function kioskSetLang(l) { if (ui.kioskLang === l) return; ui.kioskLang = l; kioskPaint(); }
  function kioskFilterSet(f) { ui.kioskFilter = f; kioskPaint(); }

  function kioskItemCount() { return kioskCart.lines.reduce((s, l) => s + l.qty, 0); }
  function kioskLineQty(itemId) { return kioskCart.lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0); }
  function kioskFindPlain(itemId) {
    return kioskCart.lines.find((l) => l.itemId === itemId && !l.isCombo
      && !(l.addons && l.addons.length) && !(l.mods && l.mods.length) && !l.note);
  }
  // Quick add (no options) — straight onto the cart, merging identical plain lines.
  function kioskQuickAdd(itemId) {
    const item = S.findItem(itemId);
    if (!item || item.available === false) return;
    if (item.isCombo) return kioskOpenItem(itemId);   // combos must pick fillings
    const ex = kioskFindPlain(itemId);
    if (ex) ex.qty += 1; else kioskCart.lines.push(S.buildLine(item, { qty: 1 }));
    // On the menu, update only the tapped card + bottom bar — no full repaint.
    if (ui.kioskStage === 'menu' && kioskSyncCard(itemId)) { kioskSyncBar(); armKioskIdle(); return; }
    if (ui.kioskStage === 'home') ui.kioskStage = 'menu';
    kioskPaint();
  }
  function kioskAdd(itemId) { kioskQuickAdd(itemId); }
  function kioskQuickDec(itemId) {
    const ex = kioskFindPlain(itemId) || [...kioskCart.lines].reverse().find((l) => l.itemId === itemId);
    if (!ex) return;
    ex.qty -= 1;
    if (ex.qty <= 0) kioskCart.lines = kioskCart.lines.filter((l) => l !== ex);
    if (ui.kioskStage === 'menu' && kioskSyncCard(itemId)) { kioskSyncBar(); armKioskIdle(); return; }
    if (!kioskCart.lines.length && ui.kioskStage === 'pay') ui.kioskStage = 'menu';
    kioskPaint();
  }
  function kioskSetCat(id) { ui.kioskCat = id; ui.kioskFilter = 'all'; kioskPaint(); }
  function kioskSetOrderType(t) { kioskCart.orderType = t; kioskPaint(); }
  function kioskQty(uid, d) {
    const l = kioskCart.lines.find((x) => x.uid === uid); if (!l) return;
    if (d === -99) l.qty = 0; else l.qty += d;
    if (l.qty <= 0) kioskCart.lines = kioskCart.lines.filter((x) => x.uid !== uid);
    if (!kioskCart.lines.length && ui.kioskStage === 'pay') ui.kioskStage = 'menu';
    kioskPaint();
  }
  function kioskScan(code) {
    const m = S.findMember(code);
    if (!m) return toast('Membership not found — check the code');
    ui.member = m; toast('Welcome back, ' + String(m.name).split(' ')[0] + '! ⭐');
    if (ui.kioskStage === 'member') kioskBack(); else kioskPaint();
  }
  function kioskLookup() { const el = $('#kx-code') || $('#kx-code-inline'); kioskScan(el ? el.value : ''); }
  function kioskClearMember() { ui.member = null; kioskPaint(); }

  /* ---- kiosk i18n (UI chrome only — dish names stay as entered) ---------- */
  const KT_DICT = {
    start_order:  { en: 'Start your order →', vi: 'Bắt đầu gọi món →' },
    scan_member:  { en: 'Scan member', vi: 'Quét thành viên' },
    scan_cta:     { en: 'Scan membership to earn points', vi: 'Quét thành viên để tích điểm' },
    popular_now:  { en: 'Popular right now', vi: 'Đang bán chạy' },
    h1a:          { en: 'Order fresh.', vi: 'Đồ tươi mỗi ngày.' },
    h1b:          { en: 'Eat happy.', vi: 'Ăn ngon mỗi bữa.' },
    home_sub:     { en: 'Authentic Vietnamese street food — freshly made to order.', vi: 'Ẩm thực đường phố Việt — làm tươi theo yêu cầu.' },
    street_food:  { en: 'Vietnamese Street Food', vi: 'Ẩm thực đường phố Việt' },
    tap_h:        { en: 'Tap to order', vi: 'Chạm để gọi món' },
    tap_sub:      { en: 'Tap anywhere to start your order', vi: 'Chạm vào màn hình để bắt đầu' },
    all:          { en: 'All', vi: 'Tất cả' },
    popular:      { en: 'Popular', vi: 'Bán chạy' },
    veg:          { en: 'Veg', vi: 'Chay' },
    spicy:        { en: 'Spicy', vi: 'Cay' },
    new:          { en: 'New', vi: 'Mới' },
    add:          { en: 'Add', vi: 'Thêm' },
    choose:       { en: 'Choose', vi: 'Chọn' },
    items:        { en: 'items', vi: 'món' },
    your_order:   { en: 'Your order', vi: 'Đơn của bạn' },
    review_checkout: { en: 'Review & checkout', vi: 'Xem lại & thanh toán' },
    checkout:     { en: 'Checkout', vi: 'Thanh toán' },
    total:        { en: 'Total', vi: 'Tổng' },
    subtotal:     { en: 'Subtotal', vi: 'Tạm tính' },
    promo:        { en: 'Promotion', vi: 'Khuyến mãi' },
    review_pay:   { en: 'Review & pay', vi: 'Xem lại & thanh toán' },
    back_menu:    { en: 'Back to menu', vi: 'Về thực đơn' },
    dine_in:      { en: 'Dine-in', vi: 'Tại quán' },
    take_away:    { en: 'Take-away', vi: 'Mang đi' },
    add_drink:    { en: 'Add a drink or dessert?', vi: 'Thêm nước hoặc tráng miệng?' },
    earn:         { en: 'earn', vi: 'tích' },
    membership:   { en: 'Membership', vi: 'Thành viên' },
    scan_hint:    { en: 'Card code or phone', vi: 'Mã thẻ hoặc SĐT' },
    look_up:      { en: 'Look up', vi: 'Tra cứu' },
    pay_card:     { en: 'Pay by card', vi: 'Thanh toán thẻ' },
    pay_note:     { en: 'Paying cash? Please order at the counter. 🌸', vi: 'Trả tiền mặt? Vui lòng gọi món tại quầy. 🌸' },
    choose_options: { en: 'Choose your options', vi: 'Chọn tuỳ chọn' },
    required:     { en: 'Required', vi: 'Bắt buộc' },
    note_kitchen: { en: 'Note for the kitchen', vi: 'Ghi chú cho bếp' },
    note_ph:      { en: 'e.g. no coriander, extra spicy', vi: 'vd: không ngò, thêm cay' },
    add_to_order: { en: 'Add to order ·', vi: 'Thêm vào đơn ·' },
    step_choose:  { en: 'Choose', vi: 'Chọn món' },
    step_review:  { en: 'Review', vi: 'Xem lại' },
    step_pay:     { en: 'Pay', vi: 'Thanh toán' },
    step_done:    { en: 'Queue', vi: 'Số thứ tự' },
    order_placed: { en: 'Order placed!', vi: 'Đặt món thành công!' },
    queue_no:     { en: 'Your queue number', vi: 'Số thứ tự của bạn' },
    collect_note: { en: 'Please collect at the counter when your number is called.', vi: 'Vui lòng nhận món tại quầy khi gọi số của bạn.' },
    new_order:    { en: 'New order', vi: 'Đơn mới' },
    processing:   { en: 'Processing payment… tap or insert your card', vi: 'Đang xử lý… chạm hoặc đưa thẻ vào' },
    empty_cart:   { en: 'Tap dishes to add them here', vi: 'Chạm món để thêm vào đây' },
    sign_out:     { en: 'Sign out', vi: 'Đăng xuất' },
    cont_guest:   { en: 'Continue as guest →', vi: 'Tiếp tục không thành viên →' },
    member_rewards: { en: 'Membership rewards', vi: 'Ưu đãi thành viên' },
    add_member_earn: { en: 'Add membership to earn', vi: 'Thêm thành viên để tích' },
    points:       { en: 'points', vi: 'điểm' },
    view_checkout: { en: 'View & checkout', vi: 'Xem & thanh toán' },
    add_more:     { en: 'Add more items', vi: 'Thêm món khác' },
    how_serve:    { en: 'How would you like your order?', vi: 'Bạn dùng tại quán hay mang đi?' },
    incl:         { en: 'incl.', vi: 'đã gồm' },
    print_receipt: { en: 'Print receipt', vi: 'In hoá đơn' },
    save_pdf:     { en: 'Save PDF', vi: 'Tải PDF' }
  };
  function kt(k) { const e = KT_DICT[k]; return e ? (e[ui.kioskLang] || e.en) : k; }

  /* ---- kiosk quick filters ---------------------------------------------- */
  const KIOSK_NEW = ['rc-tofu-egg', 'bm-super-roll', 'ph-beef-rib', 'jc-green-glow', 'bk-banh-tieu-rubi'];
  function kioskItemTags(it) {
    const n = (it.name || '').toLowerCase();
    const tags = [];
    if (it.veg || /tofu|veg|mushroom|avocado|đậu|chay/.test(n)) tags.push('veg');
    if (it.spicy || /bun bo hue|bún bò|spicy|chili|sa\s?tế|satay|sate|cay|tóp/.test(n)) tags.push('spicy');
    if (it.isNew || KIOSK_NEW.includes(it.id)) tags.push('new');
    return tags;
  }
  function kioskFilteredItems() {
    const f = ui.kioskFilter;
    if (f === 'all') return S.itemsByCategory(ui.kioskCat || S.getCategories()[0].id);
    if (f === 'popular') return kioskPopular(30);
    return S.getMenu().filter((it) => it.available !== false && !it.isCombo && kioskItemTags(it).includes(f));
  }

  /* ---- item detail / customise bottom-sheet ----------------------------- */
  function kioskOpenItem(itemId) {
    const item = S.findItem(itemId);
    if (!item || item.available === false) return;
    if (item.isCombo) kioskSheet = { item, combo: true, picks: item.combo.slots.map(() => null), qty: 1 };
    else kioskSheet = { item, combo: false, addons: [], mods: [], note: '', qty: 1 };
    renderKioskSheet();
  }
  function kioskSheetClose() { kioskSheet = null; closeModal(); }
  function kioskSheetQty(d) { if (!kioskSheet) return; kioskSheet.qty = Math.max(1, kioskSheet.qty + d); renderKioskSheet(); }
  function kioskSheetAddonQty(name, price) { const r = kioskSheet.addons.find((a) => a.name === name && a.price === price); return r ? r.qty : 0; }
  function kioskSheetAddon(name, price, delta) {
    let row = kioskSheet.addons.find((a) => a.name === name && a.price === price);
    if (!row) { if (delta < 0) return; row = { name, price, qty: 0 }; kioskSheet.addons.push(row); }
    row.qty += delta;
    if (row.qty <= 0) kioskSheet.addons = kioskSheet.addons.filter((a) => a !== row);
    renderKioskSheet();
  }
  function kioskSheetMod(name) {
    const i = kioskSheet.mods.indexOf(name);
    if (i >= 0) kioskSheet.mods.splice(i, 1); else kioskSheet.mods.push(name);
    renderKioskSheet();
  }
  function kioskSheetNote(v) { if (kioskSheet) kioskSheet.note = v; }
  function kioskSheetUnit() {
    const s = kioskSheet;
    if (s.combo) return s.item.price;
    return (s.item.price || 0) + s.addons.reduce((a, x) => a + x.price * x.qty, 0);
  }
  function kioskComboPick(i, itemId) {
    const m = S.findItem(itemId);
    kioskSheet.picks[i] = { itemId, name: S.displayName(m), slot: kioskSheet.item.combo.slots[i].label };
    renderKioskSheet();
  }
  function kioskSheetSave() {
    const s = kioskSheet; if (!s) return;
    if (s.combo) {
      if (!s.picks.every((p) => p)) return toast('Please choose all options');
      for (let i = 0; i < s.qty; i++) kioskCart.lines.push(S.buildLine(s.item, { components: s.picks.map((p) => ({ name: p.name, itemId: p.itemId, slot: p.slot })) }));
    } else {
      const plain = !s.addons.length && !s.mods.length && !(s.note || '').trim();
      if (plain) { const ex = kioskFindPlain(s.item.id); if (ex) ex.qty += s.qty; else kioskCart.lines.push(S.buildLine(s.item, { qty: s.qty })); }
      else kioskCart.lines.push(S.buildLine(s.item, { qty: s.qty, addons: s.addons, mods: s.mods, note: (s.note || '').trim() }));
    }
    const name = s.item.name;
    kioskSheet = null; closeModal();
    if (ui.kioskStage === 'home') ui.kioskStage = 'menu';
    kioskPaint();
    toast(name + ' added 🥢');
  }
  function renderKioskSheet() {
    const s = kioskSheet; if (!s) return;
    const item = s.item;
    let body;
    if (s.combo) {
      body = item.combo.slots.map((slot, i) => {
        const opts = S.getMenu().filter((m) => slot.from.includes(m.cat) && m.available !== false && !m.isCombo);
        return `<div class="kxs-group">
          <div class="kxs-group-h">${esc(slot.label)} ${s.picks[i] ? '<span class="ok">✓</span>' : `<span class="req">${kt('required')}</span>`}</div>
          <div class="kxs-opts">${opts.map((o) => `<button class="kxs-opt ${s.picks[i] && s.picks[i].itemId === o.id ? 'sel' : ''}" onclick="UI.kioskComboPick(${i},'${o.id}')">${esc(o.name)}</button>`).join('')}</div>
        </div>`;
      }).join('');
    } else {
      const groups = S.groupsForItem(item);
      const priced = groups.filter((g) => !g.free);
      const free = groups.filter((g) => g.free);
      const pricedHtml = priced.map((g) => `<div class="kxs-group"><div class="kxs-group-h">${esc(g.name)}</div>
        <div class="kxs-rows">${g.options.map((o) => { const q = kioskSheetAddonQty(o.name, o.price); return `<div class="kxs-row ${q ? 'on' : ''}">
          <span class="kxs-opt-n">${esc(o.name)} <em>+${money(o.price)}</em></span>
          <div class="kx-step sm"><button onclick="UI.kioskSheetAddon('${esc(o.name)}',${o.price},-1)" ${q ? '' : 'disabled'}>−</button><b>${q}</b><button onclick="UI.kioskSheetAddon('${esc(o.name)}',${o.price},1)">＋</button></div>
        </div>`; }).join('')}</div></div>`).join('');
      const freeHtml = free.map((g) => `<div class="kxs-group"><div class="kxs-group-h">${esc(g.name)}</div>
        <div class="kxs-chips">${g.options.map((o) => `<button class="kxs-chip ${s.mods.includes(o.name) ? 'on' : ''}" onclick="UI.kioskSheetMod('${esc(o.name)}')">${esc(o.name)}</button>`).join('')}</div></div>`).join('');
      body = `${(priced.length || free.length) ? `<div class="kxs-choose">${kt('choose_options')}</div>` : ''}${pricedHtml}${freeHtml}
        <div class="kxs-group"><div class="kxs-group-h">${kt('note_kitchen')}</div>
          <input id="kxs-note" class="kx-code-in full" placeholder="${kt('note_ph')}" value="${esc(s.note || '')}" oninput="UI.kioskSheetNote(this.value)"></div>`;
    }
    const lineTotal = kioskSheetUnit() * s.qty;
    openModal(`<div class="overlay kx-sheet-ov" onclick="UI.kioskSheetClose()">
      <div class="kx-sheet" onclick="event.stopPropagation()">
        <button class="kx-sheet-x" onclick="UI.kioskSheetClose()">✕</button>
        <div class="kx-sheet-hero">
          <img src="${esc(itemImage(item))}" alt="" onerror="this.parentNode.classList.add('noimg')">
          <div class="kx-sheet-head">
            <div class="kx-sheet-title"><h3>${esc(item.name)}</h3><div class="kx-sheet-sub">${esc((S.getCategories().find((c) => c.id === item.cat) || {}).name || '')}${s.combo ? ' · ' + kt('choose_options') : ''}</div></div>
            <div class="kx-sheet-price">${money(item.price)}</div>
          </div>
        </div>
        <div class="kx-sheet-body">${body}</div>
        <div class="kx-sheet-foot">
          <div class="kx-step lg"><button onclick="UI.kioskSheetQty(-1)">−</button><b>${s.qty}</b><button onclick="UI.kioskSheetQty(1)">＋</button></div>
          <button class="kx-sheet-add" onclick="UI.kioskSheetSave()">${kt('add_to_order')} ${money(lineTotal)}</button>
        </div>
      </div>
    </div>`);
  }

  /* ---- upsell (suggest drinks / bakery before pay) ---------------------- */
  function kioskUpsellItems() {
    const have = new Set(kioskCart.lines.map((l) => l.itemId));
    return S.getMenu().filter((m) => ['juice', 'smoothies', 'coffee', 'lemonade', 'bakery'].includes(m.cat)
      && m.available !== false && !m.isCombo && !have.has(m.id)).slice(0, 6);
  }
  function kioskUpsellAdd(id) { kioskQuickAdd(id); }

  /* ---- progress steps --------------------------------------------------- */
  function kioskSteps(active) {
    const steps = ['choose', 'review', 'pay', 'done'];
    return `<div class="kx-prog">${steps.map((k, i) => `<div class="kx-prog-i ${i < active ? 'done' : ''} ${i === active ? 'on' : ''}">
      <span class="kx-prog-no">${i < active ? '✓' : i + 1}</span><span class="kx-prog-lb">${kt('step_' + k)}</span></div>${i < steps.length - 1 ? '<span class="kx-prog-sep"></span>' : ''}`).join('')}</div>`;
  }

  function kioskCardPay() {
    if (!kioskCart.lines.length) return;
    ui.kioskPayStage = 'processing'; kioskPaint();
    const tok = Math.random().toString(36).slice(2); kioskPayTok = tok;
    setTimeout(() => {
      if (kioskPayTok !== tok || ui.view !== 'kiosk') return;
      const t = S.computeTotals(kioskCart);
      // Stamp the member's name onto the ticket so the counter can also look the
      // sale up by customer name (queue # / order id always work regardless).
      if (ui.member) kioskCart.customer = ui.member.name;
      const order = S.completeOrder([{ method: 'card', amount: t.total }],
        { cart: kioskCart, channel: 'kiosk', memberId: ui.member ? ui.member.id : null });
      if (!order) { ui.kioskPayStage = 'review'; kioskPaint(); return toast('Order could not be placed'); }
      kioskOrder = order;
      if (ui.member) ui.member = S.findMember(ui.member.code) || ui.member;   // refresh points
      kioskCart = newKioskCart();
      ui.kioskPayStage = 'review'; ui.kioskStage = 'done'; kioskPaint();
      kioskBumpDone();
    }, 2400);
  }
  // Keep the confirmation (queue number + receipt buttons) on screen long enough
  // to read/print, and push the auto-reset back whenever the guest interacts.
  function kioskBumpDone() {
    clearTimeout(kioskDoneTimer);
    kioskDoneTimer = setTimeout(() => { if (ui.view === 'kiosk' && ui.kioskStage === 'done') kioskNewOrder(); }, 30000);
  }
  // Print / save-PDF the kiosk receipt. The completed order is already in the
  // shared history, so this renders the very same receipt the counter reprints.
  function kioskPrintReceipt() { if (!kioskOrder) return; kioskBumpDone(); printReceipt(kioskOrder.id); }
  function kioskSavePdf() {
    if (!kioskOrder) return;
    kioskBumpDone();
    const o = kioskOrder, area = $('#print-area'); if (!area) return;
    area.classList.remove('report-mode');
    area.innerHTML = receiptHTML(o, true);
    const prev = document.title;                       // becomes the default PDF filename
    document.title = (S.getConfig().storeName || 'MCQ Café') + ' Receipt ' + (o.code || ('#' + o.id));
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    toast('Tip: choose “Save as PDF” to download 📄');
    setTimeout(() => window.print(), 60);
  }
  function kioskNewOrder() { clearTimeout(kioskDoneTimer); ui.member = null; ui.kioskFilter = 'all'; ui.kioskStage = 'attract'; kioskPaint(); }

  function kioskPopular(n) {
    let items = [];
    try {
      const r = S.report(S.dayKey(Date.now() - 29 * 864e5), S.dayKey(Date.now()));
      items = (r.itemRows || []).map((x) => x.itemId && S.findItem(x.itemId))
        .filter((it) => it && it.available !== false);
    } catch (e) { /* no history yet */ }
    const curated = ['ph-mcq-special', 'bm-bbq-brisket', 'bm-trad-pork', 'cf-milk', 'sm-mango', 'rc-pork-chop', 'sz-beef', 'lm-watermelon'];
    const have = new Set(items.map((i) => i.id));
    curated.forEach((id) => { const it = S.findItem(id); if (it && it.available !== false && !have.has(id) && items.length < n) { items.push(it); have.add(id); } });
    return items.slice(0, n);
  }

  function renderKiosk() {
    const stage = ui.kioskStage;
    const body = stage === 'home' ? kioskHome()
      : stage === 'menu' ? kioskMenu()
      : stage === 'member' ? kioskMember()
      : stage === 'pay' ? kioskPayView()
      : stage === 'done' ? kioskDone()
      : kioskAttract();
    return `<div class="kx-root kx-stage-${stage}">
      <button class="screen-exit kx-exit" onclick="UI.exitScreen()" title="Exit kiosk (admin)">✕</button>
      ${body}
    </div>`;
  }
  function kioskAttract() {
    const marquee = kioskPopular(8).map((it) => `${esc(it.name)} · ${money(it.price)}`).join('  🥢  ');
    return `<div class="kx-attract" onclick="UI.kioskGo('home')">
      <img class="kx-bg" src="assets/images/login-bg.jpg?v=23" alt="" aria-hidden="true">
      <video class="kx-video" src="${KIOSK_ADS[0]}" autoplay muted playsinline preload="auto"
        poster="assets/images/login-bg.jpg?v=27"
        onended="UI.kioskNextAd(this)" onerror="this.classList.add('gone')"></video>
      <div class="kx-attract-scrim" aria-hidden="true"></div>
      <div class="kx-lanterns" aria-hidden="true">${'<span>🏮</span>'.repeat(6)}</div>
      <div class="kx-attract-inner">
        <div class="kx-eyebrow">${esc(S.getConfig().storeName)} · Vietnamese Street Food</div>
        <h1 class="kx-tap-cta">Tap anywhere<br>to start your order</h1>
        <div class="kx-tap-pulse"><span></span></div>
      </div>
      ${marquee ? `<div class="kx-marquee" aria-hidden="true"><div class="kx-marquee-track">${marquee}  🥢  ${marquee}</div></div>` : ''}
    </div>`;
  }
  function kioskBar() {
    const m = ui.member;
    const c = S.getConfig();
    return `<header class="kx-bar">
      <button class="kx-brand" onclick="UI.kioskGo('home')">
        ${c.logo ? `<img src="${esc(c.logo)}" alt="">` : '🛎️'}<span>${esc(c.storeName)}</span>
      </button>
      <div class="kx-bar-right">
        <div class="kx-lang" role="group" aria-label="Language">
          <button class="${ui.kioskLang === 'en' ? 'on' : ''}" onclick="UI.kioskSetLang('en')">EN</button>
          <button class="${ui.kioskLang === 'vi' ? 'on' : ''}" onclick="UI.kioskSetLang('vi')">VI</button>
        </div>
        <button class="kx-chip ${m ? 'on' : ''}" onclick="UI.kioskGo('member')">${m ? `⭐ ${esc(String(m.name).split(' ')[0])} · ${m.points} pts` : '📷 ' + kt('scan_member')}</button>
      </div>
    </header>`;
  }
  // The card footer (add button ⇄ in-place stepper). Shared by the full render
  // and the surgical sync so they never drift.
  function kioskCardCtrl(item, qty, soldOut) {
    if (soldOut) return '<span class="kx-ctrl-sold">Sold out</span>';
    if (qty > 0) return `<div class="kx-step card" onclick="event.stopPropagation()">
        <button aria-label="Less" onclick="UI.kioskQuickDec('${item.id}')">−</button><b>${qty}</b>
        <button aria-label="More" onclick="UI.kioskQuickAdd('${item.id}')">＋</button></div>`;
    return `<button class="kx-card-add" onclick="event.stopPropagation();UI.kioskQuickAdd('${item.id}')">＋ ${kt('add')}</button>`;
  }
  function kioskCard(item, big) {
    const cat = S.getCategories().find((c) => c.id === item.cat) || {};
    const soldOut = item.available === false;
    const qty = kioskLineQty(item.id);
    // The qty badge is always present (hidden at 0) so a tap can update it in
    // place without rebuilding the whole grid — no image reload, no flicker.
    return `<div class="kx-item ${soldOut ? 'sold' : ''} ${big ? 'big' : ''} ${qty > 0 ? 'in-cart' : ''}" data-id="${item.id}" style="--accent:${cat.accent || '#c79a3f'}">
      <button class="kx-item-tap" ${soldOut ? 'disabled aria-disabled="true"' : `onclick="UI.kioskOpenItem('${item.id}')"`}>
        <div class="kx-item-thumb">
          <img src="${esc(itemImage(item))}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">
          <span class="kx-qty-badge ${qty > 0 ? '' : 'kx-hide'}">${qty}</span>
          ${item.isCombo ? '<span class="kx-combo-tag">🎁 Combo</span>' : ''}
          ${soldOut ? '<span class="kx-soldtag">Sold out</span>' : ''}
        </div>
        <div class="kx-item-body"><span class="kx-item-name">${esc(item.name)}</span><span class="kx-item-price">${money(item.price)}</span></div>
      </button>
      <div class="kx-item-ctrl">${kioskCardCtrl(item, qty, soldOut)}</div>
    </div>`;
  }
  // Surgically refresh just one card + the bottom bar (no full repaint).
  function kioskSyncCard(itemId) {
    const item = S.findItem(itemId); if (!item) return false;
    const card = document.querySelector('.kx-item[data-id="' + itemId + '"]'); if (!card) return false;
    const qty = kioskLineQty(itemId);
    card.classList.toggle('in-cart', qty > 0);
    const badge = card.querySelector('.kx-qty-badge');
    if (badge) { badge.textContent = qty; badge.classList.toggle('kx-hide', qty <= 0); }
    const ctrl = card.querySelector('.kx-item-ctrl');
    if (ctrl) ctrl.innerHTML = kioskCardCtrl(item, qty, item.available === false);
    return true;
  }
  function kioskSyncBar() {
    const bar = document.querySelector('.kx-bottombar'); if (!bar) return;
    const count = kioskItemCount();
    bar.classList.toggle('show', count > 0);
    const btn = bar.querySelector('.kx-bb-main'); if (btn) btn.disabled = !count;
    const cnt = bar.querySelector('.kx-bb-count'); if (cnt) cnt.textContent = count;
    const info = bar.querySelector('.kx-bb-info');
    if (info) {
      const label = count + ' ' + ((count === 1 && ui.kioskLang === 'en') ? 'item' : kt('items'));
      info.innerHTML = `<b>${label}</b><span>${money(S.computeTotals(kioskCart).total)}</span>`;
    }
  }
  function kioskHome() {
    const pops = kioskPopular(6);
    const m = ui.member;
    return `<div class="kx-home">
      ${kioskBar()}
      <div class="kx-home-hero">
        <div class="kx-home-media">
          <video class="kx-home-vid" src="${KIOSK_HOME_VIDS[0]}" autoplay muted playsinline preload="auto"
            poster="assets/images/vietnam-hero.jpg"
            onended="UI.kioskNextHomeAd(this)" onerror="this.classList.add('gone')"></video>
          <div class="kx-home-media-fb" aria-hidden="true"><img src="assets/images/vietnam-hero.jpg" alt=""></div>
        </div>
        <div class="kx-home-text">
          <div class="kx-home-eyebrow">🥢 ${kt('street_food')}</div>
          <h1>${kt('h1a')}<br>${kt('h1b')}</h1>
          <p>${kt('home_sub')}</p>
          <button class="kx-start" onclick="UI.kioskGo('menu')">${kt('start_order')}</button>
          <button class="kx-member-cta ${m ? 'on' : ''}" onclick="UI.kioskGo('member')">
            ${m ? `⭐ ${esc(m.name)} · ${m.points} ${kt('points')}` : '📷 ' + kt('scan_cta')}
          </button>
        </div>
      </div>
      <div class="kx-pop">
        <div class="kx-pop-head">🔥 ${kt('popular_now')}</div>
        <div class="kx-pop-row">${pops.map((it) => kioskCard(it, true)).join('')}</div>
      </div>
    </div>`;
  }
  const KIOSK_FILTERS = [['all', '🍽️'], ['popular', '🔥'], ['veg', '🌱'], ['spicy', '🌶️'], ['new', '🆕']];
  function kioskMenu() {
    const cats = S.getCategories();
    const activeCat = ui.kioskCat || cats[0].id;
    const filt = ui.kioskFilter;
    const items = kioskFilteredItems();
    const t = S.computeTotals(kioskCart);
    const count = kioskItemCount();
    const itemsLabel = `${count} ${count === 1 && ui.kioskLang === 'en' ? 'item' : kt('items')}`;
    return `<div class="kx-menu">
      ${kioskBar()}
      <div class="kx-menu-body">
        <nav class="kx-cats" aria-label="Categories">
          ${cats.map((c) => `<button class="kx-cat ${(filt === 'all' && c.id === activeCat) ? 'on' : ''}" style="--accent:${c.accent}" onclick="UI.kioskSetCat('${c.id}')"><span class="kx-cat-ico">${c.icon}</span><span class="kx-cat-tx">${esc(c.name)}</span></button>`).join('')}
        </nav>
        <div class="kx-menu-main">
          <div class="kx-filters">
            ${KIOSK_FILTERS.map(([f, ic]) => `<button class="kx-filter ${filt === f ? 'on' : ''}" onclick="UI.kioskFilterSet('${f}')">${ic} ${kt(f)}</button>`).join('')}
          </div>
          <div class="kx-grid">${items.length ? items.map((it) => kioskCard(it)).join('') : `<div class="kx-empty">${kt('empty_cart')}</div>`}</div>
        </div>
      </div>
      <div class="kx-bottombar ${count ? 'show' : ''}">
        <button class="kx-bb-main" ${count ? '' : 'disabled'} onclick="UI.kioskGo('pay')">
          <span class="kx-bb-basket">🧺<span class="kx-bb-count">${count}</span></span>
          <span class="kx-bb-info"><b>${itemsLabel}</b><span>${money(t.total)}</span></span>
          <span class="kx-bb-cta">${kt('view_checkout')} →</span>
        </button>
      </div>
    </div>`;
  }
  function kioskMember() {
    const members = S.getMembers();
    const m = ui.member;
    return `<div class="kx-member">
      ${kioskBar()}
      <div class="kx-member-inner">
        <button class="kx-back" onclick="UI.kioskBack()">← ${kt('back_menu')}</button>
        <h2>${kt('member_rewards')}</h2>
        <p class="kx-member-sub">${kt('scan_cta')} — ${S.getConfig().pointsPerDollar || 1} ${kt('points')} / ${esc(S.getConfig().currency)}1.</p>
        ${m ? `<div class="kx-mcard found"><div class="kx-mc-star">⭐</div><div class="kx-mc-info"><div class="kx-mc-name">${esc(m.name)}</div><div class="kx-mc-pts">${m.points} ${kt('points')}</div></div><button class="kx-mc-clear" onclick="UI.kioskClearMember()">${kt('sign_out')}</button></div>` : ''}
        <div class="kx-scan">
          <input id="kx-code" class="kx-code-in" placeholder="${kt('scan_hint')}" autocomplete="off">
          <button class="kx-lookup" onclick="UI.kioskLookup()">🔎 ${kt('look_up')}</button>
        </div>
        <div class="kx-demo">
          <span class="kx-demo-label">Demo cards — tap to “scan”:</span>
          <div class="kx-demo-row">${members.map((mm) => `<button class="kx-demo-b" onclick="UI.kioskScan('${esc(mm.code)}')"><b>${esc(mm.code)}</b>${esc(mm.name)} · ${mm.points}pts</button>`).join('')}</div>
        </div>
        <button class="kx-guest" onclick="UI.kioskBack()">${kt('cont_guest')}</button>
      </div>
    </div>`;
  }
  function kioskPayView() {
    const t = S.computeTotals(kioskCart);
    const m = ui.member;
    const c = S.getConfig();
    const earn = Math.max(0, Math.floor(t.total * (c.pointsPerDollar || 1)));
    if (ui.kioskPayStage === 'processing') {
      return `<div class="kx-pay processing">
        <div class="kx-proc">
          <div class="kx-proc-card">💳</div>
          <div class="eftpos-spin"></div>
          <div class="kx-proc-amt">${money(t.total)}</div>
          <div class="kx-proc-txt">${kt('processing')}</div>
        </div>
      </div>`;
    }
    const ot = kioskCart.orderType;
    const ups = kioskUpsellItems();
    const lineExtras = (l) => {
      const bits = [];
      if (l.components && l.components.length) bits.push(`<div class="kx-pi-sub">${l.components.map((cp) => esc(cp.name)).join(' · ')}</div>`);
      if (l.addons && l.addons.length) bits.push(`<div class="kx-pi-sub">${l.addons.map((a) => '+ ' + esc(a.name) + (a.qty > 1 ? ' ×' + a.qty : '')).join(', ')}</div>`);
      if (l.mods && l.mods.length) bits.push(`<div class="kx-pi-sub">${l.mods.map((x) => esc(x)).join(', ')}</div>`);
      if (l.note) bits.push(`<div class="kx-pi-note">📝 ${esc(l.note)}</div>`);
      return bits.join('');
    };
    return `<div class="kx-pay">
      ${kioskBar()}
      <div class="kx-pay-wrap">
        ${kioskSteps(1)}
        <div class="kx-pay-cols">
          <section class="kx-pay-left">
            <button class="kx-back" onclick="UI.kioskGo('menu')">← ${kt('back_menu')}</button>
            <div class="kx-ot">
              <div class="kx-ot-h">${kt('how_serve')}</div>
              <div class="kx-ot-seg">
                <button class="${ot === 'dine-in' ? 'on' : ''}" onclick="UI.kioskSetOrderType('dine-in')">🍽️ ${kt('dine_in')}</button>
                <button class="${ot === 'take-away' ? 'on' : ''}" onclick="UI.kioskSetOrderType('take-away')">🥡 ${kt('take_away')}</button>
              </div>
            </div>
            <h3 class="kx-pay-h">🧺 ${kt('your_order')}</h3>
            <div class="kx-pay-items">
              ${t.lines.map((l) => `<div class="kx-pi">
                <div class="kx-pi-main">
                  <div class="kx-pi-name">${esc(l.name)}</div>
                  ${lineExtras(l)}
                </div>
                <div class="kx-pi-right">
                  <div class="kx-step sm" onclick="event.stopPropagation()">
                    <button aria-label="Less" onclick="UI.kioskQty('${l.uid}',-1)">−</button><b>${l.qty}</b>
                    <button aria-label="More" onclick="UI.kioskQty('${l.uid}',1)">＋</button>
                  </div>
                  <div class="kx-pi-price">${money(l.lineNet)}</div>
                  <button class="kx-pi-rm" onclick="UI.kioskQty('${l.uid}',-99)" title="Remove">🗑</button>
                </div>
              </div>`).join('')}
            </div>
            <button class="kx-addmore" onclick="UI.kioskGo('menu')">＋ ${kt('add_more')}</button>
            ${ups.length ? `<div class="kx-upsell">
              <div class="kx-upsell-h">✨ ${kt('add_drink')}</div>
              <div class="kx-upsell-row">${ups.map((it) => `<button class="kx-up" onclick="UI.kioskUpsellAdd('${it.id}')">
                <span class="kx-up-thumb"><img src="${esc(itemImage(it))}" alt="" loading="lazy" onerror="this.style.display='none'"><span class="kx-up-plus">＋</span></span>
                <span class="kx-up-n">${esc(it.name)}</span>
                <span class="kx-up-p">${money(it.price)}</span>
              </button>`).join('')}</div>
            </div>` : ''}
          </section>
          <aside class="kx-pay-right">
            <div class="kx-sum-card">
              <div class="kx-mini-member">
                ${m ? `<div class="kx-mm-on"><span class="kx-mm-star">⭐</span><span class="kx-mm-tx"><b>${esc(m.name)}</b><em>+${earn} ${kt('points')} → ${m.points + earn}</em></span><button class="kx-mm-x" title="${kt('sign_out')}" onclick="UI.kioskClearMember()">✕</button></div>`
                    : `<div class="kx-mm-h">⭐ ${kt('membership')}</div>
                       <div class="kx-mm-scan"><input id="kx-code-inline" class="kx-mm-in" placeholder="${kt('scan_hint')}" autocomplete="off"><button onclick="UI.kioskLookup()">${kt('look_up')}</button></div>
                       <div class="kx-mm-hint">📷 ${kt('add_member_earn')} ${earn} ${kt('points')}</div>`}
              </div>
              <div class="kx-sum">
                <div class="kx-sum-r"><span>${kt('subtotal')}</span><span>${money(t.gross)}</span></div>
                ${t.totalDiscount > 0 ? `<div class="kx-sum-r save"><span>🏷️ ${kt('promo')}</span><span>−${money(t.totalDiscount)}</span></div>` : ''}
                <div class="kx-sum-r"><span>${esc(c.taxLabel)} ${(c.taxRate * 100).toFixed(0)}%${t.taxInclusive ? ` <em>(${kt('incl')})</em>` : ''}</span><span>${money(t.tax)}</span></div>
                <div class="kx-sum-r grand"><span>${kt('total')}</span><b>${money(t.total)}</b></div>
              </div>
              <button class="kx-paybtn" onclick="UI.kioskCardPay()">💳 ${kt('pay_card')} · ${money(t.total)}</button>
              <div class="kx-pay-note">${kt('pay_note')}</div>
            </div>
          </aside>
        </div>
      </div>
    </div>`;
  }
  function kioskDone() {
    const o = kioskOrder;
    if (!o) return kioskAttract();
    return `<div class="kx-done">
      <img class="kx-bg" src="assets/images/login-bg.jpg?v=22" alt="" aria-hidden="true">
      <div class="kx-attract-scrim" aria-hidden="true"></div>
      <div class="kx-done-inner">
        <div class="kx-prog-wrap dark">${kioskSteps(3)}</div>
        <div class="kx-check">✓</div>
        <h2>${kt('order_placed')}</h2>
        <p class="kx-done-q">${kt('queue_no')}</p>
        <div class="kx-ticket">${esc(o.code)}</div>
        <div class="kx-receipt-actions">
          <button class="kx-rc-btn" onclick="UI.kioskPrintReceipt()">🖨 ${kt('print_receipt')}</button>
          <button class="kx-rc-btn" onclick="UI.kioskSavePdf()">⬇ ${kt('save_pdf')}</button>
        </div>
        <p class="kx-done-sub">${kt('collect_note')}</p>
        ${(o.memberId && o.pointsEarned) ? `<div class="kx-done-pts">⭐ +${o.pointsEarned} ${kt('points')}</div>` : ''}
        <button class="kx-newbtn" onclick="UI.kioskNewOrder()">${kt('new_order')}</button>
      </div>
    </div>`;
  }

  /* ====================================================================== *
   * ON-SCREEN KEYBOARD  (touch devices — notes, customer, table, pager…)
   * The native keyboard still works; this guarantees text entry on a
   * keyboard-less touchscreen / kiosk. Auto-opens on a COARSE pointer only,
   * never on a mouse, so desktops keep using their physical keyboard.
   * ====================================================================== */
  const KBD_TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in global);
  const KBD_ABC = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm']
  ];
  const KBD_SYM = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '&', '*', '(', ')', '_', '+', '='],
    ['-', '/', ':', ';', '\'', '"', '?', '!'],
    ['.', ',', '%', '~', '°', '·']
  ];
  let kbd = { field: null, shift: false, sym: false };

  function kbdManaged(el) {
    if (!el || !el.tagName || (el.hasAttribute && el.hasAttribute('data-nokbd'))) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return t === 'text' || t === 'search' || t === '';
  }
  function kbdEl() {
    let el = document.getElementById('kbd');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kbd';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'On-screen keyboard');
      el.addEventListener('pointerdown', kbdPress);
      document.body.appendChild(el);
    }
    return el;
  }
  function kbdOpenFor(field) {
    kbd.field = field; kbd.sym = false; kbd.shift = false;
    kbdRender();
    document.body.classList.add('kbd-open');
    setTimeout(() => { try { field.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 70);
  }
  function kbdClose() { kbd.field = null; document.body.classList.remove('kbd-open'); }
  function kbdRender() {
    const el = kbdEl();
    const rows = kbd.sym ? KBD_SYM : KBD_ABC;
    const key = (label, act, k, cls) =>
      `<button type="button" class="kbd-k ${cls || ''}" data-act="${act}"${k != null ? ` data-k="${esc(k)}"` : ''}>${esc(label)}</button>`;
    let html = '';
    rows.forEach((row, ri) => {
      let keys = row.map((ch) => key((!kbd.sym && kbd.shift) ? ch.toUpperCase() : ch, 'char', ch)).join('');
      if (ri === rows.length - 1) {
        if (!kbd.sym) keys = key('⇧', 'shift', null, 'fn wide ' + (kbd.shift ? 'on' : '')) + keys;
        keys += key('⌫', 'bs', null, 'fn wide');
      }
      html += `<div class="kbd-row">${keys}</div>`;
    });
    html += `<div class="kbd-row">`
      + key(kbd.sym ? 'ABC' : '?123', 'sym', null, 'fn wide')
      + key('space', 'space', null, 'space')
      + key('Done', 'done', null, 'done wide')
      + `</div>`;
    el.innerHTML = html;
  }
  function kbdPress(e) {
    const btn = e.target && e.target.closest && e.target.closest('.kbd-k');
    if (!btn) return;
    e.preventDefault();  // keep focus in the field — no blur, no native-keyboard fight
    const f = kbd.field;
    const act = btn.dataset.act;
    if (!f && act !== 'done') return;
    if (act === 'char') kbdInsert(f, (!kbd.sym && kbd.shift) ? (btn.dataset.k || '').toUpperCase() : (btn.dataset.k || ''));
    else if (act === 'space') kbdInsert(f, ' ');
    else if (act === 'bs') kbdBackspace(f);
    else if (act === 'shift') { kbd.shift = !kbd.shift; kbdRender(); }
    else if (act === 'sym') { kbd.sym = !kbd.sym; kbdRender(); }
    else if (act === 'done') { if (f) f.blur(); kbdClose(); }
  }
  function kbdInsert(f, text) {
    if (!f || !text) return;
    const s = f.selectionStart != null ? f.selectionStart : f.value.length;
    const en = f.selectionEnd != null ? f.selectionEnd : f.value.length;
    f.value = f.value.slice(0, s) + text + f.value.slice(en);
    const p = s + text.length;
    try { f.setSelectionRange(p, p); } catch (_) {}
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function kbdBackspace(f) {
    if (!f) return;
    const s = f.selectionStart != null ? f.selectionStart : f.value.length;
    const en = f.selectionEnd != null ? f.selectionEnd : f.value.length;
    if (s === en) { if (s === 0) return; f.value = f.value.slice(0, s - 1) + f.value.slice(en); const p = s - 1; try { f.setSelectionRange(p, p); } catch (_) {} }
    else { f.value = f.value.slice(0, s) + f.value.slice(en); try { f.setSelectionRange(s, s); } catch (_) {} }
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---- toast ------------------------------------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  /* ---- misc -------------------------------------------------------------- */
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  /* ---- expose ------------------------------------------------------------ */
  global.UI = {
    init, go, closeModal, confirmYes,
    // auth / shell
    chooseCashier, logout, openAdmin, exitAdmin, toggleTrainingMode, pinKey, pinClear, pinBack,
    // pos
    setCategory, setDrinkSub, onSearch, clearSearch, addItem, itemCardKey, soldSwipeStart, inc, setQty, remove, setType, setPager, setNote, hold, clear,
    // cashier promotions
    openPromoInfo, gotoPromos,
    // customize / discount
    openCustomize, custAdd, custMod, custNote, custSave,
    openDiscount, discMode, discTarget, discVal, discQuick, discToggleItem, discApply, discRemoveAll,
    // combo
    comboPick, comboConfirm,
    // held
    openHeld, recall, delHeld, voidHeld,
    // payment
    openPayment, payMethod, payKey, payAddCash, payExact, payTenderCash, payTenderFull, payRemove, completeSale,
    payCardSend, payCardCancel, cardSetAmt,
    // counter loyalty member
    openMemberScan, memberScanLookup, attachCounterMember, clearCounterMember,
    // receipt / orders
    printReceipt, viewReceipt, setHistoryDay, reprintLast, onOrderSearch, clearOrderSearch,
    // credit & till
    openCredit, creditSet, creditMethod, creditConfirm, printCredit, openTill, printTill,
    // refund
    openRefund, refundPick, refundAll, refundReason, refundReasonSet, refundMethod, refundConfirm, printRefundVoucher,
    // dashboard
    setReportDay, setReportFrom, setReportTo, setReportCat, setQuickRange, exportReportPDF, exportReportExcel, exportAuditLog,
    // menu mgr
    setMenuTab, setPrice, toggleAvail, delItem, newItem, editItem, saveItem,
    uploadItemImage, itemFormUpload, itemFormResetImg,
    // modifier mgr
    mgGroupName, mgOptName, mgOptPrice, mgDelOpt, mgAddOpt, mgDelGroup, mgAddGroup, mgEditGroup, mgSaveGroup,
    // promotions mgr
    promoNew, promoEdit, promoDel, promoSet, promoSetCat, promoExcl, promoSave,
    // settings / staff
    saveSettings, togglePromo, uploadLogo, removeLogo, exportData, importPrompt, resetData,
    userSet, userAdd, userDel,
    // customer display + standing order tree (kiosk)
    openBackScreen, exitScreen, openKiosk, kioskGo, kioskBack, kioskNextAd, kioskNextHomeAd, loginNextVid, kioskToggleCart,
    kioskAdd, kioskSetCat, kioskQty, kioskScan, kioskLookup, kioskClearMember, kioskCardPay, kioskNewOrder,
    kioskSetLang, kioskLangToggle, kioskFilterSet, kioskSetOrderType, kioskQuickAdd, kioskQuickDec,
    kioskOpenItem, kioskSheetClose, kioskSheetQty, kioskSheetAddon, kioskSheetMod, kioskSheetNote,
    kioskComboPick, kioskSheetSave, kioskUpsellAdd, kioskPrintReceipt, kioskSavePdf
  };

  document.addEventListener('DOMContentLoaded', init);
  // keyboard: Esc closes modal (and the on-screen keyboard)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { kbdClose(); closeModal(); } });

  // On-screen keyboard wiring — touch devices only.
  if (KBD_TOUCH) {
    // Mark managed fields readonly *before* focus so the device's native virtual
    // keyboard never appears — only our keyboard does (no double keyboards).
    // JS still writes the value & caret fine on a readonly field.
    document.addEventListener('pointerdown', (e) => {
      if (kbdManaged(e.target)) e.target.setAttribute('readonly', 'readonly');
    }, true);
    document.addEventListener('focusin', (e) => {
      if (kbdManaged(e.target)) { e.target.setAttribute('readonly', 'readonly'); kbdOpenFor(e.target); }
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (a && kbdManaged(a)) return;   // moved to another text field — keep it open
        kbdClose();
      }, 90);
    });
  }

  // Cross-window sync: open the Customer Display (or kiosk) in a second browser
  // window/tab on a guest-facing monitor and it updates live as the counter
  // rings items or an item is marked sold out.
  window.addEventListener('storage', (e) => {
    if (e.key && e.key !== 'mcq_pos_state_v1') return;
    S.load();
    if (ui.view === 'backscreen') { paintBackScreen(); }
    else if (ui.view === 'kiosk' && ui.kioskStage === 'menu') { const v = $('#view'); if (v) v.innerHTML = renderKiosk(); }
    else if (ui.view === 'register' && document.getElementById('pos-cart')) { refreshGrid(); refreshCart(); }
  });
})(window);
