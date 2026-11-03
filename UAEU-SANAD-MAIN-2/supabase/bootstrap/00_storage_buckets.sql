-- Storage bucket definitions for a fresh (local or self-hosted) Sanadi instance.
-- Run once after the schema is restored:
--   psql "$DATABASE_URL" -f supabase/bootstrap/00_storage_buckets.sql
-- All buckets are PRIVATE; the app serves files through signed URLs only.

insert into storage.buckets (id, name, public)
values
  ('case-evidence',   'case-evidence',   false),
  ('knowledge-files', 'knowledge-files', false),
  ('student-letters', 'student-letters', false),
  ('student-cvs',     'student-cvs',     false)
on conflict (id) do nothing;

-- RLS policies on storage.objects are part of the schema dump. If you are
-- bootstrapping without a dump, re-apply the storage policies from
-- supabase/migrations before uploading any files.
