/*
  SanadiChatbotProd — 2026-10-28 (SAFE RE-RUN)
  Views / procedures / functions / triggers: CREATE OR ALTER only.
  Application-used procedures + nested dependencies only.
  INDEXES OMITTED — dropping PKs/unique constraints on a live DB breaks FKs.
  Safe to re-execute: existing objects are altered, not duplicated.
*/
USE [SanadiChatbotProd];
GO
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ========== FUNCTIONS (application-used) ========== */
GO
/* FUNCTION [dbo].[ufn_Data_Filter] */
CREATE OR ALTER FUNCTION dbo.ufn_Data_Filter(@filter nvarchar(max), @schemaName sysname, @tableName sysname)
RETURNS nvarchar(max)
AS
BEGIN
  DECLARE @column sysname = JSON_VALUE(@filter, '$.Column'),
          @op nvarchar(30) = JSON_VALUE(@filter, '$.Operator'),
          @negated bit = CASE WHEN JSON_VALUE(@filter, '$.Negated') = N'true' THEN 1 ELSE 0 END,
          @relation sysname = JSON_VALUE(@filter, '$.Relation'),
          @value nvarchar(max), @type int, @literal nvarchar(max), @clause nvarchar(max), @col nvarchar(300);
  SELECT @value = [value], @type = [type] FROM OPENJSON(@filter) WHERE [key] = N'Value';
  SET @literal = dbo.ufn_Data_Value(@value, @type);
  SET @col = CASE WHEN @relation IS NULL THEN N'' ELSE N'e.' END + QUOTENAME(@column);
  IF @op = N'in'
  BEGIN
    SELECT @literal = STRING_AGG(CONVERT(nvarchar(max), dbo.ufn_Data_Value([value], [type])), N', ')
      WITHIN GROUP (ORDER BY CONVERT(int, [key])) FROM OPENJSON(@value);
    SET @clause = CASE WHEN @literal IS NULL
      THEN CASE WHEN @negated = 1 THEN N'1 = 1' ELSE N'1 = 0' END
      ELSE @col + CASE WHEN @negated = 1 THEN N' NOT IN (' ELSE N' IN (' END + @literal + N')' END;
  END
  ELSE IF @op = N'isnull'
    SET @clause = @col + CASE WHEN @negated = 1 THEN N' IS NOT NULL' ELSE N' IS NULL' END;
  ELSE
  BEGIN
    SET @clause = CASE WHEN @op IN (N'cs', N'cd') THEN N'CONVERT(nvarchar(max), ' + @col + N')' ELSE @col END
      + CASE @op WHEN N'neq' THEN N' <> ' WHEN N'gt' THEN N' > ' WHEN N'gte' THEN N' >= '
          WHEN N'lt' THEN N' < ' WHEN N'lte' THEN N' <= '
          WHEN N'like' THEN N' LIKE ' WHEN N'ilike' THEN N' LIKE '
          WHEN N'cs' THEN N' LIKE ' WHEN N'cd' THEN N' LIKE ' ELSE N' = ' END + @literal;
    IF @negated = 1 SET @clause = N'NOT (' + @clause + N')';
  END;
  IF @relation IS NOT NULL
    SET @clause = N'EXISTS (SELECT 1 FROM [dbo].' + QUOTENAME(@relation) + N' e WHERE e.'
      + QUOTENAME(JSON_VALUE(@filter, '$.ForeignColumn')) + N' = '
      + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) + N'.' + QUOTENAME(JSON_VALUE(@filter, '$.LocalColumn'))
      + N' AND ' + @clause + N')';
  RETURN @clause;
END;
GO

/* ========== VIEWS ========== */
GO
/* VIEW [dbo].[vw_AISettings_Compatibility] */
CREATE OR ALTER VIEW dbo.vw_AISettings_Compatibility
AS
SELECT
    a.AiSettingId AS id,
    LOWER(LTRIM(RTRIM(a.ProviderCode))) AS provider,
    a.Model AS model_name,
    COALESCE(a.EmbeddingModel, N'') AS embedding_model,
    a.ApiKey AS api_key,
    CASE WHEN p.ChatPath = N'' OR RIGHT(p.BaseUrl, LEN(p.ChatPath) + 1) = N'/' + p.ChatPath
         THEN p.BaseUrl ELSE p.BaseUrl + N'/' + p.ChatPath END AS api_url,
    a.FallbackProvider AS fallback_provider,
    a.FallbackModel AS fallback_model,
    COALESCE(a.ReasoningEffort, N'none') AS reasoning_effort,
    CAST(COALESCE(a.Temperature, 0.2) AS decimal(18,6)) AS temperature,
    COALESCE(a.MaxTokens, 1200) AS max_output_tokens,
    COALESCE(a.ConfidenceThreshold, 0.55) AS confidence_threshold,
    COALESCE(a.HandoffThreshold, 0.4) AS handoff_threshold,
    COALESCE(a.RetrievalTopK, 6) AS retrieval_top_k,
    COALESCE(a.MaxToolCalls, 8) AS max_tool_calls,
    CONVERT(int, CONVERT(bigint, a.TimeoutSeconds) * 1000) AS request_timeout_ms,
    a.IsEnabled AS ai_enabled,
    a.UpdatedBy AS updated_by,
    TODATETIMEOFFSET(a.CreatedAt, '+00:00') AS created_at,
    TODATETIMEOFFSET(a.UpdatedAt, '+00:00') AS updated_at,
    a.IsEnabled AS is_enabled,
    CAST(COALESCE(a.EnableThinking, 0) AS bit) AS enable_thinking
FROM dbo.AISettings a
CROSS APPLY (SELECT TRIM(N'/' FROM LTRIM(RTRIM(a.BaseUrl))) AS BaseUrl,
                   TRIM(N'/' FROM LTRIM(RTRIM(COALESCE(a.ChatPath, N'')))) AS ChatPath) p;
GO

/* ========== STORED PROCEDURES (application-used + deps) ========== */
GO
/* SKIP [dbo].[usp_Acceptance_GetCounts] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Acceptance_LatestResolvedCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Acceptance_LatestResolvedCase
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) id FROM dbo.cases WHERE status IN (N'resolved',N'closed') ORDER BY resolved_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Acceptance_LatestTimelineCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Acceptance_LatestTimelineCase
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) case_id FROM dbo.case_status_history ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Access_Audit] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_Audit
  @actor uniqueidentifier, @action nvarchar(100), @subject uniqueidentifier, @metadata nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(@actor,@action,N'profile',@subject,@metadata);
END
GO

/* PROCEDURE [dbo].[usp_Access_FindDesk] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_FindDesk @unitId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1) id FROM dbo.service_units WHERE code IN (N'SERVICE_DESK',N'SD',N'HD') AND is_active=1 AND id<>@unitId
ORDER BY CASE code WHEN N'SERVICE_DESK' THEN 0 WHEN N'SD' THEN 1 ELSE 2 END;
END
GO

/* PROCEDURE [dbo].[usp_Access_ListAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_ListAudit
AS BEGIN SET NOCOUNT ON;
SELECT TOP (50) a.id,a.action,a.created_at [at],actor.full_name actorName,subject.full_name subjectName,
  JSON_VALUE(a.metadata,'$.reason') reason,TRY_CONVERT(int,JSON_VALUE(a.metadata,'$.reassigned')) reassigned
FROM dbo.audit_logs a LEFT JOIN dbo.profiles actor ON actor.id=a.actor_id LEFT JOIN dbo.profiles subject ON subject.id=a.entity_id
WHERE a.action IN (N'staff_access_revoked',N'staff_access_restored',N'role_granted',N'role_revoked') ORDER BY a.created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Access_ListOpenCases] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_ListOpenCases @id uniqueidentifier, @open nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT TOP (500) id Id,service_unit_id UnitId,case_number CaseNumber FROM dbo.cases
WHERE assigned_to=@id AND status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@open,','));
END
GO

/* PROCEDURE [dbo].[usp_Access_ListRoles] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_ListRoles @id uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT role FROM dbo.user_roles WHERE user_id=@id; END
GO

/* PROCEDURE [dbo].[usp_Access_ListStaff] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_ListStaff @open nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT p.id UserId, p.full_name FullName, p.email Email,
       p.access_revoked_at RevokedAt, p.access_revoked_reason RevokedReason,
       (SELECT COUNT(1) FROM dbo.cases c WHERE c.assigned_to=p.id AND c.status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@open,','))) OpenCases
FROM dbo.profiles p
WHERE EXISTS (SELECT 1 FROM dbo.user_roles r WHERE r.user_id=p.id AND r.role<>N'student')
ORDER BY COALESCE(p.full_name, N''), p.id;
END
GO

/* PROCEDURE [dbo].[usp_Access_ListWorkload] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_ListWorkload @unitId uniqueidentifier, @open nvarchar(max)
AS BEGIN SET NOCOUNT ON;
;WITH members AS (
  SELECT user_id id FROM dbo.staff_profiles WHERE service_unit_id=@unitId
  UNION SELECT staff_profile_id FROM dbo.service_staff WHERE service_unit_id=@unitId AND is_active=1
), loads AS (
  SELECT m.id,COUNT(c.id) activeCases,
    COALESCE(SUM(CASE WHEN c.status IN (N'awaiting_student',N'student_confirmation') THEN .5 WHEN c.id IS NULL THEN 0 ELSE 1 END),0) workload
  FROM members m LEFT JOIN dbo.cases c ON c.assigned_to=m.id AND c.status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@open,',')) GROUP BY m.id
)
SELECT l.id staffId,p.full_name fullName,p.email,l.workload,l.activeCases,sp.last_assigned_at lastAssignedAt,
       CAST(COALESCE(sp.is_active,0) AS bit) isActive,COALESCE(sp.availability_status,N'available') availability
FROM loads l LEFT JOIN dbo.profiles p ON p.id=l.id LEFT JOIN dbo.staff_profiles sp ON sp.user_id=l.id
ORDER BY l.workload DESC,COALESCE(p.full_name,N'');
END
GO

/* PROCEDURE [dbo].[usp_Access_NotifyReassign] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_NotifyReassign
  @caseId uniqueidentifier, @next uniqueidentifier, @number nvarchar(100)=NULL, @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,title,body,action_url,payload,status,dedupe_key,case_id,triggered_by)
SELECT N'new_assignment',N'case',@caseId,@next,N'New case assignment',N'Case '+COALESCE(@number,N'')+N' has been assigned to you.',N'/requests/'+CONVERT(nvarchar(36),@caseId),N'{}',N'pending',N'revoke-reassign:'+CONVERT(nvarchar(36),@caseId)+N':'+CONVERT(nvarchar(36),@next),@caseId,@actor
WHERE NOT EXISTS(SELECT 1 FROM dbo.notification_events WHERE dedupe_key=N'revoke-reassign:'+CONVERT(nvarchar(36),@caseId)+N':'+CONVERT(nvarchar(36),@next));
END
GO

/* PROCEDURE [dbo].[usp_Access_OwnerWorkload] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_OwnerWorkload @ownerId uniqueidentifier, @open nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT COALESCE(SUM(CASE WHEN status IN (N'awaiting_student',N'student_confirmation') THEN .5 ELSE 1 END),0)
FROM dbo.cases WHERE assigned_to=@ownerId AND status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@open,','));
END
GO

/* PROCEDURE [dbo].[usp_Access_PickCandidate] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_PickCandidate
  @unitId uniqueidentifier, @excluded uniqueidentifier, @caseId uniqueidentifier, @open nvarchar(max)
AS BEGIN SET NOCOUNT ON;
;WITH candidates AS (
  SELECT DISTINCT sp.user_id Id,sp.last_assigned_at
  FROM dbo.staff_profiles sp LEFT JOIN dbo.service_staff ss ON ss.staff_profile_id=sp.user_id AND ss.service_unit_id=@unitId
  WHERE (sp.service_unit_id=@unitId OR (ss.is_active=1 AND ss.can_receive_cases=1)) AND sp.is_active=1
    AND COALESCE(sp.availability_status,N'available')=N'available' AND sp.user_id<>@excluded
    AND NOT EXISTS(SELECT 1 FROM dbo.profiles p WHERE p.id=sp.user_id AND p.access_revoked_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM dbo.case_conflicts_of_interest x WHERE x.case_id=@caseId AND x.profile_id=sp.user_id)
), load AS (
  SELECT c.Id,c.last_assigned_at,COALESCE(SUM(CASE WHEN k.status IN (N'awaiting_student',N'student_confirmation') THEN .5 WHEN k.id IS NULL THEN 0 ELSE 1 END),0) Workload
  FROM candidates c LEFT JOIN dbo.cases k ON k.assigned_to=c.Id AND k.status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@open,',')) GROUP BY c.Id,c.last_assigned_at
) SELECT TOP (1) Id,Workload FROM load ORDER BY Workload,last_assigned_at,Id;
END
GO

/* PROCEDURE [dbo].[usp_Access_PickOwner] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_PickOwner @unitId uniqueidentifier, @excluded uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1) owner_id FROM (
  SELECT primary_service_owner_id owner_id,0 priority FROM dbo.service_units WHERE id=@unitId
  UNION ALL SELECT staff_profile_id,1 FROM dbo.service_unit_owners WHERE service_unit_id=@unitId AND is_active=1
) x WHERE owner_id IS NOT NULL AND owner_id<>@excluded
  AND NOT EXISTS(SELECT 1 FROM dbo.profiles p WHERE p.id=x.owner_id AND p.access_revoked_at IS NOT NULL)
ORDER BY priority;
END
GO

/* PROCEDURE [dbo].[usp_Access_ReassignCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_ReassignCase
  @next uniqueidentifier=NULL, @load decimal(10,2)=NULL, @now datetimeoffset, @caseId uniqueidentifier,
  @unitId uniqueidentifier=NULL, @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET assigned_to=@next, assignment_method=CASE WHEN @next IS NULL THEN NULL ELSE N'ACCESS_WITHDRAWN_REASSIGNMENT' END,
  assigned_at=CASE WHEN @next IS NULL THEN NULL ELSE @now END, workload_at_assignment=@load,
  needs_assignment_attention=CASE WHEN @next IS NULL THEN 1 ELSE 0 END,last_activity_at=@now WHERE id=@caseId;
INSERT dbo.case_assignments(case_id,assigned_to,service_unit_id,assigned_by) VALUES(@caseId,@next,@unitId,@actor);
END
GO

/* PROCEDURE [dbo].[usp_Access_Restore] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_Restore @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.profiles SET access_revoked_at=NULL,access_revoked_by=NULL,access_revoked_reason=NULL WHERE id=@id;
UPDATE dbo.staff_profiles SET is_active=1,availability_status=N'available' WHERE user_id=@id;
UPDATE dbo.service_staff SET is_active=1,can_receive_cases=1 WHERE staff_profile_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Access_Revoke] */
CREATE OR ALTER PROCEDURE dbo.usp_Access_Revoke
  @now datetimeoffset, @actor uniqueidentifier, @reason nvarchar(max), @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.profiles SET access_revoked_at=@now,access_revoked_by=@actor,access_revoked_reason=@reason WHERE id=@id;
UPDATE dbo.staff_profiles SET is_active=0,availability_status=N'unavailable' WHERE user_id=@id;
UPDATE dbo.service_staff SET is_active=0,can_receive_cases=0,can_assign_cases=0 WHERE staff_profile_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_AdminCaseMonitorSummary] */
CREATE OR ALTER PROCEDURE dbo.usp_AdminCaseMonitorSummary
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor IN ('service_owner','specific_officer','manager','staff') THEN 1 ELSE 0 END) AS pendingOwner,
    SUM(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 1 ELSE 0 END) AS responseOverdue,
    SUM(CASE WHEN c.sla_state = 'attention' THEN 1 ELSE 0 END) AS attention,
    SUM(CASE WHEN c.sla_state = 'critical' THEN 1 ELSE 0 END) AS critical,
    SUM(CASE WHEN c.sla_state = 'breached' THEN 1 ELSE 0 END) AS breached,
    SUM(CASE WHEN c.sla_paused_at IS NOT NULL THEN 1 ELSE 0 END) AS paused,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND COALESCE(c.escalation_level,0) > 0 THEN 1 ELSE 0 END) AS escalated,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'student' THEN 1 ELSE 0 END) AS waitingStudent,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'external_party' THEN 1 ELSE 0 END) AS waitingExternal,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'ai' THEN 1 ELSE 0 END) AS aiHandling,
    SUM(CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1 THEN 1 ELSE 0 END) AS criticalAlerts,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND DATEDIFF(HOUR, c.last_activity_at, SYSDATETIMEOFFSET()) >= 24 THEN 1 ELSE 0 END) AS stalled,
    SUM(CASE WHEN c.status IN ('resolved','closed') AND c.resolution_communicated_at IS NULL THEN 1 ELSE 0 END) AS closureIncomplete,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.case_type = 'complaint' THEN 1 ELSE 0 END) AS openComplaints,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.case_type = 'suggestion' THEN 1 ELSE 0 END) AS openSuggestions,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND COALESCE(c.reopened_count,0) > 0 THEN 1 ELSE 0 END) AS reopened,
    SUM(CASE WHEN CONVERT(date, c.created_at) = CONVERT(date, SYSDATETIMEOFFSET()) THEN 1 ELSE 0 END) AS todayHandled,
    SUM(CASE WHEN c.resolved_at IS NOT NULL AND CONVERT(date, c.resolved_at) = CONVERT(date, SYSDATETIMEOFFSET()) THEN 1 ELSE 0 END) AS todayResolved
  FROM [dbo].[cases] c;
END
GO

/* PROCEDURE [dbo].[usp_AdminOwnerMonitor] */
CREATE OR ALTER PROCEDURE dbo.usp_AdminOwnerMonitor
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    p.id AS ownerId, p.full_name AS ownerName,
    MAX(u.name_en) AS unitEn, MAX(u.name_ar) AS unitAr,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS activeCases,
    SUM(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 1 ELSE 0 END) AS overdueResponses,
    SUM(CASE WHEN c.sla_state = 'breached' THEN 1 ELSE 0 END) AS breached,
    SUM(CASE WHEN COALESCE(c.escalation_level,0) > 0 AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS unresolvedEscalations,
    SUM(CASE WHEN c.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS closedCases,
    CAST(NULL AS float) AS slaCompliance,
    CAST(NULL AS float) AS medianResponseHours
  FROM [dbo].[profiles] p
  JOIN [dbo].[cases] c ON c.assigned_to = p.id
  LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
  GROUP BY p.id, p.full_name
  ORDER BY activeCases DESC;
END
GO

/* PROCEDURE [dbo].[usp_AdminUnitMonitor] */
CREATE OR ALTER PROCEDURE dbo.usp_AdminUnitMonitor AS BEGIN SET NOCOUNT ON; SELECT u.id AS unitId, u.name_en AS unitEn, u.name_ar AS unitAr, SUM(CASE WHEN c.id IS NOT NULL AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor IN ('service_owner','specific_officer','manager','staff') THEN 1 ELSE 0 END) AS ownerPending, SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'student' THEN 1 ELSE 0 END) AS studentPending, SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'external_party' THEN 1 ELSE 0 END) AS externalPending, SUM(CASE WHEN c.sla_state = 'attention' THEN 1 ELSE 0 END) AS attention, SUM(CASE WHEN c.sla_state = 'critical' THEN 1 ELSE 0 END) AS critical, SUM(CASE WHEN c.sla_state = 'breached' THEN 1 ELSE 0 END) AS breached, SUM(CASE WHEN c.sla_state IN ('breached','critical') THEN 1 ELSE 0 END) AS criticalAlerts, SUM(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 1 ELSE 0 END) AS responseOverdue, CAST(0 AS float) AS automationRate, CAST(NULL AS float) AS medianResolutionHours FROM [dbo].[service_units] u INNER JOIN [dbo].[cases] c ON c.service_unit_id = u.id GROUP BY u.id, u.name_en, u.name_ar ORDER BY active DESC; END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ArchiveApprovedPrompts] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ArchiveApprovedPrompts
  @AgentType nvarchar(100),
  @Language nvarchar(10)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.agent_prompt_versions SET status = N'archived', updated_at = SYSDATETIMEOFFSET()
  WHERE agent_type = @AgentType AND language = @Language AND status = N'approved';
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_GetLatestPromptVersion] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_GetLatestPromptVersion
  @AgentType nvarchar(100),
  @Language nvarchar(10)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) version FROM dbo.agent_prompt_versions
  WHERE agent_type = @AgentType AND language = @Language
  ORDER BY version DESC;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_GetSettings] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_GetSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) * FROM dbo.vw_AISettings_Compatibility
    ORDER BY ai_enabled DESC, updated_at DESC, id;
END;
GO

/* PROCEDURE [dbo].[usp_AiAdmin_GetSettingsId] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_GetSettingsId
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) id FROM dbo.vw_AISettings_Compatibility
    ORDER BY ai_enabled DESC, updated_at DESC, id;
END;
GO

/* SKIP [dbo].[usp_AiAdmin_GetUserRoles] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_AiAdmin_InsertEvaluationRun] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertEvaluationRun
  @scenarioId uniqueidentifier,
  @batchId uniqueidentifier,
  @intents nvarchar(max) = NULL,
  @tools nvarchar(max) = NULL,
  @responseType nvarchar(100) = NULL,
  @answer nvarchar(max) = NULL,
  @citationScore float = NULL,
  @toolScore float = NULL,
  @factual float = NULL,
  @handoffScore float = NULL,
  @langScore float = NULL,
  @overall float = NULL,
  @passed bit = NULL,
  @latency int = NULL,
  @actor uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.evaluation_runs(
    scenario_id, batch_id, model_name, detected_intents, tools_used, actual_outcome_type, answer_text,
    citation_accuracy_score, tool_selection_score, factual_accuracy_score, action_safety_score,
    language_quality_score, overall_score, passed, latency_ms, run_by)
  VALUES(
    @scenarioId, @batchId, NULL, @intents, @tools, @responseType, @answer,
    @citationScore, @toolScore, @factual, @handoffScore,
    @langScore, @overall, @passed, @latency, @actor);
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_InsertEvaluationRunError] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertEvaluationRunError
  @scenarioId uniqueidentifier,
  @batchId uniqueidentifier,
  @err nvarchar(max),
  @latency int,
  @actor uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.evaluation_runs(
    scenario_id, batch_id, actual_outcome_type, answer_text, overall_score, passed, latency_ms, run_by)
  VALUES(@scenarioId, @batchId, N'error', @err, 0, 0, @latency, @actor);
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_InsertPromptAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertPromptAudit
  @actor uniqueidentifier,
  @action nvarchar(100),
  @meta nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES(@actor, @action, N'agent_prompt_version', NULL, @meta);
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_InsertPromptVersion] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertPromptVersion
  @AgentType nvarchar(100),
  @Language nvarchar(10),
  @version int,
  @SystemPrompt nvarchar(max),
  @Notes nvarchar(500) = NULL,
  @status nvarchar(50),
  @actor uniqueidentifier,
  @approvedBy uniqueidentifier = NULL,
  @approvedAt datetimeoffset = NULL,
  @effectiveFrom datetimeoffset = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.agent_prompt_versions(
    agent_type, language, version, system_prompt, notes, status,
    created_by, approved_by, approved_at, effective_from)
  VALUES(
    @AgentType, @Language, @version, @SystemPrompt, @Notes, @status,
    @actor, @approvedBy, @approvedAt, @effectiveFrom);
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_InsertSettingsAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertSettingsAudit
    @actor uniqueidentifier, @existingId int, @meta nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    -- audit_logs.entity_id is a GUID shared by other entities. Do not fabricate a
    -- GUID for an integer settings ID; preserve the actual ID in audit metadata.
    VALUES(@actor, N'ai.settings_updated', N'AISettings', NULL,
        JSON_MODIFY(COALESCE(NULLIF(@meta, N''), N'{}'), '$.aiSettingId', @existingId));
END;
GO

/* PROCEDURE [dbo].[usp_AiAdmin_InsertToolAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_InsertToolAudit
  @actor uniqueidentifier,
  @action nvarchar(100),
  @ToolId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES(@actor, @action, N'agent_tool', @ToolId, N'{}');
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListActiveScenarios] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListActiveScenarios
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, scenario_code, language, category, input_message, expected_intents, expected_tools,
    expected_outcome_type, expected_human_handoff, is_active
  FROM dbo.evaluation_scenarios
  WHERE is_active = 1
  ORDER BY scenario_code;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListActivityRuns] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListActivityRuns
  @limit int
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit) id, created_at, agent, input, language, response_type, status, latency_ms,
    model_name, fallback_used, human_handoff, error_message
  FROM dbo.agent_runs
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListEvaluationBatches] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListEvaluationBatches
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (300) batch_id, overall_score, passed, created_at, model_name
  FROM dbo.evaluation_runs
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListModelInvocationsByRunIds] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListModelInvocationsByRunIds
  @idsJson nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT agent_run_id, purpose, status, total_duration_ms, created_at
  FROM dbo.agent_model_invocations
  WHERE agent_run_id IN (SELECT CAST([value] AS uniqueidentifier) FROM OPENJSON(@idsJson))
  ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListPromptVersions] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListPromptVersions
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, agent_type, language, version, status, notes, system_prompt, updated_at
  FROM dbo.agent_prompt_versions
  ORDER BY agent_type, version DESC;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListRecentRuns] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListRecentRuns
  @since datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (500) id, created_at, latency_ms, response_type, confidence, tool_call_count, failed_tool_count,
    fallback_used, human_handoff, language, model_name, provider, error_message, status
  FROM dbo.agent_runs
  WHERE created_at >= @since
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListRecentToolExecutions] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListRecentToolExecutions
  @since datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1000) tool_name, execution_status, authorization_result, duration_ms, started_at
  FROM dbo.agent_tool_executions
  WHERE started_at >= @since;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListScenariosForEval] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListScenariosForEval
  @limit int,
  @language nvarchar(10)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit) id, scenario_code, language, input_message, expected_tools, expected_outcome_type, expected_human_handoff
  FROM dbo.evaluation_scenarios
  WHERE is_active = 1 AND (@language = N'all' OR language = @language)
  ORDER BY scenario_code;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListToolExecutionsByRunIds] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListToolExecutionsByRunIds
  @idsJson nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT agent_run_id, tool_name, execution_status, authorization_result, duration_ms, started_at
  FROM dbo.agent_tool_executions
  WHERE agent_run_id IN (SELECT CAST([value] AS uniqueidentifier) FROM OPENJSON(@idsJson))
  ORDER BY started_at;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ListTools] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListTools
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, tool_name, agent_type, risk_level, allowed_roles, enabled, confirmation_required, human_approval_required
  FROM dbo.agent_tools
  ORDER BY tool_name;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_ToggleTool] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ToggleTool
  @ToolId uniqueidentifier,
  @Enabled bit
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.agent_tools SET enabled = @Enabled, updated_at = SYSDATETIMEOFFSET() WHERE id = @ToolId;
END
GO

/* PROCEDURE [dbo].[usp_AiAdmin_UpdateSettings] */
CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_UpdateSettings
    @Provider nvarchar(100), @ModelName nvarchar(200),
    @fallbackProvider nvarchar(100) = NULL, @fallbackModel nvarchar(200) = NULL,
    @effort nvarchar(50), @Temperature float, @MaxOutputTokens int,
    @ConfidenceThreshold float, @HandoffThreshold float,
    @RetrievalTopK int, @MaxToolCalls int, @AiEnabled bit,
    @actor uniqueidentifier, @existingId int
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AISettings SET
        ProviderCode = @Provider, Model = @ModelName,
        FallbackProvider = @fallbackProvider, FallbackModel = @fallbackModel,
        ReasoningEffort = @effort, Temperature = @Temperature, MaxTokens = @MaxOutputTokens,
        ConfidenceThreshold = @ConfidenceThreshold, HandoffThreshold = @HandoffThreshold,
        RetrievalTopK = @RetrievalTopK, MaxToolCalls = @MaxToolCalls, IsEnabled = @AiEnabled,
        UpdatedBy = @actor, UpdatedAt = SYSUTCDATETIME()
    WHERE AiSettingId = @existingId;
END;
GO

/* PROCEDURE [dbo].[usp_AppointmentChat_LastAdvisor] */
CREATE OR ALTER PROCEDURE dbo.usp_AppointmentChat_LastAdvisor
  @unitCode nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) s.staff_profile_id
FROM dbo.student_appointments a
JOIN dbo.appointment_slots s ON s.id = a.appointment_slot_id
JOIN dbo.appointment_types t ON t.id = s.appointment_type_id
JOIN dbo.service_units u ON u.id = t.service_unit_id
WHERE u.code = @unitCode AND s.staff_profile_id IS NOT NULL AND a.status <> N'cancelled'
ORDER BY a.created_at DESC;
END;
GO

/* PROCEDURE [dbo].[usp_AppointmentChat_UnitLocation] */
CREATE OR ALTER PROCEDURE dbo.usp_AppointmentChat_UnitLocation
  @unitCode nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT office_location_en AS En, office_location_ar AS Ar FROM dbo.service_units WHERE code = @unitCode;
END;
GO

/* PROCEDURE [dbo].[usp_AppointmentSlotExists] */
CREATE OR ALTER PROCEDURE dbo.usp_AppointmentSlotExists
  @typeId uniqueidentifier,
  @t datetimeoffset,
  @staffId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[appointment_slots]
    WHERE appointment_type_id = @typeId AND start_time = @t
      AND ((staff_profile_id IS NULL AND @staffId IS NULL) OR staff_profile_id = @staffId)
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_Approvals_InsertDecision] */
CREATE OR ALTER PROCEDURE dbo.usp_Approvals_InsertDecision
  @userId uniqueidentifier,
  @ActionKey nvarchar(200),
  @Status nvarchar(50),
  @RiskLevel nvarchar(50),
  @AffectedService nvarchar(500) = NULL,
  @DataShared nvarchar(max) = NULL,
  @ExpectedOutcome nvarchar(max) = NULL,
  @ReceiptNumber nvarchar(100) = NULL,
  @payload nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.action_approvals(user_id,action_key,status,risk_level,affected_service,data_shared,expected_outcome,receipt_number,payload)
  OUTPUT INSERTED.id
  VALUES(@userId,@ActionKey,@Status,@RiskLevel,@AffectedService,@DataShared,@ExpectedOutcome,@ReceiptNumber,@payload);
END
GO

/* SKIP [dbo].[usp_Approvals_UpdateDecision] — encrypted or non-standard definition */
GO
/* SKIP [dbo].[usp_ApptReq_GetByCase] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_ApptReq_GetById] */
CREATE OR ALTER PROCEDURE dbo.usp_ApptReq_GetById @requestId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT ar.id Id, ar.case_id CaseId, ar.reference Reference, ar.student_id StudentId,
  student.full_name StudentName, sp.student_number StudentNumber, ar.service_unit_id UnitId, su.name_en UnitName,
  ar.preferred_datetime PreferredDatetime, ar.alternative_datetime AlternativeDatetime, ar.confirmed_datetime ConfirmedDatetime,
  ar.assigned_staff_id AssignedStaffId, staff.full_name AssignedStaffName, staff.email AssignedStaffEmail,
  ar.assignment_method AssignmentMethod, ar.assigned_at AssignedAt, ar.workload_at_assignment WorkloadAtAssignment,
  ar.request_status RequestStatus, ar.confirmation_status ConfirmationStatus, ar.purpose Purpose,
  ar.decline_reason DeclineReason, ar.location Location, ar.office_response_at OfficeResponseAt, ar.student_response_at StudentResponseAt
FROM dbo.appointment_requests ar LEFT JOIN dbo.profiles student ON student.id=ar.student_id
LEFT JOIN dbo.student_profiles sp ON sp.user_id=ar.student_id LEFT JOIN dbo.service_units su ON su.id=ar.service_unit_id
LEFT JOIN dbo.profiles staff ON staff.id=ar.assigned_staff_id
WHERE ar.id=@requestId;
END
GO

/* PROCEDURE [dbo].[usp_ApptReq_InsertComment] */
CREATE OR ALTER PROCEDURE dbo.usp_ApptReq_InsertComment
  @commentCase uniqueidentifier, @userId uniqueidentifier, @message nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_comments(case_id,author_id,body,is_internal) VALUES(@commentCase,@userId,@message,0);
END
GO

/* PROCEDURE [dbo].[usp_ApptReq_ListMine] */
CREATE OR ALTER PROCEDURE dbo.usp_ApptReq_ListMine @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT ar.id Id, ar.case_id CaseId, ar.reference Reference, ar.student_id StudentId,
  student.full_name StudentName, sp.student_number StudentNumber, ar.service_unit_id UnitId, su.name_en UnitName,
  ar.preferred_datetime PreferredDatetime, ar.alternative_datetime AlternativeDatetime, ar.confirmed_datetime ConfirmedDatetime,
  ar.assigned_staff_id AssignedStaffId, staff.full_name AssignedStaffName, staff.email AssignedStaffEmail,
  ar.assignment_method AssignmentMethod, ar.assigned_at AssignedAt, ar.workload_at_assignment WorkloadAtAssignment,
  ar.request_status RequestStatus, ar.confirmation_status ConfirmationStatus, ar.purpose Purpose,
  ar.decline_reason DeclineReason, ar.location Location, ar.office_response_at OfficeResponseAt, ar.student_response_at StudentResponseAt
FROM dbo.appointment_requests ar LEFT JOIN dbo.profiles student ON student.id=ar.student_id
LEFT JOIN dbo.student_profiles sp ON sp.user_id=ar.student_id LEFT JOIN dbo.service_units su ON su.id=ar.service_unit_id
LEFT JOIN dbo.profiles staff ON staff.id=ar.assigned_staff_id
WHERE ar.assigned_staff_id=@userId ORDER BY ar.preferred_datetime;
END
GO

/* PROCEDURE [dbo].[usp_ApptReq_Notify] */
CREATE OR ALTER PROCEDURE dbo.usp_ApptReq_Notify
  @eventType nvarchar(100), @requestId uniqueidentifier, @recipient uniqueidentifier, @message nvarchar(max),
  @dedupe nvarchar(300), @caseId uniqueidentifier=NULL, @unitId uniqueidentifier=NULL, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,dedupe_key,case_id,service_unit_id,triggered_by)
VALUES(@eventType,N'appointment_request',@requestId,@recipient,N'in_app',N'Appointment request updated',@message,N'/requests',N'pending',@dedupe,@caseId,@unitId,@userId);
END
GO

/* PROCEDURE [dbo].[usp_ApptReq_UpdateResponse] */
CREATE OR ALTER PROCEDURE dbo.usp_ApptReq_UpdateResponse
  @status nvarchar(50), @confirmation nvarchar(50), @confirmed datetimeoffset=NULL, @alternative datetimeoffset=NULL,
  @decline nvarchar(max)=NULL, @officeResponse datetimeoffset=NULL, @studentResponse datetimeoffset=NULL,
  @location nvarchar(200)=NULL, @requestId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.appointment_requests SET request_status=@status, confirmation_status=@confirmation,
  confirmed_datetime=@confirmed, alternative_datetime=@alternative, decline_reason=@decline,
  office_response_at=@officeResponse, student_response_at=@studentResponse,
  location=CASE WHEN @location IS NULL THEN location ELSE @location END, updated_at=SYSDATETIMEOFFSET()
WHERE id=@requestId;
END
GO

