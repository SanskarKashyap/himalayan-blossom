Himalayan Blossom
=================

Local development
-----------------

1. `git clone https://github.com/SanskarKashyap/himalayan-blossom.git`
2. Duplicate the sample environment file:
   `cp assets/js/env.sample.js assets/js/env.local.js`
3. Update `assets/js/env.local.js` with your local API URLs and Firebase credentials.
4. Serve the site locally (for example):
   `python3 -m http.server 8000`

Vercel deployment
-----------------

Set the following environment variables in the Vercel dashboard so they can be exposed through
`/api/env` at runtime. `APP_FIREBASE_CONFIG` should be provided as a JSON string that includes the
standard Firebase web configuration fields.

- `APP_API_BASE_URL`
- `APP_GOOGLE_CLIENT_ID`
- `APP_FIREBASE_CONFIG`

The runtime will load these values automatically for the client without requiring a checked-in
environment file.
