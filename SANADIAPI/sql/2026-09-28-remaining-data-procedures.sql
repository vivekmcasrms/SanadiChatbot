-- Apply before deploying the API. Moves remaining application SQL into database routines.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_AppointmentChat_UnitLocation
  @unitCode nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT office_location_en AS En, office_location_ar AS Ar FROM dbo.service_units WHERE code = @unitCode;
END;
GO

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

-- Query values arrive as typed JSON, never executable SQL from the API.
CREATE OR ALTER FUNCTION dbo.ufn_Data_Value(@value nvarchar(max), @type int)
RETURNS nvarchar(max)
AS
BEGIN
  RETURN CASE
    WHEN @type = 0 OR @value IS NULL THEN N'NULL'
    WHEN @type = 2 THEN @value
    WHEN @type = 3 THEN CASE WHEN @value = N'true' THEN N'1' ELSE N'0' END
    ELSE N'N''' + REPLACE(@value, N'''', N'''''') + N'''' END;
END;
GO

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

CREATE OR ALTER PROCEDURE dbo.usp_Data_Select
  @schemaName sysname, @tableName sysname, @columns nvarchar(max) = N'["*"]',
  @filters nvarchar(max) = N'[]', @scope nvarchar(max) = N'{"Mode":"none"}', @userId uniqueidentifier = NULL,
  @order nvarchar(max) = N'[]', @limit int = NULL, @offset int = NULL, @countOnly bit = 0
AS
BEGIN
  SET NOCOUNT ON;
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

CREATE OR ALTER PROCEDURE dbo.usp_Data_Write
  @schemaName sysname, @tableName sysname, @operation nvarchar(30), @values nvarchar(max) = N'[]',
  @columns nvarchar(max) = N'["*"]', @filters nvarchar(max) = N'[]',
  @scope nvarchar(max) = N'{"Mode":"none"}', @userId uniqueidentifier = NULL, @returnRows bit = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @select nvarchar(max), @where nvarchar(max), @sql nvarchar(max), @sets nvarchar(max),
          @names nvarchar(max), @literals nvarchar(max),
          @target nvarchar(520) = QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName);
  EXEC dbo.usp_Data_Columns @schemaName, @tableName, @columns, @select OUTPUT;
  EXEC dbo.usp_Data_BuildWhere @schemaName, @tableName, @filters, @scope, @where OUTPUT;
  IF @operation = N'delete'
    SET @sql = N'DELETE FROM ' + @target
      + CASE WHEN @returnRows = 1 THEN N' OUTPUT DELETED.' + REPLACE(@select, N', ', N', DELETED.') ELSE N'' END + @where;
  ELSE
  BEGIN
    IF EXISTS (SELECT 1 FROM OPENJSON(@values) j WHERE NOT EXISTS
      (SELECT 1 FROM sys.columns c WHERE c.object_id = OBJECT_ID(@target) AND c.name = JSON_VALUE(j.[value], '$.Column')))
      THROW 50001, 'Invalid mutation column.', 1;
    DECLARE @fields TABLE (ordinal int, name nvarchar(258), literal nvarchar(max));
    INSERT @fields
      SELECT CONVERT(int, j.[key]), QUOTENAME(JSON_VALUE(j.[value], '$.Column')), dbo.ufn_Data_Value(v.[value], v.[type])
      FROM OPENJSON(@values) j CROSS APPLY OPENJSON(j.[value]) v WHERE v.[key] = N'Value';
    SELECT @names = STRING_AGG(CONVERT(nvarchar(max), name), N', ') WITHIN GROUP (ORDER BY ordinal) FROM @fields;
    SELECT @literals = STRING_AGG(literal, N', ') WITHIN GROUP (ORDER BY ordinal) FROM @fields;
    SELECT @sets = STRING_AGG(CONVERT(nvarchar(max), name) + N' = ' + literal, N', ') WITHIN GROUP (ORDER BY ordinal) FROM @fields;
    IF @sets IS NULL THROW 50001, 'Empty mutation payload.', 1;
    IF @operation = N'insert'
      SET @sql = N'INSERT INTO ' + @target + N' (' + @names + N') OUTPUT INSERTED.* VALUES (' + @literals + N')';
    ELSE IF @operation = N'updateExisting'
      SET @sql = N'UPDATE ' + @target + N' SET ' + @sets + N' OUTPUT INSERTED.*' + @where;
    ELSE IF @operation = N'update'
      SET @sql = N'UPDATE ' + @target + N' SET ' + @sets + @where
        + CASE WHEN @returnRows = 1 THEN N'; SELECT ' + @select + N' FROM ' + @target + @where ELSE N'' END;
    ELSE THROW 50001, 'Invalid data mutation operation.', 1;
  END;
  EXEC sys.sp_executesql @sql, N'@rlsUser uniqueidentifier', @userId;
END;
GO
