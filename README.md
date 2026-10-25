# Midnight Society KE Ticketing

This repository is the standalone Next.js host for Midnight Society KE Ticketing. It contains the Halloween-themed public event pages, server-side Supabase integration, and ticketing-only schema migrations. Online Bar is the Ticketing admin control panel.

## Source layout

- `app/tickets/` — Halloween-themed public event discovery and event-detail/ticket-options pages.
- `app/admin/` — redirects Ticketing administrators to the Online Bar control panel.
- `app/api/admin/ticketing/` — owner/admin-session-protected management APIs; customer checkout and guest wallet routes remain separate.
- `app/api/ticketing/` — Paystack checkout, signed webhook, verified payment return, public verification and guest ticket-wallet APIs.
- `lib/ticketing/` — server-only public listing and payment/guest-wallet services.
- `app/api/admin/ticketing/events/[eventId]/image/` — authenticated event-photo uploads and replacements.
- `supabase/` — isolated Ticketing core, security and live-operations schema migrations.
- `ticketing/README.md` — implementation status, setup notes and release gates.

## Vercel deployment

Import `Davi-d-M/TICKETING` into Vercel and use the repository root as the Root Directory. Vercel detects Next.js from `package.json`; use `npm run build` as the build command and leave the output directory at its default. Production and Preview builds succeed without database credentials, but event listings will explain that setup is pending.

Configure these server-only variables in the Vercel project before enabling database-backed customer pages or checkout. The complete commerce and release-gate variable list, including test-mode settings, is in [ticketing/README.md](./ticketing/README.md); do not enable live sales before its acceptance checklist passes.

Use Online Bar Admin → Ticketing at `/lord/ticketing` for event and tier configuration, publishing, sales reporting, gate staff, security readiness, live operations, transfer review, demand insights, and Ticketing MFA enrollment. The protected `/admin` routes redirect to Online Bar. Keep payment-provider, service-role, MFA, encryption, and signing secrets server-side in the appropriate Vercel deployment settings; never put them into a browser-editable admin field. To share ticket data with Online Bar Admin or read the published customer theme, configure `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` here to the **same Supabase project** used by Online Bar Admin. Customer ticket records remain in isolated `ticketing_*` tables. The customer theme API is read-only and does not expose database credentials.

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (public URL, not a secret).
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key; server-side only.
- `TICKETING_ADMIN_EMAIL` — email used to identify the active Ticketing owner MFA record in the shared database. It must match the Online Bar owner account used to enroll Ticketing MFA.
- `TICKETING_ADMIN_PASSWORD`, `TICKETING_ADMIN_ROLE`, `TICKETING_SESSION_SECRET` and `TICKETING_MFA_ENCRYPTION_KEY` are legacy standalone-admin settings; they are not checkout readiness requirements now that admin is centralized in Online Bar.

## Database setup

After reviewing the SQL and confirming the target Supabase project, apply in this order:

1. `supabase/TICKETING_CORE_MIGRATION.sql`
2. `supabase/TICKETING_COMMERCE_MIGRATION.sql`
3. `supabase/TICKETING_PREMIUM_EXPERIENCE_MIGRATION.sql`
4. `supabase/TICKETING_EVENT_IMAGES_MIGRATION.sql`
5. `supabase/TICKETING_SECURITY_MIGRATION.sql`
6. `supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql`
7. `supabase/TICKETING_VERIFICATION_MIGRATION.sql`
8. `supabase/TICKETING_MFA_MIGRATION.sql`
9. `supabase/TICKETING_WAVES_MIGRATION.sql`
10. `supabase/TICKETING_SAFE_LIVE_TICKET_EDIT_MIGRATION.sql`
11. `supabase/TICKETING_DEMAND_INTELLIGENCE_MIGRATION.sql`

The safe live-ticket edit migration enables Online Bar admins to edit existing standard tiers and release waves while an event is on sale. It preserves purchase-time order snapshots, protects issued and reserved capacity, and makes checkout reject totals that changed before order creation. Apply it to the shared Supabase project before opening sales or using live ticket edits. The public pages list only future events belonging to approved organizers and marked `on_sale`; they expose a limited set of event and active-tier fields. Event creation is admin-only.
Admins can upload or replace JPEG, PNG and WebP event photos (up to 4 MB) from the event form or event card. The bucket is public-read-only; uploads require the admin session and server-side Supabase service role. Apply the event-images migration before uploading.

The premium-experience migration adds venue maps and arrival guidance, per-ticket fees, configurable tier benefits, and server-validated promotion codes. It also adds transactional admin updates for event capacity and ticket tiers, plus an audited service-fee control. The platform owner can adjust the fixed fee while sales are open; the new fee applies to future checkouts and does not rewrite existing order totals. Sales cannot open until a Google Maps link, coordinates, or a complete venue address and city have been supplied. Only publish confirmed transport, parking and entrance information.

The core migration safely leaves an existing `midnight-society-ke` organizer record unchanged when re-run. The premium-experience migration replaces the exact eight-argument checkout function because PostgreSQL cannot remove existing parameter defaults with `CREATE OR REPLACE`; the migration restores the intended function grants in the same transaction.

The Live Operations view reads committed operational changes from an append-only, allowlisted database journal. It polls the protected API every five seconds and recovers using an event cursor; it is not a push/WebSocket connection or an external security log. It deliberately omits buyer contact details, payment payloads and ticket credential hashes.

The verification migration adds safe customer verification, event-and-gate-assigned staff accounts, rate limits, atomic scan retry protection, security metrics and owner-approved ticket transfers. The MFA migration stores encrypted TOTP seeds, prevents authenticator-code replay atomically, and records activation/verification in the append-only audit log. The waves migration adds configurable Wave I/II/III editions per admission type with scheduled, previous-wave-sold-out/deadline, or owner-controlled manual activation. Wave-specific inventory and tier prices remain separate, and reservations enforce the release rule in the database.

The demand-intelligence migration adds a service-role-only, consent-gated signal table and an owner/admin report at Online Bar Admin → Ticketing → **Demand insights**. Visitors can allow or decline analytics and change that choice from the privacy control on ticket pages. With consent, the app records event-detail views, searches (excluding email- or phone-like text), selected city/date/price filters, and checkout starts using a session-only random visitor ID. It does not store IP addresses, names, emails, device fingerprints, or location coordinates. Paid orders and revenue in reports come from verified `paid` order records, not browser signals. Reports show descriptive 7/30/90-day counts, unmet search terms, and popular city filters; they are not demand forecasts, attribution, cross-device identity stitching, or an external analytics warehouse.

## Local development

Use Node.js 20 or later:

```sh
npm install
npm run dev
```

The site shell and browse-only pages work without environment variables; database-backed listings show a setup message until Supabase is configured.

## Sales are controlled from Online Bar Admin

Paystack checkout, server-side payment verification, ticket issuance, Online Bar-managed Ticketing MFA, five-minute rotating QR credentials, configurable Wave I/II/III releases and online assigned gate-staff scanning are implemented. Wave releases support admission-specific pricing, allocations, activation rules, and ticket appearance. Transfers require owner approval; approval invalidates the previous credential and issues a replacement ticket to the recipient. The owner controls whether an event is on sale in Online Bar Admin. Verified payments and paid orders are recorded in the Online Bar Ticket sales ledger even if wallet-email delivery is unavailable; configure Resend and guest-wallet secrets separately to deliver customer access automatically. Configure Paystack, the shared database, ticket-encryption key and owner MFA before opening sales. See [ticketing/README.md](./ticketing/README.md) for full setup and limitations. Offline admission and native Android wallet support are not implemented.
