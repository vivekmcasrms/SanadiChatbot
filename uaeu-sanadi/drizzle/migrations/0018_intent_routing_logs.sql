CREATE TABLE public.intent_routing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid,
  user_id uuid,
  intent text NOT NULL,
  domain text NOT NULL,
  confidence numeric(4,2) NOT NULL,
  entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  case_reference text,
  topic_changed boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  handler text NOT NULL,
  classifier_ms integer
);
GRANT SELECT ON public.intent_routing_logs TO authenticated;
GRANT ALL ON public.intent_routing_logs TO service_role;
ALTER TABLE public.intent_routing_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and auditors read routing logs" ON public.intent_routing_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'system_admin') OR public.has_role(auth.uid(), 'auditor'));
CREATE INDEX intent_routing_logs_created_idx ON public.intent_routing_logs (created_at DESC);
CREATE INDEX intent_routing_logs_intent_idx ON public.intent_routing_logs (intent, created_at DESC);
COMMENT ON TABLE public.intent_routing_logs IS 'Internal routing decisions (intent, domain, confidence, entities, handler). Never shown to students.';