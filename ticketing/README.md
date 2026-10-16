# Midnight Society KE Ticketing

The standalone Ticketing application is managed at `/admin/ticketing` and serves event discovery at `/tickets`. It stores data in isolated `ticketing_*` Supabase tables; it does not use drink-order, product inventory, merchant payout or waitlist tables.

## Implemented flows

- Owner/admin event and tier management, including venue arrival guidance, per-ticket fees, ticket benefits, capacity, sale windows and promotion codes. Tier terms lock once an order exists; venue/service-fee changes lock after sales open, and the service fee also locks once any order is recorded. Only the platform owner can open sales. Opening sales requires future event dates, an active paid tier, a verified map destination and explicit server-side release approvals.
- Paystack KES checkout with a 15-minute inventory reservation, idempotent order/payment records, signed webhook validation, independent server-side payment verification, and exact amount/currency/buyer-email matching.
- Tickets are issued only after verified payment. Credentials are hashed for validation and encrypted at rest for private guest-wallet display.
- Buyers retrieve their wallet through an emailed, single-use, 30-minute access link and an HttpOnly, 30-day session cookie. A rate-limited resend form is available if delivery fails.
- Customers can verify a ticket reference against the live server without exposing contact or payment details; authenticity and admission eligibility are displayed separately.
- Online gate scanning supports camera QR scanning where the browser has `BarcodeDetector`, plus handheld keyboard-style scanners. Gate staff use authenticated accounts assigned to specific events and gates. Database locking and request idempotency prevent duplicate admission; offline approval is not supported.
- Ticket holders can request a transfer. The original stays active until owner review; approval revokes its credential and issues a replacement to the recipient. Rejection leaves the original active. Approved recipients can request a fresh wallet link with the transferred-ticket reference and their email.
- Sales default to disabled. No payment provider, database or email credentials are committed to this repository.

Offline admission, rotating QR codes, automated threat detection, privileged MFA and external security logging are not implemented. Cancellation handling requires operator review; do not treat this implementation as a complete production finance or event-staff system. All transfers require owner approval; VIP/complimentary/flagged ticket categories do not currently have separate escalation rules.

## Database setup

Review all SQL files and confirm the target Supabase project before applying these migrations, in order:

1. `supabase/TICKETING_CORE_MIGRATION.sql`
2. `supabase/TICKETING_COMMERCE_MIGRATION.sql`
3. `supabase/TICKETING_PREMIUM_EXPERIENCE_MIGRATION.sql`
4. `supabase/TICKETING_EVENT_IMAGES_MIGRATION.sql`
5. `supabase/TICKETING_SECURITY_MIGRATION.sql`
6. `supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql`
7. `supabase/TICKETING_VERIFICATION_MIGRATION.sql`

The event-images migration creates a public-read-only bucket for JPEG, PNG and WebP artwork. Authenticated admin uploads are sent through the server-side API and limited to 4 MB. Apply it before using event photo uploads.

The premium-experience migration extends checkout pricing with server-calculated fees and promotions, adds event arrival data and tier benefits, and provides atomic admin update functions. Promotion redemptions count paid purchases and unexpired reservations; checkout revalidates under a promotion row lock. Ticket-tier edits are locked once an order exists, and venue/service-fee updates are transactional and restricted to draft or scheduled events.

The commerce migration extends the core schema and replaces gate check-in logic to reject cancelled, postponed, completed or out-of-window events. The verification migration adds assigned staff, scan retry IDs, rate limits, public verification, operations metrics and approval-based transfers. It uses only `ticketing_*` objects, enables RLS on new tables, revokes browser-role access and grants server-side access to `service_role`. Do not enable sales unless every migration has completed successfully.

Set the real event city and confirmed venue destination in the admin before opening ticket sales. Directions are hidden until a Google Maps link, coordinate pair, or complete venue address and city are saved. Leave parking, entrance and transport instructions blank until the organizer confirms them; the site will clearly show that the details are not published yet.

The platform must keep its service-role key server-side. API access to admin functions requires an authenticated platform owner/admin session. Do not expose provider credentials or guest ticket credentials in client-side environment variables or logs.

## Paystack sandbox setup and release

Configure the following server-side variables from `.env.example` in deployment. Use a Paystack test secret while validating the sandbox:

- `TICKETING_SALES_ENABLED=true` and `TICKETING_RELEASE_APPROVED=true` — both must be deliberately enabled after acceptance checks; default is `false`.
- `TICKETING_PAYMENT_MODE=test` and `PAYSTACK_SECRET_KEY=sk_test_...`.
- `TICKETING_PUBLIC_URL=https://...` using the final HTTPS site URL.
- `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`.
- `TICKETING_GUEST_SESSION_SECRET` and `TICKETING_TICKET_ENCRYPTION_KEY`, each a unique random secret of at least 32 characters. Back up the encryption secret securely; rotating it without re-encrypting ticket credentials will make existing wallet QR codes unreadable.
- `TICKETING_GATE_SESSION_SECRET` — a unique random secret of at least 32 characters for gate staff sessions; keep it separate from other session secrets.
- Existing Supabase URL and server-side service-role key.

Set the Paystack webhook to `https://<site-host>/api/ticketing/paystack/webhook`. The public return page is `/tickets/complete`. The dashboard checks that the commerce schema is available before indicating sales are ready, and the checkout endpoint independently enforces the same checks.

Before opening a real event, exercise sandbox purchases, duplicate and delayed callbacks, amount/currency/email mismatches, expired reservations, guest-link single use and expiry, email-delivery failure/retry, public verification privacy, simultaneous scans and request replay after a timeout, wrong-event/unassigned-staff scans, rate limits, revoked/refunded credentials, transfer approval/rejection, replacement-ticket access, and cancelled/out-of-window event admission. Keep both release switches off until all tests pass. Sandbox testing and production release approval are separate; never enable live Paystack keys without a separate production acceptance review.

Money is stored as integer minor units with an explicit ISO currency. A checkout redirect, screenshot, or client-side status must never be treated as proof of payment. The gate scanner needs an active network connection and platform-admin access; do not represent it as offline or event-staff scanning.
