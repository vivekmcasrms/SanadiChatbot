-- In-app notification push helpers (students / staff / admins).
-- Idempotent via dedupe_key. Safe to re-run.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Notify_PushInApp
  @type nvarchar(100),
  @recipient uniqueidentifier,
  @entityId uniqueidentifier,
  @caseId uniqueidentifier = NULL,
  @unit uniqueidentifier = NULL,
  @actor uniqueidentifier = NULL,
  @body nvarchar(max),
  @url nvarchar(500),
  @title nvarchar(200) = N'Update',
  @key nvarchar(300)
AS
BEGIN
  SET NOCOUNT ON;
  IF @recipient IS NULL RETURN;
  IF EXISTS (SELECT 1 FROM dbo.notification_events WHERE dedupe_key = @key) RETURN;
  INSERT INTO dbo.notification_events(
    event_type, entity_type, entity_id, recipient_profile_id, channel,
    title, body, action_url, status, case_id, service_unit_id, triggered_by, dedupe_key)
  VALUES(
    @type, N'case', @entityId, @recipient, N'in_app',
    @title, @body, @url, N'pending', @caseId, @unit, @actor, @key);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Notify_PushCaseAssignedStudent
  @caseId uniqueidentifier,
  @studentId uniqueidentifier,
  @assigneeId uniqueidentifier,
  @unitId uniqueidentifier = NULL,
  @actor uniqueidentifier = NULL,
  @caseNumber nvarchar(100),
  @unitLabel nvarchar(200) = NULL,
  @key nvarchar(300)
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.notification_events WHERE dedupe_key = @key) RETURN;

  DECLARE @staffName nvarchar(200) = NULL, @staffEmail nvarchar(320) = NULL, @unitName nvarchar(200) = @unitLabel;

  SELECT @staffName = p.full_name, @staffEmail = p.email
  FROM dbo.profiles p WHERE p.id = @assigneeId;

  IF @unitName IS NULL AND @unitId IS NOT NULL
    SELECT @unitName = COALESCE(NULLIF(u.code, N''), u.name_en)
    FROM dbo.service_units u WHERE u.id = @unitId;

  SET @unitName = COALESCE(@unitName, N'the responsible unit');
  SET @staffName = COALESCE(@staffName, N'a staff member');

  DECLARE @body nvarchar(max) =
    N'Request ' + @caseNumber + N' is with ' + @unitName + N' - ' + @staffName
    + CASE WHEN @staffEmail IS NULL OR @staffEmail = N'' THEN N'' ELSE N' (' + @staffEmail + N')' END
    + N' is following it up';

  INSERT INTO dbo.notification_events(
    event_type, entity_type, entity_id, recipient_profile_id, channel,
    title, body, action_url, status, case_id, service_unit_id, triggered_by, dedupe_key)
  VALUES(
    N'case_assigned', N'case', @caseId, @studentId, N'in_app',
    N'Assigned to Staff', @body, N'/requests/' + CONVERT(nvarchar(36), @caseId),
    N'pending', @caseId, @unitId, @actor, @key);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListAdminRecipients
AS
BEGIN
  SET NOCOUNT ON;
  SELECT DISTINCT ur.user_id
  FROM dbo.user_roles ur
  WHERE ur.role IN (N'system_admin', N'service_manager');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Monitor_GetCaseForUpdate @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id Id, case_number CaseNumber, service_unit_id UnitId, assigned_to OwnerId,
       escalation_level EscalationLevel, student_id StudentId
FROM dbo.cases WITH (UPDLOCK) WHERE id = @CaseId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Access_NotifyReassign
  @caseId uniqueidentifier, @next uniqueidentifier, @number nvarchar(100)=NULL, @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,payload,status,dedupe_key,case_id,triggered_by)
SELECT N'new_assignment',N'case',@caseId,@next,N'in_app',N'New case assignment',N'New case assigned to you: '+COALESCE(@number,N''),N'/requests/'+CONVERT(nvarchar(36),@caseId),N'{}',N'pending',N'revoke-reassign:'+CONVERT(nvarchar(36),@caseId)+N':'+CONVERT(nvarchar(36),@next),@caseId,@actor
WHERE NOT EXISTS(SELECT 1 FROM dbo.notification_events WHERE dedupe_key=N'revoke-reassign:'+CONVERT(nvarchar(36),@caseId)+N':'+CONVERT(nvarchar(36),@next));
END
GO
