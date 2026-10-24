# Midnight Society KE Ticketing

The standalone Ticketing application is managed at `/admin/ticketing` and serves event discovery at `/tickets`. It stores data in isolated `ticketing_*` Supabase tables; it does not use drink-order, product inventory, merchant payout or waitlist tables.

The customer event pages, guest ticket wallets and wallet-access emails use the published color mode managed from Online Bar Admin → Ticketing → Customer ticket colors. This app reads only the public theme identifier from the shared `settings` table; it cannot publish or change the setting. Set `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` to the exact Supabase project configured in Online Bar Admin. If this app points at another project, customer pages use the default Midnight palette instead of the admin selection. Ticket QR codes stay black on white for reliable scanning.

## Implemented flows

- Owner/admin event and tier management, including venue arrival guidance, fixed per-ticket fees, ticket benefits, capacity, sale windows and promotion codes. The platform owner can adjust the service fee while sales are open; future checkouts use the new fee while existing order totals stay unchanged. Tier terms lock once an order exists, and venue changes lock after sales open. Only the platform owner can open ticket sales. Opening sales requires future event dates, an active paid tier, a verified map destination and explicit server-side release approvals.
- Public event discovery supports typo-tolerant search, city/date/maximum-price filters, price and date sorting, opt-in nearby sorting, and a map view for events with published venue coordinates. Browser location is requested only after the guest selects **Near me** and is not persisted.
- Paystack KES checkout with a 15-minute inventory reservation, idempotent order/payment records, signed webhook validation, independent server-side payment verification, and exact amount/currency/buyer-email matching.
- Tickets are issued only after verified payment. Credentials are hashed for validation; guest wallets receive signed ticket-specific QR tokens that rotate every five minutes.
- Buyers retrieve their wallet through an emailed, single-use, 30-minute access link and an HttpOnly, 30-day session cookie. A rate-limited resend form is available if delivery fails.
- Customers can verify a ticket reference against the live server without exposing contact or payment details; authenticity and admission eligibility are displayed separately.
- Online gate scanning supports camera QR scanning where the browser has `BarcodeDetector`, plus handheld keyboard-style scanners. Gate staff use authenticated accounts assigned to specific events and gates. Both admin and staff scanners validate rotating QR signatures and expiry before database locking and request-idempotent check-in; offline admission is not supported.
- Ticket holders can request a transfer. The original stays active until owner review; approval revokes its credential and issues a replacement to the recipient. Rejection leaves the original active. Approved recipients can request a fresh wallet link with the transferred-ticket reference and their email.
- Sales default to disabled. No payment provider, database or email credentials are committed to this repository.

Ticketing administration is managed inside the authenticated Online Bar Admin workspace at `/lord/ticketing`, using its existing admin session and MFA. The Vercel customer app redirects `/admin` to that Online Bar workspace and does not require a second administrator account. The Security Center reports server configuration and schema readiness; it does not detect attacks automatically or verify external security logging. Backup scheduling and restore drills require independent verification in Supabase. Cancellation handling requires operator review; do not treat this implementation as a complete production finance or event-staff system. All transfers require owner approval; VIP/complimentary/flagged ticket categories do not currently have separate escalation rules.

## Database setup

Review all SQL files and confirm the target Supabase project before applying these migrations, in order:

1. `supabase/TICKETING_CORE_MIGRATION.sql`
2. `supabase/TICKETING_COMMERCE_MIGRATION.sql`
3. `supabase/TICKETING_PREMIUM_EXPERIENCE_MIGRATION.sql`
4. `supabase/TICKETING_EVENT_IMAGES_MIGRATION.sql`
5. `supabase/TICKETING_SECURITY_MIGRATION.sql`
6. `supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql`
7. `supabase/TICKETING_VERIFICATION_MIGRATION.sql`
8. `supabase/TICKETING_MFA_MIGRATION.sql`
9. `supabase/TICKETING_WAVES_MIGRATION.sql`

