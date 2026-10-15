# ONLINE BAR Ticketing module

This repository contains the isolated Ticketing source exported from the ONLINE BAR application. It is a **host-application module**, not a standalone deployable website: its Next.js routes rely on ONLINE BAR's existing admin session and server-side Supabase client.

## Source layout

- `app/tickets/` — Halloween-themed public event discovery and event-detail/ticket-options pages.
- `app/admin/(dashboard)/ticketing/` — owner/admin event and ticket-tier management, Trust & Security Centre, and Halloween-themed Live Operations view.
- `app/api/admin/ticketing/` — admin-session-protected Ticketing APIs, including the cursor-based operations feed.
- `lib/ticketing/` — server-only public event listing using approved organizers and on-sale events.
- `supabase/` — isolated Ticketing core, security and live-operations schema migrations.
- `ticketing/README.md` — implementation status, setup notes and release gates.

## Integrating with ONLINE BAR

Copy these paths into the matching paths of the ONLINE BAR Next.js application. The host app must provide:

- Next.js 15, React, TypeScript, Tailwind CSS and `lucide-react`.
- `@/lib/adminAccess.server` with `getAdminSession` and `isSameOriginRequest`.
- `@/lib/serverSupabase` with a server-only Supabase client using the service-role key.
- An admin dashboard layout that protects `/admin/ticketing`, `/admin/ticketing/security` and `/admin/ticketing/live`.
- A public navigation link to `/tickets`.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side. Never expose it in client code or commit credentials.

## Database setup

After reviewing the SQL and confirming the target Supabase project, apply in this order:

1. `supabase/TICKETING_CORE_MIGRATION.sql`
2. `supabase/TICKETING_SECURITY_MIGRATION.sql`
3. `supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql`

The public pages list only future events belonging to approved organizers and marked `on_sale`; they expose a limited set of event and active-tier fields. Event creation is admin-only.

The Live Operations view reads committed operational changes from an append-only, allowlisted database journal. It polls the protected API every five seconds and recovers using an event cursor; it is not a push/WebSocket connection or an external security log. It deliberately omits buyer contact details, payment payloads and ticket credential hashes.

## Important: sales are not enabled

The public event and ticket-options UI is browse-only. Purchase buttons are intentionally disabled. This repository does not yet implement verified M-Pesa checkout, payment reconciliation, customer accounts/ticket wallet, ticket issuance/delivery, five-minute QR rotation, authorized gate-scanner sessions, automated threat detection, privileged MFA, or tested backup restoration. The Android host currently wraps the Online Bar website and has no native customer ticket wallet. Website screenshot detection is not reliable; Android screenshot controls require a real, authorized wallet screen. Do not open sales or claim those controls are live until implemented, migrated and tested end-to-end.
