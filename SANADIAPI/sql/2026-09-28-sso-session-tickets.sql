USE [SanadiChatbotProd];
GO
-- Session tickets reuse the encrypted, atomic single-use SSO state store.
-- Tokens plus user metadata may exceed the previous 4,000-character limit.
ALTER TABLE [auth].[sso_states] ALTER COLUMN [protected_context] nvarchar(max) NOT NULL;
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
