-- Repairs the stale singleton-only procedures found on the server.
-- Ollama/Qwen request settings are read only from the enabled dbo.ai_settings row.
-- Populate enable_thinking on the enabled row before enabling provider traffic.

IF COL_LENGTH(N'dbo.ai_settings', N'enable_thinking') IS NULL
BEGIN
    ALTER TABLE dbo.ai_settings ADD enable_thinking bit NULL;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        provider,
        model_name,
        api_key,
        api_url,
        temperature,
        max_output_tokens,
        enable_thinking,
        ai_enabled
    FROM dbo.ai_settings
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Assist_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        provider,
        model_name,
        api_key,
        api_url,
        temperature,
        max_output_tokens,
        enable_thinking,
        ai_enabled
    FROM dbo.ai_settings
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC;
END;
GO
