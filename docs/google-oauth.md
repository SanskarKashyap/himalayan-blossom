# Google OAuth Configuration

The web client posts Google ID tokens directly to the backend endpoint `POST /api/auth/google/` (see `assets/js/auth.js:354`). This endpoint is the effective "callback" that must be registered with Google.

## Redirect/callback URI

1. Determine the base API URL that the frontend uses in production.
   - The runtime configuration script (`assets/js/runtime-config.js`) populates `window.APP_API_BASE_URL`. By default, it points to `http://localhost:8000/api` for local development.
   - For deployments, override the `data-api-base-url` attribute on the script tag or assign `window.APP_CONFIG.apiBaseUrl` before loading the script.
2. Construct the callback URL by appending `/auth/google/` to that API base, for example:
   - Local development: `http://localhost:8000/api/auth/google/`
   - Production (example): `https://api.your-domain.com/api/auth/google/`
3. Add the exact URL from step 2 to **Authorized redirect URIs** in the Google Cloud Console OAuth client settings.

## Runtime configuration

Each HTML page now loads `assets/js/runtime-config.js`. Update its data attributes per environment, or point it at your `.env` file to pull defaults:

```html
<script
  src="assets/js/runtime-config.js"
  data-api-base-url="https://api.your-domain.com/api"
  data-google-client-id="YOUR_GOOGLE_OAUTH_CLIENT_ID"
  data-google-redirect-uri="https://api.your-domain.com/api/auth/google/"
  data-env-path=".env"
></script>
```

Alternately, define `window.APP_CONFIG = { ... }` ahead of the script to supply the same values.

If you place `APP_API_BASE_URL`, `APP_GOOGLE_CLIENT_ID`, and/or `APP_GOOGLE_REDIRECT_URI` inside a `.env` file that is deployed with the site, the runtime loader will read and normalize them automatically. Keep in mind that any `.env` shipped with the static assets is publicly accessible, so only put non-secret values (OAuth client IDs are fine) there.

## Frontend client ID

The Google Identity Services SDK requires the production client ID. After updating the OAuth client in Google Cloud Console, set `data-google-client-id` (or `window.APP_CONFIG.googleClientId`) to that value so the frontend uses the correct credentials.

## Post-change validation

1. Redeploy the site so the updated runtime configuration is available.
2. Update the OAuth client in Google Cloud Console with the redirect URI and (if needed) any preview domains.
3. Test sign-in in an incognito session or after clearing cookies to bypass cached tokens.
