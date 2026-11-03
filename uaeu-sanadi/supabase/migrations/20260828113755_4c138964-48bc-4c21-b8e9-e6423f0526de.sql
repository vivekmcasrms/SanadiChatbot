create or replace function public.admin_governance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _all boolean;
  _new text[] := array['draft','submitted','acknowledged','classified','routed','assigned'];
  _prog text[] := array['in_progress','in_review','ai_processing','resolution_proposed','escalated','on_hold','waiting_external','reopened','transferred','awaiting_student','student_confirmation'];
  _result jsonb;
begin
  select public.can_monitor_all_units(_uid) into _all;
  if not coalesce(_all, false) then
    raise exception 'Not authorised for university-wide monitoring';
  end if;

  with c as (
    select * from public.cases where deleted_at is null
  ),
  totals as (
    select
      count(*)::int as total,
      count(*) filter (where case_type = 'query')::int as queries,
      count(*) filter (where case_type = 'complaint')::int as complaints,
      count(*) filter (where case_type = 'suggestion')::int as suggestions,
      count(*) filter (where case_type = 'alert')::int as alerts,
      count(*) filter (where case_type = 'service_request')::int as requests,
      count(*) filter (where status::text = any(_new))::int as open_new,
      count(*) filter (where status::text = any(_prog))::int as in_progress,
      count(*) filter (where status::text = 'resolved')::int as resolved,
      count(*) filter (where status::text = 'closed')::int as closed
    from c
  ),
  perf as (
    select
      avg(extract(epoch from (coalesce(resolved_at, closed_at) - created_at)) / 3600.0)
        filter (where coalesce(resolved_at, closed_at) is not null) as avg_resolution_hours,
      count(*) filter (
        where status::text <> all(array['resolved','closed'])
          and resolution_due_at is not null and resolution_due_at > now() + interval '24 hours'
      )::int as within_sla,
      count(*) filter (
        where status::text <> all(array['resolved','closed'])
          and resolution_due_at is not null
          and resolution_due_at > now() and resolution_due_at <= now() + interval '24 hours'
      )::int as approaching_sla,
      count(*) filter (
        where status::text <> all(array['resolved','closed'])
          and resolution_due_at is not null and resolution_due_at < now()
      )::int as breached_sla,
      count(*) filter (
        where case_type = 'alert' and coalesce(severity,'') in ('critical','important')
          and status::text <> all(array['resolved','closed'])
      )::int as critical_alerts
    from c
  ),
  units as (
    select
      su.id as unit_id,
      su.name_en, su.name_ar,
      count(*) filter (where c.status::text = any(_new || _prog))::int as open_cases,
      count(*) filter (
        where c.status::text <> all(array['resolved','closed'])
          and c.resolution_due_at is not null and c.resolution_due_at < now()
      )::int as breached,
      count(*) filter (
        where c.case_type = 'complaint' and c.status::text <> all(array['resolved','closed'])
      )::int as open_complaints,
      count(*) filter (
        where c.case_type = 'alert' and c.status::text <> all(array['resolved','closed'])
      )::int as open_alerts
    from public.service_units su
    join c on c.service_unit_id = su.id
    group by su.id, su.name_en, su.name_ar
  ),
  recent as (
    select jsonb_agg(x order by x->>'at' desc) as items from (
      select jsonb_build_object(
        'id', c.id,
        'caseNumber', c.case_number,
        'title', c.title,
        'type', c.case_type,
        'status', c.status,
        'unitEn', su.name_en,
        'unitAr', su.name_ar,
        'at', coalesce(c.last_activity_at, c.updated_at, c.created_at)
      ) as x
      from c left join public.service_units su on su.id = c.service_unit_id
      order by coalesce(c.last_activity_at, c.updated_at, c.created_at) desc
      limit 12
    ) s
  )
  select jsonb_build_object(
    'totals', (select to_jsonb(t) from totals t),
    'performance', (select to_jsonb(p) from perf p),
    'unitsNeedingAttention', coalesce((
      select jsonb_agg(to_jsonb(u) order by u.breached desc, u.open_cases desc)
      from units u
      where u.breached > 0 or u.open_complaints > 0 or u.open_alerts > 0 or u.open_cases >= 5
    ), '[]'::jsonb),
    'recent', coalesce((select items from recent), '[]'::jsonb)
  ) into _result;

  return _result;
end;
$$;

revoke all on function public.admin_governance_overview() from public, anon;
grant execute on function public.admin_governance_overview() to authenticated;

create or replace function public.admin_owner_performance()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _all boolean;
  _result jsonb;
