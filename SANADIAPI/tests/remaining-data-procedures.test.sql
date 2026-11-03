-- Executed by Test-DataProcedures.ps1 in a unique tempdb schema and rolled back.
CREATE TABLE __SCHEMA__.entries (
  id int PRIMARY KEY, user_id uniqueidentifier, label nvarchar(max), amount decimal(18,3), enabled bit, tag nvarchar(50)
);
CREATE TABLE __SCHEMA__.children (id int PRIMARY KEY, entry_id int, label nvarchar(100));
CREATE TABLE __SCHEMA__.service_units (id uniqueidentifier, code nvarchar(100), name_en nvarchar(100), name_ar nvarchar(100), office_location_en nvarchar(100), office_location_ar nvarchar(100), primary_service_owner_id uniqueidentifier);
CREATE TABLE __SCHEMA__.staff_profiles (service_unit_id uniqueidentifier, user_id uniqueidentifier);
CREATE TABLE __SCHEMA__.service_unit_owners (service_unit_id uniqueidentifier, staff_profile_id uniqueidentifier, is_active bit);
CREATE TABLE __SCHEMA__.profiles (id uniqueidentifier, full_name nvarchar(100));
CREATE TABLE __SCHEMA__.appointment_types (id uniqueidentifier, service_unit_id uniqueidentifier, name_en nvarchar(100), name_ar nvarchar(100));
CREATE TABLE __SCHEMA__.appointment_slots (id uniqueidentifier, appointment_type_id uniqueidentifier, staff_profile_id uniqueidentifier, location nvarchar(100));
CREATE TABLE __SCHEMA__.student_appointments (appointment_slot_id uniqueidentifier, status nvarchar(30), created_at datetimeoffset);
CREATE TABLE __SCHEMA__.cases (id uniqueidentifier, student_id uniqueidentifier, assigned_to uniqueidentifier, service_unit_id uniqueidentifier, meeting_at datetimeoffset, meeting_mode nvarchar(30), meeting_location nvarchar(max), status nvarchar(30), last_activity_at datetimeoffset);
CREATE TABLE __SCHEMA__.case_notes (id int, case_id uniqueidentifier);
GO

DECLARE @user uniqueidentifier = '11111111-1111-1111-1111-111111111111', @other uniqueidentifier = '22222222-2222-2222-2222-222222222222';
INSERT __SCHEMA__.entries VALUES (1,@user,N'Alpha',1.25,1,NULL),(2,@user,N'Beta',2.5,0,N'x'),(3,@other,N'Gamma',3.75,1,N'x');
INSERT __SCHEMA__.children VALUES (1,2,N'match');
DECLARE @rows TABLE (id int);
DECLARE @count TABLE (n int);

INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__', 'entries', '["id"]',
  @filters = N'[{"Column":"amount","Operator":"gte","Value":1.25},{"Column":"label","Operator":"eq","Value":"Alpha","Group":1},{"Column":"label","Operator":"eq","Value":"Beta","Group":1}]',
  @scope = N'{"Mode":"owner","Columns":["user_id"]}', @userId = @user, @order = '[{"Column":"id","Descending":true}]', @limit = 1;
IF (SELECT COUNT(*) FROM @rows) <> 1 OR (SELECT TOP 1 id FROM @rows) <> 2 THROW 51000, 'Grouped filters, owner scope, sort or limit changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @order='[{"Column":"id"}]', @offset=1, @limit=1;
IF (SELECT TOP 1 id FROM @rows) <> 2 THROW 51000, 'Offset pagination changed.', 1;
INSERT @count EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries', @limit=1, @offset=1, @countOnly=1;
IF (SELECT n FROM @count) <> 3 THROW 51000, 'Exact count must ignore pagination.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"id","Operator":"in","Value":[]}]';
IF EXISTS (SELECT 1 FROM @rows) THROW 51000, 'Empty IN must match no rows.', 1;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"id","Operator":"in","Value":[],"Negated":true}]';
IF (SELECT COUNT(*) FROM @rows) <> 3 THROW 51000, 'Empty NOT IN changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"id","Operator":"in","Value":[1,3],"Negated":true}]';
IF (SELECT COUNT(*) FROM @rows) <> 1 OR (SELECT TOP 1 id FROM @rows) <> 2 THROW 51000, 'NOT IN changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"tag","Operator":"isnull","Value":null}]';
IF (SELECT TOP 1 id FROM @rows) <> 1 THROW 51000, 'Null predicate changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"enabled","Operator":"eq","Value":false},{"Column":"tag","Operator":"isnull","Negated":true,"Value":null}]';
IF (SELECT TOP 1 id FROM @rows) <> 2 THROW 51000, 'Boolean or not-null predicate changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"label","Operator":"ilike","Value":"%pha"}]';
IF (SELECT TOP 1 id FROM @rows) <> 1 THROW 51000, 'LIKE predicate changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters='[{"Column":"label","Operator":"eq","Value":"match","Relation":"children","ForeignColumn":"entry_id","LocalColumn":"id"}]';
IF (SELECT TOP 1 id FROM @rows) <> 2 THROW 51000, 'Related-table predicate changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @scope='{"Mode":"deny"}';
IF EXISTS (SELECT 1 FROM @rows) THROW 51000, 'Denied scope returned rows.', 1;

DECLARE @full TABLE (id int, user_id uniqueidentifier, label nvarchar(max), amount decimal(18,3), enabled bit, tag nvarchar(50));
INSERT @full EXEC __SCHEMA__.usp_Data_Write '__SCHEMA__','entries','insert',
  @values=N'[{"Column":"id","Value":4},{"Column":"label","Value":"O''Brien; DROP TABLE entries; -- سندي @f1"},{"Column":"amount","Value":4.125},{"Column":"enabled","Value":true},{"Column":"tag","Value":null}]';
