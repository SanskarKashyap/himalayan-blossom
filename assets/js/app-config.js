(function () {
  'use strict';

  var didLog = false;
  var didWarnFirebase = false;
  var envResolved = false;

  function applyEnvironment(overrides) {
    var env = overrides && typeof overrides === 'object' ? overrides : window.__ENV || {};

    if (!didLog && typeof console !== 'undefined' && console.log) {
      console.log('[app-config] Loaded environment overrides:', env);
      didLog = true;
    }

    window.APP_API_BASE_URL =
      env.APP_API_BASE_URL || window.APP_API_BASE_URL ||
      // Auto-detect: use current origin so it works on any port (3000, 5500, vercel, etc.)
      (typeof window !== 'undefined' && window.location
        ? window.location.origin + '/api'
        : 'http://localhost:3000/api');

    window.APP_GOOGLE_CLIENT_ID =
      window.APP_GOOGLE_CLIENT_ID || env.APP_GOOGLE_CLIENT_ID || '';

    window.APP_FIREBASE_CONFIG = env.APP_FIREBASE_CONFIG || window.APP_FIREBASE_CONFIG || null;

    if (
      envResolved &&
      !window.APP_FIREBASE_CONFIG &&
      typeof console !== 'undefined' &&
      console.warn &&
      !didWarnFirebase
    ) {
      console.warn(
        'APP_FIREBASE_CONFIG is not set. Provide values via assets/js/env.js or window.__ENV.'
      );
      didWarnFirebase = true;
    }

    return env;
  }

  function handleEnvReady(event) {
    var payload = (event && event.detail) || window.__ENV || {};
    envResolved = true;
    applyEnvironment(payload);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('hb:env:ready', handleEnvReady, { once: true });
  }

  if (typeof window !== 'undefined' && window.HBEnv && typeof window.HBEnv.whenReady === 'function') {
    window.HBEnv.whenReady(function (env) {
      envResolved = true;
      applyEnvironment(env);
    });
  }

  applyEnvironment(window.__ENV || {});
})();
