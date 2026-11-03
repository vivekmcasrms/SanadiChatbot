/* 2026-10-27: Automatically assign NEW tickets to an eligible unit owner/staff member.
   Deploy before the matching API build. Rerunnable; no historical tickets,
   staff mappings, permissions, notification settings or credentials are changed.
   An unstaffed routed unit falls back to the existing central support desk.
   Busy support staff remain eligible to own a ticket pending follow-up.
   Only when no staff can be selected, submit successfully to the responsible
   unit queue for its owner to assign manually. Never invent an assignee.
   Error 51027 is translated to HTTP 409/ticket_assignee_unavailable by the API.
*/
CREATE OR ALTER FUNCTION dbo.ufn_TicketAssignmentCandidates
(
    @unit uniqueidentifier, @requester uniqueidentifier, @sensitive bit,
    @preferredOwner uniqueidentifier
)
RETURNS TABLE
AS RETURN
(
    SELECT sp.user_id AS Owner,
        CONVERT(nvarchar(50),CASE WHEN u.primary_service_owner_id=sp.user_id THEN N'primary_owner'
            WHEN EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.service_unit_id=u.id
                AND o.staff_profile_id=sp.user_id AND o.is_active=1
                AND o.started_at<=SYSDATETIMEOFFSET() AND (o.ended_at IS NULL OR o.ended_at>SYSDATETIMEOFFSET())) THEN N'unit_owner'
            ELSE N'workload' END) AS Method,
        CASE WHEN u.primary_service_owner_id=sp.user_id THEN 0
            WHEN EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.service_unit_id=u.id
                AND o.staff_profile_id=sp.user_id AND o.is_active=1
                AND o.started_at<=SYSDATETIMEOFFSET() AND (o.ended_at IS NULL OR o.ended_at>SYSDATETIMEOFFSET())) THEN 1 ELSE 2 END AS Rank,
        (SELECT COUNT_BIG(*) FROM dbo.cases c WHERE c.assigned_to=sp.user_id AND c.deleted_at IS NULL
            AND c.status NOT IN(N'closed',N'resolved',N'withdrawn',N'rejected',N'duplicate'))
        + (SELECT COUNT_BIG(*) FROM dbo.suggestions s WHERE s.assigned_staff_id=sp.user_id AND s.deleted_at IS NULL
            AND s.status NOT IN(N'closed',N'implemented',N'not_proceeding')) AS Workload,
        sp.last_assigned_at AS LastAssignedAt
    FROM dbo.service_units u
    JOIN dbo.staff_profiles sp ON sp.is_active=1
    JOIN auth.users a ON a.id=sp.user_id
    JOIN dbo.profiles p ON p.id=sp.user_id AND p.deleted_at IS NULL AND p.access_revoked_at IS NULL
    WHERE u.id=@unit AND u.is_active=1
      AND (@requester IS NULL OR sp.user_id<>@requester)
      AND (@preferredOwner IS NULL OR sp.user_id=@preferredOwner)
      -- A selected appointment officer can be busy now; automatic picks must be available.
      AND (@preferredOwner IS NOT NULL OR COALESCE(sp.availability_status,N'available')=N'available')
      AND (u.primary_service_owner_id=sp.user_id
        OR EXISTS(SELECT 1 FROM dbo.service_unit_owners o WHERE o.service_unit_id=u.id
            AND o.staff_profile_id=sp.user_id AND o.is_active=1
            AND o.started_at<=SYSDATETIMEOFFSET() AND (o.ended_at IS NULL OR o.ended_at>SYSDATETIMEOFFSET()))
        OR EXISTS(SELECT 1 FROM dbo.service_staff ss WHERE ss.service_unit_id=u.id
            AND ss.staff_profile_id=sp.user_id AND ss.is_active=1 AND ss.can_receive_cases=1)
        OR (sp.service_unit_id=u.id AND NOT EXISTS(SELECT 1 FROM dbo.service_staff ss
            WHERE ss.service_unit_id=u.id AND ss.staff_profile_id=sp.user_id)))
      AND NOT EXISTS(SELECT 1 FROM dbo.service_staff ss WHERE ss.service_unit_id=u.id
            AND ss.staff_profile_id=sp.user_id AND (ss.is_active=0 OR ss.can_receive_cases=0))
      AND (@sensitive=0 OR EXISTS(SELECT 1 FROM dbo.service_staff ss WHERE ss.service_unit_id=u.id
            AND ss.staff_profile_id=sp.user_id AND ss.is_active=1 AND ss.can_view_sensitive_cases=1)
        OR EXISTS(SELECT 1 FROM dbo.user_roles r WHERE r.user_id=sp.user_id AND r.role IN(N'service_manager',N'system_admin')))
);
GO
-- Reuse the service-desk codes already used by the existing assignment flow.
-- Staff IDs and unit IDs always come from current database records.
CREATE OR ALTER FUNCTION dbo.ufn_TicketAssignment
(
    @unit uniqueidentifier,@requester uniqueidentifier,@sensitive bit,@preferredOwner uniqueidentifier
)
RETURNS TABLE
AS RETURN
(
    SELECT TOP(1) p.UnitId,p.En,p.Ar,p.Owner,p.Method
    FROM (
        SELECT u.id AS UnitId,u.name_en AS En,u.name_ar AS Ar,c.Owner,c.Method,
            0 AS RouteRank,0 AS DeskRank,c.Rank,c.Workload,c.LastAssignedAt
        FROM dbo.service_units u CROSS APPLY dbo.ufn_TicketAssignmentCandidates(u.id,@requester,@sensitive,@preferredOwner) c
        WHERE u.id=@unit
        UNION ALL
        SELECT u.id,u.name_en,u.name_ar,c.Owner,CONVERT(nvarchar(50),N'SERVICE_DESK_FALLBACK'),
            1,CASE u.code WHEN N'SERVICE_DESK' THEN 0 WHEN N'SD' THEN 1 ELSE 2 END,c.Rank,c.Workload,c.LastAssignedAt
        FROM dbo.service_units u CROSS APPLY dbo.ufn_TicketAssignmentCandidates(u.id,@requester,@sensitive,NULL) c
        WHERE u.code IN(N'SERVICE_DESK',N'SD',N'HD') AND @preferredOwner IS NULL
        UNION ALL
        -- Availability is a scheduling state, not a reason to reject a student's
        -- ticket: when all support officers are busy, select an active one.
        -- Disabled/revoked accounts, receiving permissions and sensitive-case
        -- clearance are still checked by the same candidate function.
        SELECT u.id,u.name_en,u.name_ar,c.Owner,CONVERT(nvarchar(50),N'SERVICE_DESK_FALLBACK'),
            2,CASE u.code WHEN N'SERVICE_DESK' THEN 0 WHEN N'SD' THEN 1 ELSE 2 END,c.Rank,c.Workload,c.LastAssignedAt
        FROM dbo.service_units u CROSS JOIN dbo.staff_profiles sp
        CROSS APPLY dbo.ufn_TicketAssignmentCandidates(u.id,@requester,@sensitive,sp.user_id) c
        WHERE u.code IN(N'SERVICE_DESK',N'SD',N'HD') AND @preferredOwner IS NULL
        UNION ALL
        SELECT u.id,u.name_en,u.name_ar,CONVERT(uniqueidentifier,NULL),CONVERT(nvarchar(50),N'unit_queue'),
            3,CASE WHEN u.id=@unit THEN 0 WHEN u.code=N'SERVICE_DESK' THEN 1 WHEN u.code=N'SD' THEN 2 ELSE 3 END,
            0,CONVERT(bigint,0),CONVERT(datetimeoffset,NULL)
        FROM dbo.service_units u WHERE u.is_active=1 AND @preferredOwner IS NULL
            AND (u.id=@unit OR u.code IN(N'SERVICE_DESK',N'SD',N'HD'))
    ) p
    ORDER BY p.RouteRank,p.DeskRank,p.Rank,p.Workload,p.LastAssignedAt,p.Owner
);
GO
CREATE OR ALTER PROCEDURE dbo.usp_Tickets_GetAssignment
    @unit uniqueidentifier, @requester uniqueidentifier, @sensitive bit=0,
    @preferredOwner uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UnitId,En,Ar,Owner,Method FROM dbo.ufn_TicketAssignment(@unit,@requester,@sensitive,@preferredOwner);
