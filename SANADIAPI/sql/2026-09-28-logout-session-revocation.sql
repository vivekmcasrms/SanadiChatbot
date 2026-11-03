-- Apply before deploying the logout fix. No user/application records are removed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'auth.login_sessions', N'U') IS NULL
CREATE TABLE auth.login_sessions (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  user_id uniqueidentifier NOT NULL,
  revoked_at datetimeoffset(7) NULL
);
IF OBJECT_ID(N'auth.logged_out_access_tokens', N'U') IS NULL
CREATE TABLE auth.logged_out_access_tokens (
  token_hash nvarchar(64) NOT NULL PRIMARY KEY,
  expires_at datetimeoffset(7) NOT NULL
);
IF COL_LENGTH(N'auth.refresh_tokens', N'session_id') IS NULL
  ALTER TABLE auth.refresh_tokens ADD session_id uniqueidentifier NULL;
GO
CREATE OR ALTER PROCEDURE dbo.usp_AuthGetSessionRefreshToken @hash nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT user_id AS UserId, expires_at AS ExpiresAt, revoked_at AS RevokedAt, session_id AS SessionId
  FROM auth.refresh_tokens WHERE token_hash = @hash;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_AuthCreateSessionTokens
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
      THROW 51001, 'Session has expired.', 1;
    IF @previousHash IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WITH (UPDLOCK, HOLDLOCK)
        WHERE token_hash=@previousHash AND user_id=@userId AND revoked_at IS NULL AND expires_at>SYSDATETIMEOFFSET()
          AND (session_id IS NULL OR session_id=@sessionId))
        THROW 51001, 'Session has expired.', 1;
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
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_AuthEndSession
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
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_AuthIsSessionActive
  @accessHash nvarchar(64), @sessionId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CONVERT(bit, CASE
    WHEN EXISTS (SELECT 1 FROM auth.logged_out_access_tokens WHERE token_hash=@accessHash) THEN 0
    WHEN @sessionId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.login_sessions WHERE id=@sessionId AND revoked_at IS NULL) THEN 0
    ELSE 1 END);
END;
GO
