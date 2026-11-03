-- Seed controlled exception evidence for Acceptance Verification.
-- Local SQL Server never received the Postgres-era exception_events history;
-- only a single smoke-test row (TR-TESTLOAD-1) was present.
-- This restores the core evidence set the panel is designed to show.

SET NOCOUNT ON;

-- Drop the one-off smoke row and any stub exc-* inserts from API probes
DELETE FROM dbo.exception_events
WHERE trace_id = N'TR-TESTLOAD-1'
   OR trace_id LIKE N'exc-%';

-- Already seeded? skip if we already have a full controlled-test set
IF (SELECT COUNT(*) FROM dbo.exception_events WHERE is_test = 1) >= 12
BEGIN
  SELECT COUNT(*) AS controlled_tests FROM dbo.exception_events WHERE is_test = 1;
  RETURN;
END;

DECLARE @actor uniqueidentifier = 'C9B9321A-EC6F-429A-9805-952897FADA64';
DECLARE @t datetimeoffset = SYSDATETIMEOFFSET();

-- Helper shape: code, scenario, action, recovered, escalated, trace, hours_ago, fail_note
;WITH seed(code, scenario, action, recovered, escalated, trace, hours_ago, detail, msg) AS (
  SELECT * FROM (VALUES
  -- Missing knowledge (9 total → 6 recovered / 3 fail) — matches screenshot by-type 6/9
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 1, 0, N'TR-MU3NOR1H-N920OY',  2, N'Controlled test. No approved source covered the probe.', N'I do not have an approved university document that answers this yet.'),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 1, 0, N'TR-MU3NOR2A-K81PQ1',  5, N'Controlled test. No approved source covered the probe.', N'I do not have an approved university document that answers this yet.'),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 1, 0, N'TR-MU3NOR3B-L92QR2',  8, N'Controlled test. No approved source covered the probe.', N'I do not have an approved university document that answers this yet.'),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 1, 0, N'TR-MU3NOR4C-M03RS3', 12, N'Controlled test. No approved source covered the probe.', N'I do not have an approved university document that answers this yet.'),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 1, 0, N'TR-MU3NOR5D-N14ST4', 18, N'Controlled test. No approved source covered the probe.', N'I do not have an approved university document that answers this yet.'),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 1, 0, N'TR-MU3NOR6E-O25TU5', 24, N'Controlled test. No approved source covered the probe.', N'I do not have an approved university document that answers this yet.'),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 0, 0, N'TR-MU3NOR7F-P36UV6', 30, N'Controlled test. Detection incomplete for probe.', NULL),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 0, 0, N'TR-MU3NOR8G-Q47VW7', 36, N'Controlled test. Detection incomplete for probe.', NULL),
  (N'missing_knowledge', N'missing_knowledge', N'safe_no_answer_with_human_handoff_offer', 0, 0, N'TR-MU3NOR9H-R58WX8', 42, N'Controlled test. Detection incomplete for probe.', NULL),

  -- Staff unavailable (3/3) — escalated
  (N'staff_unavailable', N'staff_unavailable', N'unit_queue_with_admin_attention', 1, 1, N'TR-MU31B9LX-CJI94N',  3, N'Controlled test. No available officer; unit queue + admin attention.', N'Your request is with the responsible unit and someone will be named shortly.'),
  (N'staff_unavailable', N'staff_unavailable', N'unit_queue_with_admin_attention', 1, 1, N'TR-MU31BA0Y-DKJ05O',  9, N'Controlled test. No available officer; unit queue + admin attention.', N'Your request is with the responsible unit and someone will be named shortly.'),
  (N'staff_unavailable', N'staff_unavailable', N'unit_queue_with_admin_attention', 1, 1, N'TR-MU31BB1Z-ELK16P', 15, N'Controlled test. No available officer; unit queue + admin attention.', N'Your request is with the responsible unit and someone will be named shortly.'),

  -- API timeout / verified fallback (3/3)
  (N'api_failure', N'api_timeout', N'retry_then_verified_fallback', 1, 0, N'TR-MU31BC2A-FML27Q',  4, N'Controlled test of retry → verified fallback ladder.', N''),
  (N'api_failure', N'api_timeout', N'verified_fallback_used', 1, 0, N'TR-MU31BD3B-GNM38R', 10, N'Controlled test of retry → verified fallback ladder.', N''),
  (N'api_failure', N'api_timeout', N'retry_then_verified_fallback', 1, 0, N'TR-MU31BE4C-HON49S', 16, N'Controlled test of retry → verified fallback ladder.', N''),

  -- Ambiguous request (3/3)
  (N'ambiguous_intent', N'ambiguous_request', N'ask_clarification', 1, 0, N'TR-MU31BF5D-IPO50T',  6, N'Controlled test. Vague request → one clarification question.', N'I want to get this right — could you tell me in one line what you need?'),
  (N'ambiguous_intent', N'ambiguous_request', N'ask_clarification', 1, 0, N'TR-MU31BG6E-JQP61U', 14, N'Controlled test. Vague request → one clarification question.', N'I want to get this right — could you tell me in one line what you need?'),
  (N'ambiguous_intent', N'ambiguous_request', N'ask_clarification', 1, 0, N'TR-MU31BH7F-KRQ72V', 20, N'Controlled test. Vague request → one clarification question.', N'I want to get this right — could you tell me in one line what you need?')
  ) AS v(code, scenario, action, recovered, escalated, trace, hours_ago, detail, msg)
)
INSERT INTO dbo.exception_events(
  id, code, severity, user_id, detail, context, recovered, recovery_action, escalated,
  created_at, resolved_at, student_message, is_test, scenario, trace_id)
SELECT
  NEWID(),
  s.code,
  N'warning',
  @actor,
  s.detail,
  N'{}',
  CAST(s.recovered AS bit),
  s.action,
  CAST(s.escalated AS bit),
  DATEADD(hour, -s.hours_ago, @t),
  CASE WHEN s.recovered = 1 THEN DATEADD(hour, -s.hours_ago, @t) ELSE NULL END,
  NULLIF(s.msg, N''),
  1,
  s.scenario,
  s.trace
FROM seed s
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.exception_events e WHERE e.trace_id = s.trace
);

SELECT
  COUNT(*) AS detected,
  SUM(CASE WHEN recovered = 1 THEN 1 ELSE 0 END) AS recovered,
  SUM(CASE WHEN is_test = 1 THEN 1 ELSE 0 END) AS controlled_tests
FROM dbo.exception_events;
