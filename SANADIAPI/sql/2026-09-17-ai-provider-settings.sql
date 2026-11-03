-- 2026-09-17
-- Provider switch settings for the server-side AI adapter.
-- The existing Gemini row is intentionally not updated.
-- Enable exactly one row at a time with is_enabled = 1.

IF COL_LENGTH(N'dbo.ai_settings', N'is_enabled') IS NULL
BEGIN
  ALTER TABLE [dbo].[ai_settings]
    ADD [is_enabled] bit NOT NULL
      CONSTRAINT [DF_ai_settings_is_enabled] DEFAULT (1) WITH VALUES;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE [name] = N'UX_ai_settings_one_enabled'
    AND [object_id] = OBJECT_ID(N'dbo.ai_settings')
)
  CREATE UNIQUE INDEX [UX_ai_settings_one_enabled]
    ON [dbo].[ai_settings]([is_enabled])
    WHERE [is_enabled] = 1;
GO

-- Keep the existing singleton Gemini configuration active and untouched.
-- Alternate provider rows are disabled until an administrator enables one.
IF NOT EXISTS (
  SELECT 1 FROM [dbo].[ai_settings]
  WHERE [provider] = N'ollama' AND [model_name] = N'llama3.1'
)
INSERT INTO [dbo].[ai_settings]
(
  [is_singleton], [is_enabled], [provider], [model_name], [embedding_model],
  [api_key], [api_url], [fallback_provider], [fallback_model], [reasoning_effort],
  [temperature], [max_output_tokens], [confidence_threshold], [handoff_threshold],
  [retrieval_top_k], [max_tool_calls], [request_timeout_ms], [daily_cost_limit_usd],
  [agent_flags], [ai_enabled], [created_at], [updated_at]
)
VALUES
(
  0, 0, N'ollama', N'llama3.1', N'',
  NULL, N'http://127.0.0.1:11434/v1', NULL, NULL, N'none',
  0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
  N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
  1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (
  SELECT 1 FROM [dbo].[ai_settings]
  WHERE [provider] = N'openai' AND [model_name] = N'gpt-4o-mini'
)
INSERT INTO [dbo].[ai_settings]
(
  [is_singleton], [is_enabled], [provider], [model_name], [embedding_model],
  [api_key], [api_url], [fallback_provider], [fallback_model], [reasoning_effort],
  [temperature], [max_output_tokens], [confidence_threshold], [handoff_threshold],
  [retrieval_top_k], [max_tool_calls], [request_timeout_ms], [daily_cost_limit_usd],
  [agent_flags], [ai_enabled], [created_at], [updated_at]
)
VALUES
(
  0, 0, N'openai', N'gpt-4o-mini', N'openai/text-embedding-3-small',
  NULL, N'https://api.openai.com/v1', NULL, NULL, N'none',
  0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
  N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
  1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (
  SELECT 1 FROM [dbo].[ai_settings]
  WHERE [provider] = N'anthropic' AND [model_name] = N'claude-3-5-sonnet-latest'
)
INSERT INTO [dbo].[ai_settings]
(
  [is_singleton], [is_enabled], [provider], [model_name], [embedding_model],
  [api_key], [api_url], [fallback_provider], [fallback_model], [reasoning_effort],
  [temperature], [max_output_tokens], [confidence_threshold], [handoff_threshold],
  [retrieval_top_k], [max_tool_calls], [request_timeout_ms], [daily_cost_limit_usd],
  [agent_flags], [ai_enabled], [created_at], [updated_at]
)
VALUES
(
  0, 0, N'anthropic', N'claude-3-5-sonnet-latest', N'',
  NULL, N'https://api.anthropic.com/v1', NULL, NULL, N'none',
  0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
  N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
  1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (
  SELECT 1 FROM [dbo].[ai_settings]
  WHERE [provider] = N'gemini' AND [model_name] = N'google/gemini-2.5-flash'
)
INSERT INTO [dbo].[ai_settings]
(
  [is_singleton], [is_enabled], [provider], [model_name], [embedding_model],
  [api_key], [api_url], [fallback_provider], [fallback_model], [reasoning_effort],
  [temperature], [max_output_tokens], [confidence_threshold], [handoff_threshold],
  [retrieval_top_k], [max_tool_calls], [request_timeout_ms], [daily_cost_limit_usd],
  [agent_flags], [ai_enabled], [created_at], [updated_at]
)
VALUES
(
  0, 0, N'gemini', N'google/gemini-2.5-flash', N'google/gemini-embedding-001',
  NULL, N'https://generativelanguage.googleapis.com/v1beta', NULL, NULL, N'none',
  0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
  N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
  1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
);
GO

-- Example switch, intentionally not executed:
-- UPDATE dbo.ai_settings SET is_enabled = CASE WHEN provider = N'ollama' THEN 1 ELSE 0 END;
-- UPDATE dbo.ai_settings SET api_key = N'<server-secret-only>' WHERE provider = N'ollama';
