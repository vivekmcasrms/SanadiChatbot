#!/usr/bin/env bash
# Sanadi — complete database export (PostgreSQL → PostgreSQL, no engine change).
#
# Preferred route: Lovable → Cloud → Advanced settings → Export data.
# That export is the only one that includes the `auth` schema (password hashes).
#
# Use this script when you have direct Postgres credentials (self-hosted copy or
# a database you own). Run it on your own machine.
#
#   SOURCE_DB_URL="postgresql://user:pass@host:5432/postgres" bash scripts/export-database.sh
#
# Output (./db-export):
#   sanadi-schema.sql  types, tables, keys, constraints, defaults, indexes, views,
#                      functions, triggers, RLS policies, grants, sequences, extensions
#   sanadi-data.sql    all row data + sequence values
#   sanadi-auth.sql    auth schema (users, identities, password hashes)
#   sanadi-full.dump   custom-format dump for pg_restore (parallel restore)
set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL}"
OUT="${OUT_DIR:-db-export}"
mkdir -p "$OUT"

SCHEMAS=(--schema=public --schema=storage)

echo "→ schema"
pg_dump "$SOURCE_DB_URL" --schema-only --no-owner --no-privileges=false \
  "${SCHEMAS[@]}" -f "$OUT/sanadi-schema.sql"

echo "→ data"
pg_dump "$SOURCE_DB_URL" --data-only --disable-triggers --no-owner \
  "${SCHEMAS[@]}" -f "$OUT/sanadi-data.sql"

echo "→ auth schema (users / password hashes)"
pg_dump "$SOURCE_DB_URL" --schema=auth --no-owner -f "$OUT/sanadi-auth.sql" || \
  echo "  (skipped: the connecting role cannot read the auth schema — use the Lovable Cloud export instead)"

echo "→ custom-format full dump"
pg_dump "$SOURCE_DB_URL" -Fc --no-owner "${SCHEMAS[@]}" -f "$OUT/sanadi-full.dump"

echo "Done. Files in ./$OUT — restore with DATABASE_RESTORE.md"
