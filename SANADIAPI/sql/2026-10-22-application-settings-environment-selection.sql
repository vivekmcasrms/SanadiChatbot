USE [SanadiChatbotProd];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Keep one otherwise-identical SSO settings row for each runtime environment.
  The application selects the row through @IsProductionEntry; this avoids
  changing the existing SSO values while preventing local settings from being
  selected by the production API (or vice versa).
*/
IF COL_LENGTH(N'dbo.ApplicationSettings', N'IsProductionEntry') IS NULL
BEGIN
  ALTER TABLE [dbo].[ApplicationSettings]
    ADD [IsProductionEntry] bit NOT NULL
      CONSTRAINT [DF_ApplicationSettings_IsProductionEntry] DEFAULT (1) WITH VALUES;
END;
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_GetSettings]
  @IsProductionEntry bit = 1
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1)
    [SsoIsEnabled], [SsoClientId], [SsoClientSecret],
    [SsoAuthorizationEndpoint], [SsoTokenEndpoint], [SsoUserInfoEndpoint],
    [SsoIntrospectEndpoint], [SsoRedirectUri], [SsoScope], [SsoUiOrigin],
    [HeaderDomain]
  FROM [dbo].[ApplicationSettings]
  WHERE [IsActive] = 1
    AND [IsProductionEntry] = COALESCE(@IsProductionEntry, 1)
  ORDER BY [UpdatedAtUtc] DESC, [Id] DESC;
END;
GO

/*
  Idempotently clone the current active settings row into the missing
  environment entry. Column discovery keeps this migration compatible with
  the existing ApplicationSettings schema without rewriting setting values.
*/
IF EXISTS (SELECT 1 FROM [dbo].[ApplicationSettings] WHERE [IsActive] = 1)
BEGIN
  DECLARE @columns nvarchar(max);
  SELECT @columns = STRING_AGG(QUOTENAME(c.[name]), N', ')
  FROM sys.columns c
  WHERE c.[object_id] = OBJECT_ID(N'dbo.ApplicationSettings')
    AND c.[name] NOT IN (N'Id', N'IsProductionEntry')
    AND c.is_identity = 0
    AND c.is_computed = 0
    AND c.system_type_id <> 189;

  DECLARE @sql nvarchar(max) = N'';
  IF NOT EXISTS (SELECT 1 FROM dbo.ApplicationSettings WHERE IsProductionEntry = 1)
    SET @sql += N'INSERT dbo.ApplicationSettings (' + @columns + N', [IsProductionEntry]) SELECT ' + @columns + N', 1 FROM dbo.ApplicationSettings WHERE [Id] = (SELECT TOP (1) [Id] FROM dbo.ApplicationSettings WHERE [IsActive] = 1 ORDER BY [UpdatedAtUtc] DESC, [Id] DESC);';
  IF NOT EXISTS (SELECT 1 FROM dbo.ApplicationSettings WHERE IsProductionEntry = 0)
    SET @sql += N'INSERT dbo.ApplicationSettings (' + @columns + N', [IsProductionEntry]) SELECT ' + @columns + N', 0 FROM dbo.ApplicationSettings WHERE [Id] = (SELECT TOP (1) [Id] FROM dbo.ApplicationSettings WHERE [IsActive] = 1 ORDER BY [UpdatedAtUtc] DESC, [Id] DESC);';

  IF @sql <> N'' EXEC sys.sp_executesql @sql;
END;
GO
