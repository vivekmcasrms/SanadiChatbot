alter table public.case_reopen_requests
  add column if not exists kind text not null default 'objection',
  add column if not exists original_status text,
  add column if not exists original_outcome_en text,
  add column if not exists original_outcome_ar text,
  add column if not exists original_decided_at timestamptz;

create index if not exists case_reopen_requests_case_kind_idx on public.case_reopen_requests(case_id, kind);

create table if not exists public.student_field_provenance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  field_key text not null,
  field_value text,
  source text not null,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, field_key)
);

grant select on public.student_field_provenance to authenticated;
grant all on public.student_field_provenance to service_role;
alter table public.student_field_provenance enable row level security;

create policy "Students read their own field provenance"
  on public.student_field_provenance for select to authenticated
  using (student_id = auth.uid());

create policy "Staff read field provenance"
  on public.student_field_provenance for select to authenticated
  using (public.is_staff(auth.uid()));