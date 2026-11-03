SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

-- Campuses from SANADIAPI/sql/sanadi_schema.sql backup (idempotent MERGE)
MERGE dbo.campuses AS t
USING (VALUES
  (CONVERT(uniqueidentifier,'49c96405-977f-4263-aa38-7d95ee9fb08b'), CONVERT(uniqueidentifier,'3341f8c7-e8c3-4e2e-b97f-f1907a07a872'), N'Al Maqam Campus', N'حرم المقام', N'Al Ain, Abu Dhabi', N'العين، أبوظبي', CAST(1 AS bit)),
  (CONVERT(uniqueidentifier,'52140276-220a-4ab6-a7b3-9dbbe56529a7'), CONVERT(uniqueidentifier,'3341f8c7-e8c3-4e2e-b97f-f1907a07a872'), N'Al Jimi Campus', N'حرم الجيمي', N'Al Ain, Abu Dhabi', N'العين، أبوظبي', CAST(1 AS bit))
) AS s(id, university_id, name_en, name_ar, location_en, location_ar, is_active)
ON t.id = s.id
WHEN MATCHED THEN UPDATE SET
  t.university_id = s.university_id,
  t.name_en = s.name_en,
  t.name_ar = s.name_ar,
  t.location_en = s.location_en,
  t.location_ar = s.location_ar,
  t.is_active = s.is_active,
  t.updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (id, university_id, name_en, name_ar, location_en, location_ar, is_active, created_at, updated_at)
VALUES (s.id, s.university_id, s.name_en, s.name_ar, s.location_en, s.location_ar, s.is_active, SYSUTCDATETIME(), SYSUTCDATETIME());

COMMIT;

SELECT COUNT(*) AS campuses FROM dbo.campuses;
SELECT COUNT(*) AS active_service_units FROM dbo.service_units WHERE is_active = 1;
SELECT name_en, name_ar FROM dbo.campuses ORDER BY name_en;
