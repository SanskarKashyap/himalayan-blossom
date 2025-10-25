(function () {
  'use strict';

  const HBSite = window.HBSite || (window.HBSite = {});

  const storage = window.localStorage;
  const PREFILL_KEY = 'hb_preorder_prefill_v1';
  const PENDING_CART_KEY = 'hb_pending_cart_item_v1';
  const PRODUCT_ASSETS_KEY = 'hb_product_assets_v1';
  const CART_STORAGE_KEY = 'hb_cart_state_v1';
  const CART_API_ENDPOINT = '/api/cart';
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

  const HBCart = createCartManager();
  HBSite.cart = HBCart;
  window.HBCart = HBCart;

  let globalsInitialized = false;
  let cartFeedbackTimer = null;

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

  function createCartManager() {
    const subscribers = new Set();
    let lastEmittedCart = undefined;
    let syncPromise = null;
    let cartState = loadStoredCart();
    let remoteSyncDisabled = false;

    function loadStoredCart() {
      try {
        const raw = storage.getItem(CART_STORAGE_KEY);
        if (!raw) {
          return { items: [], updatedAt: null };
        }
        const parsed = JSON.parse(raw);
        const sanitizedItems = sanitizeCartItems(parsed.items || []);
        return {
          items: sanitizedItems,
          updatedAt: parsed.updatedAt || null,
          uid: parsed.uid || '',
          email: parsed.email || '',
        };
      } catch (error) {
        try {
          storage.removeItem(CART_STORAGE_KEY);
        } catch (removeError) {
          /* ignore */
        }
        return { items: [], updatedAt: null };
      }
    }

    function saveStoredCart(cart) {
      try {
        storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      } catch (error) {
        console.warn('[HB Cart] Unable to persist cart locally', error);
      }
    }

    function cloneCart(cart) {
      if (cart === null || cart === undefined) {
        return cart;
      }
      const items = Array.isArray(cart.items)
        ? cart.items
            .map((item) => (item && typeof item === 'object' ? Object.assign({}, item) : null))
            .filter(Boolean)
        : [];
      return Object.assign({}, cart, { items });
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
      window.dispatchEvent(
        new CustomEvent('hb:cart:updated', {
          detail: {
            cart: snapshot,
          },
        })
      );
    }

    function disableRemoteSync(reason) {
      if (remoteSyncDisabled) {
        return;
      }
      remoteSyncDisabled = true;
      if (reason) {
        console.info('[HB Cart] Remote cart sync disabled:', reason);
      } else {
        console.info('[HB Cart] Remote cart sync disabled: API unavailable');
      }
    }

    function isApiUnavailableError(error) {
      if (!error) {
        return false;
      }
      if (error.status === 404 || error.status === 405 || error.status === 501) {
        return true;
      }
      const message = (error && error.message && error.message.toString()) || '';
      return /cannot\s+get|not\s+found|failed to fetch/i.test(message);
    }

    function shouldSync() {
      return Boolean(
        window.Auth
        && typeof window.Auth.isAuthenticated === 'function'
        && typeof window.Auth.apiFetch === 'function'
        && window.Auth.isAuthenticated()
        && !remoteSyncDisabled
      );
    }

    function scheduleCartSync(cart) {
      if (!shouldSync()) {
        return Promise.resolve(null);
      }
      const snapshot = cloneCart(cart);
      syncPromise = (syncPromise || Promise.resolve())
        .catch(() => undefined)
        .then(() => syncCartSnapshot(snapshot));
      return syncPromise;
    }

    async function syncCartSnapshot(cart) {
      if (!cart || !Array.isArray(cart.items)) {
        return;
      }
      try {
        await window.Auth.apiFetch(CART_API_ENDPOINT, {
          method: 'POST',
          body: { items: cart.items },
        });
      } catch (error) {
        if (isApiUnavailableError(error)) {
          disableRemoteSync(error && error.message ? error.message : 'API unavailable');
          return;
        }
        console.warn('[HB Cart] Failed to sync cart', error);
        window.dispatchEvent(
          new CustomEvent('hb:cart:error', {
            detail: {
              error: error && error.message ? error.message : 'Unable to sync your cart. Changes are saved locally.',
            },
          })
        );
      }
    }

    function makeItemKey(item) {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const productId = item.productId || slugify(item.product || '');
      const size = item.size || 'default';
      return `${productId}`.toLowerCase() + '::' + `${size}`.toLowerCase();
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

    function findItemIndex(items, target) {
      if (!target) {
        return -1;
      }
      const key = makeItemKey(target);
      return items.findIndex((candidate) => makeItemKey(candidate) === key);
    }

    async function ensureAuthenticated() {
      if (window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated()) {
        return window.Auth.getUser();
      }
      if (window.Auth && typeof window.Auth.signIn === 'function') {
        await window.Auth.signIn({ redirectTo: window.location.href });
      }
      throw new Error('Please sign in to continue.');
    }

    function commitCart(items, meta, options) {
      const sanitizedItems = sanitizeCartItems(items);
      const nextCart = Object.assign(
        {
          items: sanitizedItems,
          updatedAt: new Date().toISOString(),
        },
        meta && typeof meta === 'object' ? meta : {}
      );
      cartState = nextCart;
      saveStoredCart(nextCart);
      emitCartUpdate(nextCart);
      if (!options || !options.skipSync) {
        scheduleCartSync(nextCart);
      }
      return nextCart;
    }

    async function mutateCart(user, mutator, options) {
      const currentItems = Array.isArray(cartState.items)
        ? cartState.items.map((raw) => (raw && typeof raw === 'object' ? Object.assign({}, raw) : {}))
        : [];
      const mutatedItems = typeof mutator === 'function' ? mutator(currentItems) || currentItems : currentItems;
      const meta = {
        uid: (user && (user.uid || user.id)) || cartState.uid || '',
        email: (user && user.email) || cartState.email || '',
      };
      return commitCart(mutatedItems, meta, options);
    }

    async function addItem(rawItem, options) {
      const user = await ensureAuthenticated();
      const item = normalizeCartItem(rawItem);
      const action = (options && options.action) || 'add';

      const cart = await mutateCart(user, (items) => {
        const existingIndex = findItemIndex(items, item);
        if (existingIndex >= 0) {
          const current = Object.assign({}, items[existingIndex]);
          const currentQuantity = Number(current.quantity) || 0;
          const nextQuantity = action === 'replace' ? item.quantity : currentQuantity + item.quantity;
          current.quantity = Math.max(1, nextQuantity);
          current.price = item.price != null ? item.price : current.price;
          current.notes = item.notes || current.notes || '';
          current.metadata = item.metadata != null ? item.metadata : current.metadata || null;
          current.language = item.language || current.language || state.language;
          items[existingIndex] = current;
        } else {
          items.push(item);
        }
        return items;
      });

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
    }

    async function setItemQuantity(productId, size, quantity) {
      const user = await ensureAuthenticated();
      const desiredQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
      return mutateCart(user, (items) => {
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
      });
    }

    async function incrementItem(productId, size, delta) {
      const user = await ensureAuthenticated();
      const change = Math.floor(Number(delta) || 0);
      if (!change) {
        return mutateCart(user, (items) => items);
      }
      return mutateCart(user, (items) => {
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
      });
    }

    async function removeItem(productId, size) {
      const user = await ensureAuthenticated();
      return mutateCart(user, (items) => {
        const placeholderItem = { productId, product: productId, size };
        const index = findItemIndex(items, placeholderItem);
        if (index === -1) {
          return items;
        }
        items.splice(index, 1);
        return items;
      });
    }

    async function updateItem(productId, size, updates) {
      const user = await ensureAuthenticated();
      return mutateCart(user, (items) => {
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
      });
    }

    function subscribe(callback) {
      if (typeof callback !== 'function') {
        return () => {};
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

    async function syncFromServer() {
      if (!window.Auth || typeof window.Auth.apiFetch !== 'function') {
        return cartState;
      }
      if (!shouldSync()) {
        return cartState;
      }
      try {
        const response = await window.Auth.apiFetch(CART_API_ENDPOINT, { method: 'GET' });
        const payload = response && typeof response === 'object' && response.cart ? response.cart : response;
        const items = sanitizeCartItems((payload && payload.items) || []);
        const meta = {
          uid: (payload && (payload.uid || payload.user_id)) || cartState.uid || '',
          email: (payload && payload.email) || cartState.email || '',
          updatedAt: payload && payload.updatedAt ? payload.updatedAt : new Date().toISOString(),
        };
        return commitCart(items, meta, { skipSync: true });
      } catch (error) {
        if (isApiUnavailableError(error)) {
          disableRemoteSync(error && error.message ? error.message : 'API unavailable');
          return cartState;
        }
        console.warn('[HB Cart] Failed to fetch cart from server', error);
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
      try {
        storage.removeItem(CART_STORAGE_KEY);
      } catch (error) {
        /* ignore */
      }
      cartState = { items: [], updatedAt: null };
      if (options && options.emitNull) {
        emitCartUpdate(null);
      } else {
        emitCartUpdate(cartState);
      }
    }

    emitCartUpdate(cartState);

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
    };
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
    const priceValue = Number(item.price);

    return {
      productId: item.productId || fallbackId,
      product: name,
      size,
      quantity,
      price: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
      image: item.img || item.image || '',
      notes: item.notes || '',
      language: item.language || state.language,
      addedAt: item.addedAt || new Date().toISOString(),
      metadata: item.metadata || null,
    };
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
      signInPrompt: 'Please sign in to view and manage your cart.',
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
      updateError: 'Unable to update cart. Please try again.',
      decrementAria: 'Decrease quantity',
      incrementAria: 'Increase quantity',
    },
    hi: {
      empty: 'आपका कार्ट खाली है।',
      signInPrompt: 'अपना कार्ट देखने और प्रबंधित करने के लिए कृपया साइन इन करें।',
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
  };

  const cartCurrencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
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
    return Boolean(elements.itemsList && elements.subtotal && elements.total && elements.checkoutButton);
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

    const priceValue = Number(item.price);
    const quantityValue = Number(item.quantity) || 0;
    const lineTotal = Number.isFinite(priceValue) ? priceValue * quantityValue : Number.NaN;

    const totalLabel = document.createElement('div');
    totalLabel.className = 'cart-item-price fw-semibold';
    totalLabel.textContent = Number.isFinite(lineTotal) ? formatCartCurrency(lineTotal) : cartText('unknownPrice');
    actions.appendChild(totalLabel);

    if (Number.isFinite(priceValue)) {
      const unitLabel = document.createElement('small');
      unitLabel.className = 'text-muted';
      unitLabel.textContent = `${formatCartCurrency(priceValue)} x ${quantityValue || 0}`;
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
        const price = Number(item.price);
        if (Number.isFinite(price) && quantity > 0) {
          accumulator.subtotal += price * quantity;
        }
        accumulator.itemCount += quantity > 0 ? quantity : 0;
        return accumulator;
      },
      { subtotal: 0, itemCount: 0 }
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

    if (elements.summaryCard) {
      elements.summaryCard.classList.remove('opacity-75', 'disabled');
    }

    if (!isAuthenticated) {
      if (elements.itemsList) {
        elements.itemsList.innerHTML = '';
      }
      if (elements.emptyState) {
        elements.emptyState.classList.add('d-none');
      }
      if (elements.summaryCard) {
        elements.summaryCard.classList.add('opacity-75', 'disabled');
      }
      if (elements.checkoutButton) {
        elements.checkoutButton.disabled = true;
        elements.checkoutButton.setAttribute('aria-disabled', 'true');
      }
      if (elements.authPrompt) {
        elements.authPrompt.classList.remove('d-none');
      }
      return;
    }

    if (elements.authPrompt) {
      elements.authPrompt.classList.add('d-none');
    }

    if (elements.itemsList) {
      elements.itemsList.innerHTML = '';
    }

    if (!items.length) {
      if (elements.emptyState) {
        elements.emptyState.classList.remove('d-none');
      }
    } else {
      if (elements.emptyState) {
        elements.emptyState.classList.add('d-none');
      }
      if (elements.itemsList) {
        items.forEach((item) => {
          elements.itemsList.appendChild(buildCartItemElement(item, lang));
        });
      }
    }

    const totals = computeCartTotals(items);
    const totalValue = totals.subtotal;
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
    }
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
    renderCart(cart);
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
    }
    cartPageState.initialized = true;
    if (cartPageState.lastCart !== undefined) {
      renderCart(cartPageState.lastCart);
    } else {
      const isAuthenticated = window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated();
      renderCart(isAuthenticated ? { items: [] } : null);
    }
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

  function hideCartFeedback() {
    const container = qs('#cartFeedback');
    if (!container) {
      return;
    }
    container.classList.add('d-none');
    container.classList.remove('alert-success', 'alert-danger', 'alert-info');
    container.textContent = '';
    if (cartFeedbackTimer) {
      window.clearTimeout(cartFeedbackTimer);
      cartFeedbackTimer = null;
    }
  }

  function showCartFeedback(message, options) {
    const container = qs('#cartFeedback');
    if (!container || !message) {
      if (!container && message) {
        console.info('[HB Cart]', message);
      }
      return;
    }
    const type = options && options.type === 'error'
      ? 'alert-danger'
      : options && options.type === 'info'
        ? 'alert-info'
        : 'alert-success';
    container.classList.remove('alert-success', 'alert-danger', 'alert-info', 'd-none');
    container.classList.add(type);
    container.textContent = message;
    if (cartFeedbackTimer) {
      window.clearTimeout(cartFeedbackTimer);
    }
    const duration = options && Number.isFinite(options.duration)
      ? Math.max(2000, Number(options.duration))
      : 4000;
    cartFeedbackTimer = window.setTimeout(() => {
      hideCartFeedback();
    }, duration);
  }

  function savePendingCartItem(item, context) {
    if (!item || typeof item !== 'object') {
      return;
    }
    const now = Date.now();
    const payload = {
      item,
      context: context || 'collection',
      createdAt: now,
      expiresAt: now + 30 * 60 * 1000,
      product: {
        en: item.product || '',
        hi: item.productHi || '',
      },
      size: item.size || '',
    };
    try {
      storage.setItem(PENDING_CART_KEY, JSON.stringify(payload));
    } catch (error) {
      /* ignore persistence errors */
    }
  }

  function loadPendingCartItem() {
    try {
      const raw = storage.getItem(PENDING_CART_KEY);
      if (!raw) {
        return null;
      }
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') {
        storage.removeItem(PENDING_CART_KEY);
        return null;
      }
      if (data.expiresAt && Number.isFinite(Number(data.expiresAt)) && Date.now() > Number(data.expiresAt)) {
        storage.removeItem(PENDING_CART_KEY);
        return null;
      }
      return data;
    } catch (error) {
      storage.removeItem(PENDING_CART_KEY);
      return null;
    }
  }

  function clearPendingCartItem() {
    try {
      storage.removeItem(PENDING_CART_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  let pendingCartProcessing = false;

  async function processPendingCartItem() {
    if (pendingCartProcessing) {
      return;
    }
    const pending = loadPendingCartItem();
    if (!pending || !pending.item) {
      return;
    }
    if (!window.Auth || typeof window.Auth.isAuthenticated !== 'function' || !window.Auth.isAuthenticated()) {
      return;
    }

    pendingCartProcessing = true;
    try {
      await HBCart.addItem(pending.item);
    } catch (error) {
      const message = error && error.message ? error.message : (state.language === 'hi'
        ? 'कार्ट में आइटम जोड़ने में असमर्थ।'
        : 'Unable to add item to cart.');
      window.dispatchEvent(
        new CustomEvent('hb:cart:error', {
          detail: {
            error: message,
            item: pending.item,
          },
        })
      );
    } finally {
      clearPendingCartItem();
      pendingCartProcessing = false;
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
      confirmBtn.addEventListener('click', async () => {
        const selected = sizeInputs.find((radio) => radio.checked);
        const currentItem = getActiveItem();
        if (!selected || !currentItem) {
          return;
        }

        hideCartFeedback();

        const productTitle = currentItem.getAttribute('data-title') || '';
        const productTitleHi = currentItem.getAttribute('data-title-hi') || '';
        const productImg = currentItem.getAttribute('data-img') || '';
        const cartItem = {
          productId: currentItem.getAttribute('data-product-id') || slugify(`${productTitle}-${selected.value}`),
          product: productTitle,
          productHi: productTitleHi,
          size: selected.value,
          quantity: 1,
          img: productImg,
          price: resolvePriceForSize(selected.value),
          language: state.language,
        };
        const payload = {
          product: productTitle,
          productHi: productTitleHi,
          size: selected.value,
          img: productImg,
        };

        try {
          storage.setItem(PREFILL_KEY, JSON.stringify(payload));
        } catch (error) {
          /* ignore storage persistence errors */
        }

        const originalEn = confirmBtn.getAttribute('data-en') || confirmBtn.textContent;
        const originalHi = confirmBtn.getAttribute('data-hi') || originalEn;
        const loadingText = state.language === 'hi' ? 'कार्ट में जोड़ रहा है...' : 'Adding to cart...';
        const successTextEn = productTitle
          ? `Added ${productTitle}${selected.value ? ` (${selected.value})` : ''} to cart!`
          : 'Added to cart!';
        const successTextHi = productTitleHi
          ? `${productTitleHi}${selected.value ? ` (${selected.value})` : ''} कार्ट में जोड़ दिया गया है!`
          : 'कार्ट में जोड़ दिया गया!';
        const restoreButtonState = () => {
          confirmBtn.setAttribute('data-en', originalEn);
          confirmBtn.setAttribute('data-hi', originalHi);
          confirmBtn.textContent = state.language === 'hi' ? originalHi : originalEn;
          confirmBtn.disabled = false;
        };

        confirmBtn.setAttribute('data-en', loadingText);
        confirmBtn.setAttribute('data-hi', loadingText);
        confirmBtn.textContent = loadingText;
        confirmBtn.disabled = true;

        const isAuthenticated = window.Auth
          && typeof window.Auth.isAuthenticated === 'function'
          && window.Auth.isAuthenticated();

        if (!isAuthenticated) {
          savePendingCartItem(cartItem, 'collection');
          hideModal();
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
          restoreButtonState();
          return;
        }

        try {
          if (HBCart && typeof HBCart.addItem === 'function') {
            await HBCart.addItem(cartItem);
          }
        } catch (error) {
          console.error('Failed to add item to cart', error);
          const message = error && error.message ? error.message : 'Unable to add item to cart.';
          const isAuthError = /sign\s?in/i.test(message);
          window.dispatchEvent(
            new CustomEvent('hb:cart:error', {
              detail: {
                error: message,
                item: cartItem,
              },
            })
          );
          if (isAuthError) {
            savePendingCartItem(cartItem, 'collection');
            hideModal();
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
          } else {
            if (!qs('#cartFeedback')) {
              window.alert(message);
            }
          }
          restoreButtonState();
          return;
        }

        clearPendingCartItem();
        hideModal();
        confirmBtn.setAttribute('data-en', successTextEn);
        confirmBtn.setAttribute('data-hi', successTextHi);
        confirmBtn.textContent = state.language === 'hi' ? successTextHi : successTextEn;

        window.setTimeout(() => {
          restoreButtonState();
        }, 2000);
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

  function initGlobals(options) {
    const force = Boolean(options && options.force);
    if (globalsInitialized && !force) {
      return;
    }
    initLanguageToggle();
    initThemeToggle();
    initMobileNav();
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
    processPendingCartItem();
  }

  function init() {
    initGlobals();
    refreshPageFeatures();
  }

  window.addEventListener('hb:auth:signed-in', () => {
    if (HBCart && typeof HBCart.syncFromServer === 'function') {
      HBCart.syncFromServer();
    }
    processPendingCartItem();
  });

  window.addEventListener('hb:auth:signed-out', () => {
    if (HBCart && typeof HBCart.clearLocal === 'function') {
      HBCart.clearLocal({ emitNull: true });
    }
  });

  window.addEventListener('hb:cart:added', (event) => {
    const detail = event && typeof event === 'object' ? (event.detail || {}) : {};
    const item = detail.item || {};
    const isHindi = state.language === 'hi';
    const productName = isHindi
      ? item.productHi || item.product || (detail.product && detail.product.hi) || ''
      : item.product || (detail.product && detail.product.en) || '';
    const sizeSuffix = item.size ? ` (${item.size})` : '';
    const message = isHindi
      ? `${productName || 'चयनित उत्पाद'}${sizeSuffix} कार्ट में जोड़ दिया गया है।`
      : `${productName || 'Selected product'}${sizeSuffix} added to your cart.`;
    showCartFeedback(message, { type: 'success' });
  });

  window.addEventListener('hb:cart:error', (event) => {
    const detail = event && typeof event === 'object' ? (event.detail || {}) : {};
    const message = detail.error || (state.language === 'hi'
      ? 'कार्ट को अपडेट करने में समस्या आई।'
      : 'There was a problem updating your cart.');
    showCartFeedback(message, { type: 'error', duration: 6000 });
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
