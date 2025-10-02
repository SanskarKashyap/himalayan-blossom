(function () {
  'use strict';

  const global = window;
  const defaults = {
    apiBaseUrl: `${window.location.origin}/api`,
    googleClientId: '',
    googleRedirectUri: '',
  };

  function parseDotEnv(content) {
    if (typeof content !== 'string') {
      return {};
    }
    return content.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return acc;
      }
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) {
        return acc;
      }
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if (!key) {
        return acc;
      }
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      acc[key] = value;
      return acc;
    }, {});
  }

  function loadEnvConfig(script) {
    try {
      const dataset = (script && script.dataset) || {};
      const envPath = dataset.envPath || '.env';
      if (!envPath) {
        return {};
      }
      const request = new XMLHttpRequest();
      request.open('GET', envPath, false);
      request.send(null);
      if (request.status >= 200 && request.status < 300) {
        return parseDotEnv(request.responseText);
      }
    } catch (error) {
      console.warn('Failed to load .env configuration', error);
    }
    return {};
  }

  function normalizeEnvConfig(raw) {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const mapping = {
      APP_API_BASE_URL: 'apiBaseUrl',
      API_BASE_URL: 'apiBaseUrl',
      APP_GOOGLE_CLIENT_ID: 'googleClientId',
      GOOGLE_CLIENT_ID: 'googleClientId',
      APP_GOOGLE_REDIRECT_URI: 'googleRedirectUri',
      GOOGLE_REDIRECT_URI: 'googleRedirectUri',
    };
    const config = {};
    Object.keys(mapping).forEach((key) => {
      if (raw[key] && typeof raw[key] === 'string' && raw[key].trim()) {
        config[mapping[key]] = raw[key].trim();
      }
    });
    return config;
  }

  function readDatasetConfig(script) {
    if (!script || !script.dataset) {
      return {};
    }
    const { apiBaseUrl, googleClientId, googleRedirectUri } = script.dataset;
    const config = {};
    if (typeof apiBaseUrl === 'string' && apiBaseUrl.trim()) {
      config.apiBaseUrl = apiBaseUrl.trim();
    }
    if (typeof googleClientId === 'string' && googleClientId.trim()) {
      config.googleClientId = googleClientId.trim();
    }
    if (typeof googleRedirectUri === 'string' && googleRedirectUri.trim()) {
      config.googleRedirectUri = googleRedirectUri.trim();
    }
    return config;
  }

  const script = document.currentScript;
  const envConfig = normalizeEnvConfig(loadEnvConfig(script));
  const datasetConfig = readDatasetConfig(script);
  const overrides = typeof global.APP_CONFIG === 'object' && global.APP_CONFIG !== null
    ? global.APP_CONFIG
    : {};
  
  // Use pre-set window variables if available
  const presetConfig = {
    apiBaseUrl: global.APP_API_BASE_URL,
    googleClientId: global.APP_GOOGLE_CLIENT_ID,
    googleRedirectUri: global.APP_GOOGLE_REDIRECT_URI
  };

  const runtimeConfig = Object.assign({}, defaults, envConfig, datasetConfig, presetConfig, overrides);

  function applyGlobals(config) {
    global.APP_CONFIG = config;
    global.APP_API_BASE_URL = global.APP_API_BASE_URL || config.apiBaseUrl;
    global.APP_GOOGLE_CLIENT_ID = global.APP_GOOGLE_CLIENT_ID || config.googleClientId;
    global.APP_GOOGLE_REDIRECT_URI = global.APP_GOOGLE_REDIRECT_URI || config.googleRedirectUri;
    return config;
  }

  const normalizedApiBase = (runtimeConfig.apiBaseUrl || defaults.apiBaseUrl).replace(/\/$/, '');

  applyGlobals(runtimeConfig);

  const serverConfigPromise = fetch(`${normalizedApiBase}/public-config/`, {
    credentials: 'include',
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((serverConfig) => {
      if (!serverConfig || typeof serverConfig !== 'object') {
        return applyGlobals(runtimeConfig);
      }
      const merged = Object.assign(runtimeConfig, {
        apiBaseUrl: (serverConfig.apiBaseUrl || runtimeConfig.apiBaseUrl || defaults.apiBaseUrl).replace(/\/$/, ''),
        googleClientId: serverConfig.googleClientId || runtimeConfig.googleClientId || '',
        googleRedirectUri: serverConfig.googleRedirectUri || runtimeConfig.googleRedirectUri || '',
      });
      return applyGlobals(merged);
    })
    .catch((error) => {
      console.warn('Falling back to static runtime config', error);
      return applyGlobals(runtimeConfig);
    });

  global.APP_CONFIG_READY = serverConfigPromise;
})();
