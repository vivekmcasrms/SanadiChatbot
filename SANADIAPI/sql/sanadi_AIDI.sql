/*
  sanadi_AIDI.sql
  Merged executable script: SQL changes from 2026-10-26 through 2026-10-27.

  Source files (included in full, in apply order):
    1) 20261026_TicketEmailNotifications.sql
       - Customer Pulse survey setting lookup
       - SSO email delegated-token storage + lease procedures
       - Ticket email templates (created/assigned/updated/comment/survey)
       - usp_TicketEmail_GetSettings / Discover / Claim / Complete
       - usp_CustomerPulse_GetSurveyCase
    2) 2026-10-27-email-gateway-authorization.sql
       - usp_TicketEmail_GetAuthorization (gateway auth for ticket/survey email)
    3) 2026-10-27-required-ticket-assignment.sql
       - Automatic ticket assignment functions/procedures/triggers
       - Required so new tickets get assignees (feeds assigned email notifications)
    4) Local UI URL replacement (http://localhost:8080 → https://sanadi-beta.uaeu.ac.ae)
       - ApplicationSettings.SsoUiOrigin (ticket email AppUrl / SSO return origin)
       - notification_settings.public_app_url
       - Any other nvarchar/varchar table columns that still contain localhost:8080
         (or the localhost://8080 typo). API localhost:5281 URLs are not changed.

  Idempotent execution rules:
    - Missing objects/rows → create/insert once.
    - Already present → skip insert; procedures/functions/triggers use CREATE OR ALTER.
    - Never insert a second email template, activation row, or settings row for the same key.
    - URL rewrite only UPDATEs rows that still contain localhost:8080 (no new rows).
    - If a required base table is absent, that section is skipped (PRINT) so the rest still runs.
    - NotificationEmailApp / AuthApiUrl / NotificationEmailApiUrl are not hardcoded here.
    - Original source files are unchanged; this file is a merge only.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/* ========== BEGIN: 20261026_TicketEmailNotifications.sql ========== */

