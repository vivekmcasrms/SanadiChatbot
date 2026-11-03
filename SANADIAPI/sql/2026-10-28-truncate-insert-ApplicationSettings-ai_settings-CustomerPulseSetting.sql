

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/* ========== 1) dbo.ApplicationSettings ========== */
/*
  Inserts one active PRODUCTION row (IsProductionEntry=1) and one active
  NON-PRODUCTION row (IsProductionEntry=0). Adjust URLs/secrets per environment.
  Column list matches fields used by SSO + ticket email procedures.
  If your table has extra NOT NULL columns without defaults, add them to INSERT.
*/
IF OBJECT_ID(N'dbo.ApplicationSettings', N'U') IS NULL
    THROW 51000, 'dbo.ApplicationSettings is missing.', 1;

TRUNCATE TABLE dbo.ApplicationSettings;

INSERT INTO dbo.ApplicationSettings
(
UniversityName,
AppName,
HeaderDomain,
SsoIsEnabled,
SsoClientId,
SsoClientSecret,
SsoAuthorizationEndpoint,
SsoTokenEndpoint,
SsoUserInfoEndpoint,
SsoIntrospectEndpoint,
SsoRedirectUri,
SsoScope,
SsoUiOrigin,
StudentApiUrl,
StudentApiClientId,
StudentApiClientSecret,
StudentApiUserAccount,
AuthApiUrl,
NotificationEmailApiUrl,
NotificationEmailCc,
NotificationEmailBcc,
NotificationEmailSubject,
NotificationEmailBodyEn,
NotificationEmailBodyAr,
NotificationEmailTemplate,
NotificationEmailApp,
EmailApiAppName,
IsActive,
UpdatedAtUtc,
IsProductionEntry

)
VALUES
/* Production entry — used when API SsoRouting:IsProductionEntry = true */
(
    'United Arab Emirates University',
    'Sanadi',
	'uaeu.ac.ae',
	1,
	'sanadi_prd',
'OTvtLtdyUVG9NDGqnotFurCim2gQs1qj7AlBcnclv8yxJFbPTGxOFvXKuAMpYHex',
'https://idm.uaeu.ac.ae/as/authorization.oauth2',
'https://idm.uaeu.ac.ae/as/token.oauth2',
'https://idm.uaeu.ac.ae/idp/userinfo.openid',
'https://idm.uaeu.ac.ae/as/introspect.oauth2',
'https://sanadiapi.uaeu.ac.ae/api/v1/auth/sso/callback',
'openid profile',
'https://sanadi-beta.uaeu.ac.ae',
'https://api.uaeu.ac.ae/',
'',
'Po3eY9ajPrapQm/GCMjfaZPI11kyR6K0wR6wTbafGmcUBccw3apLvZOuLfXgUukCsZjkNGRIRoSFxF6srNNyOA==',
'',
'https://api.uaeu.ac.ae/authservice/auth/v2/token',
'https://api.uaeu.ac.ae/general',
NULL,
NULL,
'Sanadi Chatbot Notification',
'',
'',
'1CE',
'sanadi-chatbot',
'sanadi-chatbot',
1,
SYSDATETIMEOFFSET(),
1
);

SELECT Id, IsActive, IsProductionEntry, SsoUiOrigin, SsoRedirectUri, NotificationEmailApp, EmailApiAppName, AuthApiUrl
FROM dbo.ApplicationSettings
ORDER BY IsProductionEntry DESC, Id;
GO

/* ========== 2) dbo.ai_settings (legacy) ========== */
IF OBJECT_ID(N'dbo.ai_settings', N'U') IS NULL
    PRINT N'SKIP dbo.ai_settings — table missing.';
