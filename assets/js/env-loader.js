(function () {
  'use strict';

  var hostname =
    (typeof window !== 'undefined' &&
      window.location &&
      typeof window.location.hostname === 'string' &&
      window.location.hostname) ||
    '';

  function isLikelyLocalHost(value) {
    if (!value) return false;
    return (
      value === 'localhost' ||
      value === '127.0.0.1' ||
      value === '[::1]' ||
      value.endsWith('.local')
    );
  }

  var DEFAULT_SCRIPT_SOURCES = ['assets/js/env.js'];
  if (isLikelyLocalHost(hostname)) {
    DEFAULT_SCRIPT_SOURCES.unshift('assets/js/env.local.js');
    DEFAULT_SCRIPT_SOURCES.push('assets/js/env.sample.js');
  }
  var REMOTE_ENDPOINT =
    (typeof window.__HB_ENV_ENDPOINT === 'string' && window.__HB_ENV_ENDPOINT) || '/api/env';

  var hbEnvData = {};
  var isReady = false;
  var readyListeners = [];
  var loadPromise = null;

  function snapshotGlobals() {
    var data = {};
    if (typeof window.APP_API_BASE_URL === 'string') {
      data.APP_API_BASE_URL = window.APP_API_BASE_URL;
    }
    if (typeof window.APP_GOOGLE_CLIENT_ID === 'string') {
      data.APP_GOOGLE_CLIENT_ID = window.APP_GOOGLE_CLIENT_ID;
    }
    if (window.APP_FIREBASE_CONFIG) {
      data.APP_FIREBASE_CONFIG = window.APP_FIREBASE_CONFIG;
    }
    if (window.__ENV && typeof window.__ENV === 'object') {
      data = Object.assign({}, window.__ENV, data);
    }
    return data;
  }

  function notifyReady(env) {
    var nextData = Object.assign({}, env);
    isReady = true;

    var merged;
    if (typeof window !== 'undefined' && window.__ENV && typeof window.__ENV === 'object') {
      merged = Object.assign({}, window.__ENV, nextData);
    } else {
      merged = Object.assign({}, nextData);
    }

    window.__ENV = merged;
    hbEnvData = Object.assign({}, merged);

    var listeners = readyListeners.slice();
    readyListeners.length = 0;
    listeners.forEach(function (listener) {
      try {
        listener(hbEnvData);
      } catch (error) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('HBEnv listener failed', error);
        }
      }
    });

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('hb:env:ready', { detail: hbEnvData }));
      } catch (error) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('HBEnv: Failed to dispatch ready event', error);
        }
      }
    }

    return hbEnvData;
  }

  function whenReady(callback) {
    if (typeof callback !== 'function') {
      return;
    }
    if (isReady) {
      callback(hbEnvData);
    } else {
      readyListeners.push(callback);
    }
  }

  function evaluateEnvSource(source, code) {
    if (!code || typeof code !== 'string') {
      return null;
    }

    var executor;
    try {
      executor = new Function('window', 'document', code + '\nreturn window.__ENV;');
    } catch (error) {
      var parseError = new Error('HBEnv: Failed to parse ' + source + '. ' + error.message);
      parseError.originalError = error;
      throw parseError;
    }

    var result;
    var previous = window.__ENV;
    try {
      result = executor(window, document);
    } catch (error) {
      window.__ENV = previous;
      var evalError = new Error('HBEnv: Failed to evaluate ' + source + '. ' + error.message);
      evalError.originalError = error;
      throw evalError;
    }

    if (result && typeof result === 'object') {
      return result;
    }
    if (window.__ENV && typeof window.__ENV === 'object') {
      return window.__ENV;
    }

    window.__ENV = previous;
    return null;
  }

  function loadScript(src) {
    if (typeof fetch === 'function') {
      return fetch(src, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
        .then(function (response) {
          if (!response.ok) {
            var error = new Error('HBEnv: Failed to fetch ' + src + ' (' + response.status + ')');
            if (response.status === 404) {
              error.skipMissing = true;
            }
            throw error;
          }
          return response.text();
        })
        .then(function (code) {
          return evaluateEnvSource(src, code);
        });
    }

    return new Promise(function (resolve, reject) {
      if (!src) {
        reject(new Error('HBEnv: Script source not provided.'));
        return;
      }

      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.crossOrigin = 'anonymous';
      script.onerror = function () {
        script.remove();
        var error = new Error('HBEnv: Failed to load script ' + src);
        error.skipMissing = true;
        reject(error);
      };
      script.onload = function () {
        script.remove();
        resolve(window.__ENV && typeof window.__ENV === 'object' ? window.__ENV : null);
      };

      (document.head || document.documentElement).appendChild(script);
    });
  }

  function loadLocalEnv() {
    var sources = [];

    if (Array.isArray(window.__HB_ENV_SOURCES) && window.__HB_ENV_SOURCES.length) {
      sources = window.__HB_ENV_SOURCES.slice();
    } else {
      sources = DEFAULT_SCRIPT_SOURCES.slice();
    }

    var index = 0;

    return new Promise(function (resolve, reject) {
      function tryNext() {
        if (index >= sources.length) {
          resolve(null);
          return;
        }

        var src = sources[index++];
        loadScript(src)
          .then(function (env) {
            if (env && typeof env === 'object') {
              resolve(env);
              return;
            }
            if (window.__ENV && typeof window.__ENV === 'object') {
              resolve(window.__ENV);
              return;
            }
            tryNext();
          })
          .catch(function (error) {
            if (error && error.skipMissing) {
              tryNext();
              return;
            }
            if (typeof console !== 'undefined' && console.warn) {
              console.warn(error);
            }
            tryNext();
          });
      }

      tryNext();
    });
  }

  function loadRemoteEnv() {
    if (!REMOTE_ENDPOINT) {
      return Promise.reject(new Error('HBEnv: Remote endpoint is not defined.'));
    }

    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('HBEnv: fetch is not available in this environment.'));
    }

    return fetch(REMOTE_ENDPOINT, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(function (response) {
        if (!response.ok) {
          if (response.status === 404) {
            return {};
          }
          throw new Error('HBEnv: Remote env request failed with ' + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        if (!payload || typeof payload !== 'object') {
          throw new Error('HBEnv: Remote env payload is invalid.');
        }
        return payload;
      });
  }

  function resolveEnvironment() {
    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = Promise.resolve()
      .then(function () {
        if (window.__ENV && typeof window.__ENV === 'object') {
          return window.__ENV;
        }
        return loadLocalEnv()
          .catch(function () {
            return null;
          })
          .then(function (env) {
            if (env && typeof env === 'object' && Object.keys(env).length > 0) {
              return env;
            }
            return loadRemoteEnv();
          });
      })
      .catch(function () {
        return snapshotGlobals();
      })
      .then(function (env) {
        return notifyReady(env);
      })
      .catch(function (error) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('HBEnv: Falling back to snapshot. Reason:', error);
        }
        return notifyReady(snapshotGlobals());
      });

    return loadPromise;
  }

  function getValue(key) {
    return hbEnvData[key];
  }

  var HBEnv = {
    get data() {
      return Object.assign({}, hbEnvData);
    },
    get isReady() {
      return isReady;
    },
    whenReady: whenReady,
    load: resolveEnvironment,
    get: getValue,
  };

  window.HBEnv = HBEnv;
  resolveEnvironment();
})();
