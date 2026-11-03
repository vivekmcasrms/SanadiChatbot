# Sanadi Test Environment — independent duplicate

This document describes how to stand up a complete, independent copy of Sanadi
for development and testing, and proves that the copy cannot affect production.

Production behaviour is unchanged by anything in this document: without
`SANADI_ENV=TEST` every guard and marker added for the duplicate is inert.

---

## 1. Create the duplicate project

Use the Lovable project menu → **Remix / duplicate project**. This is the only
step that must be done by a human: it creates a new project with its **own
backend** — its own database, its own login system, its own file storage.

Do not point the duplicate at the production backend. The duplicate must keep
the backend it was given.

## 2. Environment configuration

In the duplicate set:

```
SANADI_ENV=TEST
VITE_SANADI_ENV=TEST
PUBLIC_APP_URL=<duplicate preview URL>
```

The Supabase URL/keys in the duplicate are created automatically by its own
backend and must never be replaced with production values. Production keeps
`SANADI_ENV` unset.

Effects of `SANADI_ENV=TEST`:

| Area | Behaviour in the duplicate |
| --- | --- |
| Email delivery | Blocked at `src/lib/notifications/provider.server.ts`; deliveries record `skipped / test_environment` |
| University system writes | Blocked by `assertOutboundAllowed("university_system_write")` |
| Partner API writes | Blocked by `assertOutboundAllowed("external_api_write")` |
| Staff/admin UI | "Sanadi Test Environment" banner shown (`src/components/TestEnvironmentBanner.tsx`) |
| Student UI | Unchanged |

## 3. Rebuild the schema

```bash
SOURCE_DB_URL="postgresql://…"  bash scripts/clone/export-schema.sh
psql "$TARGET_DB_URL" -f clone-export/sanadi-clone-schema.sql
```

The export contains extensions, enums, tables, keys, constraints, defaults,
indexes, views, functions/RPCs, triggers, sequences, grants and RLS policies
for `public` and `storage`. Without direct Postgres credentials, use
Lovable → Cloud → Advanced settings → Export data on production and restore the
schema part of that export.

## 4. Storage

```bash
TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… SANADI_ENV=TEST \
  node scripts/clone/setup-storage.mjs
```

Creates the duplicate's own private buckets: `student-cvs`, `student-letters`,
`knowledge-files`, `case-evidence`. Access rules come from the schema rebuild.

## 5. Reference data

```bash
SOURCE_SUPABASE_URL=… SOURCE_SERVICE_ROLE_KEY=… \
TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… SANADI_ENV=TEST \
  node scripts/clone/copy-reference-data.mjs
```

Production is read-only during this copy. The allowlist lives in
`scripts/clone/reference-tables.mjs` and covers: campuses/colleges/departments,
service units and staff mappings, service catalogue, availability windows and
service levels, case categories, routing/escalation/automation rules,
appointment types, the academic programme and course catalogue with
prerequisites and baskets, careers/internship/library/housing reference data,
Knowledge Center categories, sources, documents and chunks, emergency contacts,
AI settings, agent tools and prompts, model routing, document/email/notification
templates and quality targets.

Excluded by design (listed in the same file): cases, comments, assignments,
status history, evidence, resolutions, conversations and messages,
notifications and deliveries, issued documents, student documents and CVs,
appointments and requests, action requests/receipts, agent runs, tool and model
invocations, performance and retrieval logs, audit logs.

If `document_chunks` arrive without vectors, run `scripts/rebuild-embeddings.mjs`
against the duplicate.

## 6. Accounts

```bash
TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… SANADI_ENV=TEST \
  node scripts/clone/seed-test-accounts.mjs
node scripts/seed-dsai-cohort.mjs      # the three DSAI test students
```

No production password hash is ever exported. Staff are recreated from the
approved roster with a test password; the three DSAI test students are
recreated with their academic records.

## 7. Prove the isolation

```bash
SOURCE_SUPABASE_URL=… SOURCE_SERVICE_ROLE_KEY=… \
TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… SANADI_ENV=TEST \
  node scripts/clone/verify-isolation.mjs
```

Checks performed (all writes in the duplicate, production read-only):

1. A query created in the duplicate is absent from production.
2. A complaint created in the duplicate is absent from production.
3. A student added in the duplicate is absent from production.
4. An uploaded document is absent from production storage.
5. A Knowledge Center edit is absent from production.
6. A staff assignment is written in the duplicate only.
7. The two databases answer from separate endpoints, so schema changes cannot cross over.

The script refuses to run if the source and target hosts match.

---

## 8. Isolation report

| Production resource | Duplicate resource | Shared or separate | Status |
| --- | --- | --- | --- |
| Application project (code) | Remixed copy of the same code | Separate copy | Identical behaviour, independent history |
| Database | Duplicate project's own database | **Separate** | Schema rebuilt from `export-schema.sh` |
| Authentication / accounts | Duplicate project's own login system | **Separate** | Test accounts only, no production hashes |
| File storage | Duplicate project's own private buckets | **Separate** | CVs, letters, knowledge files, evidence |
| Transactional data (cases, chats, notifications, documents) | Created fresh inside the duplicate | **Separate** | Never copied from production |
| Reference/master data | Copied read-only from production | Copied snapshot, then independent | Units, staff, catalogue, academic data, Knowledge Center |
| Email delivery | Suppressed in the duplicate | Separate (disabled) | `skipped / test_environment` |
| University systems / partner write APIs | Blocked in the duplicate | Separate (disabled) | Guarded by `assertOutboundAllowed` |
| AI inference (Lovable AI Gateway) | Duplicate project's own gateway credentials | Separate credentials, shared external service | Live external call, read-only, no production data written |
| Library catalogue lookup (OCLC/discovery) | Same public catalogue endpoint | **Shared external service** | Read-only searches; no production write |
| Domain / published URL | Duplicate project's own preview URL | **Separate** | `sanadi.online` remains production only |

Integrations that still reach live external services in the duplicate:
**AI inference** and **library catalogue search**. Both are read-only lookups
and neither writes to a university system.

## 9. Standing rule

The duplicate must never be reconfigured with production Supabase URL, keys or
database connection strings. Every copy script in `scripts/clone/` aborts when
the source and target hosts are identical or when `SANADI_ENV` is not `TEST`.