/*
  Customer Pulse survey setting lookup for an emailed ticket link.
  The application passes SsoRouting:IsProductionEntry as @IsProduction.
  Adds survey lookups, encrypted delegated-token storage, email templates and
  procedures for the C# dispatcher. Existing ticket procedures and configuration
  values are preserved. It is safe to rerun; activation time is not reset.
*/
IF OBJECT_ID(N'dbo.CustomerPulseSetting', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP usp_CustomerPulse_GetSetting — dbo.CustomerPulseSetting missing.';
ELSE
BEGIN
    EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_CustomerPulse_GetSetting
    @ServiceType varchar(30),
    @IsProduction bit
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        Id,
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
        DefaultFees
    FROM dbo.CustomerPulseSetting
    WHERE LOWER(ServiceType) = CASE WHEN LOWER(@ServiceType) = ''query'' THEN ''inquiry'' ELSE LOWER(@ServiceType) END
      AND IsProduction = @IsProduction
      AND IsEnabled = 1
    ORDER BY UpdatedAtUtc DESC, Id DESC;
END;');
    PRINT N'[sanadi_AIDI] ALTER/CREATE usp_CustomerPulse_GetSetting.';
END;
GO

-- Ticket email backend migration. Apply before deploying the C# dispatcher.
-- No ticket, SSO setting, provider credential or existing template is overwritten.
IF OBJECT_ID(N'auth.login_sessions', N'U') IS NULL OR OBJECT_ID(N'auth.refresh_tokens', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP sso_email_tokens / ticket_email_activation — auth login-session tables missing.';
ELSE
BEGIN
    IF OBJECT_ID(N'auth.sso_email_tokens', N'U') IS NULL
    BEGIN
        CREATE TABLE auth.sso_email_tokens (
            session_id uniqueidentifier NOT NULL PRIMARY KEY,
            user_id uniqueidentifier NOT NULL,
            protected_tokens nvarchar(max) NOT NULL,
            lease_id uniqueidentifier NULL,
            lease_until datetimeoffset NULL,
            updated_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
        );
        PRINT N'[sanadi_AIDI] CREATE auth.sso_email_tokens.';
    END
    ELSE
        PRINT N'[sanadi_AIDI] SKIP CREATE auth.sso_email_tokens — already exists.';

    IF OBJECT_ID(N'dbo.ticket_email_activation', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.ticket_email_activation (
            id bit NOT NULL PRIMARY KEY CHECK(id=1),
            activated_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
        );
        PRINT N'[sanadi_AIDI] CREATE dbo.ticket_email_activation.';
    END
    ELSE
        PRINT N'[sanadi_AIDI] SKIP CREATE dbo.ticket_email_activation — already exists.';

    IF NOT EXISTS(SELECT 1 FROM dbo.ticket_email_activation WHERE id=1)
    BEGIN
        INSERT dbo.ticket_email_activation(id) VALUES(1);
        PRINT N'[sanadi_AIDI] INSERT ticket_email_activation seed row.';
    END
    ELSE
        PRINT N'[sanadi_AIDI] SKIP ticket_email_activation seed — already present (activation time kept).';
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_SsoEmail_Store
    @userId uniqueidentifier, @sessionId uniqueidentifier, @protectedTokens nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    IF NOT EXISTS(SELECT 1 FROM auth.login_sessions WITH(UPDLOCK,HOLDLOCK)
        WHERE id=@sessionId AND user_id=@userId AND revoked_at IS NULL)
    BEGIN ROLLBACK; SELECT CONVERT(bit,0); RETURN; END;
    IF EXISTS(SELECT 1 FROM auth.sso_email_tokens WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@sessionId)
        UPDATE auth.sso_email_tokens SET protected_tokens=@protectedTokens,updated_at=SYSDATETIMEOFFSET()
        WHERE session_id=@sessionId AND user_id=@userId;
    ELSE INSERT auth.sso_email_tokens(session_id,user_id,protected_tokens) VALUES(@sessionId,@userId,@protectedTokens);
    -- Remove only this feature's ciphertext for revoked or expired application sessions.
    DELETE t FROM auth.sso_email_tokens t WHERE NOT EXISTS(
        SELECT 1 FROM auth.login_sessions s WHERE s.id=t.session_id AND s.revoked_at IS NULL)
        OR NOT EXISTS(SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id=t.session_id
            AND r.revoked_at IS NULL AND r.expires_at>SYSDATETIMEOFFSET());
    COMMIT; SELECT CONVERT(bit,1);
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_SsoEmail_Acquire @userId uniqueidentifier,@leaseId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH candidate AS (
        SELECT TOP(1) t.* FROM auth.sso_email_tokens t WITH(UPDLOCK,READPAST,ROWLOCK)
        JOIN auth.login_sessions s ON s.id=t.session_id AND s.user_id=@userId AND s.revoked_at IS NULL
        WHERE t.user_id=@userId AND (t.lease_until IS NULL OR t.lease_until<SYSDATETIMEOFFSET())
        AND EXISTS(SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id=s.id AND r.revoked_at IS NULL AND r.expires_at>SYSDATETIMEOFFSET())
        ORDER BY t.updated_at DESC
    )
    UPDATE candidate SET lease_id=@leaseId,lease_until=DATEADD(second,90,SYSDATETIMEOFFSET())
    OUTPUT inserted.session_id AS SessionId,inserted.lease_id AS LeaseId,inserted.protected_tokens AS ProtectedTokens;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_SsoEmail_Save
    @userId uniqueidentifier,@sessionId uniqueidentifier,@leaseId uniqueidentifier,@protectedTokens nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE t SET protected_tokens=@protectedTokens,updated_at=SYSDATETIMEOFFSET()
    FROM auth.sso_email_tokens t JOIN auth.login_sessions s ON s.id=t.session_id AND s.revoked_at IS NULL
    WHERE t.user_id=@userId AND t.session_id=@sessionId AND t.lease_id=@leaseId
      AND t.lease_until>SYSDATETIMEOFFSET()
      AND EXISTS(SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id=s.id AND r.revoked_at IS NULL AND r.expires_at>SYSDATETIMEOFFSET());
    SELECT CONVERT(bit,CASE WHEN @@ROWCOUNT=1 THEN 1 ELSE 0 END);
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_SsoEmail_Release @userId uniqueidentifier,@sessionId uniqueidentifier,@leaseId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE auth.sso_email_tokens SET lease_id=NULL,lease_until=NULL
    WHERE user_id=@userId AND session_id=@sessionId AND lease_id=@leaseId;
END;
GO
-- Existing database email templates remain administrator-editable. Seed only missing codes.
IF OBJECT_ID(N'dbo.email_templates', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP ticket email_templates seed — dbo.email_templates missing.';
ELSE
BEGIN
    INSERT dbo.email_templates(template_code,name_en,name_ar,subject_en,subject_ar,body_en,body_ar,enabled,version,audience)
    SELECT CONCAT('ticket_',e.Event,'_',LOWER(c.Category)),CONCAT(c.Category,' ',e.Event),CONCAT(c.Category,' ',e.Event),
        CASE WHEN e.Event='survey' THEN '{Category} {ReferenceNumber}: share your feedback' ELSE '{Category} {ReferenceNumber}: {Action}' END,
        CASE WHEN e.Event='survey' THEN N'{ReferenceNumber}: شاركنا رأيك' ELSE N'{ReferenceNumber}: تحديث الطلب' END,
        CONCAT('<p>Dear {RecipientName},</p><p>',e.Message,'</p><p>Reference: <strong>{ReferenceNumber}</strong><br>Category: {Category}<br>Subject: {Subject}<br>Status: {Status}</p>',
          CASE WHEN e.Event='survey' THEN '<p>Your feedback helps us improve university services.</p><p><a href="{SurveyUrl}">Complete the {Category} Customer Pulse survey</a></p>'
               ELSE '<p>{Comment}</p><p><a href="{TicketUrl}">View your request in Sanadi</a></p>' END,
          '<p>United Arab Emirates University<br>Sanadi</p>'),
        CASE WHEN e.Event='survey' THEN N'<p>عزيزي {RecipientName}،</p><p>تم إغلاق طلبك {ReferenceNumber}. نرحب بملاحظاتك لتحسين خدمات الجامعة.</p><p><a href="{SurveyUrl}">شاركنا رأيك في الخدمة</a></p>'
          ELSE N'<p>عزيزي {RecipientName}،</p><p>يوجد تحديث على طلبك {ReferenceNumber}.</p><p>{Subject}<br>{Status}</p><p>{Comment}</p><p><a href="{TicketUrl}">عرض الطلب في سندي</a></p>' END,
        1,1,'important'
    FROM (VALUES('Inquiry'),('Complaint'),('Alert'),('Suggestion')) c(Category)
    CROSS JOIN (VALUES
        ('created','Your request has been registered successfully. Please keep its reference number for follow-up.'),
        ('assigned','The responsible staff assignment for this request has been updated. Please review the request for the next steps.'),
        ('updated','The status of this request has changed. Please review the current status and any required next steps.'),
        ('comment','A new response is available on this request.'),
        ('survey','Your request has been closed. We invite you to share your experience through Customer Pulse.')
    ) e(Event,Message)
    WHERE NOT EXISTS(SELECT 1 FROM dbo.email_templates t WHERE t.template_code=CONCAT('ticket_',e.Event,'_',LOWER(c.Category)));

    PRINT CONCAT(N'[sanadi_AIDI] ticket email_templates seed inserted rows=', CONVERT(nvarchar(20), @@ROWCOUNT),
                 N' (0 means all template codes already present; bodies not overwritten).');
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_TicketEmail_GetSettings @IsProduction bit
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP(1) NotificationEmailApiUrl AS ApiUrl,NotificationEmailApp AS App,SsoUiOrigin AS AppUrl,
        NotificationEmailCc AS Cc,NotificationEmailBcc AS Bcc,NotificationEmailTemplate AS Template,
        EmailApiAppName AS ClientId,
        (SELECT TOP(1) emails_enabled FROM dbo.notification_settings) AS Enabled,
        (SELECT TOP(1) demo_email_mode FROM dbo.notification_settings) AS DemoMode
    FROM dbo.ApplicationSettings WHERE IsActive=1 AND IsProductionEntry=@IsProduction
    ORDER BY UpdatedAtUtc DESC,Id DESC;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_TicketEmail_Discover
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @since datetimeoffset=(SELECT activated_at FROM dbo.ticket_email_activation WHERE id=1);
    -- Read committed durable business records. No trigger or ticket procedure is changed.
    ;WITH assignment AS (
        SELECT a.*,LAG(a.assigned_to) OVER(PARTITION BY a.case_id ORDER BY a.created_at,a.id) AS previous_owner
        FROM dbo.case_assignments a
    ), suggestionAssignment AS (
        SELECT a.*,LAG(CASE WHEN ISJSON(a.metadata)=1 THEN JSON_VALUE(a.metadata,'$.assignee') END)
            OVER(PARTITION BY a.entity_id ORDER BY a.created_at,a.id) AS previous_owner
        FROM dbo.audit_logs a WHERE a.action='suggestion.assigned' AND a.entity_type='suggestion'
    ), events AS (
        SELECT CONCAT('case-created:',c.id,CASE WHEN p.Recipient=c.student_id THEN '' ELSE CONCAT(':',p.Recipient) END) AS Source,'created' AS Event,c.id AS TicketId,'case' AS Kind,
            c.case_number AS ReferenceNumber,c.case_type AS Category,c.title AS Title,c.status AS TicketStatus,
            CAST(NULL AS nvarchar(max)) AS PublicComment,c.student_id AS ActorId,p.Recipient AS RecipientId,c.service_unit_id AS UnitId,c.created_at AS OccurredAt
        FROM dbo.cases c CROSS APPLY(SELECT c.student_id AS Recipient
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=c.service_unit_id
            UNION SELECT c.assigned_to) p
        WHERE c.created_at>=@since AND c.deleted_at IS NULL AND p.Recipient IS NOT NULL
        UNION ALL
        SELECT CONCAT('case-initial-assignment:',c.id,':',p.Recipient),'assigned',c.id,'case',c.case_number,c.case_type,c.title,c.status,
            NULL,c.student_id,p.Recipient,c.service_unit_id,c.created_at
        FROM dbo.cases c CROSS APPLY(SELECT c.student_id AS Recipient UNION SELECT c.assigned_to
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=c.service_unit_id) p
        WHERE c.created_at>=@since AND c.deleted_at IS NULL AND p.Recipient IS NOT NULL
          AND (c.assigned_to IS NOT NULL OR EXISTS(SELECT 1 FROM dbo.service_units u WHERE u.id=c.service_unit_id AND u.primary_service_owner_id IS NOT NULL))
          AND NOT EXISTS(SELECT 1 FROM dbo.case_assignments a WHERE a.case_id=c.id)
        UNION ALL
        SELECT CONCAT('assignment:',a.id,':',p.Recipient),'assigned',c.id,'case',c.case_number,c.case_type,c.title,c.status,
            NULL,a.assigned_by,p.Recipient,c.service_unit_id,a.created_at
        FROM assignment a JOIN dbo.cases c ON c.id=a.case_id
        CROSS APPLY(SELECT c.student_id AS Recipient UNION SELECT a.assigned_to
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=c.service_unit_id) p
        WHERE a.created_at>=@since AND c.deleted_at IS NULL AND a.assigned_to=c.assigned_to
          AND (a.previous_owner IS NULL OR a.previous_owner<>a.assigned_to)
        UNION ALL
        SELECT CONCAT('history:',h.id,':',p.Recipient),'updated',c.id,'case',c.case_number,c.case_type,c.title,h.to_status,
            NULL,h.changed_by,p.Recipient,c.service_unit_id,h.created_at
        FROM dbo.case_status_history h JOIN dbo.cases c ON c.id=h.case_id
        CROSS APPLY(SELECT c.student_id AS Recipient UNION SELECT c.assigned_to
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=c.service_unit_id AND c.assigned_to IS NULL) p
        WHERE h.created_at>=@since AND h.from_status IS NOT NULL AND h.from_status<>h.to_status
          AND h.to_status<>'assigned' AND c.deleted_at IS NULL
        UNION ALL
        SELECT CONCAT('closure:',h.id),'survey',c.id,'case',c.case_number,c.case_type,c.title,h.to_status,
            NULL,h.changed_by,c.student_id,c.service_unit_id,h.created_at
        FROM dbo.case_status_history h JOIN dbo.cases c ON c.id=h.case_id
        WHERE h.created_at>=@since AND h.to_status='closed' AND ISNULL(h.from_status,'')<>'closed' AND c.deleted_at IS NULL
        UNION ALL
        SELECT CONCAT('comment:',m.id,':',p.Recipient),'comment',c.id,'case',c.case_number,c.case_type,c.title,c.status,
            CASE WHEN c.is_sensitive=1 THEN NULL ELSE m.body END,m.author_id,p.Recipient,c.service_unit_id,m.created_at
        FROM dbo.case_comments m JOIN dbo.cases c ON c.id=m.case_id
        CROSS APPLY(SELECT c.student_id AS Recipient
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=c.service_unit_id
            UNION SELECT c.assigned_to) p
        WHERE m.created_at>=@since AND m.is_internal=0 AND c.deleted_at IS NULL AND p.Recipient IS NOT NULL
        UNION ALL
        SELECT CONCAT('suggestion-created:',s.id,CASE WHEN p.Recipient=s.student_id THEN '' ELSE CONCAT(':',p.Recipient) END),'created',s.id,'suggestion',s.reference_number,'suggestion',s.title,s.status,
            NULL,s.student_id,p.Recipient,s.service_unit_id,s.created_at
        FROM dbo.suggestions s CROSS APPLY(SELECT s.student_id AS Recipient
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=s.service_unit_id
            UNION SELECT s.assigned_staff_id) p
        WHERE s.created_at>=@since AND s.deleted_at IS NULL AND p.Recipient IS NOT NULL
        UNION ALL
        SELECT CONCAT('suggestion-initial-owner:',s.id,CASE WHEN p.Recipient=COALESCE(s.assigned_staff_id,u.primary_service_owner_id) THEN '' ELSE CONCAT(':',p.Recipient) END),'assigned',s.id,'suggestion',s.reference_number,'suggestion',s.title,s.status,
            NULL,s.student_id,p.Recipient,s.service_unit_id,s.created_at
        FROM dbo.suggestions s LEFT JOIN dbo.service_units u ON u.id=s.service_unit_id
        CROSS APPLY(SELECT s.student_id AS Recipient UNION SELECT COALESCE(s.assigned_staff_id,u.primary_service_owner_id)) p
        WHERE s.created_at>=@since AND s.deleted_at IS NULL AND p.Recipient IS NOT NULL
          AND COALESCE(s.assigned_staff_id,u.primary_service_owner_id) IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM dbo.audit_logs a WHERE a.entity_id=s.id AND a.action='suggestion.assigned')
        UNION ALL
        SELECT CONCAT('suggestion-assignment:',a.id,':',p.Recipient),'assigned',s.id,'suggestion',s.reference_number,'suggestion',s.title,s.status,
            NULL,a.actor_id,p.Recipient,s.service_unit_id,a.created_at
        FROM suggestionAssignment a JOIN dbo.suggestions s ON s.id=a.entity_id
        CROSS APPLY(SELECT s.student_id AS Recipient UNION SELECT s.assigned_staff_id
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=s.service_unit_id) p
        WHERE a.created_at>=@since AND s.deleted_at IS NULL AND s.assigned_staff_id IS NOT NULL
            AND CASE WHEN ISJSON(a.metadata)=1 THEN JSON_VALUE(a.metadata,'$.assignee') END=CONVERT(nvarchar(36),s.assigned_staff_id)
            AND ISNULL(a.previous_owner,'')<>CONVERT(nvarchar(36),s.assigned_staff_id)
        UNION ALL
        SELECT CONCAT('suggestion-update:',m.id,':',p.Recipient),'comment',s.id,'suggestion',s.reference_number,'suggestion',s.title,s.status,
            m.update_text_en,m.created_by,p.Recipient,s.service_unit_id,m.created_at
        FROM dbo.suggestion_updates m JOIN dbo.suggestions s ON s.id=m.suggestion_id
        CROSS APPLY(SELECT s.student_id AS Recipient
            UNION SELECT u.primary_service_owner_id FROM dbo.service_units u WHERE u.id=s.service_unit_id
            UNION SELECT s.assigned_staff_id) p
        WHERE m.created_at>=@since AND m.visible_to_student=1 AND s.deleted_at IS NULL AND p.Recipient IS NOT NULL
        UNION ALL
        SELECT CONCAT('suggestion-closure:',s.id),'survey',s.id,'suggestion',s.reference_number,'suggestion',s.title,s.status,
            NULL,m.created_by,s.student_id,s.service_unit_id,m.created_at
        FROM dbo.suggestions s CROSS APPLY(SELECT TOP(1) created_by,created_at FROM dbo.suggestion_updates
            WHERE suggestion_id=s.id AND update_type='closed' AND visible_to_student=1 AND created_at>=@since ORDER BY created_at) m
        WHERE s.status='closed' AND s.deleted_at IS NULL
    )
    INSERT dbo.notification_deliveries(event_type,recipient_user_id,template_code,template_vars,case_id,service_unit_id,dedupe_key,recipient_role)
    SELECT CONCAT('TICKET_EMAIL_',e.Event),e.RecipientId,
        CONCAT('ticket_',e.Event,'_',CASE WHEN e.Category='query' THEN 'inquiry' ELSE LOWER(e.Category) END),
        (SELECT e.TicketId AS ticketId,e.Kind AS kind,e.ReferenceNumber AS referenceNumber,
            CASE WHEN e.Category='query' THEN 'Inquiry' ELSE UPPER(LEFT(e.Category,1))+SUBSTRING(e.Category,2,30) END AS category,
            e.Title AS title,e.TicketStatus AS status,e.PublicComment AS comment,e.ActorId AS actorId,
            e.Event AS event,e.OccurredAt AS occurredAt FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
        CASE WHEN e.Kind='case' THEN e.TicketId END,e.UnitId,CONCAT('ticket-email:',e.Source),
        CASE WHEN EXISTS(SELECT 1 FROM dbo.cases c WHERE e.Kind='case' AND c.id=e.TicketId AND c.student_id=e.RecipientId)
            OR EXISTS(SELECT 1 FROM dbo.suggestions s WHERE e.Kind='suggestion' AND s.id=e.TicketId AND s.student_id=e.RecipientId)
            THEN 'student' ELSE 'service_owner' END
    FROM events e WHERE e.RecipientId IS NOT NULL AND e.ActorId IS NOT NULL
        AND LOWER(e.Category) IN ('query','inquiry','complaint','alert','suggestion')
        AND NOT EXISTS(SELECT 1 FROM dbo.notification_deliveries d WITH(UPDLOCK,HOLDLOCK)
            WHERE d.dedupe_key=CONCAT('ticket-email:',e.Source));
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_TicketEmail_Claim
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @claimed TABLE(Id uniqueidentifier);
    ;WITH candidate AS (SELECT TOP(1) * FROM dbo.notification_deliveries WITH(UPDLOCK,READPAST,ROWLOCK)
        WHERE event_type LIKE 'TICKET[_]EMAIL[_]%' AND status IN ('queued','retrying') AND next_attempt_at<=SYSDATETIMEOFFSET()
        ORDER BY queued_at,id)
    UPDATE candidate SET status='sending',locked_at=SYSDATETIMEOFFSET(),retry_count=retry_count+1
    OUTPUT inserted.id INTO @claimed;
    SELECT d.id AS Id,d.template_vars AS Variables,d.recipient_user_id AS RecipientId,
        p.email AS RecipientEmail,p.full_name AS RecipientName,t.subject_en AS SubjectEn,t.subject_ar AS SubjectAr,
        t.body_en AS BodyEn,t.body_ar AS BodyAr,d.template_code AS TemplateCode,
        CONVERT(bit,CASE WHEN d.event_type<>'TICKET_EMAIL_assigned' THEN 1
            WHEN EXISTS(SELECT 1 FROM dbo.cases c LEFT JOIN dbo.service_units u ON u.id=c.service_unit_id
                WHERE c.id=d.case_id AND d.recipient_user_id IN(c.student_id,c.assigned_to,u.primary_service_owner_id)) THEN 1
            WHEN EXISTS(SELECT 1 FROM dbo.suggestions s LEFT JOIN dbo.service_units u ON u.id=s.service_unit_id
                WHERE JSON_VALUE(d.template_vars,'$.kind')='suggestion' AND s.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(d.template_vars,'$.ticketId'))
                    AND d.recipient_user_id IN(s.student_id,s.assigned_staff_id,u.primary_service_owner_id)) THEN 1
            ELSE 0 END) AS RecipientCurrent
    FROM @claimed c JOIN dbo.notification_deliveries d ON d.id=c.Id
    LEFT JOIN dbo.profiles p ON p.id=d.recipient_user_id AND p.deleted_at IS NULL
    OUTER APPLY(SELECT TOP(1) subject_en,subject_ar,body_en,body_ar FROM dbo.email_templates
        WHERE template_code=d.template_code AND enabled=1 AND (effective_from IS NULL OR effective_from<=SYSDATETIMEOFFSET())
        AND (effective_to IS NULL OR effective_to>SYSDATETIMEOFFSET()) ORDER BY version DESC) t;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_TicketEmail_Complete @Id uniqueidentifier,@Status nvarchar(30),@Code nvarchar(100)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Status NOT IN ('sent','failed','retrying','uncertain') THROW 51000,'Invalid email outcome.',1;
    UPDATE dbo.notification_deliveries SET status=@Status,failure_code=@Code,
        sent_at=CASE WHEN @Status='sent' THEN SYSDATETIMEOFFSET() ELSE sent_at END,
        failed_at=CASE WHEN @Status IN ('failed','uncertain') THEN SYSDATETIMEOFFSET() ELSE NULL END,
        next_attempt_at=DATEADD(minute,5,SYSDATETIMEOFFSET()),locked_at=NULL,updated_at=SYSDATETIMEOFFSET()
    WHERE id=@Id AND status='sending' AND event_type LIKE 'TICKET[_]EMAIL[_]%';
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_CustomerPulse_GetSurveyCase
    @CaseNumber nvarchar(100),
    @CaseType nvarchar(30)
AS
BEGIN
    SET NOCOUNT ON;

    IF LOWER(@CaseType) = 'suggestion'
    BEGIN
        SELECT TOP (1) id AS Id, student_id AS StudentId, reference_number AS CaseNumber
        FROM dbo.suggestions
        WHERE reference_number = @CaseNumber;
        RETURN;
    END;

    SELECT TOP (1) id AS Id, student_id AS StudentId, case_number AS CaseNumber
    FROM dbo.cases
    WHERE case_number = @CaseNumber AND case_type = @CaseType;
END;
GO
/* ========== END: 20261026_TicketEmailNotifications.sql ========== */
GO

/* ========== BEGIN: 2026-10-27-email-gateway-authorization.sql ========== */

/* Gateway authorization contract for C# ticket and survey notifications.
   Rerunnable. No SSO flow, ticket assignment, settings values or stored tokens
   are modified. Configure AuthApiUrl with the full gateway token endpoint in
   the correct ApplicationSettings environment row before enabling delivery.
*/
CREATE OR ALTER PROCEDURE dbo.usp_TicketEmail_GetAuthorization
    @IsProduction bit,
    @ActorId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP(1)
        s.AuthApiUrl AS ApiUrl,
        s.EmailApiAppName AS ClientId,
        s.StudentApiClientSecret AS ClientSecret,
        a.email AS AccountEmail,
        s.HeaderDomain AS EmailDomain
    FROM dbo.ApplicationSettings s
    JOIN auth.users a ON a.id=@ActorId
    JOIN dbo.profiles p ON p.id=a.id AND p.deleted_at IS NULL AND p.access_revoked_at IS NULL
    WHERE s.IsActive=1 AND s.IsProductionEntry=@IsProduction
      AND EXISTS(SELECT 1 FROM auth.login_sessions ls
        WHERE ls.user_id=a.id AND ls.revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM auth.refresh_tokens rt WHERE rt.session_id=ls.id
            AND rt.revoked_at IS NULL AND rt.expires_at>SYSDATETIMEOFFSET()))
    ORDER BY s.UpdatedAtUtc DESC,s.Id DESC;
END;
GO
/* ========== END: 2026-10-27-email-gateway-authorization.sql ========== */
GO

/* ========== BEGIN: 2026-10-27-required-ticket-assignment.sql ========== */

/* 2026-10-27: Automatically assign NEW tickets to an eligible unit owner/staff member.
   Deploy before the matching API build. Rerunnable; no historical tickets,
   staff mappings, permissions, notification settings or credentials are changed.
   An unstaffed routed unit falls back to the existing central support desk.
   Busy support staff remain eligible to own a ticket pending follow-up.
   Only when no staff can be selected, submit successfully to the responsible
   unit queue for its owner to assign manually. Never invent an assignee.
   Error 51027 is translated to HTTP 409/ticket_assignee_unavailable by the API.
*/
CREATE OR ALTER FUNCTION dbo.ufn_TicketAssignmentCandidates
(
    @unit uniqueidentifier, @requester uniqueidentifier, @sensitive bit,
    @preferredOwner uniqueidentifier
)
RETURNS TABLE
AS RETURN
(
    SELECT sp.user_id AS Owner,
        CONVERT(nvarchar(50),CASE WHEN u.primary_service_owner_id=sp.user_id THEN N'primary_owner'
            WHEN EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.service_unit_id=u.id
                AND o.staff_profile_id=sp.user_id AND o.is_active=1
                AND o.started_at<=SYSDATETIMEOFFSET() AND (o.ended_at IS NULL OR o.ended_at>SYSDATETIMEOFFSET())) THEN N'unit_owner'
            ELSE N'workload' END) AS Method,
        CASE WHEN u.primary_service_owner_id=sp.user_id THEN 0
            WHEN EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.service_unit_id=u.id
                AND o.staff_profile_id=sp.user_id AND o.is_active=1
                AND o.started_at<=SYSDATETIMEOFFSET() AND (o.ended_at IS NULL OR o.ended_at>SYSDATETIMEOFFSET())) THEN 1 ELSE 2 END AS Rank,
        (SELECT COUNT_BIG(*) FROM dbo.cases c WHERE c.assigned_to=sp.user_id AND c.deleted_at IS NULL
            AND c.status NOT IN(N'closed',N'resolved',N'withdrawn',N'rejected',N'duplicate'))
        + (SELECT COUNT_BIG(*) FROM dbo.suggestions s WHERE s.assigned_staff_id=sp.user_id AND s.deleted_at IS NULL
            AND s.status NOT IN(N'closed',N'implemented',N'not_proceeding')) AS Workload,
        sp.last_assigned_at AS LastAssignedAt
    FROM dbo.service_units u
    JOIN dbo.staff_profiles sp ON sp.is_active=1
    JOIN auth.users a ON a.id=sp.user_id
    JOIN dbo.profiles p ON p.id=sp.user_id AND p.deleted_at IS NULL AND p.access_revoked_at IS NULL
    WHERE u.id=@unit AND u.is_active=1
      AND (@requester IS NULL OR sp.user_id<>@requester)
      AND (@preferredOwner IS NULL OR sp.user_id=@preferredOwner)
      -- A selected appointment officer can be busy now; automatic picks must be available.
      AND (@preferredOwner IS NOT NULL OR COALESCE(sp.availability_status,N'available')=N'available')
      AND (u.primary_service_owner_id=sp.user_id
        OR EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.service_unit_id=u.id
            AND o.staff_profile_id=sp.user_id AND o.is_active=1
            AND o.started_at<=SYSDATETIMEOFFSET() AND (o.ended_at IS NULL OR o.ended_at>SYSDATETIMEOFFSET()))
        OR EXISTS(SELECT 1 FROM dbo.service_staff ss WHERE ss.service_unit_id=u.id
            AND ss.staff_profile_id=sp.user_id AND ss.is_active=1 AND ss.can_receive_cases=1)
        OR (sp.service_unit_id=u.id AND NOT EXISTS(SELECT 1 FROM dbo.service_staff ss
            WHERE ss.service_unit_id=u.id AND ss.staff_profile_id=sp.user_id)))
      AND NOT EXISTS(SELECT 1 FROM dbo.service_staff ss WHERE ss.service_unit_id=u.id
            AND ss.staff_profile_id=sp.user_id AND (ss.is_active=0 OR ss.can_receive_cases=0))
      AND (@sensitive=0 OR EXISTS(SELECT 1 FROM dbo.service_staff ss WHERE ss.service_unit_id=u.id
            AND ss.staff_profile_id=sp.user_id AND ss.is_active=1 AND ss.can_view_sensitive_cases=1)
        OR EXISTS(SELECT 1 FROM dbo.user_roles r WHERE r.user_id=sp.user_id AND r.role IN(N'service_manager',N'system_admin')))
);
GO
-- Reuse the service-desk codes already used by the existing assignment flow.
-- Staff IDs and unit IDs always come from current database records.
CREATE OR ALTER FUNCTION dbo.ufn_TicketAssignment
(
    @unit uniqueidentifier,@requester uniqueidentifier,@sensitive bit,@preferredOwner uniqueidentifier
)
RETURNS TABLE
AS RETURN
(
    SELECT TOP(1) p.UnitId,p.En,p.Ar,p.Owner,p.Method
    FROM (
        SELECT u.id AS UnitId,u.name_en AS En,u.name_ar AS Ar,c.Owner,c.Method,
            0 AS RouteRank,0 AS DeskRank,c.Rank,c.Workload,c.LastAssignedAt
        FROM dbo.service_units u CROSS APPLY dbo.ufn_TicketAssignmentCandidates(u.id,@requester,@sensitive,@preferredOwner) c
        WHERE u.id=@unit
        UNION ALL
        SELECT u.id,u.name_en,u.name_ar,c.Owner,CONVERT(nvarchar(50),N'SERVICE_DESK_FALLBACK'),
            1,CASE u.code WHEN N'SERVICE_DESK' THEN 0 WHEN N'SD' THEN 1 ELSE 2 END,c.Rank,c.Workload,c.LastAssignedAt
        FROM dbo.service_units u CROSS APPLY dbo.ufn_TicketAssignmentCandidates(u.id,@requester,@sensitive,NULL) c
        WHERE u.code IN(N'SERVICE_DESK',N'SD',N'HD') AND @preferredOwner IS NULL
        UNION ALL
        -- Availability is a scheduling state, not a reason to reject a student's
        -- ticket: when all support officers are busy, select an active one.
        -- Disabled/revoked accounts, receiving permissions and sensitive-case
        -- clearance are still checked by the same candidate function.
        SELECT u.id,u.name_en,u.name_ar,c.Owner,CONVERT(nvarchar(50),N'SERVICE_DESK_FALLBACK'),
            2,CASE u.code WHEN N'SERVICE_DESK' THEN 0 WHEN N'SD' THEN 1 ELSE 2 END,c.Rank,c.Workload,c.LastAssignedAt
        FROM dbo.service_units u CROSS JOIN dbo.staff_profiles sp
        CROSS APPLY dbo.ufn_TicketAssignmentCandidates(u.id,@requester,@sensitive,sp.user_id) c
        WHERE u.code IN(N'SERVICE_DESK',N'SD',N'HD') AND @preferredOwner IS NULL
        UNION ALL
        SELECT u.id,u.name_en,u.name_ar,CONVERT(uniqueidentifier,NULL),CONVERT(nvarchar(50),N'unit_queue'),
            3,CASE WHEN u.id=@unit THEN 0 WHEN u.code=N'SERVICE_DESK' THEN 1 WHEN u.code=N'SD' THEN 2 ELSE 3 END,
            0,CONVERT(bigint,0),CONVERT(datetimeoffset,NULL)
        FROM dbo.service_units u WHERE u.is_active=1 AND @preferredOwner IS NULL
            AND (u.id=@unit OR u.code IN(N'SERVICE_DESK',N'SD',N'HD'))
    ) p
    ORDER BY p.RouteRank,p.DeskRank,p.Rank,p.Workload,p.LastAssignedAt,p.Owner
);
GO
CREATE OR ALTER PROCEDURE dbo.usp_Tickets_GetAssignment
    @unit uniqueidentifier, @requester uniqueidentifier, @sensitive bit=0,
    @preferredOwner uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UnitId,En,Ar,Owner,Method FROM dbo.ufn_TicketAssignment(@unit,@requester,@sensitive,@preferredOwner);