/* PROCEDURE [dbo].[usp_Assistant_AppointmentMetadata] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_AppointmentMetadata
  @slotId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT t.name_en AS TypeEn, t.name_ar AS TypeAr, u.id AS UnitId, u.name_en AS UnitEn, u.name_ar AS UnitAr,
       COALESCE(s.location, u.office_location_en) AS LocEn, COALESCE(s.location, u.office_location_ar) AS LocAr,
       s.staff_profile_id AS StaffId, p.full_name AS StaffName
FROM dbo.appointment_slots s
JOIN dbo.appointment_types t ON t.id = s.appointment_type_id
LEFT JOIN dbo.service_units u ON u.id = t.service_unit_id
LEFT JOIN dbo.profiles p ON p.id = s.staff_profile_id
WHERE s.id = @slotId;
END;
GO

/* PROCEDURE [dbo].[usp_Assistant_CompleteAction] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_CompleteAction
  @actionId uniqueidentifier, @resultJson nvarchar(max), @receiptNo nvarchar(100),
  @conversationId uniqueidentifier=NULL, @toolId uniqueidentifier=NULL, @tool nvarchar(200),
  @userId uniqueidentifier, @payload nvarchar(max), @risk nvarchar(50)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.action_requests SET execution_status=N'completed',execution_result=@resultJson,
  executed_at=SYSDATETIMEOFFSET(),receipt_number=@receiptNo WHERE id=@actionId;
INSERT dbo.agent_tool_executions(conversation_id,tool_id,tool_name,requested_by_profile_id,input_payload,
  output_payload,execution_status,authorization_result,confirmation_status,approval_status,risk_level,completed_at)
VALUES(@conversationId,@toolId,@tool,@userId,@payload,@resultJson,N'succeeded',N'allowed',N'confirmed',N'not_required',@risk,SYSDATETIMEOFFSET());
END
GO

/* PROCEDURE [dbo].[usp_Assistant_FindDuplicateAction] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_FindDuplicateAction
  @userId uniqueidentifier, @tool nvarchar(200), @duplicateKey nvarchar(200)
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1) receipt_number AS Receipt, execution_result AS Result FROM dbo.action_requests
WHERE student_id=@userId AND action_type=@tool AND JSON_VALUE(proposed_payload,'$.idempotencyKey')=@duplicateKey
  AND execution_status IN (N'completed',N'awaiting_approval') ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Assistant_GetAiSettings] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) provider, model_name, api_key, api_url, temperature,
        max_output_tokens, enable_thinking, ai_enabled
    FROM dbo.vw_AISettings_Compatibility
    WHERE ai_enabled = 1
    ORDER BY updated_at DESC, id;
END;
GO

/* SKIP [dbo].[usp_Assistant_GetComplaintProposal] — encrypted or non-standard definition */
GO
/* SKIP [dbo].[usp_Assistant_GetConcernProposal] — encrypted or non-standard definition */
GO
/* SKIP [dbo].[usp_Assistant_GetIncidentContacts] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Assistant_GetLastAssistantMetadata] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetLastAssistantMetadata
  @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1) metadata AS Metadata
FROM dbo.messages
WHERE conversation_id=@conversationId AND role=N'assistant'
ORDER BY created_at DESC;
END
GO

/* SKIP [dbo].[usp_Assistant_GetSuggestionProposal] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Assistant_GetTextbookCourses] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetTextbookCourses
    @userId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT DISTINCT c.code AS Code, c.title_en AS TitleEn, c.title_ar AS TitleAr, c.credit_hours AS CreditHours
    FROM dbo.student_current_enrollments e
    JOIN dbo.course_sections s ON s.id = e.course_section_id
    JOIN dbo.courses c ON c.id = s.course_id
    WHERE e.student_id = @userId
      AND (e.enrollment_status IS NULL OR e.enrollment_status NOT IN (N'dropped', N'withdrawn'))
    ORDER BY c.code;
END
GO

/* PROCEDURE [dbo].[usp_Assistant_GetToolPolicy] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetToolPolicy @name nvarchar(200)
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1) id AS Id, enabled AS Enabled, risk_level AS Risk,
  confirmation_required AS Confirmation, human_approval_required AS HumanApproval,
  allowed_roles AS Roles FROM dbo.agent_tools WHERE tool_name=@name;
END
GO

/* PROCEDURE [dbo].[usp_Assistant_GetUserRoles] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetUserRoles @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT role FROM dbo.user_roles WHERE user_id=@userId; END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertActionRequest] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertActionRequest
  @actionId uniqueidentifier, @userId uniqueidentifier, @conversationId uniqueidentifier=NULL, @tool nvarchar(200),
  @risk nvarchar(50), @payload nvarchar(max), @approval bit, @status nvarchar(50)
AS BEGIN SET NOCOUNT ON;
INSERT dbo.action_requests(id,student_id,conversation_id,action_type,risk_level,proposed_payload,
  student_confirmation_required,student_confirmed_at,human_approval_required,execution_status)
VALUES(@actionId,@userId,@conversationId,@tool,@risk,@payload,1,SYSDATETIMEOFFSET(),@approval,@status);
END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertAssistantMessage] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertAssistantMessage
  @conversationId uniqueidentifier, @userId uniqueidentifier, @message nvarchar(max), @lang nvarchar(10), @meta nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT dbo.messages(conversation_id,user_id,role,content,language,metadata) VALUES(@conversationId,@userId,N'assistant',@message,@lang,@meta);
END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertAudit
  @userId uniqueidentifier, @action nvarchar(200), @entityId uniqueidentifier, @metadata nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(@userId,@action,N'action_request',@entityId,@metadata);
END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertCase] */
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

/* PROCEDURE [dbo].[usp_Assistant_InsertConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertConversation
  @conversationId uniqueidentifier, @userId uniqueidentifier, @title nvarchar(200), @lang nvarchar(10)
AS BEGIN SET NOCOUNT ON;
INSERT dbo.conversations(id,user_id,title,language) VALUES(@conversationId,@userId,@title,@lang);
END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertIncidentCase] */
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

/* PROCEDURE [dbo].[usp_Assistant_InsertReceipt] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertReceipt
  @receiptNo nvarchar(100), @userId uniqueidentifier, @actionId uniqueidentifier, @reference nvarchar(100)=NULL,
  @tool nvarchar(200), @unit nvarchar(200)=NULL, @nextEn nvarchar(max)=NULL, @nextAr nvarchar(max)=NULL,
  @tracking nvarchar(500)=NULL, @lang nvarchar(10), @resultJson nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT dbo.action_receipts(receipt_number,student_id,action_request_id,reference_number,action_type,
  responsible_unit_name,current_status,next_step_en,next_step_ar,tracking_url,language,payload)
VALUES(@receiptNo,@userId,@actionId,@reference,@tool,@unit,N'submitted',@nextEn,@nextAr,@tracking,@lang,@resultJson);
END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertRunAndMessage] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertRunAndMessage
  @assistantId uniqueidentifier, @conversationId uniqueidentifier, @userId uniqueidentifier, @content nvarchar(max),
  @lang nvarchar(10), @metadata nvarchar(max), @traceId uniqueidentifier, @agent nvarchar(50), @input nvarchar(max),
  @output nvarchar(max), @latency int, @model nvarchar(200)=NULL, @provider nvarchar(100), @responseType nvarchar(50),
  @confidence decimal(9,4), @tools int, @fallback bit, @handoff bit
AS BEGIN SET NOCOUNT ON;
INSERT dbo.messages(id,conversation_id,user_id,role,content,language,metadata)
  VALUES(@assistantId,@conversationId,@userId,N'assistant',@content,@lang,@metadata);
UPDATE dbo.conversations SET updated_at=SYSDATETIMEOFFSET() WHERE id=@conversationId;
INSERT dbo.agent_runs(id,user_id,conversation_id,agent,status,input,output,latency_ms,model_name,provider,
  response_type,confidence,tool_call_count,schema_valid,fallback_used,human_handoff,language)
  VALUES(@traceId,@userId,@conversationId,@agent,N'completed',@input,@output,@latency,@model,@provider,@responseType,@confidence,@tools,1,@fallback,@handoff,@lang);
END
GO

/* PROCEDURE [dbo].[usp_Assistant_InsertUserMessage] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertUserMessage
  @userMessageId uniqueidentifier,
  @conversationId uniqueidentifier,
  @userId uniqueidentifier,
  @text nvarchar(max),
  @lang nvarchar(10),
  @metadata nvarchar(max) = N'{}'
AS BEGIN SET NOCOUNT ON;
INSERT dbo.messages(id,conversation_id,user_id,role,content,language,metadata)
VALUES(@userMessageId,@conversationId,@userId,N'user',@text,@lang,COALESCE(NULLIF(@metadata,N''),N'{}'));
END
GO

/* PROCEDURE [dbo].[usp_Assistant_OwnsConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_OwnsConversation @existing uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.conversations WHERE id=@existing AND user_id=@userId; END
GO

/* PROCEDURE [dbo].[usp_Assistant_ResolveIncidentUnit] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_ResolveIncidentUnit
    @contactId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    -- Exact verified unit names/codes take priority. The fallbacks are the existing
    -- security/safety_emergency mappings; maintenance goes to Student Housing as requested.
    SELECT TOP (1) u.id AS UnitId, u.primary_service_owner_id AS OwnerId,
        u.name_en AS UnitEn, u.name_ar AS UnitAr
    FROM dbo.emergency_contacts c
    JOIN dbo.service_units u ON u.is_active = 1 AND
      (u.code = COALESCE(c.responsible_unit_en, c.label_en)
       OR u.name_en = COALESCE(c.responsible_unit_en, c.label_en)
       OR u.name_ar = COALESCE(c.responsible_unit_ar, c.label_ar)
       OR (c.code = N'campus_maintenance' AND u.code IN (N'HOUSING', N'HOUS'))
       OR (c.code = N'campus_security' AND u.code IN (N'FMD', N'SECURITY', N'FACILITIES_MANAGEMENT_'))
       OR (c.code = N'campus_fire' AND u.code = N'OES'))
    WHERE c.id = @contactId AND c.is_active = 1
    ORDER BY CASE
        WHEN u.code = COALESCE(c.responsible_unit_en, c.label_en)
          OR u.name_en = COALESCE(c.responsible_unit_en, c.label_en)
          OR u.name_ar = COALESCE(c.responsible_unit_ar, c.label_ar) THEN 0
        WHEN c.code = N'campus_maintenance' AND u.code = N'HOUSING' THEN 1
        WHEN c.code = N'campus_security' AND u.code = N'FMD' THEN 1
        WHEN c.code = N'campus_security' AND u.code = N'SECURITY' THEN 2
        ELSE 3 END, u.code;
END;
GO

/* SKIP [dbo].[usp_Assistant_RetrieveEvidence] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Assistant_UpdateAppointmentCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_UpdateAppointmentCase
  @caseId uniqueidentifier, @unitId uniqueidentifier = NULL, @staffId uniqueidentifier = NULL, @start datetimeoffset(7), @location nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.cases SET
  service_unit_id = COALESCE(@unitId, service_unit_id),
  assigned_to = COALESCE(@staffId, assigned_to),
  meeting_at = @start,
  meeting_mode = N'in_person',
  meeting_location = @location,
  status = CASE WHEN @staffId IS NOT NULL THEN N'assigned' ELSE status END,
  last_activity_at = SYSDATETIMEOFFSET()
WHERE id = @caseId;
END;
GO

/* SKIP [dbo].[usp_Assistant_UpdateRunTiming] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_AuthCreateSessionTokens] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthCreateSessionTokens
  @userId uniqueidentifier, @sessionId uniqueidentifier, @hash nvarchar(128), @days int, @previousHash nvarchar(128) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM auth.login_sessions WITH (UPDLOCK, HOLDLOCK) WHERE id = @sessionId)
      INSERT auth.login_sessions(id,user_id) VALUES (@sessionId,@userId);
    IF EXISTS (SELECT 1 FROM auth.login_sessions WHERE id=@sessionId AND (revoked_at IS NOT NULL OR user_id<>@userId))
      THROW 51001, 'Session has expired.', 1;
    IF @previousHash IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WITH (UPDLOCK, HOLDLOCK)
        WHERE token_hash=@previousHash AND user_id=@userId AND revoked_at IS NULL AND expires_at>SYSDATETIMEOFFSET()
          AND (session_id IS NULL OR session_id=@sessionId))
        THROW 51001, 'Session has expired.', 1;
      -- Retain the session on consumed tokens so logout also revokes a rotated replacement.
      UPDATE auth.refresh_tokens SET revoked_at=SYSDATETIMEOFFSET(),session_id=@sessionId WHERE token_hash=@previousHash;
    END;
    INSERT auth.refresh_tokens(user_id,token_hash,expires_at,session_id)
      VALUES (@userId,@hash,DATEADD(day,@days,SYSDATETIMEOFFSET()),@sessionId);
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH;
END;
GO

/* PROCEDURE [dbo].[usp_AuthEndSession] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthEndSession
  @hash nvarchar(128) = NULL, @sessionId uniqueidentifier = NULL,
  @accessHash nvarchar(64) = NULL, @expiresAt datetimeoffset(7) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @refreshSession uniqueidentifier;
    SELECT @refreshSession=session_id FROM auth.refresh_tokens WHERE token_hash=@hash;
    -- Serialize an upgrade of a pre-migration refresh token with logout too.
    IF @hash IS NOT NULL AND @refreshSession IS NULL
      SELECT @refreshSession=session_id FROM auth.refresh_tokens WITH (UPDLOCK,HOLDLOCK) WHERE token_hash=@hash;
    UPDATE auth.login_sessions SET revoked_at=COALESCE(revoked_at,SYSDATETIMEOFFSET())
      WHERE id IN (@sessionId,@refreshSession);
    UPDATE auth.refresh_tokens SET revoked_at=COALESCE(revoked_at,SYSDATETIMEOFFSET())
      WHERE token_hash=@hash OR session_id IN (@sessionId,@refreshSession);
    IF @accessHash IS NOT NULL AND @expiresAt IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.logged_out_access_tokens WITH (UPDLOCK,HOLDLOCK) WHERE token_hash=@accessHash)
      INSERT auth.logged_out_access_tokens(token_hash,expires_at) VALUES (@accessHash,@expiresAt);
    DELETE auth.logged_out_access_tokens WHERE expires_at<SYSDATETIMEOFFSET();
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH;
END;
GO

/* PROCEDURE [dbo].[usp_AuthGetEmailById] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthGetEmailById
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [email] FROM [auth].[users] WHERE [id] = @id;
END
GO

/* PROCEDURE [dbo].[usp_AuthGetSessionRefreshToken] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthGetSessionRefreshToken @hash nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT user_id AS UserId, expires_at AS ExpiresAt, revoked_at AS RevokedAt, session_id AS SessionId
  FROM auth.refresh_tokens WHERE token_hash = @hash;
END;
GO

/* PROCEDURE [dbo].[usp_AuthGetSsoUserByEmail_v2] */
CREATE OR ALTER PROCEDURE [dbo].[usp_AuthGetSsoUserByEmail_v2]
  @email nvarchar(256),
  @name nvarchar(350)
AS
BEGIN
  SET NOCOUNT ON;
 
 DECLARE @id uniqueidentifier;
  SELECT @id = [id] FROM [auth].[users] WHERE [email] = @email;
  
	  IF EXISTS (
				SELECT 1
				FROM profiles
				WHERE id = @id
				AND ISNULL(full_name, '') = ''
				)
		BEGIN
					UPDATE profiles
					SET full_name = @name
					WHERE id = @id;
		END

  SELECT
    u.[id] AS [Id],
    u.[email] AS [Email],
    CONVERT(bit, CASE
      WHEN p.[id] IS NOT NULL
       AND p.[deleted_at] IS NULL
       AND p.[access_revoked_at] IS NULL THEN 1
      ELSE 0
    END) AS [IsActive]
  FROM [auth].[users] u
  LEFT JOIN [dbo].[profiles] p ON p.[id] = u.[id]
  WHERE u.[id] = @id;

  SELECT [role]
  FROM [dbo].[user_roles]
  WHERE [user_id] = @id
  ORDER BY [role];
END;
GO

/* SKIP [dbo].[usp_AuthGetUserByEmail] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_AuthInsertProfile] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertProfile
  @id uniqueidentifier,
  @name nvarchar(450),
  @email nvarchar(256),
  @lang nvarchar(20)
AS
BEGIN
  INSERT INTO [dbo].[profiles] ([id], [full_name], [email], [preferred_language])
  VALUES (@id, @name, @email, @lang);
END
GO

/* PROCEDURE [dbo].[usp_AuthInsertStudentRole] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertStudentRole
  @id uniqueidentifier
AS
BEGIN
  INSERT INTO [dbo].[user_roles] ([user_id], [role]) VALUES (@id, 'student');
END
GO

/* PROCEDURE [dbo].[usp_AuthInsertUser] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthInsertUser
  @id uniqueidentifier,
  @email nvarchar(256),
  @hash nvarchar(512)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [auth].[users] ([id], [email], [encrypted_password])
  VALUES (@id, @email, @hash);
END
GO

/* PROCEDURE [dbo].[usp_AuthIsSessionActive] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthIsSessionActive
  @accessHash nvarchar(64), @sessionId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CONVERT(bit, CASE
    WHEN EXISTS (SELECT 1 FROM auth.logged_out_access_tokens WHERE token_hash=@accessHash) THEN 0
    WHEN @sessionId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.login_sessions WHERE id=@sessionId AND revoked_at IS NULL) THEN 0
    ELSE 1 END);
END;
GO

/* PROCEDURE [dbo].[usp_AuthorizeAppRoute] */
CREATE OR ALTER PROCEDURE dbo.usp_AuthorizeAppRoute
    @userId uniqueidentifier,
    @path nvarchar(512)
AS
BEGIN
    SET NOCOUNT ON;
    SET @path=LOWER(LEFT(COALESCE(NULLIF(@path,N''),N'/'),512));
    IF LEN(@path)>1 AND RIGHT(@path,1)=N'/' SET @path=LEFT(@path,LEN(@path)-1);

    DECLARE @policyId uniqueidentifier,@audience nvarchar(32),@revoked bit=0,@isStaff bit=0,@allowed bit=0;
    SELECT TOP(1) @policyId=id,@audience=audience FROM dbo.app_route_policies
      WHERE is_enabled=1 AND (@path=route_pattern OR @path LIKE route_pattern+N'/%')
      ORDER BY LEN(route_pattern) DESC;
    SELECT @revoked=CASE WHEN access_revoked_at IS NULL THEN 0 ELSE 1 END FROM dbo.profiles WHERE id=@userId;
    IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role IN
      (N'service_officer',N'service_owner',N'service_manager',N'knowledge_manager',N'knowledge_approver',
       N'integration_admin',N'system_admin',N'auditor',N'leadership_viewer')) SET @isStaff=1;

    IF @policyId IS NOT NULL AND @revoked=0
    BEGIN
      IF @audience=N'shared' SET @allowed=1;
      ELSE IF @audience=N'student' AND @isStaff=0 AND EXISTS
        (SELECT 1 FROM dbo.app_route_policy_roles pr JOIN dbo.user_roles ur ON ur.role=pr.role
         WHERE pr.policy_id=@policyId AND ur.user_id=@userId) SET @allowed=1;
      ELSE IF @audience=N'staff' AND @isStaff=1 AND EXISTS
        (SELECT 1 FROM dbo.app_route_policy_roles pr JOIN dbo.user_roles ur ON ur.role=pr.role
         WHERE pr.policy_id=@policyId AND ur.user_id=@userId) SET @allowed=1;
    END;

    DECLARE @landing nvarchar(256)=N'/assistant';
    IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'system_admin') SET @landing=N'/dashboard';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'service_manager') SET @landing=N'/dashboard';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'auditor') SET @landing=N'/dashboard?view=audit';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'integration_admin') SET @landing=N'/knowledge-center?tab=connections';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role IN(N'knowledge_manager',N'knowledge_approver')) SET @landing=N'/knowledge-center?tab=documents';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'service_owner') SET @landing=N'/owner-console?tab=dashboard';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'service_officer') SET @landing=N'/staff?view=queue';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'leadership_viewer') SET @landing=N'/leadership';

    SELECT @allowed AS allowed,@landing AS landing,@audience AS audience;
END;
GO

/* PROCEDURE [dbo].[usp_Automation_CompleteIntake] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_CompleteIntake
  @CaseId uniqueidentifier,
  @assignee uniqueidentifier = NULL,
  @actor uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.cases SET
    assigned_to = @assignee,
    status = CASE WHEN @assignee IS NULL THEN N'routed' ELSE N'assigned' END,
    last_activity_at = SYSDATETIMEOFFSET()
  WHERE id = @CaseId;
  MERGE dbo.case_automation_state t
  USING (SELECT @CaseId case_id) s ON t.case_id = s.case_id
  WHEN MATCHED THEN UPDATE SET ai_status = N'intake_complete', last_automated_at = SYSDATETIMEOFFSET()
  WHEN NOT MATCHED THEN INSERT(case_id, ai_status, last_automated_at)
  VALUES(@CaseId, N'intake_complete', SYSDATETIMEOFFSET());
  INSERT INTO dbo.automation_events(case_id, action_key, actor_type, executed, summary_en)
  VALUES(@CaseId, N'case_intake', N'human', 1, N'Case intake completed');
END
GO

/* PROCEDURE [dbo].[usp_Automation_GetAvgHoursSaved] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_GetAvgHoursSaved
AS
BEGIN
  SET NOCOUNT ON;
  SELECT AVG(CASE WHEN before_processing_hours > after_processing_hours
    THEN before_processing_hours - after_processing_hours ELSE 0 END)
  FROM dbo.service_impact_baselines;
END
GO

/* PROCEDURE [dbo].[usp_Automation_GetCaseAssignInfo] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_GetCaseAssignInfo
  @CaseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT service_unit_id, assigned_to, status FROM dbo.cases WHERE id = @CaseId;
END
GO

/* PROCEDURE [dbo].[usp_Automation_GetCaseForDraft] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_GetCaseForDraft
  @CaseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT c.case_number, c.title, c.status, c.language, c.service_unit_id, su.name_en, su.name_ar
  FROM dbo.cases c
  LEFT JOIN dbo.service_units su ON su.id = c.service_unit_id
  WHERE c.id = @CaseId;
END
GO

/* PROCEDURE [dbo].[usp_Automation_GetCaseState] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_GetCaseState
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.case_automation_state WHERE case_id = @caseId;
END
GO

/* PROCEDURE [dbo].[usp_Automation_GetPreferences] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_GetPreferences
  @uid uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.service_owner_ai_preferences WHERE staff_profile_id = @uid;
END
GO

/* PROCEDURE [dbo].[usp_Automation_InsertDraftEvent] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_InsertDraftEvent
  @CaseId uniqueidentifier,
  @actor uniqueidentifier,
  @result nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.automation_events(case_id, action_key, actor_type, actor_id, executed, summary_en, result)
  VALUES(@CaseId, N'draft_response', N'ai', @actor, 0, N'Response draft prepared for the Service Owner', @result);
END
GO

/* PROCEDURE [dbo].[usp_Automation_InsertHumanEdit] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_InsertHumanEdit
  @CaseId uniqueidentifier,
  @OriginalDraft nvarchar(max),
  @FinalText nvarchar(max),
  @actor uniqueidentifier,
  @category nvarchar(50),
  @Reason nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.ai_human_edits(case_id, entity_type, original_ai_content, edited_content, editor_profile_id, edit_category, edit_reason)
  VALUES(@CaseId, N'case_response', @OriginalDraft, @FinalText, @actor, @category, @Reason);
END
GO

/* PROCEDURE [dbo].[usp_Automation_InsertKnowledgeIssue] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_InsertKnowledgeIssue
  @uid uniqueidentifier,
  @IssueType nvarchar(100),
  @Description nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.knowledge_issue_reports(source_type, reported_by, issue_type, description, priority, status)
  VALUES(N'service_owner_report', @uid, @IssueType, @Description, N'normal', N'open');
END
GO

/* PROCEDURE [dbo].[usp_Automation_InsertOverrideAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_InsertOverrideAudit
  @CaseId uniqueidentifier,
  @actor uniqueidentifier,
  @Reason nvarchar(max),
  @result nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.automation_events(case_id, action_key, actor_type, actor_id, executed, summary_en, result)
  VALUES(@CaseId, N'decision_override', N'human', @actor, 1, @Reason, @result);
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES(@actor, N'automation.override', N'case', @CaseId, @result);
END
GO

/* PROCEDURE [dbo].[usp_Automation_InsertSendEvent] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_InsertSendEvent
  @CaseId uniqueidentifier,
  @actor uniqueidentifier,
  @summary nvarchar(max),
  @result nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.automation_events(case_id, action_key, actor_type, actor_id, executed, summary_en, result)
  VALUES(@CaseId, N'response_sending', N'human', @actor, 1, @summary, @result);
END
GO

/* PROCEDURE [dbo].[usp_Automation_ListCaseEvents] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_ListCaseEvents
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (50) id, action_key, actor_type, autonomy_level, rule_used, summary_en, summary_ar,
    executed, human_review_required, created_at
  FROM dbo.automation_events WHERE case_id = @caseId ORDER BY created_at DESC;
END
GO

/* SKIP [dbo].[usp_Automation_ListConsoleCases] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Automation_ListFollowUpPolicies] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_ListFollowUpPolicies
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, waiting_state, first_reminder_after_hours, second_reminder_after_hours,
    final_reminder_after_hours, escalation_after_hours, maximum_reminders, is_active
  FROM dbo.follow_up_policies ORDER BY waiting_state;
END
GO

/* PROCEDURE [dbo].[usp_Automation_ListPolicies] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_ListPolicies
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, action_key, case_type, risk_level, applies_to_sensitive, autonomy_level, min_confidence, is_active
  FROM dbo.automation_policies ORDER BY action_key;
END
GO

/* PROCEDURE [dbo].[usp_Automation_ListRecentEditCategories] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_ListRecentEditCategories
  @since datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  SELECT edit_category FROM dbo.ai_human_edits WHERE created_at >= @since;
END
GO

/* PROCEDURE [dbo].[usp_Automation_ListRecentEvents] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_ListRecentEvents
  @since datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  SELECT action_key, actor_type, executed, human_review_required, autonomy_level, created_at
  FROM dbo.automation_events WHERE created_at >= @since;
END
GO

/* PROCEDURE [dbo].[usp_Automation_MergePreferences] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_MergePreferences
  @uid uniqueidentifier,
  @AutoSendRoutineUpdates bit,
  @AutoRequestMissingInformation bit,
  @AutoFollowUp bit,
  @AutoEscalateByPolicy bit,
  @AutoPrepareResolution bit,
  @AutoCloseEligibleCases bit,
  @RequireReviewForAllStudentMessages bit,
  @PreferredResponseStyle nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.service_owner_ai_preferences t
  USING (SELECT @uid staff_profile_id) s ON t.staff_profile_id = s.staff_profile_id
  WHEN MATCHED THEN UPDATE SET
    auto_send_routine_updates = @AutoSendRoutineUpdates,
    auto_request_missing_information = @AutoRequestMissingInformation,
    auto_follow_up = @AutoFollowUp,
    auto_escalate_by_policy = @AutoEscalateByPolicy,
    auto_prepare_resolution = @AutoPrepareResolution,
    auto_close_eligible_cases = @AutoCloseEligibleCases,
    require_review_for_all_student_messages = @RequireReviewForAllStudentMessages,
    preferred_response_style = @PreferredResponseStyle
  WHEN NOT MATCHED THEN INSERT(
    staff_profile_id, auto_send_routine_updates, auto_request_missing_information, auto_follow_up,
    auto_escalate_by_policy, auto_prepare_resolution, auto_close_eligible_cases,
    require_review_for_all_student_messages, preferred_response_style)
  VALUES(
    @uid, @AutoSendRoutineUpdates, @AutoRequestMissingInformation, @AutoFollowUp,
    @AutoEscalateByPolicy, @AutoPrepareResolution, @AutoCloseEligibleCases,
    @RequireReviewForAllStudentMessages, @PreferredResponseStyle);
END
GO

/* PROCEDURE [dbo].[usp_Automation_OverrideField] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_OverrideField
  @CaseId uniqueidentifier,
  @Field nvarchar(50),
  @Value nvarchar(max),
  @Reason nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  IF @Field = N'unit'
    UPDATE dbo.cases SET service_unit_id = TRY_CONVERT(uniqueidentifier, @Value), assigned_to = NULL, status = N'submitted' WHERE id = @CaseId;
  ELSE IF @Field = N'urgency'
    UPDATE dbo.cases SET urgency = @Value WHERE id = @CaseId;
  ELSE IF @Field = N'assignee'
    UPDATE dbo.cases SET assigned_to = TRY_CONVERT(uniqueidentifier, @Value), status = N'assigned' WHERE id = @CaseId;
  ELSE IF @Field = N'classification'
    UPDATE dbo.cases SET case_type = @Value, human_review_required = 1 WHERE id = @CaseId;
END
GO

/* PROCEDURE [dbo].[usp_Automation_Pause] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_Pause
  @CaseId uniqueidentifier,
  @Pause bit,
  @Reason nvarchar(max) = NULL,
  @actor uniqueidentifier,
  @summary nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.case_automation_state t
  USING (SELECT @CaseId case_id) s ON t.case_id = s.case_id
  WHEN MATCHED THEN UPDATE SET
    automation_paused = @Pause,
    pause_reason = CASE WHEN @Pause = 1 THEN @Reason END,
    attention_category = CASE WHEN @Pause = 1 THEN N'decision_required' ELSE NULL END
  WHEN NOT MATCHED THEN INSERT(case_id, automation_paused, pause_reason, attention_category)
  VALUES(@CaseId, @Pause, @Reason, CASE WHEN @Pause = 1 THEN N'decision_required' END);
  INSERT INTO dbo.automation_events(case_id, action_key, actor_type, actor_id, executed, summary_en)
  VALUES(@CaseId, N'automation_pause', N'human', @actor, 1, @summary);
END
GO

/* PROCEDURE [dbo].[usp_Automation_PickAssignee] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_PickAssignee
  @unit uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) user_id FROM dbo.staff_profiles
  WHERE service_unit_id = @unit AND is_active = 1
    AND COALESCE(availability_status, N'available') = N'available'
  ORDER BY last_assigned_at;
END
GO

/* PROCEDURE [dbo].[usp_Automation_SendDraft] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_SendDraft
  @CaseId uniqueidentifier,
  @actor uniqueidentifier,
  @FinalText nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.case_comments(case_id, author_id, body, is_internal)
  VALUES(@CaseId, @actor, @FinalText, 0);
  UPDATE dbo.cases SET last_activity_at = SYSDATETIMEOFFSET() WHERE id = @CaseId;
END
GO

/* PROCEDURE [dbo].[usp_Automation_UpdatePolicyAutonomy] */
CREATE OR ALTER PROCEDURE dbo.usp_Automation_UpdatePolicyAutonomy
  @Id uniqueidentifier,
  @AutonomyLevel nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.automation_policies SET autonomy_level = @AutonomyLevel WHERE id = @Id;
END
GO

/* PROCEDURE [dbo].[usp_BookAppointment] */
CREATE OR ALTER PROCEDURE dbo.usp_BookAppointment
  @id uniqueidentifier,
  @uid uniqueidentifier,
  @slotId uniqueidentifier,
  @purpose nvarchar(max),
  @code nvarchar(32),
  @caseId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [dbo].[student_appointments] ([id], [student_id], [appointment_slot_id], [purpose], [status], [confirmation_code], [case_id], [booked_by])
  VALUES (@id, @uid, @slotId, @purpose, N'booked', @code, @caseId, @uid);
  UPDATE [dbo].[appointment_slots]
     SET [booked_count] = [booked_count] + 1,
         [status] = CASE WHEN [booked_count] + 1 >= [capacity] THEN N'booked' ELSE [status] END
   WHERE [id] = @slotId;
END
GO

/* PROCEDURE [dbo].[usp_CancelAppointment] */
CREATE OR ALTER PROCEDURE dbo.usp_CancelAppointment
  @appointmentId uniqueidentifier,
  @uid uniqueidentifier
AS
BEGIN
  UPDATE a SET a.status = 'cancelled'
  FROM [dbo].[student_appointments] a
  WHERE a.id = @appointmentId AND a.student_id = @uid;
  UPDATE s SET s.booked_count = CASE WHEN s.booked_count > 0 THEN s.booked_count - 1 ELSE 0 END
  FROM [dbo].[appointment_slots] s
  JOIN [dbo].[student_appointments] a ON a.appointment_slot_id = s.id
  WHERE a.id = @appointmentId;
END
GO

/* PROCEDURE [dbo].[usp_CanMonitorAllUnits] */
CREATE OR ALTER PROCEDURE dbo.usp_CanMonitorAllUnits
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[case_monitor_grants]
    WHERE [user_id] = @userId AND [is_active] = 1 AND [scope] = 'all_units'
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_CanSeeAllCases] */
CREATE OR ALTER PROCEDURE dbo.usp_CanSeeAllCases
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles]
    WHERE [user_id] = @userId AND [role] IN ('service_manager','system_admin','auditor','leadership_viewer')
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_Career_CreateCounsellingCase] */
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

/* PROCEDURE [dbo].[usp_Career_DeleteCvCascade] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_DeleteCvCascade
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.cv_ats_scores WHERE student_id = @id;
  DELETE FROM dbo.career_role_matches WHERE student_id = @id;
  DELETE FROM dbo.career_analysis_versions WHERE student_id = @id AND cv_id IS NOT NULL;
  UPDATE dbo.student_career_profiles SET latest_cv_id = NULL, updated_at = SYSDATETIMEOFFSET() WHERE student_id = @id;
  UPDATE dbo.student_cv_documents SET is_current = 0, deleted_at = SYSDATETIMEOFFSET(), parsed_text = NULL
  WHERE student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Career_DeleteRoleMatches] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_DeleteRoleMatches
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.career_role_matches WHERE student_id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Career_FindCvByHash] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_FindCvByHash
  @id uniqueidentifier,
  @hash nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) id Id, parsing_status ParsingStatus, is_current IsCurrent
  FROM dbo.student_cv_documents
  WHERE student_id = @id AND content_sha256 = @hash AND deleted_at IS NULL
  ORDER BY uploaded_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetCareerUnit] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetCareerUnit
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) id Id, primary_service_owner_id Owner
  FROM dbo.service_units WHERE code = N'CAREER' AND is_active = 1;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetCurrentCv] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetCurrentCv
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) * FROM dbo.student_cv_documents
  WHERE student_id = @id AND is_current = 1 AND deleted_at IS NULL
  ORDER BY uploaded_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetCvPath] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetCvPath
  @CvId uniqueidentifier,
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT original_file_path FROM dbo.student_cv_documents
  WHERE id = @CvId AND student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetInternship] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetInternship
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) o.title_en title
  FROM dbo.internship_assignments a
  LEFT JOIN dbo.internship_opportunities o ON o.id = a.opportunity_id
  WHERE a.student_id = @id
    AND a.assignment_status IN (N'assigned', N'confirmed', N'registered', N'completed');
END
GO

/* PROCEDURE [dbo].[usp_Career_GetLatestAnalysis] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetLatestAnalysis
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) version_no, profile_source, cv_file_name, calculated_at, matches
  FROM dbo.career_analysis_versions WHERE student_id = @id ORDER BY version_no DESC;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetOpenCounselling] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetOpenCounselling
  @id uniqueidentifier,
  @openJson nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) id, case_number reference, status, created_at createdAt,
    first_response_due_at firstResponseDueAt, resolution_due_at resolutionDueAt
  FROM dbo.cases
  WHERE student_id = @id AND title = N'Career counselling request'
    AND status IN (SELECT [value] FROM OPENJSON(@openJson))
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetPreferences] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetPreferences
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT preferred_roles, preferred_fields, preferred_sectors, work_orientation, latest_cv_id, counsellor_requested
  FROM dbo.student_career_profiles WHERE student_id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Career_GetStudentProfile] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_GetStudentProfile
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT sp.student_number, sp.cumulative_gpa, sp.academic_level, sp.completed_credit_hours,
    sp.expected_graduation_date, ap.name_en programme_en, ap.name_ar programme_ar, ap.total_credit_hours
  FROM dbo.student_profiles sp
  LEFT JOIN dbo.academic_programs ap ON ap.id = sp.program_id
  WHERE sp.user_id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Career_InsertCleanScan] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_InsertCleanScan
  @id uniqueidentifier,
  @cvId uniqueidentifier,
  @file nvarchar(500),
  @mime nvarchar(200),
  @size int,
  @hash nvarchar(128),
  @verdict nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.cv_upload_scans(student_id, cv_id, file_name, mime_type, size_bytes, sha256, scan_status, verdict, findings)
  VALUES(@id, @cvId, @file, @mime, @size, @hash, N'clean', @verdict, N'[]');
END
GO

/* PROCEDURE [dbo].[usp_Career_InsertCvDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_InsertCvDocument
  @cvId uniqueidentifier,
  @id uniqueidentifier,
  @file nvarchar(500),
  @mime nvarchar(200),
  @size int,
  @path nvarchar(500),
  @text nvarchar(max),
  @profile nvarchar(max),
  @language nvarchar(20),
  @status nvarchar(50),
  @error nvarchar(max) = NULL,
  @flags nvarchar(max),
  @hash nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.student_cv_documents(
    id, student_id, file_name, mime_type, size_bytes, original_file_path, parsed_text,
    parsed_profile_json, detected_language, parsing_status, parsing_error, injection_flags,
    discrepancies, is_current, scan_status, content_sha256)
  VALUES(
    @cvId, @id, @file, @mime, @size, @path, @text, @profile, @language, @status, @error, @flags,
    N'[]', 0, N'clean', @hash);
  UPDATE dbo.student_cv_documents
  SET is_current = CASE WHEN id = @cvId THEN 1 ELSE 0 END
  WHERE student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Career_InsertEvent] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_InsertEvent
  @student uniqueidentifier,
  @cv uniqueidentifier = NULL,
  @type nvarchar(100),
  @json nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.career_counselling_events(student_id, cv_id, event_type, actor_id, details)
  VALUES(@student, @cv, @type, @student, @json);
END
GO

/* PROCEDURE [dbo].[usp_Career_InsertRoleMatch] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_InsertRoleMatch
  @id uniqueidentifier,
  @cvId uniqueidentifier = NULL,
  @role uniqueidentifier,
  @fit int,
  @program decimal(10,2),
  @course decimal(10,2),
  @skills decimal(10,2),
  @experience decimal(10,2),
  @tools decimal(10,2),
  @certs decimal(10,2),
  @soft decimal(10,2),
  @preference decimal(10,2),
  @ready int,
  @evidence nvarchar(max),
  @missing nvarchar(max),
  @breakdown nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.career_role_matches(
    student_id, cv_id, career_role_id, fit_score, programme_score, coursework_score, hard_skill_score,
    experience_score, tools_score, certification_score, soft_skill_score, preference_score,
    job_readiness_score, matched_evidence, missing_requirements, skill_breakdown)
  VALUES(
    @id, @cvId, @role, @fit, @program, @course, @skills, @experience, @tools, @certs, @soft, @preference,
    @ready, @evidence, @missing, @breakdown);
END
GO

/* PROCEDURE [dbo].[usp_Career_InsertUploadScan] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_InsertUploadScan
  @id uniqueidentifier,
  @file nvarchar(500),
  @mime nvarchar(200),
  @size int,
  @hash nvarchar(128),
  @status nvarchar(50),
  @verdict nvarchar(max),
  @json nvarchar(max),
  @quarantine nvarchar(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.cv_upload_scans(student_id, file_name, mime_type, size_bytes, sha256, scan_status, verdict, findings, quarantine_path)
  VALUES(@id, @file, @mime, @size, @hash, @status, @verdict, @json, @quarantine);
END
GO

/* PROCEDURE [dbo].[usp_Career_ListActiveRoles] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_ListActiveRoles
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.career_roles WHERE active = 1;
END
GO

/* PROCEDURE [dbo].[usp_Career_ListCompletedCourses] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_ListCompletedCourses
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT c.code, c.title_en title, h.grade
  FROM dbo.student_course_history h
  JOIN dbo.courses c ON c.id = h.course_id
  WHERE h.student_id = @id AND COALESCE(h.completion_status, N'completed') = N'completed';
END
GO

/* SKIP [dbo].[usp_Career_ListRoles] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Career_ListStudentCvs] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_ListStudentCvs
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id Id, original_file_path Path, is_current [Current]
  FROM dbo.student_cv_documents
  WHERE student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Career_MergeLatestCv] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_MergeLatestCv
  @id uniqueidentifier,
  @cvId uniqueidentifier = NULL,
  @now datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.student_career_profiles AS t
  USING (SELECT @id student_id) s ON t.student_id = s.student_id
  WHEN MATCHED THEN UPDATE SET latest_cv_id = @cvId, career_fit_updated_at = @now
  WHEN NOT MATCHED THEN INSERT(student_id, latest_cv_id, career_fit_updated_at) VALUES(@id, @cvId, @now);
END
GO

/* PROCEDURE [dbo].[usp_Career_MergePreferences] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_MergePreferences
  @id uniqueidentifier,
  @roles nvarchar(max),
  @fields nvarchar(max),
  @sectors nvarchar(max),
  @locations nvarchar(max),
  @mode nvarchar(50),
  @orientation nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.student_career_profiles AS t
  USING (SELECT @id student_id) s ON t.student_id = s.student_id
  WHEN MATCHED THEN UPDATE SET
    preferred_roles = @roles, preferred_fields = @fields, preferred_sectors = @sectors,
    preferred_locations = @locations, work_mode = @mode, work_orientation = @orientation,
    updated_at = SYSDATETIMEOFFSET()
  WHEN NOT MATCHED THEN INSERT(student_id, preferred_roles, preferred_fields, preferred_sectors, preferred_locations, work_mode, work_orientation)
  VALUES(@id, @roles, @fields, @sectors, @locations, @mode, @orientation);
END
GO

/* PROCEDURE [dbo].[usp_Career_SetCurrentCv] */
CREATE OR ALTER PROCEDURE dbo.usp_Career_SetCurrentCv
  @id uniqueidentifier,
  @cv uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.student_cv_documents
  SET is_current = CASE WHEN id = @cv THEN 1 ELSE 0 END
  WHERE student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Case_GetHandover] */
