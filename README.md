# ONLINE BAR Ticketing module

This repository is the standalone Next.js host for ONLINE BAR Ticketing. It contains the Halloween-themed public event pages, a password-protected admin workspace, server-side Supabase integration, and Ticketing-only schema migrations.

## Source layout

- `app/tickets/` — Halloween-themed public event discovery and event-detail/ticket-options pages.
- `app/admin/(dashboard)/ticketing/` — owner/admin event and ticket-tier management, Trust & Security Centre, and Halloween-themed Live Operations view.
- `app/api/admin/ticketing/` — admin-session-protected Ticketing APIs, including the cursor-based operations feed.
- `lib/ticketing/` — server-only public event listing using approved organizers and on-sale events.
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
2. `supabase/TICKETING_SECURITY_MIGRATION.sql`
3. `supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql`

The public pages list only future events belonging to approved organizers and marked `on_sale`; they expose a limited set of event and active-tier fields. Event creation is admin-only.

The Live Operations view reads committed operational changes from an append-only, allowlisted database journal. It polls the protected API every five seconds and recovers using an event cursor; it is not a push/WebSocket connection or an external security log. It deliberately omits buyer contact details, payment payloads and ticket credential hashes.

## Local development

Use Node.js 20 or later:

```sh
npm install
npm run dev
```

The site shell and browse-only pages work without environment variables; database-backed listings show a setup message until Supabase is configured.

## Important: sales are not enabled

The public event and ticket-options UI is browse-only. Purchase buttons are intentionally disabled. This repository does not yet implement verified M-Pesa checkout, payment reconciliation, customer accounts/ticket wallet, ticket issuance/delivery, five-minute QR rotation, authorized gate-scanner sessions, automated threat detection, privileged MFA, or tested backup restoration. The Android host currently wraps the Online Bar website and has no native customer ticket wallet. Website screenshot detection is not reliable; Android screenshot controls require a real, authorized wallet screen. Do not open sales or claim those controls are live until implemented, migrated and tested end-to-end.
