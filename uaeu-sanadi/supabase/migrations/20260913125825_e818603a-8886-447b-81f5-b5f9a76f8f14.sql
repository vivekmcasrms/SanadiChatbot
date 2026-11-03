
-- 1. Extend learned_routing_rules ------------------------------------------
ALTER TABLE public.learned_routing_rules
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS rule_type text NOT NULL DEFAULT 'ROUTING_RULE',
  ADD COLUMN IF NOT EXISTS trigger_patterns text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS required_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS excluded_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_language text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS target_intent text,
  ADD COLUMN IF NOT EXISTS target_service_id uuid,
  ADD COLUMN IF NOT EXISTS evidence_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS historical_accuracy numeric(5,4),
  ADD COLUMN IF NOT EXISTS shadow_accuracy numeric(5,4),
  ADD COLUMN IF NOT EXISTS shadow_samples integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS activation_mode text NOT NULL DEFAULT 'HUMAN_APPROVAL',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rollback_reason text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS baseline_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.learned_routing_rules
  DROP CONSTRAINT IF EXISTS learned_routing_rules_status_check;
ALTER TABLE public.learned_routing_rules
  ADD CONSTRAINT learned_routing_rules_status_check
  CHECK (status IN ('PROPOSED','VALIDATING','SHADOW','VALIDATED','APPROVED','ACTIVE','PAUSED','REJECTED','ROLLED_BACK'));

ALTER TABLE public.learned_routing_rules
  DROP CONSTRAINT IF EXISTS learned_routing_rules_activation_mode_check;
ALTER TABLE public.learned_routing_rules
  ADD CONSTRAINT learned_routing_rules_activation_mode_check
  CHECK (activation_mode IN ('AUTO','HUMAN_APPROVAL'));

ALTER TABLE public.learned_routing_rules
  DROP CONSTRAINT IF EXISTS learned_routing_rules_risk_check;
ALTER TABLE public.learned_routing_rules
  ADD CONSTRAINT learned_routing_rules_risk_check
  CHECK (risk_level IN ('low','medium','high'));

UPDATE public.learned_routing_rules SET status = CASE WHEN active THEN 'ACTIVE' ELSE 'PAUSED' END
  WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS learned_routing_rules_status_idx
  ON public.learned_routing_rules (status, priority);

-- 2. Explainability / shadow log --------------------------------------------
CREATE TABLE IF NOT EXISTS public.learned_rule_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rule_id uuid REFERENCES public.learned_routing_rules(id) ON DELETE CASCADE,
  conversation_id uuid,
  case_id uuid,
  mode text NOT NULL DEFAULT 'ACTIVE',
  matched_phrase text,
  matched_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text,
  previous_target text,
  selected_target text,
  shadow_prediction text,
  actual_target text,
  confidence numeric(4,3),
  evidence_count integer,
  activation_mode text,
  outcome text NOT NULL DEFAULT 'PENDING',
  outcome_reason text,
  latency_ms integer
);

GRANT SELECT ON public.learned_rule_decisions TO authenticated;
GRANT ALL ON public.learned_rule_decisions TO service_role;
ALTER TABLE public.learned_rule_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Oversight can read routing decisions"
  ON public.learned_rule_decisions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'service_owner')
  );

CREATE INDEX IF NOT EXISTS learned_rule_decisions_rule_idx
  ON public.learned_rule_decisions (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS learned_rule_decisions_conversation_idx
  ON public.learned_rule_decisions (conversation_id, created_at DESC);

-- 3. Configurable thresholds --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_singleton boolean NOT NULL DEFAULT true UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  threshold_low integer NOT NULL DEFAULT 3,
  threshold_normal integer NOT NULL DEFAULT 5,
  threshold_high integer NOT NULL DEFAULT 10,
  min_historical_accuracy numeric(4,3) NOT NULL DEFAULT 0.95,
  min_shadow_samples integer NOT NULL DEFAULT 10,
  min_shadow_accuracy numeric(4,3) NOT NULL DEFAULT 0.90,
  auto_activation_enabled boolean NOT NULL DEFAULT true,
  pause_confidence numeric(4,3) NOT NULL DEFAULT 0.55,
  pause_failure_streak integer NOT NULL DEFAULT 3,
  updated_by uuid
);

GRANT SELECT ON public.learning_config TO authenticated;
GRANT ALL ON public.learning_config TO service_role;
ALTER TABLE public.learning_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Oversight can read learning config"
  ON public.learning_config FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'service_owner')
  );

CREATE POLICY "Admins can change learning config"
  ON public.learning_config FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'service_manager')
    OR public.has_role(auth.uid(), 'knowledge_manager')
  );

INSERT INTO public.learning_config (is_singleton) VALUES (true)
  ON CONFLICT (is_singleton) DO NOTHING;

CREATE TRIGGER update_learning_config_updated_at
  BEFORE UPDATE ON public.learning_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_learned_rule_decisions_updated_at
  BEFORE UPDATE ON public.learned_rule_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
