create table if not exists public.service_baselines (
  id uuid primary key default gen_random_uuid(),
  university_service_id uuid not null references public.university_services(id) on delete cascade,
  steps integer,
  forms integer,
  visits integer,
  fields_requested integer,
  avg_processing_hours numeric,
  staff_touchpoints integer,
  channels text[] not null default '{}',
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_service_id)
);

grant select, insert, update, delete on public.service_baselines to authenticated;
grant all on public.service_baselines to service_role;
alter table public.service_baselines enable row level security;

create policy "staff read service baselines" on public.service_baselines
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "managers write service baselines" on public.service_baselines
  for all to authenticated
  using (public.has_role(auth.uid(),'system_admin') or public.is_manager(auth.uid()))
  with check (public.has_role(auth.uid(),'system_admin') or public.is_manager(auth.uid()));

create table if not exists public.pilot_test_sessions (
  id uuid primary key default gen_random_uuid(),
  university_service_id uuid references public.university_services(id) on delete set null,
  service_label text,
  participant_role text not null,
  participant_count integer not null default 1,
  tested_on date not null default current_date,
  completed_successfully boolean not null default false,
  time_taken_minutes numeric,
  issues text,
  satisfaction_rating integer,
  comments text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.pilot_test_sessions
  add constraint pilot_test_sessions_rating_range
  check (satisfaction_rating is null or (satisfaction_rating between 1 and 5));

grant select, insert, update, delete on public.pilot_test_sessions to authenticated;
grant all on public.pilot_test_sessions to service_role;
alter table public.pilot_test_sessions enable row level security;

create policy "staff read pilot sessions" on public.pilot_test_sessions
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "managers write pilot sessions" on public.pilot_test_sessions
  for all to authenticated
  using (public.has_role(auth.uid(),'system_admin') or public.is_manager(auth.uid()))
  with check (public.has_role(auth.uid(),'system_admin') or public.is_manager(auth.uid()));

create index if not exists pilot_test_sessions_service_idx on public.pilot_test_sessions(university_service_id, tested_on desc);

create or replace function public.evaluation_metrics(_from timestamptz default null, _to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f timestamptz := coalesce(_from, now() - interval '365 days');
  t timestamptz := coalesce(_to, now());
  result jsonb;
begin
  if not (public.has_role(auth.uid(),'system_admin') or public.is_manager(auth.uid())) then
    raise exception 'not_authorised';
  end if;

  with c as (
    select * from public.cases
    where deleted_at is null and created_at >= f and created_at <= t
  ),
  done as (
    select * from c where status in ('resolved','closed')
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', f, 'to', t),
    'volumes', jsonb_build_object(
      'interactions', (select count(*) from c)
        + (select count(*) from public.messages m where m.created_at between f and t),
      'chat_messages', (select count(*) from public.messages m where m.created_at between f and t),
      'conversations', (select count(*) from public.conversations v where v.created_at between f and t),
      'cases', (select count(*) from c),
      'queries', (select count(*) from c where case_type = 'query'),
      'complaints', (select count(*) from c where case_type = 'complaint'),
      'suggestions', (select count(*) from c where case_type = 'suggestion'),
      'alerts', (select count(*) from c where case_type = 'alert'),
      'requests', (select count(*) from c where case_type = 'service_request')
    ),
    'handling', jsonb_build_object(
      'ai_resolved', (select count(*) from done where assigned_to is null and escalated_at is null),
      'human_escalated', (select count(*) from c where escalated_at is not null or assigned_to is not null),
      'resolved', (select count(*) from c where status = 'resolved'),
      'closed', (select count(*) from c where status = 'closed'),
      'open', (select count(*) from c where status not in ('resolved','closed','withdrawn','duplicate','rejected'))
    ),
    'timing', jsonb_build_object(
      'first_response_sample', (select count(*) from c where first_response_at is not null),
      'avg_first_response_hours', (
        select round(avg(extract(epoch from (first_response_at - created_at)) / 3600)::numeric, 2)
        from c where first_response_at is not null
      ),
      'resolution_sample', (select count(*) from done where coalesce(resolved_at, closed_at) is not null),
      'avg_resolution_hours', (
        select round(avg(extract(epoch from (coalesce(resolved_at, closed_at) - created_at)) / 3600)::numeric, 2)
        from done where coalesce(resolved_at, closed_at) is not null
      )
    ),
    'sla', jsonb_build_object(
      'sample', (select count(*) from done where resolution_due_at is not null and coalesce(resolved_at, closed_at) is not null),
      'met', (select count(*) from done where resolution_due_at is not null and coalesce(resolved_at, closed_at) is not null
                and coalesce(resolved_at, closed_at) <= resolution_due_at)
    ),
    'effort', jsonb_build_object(
      'staff_touchpoints', (select count(*) from public.case_status_history h
                              join c on c.id = h.case_id where h.changed_by is not null),
      'student_entered_fields', (select count(*) from public.case_information_requests r
                                   join c on c.id = r.case_id where r.responded_at is not null),
      'information_requests', (select count(*) from public.case_information_requests r join c on c.id = r.case_id),
      'reused_known_fields', (select count(*) from public.student_field_provenance),
      'status_transitions', (select count(*) from public.case_status_history h join c on c.id = h.case_id),
      'in_person_visits', (select count(*) from c where entry_channel = 'in_person')
    ),
    'reviews', jsonb_build_object(
      'decided_sample', (select count(*) from done),
      'reopen_or_objection', (select count(*) from public.case_reopen_requests r join c on c.id = r.case_id)
    ),
    'evidence', jsonb_build_object(
      'baselines', (select count(*) from public.service_baselines),
      'pilot_sessions', (select count(*) from public.pilot_test_sessions),
      'pilot_participants', (select coalesce(sum(participant_count),0) from public.pilot_test_sessions),
      'handovers', (select count(*) from public.case_handovers),
      'exception_events', (select count(*) from public.exception_events),
      'approvals', (select count(*) from public.action_approvals),
      'action_receipts', (select count(*) from public.action_receipts),
      'reviews_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
                            from (select coalesce(kind,'reopen') as kind, count(*) as n
                                    from public.case_reopen_requests group by 1) k),
      'provenance_fields', (select count(*) from public.student_field_provenance),
      'issued_documents', (select count(*) from public.issued_documents),
      'revoked_accounts', (select count(*) from public.profiles where access_revoked_at is not null),
      'assistant_conversations', (select count(*) from public.conversations)
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.evaluation_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.evaluation_metrics(timestamptz, timestamptz) to authenticated, service_role;