CREATE OR ALTER PROCEDURE dbo.usp_Case_GetHandover
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT c.case_number AS CaseNumber, h.student_name AS StudentName,
         h.student_number AS StudentNumber, h.student_email AS StudentEmail,
         h.unit_name_en AS UnitEn, h.unit_name_ar AS UnitAr,
         h.interaction_type AS InteractionType, h.summary_en AS Summary,
         h.conversation_context AS Conversation, h.verified_data AS VerifiedData,
         h.actions_taken AS ActionsTaken, h.unresolved_issue AS UnresolvedIssue,
         h.recommended_action AS RecommendedAction, h.priority AS Priority,
         h.attachments AS Attachments
  FROM dbo.case_handovers h
  INNER JOIN dbo.cases c ON c.id = h.case_id
  WHERE h.case_id = @caseId;
END
GO

/* SKIP [dbo].[usp_Case_GetResponsible] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_CaseExists] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseExists
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[cases] WHERE [id] = @caseId) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_Acknowledge] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_Acknowledge @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=N'acknowledged',first_response_at=COALESCE(first_response_at,SYSDATETIMEOFFSET()),last_activity_at=SYSDATETIMEOFFSET(),next_action_en=N'Officer is reviewing your request' WHERE id=@CaseId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_ApproveResolution] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_ApproveResolution @actor uniqueidentifier, @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.case_resolutions SET approved_by=@actor,approved_at=SYSDATETIMEOFFSET(),proposed_to_student_at=SYSDATETIMEOFFSET() WHERE case_id=@caseId AND approved_at IS NULL;
END
GO

/* SKIP [dbo].[usp_CaseOps_Assign] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_CaseOps_ClearMeeting] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_ClearMeeting @CaseId uniqueidentifier, @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET meeting_at=NULL,meeting_mode=NULL,meeting_location=NULL,meeting_note=NULL,meeting_set_by=@actor,
  meeting_set_at=SYSDATETIMEOFFSET(),last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
INSERT INTO dbo.case_comments(case_id,author_id,is_internal,body)VALUES(@CaseId,@actor,0,N'The meeting set for this request has been cancelled.');
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_DecideApproval] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_DecideApproval
  @state nvarchar(50), @Reason nvarchar(max)=NULL, @actor uniqueidentifier, @ApprovalId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.approval_requests SET approval_status=@state,decision_reason=@Reason,decided_at=SYSDATETIMEOFFSET(),decided_by=@actor WHERE id=@ApprovalId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_DecideReopen] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_DecideReopen
  @decision nvarchar(50), @Reason nvarchar(max)=NULL, @actor uniqueidentifier, @ReopenId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.case_reopen_requests SET review_decision=@decision,decision_reason=@Reason,reviewed_by=@actor,reviewed_at=SYSDATETIMEOFFSET() WHERE id=@ReopenId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_Escalate] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_Escalate
  @id uniqueidentifier, @level int, @unit uniqueidentifier=NULL, @owner uniqueidentifier=NULL, @reason nvarchar(max), @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=N'escalated',escalation_level=@level,escalated_at=SYSDATETIMEOFFSET(),last_activity_at=SYSDATETIMEOFFSET() WHERE id=@id;
INSERT INTO dbo.escalation_actions(case_id,escalation_level,previous_unit_id,target_unit_id,previous_assignee_id,reason,triggered_by)
VALUES(@id,@level,@unit,@unit,@owner,@reason,@actor);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_GetApproval] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_GetApproval @ApprovalId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT id,case_id,requested_by,approval_status FROM dbo.approval_requests WHERE id=@ApprovalId; END
GO

/* PROCEDURE [dbo].[usp_CaseOps_GetCase] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_GetCase @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id,case_number,student_id,status,language,service_unit_id,assigned_to,outcome_en,sla_paused_at,sla_paused_minutes FROM dbo.cases WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_GetReopen] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_GetReopen @ReopenId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT case_id,student_id,review_decision FROM dbo.case_reopen_requests WHERE id=@ReopenId; END
GO

/* PROCEDURE [dbo].[usp_CaseOps_InsertApprovalRequest] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertApprovalRequest
  @CaseId uniqueidentifier, @actor uniqueidentifier, @summary nvarchar(500)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.approval_requests(case_id,approval_type,requested_by,assigned_approver_role,approval_status,request_summary,due_at)
VALUES(@CaseId,N'resolution',@actor,N'service_manager',N'pending',@summary,DATEADD(day,3,SYSDATETIMEOFFSET()));
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_InsertAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertAudit
  @actor uniqueidentifier, @action nvarchar(200), @entity nvarchar(100), @id uniqueidentifier, @json nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata)VALUES(@actor,@action,@entity,@id,@json);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_InsertFeedbackSignal] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertFeedbackSignal
  @type nvarchar(100), @CaseId uniqueidentifier, @student uniqueidentifier, @Comments nvarchar(max)=NULL, @outcome nvarchar(200)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,student_id,student_feedback,outcome,confidence)
VALUES(@type,N'STUDENT',@CaseId,@student,@Comments,@outcome,.6);
END
GO

/* SKIP [dbo].[usp_CaseOps_InsertHistory] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_CaseOps_InsertNotify] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertNotify
  @type nvarchar(100), @entity uniqueidentifier, @recipient uniqueidentifier, @body nvarchar(max),
  @url nvarchar(500), @caseId uniqueidentifier=NULL, @unit uniqueidentifier=NULL, @actor uniqueidentifier=NULL, @key nvarchar(300)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,case_id,service_unit_id,triggered_by,dedupe_key)
VALUES(@type,N'case',@entity,@recipient,N'in_app',N'Case update',@body,@url,N'pending',@caseId,@unit,@actor,@key);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_InsertReassignSignal] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertReassignSignal
  @id uniqueidentifier, @old uniqueidentifier, @target uniqueidentifier, @note nvarchar(max)=NULL, @reason nvarchar(100)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,original_staff_id,corrected_staff_id,staff_comment,reason_code,confidence)
VALUES(N'STAFF_REASSIGNMENT',N'STAFF',@id,@old,@target,@note,@reason,.6);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_InsertResolution] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertResolution
  @id uniqueidentifier, @CaseId uniqueidentifier, @ResolutionType nvarchar(100)=NULL, @SummaryEn nvarchar(max),
  @SummaryAr nvarchar(max)=NULL, @ActionTaken nvarchar(max)=NULL, @PolicyBasis nvarchar(max)=NULL,
  @Remedy nvarchar(max)=NULL, @actor uniqueidentifier, @approval bit
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_resolutions(id,case_id,resolution_type,resolution_summary_en,resolution_summary_ar,action_taken,policy_basis,compensation_or_remedy,prepared_by,manager_approval_required,proposed_to_student_at)
VALUES(@id,@CaseId,COALESCE(@ResolutionType,N'resolved'),@SummaryEn,@SummaryAr,@ActionTaken,@PolicyBasis,@Remedy,@actor,@approval,CASE WHEN @approval=0 THEN SYSDATETIMEOFFSET() END);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_NextEscalationLevel] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_NextEscalationLevel @id uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT COALESCE(escalation_level,0)+1 FROM dbo.cases WHERE id=@id; END
GO

/* PROCEDURE [dbo].[usp_CaseOps_PickAssignee] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_PickAssignee @unit uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP(1)sp.user_id FROM dbo.staff_profiles sp
OUTER APPLY(SELECT COUNT(*) n FROM dbo.cases x WHERE x.assigned_to=sp.user_id AND x.status NOT IN(N'closed',N'resolved'))w
WHERE sp.service_unit_id=@unit AND sp.is_active=1 AND COALESCE(sp.availability_status,N'available')=N'available'
ORDER BY w.n,sp.last_assigned_at;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_PickUnitAssignee] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_PickUnitAssignee @unit uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP(1)user_id FROM dbo.staff_profiles WHERE service_unit_id=@unit AND is_active=1 ORDER BY last_assigned_at;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_ProvideInfo] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_ProvideInfo
  @CaseId uniqueidentifier, @ResponseNote nvarchar(max), @RequestId uniqueidentifier=NULL, @student uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.case_information_requests SET status=N'responded',responded_at=SYSDATETIMEOFFSET(),response_note=@ResponseNote
WHERE case_id=@CaseId AND status=N'pending' AND(@RequestId IS NULL OR id=@RequestId);
INSERT INTO dbo.case_comments(case_id,author_id,body,is_internal)VALUES(@CaseId,@student,@ResponseNote,0);
UPDATE dbo.cases SET status=N'in_review',
  sla_paused_minutes=COALESCE(sla_paused_minutes,0)+CASE WHEN sla_paused_at IS NULL THEN 0 ELSE DATEDIFF(minute,sla_paused_at,SYSDATETIMEOFFSET())END,
  sla_paused_at=NULL,sla_state=N'on_track',unread_student_message=1,current_responsible_actor=N'service_owner',
  last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_ReopenCase] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_ReopenCase @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=N'in_review',reopened_count=COALESCE(reopened_count,0)+1,closed_at=NULL,resolved_at=NULL,sla_state=N'on_track',last_activity_at=SYSDATETIMEOFFSET() WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_RequestInfo] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_RequestInfo
  @CaseId uniqueidentifier, @actor uniqueidentifier, @InformationRequired nvarchar(max), @Reason nvarchar(max)=NULL,
  @due datetimeoffset, @pause bit
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_information_requests(case_id,requested_by,information_required,reason,due_at,pauses_sla,status)
VALUES(@CaseId,@actor,@InformationRequired,@Reason,@due,@pause,N'pending');
INSERT INTO dbo.case_comments(case_id,author_id,body,is_internal,is_info_request)VALUES(@CaseId,@actor,@InformationRequired,0,1);
UPDATE dbo.cases SET status=N'awaiting_student',current_responsible_actor=N'student',
  sla_paused_at=CASE WHEN @pause=1 THEN SYSDATETIMEOFFSET() ELSE sla_paused_at END,
  sla_state=CASE WHEN @pause=1 THEN N'paused' ELSE sla_state END,
  last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_RequestReopen] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_RequestReopen
  @CaseId uniqueidentifier, @student uniqueidentifier, @Reason nvarchar(max), @NewEvidence nvarchar(max)=NULL, @RequestedOutcome nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_reopen_requests(case_id,student_id,reason,new_evidence,requested_outcome)VALUES(@CaseId,@student,@Reason,@NewEvidence,@RequestedOutcome);
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,student_id,student_feedback,confidence)VALUES(N'CASE_REOPEN',N'STUDENT',@CaseId,@student,@Reason,.65);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_RespondResolution] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_RespondResolution
  @CaseId uniqueidentifier, @Comment nvarchar(max)=NULL, @Accept bit, @response nvarchar(50), @status nvarchar(50)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.case_resolutions SET student_response=@response,student_response_at=SYSDATETIMEOFFSET(),student_response_comment=@Comment,
  finalized_at=CASE WHEN @Accept=1 THEN SYSDATETIMEOFFSET() END WHERE case_id=@CaseId AND student_response IS NULL;
UPDATE dbo.cases SET status=@status,resolved_at=CASE WHEN @Accept=1 THEN SYSDATETIMEOFFSET() ELSE resolved_at END,last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_Route] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_Route @id uniqueidentifier, @assignee uniqueidentifier=NULL
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET assigned_to=@assignee,status=CASE WHEN @assignee IS NULL THEN N'routed' ELSE N'assigned' END,last_activity_at=SYSDATETIMEOFFSET() WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_SetCaseStatus] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_SetCaseStatus @status nvarchar(50), @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; UPDATE dbo.cases SET status=@status,last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId; END
GO

/* PROCEDURE [dbo].[usp_CaseOps_SetCaseStatusById] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_SetCaseStatusById @state nvarchar(50), @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; UPDATE dbo.cases SET status=@state,last_activity_at=SYSDATETIMEOFFSET() WHERE id=@caseId; END
GO

/* PROCEDURE [dbo].[usp_CaseOps_SetMeeting] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_SetMeeting
  @CaseId uniqueidentifier, @at datetimeoffset, @Mode nvarchar(50), @Location nvarchar(500)=NULL, @Note nvarchar(max)=NULL,
  @actor uniqueidentifier, @body nvarchar(max)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET meeting_at=@at,meeting_mode=@Mode,meeting_location=@Location,meeting_note=@Note,meeting_set_by=@actor,
  meeting_set_at=SYSDATETIMEOFFSET(),last_activity_at=SYSDATETIMEOFFSET(),next_action_en=N'Attend the scheduled meeting' WHERE id=@CaseId;
INSERT INTO dbo.case_comments(case_id,author_id,is_internal,body)VALUES(@CaseId,@actor,0,@body);
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_SlaSweep] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_SlaSweep
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET sla_state=N'breached' WHERE status NOT IN(N'resolved',N'closed') AND resolution_due_at<SYSDATETIMEOFFSET() AND COALESCE(sla_state,N'')<>N'breached';
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_SubmitFeedback] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_SubmitFeedback
  @CaseId uniqueidentifier, @student uniqueidentifier, @Overall int, @Speed int=NULL, @Quality int=NULL,
  @Communication int=NULL, @Fairness int=NULL, @Effort int=NULL, @FullyResolved bit=NULL, @Comments nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_feedback(case_id,student_id,overall_satisfaction,response_speed_rating,resolution_quality_rating,communication_rating,fairness_rating,effort_score,issue_fully_resolved,comments)
VALUES(@CaseId,@student,@Overall,@Speed,@Quality,@Communication,@Fairness,@Effort,@FullyResolved,@Comments);
UPDATE dbo.cases SET status=N'closed',closed_at=SYSDATETIMEOFFSET(),satisfaction_rating=@Overall,sla_state=N'completed',closure_reason=N'resolved_confirmed',last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
END
GO

/* PROCEDURE [dbo].[usp_CaseOps_UpdateStatus] */
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_UpdateStatus
  @Status nvarchar(50), @CaseId uniqueidentifier, @done bit, @outcome nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=@Status,
  outcome_en=CASE WHEN @done=1 THEN @outcome ELSE outcome_en END,
  resolved_at=CASE WHEN @Status=N'resolved' THEN SYSDATETIMEOFFSET() ELSE resolved_at END,
  closed_at=CASE WHEN @Status=N'closed' THEN SYSDATETIMEOFFSET() ELSE closed_at END,
  sla_state=CASE WHEN @Status=N'closed' THEN N'completed' ELSE sla_state END,
  last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
END
GO

/* SKIP [dbo].[usp_CatalogColumns] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_CatalogForeignKeys] */
CREATE OR ALTER PROCEDURE dbo.usp_CatalogForeignKeys
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
      OBJECT_SCHEMA_NAME(fk.parent_object_id) AS [Schema],
      OBJECT_NAME(fk.parent_object_id) AS [Table],
      COL_NAME(fc.parent_object_id, fc.parent_column_id) AS [Column],
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS RefSchema,
      OBJECT_NAME(fk.referenced_object_id) AS RefTable,
      COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS RefColumn
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id;
END
GO

/* PROCEDURE [dbo].[usp_CatalogPrimaryKeys] */
CREATE OR ALTER PROCEDURE dbo.usp_CatalogPrimaryKeys
AS
BEGIN
  SET NOCOUNT ON;
  SELECT ku.TABLE_SCHEMA AS [Schema], ku.TABLE_NAME AS [Table], ku.COLUMN_NAME AS [Column], ku.ORDINAL_POSITION AS Ordinal
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA IN ('dbo','auth','storage');
END
GO

/* PROCEDURE [dbo].[usp_ChangeInternshipAssignment] */
CREATE OR ALTER PROCEDURE dbo.usp_ChangeInternshipAssignment
  @assignmentId uniqueidentifier,
  @opportunityId uniqueidentifier = NULL
AS
BEGIN
  UPDATE [dbo].[internship_assignments]
  SET [opportunity_id] = COALESCE(@opportunityId, [opportunity_id]), [updated_at] = SYSDATETIMEOFFSET()
  WHERE [id] = @assignmentId;
END
GO

/* PROCEDURE [dbo].[usp_Chat_CountIssuedDocs] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_CountIssuedDocs @userId uniqueidentifier, @convId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.issued_documents WHERE student_id=@userId AND conversation_id=@convId AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Chat_CountPaged] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_CountPaged
  @userId uniqueidentifier, @filter nvarchar(20), @termLike nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.conversations
WHERE user_id=@userId
  AND (@filter<>N'linked' OR related_case_id IS NOT NULL)
  AND (@filter<>N'unlinked' OR related_case_id IS NULL)
  AND (@termLike IS NULL OR title LIKE @termLike);
END
GO

/* PROCEDURE [dbo].[usp_Chat_DeleteAll] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_DeleteAll @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON; DELETE FROM dbo.conversations OUTPUT deleted.id WHERE user_id=@userId; END
GO

/* PROCEDURE [dbo].[usp_Chat_DeleteOne] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_DeleteOne @conversationId uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON; DELETE FROM dbo.conversations WHERE id=@conversationId AND user_id=@userId; END
GO

/* PROCEDURE [dbo].[usp_Chat_GetConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_GetConversation @convId uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id AS Id, title AS Title, updated_at AS UpdatedAt, related_case_id AS RelatedCaseId
FROM dbo.conversations WHERE id=@convId AND user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Chat_GetConversationState] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_GetConversationState @convId uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT summary AS Summary, pending_questions AS PendingQuestions, pending_confirmation_type AS PendingConfirmationType,
       current_service_id AS CurrentServiceId, current_service_unit_id AS CurrentServiceUnitId, related_case_id AS RelatedCaseId
FROM dbo.conversation_state WHERE conversation_id=@convId AND user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Chat_GetLinkedCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_GetLinkedCase @caseId uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT c.id AS Id, c.case_number AS CaseNumber, c.status AS Status, c.assigned_to AS AssignedTo,
       su.name_en AS UnitNameEn, su.name_ar AS UnitNameAr
FROM dbo.cases c LEFT JOIN dbo.service_units su ON su.id=c.service_unit_id
WHERE c.id=@caseId AND c.student_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Chat_GetServiceNames] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_GetServiceNames @serviceId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT name_en AS NameEn, name_ar AS NameAr FROM dbo.university_services WHERE id=@serviceId; END
GO

/* PROCEDURE [dbo].[usp_Chat_GetStaffName] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_GetStaffName @staffId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT full_name FROM dbo.profiles WHERE id=@staffId; END
GO

/* PROCEDURE [dbo].[usp_Chat_GetUnitNames] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_GetUnitNames @unitId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT name_en AS NameEn, name_ar AS NameAr FROM dbo.service_units WHERE id=@unitId; END
GO

/* PROCEDURE [dbo].[usp_Chat_InsertDeleteAllAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_InsertDeleteAllAudit @userId uniqueidentifier, @metadata nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs (actor_id, action, entity_type, entity_id, metadata)
VALUES (@userId, N'DELETE_ALL_CHATS', N'conversations', @userId, @metadata);
END
GO

/* PROCEDURE [dbo].[usp_Chat_LatestOpenConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_LatestOpenConversation @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1) id FROM dbo.conversations WHERE user_id=@userId AND archived_at IS NULL ORDER BY updated_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Chat_ListCompletedActions] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_ListCompletedActions @userId uniqueidentifier, @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT message_id AS MessageId, action_key AS ActionKey, action_type AS ActionType,
       reference_number AS ReferenceNumber, submitted_at AS SubmittedAt
FROM dbo.chat_action_completions WHERE student_id=@userId AND conversation_id=@conversationId ORDER BY submitted_at ASC;
END
GO

/* PROCEDURE [dbo].[usp_Chat_ListIssuedDocs] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_ListIssuedDocs @userId uniqueidentifier, @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id AS Id, message_id AS MessageId, reference_number AS ReferenceNumber,
       title_en AS TitleEn, title_ar AS TitleAr, language AS Language, issued_at AS IssuedAt,
       secure_verification_token AS SecureVerificationToken, document_hash AS DocumentHash,
       document_status AS DocumentStatus, document_status AS VerificationStatus
FROM dbo.issued_documents WHERE student_id=@userId AND conversation_id=@conversationId AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Chat_ListLinkedCases] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_ListLinkedCases @userId uniqueidentifier, @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT c.id AS Id, c.case_number AS CaseNumber, c.status AS Status, c.assigned_to AS AssignedTo,
       c.outcome_en AS OutcomeEn, su.name_en AS UnitNameEn
FROM dbo.cases c LEFT JOIN dbo.service_units su ON su.id=c.service_unit_id
WHERE c.student_id=@userId AND c.related_conversation_id=@conversationId;
END
GO

/* PROCEDURE [dbo].[usp_Chat_ListMessages] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_ListMessages @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id AS Id, role AS Role, content AS Content, created_at AS CreatedAt, metadata AS Metadata
FROM dbo.messages WHERE conversation_id=@conversationId ORDER BY created_at ASC;
END
GO

/* SKIP [dbo].[usp_Chat_ListMine] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Chat_ListPaged] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_ListPaged
  @userId uniqueidentifier, @filter nvarchar(20), @termLike nvarchar(200)=NULL, @offset int, @take int
AS BEGIN SET NOCOUNT ON;
SELECT id AS Id, title AS Title, updated_at AS UpdatedAt, related_case_id AS RelatedCaseId
FROM dbo.conversations
WHERE user_id=@userId
  AND (@filter<>N'linked' OR related_case_id IS NOT NULL)
  AND (@filter<>N'unlinked' OR related_case_id IS NULL)
  AND (@termLike IS NULL OR title LIKE @termLike)
ORDER BY updated_at DESC OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_Chat_ListProfilesByIds] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_ListProfilesByIds @staffIds nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT id AS Id, full_name AS FullName, email AS Email FROM dbo.profiles
WHERE id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@staffIds,','));
END
GO

/* PROCEDURE [dbo].[usp_Chat_OwnsConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Chat_OwnsConversation @conversationId uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.conversations WHERE id=@conversationId AND user_id=@userId; END
GO

/* PROCEDURE [dbo].[usp_ClaimNotificationDeliveries] */
CREATE OR ALTER PROCEDURE dbo.usp_ClaimNotificationDeliveries
  @limit int
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit) * FROM [dbo].[notification_deliveries]
  WHERE [status] = 'pending'
  ORDER BY [created_at];
END
GO

/* PROCEDURE [dbo].[usp_CustomerPulse_GetSetting] */
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

/* PROCEDURE [dbo].[usp_CustomerPulse_GetSurveyCase] */
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

/* PROCEDURE [dbo].[usp_Data_BuildWhere] */
CREATE OR ALTER PROCEDURE dbo.usp_Data_BuildWhere
  @schemaName sysname, @tableName sysname, @filters nvarchar(max), @scope nvarchar(max), @where nvarchar(max) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET @where = N'';
  DECLARE @group int, @filter nvarchar(max), @clause nvarchar(max), @groupClause nvarchar(max), @lastGroup int = -1;
  DECLARE filters_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT COALESCE(TRY_CONVERT(int, JSON_VALUE([value], '$.Group')), 0), [value]
    FROM OPENJSON(@filters)
    ORDER BY COALESCE(TRY_CONVERT(int, JSON_VALUE([value], '$.Group')), 0), CONVERT(int, [key]);
  OPEN filters_cursor;
  FETCH NEXT FROM filters_cursor INTO @group, @filter;
  SET @groupClause = N'';
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF @lastGroup <> @group AND LEN(@groupClause) > 0
    BEGIN
      SET @where += CASE WHEN LEN(@where) > 0 THEN N' AND ' ELSE N'' END + N'(' + @groupClause + N')';
      SET @groupClause = N'';
    END;
    SET @clause = dbo.ufn_Data_Filter(@filter, @schemaName, @tableName);
    IF @clause IS NULL THROW 50001, 'Invalid data filter.', 1;
    SET @groupClause += CASE WHEN LEN(@groupClause) = 0 THEN N'' WHEN @group = 0 THEN N' AND ' ELSE N' OR ' END + @clause;
    SET @lastGroup = @group;
    FETCH NEXT FROM filters_cursor INTO @group, @filter;
  END;
  CLOSE filters_cursor;
  DEALLOCATE filters_cursor;
  IF LEN(@groupClause) > 0
    SET @where += CASE WHEN LEN(@where) > 0 THEN N' AND ' ELSE N'' END + N'(' + @groupClause + N')';

  DECLARE @mode nvarchar(30) = COALESCE(JSON_VALUE(@scope, '$.Mode'), N'none'), @security nvarchar(max) = N'';
  IF @mode = N'owner'
  BEGIN
    SELECT @security = STRING_AGG(CONVERT(nvarchar(max), QUOTENAME([value]) + N' = @rlsUser'), N' OR ')
      FROM OPENJSON(@scope, '$.Columns');
    SET @security = N'(' + COALESCE(@security, N'1 = 0') + N')';
  END
  ELSE IF @mode = N'deny' SET @security = N'1 = 0';
  ELSE IF @mode = N'staffCases'
    SET @security = N'([student_id] = @rlsUser OR [assigned_to] = @rlsUser OR [service_unit_id] IN
      (SELECT [service_unit_id] FROM [dbo].[staff_profiles] WHERE [user_id] = @rlsUser
       UNION SELECT [service_unit_id] FROM [dbo].[service_unit_owners] WHERE [staff_profile_id] = @rlsUser AND [is_active] = 1
       UNION SELECT [id] FROM [dbo].[service_units] WHERE [primary_service_owner_id] = @rlsUser))';
  ELSE IF @mode = N'caseRelated'
    SET @security = N'[case_id] IN (SELECT [id] FROM [dbo].[cases] WHERE [student_id] = @rlsUser OR [assigned_to] = @rlsUser)';
  ELSE IF @mode <> N'none' THROW 50001, 'Invalid data access scope.', 1;
  IF LEN(@security) > 0 SET @where += CASE WHEN LEN(@where) > 0 THEN N' AND ' ELSE N'' END + @security;
  IF LEN(@where) > 0 SET @where = N' WHERE ' + @where;
END;
GO

/* PROCEDURE [dbo].[usp_Data_Columns] */
CREATE OR ALTER PROCEDURE dbo.usp_Data_Columns
  @schemaName sysname, @tableName sysname, @columns nvarchar(max), @select nvarchar(max) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @objectId int = OBJECT_ID(QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName));
  IF @objectId IS NULL THROW 50001, 'Unknown data table.', 1;
  IF JSON_VALUE(@columns, '$[0]') = N'*' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@columns))
    SELECT @select = STRING_AGG(CONVERT(nvarchar(max), QUOTENAME(name)), N', ') WITHIN GROUP (ORDER BY column_id)
      FROM sys.columns WHERE object_id = @objectId;
  ELSE
  BEGIN
    IF EXISTS (SELECT 1 FROM OPENJSON(@columns) j WHERE NOT EXISTS
      (SELECT 1 FROM sys.columns c WHERE c.object_id = @objectId AND c.name = j.[value]))
      THROW 50001, 'Invalid selected column.', 1;
    SELECT @select = STRING_AGG(CONVERT(nvarchar(max), QUOTENAME([value])), N', ')
      WITHIN GROUP (ORDER BY CONVERT(int, [key])) FROM OPENJSON(@columns);
  END;
  IF @select IS NULL THROW 50001, 'No selected columns.', 1;
END;
GO

/* PROCEDURE [dbo].[usp_Data_Select] */
CREATE OR ALTER PROCEDURE dbo.usp_Data_Select
  @schemaName sysname, @tableName sysname, @columns nvarchar(max) = N'["*"]',
  @filters nvarchar(max) = N'[]', @scope nvarchar(max) = N'{"Mode":"none"}', @userId uniqueidentifier = NULL,
  @order nvarchar(max) = N'[]', @limit int = NULL, @offset int = NULL, @countOnly bit = 0
AS
BEGIN
  SET NOCOUNT ON;
  -- Use the current AI result schema, including for legacy SELECT * requests.
  IF @schemaName = N'dbo' AND @tableName = N'ai_settings'
  BEGIN
    SET @tableName = N'vw_AISettings_Compatibility';
    -- Older API schema caches may still include retired fields in SELECT *.
    SELECT @columns = N'[' + COALESCE(STUFF((
        SELECT N',' + N'"' + STRING_ESCAPE([value], 'json') + N'"'
        FROM OPENJSON(@columns) WHERE [value] NOT IN (N'is_singleton', N'daily_cost_limit_usd', N'agent_flags')
        ORDER BY CONVERT(int, [key])
        FOR XML PATH(N''), TYPE).value(N'.', N'nvarchar(max)'), 1, 1, N''), N'') + N']';
  END;
  DECLARE @select nvarchar(max), @where nvarchar(max), @sort nvarchar(max), @sql nvarchar(max),
          @target nvarchar(520) = QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName);
  EXEC dbo.usp_Data_Columns @schemaName, @tableName, @columns, @select OUTPUT;
  EXEC dbo.usp_Data_BuildWhere @schemaName, @tableName, @filters, @scope, @where OUTPUT;
  IF @countOnly = 1
    SET @sql = N'SELECT COUNT(1) FROM ' + @target + @where;
  ELSE
  BEGIN
    SELECT @sort = STRING_AGG(CONVERT(nvarchar(max), QUOTENAME(JSON_VALUE(j.[value], '$.Column'))
        + CASE WHEN JSON_VALUE(j.[value], '$.Descending') = N'true' THEN N' DESC' ELSE N' ASC' END), N', ')
      WITHIN GROUP (ORDER BY CONVERT(int, j.[key]))
      FROM OPENJSON(@order) j
      WHERE EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = OBJECT_ID(@target) AND c.name = JSON_VALUE(j.[value], '$.Column'));
    SET @sql = N'SELECT ' + CASE WHEN COALESCE(@offset, 0) <= 0 AND @limit > 0 THEN N'TOP (@pLimit) ' ELSE N'' END
      + @select + N' FROM ' + @target + @where + COALESCE(N' ORDER BY ' + @sort, N'');
    IF @offset > 0
    BEGIN
      SET @limit = COALESCE(@limit, 1000);
      SET @sql += N' OFFSET @pOffset ROWS FETCH NEXT @pLimit ROWS ONLY';
    END;
  END;
  EXEC sys.sp_executesql @sql, N'@rlsUser uniqueidentifier, @pLimit int, @pOffset int', @userId, @limit, @offset;
END;
GO

/* SKIP [dbo].[usp_Data_Write] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Demo_CountStaff] */
CREATE OR ALTER PROCEDURE dbo.usp_Demo_CountStaff
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*)
  FROM dbo.staff_profiles sp
  INNER JOIN dbo.profiles p ON p.id=sp.user_id
  WHERE COALESCE(p.is_demo_account,0)=1;
END
GO

/* PROCEDURE [dbo].[usp_Demo_CountStudents] */
CREATE OR ALTER PROCEDURE dbo.usp_Demo_CountStudents
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.student_profiles WHERE is_demo_record=1;
END
GO

/* PROCEDURE [dbo].[usp_Demo_InsertAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Demo_InsertAudit
  @actor uniqueidentifier,
  @metadata nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.audit_logs(actor_id,action,entity_type,metadata)
  VALUES(@actor,N'demo.environment_reconciled',N'system',@metadata);
END
GO

/* SKIP [dbo].[usp_Demo_ListAccounts] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Demo_ListStaff] */
CREATE OR ALTER PROCEDURE dbo.usp_Demo_ListStaff
AS
BEGIN
  SET NOCOUNT ON;
  SELECT p.email,p.full_name nameEn,p.full_name nameAr,
         COALESCE((SELECT TOP(1) role FROM dbo.user_roles r WHERE r.user_id=p.id AND r.role<>N'student'),N'service_officer') role,
         su.code unit,sp.job_title_en jobEn,sp.job_title_ar jobAr,
         CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.staff_profile_id=p.id AND o.is_active=1) THEN 1 ELSE 0 END AS bit) isOwner,
         sp.job_title_en scenario,p.full_name display
  FROM dbo.profiles p JOIN dbo.staff_profiles sp ON sp.user_id=p.id
  LEFT JOIN dbo.service_units su ON su.id=sp.service_unit_id
  WHERE COALESCE(p.is_demo_account,0)=1 ORDER BY p.full_name;
END
GO

/* PROCEDURE [dbo].[usp_Demo_ListStudents] */
CREATE OR ALTER PROCEDURE dbo.usp_Demo_ListStudents
AS
BEGIN
  SET NOCOUNT ON;
  SELECT p.email,p.full_name nameEn,COALESCE(sp.preferred_name,p.full_name) nameAr,
         COALESCE(ap.code,N'') program,COALESCE(sp.academic_standing,N'demo') scenario
  FROM dbo.profiles p JOIN dbo.student_profiles sp ON sp.user_id=p.id
  LEFT JOIN dbo.academic_programs ap ON ap.id=sp.program_id
  WHERE COALESCE(p.is_demo_account,0)=1 OR COALESCE(sp.is_demo_record,0)=1 ORDER BY p.full_name;
END
GO

/* PROCEDURE [dbo].[usp_Directory_ListOpenSlots] */
CREATE OR ALTER PROCEDURE dbo.usp_Directory_ListOpenSlots
AS
BEGIN
  SET NOCOUNT ON;
  -- Campus directory shows every currently bookable open slot so the
  -- "Appointments available now" section can surface units with capacity.
  SELECT TOP (200) t.service_unit_id UnitId,s.start_time StartTime
  FROM dbo.appointment_slots s
  JOIN dbo.appointment_types t ON t.id=s.appointment_type_id
  WHERE s.status=N'open' AND s.booked_count<s.capacity AND t.is_active=1
    AND s.start_time>=SYSDATETIMEOFFSET()
  ORDER BY s.start_time;
END
GO

/* PROCEDURE [dbo].[usp_Directory_ListServices] */
CREATE OR ALTER PROCEDURE dbo.usp_Directory_ListServices
AS
BEGIN
  SET NOCOUNT ON;
  SELECT service_unit_id UnitId,code,name_en NameEn,name_ar NameAr,description_en DescriptionEn,description_ar DescriptionAr,category
  FROM dbo.university_services WHERE is_active=1 ORDER BY name_en;
END
GO

