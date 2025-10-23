(function () {
  'use strict';

  window.APP_API_BASE_URL =
    window.APP_API_BASE_URL || 'http://localhost:5500/api';

  window.APP_GOOGLE_CLIENT_ID =
    window.APP_GOOGLE_CLIENT_ID ||
    '144658462401-2l7kms1j90v4jl9ovga4uvolunnhghpj.apps.googleusercontent.com';

  window.APP_FIREBASE_CONFIG =
    window.APP_FIREBASE_CONFIG || {
      apiKey: 'AIzaSyDgQ8SvyJCTMd-QLmeayDdcx7EjwfnPr9U',
      authDomain: 'himalayan-blossom.firebaseapp.com',
      projectId: 'himalayan-blossom',
      storageBucket: 'himalayan-blossom.firebasestorage.app',
      messagingSenderId: '744535362855',
      appId: '1:744535362855:web:c6eca1a7e4d24000692d02',
      measurementId: 'G-B3PG8TM9YY',
    };
})();