END;
GO
-- Shared transactional validation for SQL callers as well as API preflight.
CREATE OR ALTER PROCEDURE dbo.usp_Tickets_RequireAssignment
    @unit uniqueidentifier OUTPUT, @requester uniqueidentifier, @sensitive bit=0,
    @owner uniqueidentifier OUTPUT, @method nvarchar(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @requested uniqueidentifier=@owner,@desk bit=CASE WHEN @method=N'SERVICE_DESK_FALLBACK'
        AND EXISTS(SELECT 1 FROM dbo.service_units WHERE id=@unit AND code IN(N'SERVICE_DESK',N'SD',N'HD')) THEN 1 ELSE 0 END;
    DECLARE @resolved bit=0;
    SET @owner=NULL;
    SELECT @resolved=1,@unit=UnitId,@owner=Owner,@method=CASE WHEN @desk=1 AND Owner IS NOT NULL THEN N'SERVICE_DESK_FALLBACK' ELSE Method END
    FROM dbo.ufn_TicketAssignment(@unit,@requester,@sensitive,@requested);
    IF @resolved=0 THROW 51027, 'A valid responsible service unit or selected staff member could not be found.', 1;
END;
GO
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
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_InsertSuggestion
    @id uniqueidentifier,@reference nvarchar(100),@userId uniqueidentifier,@title nvarchar(500),
    @description nvarchar(max),@lang nvarchar(10),@conversationId uniqueidentifier=NULL,@unit uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.usp_Interactions_InsertSuggestion @id=@id,@user=@userId,@reference=@reference,
        @title=@title,@description=@description,@unit=@unit,@anon=0,@lang=@lang,@conversation=@conversationId,
        @service=N'',@reasonEn=N'',@reasonAr=N'',@confidence=0,@channel=N'chat';
END;
GO
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
-- INSERT-only guards: do not backfill or block unrelated edits to legacy tickets.
-- Validate every row in a bulk insert; one invalid row rejects the whole statement.
CREATE OR ALTER TRIGGER dbo.trg_Cases_RequireAssignment ON dbo.cases AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS(SELECT 1 FROM inserted i WHERE NOT EXISTS(SELECT 1 FROM dbo.service_units u WHERE u.id=i.service_unit_id AND u.is_active=1)
        OR (i.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates(i.service_unit_id,i.student_id,i.is_sensitive,i.assigned_to)))
        OR (i.assigned_to IS NULL AND (COALESCE(i.assignment_method,N'')<>N'unit_queue' OR i.needs_assignment_attention<>1
            OR NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignment(i.service_unit_id,i.student_id,i.is_sensitive,NULL) r WHERE r.Owner IS NULL))))
        THROW 51027, 'A ticket requires a valid staff assignment or the responsible unit queue fallback.', 1;