/* SKIP [dbo].[usp_Directory_ListUnits] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Documents_AdminListDocuments] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_AdminListDocuments
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (200) id, reference_number, document_type, language, purpose, document_status,
    template_version, issued_at, expires_at, download_count, verification_count,
    is_demo_document, digitally_signed
  FROM dbo.issued_documents
  ORDER BY issued_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Documents_AdminListEvents] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_AdminListEvents
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (100) id, reference_number, event_type, actor_type, created_at, details
  FROM dbo.document_events
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Documents_BumpVerificationCount] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_BumpVerificationCount
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.issued_documents SET verification_count = verification_count + 1 WHERE id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Documents_CountIssued] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_CountIssued
  @id uniqueidentifier,
  @like nvarchar(200) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.issued_documents
  WHERE student_id = @id AND document_status = N'valid' AND deleted_at IS NULL
    AND (@like IS NULL OR reference_number LIKE @like OR title_en LIKE @like OR title_ar LIKE @like);
END
GO

/* PROCEDURE [dbo].[usp_Documents_CountRecentVerifyAttempts] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_CountRecentVerifyAttempts
  @clientHash nvarchar(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.document_verification_attempts
  WHERE client_hash = @clientHash AND created_at > DATEADD(minute, -1, SYSDATETIMEOFFSET());
END
GO

/* SKIP [dbo].[usp_Documents_DeleteStudentDocument] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Documents_GetByVerifyToken] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetByVerifyToken
  @token nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) d.*, p.full_name, sp.student_number, ap.name_en programme, ap.name_ar programme_ar,
    c.name_en college, c.name_ar college_ar
  FROM dbo.issued_documents d
  JOIN dbo.profiles p ON p.id = d.student_id
  LEFT JOIN dbo.student_profiles sp ON sp.user_id = d.student_id
  LEFT JOIN dbo.academic_programs ap ON ap.id = sp.program_id
  LEFT JOIN dbo.colleges c ON c.id = sp.college_id
  WHERE d.secure_verification_token = @token;
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetForDelete] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetForDelete
  @DocumentId uniqueidentifier,
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT reference_number, file_path, secure_verification_token
  FROM dbo.issued_documents
  WHERE id = @DocumentId AND student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetForDownload] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetForDownload
  @DocumentId uniqueidentifier,
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.issued_documents
  WHERE id = @DocumentId AND student_id = @id AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetIssuedById] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetIssuedById
  @docId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.issued_documents WHERE id = @docId;
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetRecentTwimc] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetRecentTwimc
  @id uniqueidentifier,
  @lang nvarchar(20),
  @purpose nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) * FROM dbo.issued_documents
  WHERE student_id = @id AND document_type = N'to_whom_it_may_concern'
    AND language = @lang AND purpose = @purpose
    AND issued_at > DATEADD(minute, -5, SYSDATETIMEOFFSET())
    AND document_status = N'valid'
  ORDER BY issued_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetReference] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetReference
  @DocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT reference_number FROM dbo.issued_documents WHERE id = @DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetRetentionDays] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetRetentionDays
AS
BEGIN
  SET NOCOUNT ON;
  SELECT retention_days FROM dbo.document_retention_policies WHERE document_type = N'to_whom_it_may_concern';
END
GO

/* PROCEDURE [dbo].[usp_Documents_GetStudentContext] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_GetStudentContext
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT p.full_name, p.email, sp.student_number, sp.account_status, sp.academic_level, sp.academic_standing,
    sp.expected_graduation_date, sp.registered_credit_hours,
    ap.name_en programme_en, ap.name_ar programme_ar, ap.degree_level,
    c.name_en college_en, c.name_ar college_ar, t.name_en term_en, t.name_ar term_ar
  FROM dbo.profiles p
  LEFT JOIN dbo.student_profiles sp ON sp.user_id = p.id
  LEFT JOIN dbo.academic_programs ap ON ap.id = sp.program_id
  LEFT JOIN dbo.colleges c ON c.id = sp.college_id
  LEFT JOIN dbo.academic_terms t ON t.id = sp.current_academic_term_id
  WHERE p.id = @id;
END
GO

/* SKIP [dbo].[usp_Documents_GetUserRoles] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Documents_InsertTemplateAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_InsertTemplateAudit
  @actor uniqueidentifier,
  @Id uniqueidentifier,
  @meta nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES(@actor, N'document.template_updated', N'document_template', @Id, @meta);
END
GO

/* PROCEDURE [dbo].[usp_Documents_InsertVerifyAttempt] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_InsertVerifyAttempt
  @tokenHash nvarchar(128),
  @clientHash nvarchar(64),
  @outcome nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.document_verification_attempts(token_hash, client_hash, outcome)
  VALUES(@tokenHash, @clientHash, @outcome);
END
GO

/* PROCEDURE [dbo].[usp_Documents_IssueTwimc] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_IssueTwimc
  @docId uniqueidentifier,
  @id uniqueidentifier,
  @reference nvarchar(100),
  @lang nvarchar(20),
  @purpose nvarchar(100),
  @path nvarchar(500),
  @size int,
  @token nvarchar(200),
  @hash nvarchar(128),
  @template uniqueidentifier = NULL,
  @versions nvarchar(200),
  @fields nvarchar(max),
  @snapshot nvarchar(max),
  @conversation uniqueidentifier = NULL,
  @issued datetimeoffset,
  @expires datetimeoffset = NULL,
  @retentionAt datetimeoffset,
  @details nvarchar(max),
  @tokenDetails nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.issued_documents(
    id, student_id, document_type, reference_number, language, purpose, document_status,
    file_path, file_size_bytes, secure_verification_token, document_hash, template_id, template_version,
    included_fields, snapshot, generated_by_type, conversation_id, issued_at, expires_at,
    retention_expires_at, is_demo_document, digitally_signed)
  VALUES(
    @docId, @id, N'to_whom_it_may_concern', @reference, @lang, @purpose, N'valid',
    @path, @size, @token, @hash, @template, @versions,
    @fields, @snapshot, N'student', @conversation, @issued, @expires,
    @retentionAt, 0, 0);
  INSERT INTO dbo.document_events(document_id, reference_number, event_type, actor_type, actor_id, details)
  VALUES
    (@docId, @reference, N'generated', N'student', @id, @details),
    (@docId, @reference, N'verification_token_created', N'system', @id, @tokenDetails);
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES(@id, N'document.issued', N'issued_document', @docId, @details);
END
GO

/* PROCEDURE [dbo].[usp_Documents_ListApprovedTemplates] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_ListApprovedTemplates
  @langsJson nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.document_templates
  WHERE document_type = N'to_whom_it_may_concern'
    AND language IN (SELECT [value] FROM OPENJSON(@langsJson))
    AND is_active = 1 AND status = N'approved'
  ORDER BY version DESC;
END
GO

/* PROCEDURE [dbo].[usp_Documents_ListIssued] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_ListIssued
  @id uniqueidentifier,
  @like nvarchar(200) = NULL,
  @skip int,
  @take int
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, reference_number, document_type, title_en, title_ar, language, purpose, document_status,
    issued_at, expires_at, retention_expires_at, file_path, secure_verification_token, is_demo_document
  FROM dbo.issued_documents
  WHERE student_id = @id AND document_status = N'valid' AND deleted_at IS NULL
    AND (@like IS NULL OR reference_number LIKE @like OR title_en LIKE @like OR title_ar LIKE @like)
  ORDER BY issued_at DESC
  OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_Documents_ListRetentionPolicies] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_ListRetentionPolicies
AS
BEGIN
  SET NOCOUNT ON;
  SELECT document_type, retention_days, label_en, label_ar
  FROM dbo.document_retention_policies
  ORDER BY document_type;
END
GO

/* PROCEDURE [dbo].[usp_Documents_ListTemplates] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_ListTemplates
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, document_type, language, version, status, is_active, title, header_text, body_template,
    footer_text, signatory_block, disclaimer, validity_days, updated_at
  FROM dbo.document_templates
  ORDER BY language, version DESC;
END
GO

/* PROCEDURE [dbo].[usp_Documents_RecordDownload] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_RecordDownload
  @DocumentId uniqueidentifier,
  @reference nvarchar(100),
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.issued_documents SET download_count = download_count + 1 WHERE id = @DocumentId;
  INSERT INTO dbo.document_events(document_id, reference_number, event_type, actor_type, actor_id)
  VALUES(@DocumentId, @reference, N'downloaded', N'student', @id);
END
GO

/* PROCEDURE [dbo].[usp_Documents_Revoke] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_Revoke
  @DocumentId uniqueidentifier,
  @Reason nvarchar(max),
  @actor uniqueidentifier,
  @reference nvarchar(100),
  @details nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.issued_documents SET
    document_status = N'revoked', verification_status = N'revoked',
    revoked_at = SYSDATETIMEOFFSET(), verification_revoked_at = SYSDATETIMEOFFSET(),
    revoked_by = @actor, revocation_reason = @Reason
  WHERE id = @DocumentId;
  INSERT INTO dbo.document_events(document_id, reference_number, event_type, actor_type, actor_id, details)
  VALUES(@DocumentId, @reference, N'revoked', N'human', @actor, @details);
END
GO

/* PROCEDURE [dbo].[usp_Documents_UpdateRetention] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_UpdateRetention
  @RetentionDays int,
  @DocumentType nvarchar(100),
  @actor uniqueidentifier,
  @meta nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.document_retention_policies
  SET retention_days = @RetentionDays, updated_by = @actor, updated_at = SYSDATETIMEOFFSET()
  WHERE document_type = @DocumentType;
  INSERT INTO dbo.audit_logs(actor_id, action, entity_type, metadata)
  VALUES(@actor, N'document.retention_updated', N'document_retention_policy', @meta);
END
GO

/* PROCEDURE [dbo].[usp_Documents_UpdateTemplate] */
CREATE OR ALTER PROCEDURE dbo.usp_Documents_UpdateTemplate
  @Id uniqueidentifier,
  @Title nvarchar(300),
  @HeaderText nvarchar(max) = NULL,
  @BodyTemplate nvarchar(max),
  @FooterText nvarchar(max) = NULL,
  @SignatoryBlock nvarchar(max) = NULL,
  @Disclaimer nvarchar(max) = NULL,
  @ValidityDays int = NULL,
  @IsActive bit = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.document_templates SET
    title = @Title, header_text = @HeaderText, body_template = @BodyTemplate,
    footer_text = @FooterText, signatory_block = @SignatoryBlock, disclaimer = @Disclaimer,
    validity_days = @ValidityDays, is_active = COALESCE(@IsActive, is_active),
    updated_at = SYSDATETIMEOFFSET()
  WHERE id = @Id;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_Audit] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_Audit @actor uniqueidentifier, @action nvarchar(100), @entity uniqueidentifier, @json nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata)VALUES(@actor,@action,N'case',@entity,@json);
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ChangePlacement] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ChangePlacement
  @old uniqueidentifier, @NewOpportunityId uniqueidentifier, @AssignmentId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.internship_opportunities SET available_seats=available_seats+1 WHERE id=@old;
UPDATE dbo.internship_opportunities SET available_seats=available_seats-1 WHERE id=@NewOpportunityId;
UPDATE dbo.internship_assignments SET opportunity_id=@NewOpportunityId,assignment_status=N'allocated',assigned_at=SYSDATETIMEOFFSET(),assigned_by_type=N'human' WHERE id=@AssignmentId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_FindAssignmentId] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_FindAssignmentId @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT TOP(1) id FROM dbo.internship_assignments WHERE related_case_id=@caseId; END
GO

/* PROCEDURE [dbo].[usp_Dossier_FinishPlacement] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_FinishPlacement
  @AssignmentId uniqueidentifier, @actor uniqueidentifier, @details nvarchar(max), @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.internship_assignment_audit(assignment_id,event_type,actor_type,actor_id,details)VALUES(@AssignmentId,N'placement_changed',N'human',@actor,@details);
UPDATE dbo.cases SET status=N'placement_allocated',outcome_en=N'Internship Placement Allocated',last_activity_at=SYSDATETIMEOFFSET() WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetAssignment] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetAssignment @assignmentId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT a.*,o.opportunity_code,o.title_en,o.title_ar,o.location_emirate,o.location_city,o.work_mode,
 org.name_en organization_name_en,org.name_ar organization_name_ar,org.sector_type AS sector,
 ex.explanation_en,ex.explanation_ar,ex.total_match_score
FROM dbo.internship_assignments a LEFT JOIN dbo.internship_opportunities o ON o.id=a.opportunity_id
LEFT JOIN dbo.internship_organizations org ON org.id=o.organization_id
OUTER APPLY(
  SELECT TOP(1) explanation_en,explanation_ar,total_match_score
  FROM dbo.internship_match_explanations x
  WHERE x.id=a.match_explanation_id
     OR (x.student_id=a.student_id AND x.opportunity_id=a.opportunity_id)
  ORDER BY x.calculated_at DESC
)ex
WHERE a.id=@assignmentId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetCase @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT c.*,cc.name_en category_name_en,cc.name_ar category_name_ar,su.name_en unit_name_en,su.name_ar unit_name_ar,su.code unit_code
FROM dbo.cases c LEFT JOIN dbo.case_categories cc ON cc.id=c.category_id LEFT JOIN dbo.service_units su ON su.id=c.service_unit_id WHERE c.id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetCaseBrief] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetCaseBrief @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT student_id,case_number,language,related_conversation_id,service_unit_id,status FROM dbo.cases WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetConversation @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT id,title,conversation_status,updated_at FROM dbo.conversations WHERE id=@conversationId; END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetLinkedConversation] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetLinkedConversation @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT related_conversation_id FROM dbo.cases WHERE id=@caseId; END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetProfileName] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetProfileName @assigned uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT COALESCE(full_name,email) FROM dbo.profiles WHERE id=@assigned; END
GO

/* PROCEDURE [dbo].[usp_Dossier_GetStudent] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_GetStudent @studentId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT p.id,p.full_name name,p.email,sp.student_number studentNumber,ap.name_en programme,sp.cumulative_gpa cgpa,sp.completed_credit_hours credits
FROM dbo.profiles p LEFT JOIN dbo.student_profiles sp ON sp.user_id=p.id LEFT JOIN dbo.academic_programs ap ON ap.id=sp.program_id WHERE p.id=@studentId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_InsertChatMessage] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_InsertChatMessage
  @conversation uniqueidentifier, @student uniqueidentifier, @body nvarchar(max), @language nvarchar(10), @meta nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.messages(conversation_id,user_id,role,content,language,metadata)VALUES(@conversation,@student,N'assistant',@body,@language,@meta);
UPDATE dbo.conversations SET conversation_status=N'waiting_student',updated_at=SYSDATETIMEOFFSET() WHERE id=@conversation;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_InsertNote] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_InsertNote @id uniqueidentifier, @caseId uniqueidentifier, @actor uniqueidentifier, @body nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_comments(id,case_id,author_id,body,is_internal)VALUES(@id,@caseId,@actor,@body,1);
END
GO

/* PROCEDURE [dbo].[usp_Dossier_InsertStudentMessage] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_InsertStudentMessage @caseId uniqueidentifier, @actor uniqueidentifier, @body nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_comments(case_id,author_id,body,is_internal)VALUES(@caseId,@actor,@body,0);
UPDATE dbo.cases SET last_activity_at=SYSDATETIMEOFFSET() WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListAlternatives] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListAlternatives
AS BEGIN SET NOCOUNT ON;
SELECT TOP(20)o.id,o.opportunity_code,o.title_en,o.title_ar,o.available_seats,org.name_en organization_name_en
FROM dbo.internship_opportunities o LEFT JOIN dbo.internship_organizations org ON org.id=o.organization_id
WHERE o.active_status=N'active' AND o.available_seats>0 ORDER BY o.available_seats DESC;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListComments] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListComments @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id,body,author_id,is_internal,is_info_request,created_at FROM dbo.case_comments WHERE case_id=@caseId ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListMessages] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListMessages @conversationId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id,role,content,created_at FROM dbo.messages WHERE conversation_id=@conversationId AND role IN(N'user',N'assistant') ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListNotices] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListNotices @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id,event_type,title,body,created_at FROM dbo.notification_events WHERE entity_id=@caseId ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListProfileNames] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListProfileNames @actorIds nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT id Id,COALESCE(full_name,email) Name FROM dbo.profiles
WHERE id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@actorIds,','));
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListStaffActors] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListStaffActors @actorIds nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT DISTINCT user_id FROM dbo.user_roles
WHERE user_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@actorIds,',')) AND role<>N'student';
END
GO

/* PROCEDURE [dbo].[usp_Dossier_ListStatusHistory] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_ListStatusHistory @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id,from_status,to_status,note,changed_by,created_at FROM dbo.case_status_history WHERE case_id=@caseId ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_LockAssignment] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_LockAssignment @AssignmentId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT opportunity_id OpportunityId,assignment_status Status FROM dbo.internship_assignments WITH(UPDLOCK) WHERE id=@AssignmentId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_LockSeats] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_LockSeats @NewOpportunityId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT available_seats FROM dbo.internship_opportunities WITH(UPDLOCK) WHERE id=@NewOpportunityId;
END
GO

/* PROCEDURE [dbo].[usp_Dossier_Notify] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_Notify
  @type nvarchar(100), @caseId uniqueidentifier, @recipient uniqueidentifier, @body nvarchar(max),
  @url nvarchar(500), @unit uniqueidentifier=NULL, @actor uniqueidentifier, @dedupe nvarchar(300)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,case_id,service_unit_id,triggered_by,dedupe_key)
VALUES(@type,N'case',@caseId,@recipient,N'in_app',N'Case update',@body,@url,N'pending',@caseId,@unit,@actor,@dedupe);
END
GO

/* PROCEDURE [dbo].[usp_Dossier_Reopen] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_Reopen
  @caseId uniqueidentifier, @from nvarchar(50), @actor uniqueidentifier, @reason nvarchar(max)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=N'reopened',resolved_at=NULL,closed_at=NULL,reopened_count=COALESCE(reopened_count,0)+1,last_activity_at=SYSDATETIMEOFFSET() WHERE id=@caseId;
INSERT INTO dbo.case_status_history(case_id,from_status,to_status,changed_by,note)VALUES(@caseId,@from,N'reopened',@actor,@reason);
END
GO

/* PROCEDURE [dbo].[usp_Dossier_UpdateConversationStatus] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_UpdateConversationStatus @status nvarchar(50), @conversation uniqueidentifier
AS BEGIN SET NOCOUNT ON; UPDATE dbo.conversations SET conversation_status=@status WHERE id=@conversation; END
GO

/* PROCEDURE [dbo].[usp_Dossier_UpdateStatus] */
CREATE OR ALTER PROCEDURE dbo.usp_Dossier_UpdateStatus
  @caseId uniqueidentifier, @status nvarchar(50), @from nvarchar(50), @actor uniqueidentifier, @note nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=@status,last_activity_at=SYSDATETIMEOFFSET(),
  resolved_at=CASE WHEN @status=N'resolved' THEN SYSDATETIMEOFFSET() ELSE resolved_at END,
  closed_at=CASE WHEN @status=N'closed' THEN SYSDATETIMEOFFSET() ELSE closed_at END,
  outcome_en=CASE WHEN @status=N'placement_allocated' THEN N'Internship Placement Allocated' ELSE outcome_en END
WHERE id=@caseId;
INSERT INTO dbo.case_status_history(case_id,from_status,to_status,changed_by,note)VALUES(@caseId,@from,@status,@actor,@note);
END
GO

/* PROCEDURE [dbo].[usp_Exceptions_Insert] */
CREATE OR ALTER PROCEDURE dbo.usp_Exceptions_Insert
  @code nvarchar(100),
  @userId uniqueidentifier = NULL,
  @conversationId uniqueidentifier = NULL,
  @detail nvarchar(2000) = NULL,
  @action nvarchar(200) = NULL,
  @recovered bit = 1,
  @escalated bit = 0,
  @trace nvarchar(100),
  @message nvarchar(max) = NULL,
  @severity nvarchar(50) = N'warning'
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.exception_events(code,severity,user_id,conversation_id,detail,recovered,recovery_action,escalated,trace_id,resolved_at,student_message,is_test)
  OUTPUT INSERTED.id
  VALUES(@code,@severity,@userId,@conversationId,@detail,@recovered,@action,@escalated,@trace,
         CASE WHEN @recovered=1 THEN SYSDATETIMEOFFSET() ELSE NULL END,@message,0);
END
GO

/* PROCEDURE [dbo].[usp_Exceptions_InsertTest] */
CREATE OR ALTER PROCEDURE dbo.usp_Exceptions_InsertTest
  @code nvarchar(100),
  @actor uniqueidentifier,
  @detail nvarchar(max),
  @action nvarchar(200),
  @escalated bit,
  @trace nvarchar(100),
  @message nvarchar(max),
  @scenario nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.exception_events(code,severity,user_id,detail,recovered,recovery_action,escalated,trace_id,resolved_at,student_message,is_test,scenario)
  OUTPUT INSERTED.id
  VALUES(@code,N'warning',@actor,@detail,1,@action,@escalated,@trace,SYSDATETIMEOFFSET(),@message,1,@scenario);
END
GO

/* PROCEDURE [dbo].[usp_Exceptions_ListEvidence] */
CREATE OR ALTER PROCEDURE dbo.usp_Exceptions_ListEvidence
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP(500) id Id,code Code,CAST(recovered AS bit) Recovered,CAST(escalated AS bit) Escalated,
         recovery_action RecoveryAction,trace_id TraceId,created_at CreatedAt,resolved_at ResolvedAt,
         student_message StudentMessage,CAST(is_test AS bit) IsTest,scenario Scenario
  FROM dbo.exception_events ORDER BY created_at DESC;
END
GO

/* SKIP [dbo].[usp_Exceptions_ListLog] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_GetAppointmentSlotForUpdate] */
CREATE OR ALTER PROCEDURE dbo.usp_GetAppointmentSlotForUpdate
  @slotId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[appointment_slots] WITH (UPDLOCK) WHERE [id] = @slotId;
END
GO

/* PROCEDURE [dbo].[usp_GetCaseAccessRow] */
CREATE OR ALTER PROCEDURE dbo.usp_GetCaseAccessRow
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT [student_id] AS StudentId, [assigned_to] AS AssignedTo, [service_unit_id] AS UnitId
  FROM [dbo].[cases] WHERE [id] = @caseId;
END
GO

/* PROCEDURE [dbo].[usp_GetServiceAvailabilityWindows] */
CREATE OR ALTER PROCEDURE dbo.usp_GetServiceAvailabilityWindows
  @serviceId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[service_availability_windows]
  WHERE [service_id] = @serviceId AND [status] = 'active'
  ORDER BY [opens_at];
END
GO

/* PROCEDURE [dbo].[usp_GetStaffAvailabilityRule] */
CREATE OR ALTER PROCEDURE dbo.usp_GetStaffAvailabilityRule
  @ruleId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[staff_availability_rules] WHERE [id] = @ruleId;
END
GO

/* PROCEDURE [dbo].[usp_GetStudentAppointment] */
CREATE OR ALTER PROCEDURE dbo.usp_GetStudentAppointment
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[student_appointments] WHERE [id] = @id;
END
GO

/* PROCEDURE [dbo].[usp_GetUniversityService] */
CREATE OR ALTER PROCEDURE dbo.usp_GetUniversityService
  @serviceId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, code, name_en, name_ar FROM [dbo].[university_services] WHERE [id] = @serviceId;
END
GO

/* SKIP [dbo].[usp_GetUserRoles] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_HasMonitorGrant] */
CREATE OR ALTER PROCEDURE dbo.usp_HasMonitorGrant
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[case_monitor_grants] WHERE [user_id] = @userId AND [is_active] = 1) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_HasRole] */
CREATE OR ALTER PROCEDURE dbo.usp_HasRole
  @userId uniqueidentifier,
  @role nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles] WHERE [user_id] = @userId AND [role] = @role
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_InsertAppointmentSlot] */
CREATE OR ALTER PROCEDURE dbo.usp_InsertAppointmentSlot
  @typeId uniqueidentifier,
  @staffId uniqueidentifier = NULL,
  @t datetimeoffset,
  @slotEnd datetimeoffset,
  @capacity int,
  @location nvarchar(450) = NULL,
  @meeting nvarchar(1024) = NULL
AS
BEGIN
  INSERT INTO [dbo].[appointment_slots]
    (appointment_type_id, staff_profile_id, start_time, end_time, capacity, status, location, meeting_link, data_source, is_demo_record)
  VALUES (@typeId, @staffId, @t, @slotEnd, @capacity, 'open', @location, @meeting, 'admin', 0);
END
GO

/* PROCEDURE [dbo].[usp_Interactions_ConvertToComplaint] */
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_ConvertToComplaint
  @CaseId uniqueidentifier,
  @user uniqueidentifier,
  @note nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.cases SET
    case_type = N'complaint', status = N'submitted',
    current_responsible_actor = N'service_owner', last_activity_at = SYSDATETIMEOFFSET()
  WHERE id = @CaseId;
  INSERT INTO dbo.case_status_history(case_id, to_status, changed_by, note)
  VALUES(@CaseId, N'submitted', @user, @note);
END
GO

/* PROCEDURE [dbo].[usp_Interactions_EscalateCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_EscalateCase
  @caseId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.cases SET status = N'escalated', escalated_at = SYSDATETIMEOFFSET(), escalation_level = 1
  WHERE id = @caseId;
END
GO

/* PROCEDURE [dbo].[usp_Interactions_GetCaseForConvert] */
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_GetCaseForConvert
  @CaseId uniqueidentifier,
  @user uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT case_number Number, case_type Type FROM dbo.cases WHERE id = @CaseId AND student_id = @user;
END
GO

/* SKIP [dbo].[usp_Interactions_GetRoutingCatalog] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Interactions_GetUnitRow] */
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_GetUnitRow
  @unit uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT name_en En, name_ar Ar, primary_service_owner_id Owner
  FROM dbo.service_units WHERE id = @unit;
END
GO

/* PROCEDURE [dbo].[usp_Interactions_InsertCase] */
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

/* PROCEDURE [dbo].[usp_Interactions_InsertSuggestion] */
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

/* SKIP [dbo].[usp_Interactions_ListEmergencyContacts] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_IsAccessRevoked] */
CREATE OR ALTER PROCEDURE dbo.usp_IsAccessRevoked
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[profiles] WHERE [id] = @userId AND [access_revoked_at] IS NOT NULL) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_IsManager] */
CREATE OR ALTER PROCEDURE dbo.usp_IsManager
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles]
    WHERE [user_id] = @userId AND [role] IN ('service_manager','system_admin')
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_IsStaff] */
CREATE OR ALTER PROCEDURE dbo.usp_IsStaff
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[user_roles]
    WHERE [user_id] = @userId AND [role] IN (
      'service_officer','service_owner','service_manager','knowledge_manager',
      'system_admin','auditor','leadership_viewer','integration_admin','knowledge_approver')
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Audit_Insert] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Audit_Insert
  @actorId uniqueidentifier,
  @action nvarchar(100),
  @entityType nvarchar(100),
  @entityId uniqueidentifier = NULL,
  @summary nvarchar(max),
  @json nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.knowledge_audit_log(actor_id, action, entity_type, entity_id, summary, details)
  VALUES(@actorId, @action, @entityType, @entityId, @summary, @json);
END
GO

