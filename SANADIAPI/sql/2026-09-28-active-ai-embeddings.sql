-- Match the active AI selection used by usp_Assistant_GetAiSettings.
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_GetEmbeddingSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1)
        provider AS Provider,
        embedding_model AS Model,
        api_url AS ApiUrl,
        api_key AS ApiKey
    FROM dbo.ai_settings
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC;
END;
GO
