INSERT INTO public.cases (
  case_number, student_id, case_type, service_unit_id, title, description, status,
  urgency, severity, language, entry_channel, current_responsible_actor, automation_level,
  human_review_required, attention_reason, linked_suggestion_id, related_conversation_id,
  routing_service_code, routing_reason_en, routing_reason_ar, routing_confidence, assigned_to, created_at
)
SELECT
  '', s.student_id, 'suggestion'::case_type, s.service_unit_id, s.title, s.description,
  CASE WHEN o.staff_profile_id IS NULL THEN 'submitted'::case_status ELSE 'assigned'::case_status END,
  'medium'::urgency_level, 'normal', s.language::lang_code, COALESCE(s.entry_channel, 'chat'),
  'service_owner', 'human_review', true,
  'A student suggestion needs a decision from the service owner',
  s.id, s.related_conversation_id,
  s.routing_service_code, s.routing_reason_en, s.routing_reason_ar, s.routing_confidence,
  o.staff_profile_id, s.created_at
FROM public.suggestions s
LEFT JOIN LATERAL (
  SELECT suo.staff_profile_id
  FROM public.service_unit_owners suo
  WHERE suo.service_unit_id = s.service_unit_id AND suo.is_active
  ORDER BY suo.created_at
  LIMIT 1
) o ON true
WHERE s.deleted_at IS NULL
  AND s.status NOT IN ('closed', 'implemented', 'not_proceeding')
  AND NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.linked_suggestion_id = s.id);