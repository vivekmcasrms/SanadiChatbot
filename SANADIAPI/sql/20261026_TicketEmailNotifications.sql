/*
  Customer Pulse survey setting lookup for an emailed ticket link.
  The application passes SsoRouting:IsProductionEntry as @IsProduction.
  Adds survey lookups, encrypted delegated-token storage, email templates and
  procedures for the C# dispatcher. Existing ticket procedures and configuration
  values are preserved. It is safe to rerun; activation time is not reset.
*/
IF OBJECT_ID(N'dbo.CustomerPulseSetting', N'U') IS NULL
    THROW 51000, 'dbo.CustomerPulseSetting is required for survey settings.', 1;
GO

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
    WHERE LOWER(ServiceType) = CASE WHEN LOWER(@ServiceType) = 'query' THEN 'inquiry' ELSE LOWER(@ServiceType) END
      AND IsProduction = @IsProduction
      AND IsEnabled = 1
    ORDER BY UpdatedAtUtc DESC, Id DESC;
END;
GO

-- Ticket email backend migration. Apply before deploying the C# dispatcher.
-- No ticket, SSO setting, provider credential or existing template is overwritten.
IF OBJECT_ID(N'auth.login_sessions', N'U') IS NULL OR OBJECT_ID(N'auth.refresh_tokens', N'U') IS NULL
    THROW 51000, 'Existing Sanadi login-session migration is required.', 1;
GO
IF OBJECT_ID(N'auth.sso_email_tokens', N'U') IS NULL
CREATE TABLE auth.sso_email_tokens (
    session_id uniqueidentifier NOT NULL PRIMARY KEY,
    user_id uniqueidentifier NOT NULL,
    protected_tokens nvarchar(max) NOT NULL,
    lease_id uniqueidentifier NULL,
    lease_until datetimeoffset NULL,
    updated_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
IF OBJECT_ID(N'dbo.ticket_email_activation', N'U') IS NULL
CREATE TABLE dbo.ticket_email_activation (
    id bit NOT NULL PRIMARY KEY CHECK(id=1),
    activated_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
IF NOT EXISTS(SELECT 1 FROM dbo.ticket_email_activation WHERE id=1)
    INSERT dbo.ticket_email_activation(id) VALUES(1);
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
-- Existing database email templates remain administrator-editable. Seed only new codes.
INSERT dbo.email_templates(template_code,name_en,name_ar,subject_en,subject_ar,body_en,body_ar,enabled,version,severity)
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
