SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_AdminUnitMonitor
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    u.id AS unitId, u.name_en AS unitEn, u.name_ar AS unitAr,
    SUM(CASE WHEN c.id IS NOT NULL AND c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor IN ('service_owner','specific_officer','manager','staff') THEN 1 ELSE 0 END) AS ownerPending,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'student' THEN 1 ELSE 0 END) AS studentPending,
    SUM(CASE WHEN c.status NOT IN ('resolved','closed','withdrawn','rejected','duplicate') AND c.current_responsible_actor = 'external_party' THEN 1 ELSE 0 END) AS externalPending,
    SUM(CASE WHEN c.sla_state = 'attention' THEN 1 ELSE 0 END) AS attention,
    SUM(CASE WHEN c.sla_state = 'critical' THEN 1 ELSE 0 END) AS critical,
    SUM(CASE WHEN c.sla_state = 'breached' THEN 1 ELSE 0 END) AS breached,
    SUM(CASE WHEN c.sla_state IN ('breached','critical') THEN 1 ELSE 0 END) AS criticalAlerts,
    SUM(CASE WHEN c.first_response_at IS NULL AND c.first_response_due_at < SYSDATETIMEOFFSET() THEN 1 ELSE 0 END) AS responseOverdue,
    CAST(0 AS float) AS automationRate,
    CAST(NULL AS float) AS medianResolutionHours
  FROM [dbo].[service_units] u
  INNER JOIN [dbo].[cases] c ON c.service_unit_id = u.id
  GROUP BY u.id, u.name_en, u.name_ar
  ORDER BY active DESC;
END
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_GetUniversityServiceById
  @serviceId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, code, name_en, name_ar FROM [dbo].[university_services] WHERE [id] = @serviceId;
END
GO
