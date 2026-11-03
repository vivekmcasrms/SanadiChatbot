/*
  SSO login tables and stored procedures.

  Select the intended application database in SSMS before running this file.
  This script creates missing tables; every existing table is skipped entirely.
  It does not change existing table columns, rows, permissions, or URLs.
  The 10 SSO login/session procedures below use CREATE OR ALTER.
  Procedure definitions are applied together in a transaction; incompatible
  existing columns stop that step without altering existing tables.

  New tables are empty. Real SSO configuration and registered users/profiles/
  roles must already exist or be provisioned through your normal process.
  dbo.ApplicationSettings below contains the SSO columns only: the repository
  does not contain an authoritative definition of the full settings table.
  An existing ApplicationSettings table is never replaced or altered.

  Source definitions: sanadi_schema.sql (auth.users, profiles, user_roles),
  auth_bootstrap.sql, 2026-09-23-sso-authentication.sql,
  2026-09-28-logout-session-revocation.sql, and current SSO settings contract.
  Procedure bodies match 2026-10-28-SanadiChatbotProd-procs-views-triggers-indexes.sql;
  usp_GetUserRoles comes from usp_procedures.sql (the consolidated file skips it).
  No email-token, notification, or other business-feature objects are included.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
    THROW 51000, 'Select the intended Sanadi application database before running this script.', 1;
IF @@TRANCOUNT <> 0
    THROW 51000, 'Run this script outside an existing transaction.', 1;

DECLARE @TableActions TABLE (TableName nvarchar(256) NOT NULL, ActionTaken nvarchar(32) NOT NULL);

BEGIN TRY
    BEGIN TRANSACTION;

    IF SCHEMA_ID(N'auth') IS NULL
        EXEC(N'CREATE SCHEMA [auth] AUTHORIZATION [dbo];');

    IF OBJECT_ID(N'dbo.ApplicationSettings', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [dbo].[ApplicationSettings] (
            [Id] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
            [IsActive] bit NOT NULL DEFAULT (0),
            [UpdatedAtUtc] datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
            [IsProductionEntry] bit NOT NULL DEFAULT (1),
            [SsoIsEnabled] bit NOT NULL DEFAULT (0),
            [SsoClientId] nvarchar(512) NULL,
            [SsoClientSecret] nvarchar(max) NULL,
            [SsoAuthorizationEndpoint] nvarchar(2048) NULL,
            [SsoTokenEndpoint] nvarchar(2048) NULL,
            [SsoUserInfoEndpoint] nvarchar(2048) NULL,
            [SsoIntrospectEndpoint] nvarchar(2048) NULL,
            [SsoRedirectUri] nvarchar(2048) NULL,
            [SsoScope] nvarchar(1024) NULL,
            [SsoUiOrigin] nvarchar(2048) NULL,
            [HeaderDomain] nvarchar(255) NULL
        );');
        INSERT INTO @TableActions VALUES (N'dbo.ApplicationSettings', N'CREATED (SSO columns only)');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'dbo.ApplicationSettings', N'SKIPPED - already exists');

    IF OBJECT_ID(N'auth.users', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [auth].[users] (
            [id] uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
            [email] nvarchar(320) NULL UNIQUE,
            [encrypted_password] nvarchar(4000) NULL,
            [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
            [updated_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
        );');
        INSERT INTO @TableActions VALUES (N'auth.users', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'auth.users', N'SKIPPED - already exists');

    IF OBJECT_ID(N'dbo.profiles', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [dbo].[profiles] (
            [id] uniqueidentifier NOT NULL PRIMARY KEY,
            [full_name] nvarchar(450) NULL,
            [email] nvarchar(450) NULL,
            [phone] nvarchar(450) NULL,
            [preferred_language] nvarchar(64) NOT NULL DEFAULT N''en'',
            [avatar_url] nvarchar(450) NULL,
            [deleted_at] datetimeoffset NULL,
            [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
            [updated_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
            [is_demo_account] bit NOT NULL DEFAULT (0),
            [access_revoked_at] datetimeoffset NULL,
            [access_revoked_by] uniqueidentifier NULL,
            [access_revoked_reason] nvarchar(450) NULL,
            FOREIGN KEY ([id]) REFERENCES [auth].[users] ([id]) ON DELETE NO ACTION
        );');
        INSERT INTO @TableActions VALUES (N'dbo.profiles', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'dbo.profiles', N'SKIPPED - already exists');

    IF OBJECT_ID(N'dbo.user_roles', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [dbo].[user_roles] (
            [id] uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
            [user_id] uniqueidentifier NOT NULL,
            [role] nvarchar(64) NOT NULL,
            [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
            UNIQUE ([user_id], [role]),
            FOREIGN KEY ([user_id]) REFERENCES [auth].[users] ([id]) ON DELETE NO ACTION
        );');
        INSERT INTO @TableActions VALUES (N'dbo.user_roles', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'dbo.user_roles', N'SKIPPED - already exists');

    IF OBJECT_ID(N'auth.sso_states', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [auth].[sso_states] (
            [state_hash] nvarchar(64) NOT NULL PRIMARY KEY,
            [protected_context] nvarchar(max) NOT NULL,
            [expires_at] datetimeoffset NOT NULL,
            [consumed_at] datetimeoffset NULL,
            [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
        );
        CREATE INDEX [IX_sso_states_expires_at] ON [auth].[sso_states] ([expires_at]);');
        INSERT INTO @TableActions VALUES (N'auth.sso_states', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'auth.sso_states', N'SKIPPED - already exists');

    IF OBJECT_ID(N'auth.login_sessions', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [auth].[login_sessions] (
            [id] uniqueidentifier NOT NULL PRIMARY KEY,
            [user_id] uniqueidentifier NOT NULL,
            [revoked_at] datetimeoffset(7) NULL
        );');
        INSERT INTO @TableActions VALUES (N'auth.login_sessions', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'auth.login_sessions', N'SKIPPED - already exists');

    IF OBJECT_ID(N'auth.refresh_tokens', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [auth].[refresh_tokens] (
            [id] uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
            [user_id] uniqueidentifier NOT NULL,
            [token_hash] nvarchar(128) NOT NULL UNIQUE,
            [expires_at] datetimeoffset NOT NULL,
            [revoked_at] datetimeoffset NULL,
            [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
            [session_id] uniqueidentifier NULL
        );
        CREATE INDEX [ix_refresh_tokens_user] ON [auth].[refresh_tokens] ([user_id]);');
        INSERT INTO @TableActions VALUES (N'auth.refresh_tokens', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'auth.refresh_tokens', N'SKIPPED - already exists');

    -- Access-token validation checks this table after SSO has issued a token.
    IF OBJECT_ID(N'auth.logged_out_access_tokens', N'U') IS NULL
    BEGIN
        EXEC(N'CREATE TABLE [auth].[logged_out_access_tokens] (
            [token_hash] nvarchar(64) NOT NULL PRIMARY KEY,
            [expires_at] datetimeoffset(7) NOT NULL
        );');
        INSERT INTO @TableActions VALUES (N'auth.logged_out_access_tokens', N'CREATED');
    END
    ELSE
        INSERT INTO @TableActions VALUES (N'auth.logged_out_access_tokens', N'SKIPPED - already exists');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

SELECT DB_NAME() AS DatabaseName, TableName, ActionTaken
FROM @TableActions ORDER BY TableName;

-- Read-only compatibility report. Missing columns are reported, never added.
DECLARE @MissingColumns TABLE (TableName nvarchar(256), ColumnName sysname);
;WITH RequiredColumns AS (
    SELECT TableName, ColumnName FROM (VALUES
        (N'dbo.ApplicationSettings', N'Id'),
        (N'dbo.ApplicationSettings', N'IsActive'),
        (N'dbo.ApplicationSettings', N'UpdatedAtUtc'),
        (N'dbo.ApplicationSettings', N'IsProductionEntry'),
        (N'dbo.ApplicationSettings', N'SsoIsEnabled'),
        (N'dbo.ApplicationSettings', N'SsoClientId'),
        (N'dbo.ApplicationSettings', N'SsoClientSecret'),
        (N'dbo.ApplicationSettings', N'SsoAuthorizationEndpoint'),
        (N'dbo.ApplicationSettings', N'SsoTokenEndpoint'),
        (N'dbo.ApplicationSettings', N'SsoUserInfoEndpoint'),
        (N'dbo.ApplicationSettings', N'SsoIntrospectEndpoint'),
        (N'dbo.ApplicationSettings', N'SsoRedirectUri'),
        (N'dbo.ApplicationSettings', N'SsoScope'),
        (N'dbo.ApplicationSettings', N'SsoUiOrigin'),
        (N'dbo.ApplicationSettings', N'HeaderDomain'),
        (N'auth.users', N'id'), (N'auth.users', N'email'),
        (N'dbo.profiles', N'id'), (N'dbo.profiles', N'full_name'),
        (N'dbo.profiles', N'deleted_at'), (N'dbo.profiles', N'access_revoked_at'),
        (N'dbo.user_roles', N'user_id'), (N'dbo.user_roles', N'role'),
        (N'auth.sso_states', N'state_hash'), (N'auth.sso_states', N'protected_context'),
        (N'auth.sso_states', N'expires_at'), (N'auth.sso_states', N'consumed_at'),
        (N'auth.login_sessions', N'id'), (N'auth.login_sessions', N'user_id'),
        (N'auth.login_sessions', N'revoked_at'),
        (N'auth.refresh_tokens', N'user_id'), (N'auth.refresh_tokens', N'token_hash'),
        (N'auth.refresh_tokens', N'expires_at'), (N'auth.refresh_tokens', N'revoked_at'),
        (N'auth.refresh_tokens', N'session_id'),
        (N'auth.logged_out_access_tokens', N'token_hash'),
        (N'auth.logged_out_access_tokens', N'expires_at')
    ) AS v(TableName, ColumnName)
)
INSERT INTO @MissingColumns (TableName, ColumnName)
SELECT TableName, ColumnName
FROM RequiredColumns WHERE COL_LENGTH(TableName, ColumnName) IS NULL;

SELECT TableName, ColumnName, N'MISSING - existing table left unchanged' AS Status
FROM @MissingColumns ORDER BY TableName, ColumnName;

SELECT N'auth.sso_states.protected_context' AS ColumnName,
       N'Expected nvarchar(max); existing definition left unchanged' AS Status
WHERE OBJECT_ID(N'auth.sso_states', N'U') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID(N'auth.sso_states', N'U')
        AND name = N'protected_context' AND system_type_id = 231 AND max_length = -1
  );

-- Existing tables stay untouched. Stop before changing any procedures if their
-- required columns are absent or session-ticket storage is too small.
IF EXISTS (SELECT 1 FROM @MissingColumns)
   OR EXISTS (
       SELECT 1 FROM sys.columns
       WHERE object_id = OBJECT_ID(N'auth.sso_states', N'U')
         AND name = N'protected_context'
         AND (system_type_id <> 231 OR max_length <> -1)
   )
    THROW 51000, 'SSO table compatibility checks failed. Review the reports above; existing tables and procedures were not altered.', 1;

-- Each dynamic statement is a separate CREATE OR ALTER batch. Keeping these
-- batches in one TRY/transaction lets a definition failure roll back all ten
-- procedure changes, without a GO separator continuing after an earlier error.
-- This installs definitions only; it does not execute the procedures.
BEGIN TRY
    BEGIN TRANSACTION;

    -- dbo.usp_Sso_GetSettings
    EXEC(N'CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_GetSettings]
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
END;');

    -- dbo.usp_Sso_CreateState
    EXEC(N'CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_CreateState]
  @stateHash nvarchar(64),
  @protectedContext nvarchar(max),
  @expiresAt datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM [auth].[sso_states]
  WHERE [expires_at] < DATEADD(hour, -1, SYSDATETIMEOFFSET());

  INSERT INTO [auth].[sso_states] ([state_hash], [protected_context], [expires_at])
  VALUES (@stateHash, @protectedContext, @expiresAt);
END;');

    -- dbo.usp_Sso_ConsumeState
    EXEC(N'CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_ConsumeState]
  @stateHash nvarchar(64),
  @now datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE [auth].[sso_states] WITH (UPDLOCK, ROWLOCK)
  SET [consumed_at] = @now
  OUTPUT CASE WHEN inserted.[expires_at] < @now THEN N''sso_expired''
              ELSE inserted.[protected_context] END
  WHERE [state_hash] = @stateHash
    AND [consumed_at] IS NULL;
END;');

    -- dbo.usp_AuthGetSsoUserByEmail_v2
    EXEC(N'CREATE OR ALTER PROCEDURE [dbo].[usp_AuthGetSsoUserByEmail_v2]
  @email nvarchar(256),
  @name nvarchar(350)
AS
BEGIN
  SET NOCOUNT ON;
 
 DECLARE @id uniqueidentifier;
  SELECT @id = [id] FROM [auth].[users] WHERE [email] = @email;
  
	  IF EXISTS (
				SELECT 1
				FROM profiles
				WHERE id = @id
				AND ISNULL(full_name, '''') = ''''
				)
		BEGIN
					UPDATE profiles
					SET full_name = @name
					WHERE id = @id;
		END

  SELECT
    u.[id] AS [Id],
    u.[email] AS [Email],
    CONVERT(bit, CASE
      WHEN p.[id] IS NOT NULL
       AND p.[deleted_at] IS NULL
       AND p.[access_revoked_at] IS NULL THEN 1
      ELSE 0
    END) AS [IsActive]
  FROM [auth].[users] u
  LEFT JOIN [dbo].[profiles] p ON p.[id] = u.[id]
  WHERE u.[id] = @id;

  SELECT [role]
  FROM [dbo].[user_roles]
  WHERE [user_id] = @id
  ORDER BY [role];
END;');

    -- dbo.usp_AuthCreateSessionTokens
    EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_AuthCreateSessionTokens
  @userId uniqueidentifier, @sessionId uniqueidentifier, @hash nvarchar(128), @days int, @previousHash nvarchar(128) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM auth.login_sessions WITH (UPDLOCK, HOLDLOCK) WHERE id = @sessionId)
      INSERT auth.login_sessions(id,user_id) VALUES (@sessionId,@userId);
    IF EXISTS (SELECT 1 FROM auth.login_sessions WHERE id=@sessionId AND (revoked_at IS NOT NULL OR user_id<>@userId))
      THROW 51001, ''Session has expired.'', 1;
    IF @previousHash IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WITH (UPDLOCK, HOLDLOCK)
        WHERE token_hash=@previousHash AND user_id=@userId AND revoked_at IS NULL AND expires_at>SYSDATETIMEOFFSET()
          AND (session_id IS NULL OR session_id=@sessionId))
        THROW 51001, ''Session has expired.'', 1;
      -- Retain the session on consumed tokens so logout also revokes a rotated replacement.
      UPDATE auth.refresh_tokens SET revoked_at=SYSDATETIMEOFFSET(),session_id=@sessionId WHERE token_hash=@previousHash;
    END;
    INSERT auth.refresh_tokens(user_id,token_hash,expires_at,session_id)
      VALUES (@userId,@hash,DATEADD(day,@days,SYSDATETIMEOFFSET()),@sessionId);
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH;
END;');

    -- dbo.usp_AuthGetSessionRefreshToken
    EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_AuthGetSessionRefreshToken @hash nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT user_id AS UserId, expires_at AS ExpiresAt, revoked_at AS RevokedAt, session_id AS SessionId
  FROM auth.refresh_tokens WHERE token_hash = @hash;
END;');

    -- dbo.usp_AuthGetEmailById
    EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_AuthGetEmailById
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [email] FROM [auth].[users] WHERE [id] = @id;
END');

    -- dbo.usp_GetUserRoles
    EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_GetUserRoles
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [role] FROM [dbo].[user_roles] WHERE [user_id] = @userId;
END');

    -- dbo.usp_AuthIsSessionActive
    EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_AuthIsSessionActive
  @accessHash nvarchar(64), @sessionId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CONVERT(bit, CASE
    WHEN EXISTS (SELECT 1 FROM auth.logged_out_access_tokens WHERE token_hash=@accessHash) THEN 0
    WHEN @sessionId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.login_sessions WHERE id=@sessionId AND revoked_at IS NULL) THEN 0
    ELSE 1 END);
END;');

    -- dbo.usp_AuthEndSession
    EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_AuthEndSession
  @hash nvarchar(128) = NULL, @sessionId uniqueidentifier = NULL,
  @accessHash nvarchar(64) = NULL, @expiresAt datetimeoffset(7) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @refreshSession uniqueidentifier;
    SELECT @refreshSession=session_id FROM auth.refresh_tokens WHERE token_hash=@hash;
    -- Serialize an upgrade of a pre-migration refresh token with logout too.
    IF @hash IS NOT NULL AND @refreshSession IS NULL
      SELECT @refreshSession=session_id FROM auth.refresh_tokens WITH (UPDLOCK,HOLDLOCK) WHERE token_hash=@hash;
    UPDATE auth.login_sessions SET revoked_at=COALESCE(revoked_at,SYSDATETIMEOFFSET())
      WHERE id IN (@sessionId,@refreshSession);
    UPDATE auth.refresh_tokens SET revoked_at=COALESCE(revoked_at,SYSDATETIMEOFFSET())
      WHERE token_hash=@hash OR session_id IN (@sessionId,@refreshSession);
    IF @accessHash IS NOT NULL AND @expiresAt IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.logged_out_access_tokens WITH (UPDLOCK,HOLDLOCK) WHERE token_hash=@accessHash)
      INSERT auth.logged_out_access_tokens(token_hash,expires_at) VALUES (@accessHash,@expiresAt);
    DELETE auth.logged_out_access_tokens WHERE expires_at<SYSDATETIMEOFFSET();
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH;
END;');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

-- Verify the SSO login/session procedure inventory after deployment.
SELECT ProcedureName,
       CASE WHEN OBJECT_ID(ProcedureName, N'P') IS NULL THEN N'MISSING' ELSE N'PRESENT' END AS Status
FROM (VALUES
    (N'dbo.usp_Sso_GetSettings'),
    (N'dbo.usp_Sso_CreateState'),
    (N'dbo.usp_Sso_ConsumeState'),
    (N'dbo.usp_AuthGetSsoUserByEmail_v2'),
    (N'dbo.usp_AuthCreateSessionTokens'),
    (N'dbo.usp_AuthGetSessionRefreshToken'),
    (N'dbo.usp_AuthGetEmailById'),
    (N'dbo.usp_GetUserRoles'),
    (N'dbo.usp_AuthIsSessionActive'),
    (N'dbo.usp_AuthEndSession')
) AS v(ProcedureName) ORDER BY ProcedureName;

PRINT N'Missing SSO login tables created; existing tables skipped. All 10 SSO login/session procedures created or altered.';
PRINT N'This script does not provision SSO settings, users, or roles.';