END;
GO
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
-- Existing owner/staff Assign action also clears the queue-fallback marker.
CREATE OR ALTER PROCEDURE dbo.usp_CaseOps_Assign
    @id uniqueidentifier,@target uniqueidentifier,@unit uniqueidentifier=NULL,@actor uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        INSERT dbo.case_assignments(case_id,assigned_to,service_unit_id,assigned_by) VALUES(@id,@target,@unit,@actor);
        UPDATE dbo.cases SET assigned_to=@target,status=N'assigned',last_activity_at=SYSDATETIMEOFFSET(),
            next_action_en=N'Assigned officer to acknowledge',needs_assignment_attention=0,
            assigned_at=COALESCE(assigned_at,SYSDATETIMEOFFSET()),
            assignment_method=CASE WHEN assignment_method=N'unit_queue' THEN N'manual' ELSE assignment_method END
        WHERE id=@id;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
-- Preserve the generic data API's contract. Only ticket INSERTs gain assignment
-- resolution and OUTPUT INTO (required on a table with an INSERT trigger).
-- Other tables and all existing update/delete/filter behavior are unchanged.
CREATE OR ALTER PROCEDURE dbo.usp_Data_Write
    @schemaName sysname,@tableName sysname,@operation nvarchar(30),@values nvarchar(max)=N'[]',
    @columns nvarchar(max)=N'["*"]',@filters nvarchar(max)=N'[]',
    @scope nvarchar(max)=N'{"Mode":"none"}',@userId uniqueidentifier=NULL,@returnRows bit=0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @select nvarchar(max),@where nvarchar(max),@sql nvarchar(max),@sets nvarchar(max),
        @names nvarchar(max),@literals nvarchar(max),
        @target nvarchar(520)=QUOTENAME(@schemaName)+N'.'+QUOTENAME(@tableName);
    EXEC dbo.usp_Data_Columns @schemaName,@tableName,@columns,@select OUTPUT;
    EXEC dbo.usp_Data_BuildWhere @schemaName,@tableName,@filters,@scope,@where OUTPUT;
    IF @operation=N'delete'
        SET @sql=N'DELETE FROM '+@target
            +CASE WHEN @returnRows=1 THEN N' OUTPUT DELETED.'+REPLACE(@select,N', ',N', DELETED.') ELSE N'' END+@where;
    ELSE
    BEGIN
        IF EXISTS(SELECT 1 FROM OPENJSON(@values) j WHERE NOT EXISTS
            (SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(@target) AND c.name=JSON_VALUE(j.[value],'$.Column')))
            THROW 50001, 'Invalid mutation column.', 1;
        DECLARE @fields TABLE(ordinal int,name nvarchar(258),literal nvarchar(max));
        INSERT @fields SELECT CONVERT(int,j.[key]),QUOTENAME(JSON_VALUE(j.[value],'$.Column')),dbo.ufn_Data_Value(v.[value],v.[type])
            FROM OPENJSON(@values) j CROSS APPLY OPENJSON(j.[value]) v WHERE v.[key]=N'Value';
        DECLARE @ticket bit=CASE WHEN @schemaName=N'dbo' AND @tableName IN(N'cases',N'suggestions') AND @operation=N'insert' THEN 1 ELSE 0 END;
        IF @ticket=1
        BEGIN
            DECLARE @unit uniqueidentifier,@requester uniqueidentifier,@owner uniqueidentifier,@method nvarchar(50),@sensitive bit=0,
                @ownerColumn sysname=CASE WHEN @tableName=N'cases' THEN N'assigned_to' ELSE N'assigned_staff_id' END;
            SELECT @unit=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.[value],'$.Value')) FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=N'service_unit_id';
            SELECT @requester=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.[value],'$.Value')) FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=N'student_id';
            SELECT @owner=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.[value],'$.Value')) FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=@ownerColumn;
            SELECT @sensitive=CASE WHEN JSON_VALUE(j.[value],'$.Value') IN(N'true',N'1') THEN 1 ELSE 0 END FROM OPENJSON(@values) j WHERE JSON_VALUE(j.[value],'$.Column')=N'is_sensitive';
            EXEC dbo.usp_Tickets_RequireAssignment @unit OUTPUT,@requester,@sensitive,@owner OUTPUT,@method OUTPUT;
            DELETE FROM @fields WHERE name=N'[service_unit_id]';
            INSERT @fields VALUES(99999,N'[service_unit_id]',dbo.ufn_Data_Value(CONVERT(nvarchar(36),@unit),1));
            DELETE FROM @fields WHERE name=QUOTENAME(@ownerColumn);
            INSERT @fields VALUES(100000,QUOTENAME(@ownerColumn),dbo.ufn_Data_Value(CONVERT(nvarchar(36),@owner),1));
            DECLARE @initialStatus nvarchar(50)=CASE WHEN @owner IS NOT NULL THEN N'assigned' WHEN @tableName=N'cases' THEN N'routed' ELSE N'submitted' END;
            IF NOT EXISTS(SELECT 1 FROM @fields WHERE name=N'[status]') INSERT @fields VALUES(100001,N'[status]',dbo.ufn_Data_Value(@initialStatus,1));
            UPDATE @fields SET literal=dbo.ufn_Data_Value(@initialStatus,1) WHERE name=N'[status]' AND literal IN(N'N''submitted''',N'N''routed''',N'N''classified''',N'N''assigned''');
            IF @tableName=N'cases'
            BEGIN
                DELETE FROM @fields WHERE name IN(N'[assigned_at]',N'[assignment_method]',N'[needs_assignment_attention]');
                INSERT @fields VALUES(100002,N'[assigned_at]',CASE WHEN @owner IS NOT NULL THEN N'SYSDATETIMEOFFSET()' ELSE N'NULL' END),
                    (100003,N'[assignment_method]',dbo.ufn_Data_Value(@method,1)),(100004,N'[needs_assignment_attention]',CASE WHEN @owner IS NULL THEN N'1' ELSE N'0' END);
                IF @owner IS NULL
                BEGIN
                    DELETE FROM @fields WHERE name IN(N'[current_responsible_actor]',N'[human_review_required]');
                    INSERT @fields VALUES(100005,N'[current_responsible_actor]',N'N''service_owner'''),(100006,N'[human_review_required]',N'1');
                END;
            END;
        END;
        SELECT @names=STRING_AGG(CONVERT(nvarchar(max),name),N', ') WITHIN GROUP(ORDER BY ordinal) FROM @fields;
        SELECT @literals=STRING_AGG(literal,N', ') WITHIN GROUP(ORDER BY ordinal) FROM @fields;
        SELECT @sets=STRING_AGG(CONVERT(nvarchar(max),name)+N' = '+literal,N', ') WITHIN GROUP(ORDER BY ordinal) FROM @fields;
        IF @sets IS NULL THROW 50001, 'Empty mutation payload.', 1;
        IF @operation=N'insert' AND @ticket=1
            SET @sql=N'BEGIN TRY BEGIN TRANSACTION; SELECT TOP(0) * INTO #newTicket FROM '+@target+N'; INSERT INTO '+@target
                +N' ('+@names+N') OUTPUT INSERTED.* INTO #newTicket VALUES ('+@literals+N'); '
                +N'UPDATE dbo.staff_profiles SET last_assigned_at=SYSDATETIMEOFFSET() WHERE user_id=@ticketOwner; COMMIT; '
                +N'SELECT * FROM #newTicket; END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;';
        ELSE IF @operation=N'insert'
            SET @sql=N'INSERT INTO '+@target+N' ('+@names+N') OUTPUT INSERTED.* VALUES ('+@literals+N')';
        ELSE IF @operation=N'updateExisting'
            SET @sql=N'UPDATE '+@target+N' SET '+@sets+N' OUTPUT INSERTED.*'+@where;
        ELSE IF @operation=N'update'
            SET @sql=N'UPDATE '+@target+N' SET '+@sets+@where+CASE WHEN @returnRows=1 THEN N'; SELECT '+@select+N' FROM '+@target+@where ELSE N'' END;
        ELSE THROW 50001, 'Invalid data mutation operation.', 1;
    END;
    EXEC sys.sp_executesql @sql,N'@rlsUser uniqueidentifier,@ticketOwner uniqueidentifier',@userId,@owner;
END;
GO
