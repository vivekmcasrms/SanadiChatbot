DECLARE @user uniqueidentifier=NEWID(), @session uniqueidentifier=NEWID(), @other uniqueidentifier=NEWID();
EXEC __SCHEMA__.usp_AuthCreateSessionTokens @user,@session,N'first',7;
EXEC __SCHEMA__.usp_AuthCreateSessionTokens @user,@other,N'other-device',7;
EXEC __SCHEMA__.usp_AuthCreateSessionTokens @user,@session,N'rotated',7,N'first';
IF NOT EXISTS (SELECT 1 FROM __SCHEMA__.refresh_tokens WHERE token_hash=N'first' AND revoked_at IS NOT NULL AND session_id=@session)
  THROW 51000, 'Refresh rotation lost its session.', 1;
DECLARE @active TABLE (active bit);
INSERT @active EXEC __SCHEMA__.usp_AuthIsSessionActive N'access',@session;
IF (SELECT active FROM @active)<>1 THROW 51000, 'Valid session rejected.', 1;
-- Logging out with the consumed refresh token must also revoke its replacement.
DECLARE @expires datetimeoffset=DATEADD(hour,1,SYSDATETIMEOFFSET());
EXEC __SCHEMA__.usp_AuthEndSession N'first',@session,N'legacy-access',@expires;
IF EXISTS (SELECT 1 FROM __SCHEMA__.refresh_tokens WHERE session_id=@session AND revoked_at IS NULL)
  THROW 51000, 'Logout left a rotated refresh token active.', 1;
DELETE @active;
INSERT @active EXEC __SCHEMA__.usp_AuthIsSessionActive N'access',@session;
IF (SELECT active FROM @active)<>0 THROW 51000, 'Logged-out access token accepted.', 1;
DELETE @active;
INSERT @active EXEC __SCHEMA__.usp_AuthIsSessionActive N'legacy-access',NULL;
IF (SELECT active FROM @active)<>0 THROW 51000, 'Legacy access token accepted after logout.', 1;
DELETE @active;
INSERT @active EXEC __SCHEMA__.usp_AuthIsSessionActive N'other-access',@other;
IF (SELECT active FROM @active)<>1 THROW 51000, 'Logout revoked an unrelated session.', 1;
-- Idempotent logout.
EXEC __SCHEMA__.usp_AuthEndSession N'first',@session,N'legacy-access',@expires;
BEGIN TRY
  EXEC __SCHEMA__.usp_AuthCreateSessionTokens @user,@session,N'resurrected',7,N'rotated';
  THROW 51000, 'A revoked session was refreshed.', 1;
END TRY
BEGIN CATCH
  IF ERROR_NUMBER()<>51001 THROW;
END CATCH;
-- The expected rejection rolls back the outer fixture transaction too.
PRINT 'PASS: logout revokes access and rotated refresh tokens, preserves other sessions, and rejects restoration.';
GO
