USE [SanadiChatbotProd];
GO

/*
  Shared, single-use authorization state. It contains only a SHA-256 state
  hash plus an authenticated-encrypted context. This makes callbacks safe
  across load-balanced API instances without process-local state.
*/
IF OBJECT_ID(N'auth.sso_states', N'U') IS NULL
BEGIN
  CREATE TABLE [auth].[sso_states] (
    [state_hash] nvarchar(64) NOT NULL,
    [protected_context] nvarchar(max) NOT NULL,
    [expires_at] datetimeoffset NOT NULL,
    [consumed_at] datetimeoffset NULL,
    [created_at] datetimeoffset NOT NULL CONSTRAINT [DF_sso_states_created_at] DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT [PK_sso_states] PRIMARY KEY ([state_hash])
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE [name] = N'IX_sso_states_expires_at'
    AND [object_id] = OBJECT_ID(N'auth.sso_states')
)
  CREATE INDEX [IX_sso_states_expires_at] ON [auth].[sso_states]([expires_at]);
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_GetSettings]
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
  ORDER BY [UpdatedAtUtc] DESC, [Id] DESC;
END;
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_CreateState]
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
END;
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_ConsumeState]
  @stateHash nvarchar(64),
  @now datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE [auth].[sso_states] WITH (UPDLOCK, ROWLOCK)
  SET [consumed_at] = @now
  OUTPUT CASE WHEN inserted.[expires_at] < @now THEN N'sso_expired'
              ELSE inserted.[protected_context] END
  WHERE [state_hash] = @stateHash
    AND [consumed_at] IS NULL;
END;
GO

/*
  SSO proves identity only. Registration, active status, and current roles
  remain authoritative in the existing SQL user/profile/role tables.
*/
CREATE OR ALTER PROCEDURE [dbo].[usp_AuthGetSsoUserByEmail]
  @email nvarchar(256)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @id uniqueidentifier;
  SELECT @id = [id] FROM [auth].[users] WHERE [email] = @email;

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
END;
GO

/* auth.users.email already has a unique index in the current schema. */