IF (SELECT label FROM @full) <> N'O''Brien; DROP TABLE entries; -- سندي @f1' OR (SELECT amount FROM @full) <> 4.125 THROW 51000, 'Insert value round-trip changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','entries','["id"]', @filters=N'[{"Column":"label","Operator":"eq","Value":"O''Brien; DROP TABLE entries; -- سندي @f1"}]';
IF (SELECT TOP 1 id FROM @rows) <> 4 THROW 51000, 'Quoted filter value changed.', 1;
DELETE @full;
INSERT @full EXEC __SCHEMA__.usp_Data_Write '__SCHEMA__','entries','updateExisting', @values='[{"Column":"label","Value":"updated"}]', @filters='[{"Column":"id","Operator":"eq","Value":4}]';
IF (SELECT label FROM @full) <> N'updated' THROW 51000, 'Upsert update output changed.', 1;
EXEC __SCHEMA__.usp_Data_Write '__SCHEMA__','entries','update', @values='[{"Column":"amount","Value":10}]', @scope='{"Mode":"owner","Columns":["user_id"]}', @userId=@user;
IF EXISTS (SELECT 1 FROM __SCHEMA__.entries WHERE user_id=@other AND amount<>3.75) THROW 51000, 'Update crossed ownership boundary.', 1;
IF (SELECT COUNT(*) FROM __SCHEMA__.entries WHERE user_id=@user AND amount=10) <> 2 THROW 51000, 'Owner update changed.', 1;
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Write '__SCHEMA__','entries','delete', @columns='["id"]', @filters='[{"Column":"id","Operator":"eq","Value":4}]', @returnRows=1;
IF (SELECT TOP 1 id FROM @rows) <> 4 OR EXISTS (SELECT 1 FROM __SCHEMA__.entries WHERE id=4) THROW 51000, 'Delete representation changed.', 1;

DECLARE @unit uniqueidentifier=NEWID(), @type uniqueidentifier=NEWID(), @slot uniqueidentifier=NEWID(), @case uniqueidentifier=NEWID(), @unrelated uniqueidentifier=NEWID();
INSERT __SCHEMA__.service_units VALUES (@unit,N'advising',N'Advising',N'إرشاد',N'Room 1',N'غرفة 1',@user);
INSERT __SCHEMA__.profiles VALUES (@user,N'Advisor');
INSERT __SCHEMA__.appointment_types VALUES (@type,@unit,N'Advice',N'إرشاد');
INSERT __SCHEMA__.appointment_slots VALUES (@slot,@type,@user,NULL);
INSERT __SCHEMA__.student_appointments VALUES (@slot,N'booked',SYSDATETIMEOFFSET());
INSERT __SCHEMA__.cases (id,student_id,service_unit_id,status) VALUES (@case,@other,@unit,N'open'),(@unrelated,@other,NULL,N'open');
DECLARE @location TABLE (En nvarchar(100), Ar nvarchar(100));
DECLARE @advisor TABLE (id uniqueidentifier);
INSERT @location EXEC __SCHEMA__.usp_AppointmentChat_UnitLocation N'advising';
IF (SELECT En FROM @location) <> N'Room 1' THROW 51000, 'Unit location query changed.', 1;
INSERT @advisor EXEC __SCHEMA__.usp_AppointmentChat_LastAdvisor N'advising';
IF (SELECT id FROM @advisor) <> @user THROW 51000, 'Advisor rotation query changed.', 1;
DECLARE @meta TABLE (TypeEn nvarchar(100), TypeAr nvarchar(100), UnitId uniqueidentifier, UnitEn nvarchar(100), UnitAr nvarchar(100), LocEn nvarchar(100), LocAr nvarchar(100), StaffId uniqueidentifier, StaffName nvarchar(100));
INSERT @meta EXEC __SCHEMA__.usp_Assistant_AppointmentMetadata @slot;
IF (SELECT LocEn FROM @meta) <> N'Room 1' OR (SELECT StaffId FROM @meta) <> @user THROW 51000, 'Appointment metadata changed.', 1;
DECLARE @start datetimeoffset = '2026-10-01T10:00:00+00:00';
EXEC __SCHEMA__.usp_Assistant_UpdateAppointmentCase @case,@unit,@user,@start,N'Room 2';
IF NOT EXISTS (SELECT 1 FROM __SCHEMA__.cases WHERE id=@case AND assigned_to=@user AND meeting_at=@start AND status=N'assigned' AND meeting_location=N'Room 2') THROW 51000, 'Appointment case update changed.', 1;
DECLARE @cases TABLE (id uniqueidentifier);
INSERT @cases EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','cases','["id"]', @scope='{"Mode":"staffCases"}', @userId=@user;
IF (SELECT COUNT(*) FROM @cases) <> 1 OR (SELECT TOP 1 id FROM @cases) <> @case THROW 51000, 'Staff case scope changed.', 1;
INSERT __SCHEMA__.case_notes VALUES (1,@case),(2,@unrelated);
DELETE @rows;
INSERT @rows EXEC __SCHEMA__.usp_Data_Select '__SCHEMA__','case_notes','["id"]', @scope='{"Mode":"caseRelated"}', @userId=@user;
IF (SELECT COUNT(*) FROM @rows) <> 1 OR (SELECT TOP 1 id FROM @rows) <> 1 THROW 51000, 'Related-case access scope changed.', 1;
PRINT 'PASS: filters, counts, pagination, Unicode/quoted values, CRUD, ownership, case access and appointment procedures.';
GO
