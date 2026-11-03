-- Point Sanadi AI at Gemini using values stored on dbo.ai_settings.
-- Does not change prompts, tools, or agent behaviour.

IF COL_LENGTH(N'dbo.ai_settings', N'api_key') IS NULL
  ALTER TABLE [dbo].[ai_settings] ADD [api_key] nvarchar(4000) NULL;
IF COL_LENGTH(N'dbo.ai_settings', N'api_url') IS NULL
  ALTER TABLE [dbo].[ai_settings] ADD [api_url] nvarchar(1000) NULL;
IF COL_LENGTH(N'dbo.ai_settings', N'fallback_provider') IS NULL
  ALTER TABLE [dbo].[ai_settings] ADD [fallback_provider] nvarchar(450) NULL;
IF COL_LENGTH(N'dbo.ai_settings', N'fallback_model') IS NULL
  ALTER TABLE [dbo].[ai_settings] ADD [fallback_model] nvarchar(450) NULL;
IF COL_LENGTH(N'dbo.ai_settings', N'reasoning_effort') IS NULL
  ALTER TABLE [dbo].[ai_settings] ADD [reasoning_effort] nvarchar(50) NOT NULL CONSTRAINT [DF_ai_settings_reasoning_effort] DEFAULT N'none';
GO

UPDATE [dbo].[ai_settings]
SET
  [provider] = N'gemini',
  [model_name] = N'google/gemini-3.6-flash',
  [embedding_model] = N'google/gemini-embedding-001',
  [api_url] = N'https://generativelanguage.googleapis.com/v1beta',
  [temperature] = 0.2,
  [max_output_tokens] = 1200,
  [confidence_threshold] = 0.55,
  [handoff_threshold] = 0.4,
  [retrieval_top_k] = 6,
  [max_tool_calls] = 8,
  [request_timeout_ms] = 45000,
  [daily_cost_limit_usd] = 25,
  [reasoning_effort] = N'none',
  [fallback_provider] = NULL,
  [fallback_model] = NULL,
  [ai_enabled] = 1,
  [updated_at] = SYSDATETIMEOFFSET()
WHERE [is_singleton] = 1;
GO

UPDATE [dbo].[model_routing_rules]
SET [preferred_provider] = N'gemini', [updated_at] = SYSDATETIMEOFFSET()
WHERE [is_active] = 1 AND [preferred_provider] = N'lovable';
GO
