# ONLINE BAR Ticketing module

This repository contains the isolated Ticketing source exported from the ONLINE BAR application. It is a **host-application module**, not a standalone deployable website: its Next.js routes rely on ONLINE BAR's existing admin session and server-side Supabase client.

## Source layout

- `app/tickets/` — Halloween-themed public event discovery and event-detail/ticket-options pages.
- `app/admin/(dashboard)/ticketing/` — owner/admin event and ticket-tier management plus the Halloween-themed Trust & Security Centre.
- `app/api/admin/ticketing/` — same-origin, admin-session-protected Ticketing APIs.
- `lib/ticketing/` — server-only public event listing using approved organizers and on-sale events.
- `supabase/` — isolated Ticketing core and security schema migrations.
- `ticketing/README.md` — implementation status, setup notes and release gates.

## Integrating with ONLINE BAR

Copy these paths into the matching paths of the ONLINE BAR Next.js application. The host app must provide:

- Next.js 15, React, TypeScript, Tailwind CSS and `lucide-react`.
- `@/lib/adminAccess.server` with `getAdminSession` and `isSameOriginRequest`.
- `@/lib/serverSupabase` with a server-only Supabase client using the service-role key.
- An admin dashboard layout that protects `/admin/ticketing` and `/admin/ticketing/security`.
- A public navigation link to `/tickets`.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side. Never expose it in client code or commit credentials.

## Database setup

After reviewing the SQL and confirming the target Supabase project, apply in this order:

1. `supabase/TICKETING_CORE_MIGRATION.sql`
2. `supabase/TICKETING_SECURITY_MIGRATION.sql`

The public pages list only future events belonging to approved organizers and marked `on_sale`; they expose a limited set of event and active-tier fields. Event creation is admin-only.

## Important: sales are not enabled

The public event and ticket-options UI is browse-only. Purchase buttons are intentionally disabled. This repository does not yet implement verified M-Pesa checkout, payment reconciliation, customer accounts/ticket wallet, ticket issuance/delivery, five-minute QR rotation, authorized gate-scanner sessions, automated threat detection, privileged MFA, or tested backup restoration. Do not open sales or claim those controls are live until implemented, migrated and tested end-to-end.