ELSE
BEGIN
    TRUNCATE TABLE dbo.ai_settings;

    INSERT INTO dbo.ai_settings
    (
        is_singleton,
        is_enabled,
        provider,
        model_name,
        embedding_model,
        api_key,
        api_url,
        fallback_provider,
        fallback_model,
        reasoning_effort,
        temperature,
        max_output_tokens,
        confidence_threshold,
        handoff_threshold,
        retrieval_top_k,
        max_tool_calls,
        request_timeout_ms,
        daily_cost_limit_usd,
        agent_flags,
        ai_enabled,
        created_at,
        updated_at
    )
    VALUES
    (
        1,                                                          -- is_singleton
        1,                                                          -- is_enabled (exactly one enabled row)
        N'ollama',
        N'qwen-fast',
        N'',
        N'BY7Tmt96i88lpr5V11xLz9AAJB8Byw2bx5hjUY88jg',
        N'https://inferencellm.uaeu.ac.ae/v1',
        NULL,
        NULL,
        N'none',
        0,
        32000,
        1,
        0,
        6,
        8,
        45000,
        25,
        N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
        1,
        SYSDATETIMEOFFSET(),
        SYSDATETIMEOFFSET()
    );

    SELECT id, provider, model_name, api_url, is_enabled, ai_enabled
    FROM dbo.ai_settings;
END;
GO


IF OBJECT_ID(N'dbo.CustomerPulseSetting', N'U') IS NULL
    THROW 51000, 'dbo.CustomerPulseSetting is missing.', 1;

TRUNCATE TABLE dbo.CustomerPulseSetting;

INSERT INTO dbo.CustomerPulseSetting
(
    ServiceType,
    IsProduction,
    IsEnabled,
    ScriptUrl,
    FullSequenceCode,
    WebLinkingId,
    MobileLinkingId,
    Channel,
    DefaultLang,
    CpStatus,
    InternalStatus,
    DefaultFees,
    UpdatedAtUtc
)
VALUES
/* Production survey settings */
(N'alert',      1, 1, N'https://www.uaeu.ac.ae/js/cp/pulse-portal.js', N'351-049-001-000',      N'O/Rz/kL/COG/C',      N'O/Rz/ko/COG/D',      N'Web', N'en', N'closed_approved', N'sanadi_alert_service_feedback', N'0.00', SYSDATETIMEOFFSET()),
(N'inquiry',    1, 1, N'https://www.uaeu.ac.ae/js/cp/pulse-portal.js', N'351-049-002-000',    N'O/Rz/kL/COH/C',    N'O/Rz/ko/COH/D',    N'Web', N'en', N'closed_approved', N'sanadi_inquiry_service_feedback', N'0.00', SYSDATETIMEOFFSET()),
(N'suggestion', 1, 1, N'https://www.uaeu.ac.ae/js/cp/pulse-portal.js', N'351-049-003-000', N'O/Rz/kL/COI/C', N'O/Rz/ko/COI/D', N'Web', N'en', N'closed_approved', N'sanadi_suggestion_service_feedback', N'0.00', SYSDATETIMEOFFSET()),
(N'complaint',  1, 1, N'https://www.uaeu.ac.ae/js/cp/pulse-portal.js', N'351-049-004-000',  N'O/Rz/kL/COJ/C',  N'O/Rz/ko/COJ/D',  N'Web', N'en', N'closed_approved', N'sanadi_complaint_service_feedback', N'0.00', SYSDATETIMEOFFSET());



SELECT Id, ServiceType, IsProduction, IsEnabled, FullSequenceCode, WebLinkingId, ScriptUrl
FROM dbo.CustomerPulseSetting
ORDER BY IsProduction DESC, ServiceType;
GO

/*
  If INSERT fails due to unexpected NOT NULL columns, discover them with:

  SELECT c.name, t.name AS type_name, c.is_nullable, c.max_length
  FROM sys.columns c
  JOIN sys.types t ON t.user_type_id = c.user_type_id
  WHERE c.object_id = OBJECT_ID(N'dbo.ApplicationSettings')  -- or ai_settings / CustomerPulseSetting
  ORDER BY c.column_id;
*/