END;
GO
-- Shared transactional validation for SQL callers as well as API preflight.
CREATE OR ALTER PROCEDURE dbo.usp_Tickets_RequireAssignment
    @unit uniqueidentifier OUTPUT, @requester uniqueidentifier, @sensitive bit=0,
    @owner uniqueidentifier OUTPUT, @method nvarchar(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @requested uniqueidentifier=@owner,@desk bit=CASE WHEN @method=N'SERVICE_DESK_FALLBACK'
        AND EXISTS(SELECT 1 FROM dbo.service_units WHERE id=@unit AND code IN(N'SERVICE_DESK',N'SD',N'HD')) THEN 1 ELSE 0 END;
    DECLARE @resolved bit=0;
    SET @owner=NULL;
    SELECT @resolved=1,@unit=UnitId,@owner=Owner,@method=CASE WHEN @desk=1 AND Owner IS NOT NULL THEN N'SERVICE_DESK_FALLBACK' ELSE Method END
    FROM dbo.ufn_TicketAssignment(@unit,@requester,@sensitive,@requested);
    IF @resolved=0 THROW 51027, 'A valid responsible service unit or selected staff member could not be found.', 1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_InsertCase
    @caseId uniqueidentifier,@referenceNo nvarchar(100),@user uniqueidentifier,@type nvarchar(50),
    @category uniqueidentifier=NULL,@unit uniqueidentifier=NULL,@title nvarchar(200),@description nvarchar(max),
    @status nvarchar(50),@priority nvarchar(50),@severity nvarchar(50),@lang nvarchar(10),@hint nvarchar(100)=NULL,
    @automation nvarchar(50),@alert nvarchar(100)=NULL,@location nvarchar(300)=NULL,@sensitive bit,
    @sensitivity nvarchar(50),@human bit,@attention nvarchar(100)=NULL,@confidentiality nvarchar(50),
    @incident nvarchar(50)=NULL,@desired nvarchar(max)=NULL,@conversation uniqueidentifier=NULL,
    @service nvarchar(100),@topic nvarchar(100)=NULL,@root nvarchar(100)=NULL,
    @reasonEn nvarchar(max),@reasonAr nvarchar(max),@confidence float,@owner uniqueidentifier=NULL,
    @method nvarchar(50),@action nvarchar(100),@meta nvarchar(max),@channel nvarchar(50)=N'shortcut'
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@user,@sensitive,@owner OUTPUT,@method OUTPUT;
        SET @status=CASE WHEN @owner IS NULL THEN N'routed' ELSE N'assigned' END;
        INSERT dbo.cases(id,case_number,student_id,case_type,category_id,service_unit_id,title,description,status,
            urgency,severity,language,entry_channel,shortcut_hint,current_responsible_actor,automation_level,
            alert_type,alert_location,is_sensitive,sensitivity_level,human_review_required,attention_reason,
            confidentiality,incident_date,desired_resolution,related_conversation_id,routing_service_code,
            routing_topic,root_cause_code,routing_reason_en,routing_reason_ar,routing_confidence,ai_confidence,
            assigned_to,assigned_at,assignment_method,first_response_due_at,resolution_due_at,needs_assignment_attention)
        VALUES(@caseId,@referenceNo,@user,@type,@category,@unit,@title,@description,@status,
            @priority,@severity,@lang,@channel,@hint,N'service_owner',@automation,
            @alert,@location,@sensitive,@sensitivity,CASE WHEN @owner IS NULL THEN 1 ELSE @human END,@attention,
            @confidentiality,TRY_CONVERT(date,@incident),@desired,@conversation,@service,
            @topic,@root,@reasonEn,@reasonAr,@confidence,@confidence,
            @owner,CASE WHEN @owner IS NOT NULL THEN SYSDATETIMEOFFSET() END,@method,
            DATEADD(hour,24,SYSDATETIMEOFFSET()),DATEADD(day,10,SYSDATETIMEOFFSET()),CASE WHEN @owner IS NULL THEN 1 ELSE 0 END);
        INSERT dbo.case_status_history(case_id,to_status,changed_by,note) VALUES(@caseId,@status,@user,@reasonEn);
        INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(@user,@action,N'case',@caseId,@meta);
        UPDATE dbo.staff_profiles SET last_assigned_at=SYSDATETIMEOFFSET() WHERE user_id=@owner;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_InsertSuggestion
    @id uniqueidentifier,@user uniqueidentifier,@reference nvarchar(100),@title nvarchar(200),@description nvarchar(max),
    @benefit nvarchar(max)=NULL,@unit uniqueidentifier=NULL,@anon bit,@lang nvarchar(10),
    @conversation uniqueidentifier=NULL,@service nvarchar(100),@reasonEn nvarchar(max),@reasonAr nvarchar(max),
    @confidence float,@channel nvarchar(50)=N'shortcut'
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @owner uniqueidentifier,@method nvarchar(50);
        EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@user,0,@owner OUTPUT,@method OUTPUT;
        INSERT dbo.suggestions(id,student_id,reference_number,title,description,expected_benefit,service_unit_id,
            is_anonymous,language,status,entry_channel,related_conversation_id,routing_service_code,
            routing_reason_en,routing_reason_ar,routing_confidence,assigned_staff_id,review_due_at)
        VALUES(@id,@user,@reference,@title,@description,@benefit,@unit,@anon,@lang,CASE WHEN @owner IS NULL THEN N'submitted' ELSE N'assigned' END,@channel,
            @conversation,@service,@reasonEn,@reasonAr,@confidence,@owner,DATEADD(day,14,SYSDATETIMEOFFSET()));
        UPDATE dbo.staff_profiles SET last_assigned_at=SYSDATETIMEOFFSET() WHERE user_id=@owner;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertCase
    @id uniqueidentifier,@reference nvarchar(100),@userId uniqueidentifier,@type nvarchar(50),
    @title nvarchar(500),@description nvarchar(max),@urgent nvarchar(50),@lang nvarchar(10),
    @conversationId uniqueidentifier=NULL,@unit uniqueidentifier=NULL,@owner uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @method nvarchar(50);
        EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@userId,0,@owner OUTPUT,@method OUTPUT;
        INSERT dbo.cases(id,case_number,student_id,case_type,title,description,status,urgency,language,
            human_review_required,related_conversation_id,entry_channel,current_responsible_actor,last_activity_at,
            service_unit_id,assigned_to,assigned_at,assignment_method,needs_assignment_attention)
        VALUES(@id,@reference,@userId,@type,@title,@description,CASE WHEN @owner IS NULL THEN N'routed' ELSE N'assigned' END,@urgent,@lang,1,@conversationId,
            N'chat',N'service_owner',SYSDATETIMEOFFSET(),@unit,@owner,CASE WHEN @owner IS NOT NULL THEN SYSDATETIMEOFFSET() END,@method,CASE WHEN @owner IS NULL THEN 1 ELSE 0 END);
        UPDATE dbo.staff_profiles SET last_assigned_at=SYSDATETIMEOFFSET() WHERE user_id=@owner;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertSuggestion
    @id uniqueidentifier,@reference nvarchar(100),@userId uniqueidentifier,@title nvarchar(500),
    @description nvarchar(max),@lang nvarchar(10),@conversationId uniqueidentifier=NULL,@unit uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.usp_Interactions_InsertSuggestion @id=@id,@user=@userId,@reference=@reference,
        @title=@title,@description=@description,@unit=@unit,@anon=0,@lang=@lang,@conversation=@conversationId,
        @service=N'',@reasonEn=N'',@reasonAr=N'',@confidence=0,@channel=N'chat';
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertIncidentCase
    @id uniqueidentifier,@reference nvarchar(100),@userId uniqueidentifier,@title nvarchar(500),
    @description nvarchar(max),@lang nvarchar(10),@contactId uniqueidentifier,
    @conversationId uniqueidentifier=NULL,@urgency nvarchar(50)=N'high'
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @code nvarchar(256),@unit uniqueidentifier,@owner uniqueidentifier,@method nvarchar(50),
            @unitEn nvarchar(450),@unitAr nvarchar(450);
        SELECT @code=code FROM dbo.emergency_contacts WITH(HOLDLOCK) WHERE id=@contactId AND is_active=1;
        IF @code IS NULL THROW 50001, 'The contact is no longer active. Please send your report again.', 1;
        IF @conversationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.conversations WHERE id=@conversationId AND user_id=@userId)
            THROW 50001, 'Chat not found.', 1;
        DECLARE @routing TABLE(UnitId uniqueidentifier,OwnerId uniqueidentifier,UnitEn nvarchar(450),UnitAr nvarchar(450));
        INSERT @routing EXEC dbo.usp_Assistant_ResolveIncidentUnit @contactId;
        SELECT @unit=UnitId,@unitEn=UnitEn,@unitAr=UnitAr FROM @routing;
        EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@userId,0,@owner OUTPUT,@method OUTPUT;
        SELECT @unitEn=name_en,@unitAr=name_ar FROM dbo.service_units WHERE id=@unit;
        IF @urgency NOT IN(N'high',N'critical') SET @urgency=N'high';
        EXEC dbo.usp_Assistant_InsertCase @id,@reference,@userId,N'alert',@title,@description,@urgency,@lang,@conversationId,@unit,@owner;
        UPDATE dbo.cases SET routing_topic=@code,routing_service_code=CASE @code
            WHEN N'campus_maintenance' THEN N'housing' WHEN N'campus_security' THEN N'security'
            WHEN N'campus_fire' THEN N'safety_emergency' ELSE N'general' END WHERE id=@id AND student_id=@userId;
        COMMIT;
        SELECT @unit AS UnitId,@owner AS OwnerId,@unitEn AS UnitEn,@unitAr AS UnitAr;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Career_CreateCounsellingCase
    @caseId uniqueidentifier,@reference nvarchar(100),@id uniqueidentifier,@unit uniqueidentifier=NULL,
    @owner uniqueidentifier=NULL,@description nvarchar(max),@status nvarchar(50),@lang nvarchar(10),
    @method nvarchar(50),@meta nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@id,0,@owner OUTPUT,@method OUTPUT;
        SET @status=CASE WHEN @owner IS NULL THEN N'routed' ELSE N'assigned' END;
        INSERT dbo.cases(id,case_number,student_id,case_type,service_unit_id,title,description,status,urgency,language,
            assigned_to,first_response_due_at,resolution_due_at,next_action_en,current_responsible_actor,
            entry_channel,assignment_method,assigned_at,needs_assignment_attention)
        VALUES(@caseId,@reference,@id,N'query',@unit,N'Career counselling request',@description,@status,N'medium',@lang,
            @owner,DATEADD(hour,24,SYSDATETIMEOFFSET()),DATEADD(day,10,SYSDATETIMEOFFSET()),
            N'A career counsellor will review your request',N'service_owner',N'shortcut',@method,
            CASE WHEN @owner IS NOT NULL THEN SYSDATETIMEOFFSET() END,CASE WHEN @owner IS NULL THEN 1 ELSE 0 END);
        MERGE dbo.student_career_profiles AS t USING(SELECT @id student_id) s ON t.student_id=s.student_id
        WHEN MATCHED THEN UPDATE SET counsellor_requested=1,shared_with_counsellor=1,updated_at=SYSDATETIMEOFFSET()
        WHEN NOT MATCHED THEN INSERT(student_id,counsellor_requested,shared_with_counsellor) VALUES(@id,1,1);
        INSERT dbo.case_status_history(case_id,from_status,to_status,changed_by,note)
            VALUES(@caseId,NULL,@status,@id,N'Career counselling request submitted');
        INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(@id,N'career.counselling.requested',N'case',@caseId,@meta);
        UPDATE dbo.staff_profiles SET last_assigned_at=SYSDATETIMEOFFSET() WHERE user_id=@owner;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
