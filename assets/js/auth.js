(function () {
  'use strict';

  const CONFIG = {
    apiBaseUrl: (window.APP_API_BASE_URL || 'http://localhost:8000/api').replace(/\/$/, ''),
    googleClientId: window.APP_GOOGLE_CLIENT_ID || '144658462401-2l7kms1j90v4jl9ovga4uvolunnhghpj.apps.googleusercontent.com',
  };

  const STORAGE_KEY = 'hb_auth_state_v1';
  const DEFAULT_PRICING = Object.assign(
    {
      '250 gram': 1199,
      '500 gram': 1999,
      '1000 gram': 3499,
    },
    typeof window.APP_PREORDER_PRICING === 'object' && !Array.isArray(window.APP_PREORDER_PRICING)
      ? Object.fromEntries(
          Object.entries(window.APP_PREORDER_PRICING).filter(([, value]) =>
            typeof value === 'number'
          )
        )
      : {}
  );

  const state = {
    user: null,
    access: null,
    refresh: null,
    googleInitialized: false,
  };

  const dom = {};
  let refreshPromise = null;
  let googleInitPromise = null;
  let razorpayPromise = null;

  function init() {
    queryDom();
    loadState();
    updateUI();
    registerEvents();

    if (!CONFIG.googleClientId) {
      renderGoogleFallback(new Error('Missing Google Client ID configuration.'));
    } else {
      ensureGoogleInitialized().catch((error) => {
        console.warn('Google sign-in failed to initialize:', error);
        renderGoogleFallback(error);
      });
    }
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

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.access && parsed.refresh && parsed.user) {
        state.access = parsed.access;
        state.refresh = parsed.refresh;
        state.user = parsed.user;
      }
    } catch (error) {
      console.warn('Failed to read stored auth state', error);
    }
  }

  function persistState() {
    try {
      if (state.user && state.access && state.refresh) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            user: state.user,
            access: state.access,
            refresh: state.refresh,
          })
        );
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Unable to persist auth state', error);
    }
  }

  function isAuthenticated() {
    return Boolean(state.access && state.refresh && state.user);
  }

  function setHidden(element, hidden) {
    if (!element) return;
    if (hidden) {
      element.setAttribute('hidden', 'hidden');
    } else {
      element.removeAttribute('hidden');
    }
  }

  function setText(element, text) {
    if (!element) return;
    element.textContent = text || '';
  }

  function getDisplayName(user) {
    if (!user) return '';
    const name = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) return name;
    if (user.username) return user.username;
    if (user.email) return user.email.split('@')[0];
    return 'Guest';
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

  function updateUI() {
    const authed = isAuthenticated();
    setHidden(dom.signedOutDesktop, authed);
    setHidden(dom.signedInDesktop, !authed);
    setHidden(dom.signedOutMobile, authed);
    setHidden(dom.signedInMobile, !authed);

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

  function registerEvents() {
    if (dom.logoutDesktop) {
      dom.logoutDesktop.addEventListener('click', (event) => {
        event.preventDefault();
        signOut();
      });
    }
    if (dom.logoutMobile) {
      dom.logoutMobile.addEventListener('click', (event) => {
        event.preventDefault();
        signOut();
      });
    }
    if (dom.loginTriggerDesktop) {
      dom.loginTriggerDesktop.addEventListener('click', handleLoginTrigger);
    }
    if (dom.loginTriggerMobile) {
      dom.loginTriggerMobile.addEventListener('click', handleLoginTrigger);
    }

    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        loadState();
        updateUI();
      }
    });
  }

  function triggerLoginPrompt() {
    updateStatusMessages('Opening sign-in options...', { type: 'info' });
    ensureGoogleInitialized()
      .then(() => {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          try {
            window.google.accounts.id.prompt();
            clearStatusMessages();
          } catch (error) {
            console.debug('Google prompt not available', error);
            updateStatusMessages('Google sign-in is temporarily unavailable.', {
              type: 'error',
              title: error && error.message ? error.message : String(error),
            });
          }
        } else {
          updateStatusMessages('Google sign-in is temporarily unavailable.', {
            type: 'error',
          });
        }
      })
      .catch((error) => {
        renderGoogleFallback(error);
      });
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

  function handleLoginTrigger(event) {
    if (event) {
      event.preventDefault();
    }
    triggerLoginPrompt();
  }

  function dispatchAuthEvent(eventName, detail) {
    window.dispatchEvent(
      new CustomEvent(`hb:auth:${eventName}`, {
        detail: detail || {},
      })
    );
  }

  function applyAuthData(data) {
    state.user = data?.user || null;
    state.access = data?.access || null;
    state.refresh = data?.refresh || null;
    persistState();
    updateUI();
    dispatchAuthEvent('changed', { user: state.user });
    if (state.user) {
      dispatchAuthEvent('signed-in', { user: state.user });
    }
  }

  function clearAuthState(options) {
    state.user = null;
    state.access = null;
    state.refresh = null;
    persistState();
    updateUI();
    if (!options || !options.silent) {
      dispatchAuthEvent('changed', { user: null });
      dispatchAuthEvent('signed-out', {});
    }
  }

  function signOut() {
    clearAuthState();
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.disableAutoSelect();
      } catch (error) {
        console.debug('Failed to disable Google auto select', error);
      }
    }
  }

  function renderGoogleFallback(error) {
    const message = CONFIG.googleClientId
      ? 'Google sign-in is temporarily unavailable.'
      : 'Set APP_GOOGLE_CLIENT_ID to enable Google login.';

    updateStatusMessages(message, {
      type: 'error',
      title: error && error.message ? error.message : undefined,
    });
  }

  function waitForGoogleLibrary(maxAttempts = 60, intervalMs = 200) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.google && window.google.accounts && window.google.accounts.id) {
          window.clearInterval(timer);
          resolve(window.google.accounts.id);
          return;
        }
        if (attempts >= maxAttempts) {
          window.clearInterval(timer);
          reject(new Error('Google Identity Services SDK failed to load.'));
        }
      }, intervalMs);
    });
  }

  function ensureGoogleInitialized() {
    if (state.googleInitialized) {
      return Promise.resolve();
    }
    if (!CONFIG.googleClientId) {
      return Promise.reject(new Error('Missing Google client ID.'));
    }
    if (googleInitPromise) {
      return googleInitPromise;
    }

    googleInitPromise = waitForGoogleLibrary()
      .then(() => {
        window.google.accounts.id.initialize({
          client_id: CONFIG.googleClientId,
          callback: handleGoogleCredential,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });
        state.googleInitialized = true;
        clearStatusMessages();
        try {
          window.google.accounts.id.prompt();
        } catch (error) {
          console.debug('Google prompt not available yet', error);
        }
      })
      .catch((error) => {
        renderGoogleFallback(error);
        throw error;
      })
      .finally(() => {
        googleInitPromise = null;
      });

    return googleInitPromise;
  }

  function handleGoogleCredential(response) {
    if (!response || !response.credential) {
      console.warn('Google credential response was empty.');
      return;
    }
    exchangeCredentialForTokens(response.credential).catch((error) => {
      console.error('Google sign-in failed', error);
      dispatchAuthEvent('error', { message: error.message });
    });
  }

  async function exchangeCredentialForTokens(credential) {
    const response = await fetch(
      buildApiUrl('/auth/google/'),
      prepareRequestInit({
        method: 'POST',
        body: { credential },
      })
    );
    if (!response.ok) {
      const message = await extractErrorMessage(response);
      throw new Error(message);
    }
    const data = await response.json();
    if (!data?.access || !data?.refresh || !data?.user) {
      throw new Error('Authentication response was incomplete.');
    }
    applyAuthData(data);
    return data;
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
    return init;
  }

  function buildApiUrl(path) {
    if (/^https?:/i.test(path)) {
      return path;
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${CONFIG.apiBaseUrl}${normalizedPath}`;
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

  async function refreshAccessToken() {
    if (!state.refresh) {
      signOut();
      throw new Error('Session expired. Please sign in again.');
    }
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = fetch(
      buildApiUrl('/auth/token/refresh/'),
      prepareRequestInit({
        method: 'POST',
        body: { refresh: state.refresh },
      })
    )
      .then(async (response) => {
        if (!response.ok) {
          const message = await extractErrorMessage(response);
          signOut();
          throw new Error(message || 'Session expired. Please sign in again.');
        }
        const data = await response.json();
        if (!data?.access) {
          signOut();
          throw new Error('Failed to refresh session.');
        }
        state.access = data.access;
        persistState();
        updateUI();
        return state.access;
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  async function apiFetch(path, options, retry = true) {
    const init = prepareRequestInit(options || {});
    if (isAuthenticated() && !init.headers.has('Authorization')) {
      init.headers.set('Authorization', `Bearer ${state.access}`);
    }

    const response = await fetch(buildApiUrl(path), init);

    if (response.status === 401 && retry && state.refresh) {
      try {
        await refreshAccessToken();
      } catch (error) {
        throw error;
      }
      return apiFetch(path, options, false);
    }

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  }

  function ensureRazorpayLoaded() {
    if (window.Razorpay) {
      return Promise.resolve(window.Razorpay);
    }
    if (razorpayPromise) {
      return razorpayPromise;
    }

    razorpayPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(
        'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
      );

      const handleLoad = () => {
        if (window.Razorpay) {
          resolve(window.Razorpay);
        } else {
          reject(new Error('Razorpay SDK loaded but unavailable.'));
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

  function dispatchPaymentEvent(eventName, detail) {
    window.dispatchEvent(
      new CustomEvent(`hb:payment:${eventName}`, {
        detail: detail || {},
      })
    );
  }

  function promptSignIn() {
    return ensureGoogleInitialized()
      .then(() => {
        try {
          window.google.accounts.id.prompt();
        } catch (error) {
          console.debug('Google prompt unavailable', error);
        }
      })
      .catch((error) => {
        renderGoogleFallback(error);
        throw error;
      });
  }

  async function handlePreorderSubmit(event) {
    event.preventDefault();
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) {
      return false;
    }

    const status = createFormStatusController(form);

    if (!isAuthenticated()) {
      status.error('Please sign in with Google to reserve your batch.');
      promptSignIn().catch(() => {
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
        amount,
        currency: 'INR',
        notes: {
          customer_name: name,
          customer_email: email,
          phone,
          city,
          variant,
          size,
          message,
        },
      };

      const response = await apiFetch('/payments/order/', {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Auth = {
    isAuthenticated,
    getUser: () => state.user,
    signIn: () => promptSignIn(),
    signOut,
    apiFetch,
    ensureGoogleInitialized,
    refreshAccessToken,
  };

  window.handlePreorderSubmit = handlePreorderSubmit;
})();
