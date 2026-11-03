# Sanadi — deployment inventory

Everything the application depends on outside its own source code.

## 1. Environment variables / secrets

No secret is stored in source control. `.env.example` is the template; real values go in
`.env` (git-ignored) locally, or in your hosting provider's secret store.

| Variable | Scope | Required | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | yes | Supabase REST/Auth endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | yes | Publishable (anon) key |
| `VITE_SUPABASE_PROJECT_ID` | browser | no | Display/debug only |
| `SUPABASE_URL` | server | yes | Same endpoint for server functions |
| `SUPABASE_PUBLISHABLE_KEY` | server | yes | Anon key for user-scoped server calls |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | Privileged operations (documents, jobs, notifications) |
| `PUBLIC_APP_URL` | server | yes in prod | Origin embedded in emails, QR codes and printed verification links |
| `LOVABLE_API_KEY` | server | yes for AI | AI gateway key (chat, CV parsing, speech-to-text) |
| `OPENAI_API_KEY` / `AZURE_OPENAI_*` / `CUSTOM_LLM_*` | server | alternative | Used when the AI settings row selects that provider |
| `LOVABLE_CRON_SECRET` (+ `_PREVIOUS`) | server | yes for jobs | Bearer secret for `/api/public/hooks/*` schedulers |
| `EMAIL_SENDER_DOMAIN`, `EMAIL_FROM_ADDRESS` | server | optional | Outbound email; sends are skipped (not failed) when unset |
| `LIBRARY_API_KEY`, `LIBRARY_API_CLIENT_ID`, `LIBRARY_API_CLIENT_SECRET` | server | optional | Library discovery integration |
| `ENABLE_DEMO_ACCESS`, `DEMO_ACCESS_CODE`, `DEMO_STAFF_PASSWORD` | server | optional | Seeded-account helper; keep `false` in production |

## 2. Storage buckets (all private)

| Bucket | Contents |
| --- | --- |
| `student-letters` | Generated PDF letters/certificates |
| `student-cvs` | Career Counselling CV uploads |
| `knowledge-files` | Knowledge Center source documents |
| `case-evidence` | Attachments submitted with cases |

Definitions: `supabase/bootstrap/00_storage_buckets.sql`. Policies on `storage.objects`
ship inside the schema dump/migrations.

## 3. Edge Functions

**None.** All backend logic runs inside the app:

- `createServerFn` RPC handlers in `src/lib/**/*.functions.ts` (+ `*.server.ts` helpers)
- HTTP endpoints as TanStack server routes in `src/routes/api/**`

Scheduled endpoints (call with `Authorization: Bearer $LOVABLE_CRON_SECRET`):

| Endpoint | Suggested schedule |
| --- | --- |
| `POST /api/public/hooks/run-jobs` | every 5 minutes (SLA, escalations, retention) |
| `POST /api/public/hooks/notification-dispatch` | every 1–5 minutes |
| `POST /api/public/hooks/notification-digest` | daily |

Locally you can drive these with `cron`, `systemd` timers, or `pg_cron` in the local database.

## 4. External integrations

| Integration | Required | Notes |
| --- | --- | --- |
| AI gateway (Lovable / OpenAI / Azure / custom) | yes for the Assistant | Provider and model chosen in the `ai_settings` table |
| Managed email API (`@lovable.dev/email-js`) | no | Replace with your SMTP/ESP provider outside Lovable; the call site is `src/lib/notifications/provider.server.ts` |
| Library discovery API (OCLC-style) | no | `src/lib/library/*.server.ts`; disabled without credentials |
| Web knowledge crawling | no | Outbound HTTPS fetches from `src/lib/knowledge/crawl.server.ts` |

## 5. Database objects

- Schema, RLS policies, functions/RPCs, triggers, enums and extensions (`pg_trgm`) all live
  in the Postgres schema. `supabase/migrations/` contains the recent incremental history only —
  the authoritative baseline for a fresh install is the **full schema dump** (see `LOCAL_SETUP.md`).
- Reference seeds kept in the repo: `supabase/seed/institution-reference.sql`,
  `supabase/seed/rag-demo-corpus.sql`.

## 6. Cannot be exported automatically

| Item | Why | What to do |
| --- | --- | --- |
| `auth.users` password hashes | Only present in a full database dump that includes the `auth` schema | Use the Cloud data export (includes `auth`), or recreate accounts and have users reset passwords |
| API keys / secrets | Never in source control | Re-issue in the new environment using `.env.example` |
| Storage file bytes | Live in object storage, not Postgres | `scripts/export-storage.mjs` → `scripts/import-storage.mjs` |
| Realtime / auth provider settings (SMTP, OAuth providers, redirect URLs) | Project-level configuration | Reconfigure in `supabase/config.toml` locally or in the target project |
| Scheduled jobs | Platform schedulers | Recreate with cron/pg_cron per §3 |
