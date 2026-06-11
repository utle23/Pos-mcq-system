/* ========================================================================== *
 * MEDIA  —  admin-managed videos / images, stored in the browser (IndexedDB)
 * --------------------------------------------------------------------------
 * The POS has no backend, so uploaded clips are kept in IndexedDB (blobs) and
 * exposed to the synchronous render code as ready-to-use object URLs through an
 * in-memory cache. Two "slots":
 *   • 'ad'    — Order Tree advertising clips. As many as you upload; they play
 *               in rotation on the kiosk attract screen.
 *   • 'login' — a single image OR video for the login screen background.
 * If a slot is empty the app falls back to the clips bundled in /assets/videos.
 * ========================================================================== */
(function (global) {
  'use strict';
  const DB_NAME = 'mcq-media', STORE = 'media', VERSION = 1;
  const HAS_IDB = typeof indexedDB !== 'undefined';

  // url-backed cache the (synchronous) render functions read from.
  // All three slots are lists whose items rotate on their screen.
  const cache = { ad: [], login: [], customer: [] };
  const SINGLE_SLOTS = [];   // (reserved) slots where uploading would replace
  let dbPromise = null;
  let ready = false;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('slot', 'slot', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function txStore(mode) {
    return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }
  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Read every record, ordered by slot + insertion order.
  function allRecords() {
    if (!HAS_IDB) return Promise.resolve([]);
    return txStore('readonly')
      .then((os) => reqP(os.getAll()))
      .then((rows) => (rows || []).sort((a, b) => (a.ord || 0) - (b.ord || 0)))
      .catch(() => []);
  }

  // Rebuild the object-url cache from the stored blobs. Old urls are revoked so
  // we never leak. Call after any add/remove and once on boot.
  function preload() {
    if (!HAS_IDB) { ready = true; return Promise.resolve(cache); }
    revokeAll();
    cache.ad = []; cache.login = []; cache.customer = [];
    return allRecords().then((rows) => {
      rows.forEach((r) => {
        const url = URL.createObjectURL(r.blob);
        const entry = { id: r.id, name: r.name, type: r.type, kind: r.kind, size: r.size, url };
        if (r.slot === 'ad') cache.ad.push(entry);
        else if (r.slot === 'login') cache.login.push(entry);       // list (rotate)
        else if (r.slot === 'customer') cache.customer.push(entry);  // list (rotate)
      });
      ready = true;
      return cache;
    });
  }

  function revokeAll() {
    cache.ad.forEach((e) => { try { URL.revokeObjectURL(e.url); } catch (_) {} });
    cache.login.forEach((e) => { try { URL.revokeObjectURL(e.url); } catch (_) {} });
    cache.customer.forEach((e) => { try { URL.revokeObjectURL(e.url); } catch (_) {} });
  }

  function uid(slot) {
    return slot + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  const kindOf = (file) => (file.type || '').indexOf('video') === 0 ? 'video' : 'image';

  // Add a file to a slot. 'login' is single-item, so adding replaces the old one.
  function add(slot, file) {
    if (!HAS_IDB) return Promise.reject(new Error('Storage unavailable in this browser'));
    const rec = {
      id: uid(slot), slot, name: file.name || (slot + ' media'),
      type: file.type || 'application/octet-stream', kind: kindOf(file),
      size: file.size || 0, ord: Date.now(), blob: file, createdAt: Date.now()
    };
    const write = SINGLE_SLOTS.includes(slot)
      ? clearSlot(slot, true).then(() => txStore('readwrite')).then((os) => reqP(os.put(rec)))
      : txStore('readwrite').then((os) => reqP(os.put(rec)));
    return write.then(preload);
  }

  function remove(id) {
    if (!HAS_IDB) return Promise.resolve();
    return txStore('readwrite').then((os) => reqP(os.delete(id))).then(preload);
  }

  // Delete every record in a slot. `silent` skips the preload (used internally
  // before a replacing write so we don't preload twice).
  function clearSlot(slot, silent) {
    if (!HAS_IDB) return Promise.resolve();
    return allRecords().then((rows) => {
      const del = rows.filter((r) => r.slot === slot);
      if (!del.length) return null;
      return txStore('readwrite').then((os) => Promise.all(del.map((r) => reqP(os.delete(r.id)))));
    }).then(() => (silent ? null : preload()));
  }

  // ---- synchronous getters for the render code -----------------------------
  global.Media = {
    preload, add, remove, clearSlot,
    ads: () => cache.ad,            // [{id,name,type,kind,size,url}]
    login: () => cache.login,       // [{…}] list (rotate)
    customer: () => cache.customer, // [{…}] list (rotate)
    isReady: () => ready,
    available: HAS_IDB
  };
})(window);
