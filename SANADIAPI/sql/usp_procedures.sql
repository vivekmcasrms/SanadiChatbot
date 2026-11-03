SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_ExecuteQuery
  @Sql nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  IF @Sql IS NULL OR LTRIM(RTRIM(@Sql)) = N'' RETURN;
  EXEC sys.sp_executesql @Sql;
END
GO

/* ===================== Auth ===================== */

CREATE OR ALTER PROCEDURE dbo.usp_AuthGetUserByEmail
  @email nvarchar(256)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [id] AS Id, [email] AS Email, [encrypted_password] AS Password
  FROM [auth].[users]
  WHERE LOWER([email]) = @email;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertUser
  @id uniqueidentifier,
  @email nvarchar(256),
  @hash nvarchar(512)
AS
BEGIN
  INSERT INTO [auth].[users] ([id], [email], [encrypted_password])
  VALUES (@id, @email, @hash);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertProfile
  @id uniqueidentifier,
  @name nvarchar(450),
  @email nvarchar(256),
  @lang nvarchar(20)
AS
BEGIN
  INSERT INTO [dbo].[profiles] ([id], [full_name], [email], [preferred_language])
  VALUES (@id, @name, @email, @lang);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertStudentRole
  @id uniqueidentifier
AS
BEGIN
  INSERT INTO [dbo].[user_roles] ([user_id], [role]) VALUES (@id, 'student');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthGetRefreshToken
  @hash nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [user_id] AS UserId, [expires_at] AS ExpiresAt, [revoked_at] AS RevokedAt
  FROM [auth].[refresh_tokens]
  WHERE [token_hash] = @hash;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthRevokeRefreshToken
  @hash nvarchar(128)
AS
BEGIN
  UPDATE [auth].[refresh_tokens] SET [revoked_at] = SYSDATETIMEOFFSET() WHERE [token_hash] = @hash;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthGetEmailById
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [email] FROM [auth].[users] WHERE [id] = @id;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertRefreshToken
  @userId uniqueidentifier,
  @hash nvarchar(128),
  @days int
AS
BEGIN
  IF OBJECT_ID(N'auth.refresh_tokens', N'U') IS NOT NULL
  INSERT INTO [auth].[refresh_tokens] ([user_id], [token_hash], [expires_at])
  VALUES (@userId, @hash, DATEADD(day, @days, SYSDATETIMEOFFSET()));
END
GO

/* ===================== Permissions ===================== */

CREATE OR ALTER PROCEDURE dbo.usp_GetUserRoles
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [role] FROM [dbo].[user_roles] WHERE [user_id] = @userId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_HasRole
  @userId uniqueidentifier,
  @role nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles] WHERE [user_id] = @userId AND [role] = @role
  ) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_IsStaff
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles]
    WHERE [user_id] = @userId AND [role] IN (
      'service_officer','service_owner','service_manager','knowledge_manager',
      'system_admin','auditor','leadership_viewer','integration_admin','knowledge_approver')
  ) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_IsManager
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles]
    WHERE [user_id] = @userId AND [role] IN ('service_manager','system_admin')
  ) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_IsAccessRevoked
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[profiles] WHERE [id] = @userId AND [access_revoked_at] IS NOT NULL) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CanSeeAllCases
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles]
    WHERE [user_id] = @userId AND [role] IN ('service_manager','system_admin','auditor','leadership_viewer')
  ) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_OwnsServiceUnit
  @userId uniqueidentifier,
  @unitId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[staff_profiles] WHERE [user_id] = @userId AND [service_unit_id] = @unitId
    UNION ALL
    SELECT 1 FROM [dbo].[service_unit_owners] WHERE [staff_profile_id] = @userId AND [service_unit_id] = @unitId AND [is_active] = 1
    UNION ALL
    SELECT 1 FROM [dbo].[service_units] WHERE [id] = @unitId AND [primary_service_owner_id] = @userId
    UNION ALL
    SELECT 1 FROM [dbo].[service_staff] WHERE [staff_profile_id] = @userId AND [service_unit_id] = @unitId
  ) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_GetCaseAccessRow
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [student_id] AS StudentId, [assigned_to] AS AssignedTo, [service_unit_id] AS UnitId
  FROM [dbo].[cases] WHERE [id] = @caseId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CaseExists
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[cases] WHERE [id] = @caseId) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CanMonitorAllUnits
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[case_monitor_grants]
    WHERE [user_id] = @userId AND [is_active] = 1 AND [scope] = 'all_units'
  ) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_HasMonitorGrant
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[case_monitor_grants] WHERE [user_id] = @userId AND [is_active] = 1) THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_StaffUnit
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 CONVERT(nvarchar(36), [service_unit_id]) FROM [dbo].[staff_profiles] WHERE [user_id] = @userId;
END
GO

/* ===================== Catalog / Storage ===================== */

CREATE OR ALTER PROCEDURE dbo.usp_CatalogColumns
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TABLE_SCHEMA AS [Schema], TABLE_NAME AS [Table], COLUMN_NAME AS [Column], DATA_TYPE AS DataType
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA IN ('dbo','auth','storage');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CatalogPrimaryKeys
AS
BEGIN
  SET NOCOUNT ON;
  SELECT ku.TABLE_SCHEMA AS [Schema], ku.TABLE_NAME AS [Table], ku.COLUMN_NAME AS [Column], ku.ORDINAL_POSITION AS Ordinal
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA IN ('dbo','auth','storage');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CatalogForeignKeys
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
      OBJECT_SCHEMA_NAME(fk.parent_object_id) AS [Schema],
      OBJECT_NAME(fk.parent_object_id) AS [Table],
      COL_NAME(fc.parent_object_id, fc.parent_column_id) AS [Column],
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS RefSchema,
      OBJECT_NAME(fk.referenced_object_id) AS RefTable,
      COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS RefColumn
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_StorageUpsertObject
  @bucket nvarchar(256),
  @path nvarchar(1024),
  @ownerId uniqueidentifier,
  @meta nvarchar(max)
AS
BEGIN
  IF NOT EXISTS (SELECT 1 FROM [storage].[objects] WHERE [bucket_id] = @bucket AND [name] = @path)
    INSERT INTO [storage].[objects] ([bucket_id], [name], [owner], [metadata])
    VALUES (@bucket, @path, @ownerId, @meta);
  ELSE
    UPDATE [storage].[objects] SET [updated_at] = SYSDATETIMEOFFSET(), [owner] = @ownerId
    WHERE [bucket_id] = @bucket AND [name] = @path;
END
GO
