(function () {
  'use strict';

  function send(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(JSON.stringify(payload));
  }

  function parseFirebaseConfig(rawConfig) {
    if (!rawConfig) {
      return null;
    }

    if (typeof rawConfig !== 'string') {
      return null;
    }

    try {
      var parsed = JSON.parse(rawConfig);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (error) {
      console.warn('api/env: Failed to parse APP_FIREBASE_CONFIG JSON.', error);
    }

    return null;
  }

  function buildClientEnv() {
    var env = {};

    if (process.env.APP_API_BASE_URL) {
      env.APP_API_BASE_URL = process.env.APP_API_BASE_URL;
    }
    if (process.env.APP_GOOGLE_CLIENT_ID) {
      env.APP_GOOGLE_CLIENT_ID = process.env.APP_GOOGLE_CLIENT_ID;
    }

    var firebaseConfig = parseFirebaseConfig(process.env.APP_FIREBASE_CONFIG);
    if (firebaseConfig) {
      env.APP_FIREBASE_CONFIG = firebaseConfig;
    }

    return env;
  }

  module.exports = function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      send(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      var payload = buildClientEnv();
      send(res, 200, payload);
    } catch (error) {
      console.error('api/env: Failed to resolve client environment.', error);
      send(res, 500, { error: 'Failed to resolve configuration.' });
    }
  };
})();
