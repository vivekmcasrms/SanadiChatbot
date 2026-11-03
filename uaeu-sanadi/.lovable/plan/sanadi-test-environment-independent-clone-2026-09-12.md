# Sanadi Test Environment — independent clone

## What I found about the current setup

Everything in Sanadi today runs against **one** shared backend: one database, one login system, one file storage, one set of app settings. The app code itself (screens, agents, tools, rules, documents, Knowledge Center, notifications) lives entirely in this project's files, so copying the code is straightforward — the real work is giving the copy its own backend so it can never touch live data.

One thing only you can do: the copy has to be created from Lovable's project menu ("Remix"/duplicate). That produces a brand-new project **with its own separate database, login system and storage**. I cannot create a second project or a second backend from inside this one. Everything else I can prepare here so the copy is ready the moment it exists.

## How the clone will be made independent

```text
Production Sanadi                Sanadi TEST
-----------------                -----------
project / code      --remix-->   own copy of all code
database            SEPARATE     own database (schema rebuilt from scripts)
login accounts      SEPARATE     own accounts (test users recreated)
file storage        SEPARATE     own buckets (CVs, letters, evidence, knowledge)
live data           SEPARATE     reference data only, no production cases
email sending       SANDBOXED    nothing leaves the system
```

## What I will build in this project (used by the clone, harmless here)

1. **Environment switch** — a new `SANADI_ENV` setting (`PRODUCTION` by default, `TEST` in the clone). Production behaviour is unchanged when the value is absent.
2. **Test-environment banner** — a clear "Sanadi Test Environment" strip shown to staff and admin users only when `SANADI_ENV=TEST`. Invisible in production.
3. **Outbound safety guard** — when the environment is TEST, email sending and any outbound call to external university/live systems is blocked at a single choke point and recorded as "suppressed (test environment)" instead of sent. Integrations that would still reach a live external service are listed explicitly in the report.
4. **Full schema rebuild script** — one ordered SQL file that recreates the complete structure in an empty database: extensions, enums, tables, keys, indexes, constraints, views, functions, triggers, access rules and permissions.
5. **Reference-data seed** — a script that loads only the safe, non-personal master data: units and service catalogue, roles, routing rules, service availability and appointment configuration, programme/course catalogue, emergency contacts, system configuration, Knowledge Center documents and their search content. No real student cases, chats, complaints, notifications or issued letters are copied.
6. **Test people, not real people** — the staff roster and the three DSAI test students are recreated as fresh accounts in the clone's own login system with test passwords. Real production accounts and password hashes are not exported.
7. **Storage setup** — the clone's own private buckets for CVs, generated documents, Knowledge Center files and uploaded evidence, with the same access rules.
8. **Isolation test suite** — an automated check run against the clone that creates a query, a complaint, a student, a document upload, a Knowledge Center edit and a staff assignment, then confirms each one exists in the clone and does **not** exist in production, and that the two databases' structures can drift independently.
9. **Isolation report** — `docs/TEST_ENVIRONMENT.md`, a table of every resource: production resource → clone resource → shared or separate → status, plus the step-by-step setup instructions for the clone.

## Nothing in production changes

All of the above is additive. Without `SANADI_ENV=TEST`, no banner appears, no behaviour changes, and no script runs automatically. I will not run any data-changing command against the current live backend.

## What you do after I finish

1. Duplicate this project from the Lovable project menu — the copy gets its own backend automatically.
2. In the copy, set `SANADI_ENV=TEST` and run the two scripts (schema, then reference data + test accounts).
3. Run the isolation test suite and read the report.

I will hand you these steps written out in the report when the work is done.