begin
  select public.can_monitor_all_units(_uid) into _all;
  if not coalesce(_all, false) then
    raise exception 'Not authorised for university-wide monitoring';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.open_cases desc), '[]'::jsonb) into _result
  from (
    select
      p.id as owner_id,
      coalesce(p.full_name, p.email, 'Unassigned') as owner_name,
      su.name_en as unit_en,
      su.name_ar as unit_ar,
      count(*)::int as assigned,
      count(*) filter (where c.status::text not in ('resolved','closed'))::int as open_cases,
      count(*) filter (where c.status::text = 'resolved')::int as resolved,
      count(*) filter (where c.status::text = 'closed')::int as closed,
      count(*) filter (where c.case_type = 'complaint')::int as complaints,
      count(*) filter (
        where c.status::text not in ('resolved','closed')
          and c.resolution_due_at is not null and c.resolution_due_at < now()
      )::int as overdue,
      avg(extract(epoch from (coalesce(c.resolved_at, c.closed_at) - c.created_at)) / 3600.0)
        filter (where coalesce(c.resolved_at, c.closed_at) is not null) as avg_handling_hours,
      (count(*) filter (
         where coalesce(c.resolved_at, c.closed_at) is not null
           and (c.resolution_due_at is null or coalesce(c.resolved_at, c.closed_at) <= c.resolution_due_at)
       )::numeric
       / nullif(count(*) filter (where coalesce(c.resolved_at, c.closed_at) is not null), 0)) as sla_compliance,
      (count(*) filter (where c.status::text in ('resolved','closed'))::numeric
       / nullif(count(*), 0)) as resolution_rate
    from public.cases c
    join public.profiles p on p.id = c.assigned_to
    left join public.service_units su on su.id = c.service_unit_id
    where c.deleted_at is null
    group by p.id, p.full_name, p.email, su.name_en, su.name_ar
  ) r;

  return _result;
end;
$$;

revoke all on function public.admin_owner_performance() from public, anon;
grant execute on function public.admin_owner_performance() to authenticated;

create or replace function public.admin_governance_report(
  _from timestamptz default null,
  _to timestamptz default null,
  _unit uuid default null,
  _owner uuid default null,
  _type text default null,
  _status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _all boolean;
  _result jsonb;
begin
  select public.can_monitor_all_units(_uid) into _all;
  if not coalesce(_all, false) then
    raise exception 'Not authorised for university-wide monitoring';
  end if;

  with c as (
    select cs.*, su.name_en as unit_en, su.name_ar as unit_ar,
           coalesce(p.full_name, p.email) as owner_name
    from public.cases cs
    left join public.service_units su on su.id = cs.service_unit_id
    left join public.profiles p on p.id = cs.assigned_to
    where cs.deleted_at is null
      and (_from is null or cs.created_at >= _from)
      and (_to is null or cs.created_at <= _to)
      and (_unit is null or cs.service_unit_id = _unit)
      and (_owner is null or cs.assigned_to = _owner)
      and (_type is null or cs.case_type::text = _type)
      and (_status is null or cs.status::text = _status)
  ),
  metrics as (
    select
      count(*)::int as total,
      count(*) filter (where case_type = 'query')::int as queries,
      count(*) filter (where case_type = 'complaint')::int as complaints,
      count(*) filter (where case_type = 'suggestion')::int as suggestions,
      count(*) filter (where case_type = 'alert')::int as alerts,
      count(*) filter (where case_type = 'service_request')::int as requests,
      count(*) filter (where status::text = 'resolved')::int as resolved,
      count(*) filter (where status::text = 'closed')::int as closed,
      count(*) filter (where status::text not in ('resolved','closed'))::int as unresolved,
      avg(extract(epoch from (coalesce(resolved_at, closed_at) - created_at)) / 3600.0)
        filter (where coalesce(resolved_at, closed_at) is not null) as avg_resolution_hours,
      count(*) filter (
        where coalesce(resolved_at, closed_at) is not null
          and (resolution_due_at is null or coalesce(resolved_at, closed_at) <= resolution_due_at)
      )::int as met_sla,
      count(*) filter (
        where resolution_due_at is not null
          and ((coalesce(resolved_at, closed_at) is not null and coalesce(resolved_at, closed_at) > resolution_due_at)
            or (coalesce(resolved_at, closed_at) is null and resolution_due_at < now()))
      )::int as breached_sla
    from c
  ),
  rows as (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) as items
    from (
      select case_number, title, case_type::text as case_type, status::text as status,
             unit_en, unit_ar, owner_name, created_at,
             coalesce(resolved_at, closed_at) as completed_at,
             resolution_due_at,
             extract(epoch from (coalesce(resolved_at, closed_at) - created_at)) / 3600.0 as resolution_hours
      from c
      order by created_at desc
      limit 1000
    ) x
  ),
  by_unit as (
    select coalesce(jsonb_agg(to_jsonb(u) order by u.total desc), '[]'::jsonb) as items
    from (
      select coalesce(unit_en, 'Unassigned') as unit_en, coalesce(unit_ar, 'غير مُسندة') as unit_ar,
             count(*)::int as total,
             count(*) filter (where status::text in ('resolved','closed'))::int as completed,
             count(*) filter (where status::text not in ('resolved','closed'))::int as open_cases,
             avg(extract(epoch from (coalesce(resolved_at, closed_at) - created_at)) / 3600.0)
               filter (where coalesce(resolved_at, closed_at) is not null) as avg_resolution_hours
      from c group by 1, 2
    ) u
  ),
  by_owner as (
    select coalesce(jsonb_agg(to_jsonb(o) order by o.total desc), '[]'::jsonb) as items
    from (
      select coalesce(owner_name, 'Unassigned') as owner_name,
             count(*)::int as total,
             count(*) filter (where status::text in ('resolved','closed'))::int as completed,
             count(*) filter (where status::text not in ('resolved','closed'))::int as open_cases
      from c group by 1
    ) o
  )
  select jsonb_build_object(
    'metrics', (select to_jsonb(m) from metrics m),
    'rows', (select items from rows),
    'byUnit', (select items from by_unit),
    'byOwner', (select items from by_owner)
  ) into _result;

  return _result;
end;
$$;

revoke all on function public.admin_governance_report(timestamptz, timestamptz, uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_governance_report(timestamptz, timestamptz, uuid, uuid, text, text) to authenticated;