/* SKIP [dbo].[usp_Knowledge_CenterOverview_GetMetrics] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Knowledge_CenterOverview_ListActivity] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_CenterOverview_ListActivity
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 25 id, action, entity_type, summary, created_at
  FROM dbo.knowledge_audit_log ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_CenterOverview_ListApprovals] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_CenterOverview_ListApprovals
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 25 id, entity_type, entity_label, approval_status, requested_at, due_at
  FROM dbo.knowledge_approval_requests WHERE approval_status=N'pending' ORDER BY requested_at;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_CenterOverview_ListFailures] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_CenterOverview_ListFailures
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 15 id, title, extraction_status, extraction_error, indexing_status
  FROM dbo.knowledge_documents
  WHERE extraction_status=N'failed' OR indexing_status=N'failed';
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_CenterOverview_ListLatencies] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_CenterOverview_ListLatencies
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 50 latency_ms FROM dbo.integration_test_runs
  WHERE latency_ms IS NOT NULL ORDER BY started_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_CenterOverview_ListRecentWebSources] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_CenterOverview_ListRecentWebSources
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 id, title, url, last_checked_at, change_detected, health_status
  FROM dbo.web_knowledge_sources ORDER BY updated_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Conflicts_Resolve] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Conflicts_Resolve
  @Id uniqueidentifier,
  @userId uniqueidentifier,
  @Notes nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_conflicts SET resolution_status=N'resolved', resolved_by=@userId, resolved_at=SYSUTCDATETIME(), resolution_notes=@Notes
  WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_ClearCurrentSchema] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_ClearCurrentSchema
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_schema_versions SET is_current=0 WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_GetCurrentSchema] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_GetCurrentSchema
  @ConnectorId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, schema_hash FROM dbo.integration_schema_versions WHERE connector_id=@ConnectorId AND is_current=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_GetDefaultToolName] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_GetDefaultToolName
  @ConnectorId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 1 tool_name FROM dbo.integration_tools WHERE connector_id=@ConnectorId AND enabled=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_GetEnvRow] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_GetEnvRow
  @Id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT connector_name, environment FROM dbo.integration_connectors WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_GetForTest] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_GetForTest
  @ConnectorId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, connector_name, source_system, is_active FROM dbo.integration_connectors WHERE id=@ConnectorId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_GetToolRow] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_GetToolRow
  @Id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT tool_name, operation_type, connector_id FROM dbo.integration_tools WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_Insert] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_Insert
  @id uniqueidentifier,
  @connectorName nvarchar(100),
  @DisplayNameEn nvarchar(200),
  @displayAr nvarchar(200),
  @SourceSystem nvarchar(200),
  @ConnectorType nvarchar(50),
  @Environment nvarchar(50),
  @BaseUrl nvarchar(2000),
  @AuthenticationType nvarchar(100),
  @CredentialSecretName nvarchar(200) = NULL,
  @credConfigured bit,
  @DataClassification nvarchar(50),
  @cachePolicy nvarchar(max),
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_connectors(
    id, connector_name, display_name_en, display_name_ar, source_system, connector_type, environment, base_url,
    authentication_type, credential_secret_name, credential_configured, data_classification, cache_policy,
    is_demo, is_active, read_enabled, write_enabled, health_status, created_by)
  VALUES(@id, @connectorName, @DisplayNameEn, @displayAr, @SourceSystem, @ConnectorType, @Environment, @BaseUrl,
    @AuthenticationType, @CredentialSecretName, @credConfigured, @DataClassification, @cachePolicy,
    0, 1, 1, 0, N'unknown', @userId);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_InsertHealthEvent] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_InsertHealthEvent
  @ConnectorId uniqueidentifier,
  @health nvarchar(50),
  @latency bigint,
  @error nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_health_events(connector_id, health_status, latency_ms, error_message)
  VALUES(@ConnectorId, @health, @latency, @error);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_InsertManualHealth] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_InsertManualHealth
  @Id uniqueidentifier,
  @HealthStatus nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_health_events(connector_id, health_status, error_message)
  VALUES(@Id, @HealthStatus, N'Set manually by an administrator');
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_InsertMapping] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_InsertMapping
  @ConnectorId uniqueidentifier,
  @ToolId uniqueidentifier = NULL,
  @ExternalField nvarchar(200),
  @InternalField nvarchar(200),
  @DataType nvarchar(50),
  @TransformationRule nvarchar(200) = NULL,
  @Sensitive bit,
  @MaskingRule nvarchar(100) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_field_mappings(connector_id, tool_id, external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule)
  VALUES(@ConnectorId, @ToolId, @ExternalField, @InternalField, @DataType, @TransformationRule, @Sensitive, @MaskingRule);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_InsertSchemaVersion] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_InsertSchemaVersion
  @ConnectorId uniqueidentifier,
  @hash nvarchar(128),
  @snap nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_schema_versions(connector_id, schema_hash, schema_snapshot, is_current)
  VALUES(@ConnectorId, @hash, @snap, 1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_InsertTestRun] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_InsertTestRun
  @ConnectorId uniqueidentifier,
  @status nvarchar(50),
  @latency bigint,
  @schemaValid bit,
  @authValid bit,
  @error nvarchar(max) = NULL,
  @preview nvarchar(max),
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_test_runs(connector_id, test_type, completed_at, status, latency_ms, schema_valid, authorization_valid, error_message, response_preview, run_by)
  VALUES(@ConnectorId, N'tool_call', SYSUTCDATETIME(), @status, @latency, @schemaValid, @authValid, @error, @preview, @userId);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_List] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_List
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, connector_name, display_name_en, display_name_ar, source_system, connector_type, environment,
    base_url, authentication_type, credential_configured, credential_last_tested_at, credential_expires_at,
    data_classification, is_demo, read_enabled, write_enabled, health_status, timeout_ms, last_health_check_at, is_active
  FROM dbo.integration_connectors ORDER BY source_system;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_ListHealth] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_ListHealth
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 50 id, connector_id, health_status, latency_ms, error_message, detected_at
  FROM dbo.integration_health_events ORDER BY detected_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_ListMappings] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_ListMappings
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, connector_id, tool_id, external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule, required
  FROM dbo.integration_field_mappings ORDER BY external_field;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_ListTests] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_ListTests
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 50 id, connector_id, tool_id, test_type, status, latency_ms, schema_valid, authorization_valid,
    error_message, started_at, response_preview
  FROM dbo.integration_test_runs ORDER BY started_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_ListTools] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_ListTools
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, connector_id, tool_name, display_name_en, display_name_ar, operation_type, risk_level,
    confirmation_required, human_approval_required, allowed_roles, enabled
  FROM dbo.integration_tools ORDER BY tool_name;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_Update] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_Update
  @Id uniqueidentifier,
  @IsActive bit = NULL,
  @ReadEnabled bit = NULL,
  @WriteEnabled bit = NULL,
  @HealthStatus nvarchar(50) = NULL,
  @TimeoutMs int = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_connectors SET
    is_active=COALESCE(@IsActive, is_active),
    read_enabled=COALESCE(@ReadEnabled, read_enabled),
    write_enabled=COALESCE(@WriteEnabled, write_enabled),
    health_status=COALESCE(@HealthStatus, health_status),
    timeout_ms=COALESCE(@TimeoutMs, timeout_ms)
  WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_UpdateHealthAfterTest] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_UpdateHealthAfterTest
  @ConnectorId uniqueidentifier,
  @health nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_connectors SET health_status=@health, last_health_check_at=SYSUTCDATETIME(), credential_last_tested_at=SYSUTCDATETIME()
  WHERE id=@ConnectorId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_UpdateMapping] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_UpdateMapping
  @id uniqueidentifier,
  @ConnectorId uniqueidentifier,
  @ToolId uniqueidentifier = NULL,
  @ExternalField nvarchar(200),
  @InternalField nvarchar(200),
  @DataType nvarchar(50),
  @TransformationRule nvarchar(200) = NULL,
  @Sensitive bit,
  @MaskingRule nvarchar(100) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_field_mappings SET
    connector_id=@ConnectorId, tool_id=@ToolId, external_field=@ExternalField, internal_field=@InternalField,
    data_type=@DataType, transformation_rule=@TransformationRule, sensitive=@Sensitive, masking_rule=@MaskingRule
  WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Connectors_UpdateTool] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Connectors_UpdateTool
  @Id uniqueidentifier,
  @Enabled bit = NULL,
  @confirm bit = NULL,
  @human bit = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_tools SET
    enabled=COALESCE(@Enabled, enabled),
    confirmation_required=COALESCE(@confirm, confirmation_required),
    human_approval_required=COALESCE(@human, human_approval_required)
  WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_CountFinancialHolds] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_CountFinancialHolds
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.student_holds WHERE student_id=@userId AND hold_type=N'financial' AND status=N'active';
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_CountGraduationBlockingHolds] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_CountGraduationBlockingHolds
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.student_holds WHERE student_id=@userId AND status=N'active' AND prevents_graduation=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_GetAcademicSummary] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_GetAcademicSummary
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT student_number, program, college, academic_level, cumulative_gpa, completed_credit_hours,
         registered_credit_hours, academic_standing, expected_graduation_date
  FROM dbo.student_profiles WHERE user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_GetConnector] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_GetConnector
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, connector_name, source_system, environment, is_active, read_enabled, write_enabled, health_status
  FROM dbo.integration_connectors WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_GetGraduationProfile] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_GetGraduationProfile
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT completed_credit_hours, cumulative_gpa, expected_graduation_date FROM dbo.student_profiles WHERE user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_GetInternshipProfile] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_GetInternshipProfile
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT completed_credit_hours, cumulative_gpa, academic_standing FROM dbo.student_profiles WHERE user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_GetRegistrationProfile] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_GetRegistrationProfile
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT registered_credit_hours, academic_standing FROM dbo.student_profiles WHERE user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_GetTool] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_GetTool
  @toolName nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 1 id, tool_name, operation_type, enabled, allowed_fields, blocked_fields, allowed_roles, response_schema, timeout_ms, connector_id
  FROM dbo.integration_tools WHERE tool_name=@toolName;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListActiveHolds] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListActiveHolds
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT hold_type, title_en, title_ar, status, prevents_registration, prevents_graduation, resolution_action_en, issued_at
  FROM dbo.student_holds WHERE student_id=@userId AND status=N'active';
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListAppointments] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListAppointments
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 status, created_at FROM dbo.student_appointments WHERE student_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListCases] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListCases
  @userId uniqueidentifier,
  @number nvarchar(100) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 case_number, status, case_type, due_at, last_activity_at
  FROM dbo.cases
  WHERE student_id=@userId AND (@number IS NULL OR @number=N'' OR case_number=@number);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListCourseSections] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListCourseSections
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 s.section_number, s.capacity, s.enrolled_count, s.status, s.meeting_schedule, c.code AS course_code, c.title_en
  FROM dbo.course_sections s LEFT JOIN dbo.courses c ON c.id=s.course_id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListFieldMappings] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListFieldMappings
  @connectorId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule, default_value
  FROM dbo.integration_field_mappings WHERE connector_id=@connectorId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListOpenSlots] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListOpenSlots
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 start_time, end_time, capacity, booked_count, status FROM dbo.appointment_slots
  WHERE status=N'open' AND start_time>=SYSUTCDATETIME() ORDER BY start_time;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_ConnectorsSvc_ListRegistrationBlockingHolds] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_ConnectorsSvc_ListRegistrationBlockingHolds
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT hold_type FROM dbo.student_holds WHERE student_id=@userId AND status=N'active' AND prevents_registration=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_Activate] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_Activate
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET approval_status=N'approved', is_active=1, is_current=1,
    processing_status=N'published', published_at=SYSUTCDATETIME() WHERE id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_DeleteChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_DeleteChunks
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.document_chunks WHERE document_id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_GetForActivate] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_GetForActivate
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, title, language, knowledge_domain, extraction_status, indexing_status, approval_status,
         is_active, is_current, deleted_at, effective_date, expiry_date, superseded_by_document_id
  FROM dbo.knowledge_documents WHERE id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_GetForDiagnose] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_GetForDiagnose
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, title, approval_status, is_active, is_current, deleted_at, effective_date, expiry_date, superseded_by_document_id
  FROM dbo.knowledge_documents WHERE id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_GetForReprocess] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_GetForReprocess
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, title, language, version, effective_date, expiry_date, storage_path, mime_type,
         approval_status, is_active, is_current, deleted_at, superseded_by_document_id
  FROM dbo.knowledge_documents WHERE id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_InsertChunk] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_InsertChunk
  @chunkId uniqueidentifier,
  @documentId uniqueidentifier,
  @ChunkNumber int,
  @Content nvarchar(max),
  @TokenCount int,
  @SectionTitle nvarchar(500) = NULL,
  @SectionPath nvarchar(1000) = NULL,
  @PageNumber int = NULL,
  @SourceLocator nvarchar(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.document_chunks(id, document_id, chunk_index, content, token_count, section_title, section_path, page_number, source_locator, is_active)
  VALUES(@chunkId, @documentId, @ChunkNumber, @Content, @TokenCount, @SectionTitle, @SectionPath, @PageNumber, @SourceLocator, 1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_ListChunkContents] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_ListChunkContents
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT chunk_index, content FROM dbo.document_chunks WHERE document_id=@documentId ORDER BY chunk_index;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_ListChunkSections] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_ListChunkSections
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT section_title, content FROM dbo.document_chunks WHERE document_id=@documentId ORDER BY chunk_index;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_ListChunksForDiagnose] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_ListChunksForDiagnose
  @documentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT chunk_index, section_title, section_path, page_number, content
  FROM dbo.document_chunks WHERE document_id=@documentId ORDER BY chunk_index;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_RevertActivation] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_RevertActivation
  @documentId uniqueidentifier,
  @approval_status nvarchar(50) = NULL,
  @is_active bit = NULL,
  @is_current bit = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET approval_status=@approval_status, is_active=@is_active, is_current=@is_current
  WHERE id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_DocOps_UpdateAfterReprocess] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_DocOps_UpdateAfterReprocess
  @detected nvarchar(20),
  @documentId uniqueidentifier,
  @issuesJson nvarchar(max),
  @qualityStatus nvarchar(50),
  @processingStatus nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET
    detected_language=@detected, extraction_status=N'completed', chunking_status=N'completed',
    indexing_status=N'completed', embedding_status=N'completed',
    quality_status=@qualityStatus, quality_issues=@issuesJson,
    processing_status=@processingStatus, extraction_error=NULL
  WHERE id=@documentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_ActivateChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_ActivateChunks
  @PreviousId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.document_chunks SET is_active=1 WHERE document_id=@PreviousId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_Approve] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_Approve
  @DocumentId uniqueidentifier,
  @userId uniqueidentifier,
  @now datetime2,
  @status nvarchar(50),
  @publishedAt datetime2 = NULL,
  @active bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET
    approval_status=@status, approved_by=@userId, approved_at=@now,
    published_at=@publishedAt, is_active=@active, is_current=@active
  WHERE id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_DeactivateChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_DeactivateChunks
  @DocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.document_chunks SET is_active=0 WHERE document_id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_DeactivateChunksByTarget] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_DeactivateChunksByTarget
  @TargetDocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.document_chunks SET is_active=0 WHERE document_id=@TargetDocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_DecideApprovalRequest] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_DecideApprovalRequest
  @DocumentId uniqueidentifier,
  @reqStatus nvarchar(50),
  @now datetime2,
  @userId uniqueidentifier,
  @Notes nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_approval_requests SET approval_status=@reqStatus, decided_at=@now, decided_by=@userId, review_notes=@Notes
  WHERE entity_id=@DocumentId AND approval_status=N'pending';
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_GetDecideRow] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_GetDecideRow
  @DocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, title, effective_date, supersedes_document_id FROM dbo.knowledge_documents WHERE id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_GetQualityRow] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_GetQualityRow
  @DocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, title, quality_status FROM dbo.knowledge_documents WHERE id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_GetReplaceTarget] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_GetReplaceTarget
  @TargetDocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, title, version, is_active, approval_status FROM dbo.knowledge_documents WHERE id=@TargetDocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_InsertApprovalRequest] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_InsertApprovalRequest
  @DocumentId uniqueidentifier,
  @title nvarchar(500),
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.knowledge_approval_requests(entity_type, entity_id, entity_label, requested_by, assigned_approver_role, approval_status, due_at)
  VALUES(N'knowledge_document', @DocumentId, @title, @userId, N'knowledge_approver', N'pending', DATEADD(day,5,SYSUTCDATETIME()));
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_List] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_List
  @search nvarchar(400) = NULL,
  @status nvarchar(100) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 300 id, title, document_type, language, version, effective_date, review_date, expiry_date,
    approval_status, processing_status, extraction_status, indexing_status, quality_status, quality_issues,
    confidentiality_level, is_current, is_active, usage_count, owner_unit_id, category_id,
    supersedes_document_id, superseded_by_document_id, created_at
  FROM dbo.knowledge_documents
  WHERE (@status IS NULL OR @status=N'all' OR approval_status=@status)
    AND (@search IS NULL OR title LIKE N'%' + @search + N'%')
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_ListCategories] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_ListCategories
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, code, name_en, name_ar FROM dbo.knowledge_document_categories
  WHERE is_active=1 ORDER BY sort_order;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_ListUnits] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_ListUnits
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, code, name_en, name_ar FROM dbo.service_units ORDER BY code;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_MarkSuperseded] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_MarkSuperseded
  @DocumentId uniqueidentifier,
  @supersededId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET is_current=0, approval_status=N'superseded', superseded_by_document_id=@DocumentId
  WHERE id=@supersededId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_PublishReplacement] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_PublishReplacement
  @id uniqueidentifier,
  @userId uniqueidentifier,
  @now datetime2
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET approval_status=N'approved', approved_by=@userId, approved_at=@now,
    published_at=@now, is_active=1, is_current=1, processing_status=N'published' WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_Retire] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_Retire
  @DocumentId uniqueidentifier,
  @Reason nvarchar(max),
  @ReplacementId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET
    approval_status=N'retired', is_active=0, is_current=0, retired_at=SYSUTCDATETIME(),
    retirement_reason=@Reason, superseded_by_document_id=@ReplacementId
  WHERE id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_RollbackCurrent] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_RollbackCurrent
  @CurrentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET is_current=0, is_active=0, approval_status=N'needs_revision' WHERE id=@CurrentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_RollbackPrevious] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_RollbackPrevious
  @PreviousId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET is_current=1, is_active=1, approval_status=N'published', superseded_by_document_id=NULL WHERE id=@PreviousId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_SetApprovalStatus] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_SetApprovalStatus
  @DocumentId uniqueidentifier,
  @status nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET approval_status=@status WHERE id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_SetPendingReview] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_SetPendingReview
  @DocumentId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET approval_status=N'pending_review' WHERE id=@DocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Documents_SupersedeTarget] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Documents_SupersedeTarget
  @id uniqueidentifier,
  @TargetDocumentId uniqueidentifier,
  @now datetime2,
  @reason nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET is_active=0, is_current=0, approval_status=N'superseded',
    superseded_by_document_id=@id, retired_at=@now, retirement_reason=@reason WHERE id=@TargetDocumentId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Embeddings_ListUnembeddedDocChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Embeddings_ListUnembeddedDocChunks
  @limit int
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP (@limit) id, content, section_title
  FROM dbo.document_chunks WHERE embedding IS NULL AND is_active=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Embeddings_ListUnembeddedWebChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Embeddings_ListUnembeddedWebChunks
  @limit int
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP (@limit) id, content, section_title, page_title
  FROM dbo.web_page_chunks WHERE embedding IS NULL AND is_active=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Embeddings_UpdateDocumentChunk] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Embeddings_UpdateDocumentChunk
  @vec nvarchar(max),
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.document_chunks SET embedding=@vec WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Embeddings_UpdateWebPageChunk] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Embeddings_UpdateWebPageChunk
  @vec nvarchar(max),
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_page_chunks SET embedding=@vec WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Export_ListAuthorityRules] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Export_ListAuthorityRules
AS
BEGIN
  SET NOCOUNT ON;

  SELECT data_domain, primary_source_type, secondary_source_type, conflict_behavior, cache_allowed, maximum_staleness_minutes
  FROM dbo.data_authority_rules;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Export_ListConnectors] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Export_ListConnectors
AS
BEGIN
  SET NOCOUNT ON;

  SELECT connector_name, source_system, connector_type, environment, authentication_type, data_classification, read_enabled, write_enabled, is_active
  FROM dbo.integration_connectors;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Export_ListDocuments] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Export_ListDocuments
AS
BEGIN
  SET NOCOUNT ON;

  SELECT title, document_type, language, version, effective_date, review_date, expiry_date, approval_status, confidentiality_level
  FROM dbo.knowledge_documents;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Export_ListFaqs] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Export_ListFaqs
AS
BEGIN
  SET NOCOUNT ON;

  SELECT question_en, question_ar, answer_en, answer_ar, approval_status, effective_date, priority FROM dbo.faq_items;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Export_ListMappings] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Export_ListMappings
AS
BEGIN
  SET NOCOUNT ON;

  SELECT external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule FROM dbo.integration_field_mappings;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Export_ListTools] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Export_ListTools
AS
BEGIN
  SET NOCOUNT ON;

  SELECT tool_name, operation_type, risk_level, confirmation_required, human_approval_required, enabled FROM dbo.integration_tools;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Gaps_SetStatus] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Gaps_SetStatus
  @Id uniqueidentifier,
  @Status nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_gaps SET status=@Status WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_GetEmbeddingSettings] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_GetEmbeddingSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) LOWER(LTRIM(RTRIM(ProviderCode))) AS Provider,
        COALESCE(EmbeddingModel, N'') AS Model, BaseUrl AS ApiUrl, ApiKey AS ApiKey
    FROM dbo.AISettings
    WHERE IsEnabled = 1
    ORDER BY UpdatedAt DESC, AiSettingId;
END;
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_GetIndexMetrics] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_GetIndexMetrics
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    (SELECT COUNT(*) FROM dbo.knowledge_documents WHERE is_active=1 AND approval_status=N'approved') AS activeDocuments,
    (SELECT COUNT(*) FROM dbo.knowledge_documents WHERE approval_status IN (N'pending_review',N'needs_revision',N'draft') AND deleted_at IS NULL) AS needsReviewDocuments,
    (SELECT COUNT(*) FROM dbo.knowledge_documents WHERE extraction_status=N'failed' OR indexing_status=N'failed' OR quality_status=N'failed') AS failedDocuments,
    (SELECT COUNT(*) FROM dbo.document_chunks WHERE is_active=1) AS docChunks,
    (SELECT COUNT(*) FROM dbo.document_chunks WHERE is_active=1 AND embedding IS NOT NULL) AS docChunksEmbedded,
    (SELECT COUNT(*) FROM dbo.web_knowledge_sources WHERE is_active=1 AND approval_status=N'approved') AS activeWebSources,
    (SELECT COUNT(*) FROM dbo.web_source_pages WHERE is_active=1 AND status=N'indexed') AS webPagesIndexed,
    (SELECT COUNT(*) FROM dbo.web_page_chunks WHERE is_active=1) AS webChunks,
    (SELECT COUNT(*) FROM dbo.web_page_chunks WHERE is_active=1 AND embedding IS NOT NULL) AS webChunksEmbedded,
    (SELECT COUNT(*) FROM dbo.integration_connectors WHERE is_active=1) AS activeApis,
    (SELECT COUNT(*) FROM dbo.integration_connectors WHERE health_status=N'offline') AS failedApis,
    (SELECT COUNT(*) FROM dbo.knowledge_documents WHERE is_active=1 AND language=N'en') AS englishDocuments,
    (SELECT COUNT(*) FROM dbo.knowledge_documents WHERE is_active=1 AND language=N'ar') AS arabicDocuments,
    (SELECT COUNT(*) FROM dbo.knowledge_retrieval_logs WHERE selected_for_response=0) AS emptyRetrievals;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_ListConflicts] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_ListConflicts
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 100 id, conflict_type, affected_topic, severity, source_one_type, source_two_type,
    conflicting_statement_one, conflicting_statement_two, resolution_status, detected_at
  FROM dbo.knowledge_conflicts ORDER BY detected_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_ListCoverage] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_ListCoverage
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 50 service_id, coverage_score, topics_with_approved_source, total_known_topics,
    topics_with_ar_content, topics_with_en_content, unresolved_conflicts, knowledge_gaps, updated_at
  FROM dbo.service_knowledge_health ORDER BY coverage_score;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_ListGaps] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_ListGaps
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 100 id, normalized_topic, language, occurrence_count, average_confidence, human_handoff_count,
    negative_feedback_count, recommended_source_type, priority_score, status, sample_questions
  FROM dbo.knowledge_gaps ORDER BY priority_score DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_ListIssues] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_ListIssues
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 50 id, source_type, issue_type, description, priority, status, created_at
  FROM dbo.knowledge_issue_reports ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_ListRetrievalLogs] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_ListRetrievalLogs
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 1000 source_type, source_id, selected_for_response, citation_used FROM dbo.knowledge_retrieval_logs;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Health_ListServices] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Health_ListServices
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, code, name_en, name_ar FROM dbo.university_services;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Ingest_FindByChecksum] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Ingest_FindByChecksum
  @sum nvarchar(128)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 1 id, title FROM dbo.knowledge_documents WHERE checksum=@sum AND deleted_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Ingest_InsertChunk] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Ingest_InsertChunk
  @chunkId uniqueidentifier,
  @id uniqueidentifier,
  @ChunkNumber int,
  @Content nvarchar(max),
  @TokenCount int,
  @SectionTitle nvarchar(500) = NULL,
  @SectionPath nvarchar(1000) = NULL,
  @PageNumber int = NULL,
  @SourceLocator nvarchar(500) = NULL,
  @meta nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.document_chunks(id, document_id, chunk_index, content, token_count, section_title, section_path, page_number, source_locator, metadata, is_active)
  VALUES(@chunkId, @id, @ChunkNumber, @Content, @TokenCount, @SectionTitle, @SectionPath, @PageNumber, @SourceLocator, @meta, 1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Ingest_InsertDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Ingest_InsertDocument
  @id uniqueidentifier,
  @Title nvarchar(500),
  @description nvarchar(max) = NULL,
  @DocumentType nvarchar(100),
  @CategoryId uniqueidentifier = NULL,
  @OwnerUnitId uniqueidentifier = NULL,
  @KnowledgeDomain nvarchar(200) = NULL,
  @Language nvarchar(20),
  @Version nvarchar(50),
  @EffectiveDate nvarchar(20),
  @ReviewDate nvarchar(20) = NULL,
  @ExpiryDate nvarchar(20) = NULL,
  @ConfidentialityLevel nvarchar(50),
  @FileName nvarchar(500),
  @SizeBytes bigint,
  @MimeType nvarchar(200),
  @StoragePath nvarchar(1000) = NULL,
  @sum nvarchar(128),
  @detected nvarchar(20),
  @extractionStatus nvarchar(50),
  @extractionError nvarchar(max) = NULL,
  @chunkingStatus nvarchar(50),
  @embeddingStatus nvarchar(50),
  @indexingStatus nvarchar(50),
  @qualityStatus nvarchar(50),
  @issuesJson nvarchar(max),
  @processingStatus nvarchar(50),
  @Notes nvarchar(max) = NULL,
  @SupersedesDocumentId uniqueidentifier = NULL,
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.knowledge_documents(
    id, title, description, document_type, category_id, owner_unit_id, service_unit_id, knowledge_domain,
    language, authoritative_language, version, effective_date, review_date, expiry_date, confidentiality_level,
    file_name, file_size_bytes, mime_type, storage_path, checksum, detected_language,
    extraction_status, extraction_error, chunking_status, embedding_status, indexing_status,
    quality_status, quality_issues, processing_status, approval_status, is_active, is_current,
    notes, supersedes_document_id, created_by)
  VALUES(
    @id, @Title, @description, @DocumentType, @CategoryId, @OwnerUnitId, @OwnerUnitId, @KnowledgeDomain,
    @Language, @Language, @Version, @EffectiveDate, @ReviewDate, @ExpiryDate, @ConfidentialityLevel,
    @FileName, @SizeBytes, @MimeType, @StoragePath, @sum, @detected,
    @extractionStatus, @extractionError, @chunkingStatus, @embeddingStatus, @indexingStatus,
    @qualityStatus, @issuesJson, @processingStatus, N'draft', 0, 0,
    @Notes, @SupersedesDocumentId, @userId);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Issues_Insert] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Issues_Insert
  @id uniqueidentifier,
  @SourceType nvarchar(50),
  @SourceId uniqueidentifier = NULL,
  @userId uniqueidentifier,
  @IssueType nvarchar(100),
  @Description nvarchar(max) = NULL,
  @RelatedConversationId uniqueidentifier = NULL,
  @Priority nvarchar(50)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.knowledge_issue_reports(id, source_type, source_id, reported_by, issue_type, description, related_conversation_id, priority)
  VALUES(@id, @SourceType, @SourceId, @userId, @IssueType, @Description, @RelatedConversationId, @Priority);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Permissions_ListRoles] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Permissions_ListRoles
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT role FROM dbo.user_roles WHERE user_id=@userId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_CountCategory] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_CountCategory
  @Code nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.knowledge_document_categories WHERE code=@Code;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_CountFaq] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_CountFaq
  @QEn nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.faq_items WHERE question_en=@QEn;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_CountTool] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_CountTool
  @cid uniqueidentifier,
  @Name nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.integration_tools WHERE connector_id=@cid AND tool_name=@Name;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_FindConnector] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_FindConnector
  @Name nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id FROM dbo.integration_connectors WHERE connector_name=@Name AND environment=N'development';
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_FindDocumentByTitle] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_FindDocumentByTitle
  @Title nvarchar(500)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id FROM dbo.knowledge_documents WHERE title=@Title;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_InsertCategory] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_InsertCategory
  @Code nvarchar(100),
  @En nvarchar(200),
  @Ar nvarchar(200),
  @sort int
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.knowledge_document_categories(code, name_en, name_ar, sort_order) VALUES(@Code,@En,@Ar,@sort);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_InsertChunk] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_InsertChunk
  @cid uniqueidentifier,
  @id uniqueidentifier,
  @ChunkNumber int,
  @Content nvarchar(max),
  @TokenCount int,
  @SectionTitle nvarchar(500) = NULL,
  @SectionPath nvarchar(1000) = NULL,
  @SourceLocator nvarchar(500) = NULL,
  @active bit
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.document_chunks(id, document_id, chunk_index, content, token_count, section_title, section_path, source_locator, is_active)
  VALUES(@cid, @id, @ChunkNumber, @Content, @TokenCount, @SectionTitle, @SectionPath, @SourceLocator, @active);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_InsertDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_InsertDocument
  @id uniqueidentifier,
  @Title nvarchar(500),
  @desc nvarchar(max),
  @Type nvarchar(100),
  @cat uniqueidentifier = NULL,
  @unit uniqueidentifier = NULL,
  @Lang nvarchar(20),
  @Version nvarchar(50),
  @effective nvarchar(20),
  @Conf nvarchar(50),
  @file nvarchar(500),
  @size int,
  @sum nvarchar(128),
  @approval nvarchar(50),
  @userId uniqueidentifier,
  @active bit
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.knowledge_documents(
    id, title, description, document_type, category_id, owner_unit_id, service_unit_id, language, authoritative_language,
    version, effective_date, review_date, confidentiality_level, file_name, mime_type, file_size_bytes, checksum,
    detected_language, extraction_status, chunking_status, embedding_status, indexing_status, quality_status,
    processing_status, approval_status, approved_by, approved_at, published_at, is_active, is_current, created_by)
  VALUES(
    @id, @Title, @desc, @Type, @cat, @unit, @unit, @Lang, @Lang, @Version, @effective, '2026-09-01', @Conf,
    @file, N'text/markdown', @size, @sum, @Lang, N'completed', N'completed', N'completed', N'completed', N'passed',
    N'published', @approval, @userId, SYSUTCDATETIME(), SYSUTCDATETIME(), @active, @active, @userId);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_InsertFaq] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_InsertFaq
  @QEn nvarchar(max),
  @QAr nvarchar(max),
  @AEn nvarchar(max),
  @AAr nvarchar(max),
  @unit uniqueidentifier = NULL,
  @userId uniqueidentifier,
  @priority int
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.faq_items(question_en, question_ar, answer_en, answer_ar, service_unit_id, approval_status, approved_by, approved_at, effective_date, review_date, priority, is_active)
  VALUES(@QEn,@QAr,@AEn,@AAr,@unit,N'approved',@userId,SYSUTCDATETIME(),'2025-09-01','2026-09-01',@priority,1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_InsertTool] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_InsertTool
  @cid uniqueidentifier,
  @Name nvarchar(200),
  @En nvarchar(200),
  @Ar nvarchar(200),
  @desc nvarchar(500),
  @path nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.integration_tools(connector_id, tool_name, display_name_en, display_name_ar, description, operation_type, endpoint_path, http_method, allowed_roles, risk_level, enabled)
  VALUES(@cid,@Name,@En,@Ar,@desc,N'read',@path,N'GET',N'["student","service_officer","service_manager","system_admin"]',N'low',1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_LinkSupersededBy] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_LinkSupersededBy
  @current uniqueidentifier,
  @old uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET superseded_by_document_id=@current WHERE id=@old;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_LinkSupersedes] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_LinkSupersedes
  @current uniqueidentifier,
  @old uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET supersedes_document_id=@old WHERE id=@current;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_ListCategories] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_ListCategories
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, code FROM dbo.knowledge_document_categories;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Seed_ListUnits] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Seed_ListUnits
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 20 id, code FROM dbo.service_units;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_CountActiveChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_CountActiveChunks
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.document_chunks WHERE document_id=@id AND is_active=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_CountChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_CountChunks
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.document_chunks WHERE document_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_CountEnabledTools] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_CountEnabledTools
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT COUNT(*) FROM dbo.integration_tools WHERE connector_id=@id AND enabled=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_DeleteChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_DeleteChunks
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.document_chunks WHERE document_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_DeleteWeb] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_DeleteWeb
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.web_knowledge_sources WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_DeleteWebChanges] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_DeleteWebChanges
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.web_source_changes WHERE web_source_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_DisableApi] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_DisableApi
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_connectors SET is_active=0, read_enabled=0, write_enabled=0, health_status=N'offline' WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_DisableApiTools] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_DisableApiTools
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_tools SET enabled=0 WHERE connector_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_EnableApi] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_EnableApi
  @id uniqueidentifier,
  @enabled bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.integration_connectors SET is_active=@enabled, read_enabled=@enabled WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_EnableDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_EnableDocument
  @id uniqueidentifier,
  @enabled bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET is_active=@enabled, is_current=@enabled,
    approval_status=CASE WHEN @enabled=1 THEN N'approved' ELSE N'retired' END,
    retired_at=CASE WHEN @enabled=1 THEN NULL ELSE SYSUTCDATETIME() END,
    retirement_reason=CASE WHEN @enabled=1 THEN NULL ELSE N'Disabled by an administrator' END
  WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_EnableWeb] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_EnableWeb
  @id uniqueidentifier,
  @enabled bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET is_active=@enabled WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_GetApi] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_GetApi
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT * FROM dbo.integration_connectors WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_GetDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_GetDocument
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT * FROM dbo.knowledge_documents WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_GetStoragePath] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_GetStoragePath
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT storage_path FROM dbo.knowledge_documents WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_GetWeb] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_GetWeb
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT * FROM dbo.web_knowledge_sources WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListApiHealth] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListApiHealth
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 id, health_status, latency_ms, error_message, detected_at FROM dbo.integration_health_events WHERE connector_id=@id ORDER BY detected_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListApis] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListApis
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 300 id, connector_name, display_name_en, source_system, connector_type, data_classification,
    is_active, health_status, last_health_check_at, created_at, updated_at
  FROM dbo.integration_connectors ORDER BY source_system;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListApiTests] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListApiTests
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 id, status, latency_ms, error_message, started_at FROM dbo.integration_test_runs WHERE connector_id=@id ORDER BY started_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListApiTools] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListApiTools
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, tool_name, display_name_en, operation_type, risk_level, enabled FROM dbo.integration_tools WHERE connector_id=@id ORDER BY tool_name;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListAudit
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 25 id, action, summary, created_at FROM dbo.knowledge_audit_log WHERE entity_id=@id ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListDocChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListDocChunks
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 80 chunk_index, section_title, section_path, page_number, token_count, content, is_active
  FROM dbo.document_chunks WHERE document_id=@id ORDER BY chunk_index;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListDocuments] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListDocuments
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 500 id, title, document_type, knowledge_domain, language, version, approval_status, processing_status,
    extraction_status, indexing_status, quality_status, is_active, is_current, deleted_at, effective_date, expiry_date,
    superseded_by_document_id, mime_type, created_by, created_at, updated_at, owner_unit_id
  FROM dbo.knowledge_documents ORDER BY updated_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListDocVersions] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListDocVersions
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, version, approval_status, is_active, is_current, effective_date, expiry_date, created_at, retirement_reason, superseded_by_document_id, supersedes_document_id
  FROM dbo.knowledge_documents
  WHERE id=@id OR supersedes_document_id=@id OR superseded_by_document_id=@id ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListProfiles] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListProfiles
  @actorIds nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, full_name, email FROM dbo.profiles
  WHERE id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@actorIds, N','));
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListRetrievalLogs] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListRetrievalLogs
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 10 query_text, retrieval_score, selected_for_response, retrieved_at, section_title
  FROM dbo.knowledge_retrieval_logs WHERE source_id=@id ORDER BY retrieved_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListUnits] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListUnits
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 200 id, code, name_en FROM dbo.service_units;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListWeb] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListWeb
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 300 id, title, url, language, source_category, is_active, health_status, change_detected, approval_status,
    last_checked_at, last_changed_at, last_successful_fetch_at, created_by, created_at, updated_at, owner_unit_id
  FROM dbo.web_knowledge_sources ORDER BY updated_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_ListWebChanges] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_ListWebChanges
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 20 id, change_type, change_summary, change_percentage, detected_at, review_status
  FROM dbo.web_source_changes WHERE web_source_id=@id ORDER BY detected_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_SetChunksActive] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_SetChunksActive
  @id uniqueidentifier,
  @enabled bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.document_chunks SET is_active=@enabled WHERE document_id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_SoftDeleteDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_SoftDeleteDocument
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.knowledge_documents SET deleted_at=SYSUTCDATETIME(), is_active=0, is_current=0,
    approval_status=N'retired', retirement_reason=N'Deleted from the knowledge centre', storage_path=NULL
  WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Sources_SoftDeleteWeb] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Sources_SoftDeleteWeb
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET is_active=0, approval_status=N'rejected', health_status=N'removed' WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_ApplyChangeDecision] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_ApplyChangeDecision
  @web uniqueidentifier,
  @status nvarchar(50),
  @active bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET change_detected=0,
    approval_status=@status, is_active=@active WHERE id=@web;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_GetChangeSourceId] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_GetChangeSourceId
  @ChangeId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT web_source_id FROM dbo.web_source_changes WHERE id=@ChangeId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_GetSourceForRefresh] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_GetSourceForRefresh
  @Id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, url, title, content_hash, extracted_text, trusted_auto_refresh, source_category, knowledge_domain,
         crawl_scope, max_depth, max_pages, seed_urls, allowed_paths, excluded_path_patterns
  FROM dbo.web_knowledge_sources WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_InsertAccessFailedChange] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_InsertAccessFailedChange
  @Id uniqueidentifier,
  @hash nvarchar(128) = NULL,
  @reason nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.web_source_changes(web_source_id, previous_content_hash, change_type, change_summary, detected_at)
  VALUES(@Id, @hash, N'access_failed', @reason, SYSUTCDATETIME());
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_InsertChange] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_InsertChange
  @Id uniqueidentifier,
  @prev nvarchar(128) = NULL,
  @corpusHash nvarchar(128),
  @changeType nvarchar(50),
  @summary nvarchar(max),
  @pct float,
  @review nvarchar(50),
  @approvedAt datetime2 = NULL
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.web_source_changes(web_source_id, previous_content_hash, new_content_hash, change_type, change_summary, change_percentage, review_status, approved_at)
  VALUES(@Id, @prev, @corpusHash, @changeType, @summary, @pct, @review, @approvedAt);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_InsertSource] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_InsertSource
  @newId uniqueidentifier,
  @Title nvarchar(500),
  @Url nvarchar(2000),
  @Language nvarchar(20),
  @SourceCategory nvarchar(100),
  @ConfidentialityLevel nvarchar(50),
  @RefreshFrequency nvarchar(50),
  @OwnerUnitId uniqueidentifier = NULL,
  @TrustedAutoRefresh bit,
  @KnowledgeDomain nvarchar(200) = NULL,
  @CrawlScope nvarchar(50),
  @maxDepth int,
  @maxPages int,
  @seedJson nvarchar(max),
  @allowedJson nvarchar(max),
  @excludedJson nvarchar(max),
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.web_knowledge_sources(
    id, title, url, language, source_category, confidentiality_level, refresh_frequency, owner_unit_id,
    trusted_auto_refresh, knowledge_domain, crawl_scope, max_depth, max_pages, seed_urls, allowed_paths,
    excluded_path_patterns, created_by)
  VALUES(@newId, @Title, @Url, @Language, @SourceCategory, @ConfidentialityLevel, @RefreshFrequency, @OwnerUnitId,
    @TrustedAutoRefresh, @KnowledgeDomain, @CrawlScope, @maxDepth, @maxPages, @seedJson, @allowedJson, @excludedJson, @userId);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_ListChanges] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_ListChanges
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 100 id, web_source_id, change_type, change_summary, change_percentage, detected_at, review_status
  FROM dbo.web_source_changes ORDER BY detected_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_ListPages] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_ListPages
  @Id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 300 id, url, title, language, depth, status, error_reason, text_length, chunk_count, fetched_at, indexed_at, is_active
  FROM dbo.web_source_pages WHERE web_source_id=@Id ORDER BY depth, url;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_ListSources] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_ListSources
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 200 id, title, url, language, source_category, confidentiality_level, refresh_frequency,
    last_checked_at, last_successful_fetch_at, last_indexed_at, change_detected, health_status, approval_status,
    is_active, owner_unit_id, knowledge_domain, crawl_scope, max_depth, max_pages, seed_urls, allowed_paths,
    excluded_path_patterns, pages_discovered, pages_indexed, pages_failed, chunk_count, ingestion_status, last_error
  FROM dbo.web_knowledge_sources ORDER BY updated_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_MarkCrawlEmpty] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_MarkCrawlEmpty
  @Id uniqueidentifier,
  @health nvarchar(50),
  @err nvarchar(500),
  @discovered int,
  @failed int
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET ingestion_status=N'failed', health_status=@health, last_error=@err,
    pages_discovered=@discovered, pages_indexed=0, pages_failed=@failed, last_checked_at=SYSUTCDATETIME()
  WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_MarkFetchFailed] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_MarkFetchFailed
  @Id uniqueidentifier,
  @err nvarchar(500)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET ingestion_status=N'failed', health_status=N'failed', last_error=@err WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_ReviewChange] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_ReviewChange
  @ChangeId uniqueidentifier,
  @Decision nvarchar(50),
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_source_changes SET review_status=@Decision, reviewed_by=@userId,
    approved_at=CASE WHEN @Decision=N'approved' THEN SYSUTCDATETIME() ELSE NULL END
  WHERE id=@ChangeId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_SetCrawling] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_SetCrawling
  @Id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET ingestion_status=N'crawling', last_checked_at=SYSUTCDATETIME() WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_UpdateAfterCrawl] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_UpdateAfterCrawl
  @Id uniqueidentifier,
  @corpusHash nvarchar(128),
  @text nvarchar(max),
  @ingestion nvarchar(50),
  @health nvarchar(50),
  @lastError nvarchar(500) = NULL,
  @discovered int,
  @indexed int,
  @failed int,
  @chunks int,
  @changeDetected bit,
  @approval nvarchar(50),
  @changed bit,
  @autoPublish bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET
    last_checked_at=SYSUTCDATETIME(), last_successful_fetch_at=SYSUTCDATETIME(), last_indexed_at=SYSUTCDATETIME(),
    content_hash=@corpusHash, extracted_text=@text,
    ingestion_status=@ingestion, health_status=@health, last_error=@lastError,
    pages_discovered=@discovered, pages_indexed=@indexed, pages_failed=@failed, chunk_count=@chunks,
    change_detected=@changeDetected, approval_status=@approval,
    last_changed_at=CASE WHEN @changed=1 THEN SYSUTCDATETIME() ELSE last_changed_at END,
    is_active=CASE WHEN @autoPublish=1 THEN 1 ELSE is_active END
  WHERE id=@Id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_Web_UpdateSource] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_Web_UpdateSource
  @id uniqueidentifier,
  @Title nvarchar(500),
  @Url nvarchar(2000),
  @Language nvarchar(20),
  @SourceCategory nvarchar(100),
  @ConfidentialityLevel nvarchar(50),
  @RefreshFrequency nvarchar(50),
  @OwnerUnitId uniqueidentifier = NULL,
  @TrustedAutoRefresh bit,
  @KnowledgeDomain nvarchar(200) = NULL,
  @CrawlScope nvarchar(50),
  @maxDepth int,
  @maxPages int,
  @seedJson nvarchar(max),
  @allowedJson nvarchar(max),
  @excludedJson nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_knowledge_sources SET
    title=@Title, url=@Url, language=@Language, source_category=@SourceCategory,
    confidentiality_level=@ConfidentialityLevel, refresh_frequency=@RefreshFrequency,
    owner_unit_id=@OwnerUnitId, trusted_auto_refresh=@TrustedAutoRefresh,
    knowledge_domain=@KnowledgeDomain, crawl_scope=@CrawlScope, max_depth=@maxDepth, max_pages=@maxPages,
    seed_urls=@seedJson, allowed_paths=@allowedJson, excluded_path_patterns=@excludedJson
  WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_DeactivateStaleColleges] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_DeactivateStaleColleges
  @sourceId uniqueidentifier,
  @now datetime2
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.university_colleges SET is_active=0 WHERE web_source_id=@sourceId AND verified_at<@now;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_DeleteChunksByPageIds] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_DeleteChunksByPageIds
  @ids nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.web_page_chunks
  WHERE page_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids, N','));
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_DeletePageChunks] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_DeletePageChunks
  @pageId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.web_page_chunks WHERE page_id=@pageId;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_FindCollege] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_FindCollege
  @name nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id FROM dbo.university_colleges WHERE name_en=@name;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_FindPage] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_FindPage
  @sourceId uniqueidentifier,
  @url nvarchar(2000)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id FROM dbo.web_source_pages WHERE web_source_id=@sourceId AND url=@url;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_InsertCollege] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_InsertCollege
  @name nvarchar(200),
  @url nvarchar(2000),
  @sourceId uniqueidentifier,
  @now datetime2
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.university_colleges(name_en, source_url, web_source_id, verified_at, is_active)
  VALUES(@name, @url, @sourceId, @now, 1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_InsertPage] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_InsertPage
  @pageId uniqueidentifier,
  @sourceId uniqueidentifier,
  @url nvarchar(2000),
  @title nvarchar(500) = NULL,
  @language nvarchar(20),
  @depth int,
  @status nvarchar(50),
  @error nvarchar(max) = NULL,
  @hash nvarchar(128) = NULL,
  @textLength int,
  @chunkCount int,
  @now datetime2,
  @indexedAt datetime2 = NULL,
  @active bit
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.web_source_pages(id, web_source_id, url, title, language, depth, status, error_reason, content_hash, text_length, chunk_count, fetched_at, indexed_at, is_active)
  VALUES(@pageId, @sourceId, @url, @title, @language, @depth, @status, @error, @hash, @textLength, @chunkCount, @now, @indexedAt, @active);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_InsertPageChunk] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_InsertPageChunk
  @chunkId uniqueidentifier,
  @sourceId uniqueidentifier,
  @pageId uniqueidentifier,
  @ChunkNumber int,
  @SectionTitle nvarchar(500) = NULL,
  @SectionPath nvarchar(1000) = NULL,
  @title nvarchar(500) = NULL,
  @url nvarchar(2000),
  @content nvarchar(max),
  @TokenCount int,
  @language nvarchar(20),
  @hash nvarchar(128) = NULL,
  @now datetime2
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.web_page_chunks(id, web_source_id, page_id, chunk_index, section_title, section_path, page_title, source_url, content, token_count, language, content_hash, fetched_at, indexed_at, is_active)
  VALUES(@chunkId, @sourceId, @pageId, @ChunkNumber, @SectionTitle, @SectionPath, @title, @url, @content, @TokenCount, @language, @hash, @now, @now, 1);
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_ListActivePages] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_ListActivePages
  @sourceId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;

  SELECT id, url FROM dbo.web_source_pages WHERE web_source_id=@sourceId AND is_active=1;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_MarkPagesRemoved] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_MarkPagesRemoved
  @ids nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_source_pages SET is_active=0, status=N'removed'
  WHERE id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids, N','));
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_UpdateCollege] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_UpdateCollege
  @id uniqueidentifier,
  @url nvarchar(2000),
  @sourceId uniqueidentifier,
  @now datetime2
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.university_colleges SET source_url=@url, web_source_id=@sourceId, verified_at=@now, is_active=1 WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Knowledge_WebCrawl_UpdatePage] */
CREATE OR ALTER PROCEDURE dbo.usp_Knowledge_WebCrawl_UpdatePage
  @pageId uniqueidentifier,
  @title nvarchar(500) = NULL,
  @language nvarchar(20),
  @depth int,
  @status nvarchar(50),
  @error nvarchar(max) = NULL,
  @hash nvarchar(128) = NULL,
  @textLength int,
  @chunkCount int,
  @now datetime2,
  @indexedAt datetime2 = NULL,
  @active bit
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.web_source_pages SET title=@title, language=@language, depth=@depth, status=@status,
    error_reason=@error, content_hash=@hash, text_length=@textLength, chunk_count=@chunkCount,
    fetched_at=@now, indexed_at=@indexedAt, is_active=@active WHERE id=@pageId;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ActivateCandidate] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ActivateCandidate
  @title nvarchar(300) = NULL,
  @Note nvarchar(max) = NULL,
  @actor uniqueidentifier,
  @CandidateId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.learning_candidates
  SET status = N'ACTIVE', title = COALESCE(@title, title), review_note = @Note,
      approved_by = @actor, approved_at = SYSDATETIMEOFFSET(), activated_at = SYSDATETIMEOFFSET()
  WHERE id = @CandidateId;
