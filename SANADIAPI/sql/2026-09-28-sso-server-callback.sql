USE [SanadiChatbotProd];
GO

-- Run against the database used by sanadiapit.uaeu.ac.ae.
-- The identity provider must allow this exact HTTPS callback for SanadiChatbot.
-- Change only the effective server SSO callback; local launch port stays 5281.
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

;WITH EffectiveSettings AS (
  SELECT TOP (1) [SsoRedirectUri]
  FROM [dbo].[ApplicationSettings] WITH (UPDLOCK, HOLDLOCK)
  WHERE [IsActive] = 1
  ORDER BY [UpdatedAtUtc] DESC, [Id] DESC
)
UPDATE EffectiveSettings
SET [SsoRedirectUri] = N'https://sanadiapit.uaeu.ac.ae/api/v1/auth/sso/callback'
WHERE [SsoRedirectUri] = N'http://localhost:5281/api/v1/auth/sso/callback';

IF NOT EXISTS (
  SELECT 1
  FROM (
    SELECT TOP (1) [SsoRedirectUri]
    FROM [dbo].[ApplicationSettings]
    WHERE [IsActive] = 1
    ORDER BY [UpdatedAtUtc] DESC, [Id] DESC
  ) AS EffectiveSettings
  WHERE [SsoRedirectUri] = N'https://sanadiapit.uaeu.ac.ae/api/v1/auth/sso/callback'
)
BEGIN
  ROLLBACK TRANSACTION;
  THROW 50001, 'The effective callback differs from the expected localhost URL. No settings were changed; inspect SsoRedirectUri.', 1;
END;

COMMIT TRANSACTION;

SELECT TOP (1) [SsoRedirectUri], [SsoUiOrigin]
FROM [dbo].[ApplicationSettings]
WHERE [IsActive] = 1
ORDER BY [UpdatedAtUtc] DESC, [Id] DESC;
GO
