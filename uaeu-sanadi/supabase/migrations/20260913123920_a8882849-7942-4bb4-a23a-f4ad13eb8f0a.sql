-- ============ learning_signals ============
CREATE TABLE public.learning_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid,
  message_id uuid,
  case_id uuid,
  student_id uuid,
  original_domain text,
  original_intent text,
  original_unit_id uuid REFERENCES public.service_units(id) ON DELETE SET NULL,
  original_staff_id uuid,
  corrected_domain text,
  corrected_intent text,
  corrected_unit_id uuid REFERENCES public.service_units(id) ON DELETE SET NULL,
  corrected_staff_id uuid,
  correction_type text NOT NULL CHECK (correction_type IN (
    'INTENT_CORRECTION','DOMAIN_CORRECTION','ROUTING_CORRECTION','UNIT_REASSIGNMENT',
    'STAFF_REASSIGNMENT','KNOWLEDGE_GAP','RESPONSE_QUALITY','WORKFLOW_FAILURE',
    'FALSE_RESOLUTION','CASE_REOPEN','STUDENT_CLARIFICATION','OTHER')),
  correction_source text NOT NULL CHECK (correction_source IN ('STAFF','STUDENT','SYSTEM','ADMIN')),
  reason_code text,
  original_user_text text,
  relevant_context_summary text,
  staff_comment text,
  student_feedback text,
  outcome text,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  -- True when the correction touches policy, eligibility, permissions or
  -- financial rules. Such signals are recorded for review but never feed
  -- automatic improvement proposals.
  policy_sensitive boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CLUSTERED','REVIEWED','DISMISSED')),
  candidate_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz
);

GRANT SELECT ON public.learning_signals TO authenticated;
GRANT ALL ON public.learning_signals TO service_role;
ALTER TABLE public.learning_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Oversight staff read learning signals"
  ON public.learning_signals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'service_owner')
  );

CREATE INDEX idx_learning_signals_type_created ON public.learning_signals (correction_type, created_at DESC);
CREATE INDEX idx_learning_signals_status ON public.learning_signals (status, created_at DESC);
CREATE INDEX idx_learning_signals_case ON public.learning_signals (case_id);
CREATE INDEX idx_learning_signals_candidate ON public.learning_signals (candidate_id);

-- ============ learning_candidates ============
CREATE TABLE public.learning_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  candidate_type text NOT NULL CHECK (candidate_type IN (
    'ROUTING_RULE','INTENT_ALIAS','UNIT_ALIAS','KNOWLEDGE_GAP','CLARIFICATION_RULE',
    'TOOL_SELECTION_RULE','PROMPT_IMPROVEMENT','WORKFLOW_IMPROVEMENT')),
  pattern_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_count integer NOT NULL DEFAULT 0,
  affected_domains text[] NOT NULL DEFAULT '{}',
  affected_units uuid[] NOT NULL DEFAULT '{}',
  example_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_behaviour text,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED','DEFERRED','ACTIVE')),
  review_note text,
  approved_by uuid,
  approved_at timestamptz,
  activated_at timestamptz,
  baseline_metrics jsonb,
  impact_metrics jsonb
);
CREATE UNIQUE INDEX idx_learning_candidates_pattern ON public.learning_candidates (candidate_type, pattern_key);

GRANT SELECT ON public.learning_candidates TO authenticated;
GRANT ALL ON public.learning_candidates TO service_role;
ALTER TABLE public.learning_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Oversight staff read learning candidates"
  ON public.learning_candidates FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'service_owner')
  );

ALTER TABLE public.learning_signals
  ADD CONSTRAINT learning_signals_candidate_fk
  FOREIGN KEY (candidate_id) REFERENCES public.learning_candidates(id) ON DELETE SET NULL;

-- ============ learned_routing_rules ============
CREATE TABLE public.learned_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rule_name text NOT NULL,
  trigger_context text,
  trigger_phrases text[] NOT NULL DEFAULT '{}',
  pending_domain text,
  target_domain text,
  target_service text,
  target_unit_id uuid REFERENCES public.service_units(id) ON DELETE SET NULL,
  priority integer NOT NULL DEFAULT 100,
  confidence numeric(4,3) NOT NULL DEFAULT 0.800,
  approved_by uuid,
  effective_from timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  source_candidate_id uuid REFERENCES public.learning_candidates(id) ON DELETE SET NULL,
  applied_count integer NOT NULL DEFAULT 0
);

GRANT SELECT ON public.learned_routing_rules TO authenticated;
GRANT ALL ON public.learned_routing_rules TO service_role;
ALTER TABLE public.learned_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Oversight staff read learned routing rules"
  ON public.learned_routing_rules FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'service_owner')
  );

CREATE INDEX idx_learned_routing_active ON public.learned_routing_rules (active, priority);

CREATE TRIGGER update_learning_signals_updated_at BEFORE UPDATE ON public.learning_signals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_learning_candidates_updated_at BEFORE UPDATE ON public.learning_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_learned_routing_rules_updated_at BEFORE UPDATE ON public.learned_routing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();