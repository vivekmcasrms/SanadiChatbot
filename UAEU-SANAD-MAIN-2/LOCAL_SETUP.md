# Sanadi — local setup (outside Lovable)

Runs the full stack on your machine: React/Vite frontend, local Supabase (Postgres, Auth,
Storage), and all backend logic (server functions + HTTP routes) inside the same app —
there are no separate Edge Functions to deploy.

**Database engine: PostgreSQL 17 + pgvector — unchanged.** Nothing is converted to another
engine.

Companion documents:

| File | Contents |
| --- | --- |
| `DATABASE_RESTORE.md` | export + step-by-step restore with exact commands |
| `EXTERNAL_DEPENDENCIES.md` | every integration: local / internet / credentials / unavailable |
| `docs/DEPENDENCY_REPORT.md` | every DB object the code uses → present / exported / restored |
| `docs/VALIDATION_REPORT.md` | what is verified now and what you verify after restore |
| `docs/DEPLOYMENT_INVENTORY.md` | secrets, buckets, jobs, integrations inventory |
| `docker-compose.yml`, `Dockerfile` | containerised app (Supabase CLI provides the data stack) |
| `.env.example` | every configuration key, no secrets |

Prerequisites: Node 20+ (or Bun), Docker Desktop, the Supabase CLI, and `psql`.


---

## 1. Install dependencies

```bash
git clone <your-repo> sanadi && cd sanadi
npm install     # or: bun install
```

## 2. Start Supabase locally

```bash
supabase start
```

Note the printed `API URL` (`http://127.0.0.1:54321`), `anon key`, `service_role key`
and `DB URL` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

`supabase/config.toml` holds the project id. For a purely local stack you may set it to
`sanadi-local`; keep the original value only if you also intend to `supabase link` to the
hosted project.

## 3. Restore the schema

The repo's `supabase/migrations/` folder holds the recent incremental history, not a
from-zero baseline. For a fresh database use the full dump:

1. In Lovable, open **Cloud → Advanced settings → Export data** and download the export
   (schema + data, including the `auth` schema).
2. Split or apply it against the local database:

```bash
export DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$DB_URL" -f sanadi-export.sql          # schema + data in one file
```

If your dump is schema-only, apply data afterwards (step 4). Then keep future changes as
new files in `supabase/migrations/` and apply with `supabase db push`.

Save the baseline into the repo for teammates:

```bash
supabase db dump --db-url "$DB_URL" -f supabase/migrations/00000000000000_baseline.sql
```

## 4. Restore data

```bash
psql "$DB_URL" -f sanadi-export-data.sql            # if schema/data were separate
psql "$DB_URL" -f supabase/seed/institution-reference.sql   # reference data only, optional
psql "$DB_URL" -f supabase/bootstrap/00_storage_buckets.sql # storage buckets
```

Preserved by the dump: students and reference data, profiles/users, service units, service
owners, services, knowledge sources and indexed knowledge metadata, cases/conversations,
configuration tables, and document metadata. Passwords survive only when the dump includes
the `auth` schema; otherwise recreate accounts (step 9) and ask users to reset.

## 5. Restore storage files

Against the **source** project (service-role key from the Lovable backend view is not
retrievable — use a self-hosted/own project key, or skip and re-upload manually):

```bash
SUPABASE_URL=<source url> SUPABASE_SERVICE_ROLE_KEY=<source key> node scripts/export-storage.mjs
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> node scripts/import-storage.mjs
```

## 6. Configure environment variables

```bash
cp .env.example .env
```

Fill in the local Supabase URL and keys, set `PUBLIC_APP_URL=http://localhost:8080`, add an
AI key (`LOVABLE_API_KEY` or an OpenAI/Azure/custom provider — see
`docs/DEPLOYMENT_INVENTORY.md`), and generate `LOVABLE_CRON_SECRET`:

```bash
openssl rand -hex 32
```

Never commit `.env`.

## 7. Start Edge Functions / background jobs

There are **no Supabase Edge Functions**. Scheduled work is exposed as HTTP routes served
by the app; trigger them from cron:

```bash
curl -X POST -H "Authorization: Bearer $LOVABLE_CRON_SECRET" http://localhost:8080/api/public/hooks/run-jobs
curl -X POST -H "Authorization: Bearer $LOVABLE_CRON_SECRET" http://localhost:8080/api/public/hooks/notification-dispatch
curl -X POST -H "Authorization: Bearer $LOVABLE_CRON_SECRET" http://localhost:8080/api/public/hooks/notification-digest
```

## 8. Start the application

```bash
npm run dev        # http://localhost:8080
```

Or in Docker (the Supabase CLI stack must already be running):

```bash
docker compose up app       # http://localhost:8080
```

Production-style run: the build targets a Worker runtime (output in `dist/`), so serve it
with the bundled preview server rather than a bare Node entry point:

```bash
npm run build
npx vite preview         # serves the built app locally
```

For a long-running host, deploy `dist/` to a Worker-compatible runtime
(`npx nitro deploy --prebuilt`, Cloudflare `wrangler`), or keep `npm run dev`
under a process manager. `NITRO_PRESET=node-server` is **not** honoured by this
template — verified: the build still emits the Worker output.



## 9. Create / sign in with a local admin

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
ADMIN_EMAIL=admin@yourdomain.edu ADMIN_PASSWORD='ChangeMe123!' \
node scripts/create-admin.mjs
```

Sign in at `http://localhost:8080/auth`. Local Supabase auto-confirms email, so no SMTP is
needed for sign-in.

## 10. Verify the deployment

First confirm the restored database has every object the code uses:

```bash
SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  node scripts/verify-local-deployment.mjs
```

Then walk the functional checks (full list in `docs/VALIDATION_REPORT.md`):



| Area | Check |
| --- | --- |
| Assistant | Ask "What are the library opening hours?" — a streamed, cited answer appears |
| Knowledge Center | Admin → Knowledge Center: sources list loads; upload a PDF and confirm it reaches `completed` |
| Career Counselling | As a student, upload a CV → ATS score and career matches render; delete removes the file |
| Documents | Request a "To whom it may concern" letter → PDF downloads and its QR link resolves on `/verify/<token>` |
| Service Owner | Sign in as an owner → "Needs Your Attention" count matches the list; open a case and reply |
| Jobs & email | Run the cron curls above; `notification_deliveries` rows move out of `pending` (they report `skipped` until an email sender domain is configured) |

---

## Known migration gaps

- **Auth passwords** transfer only with a dump that includes the `auth` schema.
- **Secrets** are never exported — re-issue them per `docs/DEPLOYMENT_INVENTORY.md`.
- **Storage bytes** need the export/import scripts; they are not in the SQL dump.
- **Email delivery** uses Lovable's managed API; outside Lovable, swap the single call site
  in `src/lib/notifications/provider.server.ts` for your SMTP/ESP client.
- **AI gateway**: without `LOVABLE_API_KEY`, point the `ai_settings` row at OpenAI/Azure/a
  custom base URL and set the matching keys.
- **Schedulers** must be recreated (cron, systemd timer, or `pg_cron`).