END
GO

/* PROCEDURE [dbo].[usp_Learning_CandidateExistsByKey] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_CandidateExistsByKey
  @key nvarchar(500)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.learning_candidates WHERE pattern_key = @key;
END
GO

/* PROCEDURE [dbo].[usp_Learning_CountActiveRules] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_CountActiveRules
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.learned_routing_rules WHERE status = N'ACTIVE';
END
GO

/* PROCEDURE [dbo].[usp_Learning_CountDecisions] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_CountDecisions
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.learned_rule_decisions;
END
GO

/* PROCEDURE [dbo].[usp_Learning_CountRules] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_CountRules
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.learned_routing_rules;
END
GO

/* PROCEDURE [dbo].[usp_Learning_CreateCandidateFromSignals] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_CreateCandidateFromSignals
  @id uniqueidentifier,
  @key nvarchar(500),
  @title nvarchar(300),
  @evidence int,
  @change nvarchar(max),
  @confidence decimal(10,4),
  @type nvarchar(100),
  @domain nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.learning_candidates(
    id, candidate_type, pattern_key, title, description, current_behaviour, pattern,
    evidence_count, affected_domains, affected_units, example_messages, proposed_change,
    confidence, risk_level, status)
  VALUES(
    @id, N'ROUTING_RULE', @key, @title,
    N'Repeated human corrections indicate a routing improvement.',
    N'Current route required repeated correction', N'{}',
    @evidence, N'[]', N'[]', N'[]', @change, @confidence, N'low', N'PROPOSED');
  UPDATE dbo.learning_signals
  SET status = N'CLUSTERED', candidate_id = @id
  WHERE status = N'NEW' AND correction_type = @type AND COALESCE(corrected_domain, N'') = @domain;
END
GO

/* PROCEDURE [dbo].[usp_Learning_DetectGroups] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_DetectGroups
AS
BEGIN
  SET NOCOUNT ON;
  SELECT correction_type, COALESCE(corrected_domain, N'') corrected_domain, corrected_unit_id,
    COUNT(*) evidence, AVG(confidence) confidence
  FROM dbo.learning_signals
  WHERE status = N'NEW' AND policy_sensitive = 0
  GROUP BY correction_type, corrected_domain, corrected_unit_id
  HAVING COUNT(*) >= 3;
END
GO

/* PROCEDURE [dbo].[usp_Learning_EvaluateRules] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_EvaluateRules
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.learned_routing_rules
  SET last_evaluated_at = SYSDATETIMEOFFSET(),
      historical_accuracy = CASE
        WHEN applied_count = 0 THEN historical_accuracy
        ELSE CAST(success_count AS decimal(10,4)) / NULLIF(applied_count, 0)
      END;
END
GO

/* PROCEDURE [dbo].[usp_Learning_GetCandidate] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_GetCandidate
  @CandidateId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.learning_candidates WHERE id = @CandidateId;
END
GO

/* PROCEDURE [dbo].[usp_Learning_GetConfig] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_GetConfig
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) * FROM dbo.learning_config;
END
GO

/* PROCEDURE [dbo].[usp_Learning_GetConfigId] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_GetConfigId
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1) id FROM dbo.learning_config;
END
GO

/* SKIP [dbo].[usp_Learning_GetUserRoles] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Learning_InsertConfig] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_InsertConfig
  @ThresholdLow int = NULL,
  @ThresholdNormal int = NULL,
  @ThresholdHigh int = NULL,
  @MinHistoricalAccuracy float = NULL,
  @MinShadowSamples int = NULL,
  @MinShadowAccuracy float = NULL,
  @AutoActivationEnabled bit = NULL,
  @PauseConfidence float = NULL,
  @actor uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.learning_config(
    threshold_low, threshold_normal, threshold_high, min_historical_accuracy,
    min_shadow_samples, min_shadow_accuracy, auto_activation_enabled, pause_confidence, updated_by)
  VALUES(
    COALESCE(@ThresholdLow, 3), COALESCE(@ThresholdNormal, 5), COALESCE(@ThresholdHigh, 10),
    COALESCE(@MinHistoricalAccuracy, .7), COALESCE(@MinShadowSamples, 10),
    COALESCE(@MinShadowAccuracy, .75), COALESCE(@AutoActivationEnabled, 0),
    COALESCE(@PauseConfidence, .4), @actor);
END
GO

/* PROCEDURE [dbo].[usp_Learning_InsertFeedbackSignal] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_InsertFeedbackSignal
  @correction nvarchar(100),
  @ConversationId uniqueidentifier = NULL,
  @MessageId uniqueidentifier = NULL,
  @id uniqueidentifier,
  @Domain nvarchar(200) = NULL,
  @UserText nvarchar(max) = NULL,
  @Comment nvarchar(max) = NULL,
  @ReasonCode nvarchar(100) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.learning_signals(
    correction_type, correction_source, conversation_id, message_id, student_id,
    original_domain, original_user_text, student_feedback, reason_code, confidence)
  VALUES(@correction, N'STUDENT', @ConversationId, @MessageId, @id, @Domain, @UserText, @Comment, @ReasonCode, .55);
END
GO

/* PROCEDURE [dbo].[usp_Learning_InsertRoutingRule] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_InsertRoutingRule
  @name nvarchar(300),
  @context nvarchar(max) = NULL,
  @phrases nvarchar(max),
  @pending nvarchar(200) = NULL,
  @domain nvarchar(200) = NULL,
  @unit uniqueidentifier = NULL,
  @priority int,
  @confidence decimal(10,4),
  @actor uniqueidentifier,
  @source uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.learned_routing_rules(
    rule_name, trigger_context, trigger_phrases, pending_domain, target_domain, target_unit_id,
    priority, confidence, approved_by, source_candidate_id, active, status)
  VALUES(@name, @context, @phrases, @pending, @domain, @unit, @priority, @confidence, @actor, @source, 1, N'ACTIVE');
END
GO

/* PROCEDURE [dbo].[usp_Learning_ListActiveUnits] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ListActiveUnits
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, name_en, name_ar FROM dbo.service_units WHERE is_active = 1;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ListCandidates] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ListCandidates
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (200) * FROM dbo.learning_candidates ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ListRoutingRules] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ListRoutingRules
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.learned_routing_rules ORDER BY priority;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ListRoutingRulesTop] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ListRoutingRulesTop
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (300) * FROM dbo.learned_routing_rules ORDER BY status, priority;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ListRuleDecisions] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ListRuleDecisions
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (100) id, created_at, rule_id, mode, matched_phrase, matched_context, language,
    previous_target, selected_target, shadow_prediction, actual_target, confidence, evidence_count,
    activation_mode, outcome, outcome_reason
  FROM dbo.learned_rule_decisions
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ListSignals] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ListSignals
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (100) id, created_at, correction_type, correction_source, original_domain, corrected_domain,
    original_unit_id, corrected_unit_id, original_user_text, staff_comment, student_feedback, reason_code,
    policy_sensitive, status, confidence
  FROM dbo.learning_signals
  ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Learning_RuleExists] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_RuleExists
  @RuleId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) FROM dbo.learned_routing_rules WHERE id = @RuleId;
END
GO

/* PROCEDURE [dbo].[usp_Learning_ToggleRule] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_ToggleRule
  @RuleId uniqueidentifier,
  @Active bit
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.learned_routing_rules
  SET active = @Active, status = CASE WHEN @Active = 1 THEN N'ACTIVE' ELSE N'PAUSED' END
  WHERE id = @RuleId;
END
GO

/* PROCEDURE [dbo].[usp_Learning_UpdateCandidateDecision] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_UpdateCandidateDecision
  @status nvarchar(50),
  @Note nvarchar(max) = NULL,
  @actor uniqueidentifier,
  @CandidateId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.learning_candidates
  SET status = @status, review_note = @Note, approved_by = @actor, approved_at = SYSDATETIMEOFFSET()
  WHERE id = @CandidateId;
END
GO

/* PROCEDURE [dbo].[usp_Learning_UpdateConfig] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_UpdateConfig
  @id uniqueidentifier,
  @ThresholdLow int = NULL,
  @ThresholdNormal int = NULL,
  @ThresholdHigh int = NULL,
  @MinHistoricalAccuracy float = NULL,
  @MinShadowSamples int = NULL,
  @MinShadowAccuracy float = NULL,
  @AutoActivationEnabled bit = NULL,
  @PauseConfidence float = NULL,
  @actor uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.learning_config SET
    threshold_low = COALESCE(@ThresholdLow, threshold_low),
    threshold_normal = COALESCE(@ThresholdNormal, threshold_normal),
    threshold_high = COALESCE(@ThresholdHigh, threshold_high),
    min_historical_accuracy = COALESCE(@MinHistoricalAccuracy, min_historical_accuracy),
    min_shadow_samples = COALESCE(@MinShadowSamples, min_shadow_samples),
    min_shadow_accuracy = COALESCE(@MinShadowAccuracy, min_shadow_accuracy),
    auto_activation_enabled = COALESCE(@AutoActivationEnabled, auto_activation_enabled),
    pause_confidence = COALESCE(@PauseConfidence, pause_confidence),
    updated_by = @actor,
    updated_at = SYSDATETIMEOFFSET()
  WHERE id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Learning_UpdateRoutingRule] */
CREATE OR ALTER PROCEDURE dbo.usp_Learning_UpdateRoutingRule
  @RuleId uniqueidentifier,
  @Reason nvarchar(max) = NULL,
  @status nvarchar(50) = NULL,
  @actor uniqueidentifier,
  @name nvarchar(300) = NULL,
  @phrases nvarchar(max) = NULL,
  @domain nvarchar(200) = NULL,
  @unit uniqueidentifier = NULL,
  @priority int = NULL,
  @language nvarchar(10) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.learned_routing_rules SET
    rule_name = COALESCE(@name, rule_name),
    trigger_phrases = COALESCE(@phrases, trigger_phrases),
    target_domain = COALESCE(@domain, target_domain),
    target_unit_id = COALESCE(@unit, target_unit_id),
    priority = COALESCE(@priority, priority),
    source_language = COALESCE(@language, source_language),
    status = COALESCE(@status, status),
    active = CASE WHEN @status = N'ACTIVE' THEN 1 WHEN @status IS NULL THEN active ELSE 0 END,
    approved_by = CASE WHEN @status IN (N'ACTIVE', N'APPROVED') THEN @actor ELSE approved_by END,
    approved_at = CASE WHEN @status IN (N'ACTIVE', N'APPROVED') THEN SYSDATETIMEOFFSET() ELSE approved_at END,
    effective_from = CASE WHEN @status = N'ACTIVE' THEN SYSDATETIMEOFFSET() ELSE effective_from END,
    paused_at = CASE WHEN @status IN (N'PAUSED', N'ROLLED_BACK') THEN SYSDATETIMEOFFSET() ELSE paused_at END,
    rollback_reason = CASE WHEN @status IN (N'PAUSED', N'ROLLED_BACK', N'REJECTED') THEN @Reason ELSE rollback_reason END
  WHERE id = @RuleId;
END
GO

/* SKIP [dbo].[usp_Library_GetIntegration] — encrypted or non-standard definition */
GO
/* SKIP [dbo].[usp_Library_GetOclcSettings] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Library_ListExceptions] */
CREATE OR ALTER PROCEDURE dbo.usp_Library_ListExceptions @Ids nvarchar(max), @FromDate date, @ToDate date
AS BEGIN SET NOCOUNT ON;
SELECT library_location_id AS LibraryLocationId, exception_date AS ExceptionDate, opens_at AS OpensAt,
       closes_at AS ClosesAt, closed, reason_en AS ReasonEn, reason_ar AS ReasonAr
FROM dbo.library_hours_exceptions
WHERE library_location_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@Ids,','))
  AND exception_date>=@FromDate AND exception_date<=@ToDate;
END
GO

/* PROCEDURE [dbo].[usp_Library_ListHours] */
CREATE OR ALTER PROCEDURE dbo.usp_Library_ListHours @Ids nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT library_location_id AS LibraryLocationId, day_of_week AS DayOfWeek, opens_at AS OpensAt, closes_at AS ClosesAt, closed
FROM dbo.library_opening_hours WHERE library_location_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@Ids,','));
END
GO

/* PROCEDURE [dbo].[usp_Library_ListLocations] */
CREATE OR ALTER PROCEDURE dbo.usp_Library_ListLocations
AS BEGIN SET NOCOUNT ON;
SELECT id, code, name_en AS NameEn, name_ar AS NameAr, campus_en AS CampusEn, campus_ar AS CampusAr,
       building_en AS BuildingEn, building_ar AS BuildingAr, contact_email AS ContactEmail, contact_phone AS ContactPhone,
       map_url AS MapUrl, timezone, sort_order AS SortOrder
FROM dbo.library_locations WHERE is_active=1 ORDER BY sort_order, name_en;
END
GO

/* PROCEDURE [dbo].[usp_Library_ListServices] */
CREATE OR ALTER PROCEDURE dbo.usp_Library_ListServices
AS BEGIN SET NOCOUNT ON;
SELECT service_key AS ServiceKey, name_en AS NameEn, name_ar AS NameAr, description_en AS DescriptionEn, description_ar AS DescriptionAr,
       eligibility_en AS EligibilityEn, eligibility_ar AS EligibilityAr, instructions_en AS InstructionsEn, instructions_ar AS InstructionsAr,
       availability_en AS AvailabilityEn, availability_ar AS AvailabilityAr, category, url, contact, sort_order AS SortOrder
FROM dbo.library_services WHERE is_active=1 ORDER BY sort_order, name_en;
END
GO

/* PROCEDURE [dbo].[usp_Library_UpdateIntegration] */
CREATE OR ALTER PROCEDURE dbo.usp_Library_UpdateIntegration
  @providerName nvarchar(120), @baseUrl nvarchar(500)=NULL, @authMethod nvarchar(50), @authHeaderName nvarchar(100)=NULL,
  @authQueryParam nvarchar(100)=NULL, @searchPath nvarchar(200)=NULL, @itemPath nvarchar(200)=NULL,
  @catalogueUrlTemplate nvarchar(500)=NULL, @timeoutMs int, @maxRetries int, @enabled bit
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.library_provider_settings SET provider_name=@providerName,base_url=@baseUrl,auth_method=@authMethod,
  auth_header_name=@authHeaderName,auth_query_param=@authQueryParam,search_path=@searchPath,item_path=@itemPath,
  catalogue_url_template=@catalogueUrlTemplate,timeout_ms=@timeoutMs,max_retries=@maxRetries,enabled=@enabled,
  updated_at=SYSDATETIMEOFFSET() WHERE provider_key=N'library_search';
END
GO

/* PROCEDURE [dbo].[usp_ListAppointmentAvailability] */
CREATE OR ALTER PROCEDURE dbo.usp_ListAppointmentAvailability
  @limit int,
  @unit nvarchar(128) = NULL,
  @q nvarchar(450) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit)
         s.id, s.start_time, s.end_time, (s.capacity - s.booked_count) AS remaining,
         t.id AS type_id, t.name_en AS type_name_en, t.name_ar AS type_name_ar,
         t.duration_minutes, t.location_type, t.requires_approval,
         u.id AS unit_id, u.code AS unit_code, u.name_en AS unit_name_en, u.name_ar AS unit_name_ar,
         COALESCE(u.contact_email, u.email) AS unit_email,
         sp.user_id AS staff_id, p.full_name AS staff_name, p.email AS staff_email,
         s.location, s.meeting_link
  FROM [dbo].[appointment_slots] s
  JOIN [dbo].[appointment_types] t ON t.id = s.appointment_type_id
  LEFT JOIN [dbo].[service_units] u ON u.id = t.service_unit_id
  LEFT JOIN [dbo].[staff_profiles] sp ON sp.user_id = s.staff_profile_id
  LEFT JOIN [dbo].[profiles] p ON p.id = s.staff_profile_id
  WHERE s.status = 'open'
    AND s.booked_count < s.capacity AND t.is_active = 1
    AND s.start_time >= SYSDATETIMEOFFSET()
    AND (@unit IS NULL OR u.code = @unit)
    AND (@q IS NULL OR (t.name_en + ' ' + t.name_ar) LIKE '%' + @q + '%')
  ORDER BY s.start_time;
END
GO

/* PROCEDURE [dbo].[usp_Monitor_ConfirmClosure] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_ConfirmClosure @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; UPDATE dbo.cases SET resolution_communicated_at=SYSDATETIMEOFFSET() WHERE id=@caseId; END
GO

/* PROCEDURE [dbo].[usp_Monitor_CountRecentReminders] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_CountRecentReminders @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.case_oversight_actions WHERE case_id=@CaseId AND action_type=N'remind_owner' AND created_at>=DATEADD(minute,-240,SYSDATETIMEOFFSET());
END
GO

/* PROCEDURE [dbo].[usp_Monitor_EscalateCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_EscalateCase @level int, @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases
SET status = N'escalated',
    escalation_level = @level,
    escalated_at = COALESCE(escalated_at, SYSDATETIMEOFFSET()),
    sla_state = N'escalated',
    last_activity_at = SYSDATETIMEOFFSET()
WHERE id = @CaseId;
END
GO

/* SKIP [dbo].[usp_Monitor_GetCaseForUpdate] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Monitor_InsertAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_InsertAudit
  @actor uniqueidentifier, @action nvarchar(200), @CaseId uniqueidentifier, @metadata nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata)VALUES(@actor,@action,N'case',@CaseId,@metadata);
END
GO

/* PROCEDURE [dbo].[usp_Monitor_InsertClosureAction] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_InsertClosureAction @caseId uniqueidentifier, @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON; INSERT INTO dbo.case_oversight_actions(case_id,action_type,actor_id)VALUES(@caseId,N'closure_confirmed',@actor); END
GO

/* PROCEDURE [dbo].[usp_Monitor_InsertClosureAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_InsertClosureAudit @actor uniqueidentifier, @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; INSERT INTO dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata)VALUES(@actor,N'oversight_closure_confirmed',N'case',@caseId,N'{}'); END
GO

/* PROCEDURE [dbo].[usp_Monitor_InsertEscalation] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_InsertEscalation
  @CaseId uniqueidentifier, @level int, @unit uniqueidentifier=NULL, @owner uniqueidentifier=NULL, @reason nvarchar(max), @actor uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.escalation_actions(case_id,escalation_level,previous_unit_id,target_unit_id,previous_assignee_id,reason,triggered_by)
VALUES(@CaseId,@level,@unit,@unit,@owner,@reason,@actor);
END
GO

/* PROCEDURE [dbo].[usp_Monitor_InsertOversight] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_InsertOversight
  @CaseId uniqueidentifier, @Action nvarchar(50), @actor uniqueidentifier, @Reason nvarchar(max)=NULL,
  @unit uniqueidentifier=NULL, @owner uniqueidentifier=NULL, @NewUnitId uniqueidentifier=NULL, @NewOwnerId uniqueidentifier=NULL, @sla nvarchar(50)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_oversight_actions(case_id,action_type,actor_id,reason,previous_unit_id,previous_owner_id,new_unit_id,new_owner_id,sla_treatment)
VALUES(@CaseId,@Action,@actor,@Reason,@unit,@owner,@NewUnitId,@NewOwnerId,@sla);
END
GO

/* PROCEDURE [dbo].[usp_Monitor_Notify] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_Notify
  @type nvarchar(100), @caseId uniqueidentifier, @recipient uniqueidentifier, @body nvarchar(max),
  @url nvarchar(500), @unit uniqueidentifier=NULL, @actor uniqueidentifier, @dedupe nvarchar(300)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,case_id,service_unit_id,triggered_by,dedupe_key)
VALUES(@type,N'case',@caseId,@recipient,N'in_app',N'Case oversight update',@body,@url,N'pending',@caseId,@unit,@actor,@dedupe);
END
GO

/* PROCEDURE [dbo].[usp_Monitor_ReassignCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Monitor_ReassignCase
  @NewUnitId uniqueidentifier=NULL, @NewOwnerId uniqueidentifier=NULL, @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET service_unit_id=COALESCE(@NewUnitId,service_unit_id),assigned_to=@NewOwnerId,
  current_responsible_actor=CASE WHEN @NewOwnerId IS NULL THEN N'service_owner' ELSE N'specific_officer' END,
  last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
END
GO

/* PROCEDURE [dbo].[usp_MyAppointments] */
CREATE OR ALTER PROCEDURE dbo.usp_MyAppointments
  @uid uniqueidentifier,
  @includePast int
AS
BEGIN
  SET NOCOUNT ON;
  SELECT a.id AS appointment_id, a.appointment_slot_id AS slot_id, a.status, a.confirmation_code,
         a.purpose, s.start_time, s.end_time, s.location, t.location_type, s.meeting_link,
         t.name_en AS type_name_en, t.name_ar AS type_name_ar, p.full_name AS staff_name, p.email AS staff_email
  FROM [dbo].[student_appointments] a
  JOIN [dbo].[appointment_slots] s ON s.id = a.appointment_slot_id
  JOIN [dbo].[appointment_types] t ON t.id = s.appointment_type_id
  LEFT JOIN [dbo].[profiles] p ON p.id = s.staff_profile_id
  WHERE a.student_id = @uid AND (@includePast = 1 OR s.start_time >= SYSDATETIMEOFFSET())
  ORDER BY s.start_time;
END
GO

/* PROCEDURE [dbo].[usp_NextDocumentReference] */
CREATE OR ALTER PROCEDURE dbo.usp_NextDocumentReference
  @code nvarchar(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CONCAT(
      N'UAEU-',
      UPPER(@code),
      N'-',
      CONVERT(nchar(4), YEAR(SYSUTCDATETIME())),
      N'-',
      RIGHT(REPLICATE(N'0', 6) + CAST(NEXT VALUE FOR [dbo].[issued_document_seq] AS nvarchar(20)), 6));
END
GO

/* PROCEDURE [dbo].[usp_Notify_CountDeliveries] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_CountDeliveries
  @status nvarchar(50), @severity nvarchar(50), @q nvarchar(200), @qLike nvarchar(220), @offset int=0, @take int=20
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.notification_deliveries
WHERE (@status = N'all' OR status = @status) AND (@severity = N'all' OR severity = @severity)
  AND (@q = N'' OR event_type LIKE @qLike OR subject LIKE @qLike OR recipient_email LIKE @qLike);
END
GO

/* PROCEDURE [dbo].[usp_Notify_CountUnread] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_CountUnread @userId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) FROM dbo.notification_events
    WHERE recipient_profile_id = @userId AND channel = N'in_app' AND read_at IS NULL;
END;
GO

/* PROCEDURE [dbo].[usp_Notify_CreateBroadcast] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_CreateBroadcast
  @TitleEn nvarchar(500), @TitleAr nvarchar(500), @MessageEn nvarchar(max), @MessageAr nvarchar(max),
  @Audience nvarchar(50), @audienceConfig nvarchar(max), @ActionUrl nvarchar(500)=NULL, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.emergency_broadcasts (title_en, title_ar, message_en, message_ar, audience, audience_config, action_url, created_by, status)
OUTPUT INSERTED.id
VALUES (@TitleEn, @TitleAr, @MessageEn, @MessageAr, @Audience, @audienceConfig, @ActionUrl, @userId, N'pending_approval');
END
GO

/* PROCEDURE [dbo].[usp_Notify_GetBroadcast] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_GetBroadcast @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT status AS Status, audience AS Audience, audience_config AS AudienceConfig,
  title_en AS TitleEn, title_ar AS TitleAr, message_en AS MessageEn, message_ar AS MessageAr, action_url AS ActionUrl
FROM dbo.emergency_broadcasts WHERE id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Notify_GetDispatchState] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_GetDispatchState
AS BEGIN SET NOCOUNT ON;
SELECT paused, pause_reason, last_run_at, consecutive_failures, lease_until,
       sender_domain_status, sender_domain_reason, sender_domain_checked_at
FROM dbo.notification_dispatch_state WHERE id = 1;
END
GO

/* PROCEDURE [dbo].[usp_Notify_GetSettings] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_GetSettings
AS BEGIN SET NOCOUNT ON;
SELECT emails_enabled, public_app_url, demo_email_mode, demo_redirect_email, digest_enabled, batch_size, max_retries
FROM dbo.notification_settings WHERE id = 1;
END
GO

/* PROCEDURE [dbo].[usp_Notify_InsertBroadcastAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_InsertBroadcastAudit @userId uniqueidentifier, @id uniqueidentifier, @metadata nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs (actor_id, action, entity_type, entity_id, metadata)
VALUES (@userId, N'emergency_broadcast_sent', N'emergency_broadcast', @id, @metadata);
END
GO

/* PROCEDURE [dbo].[usp_Notify_ListAdminRecipients] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListAdminRecipients
AS
BEGIN
  SET NOCOUNT ON;
  SELECT DISTINCT ur.user_id
  FROM dbo.user_roles ur
  WHERE ur.role IN (N'system_admin', N'service_manager');
END
GO

/* PROCEDURE [dbo].[usp_Notify_ListAllStudents] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListAllStudents @max int
AS BEGIN SET NOCOUNT ON; SELECT TOP (@max) user_id FROM dbo.user_roles WHERE role = N'student'; END
GO

/* PROCEDURE [dbo].[usp_Notify_ListBroadcasts] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListBroadcasts
AS BEGIN SET NOCOUNT ON;
SELECT TOP (20) id AS Id, title_en AS TitleEn, title_ar AS TitleAr, status AS Status,
  audience AS Audience, recipient_count AS RecipientCount, created_at AS CreatedAt, sent_at AS SentAt
FROM dbo.emergency_broadcasts ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Notify_ListDeliveries] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListDeliveries
  @status nvarchar(50), @severity nvarchar(50), @q nvarchar(200), @qLike nvarchar(220), @offset int, @take int
AS BEGIN SET NOCOUNT ON;
SELECT id AS Id, event_type AS EventType, severity AS Severity, status AS Status, language AS Language,
  template_code AS TemplateCode, recipient_email AS RecipientEmail, recipient_role AS RecipientRole, subject AS Subject,
  retry_count AS RetryCount, failure_code AS FailureCode, failure_reason AS FailureReason,
  queued_at AS QueuedAt, sent_at AS SentAt, next_attempt_at AS NextAttemptAt
FROM dbo.notification_deliveries
WHERE (@status = N'all' OR status = @status) AND (@severity = N'all' OR severity = @severity)
  AND (@q = N'' OR event_type LIKE @qLike OR subject LIKE @qLike OR recipient_email LIKE @qLike)
ORDER BY queued_at DESC OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_Notify_ListGroupMembers] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListGroupMembers @groupCode nvarchar(100), @max int
AS BEGIN SET NOCOUNT ON;
SELECT TOP (@max) user_id FROM dbo.notification_group_members WHERE group_code = @groupCode AND is_active = 1 AND user_id IS NOT NULL;
END
GO

/* SKIP [dbo].[usp_Notify_ListMine] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Notify_ListRecentDeliveries] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListRecentDeliveries @since datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT TOP (5000) status AS Status, severity AS Severity FROM dbo.notification_deliveries WHERE queued_at >= @since;
END
GO

/* PROCEDURE [dbo].[usp_Notify_ListUnitStudents] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_ListUnitStudents @unitId uniqueidentifier, @max int
AS BEGIN SET NOCOUNT ON; SELECT DISTINCT TOP (@max) student_id FROM dbo.cases WHERE service_unit_id = @unitId; END
GO

/* PROCEDURE [dbo].[usp_Notify_MarkAllRead] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_MarkAllRead @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.notification_events SET read_at = SYSDATETIMEOFFSET()
WHERE recipient_profile_id = @userId AND channel = N'in_app' AND read_at IS NULL;
END
GO

/* PROCEDURE [dbo].[usp_Notify_MarkBroadcastSending] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_MarkBroadcastSending @id uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.emergency_broadcasts SET status = N'sending', approved_by = @userId, approved_at = SYSDATETIMEOFFSET() WHERE id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Notify_MarkBroadcastSent] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_MarkBroadcastSent @id uniqueidentifier, @queued int
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.emergency_broadcasts SET status = N'sent', sent_at = SYSDATETIMEOFFSET(), recipient_count = @queued WHERE id = @id;
END
GO

/* PROCEDURE [dbo].[usp_Notify_MarkCaseRead] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_MarkCaseRead @userId uniqueidentifier, @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.notification_events SET read_at = SYSDATETIMEOFFSET()
WHERE recipient_profile_id = @userId AND channel = N'in_app' AND read_at IS NULL AND case_id = @caseId;
END
GO

/* PROCEDURE [dbo].[usp_Notify_MarkIdsRead] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_MarkIdsRead @userId uniqueidentifier, @ids nvarchar(max)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.notification_events SET read_at = SYSDATETIMEOFFSET()
WHERE recipient_profile_id = @userId AND channel = N'in_app' AND read_at IS NULL
  AND id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids,','));
END
GO

/* PROCEDURE [dbo].[usp_Notify_PushCaseAssignedStudent] */
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

/* PROCEDURE [dbo].[usp_Notify_PushInApp] */
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

/* PROCEDURE [dbo].[usp_Notify_QueueBroadcastDelivery] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_QueueBroadcastDelivery
  @recipientId uniqueidentifier, @templateVars nvarchar(max), @actionUrl nvarchar(500), @id uniqueidentifier, @dedupeKey nvarchar(300)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_deliveries
  (notification_event_id, event_type, severity, recipient_user_id, channel, template_code, template_vars, action_url, status, emergency_broadcast_id, dedupe_key)
SELECT NULL, N'EMERGENCY_ALERT', N'emergency', @recipientId, N'email', N'EMERGENCY_ALERT', @templateVars, @actionUrl, N'queued', @id, @dedupeKey
WHERE NOT EXISTS (SELECT 1 FROM dbo.notification_deliveries WHERE dedupe_key = @dedupeKey);
END
GO

/* PROCEDURE [dbo].[usp_Notify_SetDispatchPaused] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_SetDispatchPaused @paused bit, @reason nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.notification_dispatch_state SET paused = @paused,
  pause_reason = CASE WHEN @paused = 1 THEN @reason ELSE NULL END,
  paused_at = CASE WHEN @paused = 1 THEN SYSDATETIMEOFFSET() ELSE NULL END,
  consecutive_failures = CASE WHEN @paused = 1 THEN consecutive_failures ELSE 0 END,
  lease_until = NULL, updated_at = SYSDATETIMEOFFSET() WHERE id = 1;
END
GO

/* PROCEDURE [dbo].[usp_Notify_UpdateSettings] */
CREATE OR ALTER PROCEDURE dbo.usp_Notify_UpdateSettings
  @EmailsEnabled bit=NULL, @DemoEmailMode bit=NULL, @DemoRedirectEmail nvarchar(200)=NULL,
  @DigestEnabled bit=NULL, @PublicAppUrl nvarchar(500)=NULL, @BatchSize int=NULL
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.notification_settings SET
  emails_enabled = COALESCE(@EmailsEnabled, emails_enabled), demo_email_mode = COALESCE(@DemoEmailMode, demo_email_mode),
  demo_redirect_email = COALESCE(@DemoRedirectEmail, demo_redirect_email), digest_enabled = COALESCE(@DigestEnabled, digest_enabled),
  public_app_url = COALESCE(@PublicAppUrl, public_app_url), batch_size = COALESCE(@BatchSize, batch_size),
  updated_at = SYSDATETIMEOFFSET() WHERE id = 1;
END
GO

/* PROCEDURE [dbo].[usp_Owner_GetCaseRouting] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_GetCaseRouting @CaseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT service_unit_id,routing_service_code,routing_topic FROM dbo.cases WHERE id=@CaseId; END
GO

/* PROCEDURE [dbo].[usp_Owner_InsertRoutingFeedback] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_InsertRoutingFeedback
  @CaseId uniqueidentifier, @uid uniqueidentifier, @original uniqueidentifier=NULL, @CorrectedUnitId uniqueidentifier=NULL,
  @service nvarchar(100)=NULL, @topic nvarchar(200)=NULL, @Reason nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_routing_feedback(case_id,reported_by,original_unit_id,corrected_unit_id,original_service_code,original_topic,reason)
VALUES(@CaseId,@uid,@original,@CorrectedUnitId,@service,@topic,@Reason);
END
GO

/* PROCEDURE [dbo].[usp_Owner_InsertRoutingSignal] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_InsertRoutingSignal
  @CaseId uniqueidentifier, @original uniqueidentifier=NULL, @CorrectedUnitId uniqueidentifier=NULL,
  @topic nvarchar(200)=NULL, @service nvarchar(100)=NULL, @Reason nvarchar(max), @outcome nvarchar(50)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,original_unit_id,corrected_unit_id,original_domain,original_intent,staff_comment,outcome,confidence)
VALUES(N'ROUTING_CORRECTION',N'STAFF',@CaseId,@original,@CorrectedUnitId,@topic,@service,@Reason,@outcome,.75);
END
GO

/* PROCEDURE [dbo].[usp_Owner_ListActionPermissions] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListActionPermissions @ids nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT service_unit_id,action_code code,enabled,requires_confirmation requiresConfirmation,requires_reason requiresReason,risk_level riskLevel
FROM dbo.service_owner_action_permissions
WHERE service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids,','));
END
GO

/* PROCEDURE [dbo].[usp_Owner_ListActiveUnits] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListActiveUnits
AS BEGIN SET NOCOUNT ON; SELECT id FROM dbo.service_units WHERE is_active=1; END
GO

/* PROCEDURE [dbo].[usp_Owner_ListChats] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListChats @units nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT TOP(50)cv.id,cv.title,cv.language,cv.conversation_status status,cv.updated_at updatedAt,c.id caseId,c.case_number caseNumber,c.title caseTitle
FROM dbo.conversations cv JOIN dbo.cases c ON c.id=cv.related_case_id
WHERE c.service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@units,','))
ORDER BY cv.updated_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Owner_ListDashboardCases] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListDashboardCases @units nvarchar(max), @uid uniqueidentifier, @days int
AS BEGIN SET NOCOUNT ON;
SELECT id,case_number,case_type,title,status,urgency,created_at,last_activity_at FROM dbo.cases
WHERE(service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@units,',')) OR assigned_to=@uid)
  AND created_at>=DATEADD(day,-@days,SYSDATETIMEOFFSET());
END
GO

/* PROCEDURE [dbo].[usp_Owner_ListInsightCases] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListInsightCases @units nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT c.case_type,c.status,c.created_at,c.resolved_at,c.resolution_due_at,c.routing_topic,c.root_cause_code,a.attention_category,a.automation_paused
FROM dbo.cases c LEFT JOIN dbo.case_automation_state a ON a.case_id=c.id
WHERE c.service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@units,','))
  AND c.created_at>=DATEADD(day,-30,SYSDATETIMEOFFSET());
END
GO

/* PROCEDURE [dbo].[usp_Owner_ListOpenCases] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListOpenCases @units nvarchar(max), @uid uniqueidentifier, @open nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT TOP(200)c.*,a.attention_category,a.attention_reason_en,a.attention_reason_ar,a.next_action_en,a.next_action_ar,a.next_action_at,a.automation_paused,a.ai_status
FROM dbo.cases c LEFT JOIN dbo.case_automation_state a ON a.case_id=c.id
WHERE(c.service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@units,',')) OR c.assigned_to=@uid)
  AND c.status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@open,','))
ORDER BY c.urgency DESC,c.created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Owner_ListProfileNames] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListProfileNames @students nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT id Id,COALESCE(full_name,email) Name FROM dbo.profiles
WHERE id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@students,','));
END
GO

/* SKIP [dbo].[usp_Owner_ListStaffUnits] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Owner_ListUnitsByIds] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ListUnitsByIds @ids nvarchar(max)
AS BEGIN SET NOCOUNT ON;
SELECT id,code,name_en nameEn,name_ar nameAr FROM dbo.service_units
WHERE id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids,',')) ORDER BY name_en;
END
GO

/* PROCEDURE [dbo].[usp_Owner_ReassignMisroute] */
CREATE OR ALTER PROCEDURE dbo.usp_Owner_ReassignMisroute
  @CaseId uniqueidentifier, @CorrectedUnitId uniqueidentifier, @uid uniqueidentifier, @reason nvarchar(max)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET service_unit_id=@CorrectedUnitId,assigned_to=NULL,status=N'submitted',human_review_required=1,routing_reason_en=@reason,routing_confidence=1,last_activity_at=SYSDATETIMEOFFSET() WHERE id=@CaseId;
INSERT INTO dbo.case_status_history(case_id,to_status,changed_by,note)VALUES(@CaseId,N'submitted',@uid,@reason);
END
GO

/* SKIP [dbo].[usp_OwnerLists_CountCases] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_OwnerLists_CountChats] */
CREATE OR ALTER PROCEDURE dbo.usp_OwnerLists_CountChats
  @scope nvarchar(max), @skip int=0, @take int=20, @filter nvarchar(50)=N'all', @term nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.conversations cv JOIN dbo.cases c ON c.id=cv.related_case_id
WHERE c.service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@scope,','))
  AND (@filter<>N'escalated' OR c.status=N'escalated')
  AND (@filter<>N'attention' OR c.status IN(N'awaiting_student',N'student_confirmation'))
  AND (@term IS NULL OR cv.title LIKE @term OR c.case_number LIKE @term);
