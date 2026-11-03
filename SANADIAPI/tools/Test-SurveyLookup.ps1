param([string]$Instance = '(localdb)\MSSQLLocalDB', [switch]$RunCSharp)

# Isolated, synthetic SQL integration tests. Never connect to application settings.
$ErrorActionPreference = 'Stop'
if ($Instance -notmatch '^\(localdb\)\\[\w-]+$') { throw 'Only a local LocalDB instance is allowed.' }
$database = 'SanadiSurveyTest_' + [Guid]::NewGuid().ToString('N')
$master = [System.Data.SqlClient.SqlConnection]::new("Server=$Instance;Database=master;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=20")
$test = $null
$created = $false
$checks = 0
function Run-Sql($connection, [string]$sql) {
    $command = $connection.CreateCommand()
    try { $command.CommandText = $sql; [void]$command.ExecuteNonQuery() }
    finally { $command.Dispose() }
}
function Lookup($connection, [string]$procedure, [hashtable]$parameters) {
    $command = $connection.CreateCommand()
    try {
        $command.CommandType = [System.Data.CommandType]::StoredProcedure
        $command.CommandText = $procedure
        foreach ($name in $parameters.Keys) { [void]$command.Parameters.AddWithValue($name, $parameters[$name]) }
        $table = [System.Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        return ,$table
    } finally { $command.Dispose() }
}
try {
    $master.Open()
    Run-Sql $master "CREATE DATABASE [$database]"
    $created = $true
    $test = [System.Data.SqlClient.SqlConnection]::new("Server=$Instance;Database=$database;Integrated Security=true;TrustServerCertificate=true")
    $test.Open()
    Run-Sql $test @'
CREATE TABLE dbo.CustomerPulseSetting (
 Id int IDENTITY PRIMARY KEY, ServiceType varchar(30), IsProduction bit, IsEnabled bit,
 ScriptUrl nvarchar(500), FullSequenceCode nvarchar(100), WebLinkingId nvarchar(100),
 MobileLinkingId nvarchar(100), Channel nvarchar(50), DefaultLang nvarchar(10),
 CpStatus nvarchar(50), InternalStatus nvarchar(50), DefaultFees decimal(18,2), UpdatedAtUtc datetime2);
CREATE TABLE dbo.cases (id uniqueidentifier, student_id uniqueidentifier, case_number nvarchar(100), case_type nvarchar(30));
CREATE TABLE dbo.suggestions (id uniqueidentifier, student_id uniqueidentifier, reference_number nvarchar(100));
INSERT dbo.CustomerPulseSetting (ServiceType,IsProduction,IsEnabled,FullSequenceCode,WebLinkingId,UpdatedAtUtc)
SELECT c.Category, e.IsProduction, 1, CONCAT(c.Category, '-', e.IsProduction), 'test-link', SYSUTCDATETIME()
FROM (VALUES ('Inquiry'),('Complaint'),('Alert'),('Suggestion')) c(Category)
CROSS JOIN (VALUES (0),(1)) e(IsProduction);
INSERT dbo.cases VALUES (NEWID(),NEWID(),'TEST-INQUIRY','query'),(NEWID(),NEWID(),'TEST-COMPLAINT','complaint'),(NEWID(),NEWID(),'TEST-ALERT','alert');
INSERT dbo.suggestions VALUES (NEWID(),NEWID(),'TEST-SUGGESTION');
EXEC(N'CREATE SCHEMA auth');
CREATE TABLE auth.login_sessions(id uniqueidentifier PRIMARY KEY,user_id uniqueidentifier,revoked_at datetimeoffset NULL);
CREATE TABLE auth.refresh_tokens(session_id uniqueidentifier,revoked_at datetimeoffset NULL,expires_at datetimeoffset);
CREATE TABLE auth.users(id uniqueidentifier PRIMARY KEY,email nvarchar(320));
CREATE TABLE dbo.email_templates(template_code nvarchar(100),name_en nvarchar(200),name_ar nvarchar(200),subject_en nvarchar(500),subject_ar nvarchar(500),body_en nvarchar(max),body_ar nvarchar(max),enabled bit,version int,severity nvarchar(50),effective_from datetimeoffset NULL,effective_to datetimeoffset NULL);
CREATE TABLE dbo.notification_settings(emails_enabled bit,demo_email_mode bit);
INSERT dbo.notification_settings VALUES(1,0);
CREATE TABLE dbo.ApplicationSettings(Id int,IsActive bit,IsProductionEntry bit,UpdatedAtUtc datetime2,
 NotificationEmailApiUrl nvarchar(500),NotificationEmailApp nvarchar(100),SsoUiOrigin nvarchar(500),NotificationEmailCc nvarchar(500),NotificationEmailBcc nvarchar(500),NotificationEmailTemplate nvarchar(100),EmailApiAppName nvarchar(100));
INSERT dbo.ApplicationSettings VALUES(1,1,0,SYSUTCDATETIME(),'https://mail.test/general','test-app','https://app.test',NULL,NULL,'test-template','test-client');
INSERT dbo.ApplicationSettings VALUES(2,1,1,SYSUTCDATETIME(),'https://production-mail.test/general','production-app','https://production-app.test',NULL,NULL,'production-template','production-client');
ALTER TABLE dbo.ApplicationSettings ADD AuthApiUrl nvarchar(500),StudentApiClientSecret nvarchar(500),HeaderDomain nvarchar(100);
UPDATE dbo.ApplicationSettings SET AuthApiUrl='https://gateway.test/token',StudentApiClientSecret='synthetic-gateway-secret',HeaderDomain='example.test';
CREATE TABLE dbo.profiles(id uniqueidentifier,full_name nvarchar(100),email nvarchar(200),deleted_at datetimeoffset NULL);
CREATE TABLE dbo.service_units(id uniqueidentifier,primary_service_owner_id uniqueidentifier);
CREATE TABLE dbo.audit_logs(id uniqueidentifier DEFAULT NEWID(),actor_id uniqueidentifier,action nvarchar(200),entity_type nvarchar(50),entity_id uniqueidentifier,metadata nvarchar(max),created_at datetimeoffset DEFAULT SYSDATETIMEOFFSET());
CREATE TABLE dbo.case_assignments(id uniqueidentifier DEFAULT NEWID(),case_id uniqueidentifier,assigned_to uniqueidentifier,assigned_by uniqueidentifier,created_at datetimeoffset DEFAULT SYSDATETIMEOFFSET());
CREATE TABLE dbo.case_status_history(id uniqueidentifier DEFAULT NEWID(),case_id uniqueidentifier,from_status nvarchar(50),to_status nvarchar(50),changed_by uniqueidentifier,created_at datetimeoffset DEFAULT SYSDATETIMEOFFSET());
CREATE TABLE dbo.case_comments(id uniqueidentifier DEFAULT NEWID(),case_id uniqueidentifier,author_id uniqueidentifier,body nvarchar(max),is_internal bit,created_at datetimeoffset DEFAULT SYSDATETIMEOFFSET());
CREATE TABLE dbo.suggestion_updates(id uniqueidentifier DEFAULT NEWID(),suggestion_id uniqueidentifier,update_type nvarchar(50),update_text_en nvarchar(max),visible_to_student bit,created_by uniqueidentifier,created_at datetimeoffset DEFAULT SYSDATETIMEOFFSET());
ALTER TABLE dbo.cases ADD title nvarchar(200),status nvarchar(50),service_unit_id uniqueidentifier,assigned_to uniqueidentifier,deleted_at datetimeoffset NULL,created_at datetimeoffset,is_sensitive bit;
ALTER TABLE dbo.suggestions ADD title nvarchar(200),status nvarchar(50),service_unit_id uniqueidentifier,assigned_staff_id uniqueidentifier,deleted_at datetimeoffset NULL,created_at datetimeoffset;
CREATE TABLE dbo.notification_deliveries(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),event_type nvarchar(100),recipient_user_id uniqueidentifier,template_code nvarchar(100),template_vars nvarchar(max),case_id uniqueidentifier NULL,service_unit_id uniqueidentifier NULL,dedupe_key nvarchar(300) UNIQUE,recipient_role nvarchar(50),
 status nvarchar(30) DEFAULT 'queued',queued_at datetimeoffset DEFAULT SYSDATETIMEOFFSET(),next_attempt_at datetimeoffset DEFAULT SYSDATETIMEOFFSET(),locked_at datetimeoffset NULL,retry_count int DEFAULT 0,sent_at datetimeoffset NULL,failed_at datetimeoffset NULL,failure_code nvarchar(100),updated_at datetimeoffset DEFAULT SYSDATETIMEOFFSET());
'@
    $migration = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../sql/20261026_TicketEmailNotifications.sql') -Raw
    # Two executions verify that deploying the lookup migration is repeatable.
    foreach ($iteration in 1,2) {
        foreach ($batch in [regex]::Split($migration, '(?im)^GO\s*\r?$')) {
            if (-not [string]::IsNullOrWhiteSpace($batch)) { Run-Sql $test $batch }
        }
    }
    Run-Sql $test 'ALTER TABLE dbo.profiles ADD access_revoked_at datetimeoffset NULL;'
    $gatewayMigration = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../sql/2026-10-27-email-gateway-authorization.sql') -Raw
    foreach ($iteration in 1,2) {
        foreach ($batch in [regex]::Split($gatewayMigration, '(?im)^GO\s*\r?$')) {
            if (-not [string]::IsNullOrWhiteSpace($batch)) { Run-Sql $test $batch }
        }
    }
    foreach ($production in 0,1) {
        foreach ($category in 'Inquiry','Complaint','Alert','Suggestion','query') {
            $rows = Lookup $test 'dbo.usp_CustomerPulse_GetSetting' @{ '@ServiceType'=$category; '@IsProduction'=[bool]$production }
            $expected = if ($category -eq 'query') { 'Inquiry' } else { $category }
            if ($rows.Rows.Count -ne 1 -or $rows.Rows[0].FullSequenceCode -ne "$expected-$production") { throw "Wrong setting: $category / $production" }
            $checks++
        }
    }
    foreach ($pair in @(@('TEST-INQUIRY','query'),@('TEST-COMPLAINT','complaint'),@('TEST-ALERT','alert'),@('TEST-SUGGESTION','suggestion'))) {
        $rows = Lookup $test 'dbo.usp_CustomerPulse_GetSurveyCase' @{ '@CaseNumber'=$pair[0]; '@CaseType'=$pair[1] }
        if ($rows.Rows.Count -ne 1 -or $rows.Rows[0].CaseNumber -ne $pair[0]) { throw "Ticket lookup failed: $($pair[1])" }
        $checks++
    }
    foreach ($pair in @(@('TEST-SUGGESTION','complaint'),@('TEST-COMPLAINT','suggestion'),@('MISSING','query'))) {
        $rows = Lookup $test 'dbo.usp_CustomerPulse_GetSurveyCase' @{ '@CaseNumber'=$pair[0]; '@CaseType'=$pair[1] }
        if ($rows.Rows.Count -ne 0) { throw 'Wrong reference/category must not resolve.' }
        $checks++
    }
    Run-Sql $test "UPDATE dbo.CustomerPulseSetting SET IsEnabled=0 WHERE ServiceType='Alert' AND IsProduction=0"
    $rows = Lookup $test 'dbo.usp_CustomerPulse_GetSetting' @{ '@ServiceType'='Alert'; '@IsProduction'=$false }
    if ($rows.Rows.Count -ne 0) { throw 'Disabled setting must not resolve.' }
    $checks++
    Run-Sql $test @'
UPDATE dbo.ticket_email_activation SET activated_at=DATEADD(minute,-5,SYSDATETIMEOFFSET());
DECLARE @owner uniqueidentifier='22222222-2222-2222-2222-222222222222',@unit uniqueidentifier='33333333-3333-3333-3333-333333333333';
INSERT dbo.profiles(id,full_name,email,deleted_at) SELECT student_id,'Student','student@example.test',NULL FROM dbo.cases UNION SELECT student_id,'Student','student@example.test',NULL FROM dbo.suggestions;
INSERT dbo.profiles(id,full_name,email,deleted_at) VALUES(@owner,'Unit Owner','owner@example.test',NULL);
INSERT dbo.service_units VALUES(@unit,@owner);
UPDATE dbo.cases SET title='Synthetic ticket',status='assigned',created_at=SYSDATETIMEOFFSET(),service_unit_id=@unit,assigned_to=@owner,is_sensitive=0;
UPDATE dbo.suggestions SET title='Synthetic suggestion',status='submitted',created_at=SYSDATETIMEOFFSET(),service_unit_id=@unit;
EXEC dbo.usp_TicketEmail_Discover;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_created')<>8 THROW 51000,'Creation must notify the requester and unit owner for every category.',1;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_created' AND recipient_user_id=@owner)<>4 THROW 51000,'Unit owner missing from creation.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.notification_deliveries WHERE recipient_user_id=@owner AND event_type='TICKET_EMAIL_assigned') THROW 51000,'Unit owner missing.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.notification_deliveries WHERE template_code='ticket_created_inquiry') THROW 51000,'Inquiry mapping wrong.',1;
DECLARE @count int=(SELECT COUNT(*) FROM dbo.notification_deliveries);
EXEC dbo.usp_TicketEmail_Discover;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries)<>@count THROW 51000,'Duplicate discovery.',1;
INSERT dbo.case_status_history(case_id,from_status,to_status,changed_by) SELECT id,status,'closed',@owner FROM dbo.cases;
INSERT dbo.case_status_history(case_id,from_status,to_status,changed_by) SELECT id,'closed','closed',@owner FROM dbo.cases;
UPDATE dbo.cases SET status='closed';
INSERT dbo.suggestion_updates(suggestion_id,update_type,update_text_en,visible_to_student,created_by) SELECT id,'closed','Public outcome',1,@owner FROM dbo.suggestions;
UPDATE dbo.suggestions SET status='closed';
INSERT dbo.case_comments(case_id,author_id,body,is_internal) SELECT TOP(1) id,@owner,'INTERNAL_SECRET_MUST_NOT_EMAIL',1 FROM dbo.cases;
INSERT dbo.case_comments(case_id,author_id,body,is_internal) SELECT TOP(1) id,@owner,'Public response',0 FROM dbo.cases;
EXEC dbo.usp_TicketEmail_Discover;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_survey')<>4 THROW 51000,'Four closure surveys required; repeated closed status must not duplicate.',1;
IF EXISTS(SELECT 1 FROM dbo.notification_deliveries WHERE template_vars LIKE '%INTERNAL_SECRET_MUST_NOT_EMAIL%') THROW 51000,'Internal comment leaked.',1;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_comment' AND JSON_VALUE(template_vars,'$.kind')='case')<>2 THROW 51000,'Public comment must notify the requester and unit owner.',1;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_comment' AND JSON_VALUE(template_vars,'$.kind')='case' AND recipient_user_id=@owner)<>1 THROW 51000,'Unit owner missing from comment.',1;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_comment' AND JSON_VALUE(template_vars,'$.kind')='case' AND recipient_role='student')<>1 THROW 51000,'Requester missing from comment.',1;
IF (SELECT COUNT(*) FROM dbo.email_templates WHERE template_code LIKE 'ticket_survey_%')<>4 THROW 51000,'Category survey templates missing.',1;
INSERT dbo.suggestion_updates(suggestion_id,update_type,update_text_en,visible_to_student,created_by) SELECT id,'closed','Repeated close',1,@owner FROM dbo.suggestions;
EXEC dbo.usp_TicketEmail_Discover;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type='TICKET_EMAIL_survey')<>4 THROW 51000,'Suggestion survey duplicated.',1;
-- The two assignment rows name the same owner: only one meaningful assignment event.
INSERT dbo.case_assignments(case_id,assigned_to,assigned_by,created_at) SELECT TOP(1) id,@owner,@owner,DATEADD(second,-2,SYSDATETIMEOFFSET()) FROM dbo.cases;
INSERT dbo.case_assignments(case_id,assigned_to,assigned_by,created_at) SELECT TOP(1) id,@owner,@owner,DATEADD(second,-1,SYSDATETIMEOFFSET()) FROM dbo.cases;
EXEC dbo.usp_TicketEmail_Discover;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE dedupe_key LIKE 'ticket-email:assignment:%')<>2 THROW 51000,'Unchanged assignment duplicated.',1;
UPDATE dbo.suggestions SET assigned_staff_id=@owner;
INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata,created_at)
 SELECT @owner,'suggestion.assigned','suggestion',id,CONCAT('{"assignee":"',@owner,'"}'),DATEADD(second,-2,SYSDATETIMEOFFSET()) FROM dbo.suggestions;
INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata,created_at)
 SELECT @owner,'suggestion.assigned','suggestion',id,CONCAT('{"assignee":"',@owner,'"}'),DATEADD(second,-1,SYSDATETIMEOFFSET()) FROM dbo.suggestions;
EXEC dbo.usp_TicketEmail_Discover;
IF (SELECT COUNT(*) FROM dbo.notification_deliveries WHERE dedupe_key LIKE 'ticket-email:suggestion-assignment:%')<>2 THROW 51000,'Suggestion assignment recipient/deduplication failed.',1;
-- Lease isolation and logout checks use synthetic protected bytes only.
DECLARE @session uniqueidentifier=NEWID();
INSERT auth.login_sessions VALUES(@session,@owner,NULL);
INSERT auth.refresh_tokens VALUES(@session,NULL,DATEADD(day,1,SYSDATETIMEOFFSET()));
DECLARE @ok TABLE(Success bit);
INSERT @ok EXEC dbo.usp_SsoEmail_Store @owner,@session,'synthetic-encrypted-payload';
IF NOT EXISTS(SELECT 1 FROM @ok WHERE Success=1) THROW 51000,'Token save failed.',1;
DECLARE @lease uniqueidentifier=NEWID();
DECLARE @leaseRows TABLE(SessionId uniqueidentifier,LeaseId uniqueidentifier,ProtectedTokens nvarchar(max));
INSERT @leaseRows EXEC dbo.usp_SsoEmail_Acquire @owner,@lease;
IF (SELECT COUNT(*) FROM @leaseRows)<>1 THROW 51000,'Token lease failed.',1;
DELETE @leaseRows;
DECLARE @otherLease uniqueidentifier=NEWID();
INSERT @leaseRows EXEC dbo.usp_SsoEmail_Acquire @owner,@otherLease;
IF EXISTS(SELECT 1 FROM @leaseRows) THROW 51000,'Concurrent token lease allowed.',1;
EXEC dbo.usp_SsoEmail_Release @owner,@session,@lease;
UPDATE auth.login_sessions SET revoked_at=SYSDATETIMEOFFSET() WHERE id=@session;
INSERT @leaseRows EXEC dbo.usp_SsoEmail_Acquire @owner,@otherLease;
IF EXISTS(SELECT 1 FROM @leaseRows) THROW 51000,'Logged-out token reusable.',1;
'@
    $checks += 15
    $settings = Lookup $test 'dbo.usp_TicketEmail_GetSettings' @{ '@IsProduction'=$true }
    if ($settings.Rows.Count -ne 1 -or $settings.Rows[0].App -ne 'production-app') { throw 'Environment-specific email settings failed.' }
    $checks++
    $claimed = Lookup $test 'dbo.usp_TicketEmail_Claim' @{}
    if ($claimed.Rows.Count -ne 1 -or $claimed.Rows[0].RecipientEmail -notin @('student@example.test','owner@example.test')) { throw 'Claim did not resolve authoritative recipient.' }
    $checks++
    Run-Sql $test "EXEC dbo.usp_TicketEmail_Complete @Id='$($claimed.Rows[0].Id)',@Status='sent'"
    Write-Output "PASS: $checks survey/email SQL checks; full migration applied twice; only synthetic LocalDB data used."
    if ($RunCSharp) {
        $previousTestConnection = $env:SANADI_EMAIL_SQL_TEST
        try {
            $env:SANADI_EMAIL_SQL_TEST = $test.ConnectionString
            & dotnet build (Join-Path $PSScriptRoot 'TicketEmailSqlSmoke/TicketEmailSqlSmoke.csproj') --ignore-failed-sources -m:1 /p:NuGetAudit=false /p:UseSharedCompilation=false /p:UseAppHost=false /p:OutputPath=bin/TicketEmailValidation/ /nodeReuse:false --verbosity quiet
            if ($LASTEXITCODE -ne 0) { throw 'SQL/C# smoke harness build failed.' }
            & dotnet (Join-Path $PSScriptRoot 'TicketEmailSqlSmoke/bin/TicketEmailValidation/TicketEmailSqlSmoke.dll')
            if ($LASTEXITCODE -ne 0) { throw 'SQL/C# email smoke test failed.' }
        } finally { $env:SANADI_EMAIL_SQL_TEST = $previousTestConnection }
    }
} finally {
    if ($test) { $test.Dispose() }
    [System.Data.SqlClient.SqlConnection]::ClearAllPools()
    if ($created -and $database -match '^SanadiSurveyTest_[0-9a-f]{32}$') {
        Run-Sql $master "ALTER DATABASE [$database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$database]"
        Write-Output "Removed isolated test database: $database (synthetic data only)."
    }
    $master.Dispose()
}
