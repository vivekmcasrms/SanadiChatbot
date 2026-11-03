-- Routing data only: no service names, unit codes or keyword-to-unit mappings in SQL.
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_GetRoutingCatalog
AS
BEGIN
    SET NOCOUNT ON;
    SELECT id AS Id, code AS Code, name_en AS NameEn, name_ar AS NameAr,
        description_en AS DescriptionEn, description_ar AS DescriptionAr
    FROM dbo.service_units WHERE is_active = 1 ORDER BY code;
    SELECT id, code, name_en, name_ar, default_unit_id, case_type
    FROM dbo.case_categories WHERE is_active = 1;
    SELECT rule_name, priority, conditions, target_unit_id, requires_human_review
    FROM dbo.routing_rules WHERE is_active = 1 ORDER BY priority, id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Notify_CountUnread @userId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) FROM dbo.notification_events
    WHERE recipient_profile_id = @userId AND channel = N'in_app' AND read_at IS NULL;
END;
GO
