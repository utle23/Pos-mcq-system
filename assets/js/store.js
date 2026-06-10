/* ============================================================================
 * MCQ Café POS — Store (state, persistence, pricing & order engine)
 * Framework-free. Holds the single source of truth and exposes pure-ish
 * helpers used by the UI layer.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const KEY = 'mcq_pos_state_v1';
  const D = global.MCQ_DATA;
  const ITEM_ASSET_VERSION = 12;
  const itemAsset = (id) => 'assets/images/items/' + id + '.jpg?v=' + ITEM_ASSET_VERSION;
  const DRINK_CATS = ['juice', 'smoothies', 'coffee', 'lemonade'];
  const BANH_MI_IMAGE_FIXES = {
    'bm-fried-eggs': itemAsset('bm-fried-eggs'),
    'bm-tofu': itemAsset('bm-tofu'),
    'bm-bbq-brisket': itemAsset('bm-bbq-brisket')
  };
  const PHO_IMAGE_FIXES = {
    'ph-pho-cup': itemAsset('ph-pho-cup')
  };
  const BAKERY_IMAGE_FIXES = {
    'bk-banh-tieu-hollow': itemAsset('bk-banh-tieu-hollow'),
    'bk-banh-tieu-dau': itemAsset('bk-banh-tieu-dau'),
    'bk-banh-tieu-rubi': itemAsset('bk-banh-tieu-rubi'),
    'bk-chao-quay-rubi': itemAsset('bk-chao-quay-rubi'),
    'bk-meat-spring-roll': itemAsset('bk-meat-spring-roll'),
    'bk-fried-pork-dump': itemAsset('bk-fried-pork-dump'),
    'bk-fried-banana': itemAsset('bk-fried-banana'),
    'bk-batiso': itemAsset('bk-batiso')
  };
  const BAKERY_FRONT_ORDER = [
    'bk-banh-tieu-hollow',
    'bk-meat-spring-roll',
    'bk-fried-pork-dump',
    'bk-fried-banana',
    'bk-batiso'
  ];

  /* ---- safe persistence (works even when localStorage is blocked) -------- */
  let memoryFallback = null;
  const storage = {
    read() {
      try { return localStorage.getItem(KEY); }
      catch (e) { return memoryFallback; }
    },
    write(v) {
      try { localStorage.setItem(KEY, v); }
      catch (e) { memoryFallback = v; }
    }
  };

  /* ---- utilities --------------------------------------------------------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function roundCash(n, step) {
    if (!step) return round2(n);
    return round2(Math.round(n / step) * step);
  }

  /* ---- in-memory state --------------------------------------------------- */
  let state = {
    config: clone(D.CONFIG),
    menu: clone(D.MENU),
    promotions: clone(D.PROMOTIONS),
    modifierGroups: clone(D.MODIFIER_GROUPS),
    cart: newCart(),
    held: [],        // parked tickets
    orders: [],      // completed orders (history)
    credits: [],     // manager credits/refunds with no linked receipt
    tills: [],       // ring-off (Z) records
    auditLog: [],    // manager-sensitive actions
    members: clone(D.MEMBERS || []),   // loyalty members (kiosk membership)
    trainingMode: false,
    // Live customer-facing channel: mirrors the counter payment in progress to a
    // second-screen window so the guest sees tendered / change / split live, then
    // a thank-you. { mode:'idle' } | { mode:'pay', ... } | { mode:'done', ... }
    live: { mode: 'idle' }
  };

  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach((fn) => fn(state)); }

  function newCart() {
    return {
      lines: [],
      orderType: 'dine-in',   // 'dine-in' | 'take-away'
      table: '',
      customer: '',
      pager: '',              // pager number (dine-in & take-away)
      discount: { mode: 'none', value: 0 }, // mode: none|percent|amount
      note: ''
    };
  }

  /* ---- load / save ------------------------------------------------------- */
  function load() {
    const raw = storage.read();
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        state.config = Object.assign(clone(D.CONFIG), saved.config || {});
        migrateConfig(saved.config || {});
        state.menu = saved.menu && saved.menu.length ? saved.menu : clone(D.MENU);
        // ensure new default items (e.g. Tofu Rice with Egg) exist after upgrade
        clone(D.MENU).forEach((def) => {
          if (!state.menu.some((m) => m.id === def.id)) state.menu.push(def);
        });
        migrateMenu(saved.config ? (saved.config.seedVersion || 1) : 1);
        state.promotions = saved.promotions && saved.promotions.length ? saved.promotions : clone(D.PROMOTIONS);
        state.modifierGroups = saved.modifierGroups && saved.modifierGroups.length ? saved.modifierGroups : clone(D.MODIFIER_GROUPS);
        // append any newly-shipped default modifier groups (e.g. Rice options)
        clone(D.MODIFIER_GROUPS).forEach((g) => {
          if (!state.modifierGroups.some((x) => x.id === g.id)) state.modifierGroups.push(g);
        });
        state.held = saved.held || [];
        state.orders = saved.orders || [];
        state.credits = saved.credits || [];
        state.tills = saved.tills || [];
        state.auditLog = Array.isArray(saved.auditLog) ? saved.auditLog : [];
        state.members = Array.isArray(saved.members) && saved.members.length ? saved.members : clone(D.MEMBERS || []);
        state.trainingMode = !!saved.trainingMode;
        state.live = saved.live && saved.live.mode ? saved.live : { mode: 'idle' };
        state.cart = saved.cart && saved.cart.lines ? saved.cart : newCart();
      } catch (e) { /* corrupt -> defaults */ }
    }
  }

  // One-time upgrade of persisted store details to a newer seed version.
  // Only overwrites fields the user never customised (still equal to the old
  // placeholder), so manual edits are preserved.
  function migrateConfig(savedConfig) {
    const savedVer = savedConfig.seedVersion || 1;
    if (savedVer >= (D.CONFIG.seedVersion || 1)) return;
    const oldDefaults = {
      tagline: 'Vietnamese Street Kitchen',
      address: '123 Saigon Lane, Melbourne VIC 3000',
      phone: '(03) 9000 0000',
      abn: 'ABN 00 000 000 000'
    };
    Object.keys(oldDefaults).forEach((k) => {
      if (state.config[k] === oldDefaults[k] || state.config[k] == null) {
        state.config[k] = D.CONFIG[k];
      }
    });
    // Adopt the bundled MCQ logo if the user never set one.
    if (savedVer < 5 && !state.config.logo) state.config.logo = D.CONFIG.logo;
    // Ensure staff accounts exist (added in seed v6).
    if (savedVer < 6 && (!state.config.users || !state.config.users.length)) {
      state.config.users = clone(D.CONFIG.users);
    }
    state.config.seedVersion = D.CONFIG.seedVersion;
  }

  // Reconcile specific menu-item flags on upgrade (preserves price edits).
  function migrateMenu(savedVer) {
    if (savedVer < 3) {
      // Pho Cup & BBH Cup are now allowed for dine-in too.
      ['ph-pho-cup', 'ph-bbh-cup'].forEach((id) => {
        const m = state.menu.find((x) => x.id === id);
        if (m) delete m.takeawayOnly;
      });
    }
    if (savedVer < 7) {
      // Wok Fried Tofu → Fried Tofu; remove Grilled Tocino (bánh mì).
      const tofu = state.menu.find((m) => m.id === 'bm-tofu');
      if (tofu && /wok\s*fried\s*tofu/i.test(tofu.name)) tofu.name = 'Fried Tofu';
      state.menu = state.menu.filter((m) => m.id !== 'bm-tocino');
    }
    if (savedVer < 11) {
      // Menu photo cleanup: replace older uploaded/mis-mapped images while
      // preserving each item's current price and other manager edits.
      Object.entries(Object.assign({}, BAKERY_IMAGE_FIXES, BANH_MI_IMAGE_FIXES, PHO_IMAGE_FIXES)).forEach(([id, img]) => {
        const m = state.menu.find((x) => x.id === id);
        if (m) m.img = img;
      });
      const bateso = state.menu.find((m) => m.id === 'bk-batiso');
      if (bateso && bateso.name === 'Batiso') bateso.name = 'Bateso';
      reorderCategoryFirst('bakery', BAKERY_FRONT_ORDER);
    }
    if (savedVer < 12) {
      state.menu = state.menu.filter((m) => m.id !== 'bk-chao-quay');
      reorderCategoryFirst('bakery', BAKERY_FRONT_ORDER);
    }
  }

  function reorderCategoryFirst(catId, firstIds) {
    const firstCategoryIndex = state.menu.findIndex((m) => m.cat === catId);
    if (firstCategoryIndex < 0) return;

    const categoryItems = state.menu.filter((m) => m.cat === catId);
    const byId = new Map(categoryItems.map((m) => [m.id, m]));
    const firstSet = new Set(firstIds);
    const orderedCategory = firstIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .concat(categoryItems.filter((m) => !firstSet.has(m.id)));

    const otherItems = state.menu.filter((m) => m.cat !== catId);
    state.menu = otherItems
      .slice(0, firstCategoryIndex)
      .concat(orderedCategory, otherItems.slice(firstCategoryIndex));
  }

  function persist() {
    storage.write(JSON.stringify({
      config: state.config,
      menu: state.menu,
      promotions: state.promotions,
      modifierGroups: state.modifierGroups,
      cart: state.cart,
      held: state.held,
      orders: state.orders,
      credits: state.credits,
      tills: state.tills,
      auditLog: state.auditLog,
      members: state.members,
      trainingMode: state.trainingMode,
      live: state.live
    }));
  }

  function commit() { persist(); emit(); }

  function audit(action, detail = {}, level = 'info') {
    state.auditLog = state.auditLog || [];
    state.auditLog.unshift({
      id: 'A' + uid(),
      at: Date.now(),
      by: state.config.cashier || 'System',
      action,
      level,
      detail: clone(detail)
    });
    if (state.auditLog.length > 500) state.auditLog.length = 500;
  }

  /* ---- lookups ----------------------------------------------------------- */
  const getConfig = () => state.config;
  const getMenu = () => state.menu;
  const getCart = () => state.cart;
  const getHeld = () => state.held;
  const getOrders = () => state.orders;
  const isTrainingMode = () => !!state.trainingMode;
  const getAuditLog = () => state.auditLog || [];
  function setTrainingMode(on) {
    const next = !!on;
    if (state.trainingMode !== next) audit(next ? 'training.on' : 'training.off', {}, 'notice');
    state.trainingMode = next;
    commit();
  }
  const findItem = (id) => state.menu.find((m) => m.id === id);
  const itemsByCategory = (catId) => state.menu.filter((m) => m.cat === catId);

  /* ---- live customer-facing payment channel (second screen) -------------- */
  const getLive = () => state.live || { mode: 'idle' };
  // Mirror the payment-in-progress / thank-you to any second-screen window.
  // Always carries a timestamp so a stale broadcast can be ignored downstream.
  function setLive(live) {
    state.live = Object.assign({ mode: 'idle' }, live || {}, { ts: Date.now() });
    commit();
  }
  function clearLive() {
    if (state.live && state.live.mode === 'idle') return;   // nothing to clear
    state.live = { mode: 'idle', ts: Date.now() };
    commit();
  }

  function money(n) {
    const c = state.config;
    const sign = n < 0 ? '-' : '';
    return sign + c.currency + Math.abs(round2(n)).toFixed(2);
  }

  /* ====================================================================== *
   * PRICING ENGINE
   * ====================================================================== */

  // Sum of paid add-ons for one unit of a line.
  function addonsUnit(line) {
    return (line.addons || []).reduce((s, a) => s + (a.price || 0) * (a.qty || 1), 0);
  }
  // Base (item) price for a line, tolerant of older saved carts.
  function baseOf(line) {
    return line.basePrice != null ? line.basePrice : (line.unitPrice || 0);
  }

  // Promotion lifecycle status given today's date.
  //   disabled  → switched off by admin
  //   scheduled → switched on but start date is in the future
  //   expired   → end date has passed
  //   active    → currently valid and applied at checkout
  function promotionStatus(p) {
    if (!p.active) return 'disabled';
    const today = dayKey(Date.now());
    if (p.startDate && today < p.startDate) return 'scheduled';
    if (p.endDate && today > p.endDate) return 'expired';
    return 'active';
  }
  const promotionActiveNow = (p) => promotionStatus(p) === 'active';

  // Discount applicable to a single cart line (auto promotions).
  // IMPORTANT: the percentage applies to the BASE price only — never to paid
  // add-ons (e.g. you don't give 15% off an added $5 roast pork).
  function linePromo(line) {
    const menuItem = findItem(line.itemId);
    if (line.noDiscount || (menuItem && menuItem.noDiscount)) return null;
    for (const p of state.promotions) {
      if (!promotionActiveNow(p)) continue;
      if (p.type === 'category_percent') {
        if (line.isCombo && p.excludeCombos) continue;
        if (line.cat !== p.category) continue;
        if ((p.excludeItemIds || []).includes(line.itemId)) continue;
        const perUnit = round2(baseOf(line) * (p.percent / 100));
        return { id: p.id, name: p.name, perUnit, amount: round2(perUnit * line.qty) };
      }
    }
    return null;
  }

  // Manual discount amount for a base value, given a {mode,value} rule.
  function discountAmount(rule, baseValue) {
    if (!rule || rule.mode === 'none' || !rule.value) return 0;
    if (rule.mode === 'percent') return round2(baseValue * (Math.max(0, Math.min(100, rule.value)) / 100));
    if (rule.mode === 'amount') return round2(Math.max(0, Math.min(baseValue, rule.value)));
    return 0;
  }

  function computeTotals(cart) {
    const c = state.config;
    let gross = 0, promoDiscount = 0, lineManualTotal = 0;
    const lines = cart.lines.map((line) => {
      const base = baseOf(line);
      const addUnit = round2(addonsUnit(line));
      const unitPrice = round2(base + addUnit);
      const lineGross = round2(unitPrice * line.qty);
      const promo = linePromo(line);
      const promoAmt = promo ? promo.amount : 0;
      const afterPromo = round2(lineGross - promoAmt);
      // per-line manual discount (admin, applied to selected items)
      const lineManual = discountAmount(line.discount, afterPromo);
      gross += lineGross;
      promoDiscount += promoAmt;
      lineManualTotal += lineManual;
      return {
        ...line, basePrice: base, addonsUnit: addUnit, unitPrice, lineGross,
        promo, promoAmt, lineManual, lineDiscount: round2(promoAmt + lineManual),
        lineNet: round2(afterPromo - lineManual)
      };
    });

    const afterLine = round2(gross - promoDiscount - lineManualTotal);

    // Order-level manual discount applies AFTER promotions + line discounts
    const orderManual = discountAmount(cart.discount, afterLine);
    const manualDiscount = round2(lineManualTotal + orderManual);
    const net = round2(afterLine - orderManual);

    let tax, total;
    if (c.taxInclusive) {
      total = net;
      tax = round2(net - net / (1 + c.taxRate));
    } else {
      tax = round2(net * c.taxRate);
      total = round2(net + tax);
    }

    const cashTotal = roundCash(total, c.cashRounding);
    const cashRoundingAdj = round2(cashTotal - total);

    return {
      lines,
      itemCount: cart.lines.reduce((s, l) => s + l.qty, 0),
      gross: round2(gross),
      promoDiscount: round2(promoDiscount),
      lineManual: round2(lineManualTotal),
      orderManual: round2(orderManual),
      manualDiscount,
      totalDiscount: round2(promoDiscount + manualDiscount),
      net,
      tax,
      total: round2(total),
      cashTotal,
      taxInclusive: c.taxInclusive,
      roundingAdj: 0,
      cashRoundingAdj
    };
  }

  function paymentTotal(totals, payments) {
    const hasCash = payments.some((p) => p.method === 'cash');
    const hasNonCash = payments.some((p) => p.method !== 'cash');
    const useCashRounding = hasCash && !hasNonCash;
    const total = useCashRounding ? (totals.cashTotal != null ? totals.cashTotal : totals.total) : totals.total;
    return {
      total: round2(total),
      roundingAdj: useCashRounding ? round2(total - totals.total) : 0
    };
  }

  /* ====================================================================== *
   * CART OPERATIONS
   * ====================================================================== */

  // Ticket display name: Bánh Mì items carry the words "Bánh Mì" so the kitchen
  // never confuses e.g. "Grilled Lemongrass Chicken" (bánh mì) with the noodle
  // or rice version of the same protein.
  function displayName(item) {
    if (!item) return '';
    if (item.cat === 'banh-mi' && !/b[aá]nh\s*m[iì]/i.test(item.name)) return item.name + ' Bánh Mì';
    return item.name;
  }

  function buildLine(item, opts = {}) {
    const base = opts.basePrice != null ? opts.basePrice
      : (opts.unitPrice != null ? opts.unitPrice : item.price);
    return {
      uid: uid(),
      itemId: item.id,
      name: displayName(item),
      cat: item.cat,
      basePrice: base,
      addons: opts.addons || [],   // [{ name, price, qty }]
      mods: opts.mods || [],       // [ 'No coriander', ... ]
      qty: opts.qty || 1,
      note: opts.note || '',
      discount: opts.discount || { mode: 'none', value: 0 }, // per-line admin discount
      isCombo: !!item.isCombo,
      components: opts.components || [], // [{slot, name, itemId}]
      takeawayOnly: !!item.takeawayOnly,
      noDiscount: !!item.noDiscount
    };
  }

  const isPlain = (x) => !(x && ((x.addons && x.addons.length) || (x.mods && x.mods.length) || x.note || x.components && x.components.length));

  function addItem(itemId, opts = {}) {
    const item = findItem(itemId);
    if (!item || item.available === false) return;

    // merge with an identical existing line (only when neither has customizations)
    if (!item.isCombo && isPlain(opts)) {
      const existing = state.cart.lines.find(
        (l) => l.itemId === itemId && !l.isCombo && isPlain(l)
      );
      if (existing) { existing.qty += opts.qty || 1; return commit(); }
    }
    state.cart.lines.push(buildLine(item, opts));
    commit();
  }

  // Apply customizations (add-ons / preferences / note) to a cart line.
  function updateLine(uidVal, patch) {
    const l = state.cart.lines.find((x) => x.uid === uidVal);
    if (!l) return;
    if (patch.addons !== undefined) l.addons = patch.addons;
    if (patch.mods !== undefined) l.mods = patch.mods;
    if (patch.note !== undefined) l.note = patch.note;
    commit();
  }

  // Modifier groups that apply to a given menu item.
  const getModifierGroups = () => state.modifierGroups;
  function groupsForItem(item) {
    if (!item) return [];
    const drinkItem = DRINK_CATS.includes(item.cat);
    return state.modifierGroups.filter((g) => {
      const direct = (g.appliesTo.categories || []).includes(item.cat) ||
        (g.appliesTo.items || []).includes(item.id);
      if (drinkItem) return direct;
      return g.appliesTo.all || direct;
    });
  }

  /* ---- modifier management (admin) -------------------------------------- */
  function addModifierGroup(group) {
    state.modifierGroups.push(Object.assign({
      id: 'grp-' + uid(), name: 'New group', free: false, appliesTo: { all: true }, options: []
    }, group));
    commit();
  }
  function updateModifierGroup(id, patch) {
    const g = state.modifierGroups.find((x) => x.id === id);
    if (g) { Object.assign(g, patch); commit(); }
  }
  function deleteModifierGroup(id) {
    state.modifierGroups = state.modifierGroups.filter((g) => g.id !== id);
    commit();
  }
  function addModifierOption(groupId, option) {
    const g = state.modifierGroups.find((x) => x.id === groupId);
    if (!g) return;
    g.options.push(g.free ? { name: option.name || 'New option' }
      : { name: option.name || 'New add-on', price: option.price || 0 });
    commit();
  }
  function updateModifierOption(groupId, idx, patch) {
    const g = state.modifierGroups.find((x) => x.id === groupId);
    if (g && g.options[idx]) { Object.assign(g.options[idx], patch); commit(); }
  }
  function deleteModifierOption(groupId, idx) {
    const g = state.modifierGroups.find((x) => x.id === groupId);
    if (g) { g.options.splice(idx, 1); commit(); }
  }

  function setQty(uidVal, qty) {
    const l = state.cart.lines.find((x) => x.uid === uidVal);
    if (!l) return;
    l.qty = Math.max(1, qty);
    commit();
  }
  function incQty(uidVal, delta) {
    const l = state.cart.lines.find((x) => x.uid === uidVal);
    if (!l) return;
    l.qty = Math.max(1, l.qty + delta);
    commit();
  }
  function removeLine(uidVal) {
    state.cart.lines = state.cart.lines.filter((x) => x.uid !== uidVal);
    commit();
  }
  function setLineNote(uidVal, note) {
    const l = state.cart.lines.find((x) => x.uid === uidVal);
    if (l) { l.note = note; commit(); }
  }
  function setOrderType(type) {
    state.cart.orderType = type;
    // If switching to dine-in, drop take-away-only items
    if (type === 'dine-in') {
      state.cart.lines = state.cart.lines.filter((l) => !l.takeawayOnly);
    }
    commit();
  }
  function setTable(t) { state.cart.table = t; commit(); }
  function setCustomer(name) { state.cart.customer = name; commit(); }
  function setPager(p) { state.cart.pager = p; commit(); }
  function setCartNote(n) { state.cart.note = n; commit(); }
  function setDiscount(mode, value) {
    state.cart.discount = { mode, value: Number(value) || 0 };
    audit('discount.order', { mode, value: state.cart.discount.value }, 'warn');
    commit();
  }
  // Per-line admin discount. uidList = array of line uids to apply to.
  function setLineDiscount(uidList, mode, value) {
    const set = new Set(uidList);
    state.cart.lines.forEach((l) => {
      l.discount = set.has(l.uid) ? { mode, value: Number(value) || 0 } : { mode: 'none', value: 0 };
    });
    audit('discount.items', { mode, value: Number(value) || 0, count: set.size }, 'warn');
    commit();
  }
  function clearAllDiscounts() {
    state.cart.discount = { mode: 'none', value: 0 };
    state.cart.lines.forEach((l) => { l.discount = { mode: 'none', value: 0 }; });
    audit('discount.clear', {}, 'warn');
    commit();
  }
  function clearCart() { state.cart = newCart(); commit(); }

  /* ====================================================================== *
   * HELD (PARKED) TICKETS
   * ====================================================================== */
  function holdOrder() {
    if (!state.cart.lines.length) return;
    state.held.push({
      id: uid(),
      label: state.cart.pager ? ('Pager ' + state.cart.pager)
        : (state.cart.customer || ('Ticket ' + (state.held.length + 1))),
      heldAt: Date.now(),
      cart: clone(state.cart)
    });
    state.cart = newCart();
    commit();
  }
  function recallHeld(id) {
    const idx = state.held.findIndex((h) => h.id === id);
    if (idx === -1) return;
    if (state.cart.lines.length) holdOrder();
    state.cart = state.held[idx].cart;
    state.held.splice(idx, 1);
    commit();
  }
  function deleteHeld(id) {
    state.held = state.held.filter((h) => h.id !== id);
    commit();
  }

  /* ====================================================================== *
   * COMPLETE / VOID ORDER
   * ====================================================================== */
  // Receipt code that resets to 0001 each day.
  function nextDailyNo(ts) {
    const k = dayKey(ts);
    return state.orders.filter((o) => !o.training && dayKey(o.createdAt) === k).length + 1;
  }
  const pad4 = (n) => String(n).padStart(4, '0');

  function completeOrder(payments, opts = {}) {
    // The kiosk passes its own cart so a counter ticket in progress is untouched;
    // both channels still draw from the SAME daily queue number (nextDailyNo).
    const cart = opts.cart || state.cart;
    const totals = computeTotals(cart);
    const cleanPayments = (payments || [])
      .map((p) => ({ method: p.method || 'cash', amount: round2(Math.max(0, Number(p.amount) || 0)) }))
      .filter((p) => p.amount > 0);
    const payable = paymentTotal(totals, cleanPayments);
    const paid = cleanPayments.reduce((s, p) => s + p.amount, 0);
    if (!cart.lines.length || !cleanPayments.length || paid < payable.total - 0.0001) return null;
    const now = Date.now();
    const training = opts.training != null ? !!opts.training : !!state.trainingMode;
    const dailyNo = training ? 0 : nextDailyNo(now);
    const order = {
      id: state.config.orderSeq++,
      ref: uid(),
      dailyNo,
      code: training ? 'TRAIN' : pad4(dailyNo),     // displayed receipt code, resets daily
      training,
      channel: opts.channel || 'counter',           // 'counter' | 'kiosk'
      memberId: opts.memberId || null,
      createdAt: now,
      cashier: opts.channel === 'kiosk' ? 'Order Kiosk' : state.config.cashier,
      orderType: cart.orderType,
      table: cart.table,
      customer: cart.customer,
      pager: cart.pager,
      note: cart.note,
      lines: totals.lines.map((l) => ({
        itemId: l.itemId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, basePrice: l.basePrice, isCombo: l.isCombo,
        components: l.components, note: l.note, addons: l.addons || [], mods: l.mods || [],
        lineGross: l.lineGross, lineDiscount: l.lineDiscount, lineNet: l.lineNet,
        lineManual: l.lineManual || 0, discount: clone(l.discount || { mode: 'none', value: 0 }),
        promoName: l.promo ? l.promo.name : null, cat: l.cat, noDiscount: !!l.noDiscount,
        refundedQty: 0
      })),
      totals: {
        itemCount: totals.itemCount, gross: totals.gross,
        promoDiscount: totals.promoDiscount, manualDiscount: totals.manualDiscount,
        lineManual: totals.lineManual, orderManual: totals.orderManual,
        net: totals.net, tax: totals.tax, total: payable.total,
        taxInclusive: totals.taxInclusive, roundingAdj: payable.roundingAdj
      },
      discount: clone(cart.discount),
      payments: clone(cleanPayments),
      paid: round2(paid),
      change: round2(Math.max(0, paid - payable.total)),
      status: 'paid',
      refunds: [],
      refundedTotal: 0
    };
    // Loyalty: award points to a linked member (kiosk or counter).
    if (!training && order.memberId) {
      const m = state.members.find((x) => x.id === order.memberId);
      const earned = Math.max(0, Math.floor(payable.total * (state.config.pointsPerDollar || 1)));
      if (m) { m.points = (m.points || 0) + earned; order.pointsEarned = earned; }
    }
    state.orders.unshift(order);
    if (!opts.cart) state.cart = newCart();   // only the counter cart auto-resets
    if (training) audit('sale.training', { orderId: order.id, total: payable.total, items: totals.itemCount }, 'notice');
    if (order.channel === 'kiosk') audit('sale.kiosk', { orderId: order.id, code: order.code, total: payable.total, member: order.memberId || null }, 'info');
    commit();
    return order;
  }

  /* ---- loyalty members --------------------------------------------------- */
  function getMembers() { return state.members; }
  function findMember(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const digits = q.replace(/\D/g, '');
    return state.members.find((m) =>
      String(m.code || '').toLowerCase().replace(/\s/g, '') === q.replace(/\s/g, '') ||
      (digits.length >= 6 && String(m.phone || '').replace(/\D/g, '') === digits) ||
      String(m.id).toLowerCase() === q
    ) || null;
  }
  function addMemberPoints(id, pts) {
    const m = state.members.find((x) => x.id === id);
    if (!m) return null;
    m.points = Math.max(0, (m.points || 0) + (Number(pts) || 0));
    commit();
    return m;
  }

  function findOrder(id) { return state.orders.find((o) => o.id === Number(id)); }
  function lastOrder() { return state.orders.find((o) => o.status !== 'voided' && !o.training) || null; }

  // Search across ALL orders by receipt details, amount, time, table or customer.
  function searchOrders(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const num = q.replace(/^#/, '');
    const compactQ = q.replace(/\s+/g, '');
    const currency = String(state.config.currency || '$').toLowerCase();
    const amountRaw = q.split(currency).join('').replace(/[$,\s]/g, '');
    const amountQuery = /^\d+(\.\d{1,2})?$/.test(amountRaw) ? round2(Number(amountRaw)) : null;
    const sameAmount = (n) => amountQuery != null && Math.abs(round2(Number(n) || 0) - amountQuery) < 0.005;
    const includes = (v) => String(v || '').toLowerCase().includes(q);
    const compactIncludes = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').includes(compactQ);
    const timeStrings = (ts) => {
      const d = new Date(ts);
      const hr24 = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return [
        d.toLocaleString().toLowerCase(),
        d.toLocaleDateString().toLowerCase(),
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }).toLowerCase(),
        hr24 + ':' + min,
        String(d.getHours()) + ':' + min
      ];
    };
    return state.orders.filter((o) => {
      const net = round2((o.totals ? o.totals.total : 0) - (o.refundedTotal || 0));
      return String(o.id).includes(num) ||
        String(o.code || '').toLowerCase().includes(num) ||
        String(o.ref || '').toLowerCase().includes(q) ||
        (o.pager && includes(o.pager)) ||
        (o.table && includes(o.table)) ||
        (o.customer && includes(o.customer)) ||
        sameAmount(o.totals && o.totals.total) ||
        sameAmount(o.totals && o.totals.gross) ||
        sameAmount(o.totals && o.totals.net) ||
        sameAmount(net) ||
        sameAmount(o.paid) ||
        sameAmount(o.refundedTotal) ||
        (o.payments || []).some((p) => sameAmount(p.amount) || includes(p.method)) ||
        timeStrings(o.createdAt).some((v) => includes(v) || compactIncludes(v));
    });
  }

  // Full cancellation — removes the sale from all takings. Use for mistakes.
  function voidOrder(id) {
    const o = findOrder(id);
    if (o) {
      o.status = 'voided';
      o.voidedAt = Date.now();
      o.voidedBy = state.config.cashier;
      audit('order.void', { orderId: o.id, code: o.code, total: o.totals.total }, 'warn');
      commit();
    }
  }

  // How many units of each line can still be returned.
  function refundableQty(order, idx) {
    const l = order.lines[idx];
    return Math.max(0, l.qty - (l.refundedQty || 0));
  }
  function remainingRefundable(order) {
    return round2(order.totals.total - (order.refundedTotal || 0));
  }

  /* Return / Refund.
   * payload = { items:[{idx, qty}], reason, method }
   * Refund value is a proportional share of the order total so order-level
   * discounts, tax and rounding are returned fairly. */
  function refundOrder(id, payload) {
    const o = findOrder(id);
    if (!o || o.status === 'voided') return null;

    const totalLineNet = o.lines.reduce((s, l) => s + l.lineNet, 0) || 1;
    let refundLineNet = 0;
    const items = [];

    (payload.items || []).forEach(({ idx, qty }) => {
      const l = o.lines[idx];
      if (!l) return;
      const q = Math.min(Number(qty) || 0, refundableQty(o, idx));
      if (q <= 0) return;
      const perUnitNet = l.lineNet / l.qty;
      refundLineNet += perUnitNet * q;
      l.refundedQty = (l.refundedQty || 0) + q;
      items.push({ name: l.name, qty: q, amount: round2((o.totals.total / totalLineNet) * perUnitNet * q) });
    });

    if (!items.length) return null;

    let amount = round2(o.totals.total * (refundLineNet / totalLineNet));
    amount = Math.min(amount, remainingRefundable(o));
    if (amount <= 0) return null;

    const rec = {
      id: 'R' + uid(), at: Date.now(), amount,
      method: payload.method || 'cash',
      reason: payload.reason || '',
      items, by: state.config.cashier,
      orderId: o.id
    };
    o.refunds = o.refunds || [];
    o.refunds.push(rec);
    o.refundedTotal = round2((o.refundedTotal || 0) + amount);

    const fullyReturned = o.lines.every((l) => (l.refundedQty || 0) >= l.qty);
    o.status = (fullyReturned || remainingRefundable(o) <= 0.001) ? 'refunded' : 'partial-refund';
    audit('order.refund', { orderId: o.id, code: o.code, amount: rec.amount, method: rec.method, reason: rec.reason }, 'warn');
    commit();
    return rec;
  }

  /* ====================================================================== *
   * MENU MANAGEMENT
   * ====================================================================== */
  function upsertMenuItem(item) {
    const idx = state.menu.findIndex((m) => m.id === item.id);
    const before = idx >= 0 ? state.menu[idx] : null;
    if (idx >= 0) state.menu[idx] = Object.assign({}, state.menu[idx], item);
    else state.menu.push(Object.assign({ id: 'item-' + uid() }, item));
    const after = idx >= 0 ? state.menu[idx] : state.menu[state.menu.length - 1];
    audit(before ? 'menu.update' : 'menu.create', {
      id: after.id, name: after.name, category: after.cat, price: after.price
    }, 'notice');
    commit();
  }
  function deleteMenuItem(id) {
    const item = findItem(id);
    state.menu = state.menu.filter((m) => m.id !== id);
    audit('menu.delete', { id, name: item ? item.name : '' }, 'warn');
    commit();
  }
  function toggleAvailability(id) {
    const m = findItem(id);
    if (m) {
      m.available = m.available === false ? true : false;
      audit(m.available === false ? 'menu.sold_out' : 'menu.available', { id: m.id, name: m.name }, m.available === false ? 'warn' : 'notice');
      commit();
    }
  }

  /* ====================================================================== *
   * STAFF ACCOUNTS / AUTH
   * ====================================================================== */
  const getUsers = () => state.config.users || [];
  function verifyUser(id, pin) {
    const u = getUsers().find((x) => x.id === id);
    return (u && u.pin === String(pin)) ? u : null;
  }
  function verifyAdminPin(pin) {
    return getUsers().find((u) => u.role === 'admin' && u.pin === String(pin)) || null;
  }
  function setActiveCashier(name) { state.config.cashier = name; commit(); }
  function addUser(u) {
    const rec = Object.assign({ id: 'u-' + uid(), name: 'New staff', pin: '0000', role: 'user' }, u);
    state.config.users = getUsers().concat([rec]);
    audit('staff.create', { id: rec.id, name: rec.name, role: rec.role }, 'notice');
    commit();
  }
  function updateUser(id, patch) {
    const u = getUsers().find((x) => x.id === id);
    if (u) {
      const changed = Object.keys(patch || {}).filter((k) => JSON.stringify(u[k]) !== JSON.stringify(patch[k]));
      Object.assign(u, patch);
      if (changed.length) audit('staff.update', { id: u.id, name: u.name, keys: changed }, 'notice');
      commit();
    }
  }
  function deleteUser(id) {
    const users = getUsers();
    // never delete the last admin
    const target = users.find((x) => x.id === id);
    if (target && target.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1) return false;
    state.config.users = users.filter((x) => x.id !== id);
    audit('staff.delete', { id, name: target ? target.name : '' }, 'warn');
    commit();
    return true;
  }

  /* ====================================================================== *
   * MANAGER CREDIT (refund with no linked receipt)
   * ====================================================================== */
  const getCredits = () => state.credits;
  function addCredit(payload) {
    const rec = {
      id: 'C' + uid(), at: Date.now(),
      amount: round2(Math.max(0, Number(payload.amount) || 0)),
      method: payload.method || 'cash',
      description: payload.description || '',
      by: state.config.cashier
    };
    if (rec.amount <= 0) return null;
    state.credits.unshift(rec);
    audit('credit.issue', { id: rec.id, amount: rec.amount, method: rec.method, description: rec.description }, 'warn');
    commit();
    return rec;
  }

  /* ---- config ------------------------------------------------------------ */
  function updateConfig(patch) {
    const changed = Object.keys(patch || {}).filter((k) => JSON.stringify(state.config[k]) !== JSON.stringify(patch[k]));
    state.config = Object.assign({}, state.config, patch);
    if (changed.length) audit('settings.update', { keys: changed }, 'notice');
    commit();
  }
  function togglePromotion(id) {
    const p = state.promotions.find((x) => x.id === id);
    if (p) {
      p.active = !p.active;
      audit(p.active ? 'promotion.enable' : 'promotion.disable', { id: p.id, name: p.name }, 'notice');
      commit();
    }
  }
  function addPromotion(promo) {
    const rec = Object.assign({
      id: 'promo-' + uid(), name: 'New promotion', type: 'category_percent',
      category: D.CATEGORIES[0].id, percent: 10, excludeItemIds: [], excludeCombos: true,
      startDate: '', endDate: '', active: true, note: ''
    }, promo);
    state.promotions.push(rec);
    audit('promotion.create', { id: rec.id, name: rec.name, percent: rec.percent, category: rec.category }, 'notice');
    commit();
  }
  function updatePromotion(id, patch) {
    const p = state.promotions.find((x) => x.id === id);
    if (p) {
      Object.assign(p, patch);
      audit('promotion.update', { id: p.id, name: p.name }, 'notice');
      commit();
    }
  }
  function deletePromotion(id) {
    const p = state.promotions.find((x) => x.id === id);
    state.promotions = state.promotions.filter((p) => p.id !== id);
    audit('promotion.delete', { id, name: p ? p.name : '' }, 'warn');
    commit();
  }

  /* ====================================================================== *
   * REPORTING
   * ====================================================================== */
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // report(fromKey, toKey) — inclusive date range; pass null/null for all time.
  // Back-compat: report(dayKey) reports a single day.
  function report(fromKey, toKey) {
    if (toKey === undefined) toKey = fromKey;   // single-day call
    const inRange = (ts) => {
      const k = dayKey(ts);
      if (fromKey && k < fromKey) return false;
      if (toKey && k > toKey) return false;
      return true;
    };
    // Voided orders are excluded entirely; refunded/partial still count (net of refund).
    const paid = state.orders.filter((o) => !o.training && o.status !== 'voided' && inRange(o.createdAt));

    const summary = {
      orders: paid.length,
      gross: 0, net: 0, tax: 0, total: 0,
      grossSales: 0, refunds: 0, refundCount: 0,
      promoDiscount: 0, manualDiscount: 0,
      items: 0,
      byPayment: {}, byCategory: {}, byItem: {},
      byHour: {}, byHourOrders: {}, byStaff: {},
      dineIn: 0, takeAway: 0
    };

    paid.forEach((o) => {
      const refunded = o.refundedTotal || 0;
      const keepRatio = o.totals.total > 0 ? (o.totals.total - refunded) / o.totals.total : 0;
      const orderNet = round2(o.totals.total - refunded);
      const staff = o.cashier || 'Unknown';
      if (!summary.byStaff[staff]) summary.byStaff[staff] = { orders: 0, sales: 0, refunds: 0, items: 0 };
      summary.byStaff[staff].orders += 1;
      summary.byStaff[staff].sales += orderNet;
      summary.byStaff[staff].refunds += refunded;

      summary.grossSales += o.totals.total;
      summary.refunds += refunded;
      summary.refundCount += (o.refunds ? o.refunds.length : 0);
      summary.total += orderNet;       // net takings
      summary.gross += o.totals.gross * keepRatio;
      summary.net += o.totals.net * keepRatio;
      summary.tax += o.totals.tax * keepRatio;
      summary.promoDiscount += o.totals.promoDiscount;
      summary.manualDiscount += o.totals.manualDiscount;
      if (o.orderType === 'dine-in') summary.dineIn++; else summary.takeAway++;

      const hr = new Date(o.createdAt).getHours();
      summary.byHour[hr] = (summary.byHour[hr] || 0) + orderNet;
      summary.byHourOrders[hr] = (summary.byHourOrders[hr] || 0) + 1;

      // Net cash-drawer view: tenders in, refunds out (by method)
      o.payments.forEach((p) => {
        summary.byPayment[p.method] = (summary.byPayment[p.method] || 0) + p.amount;
      });
      (o.refunds || []).forEach((r) => {
        summary.byPayment[r.method] = (summary.byPayment[r.method] || 0) - r.amount;
      });

      o.lines.forEach((l) => {
        const soldQty = l.qty - (l.refundedQty || 0);
        if (soldQty <= 0) return;
        const perUnitNet = l.lineNet / l.qty;
        summary.items += soldQty;
        summary.byStaff[staff].items += soldQty;
        summary.byCategory[l.cat] = (summary.byCategory[l.cat] || 0) + perUnitNet * soldQty;
        const itemKey = l.itemId || l.name;
        if (!summary.byItem[itemKey]) summary.byItem[itemKey] = { name: l.name, itemId: l.itemId || null, qty: 0, revenue: 0, cat: l.cat };
        summary.byItem[itemKey].qty += soldQty;
        summary.byItem[itemKey].revenue += perUnitNet * soldQty;
      });
    });

    summary.avgOrder = paid.length ? round2(summary.total / paid.length) : 0;
    // Full item table (used for category filtering & exports)
    summary.itemRows = Object.values(summary.byItem)
      .map((v) => ({ itemId: v.itemId, name: v.name, cat: v.cat, qty: v.qty, revenue: round2(v.revenue) }))
      .sort((a, b) => b.qty - a.qty);
    summary.topItems = summary.itemRows.slice(0, 8);
    summary.staffRows = Object.entries(summary.byStaff)
      .map(([name, v]) => ({ name, orders: v.orders, items: v.items, sales: round2(v.sales), refunds: round2(v.refunds) }))
      .sort((a, b) => b.sales - a.sales);

    ['gross', 'net', 'tax', 'total', 'grossSales', 'refunds', 'promoDiscount', 'manualDiscount'].forEach((k) => {
      summary[k] = round2(summary[k]);
    });
    return summary;
  }

  /* ====================================================================== *
   * TILL — X reading / Z ring-off
   * Cash-drawer view for a day: what to count at end of shift.
   * ====================================================================== */
  function tillReport(dKey) {
    const day = dKey || dayKey(Date.now());
    const r = report(day, day);
    const credits = state.credits.filter((c) => dayKey(c.at) === day);
    const creditTotal = round2(credits.reduce((s, c) => s + c.amount, 0));
    const byMethod = Object.assign({ cash: 0, card: 0, other: 0 }, r.byPayment);
    // credits paid out of the drawer reduce the relevant method
    credits.forEach((c) => { byMethod[c.method] = (byMethod[c.method] || 0) - c.amount; });

    let rounding = 0;
    state.orders.filter((o) => !o.training && o.status !== 'voided' && dayKey(o.createdAt) === day)
      .forEach((o) => { rounding += (o.totals.roundingAdj || 0); });

    const closed = state.tills.filter((t) => t.dayKey === day);
    return {
      dayKey: day,
      generatedAt: Date.now(),
      cashier: state.config.cashier,
      orders: r.orders,
      grossSales: r.grossSales,
      netSales: r.total,
      gst: r.tax,
      discount: round2(r.promoDiscount + r.manualDiscount),
      promoDiscount: r.promoDiscount,
      manualDiscount: r.manualDiscount,
      refunds: r.refunds,
      refundCount: r.refundCount,
      credits: creditTotal,
      creditCount: credits.length,
      rounding: round2(rounding),
      cash: round2(byMethod.cash || 0),
      card: round2(byMethod.card || 0),
      other: round2(byMethod.other || 0),
      drawerTotal: round2((byMethod.cash || 0) + (byMethod.card || 0) + (byMethod.other || 0)),
      dineIn: r.dineIn, takeAway: r.takeAway,
      closedCount: closed.length
    };
  }
  function ringOff(dKey) {
    const rep = tillReport(dKey);
    const rec = { id: 'Z' + uid(), at: Date.now(), dayKey: rep.dayKey, by: state.config.cashier, report: rep };
    state.tills.unshift(rec);
    audit('till.ring_off', { id: rec.id, dayKey: rec.dayKey, netSales: rep.netSales, drawerTotal: rep.drawerTotal }, 'warn');
    commit();
    return rec;
  }
  const getTills = () => state.tills;

  function resetAll() {
    state = {
      config: clone(D.CONFIG),
      menu: clone(D.MENU),
      promotions: clone(D.PROMOTIONS),
      modifierGroups: clone(D.MODIFIER_GROUPS),
      cart: newCart(),
      held: [],
      orders: [],
      credits: [],
      tills: [],
      auditLog: [{ id: 'A' + uid(), at: Date.now(), by: 'System', action: 'data.reset', level: 'warn', detail: {} }],
      trainingMode: false
    };
    commit();
  }

  function exportData() {
    return JSON.stringify({
      config: state.config, menu: state.menu, promotions: state.promotions,
      modifierGroups: state.modifierGroups, held: state.held, orders: state.orders,
      credits: state.credits, tills: state.tills, auditLog: state.auditLog, trainingMode: state.trainingMode
    }, null, 2);
  }
  function importData(json) {
    const data = JSON.parse(json);
    if (data.config) state.config = Object.assign(clone(D.CONFIG), data.config);
    if (data.menu) state.menu = data.menu;
    if (data.promotions) state.promotions = data.promotions;
    if (data.modifierGroups) state.modifierGroups = data.modifierGroups;
    if (data.held) state.held = data.held;
    if (data.orders) state.orders = data.orders;
    if (data.credits) state.credits = data.credits;
    if (data.tills) state.tills = data.tills;
    state.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
    state.trainingMode = !!data.trainingMode;
    audit('data.import', { orders: state.orders.length, menu: state.menu.length }, 'warn');
    commit();
  }

  /* ---- public API -------------------------------------------------------- */
  global.Store = {
    load, subscribe, commit,
    // getters
    getConfig, getMenu, getCart, getHeld, getOrders, getAuditLog, isTrainingMode, setTrainingMode, findItem, itemsByCategory,
    getCategories: () => D.CATEGORIES, getPromotions: () => state.promotions,
    money, round2,
    // pricing
    computeTotals, linePromo,
    // cart
    addItem, setQty, incQty, removeLine, setLineNote, updateLine, setOrderType, setTable,
    setCustomer, setPager, setCartNote, setDiscount, setLineDiscount, clearAllDiscounts, clearCart, buildLine,
    // auth / staff
    getUsers, verifyUser, verifyAdminPin, setActiveCashier, addUser, updateUser, deleteUser,
    // credits & till
    getCredits, addCredit, tillReport, ringOff, getTills,
    // modifiers
    getModifierGroups, groupsForItem, addonsUnit, displayName,
    addModifierGroup, updateModifierGroup, deleteModifierGroup,
    addModifierOption, updateModifierOption, deleteModifierOption,
    // held
    holdOrder, recallHeld, deleteHeld,
    // orders
    completeOrder, voidOrder, refundOrder, findOrder, lastOrder, searchOrders,
    refundableQty, remainingRefundable,
    // loyalty members
    getMembers, findMember, addMemberPoints,
    // live customer-facing channel
    getLive, setLive, clearLive,
    // menu mgmt
    upsertMenuItem, deleteMenuItem, toggleAvailability,
    // config & promotions
    updateConfig, togglePromotion, addPromotion, updatePromotion, deletePromotion,
    promotionStatus, promotionActiveNow,
    // reports
    report, dayKey,
    // data mgmt
    resetAll, exportData, importData
  };
})(window);
