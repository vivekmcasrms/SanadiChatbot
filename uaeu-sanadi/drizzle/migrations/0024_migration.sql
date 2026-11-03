alter table public.scheduled_job_runs
  add column if not exists duration_ms integer,
  add column if not exists skipped integer not null default 0,
  add column if not exists pages integer not null default 0,
  add column if not exists truncated boolean not null default false,
  add column if not exists details jsonb not null default '{}'::jsonb;
create index if not exists student_appointments_status_idx on public.student_appointments(status);
create index if not exists appointment_slots_start_time_idx on public.appointment_slots(start_time);