END
GO

/* PROCEDURE [dbo].[usp_OwnerLists_ListCases] */
CREATE OR ALTER PROCEDURE dbo.usp_OwnerLists_ListCases
  @uid uniqueidentifier, @scope nvarchar(max)=NULL, @hasScope bit=0, @skip int, @take int,
  @now datetimeoffset, @in4 datetimeoffset, @in24 datetimeoffset,
  @type nvarchar(50)=NULL, @priority nvarchar(50)=NULL, @since datetimeoffset=NULL, @term nvarchar(200)=NULL,
  @sla nvarchar(50)=N'all', @automation nvarchar(50)=N'all', @sort nvarchar(50)=N'activity',
  @wanted nvarchar(max)=NULL, @extra nvarchar(50)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT c.id Id,c.service_unit_id ServiceUnitId,c.case_number CaseNumber,c.case_type CaseType,c.title Title,c.status Status,c.urgency Urgency,
  c.created_at CreatedAt,c.last_activity_at LastActivityAt,c.resolution_due_at ResolutionDueAt,c.routing_reason_en RoutingReasonEn,
  c.routing_reason_ar RoutingReasonAr,c.routing_confidence RoutingConfidence,st.attention_reason_en AttentionReasonEn,
  st.attention_reason_ar AttentionReasonAr,c.student_id StudentId,pr.full_name StudentName,
  CAST(CASE WHEN st.attention_category IS NOT NULL OR ISNULL(st.automation_paused,0)=1 THEN 1 ELSE 0 END AS bit) NeedsAttention
FROM dbo.cases c LEFT JOIN dbo.case_automation_state st ON st.case_id=c.id LEFT JOIN dbo.profiles pr ON pr.id=c.student_id
WHERE ((@hasScope=1 AND (c.service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@scope,',')) OR c.assigned_to=@uid))
    OR (@hasScope=0 AND c.assigned_to=@uid))
  AND (@type IS NULL OR c.case_type=@type)
  AND (@priority IS NULL OR c.urgency=@priority)
  AND (@since IS NULL OR c.created_at>=@since)
  AND (@term IS NULL OR c.case_number LIKE @term OR c.title LIKE @term OR c.routing_topic LIKE @term)
  AND (@sla=N'all' OR (@sla=N'breached' AND c.resolution_due_at<@now) OR (@sla=N'critical' AND c.resolution_due_at>=@now AND c.resolution_due_at<@in4)
       OR (@sla=N'attention' AND c.resolution_due_at>=@in4 AND c.resolution_due_at<@in24) OR (@sla=N'on_track' AND c.resolution_due_at>=@in24))
  AND (@automation=N'all' OR (@automation=N'ai' AND st.attention_category IS NULL AND ISNULL(st.automation_paused,0)=0)
       OR (@automation=N'human' AND st.attention_category IS NOT NULL))
  AND (@wanted IS NULL OR c.status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@wanted,',')))
  AND (@extra IS NULL OR (@extra=N'attention' AND st.attention_category IS NOT NULL) OR (@extra=N'breached' AND c.resolution_due_at<@now))
ORDER BY
  CASE WHEN @sort=N'created' THEN 0 WHEN @sort=N'due' THEN 1 WHEN @sort=N'priority' THEN 2 ELSE 3 END,
  CASE WHEN @sort=N'created' THEN c.created_at END DESC,
  CASE WHEN @sort=N'due' THEN CASE WHEN c.resolution_due_at IS NULL THEN 1 ELSE 0 END END,
  CASE WHEN @sort=N'due' THEN c.resolution_due_at END,
  CASE c.urgency WHEN N'critical' THEN 4 WHEN N'high' THEN 3 WHEN N'medium' THEN 2 ELSE 1 END DESC,
  CASE WHEN c.last_activity_at IS NULL THEN 1 ELSE 0 END, c.last_activity_at DESC, c.created_at DESC
OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_OwnerLists_ListChats] */
CREATE OR ALTER PROCEDURE dbo.usp_OwnerLists_ListChats
  @scope nvarchar(max), @skip int, @take int, @filter nvarchar(50)=N'all', @term nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT cv.id,cv.title,cv.language,cv.conversation_status status,cv.updated_at updatedAt,c.id caseId,c.case_number caseNumber,c.title caseTitle
FROM dbo.conversations cv JOIN dbo.cases c ON c.id=cv.related_case_id
WHERE c.service_unit_id IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@scope,','))
  AND (@filter<>N'escalated' OR c.status=N'escalated')
  AND (@filter<>N'attention' OR c.status IN(N'awaiting_student',N'student_confirmation'))
  AND (@term IS NULL OR cv.title LIKE @term OR c.case_number LIKE @term)
ORDER BY cv.updated_at DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_OwnsServiceUnit] */
CREATE OR ALTER PROCEDURE dbo.usp_OwnsServiceUnit
  @userId uniqueidentifier,
  @unitId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[staff_profiles] WHERE [user_id] = @userId AND [service_unit_id] = @unitId
    UNION ALL
    SELECT 1 FROM [dbo].[service_unit_owners] WHERE [staff_profile_id] = @userId AND [service_unit_id] = @unitId AND [is_active] = 1
    UNION ALL
    SELECT 1 FROM [dbo].[service_units] WHERE [id] = @unitId AND [primary_service_owner_id] = @userId
    UNION ALL
    SELECT 1 FROM [dbo].[service_staff] WHERE [staff_profile_id] = @userId AND [service_unit_id] = @unitId
  ) THEN 1 ELSE 0 END;
END
GO

/* PROCEDURE [dbo].[usp_Proactive_CloseStaleCaseAlerts] */
CREATE OR ALTER PROCEDURE dbo.usp_Proactive_CloseStaleCaseAlerts
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE a SET status=N'resolved'
  FROM dbo.student_alerts a
  WHERE a.student_id=@id AND a.status=N'active' AND a.alert_type LIKE N'case_waiting_%' AND a.related_case_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM dbo.cases c WHERE c.id=a.related_case_id AND c.status IN(N'awaiting_student',N'student_confirmation',N'resolution_proposed'));
END
GO

/* SKIP [dbo].[usp_Proactive_ListActiveAlertTypes] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Proactive_ListSuggestionThemes] */
CREATE OR ALTER PROCEDURE dbo.usp_Proactive_ListSuggestionThemes
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (300) s.id Id,s.reference_number ReferenceNumber,s.title Title,s.description Description,s.status Status,
    s.vote_count Votes,s.created_at CreatedAt,s.service_unit_id UnitId,u.name_en UnitNameEn,u.name_ar UnitNameAr
  FROM dbo.suggestions s LEFT JOIN dbo.service_units u ON u.id=s.service_unit_id
  WHERE s.deleted_at IS NULL AND s.status NOT IN(N'implemented',N'closed',N'not_proceeding')
  ORDER BY s.created_at;
END
GO

/* PROCEDURE [dbo].[usp_PurgeExpiredDocuments] */
CREATE OR ALTER PROCEDURE dbo.usp_PurgeExpiredDocuments
  @limit int
AS
BEGIN
  UPDATE TOP (@limit) [dbo].[issued_documents]
  SET [document_status] = 'expired'
  WHERE [document_status] = 'active' AND [retention_expires_at] IS NOT NULL AND [retention_expires_at] < SYSDATETIMEOFFSET();
END
GO

/* PROCEDURE [dbo].[usp_PurgeMyIssuedDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_PurgeMyIssuedDocument
  @id uniqueidentifier,
  @uid uniqueidentifier
AS
BEGIN
  UPDATE [dbo].[issued_documents] SET [document_status] = 'purged' WHERE [id] = @id AND [student_id] = @uid;
END
GO

/* PROCEDURE [dbo].[usp_RemoveMyRequests] */
CREATE OR ALTER PROCEDURE dbo.usp_RemoveMyRequests
  @uid uniqueidentifier,
  @scope nvarchar(64),
  @ids nvarchar(max)
AS
BEGIN
  UPDATE [dbo].[cases] SET [student_hidden_at] = SYSDATETIMEOFFSET(), [student_hidden_by] = @uid
  WHERE [student_id] = @uid AND [status] IN ('resolved','closed')
    AND [student_hidden_at] IS NULL
    AND (@scope <> 'selected' OR [id] IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids, ',')));
END
GO

/* PROCEDURE [dbo].[usp_RemoveMySuggestions] */
CREATE OR ALTER PROCEDURE dbo.usp_RemoveMySuggestions
  @uid uniqueidentifier,
  @scope nvarchar(64),
  @ids nvarchar(max)
AS
BEGIN
  UPDATE [dbo].[suggestions] SET [student_hidden_at] = SYSDATETIMEOFFSET()
  WHERE [student_id] = @uid AND [student_hidden_at] IS NULL
    AND (@scope <> 'selected' OR [id] IN (SELECT TRY_CAST(value AS uniqueidentifier) FROM STRING_SPLIT(@ids, ',')));
END
GO

/* PROCEDURE [dbo].[usp_RescheduleAppointment] */
CREATE OR ALTER PROCEDURE dbo.usp_RescheduleAppointment
  @appointmentId uniqueidentifier,
  @uid uniqueidentifier,
  @newSlot uniqueidentifier
AS
BEGIN
  DECLARE @old uniqueidentifier;
  SELECT @old = appointment_slot_id FROM [dbo].[student_appointments] WHERE id = @appointmentId AND student_id = @uid;
  UPDATE [dbo].[student_appointments] SET appointment_slot_id = @newSlot WHERE id = @appointmentId AND student_id = @uid;
  UPDATE [dbo].[appointment_slots] SET booked_count = CASE WHEN booked_count > 0 THEN booked_count - 1 ELSE 0 END WHERE id = @old;
  UPDATE [dbo].[appointment_slots] SET booked_count = booked_count + 1 WHERE id = @newSlot;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_AdminCaseMonitorCount] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_AdminCaseMonitorCount
  @unit uniqueidentifier=NULL, @type nvarchar(50)=NULL, @priority nvarchar(50)=NULL, @owner uniqueidentifier=NULL,
  @since datetimeoffset=NULL, @actor nvarchar(50)=NULL, @sla nvarchar(50)=NULL, @status nvarchar(50)=NULL,
  @escalation nvarchar(50)=NULL, @view nvarchar(50)=N'open', @pattern nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(1) FROM (
SELECT
  c.id, c.case_number, c.case_type, c.title, c.status, c.urgency, c.severity,
  c.service_unit_id, u.name_en AS unit_name_en, u.name_ar AS unit_name_ar,
  c.assigned_to, own.full_name AS owner_name,
  c.student_id, stu.full_name AS student_name, sp.student_number,
  c.routing_service_code, c.routing_topic, c.root_cause_code,
  c.current_responsible_actor AS actor,
  COALESCE(c.responsible_since, c.created_at) AS responsible_since,
  c.created_at, c.last_activity_at,
  COALESCE(c.resolution_due_at, c.due_at) AS sla_due_at,
  c.sla_state AS sla_status,
  CAST(CASE WHEN c.sla_paused_at IS NOT NULL THEN 1 ELSE 0 END AS bit) AS sla_paused,
  CASE WHEN c.sla_state = 'breached' AND c.resolution_due_at IS NOT NULL
       THEN DATEDIFF(SECOND, c.resolution_due_at, SYSDATETIMEOFFSET()) ELSE 0 END AS breach_seconds,
  c.first_response_due_at AS owner_response_due_at,
  CAST(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at IS NOT NULL
             AND c.first_response_due_at < SYSDATETIMEOFFSET()
             AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
            THEN 1 ELSE 0 END AS bit) AS response_overdue,
  c.response_state,
  DATEDIFF(SECOND, COALESCE(c.responsible_since, c.created_at), SYSDATETIMEOFFSET()) AS waiting_seconds,
  DATEDIFF(SECOND, c.last_activity_at, SYSDATETIMEOFFSET()) AS inactive_seconds,
  CAST(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
             AND DATEDIFF(HOUR, c.last_activity_at, SYSDATETIMEOFFSET()) >= 24
            THEN 1 ELSE 0 END AS bit) AS stalled,
  CAST(CASE WHEN c.status IN ('resolved','closed') AND c.resolution_communicated_at IS NULL
            THEN 1 ELSE 0 END AS bit) AS closure_incomplete,
  CAST(CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1
            THEN 1 ELSE 0 END AS bit) AS critical_alert,
  CAST(CASE WHEN COALESCE(c.escalation_level,0) > 0 AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
            THEN 1 ELSE 0 END AS bit) AS escalation_unresolved,
  c.escalation_level, c.escalated_at, c.acknowledged_at, c.reopened_count, c.is_sensitive,
  CAST(CASE WHEN c.status IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END AS bit) AS is_closed,
  c.resolved_at, c.resolution_communicated_at, c.next_action_en, c.next_action_ar,
  CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1 THEN 1
       WHEN c.sla_state = 'breached' THEN 2
       WHEN c.sla_state = 'critical' THEN 3
       WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 4
       WHEN COALESCE(c.escalation_level,0) > 0 THEN 5
       WHEN c.sla_state = 'attention' THEN 6
       ELSE 8 END AS risk_rank
FROM [dbo].[cases] c
LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
LEFT JOIN [dbo].[profiles] own ON own.id = c.assigned_to
LEFT JOIN [dbo].[profiles] stu ON stu.id = c.student_id
LEFT JOIN [dbo].[student_profiles] sp ON sp.user_id = c.student_id
) v
WHERE (@unit IS NULL OR v.service_unit_id = @unit)
  AND (@type IS NULL OR @type = 'all' OR v.case_type = @type)
  AND (@priority IS NULL OR @priority = 'all' OR v.urgency = @priority OR v.severity = @priority)
  AND (@owner IS NULL OR v.assigned_to = @owner)
  AND (@since IS NULL OR v.created_at >= @since)
  AND (@actor IS NULL OR @actor = 'all' OR v.actor = @actor)
  AND (@sla IS NULL OR @sla = 'all' OR v.sla_status = @sla)
  AND (@status IS NULL OR @status = 'all' OR v.status = @status)
  AND (@escalation IS NULL OR @escalation = 'all'
       OR (@escalation = 'none' AND COALESCE(v.escalation_level,0) = 0)
       OR (@escalation = 'escalated' AND COALESCE(v.escalation_level,0) > 0)
       OR (@escalation = 'unresolved' AND v.escalation_unresolved = 1))
  AND (
    CASE @view
      WHEN 'all' THEN 1
      WHEN 'open' THEN CASE WHEN v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'intervention' THEN CASE WHEN v.is_closed = 0 AND (v.sla_status IN ('breached','critical') OR v.response_overdue = 1 OR v.escalation_unresolved = 1 OR v.stalled = 1 OR v.critical_alert = 1 OR COALESCE(v.reopened_count,0) >= 2) THEN 1 ELSE 0 END
      WHEN 'complaints' THEN CASE WHEN v.case_type = 'complaint' AND v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'suggestions' THEN CASE WHEN v.case_type = 'suggestion' AND v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'alerts' THEN CASE WHEN v.case_type = 'alert' AND v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'reopened' THEN CASE WHEN COALESCE(v.reopened_count,0) > 0 THEN 1 ELSE 0 END
      WHEN 'closure' THEN CASE WHEN v.closure_incomplete = 1 THEN 1 ELSE 0 END
      ELSE CASE WHEN v.is_closed = 0 THEN 1 ELSE 0 END
    END = 1)
  AND (@pattern IS NULL OR (
        v.case_number LIKE @pattern OR v.title LIKE @pattern
        OR COALESCE(v.student_name,'') LIKE @pattern
        OR COALESCE(v.student_number,'') LIKE @pattern
        OR COALESCE(v.owner_name,'') LIKE @pattern
        OR COALESCE(v.unit_name_en,'') LIKE @pattern
        OR COALESCE(v.unit_name_ar,'') LIKE @pattern
        OR COALESCE(v.routing_service_code,'') LIKE @pattern));
END
GO

/* PROCEDURE [dbo].[usp_Rpc_AdminCaseMonitorDetail] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_AdminCaseMonitorDetail @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;

SELECT
  c.id, c.case_number, c.case_type, c.title, c.status, c.urgency, c.severity,
  c.service_unit_id, u.name_en AS unit_name_en, u.name_ar AS unit_name_ar,
  c.assigned_to, own.full_name AS owner_name,
  c.student_id, stu.full_name AS student_name, sp.student_number,
  c.routing_service_code, c.routing_topic, c.root_cause_code,
  c.current_responsible_actor AS actor,
  COALESCE(c.responsible_since, c.created_at) AS responsible_since,
  c.created_at, c.last_activity_at,
  COALESCE(c.resolution_due_at, c.due_at) AS sla_due_at,
  c.sla_state AS sla_status,
  CAST(CASE WHEN c.sla_paused_at IS NOT NULL THEN 1 ELSE 0 END AS bit) AS sla_paused,
  CASE WHEN c.sla_state = 'breached' AND c.resolution_due_at IS NOT NULL
       THEN DATEDIFF(SECOND, c.resolution_due_at, SYSDATETIMEOFFSET()) ELSE 0 END AS breach_seconds,
  c.first_response_due_at AS owner_response_due_at,
  CAST(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at IS NOT NULL
             AND c.first_response_due_at < SYSDATETIMEOFFSET()
             AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
            THEN 1 ELSE 0 END AS bit) AS response_overdue,
  c.response_state,
  DATEDIFF(SECOND, COALESCE(c.responsible_since, c.created_at), SYSDATETIMEOFFSET()) AS waiting_seconds,
  DATEDIFF(SECOND, c.last_activity_at, SYSDATETIMEOFFSET()) AS inactive_seconds,
  CAST(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
             AND DATEDIFF(HOUR, c.last_activity_at, SYSDATETIMEOFFSET()) >= 24
            THEN 1 ELSE 0 END AS bit) AS stalled,
  CAST(CASE WHEN c.status IN ('resolved','closed') AND c.resolution_communicated_at IS NULL
            THEN 1 ELSE 0 END AS bit) AS closure_incomplete,
  CAST(CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1
            THEN 1 ELSE 0 END AS bit) AS critical_alert,
  CAST(CASE WHEN COALESCE(c.escalation_level,0) > 0 AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
            THEN 1 ELSE 0 END AS bit) AS escalation_unresolved,
  c.escalation_level, c.escalated_at, c.acknowledged_at, c.reopened_count, c.is_sensitive,
  CAST(CASE WHEN c.status IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END AS bit) AS is_closed,
  c.resolved_at, c.resolution_communicated_at, c.next_action_en, c.next_action_ar,
  CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1 THEN 1
       WHEN c.sla_state = 'breached' THEN 2
       WHEN c.sla_state = 'critical' THEN 3
       WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 4
       WHEN COALESCE(c.escalation_level,0) > 0 THEN 5
       WHEN c.sla_state = 'attention' THEN 6
       ELSE 8 END AS risk_rank
FROM [dbo].[cases] c
LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
LEFT JOIN [dbo].[profiles] own ON own.id = c.assigned_to
LEFT JOIN [dbo].[profiles] stu ON stu.id = c.student_id
LEFT JOIN [dbo].[student_profiles] sp ON sp.user_id = c.student_id
 WHERE c.id = @caseId;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_AdminCaseMonitorList] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_AdminCaseMonitorList
  @unit uniqueidentifier=NULL, @type nvarchar(50)=NULL, @priority nvarchar(50)=NULL, @owner uniqueidentifier=NULL,
  @since datetimeoffset=NULL, @actor nvarchar(50)=NULL, @sla nvarchar(50)=NULL, @status nvarchar(50)=NULL,
  @escalation nvarchar(50)=NULL, @view nvarchar(50)=N'open', @pattern nvarchar(200)=NULL,
  @sort nvarchar(20)=N'risk', @offset int, @pageSize int
AS BEGIN SET NOCOUNT ON;
SELECT * FROM (
SELECT
  c.id, c.case_number, c.case_type, c.title, c.status, c.urgency, c.severity,
  c.service_unit_id, u.name_en AS unit_name_en, u.name_ar AS unit_name_ar,
  c.assigned_to, own.full_name AS owner_name,
  c.student_id, stu.full_name AS student_name, sp.student_number,
  c.routing_service_code, c.routing_topic, c.root_cause_code,
  c.current_responsible_actor AS actor,
  COALESCE(c.responsible_since, c.created_at) AS responsible_since,
  c.created_at, c.last_activity_at,
  COALESCE(c.resolution_due_at, c.due_at) AS sla_due_at,
  c.sla_state AS sla_status,
  CAST(CASE WHEN c.sla_paused_at IS NOT NULL THEN 1 ELSE 0 END AS bit) AS sla_paused,
  CASE WHEN c.sla_state = 'breached' AND c.resolution_due_at IS NOT NULL
       THEN DATEDIFF(SECOND, c.resolution_due_at, SYSDATETIMEOFFSET()) ELSE 0 END AS breach_seconds,
  c.first_response_due_at AS owner_response_due_at,
  CAST(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at IS NOT NULL
             AND c.first_response_due_at < SYSDATETIMEOFFSET()
             AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
            THEN 1 ELSE 0 END AS bit) AS response_overdue,
  c.response_state,
  DATEDIFF(SECOND, COALESCE(c.responsible_since, c.created_at), SYSDATETIMEOFFSET()) AS waiting_seconds,
  DATEDIFF(SECOND, c.last_activity_at, SYSDATETIMEOFFSET()) AS inactive_seconds,
  CAST(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
             AND DATEDIFF(HOUR, c.last_activity_at, SYSDATETIMEOFFSET()) >= 24
            THEN 1 ELSE 0 END AS bit) AS stalled,
  CAST(CASE WHEN c.status IN ('resolved','closed') AND c.resolution_communicated_at IS NULL
            THEN 1 ELSE 0 END AS bit) AS closure_incomplete,
  CAST(CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1
            THEN 1 ELSE 0 END AS bit) AS critical_alert,
  CAST(CASE WHEN COALESCE(c.escalation_level,0) > 0 AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate')
            THEN 1 ELSE 0 END AS bit) AS escalation_unresolved,
  c.escalation_level, c.escalated_at, c.acknowledged_at, c.reopened_count, c.is_sensitive,
  CAST(CASE WHEN c.status IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END AS bit) AS is_closed,
  c.resolved_at, c.resolution_communicated_at, c.next_action_en, c.next_action_ar,
  CASE WHEN c.sla_state IN ('breached','critical') OR c.needs_assignment_attention = 1 THEN 1
       WHEN c.sla_state = 'breached' THEN 2
       WHEN c.sla_state = 'critical' THEN 3
       WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 4
       WHEN COALESCE(c.escalation_level,0) > 0 THEN 5
       WHEN c.sla_state = 'attention' THEN 6
       ELSE 8 END AS risk_rank
FROM [dbo].[cases] c
LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
LEFT JOIN [dbo].[profiles] own ON own.id = c.assigned_to
LEFT JOIN [dbo].[profiles] stu ON stu.id = c.student_id
LEFT JOIN [dbo].[student_profiles] sp ON sp.user_id = c.student_id
) v
WHERE (@unit IS NULL OR v.service_unit_id = @unit)
  AND (@type IS NULL OR @type = 'all' OR v.case_type = @type)
  AND (@priority IS NULL OR @priority = 'all' OR v.urgency = @priority OR v.severity = @priority)
  AND (@owner IS NULL OR v.assigned_to = @owner)
  AND (@since IS NULL OR v.created_at >= @since)
  AND (@actor IS NULL OR @actor = 'all' OR v.actor = @actor)
  AND (@sla IS NULL OR @sla = 'all' OR v.sla_status = @sla)
  AND (@status IS NULL OR @status = 'all' OR v.status = @status)
  AND (@escalation IS NULL OR @escalation = 'all'
       OR (@escalation = 'none' AND COALESCE(v.escalation_level,0) = 0)
       OR (@escalation = 'escalated' AND COALESCE(v.escalation_level,0) > 0)
       OR (@escalation = 'unresolved' AND v.escalation_unresolved = 1))
  AND (
    CASE @view
      WHEN 'all' THEN 1
      WHEN 'open' THEN CASE WHEN v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'intervention' THEN CASE WHEN v.is_closed = 0 AND (v.sla_status IN ('breached','critical') OR v.response_overdue = 1 OR v.escalation_unresolved = 1 OR v.stalled = 1 OR v.critical_alert = 1 OR COALESCE(v.reopened_count,0) >= 2) THEN 1 ELSE 0 END
      WHEN 'complaints' THEN CASE WHEN v.case_type = 'complaint' AND v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'suggestions' THEN CASE WHEN v.case_type = 'suggestion' AND v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'alerts' THEN CASE WHEN v.case_type = 'alert' AND v.is_closed = 0 THEN 1 ELSE 0 END
      WHEN 'reopened' THEN CASE WHEN COALESCE(v.reopened_count,0) > 0 THEN 1 ELSE 0 END
      WHEN 'closure' THEN CASE WHEN v.closure_incomplete = 1 THEN 1 ELSE 0 END
      ELSE CASE WHEN v.is_closed = 0 THEN 1 ELSE 0 END
    END = 1)
  AND (@pattern IS NULL OR (
        v.case_number LIKE @pattern OR v.title LIKE @pattern
        OR COALESCE(v.student_name,'') LIKE @pattern
        OR COALESCE(v.student_number,'') LIKE @pattern
        OR COALESCE(v.owner_name,'') LIKE @pattern
        OR COALESCE(v.unit_name_en,'') LIKE @pattern
        OR COALESCE(v.unit_name_ar,'') LIKE @pattern
        OR COALESCE(v.routing_service_code,'') LIKE @pattern))
ORDER BY
  CASE WHEN @sort=N'waiting' THEN v.waiting_seconds END DESC,
  CASE WHEN @sort=N'due' THEN v.sla_due_at END ASC,
  CASE WHEN @sort=N'updated' THEN v.last_activity_at END DESC,
  CASE WHEN @sort=N'created' THEN v.created_at END DESC,
  CASE WHEN @sort IS NULL OR @sort NOT IN (N'waiting',N'due',N'updated',N'created') THEN v.risk_rank END ASC,
  CASE WHEN @sort IS NULL OR @sort NOT IN (N'waiting',N'due',N'updated',N'created') THEN v.sla_due_at END ASC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalEffort] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalEffort @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT
  (SELECT COUNT(1) FROM [dbo].[case_status_history] s JOIN [dbo].[cases] c ON c.id = s.case_id WHERE c.created_at >= @from AND c.created_at <= @to) AS status_transitions,
  (SELECT COUNT(1) FROM [dbo].[messages] m JOIN [dbo].[conversations] cv ON cv.id = m.conversation_id WHERE cv.created_at >= @from AND cv.created_at <= @to AND m.role = 'assistant') AS staff_touchpoints,
  0 AS student_entered_fields,
  (SELECT COUNT(1) FROM [dbo].[case_information_requests] WHERE created_at >= @from AND created_at <= @to) AS information_requests,
  (SELECT COUNT(1) FROM [dbo].[student_field_provenance] WHERE verified_at >= @from AND verified_at <= @to) AS reused_known_fields,
  0 AS in_person_visits;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalEvidence] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalEvidence @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT
  (SELECT COUNT(1) FROM [dbo].[service_baselines]) AS baselines,
  (SELECT COUNT(1) FROM [dbo].[pilot_test_sessions] WHERE tested_on >= @from AND tested_on <= @to) AS pilot_sessions,
  (SELECT COALESCE(SUM(participant_count),0) FROM [dbo].[pilot_test_sessions] WHERE tested_on >= @from AND tested_on <= @to) AS pilot_participants,
  (SELECT COUNT(1) FROM [dbo].[case_handovers] WHERE created_at >= @from AND created_at <= @to) AS handovers,
  (SELECT COUNT(1) FROM [dbo].[case_sla_events] WHERE triggered_at >= @from AND triggered_at <= @to) AS exception_events,
  (SELECT COUNT(1) FROM [dbo].[approval_requests] WHERE created_at >= @from AND created_at <= @to) AS approvals,
  (SELECT COUNT(1) FROM [dbo].[action_receipts] WHERE created_at >= @from AND created_at <= @to) AS action_receipts,
  (SELECT COUNT(1) FROM [dbo].[student_field_provenance] WHERE verified_at >= @from AND verified_at <= @to) AS provenance_fields,
  (SELECT COUNT(1) FROM [dbo].[issued_documents] WHERE created_at >= @from AND created_at <= @to) AS issued_documents,
  (SELECT COUNT(1) FROM [dbo].[profiles] WHERE access_revoked_at IS NOT NULL) AS revoked_accounts,
  (SELECT COUNT(1) FROM [dbo].[conversations] WHERE created_at >= @from AND created_at <= @to) AS assistant_conversations,
  (SELECT COUNT(1) FROM [dbo].[voice_interaction_events] WHERE created_at >= @from AND created_at <= @to AND event_type = N'transcribed' AND success = 1) AS voice_interactions,
  (SELECT COUNT(1) FROM [dbo].[voice_interaction_events] WHERE created_at >= @from AND created_at <= @to AND event_type = N'transcribed' AND detected_language IN (N'ar', N'mixed')) AS voice_ar,
  (SELECT COUNT(1) FROM [dbo].[voice_interaction_events] WHERE created_at >= @from AND created_at <= @to AND event_type = N'transcribed' AND detected_language IN (N'en', N'mixed')) AS voice_en,
  (SELECT COUNT(1) FROM [dbo].[voice_interaction_events] WHERE created_at >= @from AND created_at <= @to AND clarification = 1) AS voice_clarifications,
  (SELECT COUNT(1) FROM [dbo].[voice_interaction_events] WHERE created_at >= @from AND created_at <= @to AND (event_type = N'failed' OR success = 0)) AS voice_failures;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalHandling] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalHandling @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT
  SUM(CASE WHEN status IN ('resolved','closed') AND current_responsible_actor = 'ai' THEN 1 ELSE 0 END) AS ai_resolved,
  SUM(CASE WHEN escalation_level > 0 OR current_responsible_actor IN ('service_owner','specific_officer','staff') THEN 1 ELSE 0 END) AS human_escalated,
  SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
  SUM(CASE WHEN status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS [open]
FROM [dbo].[cases] WHERE created_at >= @from AND created_at <= @to;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalReviewKinds] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalReviewKinds @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT kind, COUNT(1) AS n FROM [dbo].[case_reopen_requests]
WHERE created_at >= @from AND created_at <= @to GROUP BY kind;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalReviews] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalReviews @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(1) AS decided_sample,
  SUM(CASE WHEN kind IN (N'objection',N'reopen',N'correction') THEN 1 ELSE 0 END) AS reopen_or_objection
FROM [dbo].[case_reopen_requests] WHERE created_at >= @from AND created_at <= @to;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalSla] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalSla @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT
  SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS sample,
  SUM(CASE WHEN status IN ('resolved','closed') AND sla_state IN ('on_track','completed') THEN 1 ELSE 0 END) AS met
FROM [dbo].[cases] WHERE created_at >= @from AND created_at <= @to;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalTiming] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalTiming @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT
  SUM(CASE WHEN first_response_at IS NOT NULL THEN 1 ELSE 0 END) AS first_response_sample,
  AVG(CASE WHEN first_response_at IS NOT NULL THEN CAST(DATEDIFF(MINUTE, created_at, first_response_at) AS float) / 60.0 END) AS avg_first_response_hours,
  SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolution_sample,
  AVG(CASE WHEN resolved_at IS NOT NULL THEN CAST(DATEDIFF(MINUTE, created_at, resolved_at) AS float) / 60.0 END) AS avg_resolution_hours
FROM [dbo].[cases] WHERE created_at >= @from AND created_at <= @to;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_EvalVolumes] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalVolumes @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT
  (SELECT COUNT(1) FROM [dbo].[messages] WHERE created_at >= @from AND created_at <= @to) AS interactions,
  (SELECT COUNT(1) FROM [dbo].[messages] WHERE created_at >= @from AND created_at <= @to) AS chat_messages,
  (SELECT COUNT(1) FROM [dbo].[conversations] WHERE created_at >= @from AND created_at <= @to) AS conversations,
  COUNT(1) AS cases,
  SUM(CASE WHEN case_type = 'query' THEN 1 ELSE 0 END) AS queries,
  SUM(CASE WHEN case_type = 'complaint' THEN 1 ELSE 0 END) AS complaints,
  SUM(CASE WHEN case_type = 'suggestion' THEN 1 ELSE 0 END) AS suggestions,
  SUM(CASE WHEN case_type = 'alert' THEN 1 ELSE 0 END) AS alerts,
  SUM(CASE WHEN case_type = 'request' THEN 1 ELSE 0 END) AS requests
FROM [dbo].[cases] WHERE created_at >= @from AND created_at <= @to;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovPerformance] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovPerformance
AS BEGIN SET NOCOUNT ON;
SELECT AVG(CASE WHEN resolved_at IS NOT NULL THEN CAST(DATEDIFF(MINUTE, created_at, resolved_at) AS float) / 60.0 END) AS avg_resolution_hours,
  SUM(CASE WHEN sla_state IN ('on_track','completed') AND status IN ('resolved','closed') THEN 1 ELSE 0 END) AS within_sla,
  SUM(CASE WHEN sla_state = 'attention' THEN 1 ELSE 0 END) AS approaching_sla,
  SUM(CASE WHEN sla_state = 'breached' THEN 1 ELSE 0 END) AS breached_sla,
  SUM(CASE WHEN sla_state IN ('breached','critical') THEN 1 ELSE 0 END) AS critical_alerts
FROM [dbo].[cases];
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovRecent] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovRecent
AS BEGIN SET NOCOUNT ON;
SELECT TOP 12 c.id, c.case_number AS caseNumber, c.title, c.case_type AS type, c.status,
       u.name_en AS unitEn, u.name_ar AS unitAr, c.created_at AS at
FROM [dbo].[cases] c LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
ORDER BY c.created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovReportByOwner] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovReportByOwner
  @from datetimeoffset=NULL, @to datetimeoffset=NULL, @unit uniqueidentifier=NULL,
  @owner uniqueidentifier=NULL, @type nvarchar(50)=NULL, @status nvarchar(50)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COALESCE(p.full_name, p.email, N'Unassigned') AS owner_name,
       COUNT(1) AS total,
       SUM(CASE WHEN c.status IN (N'resolved', N'closed') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN c.status NOT IN (N'resolved', N'closed') THEN 1 ELSE 0 END) AS open_cases
FROM [dbo].[cases] c
LEFT JOIN [dbo].[profiles] p ON p.id = c.assigned_to
WHERE c.deleted_at IS NULL
  AND (@from IS NULL OR c.created_at >= @from) AND (@to IS NULL OR c.created_at <= @to)
  AND (@unit IS NULL OR c.service_unit_id = @unit) AND (@owner IS NULL OR c.assigned_to = @owner)
  AND (@type IS NULL OR c.case_type = @type) AND (@status IS NULL OR c.status = @status)
GROUP BY COALESCE(p.full_name, p.email, N'Unassigned');
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovReportByUnit] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovReportByUnit
  @from datetimeoffset=NULL, @to datetimeoffset=NULL, @unit uniqueidentifier=NULL,
  @owner uniqueidentifier=NULL, @type nvarchar(50)=NULL, @status nvarchar(50)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COALESCE(u.name_en, N'Unassigned') AS unit_en,
       COALESCE(u.name_ar, N'غير مُسندة') AS unit_ar,
       COUNT(1) AS total,
       SUM(CASE WHEN c.status IN (N'resolved', N'closed') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN c.status NOT IN (N'resolved', N'closed') THEN 1 ELSE 0 END) AS open_cases,
       AVG(CASE WHEN COALESCE(c.resolved_at, c.closed_at) IS NOT NULL
           THEN CAST(DATEDIFF(MINUTE, c.created_at, COALESCE(c.resolved_at, c.closed_at)) AS float) / 60.0 END) AS avg_resolution_hours
FROM [dbo].[cases] c
LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
WHERE c.deleted_at IS NULL
  AND (@from IS NULL OR c.created_at >= @from) AND (@to IS NULL OR c.created_at <= @to)
  AND (@unit IS NULL OR c.service_unit_id = @unit) AND (@owner IS NULL OR c.assigned_to = @owner)
  AND (@type IS NULL OR c.case_type = @type) AND (@status IS NULL OR c.status = @status)
GROUP BY COALESCE(u.name_en, N'Unassigned'), COALESCE(u.name_ar, N'غير مُسندة');
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovReportMetrics] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovReportMetrics
  @from datetimeoffset=NULL, @to datetimeoffset=NULL, @unit uniqueidentifier=NULL,
  @owner uniqueidentifier=NULL, @type nvarchar(50)=NULL, @status nvarchar(50)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(1) AS total,
  SUM(CASE WHEN case_type = N'query' THEN 1 ELSE 0 END) AS queries,
  SUM(CASE WHEN case_type = N'complaint' THEN 1 ELSE 0 END) AS complaints,
  SUM(CASE WHEN case_type = N'suggestion' THEN 1 ELSE 0 END) AS suggestions,
  SUM(CASE WHEN case_type = N'alert' THEN 1 ELSE 0 END) AS alerts,
  SUM(CASE WHEN case_type IN (N'request', N'service_request') THEN 1 ELSE 0 END) AS requests,
  SUM(CASE WHEN status = N'resolved' THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN status = N'closed' THEN 1 ELSE 0 END) AS closed,
  SUM(CASE WHEN status NOT IN (N'resolved', N'closed') THEN 1 ELSE 0 END) AS unresolved,
  AVG(CASE WHEN COALESCE(resolved_at, closed_at) IS NOT NULL
      THEN CAST(DATEDIFF(MINUTE, created_at, COALESCE(resolved_at, closed_at)) AS float) / 60.0 END) AS avg_resolution_hours,
  SUM(CASE WHEN COALESCE(resolved_at, closed_at) IS NOT NULL
            AND (resolution_due_at IS NULL OR COALESCE(resolved_at, closed_at) <= resolution_due_at)
      THEN 1 ELSE 0 END) AS met_sla,
  SUM(CASE WHEN resolution_due_at IS NOT NULL
            AND ((COALESCE(resolved_at, closed_at) IS NOT NULL AND COALESCE(resolved_at, closed_at) > resolution_due_at)
              OR (COALESCE(resolved_at, closed_at) IS NULL AND resolution_due_at < SYSDATETIMEOFFSET()))
      THEN 1 ELSE 0 END) AS breached_sla
FROM [dbo].[cases]
WHERE deleted_at IS NULL
  AND (@from IS NULL OR created_at >= @from) AND (@to IS NULL OR created_at <= @to)
  AND (@unit IS NULL OR service_unit_id = @unit) AND (@owner IS NULL OR assigned_to = @owner)
  AND (@type IS NULL OR case_type = @type) AND (@status IS NULL OR status = @status);
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovReportRows] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovReportRows
  @from datetimeoffset=NULL, @to datetimeoffset=NULL, @unit uniqueidentifier=NULL,
  @owner uniqueidentifier=NULL, @type nvarchar(50)=NULL, @status nvarchar(50)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT TOP (1000)
  c.case_number,
  c.title,
  c.case_type,
  c.status,
  u.name_en AS unit_en,
  u.name_ar AS unit_ar,
  COALESCE(p.full_name, p.email) AS owner_name,
  c.created_at,
  COALESCE(c.resolved_at, c.closed_at) AS completed_at,
  c.resolution_due_at,
  CASE WHEN COALESCE(c.resolved_at, c.closed_at) IS NOT NULL
       THEN CAST(DATEDIFF(MINUTE, c.created_at, COALESCE(c.resolved_at, c.closed_at)) AS float) / 60.0
       ELSE NULL END AS resolution_hours
FROM [dbo].[cases] c
LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
LEFT JOIN [dbo].[profiles] p ON p.id = c.assigned_to
WHERE c.deleted_at IS NULL
  AND (@from IS NULL OR c.created_at >= @from) AND (@to IS NULL OR c.created_at <= @to)
  AND (@unit IS NULL OR c.service_unit_id = @unit) AND (@owner IS NULL OR c.assigned_to = @owner)
  AND (@type IS NULL OR c.case_type = @type) AND (@status IS NULL OR c.status = @status)
ORDER BY c.created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovTotals] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovTotals
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(1) AS total,
  SUM(CASE WHEN case_type = 'query' THEN 1 ELSE 0 END) AS queries,
  SUM(CASE WHEN case_type = 'complaint' THEN 1 ELSE 0 END) AS complaints,
  SUM(CASE WHEN case_type = 'suggestion' THEN 1 ELSE 0 END) AS suggestions,
  SUM(CASE WHEN case_type = 'alert' THEN 1 ELSE 0 END) AS alerts,
  SUM(CASE WHEN case_type IN ('request','service_request') THEN 1 ELSE 0 END) AS requests,
  SUM(CASE WHEN status IN ('submitted','new','open') THEN 1 ELSE 0 END) AS open_new,
  SUM(CASE WHEN status IN ('in_progress','assigned','awaiting_student') THEN 1 ELSE 0 END) AS in_progress,
  SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
FROM [dbo].[cases];
END
GO

/* PROCEDURE [dbo].[usp_Rpc_GovUnitsAttention] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_GovUnitsAttention
AS BEGIN SET NOCOUNT ON;
SELECT TOP 8 u.id AS unit_id, u.name_en, u.name_ar,
  SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS open_cases,
  SUM(CASE WHEN c.sla_state = 'breached' THEN 1 ELSE 0 END) AS breached,
  SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.case_type = 'complaint' THEN 1 ELSE 0 END) AS open_complaints,
  SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.case_type = 'alert' THEN 1 ELSE 0 END) AS open_alerts
FROM [dbo].[service_units] u JOIN [dbo].[cases] c ON c.service_unit_id = u.id
GROUP BY u.id, u.name_en, u.name_ar ORDER BY breached DESC, open_cases DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_ListEscalations] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_ListEscalations @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT escalation_level AS level, reason, triggered_at AS at,
       acknowledged_at AS acknowledgedAt, resolved_at AS resolvedAt
FROM [dbo].[escalation_actions] WHERE case_id = @caseId ORDER BY triggered_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_ListOversight] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_ListOversight @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT action_type AS type, reason, created_at AS at
FROM [dbo].[case_oversight_actions] WHERE case_id = @caseId ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_ListResponsibility] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_ListResponsibility @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT actor, started_at AS startedAt, ended_at AS endedAt, duration_seconds AS durationSeconds,
       service_unit_id AS unitId, reason
FROM [dbo].[case_responsibility_history] WHERE case_id = @caseId ORDER BY started_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_ListSlaEvents] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_ListSlaEvents @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT event_type AS type, threshold_percentage AS threshold, triggered_at AS at,
       acknowledged_at AS acknowledgedAt, action_taken AS action
FROM [dbo].[case_sla_events] WHERE case_id = @caseId ORDER BY triggered_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_ListStatusHistory] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_ListStatusHistory @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT from_status AS [from], to_status AS [to], note, created_at AS at
FROM [dbo].[case_status_history] WHERE case_id = @caseId ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_Rpc_OwnerPerformance] */
CREATE OR ALTER PROCEDURE dbo.usp_Rpc_OwnerPerformance
AS BEGIN SET NOCOUNT ON;
SELECT p.id AS owner_id, p.full_name AS owner_name, MAX(u.name_en) AS unit_en, MAX(u.name_ar) AS unit_ar,
  COUNT(1) AS assigned,
  SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS open_cases,
  SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END) AS closed,
  SUM(CASE WHEN c.case_type = 'complaint' THEN 1 ELSE 0 END) AS complaints,
  SUM(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 1 ELSE 0 END) AS overdue,
  AVG(CASE WHEN c.resolved_at IS NOT NULL THEN CAST(DATEDIFF(MINUTE, c.created_at, c.resolved_at) AS float) / 60.0 END) AS avg_handling_hours,
  CAST(NULL AS float) AS sla_compliance, CAST(NULL AS float) AS resolution_rate
