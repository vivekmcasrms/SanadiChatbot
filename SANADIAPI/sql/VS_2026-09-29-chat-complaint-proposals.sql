-- Read the authenticated student's stored proposal before executing a confirmed complaint.
-- Routing continues to use the active AI/catalogue and existing interaction procedures.
-- No service mapping or response text is embedded in SQL.
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetComplaintProposal
    @userId uniqueidentifier,
    @conversationId uniqueidentifier,
    @messageId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.metadata
    FROM dbo.messages m
    JOIN dbo.conversations c ON c.id = m.conversation_id
    WHERE c.id = @conversationId AND c.user_id = @userId
      AND m.id = @messageId AND m.role = N'assistant';
END;
GO

-- Preserve the existing form workflow; chat supplies its actual entry channel.
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_InsertCase
  @caseId uniqueidentifier,
  @referenceNo nvarchar(100),
  @user uniqueidentifier,
  @type nvarchar(50),
  @category uniqueidentifier = NULL,
  @unit uniqueidentifier = NULL,
  @title nvarchar(200),
  @description nvarchar(max),
  @status nvarchar(50),
  @priority nvarchar(50),
  @severity nvarchar(50),
  @lang nvarchar(10),
  @hint nvarchar(100) = NULL,
  @automation nvarchar(50),
  @alert nvarchar(100) = NULL,
  @location nvarchar(300) = NULL,
  @sensitive bit,
  @sensitivity nvarchar(50),
  @human bit,
  @attention nvarchar(100) = NULL,
  @confidentiality nvarchar(50),
  @incident nvarchar(50) = NULL,
  @desired nvarchar(max) = NULL,
  @conversation uniqueidentifier = NULL,
  @service nvarchar(100),
  @topic nvarchar(100) = NULL,
  @root nvarchar(100) = NULL,
  @reasonEn nvarchar(max),
  @reasonAr nvarchar(max),
  @confidence float,
  @owner uniqueidentifier = NULL,
  @method nvarchar(50),
  @action nvarchar(100),
  @meta nvarchar(max),
  @channel nvarchar(50) = N'shortcut'
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.cases(
    id, case_number, student_id, case_type, category_id, service_unit_id, title, description, status,
    urgency, severity, language, entry_channel, shortcut_hint, current_responsible_actor, automation_level,
    alert_type, alert_location, is_sensitive, sensitivity_level, human_review_required, attention_reason,
    confidentiality, incident_date, desired_resolution, related_conversation_id, routing_service_code,
    routing_topic, root_cause_code, routing_reason_en, routing_reason_ar, routing_confidence, ai_confidence,
    assigned_to, assigned_at, assignment_method, first_response_due_at, resolution_due_at)
  VALUES(
    @caseId, @referenceNo, @user, @type, @category, @unit, @title, @description, @status,
    @priority, @severity, @lang, @channel, @hint, N'service_owner', @automation,
    @alert, @location, @sensitive, @sensitivity, @human, @attention,
    @confidentiality, TRY_CONVERT(date, @incident), @desired, @conversation, @service,
    @topic, @root, @reasonEn, @reasonAr, @confidence, @confidence,
    @owner, CASE WHEN @owner IS NULL THEN NULL ELSE SYSDATETIMEOFFSET() END, @method,
    DATEADD(hour, 24, SYSDATETIMEOFFSET()), DATEADD(day, 10, SYSDATETIMEOFFSET()));
  INSERT INTO dbo.case_status_history(case_id, to_status, changed_by, note)
  VALUES(@caseId, @status, @user, @reasonEn);
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES(@user, @action, N'case', @caseId, @meta);
END
GO

