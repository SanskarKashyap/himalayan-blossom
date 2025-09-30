# Himalayan Blossom Backend

This Django project powers authentication, role management, and Razorpay payment integrations for the Himalayan Blossom site.

## Getting Started

1. **Create a virtual environment and install dependencies**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r backend/requirements.txt
   ```

2. **Environment configuration**
   - Copy the example file and fill in secrets from your Google OAuth and Razorpay dashboards.
     ```bash
     cp backend/.env.example backend/.env
     ```
   - Generate a strong Django secret key (store it in `backend/.env`):
     ```bash
     python - <<'PY'
     import secrets
     print(secrets.token_urlsafe(64))
     PY
     ```
   - Add admin email addresses (comma separated) to elevate those users when they log in via Google.

3. **Apply migrations and create a superuser (optional for admin site)**
   ```bash
   cd backend
   python manage.py migrate
   python manage.py createsuperuser
   ```

4. **Run the development server**
   ```bash
   python manage.py runserver 0.0.0.0:8000
   ```

## API Overview

- `POST /api/auth/google/` — Accepts a Google ID token (`credential`), verifies it, assigns the correct role, and returns JWT `access` + `refresh` tokens.
- `POST /api/auth/token/refresh/` — Exchanges a refresh token for a new access token.
- `POST /api/auth/token/verify/` — Validates an access or refresh token.
- `GET /api/users/` — Lists all users (Admin role only).
- `GET /api/users/me/` — Returns the authenticated user profile.
- `POST /api/payments/order/` — Creates a Razorpay order for Admin or Consumer users.

Include the `Authorization: Bearer <access token>` header for protected endpoints.

## Payment Integration Notes

- Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
- The API response includes `razorpay_key_id` so the front-end can initialize the Checkout SDK.
- Persisted orders are stored in the `payments_paymentorder` table for reconciliation.

## Role-Based Access

User roles are resolved on each Google sign-in. Emails listed in `ADMIN_EMAILS` automatically receive the `Admin` role. All other accounts default to `Consumer`. The `IsAdminUserRole` and `IsAdminOrConsumerRole` permissions secure admin-only and checkout flows respectively.
