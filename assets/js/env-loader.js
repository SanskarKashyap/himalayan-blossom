(function () {
  'use strict';

  function snapshotGlobals() {
    const data = {};
    if (typeof window.APP_API_BASE_URL === 'string') {
      data.APP_API_BASE_URL = window.APP_API_BASE_URL;
    }
    if (typeof window.APP_GOOGLE_CLIENT_ID === 'string') {
      data.APP_GOOGLE_CLIENT_ID = window.APP_GOOGLE_CLIENT_ID;
    }
    if (window.APP_FIREBASE_CONFIG) {
      data.APP_FIREBASE_CONFIG = window.APP_FIREBASE_CONFIG;
    }
    return data;
  }

  const HBEnv = {
    data: snapshotGlobals(),
    load() {
      this.data = snapshotGlobals();
      return Promise.resolve(this.data);
    },
    get(key) {
      return this.data[key];
    },
  };

  window.HBEnv = HBEnv;
  HBEnv.load();
})();
