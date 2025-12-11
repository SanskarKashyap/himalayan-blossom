(function () {
  'use strict';

  const HBSite = window.HBSite || (window.HBSite = {});

  const storage = window.localStorage;
  const PREFILL_KEY = 'hb_preorder_prefill_v1';
  const PENDING_CART_KEY = 'hb_pending_cart_item_v1';
  const PRODUCT_ASSETS_KEY = 'hb_product_assets_v1';
  const LOCAL_CART_KEY = 'hb_cart_guest_v2';
  const USER_CART_STORAGE_PREFIX = 'hb_user_cart_v2_';
  const FIRESTORE_CART_COLLECTION = 'carts';
  const CART_SYNC_DEBOUNCE_MS = 900;
  const CART_PRICE_SCALE = 100; // store price as paise for accuracy
  const CART_CURRENCY = 'INR';
  const DEFAULT_PRODUCT_ASSETS = {
    'Van Amrit — Wild Honey': { img: 'assets/img/menu/menu-item-1.png' },
    'Shila Madhu — Honey Dew': { img: 'assets/img/menu/menu-item-2.png' },
    'Him Kanti — White Honey': { img: 'assets/img/menu/menu-item-3.png' },
    'Kashtha Bal — Chestnut Honey': { img: 'assets/img/menu/menu-item-4.png' },
    'Him Saans — Thyme Honey': { img: 'assets/img/menu/menu-item-5.png' },
    'Pachan Amrit — Ajwain Honey': { img: 'assets/img/menu/menu-item-6.png' },
    'Gahana Madhu — Malty Honey': { img: 'assets/img/menu/menu-item-7.png' },
    'Sarson Tejas — Mustard Honey': { img: 'assets/img/menu/menu-item-8.png' }
  };

  const DEFAULT_PRICING = {
    '250 gram': 1199,
    '500 gram': 1999,
    '1000 gram': 3499,
  };

  const state = {
    language: storage.getItem('language') || 'en',
    theme: storage.getItem('theme') || 'light',
    productAssets: { ...DEFAULT_PRODUCT_ASSETS },
  };

  const CART_DISABLED_COPY = {
    en: 'Online cart checkout is no longer available.',
    hi: 'ऑनलाइन कार्ट सुविधा अब उपलब्ध नहीं है।',
  };

  const HBCart = createCartManager();
  HBSite.cart = HBCart;
  window.HBCart = HBCart;

  let globalsInitialized = false;

  try {
    const storedAssets = storage.getItem(PRODUCT_ASSETS_KEY);
    if (storedAssets) {
      state.productAssets = { ...DEFAULT_PRODUCT_ASSETS, ...(JSON.parse(storedAssets) || {}) };
    }
  } catch (error) {
    state.productAssets = { ...DEFAULT_PRODUCT_ASSETS };
  }

  function qs(selector, context) {
    return (context || document).querySelector(selector);
  }

  function qsa(selector, context) {
    return Array.from((context || document).querySelectorAll(selector));
  }

  function getCartDisabledMessage() {
    return state.language === 'hi' ? CART_DISABLED_COPY.hi : CART_DISABLED_COPY.en;
  }

  function logCartStep(message, details) {
    if (details !== undefined) {
      console.log('[HB Cart]', message, details);
    } else {
      console.log('[HB Cart]', message);
    }
  }

  function getCartIndicatorTargets() {
    return [
      {
        container: document.getElementById('headerCartButton'),
        count: document.getElementById('headerCartCount'),
      },
      {
        container: document.getElementById('mobileCartButton'),
        count: document.getElementById('mobileCartCount'),
      },
    ];
  }

  function computeCartCount(cart) {
    if (!cart || !Array.isArray(cart.items)) {
      return 0;
    }
    return cart.items.reduce((total, item) => {
      const qty = Number(item && item.quantity);
      return total + (Number.isFinite(qty) && qty > 0 ? qty : 0);
    }, 0);
  }

  function updateCartIndicators(cart) {
    const count = computeCartCount(cart);
    getCartIndicatorTargets().forEach((target) => {
      if (!target || !target.count) {
        return;
      }
      target.count.textContent = String(count);
      if (target.container) {
        target.container.classList.toggle('has-items', count > 0);
      }
    });
  }

  function handleCartTriggerClick(event) {
    if (!HBCart || typeof HBCart.syncFromServer !== 'function') {
      logCartStep('Cart trigger ignored: cart manager unavailable');
      return;
    }
    logCartStep('Cart trigger clicked', { target: (event && event.currentTarget && event.currentTarget.id) || 'unknown' });
    const trigger = event && event.currentTarget ? event.currentTarget : null;
    if (trigger) {
      trigger.classList.add('cart-syncing');
    }
    HBCart.syncFromServer('icon-click')
      .catch((error) => {
        console.warn('[HB Cart] Failed to load cart on demand', error);
        logCartStep('Cart trigger fetch failed', { error: error && error.message ? error.message : 'unknown error' });
      })
      .finally(() => {
        if (trigger) {
          trigger.classList.remove('cart-syncing');
        }
        logCartStep('Cart trigger fetch completed');
      });
  }

  function initCartTriggers() {
    getCartIndicatorTargets().forEach((target) => {
      if (!target || !target.container) {
        return;
      }
      const button = target.container;
      if (button.dataset.hbCartTriggerBound === 'true') {
        return;
      }
      button.dataset.hbCartTriggerBound = 'true';
      button.addEventListener('click', handleCartTriggerClick);
      logCartStep('Cart trigger bound', { id: button.id || 'unknown' });
    });
  }


  function createCartManager() {
    const subscribers = new Set();
    let cartState = loadGuestCart();
    let mode = 'guest';
    let user = null;
    let firebaseResources = null;
    let firebaseReadyPromise = null;
    let remoteUnsubscribe = null;
    let pendingWriteTimer = null;
    let pendingWritePromise = null;
    let lastEmittedCart = undefined;
    let isApplyingRemoteSnapshot = false;

    emitCartUpdate(cartState);
    bootstrapAuthBridge();

    return {
      addItem,
      setItemQuantity,
      incrementItem,
      removeItem,
      updateItem,
      subscribe,
      getCart,
      syncFromServer,
      clearLocal,
      getMode: () => mode,
    };

    function bootstrapAuthBridge() {
      if (window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated()) {
        const currentUser = window.Auth.getUser && window.Auth.getUser();
        if (currentUser) {
          connectRemoteCart(currentUser);
        }
      }
      window.addEventListener('hb:auth:signed-in', (event) => {
        const detailUser = event && event.detail && event.detail.user;
        connectRemoteCart(detailUser || (window.Auth && window.Auth.getUser && window.Auth.getUser()));
      });
      window.addEventListener('hb:auth:signed-out', () => {
        disconnectRemoteCart();
      });
    }

    function connectRemoteCart(nextUser) {
      if (!nextUser || !nextUser.uid) {
        return;
      }
      if (user && user.uid === nextUser.uid && mode === 'remote') {
        return;
      }
      user = nextUser;
      mode = 'remote';
      const cached = loadUserCartSnapshot(user.uid);
      if (cached) {
        cartState = cached;
        emitCartUpdate(cartState);
      }
      subscribeToRemoteCart(user.uid).catch((error) => {
        console.warn('[HB Cart] Failed to subscribe to Firestore cart', error);
      });
    }

    function disconnectRemoteCart() {
      if (remoteUnsubscribe) {
        try {
          remoteUnsubscribe();
        } catch (error) {
          console.warn('[HB Cart] Failed to cleanup Firestore listener', error);
        }
        remoteUnsubscribe = null;
      }
      firebaseResources = null;
      firebaseReadyPromise = null;
      user = null;
      mode = 'guest';
      cartState = loadGuestCart();
      emitCartUpdate(cartState);
    }

    function loadGuestCart() {
      try {
        const raw = storage.getItem(LOCAL_CART_KEY);
        if (raw) {
          return hydrateCart(JSON.parse(raw), { meta: { mode: 'guest' } });
        }
      } catch (error) {
        console.warn('[HB Cart] Failed to parse guest cart', error);
      }
      return hydrateCart(null, { meta: { mode: 'guest' } });
    }

    function persistGuestCart(cart) {
      try {
        storage.setItem(LOCAL_CART_KEY, JSON.stringify(cart));
      } catch (error) {
        console.warn('[HB Cart] Unable to persist guest cart', error);
      }
    }

    function loadUserCartSnapshot(uid) {
      if (!uid) {
        return null;
      }
      try {
        const raw = storage.getItem(`${USER_CART_STORAGE_PREFIX}${uid}`);
        if (!raw) {
          return null;
        }
        return hydrateCart(JSON.parse(raw), { meta: { mode: 'remote', source: 'cache' } });
      } catch (error) {
        console.warn('[HB Cart] Failed to load cached user cart', error);
        return null;
      }
    }

    function persistUserCartSnapshot(uid, cart) {
      if (!uid) {
        return;
      }
      try {
        storage.setItem(`${USER_CART_STORAGE_PREFIX}${uid}`, JSON.stringify(cart));
      } catch (error) {
        console.warn('[HB Cart] Unable to persist user cart snapshot', error);
      }
    }

    function hydrateCart(raw, overrides) {
      if (!raw || typeof raw !== 'object') {
        return emptyCart(overrides);
      }
      const items = sanitizeCartItems(raw.items);
      const meta = Object.assign(
        {
          lastMutatedAt: Date.now(),
          lastMergedAt: 0,
          mode,
        },
        raw.meta || {},
        overrides && overrides.meta ? overrides.meta : {}
      );
      return {
        items,
        updatedAt: raw.updatedAt || new Date().toISOString(),
        currency: raw.currency || CART_CURRENCY,
        meta,
      };
    }

    function emptyCart(overrides) {
      const base = {
        items: [],
        updatedAt: new Date().toISOString(),
        currency: CART_CURRENCY,
        meta: {
          lastMutatedAt: Date.now(),
          lastMergedAt: 0,
          mode: overrides && overrides.meta && overrides.meta.mode ? overrides.meta.mode : mode,
        },
      };
      if (overrides && overrides.meta) {
        base.meta = Object.assign(base.meta, overrides.meta);
      }
      return base;
    }

    function cloneCart(cart) {
      if (!cart) {
        return cart;
      }
      return {
        items: Array.isArray(cart.items)
          ? cart.items
            .map((item) => (item && typeof item === 'object' ? Object.assign({}, item) : null))
            .filter(Boolean)
          : [],
        updatedAt: cart.updatedAt,
        currency: cart.currency || CART_CURRENCY,
        meta: cart.meta ? Object.assign({}, cart.meta) : {},
      };
    }

    function emitCartUpdate(cart) {
      const snapshot = cloneCart(cart);
      lastEmittedCart = snapshot;
      updateCartIndicators(snapshot || { items: [] });
      subscribers.forEach((callback) => {
        if (typeof callback !== 'function') {
          return;
        }
        try {
          callback(snapshot);
        } catch (error) {
          console.warn('[HB Cart] Subscriber callback failed', error);
        }
      });
      logCartStep('Cart update emitted', {
        mode,
        itemCount: snapshot && Array.isArray(snapshot.items) ? snapshot.items.length : 0,
      });
      window.dispatchEvent(
        new CustomEvent('hb:cart:updated', {
          detail: {
            cart: snapshot,
            mode,
          },
        })
      );
    }

    function sanitizeCartItems(items) {
      if (!Array.isArray(items)) {
        return [];
      }
      return items
        .map((raw) => {
          try {
            return normalizeCartItem(raw);
          } catch (error) {
            console.warn('[HB Cart] Ignoring invalid cart item during sanitize', raw, error);
            return null;
          }
        })
        .filter(Boolean);
    }

    function makeItemKey(item) {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const productId = item.productId || slugify(item.product || '');
      const size = item.size || 'default';
      return `${productId}`.toLowerCase() + '::' + `${size}`.toLowerCase();
    }

    function findItemIndex(items, target) {
      if (!target) {
        return -1;
      }
      const key = makeItemKey(target);
      return items.findIndex((candidate) => makeItemKey(candidate) === key);
    }

    function subscribe(callback) {
      if (typeof callback !== 'function') {
        return () => { };
      }
      subscribers.add(callback);
      if (lastEmittedCart !== undefined) {
        try {
          callback(lastEmittedCart);
        } catch (error) {
          console.warn('[HB Cart] Initial subscriber callback failed', error);
        }
      }
      return () => {
        subscribers.delete(callback);
      };
    }

    async function getCart() {
      if (lastEmittedCart !== undefined) {
        return lastEmittedCart;
      }
      emitCartUpdate(cartState);
      return cartState;
    }

    async function addItem(rawItem, options) {
      const item = normalizeCartItem(rawItem);
      const action = (options && options.action) || 'add';
      return applyMutation((items) => {
        const existingIndex = findItemIndex(items, item);
        if (existingIndex >= 0) {
          const current = Object.assign({}, items[existingIndex]);
          const currentQuantity = Number(current.quantity) || 0;
          const nextQuantity = action === 'replace' ? item.quantity : currentQuantity + item.quantity;
          current.quantity = Math.max(1, nextQuantity);
          if (item.pricePaise != null) {
            current.pricePaise = item.pricePaise;
            current.price = item.price;
          }
          current.notes = item.notes || current.notes || '';
          current.metadata = item.metadata != null ? item.metadata : current.metadata || null;
          current.image = item.image || current.image || '';
          items[existingIndex] = current;
        } else {
          items.push(item);
        }
        return items;
      }, { reason: 'add-item' }).then((cart) => {
        window.dispatchEvent(
          new CustomEvent('hb:cart:added', {
            detail: {
              user,
              item,
              cart,
            },
          })
        );
        return cart;
      });
    }

    async function setItemQuantity(productId, size, quantity) {
      const desiredQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
      return applyMutation((items) => {
        const placeholderItem = { productId, product: productId, size };
        const index = findItemIndex(items, placeholderItem);
        if (index === -1) {
          return items;
        }
        if (desiredQuantity <= 0) {
          items.splice(index, 1);
          return items;
        }
        const existing = Object.assign({}, items[index]);
        existing.quantity = desiredQuantity;
        items[index] = existing;
        return items;
      }, { reason: 'set-quantity' });
    }

    async function incrementItem(productId, size, delta) {
      const change = Math.floor(Number(delta) || 0);
      if (!change) {
        return cartState;
      }
      return applyMutation((items) => {
        const placeholderItem = { productId, product: productId, size };
        const index = findItemIndex(items, placeholderItem);
        if (index === -1) {
          return items;
        }
        const existing = Object.assign({}, items[index]);
        const nextQuantity = (Number(existing.quantity) || 0) + change;
        if (nextQuantity <= 0) {
          items.splice(index, 1);
          return items;
        }
        existing.quantity = nextQuantity;
        items[index] = existing;
        return items;
      }, { reason: 'increment' });
    }

    async function removeItem(productId, size) {
      return applyMutation((items) => {
        const placeholderItem = { productId, product: productId, size };
        const index = findItemIndex(items, placeholderItem);
        if (index === -1) {
          return items;
        }
        items.splice(index, 1);
        return items;
      }, { reason: 'remove' });
    }

    async function updateItem(productId, size, updates) {
      return applyMutation((items) => {
        const placeholderItem = { productId, product: productId, size };
        const index = findItemIndex(items, placeholderItem);
        if (index === -1) {
          return items;
        }
        const existing = Object.assign({}, items[index]);
        if (updates && typeof updates === 'object') {
          Object.keys(updates).forEach((key) => {
            if (updates[key] === undefined) {
              return;
            }
            existing[key] = updates[key];
          });
        }
        items[index] = existing;
        return items;
      }, { reason: 'update' });
    }

    async function applyMutation(mutator, options) {
      const currentItems = Array.isArray(cartState.items)
        ? cartState.items.map((raw) => (raw && typeof raw === 'object' ? Object.assign({}, raw) : {}))
        : [];
      const mutatedItems = typeof mutator === 'function' ? mutator(currentItems) || currentItems : currentItems;
      const sanitizedItems = sanitizeCartItems(mutatedItems);
      const nextCart = Object.assign({}, cartState, {
        items: sanitizedItems,
        updatedAt: new Date().toISOString(),
      });

      if (mode === 'guest') {
        nextCart.meta = Object.assign({}, nextCart.meta, { lastMutatedAt: Date.now() });
        cartState = nextCart;
        persistGuestCart(nextCart);
        emitCartUpdate(nextCart);
        return nextCart;
      }

      cartState = nextCart;
      persistUserCartSnapshot(user && user.uid, nextCart);
      emitCartUpdate(nextCart);
      scheduleRemoteWrite(nextCart, options && options.reason);
      return nextCart;
    }

    function scheduleRemoteWrite(cart, reason) {
      if (!user || !user.uid) {
        return;
      }
      if (pendingWriteTimer) {
        window.clearTimeout(pendingWriteTimer);
      }
      pendingWriteTimer = window.setTimeout(() => {
        pendingWriteTimer = null;
        pendingWritePromise = persistCartToFirestore(cart, reason).catch((error) => {
          console.warn('[HB Cart] Firestore sync failed', error);
          window.dispatchEvent(
            new CustomEvent('hb:cart:error', {
              detail: {
                error: error && error.message ? error.message : 'Unable to sync your cart right now.',
              },
            })
          );
        });
      }, CART_SYNC_DEBOUNCE_MS);
      return pendingWritePromise;
    }

    async function persistCartToFirestore(cart, reason) {
      if (!user || !user.uid) {
        return;
      }
      const resources = await ensureFirebaseResources();
      const firestore = resources.firestore;
      if (!firestore) {
        throw new Error('Firestore is not available.');
      }
      const docRef = firestore.collection(FIRESTORE_CART_COLLECTION).doc(user.uid);
      const payload = serializeCartForFirestore(cart, resources);
      isApplyingRemoteSnapshot = true;
      try {
        await docRef.set(payload);
        logCartStep('Cart persisted to Firestore', { reason: reason || 'mutation', itemCount: cart.items.length });
      } finally {
        window.setTimeout(() => {
          isApplyingRemoteSnapshot = false;
        }, 50);
      }
    }

    function ensureFirebaseResources() {
      if (firebaseResources) {
        return Promise.resolve(firebaseResources);
      }
      if (firebaseReadyPromise) {
        return firebaseReadyPromise;
      }
      if (!window.Auth || typeof window.Auth.ensureFirebaseReady !== 'function') {
        return Promise.reject(new Error('Firebase is not configured. Set APP_FIREBASE_CONFIG.'));
      }
      firebaseReadyPromise = window.Auth.ensureFirebaseReady()
        .then((resources) => {
          firebaseResources = resources;
          return resources;
        })
        .catch((error) => {
          firebaseReadyPromise = null;
          throw error;
        });
      return firebaseReadyPromise;
    }

    async function subscribeToRemoteCart(uid) {
      const resources = await ensureFirebaseResources();
      const firestore = resources.firestore;
      if (!firestore) {
        throw new Error('Firestore is not available.');
      }
      if (remoteUnsubscribe) {
        try {
          remoteUnsubscribe();
        } catch (error) {
          console.warn('[HB Cart] Failed to dispose previous Firestore listener', error);
        }
        remoteUnsubscribe = null;
      }
      const docRef = firestore.collection(FIRESTORE_CART_COLLECTION).doc(uid);
      const snapshot = await docRef.get();
      let remoteCart = snapshot.exists ? deserializeCartDocument(snapshot.data()) : emptyCart({ meta: { mode: 'remote' } });
      remoteCart = await maybeMergeGuestCart(docRef, remoteCart, resources);
      cartState = remoteCart;
      persistUserCartSnapshot(uid, remoteCart);
      emitCartUpdate(remoteCart);

      remoteUnsubscribe = docRef.onSnapshot((doc) => {
        if (!doc.exists) {
          const clearedCart = emptyCart({ meta: { mode: 'remote' } });
          cartState = clearedCart;
          persistUserCartSnapshot(uid, clearedCart);
          emitCartUpdate(clearedCart);
          return;
        }
        if (isApplyingRemoteSnapshot) {
          return;
        }
        const nextCart = deserializeCartDocument(doc.data());
        cartState = nextCart;
        persistUserCartSnapshot(uid, nextCart);
        emitCartUpdate(nextCart);
      });
    }

    async function maybeMergeGuestCart(docRef, remoteCart, resources) {
      const guestCart = loadGuestCart();
      if (!hasGuestChanges(guestCart)) {
        return remoteCart;
      }
      const mergedCart = mergeCarts(remoteCart, guestCart);
      try {
        await docRef.set(serializeCartForFirestore(mergedCart, resources));
        markGuestCartMerged(guestCart);
        persistGuestCart(guestCart);
        logCartStep('Guest cart merged into Firestore cart', {
          guestItems: guestCart.items.length,
          mergedItems: mergedCart.items.length,
        });
      } catch (error) {
        console.warn('[HB Cart] Failed to merge guest cart into Firestore', error);
      }
      return mergedCart;
    }

    function mergeCarts(remoteCart, guestCart) {
      const map = new Map();
      const combine = (item) => {
        const key = makeItemKey(item);
        if (!key) {
          return;
        }
        if (map.has(key)) {
          const existing = map.get(key);
          existing.quantity = Math.max(1, (Number(existing.quantity) || 0) + (Number(item.quantity) || 0));
          if (item.pricePaise != null && existing.pricePaise == null) {
            existing.pricePaise = item.pricePaise;
            existing.price = item.price;
          }
          if (!existing.image && item.image) {
            existing.image = item.image;
          }
          if (!existing.notes && item.notes) {
            existing.notes = item.notes;
          }
          return;
        }
        map.set(key, Object.assign({}, item));
      };
      (remoteCart && Array.isArray(remoteCart.items) ? remoteCart.items : []).forEach(combine);
      (guestCart && Array.isArray(guestCart.items) ? guestCart.items : []).forEach(combine);
      return {
        items: Array.from(map.values()),
        updatedAt: new Date().toISOString(),
        currency: CART_CURRENCY,
        meta: {
          mode: 'remote',
          source: 'merge',
        },
      };
    }

    function hasGuestChanges(cart) {
      if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
        return false;
      }
      const lastMutated = Number(cart.meta && cart.meta.lastMutatedAt) || 0;
      const lastMerged = Number(cart.meta && cart.meta.lastMergedAt) || 0;
      return lastMutated >= lastMerged;
    }

    function markGuestCartMerged(cart) {
      if (!cart || !cart.meta) {
        return;
      }
      const timestamp = Date.now();
      cart.meta.lastMergedAt = cart.meta.lastMutatedAt || timestamp;
      cart.meta.lastMutatedAt = cart.meta.lastMutatedAt || timestamp;
    }

    function serializeCartForFirestore(cart, resources) {
      const firebase = resources && resources.firebase;
      const serverTimestamp = firebase && firebase.firestore && firebase.firestore.FieldValue
        ? firebase.firestore.FieldValue.serverTimestamp()
        : new Date().toISOString();
      const items = {};
      (cart.items || []).forEach((item) => {
        const key = makeItemKey(item);
        if (!key) {
          return;
        }
        items[key] = {
          productId: item.productId,
          name: item.product || '',
          size: item.size || '',
          qty: item.quantity,
          priceSnapshot: Number.isFinite(item.pricePaise) ? item.pricePaise : null,
          currency: CART_CURRENCY,
          image: item.image || '',
          notes: item.notes || '',
          metadata: item.metadata || null,
          addedAt: item.addedAt || new Date().toISOString(),
        };
      });
      return {
        userId: user && user.uid,
        currency: CART_CURRENCY,
        updatedAt: serverTimestamp,
        clientUpdatedAt: cart.updatedAt || new Date().toISOString(),
        version: 2,
        items,
      };
    }

    function deserializeCartDocument(data) {
      if (!data || typeof data !== 'object') {
        return emptyCart({ meta: { mode: 'remote' } });
      }
      const collection = data.items && typeof data.items === 'object' ? data.items : {};
      const items = Object.keys(collection).map((key) => {
        const raw = collection[key] || {};
        return normalizeCartItem({
          productId: raw.productId || key,
          product: raw.name || raw.product || '',
          size: raw.size || '',
          quantity: raw.qty || raw.quantity || 1,
          pricePaise: raw.priceSnapshot != null ? raw.priceSnapshot : raw.price_paise,
          price: raw.price,
          image: raw.image || '',
          notes: raw.notes || '',
          metadata: raw.metadata || null,
          addedAt: raw.addedAt || (raw.metadata && raw.metadata.addedAt) || new Date().toISOString(),
        });
      });
      return {
        items: sanitizeCartItems(items),
        updatedAt: new Date().toISOString(),
        currency: data.currency || CART_CURRENCY,
        meta: {
          mode: 'remote',
          source: 'firestore',
        },
      };
    }

    async function syncFromServer(reason) {
      if (mode !== 'remote' || !user || !user.uid) {
        logCartStep('Cart fetch skipped', { reason: reason || 'guest-mode' });
        emitCartUpdate(cartState);
        return cartState;
      }
      try {
        const resources = await ensureFirebaseResources();
        const firestore = resources.firestore;
        const docRef = firestore.collection(FIRESTORE_CART_COLLECTION).doc(user.uid);
        logCartStep('Cart fetch started', { reason: reason || 'manual' });
        const snapshot = await docRef.get();
        const payload = snapshot.exists ? deserializeCartDocument(snapshot.data()) : emptyCart({ meta: { mode: 'remote' } });
        cartState = payload;
        persistUserCartSnapshot(user.uid, payload);
        emitCartUpdate(payload);
        return payload;
      } catch (error) {
        console.warn('[HB Cart] Failed to fetch cart from Firestore', error);
        window.dispatchEvent(
          new CustomEvent('hb:cart:error', {
            detail: {
              error: error && error.message ? error.message : 'Unable to load your cart right now.',
            },
          })
        );
        return cartState;
      }
    }

    function clearLocal(options) {
      const nextCart = emptyCart({ meta: { mode: 'guest' } });
      persistGuestCart(nextCart);
      if (mode === 'guest') {
        cartState = nextCart;
        if (options && options.emitNull) {
          emitCartUpdate(cartState);
        }
      } else if (options && options.emitNull) {
        emitCartUpdate(cartState);
      }
    }
  }

  function normalizeCartItem(item) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid cart item.');
    }

    const name = (item.product || item.productName || item.name || '').toString().trim();
    const size = (item.size || '').toString().trim();
    const quantityNumber = Number(item.quantity);
    const quantity = Number.isFinite(quantityNumber) && quantityNumber > 0 ? Math.floor(quantityNumber) : 1;
    const fallbackId = name ? slugify(`${name}-${size || 'default'}`) : `product-${Date.now()}`;
    const pricePaise = resolveCartPricePaise(item, size);
    const priceValue = Number.isFinite(pricePaise) ? pricePaise / CART_PRICE_SCALE : null;

    return {
      productId: item.productId || fallbackId,
      product: name,
      size,
      quantity,
      price: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
      pricePaise: pricePaise,
      image: item.img || item.image || '',
      notes: item.notes || '',
      language: item.language || state.language,
      addedAt: item.addedAt || new Date().toISOString(),
      metadata: item.metadata || null,
    };
  }

  function resolveCartPricePaise(item, size) {
    const candidates = [
      item.pricePaise,
      item.price_paise,
      item.priceSnapshot,
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const value = normalizePaiseValue(candidates[index]);
      if (value !== null) {
        return value;
      }
    }

    if (item.price != null) {
      const rupeeValue = Number(item.price);
      if (Number.isFinite(rupeeValue) && rupeeValue > 0) {
        const paiseFromPrice = normalizePaiseValue(rupeeValue * CART_PRICE_SCALE);
        if (paiseFromPrice !== null) {
          return paiseFromPrice;
        }
      }
    }

    const inferred = resolvePriceForSize(size);
    if (Number.isFinite(inferred) && inferred > 0) {
      return normalizePaiseValue(inferred * CART_PRICE_SCALE);
    }

    return null;
  }

  function normalizePaiseValue(candidate) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return Math.round(numeric);
  }

  function slugify(value) {
    return value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  const CART_TEXT = {
    en: {
      empty: 'Your cart is empty.',
      signInPrompt: 'Sign in to sync your cart and checkout securely.',
      signInButton: 'Sign in',
      unknownPrice: 'Price unavailable',
      quantity: 'Quantity',
      sizeLabel: 'Size',
      editNotes: 'Edit notes',
      remove: 'Remove',
      notesPlaceholder: 'Add a note for this item',
      noteLabel: 'Notes',
      unknownProduct: 'Selected product',
      empty: 'Selected product',
      checkoutDisabled: 'Add items to your cart before proceeding to checkout.',
      checkoutRedirect: 'Redirecting you to checkout...',
      checkoutCtaAuth: 'Sign in to checkout',
      checkoutCta: 'Proceed to checkout',
      summaryHintSignedIn: 'Adjust quantities or remove items at any time. Your cart stays in sync across devices.',
      summaryHintGuest: 'Totals are estimates. Sign in to sync across devices and checkout securely.',
      updateError: 'Unable to update cart. Please try again.',
      decrementAria: 'Decrease quantity',
      incrementAria: 'Increase quantity',
    },
    hi: {
      empty: 'आपका कार्ट खाली है।',
      signInPrompt: 'अपने कार्ट को सिंक करने और सुरक्षित रूप से चेकआउट पूरा करने के लिए साइन इन करें।',
      signInButton: 'साइन इन करें',
      unknownPrice: 'मूल्य उपलब्ध नहीं',
      quantity: 'मात्रा',
      sizeLabel: 'आकार',
      editNotes: 'नोट संपादित करें',
      remove: 'हटाएं',
      notesPlaceholder: 'इस उत्पाद के लिए नोट जोड़ें',
      noteLabel: 'नोट',
      unknownProduct: 'चयनित उत्पाद',
      empty: 'चयनित उत्पाद',
      checkoutDisabled: 'चेकआउट पर जाने से पहले उत्पाद जोड़ें।',
      checkoutRedirect: 'आपको चेकआउट पर भेजा जा रहा है...',
      checkoutCtaAuth: 'चेकआउट के लिए साइन इन करें',
      checkoutCta: 'चेकआउट पर जाएं',
      summaryHintSignedIn: 'मात्रा बदलें या आइटम हटाएं। आपका कार्ट सभी उपकरणों पर सिंक रहता है।',
      summaryHintGuest: 'कुल अनुमानित हैं। सुरक्षित चेकआउट के लिए साइन इन करें और सभी उपकरणों पर सिंक रखें।',
      updateError: 'कार्ट अपडेट नहीं हो पाया। कृपया पुनः प्रयास करें।',
      decrementAria: 'मात्रा घटाएं',
      incrementAria: 'मात्रा बढ़ाएं',
    },
  };

  const cartPageState = {
    initialized: false,
    unsubscribe: null,
    elements: {},
    lastCart: undefined,
    statusTimer: null,
    eventsBound: false,
    fetchPromise: null,
  };

  const cartCurrencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: CART_CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  function isCartPageActive() {
    return document.body && document.body.getAttribute('data-page-id') === 'cart';
  }

  function getCartLanguage() {
    const lang = (document.documentElement && document.documentElement.getAttribute('lang')) || state.language || 'en';
    return lang === 'hi' ? 'hi' : 'en';
  }

  function cartText(key) {
    const lang = getCartLanguage();
    if (CART_TEXT[lang] && CART_TEXT[lang][key]) {
      return CART_TEXT[lang][key];
    }
    if (CART_TEXT.en && CART_TEXT.en[key]) {
      return CART_TEXT.en[key];
    }
    return key;
  }

  function formatCartCurrency(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return cartText('unknownPrice');
    }
    return cartCurrencyFormatter.format(amount);
  }

  function formatCartTotal(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return '—';
    }
    return cartCurrencyFormatter.format(amount);
  }

  function ensureCartElements() {
    const root = qs('#cartPageRoot');
    if (!root) {
      logCartStep('Cart elements missing: #cartPageRoot not found');
      return false;
    }
    const elements = cartPageState.elements;
    elements.root = root;
    elements.itemsList = qs('#cartItemsList', root);
    elements.emptyState = qs('#cartEmptyState', root);
    elements.summaryCard = qs('#cartSummaryCard', root);
    elements.subtotal = qs('#cartSummarySubtotal', root);
    elements.total = qs('#cartSummaryTotal', root);
    elements.shipping = qs('#cartSummaryShipping', root);
    elements.checkoutButton = qs('#cartCheckoutButton', root);
    elements.summaryHint = qs('#cartSummaryHint', root);
    elements.statusMessage = qs('#cartStatusMessage', root) || qs('#cartStatusMessage');
    elements.authPrompt = qs('#cartAuthPrompt', root);
    elements.authButton = qs('#cartSignInButton', root);
    const ready = Boolean(elements.itemsList && elements.subtotal && elements.total && elements.checkoutButton);
    if (!ready) {
      logCartStep('Cart elements missing required nodes');
    }
    return ready;
  }

  function clearCartStatus() {
    const message = cartPageState.elements.statusMessage;
    if (!message) {
      return;
    }
    message.classList.add('d-none');
    message.textContent = '';
    message.classList.remove('alert-success', 'alert-danger', 'alert-info', 'alert-warning');
    if (cartPageState.statusTimer) {
      window.clearTimeout(cartPageState.statusTimer);
      cartPageState.statusTimer = null;
    }
  }

  function showCartStatus(text, type) {
    const message = cartPageState.elements.statusMessage;
    if (!message || !text) {
      if (text) {
        console.info('[HB Cart]', text);
      }
      return;
    }
    message.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-info', 'alert-warning');
    const alertClass = type === 'error'
      ? 'alert-danger'
      : type === 'success'
        ? 'alert-success'
        : type === 'warning'
          ? 'alert-warning'
          : 'alert-info';
    message.classList.add(alertClass);
    message.textContent = text;
    if (cartPageState.statusTimer) {
      window.clearTimeout(cartPageState.statusTimer);
    }
    cartPageState.statusTimer = window.setTimeout(() => {
      clearCartStatus();
    }, type === 'error' ? 6000 : 4000);
  }

  function showCatalogCartFeedback(text, type) {
    const feedback = document.getElementById('cartFeedback');
    if (!feedback || !text) {
      if (text) {
        console.info('[HB Cart]', text);
      }
      return;
    }
    feedback.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning', 'alert-info');
    const variant = type === 'error'
      ? 'alert-danger'
      : type === 'warning'
        ? 'alert-warning'
        : 'alert-success';
    feedback.classList.add(variant);
    feedback.textContent = text;
    if (feedback._hbTimer) {
      window.clearTimeout(feedback._hbTimer);
    }
    feedback._hbTimer = window.setTimeout(() => {
      feedback.classList.add('d-none');
    }, 4200);
  }

  function resolveCartProductName(item, lang) {
    if (!item || typeof item !== 'object') {
      return cartText('unknownProduct');
    }
    const preferred = lang === 'hi' ? item.productHi : item.product;
    return (preferred || item.product || item.productHi || cartText('empty')).trim() || cartText('empty');
  }

  function createCartActionButton(label, action, className, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('data-cart-action', action);
    if (ariaLabel) {
      button.setAttribute('aria-label', ariaLabel);
    }
    button.textContent = label;
    return button;
  }

  function buildCartItemElement(item, lang) {
    const element = document.createElement('div');
    element.className = 'cart-item card mb-3';
    element.dataset.productId = item.productId || '';
    element.dataset.size = item.size || '';
    element.dataset.notes = item.notes || '';

    const body = document.createElement('div');
    body.className = 'card-body d-flex flex-column flex-md-row gap-3 align-items-start';
    element.appendChild(body);

    const infoWrapper = document.createElement('div');
    infoWrapper.className = 'd-flex flex-row align-items-start gap-3 flex-grow-1';
    body.appendChild(infoWrapper);

    if (item.image) {
      const thumb = document.createElement('div');
      thumb.className = 'cart-item-thumb flex-shrink-0';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = resolveCartProductName(item, lang);
      img.className = 'rounded cart-item-image';
      img.width = 80;
      img.height = 80;
      thumb.appendChild(img);
      infoWrapper.appendChild(thumb);
    }

    const details = document.createElement('div');
    details.className = 'cart-item-details';
    infoWrapper.appendChild(details);

    const title = document.createElement('h5');
    title.className = 'card-title mb-1';
    title.textContent = resolveCartProductName(item, lang);
    details.appendChild(title);

    if (item.size) {
      const sizeLine = document.createElement('p');
      sizeLine.className = 'mb-1 text-muted small';
      sizeLine.textContent = `${cartText('sizeLabel')}: ${item.size}`;
      details.appendChild(sizeLine);
    }

    if (item.notes) {
      const notes = document.createElement('p');
      notes.className = 'mb-0 text-muted small';
      notes.textContent = `${cartText('noteLabel')}: ${item.notes}`;
      details.appendChild(notes);
    }

    const actions = document.createElement('div');
    actions.className = 'd-flex flex-column align-items-end gap-2 ms-md-auto';
    body.appendChild(actions);

    const pricePaise = Number(item.pricePaise);
    const quantityValue = Number(item.quantity) || 0;
    const lineTotalPaise = Number.isFinite(pricePaise) ? pricePaise * quantityValue : Number.NaN;

    const totalLabel = document.createElement('div');
    totalLabel.className = 'cart-item-price fw-semibold';
    totalLabel.textContent = Number.isFinite(lineTotalPaise)
      ? formatCartCurrency(lineTotalPaise / CART_PRICE_SCALE)
      : cartText('unknownPrice');
    actions.appendChild(totalLabel);

    if (Number.isFinite(pricePaise)) {
      const unitLabel = document.createElement('small');
      unitLabel.className = 'text-muted';
      unitLabel.textContent = `${formatCartCurrency(pricePaise / CART_PRICE_SCALE)} x ${quantityValue || 0}`;
      actions.appendChild(unitLabel);
    }

    const quantityControl = document.createElement('div');
    quantityControl.className = 'cart-quantity-control d-flex align-items-center gap-2';
    actions.appendChild(quantityControl);

    quantityControl.appendChild(
      createCartActionButton('-', 'decrement', 'btn btn-outline-secondary btn-sm', cartText('decrementAria'))
    );

    const quantityInput = document.createElement('input');
    quantityInput.type = 'number';
    quantityInput.className = 'form-control form-control-sm cart-qty-input';
    quantityInput.min = '1';
    quantityInput.value = quantityValue > 0 ? String(quantityValue) : '1';
    quantityInput.setAttribute('aria-label', cartText('quantity'));
    quantityControl.appendChild(quantityInput);

    quantityControl.appendChild(
      createCartActionButton('+', 'increment', 'btn btn-outline-secondary btn-sm', cartText('incrementAria'))
    );

    const actionRow = document.createElement('div');
    actionRow.className = 'd-flex flex-wrap gap-2 justify-content-end';
    actions.appendChild(actionRow);

    actionRow.appendChild(
      createCartActionButton(cartText('editNotes'), 'edit-notes', 'btn btn-outline-secondary btn-sm', cartText('editNotes'))
    );
    actionRow.appendChild(
      createCartActionButton(cartText('remove'), 'remove', 'btn btn-outline-danger btn-sm', cartText('remove'))
    );

    return element;
  }

  function computeCartTotals(items) {
    return (items || []).reduce(
      (accumulator, item) => {
        const quantity = Number(item.quantity) || 0;
        const pricePaise = Number(item.pricePaise);
        if (Number.isFinite(pricePaise) && quantity > 0) {
          accumulator.subtotalPaise += pricePaise * quantity;
        }
        accumulator.itemCount += quantity > 0 ? quantity : 0;
        return accumulator;
      },
      { subtotalPaise: 0, itemCount: 0 }
    );
  }

  function renderCart(cart) {
    if (!ensureCartElements()) {
      return;
    }
    const elements = cartPageState.elements;
    const lang = getCartLanguage();
    const isAuthenticated = window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated();
    const items = cart && Array.isArray(cart.items) ? cart.items : [];
    cartPageState.lastCart = cart;
    logCartStep('Rendering cart', { isAuthenticated, itemCount: items.length });

    if (elements.summaryCard) {
      elements.summaryCard.classList.remove('opacity-75', 'disabled');
    }

    if (elements.authPrompt) {
      elements.authPrompt.classList.toggle('d-none', isAuthenticated);
    }

    if (elements.summaryHint) {
      const hintKey = isAuthenticated ? 'summaryHintSignedIn' : 'summaryHintGuest';
      elements.summaryHint.textContent = cartText(hintKey);
    }

    if (elements.itemsList) {
      elements.itemsList.innerHTML = '';
    }

    if (!items.length) {
      if (elements.emptyState) {
        elements.emptyState.classList.remove('d-none');
      }
      logCartStep('Cart render: showing empty state');
    } else {
      if (elements.emptyState) {
        elements.emptyState.classList.add('d-none');
      }
      if (elements.itemsList) {
        items.forEach((item) => {
          elements.itemsList.appendChild(buildCartItemElement(item, lang));
        });
      }
      logCartStep('Cart render: populated items', { itemCount: items.length });
    }

    const totals = computeCartTotals(items);
    const totalValue = totals.subtotalPaise / CART_PRICE_SCALE;
    if (elements.subtotal) {
      elements.subtotal.textContent = formatCartTotal(totalValue);
    }
    if (elements.total) {
      elements.total.textContent = formatCartTotal(totalValue);
    }
    if (elements.checkoutButton) {
      const disabled = !items.length;
      elements.checkoutButton.disabled = disabled;
      if (disabled) {
        elements.checkoutButton.setAttribute('aria-disabled', 'true');
      } else {
        elements.checkoutButton.removeAttribute('aria-disabled');
      }
      elements.checkoutButton.dataset.requiresAuth = (!isAuthenticated).toString();
      elements.checkoutButton.textContent = isAuthenticated
        ? cartText('checkoutCta')
        : cartText('checkoutCtaAuth');
    }
  }

  function refreshCartAuthState() {
    if (!isCartPageActive()) {
      return;
    }
    const fallbackCart = cartPageState.lastCart !== undefined ? cartPageState.lastCart : null;
    renderCart(fallbackCart);
    fetchCartForPage('auth-change');
  }

  async function performCartIncrement(productId, size, delta) {
    if (!HBCart || typeof HBCart.incrementItem !== 'function') {
      throw new Error(cartText('updateError'));
    }
    await HBCart.incrementItem(productId, size, delta);
  }

  async function performCartSetQuantity(productId, size, quantity) {
    if (!HBCart || typeof HBCart.setItemQuantity !== 'function') {
      throw new Error(cartText('updateError'));
    }
    await HBCart.setItemQuantity(productId, size, quantity);
  }

  async function performCartRemove(productId, size) {
    if (!HBCart || typeof HBCart.removeItem !== 'function') {
      throw new Error(cartText('updateError'));
    }
    await HBCart.removeItem(productId, size);
  }

  async function performCartEditNotes(productId, size, currentNote) {
    if (!HBCart || typeof HBCart.updateItem !== 'function') {
      throw new Error(cartText('updateError'));
    }
    const nextNote = window.prompt(cartText('notesPlaceholder'), currentNote || '');
    if (nextNote === null) {
      return;
    }
    await HBCart.updateItem(productId, size, { notes: nextNote.trim() });
  }

  function handleCartItemsClick(event) {
    const button = event.target.closest('[data-cart-action]');
    if (!button || !cartPageState.initialized) {
      return;
    }
    const action = button.getAttribute('data-cart-action');
    const itemElement = button.closest('.cart-item');
    if (!itemElement) {
      return;
    }
    const { productId } = itemElement.dataset;
    const size = itemElement.dataset.size || '';
    if (!productId) {
      return;
    }
    button.disabled = true;
    const currentNote = itemElement.dataset.notes || '';

    Promise.resolve()
      .then(() => {
        if (action === 'increment') {
          return performCartIncrement(productId, size, 1);
        }
        if (action === 'decrement') {
          return performCartIncrement(productId, size, -1);
        }
        if (action === 'remove') {
          return performCartRemove(productId, size);
        }
        if (action === 'edit-notes') {
          return performCartEditNotes(productId, size, currentNote);
        }
        return null;
      })
      .catch((error) => {
        const message = error && error.message ? error.message : cartText('updateError');
        showCartStatus(message, 'error');
      })
      .finally(() => {
        window.requestAnimationFrame(() => {
          button.disabled = false;
        });
      });
  }

  function handleCartItemsChange(event) {
    const input = event.target;
    if (!input || !input.classList || !input.classList.contains('cart-qty-input')) {
      return;
    }
    const itemElement = input.closest('.cart-item');
    if (!itemElement) {
      return;
    }
    const { productId } = itemElement.dataset;
    const size = itemElement.dataset.size || '';
    if (!productId) {
      return;
    }
    const value = Math.floor(Number(input.value));
    input.disabled = true;
    Promise.resolve()
      .then(() => {
        if (!Number.isFinite(value) || value <= 0) {
          return performCartRemove(productId, size);
        }
        return performCartSetQuantity(productId, size, value);
      })
      .catch((error) => {
        const message = error && error.message ? error.message : cartText('updateError');
        showCartStatus(message, 'error');
      })
      .finally(() => {
        window.requestAnimationFrame(() => {
          input.disabled = false;
        });
      });
  }

  function handleCartSignInClick(event) {
    if (event) {
      event.preventDefault();
    }
    if (window.Auth && typeof window.Auth.signIn === 'function') {
      window.Auth.signIn({ redirectTo: window.location.href }).catch(() => {
        const loginUrl = new URL('login.html', window.location.origin);
        loginUrl.searchParams.set('redirect', window.location.href);
        window.location.assign(`${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`);
      });
    } else {
      const loginUrl = new URL('login.html', window.location.origin);
      loginUrl.searchParams.set('redirect', window.location.href);
      window.location.assign(`${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`);
    }
  }

  function handleCartCheckoutClick(event) {
    if (event) {
      event.preventDefault();
    }
    if (!cartPageState.lastCart || !Array.isArray(cartPageState.lastCart.items) || !cartPageState.lastCart.items.length) {
      showCartStatus(cartText('checkoutDisabled'), 'warning');
      return;
    }
    const isAuthenticated = window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated();
    if (!isAuthenticated) {
      showCartStatus(cartText('signInPrompt'), 'warning');
      if (window.Auth && typeof window.Auth.signIn === 'function') {
        window.Auth.signIn({ redirectTo: window.location.href }).catch(() => {
          const loginUrl = new URL('login.html', window.location.origin);
          loginUrl.searchParams.set('redirect', window.location.href);
          window.location.assign(`${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`);
        });
      }
      return;
    }
    showCartStatus(cartText('checkoutRedirect'), 'info');
    window.setTimeout(() => {
      window.location.assign('preorder.html');
    }, 500);
  }

  function attachCartPageEvents() {
    if (!cartPageState.elements.root || cartPageState.eventsBound) {
      return;
    }
    if (cartPageState.elements.itemsList) {
      cartPageState.elements.itemsList.addEventListener('click', handleCartItemsClick);
      cartPageState.elements.itemsList.addEventListener('change', handleCartItemsChange);
    }
    if (cartPageState.elements.authButton) {
      cartPageState.elements.authButton.addEventListener('click', handleCartSignInClick);
    }
    if (cartPageState.elements.checkoutButton) {
      cartPageState.elements.checkoutButton.addEventListener('click', handleCartCheckoutClick);
    }
    cartPageState.eventsBound = true;
  }

  function detachCartPageEvents() {
    if (!cartPageState.eventsBound) {
      return;
    }
    if (cartPageState.elements.itemsList) {
      cartPageState.elements.itemsList.removeEventListener('click', handleCartItemsClick);
      cartPageState.elements.itemsList.removeEventListener('change', handleCartItemsChange);
    }
    if (cartPageState.elements.authButton) {
      cartPageState.elements.authButton.removeEventListener('click', handleCartSignInClick);
    }
    if (cartPageState.elements.checkoutButton) {
      cartPageState.elements.checkoutButton.removeEventListener('click', handleCartCheckoutClick);
    }
    cartPageState.eventsBound = false;
  }

  function handleCartUpdate(cart) {
    logCartStep('handleCartUpdate invoked', {
      itemCount: cart && Array.isArray(cart.items) ? cart.items.length : 0,
    });
    renderCart(cart);
  }

  function fetchCartForPage(reason) {
    if (cartPageState.fetchPromise) {
      logCartStep('Cart page fetch already in progress', { reason });
      return cartPageState.fetchPromise;
    }
    if (!HBCart || typeof HBCart.syncFromServer !== 'function') {
      logCartStep('Cart page fetch skipped: cart manager unavailable');
      return Promise.resolve(null);
    }
    const cartMode = typeof HBCart.getMode === 'function' ? HBCart.getMode() : 'guest';
    if (cartMode !== 'remote') {
      logCartStep('Cart page fetch skipped: using local cart state', { reason });
      return Promise.resolve(cartPageState.lastCart || null);
    }
    const fetchReason = reason || 'cart-page';
    logCartStep('Cart page fetch starting', { reason: fetchReason });
    cartPageState.fetchPromise = HBCart.syncFromServer(fetchReason).catch((error) => {
      console.warn('[HB Cart] Cart page fetch failed', error);
      logCartStep('Cart page fetch failed', { reason: error && error.message ? error.message : 'unknown error' });
      return null;
    }).finally(() => {
      logCartStep('Cart page fetch finished', { reason: fetchReason });
      cartPageState.fetchPromise = null;
    });
    return cartPageState.fetchPromise;
  }

  function teardownCartPage() {
    if (cartPageState.unsubscribe) {
      try {
        cartPageState.unsubscribe();
      } catch (error) {
        console.warn('[HB Cart] Failed to unsubscribe cart listener', error);
      }
      cartPageState.unsubscribe = null;
    }
    detachCartPageEvents();
    clearCartStatus();
    if (cartPageState.elements.itemsList) {
      cartPageState.elements.itemsList.innerHTML = '';
    }
    cartPageState.elements = {};
    cartPageState.initialized = false;
    cartPageState.lastCart = undefined;
  }

  function initCartPage() {
    logCartStep('initCartPage called', { isActive: isCartPageActive() });
    if (!isCartPageActive()) {
      if (cartPageState.initialized) {
        teardownCartPage();
      }
      return;
    }
    if (!ensureCartElements()) {
      return;
    }
    attachCartPageEvents();
    if (!cartPageState.unsubscribe && HBCart && typeof HBCart.subscribe === 'function') {
      cartPageState.unsubscribe = HBCart.subscribe(handleCartUpdate);
      logCartStep('Cart page subscribed to cart manager');
    }
    cartPageState.initialized = true;
    if (cartPageState.lastCart !== undefined) {
      renderCart(cartPageState.lastCart);
    } else {
      const isAuthenticated = window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated();
      renderCart(isAuthenticated ? { items: [] } : null);
    }
    fetchCartForPage('cart-page-init');
  }

  window.addEventListener('hb:language:changed', () => {
    if (!cartPageState.initialized) {
      return;
    }
    if (cartPageState.lastCart !== undefined) {
      renderCart(cartPageState.lastCart);
    } else {
      const isAuthenticated = window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated();
      renderCart(isAuthenticated ? { items: [] } : null);
    }
  });

  function resolvePriceForSize(size) {
    if (!size) return null;
    const pricingConfig = typeof window.APP_PREORDER_PRICING === 'object' ? window.APP_PREORDER_PRICING : {};
    const direct = pricingConfig[size];
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
      return direct;
    }
    const normalized = pricingConfig[size] && typeof pricingConfig[size] === 'object'
      ? pricingConfig[size]
      : null;
    if (normalized && typeof normalized[size] === 'number') {
      return normalized[size];
    }
    const fallback = DEFAULT_PRICING[size];
    return typeof fallback === 'number' ? fallback : null;
  }

  function processPendingCartItem() {
    try {
      const raw = storage.getItem(PENDING_CART_KEY);
      if (!raw) {
        return;
      }
      storage.removeItem(PENDING_CART_KEY);
      const pending = JSON.parse(raw);
      if (pending && window.HBCart && typeof window.HBCart.addItem === 'function') {
        window.HBCart.addItem(pending).catch(() => {
          /* ignore failures */
        });
      }
    } catch (error) {
      storage.removeItem(PENDING_CART_KEY);
    }
  }

  function registerProductAsset(item) {
    if (!item) return;
    const title = item.getAttribute('data-title');
    if (!title) return;
    const existing = state.productAssets[title] || {};
    state.productAssets[title] = {
      img: item.getAttribute('data-img') || existing.img || '',
      titleHi: item.getAttribute('data-title-hi') || existing.titleHi || '',
    };
    try {
      storage.setItem(PRODUCT_ASSETS_KEY, JSON.stringify(state.productAssets));
    } catch (error) {
      /* ignore quota issues */
    }
  }

  function collectProductAssets() {
    qsa('.menu-item').forEach(registerProductAsset);
  }

  function ensureProductModalStructure() {
    let overlay = qs('#modalOverlay');
    let modal = qs('#productModal');

    if (overlay && modal) {
      return { overlay, modal };
    }

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (modal) {
      modal.remove();
      modal = null;
    }

    const template = document.createElement('template');
    template.innerHTML = `
      <div id="modalOverlay" class="modal-overlay"></div>
      <div id="productModal" class="modal product-modal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <span class="modal-close">&times;</span>
            <div class="row g-0">
              <div class="col-md-6">
                <img
                  id="modalImg"
                  src=""
                  alt=""
                  class="img-fluid rounded-start"
                />
              </div>
              <div class="col-md-6 d-flex flex-column justify-content-center">
                <div class="modal-body-right">
                  <h4 id="modalTitle"></h4>
                  <div id="modalDesc"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `.trim();

    document.body.appendChild(template.content);
    return {
      overlay: qs('#modalOverlay'),
      modal: qs('#productModal'),
    };
  }

  function ensurePreorderModalStructure() {
    let overlay = qs('#preorderModalOverlay');
    let modal = qs('#preorderSelectionModal');

    if (overlay && modal) {
      return { overlay, modal };
    }

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (modal) {
      modal.remove();
      modal = null;
    }

    const template = document.createElement('template');
    template.innerHTML = `
      <div
        id="preorderModalOverlay"
        class="modal-overlay"
      ></div>
      <div
        id="preorderSelectionModal"
        class="modal preorder-modal"
        tabindex="-1"
      >
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <button
              type="button"
              class="modal-close"
              id="preorderModalClose"
              aria-label="Close"
            >
              &times;
            </button>
            <div class="row g-0">
              <div class="col-md-5">
                <img
                  id="preorderModalImg"
                  src=""
                  alt=""
                  class="img-fluid rounded-start"
                />
              </div>
              <div class="col-md-7 d-flex flex-column justify-content-center">
                <div class="modal-body-right">
                  <h4 id="preorderModalTitle"></h4>
                  <p
                    id="preorderModalSubtitle"
                    data-en="Select your preferred jar size to continue."
                    data-hi="जारी रखने के लिए अपना पसंदीदा जार आकार चुनें।"
                  >
                    Select your preferred jar size to continue.
                  </p>
                  <div class="size-options" id="preorderSizeOptions">
                    <label class="size-option" for="preorder-size-250">
                      <input
                        type="radio"
                        name="preorderSize"
                        id="preorder-size-250"
                        value="250 gram"
                      />
                      <span data-en="250 gram" data-hi="250 ग्राम">250 gram</span>
                    </label>
                    <label class="size-option" for="preorder-size-500">
                      <input
                        type="radio"
                        name="preorderSize"
                        id="preorder-size-500"
                        value="500 gram"
                      />
                      <span data-en="500 gram" data-hi="500 ग्राम">500 gram</span>
                    </label>
                    <label class="size-option" for="preorder-size-1000">
                      <input
                        type="radio"
                        name="preorderSize"
                        id="preorder-size-1000"
                        value="1000 gram"
                      />
                      <span data-en="1000 gram" data-hi="1000 ग्राम">1000 gram</span>
                    </label>
                  </div>
                  <div class="modal-actions">
                    <button
                      type="button"
                      class="modal-action-btn ghost"
                      id="preorderModalCancel"
                      data-en="Cancel"
                      data-hi="रद्द करें"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="modal-action-btn primary"
                      id="preorderModalConfirm"
                      data-en="Add to Cart"
                      data-hi="कार्ट में जोड़ें"
                      disabled
                    >
                      Add to Cart
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `.trim();

    document.body.appendChild(template.content);
    return {
      overlay: qs('#preorderModalOverlay'),
      modal: qs('#preorderSelectionModal'),
    };
  }

  function updateLanguage(lang) {
    state.language = lang;
    storage.setItem('language', lang);
    if (lang === 'en' || lang === 'hi') {
      document.documentElement.setAttribute('lang', lang);
    }

    qsa('[data-en][data-hi]').forEach((el) => {
      const value = lang === 'hi' ? el.getAttribute('data-hi') : el.getAttribute('data-en');
      if (value !== null && value !== undefined) {
        el.textContent = value;
      }
    });

    qsa('[data-placeholder-en][data-placeholder-hi]').forEach((el) => {
      el.placeholder = lang === 'hi'
        ? el.getAttribute('data-placeholder-hi')
        : el.getAttribute('data-placeholder-en');
    });

    qsa('[data-value-en][data-value-hi]').forEach((el) => {
      el.value = lang === 'hi'
        ? el.getAttribute('data-value-hi')
        : el.getAttribute('data-value-en');
    });

    qsa('[data-title-en][data-title-hi]').forEach((el) => {
      el.title = lang === 'hi'
        ? el.getAttribute('data-title-hi')
        : el.getAttribute('data-title-en');
    });

    qsa('[data-alt-en][data-alt-hi]').forEach((el) => {
      el.alt = lang === 'hi'
        ? el.getAttribute('data-alt-hi')
        : el.getAttribute('data-alt-en');
    });

    const desktopToggle = qs('#lang-toggle');
    if (desktopToggle) {
      const label = desktopToggle.querySelector('span');
      if (label) {
        label.textContent = lang === 'en' ? 'हिं' : 'EN';
      }
    }

    const mobileToggle = qs('#mobile-lang-toggle');
    if (mobileToggle) {
      const label = mobileToggle.querySelector('span');
      if (label) {
        label.textContent = lang === 'en' ? 'हिं' : 'EN';
      }
    }

    window.dispatchEvent(
      new CustomEvent('hb:language:changed', {
        detail: {
          language: state.language,
        },
      })
    );
  }

  function initLanguageToggle() {
    updateLanguage(state.language);

    const toggle = qs('#lang-toggle');
    if (toggle && !toggle.dataset.hbBound) {
      toggle.dataset.hbBound = 'true';
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const nextLang = state.language === 'en' ? 'hi' : 'en';
        updateLanguage(nextLang);
      });
    }

    const mobileToggle = qs('#mobile-lang-toggle');
    if (mobileToggle && !mobileToggle.dataset.hbBound) {
      mobileToggle.dataset.hbBound = 'true';
      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        if (toggle) {
          toggle.dispatchEvent(new Event('click', { bubbles: false, cancelable: true }));
        } else {
          const nextLang = state.language === 'en' ? 'hi' : 'en';
          updateLanguage(nextLang);
        }
      });
    }
  }

  function updateModalThemes() {
    const shouldUseDark = document.body.classList.contains('dark-theme');
    [qs('#productModal'), qs('#preorderSelectionModal')].forEach((modal) => {
      if (!modal) return;
      modal.classList.toggle('dark-theme', shouldUseDark);
    });
  }

  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    storage.setItem('theme', state.theme);

    const body = document.body;
    const toggle = qs('#theme-toggle');
    const icon = toggle ? toggle.querySelector('i') : null;

    if (state.theme === 'dark') {
      body.classList.add('dark-theme');
      if (icon) {
        icon.classList.remove('bi-sun');
        icon.classList.add('bi-moon');
      }
    } else {
      body.classList.remove('dark-theme');
      if (icon) {
        icon.classList.add('bi-sun');
        icon.classList.remove('bi-moon');
      }
    }

    updateModalThemes();
  }

  function initThemeToggle() {
    applyTheme(state.theme);

    const toggle = qs('#theme-toggle');
    if (toggle && !toggle.dataset.hbBound) {
      toggle.dataset.hbBound = 'true';
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        applyTheme(nextTheme);
      });
    }

    const mobileToggle = qs('#mobile-theme-toggle');
    if (mobileToggle && !mobileToggle.dataset.hbBound) {
      mobileToggle.dataset.hbBound = 'true';
      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        if (toggle) {
          toggle.dispatchEvent(new Event('click', { bubbles: false, cancelable: true }));
        } else {
          const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
          applyTheme(nextTheme);
        }
      });
    }
  }

  function initMobileNav() {
    const toggle = qs('.mobile-nav-toggle');
    const mobileNav = qs('.mobile-nav');
    if (!toggle || !mobileNav) return;

    const icon = toggle.querySelector('i');

    const setState = (isActive) => {
      const hbToggle = window.HBPage && typeof window.HBPage.toggleMobileNav === 'function'
        ? window.HBPage.toggleMobileNav
        : null;

      if (hbToggle) {
        hbToggle(isActive);
        return isActive;
      }

      document.body.classList.toggle('mobile-nav-active', isActive);
      mobileNav.classList.toggle('active', isActive);
      mobileNav.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
      if (icon) {
        icon.classList.toggle('bi-list', !isActive);
        icon.classList.toggle('bi-x', isActive);
      }

      return isActive;
    };

    const toggleNav = (forceState) => {
      const nextState = typeof forceState === 'boolean'
        ? forceState
        : !mobileNav.classList.contains('active');
      return setState(nextState);
    };

    if (!toggle.dataset.hbBound) {
      toggle.dataset.hbBound = 'true';
      toggle.addEventListener('click', (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        toggleNav();
      });
    }

    toggleNav(false);
    HBSite.toggleMobileNav = toggleNav;

    qsa('.mobile-nav-menu a').forEach((link) => {
      if (link.dataset.hbBound) return;
      link.dataset.hbBound = 'true';
      link.addEventListener('click', () => {
        toggleNav(false);
      });
    });
  }

  function closeModal(modal, overlay) {
    if (overlay && overlay._hbEscapeHandler) {
      window.removeEventListener('keyup', overlay._hbEscapeHandler);
      delete overlay._hbEscapeHandler;
    }
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
  }

  function initProductModal() {
    const { modal, overlay } = ensureProductModalStructure();
    const modalImg = qs('#modalImg');
    const modalTitle = qs('#modalTitle');
    const descContainer = qs('#modalDesc');

    if (!modal || !overlay) return;

    qsa('.menu-item').forEach((item) => {
      if (item.dataset.hbModalBound) return;
      item.dataset.hbModalBound = 'true';
      registerProductAsset(item);
      item.addEventListener('click', (event) => {
        if (event.target.closest('a[href="#preorder"]')) {
          return;
        }

        const clickedLink = event.target.closest('a');
        if (clickedLink) {
          event.preventDefault();
        }

        const titleEn = item.getAttribute('data-title') || '';
        const titleHi = item.getAttribute('data-title-hi') || titleEn;
        const descEnRaw = item.getAttribute('data-desc') || '';
        const descHiRaw = item.getAttribute('data-desc-hi') || '';
        const imageSrc = item.getAttribute('data-img') || '';
        const productImgEl = item.querySelector('img');
        const altEn = productImgEl
          ? productImgEl.getAttribute('data-alt-en') || productImgEl.getAttribute('alt') || titleEn
          : titleEn;
        const altHi = productImgEl
          ? productImgEl.getAttribute('data-alt-hi') || titleHi
          : titleHi;
        const isHindi = state.language === 'hi';

        if (modalImg) {
          modalImg.src = imageSrc;
          modalImg.setAttribute('data-alt-en', altEn);
          modalImg.setAttribute('data-alt-hi', altHi);
          modalImg.alt = isHindi && altHi ? altHi : altEn;
        }

        if (modalTitle) {
          modalTitle.setAttribute('data-en', titleEn);
          modalTitle.setAttribute('data-hi', titleHi);
          modalTitle.textContent = isHindi && titleHi ? titleHi : titleEn;
        }

        if (descContainer) {
          descContainer.innerHTML = '';
          const descPartsEn = descEnRaw.split('<br>');
          const descPartsHi = descHiRaw.split('<br>');
          const tileCount = Math.max(descPartsEn.length, descPartsHi.length);

          for (let index = 0; index < tileCount; index += 1) {
            const cleanEn = (descPartsEn[index] || '').trim();
            const cleanHi = (descPartsHi[index] || '').trim();
            if (!cleanEn && !cleanHi) continue;

            const tile = document.createElement('div');
            tile.className = 'desc-tile';
            tile.setAttribute('data-en', cleanEn);
            tile.setAttribute('data-hi', cleanHi || cleanEn);
            tile.textContent = isHindi && (cleanHi || cleanEn)
              ? (cleanHi || cleanEn)
              : cleanEn;
            descContainer.appendChild(tile);
          }
        }

        overlay.style.display = 'block';
        modal.style.display = 'flex';
        if (overlay._hbEscapeHandler) {
          window.removeEventListener('keyup', overlay._hbEscapeHandler);
        }
        const escapeHandler = (event) => {
          if (event.key === 'Escape') {
            closeModal(modal, overlay);
          }
        };
        overlay._hbEscapeHandler = escapeHandler;
        window.addEventListener('keyup', escapeHandler);
        updateModalThemes();
      });
    });

    const closeBtn = qs('#productModal .modal-close');
    if (closeBtn && !closeBtn.dataset.hbBound) {
      closeBtn.dataset.hbBound = 'true';
      closeBtn.addEventListener('click', () => closeModal(modal, overlay));
    }

    if (!overlay.dataset.hbBound) {
      overlay.dataset.hbBound = 'true';
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          closeModal(modal, overlay);
        }
      });
    }
  }

  function initPreorderModal() {
    const { overlay, modal } = ensurePreorderModalStructure();
    const modalImg = qs('#preorderModalImg');
    const modalTitle = qs('#preorderModalTitle');
    const confirmBtn = qs('#preorderModalConfirm');
    const cancelBtn = qs('#preorderModalCancel');
    const closeBtn = qs('#preorderModalClose');
    const sizeInputs = qsa('input[name="preorderSize"]', modal || undefined);

    if (!overlay || !modal || !confirmBtn) {
      return;
    }

    let activeItem = modal ? modal._hbActiveItem || null : null;

    const setActiveItem = (item) => {
      activeItem = item || null;
      if (modal) {
        modal._hbActiveItem = activeItem;
      }
    };

    const getActiveItem = () => {
      if (modal && modal._hbActiveItem) {
        return modal._hbActiveItem;
      }
      return activeItem;
    };

    const resetModal = ({ preserveActive = false } = {}) => {
      if (!preserveActive) {
        setActiveItem(null);
      }
      confirmBtn.disabled = true;
      sizeInputs.forEach((input) => {
        input.checked = false;
      });
    };

    function hideModal() {
      if (overlay && overlay._hbEscapeHandler) {
        window.removeEventListener('keyup', overlay._hbEscapeHandler);
        delete overlay._hbEscapeHandler;
      }
      if (overlay) overlay.style.display = 'none';
      if (modal) modal.style.display = 'none';
      resetModal();
    }

    const ensureEscapeHandler = () => {
      if (overlay._hbEscapeHandler) {
        window.removeEventListener('keyup', overlay._hbEscapeHandler);
      }
      overlay._hbEscapeHandler = (event) => {
        if (event.key === 'Escape') {
          hideModal();
        }
      };
      window.addEventListener('keyup', overlay._hbEscapeHandler);
    };

    resetModal();

    const preorderButtons = qsa('.menu-item a[href="#preorder"]');

    preorderButtons.forEach((button) => {
      if (button.dataset.hbPreorderBound) {
        return;
      }
      button.dataset.hbPreorderBound = 'true';
      registerProductAsset(button.closest('.menu-item'));

      button.addEventListener('click', (event) => {
        event.preventDefault();
        const menuItem = button.closest('.menu-item');
        if (!menuItem) {
          return;
        }
        setActiveItem(menuItem);

        const titleEn = menuItem.getAttribute('data-title') || '';
        const titleHi = menuItem.getAttribute('data-title-hi') || titleEn;
        const imageSrc = menuItem.getAttribute('data-img') || '';
        const productImgEl = menuItem.querySelector('img');
        const altEn = productImgEl
          ? productImgEl.getAttribute('data-alt-en') || productImgEl.getAttribute('alt') || titleEn
          : titleEn;
        const altHi = productImgEl
          ? productImgEl.getAttribute('data-alt-hi') || titleHi
          : titleHi;
        const isHindi = state.language === 'hi';

        if (modalImg) {
          modalImg.src = imageSrc;
          modalImg.setAttribute('data-alt-en', altEn);
          modalImg.setAttribute('data-alt-hi', altHi);
          modalImg.alt = isHindi && altHi ? altHi : altEn;
        }
        if (modalTitle) {
          modalTitle.setAttribute('data-en', titleEn);
          modalTitle.setAttribute('data-hi', titleHi);
          modalTitle.textContent = isHindi && titleHi ? titleHi : titleEn;
        }

        resetModal({ preserveActive: true });
        overlay.style.display = 'block';
        modal.style.display = 'flex';
        ensureEscapeHandler();
        updateModalThemes();
      });
    });

    sizeInputs.forEach((input) => {
      if (input.dataset.hbBound) {
        return;
      }
      input.dataset.hbBound = 'true';
      input.addEventListener('change', () => {
        const isAnyChecked = sizeInputs.some((radio) => radio.checked);
        confirmBtn.disabled = !isAnyChecked;
      });
    });

    if (!confirmBtn.dataset.hbBound) {
      confirmBtn.dataset.hbBound = 'true';
      confirmBtn.addEventListener('click', () => {
        const selected = sizeInputs.find((radio) => radio.checked);
        const currentItem = getActiveItem();
        if (!selected || !currentItem) {
          return;
        }
        const sizeValue = selected.value;
        const price = resolvePriceForSize(sizeValue);
        if (!Number.isFinite(price) || price <= 0) {
          showCatalogCartFeedback(cartText('unknownPrice'), 'error');
          return;
        }
        const titleEn = currentItem.getAttribute('data-title') || '';
        const titleHi = currentItem.getAttribute('data-title-hi') || titleEn;
        const productId = currentItem.getAttribute('data-product-id') || slugify(titleEn || sizeValue);
        const imageSrc = currentItem.getAttribute('data-img') || '';
        confirmBtn.disabled = true;
        const payload = {
          productId,
          product: titleEn,
          productHi: titleHi,
          size: sizeValue,
          quantity: 1,
          price,
          image: imageSrc,
          metadata: {
            productId,
            source: 'preorder-modal',
            titleHi,
          },
        };

        if (!window.HBCart || typeof window.HBCart.addItem !== 'function') {
          showCatalogCartFeedback(getCartDisabledMessage(), 'warning');
          confirmBtn.disabled = false;
          return;
        }

        window.HBCart.addItem(payload)
          .then(() => {
            const localizedTitle = state.language === 'hi' && titleHi ? titleHi : titleEn;
            showCatalogCartFeedback(`${localizedTitle} (${sizeValue}) added to your cart.`, 'success');
            hideModal();
          })
          .catch((error) => {
            const message = error && error.message ? error.message : cartText('updateError');
            showCatalogCartFeedback(message, 'error');
          })
          .finally(() => {
            const hasSelection = sizeInputs.some((radio) => radio.checked);
            confirmBtn.disabled = !hasSelection;
          });
      });
    }

    if (cancelBtn && !cancelBtn.dataset.hbBound) {
      cancelBtn.dataset.hbBound = 'true';
      cancelBtn.addEventListener('click', hideModal);
    }
    if (closeBtn && !closeBtn.dataset.hbBound) {
      closeBtn.dataset.hbBound = 'true';
      closeBtn.addEventListener('click', hideModal);
    }

    if (overlay && !overlay.dataset.hbBound) {
      overlay.dataset.hbBound = 'true';
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          hideModal();
        }
      });
    }
  }

  function loadPreorderSeed() {
    try {
      const raw = storage.getItem(PREFILL_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function updateReservationImage(reservationImg, productName, fallback) {
    if (!reservationImg) return;
    let imageSrc = fallback || 'assets/img/reservation.jpg';

    if (productName && state.productAssets[productName] && state.productAssets[productName].img) {
      imageSrc = state.productAssets[productName].img;
    } else {
      const seed = loadPreorderSeed();
      if (seed && seed.product === productName && seed.img) {
        imageSrc = seed.img;
      }
    }

    reservationImg.style.backgroundImage = `url(${imageSrc})`;
  }

  function initPreorderForm() {
    const preorderSection = qs('#preorder');
    if (!preorderSection) return;

    const productSelect = qs('select[name="product"]', preorderSection);
    const sizeSelect = qs('select[name="size"]', preorderSection);
    const reservationImg = qs('.reservation-img', preorderSection);
    const params = new URLSearchParams(window.location.search);
    const seed = loadPreorderSeed();

    const initialProduct = params.get('product') || (seed && seed.product) || '';
    const initialProductHi = params.get('productHi') || (seed && seed.productHi) || '';
    const initialSize = params.get('size') || (seed && seed.size) || '';

    const normalizeForMatch = (value) => (value || '')
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/—/g, '-')
      .toLowerCase();

    const findMatchingOption = (selectEl, candidates) => {
      if (!selectEl) return null;
      const normalizedCandidates = candidates
        .filter((candidate) => candidate && candidate.toString().trim().length)
        .map((candidate) => normalizeForMatch(candidate));
      if (!normalizedCandidates.length) return null;
      const options = qsa('option', selectEl).filter((option) => option.value.trim().length);
      return options.find((option) => {
        const valuesToCheck = [
          option.value,
          option.textContent,
          option.getAttribute('data-en'),
          option.getAttribute('data-hi'),
        ]
          .filter((value) => value != null)
          .map((value) => normalizeForMatch(value));
        return normalizedCandidates.some((candidate) => valuesToCheck.includes(candidate));
      }) || null;
    };

    let resolvedProduct = initialProduct || initialProductHi;
    const matchedProductOption = findMatchingOption(productSelect, [
      initialProduct,
      initialProductHi,
      seed && seed.product,
      seed && seed.productHi,
    ]);
    if (productSelect && matchedProductOption) {
      productSelect.value = matchedProductOption.value;
      resolvedProduct = matchedProductOption.value;
      productSelect.dataset.hbPrefilled = 'true';
    }

    const matchedSizeOption = findMatchingOption(sizeSelect, [
      initialSize,
      seed && seed.size,
    ]);
    if (sizeSelect && matchedSizeOption) {
      sizeSelect.value = matchedSizeOption.value;
      sizeSelect.dataset.hbPrefilled = 'true';
    }

    const productForImage = (productSelect && productSelect.value)
      || resolvedProduct
      || (seed && seed.product)
      || initialProduct
      || initialProductHi;
    updateReservationImage(reservationImg, productForImage);

    if ((matchedProductOption || matchedSizeOption) && !preorderSection.classList.contains('hb-prefilled')) {
      preorderSection.classList.add('hb-prefilled');
    }

    if (productSelect && !productSelect.dataset.hbBound) {
      productSelect.dataset.hbBound = 'true';
      productSelect.addEventListener('change', () => {
        updateReservationImage(reservationImg, productSelect.value);
      });
    }
  }

  function initContactForm() {
    const form = qs('.contact-form');
    if (!form) return;

    window.sendToWhatsApp = function sendToWhatsApp() {
      const name = (qs('#name') || { value: '' }).value.trim();
      const email = (qs('#email') || { value: '' }).value.trim();
      const subject = (qs('#subject') || { value: '' }).value.trim();
      const message = (qs('#message') || { value: '' }).value.trim();
      const phone = '919930815228';
      const text = `Hello Himalayan Blossom, my name is ${name}.\nEmail: ${email}\nSubject: ${subject}\nMessage: ${message}`;
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    };
  }

  function renderCartDisabledPage() {
    if (!isCartPageActive()) {
      return;
    }
    const root = document.getElementById('cartPageRoot');
    if (!root) {
      return;
    }
    const message = getCartDisabledMessage();
    root.innerHTML = `
      <div class="alert alert-info cart-disabled-alert" role="status">${message}</div>
    `;
  }


  function initGlobals(options) {
    const force = Boolean(options && options.force);
    if (globalsInitialized && !force) {
      return;
    }
    initLanguageToggle();
    initThemeToggle();
    initMobileNav();
    initCartTriggers();
    globalsInitialized = true;
  }

  function refreshPageFeatures() {
    collectProductAssets();
    updateLanguage(state.language);
    applyTheme(state.theme);
    if (window.HBLayout && typeof window.HBLayout.refresh === 'function') {
      window.HBLayout.refresh();
    }
    initProductModal();
    initPreorderModal();
    initPreorderForm();
    initContactForm();
    initCartPage();
  }

  function init() {
    initGlobals();
    refreshPageFeatures();
    processPendingCartItem();
  }

  window.addEventListener('hb:auth:signed-in', () => {
    refreshCartAuthState();
  });

  window.addEventListener('hb:auth:signed-out', () => {
    refreshCartAuthState();
  });

  HBSite.refreshPage = refreshPageFeatures;
  document.addEventListener('hb:spa:pagechange', refreshPageFeatures);
  window.addEventListener('hb:layout:ready', () => {
    initGlobals({ force: true });
    refreshPageFeatures();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