Apply the MFA migration and configure `TICKETING_MFA_ENCRYPTION_KEY` and `TICKETING_QR_SIGNING_SECRET` before deploying this version: admin login will intentionally refuse to issue a session until the MFA migration/key are available, and wallet QR issuance/scanning needs the QR key. The first successful password sign-in enrolls the authenticator; do not remove the server-side encryption key afterward.

The waves migration adds Wave I — The Awakening, Wave II — The Summoning and Wave III — The Final Call to the existing ticket-type model. Each admission type (for example General Admission or VIP) can have its own three releases, prices, allocations, benefits, sale windows, opening rule and visual theme. Scheduled waves open at their configured time; sell-out waves open only after their matching previous admission wave is fully sold/reserved or its sales deadline passes; manual waves stay closed until the owner activates them. Inventory reservations and checkout enforce the same transition rules transactionally. Configure only confirmed prices, allocations and benefits in the admin.

The event-images migration creates a public-read-only bucket for JPEG, PNG and WebP artwork. Authenticated admin uploads are sent through the server-side API and limited to 4 MB. Apply it before using event photo uploads.

The premium-experience migration extends checkout pricing with server-calculated fees and promotions, adds event arrival data and tier benefits, and provides atomic admin update functions. Promotion redemptions count paid purchases and unexpired reservations; checkout revalidates under a promotion row lock. Ticket-tier edits are locked once an order exists, venue changes are restricted to draft or scheduled events, and the platform owner can change the per-ticket service fee while sales are open. Each order keeps the fee snapshot calculated when checkout started.

The core migration leaves an existing organizer with the `midnight-society-ke` slug unchanged on re-run. The premium-experience migration drops and recreates only the exact eight-argument checkout overload so PostgreSQL can replace an older definition that has parameter defaults; it restores the function grants within the same transaction.

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
- `TICKETING_QR_SIGNING_SECRET` — an independent random value of at least 32 characters for signed five-minute ticket QR credentials. Keep it separate from all session and encryption keys.
- Existing Supabase URL and server-side service-role key.

The Online Bar Admin deployment owns administrator password/session settings and `TICKETING_MFA_ENCRYPTION_KEY`; do not create a separate Ticketing admin account in Vercel. Set the Paystack webhook to `https://<site-host>/api/ticketing/paystack/webhook`. The public return page is `/tickets/complete`. The dashboard checks that the commerce schema is available before indicating sales are ready, and the checkout endpoint independently enforces the same checks.

Before opening a real event, enroll the admin authenticator and exercise sandbox purchases, duplicate and delayed callbacks, amount/currency/email mismatches, expired reservations, guest-link single use and expiry, email-delivery failure/retry, public verification privacy, expired/replayed rotating QR codes, simultaneous scans and request replay after a timeout, wrong-event/unassigned-staff scans, rate limits, revoked/refunded credentials, transfer approval/rejection, replacement-ticket access, and cancelled/out-of-window event admission. Keep both release switches off until all tests pass. Sandbox testing and production release approval are separate; never enable live Paystack keys without a separate production acceptance review.

### First event and operating sequence

1. Sign in through Online Bar Admin and open `/lord/ticketing`; complete the platform's required authenticator enrollment.
2. Create a private event draft in `/lord/ticketing` and enter only organizer-confirmed event and venue information.
3. Add ticket tiers and release waves with confirmed KES pricing, inventory, benefits and opening rules. Assign gate staff and a named gate from the scanner workspace.
4. Complete the sandbox acceptance checklist above using Paystack test credentials. Confirm the buyer receives the one-time wallet email, sees the issued ticket, and the assigned scanner accepts the first scan but rejects a duplicate.
5. Only after the owner approves the production release, set the release switches, open the approved event and verify sales and scans in Live Operations. Orders and earnings remain in the isolated Ticketing ledger.

The public site intentionally shows no event until an approved event has a ticket wave open for sale. A scheduled ticket-wave opening controls ticket sales; it is not the separate Midnight Society member-pass countdown.

Money is stored as integer minor units with an explicit ISO currency. A checkout redirect, screenshot, or client-side status must never be treated as proof of payment. The gate scanner needs an active network connection and platform-admin access; do not represent it as offline or event-staff scanning.
