/*
  Hotfix for column mismatches reported when deploying
  2026-09-21-usp-api-direct-queries.sql

  Schema facts:
  - dbo.staff_profiles has NO is_demo_record (use profiles.is_demo_account)
  - dbo.student_alerts has NO updated_at
  - dbo.learning_signals column is correction_source (not source)
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertReassignSignal
  @id uniqueidentifier, @old uniqueidentifier, @target uniqueidentifier, @note nvarchar(max)=NULL, @reason nvarchar(100)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,original_staff_id,corrected_staff_id,staff_comment,reason_code,confidence)
VALUES(N'STAFF_REASSIGNMENT',N'STAFF',@id,@old,@target,@note,@reason,.6);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_InsertFeedbackSignal
  @type nvarchar(100), @CaseId uniqueidentifier, @student uniqueidentifier, @Comments nvarchar(max)=NULL, @outcome nvarchar(200)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,student_id,student_feedback,outcome,confidence)
VALUES(@type,N'STUDENT',@CaseId,@student,@Comments,@outcome,.6);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_RequestReopen
  @CaseId uniqueidentifier, @student uniqueidentifier, @Reason nvarchar(max), @NewEvidence nvarchar(max)=NULL, @RequestedOutcome nvarchar(max)=NULL
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.case_reopen_requests(case_id,student_id,reason,new_evidence,requested_outcome)VALUES(@CaseId,@student,@Reason,@NewEvidence,@RequestedOutcome);
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,student_id,student_feedback,confidence)VALUES(N'CASE_REOPEN',N'STUDENT',@CaseId,@student,@Reason,.65);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Owner_InsertRoutingSignal
  @CaseId uniqueidentifier, @original uniqueidentifier=NULL, @CorrectedUnitId uniqueidentifier=NULL,
  @topic nvarchar(200)=NULL, @service nvarchar(100)=NULL, @Reason nvarchar(max), @outcome nvarchar(50)
AS BEGIN SET NOCOUNT ON;
INSERT INTO dbo.learning_signals(correction_type,correction_source,case_id,original_unit_id,corrected_unit_id,original_domain,original_intent,staff_comment,outcome,confidence)
VALUES(N'ROUTING_CORRECTION',N'STAFF',@CaseId,@original,@CorrectedUnitId,@topic,@service,@Reason,@outcome,.75);
END
GO

-- ============================================================
-- Hotfix: Dossier GetAssignment + Rpc Eval* column/syntax errors
-- (assignment_id/created_at/sector, reserved open, provenance verified_at, reviews.kind)
-- ============================================================

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

CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalReviews @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT COUNT(1) AS decided_sample,
  SUM(CASE WHEN kind IN (N'objection',N'reopen',N'correction') THEN 1 ELSE 0 END) AS reopen_or_objection
FROM [dbo].[case_reopen_requests] WHERE created_at >= @from AND created_at <= @to;
END
GO

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
  (SELECT COUNT(1) FROM [dbo].[conversations] WHERE created_at >= @from AND created_at <= @to) AS assistant_conversations;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Rpc_EvalReviewKinds @from datetimeoffset, @to datetimeoffset
AS BEGIN SET NOCOUNT ON;
SELECT kind, COUNT(1) AS n FROM [dbo].[case_reopen_requests]
WHERE created_at >= @from AND created_at <= @to GROUP BY kind;
END
GO
