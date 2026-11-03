-- Include provider so voice STT can choose Gemini vs OpenAI correctly.
SET NOCOUNT ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Voice_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) api_key, api_url, model_name, provider
    FROM dbo.vw_AISettings_Compatibility
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC, id;
END;
GO
