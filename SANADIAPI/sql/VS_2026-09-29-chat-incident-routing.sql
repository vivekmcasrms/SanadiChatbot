-- Restore the contact-register fast path used by the original chat orchestrator.
-- Run before deploying the updated API. No settings, contacts or tool policies are changed.
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetIncidentContacts
AS
BEGIN
    SET NOCOUNT ON;
    SELECT id AS Id, code AS Code, category_en AS CategoryEn, category_ar AS CategoryAr,
        emergency_type_en AS TypeEn, emergency_type_ar AS TypeAr,
        COALESCE(responsible_unit_en, label_en) AS UnitEn,
        COALESCE(responsible_unit_ar, label_ar) AS UnitAr,
        mobile_number AS Mobile, emergency_number AS EmergencyNumber, email AS Email,
        notes_en AS NotesEn, notes_ar AS NotesAr, keywords AS Keywords, priority AS Priority
    FROM dbo.emergency_contacts
    WHERE is_active = 1
      AND (NULLIF(emergency_number, N'') IS NOT NULL OR NULLIF(mobile_number, N'') IS NOT NULL OR NULLIF(email, N'') IS NOT NULL)
    ORDER BY priority, code;
END;
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertIncidentCase
    @id uniqueidentifier, @reference nvarchar(100), @userId uniqueidentifier,
    @title nvarchar(500), @description nvarchar(max), @lang nvarchar(10),
    @contactId uniqueidentifier, @conversationId uniqueidentifier = NULL, @urgency nvarchar(50) = N'high'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @code nvarchar(256), @unit uniqueidentifier, @owner uniqueidentifier,
            @unitEn nvarchar(450), @unitAr nvarchar(450);
        SELECT @code = code FROM dbo.emergency_contacts WITH (HOLDLOCK)
        WHERE id = @contactId AND is_active = 1;
        IF @code IS NULL THROW 50001, 'The contact is no longer active. Please send your report again.', 1;
        IF @conversationId IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM dbo.conversations WHERE id = @conversationId AND user_id = @userId)
            THROW 50001, 'Chat not found.', 1;

        DECLARE @routing TABLE(UnitId uniqueidentifier, OwnerId uniqueidentifier, UnitEn nvarchar(450), UnitAr nvarchar(450));
        INSERT @routing EXEC dbo.usp_Assistant_ResolveIncidentUnit @contactId;
        SELECT @unit = UnitId, @owner = OwnerId, @unitEn = UnitEn, @unitAr = UnitAr FROM @routing;
        IF @urgency NOT IN (N'high', N'critical') SET @urgency = N'high';
        EXEC dbo.usp_Assistant_InsertCase @id, @reference, @userId, N'alert', @title, @description, @urgency, @lang, @conversationId;
        UPDATE dbo.cases SET service_unit_id = @unit, assigned_to = @owner,
            assigned_at = CASE WHEN @owner IS NOT NULL THEN SYSDATETIMEOFFSET() END,
            status = CASE WHEN @owner IS NOT NULL THEN N'assigned' WHEN @unit IS NOT NULL THEN N'routed' ELSE N'submitted' END,
            assignment_method = CASE WHEN @owner IS NOT NULL THEN N'primary_owner' ELSE N'unit_queue' END,
            current_responsible_actor = CASE WHEN @unit IS NOT NULL THEN N'service_owner' ELSE N'human' END,
            routing_topic = @code, routing_service_code = CASE @code
                WHEN N'campus_maintenance' THEN N'housing' WHEN N'campus_security' THEN N'security'
                WHEN N'campus_fire' THEN N'safety_emergency' ELSE N'general' END
        WHERE id = @id AND student_id = @userId;
        COMMIT TRANSACTION;
        SELECT @unit AS UnitId, @owner AS OwnerId, @unitEn AS UnitEn, @unitAr AS UnitAr;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
