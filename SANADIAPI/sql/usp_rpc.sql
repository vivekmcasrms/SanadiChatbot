SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_GetAppointmentSlotForUpdate
  @slotId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[appointment_slots] WITH (UPDLOCK) WHERE [id] = @slotId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_BookAppointment
  @id uniqueidentifier,
  @uid uniqueidentifier,
  @slotId uniqueidentifier,
  @purpose nvarchar(max),
  @code nvarchar(32)
AS
BEGIN
  INSERT INTO [dbo].[student_appointments] ([id], [student_id], [appointment_slot_id], [purpose], [status], [confirmation_code])
  VALUES (@id, @uid, @slotId, @purpose, 'booked', @code);
  UPDATE [dbo].[appointment_slots] SET [booked_count] = [booked_count] + 1 WHERE [id] = @slotId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_GetStudentAppointment
  @id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[student_appointments] WHERE [id] = @id;
END
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_SearchKnowledgePassages
  @limit int,
  @domain nvarchar(128) = NULL,
  @lang nvarchar(20) = NULL,
  @query nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit)
         c.id AS chunk_id, d.title, d.document_type, d.language, d.knowledge_domain,
         d.confidentiality_level AS confidentiality, d.effective_date, d.version,
         d.owner_unit_id AS owning_unit, c.page_number, c.section_title, c.content AS snippet,
         d.id AS source_id, 'document' AS source_type, 0 AS stale,
         1.0 AS score, 1.0 AS lexical_score, 0.0 AS semantic_score, 0.0 AS fuzzy_score,
         1.0 AS authority, NULL AS citation_url
  FROM [dbo].[document_chunks] c
  JOIN [dbo].[knowledge_documents] d ON d.id = c.document_id
  WHERE d.is_active = 1 AND (@domain IS NULL OR d.knowledge_domain = @domain)
    AND (@lang IS NULL OR d.language = @lang OR d.language IS NULL)
    AND (c.content LIKE '%' + @query + '%' OR d.title LIKE '%' + @query + '%')
  ORDER BY CASE WHEN d.title LIKE '%' + @query + '%' THEN 0 ELSE 1 END, d.updated_at DESC;
END
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_VerifyStudentDocument
  @token nvarchar(256)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 * FROM [dbo].[issued_documents] WHERE [secure_verification_token] = @token;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PurgeExpiredDocuments
  @limit int
AS
BEGIN
  UPDATE TOP (@limit) [dbo].[issued_documents]
  SET [document_status] = 'expired'
  WHERE [document_status] = 'active' AND [retention_expires_at] IS NOT NULL AND [retention_expires_at] < SYSDATETIMEOFFSET();
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PurgeMyIssuedDocument
  @id uniqueidentifier,
  @uid uniqueidentifier
AS
BEGIN
  UPDATE [dbo].[issued_documents] SET [document_status] = 'purged' WHERE [id] = @id AND [student_id] = @uid;
END
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_GetUniversityService
  @serviceId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, code, name_en, name_ar FROM [dbo].[university_services] WHERE [id] = @serviceId;
END
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_GetStaffAvailabilityRule
  @ruleId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM [dbo].[staff_availability_rules] WHERE [id] = @ruleId;
END
GO

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
