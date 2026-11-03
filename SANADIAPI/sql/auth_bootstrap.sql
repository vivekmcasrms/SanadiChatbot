USE [SanadiChatbotProd];
GO

IF OBJECT_ID(N'auth.refresh_tokens', N'U') IS NULL
CREATE TABLE [auth].[refresh_tokens] (
  [id] uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  [user_id] uniqueidentifier NOT NULL,
  [token_hash] nvarchar(128) NOT NULL UNIQUE,
  [expires_at] datetimeoffset NOT NULL,
  [revoked_at] datetimeoffset NULL,
  [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_refresh_tokens_user' AND object_id = OBJECT_ID(N'auth.refresh_tokens'))
CREATE INDEX [ix_refresh_tokens_user] ON [auth].[refresh_tokens]([user_id]);
GO
