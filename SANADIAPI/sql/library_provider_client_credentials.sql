-- Catalogue connector credentials used by Ask the Librarian.
-- Safe to re-run: adds the columns only when they are missing.
IF COL_LENGTH(N'dbo.library_provider_settings', N'library_client_id') IS NULL
  ALTER TABLE [dbo].[library_provider_settings] ADD [library_client_id] nvarchar(450) NULL;
IF COL_LENGTH(N'dbo.library_provider_settings', N'library_client_secret') IS NULL
  ALTER TABLE [dbo].[library_provider_settings] ADD [library_client_secret] nvarchar(450) NULL;
GO
