#!/usr/bin/env bash
# Sanadi — complete schema export for the TEST duplicate (PostgreSQL → PostgreSQL).
#
# Produces ONE ordered file that rebuilds the entire structure in an empty
# database: extensions, enums, tables, keys, constraints, defaults, indexes,
# views, functions/RPCs, triggers, sequences, grants and RLS policies.
# No row data is included — reference data is loaded by copy-reference-data.mjs.
#
#   SOURCE_DB_URL="postgresql://user:pass@host:5432/postgres" \
#     bash scripts/clone/export-schema.sh
#
# If you do not hold direct Postgres credentials, use Lovable → Cloud →
# Advanced settings → Export data on the production project instead, and
# restore the schema portion of that export into the duplicate.
set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL (read-only credentials are enough)}"
OUT="${OUT_DIR:-clone-export}"
mkdir -p "$OUT"

echo "→ public + storage schema (structure only)"
pg_dump "$SOURCE_DB_URL" --schema-only --no-owner \
  --schema=public --schema=storage \
  -f "$OUT/sanadi-clone-schema.sql"

echo "→ inventory (for the isolation report)"
psql "$SOURCE_DB_URL" -At -c "
  select 'tables='||count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  union all select 'views='||count(*) from information_schema.views where table_schema='public'
  union all select 'enums='||count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'
  union all select 'functions='||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'triggers='||count(*) from pg_trigger where not tgisinternal
  union all select 'policies='||count(*) from pg_policies where schemaname in ('public','storage')
  union all select 'extensions='||string_agg(extname,',') from pg_extension
" | tee "$OUT/sanadi-clone-inventory.txt"

echo
echo "Done. Apply to the duplicate with:"
echo "  psql \"\$TARGET_DB_URL\" -f $OUT/sanadi-clone-schema.sql"
