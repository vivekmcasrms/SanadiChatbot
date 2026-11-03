SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertUser
  @id uniqueidentifier,
  @email nvarchar(256),
  @hash nvarchar(512)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [auth].[users] ([id], [email], [encrypted_password])
  VALUES (@id, @email, @hash);
END
GO

IF OBJECT_ID(N'auth.users', N'U') IS NOT NULL
   AND COL_LENGTH(N'auth.users', N'raw_user_meta_data') IS NOT NULL
BEGIN
  BEGIN TRANSACTION;

  -- Keep non-name values in their existing profile columns before dropping
  -- auth metadata. Full name remains sourced from SSO/profile flows.
  IF OBJECT_ID(N'dbo.profiles', N'U') IS NOT NULL
  BEGIN
    UPDATE p
    SET preferred_language = COALESCE(NULLIF(m.preferred_language, N''), p.preferred_language),
        is_demo_account = CASE WHEN m.demo_account = N'true' THEN 1 ELSE p.is_demo_account END
    FROM dbo.profiles p
    INNER JOIN auth.users u ON u.id = p.id
    CROSS APPLY (
      SELECT
        CASE WHEN ISJSON(u.raw_user_meta_data) = 1
             THEN JSON_VALUE(u.raw_user_meta_data, '$.preferred_language') END AS preferred_language,
        CASE WHEN ISJSON(u.raw_user_meta_data) = 1
             THEN JSON_VALUE(u.raw_user_meta_data, '$.demo_account') END AS demo_account
    ) m
    WHERE m.preferred_language IS NOT NULL OR m.demo_account = N'true';
  END;

  DECLARE @defaultName sysname;
  SELECT @defaultName = dc.name
  FROM sys.default_constraints dc
  INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'auth.users')
    AND c.name = N'raw_user_meta_data';

  IF @defaultName IS NOT NULL
  BEGIN
    DECLARE @dropDefaultSql nvarchar(max) =
      N'ALTER TABLE [auth].[users] DROP CONSTRAINT ' + QUOTENAME(@defaultName);
    EXEC sys.sp_executesql @dropDefaultSql;
  END;

  ALTER TABLE [auth].[users] DROP COLUMN [raw_user_meta_data];

  COMMIT TRANSACTION;
END;
GO
