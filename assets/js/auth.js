(function () {
  'use strict';

  function normalizeBaseUrl(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.replace(/\/$/, '');
  }

  function coerceFirebaseConfig(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'object') {
      return value;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        console.warn('Auth: unable to parse Firebase config string', error);
      }
    }
    return null;
  }

  const CONFIG = {
    get apiBaseUrl() {
      return normalizeBaseUrl(window.APP_API_BASE_URL || '');
    },
    loginLogEndpoint: '/api/login-log',
    cartEndpoint: '/api/cart',
    get firebaseConfig() {
      const direct = coerceFirebaseConfig(window.APP_FIREBASE_CONFIG);
      if (direct) {
        return direct;
      }
      if (window.HBEnv && typeof window.HBEnv.get === 'function') {
        return coerceFirebaseConfig(window.HBEnv.get('APP_FIREBASE_CONFIG'));
      }
      return null;
    },
    authCookieName: 'hbAuthToken',
  };

  const DEFAULT_PRICING = Object.assign(
    {
      '250 gram': 1199,
      '500 gram': 1999,
      '1000 gram': 3499,
    },
    typeof window.APP_PREORDER_PRICING === 'object' && !Array.isArray(window.APP_PREORDER_PRICING)
      ? Object.fromEntries(
        Object.entries(window.APP_PREORDER_PRICING).filter(([, value]) => typeof value === 'number')
      )
      : {}
  );

  const state = {
    user: null,
    idToken: null,
    tokenExpiresAt: null,
    lastLoginAuthTime: null,
    firebaseReady: false,
  };

  const dom = {};
  const observers = new Set();

  let envReadyPromise = null;
  let firebaseReadyPromise = null;
  let razorpayPromise = null;

  function ensureEnvironmentReady() {
    if (envReadyPromise) {
      return envReadyPromise;
    }

    const loader = window.HBEnv;
    if (loader && typeof loader.load === 'function') {
      envReadyPromise = loader
        .load()
        .catch((error) => {
          console.warn('Auth: environment file failed to load', error);
        })
        .then(() => {
          return loader && loader.data ? loader.data : {};
        });
      return envReadyPromise;
    }

    envReadyPromise = Promise.resolve({});
    return envReadyPromise;
  }

  function init() {
    queryDom();
    registerEvents();
    updateUI();

    ensureFirebaseReady().catch((error) => {
      console.warn('Firebase initialization failed:', error);
      updateStatusMessages('Login is temporarily unavailable.', {
        type: 'error',
        title: error && error.message ? error.message : undefined,
      });
    });
  }

  function queryDom() {
    dom.signedOutDesktop = document.getElementById('authSignedOutDesktop');
    dom.signedInDesktop = document.getElementById('authSignedInDesktop');
    dom.signedOutMobile = document.getElementById('authSignedOutMobile');
    dom.signedInMobile = document.getElementById('authSignedInMobile');
    dom.userNameDesktop = document.getElementById('authUserNameDesktop');
    dom.userRoleDesktop = document.getElementById('authUserRoleDesktop');
    dom.userNameMobile = document.getElementById('authUserNameMobile');
    dom.userRoleMobile = document.getElementById('authUserRoleMobile');
    dom.logoutDesktop = document.getElementById('authLogoutButtonDesktop');
    dom.logoutMobile = document.getElementById('authLogoutButtonMobile');
    dom.loginTriggerDesktop = document.getElementById('authLoginTriggerDesktop');
    dom.loginTriggerMobile = document.getElementById('authLoginTriggerMobile');
    dom.loginMessageDesktop = document.getElementById('authStatusMessageDesktop');
    dom.loginMessageMobile = document.getElementById('authStatusMessageMobile');
  }

  function registerEvents() {
    if (dom.logoutDesktop && !dom.logoutDesktop.dataset.hbBound) {
      dom.logoutDesktop.dataset.hbBound = 'true';
      dom.logoutDesktop.addEventListener('click', (event) => {
        event.preventDefault();
        signOut();
      });
    }

    if (dom.logoutMobile && !dom.logoutMobile.dataset.hbBound) {
      dom.logoutMobile.dataset.hbBound = 'true';
      dom.logoutMobile.addEventListener('click', (event) => {
        event.preventDefault();
        signOut();
      });
    }

    if (dom.loginTriggerDesktop && !dom.loginTriggerDesktop.dataset.hbBound) {
      dom.loginTriggerDesktop.dataset.hbBound = 'true';
      dom.loginTriggerDesktop.addEventListener('click', handleLoginTrigger);
    }

    if (dom.loginTriggerMobile && !dom.loginTriggerMobile.dataset.hbBound) {
      dom.loginTriggerMobile.dataset.hbBound = 'true';
      dom.loginTriggerMobile.addEventListener('click', handleLoginTrigger);
    }
  }

  function updateUI() {
    const authed = isAuthenticated();
    toggleHidden(dom.signedOutDesktop, authed);
    toggleHidden(dom.signedInDesktop, !authed);
    toggleHidden(dom.signedOutMobile, authed);
    toggleHidden(dom.signedInMobile, !authed);

    if (authed && state.user) {
      const displayName = getDisplayName(state.user);
      setText(dom.userNameDesktop, displayName);
      setText(dom.userNameMobile, displayName);
      updateRoleBadge(dom.userRoleDesktop, state.user.role);
      updateRoleBadge(dom.userRoleMobile, state.user.role);
    } else {
      setText(dom.userNameDesktop, '');
      setText(dom.userNameMobile, '');
      updateRoleBadge(dom.userRoleDesktop, null);
      updateRoleBadge(dom.userRoleMobile, null);
    }
  }

  function toggleHidden(element, hidden) {
    if (!element) return;
    if (hidden) {
      element.setAttribute('hidden', 'hidden');
    } else {
      element.removeAttribute('hidden');
    }
  }

  function setText(element, text) {
    if (element) {
      element.textContent = text || '';
    }
  }

  function updateRoleBadge(element, role) {
    if (!element) return;
    if (role) {
      element.textContent = role;
      element.removeAttribute('hidden');
    } else {
      element.textContent = '';
      element.setAttribute('hidden', 'hidden');
    }
  }

  function getDisplayName(user) {
    if (!user) return '';
    if (user.displayName) return user.displayName;
    if (user.first_name || user.last_name) {
      return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    }
    if (user.email) return user.email.split('@')[0];
    return 'Guest';
  }

  function updateStatusMessages(text, options) {
    const elements = [dom.loginMessageDesktop, dom.loginMessageMobile];
    elements.forEach((element) => {
      if (!element) return;
      if (text) {
        element.textContent = text;
        if (options && options.title) {
          element.title = options.title;
        } else {
          element.removeAttribute('title');
        }
        if (options && options.type) {
          element.dataset.statusType = options.type;
        } else {
          delete element.dataset.statusType;
        }
        element.removeAttribute('hidden');
      } else {
        element.textContent = '';
        element.setAttribute('hidden', 'hidden');
        element.removeAttribute('title');
        delete element.dataset.statusType;
      }
    });
  }

  function clearStatusMessages() {
    updateStatusMessages('', {});
  }

  function dispatchAuthEvent(eventName, detail) {
    const payload = detail || {};
    window.dispatchEvent(new CustomEvent(`hb:auth:${eventName}`, { detail: payload }));
    observers.forEach((callback) => {
      try {
        callback(eventName, payload);
      } catch (error) {
        console.warn('Auth observer callback failed', error);
      }
    });
  }

  function handleLoginTrigger(event) {
    if (event) {
      event.preventDefault();
    }
    signInWithFirebase({ redirectTo: window.location.href });
  }

  function ensureFirebaseReady() {
    return ensureEnvironmentReady().then(() => {
      if (state.firebaseReady && window.firebase) {
        const firebase = window.firebase;
        return {
          firebase,
          app: firebase.app(),
          auth: firebase.auth(),
          firestore: firebase.firestore(),
        };
      }

      if (firebaseReadyPromise) {
        return firebaseReadyPromise;
      }

      const firebaseConfig = CONFIG.firebaseConfig;
      if (!firebaseConfig || !firebaseConfig.apiKey) {
        return Promise.reject(new Error('Missing Firebase configuration. Set window.APP_FIREBASE_CONFIG before loading auth.js.'));
      }

      const scripts = [
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
      ];

      firebaseReadyPromise = scripts
        .reduce((promise, src) => promise.then(() => loadScriptOnce(src)), Promise.resolve())
        .then(() => {
          const firebase = window.firebase;
          if (!firebase || !firebase.initializeApp) {
            throw new Error('Firebase SDK failed to load.');
          }
          if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
          }
          const app = firebase.app();
          const auth = firebase.auth();
          const firestore = firebase.firestore();

          auth.onIdTokenChanged(handleFirebaseUser);
          state.firebaseReady = true;

          return { firebase, app, auth, firestore };
        })
        .catch((error) => {
          firebaseReadyPromise = null;
          throw error;
        });

      return firebaseReadyPromise;
    });
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-hb-src="${src}"]`)) {
        resolve();
        return;
      }

      const existing = Array.from(document.querySelectorAll('script')).find((script) => script.src === src);
      if (existing) {
        if (existing.dataset.hbLoaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => {
          existing.dataset.hbLoaded = 'true';
          resolve();
        }, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.hbSrc = src;
      script.addEventListener('load', () => {
        script.dataset.hbLoaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => {
        reject(new Error(`Failed to load script: ${src}`));
      }, { once: true });
      document.head.appendChild(script);
    });
  }

  function resolveRedirectTarget(target) {
    const fallback = `${window.location.pathname}${window.location.search}${window.location.hash}` || 'index.html';
    if (!target || typeof target !== 'string') {
      return fallback;
    }
    try {
      const url = new URL(target, window.location.origin);
      if (url.origin !== window.location.origin) {
        return fallback;
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (error) {
      return fallback;
    }
  }

  function redirectToAuthPage(page, options) {
    const redirectTo = resolveRedirectTarget(options && options.redirectTo);
    const url = new URL(page, window.location.origin);
    if (redirectTo) {
      url.searchParams.set('redirect', redirectTo);
    }
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  function signInWithFirebase(options) {
    redirectToAuthPage('login.html', options);
    return Promise.resolve({ redirected: true });
  }

  function signOut() {
    return ensureFirebaseReady()
      .then(({ auth }) => auth.signOut())
      .catch(() => {
        clearAuthState({ silent: true });
      })
      .finally(() => {
        clearAuthState({ silent: true });
      });
  }

  function isAuthenticated() {
    return Boolean(state.user && state.idToken);
  }

  function clearAuthState(options) {
    state.user = null;
    state.idToken = null;
    state.tokenExpiresAt = null;
    state.lastLoginAuthTime = null;
    clearAuthCookie();
    updateUI();
    if (!options || !options.silent) {
      dispatchAuthEvent('changed', { user: null });
      dispatchAuthEvent('signed-out', {});
    }
  }

  function clearAuthCookie() {
    document.cookie = `${CONFIG.authCookieName}=; Max-Age=0; path=/; SameSite=Strict`;
  }

  function persistAuthCookie(token, expiration) {
    if (!token) {
      clearAuthCookie();
      return;
    }

    let maxAge = 3600;
    if (expiration instanceof Date) {
      const diff = Math.floor((expiration.getTime() - Date.now()) / 1000);
      if (Number.isFinite(diff) && diff > 0) {
        maxAge = diff;
      }
    }

    const attributes = ['path=/', 'SameSite=Strict', `Max-Age=${Math.max(300, maxAge)}`];
    if (location.protocol === 'https:') {
      attributes.push('Secure');
    }

    document.cookie = `${CONFIG.authCookieName}=${encodeURIComponent(token)}; ${attributes.join('; ')}`;
  }

  async function handleFirebaseUser(user) {
    if (!user) {
      clearAuthState({ silent: false });
      return;
    }

    try {
      const tokenResult = await user.getIdTokenResult();
      const expiration = tokenResult.expirationTime ? new Date(tokenResult.expirationTime) : null;
      state.user = {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        role: user.role || '',
      };
      state.idToken = tokenResult.token;
      state.tokenExpiresAt = expiration;
      persistAuthCookie(tokenResult.token, expiration);
      updateUI();
      dispatchAuthEvent('changed', { user: state.user });
      dispatchAuthEvent('signed-in', { user: state.user });

      if (tokenResult.authTime && state.lastLoginAuthTime !== tokenResult.authTime) {
        state.lastLoginAuthTime = tokenResult.authTime;
        logLoginActivity({ tokenResult });
      }
    } catch (error) {
      console.error('Failed to resolve Firebase user token', error);
      updateStatusMessages('Authentication failed. Please try signing in again.', { type: 'error' });
      clearAuthState({ silent: false });
    }
  }

  async function getIdToken(options) {
    const { forceRefresh = false } = options || {};
    await ensureFirebaseReady().catch(() => null);

    const firebase = window.firebase;
    if (!firebase) {
      return null;
    }

    const auth = firebase.auth();
    if (!auth.currentUser) {
      return null;
    }

    try {
      const token = await auth.currentUser.getIdToken(forceRefresh);
      const tokenResult = await auth.currentUser.getIdTokenResult();
      state.idToken = token;
      state.tokenExpiresAt = tokenResult.expirationTime ? new Date(tokenResult.expirationTime) : null;
      persistAuthCookie(token, state.tokenExpiresAt);
      return token;
    } catch (error) {
      console.warn('Unable to obtain Firebase ID token', error);
      return null;
    }
  }

  function buildApiUrl(path) {
    if (/^https?:/i.test(path)) {
      return path;
    }
    const base = CONFIG.apiBaseUrl || '';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
      return `${base}${normalizedPath.slice(4)}`;
    }
    if (!base) {
      return normalizedPath;
    }
    return `${base}${normalizedPath}`;
  }

  function prepareRequestInit(options) {
    const init = Object.assign({}, options);
    const headers = new Headers(options && options.headers ? options.headers : {});

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    let body = options ? options.body : undefined;
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body && typeof body === 'object' && !isFormData) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const contentType = headers.get('Content-Type') || '';
      if (contentType.includes('application/json') && typeof body !== 'string') {
        body = JSON.stringify(body);
      }
    }

    init.headers = headers;
    init.body = body;
    init.credentials = options && options.credentials ? options.credentials : 'include';
    return init;
  }

  async function apiFetch(path, options) {
    await ensureEnvironmentReady();
    const init = prepareRequestInit(options || {});
    const token = await getIdToken();
    if (token) {
      init.headers.set('Authorization', `Bearer ${token}`);
    }

    const execute = () => fetch(buildApiUrl(path), init);
    let response = await execute();

    if (response.status === 401) {
      const refreshedToken = await getIdToken({ forceRefresh: true });
      if (refreshedToken) {
        init.headers.set('Authorization', `Bearer ${refreshedToken}`);
        response = await execute();
      }
    }

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      const error = new Error(message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.statusText = response.statusText;
      throw error;
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async function extractErrorMessage(response) {
    try {
      const data = await response.clone().json();
      if (data) {
        if (typeof data.detail === 'string') {
          return data.detail;
        }
        if (typeof data.message === 'string') {
          return data.message;
        }
        if (Array.isArray(data) && data[0]) {
          return data[0];
        }
      }
    } catch (error) {
      // ignore JSON parse errors
    }
    try {
      const text = await response.text();
      if (text) {
        return text;
      }
    } catch (error) {
      // ignore text errors
    }
    return `Request failed with status ${response.status}`;
  }

  async function logLoginActivity({ tokenResult }) {
    try {
      const token = await getIdToken();
      if (!token) {
        return;
      }
      const payload = {
        event: 'login',
        authTime: tokenResult ? tokenResult.authTime : new Date().toISOString(),
      };
      await fetch(CONFIG.loginLogEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = error && error.message ? error.message.toString() : '';
      if (/missing\s+firebase\s+service\s+account/i.test(message)) {
        console.info('Login activity logging skipped: service account configuration is missing.');
        return;
      }
      console.warn('Failed to log login activity', error);
    }
  }

  function createFormStatusController(form) {
    const loadingEl = form.querySelector('.loading');
    const errorEl = form.querySelector('.error-message');
    const successEl = form.querySelector('.sent-message');
    const submitBtn = form.querySelector('button[type="submit"]');

    if (loadingEl && !loadingEl.dataset.defaultText) {
      loadingEl.dataset.defaultText = loadingEl.textContent.trim();
    }
    if (errorEl && !errorEl.dataset.defaultText) {
      errorEl.dataset.defaultText = errorEl.textContent.trim();
    }
    if (successEl && !successEl.dataset.defaultText) {
      successEl.dataset.defaultText = successEl.textContent.trim();
    }

    function setVisibility(element, visible, message) {
      if (!element) return;
      element.style.display = visible ? 'block' : 'none';
      if (visible) {
        element.textContent = message || element.dataset.defaultText || element.textContent;
      }
    }

    function idle() {
      setVisibility(loadingEl, false);
      setVisibility(errorEl, false);
      setVisibility(successEl, false);
      if (submitBtn) submitBtn.disabled = false;
    }

    function loading(message) {
      if (submitBtn) submitBtn.disabled = true;
      setVisibility(errorEl, false);
      setVisibility(successEl, false);
      setVisibility(loadingEl, true, message || loadingEl?.dataset.defaultText);
    }

    function success(message) {
      if (submitBtn) submitBtn.disabled = false;
      setVisibility(loadingEl, false);
      setVisibility(errorEl, false);
      setVisibility(successEl, true, message || successEl?.dataset.defaultText);
    }

    function error(message) {
      if (submitBtn) submitBtn.disabled = false;
      setVisibility(loadingEl, false);
      setVisibility(successEl, false);
      setVisibility(errorEl, true, message || errorEl?.dataset.defaultText || 'Something went wrong.');
    }

    idle();

    return { idle, loading, success, error };
  }

  function resolvePreorderAmount(variant, size) {
    const pricingConfig = typeof window.APP_PREORDER_PRICING === 'object' ? window.APP_PREORDER_PRICING : {};
    const normalizedVariant = (variant || '').trim();
    const normalizedSize = (size || '').trim();

    let amount = null;
    if (normalizedVariant && pricingConfig[normalizedVariant] && typeof pricingConfig[normalizedVariant] === 'object') {
      const candidate = Number(pricingConfig[normalizedVariant][normalizedSize]);
      if (Number.isFinite(candidate) && candidate > 0) {
        amount = candidate;
      }
    }

    if (!amount && normalizedSize) {
      const candidate = Number(pricingConfig[normalizedSize]);
      if (Number.isFinite(candidate) && candidate > 0) {
        amount = candidate;
      }
    }

    if (!amount && normalizedSize) {
      const candidate = Number(DEFAULT_PRICING[normalizedSize]);
      if (Number.isFinite(candidate) && candidate > 0) {
        amount = candidate;
      }
    }

    return amount;
  }

  function ensureRazorpayLoaded() {
    if (window.Razorpay) {
      return Promise.resolve(window.Razorpay);
    }
    if (razorpayPromise) {
      return razorpayPromise;
    }

    razorpayPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');

      const handleLoad = () => {
        if (window.Razorpay) {
          resolve(window.Razorpay);
        } else {
          reject(new Error('Razorpay SDK loaded but Razorpay is undefined.'));
        }
      };

      const handleError = () => {
        reject(new Error('Unable to load Razorpay SDK.'));
      };

      if (existingScript) {
        existingScript.addEventListener('load', handleLoad, { once: true });
        existingScript.addEventListener('error', handleError, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = handleLoad;
        script.onerror = handleError;
        document.head.appendChild(script);
      }

      window.setTimeout(() => {
        if (!window.Razorpay) {
          reject(new Error('Timed out waiting for Razorpay SDK.'));
        }
      }, 10000);
    }).finally(() => {
      if (!window.Razorpay) {
        razorpayPromise = null;
      }
    });

    return razorpayPromise;
  }

  async function promptSignIn(options) {
    signInWithFirebase(options);
    throw new Error('Redirecting to sign-in.');
  }

  async function handlePreorderSubmit(event) {
    event.preventDefault();
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) {
      return false;
    }

    const status = createFormStatusController(form);

    if (!isAuthenticated()) {
      status.error('Please sign in to reserve your batch.');
      promptSignIn({ redirectTo: window.location.href }).catch(() => {
        // Swallow prompt errors — message already displayed
      });
      return false;
    }

    const formData = new FormData(form);
    const name = (formData.get('name') || '').toString().trim();
    const email = (formData.get('email') || '').toString().trim();
    const variant = (formData.get('product') || '').toString().trim();
    const size = (formData.get('size') || '').toString().trim();
    const phone = (formData.get('phone') || '').toString().trim();
    const city = (formData.get('city') || '').toString().trim();
    const message = (formData.get('message') || '').toString().trim();

    if (!variant || !size) {
      status.error('Please select a honey variant and jar size.');
      return false;
    }

    const amount = resolvePreorderAmount(variant, size);
    if (!amount) {
      status.error('Pricing for the selected jar size is not configured.');
      return false;
    }

    status.loading('Creating secure checkout...');

    try {
      const payload = {
        // amount: amount, // Security: Do not send amount. Server calculates it.
        variant,
        size,
        currency: 'INR',
        notes: {
          customer_name: name,
          customer_email: email,
          phone,
          city,
          message,
        },
      };

      const response = await apiFetch('/api/create-order', {
        method: 'POST',
        body: payload,
      });

      status.idle();

      const { order, razorpay_key_id: keyId } = response || {};
      if (!order || !order.razorpay_order_id || !keyId) {
        throw new Error('Incomplete payment response from server.');
      }

      dispatchPaymentEvent('order-created', { order });

      await ensureRazorpayLoaded();

      const amountPaise = Math.round(Number(order.amount || amount) * 100);

      const razorpay = new window.Razorpay({
        key: keyId,
        amount: amountPaise,
        currency: order.currency || 'INR',
        name: 'Himalayan Blossom',
        description: `Pre-order: ${variant} (${size})`,
        order_id: order.razorpay_order_id,
        prefill: {
          name: name || getDisplayName(state.user) || 'Himalayan Blossom Patron',
          email: email || state.user?.email || '',
          contact: phone || '',
        },
        notes: order.notes || payload.notes,
        theme: {
          color: '#d4af37',
        },
        handler: function () {
          status.success('Thank you! Your payment is underway. We will email the receipt shortly.');
          form.reset();
          dispatchPaymentEvent('payment-initiated', { order });
        },
        modal: {
          ondismiss: function () {
            status.idle();
            dispatchPaymentEvent('payment-dismissed', { order });
          },
        },
      });

      razorpay.open();
    } catch (error) {
      status.error(error.message || 'Unable to initiate payment. Please try again.');
      dispatchPaymentEvent('error', { message: error.message });
    }

    return false;
  }

  function dispatchPaymentEvent(eventName, detail) {
    window.dispatchEvent(
      new CustomEvent(`hb:payment:${eventName}`, {
        detail: detail || {},
      })
    );
  }

  const Auth = {
    isAuthenticated,
    getUser: () => (state.user ? Object.assign({}, state.user) : null),
    signIn: (options) => signInWithFirebase(options),
    signOut,
    apiFetch,
    ensureFirebaseReady,
    getIdToken,
    redirectToAuthPage: (page, options) => redirectToAuthPage(page, options),
    on: (callback) => {
      if (typeof callback === 'function') {
        observers.add(callback);
        return () => observers.delete(callback);
      }
      return () => { };
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Auth = Auth;
  window.handlePreorderSubmit = handlePreorderSubmit;
})();
