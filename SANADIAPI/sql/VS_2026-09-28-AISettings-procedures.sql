/*
  VS_2026-09-28-AISettings-procedures.sql
  Prepared from the configured database's procedure definitions and actual
  dbo.AISettings schema on 2026-09-28. Execute in the Sanadi application database.

  Database migration script. Numeric admin IDs require the corresponding
  AiAdminController scalar read to use int? instead of Guid?.
  - Existing AISettings provider, model, BaseUrl, ChatPath, ApiKey and IsEnabled
    remain authoritative. No URLs or credentials are embedded in this script.
  - Add compatibility columns approved for preserving existing AI settings.
    Copy missing values ONCE from the most recent matching legacy provider.
    Never copy legacy URLs/keys over AISettings values or enable legacy providers.
  - Use the existing numeric AiSettingId for AI settings identity (returned as id).
    The API admin caller must read/pass int rather than Guid for @existingId.
    User/actor identity remains a GUID; it is not an AI settings row ID.
  - Chat api_url = BaseUrl + ChatPath (without duplicating an existing suffix).
    Embeddings use BaseUrl, ApiKey and the preserved separate EmbeddingModel.
  - Existing C# Ollama chat/embedding requests already use Authorization: Bearer
    with the returned ApiKey. SQL supplies configuration; it does not send HTTP.
  - The legacy agent's generic settings READ is redirected to the compatibility
    view backed only by AISettings. Other generic data reads remain unchanged.
    The old table is retained as migration source/metadata, not runtime AI config.
  - Does not add new AI-provider capabilities, migrate models/vectors, change
    application HTTP timeouts, or make Ollama support Gemini voice transcription.
  - Transactional and repeatable. Do not rerun older ai_settings migrations afterward.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.AISettings', N'U') IS NULL
        THROW 51000, 'dbo.AISettings is missing. Run this script in the correct database.', 1;
    IF OBJECT_ID(N'dbo.ai_settings', N'U') IS NULL
        THROW 51000, 'Legacy ai_settings is required for the one-time compatibility migration.', 1;
    IF OBJECT_ID(N'dbo.usp_Data_Select', N'P') IS NULL
        THROW 51000, 'The existing generic data reader usp_Data_Select is missing.', 1;

    IF COL_LENGTH(N'dbo.AISettings', N'EmbeddingModel') IS NULL
        ALTER TABLE dbo.AISettings ADD [EmbeddingModel] nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'EnableThinking') IS NULL
        ALTER TABLE dbo.AISettings ADD [EnableThinking] bit NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'FallbackProvider') IS NULL
        ALTER TABLE dbo.AISettings ADD [FallbackProvider] nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'FallbackModel') IS NULL
        ALTER TABLE dbo.AISettings ADD [FallbackModel] nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'ReasoningEffort') IS NULL
        ALTER TABLE dbo.AISettings ADD [ReasoningEffort] nvarchar(50) NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'ConfidenceThreshold') IS NULL
        ALTER TABLE dbo.AISettings ADD [ConfidenceThreshold] decimal(18,6) NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'HandoffThreshold') IS NULL
        ALTER TABLE dbo.AISettings ADD [HandoffThreshold] decimal(18,6) NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'RetrievalTopK') IS NULL
        ALTER TABLE dbo.AISettings ADD [RetrievalTopK] int NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'MaxToolCalls') IS NULL
        ALTER TABLE dbo.AISettings ADD [MaxToolCalls] int NULL;
    IF COL_LENGTH(N'dbo.AISettings', N'UpdatedBy') IS NULL
        ALTER TABLE dbo.AISettings ADD [UpdatedBy] uniqueidentifier NULL;

    -- Dynamic batches compile after the compatibility columns have been added.
    IF NOT EXISTS (SELECT 1 FROM sys.extended_properties
        WHERE class = 1 AND major_id = OBJECT_ID(N'dbo.AISettings') AND minor_id = 0
          AND name = N'VS_AISettings_CompatibilityMigrated')
    BEGIN
    EXEC sys.sp_executesql N'UPDATE a SET
    EmbeddingModel = COALESCE(a.EmbeddingModel, old.embedding_model, N''''),
    EnableThinking = COALESCE(a.EnableThinking, old.enable_thinking, 0),
    FallbackProvider = COALESCE(a.FallbackProvider, old.fallback_provider),
    FallbackModel = COALESCE(a.FallbackModel, old.fallback_model),
    ReasoningEffort = COALESCE(a.ReasoningEffort, old.reasoning_effort, N''none''),
    Temperature = COALESCE(a.Temperature, old.temperature, 0.2),
    MaxTokens = COALESCE(a.MaxTokens, old.max_output_tokens, 1200),
    ConfidenceThreshold = COALESCE(a.ConfidenceThreshold, old.confidence_threshold, 0.55),
    HandoffThreshold = COALESCE(a.HandoffThreshold, old.handoff_threshold, 0.4),
    RetrievalTopK = COALESCE(a.RetrievalTopK, old.retrieval_top_k, 6),
    MaxToolCalls = COALESCE(a.MaxToolCalls, old.max_tool_calls, 8),
    UpdatedBy = COALESCE(a.UpdatedBy, old.updated_by)
FROM dbo.AISettings a
OUTER APPLY (
    SELECT TOP (1) legacy.embedding_model, legacy.enable_thinking,
        legacy.fallback_provider, legacy.fallback_model, legacy.reasoning_effort,
        legacy.temperature, legacy.max_output_tokens, legacy.confidence_threshold,
        legacy.handoff_threshold, legacy.retrieval_top_k, legacy.max_tool_calls,
        legacy.updated_by
    FROM dbo.ai_settings legacy
    WHERE LOWER(LTRIM(RTRIM(legacy.provider))) = LOWER(LTRIM(RTRIM(a.ProviderCode)))
    ORDER BY CASE WHEN legacy.model_name = a.Model THEN 0 ELSE 1 END,
             legacy.ai_enabled DESC, legacy.updated_at DESC, legacy.id
) old
;
';
    EXEC sys.sp_addextendedproperty @name = N'VS_AISettings_CompatibilityMigrated', @value = N'2026-09-28',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'AISettings';
    END;

    EXEC sys.sp_executesql N'-- Required by existing callers casting these values to non-null numeric types.
UPDATE dbo.AISettings SET Temperature = 0.2 WHERE Temperature IS NULL;
UPDATE dbo.AISettings SET MaxTokens = 1200 WHERE MaxTokens IS NULL;

-- The application sends a Bearer header; ApiKey must contain the raw key.
IF EXISTS (SELECT 1 FROM dbo.AISettings
    WHERE LOWER(LTRIM(RTRIM(ProviderCode))) = N''ollama'' AND IsEnabled = 1
      AND (NULLIF(LTRIM(RTRIM(ApiKey)), N'''') IS NULL OR LTRIM(ApiKey) LIKE N''Bearer %''))
    THROW 51000, ''Enabled Ollama requires the raw API key in AISettings.ApiKey, without the Bearer prefix.'', 1;
UPDATE dbo.AISettings SET AuthHeaderName = N''Authorization'', AuthHeaderPrefix = N''Bearer''
WHERE LOWER(LTRIM(RTRIM(ProviderCode))) = N''ollama''
  AND (ISNULL(AuthHeaderName, N'''') <> N''Authorization'' OR ISNULL(AuthHeaderPrefix, N'''') <> N''Bearer'');

IF EXISTS (SELECT 1 FROM dbo.AISettings WHERE IsEnabled = 1 AND
    (NULLIF(LTRIM(RTRIM(BaseUrl)), N'''') IS NULL OR NULLIF(LTRIM(RTRIM(Model)), N'''') IS NULL))
    THROW 51000, ''Enabled AISettings requires BaseUrl and Model.'', 1;
IF EXISTS (SELECT 1 FROM dbo.AISettings WHERE ChatPath LIKE N''%://%'')
    THROW 51000, ''ChatPath must be a relative path; configure the service URL in BaseUrl.'', 1;';

    -- Defaults apply to future rows; existing migrated values are not overwritten.
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'EmbeddingModel')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_EmbeddingModel DEFAULT (N'''') FOR [EmbeddingModel];';
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'EnableThinking')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_EnableThinking DEFAULT (0) FOR [EnableThinking];';
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'ReasoningEffort')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_ReasoningEffort DEFAULT (N''none'') FOR [ReasoningEffort];';
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'ConfidenceThreshold')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_ConfidenceThreshold DEFAULT (0.55) FOR [ConfidenceThreshold];';
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'HandoffThreshold')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_HandoffThreshold DEFAULT (0.4) FOR [HandoffThreshold];';
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'RetrievalTopK')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_RetrievalTopK DEFAULT (6) FOR [RetrievalTopK];';
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = N'MaxToolCalls')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.AISettings ADD CONSTRAINT DF_AISettings_VS_MaxToolCalls DEFAULT (8) FOR [MaxToolCalls];';


    -- Compatibility result names keep the already-deployed API and agent working.
    EXEC sys.sp_executesql N'CREATE OR ALTER VIEW dbo.vw_AISettings_Compatibility
AS
SELECT
    a.AiSettingId AS id,
    LOWER(LTRIM(RTRIM(a.ProviderCode))) AS provider,
    a.Model AS model_name,
    COALESCE(a.EmbeddingModel, N'''') AS embedding_model,
    a.ApiKey AS api_key,
    CASE WHEN p.ChatPath = N'''' OR RIGHT(p.BaseUrl, LEN(p.ChatPath) + 1) = N''/'' + p.ChatPath
         THEN p.BaseUrl ELSE p.BaseUrl + N''/'' + p.ChatPath END AS api_url,
    a.FallbackProvider AS fallback_provider,
    a.FallbackModel AS fallback_model,
    COALESCE(a.ReasoningEffort, N''none'') AS reasoning_effort,
    CAST(COALESCE(a.Temperature, 0.2) AS decimal(18,6)) AS temperature,
    COALESCE(a.MaxTokens, 1200) AS max_output_tokens,
    COALESCE(a.ConfidenceThreshold, 0.55) AS confidence_threshold,
    COALESCE(a.HandoffThreshold, 0.4) AS handoff_threshold,
    COALESCE(a.RetrievalTopK, 6) AS retrieval_top_k,
    COALESCE(a.MaxToolCalls, 8) AS max_tool_calls,
    CONVERT(int, CONVERT(bigint, a.TimeoutSeconds) * 1000) AS request_timeout_ms,
    a.IsEnabled AS ai_enabled,
    a.UpdatedBy AS updated_by,
    TODATETIMEOFFSET(a.CreatedAt, ''+00:00'') AS created_at,
    TODATETIMEOFFSET(a.UpdatedAt, ''+00:00'') AS updated_at,
    a.IsEnabled AS is_enabled,
    CAST(COALESCE(a.EnableThinking, 0) AS bit) AS enable_thinking
FROM dbo.AISettings a
CROSS APPLY (SELECT TRIM(N''/'' FROM LTRIM(RTRIM(a.BaseUrl))) AS BaseUrl,
                   TRIM(N''/'' FROM LTRIM(RTRIM(COALESCE(a.ChatPath, N'''')))) AS ChatPath) p;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) provider, model_name, api_key, api_url, temperature,
        max_output_tokens, enable_thinking, ai_enabled
    FROM dbo.vw_AISettings_Compatibility
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC, id;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_Assist_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) provider, model_name, api_key, api_url, temperature,
        max_output_tokens, enable_thinking, ai_enabled
    FROM dbo.vw_AISettings_Compatibility
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC, id;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_GetEmbeddingSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) LOWER(LTRIM(RTRIM(ProviderCode))) AS Provider,
        COALESCE(EmbeddingModel, N'''') AS Model, BaseUrl AS ApiUrl, ApiKey AS ApiKey
    FROM dbo.AISettings
    WHERE IsEnabled = 1
    ORDER BY UpdatedAt DESC, AiSettingId;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_Voice_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) api_key, api_url, model_name
    FROM dbo.vw_AISettings_Compatibility
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC, id;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_GetSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) * FROM dbo.vw_AISettings_Compatibility
    ORDER BY ai_enabled DESC, updated_at DESC, id;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_GetSettingsId
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) id FROM dbo.vw_AISettings_Compatibility
    ORDER BY ai_enabled DESC, updated_at DESC, id;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_UpdateSettings
    @Provider nvarchar(100), @ModelName nvarchar(200),
    @fallbackProvider nvarchar(100) = NULL, @fallbackModel nvarchar(200) = NULL,
    @effort nvarchar(50), @Temperature float, @MaxOutputTokens int,
    @ConfidenceThreshold float, @HandoffThreshold float,
    @RetrievalTopK int, @MaxToolCalls int, @AiEnabled bit,
    @actor uniqueidentifier, @existingId int
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AISettings SET
        ProviderCode = @Provider, Model = @ModelName,
        FallbackProvider = @fallbackProvider, FallbackModel = @fallbackModel,
        ReasoningEffort = @effort, Temperature = @Temperature, MaxTokens = @MaxOutputTokens,
        ConfidenceThreshold = @ConfidenceThreshold, HandoffThreshold = @HandoffThreshold,
        RetrievalTopK = @RetrievalTopK, MaxToolCalls = @MaxToolCalls, IsEnabled = @AiEnabled,
        UpdatedBy = @actor, UpdatedAt = SYSUTCDATETIME()
    WHERE AiSettingId = @existingId;
END;';
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertSettingsAudit
    @actor uniqueidentifier, @existingId int, @meta nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    -- audit_logs.entity_id is a GUID shared by other entities. Do not fabricate a
    -- GUID for an integer settings ID; preserve the actual ID in audit metadata.
    VALUES(@actor, N''ai.settings_updated'', N''AISettings'', NULL,
        JSON_MODIFY(COALESCE(NULLIF(@meta, N''''), N''{}''), ''$.aiSettingId'', @existingId));
END;';

    -- Existing server-side agent callers use the generic data API.
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_Data_Select
  @schemaName sysname, @tableName sysname, @columns nvarchar(max) = N''["*"]'',
  @filters nvarchar(max) = N''[]'', @scope nvarchar(max) = N''{"Mode":"none"}'', @userId uniqueidentifier = NULL,
  @order nvarchar(max) = N''[]'', @limit int = NULL, @offset int = NULL, @countOnly bit = 0
AS
BEGIN
  SET NOCOUNT ON;
  -- Use the current AI result schema, including for legacy SELECT * requests.
  IF @schemaName = N''dbo'' AND @tableName = N''ai_settings''
  BEGIN
    SET @tableName = N''vw_AISettings_Compatibility'';
    -- Older API schema caches may still include retired fields in SELECT *.
    SELECT @columns = N''['' + COALESCE(STUFF((
        SELECT N'','' + N''"'' + STRING_ESCAPE([value], ''json'') + N''"''
        FROM OPENJSON(@columns) WHERE [value] NOT IN (N''is_singleton'', N''daily_cost_limit_usd'', N''agent_flags'')
        ORDER BY CONVERT(int, [key])
        FOR XML PATH(N''''), TYPE).value(N''.'', N''nvarchar(max)''), 1, 1, N''''), N'''') + N'']'';
  END;
  DECLARE @select nvarchar(max), @where nvarchar(max), @sort nvarchar(max), @sql nvarchar(max),
          @target nvarchar(520) = QUOTENAME(@schemaName) + N''.'' + QUOTENAME(@tableName);
  EXEC dbo.usp_Data_Columns @schemaName, @tableName, @columns, @select OUTPUT;
  EXEC dbo.usp_Data_BuildWhere @schemaName, @tableName, @filters, @scope, @where OUTPUT;
  IF @countOnly = 1
    SET @sql = N''SELECT COUNT(1) FROM '' + @target + @where;
  ELSE
  BEGIN
    SELECT @sort = STRING_AGG(CONVERT(nvarchar(max), QUOTENAME(JSON_VALUE(j.[value], ''$.Column''))
        + CASE WHEN JSON_VALUE(j.[value], ''$.Descending'') = N''true'' THEN N'' DESC'' ELSE N'' ASC'' END), N'', '')
      WITHIN GROUP (ORDER BY CONVERT(int, j.[key]))
      FROM OPENJSON(@order) j
      WHERE EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = OBJECT_ID(@target) AND c.name = JSON_VALUE(j.[value], ''$.Column''));
    SET @sql = N''SELECT '' + CASE WHEN COALESCE(@offset, 0) <= 0 AND @limit > 0 THEN N''TOP (@pLimit) '' ELSE N'''' END
      + @select + N'' FROM '' + @target + @where + COALESCE(N'' ORDER BY '' + @sort, N'''');
    IF @offset > 0
    BEGIN
      SET @limit = COALESCE(@limit, 1000);
      SET @sql += N'' OFFSET @pOffset ROWS FETCH NEXT @pLimit ROWS ONLY'';
    END;
  END;
  EXEC sys.sp_executesql @sql, N''@rlsUser uniqueidentifier, @pLimit int, @pOffset int'', @userId, @limit, @offset;
END;';

    -- Remove retired fields if an earlier version of this script was applied.
    -- Views/procedures above no longer depend on these columns.
    DECLARE @retiredColumns TABLE (name sysname PRIMARY KEY);
    INSERT @retiredColumns VALUES (N'IsSingleton'), (N'DailyCostLimitUsd'), (N'AgentFlags');
    DECLARE @retiredColumn sysname, @retiredDefault sysname, @dropRetired nvarchar(max);
    WHILE EXISTS (SELECT 1 FROM @retiredColumns)
    BEGIN
        SELECT TOP (1) @retiredColumn = name FROM @retiredColumns ORDER BY name;
        IF COL_LENGTH(N'dbo.AISettings', @retiredColumn) IS NOT NULL
        BEGIN
            SET @retiredDefault = NULL;
            SELECT @retiredDefault = d.name
            FROM sys.default_constraints d
            JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
            WHERE d.parent_object_id = OBJECT_ID(N'dbo.AISettings') AND c.name = @retiredColumn;
            IF @retiredDefault IS NOT NULL
            BEGIN
                SET @dropRetired = N'ALTER TABLE dbo.AISettings DROP CONSTRAINT ' + QUOTENAME(@retiredDefault);
                EXEC sys.sp_executesql @dropRetired;
            END;
            SET @dropRetired = N'ALTER TABLE dbo.AISettings DROP COLUMN ' + QUOTENAME(@retiredColumn);
            EXEC sys.sp_executesql @dropRetired;
        END;
        DELETE FROM @retiredColumns WHERE name = @retiredColumn;
    END;

    COMMIT TRANSACTION;
    PRINT N'AI procedures now read AISettings. No legacy URLs or API keys were copied.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
