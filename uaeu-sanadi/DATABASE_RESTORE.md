# Sanadi — database export and restore

## 0. Database engine (verified against the live database)

| Item | Value |
| --- | --- |
| Engine | **PostgreSQL 17.6** (Supabase / Lovable Cloud managed) |
| Extensions in use | `vector` 0.8.2 (pgvector), `pg_trgm` 1.6, `pgcrypto` 1.3, `uuid-ossp` 1.1, `pg_cron` 1.6.4, `pg_net` 0.20.4, `pg_stat_statements` 1.11, `supabase_vault` 0.3.1, `plpgsql` |
| Public schema | 199 tables, 2 views, 0 materialized views, 9 enum types, 100+ application functions, 98 user triggers, 427 RLS policies |
| Vector columns | `document_chunks.embedding`, `web_page_chunks.embedding` (type `vector`) |
| Storage buckets | `student-letters`, `student-cvs`, `knowledge-files`, `case-evidence` (all private) + one legacy export bucket |

**The local deployment keeps PostgreSQL.** No conversion to SQL Server or any
other engine is performed or required.

---

## 1. Produce the export (run on your machine)

The complete, dependency-ordered backup — schemas, tables, data, keys,
constraints, defaults, indexes, views, functions, triggers, enums, sequences,
RLS policies, grants, extensions and the `auth` schema (password hashes) — comes
from the Lovable data export:

**Lovable → Cloud → Advanced settings → Export data**

That is the only export that includes the `auth` schema, so it is the one to
use. Download it as `sanadi-export.sql`.

If you instead have direct Postgres credentials for a self-hosted copy,
`scripts/export-database.sh` runs the equivalent `pg_dump` commands.

## 2. Start a local Postgres with the same extensions

```bash
supabase start
export DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Supabase CLI starts Postgres 17 with pgvector, pg_trgm, pgcrypto and
uuid-ossp available, plus Auth (GoTrue), Storage and PostgREST.

## 3. Enable extensions (if restoring into a bare Postgres)

```bash
psql "$DB_URL" -c 'create extension if not exists vector;
                   create extension if not exists pg_trgm;
                   create extension if not exists pgcrypto;
                   create extension if not exists "uuid-ossp";'
```

`pg_cron`, `pg_net`, `supabase_vault` and `pg_stat_statements` are platform
extensions. Sanadi's application code does not call them — scheduled work runs
through the HTTP hooks in §7 of `LOCAL_SETUP.md` — so a local install without
them is fully functional.

## 4. Restore schema + data (correct order is inside the dump)

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f sanadi-export.sql
```

A dump split into schema/data restores in this order:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f sanadi-schema.sql   # types, tables, FKs, functions, triggers, RLS, grants
psql "$DB_URL" -v ON_ERROR_STOP=1 -f sanadi-data.sql     # data + sequence values
```

## 5. Storage buckets and files

```bash
psql "$DB_URL" -f supabase/bootstrap/00_storage_buckets.sql

SUPABASE_URL=<source url> SUPABASE_SERVICE_ROLE_KEY=<source service key> \
  node scripts/export-storage.mjs           # → ./storage-export

SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local service key> \
  node scripts/import-storage.mjs           # uploads with identical paths
```

Object paths are preserved, so every `issued_documents.file_path`,
`student_cv_documents`, `knowledge_documents` and `case_evidence` row keeps
pointing at the right file.

## 6. Reference / master seed data (only for a fresh database)

```bash
psql "$DB_URL" -f supabase/seed/institution-reference.sql
psql "$DB_URL" -f supabase/seed/rag-demo-corpus.sql        # optional demo corpus
node scripts/seed-dsai-cohort.mjs                          # DSAI programme + sample students
node scripts/import-staff-roster.mjs                       # staff roster from supabase/seed/staff-roster.json
```

Skip these if you restored a full dump — they would duplicate existing rows.

## 7. Embeddings

`vector` columns are dumped and restored as plain text literals, so embeddings
are portable — nothing to rebuild after a full restore. If you restored
schema-only, or changed the embedding provider:

```bash
LOVABLE_API_KEY=... SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<local service key> node scripts/rebuild-embeddings.mjs
```

## 8. Verify the restore

```bash
SUPABASE_DB_URL="$DB_URL" node scripts/verify-local-deployment.mjs
```

It checks every table, view, function/RPC, enum and storage bucket that the
application code references and prints a PASS/FAIL line for each.

## 9. Migrations going forward

`supabase/migrations/` holds the incremental history from 2026-08-27 onward, not
a from-zero baseline. After restoring, capture your own baseline:

```bash
supabase db dump --db-url "$DB_URL" -f supabase/migrations/00000000000000_baseline.sql
```

New changes: add a file to `supabase/migrations/` and run `supabase db push`.

## 10. Known limitations

| Item | Limitation |
| --- | --- |
| Password hashes | Only present if the export includes the `auth` schema. Otherwise recreate users (`scripts/create-admin.mjs`, `scripts/seed-dsai-cohort.mjs`, `scripts/import-staff-roster.mjs`) and have users reset passwords. |
| Secrets | Never exported. Re-issue locally using `.env.example`. |
| Storage bytes | Not in the SQL dump — use the scripts in §5. |
| `pg_cron` jobs | Platform-level; recreate as OS cron / systemd timers calling the HTTP hooks. |
| Auth provider config | Redirect URLs, OAuth providers and SMTP are project settings, re-set in `supabase/config.toml`. |