-- INSERT-only guards: do not backfill or block unrelated edits to legacy tickets.
-- Validate every row in a bulk insert; one invalid row rejects the whole statement.
IF OBJECT_ID(N'dbo.cases', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP trg_Cases_RequireAssignment — dbo.cases missing.';
ELSE
BEGIN
    EXEC(N'
CREATE OR ALTER TRIGGER dbo.trg_Cases_RequireAssignment ON dbo.cases AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS(SELECT 1 FROM inserted i WHERE NOT EXISTS(SELECT 1 FROM dbo.service_units u WHERE u.id=i.service_unit_id AND u.is_active=1)
        OR (i.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates(i.service_unit_id,i.student_id,i.is_sensitive,i.assigned_to)))
        OR (i.assigned_to IS NULL AND (COALESCE(i.assignment_method,N'''')<>N''unit_queue'' OR i.needs_assignment_attention<>1
            OR NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignment(i.service_unit_id,i.student_id,i.is_sensitive,NULL) r WHERE r.Owner IS NULL))))
        THROW 51027, ''A ticket requires a valid staff assignment or the responsible unit queue fallback.'', 1;
END;');
    PRINT N'[sanadi_AIDI] ALTER/CREATE trg_Cases_RequireAssignment.';
END;
GO
IF OBJECT_ID(N'dbo.suggestions', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP trg_Suggestions_RequireAssignment — dbo.suggestions missing.';
ELSE
BEGIN
    EXEC(N'
CREATE OR ALTER TRIGGER dbo.trg_Suggestions_RequireAssignment ON dbo.suggestions AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS(SELECT 1 FROM inserted i WHERE NOT EXISTS(SELECT 1 FROM dbo.service_units u WHERE u.id=i.service_unit_id AND u.is_active=1)
        OR (i.assigned_staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates(i.service_unit_id,i.student_id,0,i.assigned_staff_id)))
        OR (i.assigned_staff_id IS NULL AND NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignment(i.service_unit_id,i.student_id,0,NULL) r WHERE r.Owner IS NULL)))
        THROW 51027, ''A suggestion requires a valid staff assignment or the responsible unit queue fallback.'', 1;
END;');
    PRINT N'[sanadi_AIDI] ALTER/CREATE trg_Suggestions_RequireAssignment.';
END;
GO
-- Existing owner/staff Assign action also clears the queue-fallback marker.
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_Assign
    @id uniqueidentifier,@target uniqueidentifier,@unit uniqueidentifier=NULL,@actor uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        INSERT dbo.case_assignments(case_id,assigned_to,service_unit_id,assigned_by) VALUES(@id,@target,@unit,@actor);
        UPDATE dbo.cases SET assigned_to=@target,status=N'assigned',last_activity_at=SYSDATETIMEOFFSET(),
            next_action_en=N'Assigned officer to acknowledge',needs_assignment_attention=0,
            assigned_at=COALESCE(assigned_at,SYSDATETIMEOFFSET()),
            assignment_method=CASE WHEN assignment_method=N'unit_queue' THEN N'manual' ELSE assignment_method END
        WHERE id=@id;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
-- Preserve the generic data API's contract. Only ticket INSERTs gain assignment
-- resolution and OUTPUT INTO (required on a table with an INSERT trigger).
-- Other tables and all existing update/delete/filter behavior are unchanged.
CREATE OR ALTER PROCEDURE dbo.usp_Data_Write
    @schemaName sysname,@tableName sysname,@operation nvarchar(30),@values nvarchar(max)=N'[]',
    @columns nvarchar(max)=N'["*"]',@filters nvarchar(max)=N'[]',
    @scope nvarchar(max)=N'{"Mode":"none"}',@userId uniqueidentifier=NULL,@returnRows bit=0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @select nvarchar(max),@where nvarchar(max),@sql nvarchar(max),@sets nvarchar(max),
        @names nvarchar(max),@literals nvarchar(max),
        @target nvarchar(520)=QUOTENAME(@schemaName)+N'.'+QUOTENAME(@tableName);
    EXEC dbo.usp_Data_Columns @schemaName,@tableName,@columns,@select OUTPUT;
    EXEC dbo.usp_Data_BuildWhere @schemaName,@tableName,@filters,@scope,@where OUTPUT;
    IF @operation=N'delete'
        SET @sql=N'DELETE FROM '+@target
            +CASE WHEN @returnRows=1 THEN N' OUTPUT DELETED.'+REPLACE(@select,N', ',N', DELETED.') ELSE N'' END+@where;
    ELSE
    BEGIN
        IF EXISTS(SELECT 1 FROM OPENJSON(@values) j WHERE NOT EXISTS
            (SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(@target) AND c.name=JSON_VALUE(j.[value],'$.Column')))
            THROW 50001, 'Invalid mutation column.', 1;
        DECLARE @fields TABLE(ordinal int,name nvarchar(258),literal nvarchar(max));
        INSERT @fields SELECT CONVERT(int,j.[key]),QUOTENAME(JSON_VALUE(j.[value],'$.Column')),dbo.ufn_Data_Value(v.[value],v.[type])
            FROM OPENJSON(@values) j CROSS APPLY OPENJSON(j.[value]) v WHERE v.[key]=N'Value';
        DECLARE @ticket bit=CASE WHEN @schemaName=N'dbo' AND @tableName IN(N'cases',N'suggestions') AND @operation=N'insert' THEN 1 ELSE 0 END;
        IF @ticket=1
        BEGIN
            DECLARE @unit uniqueidentifier,@requester uniqueidentifier,@owner uniqueidentifier,@method nvarchar(50),@sensitive bit=0,
                @ownerColumn sysname=CASE WHEN @tableName=N'cases' THEN N'assigned_to' ELSE N'assigned_staff_id' END;
            SELECT @unit=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.[value],'$.Value')) FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=N'service_unit_id';
            SELECT @requester=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.[value],'$.Value')) FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=N'student_id';
            SELECT @owner=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.[value],'$.Value')) FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=@ownerColumn;
            SELECT @sensitive=CASE WHEN JSON_VALUE(j.[value],'$.Value') IN(N'true',N'1') THEN 1 ELSE 0 END FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=N'is_sensitive';
            EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@requester,@sensitive,@owner OUTPUT,@method OUTPUT;
            DELETE FROM @fields WHERE name=N'[service_unit_id]';
            INSERT @fields VALUES(99999,N'[service_unit_id]',dbo.ufn_Data_Value(CONVERT(nvarchar(36),@unit),1));
            DELETE FROM @fields WHERE name=QUOTENAME(@ownerColumn);
            INSERT @fields VALUES(100000,QUOTENAME(@ownerColumn),dbo.ufn_Data_Value(CONVERT(nvarchar(36),@owner),1));
            DECLARE @initialStatus nvarchar(50)=CASE WHEN @owner IS NOT NULL THEN N'assigned' WHEN @tableName=N'cases' THEN N'routed' ELSE N'submitted' END;
            IF NOT EXISTS(SELECT 1 FROM @fields WHERE name=N'[status]') INSERT @fields VALUES(100001,N'[status]',dbo.ufn_Data_Value(@initialStatus,1));
            UPDATE @fields SET literal=dbo.ufn_Data_Value(@initialStatus,1) WHERE name=N'[status]' AND literal IN(N'N''submitted''',N'N''routed''',N'N''classified''',N'N''assigned''');
            IF @tableName=N'cases'
            BEGIN
                DELETE FROM @fields WHERE name IN(N'[assigned_at]',N'[assignment_method]',N'[needs_assignment_attention]');
                INSERT @fields VALUES(100002,N'[assigned_at]',CASE WHEN @owner IS NOT NULL THEN N'SYSDATETIMEOFFSET()' ELSE N'NULL' END),
                    (100003,N'[assignment_method]',dbo.ufn_Data_Value(@method,1)),(100004,N'[needs_assignment_attention]',CASE WHEN @owner IS NULL THEN N'1' ELSE N'0' END);
                IF @owner IS NULL
                BEGIN
                    DELETE FROM @fields WHERE name IN(N'[current_responsible_actor]',N'[human_review_required]');
                    INSERT @fields VALUES(100005,N'[current_responsible_actor]',N'N''service_owner'''),(100006,N'[human_review_required]',N'1');
                END;
            END;
        END;
        SELECT @names=STRING_AGG(CONVERT(nvarchar(max),name),N', ') WITHIN GROUP(ORDER BY ordinal) FROM @fields;
        SELECT @literals=STRING_AGG(literal,N', ') WITHIN GROUP(ORDER BY ordinal) FROM @fields;
        SELECT @sets=STRING_AGG(CONVERT(nvarchar(max),name)+N' = '+literal,N', ') WITHIN GROUP(ORDER BY ordinal) FROM @fields;
        IF @sets IS NULL THROW 50001, 'Empty mutation payload.', 1;
        IF @operation=N'insert' AND @ticket=1
            SET @sql=N'BEGIN TRY BEGIN TRANSACTION; SELECT TOP(0) * INTO #newTicket FROM '+@target+N'; INSERT INTO '+@target
                +N' ('+@names+N') OUTPUT INSERTED.* INTO #newTicket VALUES ('+@literals+N'); '
                +N'UPDATE dbo.staff_profiles SET last_assigned_at=SYSDATETIMEOFFSET() WHERE user_id=@ticketOwner; COMMIT; '
                +N'SELECT * FROM #newTicket; END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;';
        ELSE IF @operation=N'insert'
            SET @sql=N'INSERT INTO '+@target+N' ('+@names+N') OUTPUT INSERTED.* VALUES ('+@literals+N')';
        ELSE IF @operation=N'updateExisting'
            SET @sql=N'UPDATE '+@target+N' SET '+@sets+N' OUTPUT INSERTED.*'+@where;
        ELSE IF @operation=N'update'
            SET @sql=N'UPDATE '+@target+N' SET '+@sets+@where+CASE WHEN @returnRows=1 THEN N'; SELECT '+@select+N' FROM '+@target+@where ELSE N'' END;
        ELSE THROW 50001, 'Invalid data mutation operation.', 1;
    END;
    EXEC sys.sp_executesql @sql,N'@rlsUser uniqueidentifier,@ticketOwner uniqueidentifier',@userId,@owner;
END;
GO
/* ========== END: 2026-10-27-required-ticket-assignment.sql ========== */
GO

/* ========== BEGIN: replace localhost:8080 UI URLs ========== */
/*
  UPDATE-only rewrite of local UI host → https://sanadi-beta.uaeu.ac.ae.
  No INSERT. Rows already on the hosted UI origin are left unchanged.
  Does not modify API callback URLs on localhost:5281.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @NewUiOrigin nvarchar(200) = N'https://sanadi-beta.uaeu.ac.ae';
DECLARE @uiRows int = 0, @notifyRows int = 0;

IF OBJECT_ID(N'dbo.ApplicationSettings', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP SsoUiOrigin URL rewrite — dbo.ApplicationSettings missing.';
ELSE
BEGIN
    UPDATE dbo.ApplicationSettings
    SET SsoUiOrigin = REPLACE(REPLACE(REPLACE(REPLACE(
            SsoUiOrigin,
            N'http://localhost://8080', @NewUiOrigin),
            N'https://localhost://8080', @NewUiOrigin),
            N'http://localhost:8080', @NewUiOrigin),
            N'https://localhost:8080', @NewUiOrigin),
        UpdatedAtUtc = SYSDATETIMEOFFSET()
    WHERE SsoUiOrigin LIKE N'%localhost%8080%';
    SET @uiRows = @@ROWCOUNT;
    PRINT CONCAT(N'[sanadi_AIDI] ApplicationSettings.SsoUiOrigin rows updated=', CONVERT(nvarchar(20), @uiRows),
                 N' (0 means already hosted / no localhost:8080).');
END;

IF OBJECT_ID(N'dbo.notification_settings', N'U') IS NULL
    PRINT N'[sanadi_AIDI] SKIP public_app_url rewrite — dbo.notification_settings missing.';
ELSE
BEGIN
    UPDATE dbo.notification_settings
    SET public_app_url = REPLACE(REPLACE(REPLACE(REPLACE(
            public_app_url,
            N'http://localhost://8080', @NewUiOrigin),
            N'https://localhost://8080', @NewUiOrigin),
            N'http://localhost:8080', @NewUiOrigin),
            N'https://localhost:8080', @NewUiOrigin),
        updated_at = SYSDATETIMEOFFSET()
    WHERE public_app_url LIKE N'%localhost%8080%';
    SET @notifyRows = @@ROWCOUNT;
    PRINT CONCAT(N'[sanadi_AIDI] notification_settings.public_app_url rows updated=', CONVERT(nvarchar(20), @notifyRows),
                 N' (0 means already hosted / no localhost:8080).');
END;

-- Sweep remaining string columns that still embed the local UI host
-- (for example email template bodies). Skip views and computed columns.
DECLARE @sql nvarchar(max) = N'';
SELECT @sql = @sql + N'
UPDATE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N'
SET ' + QUOTENAME(c.name) + N' = REPLACE(REPLACE(REPLACE(REPLACE('
    + QUOTENAME(c.name) + N',
        N''http://localhost://8080'', @NewUiOrigin),
        N''https://localhost://8080'', @NewUiOrigin),
        N''http://localhost:8080'', @NewUiOrigin),
        N''https://localhost:8080'', @NewUiOrigin)
WHERE ' + QUOTENAME(c.name) + N' LIKE N''%localhost%8080%'';'
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.is_computed = 0
  AND c.is_filestream = 0
  AND ty.name IN (N'nvarchar', N'varchar', N'nchar', N'char')
  AND NOT (
        (s.name = N'dbo' AND t.name = N'ApplicationSettings' AND c.name = N'SsoUiOrigin')
     OR (s.name = N'dbo' AND t.name = N'notification_settings' AND c.name = N'public_app_url')
  );

IF NULLIF(LTRIM(RTRIM(@sql)), N'') IS NOT NULL
BEGIN
    EXEC sys.sp_executesql @sql, N'@NewUiOrigin nvarchar(200)', @NewUiOrigin;
    PRINT N'[sanadi_AIDI] Broad localhost:8080 string-column sweep executed (UPDATE only where matched).';
END
ELSE
    PRINT N'[sanadi_AIDI] SKIP broad URL sweep — no eligible columns.';

IF OBJECT_ID(N'dbo.ApplicationSettings', N'U') IS NOT NULL
    SELECT TOP (1) Id, IsActive, IsProductionEntry, SsoUiOrigin, SsoRedirectUri
    FROM dbo.ApplicationSettings
    WHERE IsActive = 1
    ORDER BY UpdatedAtUtc DESC, Id DESC;

IF OBJECT_ID(N'dbo.notification_settings', N'U') IS NOT NULL
    SELECT id, public_app_url, emails_enabled, demo_email_mode
    FROM dbo.notification_settings;

PRINT N'[sanadi_AIDI] Completed. Re-run is safe: inserts skip duplicates; objects ALTER in place.';
GO
/* ========== END: replace localhost:8080 UI URLs ========== */
GO