FROM [dbo].[cases] c JOIN [dbo].[profiles] p ON p.id = c.assigned_to
LEFT JOIN [dbo].[service_units] u ON u.id = c.service_unit_id
GROUP BY p.id, p.full_name ORDER BY open_cases DESC;
END
GO

/* SKIP [dbo].[usp_SearchKnowledgePassages] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Sso_ConsumeState] */
CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_ConsumeState]
  @stateHash nvarchar(64),
  @now datetimeoffset
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE [auth].[sso_states] WITH (UPDLOCK, ROWLOCK)
  SET [consumed_at] = @now
  OUTPUT CASE WHEN inserted.[expires_at] < @now THEN N'sso_expired'
              ELSE inserted.[protected_context] END
  WHERE [state_hash] = @stateHash
    AND [consumed_at] IS NULL;
END;
GO

/* PROCEDURE [dbo].[usp_Sso_CreateState] */
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

/* PROCEDURE [dbo].[usp_Sso_GetSettings] */
CREATE OR ALTER PROCEDURE [dbo].[usp_Sso_GetSettings]
  @IsProductionEntry bit = 1
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (1)
    [SsoIsEnabled], [SsoClientId], [SsoClientSecret],
    [SsoAuthorizationEndpoint], [SsoTokenEndpoint], [SsoUserInfoEndpoint],
    [SsoIntrospectEndpoint], [SsoRedirectUri], [SsoScope], [SsoUiOrigin],
    [HeaderDomain]
  FROM [dbo].[ApplicationSettings]
  WHERE [IsActive] = 1
    AND [IsProductionEntry] = COALESCE(@IsProductionEntry, 1)
  ORDER BY [UpdatedAtUtc] DESC, [Id] DESC;
END;
GO

/* PROCEDURE [dbo].[usp_SsoEmail_Acquire] */
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

/* PROCEDURE [dbo].[usp_SsoEmail_Release] */
CREATE OR ALTER PROCEDURE dbo.usp_SsoEmail_Release @userId uniqueidentifier,@sessionId uniqueidentifier,@leaseId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE auth.sso_email_tokens SET lease_id=NULL,lease_until=NULL
    WHERE user_id=@userId AND session_id=@sessionId AND lease_id=@leaseId;
END;
GO

/* PROCEDURE [dbo].[usp_SsoEmail_Save] */
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

/* PROCEDURE [dbo].[usp_SsoEmail_Store] */
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

/* PROCEDURE [dbo].[usp_StaffUnit] */
CREATE OR ALTER PROCEDURE dbo.usp_StaffUnit
  @userId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 CONVERT(nvarchar(36), [service_unit_id]) FROM [dbo].[staff_profiles] WHERE [user_id] = @userId;
END
GO

/* PROCEDURE [dbo].[usp_StorageUpsertObject] */
CREATE OR ALTER PROCEDURE dbo.usp_StorageUpsertObject
  @bucket nvarchar(256),
  @path nvarchar(1024),
  @ownerId uniqueidentifier,
  @meta nvarchar(max)
AS
BEGIN
  IF NOT EXISTS (SELECT 1 FROM [storage].[objects] WHERE [bucket_id] = @bucket AND [name] = @path)
    INSERT INTO [storage].[objects] ([bucket_id], [name], [owner], [metadata])
    VALUES (@bucket, @path, @ownerId, @meta);
  ELSE
    UPDATE [storage].[objects] SET [updated_at] = SYSDATETIMEOFFSET(), [owner] = @ownerId
    WHERE [bucket_id] = @bucket AND [name] = @path;
END
GO

/* PROCEDURE [dbo].[usp_StudentLists_CountAlerts] */
CREATE OR ALTER PROCEDURE dbo.usp_StudentLists_CountAlerts
  @uid uniqueidentifier, @skip int=0, @take int=20, @filter nvarchar(50)=N'all', @since datetimeoffset=NULL, @search nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.student_alerts a
WHERE a.student_id=@uid AND a.status=N'active'
  AND (@filter<>N'unread' OR a.is_read=0)
  AND (@filter<>N'critical' OR a.severity IN(N'critical',N'high'))
  AND (@since IS NULL OR a.generated_at>=@since)
  AND (@search IS NULL OR a.title_en LIKE @search OR a.title_ar LIKE @search);
END
GO

/* SKIP [dbo].[usp_StudentLists_CountCases] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_StudentLists_CountSuggestions] */
CREATE OR ALTER PROCEDURE dbo.usp_StudentLists_CountSuggestions
  @uid uniqueidentifier, @skip int=0, @take int=20, @status nvarchar(50)=NULL, @sort nvarchar(50)=N'recent', @search nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(*) FROM dbo.suggestions s
WHERE s.student_id=@uid AND s.student_hidden_at IS NULL
  AND (@status IS NULL OR s.status=@status)
  AND (@search IS NULL OR s.reference_number LIKE @search OR s.title LIKE @search);
END
GO

/* PROCEDURE [dbo].[usp_StudentLists_ListAlerts] */
CREATE OR ALTER PROCEDURE dbo.usp_StudentLists_ListAlerts
  @uid uniqueidentifier, @skip int, @take int, @filter nvarchar(50)=N'all', @since datetimeoffset=NULL, @search nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT a.id,a.title_en,a.title_ar,a.body_en,a.body_ar,a.severity,a.alert_type,a.action_url,a.deadline,
  CAST(a.is_read AS bit)is_read,a.generated_at,u.name_en unit_en,u.name_ar unit_ar
FROM dbo.student_alerts a LEFT JOIN dbo.service_units u ON u.id=a.source_unit_id
WHERE a.student_id=@uid AND a.status=N'active'
  AND (@filter<>N'unread' OR a.is_read=0)
  AND (@filter<>N'critical' OR a.severity IN(N'critical',N'high'))
  AND (@since IS NULL OR a.generated_at>=@since)
  AND (@search IS NULL OR a.title_en LIKE @search OR a.title_ar LIKE @search)
ORDER BY CASE a.severity WHEN N'critical' THEN 4 WHEN N'high' THEN 3 WHEN N'medium' THEN 2 ELSE 1 END DESC,a.generated_at DESC
OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_StudentLists_ListCases] */
CREATE OR ALTER PROCEDURE dbo.usp_StudentLists_ListCases
  @uid uniqueidentifier, @skip int, @take int, @tab nvarchar(50)=N'active', @type nvarchar(50)=NULL,
  @statuses nvarchar(max)=NULL, @sort nvarchar(50)=N'recent', @since datetimeoffset=NULL, @search nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT id,case_number,title,status,urgency,case_type,created_at,last_activity_at,
  CAST(CASE WHEN case_type<>N'complaint' AND status IN(N'resolved',N'closed') THEN 1 ELSE 0 END AS bit) removable,
  meeting_at,meeting_mode,meeting_location
FROM dbo.cases
WHERE student_id=@uid AND student_hidden_at IS NULL
  AND (
    (@statuses IS NOT NULL AND status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@statuses,',')))
    OR (@statuses IS NULL AND @tab=N'active' AND status NOT IN (N'resolved',N'closed'))
    OR (@statuses IS NULL AND @tab=N'resolved' AND status IN (N'resolved',N'closed'))
    OR (@statuses IS NULL AND @tab NOT IN (N'active',N'resolved'))
  )
  AND (@type IS NULL OR case_type=@type)
  AND (@since IS NULL OR created_at>=@since)
  AND (@search IS NULL OR case_number LIKE @search OR title LIKE @search)
ORDER BY
  CASE WHEN @sort=N'oldest' THEN 0 WHEN @sort=N'activity' THEN 1 ELSE 2 END,
  CASE WHEN @sort=N'oldest' THEN created_at END ASC,
  CASE WHEN @sort=N'activity' THEN CASE WHEN last_activity_at IS NULL THEN 1 ELSE 0 END END ASC,
  CASE WHEN @sort=N'activity' THEN last_activity_at END DESC,
  created_at DESC
OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_StudentLists_ListSuggestions] */
CREATE OR ALTER PROCEDURE dbo.usp_StudentLists_ListSuggestions
  @uid uniqueidentifier, @skip int, @take int, @status nvarchar(50)=NULL, @sort nvarchar(50)=N'recent', @search nvarchar(200)=NULL
AS BEGIN SET NOCOUNT ON;
SELECT s.id,s.reference_number,s.title,s.status,s.created_at,s.outcome_summary,s.implementation_target_date,
  u.update_text_en latestUpdateEn,u.update_text_ar latestUpdateAr
FROM dbo.suggestions s OUTER APPLY
(SELECT TOP (1) update_text_en,update_text_ar FROM dbo.suggestion_updates su WHERE su.suggestion_id=s.id AND su.visible_to_student=1 ORDER BY su.created_at DESC)u
WHERE s.student_id=@uid AND s.student_hidden_at IS NULL
  AND (@status IS NULL OR s.status=@status)
  AND (@search IS NULL OR s.reference_number LIKE @search OR s.title LIKE @search)
ORDER BY CASE WHEN @sort=N'oldest' THEN s.created_at END ASC, s.created_at DESC
OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_Acknowledge] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_Acknowledge @actor uniqueidentifier, @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.suggestions SET status=N'under_review',assigned_staff_id=COALESCE(assigned_staff_id,@actor) WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_Assign] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_Assign @target uniqueidentifier, @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.suggestions SET assigned_staff_id=@target,status=CASE WHEN status=N'submitted' THEN N'assigned' ELSE status END WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_AssignOnIntake] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_AssignOnIntake
  @assignee uniqueidentifier=NULL, @due datetimeoffset, @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.suggestions SET assigned_staff_id=@assignee,review_due_at=@due,status=CASE WHEN @assignee IS NULL THEN N'submitted' ELSE N'assigned' END WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_Decide] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_Decide
  @Decision nvarchar(50), @OutcomeEn nvarchar(max), @target datetimeoffset=NULL, @SuggestionId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.suggestions SET status=@Decision,outcome_summary=@OutcomeEn,implementation_target_date=@target WHERE id=@SuggestionId;
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_InsertAssessment] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_InsertAssessment
  @SuggestionId uniqueidentifier, @actor uniqueidentifier, @Impact int, @Feasibility int, @Alignment int,
  @CostBand nvarchar(50)=NULL, @Complexity nvarchar(50)=NULL, @Recommendation nvarchar(50), @Rationale nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.suggestion_assessments(suggestion_id,reviewer_id,student_impact_score,feasibility_score,strategic_alignment_score,estimated_cost_band,implementation_complexity,recommendation,rationale)
VALUES(@SuggestionId,@actor,@Impact,@Feasibility,@Alignment,@CostBand,@Complexity,@Recommendation,@Rationale);
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_InsertAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_InsertAudit
  @actor uniqueidentifier=NULL, @action nvarchar(200), @id uniqueidentifier, @json nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(@actor,@action,N'suggestion',@id,@json);
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_InsertReview] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_InsertReview
  @SuggestionId uniqueidentifier, @actor uniqueidentifier, @Decision nvarchar(50), @OutcomeEn nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.suggestion_reviews(suggestion_id,reviewer_id,decision,notes)VALUES(@SuggestionId,@actor,@Decision,@OutcomeEn);
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_InsertUpdate] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_InsertUpdate
  @id uniqueidentifier, @actor uniqueidentifier=NULL, @type nvarchar(50), @en nvarchar(max), @ar nvarchar(max)=NULL, @visible bit=1
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.suggestion_updates(suggestion_id,update_type,update_text_en,update_text_ar,visible_to_student,created_by)
VALUES(@id,@type,@en,COALESCE(NULLIF(@ar,N''),@en),@visible,@actor);
END
GO

/* SKIP [dbo].[usp_Suggestions_Load] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Suggestions_MarkUnderReview] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_MarkUnderReview @SuggestionId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.suggestions SET status=N'under_review' WHERE id=@SuggestionId AND status IN(N'submitted',N'assigned');
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_Notify] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_Notify
  @Id uniqueidentifier, @StudentId uniqueidentifier, @ServiceUnitId uniqueidentifier=NULL, @actor uniqueidentifier=NULL,
  @body nvarchar(max), @dedupe nvarchar(300)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,service_unit_id,triggered_by,dedupe_key)
VALUES(N'suggestion_status_changed',N'suggestion',@Id,@StudentId,N'in_app',N'Suggestion update',@body,N'/requests',N'pending',@ServiceUnitId,@actor,@dedupe);
END
GO

/* PROCEDURE [dbo].[usp_Suggestions_PickAssignee] */
CREATE OR ALTER PROCEDURE dbo.usp_Suggestions_PickAssignee @ServiceUnitId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT TOP(1) ss.staff_profile_id FROM dbo.service_staff ss
JOIN dbo.staff_profiles sp ON sp.user_id=ss.staff_profile_id
OUTER APPLY(SELECT COUNT(*) active_cases FROM dbo.cases c WHERE c.assigned_to=ss.staff_profile_id AND c.status IN(N'submitted',N'acknowledged',N'classified',N'routed',N'assigned',N'in_progress',N'in_review',N'ai_processing',N'escalated',N'on_hold',N'waiting_external',N'awaiting_student',N'student_confirmation',N'reopened',N'transferred')) w
WHERE ss.service_unit_id=@ServiceUnitId AND ss.can_receive_cases=1 AND ss.is_active=1
  AND sp.is_active=1 AND COALESCE(sp.availability_status,N'available')=N'available'
ORDER BY COALESCE(w.active_cases,0),sp.last_assigned_at,ss.is_service_owner DESC;
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_CancelReminder] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_CancelReminder @id uniqueidentifier, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.student_service_reminders SET status=N'cancelled',cancelled_at=SYSDATETIMEOFFSET() WHERE id=@id AND student_id=@userId AND status=N'scheduled';
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_DeleteWindow] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_DeleteWindow @id uniqueidentifier
AS BEGIN SET NOCOUNT ON; DELETE FROM dbo.service_availability_windows WHERE id=@id; END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_FindReminder] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_FindReminder
  @userId uniqueidentifier, @serviceId uniqueidentifier, @ReminderType nvarchar(50)
AS BEGIN SET NOCOUNT ON;
SELECT id FROM dbo.student_service_reminders WHERE student_id=@userId AND service_id=@serviceId AND reminder_type=@ReminderType AND status=N'scheduled';
END
GO

/* SKIP [dbo].[usp_SvcAvail_GetServiceIdByCode] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_SvcAvail_InsertReminder] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_InsertReminder
  @userId uniqueidentifier, @serviceId uniqueidentifier, @window uniqueidentifier=NULL, @ReminderType nvarchar(50), @scheduled datetimeoffset
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.student_service_reminders(student_id,service_id,availability_window_id,reminder_type,scheduled_for,status)
OUTPUT INSERTED.id VALUES(@userId,@serviceId,@window,@ReminderType,@scheduled,N'scheduled');
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_InsertWindow] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_InsertWindow
  @ServiceId uniqueidentifier, @AvailabilityType nvarchar(50), @opens datetimeoffset=NULL, @closes datetimeoffset=NULL,
  @AcademicTermId uniqueidentifier=NULL, @Label nvarchar(200)=NULL, @ReasonEn nvarchar(max)=NULL, @ReasonAr nvarchar(max)=NULL,
  @StudentMessageEn nvarchar(max)=NULL, @StudentMessageAr nvarchar(max)=NULL, @RemindersEnabled bit=NULL,
  @PreliminaryCheckAllowed bit=NULL, @StudentVisible bit=NULL, @Status nvarchar(50)=NULL, @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.service_availability_windows(service_id,availability_type,opens_at,closes_at,academic_term_id,label,reason_en,reason_ar,student_message_en,student_message_ar,reminders_enabled,preliminary_check_allowed,student_visible,status,created_by,updated_by)
OUTPUT INSERTED.id
VALUES(@ServiceId,@AvailabilityType,@opens,@closes,@AcademicTermId,@Label,@ReasonEn,@ReasonAr,@StudentMessageEn,@StudentMessageAr,COALESCE(@RemindersEnabled,1),COALESCE(@PreliminaryCheckAllowed,0),COALESCE(@StudentVisible,1),COALESCE(@Status,N'active'),@userId,@userId);
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_ListAudit] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_ListAudit @serviceId uniqueidentifier=NULL
AS BEGIN SET NOCOUNT ON;
SELECT TOP (50) id,service_id,window_id,action,old_values,new_values,reason,changed_by,created_at
FROM dbo.service_availability_audit WHERE @serviceId IS NULL OR service_id=@serviceId ORDER BY created_at DESC;
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_ListReminders] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_ListReminders @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT r.id,r.service_id,r.reminder_type,r.scheduled_for,r.status,r.sent_at,s.code,s.name_en,s.name_ar
FROM dbo.student_service_reminders r JOIN dbo.university_services s ON s.id=r.service_id
WHERE r.student_id=@id ORDER BY r.scheduled_for;
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_ListServices] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_ListServices
AS BEGIN SET NOCOUNT ON;
SELECT id Id,code Code,name_en NameEn,name_ar NameAr,category Category,CAST(is_active AS bit) IsActive,service_unit_id ServiceUnitId
FROM dbo.university_services ORDER BY name_en;
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_ListWindows] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_ListWindows
AS BEGIN SET NOCOUNT ON;
SELECT id Id,service_id ServiceId,availability_type AvailabilityType,opens_at OpensAt,closes_at ClosesAt,status Status,label Label,
  reason_en ReasonEn,reason_ar ReasonAr,student_message_en StudentMessageEn,student_message_ar StudentMessageAr,
  CAST(reminders_enabled AS bit) RemindersEnabled,CAST(preliminary_check_allowed AS bit) PreliminaryCheckAllowed,
  CAST(student_visible AS bit) StudentVisible,academic_term_id AcademicTermId,updated_at UpdatedAt
FROM dbo.service_availability_windows ORDER BY opens_at;
END
GO

/* PROCEDURE [dbo].[usp_SvcAvail_UpdateWindow] */
CREATE OR ALTER PROCEDURE dbo.usp_SvcAvail_UpdateWindow
  @ServiceId uniqueidentifier, @AvailabilityType nvarchar(50), @opens datetimeoffset=NULL, @closes datetimeoffset=NULL,
  @AcademicTermId uniqueidentifier=NULL, @Label nvarchar(200)=NULL, @ReasonEn nvarchar(max)=NULL, @ReasonAr nvarchar(max)=NULL,
  @StudentMessageEn nvarchar(max)=NULL, @StudentMessageAr nvarchar(max)=NULL, @RemindersEnabled bit=NULL,
  @PreliminaryCheckAllowed bit=NULL, @StudentVisible bit=NULL, @Status nvarchar(50)=NULL, @userId uniqueidentifier, @id uniqueidentifier
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.service_availability_windows SET service_id=@ServiceId,availability_type=@AvailabilityType,opens_at=@opens,closes_at=@closes,
  academic_term_id=@AcademicTermId,label=@Label,reason_en=@ReasonEn,reason_ar=@ReasonAr,student_message_en=@StudentMessageEn,
  student_message_ar=@StudentMessageAr,reminders_enabled=COALESCE(@RemindersEnabled,1),preliminary_check_allowed=COALESCE(@PreliminaryCheckAllowed,0),
  student_visible=COALESCE(@StudentVisible,1),status=COALESCE(@Status,N'active'),updated_by=@userId,updated_at=SYSDATETIMEOFFSET() WHERE id=@id;
END
GO

/* PROCEDURE [dbo].[usp_TicketEmail_Claim] */
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

/* PROCEDURE [dbo].[usp_TicketEmail_Complete] */
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

/* PROCEDURE [dbo].[usp_TicketEmail_Discover] */
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

/* SKIP [dbo].[usp_TicketEmail_GetAuthorization] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_TicketEmail_GetSettings] */
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

/* PROCEDURE [dbo].[usp_Tickets_GetAssignment] */
CREATE OR ALTER PROCEDURE dbo.usp_Tickets_GetAssignment
    @unit uniqueidentifier, @requester uniqueidentifier, @sensitive bit=0,
    @preferredOwner uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UnitId,En,Ar,Owner,Method FROM dbo.ufn_TicketAssignment(@unit,@requester,@sensitive,@preferredOwner);
END;
GO

/* SKIP [dbo].[usp_Tickets_RequireAssignment] — encrypted or non-standard definition */
GO
/* PROCEDURE [dbo].[usp_Transp_Audit] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_Audit @actor uniqueidentifier, @action nvarchar(100), @caseId uniqueidentifier, @metadata nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(@actor,@action,N'case',@caseId,@metadata);
END
GO

/* PROCEDURE [dbo].[usp_Transp_GetActivityCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_GetActivityCase @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT c.student_id StudentId,c.created_at CreatedAt,c.ai_summary AiSummary,c.outcome_en OutcomeEn,c.outcome_ar OutcomeAr,
       su.name_en UnitEn,su.name_ar UnitAr,p.full_name StaffName,cc.name_en CategoryEn,cc.name_ar CategoryAr
FROM dbo.cases c LEFT JOIN dbo.service_units su ON su.id=c.service_unit_id LEFT JOIN dbo.profiles p ON p.id=c.assigned_to
LEFT JOIN dbo.case_categories cc ON cc.id=c.category_id WHERE c.id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Transp_GetOutcome] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_GetOutcome @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT c.student_id StudentId,c.status Status,c.outcome_en OutcomeEn,c.outcome_ar OutcomeAr,c.next_action_en NextStepEn,c.next_action_ar NextStepAr,
COALESCE(c.resolved_at,c.closed_at) ResolvedAt,su.name_en UnitEn,su.name_ar UnitAr,p.full_name StaffName,
(SELECT TOP (1) resolution_summary_en FROM dbo.case_resolutions WHERE case_id=c.id ORDER BY created_at DESC) ExplanationEn,
(SELECT TOP (1) resolution_summary_ar FROM dbo.case_resolutions WHERE case_id=c.id ORDER BY created_at DESC) ExplanationAr
FROM dbo.cases c LEFT JOIN dbo.service_units su ON su.id=c.service_unit_id LEFT JOIN dbo.profiles p ON p.id=c.assigned_to WHERE c.id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Transp_InsertComment] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_InsertComment @caseId uniqueidentifier, @userId uniqueidentifier, @reason nvarchar(max)
AS BEGIN SET NOCOUNT ON; INSERT INTO dbo.case_comments(case_id,author_id,body,is_internal) VALUES(@caseId,@userId,@reason,0); END
GO

/* PROCEDURE [dbo].[usp_Transp_InsertEscalation] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_InsertEscalation
  @caseId uniqueidentifier, @level int, @unitId uniqueidentifier=NULL, @assignedTo uniqueidentifier=NULL,
  @reason nvarchar(max), @userId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.escalation_actions(case_id,escalation_level,previous_unit_id,target_unit_id,previous_assignee_id,reason,triggered_by)
VALUES(@caseId,@level,@unitId,@unitId,@assignedTo,@reason,@userId);
UPDATE dbo.cases SET escalation_level=@level,sla_state=N'escalated' WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Transp_InsertReopenRequest] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_InsertReopenRequest
  @caseId uniqueidentifier, @userId uniqueidentifier, @kind nvarchar(50), @reason nvarchar(max),
  @status nvarchar(50), @outcomeEn nvarchar(max)=NULL, @outcomeAr nvarchar(max)=NULL, @decidedAt datetimeoffset=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_reopen_requests(case_id,student_id,kind,reason,original_status,original_outcome_en,original_outcome_ar,original_decided_at)
VALUES(@caseId,@userId,@kind,@reason,@status,@outcomeEn,@outcomeAr,@decidedAt);
END
GO

/* PROCEDURE [dbo].[usp_Transp_InsertStatusHistory] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_InsertStatusHistory
  @caseId uniqueidentifier, @status nvarchar(50), @userId uniqueidentifier, @note nvarchar(max)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_status_history(case_id,from_status,to_status,changed_by,note) VALUES(@caseId,@status,N'in_review',@userId,@note);
END
GO

/* PROCEDURE [dbo].[usp_Transp_ListComments] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_ListComments @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT author_id AuthorId,is_info_request IsInfoRequest,created_at CreatedAt FROM dbo.case_comments WHERE case_id=@caseId ORDER BY created_at; END
GO

/* PROCEDURE [dbo].[usp_Transp_ListConcerns] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_ListConcerns @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id,kind,reason,created_at createdAt,NULLIF(review_decision,N'pending') decision,decision_reason decisionReason,reviewed_at reviewedAt,
original_outcome_en originalOutcomeEn,original_outcome_ar originalOutcomeAr FROM dbo.case_reopen_requests WHERE case_id=@caseId ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Transp_ListNotices] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_ListNotices @caseId uniqueidentifier, @studentId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT COALESCE(sent_at,created_at) CreatedAt,status Status FROM dbo.notification_deliveries
WHERE case_id=@caseId AND recipient_user_id=@studentId AND status IN (N'sent',N'delivered') ORDER BY created_at;
END
GO

/* PROCEDURE [dbo].[usp_Transp_ListReceipts] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_ListReceipts @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT created_at CreatedAt,responsible_unit_name Actor FROM dbo.action_receipts WHERE case_id=@caseId ORDER BY created_at; END
GO

/* PROCEDURE [dbo].[usp_Transp_ListStatusHistory] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_ListStatusHistory @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON; SELECT to_status ToStatus,created_at CreatedAt FROM dbo.case_status_history WHERE case_id=@caseId ORDER BY created_at; END
GO

/* PROCEDURE [dbo].[usp_Transp_LockCase] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_LockCase @caseId uniqueidentifier
AS BEGIN SET NOCOUNT ON;
SELECT id Id,case_number CaseNumber,student_id StudentId,status Status,service_unit_id UnitId,assigned_to AssignedTo,
outcome_en OutcomeEn,outcome_ar OutcomeAr,COALESCE(resolved_at,closed_at) DecidedAt,escalation_level EscalationLevel
FROM dbo.cases WITH (UPDLOCK) WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_Transp_Notify] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_Notify
  @caseId uniqueidentifier, @recipient uniqueidentifier, @reason nvarchar(max), @url nvarchar(500),
  @unitId uniqueidentifier=NULL, @actor uniqueidentifier, @dedupe nvarchar(300)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,case_id,service_unit_id,triggered_by,dedupe_key)
VALUES(N'case_status_changed',N'case',@caseId,@recipient,N'in_app',N'Case outcome update',@reason,@url,N'pending',@caseId,@unitId,@actor,@dedupe);
END
GO

/* PROCEDURE [dbo].[usp_Transp_SetInReview] */
CREATE OR ALTER PROCEDURE dbo.usp_Transp_SetInReview @caseId uniqueidentifier, @nextEn nvarchar(max), @nextAr nvarchar(max)
AS BEGIN SET NOCOUNT ON;
UPDATE dbo.cases SET status=N'in_review',last_activity_at=SYSDATETIMEOFFSET(),next_action_en=@nextEn,next_action_ar=@nextAr WHERE id=@caseId;
END
GO

/* PROCEDURE [dbo].[usp_VerifyStudentDocument] */
CREATE OR ALTER PROCEDURE dbo.usp_VerifyStudentDocument
  @token nvarchar(256)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 * FROM [dbo].[issued_documents] WHERE [secure_verification_token] = @token;
END
GO

/* ========== TRIGGERS ========== */
GO
/* TRIGGER [dbo].[trg_Suggestions_RequireAssignment] on [dbo].[suggestions] */
CREATE OR ALTER TRIGGER dbo.trg_Suggestions_RequireAssignment ON dbo.suggestions AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS(SELECT 1 FROM inserted i WHERE NOT EXISTS(SELECT 1 FROM dbo.service_units u WHERE u.id=i.service_unit_id AND u.is_active=1)
        OR (i.assigned_staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates(i.service_unit_id,i.student_id,0,i.assigned_staff_id)))
        OR (i.assigned_staff_id IS NULL AND NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignment(i.service_unit_id,i.student_id,0,NULL) r WHERE r.Owner IS NULL)))
        THROW 51027, 'A suggestion requires a valid staff assignment or the responsible unit queue fallback.', 1;
END;
GO

/* ========== END ==========
  Functions: 1 | Views: 1 | Procedures: 609 | Triggers: 1
  Indexes: intentionally omitted (unsafe DROP PK on live DB).
*/
