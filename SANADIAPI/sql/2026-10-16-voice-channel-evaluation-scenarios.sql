-- Voice channel acceptance scenarios (text-equivalent transcripts).
-- Same /api/chat/ask evaluation path as typed turns; STT is smoke-tested separately when configured.
SET NOCOUNT ON;

MERGE dbo.evaluation_scenarios AS target
USING (VALUES
  (
    N'VOICE-EN-COMPLAINT-BUS',
    N'en',
    N'voice_channel',
    N'I want to complain about the evening bus service.',
    N'["complaint"]',
    N'[]',
    N'action_proposal',
    CAST(0 AS bit),
    N'PRD voice test 1: English complaint transcript uses the same complaint path as typing.'
  ),
  (
    N'VOICE-AR-SUGGESTION-TECH',
    N'ar',
    N'voice_channel',
    N'أقترح أن تتعاون الجامعة مع شركات تقنية أكثر.',
    N'["suggestion"]',
    N'[]',
    N'action_proposal',
    CAST(0 AS bit),
    N'PRD voice test 2: Arabic suggestion — Suggestion agent, not Career Placement.'
  ),
  (
    N'VOICE-EN-CASE-FOLLOWUP',
    N'en',
    N'voice_channel',
    N'Is my UAEU-2026-01063 meeting confirmed?',
    N'["query"]',
    N'[]',
    N'answer',
    CAST(0 AS bit),
    N'PRD voice test 3: case-ref follow-up must not open a new appointment booking.'
  ),
  (
    N'VOICE-EN-REG-CSBP220',
    N'en',
    N'voice_channel',
    N'Can I register for CSBP220?',
    N'["query"]',
    N'[]',
    N'answer',
    CAST(0 AS bit),
    N'PRD voice test 4: Registration Readiness from verified student data.'
  ),
  (
    N'VOICE-EN-AMBIGUOUS',
    N'en',
    N'voice_channel',
    N'Help me with that thing about the course.',
    N'[]',
    N'[]',
    N'clarification',
    CAST(0 AS bit),
    N'PRD voice test 5: ambiguity asks one clarification — no silent action.'
  ),
  (
    N'VOICE-EN-CONTINUITY',
    N'en',
    N'voice_channel',
    N'Please continue with my previous request in this conversation.',
    N'[]',
    N'[]',
    N'answer',
    CAST(0 AS bit),
    N'PRD voice test 6: voice↔type continuity — same conversationId / thread context.'
  )
) AS source (scenario_code, language, category, input_message, expected_intents, expected_tools, expected_outcome_type, expected_human_handoff, notes)
ON target.scenario_code = source.scenario_code
WHEN MATCHED THEN
  UPDATE SET
    language = source.language,
    category = source.category,
    input_message = source.input_message,
    expected_intents = source.expected_intents,
    expected_tools = source.expected_tools,
    expected_outcome_type = source.expected_outcome_type,
    expected_human_handoff = source.expected_human_handoff,
    notes = source.notes,
    is_active = 1
WHEN NOT MATCHED THEN
  INSERT (scenario_code, language, category, input_message, expected_intents, expected_tools, expected_outcome_type, expected_human_handoff, notes, is_active)
  VALUES (source.scenario_code, source.language, source.category, source.input_message, source.expected_intents, source.expected_tools, source.expected_outcome_type, source.expected_human_handoff, source.notes, 1);
GO
