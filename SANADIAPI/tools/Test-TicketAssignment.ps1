param([string]$Instance = '(localdb)\MSSQLLocalDB')

# Synthetic, isolated SQL integration tests. Never reads application configuration.
$ErrorActionPreference = 'Stop'
if ($Instance -notmatch '^\(localdb\)\\[\w-]+$') { throw 'Only LocalDB is allowed.' }
$database = 'SanadiAssignmentTest_' + [Guid]::NewGuid().ToString('N')
$master = [System.Data.SqlClient.SqlConnection]::new("Server=$Instance;Database=master;Integrated Security=true;TrustServerCertificate=true")
$test = $null
$created = $false
$checks = 0
function Run-Sql([string]$sql) {
    $cmd = $test.CreateCommand()
    try { $cmd.CommandText = $sql; [void]$cmd.ExecuteNonQuery() } finally { $cmd.Dispose() }
}
function Check([string]$name, [string]$sql) {
    $cmd = $test.CreateCommand()
    try {
        $cmd.CommandText = $sql
        if ([int]$cmd.ExecuteScalar() -ne 1) { throw "FAILED: $name" }
        $script:checks++
        Write-Output "PASS: $name"
    } finally { $cmd.Dispose() }
}
function Rejected([string]$name, [string]$sql) {
    try { Run-Sql $sql; throw "FAILED: $name was accepted" }
    catch {
        $e = $_.Exception
        while ($e -and $e -isnot [System.Data.SqlClient.SqlException]) { $e = $e.InnerException }
        if (!$e -or $e.Number -ne 51027) { throw }
        $script:checks++
        Write-Output "PASS: $name"
    }
}
try {
    $master.Open()
    $cmd = $master.CreateCommand(); $cmd.CommandText = "CREATE DATABASE [$database]"; [void]$cmd.ExecuteNonQuery(); $cmd.Dispose()
    $created = $true
    $test = [System.Data.SqlClient.SqlConnection]::new("Server=$Instance;Database=$database;Integrated Security=true;TrustServerCertificate=true")
    $test.Open()
    Run-Sql "EXEC(N'CREATE SCHEMA auth');"
    # Use the real table definitions, but no application data, foreign databases or external services.
    $schema = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../sql/sanadi_schema.sql') -Raw
    foreach ($table in 'auth.users','dbo.profiles','dbo.service_units','dbo.staff_profiles','dbo.service_staff',
        'dbo.service_unit_owners','dbo.user_roles','dbo.cases','dbo.suggestions','dbo.case_status_history',
        'dbo.audit_logs','dbo.case_assignments','dbo.student_career_profiles','dbo.emergency_contacts','dbo.conversations') {
        $parts = $table.Split('.')
        $pattern = '(?s)CREATE TABLE \[' + [regex]::Escape($parts[0]) + '\]\.\[' + [regex]::Escape($parts[1]) + '\] \(.*?\r?\n\);'
        $definition = [regex]::Match($schema, $pattern).Value
        if (!$definition) { throw "Table fixture missing: $table" }
        Run-Sql $definition
    }
    foreach ($batch in [regex]::Split((Get-Content -LiteralPath (Join-Path $PSScriptRoot '../sql/2026-09-28-remaining-data-procedures.sql') -Raw),'(?im)^GO\s*\r?$')) {
        if ($batch -match 'CREATE OR ALTER (FUNCTION|PROCEDURE) dbo\.(ufn_Data_Value|ufn_Data_Filter|usp_Data_BuildWhere|usp_Data_Columns)\b') { Run-Sql $batch }
    }
    foreach ($batch in [regex]::Split((Get-Content -LiteralPath (Join-Path $PSScriptRoot '../sql/VS_2026-09-29-chat-incident-routing.sql') -Raw),'(?im)^GO\s*\r?$')) {
        if ($batch -match 'CREATE OR ALTER PROCEDURE dbo.usp_Assistant_ResolveIncidentUnit\b') { Run-Sql $batch }
    }
    # Fixed IDs below belong only to this temporary database.
    $unit = '10000000-0000-0000-0000-000000000001'
    $empty = '10000000-0000-0000-0000-000000000002'
    $student = '20000000-0000-0000-0000-000000000001'
    $primary = '30000000-0000-0000-0000-000000000001'
    $officer = '30000000-0000-0000-0000-000000000002'
    $other = '30000000-0000-0000-0000-000000000003'
    Run-Sql @"
INSERT auth.users(id,email) VALUES('$student','student@example.invalid'),('$primary','primary@example.invalid'),('$officer','officer@example.invalid'),('$other','other@example.invalid');
INSERT dbo.profiles(id,full_name) VALUES('$student','Test student'),('$primary','Test owner'),('$officer','Test officer'),('$other','Test other-unit officer');
INSERT dbo.service_units(id,code,name_en,name_ar,primary_service_owner_id) VALUES('$unit','TEST_UNIT','Test unit',N'وحدة اختبار','$primary'),('$empty','UNSTAFFED','Unstaffed',N'وحدة غير مهيأة',NULL);
INSERT dbo.staff_profiles(user_id,service_unit_id) VALUES('$primary','$unit'),('$officer','$unit'),('$other','$empty');
INSERT dbo.service_staff(staff_profile_id,service_unit_id,can_receive_cases) VALUES('$primary','$unit',1),('$officer','$unit',1),('$other','$empty',0);
INSERT dbo.cases(case_number,student_id,title,description) VALUES('LEGACY-UNASSIGNED','$student','Legacy','Must not be modified by migration');
"@
    $migration = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../sql/2026-10-27-required-ticket-assignment.sql') -Raw
    foreach ($iteration in 1,2) {
        foreach ($batch in [regex]::Split($migration,'(?im)^GO\s*\r?$')) { if ($batch.Trim()) { Run-Sql $batch } }
    }
    Check 'rerunnable migration preserves historical unassigned ticket' "SELECT COUNT(*) FROM dbo.cases WHERE case_number='LEGACY-UNASSIGNED' AND assigned_to IS NULL;"
    Run-Sql "UPDATE dbo.cases SET title='Legacy edit still works' WHERE case_number='LEGACY-UNASSIGNED';"
    Check 'primary owner takes priority' "SELECT COUNT(*) FROM (SELECT TOP(1) Owner FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,NULL) ORDER BY Rank,Workload,LastAssignedAt,Owner) t WHERE Owner='$primary';"
    Run-Sql "UPDATE dbo.service_units SET primary_service_owner_id=NULL WHERE id='$unit'; INSERT dbo.service_unit_owners(service_unit_id,staff_profile_id) VALUES('$unit','$officer');"
    Check 'registered unit owner fallback' "SELECT COUNT(*) FROM (SELECT TOP(1) Owner FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,NULL) ORDER BY Rank,Workload,LastAssignedAt,Owner) t WHERE Owner='$officer';"
    Run-Sql "UPDATE dbo.service_unit_owners SET ended_at=DATEADD(day,-1,SYSDATETIMEOFFSET()); UPDATE dbo.staff_profiles SET last_assigned_at=CASE WHEN user_id='$primary' THEN SYSDATETIMEOFFSET() ELSE NULL END;"
    Check 'expired ownership excluded; least recently assigned officer wins' "SELECT COUNT(*) FROM (SELECT TOP(1) Owner,Method FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,NULL) ORDER BY Rank,Workload,LastAssignedAt,Owner) t WHERE Owner='$officer' AND Method='workload';"
    Run-Sql "INSERT dbo.cases(case_number,student_id,service_unit_id,assigned_to,title,description) VALUES('LOAD','$student','$unit','$officer','Workload fixture','Synthetic');"
    Check 'live workload takes priority over last assignment' "SELECT COUNT(*) FROM (SELECT TOP(1) Owner FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,NULL) ORDER BY Rank,Workload,LastAssignedAt,Owner) t WHERE Owner='$primary';"
    Run-Sql "UPDATE dbo.staff_profiles SET availability_status='unavailable' WHERE user_id='$primary';"
    # Explicitly assert exclusions, including a selected appointment officer's different availability rule.
    Check 'preselected active appointment officer can be busy' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,'$primary');"
    Check 'automatic candidates omit unavailable staff' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,NULL) WHERE Owner='$primary') THEN 1 ELSE 0 END;"
    Run-Sql "UPDATE dbo.staff_profiles SET availability_status='available';"
    Check 'requester cannot be assigned their own ticket' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates('$unit','$primary',0,NULL) WHERE Owner='$primary') THEN 1 ELSE 0 END;"
    Check 'sensitive cases require clearance' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',1,NULL)) THEN 1 ELSE 0 END;"
    Run-Sql "UPDATE dbo.service_staff SET can_view_sensitive_cases=1 WHERE staff_profile_id='$officer';"
    Check 'cleared staff eligible for sensitive ticket' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',1,NULL) WHERE Owner='$officer';"
    Run-Sql "UPDATE dbo.staff_profiles SET is_active=0 WHERE user_id='$primary';"
    Check 'inactive staff excluded, including explicit selection' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,'$primary')) THEN 1 ELSE 0 END;"
    Run-Sql "UPDATE dbo.staff_profiles SET is_active=1; UPDATE dbo.profiles SET access_revoked_at=SYSDATETIMEOFFSET() WHERE id='$primary';"
    Check 'revoked account excluded' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.ufn_TicketAssignmentCandidates('$unit','$student',0,'$primary')) THEN 1 ELSE 0 END;"
    Run-Sql "UPDATE dbo.profiles SET access_revoked_at=NULL;"
    Rejected 'wrong-unit explicit staff rejected' "DECLARE @o uniqueidentifier='$other',@m nvarchar(50); EXEC dbo.usp_Tickets_RequireAssignment '$unit','$student',0,@o OUTPUT,@m OUTPUT;"
    Check 'unit with no receiving staff uses unit queue rather than rejecting user' "DECLARE @u uniqueidentifier='$empty',@o uniqueidentifier,@m nvarchar(50); EXEC dbo.usp_Tickets_RequireAssignment @u OUTPUT,'$student',0,@o OUTPUT,@m OUTPUT; SELECT CASE WHEN @u='$empty' AND @o IS NULL AND @m='unit_queue' THEN 1 ELSE 0 END;"
    Rejected 'missing unit rejected' "DECLARE @o uniqueidentifier,@m nvarchar(50); EXEC dbo.usp_Tickets_RequireAssignment NULL,'$student',0,@o OUTPUT,@m OUTPUT;"
    Run-Sql "UPDATE dbo.service_units SET is_active=0 WHERE id='$unit';"
    Rejected 'inactive unit rejected' "DECLARE @o uniqueidentifier,@m nvarchar(50); EXEC dbo.usp_Tickets_RequireAssignment '$unit','$student',0,@o OUTPUT,@m OUTPUT;"
    Run-Sql "UPDATE dbo.service_units SET is_active=1;"
    foreach ($type in 'query','complaint','alert','service_request') {
        $id = [Guid]::NewGuid()
        Run-Sql "EXEC dbo.usp_Interactions_InsertCase @caseId='$id',@referenceNo='TEST-$type',@user='$student',@type='$type',@unit='$unit',@title='Synthetic test',@description='Test only',@status='routed',@priority='medium',@severity='normal',@lang='en',@automation='human_review',@sensitive=0,@sensitivity='normal',@human=1,@confidentiality='standard',@service='TEST_UNIT',@reasonEn='Test',@reasonAr=N'اختبار',@confidence=0.9,@method='unit_queue',@action='test.created',@meta='{}';"
        Check "$type inserted with owner, timestamp, method and matching status history" "SELECT COUNT(*) FROM dbo.cases c JOIN dbo.case_status_history h ON h.case_id=c.id WHERE c.id='$id' AND c.assigned_to IS NOT NULL AND c.assigned_at IS NOT NULL AND c.assignment_method<>'unit_queue' AND c.status='assigned' AND h.to_status=c.status;"
    }
    $sug = [Guid]::NewGuid()
    Run-Sql "EXEC dbo.usp_Interactions_InsertSuggestion @id='$sug',@user='$student',@reference='TEST-SUG',@title='Synthetic suggestion',@description='Test only',@unit='$unit',@anon=0,@lang='en',@service='TEST_UNIT',@reasonEn='Test',@reasonAr=N'اختبار',@confidence=0.9;"
    Check 'suggestion is assigned immediately, without later UI intake' "SELECT COUNT(*) FROM dbo.suggestions WHERE id='$sug' AND assigned_staff_id IS NOT NULL AND review_due_at IS NOT NULL AND status='assigned';"
    $legacyChat = [Guid]::NewGuid()
    Run-Sql "EXEC dbo.usp_Assistant_InsertCase '$legacyChat','TEST-CHAT','$student','service_request','Synthetic','Test only','medium','en',NULL,'$unit';"
    Check 'legacy chat path assigns before insertion' "SELECT COUNT(*) FROM dbo.cases WHERE id='$legacyChat' AND assigned_to IS NOT NULL;"
    Rejected 'legacy chat without routing cannot create unassigned ticket' "DECLARE @id uniqueidentifier=NEWID(); EXEC dbo.usp_Assistant_InsertCase @id,'TEST-BLOCKED-CHAT','$student','service_request','Synthetic','Test only','medium','en';"
    $career = [Guid]::NewGuid()
    Run-Sql "EXEC dbo.usp_Career_CreateCounsellingCase '$career','TEST-CAREER','$student','$unit',NULL,'Synthetic','routed','en','unit_queue','{}';"
    Check 'career path assigns before storing side effects' "SELECT COUNT(*) FROM dbo.cases WHERE id='$career' AND assigned_to IS NOT NULL AND status='assigned';"
    $incident = [Guid]::NewGuid(); $contact = [Guid]::NewGuid()
    Run-Sql "INSERT dbo.emergency_contacts(id,code,label_en,label_ar,responsible_unit_en) VALUES('$contact','synthetic','Test unit',N'اختبار','Test unit'); EXEC dbo.usp_Assistant_InsertIncidentCase '$incident','TEST-INCIDENT','$student','Synthetic incident','Test only','en','$contact';"
    Check 'incident path uses resolved unit staff, not a temporary unassigned case' "SELECT COUNT(*) FROM dbo.cases WHERE id='$incident' AND service_unit_id='$unit' AND assigned_to IS NOT NULL;"
    $blocked = [Guid]::NewGuid()
    Rejected 'invalid unit leaves no partial record' "EXEC dbo.usp_Interactions_InsertCase @caseId='$blocked',@referenceNo='TEST-BLOCKED',@user='$student',@type='complaint',@unit=NULL,@title='Synthetic',@description='Test only',@status='routed',@priority='medium',@severity='normal',@lang='en',@automation='human_review',@sensitive=0,@sensitivity='normal',@human=1,@confidentiality='standard',@service='UNSTAFFED',@reasonEn='Test',@reasonAr=N'اختبار',@confidence=0.9,@method='unit_queue',@action='test.created',@meta='{}';"
    Check 'no ticket, status history or audit after rejection' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.cases WHERE id='$blocked') AND NOT EXISTS(SELECT 1 FROM dbo.case_status_history WHERE case_id='$blocked') AND NOT EXISTS(SELECT 1 FROM dbo.audit_logs WHERE entity_id='$blocked') THEN 1 ELSE 0 END;"
    Rejected 'direct SQL unassigned insert is blocked' "INSERT dbo.cases(case_number,student_id,title,description) VALUES('BYPASS','$student','Synthetic','Test only');"
    Rejected 'bulk insert with one unassigned ticket is entirely blocked' "INSERT dbo.cases(case_number,student_id,title,description,service_unit_id,assigned_to) VALUES('BULK-VALID','$student','Synthetic','Test only','$unit','$officer'),('BULK-INVALID','$student','Synthetic','Test only','$unit',NULL);"
    Check 'bulk failure rolls back all rows' "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.cases WHERE case_number LIKE 'BULK-%') THEN 1 ELSE 0 END;"
    Rejected 'direct SQL unassigned suggestion is blocked' "INSERT dbo.suggestions(reference_number,student_id,title,description) VALUES('BYPASS-SUG','$student','Synthetic','Test only');"
    foreach ($table in 'cases','suggestions') {
        $refColumn = if ($table -eq 'cases') { 'case_number' } else { 'reference_number' }
        $ownerColumn = if ($table -eq 'cases') { 'assigned_to' } else { 'assigned_staff_id' }
        $generic = [Guid]::NewGuid()
        $payload = @(@{Column='id';Value=$generic.ToString()},@{Column=$refColumn;Value="TEST-GENERIC-$table"},@{Column='student_id';Value=$student},@{Column='service_unit_id';Value=$unit},@{Column='title';Value='Synthetic'},@{Column='description';Value='Test only'}) | ConvertTo-Json -Compress
        Run-Sql "EXEC dbo.usp_Data_Write @schemaName='dbo',@tableName='$table',@operation='insert',@values=N'$payload',@returnRows=1;"
        Check "generic $table insert supports triggers and returns assigned record" "SELECT COUNT(*) FROM dbo.$table WHERE id='$generic' AND $ownerColumn IS NOT NULL AND status='assigned';"
        $payload = @(@{Column='title';Value='Synthetic updated'}) | ConvertTo-Json -Compress -AsArray
        $filters = @(@{Column='id';Operator='eq';Value=$generic.ToString()}) | ConvertTo-Json -Compress -AsArray
        Run-Sql "EXEC dbo.usp_Data_Write @schemaName='dbo',@tableName='$table',@operation='updateExisting',@values=N'$payload',@filters=N'$filters',@returnRows=1;"
        Check "existing generic $table upsert remains usable" "SELECT COUNT(*) FROM dbo.$table WHERE id='$generic' AND title='Synthetic updated';"
    }
    $payload = @(@{Column='id';Value='40000000-0000-0000-0000-000000000001'},@{Column='full_name';Value='Unrelated profile'}) | ConvertTo-Json -Compress
    Run-Sql "EXEC dbo.usp_Data_Write @schemaName='dbo',@tableName='profiles',@operation='insert',@values=N'$payload',@returnRows=1;"
    Check 'unrelated generic table insert unchanged' "SELECT COUNT(*) FROM dbo.profiles WHERE full_name='Unrelated profile';"
    $queued = [Guid]::NewGuid()
    Run-Sql "EXEC dbo.usp_Interactions_InsertCase @caseId='$queued',@referenceNo='TEST-UNIT-QUEUE',@user='$student',@type='complaint',@unit='$empty',@title='Synthetic queued complaint',@description='Test only',@status='routed',@priority='medium',@severity='normal',@lang='en',@automation='human_review',@sensitive=0,@sensitivity='normal',@human=1,@confidentiality='standard',@service='UNSTAFFED',@reasonEn='Test',@reasonAr=N'اختبار',@confidence=0.9,@method='unit_queue',@action='test.created',@meta='{}';"
    Check 'unstaffed complaint submits successfully to original unit queue' "SELECT COUNT(*) FROM dbo.cases WHERE id='$queued' AND service_unit_id='$empty' AND assigned_to IS NULL AND status='routed' AND assignment_method='unit_queue' AND needs_assignment_attention=1 AND assigned_at IS NULL;"
    $queueSuggestion = [Guid]::NewGuid()
    Run-Sql "EXEC dbo.usp_Interactions_InsertSuggestion @id='$queueSuggestion',@user='$student',@reference='TEST-QUEUED-SUG',@title='Synthetic suggestion',@description='Test only',@unit='$empty',@anon=0,@lang='en',@service='UNSTAFFED',@reasonEn='Test',@reasonAr=N'اختبار',@confidence=0.9;"
    Check 'unstaffed suggestion submits successfully to unit' "SELECT COUNT(*) FROM dbo.suggestions WHERE id='$queueSuggestion' AND service_unit_id='$empty' AND assigned_staff_id IS NULL AND status='submitted';"
    $genericQueued = [Guid]::NewGuid()
    $payload = @(@{Column='id';Value=$genericQueued.ToString()},@{Column='case_number';Value='TEST-GENERIC-QUEUE'},@{Column='student_id';Value=$student},@{Column='service_unit_id';Value=$empty},@{Column='title';Value='Synthetic queued case'},@{Column='description';Value='Test only'},@{Column='status';Value='assigned'}) | ConvertTo-Json -Compress
    Run-Sql "EXEC dbo.usp_Data_Write @schemaName='dbo',@tableName='cases',@operation='insert',@values=N'$payload',@returnRows=1;"
    Check 'generic unit queue reports routed, not falsely assigned to a person' "SELECT COUNT(*) FROM dbo.cases WHERE id='$genericQueued' AND assigned_to IS NULL AND status='routed' AND needs_assignment_attention=1 AND current_responsible_actor='service_owner' AND human_review_required=1;"
    Run-Sql "UPDATE dbo.service_staff SET can_receive_cases=1 WHERE staff_profile_id='$other'; EXEC dbo.usp_CaseOps_Assign '$queued','$other','$empty','$primary';"
    Check 'existing owner Assign action clears queue marker and records assignment history' "SELECT COUNT(*) FROM dbo.cases c JOIN dbo.case_assignments a ON a.case_id=c.id WHERE c.id='$queued' AND c.assigned_to='$other' AND c.status='assigned' AND c.needs_assignment_attention=0 AND c.assigned_at IS NOT NULL AND c.assignment_method='manual' AND a.assigned_to=c.assigned_to;"
    Run-Sql "UPDATE dbo.service_staff SET can_receive_cases=0 WHERE staff_profile_id='$other';"
    $desk = '10000000-0000-0000-0000-000000000003'; $support = '30000000-0000-0000-0000-000000000004'
    Run-Sql "INSERT dbo.service_units(id,code,name_en,name_ar) VALUES('$desk','HD','Help Desk',N'الدعم'); INSERT auth.users(id,email) VALUES('$support','support@example.invalid'); INSERT dbo.profiles(id,full_name) VALUES('$support','Test support'); INSERT dbo.staff_profiles(user_id,service_unit_id) VALUES('$support','$desk'); INSERT dbo.service_staff(staff_profile_id,service_unit_id) VALUES('$support','$desk');"
    Check 'support staff selected automatically for an unstaffed unit' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignment('$empty','$student',0,NULL) WHERE UnitId='$desk' AND Owner='$support' AND Method='SERVICE_DESK_FALLBACK';"
    Check 'missing routing uses support staff without rejecting user' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignment(NULL,'$student',0,NULL) WHERE UnitId='$desk' AND Owner='$support';"
    $supportCase = [Guid]::NewGuid()
    Run-Sql "EXEC dbo.usp_Assistant_InsertCase '$supportCase','TEST-SUPPORT','$student','service_request','Synthetic','Test only','medium','en',NULL,'$empty';"
    Check 'fallback persists actual support unit and staff atomically' "SELECT COUNT(*) FROM dbo.cases WHERE id='$supportCase' AND service_unit_id='$desk' AND assigned_to='$support' AND assignment_method='SERVICE_DESK_FALLBACK' AND needs_assignment_attention=0;"
    Check 'named support fallback method survives preflight validation' "DECLARE @u uniqueidentifier='$desk',@o uniqueidentifier='$support',@m nvarchar(50)='SERVICE_DESK_FALLBACK'; EXEC dbo.usp_Tickets_RequireAssignment @u OUTPUT,'$student',0,@o OUTPUT,@m OUTPUT; SELECT CASE WHEN @m='SERVICE_DESK_FALLBACK' THEN 1 ELSE 0 END;"
    Run-Sql "UPDATE dbo.staff_profiles SET availability_status='unavailable' WHERE user_id='$support';"
    Check 'busy support staff still own the ticket for later follow-up' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignment('$empty','$student',0,NULL) WHERE Owner='$support' AND Method='SERVICE_DESK_FALLBACK';"
    Run-Sql "UPDATE dbo.staff_profiles SET is_active=0 WHERE user_id='$support';"
    Check 'disabled support staff are not assigned; original unit queue is final fallback' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignment('$empty','$student',0,NULL) WHERE UnitId='$empty' AND Owner IS NULL AND Method='unit_queue';"
    Check 'sensitive cases keep clearance rules during fallback' "SELECT COUNT(*) FROM dbo.ufn_TicketAssignment('$empty','$student',1,NULL) WHERE UnitId='$empty' AND Owner IS NULL AND Method='unit_queue';"
    Write-Output "Ticket assignment integration checks passed: $checks. No live database or email service used."
} finally {
    if ($test) { $test.Dispose() }
    if ($created -and $master.State -eq 'Open' -and $database -match '^SanadiAssignmentTest_[a-f0-9]{32}$') {
        $cmd = $master.CreateCommand()
        try { $cmd.CommandText = "ALTER DATABASE [$database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$database];"; [void]$cmd.ExecuteNonQuery() }
        finally { $cmd.Dispose() }
    }
    $master.Dispose()
}
