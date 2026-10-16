# Midnight Society KE Ticketing

This repository is the standalone Next.js host for Midnight Society KE Ticketing. It contains the Halloween-themed public event pages, a password-protected admin workspace, server-side Supabase integration, and ticketing-only schema migrations.

## Source layout

- `app/tickets/` — Halloween-themed public event discovery and event-detail/ticket-options pages.
- `app/admin/(dashboard)/ticketing/` — owner/admin event management, trust centre, live operations, transfer review and gate scanners.
- `app/api/admin/ticketing/` — admin-session-protected event management, scanning, transfer review and operations APIs.
- `app/api/ticketing/` — Paystack checkout, signed webhook, verified payment return, public verification and guest ticket-wallet APIs.
- `lib/ticketing/` — server-only public listing and payment/guest-wallet services.
- `app/api/admin/ticketing/events/[eventId]/image/` — authenticated event-photo uploads and replacements.
- `supabase/` — isolated Ticketing core, security and live-operations schema migrations.
- `ticketing/README.md` — implementation status, setup notes and release gates.
- `app/admin/login/` — dedicated Ticketing administrator sign-in.

## Vercel deployment

Import `Davi-d-M/TICKETING` into Vercel and use the repository root as the Root Directory. Vercel detects Next.js from `package.json`; use `npm run build` as the build command and leave the output directory at its default. Production and Preview builds succeed without database credentials, but event listings will explain that setup is pending.

Configure these server-only variables in the Vercel project before enabling the admin or database-backed pages:

- `TICKETING_ADMIN_EMAIL` — dedicated Ticketing administrator email.
- `TICKETING_ADMIN_PASSWORD` — a unique high-entropy password.
- `TICKETING_SESSION_SECRET` — independent random value of at least 32 characters.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (public URL, not a secret).
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key; server-side only.

Set `TICKETING_ADMIN_ROLE=admin` only if the account should not have owner-only case controls; omit it for the dedicated owner. After changing environment variables, redeploy. The admin login is at `/admin/login`.

## Database setup

After reviewing the SQL and confirming the target Supabase project, apply in this order:

1. `supabase/TICKETING_CORE_MIGRATION.sql`
2. `supabase/TICKETING_COMMERCE_MIGRATION.sql`
3. `supabase/TICKETING_PREMIUM_EXPERIENCE_MIGRATION.sql`
4. `supabase/TICKETING_EVENT_IMAGES_MIGRATION.sql`
5. `supabase/TICKETING_SECURITY_MIGRATION.sql`
6. `supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql`
7. `supabase/TICKETING_VERIFICATION_MIGRATION.sql`

The public pages list only future events belonging to approved organizers and marked `on_sale`; they expose a limited set of event and active-tier fields. Event creation is admin-only.
Admins can upload or replace JPEG, PNG and WebP event photos (up to 4 MB) from the event form or event card. The bucket is public-read-only; uploads require the admin session and server-side Supabase service role. Apply the event-images migration before uploading.

The premium-experience migration adds venue maps and arrival guidance, per-ticket fees, configurable tier benefits, and server-validated promotion codes. It also adds transactional admin updates for event capacity and ticket tiers. Sales cannot open until a Google Maps link, coordinates, or a complete venue address and city have been supplied. Only publish confirmed transport, parking and entrance information.

The Live Operations view reads committed operational changes from an append-only, allowlisted database journal. It polls the protected API every five seconds and recovers using an event cursor; it is not a push/WebSocket connection or an external security log. It deliberately omits buyer contact details, payment payloads and ticket credential hashes.

The verification migration adds safe customer verification, event-and-gate-assigned staff accounts, rate limits, atomic scan retry protection, security metrics and owner-approved ticket transfers.

## Local development

Use Node.js 20 or later:

```sh
npm install
npm run dev
```

The site shell and browse-only pages work without environment variables; database-backed listings show a setup message until Supabase is configured.

## Sales stay disabled until release approval

Paystack sandbox checkout, server-side payment verification, guest-email wallet access, ticket issuance and online assigned gate-staff scanning are implemented. Transfers require owner approval; approval invalidates the previous credential and issues a replacement ticket to the recipient. Live purchases remain disabled by default: apply and test all seven migrations, configure payment/email/session/encryption secrets, and pass end-to-end acceptance before setting both `TICKETING_SALES_ENABLED=true` and `TICKETING_RELEASE_APPROVED=true`. See [ticketing/README.md](./ticketing/README.md) for full setup and limitations. Offline admission, rotating QR codes and a native Android wallet are not implemented.
