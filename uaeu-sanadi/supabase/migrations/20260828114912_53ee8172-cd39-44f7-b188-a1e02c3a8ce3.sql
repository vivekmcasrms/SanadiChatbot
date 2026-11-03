CREATE OR REPLACE FUNCTION public.admin_owner_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _all boolean;
  _out jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.can_monitor_cases(_uid) THEN
    RAISE EXCEPTION 'Not authorised for case monitoring';
  END IF;
  _all := public.can_monitor_all_units(_uid);

  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'activeCases')::int DESC), '[]'::jsonb) INTO _out
  FROM (
    SELECT jsonb_build_object(
      'ownerId', v.assigned_to,
      'ownerName', COALESCE(v.owner_name, 'Unassigned'),
      'unitEn', COALESCE(v.unit_name_en, '—'),
      'unitAr', COALESCE(v.unit_name_ar, '—'),
      'activeCases', count(*) FILTER (WHERE NOT v.is_closed),
      'overdueResponses', count(*) FILTER (WHERE v.response_overdue),
      'breached', count(*) FILTER (WHERE v.sla_status = 'breached'),
      'unresolvedEscalations', count(*) FILTER (WHERE v.escalation_unresolved),
      'closedCases', count(*) FILTER (WHERE v.is_closed),
      -- A share between 0 and 1, and NULL while nothing has been completed:
      -- an officer with no closed case has no compliance record, not a bad one.
      'slaCompliance', CASE
        WHEN count(*) FILTER (WHERE v.is_closed) = 0 THEN NULL
        ELSE ROUND(
          count(*) FILTER (WHERE v.is_closed AND (v.sla_due_at IS NULL OR v.resolved_at <= v.sla_due_at))::numeric
          / count(*) FILTER (WHERE v.is_closed), 4)
      END,
      -- Time actually taken to first respond (acknowledgement), not the time allowed.
      'medianResponseHours', ROUND((percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (v.acknowledged_at - v.created_at)) / 3600.0))::numeric, 1)
    ) AS t
    FROM public.case_monitor_v v
    WHERE v.assigned_to IS NOT NULL
      AND (_all OR v.service_unit_id IN (SELECT service_unit_id FROM public.case_monitor_units(_uid)))
    GROUP BY v.assigned_to, v.owner_name, v.unit_name_en, v.unit_name_ar
  ) s;

  RETURN _out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_owner_monitor() FROM anon;