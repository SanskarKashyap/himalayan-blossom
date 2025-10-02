# Himalayan Blossom PHP Backend (Laravel + MongoDB)

This Laravel API replaces the legacy Django service while keeping the existing REST surface (`/api/auth/google/`, `/api/users/`, etc.). It integrates Google OAuth sign-in, issues first-party JWT access/refresh tokens, and persists user profiles in MongoDB Atlas.

## Requirements

- PHP 8.2+
- Composer 2.5+
- MongoDB Atlas cluster (or local MongoDB for development)
- OpenSSL extension enabled for PHP (required for JWT signing)

## Getting Started

1. **Install dependencies**

   ```bash
   cd php-backend
   composer install
   ```

2. **Environment configuration**

   Copy the provided sample to `.env` and edit with your secrets:

   ```bash
   cp .env.example .env
   ```

   Required keys:

   | Key | Description |
   | --- | --- |
   | `JWT_SECRET` | Random 32+ character string used to sign JWTs |
   | `GOOGLE_CLIENT_ID` | OAuth Client ID from Google Cloud Console |
   | `GOOGLE_REDIRECT_URI` | Must match the registered redirect URI |
   | `MONGODB_URI` | Connection string for MongoDB Atlas |
   | `PUBLIC_API_BASE_URL` | Public API origin used by the static frontend |

   When running locally with the bundled frontend, set `APP_URL=http://127.0.0.1:8080`
   and `PUBLIC_API_BASE_URL=http://127.0.0.1:8080/api` so the runtime config matches
   the development server origin.

3. **Generate Laravel app key**

   ```bash
   php artisan key:generate
   ```

4. **Run database migrations** (creates indexes for refresh tokens)

   ```bash
   php artisan migrate
   ```

5. **Serve locally** (frontend + backend)

   ```bash
   composer run serve
   ```

   This starts the Laravel HTTP server on `http://127.0.0.1:8080`, serving the
   static frontend pages and the `/api` routes from the same origin. You can
   still run `php artisan serve --host=127.0.0.1 --port=8080` directly if you
   prefer.

6. **Expose via Cloudflare Tunnel** (example)

   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```

## API Overview

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/auth/google/` | Accepts Google ID token (`credential`), upserts the user, returns `{ user, access, refresh }` |
| `POST` | `/api/auth/token/refresh/` | Exchanges a refresh token for a new access/refresh pair |
| `POST` | `/api/auth/token/verify/` | Verifies an access token and returns its payload |
| `GET` | `/api/users/` | Returns all users (admin-only; requires `Authorization: Bearer`) |
| `GET` | `/api/public-config/` | Public configuration for the static frontend |

All responses mirror the Django contract so the existing frontend continues to operate without changes.

## Migrating from Django

- Update your deployment pipeline to run `composer install`, configure `.env`, and run `php artisan migrate`.
- Point the frontend runtime config (`PUBLIC_API_BASE_URL`) at the Cloudflare Tunnel URL during demos.
- Remove legacy Django services once the PHP backend is validated.

## Testing

- `php artisan test`
- `php artisan lint` (when Pint is installed) 

Add future enhancements such as rate limiting, audit logging, or queue workers using Laravel's ecosystem as needed.
