
/* Sanadi — SQL Server schema
   Tables, columns, checks, keys, and seed rows match the PostgreSQL dump.
   PostgreSQL schema "public" is [dbo] here (SQL Server reserves the name public).
   Functions/views/triggers are kept as comments (plpgsql is not T-SQL).
*/
USE master;
GO
IF DB_ID(N'SanadiChatbotProd') IS NOT NULL
BEGIN
  ALTER DATABASE [SanadiChatbotProd] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  DROP DATABASE [SanadiChatbotProd];
END
GO
CREATE DATABASE [SanadiChatbotProd];
GO
USE [SanadiChatbotProd];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT OFF;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'extensions') EXEC(N'CREATE SCHEMA [extensions]');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'auth') EXEC(N'CREATE SCHEMA [auth]');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'storage') EXEC(N'CREATE SCHEMA [storage]');
-- Schema name "public" cannot be created: SQL Server already has a fixed role with that name.
-- Application objects use [dbo] (SQL Server equivalent of PostgreSQL public).
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'anon') CREATE ROLE [anon];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'authenticated') CREATE ROLE [authenticated];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'service_role') CREATE ROLE [service_role];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'supabase_admin') CREATE ROLE [supabase_admin];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'supabase_auth_admin') CREATE ROLE [supabase_auth_admin];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'supabase_storage_admin') CREATE ROLE [supabase_storage_admin];
GO

CREATE OR ALTER FUNCTION [auth].[uid]()
RETURNS uniqueidentifier
AS
BEGIN
  DECLARE @v nvarchar(100) = CONVERT(nvarchar(100), SESSION_CONTEXT(N'request.jwt.claim.sub'));
  IF @v IS NULL OR @v = N'' RETURN NULL;
  RETURN CONVERT(uniqueidentifier, @v);
END;
GO

CREATE OR ALTER FUNCTION [auth].[role]()
RETURNS nvarchar(128)
AS
BEGIN
  DECLARE @v nvarchar(128) = CONVERT(nvarchar(128), SESSION_CONTEXT(N'request.jwt.claim.role'));
  RETURN COALESCE(NULLIF(@v, N''), N'anon');
END;
GO

CREATE OR ALTER FUNCTION [auth].[jwt]()
RETURNS nvarchar(max)
AS
BEGIN
  DECLARE @v nvarchar(max) = CONVERT(nvarchar(max), SESSION_CONTEXT(N'request.jwt.claims'));
  RETURN COALESCE(@v, N'{}');
END;
GO

IF OBJECT_ID(N'auth.users', N'U') IS NULL
CREATE TABLE [auth].[users] (
  [id] uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  [email] nvarchar(320) NULL UNIQUE,
  [encrypted_password] nvarchar(4000) NULL,
  [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  [updated_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF OBJECT_ID(N'storage.buckets', N'U') IS NULL
CREATE TABLE [storage].[buckets] (
  [id] nvarchar(128) NOT NULL PRIMARY KEY,
  [name] nvarchar(256) NOT NULL,
  [public] bit NOT NULL DEFAULT 0,
  [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF OBJECT_ID(N'storage.objects', N'U') IS NULL
CREATE TABLE [storage].[objects] (
  [id] uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  [bucket_id] nvarchar(128) NULL REFERENCES [storage].[buckets]([id]),
  [name] nvarchar(4000) NULL,
  [owner] uniqueidentifier NULL,
  [metadata] nvarchar(max) NULL,
  [created_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  [updated_at] datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

CREATE OR ALTER FUNCTION [storage].[foldername](@name nvarchar(4000))
RETURNS nvarchar(max)
AS
BEGIN
  -- same as PostgreSQL string_to_array(name,'/') without the last part
  RETURN LEFT(@name, CASE WHEN CHARINDEX(N'/', REVERSE(@name)) > 0 THEN LEN(@name) - CHARINDEX(N'/', REVERSE(@name)) ELSE 0 END);
END;
GO

IF OBJECT_ID(N'dbo.rls_policies', N'U') IS NULL
CREATE TABLE [dbo].[rls_policies] (
  [policy_name] nvarchar(128) NOT NULL,
  [table_name] nvarchar(128) NOT NULL,
  [definition] nvarchar(max) NOT NULL,
  CONSTRAINT rls_policies_pk PRIMARY KEY ([policy_name], [table_name])
);
GO

BEGIN TRY
INSERT INTO [storage].[buckets] ([id], [name], [public]) VALUES
  (N'case-evidence', N'case-evidence', 0),
  (N'knowledge-files', N'knowledge-files', 0),
  (N'student-letters', N'student-letters', 0),
  (N'student-cvs', N'student-cvs', 0);
END TRY
BEGIN CATCH IF ERROR_NUMBER() NOT IN (2627, 2601) THROW; END CATCH;
GO


-- ========== TABLES ==========

IF OBJECT_ID(N'dbo.student_appointments', N'U') IS NULL
CREATE TABLE [dbo].[student_appointments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[appointment_slot_id] uniqueidentifier NOT NULL,
[case_id] uniqueidentifier,
[purpose] nvarchar(450),
[status] nvarchar(450) DEFAULT N'booked' NOT NULL,
[booked_by] uniqueidentifier,
[confirmation_code] nvarchar(256) NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[cancelled_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.internship_assignments', N'U') IS NULL
CREATE TABLE [dbo].[internship_assignments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[assignment_number] nvarchar(256) NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[opportunity_id] uniqueidentifier NOT NULL,
[organization_id] uniqueidentifier NOT NULL,
[match_score] numeric(5,2),
[match_explanation_id] uniqueidentifier,
[assignment_status] nvarchar(450) DEFAULT N'reserved' NOT NULL,
[assigned_by_type] nvarchar(450) DEFAULT N'agent' NOT NULL,
[assigned_by_agent_run_id] uniqueidentifier,
[student_confirmed_at] datetimeoffset,
[assigned_at] datetimeoffset,
[internship_start_date] date,
[internship_end_date] date,
[internship_course_id] uniqueidentifier,
[course_registration_status] nvarchar(450) DEFAULT N'not_started' NOT NULL,
[employer_acceptance_status] nvarchar(450) DEFAULT N'not_required' NOT NULL,
[owner_review_status] nvarchar(450) DEFAULT N'not_required' NOT NULL,
[service_owner_id] uniqueidentifier,
[requires_human_review] bit DEFAULT 0 NOT NULL,
[human_review_reason] nvarchar(450),
[owner_flagged] bit DEFAULT 0 NOT NULL,
[owner_notes] nvarchar(max),
[seats_before] int,
[seats_after] int,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[related_case_id] uniqueidentifier,
[related_conversation_id] uniqueidentifier,
[government_clearance_required] bit DEFAULT 1 NOT NULL,
[government_clearance_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[government_clearance_approved_by] uniqueidentifier,
[government_clearance_approved_at] datetimeoffset,
[government_clearance_rejection_reason] nvarchar(450),
[provisional_allocation_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET(),
[final_allocation_at] datetimeoffset,
    CONSTRAINT internship_assignments_gov_clearance_status_chk CHECK ((government_clearance_status IN (N'not_required', N'pending', N'approved', N'rejected', N'returned_for_clarification')))

);
GO

IF OBJECT_ID(N'dbo.notification_deliveries', N'U') IS NULL
CREATE TABLE [dbo].[notification_deliveries] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[notification_event_id] uniqueidentifier,
[event_type] nvarchar(450) NOT NULL,
[severity] nvarchar(64) DEFAULT N'important' NOT NULL,
[recipient_user_id] uniqueidentifier,
[recipient_email] nvarchar(450),
[recipient_role] nvarchar(450),
[channel] nvarchar(450) DEFAULT N'email' NOT NULL,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[template_code] nvarchar(256) NOT NULL,
[template_version] int,
[subject] nvarchar(450),
[template_vars] nvarchar(max) DEFAULT N'{}' NOT NULL,
[action_url] nvarchar(450),
[case_id] uniqueidentifier,
[service_unit_id] uniqueidentifier,
[status] nvarchar(450) DEFAULT N'queued' NOT NULL,
[queued_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[next_attempt_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[locked_at] datetimeoffset,
[sent_at] datetimeoffset,
[delivered_at] datetimeoffset,
[failed_at] datetimeoffset,
[retry_count] int DEFAULT 0 NOT NULL,
[provider_message_id] nvarchar(max),
[failure_code] nvarchar(450),
[failure_reason] nvarchar(450),
[dedupe_key] nvarchar(256),
[emergency_broadcast_id] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.intercollege_transfer_requests', N'U') IS NULL
CREATE TABLE [dbo].[intercollege_transfer_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[transfer_number] nvarchar(256),
[student_id] uniqueidentifier NOT NULL,
[source_college_id] uniqueidentifier,
[source_programme_id] uniqueidentifier,
[target_college_id] uniqueidentifier,
[target_programme_id] uniqueidentifier,
[current_gpa] numeric(3,2),
[projected_gpa] numeric(3,2),
[completed_credits] int DEFAULT 0 NOT NULL,
[retained_credits] int DEFAULT 0 NOT NULL,
[non_applicable_credits] int DEFAULT 0 NOT NULL,
[additional_credits_required] int DEFAULT 0 NOT NULL,
[expected_graduation_before] nvarchar(450),
[projected_graduation_after] nvarchar(450),
[estimated_delay_semesters] int DEFAULT 0 NOT NULL,
[transfer_count_before] int DEFAULT 0 NOT NULL,
[eligibility_status] nvarchar(450) DEFAULT N'analysis_requested' NOT NULL,
[eligibility_reasons] nvarchar(max) DEFAULT N'[]' NOT NULL,
[analysis_snapshot] nvarchar(max) DEFAULT N'{}' NOT NULL,
[analysis_version] nvarchar(450),
[student_confirmed_at] datetimeoffset,
[acknowledgement_version] nvarchar(450),
[transfer_status] nvarchar(450) DEFAULT N'analysis_requested' NOT NULL,
[requires_human_review] bit DEFAULT 0 NOT NULL,
[human_review_reason] nvarchar(450),
[owner_notes] nvarchar(max),
[executed_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[seats_before] int,
[seats_after] int,
[capacity_id] uniqueidentifier,
[rule_version] nvarchar(450),
[equivalency_version] nvarchar(450),
    CONSTRAINT intercollege_transfer_requests_transfer_status_check CHECK ((transfer_status IN (N'analysis_requested', N'eligible', N'not_eligible', N'awaiting_student_review', N'awaiting_student_confirmation', N'pending_execution', N'human_review_required', N'completed', N'cancelled', N'failed', N'rejected')))

);
GO

IF OBJECT_ID(N'dbo.housing_allocations', N'U') IS NULL
CREATE TABLE [dbo].[housing_allocations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[allocation_number] nvarchar(256) NOT NULL,
[housing_application_id] uniqueidentifier NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[hostel_id] uniqueidentifier NOT NULL,
[room_id] uniqueidentifier NOT NULL,
[bed_label] nvarchar(450),
[allocation_status] nvarchar(450) DEFAULT N'reserved' NOT NULL,
[allocated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[move_in_date] date,
[move_out_date] date,
[allocated_by_type] nvarchar(450) DEFAULT N'agent' NOT NULL,
[allocated_by_agent_run_id] uniqueidentifier,
[reviewed_by_owner_id] uniqueidentifier,
[reviewed_at] datetimeoffset,
[override_reason] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.academic_programs', N'U') IS NULL
CREATE TABLE [dbo].[academic_programs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[college_id] uniqueidentifier,
[department_id] uniqueidentifier,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[degree_level] nvarchar(450) DEFAULT N'bachelor' NOT NULL,
[total_credit_hours] int DEFAULT 120 NOT NULL,
[minimum_gpa] numeric(3,2) DEFAULT 2.00 NOT NULL,
[internship_required] bit DEFAULT 1 NOT NULL,
[internship_minimum_credits] int DEFAULT 80 NOT NULL,
[maximum_study_years] int DEFAULT 8 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT academic_programs_internship_minimum_credits_check CHECK ((internship_minimum_credits >= 0)),
    CONSTRAINT academic_programs_minimum_gpa_check CHECK (((minimum_gpa >= 0) AND (minimum_gpa <= 4))),
    CONSTRAINT academic_programs_total_credit_hours_check CHECK ((total_credit_hours > 0))

);
GO

IF OBJECT_ID(N'dbo.academic_terms', N'U') IS NULL
CREATE TABLE [dbo].[academic_terms] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_id] uniqueidentifier,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[start_date] date NOT NULL,
[end_date] date NOT NULL,
[registration_start] date,
[registration_end] date,
[add_drop_deadline] date,
[withdrawal_deadline] date,
[exam_start] date,
[exam_end] date,
[is_current] bit DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT academic_terms_check CHECK ((end_date >= start_date))

);
GO

IF OBJECT_ID(N'dbo.action_approvals', N'U') IS NULL
CREATE TABLE [dbo].[action_approvals] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[action_key] nvarchar(450) NOT NULL,
[risk_level] nvarchar(64) DEFAULT N'level_1' NOT NULL,
[payload] nvarchar(max) DEFAULT N'{}' NOT NULL,
[affected_service] nvarchar(450),
[data_shared] nvarchar(450),
[expected_outcome] nvarchar(450),
[status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[approver_id] uniqueidentifier,
[receipt_number] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT action_approvals_status_check CHECK ((status IN (N'pending', N'confirmed', N'cancelled', N'approved', N'rejected')))

);
GO

IF OBJECT_ID(N'dbo.action_receipts', N'U') IS NULL
CREATE TABLE [dbo].[action_receipts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[receipt_number] nvarchar(256) NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[action_request_id] uniqueidentifier,
[case_id] uniqueidentifier,
[suggestion_id] uniqueidentifier,
[appointment_id] uniqueidentifier,
[reference_number] nvarchar(450),
[action_type] nvarchar(450) NOT NULL,
[responsible_unit_id] uniqueidentifier,
[responsible_unit_name] nvarchar(450),
[submitted_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[expected_first_response_at] datetimeoffset,
[expected_resolution_at] datetimeoffset,
[current_status] nvarchar(450) DEFAULT N'submitted' NOT NULL,
[next_step_en] nvarchar(450),
[next_step_ar] nvarchar(450),
[tracking_url] nvarchar(450),
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[payload] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.action_request_documents', N'U') IS NULL
CREATE TABLE [dbo].[action_request_documents] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[action_request_id] uniqueidentifier NOT NULL,
[student_document_id] uniqueidentifier NOT NULL,
[included_with_consent] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.action_requests', N'U') IS NULL
CREATE TABLE [dbo].[action_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[conversation_id] uniqueidentifier,
[case_id] uniqueidentifier,
[university_service_id] uniqueidentifier,
[action_type] nvarchar(450) NOT NULL,
[risk_level] nvarchar(64) DEFAULT N'level_1' NOT NULL,
[proposed_payload] nvarchar(max) DEFAULT N'{}' NOT NULL,
[student_confirmation_required] bit DEFAULT 1 NOT NULL,
[student_confirmed_at] datetimeoffset,
[human_approval_required] bit DEFAULT 0 NOT NULL,
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[execution_status] nvarchar(450) DEFAULT N'proposed' NOT NULL,
[execution_result] nvarchar(max),
[receipt_number] nvarchar(256),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[executed_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.action_revalidation_events', N'U') IS NULL
CREATE TABLE [dbo].[action_revalidation_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[trace_id] nvarchar(450),
[action_code] nvarchar(450) NOT NULL,
[student_id] uniqueidentifier,
[actor_id] uniqueidentifier,
[service_code] nvarchar(450),
[snapshot_at] datetimeoffset,
[executed_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[checks] nvarchar(max) DEFAULT N'[]' NOT NULL,
[authoritative_source] nvarchar(450),
[original_value] nvarchar(max),
[live_value] nvarchar(max),
[changed] bit DEFAULT 0 NOT NULL,
[revalidation_result] nvarchar(450) NOT NULL,
[recovery_classification] nvarchar(450),
[recovery_action] nvarchar(max),
[student_confirmation_required] bit DEFAULT 0 NOT NULL,
[transaction_result] nvarchar(450),
[duration_ms] int,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.action_revalidation_policies', N'U') IS NULL
CREATE TABLE [dbo].[action_revalidation_policies] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[action_code] nvarchar(256) NOT NULL,
[service_code] nvarchar(450),
[check_service_window] bit DEFAULT 0 NOT NULL,
[check_holds] bit DEFAULT 0 NOT NULL,
[hold_types] nvarchar(max) DEFAULT N'[]' NOT NULL,
[check_student_status] bit DEFAULT 0 NOT NULL,
[check_resource_capacity] bit DEFAULT 0 NOT NULL,
[resource_type] nvarchar(450),
[check_existing_assignment] bit DEFAULT 0 NOT NULL,
[check_eligibility] bit DEFAULT 0 NOT NULL,
[check_policy_version] bit DEFAULT 0 NOT NULL,
[check_conflicting_transaction] bit DEFAULT 0 NOT NULL,
[custom_validation_function] nvarchar(450),
[recovery_mode] nvarchar(450) DEFAULT N'auto' NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[notes] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.agent_model_invocations', N'U') IS NULL
CREATE TABLE [dbo].[agent_model_invocations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[trace_id] nvarchar(256) NOT NULL,
[conversation_id] uniqueidentifier,
[agent_run_id] uniqueidentifier,
[call_sequence] int NOT NULL,
[purpose] nvarchar(450) NOT NULL,
[necessity_reason] nvarchar(450) NOT NULL,
[provider] nvarchar(450) NOT NULL,
[model_name] nvarchar(450) NOT NULL,
[prompt_tokens] int DEFAULT 0 NOT NULL,
[completion_tokens] int DEFAULT 0 NOT NULL,
[estimated_input_tokens] int DEFAULT 0 NOT NULL,
[lane] nvarchar(450) NOT NULL,
[lane_queue_ms] int DEFAULT 0 NOT NULL,
[provider_first_token_ms] int,
[provider_duration_ms] int DEFAULT 0 NOT NULL,
[total_duration_ms] int DEFAULT 0 NOT NULL,
[result_used] bit DEFAULT 1 NOT NULL,
[status] nvarchar(450) DEFAULT N'succeeded' NOT NULL,
[error_category] nvarchar(450),
[prompt_breakdown] nvarchar(max) DEFAULT N'{}' NOT NULL,
[tool_names] nvarchar(max) DEFAULT N'[]' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT agent_model_invocations_call_sequence_check CHECK ((call_sequence > 0)),
    CONSTRAINT agent_model_invocations_completion_tokens_check CHECK ((completion_tokens >= 0)),
    CONSTRAINT agent_model_invocations_estimated_input_tokens_check CHECK ((estimated_input_tokens >= 0)),
    CONSTRAINT agent_model_invocations_lane_queue_ms_check CHECK ((lane_queue_ms >= 0)),
    CONSTRAINT agent_model_invocations_prompt_tokens_check CHECK ((prompt_tokens >= 0)),
    CONSTRAINT agent_model_invocations_provider_duration_ms_check CHECK ((provider_duration_ms >= 0)),
    CONSTRAINT agent_model_invocations_provider_first_token_ms_check CHECK (((provider_first_token_ms IS NULL) OR (provider_first_token_ms >= 0))),
    CONSTRAINT agent_model_invocations_status_check CHECK ((status IN (N'succeeded', N'failed', N'discarded'))),
    CONSTRAINT agent_model_invocations_total_duration_ms_check CHECK ((total_duration_ms >= 0))

);
GO

IF OBJECT_ID(N'dbo.agent_prompt_versions', N'U') IS NULL
CREATE TABLE [dbo].[agent_prompt_versions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[agent_type] nvarchar(256) NOT NULL,
[version] int NOT NULL,
[system_prompt] nvarchar(max) NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[status] nvarchar(450) DEFAULT N'draft' NOT NULL,
[notes] nvarchar(max),
[created_by] uniqueidentifier,
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[effective_from] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.agent_runs', N'U') IS NULL
CREATE TABLE [dbo].[agent_runs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[conversation_id] uniqueidentifier,
[agent] nvarchar(450) NOT NULL,
[status] nvarchar(450) DEFAULT N'completed' NOT NULL,
[input] nvarchar(max) DEFAULT N'{}' NOT NULL,
[output] nvarchar(max) DEFAULT N'{}' NOT NULL,
[latency_ms] int,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[model_name] nvarchar(450),
[provider] nvarchar(450),
[prompt_version] nvarchar(max),
[response_type] nvarchar(450),
[confidence] numeric,
[tool_call_count] int DEFAULT 0 NOT NULL,
[failed_tool_count] int DEFAULT 0 NOT NULL,
[schema_valid] bit,
[fallback_used] bit DEFAULT 0 NOT NULL,
[human_handoff] bit DEFAULT 0 NOT NULL,
[language] nvarchar(64),
[estimated_cost_usd] numeric,
[error_message] nvarchar(max)

);
GO

IF OBJECT_ID(N'dbo.agent_tool_executions', N'U') IS NULL
CREATE TABLE [dbo].[agent_tool_executions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[agent_run_id] uniqueidentifier,
[conversation_id] uniqueidentifier,
[tool_id] uniqueidentifier,
[tool_name] nvarchar(450) NOT NULL,
[requested_by_profile_id] uniqueidentifier NOT NULL,
[input_payload] nvarchar(max) DEFAULT N'{}' NOT NULL,
[output_payload] nvarchar(max),
[execution_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[authorization_result] nvarchar(450) DEFAULT N'allowed' NOT NULL,
[confirmation_status] nvarchar(450) DEFAULT N'not_required' NOT NULL,
[approval_status] nvarchar(450) DEFAULT N'not_required' NOT NULL,
[risk_level] nvarchar(64) DEFAULT N'level_0' NOT NULL,
[duration_ms] int,
[started_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[completed_at] datetimeoffset,
[error_code] nvarchar(450),
[error_message] nvarchar(max)

);
GO

IF OBJECT_ID(N'dbo.agent_tools', N'U') IS NULL
CREATE TABLE [dbo].[agent_tools] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[tool_name] nvarchar(256) NOT NULL,
[agent_type] nvarchar(450) DEFAULT N'query' NOT NULL,
[description] nvarchar(max) NOT NULL,
[input_schema] nvarchar(max) DEFAULT N'{}' NOT NULL,
[output_schema] nvarchar(max) DEFAULT N'{}' NOT NULL,
[authentication_required] bit DEFAULT 1 NOT NULL,
[allowed_roles] nvarchar(max) DEFAULT N'["student"]' NOT NULL,
[risk_level] nvarchar(64) DEFAULT N'level_0' NOT NULL,
[confirmation_required] bit DEFAULT 0 NOT NULL,
[human_approval_required] bit DEFAULT 0 NOT NULL,
[audit_required] bit DEFAULT 1 NOT NULL,
[timeout_ms] int DEFAULT 8000 NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.ai_human_edits', N'U') IS NULL
CREATE TABLE [dbo].[ai_human_edits] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[agent_run_id] uniqueidentifier,
[case_id] uniqueidentifier,
[entity_type] nvarchar(450) DEFAULT N'case_response' NOT NULL,
[entity_id] uniqueidentifier,
[original_ai_content] nvarchar(max) NOT NULL,
[edited_content] nvarchar(max) NOT NULL,
[editor_profile_id] uniqueidentifier NOT NULL,
[edit_category] nvarchar(450) DEFAULT N'other' NOT NULL,
[edit_reason] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.ai_settings', N'U') IS NULL
CREATE TABLE [dbo].[ai_settings] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[is_singleton] bit DEFAULT 1 NOT NULL,
[provider] nvarchar(450) DEFAULT N'gemini' NOT NULL,
[model_name] nvarchar(450) DEFAULT N'google/gemini-3.6-flash' NOT NULL,
[embedding_model] nvarchar(max) DEFAULT N'google/gemini-embedding-001' NOT NULL,
[api_key] nvarchar(4000) NULL,
[api_url] nvarchar(1000) DEFAULT N'https://generativelanguage.googleapis.com/v1beta' NULL,
[fallback_provider] nvarchar(450) NULL,
[fallback_model] nvarchar(450) NULL,
[reasoning_effort] nvarchar(50) DEFAULT N'none' NOT NULL,
[enable_thinking] bit NULL,
[temperature] numeric DEFAULT 0.2 NOT NULL,
[max_output_tokens] int DEFAULT 1200 NOT NULL,
[confidence_threshold] numeric DEFAULT 0.55 NOT NULL,
[handoff_threshold] numeric DEFAULT 0.4 NOT NULL,
[retrieval_top_k] int DEFAULT 6 NOT NULL,
[max_tool_calls] int DEFAULT 8 NOT NULL,
[request_timeout_ms] int DEFAULT 45000 NOT NULL,
[daily_cost_limit_usd] numeric DEFAULT 25 NOT NULL,
[agent_flags] nvarchar(max) DEFAULT N'{"alert": true, "query": true, "action": true, "complaint": true, "knowledge": true, "suggestion": true, "supervisor": true, "case_management": true}' NOT NULL,
[ai_enabled] bit DEFAULT 1 NOT NULL,
[updated_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.alert_deduplication', N'U') IS NULL
CREATE TABLE [dbo].[alert_deduplication] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[alert_rule_id] uniqueidentifier,
[condition_key] nvarchar(256) NOT NULL,
[source_record_id] uniqueidentifier,
[first_generated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[last_generated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[last_condition_hash] nvarchar(450),
[current_status] nvarchar(450) DEFAULT N'active' NOT NULL

);
GO

IF OBJECT_ID(N'dbo.alert_rule_conditions', N'U') IS NULL
CREATE TABLE [dbo].[alert_rule_conditions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[alert_rule_id] uniqueidentifier NOT NULL,
[field_source] nvarchar(450) NOT NULL,
[field_name] nvarchar(450) NOT NULL,
[operator] nvarchar(450) NOT NULL,
[comparison_value] nvarchar(max),
[condition_group] int DEFAULT 1 NOT NULL,
[evaluation_order] int DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.alert_rule_runs', N'U') IS NULL
CREATE TABLE [dbo].[alert_rule_runs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[alert_rule_id] uniqueidentifier,
[started_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[completed_at] datetimeoffset,
[records_evaluated] int DEFAULT 0 NOT NULL,
[alerts_created] int DEFAULT 0 NOT NULL,
[alerts_skipped] int DEFAULT 0 NOT NULL,
[errors_count] int DEFAULT 0 NOT NULL,
[run_status] nvarchar(450) DEFAULT N'running' NOT NULL,
[error_summary] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.alert_rules', N'U') IS NULL
CREATE TABLE [dbo].[alert_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[name] nvarchar(450) NOT NULL,
[description] nvarchar(max),
[category] nvarchar(450) DEFAULT N'general' NOT NULL,
[criteria] nvarchar(max) DEFAULT N'{}' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[event_type] nvarchar(450) DEFAULT N'manual' NOT NULL,
[target_condition] nvarchar(max) DEFAULT N'{}' NOT NULL,
[severity] nvarchar(64) DEFAULT N'medium' NOT NULL,
[title_template_en] nvarchar(max),
[title_template_ar] nvarchar(max),
[body_template_en] nvarchar(max),
[body_template_ar] nvarchar(max),
[action_label_en] nvarchar(450),
[action_label_ar] nvarchar(450),
[action_type] nvarchar(450) DEFAULT N'open_page' NOT NULL,
[action_url] nvarchar(450),
[related_service_id] uniqueidentifier,
[days_before_deadline] int,
[delivery_channels] nvarchar(max) DEFAULT N'["in_app"]' NOT NULL

);
GO

IF OBJECT_ID(N'dbo.alerts', N'U') IS NULL
CREATE TABLE [dbo].[alerts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[body_en] nvarchar(max) NOT NULL,
[body_ar] nvarchar(max) NOT NULL,
[reason_en] nvarchar(450),
[reason_ar] nvarchar(450),
[recommended_action_en] nvarchar(450),
[recommended_action_ar] nvarchar(450),
[action_url] nvarchar(450),
[category] nvarchar(450) DEFAULT N'general' NOT NULL,
[urgency] nvarchar(64) DEFAULT N'medium' NOT NULL,
[deadline_at] datetimeoffset,
[service_unit_id] uniqueidentifier,
[source_en] nvarchar(450),
[source_ar] nvarchar(450),
[is_campus_wide] bit DEFAULT 1 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.appointment_requests', N'U') IS NULL
CREATE TABLE [dbo].[appointment_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier,
[student_id] uniqueidentifier NOT NULL,
[service_unit_id] uniqueidentifier,
[appointment_mode] nvarchar(450) DEFAULT N'PREFERRED_TIME_REQUEST' NOT NULL,
[preferred_datetime] datetimeoffset NOT NULL,
[alternative_datetime] datetimeoffset,
[confirmed_datetime] datetimeoffset,
[assigned_staff_id] uniqueidentifier,
[assignment_method] nvarchar(450),
[assigned_at] datetimeoffset,
[workload_at_assignment] numeric,
[request_status] nvarchar(450) DEFAULT N'REQUESTED' NOT NULL,
[confirmation_status] nvarchar(450) DEFAULT N'AWAITING_OFFICE_CONFIRMATION' NOT NULL,
[office_response_at] datetimeoffset,
[student_response_at] datetimeoffset,
[purpose] nvarchar(450),
[decline_reason] nvarchar(450),
[location] nvarchar(450),
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[reference] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.appointment_slots', N'U') IS NULL
CREATE TABLE [dbo].[appointment_slots] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[appointment_type_id] uniqueidentifier NOT NULL,
[staff_profile_id] uniqueidentifier,
[start_time] datetimeoffset NOT NULL,
[end_time] datetimeoffset NOT NULL,
[capacity] int DEFAULT 1 NOT NULL,
[booked_count] int DEFAULT 0 NOT NULL,
[status] nvarchar(450) DEFAULT N'open' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[location] nvarchar(450),
[meeting_link] nvarchar(450),
[data_source] nvarchar(450) DEFAULT N'manual' NOT NULL,
[is_demo_record] bit DEFAULT 0 NOT NULL,
    CONSTRAINT appointment_slots_booked_count_check CHECK ((booked_count >= 0)),
    CONSTRAINT appointment_slots_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT appointment_slots_check CHECK ((end_time > start_time))

);
GO

IF OBJECT_ID(N'dbo.appointment_types', N'U') IS NULL
CREATE TABLE [dbo].[appointment_types] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[duration_minutes] int DEFAULT 30 NOT NULL,
[location_type] nvarchar(450) DEFAULT N'in_person' NOT NULL,
[requires_approval] bit DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[data_source] nvarchar(450) DEFAULT N'manual' NOT NULL,
[is_demo_record] bit DEFAULT 0 NOT NULL,
    CONSTRAINT appointment_types_duration_minutes_check CHECK ((duration_minutes > 0))

);
GO

IF OBJECT_ID(N'dbo.approval_requests', N'U') IS NULL
CREATE TABLE [dbo].[approval_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[action_request_id] uniqueidentifier,
[case_id] uniqueidentifier,
[approval_type] nvarchar(450) NOT NULL,
[requested_by] uniqueidentifier,
[assigned_approver_role] nvarchar(64),
[assigned_approver_id] uniqueidentifier,
[approval_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[risk_level] nvarchar(64),
[request_summary] nvarchar(450) NOT NULL,
[supporting_data] nvarchar(max) DEFAULT N'{}' NOT NULL,
[decision_reason] nvarchar(450),
[requested_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[due_at] datetimeoffset,
[decided_at] datetimeoffset,
[decided_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.ats_scoring_profiles', N'U') IS NULL
CREATE TABLE [dbo].[ats_scoring_profiles] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[scope] nvarchar(256) NOT NULL,
[role_code] nvarchar(450),
[engine_version] nvarchar(450) DEFAULT N'ats.v2' NOT NULL,
[weights_version] nvarchar(max) DEFAULT N'ats-weights.v1' NOT NULL,
[weights] nvarchar(max) DEFAULT N'{}' NOT NULL,
[bands] nvarchar(max) DEFAULT N'[]' NOT NULL,
[active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT ats_scoring_profiles_scope_check CHECK ((scope IN (N'general', N'role')))

);
GO

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
CREATE TABLE [dbo].[audit_logs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[actor_id] uniqueidentifier,
[action] nvarchar(450) NOT NULL,
[entity_type] nvarchar(450),
[entity_id] uniqueidentifier,
[metadata] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.automation_events', N'U') IS NULL
CREATE TABLE [dbo].[automation_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier,
[entity_type] nvarchar(450) DEFAULT N'case' NOT NULL,
[entity_id] uniqueidentifier,
[action_key] nvarchar(450) NOT NULL,
[agent] nvarchar(450) DEFAULT N'ai_case_manager' NOT NULL,
[actor_type] nvarchar(450) DEFAULT N'ai' NOT NULL,
[actor_id] uniqueidentifier,
[autonomy_level] nvarchar(450) DEFAULT N'automatic' NOT NULL,
[policy_id] uniqueidentifier,
[rule_used] nvarchar(450),
[inputs] nvarchar(max) DEFAULT N'{}' NOT NULL,
[result] nvarchar(max) DEFAULT N'{}' NOT NULL,
[confidence] numeric,
[risk_level] nvarchar(64),
[human_review_required] bit DEFAULT 0 NOT NULL,
[executed] bit DEFAULT 1 NOT NULL,
[summary_en] nvarchar(450),
[summary_ar] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.automation_policies', N'U') IS NULL
CREATE TABLE [dbo].[automation_policies] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[action_key] nvarchar(450) NOT NULL,
[case_type] nvarchar(64),
[service_unit_id] uniqueidentifier,
[risk_level] nvarchar(64),
[applies_to_sensitive] bit DEFAULT 0 NOT NULL,
[autonomy_level] nvarchar(450) DEFAULT N'automatic' NOT NULL,
[min_confidence] numeric DEFAULT 0.6 NOT NULL,
[notes] nvarchar(max),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT automation_policies_autonomy_level_check CHECK ((autonomy_level IN (N'automatic', N'automatic_notify', N'owner_approval', N'human_only')))

);
GO

IF OBJECT_ID(N'dbo.bilingual_terms', N'U') IS NULL
CREATE TABLE [dbo].[bilingual_terms] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[term_category] nvarchar(450) NOT NULL,
[canonical_en] nvarchar(450) NOT NULL,
[canonical_ar] nvarchar(450) NOT NULL,
[alternative_en] nvarchar(max) DEFAULT N'[]' NOT NULL,
[alternative_ar] nvarchar(max) DEFAULT N'[]' NOT NULL,
[abbreviation] nvarchar(450),
[service_unit_id] uniqueidentifier,
[notes] nvarchar(max),
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.calendar_exceptions', N'U') IS NULL
CREATE TABLE [dbo].[calendar_exceptions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[working_calendar_id] uniqueidentifier NOT NULL,
[exception_date] date NOT NULL,
[exception_type] nvarchar(450) DEFAULT N'holiday' NOT NULL,
[title_en] nvarchar(450),
[title_ar] nvarchar(450),
[is_working_day] bit DEFAULT 0 NOT NULL,
[custom_start_time] time,
[custom_end_time] time,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.campuses', N'U') IS NULL
CREATE TABLE [dbo].[campuses] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_id] uniqueidentifier NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[location_en] nvarchar(450),
[location_ar] nvarchar(450),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.career_analysis_versions', N'U') IS NULL
CREATE TABLE [dbo].[career_analysis_versions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[version_no] int NOT NULL,
[profile_source] nvarchar(450) NOT NULL,
[cv_id] uniqueidentifier,
[cv_file_name] nvarchar(450),
[weights] nvarchar(max) DEFAULT N'{}' NOT NULL,
[matches] nvarchar(max) DEFAULT N'[]' NOT NULL,
[ats] nvarchar(max),
[skill_gaps] nvarchar(max),
[action_plan] nvarchar(max) DEFAULT N'[]' NOT NULL,
[scoring_version] nvarchar(450) NOT NULL,
[calculated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT career_analysis_versions_profile_source_check CHECK ((profile_source IN (N'academic', N'academic_cv')))

);
GO

IF OBJECT_ID(N'dbo.career_counselling_events', N'U') IS NULL
CREATE TABLE [dbo].[career_counselling_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[cv_id] uniqueidentifier,
[event_type] nvarchar(450) NOT NULL,
[actor_id] uniqueidentifier,
[duration_ms] int,
[details] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.career_matching_weight_profiles', N'U') IS NULL
CREATE TABLE [dbo].[career_matching_weight_profiles] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[profile_mode] nvarchar(256) NOT NULL,
[weights] nvarchar(max) NOT NULL,
[active] bit DEFAULT 1 NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT career_matching_weight_profiles_profile_mode_check CHECK ((profile_mode IN (N'academic', N'cv_enhanced')))

);
GO

IF OBJECT_ID(N'dbo.career_role_matches', N'U') IS NULL
CREATE TABLE [dbo].[career_role_matches] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[cv_id] uniqueidentifier,
[career_role_id] uniqueidentifier NOT NULL,
[fit_score] numeric(5,2) DEFAULT 0 NOT NULL,
[programme_score] numeric(5,2) DEFAULT 0 NOT NULL,
[coursework_score] numeric(5,2) DEFAULT 0 NOT NULL,
[hard_skill_score] numeric(5,2) DEFAULT 0 NOT NULL,
[experience_score] numeric(5,2) DEFAULT 0 NOT NULL,
[tools_score] numeric(5,2) DEFAULT 0 NOT NULL,
[certification_score] numeric(5,2) DEFAULT 0 NOT NULL,
[soft_skill_score] numeric(5,2) DEFAULT 0 NOT NULL,
[preference_score] numeric(5,2) DEFAULT 0 NOT NULL,
[job_readiness_score] numeric(5,2) DEFAULT 0 NOT NULL,
[matched_evidence] nvarchar(max) DEFAULT N'[]' NOT NULL,
[missing_requirements] nvarchar(max) DEFAULT N'[]' NOT NULL,
[skill_breakdown] nvarchar(max) DEFAULT N'{}' NOT NULL,
[scoring_version] nvarchar(450) DEFAULT N'career-fit.v1' NOT NULL,
[calculated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.career_roles', N'U') IS NULL
CREATE TABLE [dbo].[career_roles] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[role_code] nvarchar(256) NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[career_family] nvarchar(450) NOT NULL,
[description_en] nvarchar(max) DEFAULT N'' NOT NULL,
[description_ar] nvarchar(max) DEFAULT N'' NOT NULL,
[suitable_programmes] nvarchar(max) DEFAULT N'[]' NOT NULL,
[typical_entry_level] nvarchar(450) DEFAULT N'entry' NOT NULL,
[required_hard_skills] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_hard_skills] nvarchar(max) DEFAULT N'[]' NOT NULL,
[required_soft_skills] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_tools] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_courses] nvarchar(max) DEFAULT N'[]' NOT NULL,
[certifications] nvarchar(max) DEFAULT N'[]' NOT NULL,
[experience_expectations] nvarchar(450) DEFAULT N'' NOT NULL,
[portfolio_expectations] nvarchar(450) DEFAULT N'' NOT NULL,
[industry_sectors] nvarchar(max) DEFAULT N'[]' NOT NULL,
[ats_keywords] nvarchar(max) DEFAULT N'[]' NOT NULL,
[active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_access_restrictions', N'U') IS NULL
CREATE TABLE [dbo].[case_access_restrictions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[restriction_type] nvarchar(450) NOT NULL,
[allowed_roles] nvarchar(max) DEFAULT N'[]' NOT NULL,
[allowed_profile_ids] nvarchar(max) DEFAULT N'[]' NOT NULL,
[reason] nvarchar(450),
[created_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_assignments', N'U') IS NULL
CREATE TABLE [dbo].[case_assignments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[assigned_to] uniqueidentifier,
[service_unit_id] uniqueidentifier,
[assigned_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_automation_state', N'U') IS NULL
CREATE TABLE [dbo].[case_automation_state] (

[case_id] uniqueidentifier NOT NULL,
[ai_status] nvarchar(450) DEFAULT N'managing_automatically' NOT NULL,
[next_action_key] nvarchar(450),
[next_action_en] nvarchar(450),
[next_action_ar] nvarchar(450),
[next_action_at] datetimeoffset,
[ai_confidence] numeric,
[automation_paused] bit DEFAULT 0 NOT NULL,
[pause_reason] nvarchar(450),
[paused_by] uniqueidentifier,
[paused_at] datetimeoffset,
[attention_category] nvarchar(450),
[attention_reason_en] nvarchar(450),
[attention_reason_ar] nvarchar(450),
[reminders_sent] int DEFAULT 0 NOT NULL,
[last_automated_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_categories', N'U') IS NULL
CREATE TABLE [dbo].[case_categories] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[case_type] nvarchar(64) DEFAULT N'complaint' NOT NULL,
[default_unit_id] uniqueidentifier,
[is_sensitive] bit DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_comments', N'U') IS NULL
CREATE TABLE [dbo].[case_comments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[author_id] uniqueidentifier NOT NULL,
[body] nvarchar(max) NOT NULL,
[is_internal] bit DEFAULT 0 NOT NULL,
[is_info_request] bit DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_conflicts_of_interest', N'U') IS NULL
CREATE TABLE [dbo].[case_conflicts_of_interest] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[profile_id] uniqueidentifier,
[conflict_type] nvarchar(450) NOT NULL,
[description] nvarchar(max),
[recusal_status] nvarchar(450) DEFAULT N'flagged' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_escalations', N'U') IS NULL
CREATE TABLE [dbo].[case_escalations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[raised_by] uniqueidentifier NOT NULL,
[reason] nvarchar(450) NOT NULL,
[resolved_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_evidence', N'U') IS NULL
CREATE TABLE [dbo].[case_evidence] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[uploaded_by] uniqueidentifier NOT NULL,
[storage_path] nvarchar(450) NOT NULL,
[file_name] nvarchar(450) NOT NULL,
[mime_type] nvarchar(450),
[size_bytes] bigint,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_feedback', N'U') IS NULL
CREATE TABLE [dbo].[case_feedback] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[overall_satisfaction] int,
[response_speed_rating] int,
[resolution_quality_rating] int,
[communication_rating] int,
[fairness_rating] int,
[effort_score] int,
[issue_fully_resolved] bit,
[comments] nvarchar(450),
[submitted_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_handovers', N'U') IS NULL
CREATE TABLE [dbo].[case_handovers] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[student_name] nvarchar(450),
[student_number] nvarchar(450),
[student_email] nvarchar(450),
[service_unit_id] uniqueidentifier,
[unit_name_en] nvarchar(450),
[unit_name_ar] nvarchar(450),
[interaction_type] nvarchar(450),
[summary_en] nvarchar(450),
[summary_ar] nvarchar(450),
[conversation_context] nvarchar(max) DEFAULT N'[]' NOT NULL,
[verified_data] nvarchar(max) DEFAULT N'{}' NOT NULL,
[actions_taken] nvarchar(max) DEFAULT N'[]' NOT NULL,
[unresolved_issue] nvarchar(450),
[recommended_action] nvarchar(450),
[priority] nvarchar(450),
[attachments] nvarchar(max) DEFAULT N'[]' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_information_requests', N'U') IS NULL
CREATE TABLE [dbo].[case_information_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[requested_by] uniqueidentifier,
[information_required] nvarchar(450) NOT NULL,
[reason] nvarchar(450),
[due_at] datetimeoffset,
[accepted_file_types] nvarchar(max),
[pauses_sla] bit DEFAULT 1 NOT NULL,
[reminder_days] int DEFAULT 3 NOT NULL,
[status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[responded_at] datetimeoffset,
[response_note] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_monitor_grants', N'U') IS NULL
CREATE TABLE [dbo].[case_monitor_grants] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[scope] nvarchar(450) DEFAULT N'all_units' NOT NULL,
[unit_ids] nvarchar(max) DEFAULT N'[]' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[granted_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.cases', N'U') IS NULL
CREATE TABLE [dbo].[cases] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_number] nvarchar(256) NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[case_type] nvarchar(64) DEFAULT N'complaint' NOT NULL,
[category_id] uniqueidentifier,
[service_unit_id] uniqueidentifier,
[title] nvarchar(450) NOT NULL,
[description] nvarchar(max) NOT NULL,
[status] nvarchar(64) DEFAULT N'submitted' NOT NULL,
[urgency] nvarchar(64) DEFAULT N'medium' NOT NULL,
[incident_date] date,
[desired_resolution] nvarchar(450),
[confidentiality] nvarchar(450) DEFAULT N'standard' NOT NULL,
[is_sensitive] bit DEFAULT 0 NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[expected_resolution_date] date,
[assigned_to] uniqueidentifier,
[closed_at] datetimeoffset,
[satisfaction_rating] int,
[deleted_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[university_service_id] uniqueidentifier,
[sensitivity_level] nvarchar(450) DEFAULT N'normal' NOT NULL,
[anonymous_requested] bit DEFAULT 0 NOT NULL,
[priority_score] int DEFAULT 50 NOT NULL,
[due_at] datetimeoffset,
[first_response_at] datetimeoffset,
[resolved_at] datetimeoffset,
[ai_summary] nvarchar(450),
[ai_recommended_action] nvarchar(450),
[human_review_required] bit DEFAULT 0 NOT NULL,
[first_response_due_at] datetimeoffset,
[resolution_due_at] datetimeoffset,
[sla_state] nvarchar(450) DEFAULT N'on_track' NOT NULL,
[sla_paused_at] datetimeoffset,
[sla_paused_minutes] int DEFAULT 0 NOT NULL,
[escalation_level] int DEFAULT 0 NOT NULL,
[next_action_en] nvarchar(450),
[next_action_ar] nvarchar(450),
[last_activity_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[closure_reason] nvarchar(450),
[reopened_count] int DEFAULT 0 NOT NULL,
[unread_student_message] bit DEFAULT 0 NOT NULL,
[ai_confidence] numeric,
[related_conversation_id] uniqueidentifier,
[related_internship_assignment_id] uniqueidentifier,
[outcome_en] nvarchar(450),
[outcome_ar] nvarchar(450),
[is_demo] bit DEFAULT 0 NOT NULL,
[student_hidden_at] datetimeoffset,
[student_hidden_by] uniqueidentifier,
[deletion_type] nvarchar(450),
[routing_service_code] nvarchar(450),
[routing_topic] nvarchar(450),
[root_cause_code] nvarchar(450),
[routing_reason_en] nvarchar(450),
[routing_reason_ar] nvarchar(450),
[routing_confidence] numeric,
[severity] nvarchar(450) DEFAULT N'normal' NOT NULL,
[current_responsible_actor] nvarchar(450) DEFAULT N'ai' NOT NULL,
[entry_channel] nvarchar(450) DEFAULT N'chat' NOT NULL,
[alert_type] nvarchar(450),
[alert_location] nvarchar(450),
[acknowledged_at] datetimeoffset,
[escalated_at] datetimeoffset,
[automation_level] nvarchar(450),
[attention_reason] nvarchar(450),
[shortcut_hint] nvarchar(450),
[linked_suggestion_id] uniqueidentifier,
[responsible_since] datetimeoffset,
[response_state] nvarchar(450),
[resolution_communicated_at] datetimeoffset,
[assignment_method] nvarchar(450),
[assigned_at] datetimeoffset,
[workload_at_assignment] numeric,
[needs_assignment_attention] bit DEFAULT 0 NOT NULL,
[structured_details] nvarchar(max),
    CONSTRAINT cases_confidentiality_check CHECK ((confidentiality IN (N'standard', N'confidential', N'anonymous'))),
    CONSTRAINT cases_satisfaction_rating_check CHECK (((satisfaction_rating >= 1) AND (satisfaction_rating <= 5)))

);
GO

IF OBJECT_ID(N'dbo.profiles', N'U') IS NULL
CREATE TABLE [dbo].[profiles] (

[id] uniqueidentifier NOT NULL,
[full_name] nvarchar(450),
[email] nvarchar(450),
[phone] nvarchar(450),
[preferred_language] nvarchar(64) DEFAULT N'en' NOT NULL,
[avatar_url] nvarchar(450),
[deleted_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[is_demo_account] bit DEFAULT 0 NOT NULL,
[access_revoked_at] datetimeoffset,
[access_revoked_by] uniqueidentifier,
[access_revoked_reason] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.service_level_rules', N'U') IS NULL
CREATE TABLE [dbo].[service_level_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_type] nvarchar(64) NOT NULL,
[urgency] nvarchar(64) NOT NULL,
[acknowledge_hours] int DEFAULT 24 NOT NULL,
[resolve_days] int DEFAULT 10 NOT NULL,
[service_unit_id] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[owner_response_hours] int DEFAULT 8 NOT NULL,
[stall_hours] int DEFAULT 24 NOT NULL,
[pause_on_student] bit DEFAULT 1 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_units', N'U') IS NULL
CREATE TABLE [dbo].[service_units] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[department_id] uniqueidentifier,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[email] nvarchar(450),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[university_id] uniqueidentifier,
[college_id] uniqueidentifier,
[contact_email] nvarchar(450),
[phone_extension] nvarchar(450),
[office_location_en] nvarchar(450),
[office_location_ar] nvarchar(450),
[service_hours_en] nvarchar(450),
[service_hours_ar] nvarchar(450),
[escalation_unit_id] uniqueidentifier,
[primary_service_owner_id] uniqueidentifier,
[appointment_enabled] bit DEFAULT 0 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_profiles', N'U') IS NULL
CREATE TABLE [dbo].[student_profiles] (

[user_id] uniqueidentifier NOT NULL,
[student_number] nvarchar(256),
[college] nvarchar(450),
[program] nvarchar(450),
[year_of_study] int,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[preferred_name] nvarchar(450),
[college_id] uniqueidentifier,
[department_id] uniqueidentifier,
[program_id] uniqueidentifier,
[admission_term_id] uniqueidentifier,
[current_academic_term_id] uniqueidentifier,
[academic_level] nvarchar(450),
[completed_credit_hours] int DEFAULT 0 NOT NULL,
[registered_credit_hours] int DEFAULT 0 NOT NULL,
[cumulative_gpa] numeric(3,2),
[academic_standing] nvarchar(450) DEFAULT N'good_standing' NOT NULL,
[expected_graduation_date] date,
[advisor_staff_id] uniqueidentifier,
[residency_status] nvarchar(450),
[scholarship_status] nvarchar(450),
[preferred_language] nvarchar(64) DEFAULT N'en' NOT NULL,
[preferred_notification_channel] nvarchar(450) DEFAULT N'in_app' NOT NULL,
[accessibility_support_required] bit DEFAULT 0 NOT NULL,
[account_status] nvarchar(450) DEFAULT N'active' NOT NULL,
[is_demo_record] bit DEFAULT 1 NOT NULL,
    CONSTRAINT student_profiles_completed_credit_hours_check CHECK ((completed_credit_hours >= 0)),
    CONSTRAINT student_profiles_cumulative_gpa_check CHECK (((cumulative_gpa IS NULL) OR ((cumulative_gpa >= 0) AND (cumulative_gpa <= 4)))),
    CONSTRAINT student_profiles_registered_credit_hours_check CHECK ((registered_credit_hours >= 0)),
    CONSTRAINT student_profiles_year_of_study_check CHECK (((year_of_study >= 1) AND (year_of_study <= 8)))

);
GO

IF OBJECT_ID(N'dbo.case_oversight_actions', N'U') IS NULL
CREATE TABLE [dbo].[case_oversight_actions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[action_type] nvarchar(450) NOT NULL,
[actor_id] uniqueidentifier NOT NULL,
[reason] nvarchar(450),
[previous_unit_id] uniqueidentifier,
[previous_owner_id] uniqueidentifier,
[new_unit_id] uniqueidentifier,
[new_owner_id] uniqueidentifier,
[sla_treatment] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_reopen_requests', N'U') IS NULL
CREATE TABLE [dbo].[case_reopen_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[reason] nvarchar(450) NOT NULL,
[new_evidence] nvarchar(450),
[requested_outcome] nvarchar(450),
[review_decision] nvarchar(450) DEFAULT N'pending' NOT NULL,
[decision_reason] nvarchar(450),
[reviewed_by] uniqueidentifier,
[reviewed_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[kind] nvarchar(450) DEFAULT N'objection' NOT NULL,
[original_status] nvarchar(450),
[original_outcome_en] nvarchar(450),
[original_outcome_ar] nvarchar(450),
[original_decided_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.case_resolutions', N'U') IS NULL
CREATE TABLE [dbo].[case_resolutions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[resolution_type] nvarchar(450) NOT NULL,
[resolution_summary_en] nvarchar(450) NOT NULL,
[resolution_summary_ar] nvarchar(450),
[action_taken] nvarchar(450),
[policy_basis] nvarchar(450),
[compensation_or_remedy] nvarchar(450),
[prepared_by] uniqueidentifier,
[manager_approval_required] bit DEFAULT 0 NOT NULL,
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[proposed_to_student_at] datetimeoffset,
[student_response] nvarchar(450),
[student_response_at] datetimeoffset,
[student_response_comment] nvarchar(450),
[finalized_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_responsibility_history', N'U') IS NULL
CREATE TABLE [dbo].[case_responsibility_history] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[actor] nvarchar(450) NOT NULL,
[actor_user_id] uniqueidentifier,
[service_unit_id] uniqueidentifier,
[reason] nvarchar(450),
[started_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[ended_at] datetimeoffset,
[duration_seconds] int,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_routing_feedback', N'U') IS NULL
CREATE TABLE [dbo].[case_routing_feedback] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[reported_by] uniqueidentifier NOT NULL,
[original_unit_id] uniqueidentifier,
[corrected_unit_id] uniqueidentifier,
[original_service_code] nvarchar(450),
[original_topic] nvarchar(450),
[reason] nvarchar(450) NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.case_sla_events', N'U') IS NULL
CREATE TABLE [dbo].[case_sla_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[event_type] nvarchar(256) NOT NULL,
[threshold_percentage] int,
[triggered_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[acknowledged_by] uniqueidentifier,
[acknowledged_at] datetimeoffset,
[action_taken] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.case_status_history', N'U') IS NULL
CREATE TABLE [dbo].[case_status_history] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[from_status] nvarchar(64),
[to_status] nvarchar(64) NOT NULL,
[note] nvarchar(450),
[changed_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.citations', N'U') IS NULL
CREATE TABLE [dbo].[citations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[message_id] uniqueidentifier,
[user_id] uniqueidentifier NOT NULL,
[document_id] uniqueidentifier,
[source_title] nvarchar(450) NOT NULL,
[owning_unit] nvarchar(450),
[document_version] nvarchar(450),
[effective_date] date,
[citation_url] nvarchar(max),
[confidence] nvarchar(450) DEFAULT N'medium' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT citations_confidence_check CHECK ((confidence IN (N'low', N'medium', N'high', N'unverified')))

);
GO

IF OBJECT_ID(N'dbo.colleges', N'U') IS NULL
CREATE TABLE [dbo].[colleges] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_id] uniqueidentifier NOT NULL,
[campus_id] uniqueidentifier,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[dean_name] nvarchar(450),
[contact_email] nvarchar(450),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.consent_records', N'U') IS NULL
CREATE TABLE [dbo].[consent_records] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[consent_type] nvarchar(450) NOT NULL,
[granted] bit DEFAULT 1 NOT NULL,
[version] nvarchar(450) DEFAULT N'1.0' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.conversation_state', N'U') IS NULL
CREATE TABLE [dbo].[conversation_state] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[conversation_id] uniqueidentifier NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[summary] nvarchar(450),
[active_intents] nvarchar(max) DEFAULT N'[]' NOT NULL,
[extracted_entities] nvarchar(max) DEFAULT N'{}' NOT NULL,
[pending_questions] nvarchar(max) DEFAULT N'[]' NOT NULL,
[pending_action_request_id] uniqueidentifier,
[pending_confirmation_type] nvarchar(450),
[pending_confirmation_payload] nvarchar(max),
[current_service_id] uniqueidentifier,
[current_service_unit_id] uniqueidentifier,
[related_case_id] uniqueidentifier,
[related_suggestion_id] uniqueidentifier,
[last_agent_type] nvarchar(450),
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[human_handoff_state] nvarchar(450) DEFAULT N'none' NOT NULL,
[turn_count] int DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.conversations', N'U') IS NULL
CREATE TABLE [dbo].[conversations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[title] nvarchar(450),
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[archived_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[conversation_status] nvarchar(450) DEFAULT N'active' NOT NULL,
[related_case_id] uniqueidentifier

);
GO

IF OBJECT_ID(N'dbo.course_prerequisites', N'U') IS NULL
CREATE TABLE [dbo].[course_prerequisites] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[course_id] uniqueidentifier NOT NULL,
[prerequisite_course_id] uniqueidentifier NOT NULL,
[minimum_grade] nvarchar(450) DEFAULT N'D' NOT NULL,
[prerequisite_type] nvarchar(450) DEFAULT N'required' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT course_prerequisites_check CHECK ((course_id <> prerequisite_course_id))

);
GO

IF OBJECT_ID(N'dbo.course_sections', N'U') IS NULL
CREATE TABLE [dbo].[course_sections] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[course_id] uniqueidentifier NOT NULL,
[academic_term_id] uniqueidentifier NOT NULL,
[section_number] nvarchar(256) NOT NULL,
[instructor_name] nvarchar(450),
[capacity] int DEFAULT 30 NOT NULL,
[enrolled_count] int DEFAULT 0 NOT NULL,
[meeting_schedule] nvarchar(450),
[room] nvarchar(450),
[status] nvarchar(450) DEFAULT N'open' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT course_sections_capacity_check CHECK ((capacity >= 0)),
    CONSTRAINT course_sections_enrolled_count_check CHECK ((enrolled_count >= 0))

);
GO

IF OBJECT_ID(N'dbo.courses', N'U') IS NULL
CREATE TABLE [dbo].[courses] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[department_id] uniqueidentifier,
[code] nvarchar(256) NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[credit_hours] int DEFAULT 3 NOT NULL,
[course_level] int DEFAULT 100 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT courses_credit_hours_check CHECK ((credit_hours >= 0))

);
GO

IF OBJECT_ID(N'dbo.cv_ats_scores', N'U') IS NULL
CREATE TABLE [dbo].[cv_ats_scores] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[cv_id] uniqueidentifier NOT NULL,
[target_role_id] uniqueidentifier,
[overall_score] int DEFAULT 0 NOT NULL,
[structure_score] int DEFAULT 0 NOT NULL,
[contact_score] int DEFAULT 0 NOT NULL,
[education_score] int DEFAULT 0 NOT NULL,
[skills_score] int DEFAULT 0 NOT NULL,
[experience_project_score] int DEFAULT 0 NOT NULL,
[achievement_score] int DEFAULT 0 NOT NULL,
[keyword_score] int DEFAULT 0 NOT NULL,
[completeness_score] int DEFAULT 0 NOT NULL,
[clarity_score] int DEFAULT 0 NOT NULL,
[strengths] nvarchar(max) DEFAULT N'[]' NOT NULL,
[improvements] nvarchar(max) DEFAULT N'[]' NOT NULL,
[recommended_keywords] nvarchar(max) DEFAULT N'[]' NOT NULL,
[scoring_version] nvarchar(450) DEFAULT N'ats.v1' NOT NULL,
[calculated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[score_kind] nvarchar(256) DEFAULT N'general' NOT NULL,
[role_code] nvarchar(450),
[cv_version] nvarchar(450),
[weights_version] nvarchar(max) DEFAULT N'ats-weights.v1' NOT NULL,
[parsing_confidence] nvarchar(450),
[breakdown] nvarchar(max) DEFAULT N'{}' NOT NULL,
[details] nvarchar(max) DEFAULT N'{}' NOT NULL

);
GO

IF OBJECT_ID(N'dbo.cv_upload_scans', N'U') IS NULL
CREATE TABLE [dbo].[cv_upload_scans] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[cv_id] uniqueidentifier,
[file_name] nvarchar(450) NOT NULL,
[mime_type] nvarchar(450) NOT NULL,
[size_bytes] int DEFAULT 0 NOT NULL,
[sha256] nvarchar(450),
[scan_status] nvarchar(450) DEFAULT N'clean' NOT NULL,
[verdict] nvarchar(450),
[findings] nvarchar(max) DEFAULT N'[]' NOT NULL,
[quarantine_path] nvarchar(450),
[scanner] nvarchar(450) DEFAULT N'sanadi-static-v1' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.data_authority_rules', N'U') IS NULL
CREATE TABLE [dbo].[data_authority_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[data_domain] nvarchar(450) NOT NULL,
[primary_source_type] nvarchar(450) NOT NULL,
[primary_source_id] uniqueidentifier,
[secondary_source_type] nvarchar(450),
[secondary_source_id] uniqueidentifier,
[conflict_behavior] nvarchar(450) DEFAULT N'prefer_primary' NOT NULL,
[cache_allowed] bit DEFAULT 1 NOT NULL,
[maximum_staleness_minutes] int,
[owner_unit_id] uniqueidentifier,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.departments', N'U') IS NULL
CREATE TABLE [dbo].[departments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[college_id] uniqueidentifier,
[chair_name] nvarchar(450),
[contact_email] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.detected_intents', N'U') IS NULL
CREATE TABLE [dbo].[detected_intents] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[message_id] uniqueidentifier NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[intent] nvarchar(450) NOT NULL,
[category] nvarchar(450),
[language] nvarchar(64),
[urgency] nvarchar(64) DEFAULT N'low' NOT NULL,
[sentiment] nvarchar(450),
[required_unit_id] uniqueidentifier,
[requires_auth] bit DEFAULT 1 NOT NULL,
[requires_student_data] bit DEFAULT 0 NOT NULL,
[action_requested] bit DEFAULT 0 NOT NULL,
[requires_human] bit DEFAULT 0 NOT NULL,
[confidence] numeric(4,3),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.document_chunks', N'U') IS NULL
CREATE TABLE [dbo].[document_chunks] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[document_id] uniqueidentifier NOT NULL,
[chunk_index] int NOT NULL,
[content] nvarchar(max) NOT NULL,
[token_count] int,
[embedding_json] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[section_title] nvarchar(450),
[section_path] nvarchar(450),
[page_number] int,
[source_locator] nvarchar(450),
[metadata] nvarchar(max) DEFAULT N'{}' NOT NULL,
[quality_score] numeric,
[is_active] bit DEFAULT 1 NOT NULL,
[search_vector] nvarchar(max) NULL,
[embedding] nvarchar(max)

);
GO

IF OBJECT_ID(N'dbo.document_deletion_records', N'U') IS NULL
CREATE TABLE [dbo].[document_deletion_records] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[document_id] uniqueidentifier NOT NULL,
[reference_number] nvarchar(450) NOT NULL,
[document_type] nvarchar(450) NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[created_at] datetimeoffset NOT NULL,
[deleted_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[deletion_type] nvarchar(450) NOT NULL,
[actor_type] nvarchar(450) DEFAULT N'student' NOT NULL,
[actor_id] uniqueidentifier,
    CONSTRAINT document_deletion_records_deletion_type_check CHECK ((deletion_type IN (N'Student Requested', N'Automatic Retention Expiry', N'Administrator Action')))

);
GO

IF OBJECT_ID(N'dbo.document_events', N'U') IS NULL
CREATE TABLE [dbo].[document_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[document_id] uniqueidentifier,
[reference_number] nvarchar(450),
[event_type] nvarchar(450) NOT NULL,
[actor_type] nvarchar(450) DEFAULT N'system' NOT NULL,
[actor_id] uniqueidentifier,
[details] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.document_retention_policies', N'U') IS NULL
CREATE TABLE [dbo].[document_retention_policies] (

[document_type] nvarchar(450) NOT NULL,
[retention_days] int DEFAULT 30 NOT NULL,
[label_en] nvarchar(450),
[label_ar] nvarchar(450),
[updated_by] uniqueidentifier,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT document_retention_policies_retention_days_check CHECK (((retention_days >= 1) AND (retention_days <= 3650)))

);
GO

IF OBJECT_ID(N'dbo.document_templates', N'U') IS NULL
CREATE TABLE [dbo].[document_templates] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[document_type] nvarchar(256) NOT NULL,
[language] nvarchar(256) NOT NULL,
[version] int DEFAULT 1 NOT NULL,
[status] nvarchar(450) DEFAULT N'approved' NOT NULL,
[title] nvarchar(450) NOT NULL,
[header_text] nvarchar(max),
[body_template] nvarchar(max) NOT NULL,
[footer_text] nvarchar(max),
[signatory_block] nvarchar(max),
[disclaimer] nvarchar(max),
[required_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[optional_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[validity_days] int,
[effective_date] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT document_templates_language_check CHECK ((language IN (N'en', N'ar')))

);
GO

IF OBJECT_ID(N'dbo.document_verification_attempts', N'U') IS NULL
CREATE TABLE [dbo].[document_verification_attempts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[token_hash] nvarchar(450) NOT NULL,
[client_hash] nvarchar(450) NOT NULL,
[outcome] nvarchar(450) NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.document_verification_tombstones', N'U') IS NULL
CREATE TABLE [dbo].[document_verification_tombstones] (

[token_hash] nvarchar(450) NOT NULL,
[reference_number] nvarchar(450),
[reason] nvarchar(450) DEFAULT N'deleted' NOT NULL,
[retired_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.document_versions', N'U') IS NULL
CREATE TABLE [dbo].[document_versions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[document_id] uniqueidentifier NOT NULL,
[version] nvarchar(450) NOT NULL,
[notes] nvarchar(max),
[storage_path] nvarchar(450),
[created_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.email_templates', N'U') IS NULL
CREATE TABLE [dbo].[email_templates] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[template_code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[subject_en] nvarchar(450) NOT NULL,
[subject_ar] nvarchar(450) NOT NULL,
[body_en] nvarchar(max) NOT NULL,
[body_ar] nvarchar(max) NOT NULL,
[cta_label_en] nvarchar(450),
[cta_label_ar] nvarchar(450),
[severity] nvarchar(64) DEFAULT N'important' NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[version] int DEFAULT 1 NOT NULL,
[effective_from] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[effective_to] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.emergency_broadcasts', N'U') IS NULL
CREATE TABLE [dbo].[emergency_broadcasts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[message_en] nvarchar(max) NOT NULL,
[message_ar] nvarchar(max) NOT NULL,
[language_policy] nvarchar(450) DEFAULT N'bilingual' NOT NULL,
[audience] nvarchar(450) DEFAULT N'group' NOT NULL,
[audience_config] nvarchar(max) DEFAULT N'{}' NOT NULL,
[action_url] nvarchar(450),
[status] nvarchar(450) DEFAULT N'draft' NOT NULL,
[requires_approval] bit DEFAULT 1 NOT NULL,
[created_by] uniqueidentifier NOT NULL,
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[sent_at] datetimeoffset,
[recipient_count] int DEFAULT 0 NOT NULL,
[delivered_count] int DEFAULT 0 NOT NULL,
[failed_count] int DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.emergency_contacts', N'U') IS NULL
CREATE TABLE [dbo].[emergency_contacts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(256) NOT NULL,
[label_en] nvarchar(450) NOT NULL,
[label_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[phone] nvarchar(450),
[url] nvarchar(450),
[kind] nvarchar(450) DEFAULT N'university' NOT NULL,
[sort_order] int DEFAULT 100 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[category_en] nvarchar(450),
[category_ar] nvarchar(450),
[emergency_type_en] nvarchar(450),
[emergency_type_ar] nvarchar(450),
[responsible_unit_en] nvarchar(450),
[responsible_unit_ar] nvarchar(450),
[mobile_number] nvarchar(450),
[emergency_number] nvarchar(450),
[email] nvarchar(450),
[notes_en] nvarchar(max),
[notes_ar] nvarchar(max),
[keywords] nvarchar(max) DEFAULT N'[]' NOT NULL,
[priority] int DEFAULT 100 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.escalation_actions', N'U') IS NULL
CREATE TABLE [dbo].[escalation_actions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[escalation_policy_id] uniqueidentifier,
[escalation_level] int DEFAULT 1 NOT NULL,
[previous_unit_id] uniqueidentifier,
[target_unit_id] uniqueidentifier,
[previous_assignee_id] uniqueidentifier,
[new_assignee_id] uniqueidentifier,
[reason] nvarchar(450),
[triggered_by] uniqueidentifier,
[triggered_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[acknowledged_at] datetimeoffset,
[resolved_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.escalation_policies', N'U') IS NULL
CREATE TABLE [dbo].[escalation_policies] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier,
[case_type] nvarchar(64),
[trigger_type] nvarchar(450) NOT NULL,
[trigger_value] nvarchar(450),
[escalation_level] int DEFAULT 1 NOT NULL,
[target_unit_id] uniqueidentifier,
[target_role] nvarchar(64),
[notify_student] bit DEFAULT 1 NOT NULL,
[requires_reason] bit DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.evaluation_equivalence_groups', N'U') IS NULL
CREATE TABLE [dbo].[evaluation_equivalence_groups] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[group_code] nvarchar(256) NOT NULL,
[description] nvarchar(max) NOT NULL,
[expected_core_outcome] nvarchar(max) DEFAULT N'{}' NOT NULL,
[tolerance_rules] nvarchar(max) DEFAULT N'{}' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.evaluation_equivalence_items', N'U') IS NULL
CREATE TABLE [dbo].[evaluation_equivalence_items] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[group_id] uniqueidentifier NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[input_message] nvarchar(max) NOT NULL,
[student_id] uniqueidentifier,
[expected_intent] nvarchar(450),
[expected_tools] nvarchar(max) DEFAULT N'[]' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.evaluation_runs', N'U') IS NULL
CREATE TABLE [dbo].[evaluation_runs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[scenario_id] uniqueidentifier NOT NULL,
[batch_id] uniqueidentifier,
[model_name] nvarchar(450),
[prompt_version] nvarchar(max),
[detected_intents] nvarchar(max) DEFAULT N'[]' NOT NULL,
[tools_used] nvarchar(max) DEFAULT N'[]' NOT NULL,
[actual_outcome_type] nvarchar(450),
[answer_text] nvarchar(max),
[citation_accuracy_score] numeric,
[tool_selection_score] numeric,
[factual_accuracy_score] numeric,
[action_safety_score] numeric,
[language_quality_score] numeric,
[overall_score] numeric,
[passed] bit DEFAULT 0 NOT NULL,
[latency_ms] int,
[run_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.evaluation_scenarios', N'U') IS NULL
CREATE TABLE [dbo].[evaluation_scenarios] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[scenario_code] nvarchar(256) NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[category] nvarchar(450) DEFAULT N'general' NOT NULL,
[student_id] uniqueidentifier,
[input_message] nvarchar(max) NOT NULL,
[expected_intents] nvarchar(max) DEFAULT N'[]' NOT NULL,
[expected_tools] nvarchar(max) DEFAULT N'[]' NOT NULL,
[expected_outcome_type] nvarchar(450) DEFAULT N'answer' NOT NULL,
[expected_service_unit_id] uniqueidentifier,
[expected_risk_level] nvarchar(64) DEFAULT N'level_0' NOT NULL,
[expected_human_handoff] bit DEFAULT 0 NOT NULL,
[notes] nvarchar(max),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[difficulty] nvarchar(450) DEFAULT N'standard',
[risk_tag] nvarchar(450) DEFAULT N'low',
[latency_class] nvarchar(450) DEFAULT N'general_knowledge',
[service_tag] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.exception_events', N'U') IS NULL
CREATE TABLE [dbo].[exception_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(450) NOT NULL,
[severity] nvarchar(450) DEFAULT N'warning' NOT NULL,
[user_id] uniqueidentifier,
[case_id] uniqueidentifier,
[conversation_id] uniqueidentifier,
[detail] nvarchar(450),
[context] nvarchar(max) DEFAULT N'{}' NOT NULL,
[recovered] bit DEFAULT 0 NOT NULL,
[recovery_action] nvarchar(450),
[escalated] bit DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.faq_items', N'U') IS NULL
CREATE TABLE [dbo].[faq_items] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier,
[question_en] nvarchar(max) NOT NULL,
[question_ar] nvarchar(max) NOT NULL,
[answer_en] nvarchar(max) NOT NULL,
[answer_ar] nvarchar(max) NOT NULL,
[document_id] uniqueidentifier,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[university_service_id] uniqueidentifier,
[source_section] nvarchar(450),
[effective_date] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[review_date] date,
[expiry_date] date,
[approval_status] nvarchar(450) DEFAULT N'approved' NOT NULL,
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[priority] int DEFAULT 100 NOT NULL,
[search_keywords] nvarchar(max) DEFAULT N'[]' NOT NULL,
[knowledge_domain] nvarchar(450),
[search_vector] nvarchar(max) NULL

);
GO

IF OBJECT_ID(N'dbo.feedback', N'U') IS NULL
CREATE TABLE [dbo].[feedback] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[message_id] uniqueidentifier,
[case_id] uniqueidentifier,
[was_helpful] bit,
[rating] int,
[comment] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))

);
GO

IF OBJECT_ID(N'dbo.follow_up_policies', N'U') IS NULL
CREATE TABLE [dbo].[follow_up_policies] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[entity_type] nvarchar(450) DEFAULT N'case' NOT NULL,
[case_type] nvarchar(64),
[service_unit_id] uniqueidentifier,
[waiting_state] nvarchar(450) NOT NULL,
[first_reminder_after_hours] int DEFAULT 48 NOT NULL,
[second_reminder_after_hours] int,
[final_reminder_after_hours] int,
[escalation_after_hours] int,
[notify_student] bit DEFAULT 1 NOT NULL,
[notify_owner] bit DEFAULT 0 NOT NULL,
[notify_manager] bit DEFAULT 0 NOT NULL,
[maximum_reminders] int DEFAULT 3 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.grounding_checks', N'U') IS NULL
CREATE TABLE [dbo].[grounding_checks] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[agent_run_id] uniqueidentifier,
[claim_count] int DEFAULT 0 NOT NULL,
[supported_claim_count] int DEFAULT 0 NOT NULL,
[unsupported_claim_count] int DEFAULT 0 NOT NULL,
[citation_count] int DEFAULT 0 NOT NULL,
[invalid_citation_count] int DEFAULT 0 NOT NULL,
[student_data_claim_count] int DEFAULT 0 NOT NULL,
[verified_student_data_claim_count] int DEFAULT 0 NOT NULL,
[grounding_score] numeric DEFAULT 0 NOT NULL,
[passed] bit DEFAULT 0 NOT NULL,
[failure_details] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.hostel_rooms', N'U') IS NULL
CREATE TABLE [dbo].[hostel_rooms] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[hostel_id] uniqueidentifier NOT NULL,
[room_number] nvarchar(256) NOT NULL,
[room_type] nvarchar(450) NOT NULL,
[capacity] int DEFAULT 2 NOT NULL,
[occupied_beds] int DEFAULT 0 NOT NULL,
[available_beds] int DEFAULT 0 NOT NULL,
[floor] int,
[accessibility_enabled] bit DEFAULT 0 NOT NULL,
[status] nvarchar(450) DEFAULT N'available' NOT NULL,
[is_demo_record] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.hostels', N'U') IS NULL
CREATE TABLE [dbo].[hostels] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[gender_category] nvarchar(450) DEFAULT N'male' NOT NULL,
[campus_id] uniqueidentifier,
[location_en] nvarchar(450),
[location_ar] nvarchar(450),
[room_types] nvarchar(max) DEFAULT N'[]' NOT NULL,
[total_capacity] int DEFAULT 0 NOT NULL,
[current_occupancy] int DEFAULT 0 NOT NULL,
[available_capacity] int DEFAULT 0 NOT NULL,
[eligibility_notes_en] nvarchar(max),
[eligibility_notes_ar] nvarchar(max),
[facilities] nvarchar(max) DEFAULT N'[]' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[is_demo_record] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.housing_applications', N'U') IS NULL
CREATE TABLE [dbo].[housing_applications] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[application_number] nvarchar(256) NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[service_id] uniqueidentifier,
[eligibility_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[eligibility_check_result] nvarchar(max) DEFAULT N'{}' NOT NULL,
[preferred_hostel_id] uniqueidentifier,
[preferred_room_type] nvarchar(450),
[proposed_hostel_id] uniqueidentifier,
[proposed_room_id] uniqueidentifier,
[final_hostel_id] uniqueidentifier,
[final_room_id] uniqueidentifier,
[application_status] nvarchar(450) DEFAULT N'draft' NOT NULL,
[student_confirmed_at] datetimeoffset,
[submitted_at] datetimeoffset,
[registered_at] datetimeoffset,
[requires_human_review] bit DEFAULT 0 NOT NULL,
[human_review_reason] nvarchar(450),
[assigned_owner_id] uniqueidentifier,
[agent_run_id] uniqueidentifier,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.housing_eligibility_rules', N'U') IS NULL
CREATE TABLE [dbo].[housing_eligibility_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[rule_name] nvarchar(256) NOT NULL,
[description_en] nvarchar(max) NOT NULL,
[description_ar] nvarchar(max) NOT NULL,
[condition_type] nvarchar(450) NOT NULL,
[condition_value] nvarchar(max) DEFAULT N'{}' NOT NULL,
[mandatory] bit DEFAULT 1 NOT NULL,
[effective_date] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[expiry_date] date,
[priority] int DEFAULT 100 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.housing_waitlist', N'U') IS NULL
CREATE TABLE [dbo].[housing_waitlist] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[housing_application_id] uniqueidentifier,
[preferred_room_type] nvarchar(450),
[preferred_hostel_id] uniqueidentifier,
[priority_score] int DEFAULT 50 NOT NULL,
[waitlist_status] nvarchar(450) DEFAULT N'waiting' NOT NULL,
[joined_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[offered_at] datetimeoffset,
[offer_expires_at] datetimeoffset,
[accepted_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.integration_connectors', N'U') IS NULL
CREATE TABLE [dbo].[integration_connectors] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_name] nvarchar(256) NOT NULL,
[display_name_en] nvarchar(450),
[display_name_ar] nvarchar(450),
[source_system] nvarchar(450) NOT NULL,
[connector_type] nvarchar(450) DEFAULT N'rest_api' NOT NULL,
[environment] nvarchar(256) DEFAULT N'development' NOT NULL,
[base_url] nvarchar(450),
[authentication_type] nvarchar(450) DEFAULT N'none' NOT NULL,
[credential_secret_name] nvarchar(450),
[credential_configured] bit DEFAULT 0 NOT NULL,
[credential_last_tested_at] datetimeoffset,
[credential_expires_at] datetimeoffset,
[owner_unit_id] uniqueidentifier,
[technical_owner] nvarchar(450),
[business_owner] nvarchar(450),
[data_classification] nvarchar(450) DEFAULT N'internal' NOT NULL,
[is_demo] bit DEFAULT 1 NOT NULL,
[read_enabled] bit DEFAULT 1 NOT NULL,
[write_enabled] bit DEFAULT 0 NOT NULL,
[health_status] nvarchar(450) DEFAULT N'healthy' NOT NULL,
[timeout_ms] int DEFAULT 8000 NOT NULL,
[retry_policy] nvarchar(max) DEFAULT N'{"backoff_ms": 250, "max_attempts": 2}' NOT NULL,
[cache_policy] nvarchar(max) DEFAULT N'{"ttl_seconds": 60}' NOT NULL,
[rate_limit_policy] nvarchar(max) DEFAULT N'{"per_minute": 60}' NOT NULL,
[last_health_check_at] datetimeoffset,
[is_active] bit DEFAULT 1 NOT NULL,
[created_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.integration_field_mappings', N'U') IS NULL
CREATE TABLE [dbo].[integration_field_mappings] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_id] uniqueidentifier NOT NULL,
[tool_id] uniqueidentifier,
[external_field] nvarchar(450) NOT NULL,
[internal_field] nvarchar(450) NOT NULL,
[data_type] nvarchar(450) DEFAULT N'string' NOT NULL,
[transformation_rule] nvarchar(450),
[required] bit DEFAULT 0 NOT NULL,
[sensitive] bit DEFAULT 0 NOT NULL,
[masking_rule] nvarchar(450),
[default_value] nvarchar(450),
[validation_rule] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.integration_health_events', N'U') IS NULL
CREATE TABLE [dbo].[integration_health_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_id] uniqueidentifier NOT NULL,
[health_status] nvarchar(450) NOT NULL,
[latency_ms] int,
[error_code] nvarchar(450),
[error_message] nvarchar(max),
[detected_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[resolved_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.integration_schema_versions', N'U') IS NULL
CREATE TABLE [dbo].[integration_schema_versions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_id] uniqueidentifier NOT NULL,
[tool_id] uniqueidentifier,
[schema_hash] nvarchar(max) NOT NULL,
[schema_snapshot] nvarchar(max) DEFAULT N'{}' NOT NULL,
[detected_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[is_current] bit DEFAULT 1 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.integration_test_runs', N'U') IS NULL
CREATE TABLE [dbo].[integration_test_runs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_id] uniqueidentifier NOT NULL,
[tool_id] uniqueidentifier,
[test_type] nvarchar(450) DEFAULT N'connectivity' NOT NULL,
[started_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[completed_at] datetimeoffset,
[status] nvarchar(450) DEFAULT N'running' NOT NULL,
[latency_ms] int,
[schema_valid] bit,
[authorization_valid] bit,
[error_code] nvarchar(450),
[error_message] nvarchar(max),
[response_preview] nvarchar(max),
[run_by] uniqueidentifier

);
GO

IF OBJECT_ID(N'dbo.integration_tools', N'U') IS NULL
CREATE TABLE [dbo].[integration_tools] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_id] uniqueidentifier NOT NULL,
[tool_name] nvarchar(256) NOT NULL,
[display_name_en] nvarchar(450) NOT NULL,
[display_name_ar] nvarchar(450) NOT NULL,
[description] nvarchar(max),
[operation_type] nvarchar(450) DEFAULT N'read' NOT NULL,
[endpoint_path] nvarchar(450),
[http_method] nvarchar(450),
[request_schema] nvarchar(max) DEFAULT N'{}' NOT NULL,
[response_schema] nvarchar(max) DEFAULT N'{}' NOT NULL,
[allowed_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[blocked_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[authentication_required] bit DEFAULT 1 NOT NULL,
[allowed_roles] nvarchar(max) DEFAULT N'["student"]' NOT NULL,
[risk_level] nvarchar(450) DEFAULT N'low' NOT NULL,
[confirmation_required] bit DEFAULT 0 NOT NULL,
[human_approval_required] bit DEFAULT 0 NOT NULL,
[cache_ttl_seconds] int,
[timeout_ms] int DEFAULT 8000 NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.intercollege_transfer_acknowledgements', N'U') IS NULL
CREATE TABLE [dbo].[intercollege_transfer_acknowledgements] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[transfer_request_id] uniqueidentifier NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[credit_loss_accepted] bit DEFAULT 0 NOT NULL,
[gpa_change_accepted] bit DEFAULT 0 NOT NULL,
[graduation_delay_accepted] bit DEFAULT 0 NOT NULL,
[financial_consequence_accepted] bit DEFAULT 0 NOT NULL,
[one_transfer_rule_accepted] bit DEFAULT 0 NOT NULL,
[final_transfer_confirmed] bit DEFAULT 0 NOT NULL,
[terms_version] nvarchar(450) DEFAULT N'ict-terms-v1' NOT NULL,
[acknowledged_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[capacity_accepted] bit DEFAULT 0 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.intercollege_transfer_course_impact', N'U') IS NULL
CREATE TABLE [dbo].[intercollege_transfer_course_impact] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[transfer_request_id] uniqueidentifier NOT NULL,
[source_course_id] uniqueidentifier,
[source_course_code] nvarchar(450) NOT NULL,
[course_title] nvarchar(450) NOT NULL,
[course_title_ar] nvarchar(450),
[original_credit_hours] int DEFAULT 0 NOT NULL,
[grade] nvarchar(450),
[target_course_id] uniqueidentifier,
[target_course_code] nvarchar(450),
[impact_type] nvarchar(450) NOT NULL,
[credits_accepted] int DEFAULT 0 NOT NULL,
[counts_toward_degree] bit DEFAULT 0 NOT NULL,
[impact_reason_en] nvarchar(450),
[impact_reason_ar] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT intercollege_transfer_course_impact_impact_type_check CHECK ((impact_type IN (N'counts_core', N'counts_elective', N'not_applicable', N'manual_review')))

);
GO

IF OBJECT_ID(N'dbo.internship_assignment_audit', N'U') IS NULL
CREATE TABLE [dbo].[internship_assignment_audit] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[assignment_id] uniqueidentifier,
[student_id] uniqueidentifier NOT NULL,
[event_type] nvarchar(450) NOT NULL,
[actor_type] nvarchar(450) DEFAULT N'agent' NOT NULL,
[actor_id] uniqueidentifier,
[details] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.internship_match_explanations', N'U') IS NULL
CREATE TABLE [dbo].[internship_match_explanations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[opportunity_id] uniqueidentifier NOT NULL,
[weights_version] int,
[total_match_score] numeric(5,2) DEFAULT 0 NOT NULL,
[programme_score] numeric(5,2) DEFAULT 0 NOT NULL,
[skills_course_score] numeric(5,2) DEFAULT 0 NOT NULL,
[gpa_score] numeric(5,2) DEFAULT 0 NOT NULL,
[location_score] numeric(5,2) DEFAULT 0 NOT NULL,
[preference_score] numeric(5,2) DEFAULT 0 NOT NULL,
[other_score] numeric(5,2) DEFAULT 0 NOT NULL,
[eligibility_passed] bit DEFAULT 1 NOT NULL,
[exclusion_reason] nvarchar(450),
[explanation_en] nvarchar(450),
[explanation_ar] nvarchar(450),
[calculated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.internship_matching_weights', N'U') IS NULL
CREATE TABLE [dbo].[internship_matching_weights] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[version] int DEFAULT 1 NOT NULL,
[programme_fit_weight] numeric(5,2) DEFAULT 35 NOT NULL,
[skills_course_weight] numeric(5,2) DEFAULT 25 NOT NULL,
[gpa_weight] numeric(5,2) DEFAULT 15 NOT NULL,
[location_weight] numeric(5,2) DEFAULT 10 NOT NULL,
[preference_weight] numeric(5,2) DEFAULT 10 NOT NULL,
[other_weight] numeric(5,2) DEFAULT 5 NOT NULL,
[effective_from] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[approved_by] uniqueidentifier,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT internship_weights_total_100 CHECK (((((((programme_fit_weight + skills_course_weight) + gpa_weight) + location_weight) + preference_weight) + other_weight) = 100))

);
GO

IF OBJECT_ID(N'dbo.internship_opportunities', N'U') IS NULL
CREATE TABLE [dbo].[internship_opportunities] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[organization_id] uniqueidentifier NOT NULL,
[opportunity_code] nvarchar(256) NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[field_category] nvarchar(450) DEFAULT N'General' NOT NULL,
[target_programs] nvarchar(max) DEFAULT N'[]' NOT NULL,
[target_departments] nvarchar(max) DEFAULT N'[]' NOT NULL,
[minimum_gpa] numeric(3,2),
[minimum_completed_credits] int,
[required_courses] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_courses] nvarchar(max) DEFAULT N'[]' NOT NULL,
[required_skills] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_skills] nvarchar(max) DEFAULT N'[]' NOT NULL,
[location_emirate] nvarchar(450) DEFAULT N'Abu Dhabi' NOT NULL,
[location_city] nvarchar(450) DEFAULT N'Abu Dhabi' NOT NULL,
[work_mode] nvarchar(450) DEFAULT N'on_site' NOT NULL,
[sector_preference] nvarchar(450),
[start_date] date NOT NULL,
[end_date] date NOT NULL,
[total_seats] int DEFAULT 1 NOT NULL,
[reserved_seats] int DEFAULT 0 NOT NULL,
[assigned_seats] int DEFAULT 0 NOT NULL,
[available_seats] int NULL,
[application_deadline] date,
[requires_employer_review] bit DEFAULT 0 NOT NULL,
[preapproved_allocation] bit DEFAULT 1 NOT NULL,
[student_choice_allowed] bit DEFAULT 1 NOT NULL,
[internship_course_id] uniqueidentifier,
[active_status] nvarchar(450) DEFAULT N'active' NOT NULL,
[is_demo_record] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT internship_opportunities_assigned_seats_check CHECK ((assigned_seats >= 0)),
    CONSTRAINT internship_opportunities_reserved_seats_check CHECK ((reserved_seats >= 0)),
    CONSTRAINT internship_opportunities_total_seats_check CHECK ((total_seats >= 0)),
    CONSTRAINT internship_seats_not_oversubscribed CHECK (((reserved_seats + assigned_seats) <= total_seats))

);
GO

IF OBJECT_ID(N'dbo.internship_organizations', N'U') IS NULL
CREATE TABLE [dbo].[internship_organizations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[organization_code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[sector_type] nvarchar(450) DEFAULT N'Other' NOT NULL,
[organization_type] nvarchar(450) DEFAULT N'Employer' NOT NULL,
[emirate] nvarchar(450) DEFAULT N'Abu Dhabi' NOT NULL,
[city] nvarchar(450) DEFAULT N'Abu Dhabi' NOT NULL,
[location_en] nvarchar(450),
[location_ar] nvarchar(450),
[website_demo_url] nvarchar(450),
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[is_approved] bit DEFAULT 1 NOT NULL,
[approval_status] nvarchar(450) DEFAULT N'approved' NOT NULL,
[active_from] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[active_to] date,
[owner_unit_id] uniqueidentifier,
[is_demo_record] bit DEFAULT 1 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.internship_waitlist', N'U') IS NULL
CREATE TABLE [dbo].[internship_waitlist] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[preferred_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_locations] nvarchar(max) DEFAULT N'[]' NOT NULL,
[minimum_match_score] numeric(5,2) DEFAULT 50 NOT NULL,
[priority_score] numeric(6,2) DEFAULT 0 NOT NULL,
[status] nvarchar(450) DEFAULT N'waiting' NOT NULL,
[joined_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[offered_opportunity_id] uniqueidentifier,
[offer_created_at] datetimeoffset,
[offer_expires_at] datetimeoffset,
[accepted_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.issued_documents', N'U') IS NULL
CREATE TABLE [dbo].[issued_documents] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[document_type] nvarchar(450) DEFAULT N'to_whom_it_may_concern' NOT NULL,
[reference_number] nvarchar(256) NOT NULL,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[purpose] nvarchar(450) DEFAULT N'general' NOT NULL,
[document_status] nvarchar(450) DEFAULT N'valid' NOT NULL,
[title_en] nvarchar(450) DEFAULT N'To Whom It May Concern' NOT NULL,
[title_ar] nvarchar(450) DEFAULT N'إلى من يهمه الأمر' NOT NULL,
[file_path] nvarchar(450),
[file_size_bytes] int,
[secure_verification_token] nvarchar(256) NOT NULL,
[document_hash] nvarchar(450),
[document_version] int DEFAULT 1 NOT NULL,
[template_id] uniqueidentifier,
[template_version] nvarchar(max),
[included_fields] nvarchar(max) DEFAULT N'{}' NOT NULL,
[snapshot] nvarchar(max) DEFAULT N'{}' NOT NULL,
[generated_by_type] nvarchar(450) DEFAULT N'agent' NOT NULL,
[generated_by_agent_run_id] uniqueidentifier,
[conversation_id] uniqueidentifier,
[issued_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[expires_at] datetimeoffset,
[revoked_at] datetimeoffset,
[revoked_by] uniqueidentifier,
[revocation_reason] nvarchar(450),
[superseded_by] uniqueidentifier,
[digitally_signed] bit DEFAULT 0 NOT NULL,
[signing_provider] nvarchar(450),
[certificate_id] nvarchar(450),
[signed_at] datetimeoffset,
[signature_hash] nvarchar(450),
[is_demo_document] bit DEFAULT 1 NOT NULL,
[download_count] int DEFAULT 0 NOT NULL,
[verification_count] int DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[retention_expires_at] datetimeoffset,
[deleted_at] datetimeoffset,
[deleted_by] uniqueidentifier,
[deletion_reason] nvarchar(450),
[verification_revoked_at] datetimeoffset,
[verification_status] nvarchar(450) DEFAULT N'active' NOT NULL,
[message_id] uniqueidentifier

);
GO

IF OBJECT_ID(N'dbo.knowledge_approval_requests', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_approval_requests] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[entity_type] nvarchar(450) NOT NULL,
[entity_id] uniqueidentifier NOT NULL,
[entity_label] nvarchar(450),
[requested_by] uniqueidentifier NOT NULL,
[assigned_approver_id] uniqueidentifier,
[assigned_approver_role] nvarchar(450) DEFAULT N'knowledge_approver' NOT NULL,
[approval_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[review_notes] nvarchar(max),
[requested_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[due_at] datetimeoffset,
[decided_at] datetimeoffset,
[decided_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.knowledge_audit_log', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_audit_log] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[actor_id] uniqueidentifier,
[action] nvarchar(450) NOT NULL,
[entity_type] nvarchar(450) NOT NULL,
[entity_id] uniqueidentifier,
[summary] nvarchar(450),
[details] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.knowledge_conflicts', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_conflicts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[conflict_type] nvarchar(450) DEFAULT N'contradiction' NOT NULL,
[source_one_type] nvarchar(450) NOT NULL,
[source_one_id] uniqueidentifier,
[source_two_type] nvarchar(450) NOT NULL,
[source_two_id] uniqueidentifier,
[affected_topic] nvarchar(450) NOT NULL,
[conflicting_statement_one] nvarchar(450),
[conflicting_statement_two] nvarchar(450),
[severity] nvarchar(450) DEFAULT N'medium' NOT NULL,
[detected_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[assigned_unit_id] uniqueidentifier,
[resolution_status] nvarchar(450) DEFAULT N'open' NOT NULL,
[resolved_by] uniqueidentifier,
[resolved_at] datetimeoffset,
[resolution_notes] nvarchar(max)

);
GO

IF OBJECT_ID(N'dbo.knowledge_document_categories', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_document_categories] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[sort_order] int DEFAULT 100 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.knowledge_documents', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_documents] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[source_id] uniqueidentifier,
[service_unit_id] uniqueidentifier,
[title] nvarchar(450) NOT NULL,
[description] nvarchar(max),
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[document_type] nvarchar(450) DEFAULT N'policy' NOT NULL,
[version] nvarchar(450) DEFAULT N'1.0' NOT NULL,
[effective_date] date,
[review_date] date,
[is_official] bit DEFAULT 0 NOT NULL,
[confidentiality] nvarchar(450) DEFAULT N'public' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[approval_status] nvarchar(450) DEFAULT N'draft' NOT NULL,
[chunking_status] nvarchar(64) DEFAULT N'pending' NOT NULL,
[embedding_status] nvarchar(64) DEFAULT N'pending' NOT NULL,
[indexing_status] nvarchar(64) DEFAULT N'pending' NOT NULL,
[storage_path] nvarchar(450),
[citation_url] nvarchar(max),
[created_by] uniqueidentifier,
[deleted_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[category_id] uniqueidentifier,
[owner_unit_id] uniqueidentifier,
[authoritative_language] nvarchar(450) DEFAULT N'en' NOT NULL,
[official_status] nvarchar(450) DEFAULT N'official' NOT NULL,
[confidentiality_level] nvarchar(450) DEFAULT N'student_authenticated' NOT NULL,
[expiry_date] date,
[file_name] nvarchar(450),
[file_size_bytes] bigint,
[mime_type] nvarchar(450),
[checksum] nvarchar(450),
[extraction_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[extraction_error] nvarchar(450),
[detected_language] nvarchar(450),
[quality_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[quality_issues] nvarchar(max) DEFAULT N'[]' NOT NULL,
[processing_status] nvarchar(450) DEFAULT N'uploaded' NOT NULL,
[approved_by] uniqueidentifier,
[approved_at] datetimeoffset,
[published_at] datetimeoffset,
[retired_at] datetimeoffset,
[retirement_reason] nvarchar(450),
[supersedes_document_id] uniqueidentifier,
[superseded_by_document_id] uniqueidentifier,
[is_current] bit DEFAULT 0 NOT NULL,
[intended_audience] nvarchar(450) DEFAULT N'students' NOT NULL,
[tags] nvarchar(max) DEFAULT N'[]' NOT NULL,
[notes] nvarchar(max),
[usage_count] int DEFAULT 0 NOT NULL,
[knowledge_domain] nvarchar(450),
    CONSTRAINT knowledge_documents_approval_status_check CHECK ((approval_status IN (N'draft', N'pending_review', N'approved', N'published', N'rejected', N'needs_revision', N'superseded', N'retired'))),
    CONSTRAINT knowledge_documents_confidentiality_check CHECK ((confidentiality IN (N'public', N'internal', N'restricted')))

);
GO

IF OBJECT_ID(N'dbo.knowledge_gaps', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_gaps] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[normalized_topic] nvarchar(450) NOT NULL,
[sample_questions] nvarchar(max) DEFAULT N'[]' NOT NULL,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[occurrence_count] int DEFAULT 1 NOT NULL,
[affected_services] nvarchar(max) DEFAULT N'[]' NOT NULL,
[affected_units] nvarchar(max) DEFAULT N'[]' NOT NULL,
[average_confidence] numeric,
[human_handoff_count] int DEFAULT 0 NOT NULL,
[negative_feedback_count] int DEFAULT 0 NOT NULL,
[recommended_source_type] nvarchar(450),
[priority_score] numeric DEFAULT 0 NOT NULL,
[status] nvarchar(450) DEFAULT N'detected' NOT NULL,
[assigned_to] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.knowledge_issue_reports', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_issue_reports] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[source_type] nvarchar(450) NOT NULL,
[source_id] uniqueidentifier,
[reported_by] uniqueidentifier NOT NULL,
[issue_type] nvarchar(450) NOT NULL,
[description] nvarchar(max),
[related_conversation_id] uniqueidentifier,
[priority] nvarchar(450) DEFAULT N'medium' NOT NULL,
[status] nvarchar(450) DEFAULT N'open' NOT NULL,
[assigned_to] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[resolved_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.knowledge_retrieval_logs', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_retrieval_logs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[conversation_id] uniqueidentifier,
[message_id] uniqueidentifier,
[source_type] nvarchar(450) NOT NULL,
[source_id] uniqueidentifier,
[chunk_id] uniqueidentifier,
[retrieval_score] numeric,
[authority_score] numeric,
[selected_for_response] bit DEFAULT 0 NOT NULL,
[citation_used] bit DEFAULT 0 NOT NULL,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[retrieved_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[trace_id] nvarchar(450),
[query_text] nvarchar(450),
[knowledge_domain] nvarchar(450),
[retrieval_duration_ms] int,
[candidate_count] int,
[selected_count] int,
[grounding_status] nvarchar(450),
[knowledge_version] nvarchar(450),
[source_title] nvarchar(450),
[section_title] nvarchar(450),
[effective_date] date,
[rank_position] int,
[lexical_score] numeric,
[fuzzy_score] numeric

);
GO

IF OBJECT_ID(N'dbo.knowledge_sources', N'U') IS NULL
CREATE TABLE [dbo].[knowledge_sources] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[service_unit_id] uniqueidentifier,
[source_url] nvarchar(450),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.library_hours_exceptions', N'U') IS NULL
CREATE TABLE [dbo].[library_hours_exceptions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[library_location_id] uniqueidentifier NOT NULL,
[exception_date] date NOT NULL,
[opens_at] time,
[closes_at] time,
[closed] bit DEFAULT 1 NOT NULL,
[reason_en] nvarchar(450),
[reason_ar] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.library_locations', N'U') IS NULL
CREATE TABLE [dbo].[library_locations] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[campus_en] nvarchar(450),
[campus_ar] nvarchar(450),
[building_en] nvarchar(450),
[building_ar] nvarchar(450),
[contact_email] nvarchar(450),
[contact_phone] nvarchar(450),
[map_url] nvarchar(450),
[timezone] nvarchar(450) DEFAULT N'Asia/Dubai' NOT NULL,
[sort_order] int DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.library_opening_hours', N'U') IS NULL
CREATE TABLE [dbo].[library_opening_hours] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[library_location_id] uniqueidentifier NOT NULL,
[day_of_week] int NOT NULL,
[opens_at] time,
[closes_at] time,
[closed] bit DEFAULT 0 NOT NULL,
[audience_type] nvarchar(450) DEFAULT N'all' NOT NULL,
[effective_from] date,
[effective_to] date,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT library_opening_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))

);
GO

IF OBJECT_ID(N'dbo.library_provider_settings', N'U') IS NULL
CREATE TABLE [dbo].[library_provider_settings] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[provider_key] nvarchar(256) NOT NULL,
[provider_name] nvarchar(450) NOT NULL,
[base_url] nvarchar(450),
[auth_method] nvarchar(450) DEFAULT N'header_api_key' NOT NULL,
[auth_header_name] nvarchar(max) DEFAULT N'X-API-Key' NOT NULL,
[auth_query_param] nvarchar(450),
[api_key_secret_name] nvarchar(450) DEFAULT N'LIBRARY_API_KEY' NOT NULL,
[extra_headers] nvarchar(max) DEFAULT N'{}' NOT NULL,
[search_path] nvarchar(450),
[item_path] nvarchar(450),
[availability_path] nvarchar(450),
[location_path] nvarchar(450),
[eaccess_path] nvarchar(450),
[library_client_id] nvarchar(450),
[library_client_secret] nvarchar(450),
[catalogue_url_template] nvarchar(max),
[query_param_map] nvarchar(max) DEFAULT N'{}' NOT NULL,
[response_map] nvarchar(max) DEFAULT N'{}' NOT NULL,
[timeout_ms] int DEFAULT 6000 NOT NULL,
[max_retries] int DEFAULT 1 NOT NULL,
[enabled] bit DEFAULT 0 NOT NULL,
[health_status] nvarchar(450) DEFAULT N'unknown' NOT NULL,
[last_success_at] datetimeoffset,
[last_error] nvarchar(450),
[last_error_at] datetimeoffset,
[last_latency_ms] int,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.library_search_events', N'U') IS NULL
CREATE TABLE [dbo].[library_search_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier,
[search_type] nvarchar(450) DEFAULT N'keyword' NOT NULL,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[query_terms] nvarchar(450),
[result_count] int DEFAULT 0 NOT NULL,
[zero_results] bit DEFAULT 0 NOT NULL,
[provider_status] nvarchar(450) DEFAULT N'success' NOT NULL,
[provider_latency_ms] int,
[error_code] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.library_services', N'U') IS NULL
CREATE TABLE [dbo].[library_services] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_key] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[eligibility_en] nvarchar(450),
[eligibility_ar] nvarchar(450),
[instructions_en] nvarchar(max),
[instructions_ar] nvarchar(max),
[availability_en] nvarchar(450),
[availability_ar] nvarchar(450),
[library_location_id] uniqueidentifier,
[url] nvarchar(450),
[contact] nvarchar(450),
[category] nvarchar(450) DEFAULT N'general' NOT NULL,
[sort_order] int DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.message_attachments', N'U') IS NULL
CREATE TABLE [dbo].[message_attachments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[message_id] uniqueidentifier NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[storage_path] nvarchar(450) NOT NULL,
[file_name] nvarchar(450) NOT NULL,
[mime_type] nvarchar(450),
[size_bytes] bigint,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.messages', N'U') IS NULL
CREATE TABLE [dbo].[messages] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[conversation_id] uniqueidentifier NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[role] nvarchar(450) NOT NULL,
[content] nvarchar(max) NOT NULL,
[language] nvarchar(64),
[metadata] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT messages_role_check CHECK ((role IN (N'user', N'assistant', N'system')))

);
GO

IF OBJECT_ID(N'dbo.model_routing_rules', N'U') IS NULL
CREATE TABLE [dbo].[model_routing_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[task_type] nvarchar(256) NOT NULL,
[complexity_level] nvarchar(256) DEFAULT N'simple' NOT NULL,
[preferred_provider] nvarchar(450) DEFAULT N'lovable' NOT NULL,
[preferred_model] nvarchar(450) NOT NULL,
[fallback_model] nvarchar(450),
[maximum_input_tokens] int DEFAULT 8000 NOT NULL,
[maximum_output_tokens] int DEFAULT 1200 NOT NULL,
[timeout_ms] int DEFAULT 20000 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.notification_delivery_logs', N'U') IS NULL
CREATE TABLE [dbo].[notification_delivery_logs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[channel] nvarchar(450) NOT NULL,
[subject] nvarchar(450),
[status] nvarchar(450) DEFAULT N'queued' NOT NULL,
[alert_id] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[student_alert_id] uniqueidentifier,
[recipient_masked] nvarchar(450),
[provider_response] nvarchar(max),
[attempted_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[delivered_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.notification_dispatch_state', N'U') IS NULL
CREATE TABLE [dbo].[notification_dispatch_state] (

[id] bit DEFAULT 1 NOT NULL,
[lease_until] datetimeoffset,
[last_run_at] datetimeoffset,
[paused] bit DEFAULT 0 NOT NULL,
[pause_reason] nvarchar(450),
[paused_at] datetimeoffset,
[consecutive_failures] int DEFAULT 0 NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[sender_domain_status] nvarchar(450) DEFAULT N'unknown' NOT NULL,
[sender_domain_reason] nvarchar(450),
[sender_domain_checked_at] datetimeoffset,
    CONSTRAINT notification_dispatch_state_id_check CHECK (id = 1)

);
GO

IF OBJECT_ID(N'dbo.notification_event_types', N'U') IS NULL
CREATE TABLE [dbo].[notification_event_types] (

[event_type] nvarchar(450) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[severity] nvarchar(64) DEFAULT N'normal' NOT NULL,
[category] nvarchar(450) DEFAULT N'general' NOT NULL,
[audience] nvarchar(450) DEFAULT N'student' NOT NULL,
[email_enabled] bit DEFAULT 0 NOT NULL,
[student_optional] bit DEFAULT 1 NOT NULL,
[digest_eligible] bit DEFAULT 0 NOT NULL,
[admin_group_code] nvarchar(450),
[template_code] nvarchar(max),
[throttle_seconds] int DEFAULT 0 NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.notification_events', N'U') IS NULL
CREATE TABLE [dbo].[notification_events] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[event_type] nvarchar(450) NOT NULL,
[entity_type] nvarchar(450) NOT NULL,
[entity_id] uniqueidentifier,
[recipient_profile_id] uniqueidentifier,
[template_id] uniqueidentifier,
[channel] nvarchar(450) DEFAULT N'in_app' NOT NULL,
[title] nvarchar(450),
[body] nvarchar(max),
[action_url] nvarchar(450),
[payload] nvarchar(max) DEFAULT N'{}' NOT NULL,
[scheduled_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[processed_at] datetimeoffset,
[read_at] datetimeoffset,
[status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[retry_count] int DEFAULT 0 NOT NULL,
[dedupe_key] nvarchar(256),
[error_message] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[severity] nvarchar(64) DEFAULT N'normal' NOT NULL,
[case_id] uniqueidentifier,
[service_unit_id] uniqueidentifier,
[triggered_by] uniqueidentifier

);
GO

IF OBJECT_ID(N'dbo.notification_group_members', N'U') IS NULL
CREATE TABLE [dbo].[notification_group_members] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[group_code] nvarchar(256) NOT NULL,
[user_id] uniqueidentifier,
[email] nvarchar(256),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT notification_group_members_check CHECK (((user_id IS NOT NULL) OR (email IS NOT NULL)))

);
GO

IF OBJECT_ID(N'dbo.notification_groups', N'U') IS NULL
CREATE TABLE [dbo].[notification_groups] (

[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[description] nvarchar(max),
[is_emergency] bit DEFAULT 0 NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.notification_preferences', N'U') IS NULL
CREATE TABLE [dbo].[notification_preferences] (

[user_id] uniqueidentifier NOT NULL,
[in_app] bit DEFAULT 1 NOT NULL,
[email] bit DEFAULT 1 NOT NULL,
[sms] bit DEFAULT 0 NOT NULL,
[push] bit DEFAULT 0 NOT NULL,
[categories] nvarchar(max) DEFAULT N'["academic","finance","housing","general"]' NOT NULL,
[quiet_hours_start] time,
[quiet_hours_end] time,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[optional_email_categories] nvarchar(max) DEFAULT N'["service_updates","career","reminders","library","informational"]' NOT NULL,
[digest_enabled] bit DEFAULT 1 NOT NULL,
[immediate_critical] bit DEFAULT 1 NOT NULL,
[sla_warning_email] bit DEFAULT 1 NOT NULL,
[assignment_email] bit DEFAULT 1 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.notification_settings', N'U') IS NULL
CREATE TABLE [dbo].[notification_settings] (

[id] bit DEFAULT 1 NOT NULL,
[emails_enabled] bit DEFAULT 1 NOT NULL,
[public_app_url] nvarchar(450) DEFAULT N'https://sanadi.online' NOT NULL,
[sender_name] nvarchar(450) DEFAULT N'Sanadi' NOT NULL,
[demo_email_mode] bit DEFAULT 1 NOT NULL,
[demo_redirect_email] nvarchar(450),
[digest_enabled] bit DEFAULT 1 NOT NULL,
[digest_hour] int DEFAULT 7 NOT NULL,
[max_retries] int DEFAULT 3 NOT NULL,
[batch_size] int DEFAULT 25 NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT notification_settings_id_check CHECK (id = 1)

);
GO

IF OBJECT_ID(N'dbo.notification_templates', N'U') IS NULL
CREATE TABLE [dbo].[notification_templates] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[event_type] nvarchar(256) NOT NULL,
[channel] nvarchar(256) DEFAULT N'in_app' NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[subject_template] nvarchar(max) NOT NULL,
[body_template] nvarchar(max) NOT NULL,
[action_label_template] nvarchar(max),
[is_active] bit DEFAULT 1 NOT NULL,
[version] int DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.operation_idempotency', N'U') IS NULL
CREATE TABLE [dbo].[operation_idempotency] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[idempotency_key] nvarchar(256) NOT NULL,
[operation_type] nvarchar(450) NOT NULL,
[user_profile_id] uniqueidentifier,
[request_hash] nvarchar(450) NOT NULL,
[entity_type] nvarchar(450),
[entity_id] uniqueidentifier,
[status] nvarchar(450) DEFAULT N'in_progress' NOT NULL,
[response_snapshot] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[expires_at] datetimeoffset DEFAULT DATEADD(day, 7, SYSDATETIMEOFFSET()) NOT NULL

);
GO

IF OBJECT_ID(N'dbo.operational_insights', N'U') IS NULL
CREATE TABLE [dbo].[operational_insights] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[insight_type] nvarchar(450) NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450),
[summary_en] nvarchar(450),
[summary_ar] nvarchar(450),
[supporting_metrics] nvarchar(max) DEFAULT N'{}' NOT NULL,
[affected_units] nvarchar(max) DEFAULT N'[]' NOT NULL,
[confidence_score] numeric,
[recommended_action_en] nvarchar(450),
[recommended_action_ar] nvarchar(450),
[generated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[reviewed_by] uniqueidentifier,
[review_status] nvarchar(450) DEFAULT N'ai_generated' NOT NULL,
[linked_improvement_id] uniqueidentifier

);
GO

IF OBJECT_ID(N'dbo.performance_budgets', N'U') IS NULL
CREATE TABLE [dbo].[performance_budgets] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[response_category] nvarchar(256) NOT NULL,
[label_en] nvarchar(450) NOT NULL,
[label_ar] nvarchar(450) NOT NULL,
[budget_ms] int NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.pilot_test_sessions', N'U') IS NULL
CREATE TABLE [dbo].[pilot_test_sessions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_service_id] uniqueidentifier,
[service_label] nvarchar(450),
[participant_role] nvarchar(450) NOT NULL,
[participant_count] int DEFAULT 1 NOT NULL,
[tested_on] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[completed_successfully] bit DEFAULT 0 NOT NULL,
[time_taken_minutes] numeric,
[issues] nvarchar(450),
[satisfaction_rating] int,
[comments] nvarchar(450),
[recorded_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT pilot_test_sessions_rating_range CHECK (((satisfaction_rating IS NULL) OR ((satisfaction_rating >= 1) AND (satisfaction_rating <= 5))))

);
GO

IF OBJECT_ID(N'dbo.program_basket_courses', N'U') IS NULL
CREATE TABLE [dbo].[program_basket_courses] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[basket_id] uniqueidentifier NOT NULL,
[course_id] uniqueidentifier NOT NULL,
[category_label] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.program_courses', N'U') IS NULL
CREATE TABLE [dbo].[program_courses] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[program_id] uniqueidentifier NOT NULL,
[course_id] uniqueidentifier NOT NULL,
[requirement_type] nvarchar(450) DEFAULT N'major_required' NOT NULL,
[recommended_year] int,
[recommended_semester] int,
[is_required] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.program_requirement_baskets', N'U') IS NULL
CREATE TABLE [dbo].[program_requirement_baskets] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[program_id] uniqueidentifier NOT NULL,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[basket_type] nvarchar(450) NOT NULL,
[required_credit_hours] int NOT NULL,
[required_course_count] int NOT NULL,
[effective_catalog_year] nvarchar(256) NOT NULL,
[max_credit_hours_per_category] int,
[selection_note_en] nvarchar(450),
[selection_note_ar] nvarchar(450),
[course_list_verified] bit DEFAULT 1 NOT NULL,
[source_url] nvarchar(450),
[display_order] int DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.programme_course_equivalencies', N'U') IS NULL
CREATE TABLE [dbo].[programme_course_equivalencies] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[source_programme_id] uniqueidentifier NOT NULL,
[source_course_id] uniqueidentifier NOT NULL,
[target_programme_id] uniqueidentifier NOT NULL,
[target_course_id] uniqueidentifier,
[equivalency_type] nvarchar(450) NOT NULL,
[credit_hours_accepted] int DEFAULT 0 NOT NULL,
[counts_as_core] bit DEFAULT 0 NOT NULL,
[counts_as_elective] bit DEFAULT 0 NOT NULL,
[counts_toward_degree] bit DEFAULT 0 NOT NULL,
[approved_status] nvarchar(450) DEFAULT N'approved' NOT NULL,
[effective_from] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[effective_to] date,
[notes] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[rule_version] nvarchar(450) DEFAULT N'ict-equiv-v1' NOT NULL,
    CONSTRAINT programme_course_equivalencies_approved_status_check CHECK ((approved_status IN (N'draft', N'approved', N'retired'))),
    CONSTRAINT programme_course_equivalencies_equivalency_type_check CHECK ((equivalency_type IN (N'direct_equivalent', N'accepted_as_elective', N'partial_credit', N'not_transferable', N'manual_review_required')))

);
GO

IF OBJECT_ID(N'dbo.programme_transfer_capacity', N'U') IS NULL
CREATE TABLE [dbo].[programme_transfer_capacity] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[programme_id] uniqueidentifier NOT NULL,
[academic_term_id] uniqueidentifier,
[total_transfer_seats] int DEFAULT 4 NOT NULL,
[reserved_transfer_seats] int DEFAULT 0 NOT NULL,
[assigned_transfer_seats] int DEFAULT 0 NOT NULL,
[available_transfer_seats] int NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[is_demo_record] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.quality_targets', N'U') IS NULL
CREATE TABLE [dbo].[quality_targets] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[metric_key] nvarchar(256) NOT NULL,
[label_en] nvarchar(450) NOT NULL,
[label_ar] nvarchar(450) NOT NULL,
[target_value] numeric NOT NULL,
[comparator] nvarchar(450) DEFAULT N'gte' NOT NULL,
[unit] nvarchar(450) DEFAULT N'percent' NOT NULL,
[measured_value] numeric,
[measured_at] datetimeoffset,
[sample_size] int,
[is_critical] bit DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.release_readiness', N'U') IS NULL
CREATE TABLE [dbo].[release_readiness] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[gate_key] nvarchar(256) NOT NULL,
[label_en] nvarchar(450) NOT NULL,
[label_ar] nvarchar(450) NOT NULL,
[status] nvarchar(450) DEFAULT N'not_evaluated' NOT NULL,
[is_blocking] bit DEFAULT 1 NOT NULL,
[evidence] nvarchar(max) DEFAULT N'{}' NOT NULL,
[notes] nvarchar(max),
[evaluated_at] datetimeoffset,
[evaluated_by] uniqueidentifier,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.response_cache_metadata', N'U') IS NULL
CREATE TABLE [dbo].[response_cache_metadata] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[cache_key] nvarchar(256) NOT NULL,
[data_category] nvarchar(450) NOT NULL,
[source_version] nvarchar(450),
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[payload] nvarchar(max) DEFAULT N'{}' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[expires_at] datetimeoffset DEFAULT DATEADD(hour, 1, SYSDATETIMEOFFSET()) NOT NULL,
[invalidated_at] datetimeoffset,
[invalidation_reason] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.response_performance_logs', N'U') IS NULL
CREATE TABLE [dbo].[response_performance_logs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[conversation_id] uniqueidentifier,
[message_id] uniqueidentifier,
[agent_run_id] uniqueidentifier,
[response_category] nvarchar(450) DEFAULT N'general_knowledge' NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[total_duration_ms] int DEFAULT 0 NOT NULL,
[authentication_duration_ms] int DEFAULT 0 NOT NULL,
[intent_duration_ms] int DEFAULT 0 NOT NULL,
[retrieval_duration_ms] int DEFAULT 0 NOT NULL,
[tool_duration_ms] int DEFAULT 0 NOT NULL,
[generation_duration_ms] int DEFAULT 0 NOT NULL,
[supervisor_duration_ms] int DEFAULT 0 NOT NULL,
[database_duration_ms] int DEFAULT 0 NOT NULL,
[first_visible_feedback_ms] int DEFAULT 0 NOT NULL,
[first_token_ms] int,
[tool_count] int DEFAULT 0 NOT NULL,
[parallel_tool_count] int DEFAULT 0 NOT NULL,
[input_tokens] int,
[output_tokens] int,
[model_name] nvarchar(450),
[intent] nvarchar(450),
[cache_hit] bit DEFAULT 0 NOT NULL,
[partial_failure] bit DEFAULT 0 NOT NULL,
[budget_exceeded] bit DEFAULT 0 NOT NULL,
[success] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[trace_id] nvarchar(450),
[model_call_count] int DEFAULT 0 NOT NULL,
[db_query_count] int,
[response_bytes] int DEFAULT 0 NOT NULL,
[error_kind] nvarchar(450),
[rate_limited] bit DEFAULT 0 NOT NULL,
[execution_path] nvarchar(450) DEFAULT N'AGENTIC',
[supervisor_invoked] bit DEFAULT 0 NOT NULL,
[supervisor_reason] nvarchar(450),
[supervisor_latency_ms] int,
[model_names] nvarchar(max) DEFAULT N'[]' NOT NULL,
[prompt_tokens] int DEFAULT 0 NOT NULL,
[retrieval_tokens] int DEFAULT 0 NOT NULL,
[prompt_breakdown] nvarchar(max) DEFAULT N'{}' NOT NULL,
[first_visible_ms] int,
[domains] nvarchar(max) DEFAULT N'[]' NOT NULL,
[db_total_ms] int,
[db_slowest_operation] nvarchar(450),
[db_slowest_ms] int,
[stream_chunk_count] int,
[stream_duration_ms] int,
[finalization_ms] int,
[routing_ms] int,
[student_context_ms] int,
[external_api_ms] int,
[model_queue_ms] int

);
GO

IF OBJECT_ID(N'dbo.response_quality_reviews', N'U') IS NULL
CREATE TABLE [dbo].[response_quality_reviews] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[agent_run_id] uniqueidentifier,
[reviewer_type] nvarchar(450) DEFAULT N'human' NOT NULL,
[reviewer_profile_id] uniqueidentifier,
[intent_score] int,
[factual_score] int,
[student_data_score] int,
[citation_score] int,
[completeness_score] int,
[conciseness_score] int,
[action_relevance_score] int,
[tool_selection_score] int,
[safety_score] int,
[privacy_score] int,
[language_score] int,
[tone_score] int,
[task_completion_score] int,
[issue_tags] nvarchar(max) DEFAULT N'[]' NOT NULL,
[proposed_correction] nvarchar(450),
[comments] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.risk_flags', N'U') IS NULL
CREATE TABLE [dbo].[risk_flags] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier,
[user_id] uniqueidentifier,
[flag_type] nvarchar(450) NOT NULL,
[severity] nvarchar(64) DEFAULT N'medium' NOT NULL,
[notes] nvarchar(max),
[resolved_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.routing_decisions', N'U') IS NULL
CREATE TABLE [dbo].[routing_decisions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[case_id] uniqueidentifier NOT NULL,
[matched_rule_id] uniqueidentifier,
[recommended_unit_id] uniqueidentifier,
[final_unit_id] uniqueidentifier,
[recommended_staff_id] uniqueidentifier,
[final_staff_id] uniqueidentifier,
[confidence_score] numeric,
[overridden] bit DEFAULT 0 NOT NULL,
[override_reason] nvarchar(450),
[decided_by] nvarchar(450) DEFAULT N'system' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.routing_rules', N'U') IS NULL
CREATE TABLE [dbo].[routing_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[rule_name] nvarchar(450) NOT NULL,
[priority] int DEFAULT 100 NOT NULL,
[conditions] nvarchar(max) DEFAULT N'{}' NOT NULL,
[target_unit_id] uniqueidentifier,
[target_role] nvarchar(64),
[target_staff_id] uniqueidentifier,
[requires_human_review] bit DEFAULT 0 NOT NULL,
[assignment_method] nvarchar(450) DEFAULT N'lowest_workload' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.scheduled_job_runs', N'U') IS NULL
CREATE TABLE [dbo].[scheduled_job_runs] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[job_name] nvarchar(450) NOT NULL,
[started_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[completed_at] datetimeoffset,
[status] nvarchar(450) DEFAULT N'running' NOT NULL,
[records_processed] int DEFAULT 0 NOT NULL,
[successes] int DEFAULT 0 NOT NULL,
[failures] int DEFAULT 0 NOT NULL,
[error_summary] nvarchar(450)

);
GO

IF OBJECT_ID(N'dbo.service_availability_audit', N'U') IS NULL
CREATE TABLE [dbo].[service_availability_audit] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_id] uniqueidentifier,
[window_id] uniqueidentifier,
[action] nvarchar(450) NOT NULL,
[old_values] nvarchar(max),
[new_values] nvarchar(max),
[reason] nvarchar(450),
[changed_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_availability_windows', N'U') IS NULL
CREATE TABLE [dbo].[service_availability_windows] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_id] uniqueidentifier NOT NULL,
[academic_year] nvarchar(450),
[academic_term_id] uniqueidentifier,
[availability_type] nvarchar(450) DEFAULT N'always_available' NOT NULL,
[opens_at] datetimeoffset,
[closes_at] datetimeoffset,
[timezone] nvarchar(450) DEFAULT N'Asia/Dubai' NOT NULL,
[status] nvarchar(450) DEFAULT N'active' NOT NULL,
[student_visible] bit DEFAULT 1 NOT NULL,
[reason_en] nvarchar(450),
[reason_ar] nvarchar(450),
[student_message_en] nvarchar(max),
[student_message_ar] nvarchar(max),
[reminders_enabled] bit DEFAULT 1 NOT NULL,
[preliminary_check_allowed] bit DEFAULT 0 NOT NULL,
[label] nvarchar(450),
[created_by] uniqueidentifier,
[updated_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT service_availability_windows_availability_type_check CHECK ((availability_type IN (N'always_available', N'date_range', N'term_based', N'multiple_windows', N'temporarily_closed', N'admin_disabled'))),
    CONSTRAINT service_availability_windows_status_check CHECK ((status IN (N'active', N'archived')))

);
GO

IF OBJECT_ID(N'dbo.service_baselines', N'U') IS NULL
CREATE TABLE [dbo].[service_baselines] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_service_id] uniqueidentifier NOT NULL,
[steps] int,
[forms] int,
[visits] int,
[fields_requested] int,
[avg_processing_hours] numeric,
[staff_touchpoints] int,
[channels] nvarchar(max) DEFAULT N'[]' NOT NULL,
[notes] nvarchar(max),
[recorded_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_degradation_state', N'U') IS NULL
CREATE TABLE [dbo].[service_degradation_state] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[component] nvarchar(256) NOT NULL,
[state] nvarchar(450) DEFAULT N'operational' NOT NULL,
[message_en] nvarchar(max),
[message_ar] nvarchar(max),
[since] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_impact_baselines', N'U') IS NULL
CREATE TABLE [dbo].[service_impact_baselines] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier,
[journey_code] nvarchar(256) NOT NULL,
[journey_en] nvarchar(450) NOT NULL,
[journey_ar] nvarchar(450) NOT NULL,
[before_steps] int NOT NULL,
[before_fields] int NOT NULL,
[before_approvals] int NOT NULL,
[before_processing_hours] numeric NOT NULL,
[before_visits] int NOT NULL,
[before_staff_touches] int NOT NULL,
[before_flow_en] nvarchar(450) NOT NULL,
[before_flow_ar] nvarchar(450) NOT NULL,
[after_steps] int NOT NULL,
[after_fields] int NOT NULL,
[after_approvals] int NOT NULL,
[after_processing_hours] numeric NOT NULL,
[after_visits] int NOT NULL,
[after_staff_touches] int NOT NULL,
[after_flow_en] nvarchar(450) NOT NULL,
[after_flow_ar] nvarchar(450) NOT NULL,
[highlight] bit DEFAULT 0 NOT NULL,
[is_demo] bit DEFAULT 1 NOT NULL,
[display_order] int DEFAULT 100 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_improvements', N'U') IS NULL
CREATE TABLE [dbo].[service_improvements] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450),
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[source_type] nvarchar(450) DEFAULT N'insight' NOT NULL,
[source_case_ids] nvarchar(max) DEFAULT N'[]' NOT NULL,
[source_suggestion_ids] nvarchar(max) DEFAULT N'[]' NOT NULL,
[responsible_unit_id] uniqueidentifier,
[owner_profile_id] uniqueidentifier,
[status] nvarchar(450) DEFAULT N'proposed' NOT NULL,
[target_date] date,
[expected_impact] nvarchar(450),
[actual_impact] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_knowledge_health', N'U') IS NULL
CREATE TABLE [dbo].[service_knowledge_health] (

[service_id] uniqueidentifier NOT NULL,
[total_known_topics] int DEFAULT 0 NOT NULL,
[topics_with_approved_source] int DEFAULT 0 NOT NULL,
[topics_with_en_content] int DEFAULT 0 NOT NULL,
[topics_with_ar_content] int DEFAULT 0 NOT NULL,
[topics_with_current_source] int DEFAULT 0 NOT NULL,
[topics_with_authoritative_source] int DEFAULT 0 NOT NULL,
[unresolved_conflicts] int DEFAULT 0 NOT NULL,
[knowledge_gaps] int DEFAULT 0 NOT NULL,
[coverage_score] numeric DEFAULT 0 NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_owner_action_permissions', N'U') IS NULL
CREATE TABLE [dbo].[service_owner_action_permissions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier NOT NULL,
[role] nvarchar(64) DEFAULT N'service_owner' NOT NULL,
[action_code] nvarchar(256) NOT NULL,
[enabled] bit DEFAULT 1 NOT NULL,
[requires_confirmation] bit DEFAULT 0 NOT NULL,
[requires_reason] bit DEFAULT 0 NOT NULL,
[risk_level] nvarchar(450) DEFAULT N'low' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_owner_ai_preferences', N'U') IS NULL
CREATE TABLE [dbo].[service_owner_ai_preferences] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[staff_profile_id] uniqueidentifier NOT NULL,
[auto_send_routine_updates] bit DEFAULT 1 NOT NULL,
[auto_request_missing_information] bit DEFAULT 1 NOT NULL,
[auto_follow_up] bit DEFAULT 1 NOT NULL,
[auto_escalate_by_policy] bit DEFAULT 1 NOT NULL,
[auto_prepare_resolution] bit DEFAULT 1 NOT NULL,
[auto_close_eligible_cases] bit DEFAULT 0 NOT NULL,
[require_review_for_all_student_messages] bit DEFAULT 0 NOT NULL,
[preferred_response_style] nvarchar(450) DEFAULT N'concise_formal' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_process_metrics', N'U') IS NULL
CREATE TABLE [dbo].[service_process_metrics] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_service_id] uniqueidentifier,
[measurement_period] nvarchar(450) NOT NULL,
[process_version] nvarchar(450) DEFAULT N'baseline' NOT NULL,
[total_steps] int,
[required_fields] int,
[required_documents] int,
[physical_visits] int,
[average_processing_minutes] int,
[average_student_effort_minutes] int,
[average_staff_effort_minutes] int,
[first_pass_success_rate] numeric,
[digital_completion_rate] numeric,
[satisfaction_score] numeric,
[cost_per_case] numeric,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_requirements', N'U') IS NULL
CREATE TABLE [dbo].[service_requirements] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_service_id] uniqueidentifier NOT NULL,
[requirement_name_en] nvarchar(450) NOT NULL,
[requirement_name_ar] nvarchar(450) NOT NULL,
[requirement_type] nvarchar(450) DEFAULT N'document' NOT NULL,
[is_mandatory] bit DEFAULT 1 NOT NULL,
[validation_rule] nvarchar(450),
[display_order] int DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_staff', N'U') IS NULL
CREATE TABLE [dbo].[service_staff] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[staff_profile_id] uniqueidentifier NOT NULL,
[service_unit_id] uniqueidentifier NOT NULL,
[role_type] nvarchar(450) DEFAULT N'officer' NOT NULL,
[can_receive_cases] bit DEFAULT 1 NOT NULL,
[can_approve_actions] bit DEFAULT 0 NOT NULL,
[can_view_sensitive_cases] bit DEFAULT 0 NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[is_service_owner] bit DEFAULT 0 NOT NULL,
[can_assign_cases] bit DEFAULT 0 NOT NULL,
[can_approve_normal_resolution] bit DEFAULT 1 NOT NULL,
[can_escalate] bit DEFAULT 1 NOT NULL,
[is_demo_record] bit DEFAULT 0 NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_unit_owners', N'U') IS NULL
CREATE TABLE [dbo].[service_unit_owners] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier NOT NULL,
[staff_profile_id] uniqueidentifier NOT NULL,
[ownership_type] nvarchar(450) DEFAULT N'primary' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[started_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[ended_at] datetimeoffset,
[assigned_by] uniqueidentifier,
[notes] nvarchar(max),
[is_demo_record] bit DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.service_workflow_steps', N'U') IS NULL
CREATE TABLE [dbo].[service_workflow_steps] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_service_id] uniqueidentifier NOT NULL,
[step_number] int NOT NULL,
[step_name_en] nvarchar(450) NOT NULL,
[step_name_ar] nvarchar(450) NOT NULL,
[responsible_unit_id] uniqueidentifier,
[expected_duration_hours] int DEFAULT 24 NOT NULL,
[requires_approval] bit DEFAULT 0 NOT NULL,
[is_student_visible] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.staff_availability_rules', N'U') IS NULL
CREATE TABLE [dbo].[staff_availability_rules] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier NOT NULL,
[staff_profile_id] uniqueidentifier,
[appointment_type_id] uniqueidentifier,
[weekday] smallint NOT NULL,
[start_minute] int NOT NULL,
[end_minute] int NOT NULL,
[slot_minutes] int DEFAULT 30 NOT NULL,
[capacity] int DEFAULT 1 NOT NULL,
[location] nvarchar(450),
[meeting_link] nvarchar(450),
[valid_from] date DEFAULT CONVERT(date, SYSDATETIMEOFFSET()) NOT NULL,
[valid_to] date,
[is_active] bit DEFAULT 1 NOT NULL,
[created_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT staff_availability_rules_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT staff_availability_rules_end_minute_check CHECK (((end_minute >= 1) AND (end_minute <= 1440))),
    CONSTRAINT staff_availability_rules_slot_minutes_check CHECK ((slot_minutes > 0)),
    CONSTRAINT staff_availability_rules_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439))),
    CONSTRAINT staff_availability_rules_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6))),
    CONSTRAINT staff_availability_rules_window CHECK ((end_minute > start_minute))

);
GO

IF OBJECT_ID(N'dbo.staff_profiles', N'U') IS NULL
CREATE TABLE [dbo].[staff_profiles] (

[user_id] uniqueidentifier NOT NULL,
[service_unit_id] uniqueidentifier,
[job_title_en] nvarchar(450),
[job_title_ar] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[staff_code] nvarchar(256),
[is_active] bit DEFAULT 1 NOT NULL,
[availability_status] nvarchar(450) DEFAULT N'available' NOT NULL,
[last_assigned_at] datetimeoffset,
[must_change_password] bit DEFAULT 0 NOT NULL,
    CONSTRAINT staff_profiles_availability_status_check CHECK ((availability_status IN (N'available', N'unavailable', N'on_leave')))

);
GO

IF OBJECT_ID(N'dbo.structured_data_sources', N'U') IS NULL
CREATE TABLE [dbo].[structured_data_sources] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[connector_id] uniqueidentifier,
[source_name] nvarchar(450) NOT NULL,
[source_type] nvarchar(450) DEFAULT N'view' NOT NULL,
[approved_view_or_function] nvarchar(450) NOT NULL,
[allowed_columns] nvarchar(max) DEFAULT N'[]' NOT NULL,
[filtering_rules] nvarchar(max) DEFAULT N'{}' NOT NULL,
[maximum_rows] int DEFAULT 100 NOT NULL,
[refresh_strategy] nvarchar(450) DEFAULT N'on_demand' NOT NULL,
[last_sync_at] datetimeoffset,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_alerts', N'U') IS NULL
CREATE TABLE [dbo].[student_alerts] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[alert_id] uniqueidentifier,
[student_id] uniqueidentifier NOT NULL,
[is_read] bit DEFAULT 0 NOT NULL,
[action_taken_at] datetimeoffset,
[dismissed_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[alert_rule_id] uniqueidentifier,
[alert_type] nvarchar(450) DEFAULT N'general' NOT NULL,
[title_en] nvarchar(450),
[title_ar] nvarchar(450),
[body_en] nvarchar(max),
[body_ar] nvarchar(max),
[severity] nvarchar(64) DEFAULT N'medium' NOT NULL,
[source_unit_id] uniqueidentifier,
[related_case_id] uniqueidentifier,
[related_service_id] uniqueidentifier,
[action_label_en] nvarchar(450),
[action_label_ar] nvarchar(450),
[action_url] nvarchar(450),
[deadline] datetimeoffset,
[generated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[read_at] datetimeoffset,
[action_completed_at] datetimeoffset,
[status] nvarchar(450) DEFAULT N'active' NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_career_profiles', N'U') IS NULL
CREATE TABLE [dbo].[student_career_profiles] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[latest_cv_id] uniqueidentifier,
[preferred_roles] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_sectors] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_locations] nvarchar(max) DEFAULT N'[]' NOT NULL,
[work_mode] nvarchar(450),
[work_orientation] nvarchar(450),
[counsellor_requested] bit DEFAULT 0 NOT NULL,
[shared_with_counsellor] bit DEFAULT 0 NOT NULL,
[career_fit_updated_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_course_history', N'U') IS NULL
CREATE TABLE [dbo].[student_course_history] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[course_id] uniqueidentifier NOT NULL,
[academic_term_id] uniqueidentifier,
[grade] nvarchar(450),
[grade_points] numeric(3,2),
[credits_attempted] int DEFAULT 3 NOT NULL,
[credits_earned] int DEFAULT 0 NOT NULL,
[completion_status] nvarchar(450) DEFAULT N'completed' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT student_course_history_credits_attempted_check CHECK ((credits_attempted >= 0)),
    CONSTRAINT student_course_history_credits_earned_check CHECK ((credits_earned >= 0))

);
GO

IF OBJECT_ID(N'dbo.student_current_enrollments', N'U') IS NULL
CREATE TABLE [dbo].[student_current_enrollments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[course_section_id] uniqueidentifier NOT NULL,
[enrollment_status] nvarchar(450) DEFAULT N'registered' NOT NULL,
[registration_date] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_cv_documents', N'U') IS NULL
CREATE TABLE [dbo].[student_cv_documents] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[file_name] nvarchar(450) NOT NULL,
[mime_type] nvarchar(450),
[size_bytes] int,
[original_file_path] nvarchar(450) NOT NULL,
[parsed_text] nvarchar(450),
[parsed_profile_json] nvarchar(max) DEFAULT N'{}' NOT NULL,
[detected_language] nvarchar(450) DEFAULT N'en' NOT NULL,
[parsing_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[parsing_error] nvarchar(450),
[injection_flags] nvarchar(max) DEFAULT N'[]' NOT NULL,
[discrepancies] nvarchar(max) DEFAULT N'[]' NOT NULL,
[is_current] bit DEFAULT 1 NOT NULL,
[uploaded_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[scan_status] nvarchar(450) DEFAULT N'clean' NOT NULL,
[content_sha256] nvarchar(max),
[deleted_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.student_documents', N'U') IS NULL
CREATE TABLE [dbo].[student_documents] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[document_type] nvarchar(450) NOT NULL,
[document_name] nvarchar(450) NOT NULL,
[storage_path] nvarchar(450),
[verification_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[issued_date] date,
[expiry_date] date,
[uploaded_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_field_provenance', N'U') IS NULL
CREATE TABLE [dbo].[student_field_provenance] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[field_key] nvarchar(256) NOT NULL,
[field_value] nvarchar(450),
[source] nvarchar(450) NOT NULL,
[verified_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_holds', N'U') IS NULL
CREATE TABLE [dbo].[student_holds] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[hold_type] nvarchar(450) NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[issuing_unit_id] uniqueidentifier,
[issued_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[expires_at] datetimeoffset,
[prevents_registration] bit DEFAULT 0 NOT NULL,
[prevents_graduation] bit DEFAULT 0 NOT NULL,
[resolution_action_en] nvarchar(450),
[resolution_action_ar] nvarchar(450),
[status] nvarchar(450) DEFAULT N'active' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_housing_preferences', N'U') IS NULL
CREATE TABLE [dbo].[student_housing_preferences] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[preferred_hostel_id] uniqueidentifier,
[preferred_room_type] nvarchar(450),
[accessibility_required] bit DEFAULT 0 NOT NULL,
[preferred_location] nvarchar(450),
[roommate_preference] nvarchar(450),
[notes] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_internship_preferences', N'U') IS NULL
CREATE TABLE [dbo].[student_internship_preferences] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[preferred_fields] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_sectors] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_emirates] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_cities] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_work_mode] nvarchar(450),
[preferred_organization_types] nvarchar(max) DEFAULT N'[]' NOT NULL,
[preferred_role_keywords] nvarchar(max) DEFAULT N'[]' NOT NULL,
[willing_to_relocate] bit DEFAULT 1 NOT NULL,
[notes] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_requirements', N'U') IS NULL
CREATE TABLE [dbo].[student_requirements] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[requirement_type] nvarchar(450) NOT NULL,
[title_en] nvarchar(450) NOT NULL,
[title_ar] nvarchar(450) NOT NULL,
[status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[due_date] date,
[responsible_unit_id] uniqueidentifier,
[action_url] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.student_service_reminders', N'U') IS NULL
CREATE TABLE [dbo].[student_service_reminders] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[service_id] uniqueidentifier NOT NULL,
[availability_window_id] uniqueidentifier,
[reminder_type] nvarchar(256) DEFAULT N'service_open' NOT NULL,
[scheduled_for] datetimeoffset NOT NULL,
[status] nvarchar(450) DEFAULT N'scheduled' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[sent_at] datetimeoffset,
[cancelled_at] datetimeoffset,
    CONSTRAINT student_service_reminders_reminder_type_check CHECK ((reminder_type IN (N'service_open', N'day_before_open'))),
    CONSTRAINT student_service_reminders_status_check CHECK ((status IN (N'scheduled', N'sent', N'cancelled', N'failed')))

);
GO

IF OBJECT_ID(N'dbo.suggestion_assessments', N'U') IS NULL
CREATE TABLE [dbo].[suggestion_assessments] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[suggestion_id] uniqueidentifier NOT NULL,
[reviewer_id] uniqueidentifier,
[strategic_alignment_score] int,
[student_impact_score] int,
[feasibility_score] int,
[estimated_cost_band] nvarchar(450),
[implementation_complexity] nvarchar(450),
[duplicate_assessment] nvarchar(450),
[recommendation] nvarchar(450),
[rationale] nvarchar(450),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.suggestion_duplicates', N'U') IS NULL
CREATE TABLE [dbo].[suggestion_duplicates] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[suggestion_id] uniqueidentifier NOT NULL,
[duplicate_of] uniqueidentifier NOT NULL,
[similarity] numeric(4,3),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.suggestion_reviews', N'U') IS NULL
CREATE TABLE [dbo].[suggestion_reviews] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[suggestion_id] uniqueidentifier NOT NULL,
[reviewer_id] uniqueidentifier,
[decision] nvarchar(450),
[notes] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.suggestion_similarities', N'U') IS NULL
CREATE TABLE [dbo].[suggestion_similarities] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[source_suggestion_id] uniqueidentifier NOT NULL,
[similar_suggestion_id] uniqueidentifier NOT NULL,
[similarity_score] numeric(4,3) DEFAULT 0 NOT NULL,
[reviewed_by] uniqueidentifier,
[confirmed_duplicate] bit DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.suggestion_updates', N'U') IS NULL
CREATE TABLE [dbo].[suggestion_updates] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[suggestion_id] uniqueidentifier NOT NULL,
[update_type] nvarchar(450) DEFAULT N'status' NOT NULL,
[update_text_en] nvarchar(450) NOT NULL,
[update_text_ar] nvarchar(450) NOT NULL,
[visible_to_student] bit DEFAULT 1 NOT NULL,
[created_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.suggestion_votes', N'U') IS NULL
CREATE TABLE [dbo].[suggestion_votes] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[suggestion_id] uniqueidentifier NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[vote_type] nvarchar(450) DEFAULT N'up' NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.suggestions', N'U') IS NULL
CREATE TABLE [dbo].[suggestions] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[reference_number] nvarchar(256) NOT NULL,
[student_id] uniqueidentifier NOT NULL,
[title] nvarchar(450) NOT NULL,
[description] nvarchar(max) NOT NULL,
[expected_benefit] nvarchar(450),
[service_unit_id] uniqueidentifier,
[status] nvarchar(64) DEFAULT N'submitted' NOT NULL,
[is_anonymous] bit DEFAULT 0 NOT NULL,
[language] nvarchar(64) DEFAULT N'en' NOT NULL,
[deleted_at] datetimeoffset,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[category] nvarchar(450),
[affected_service_id] uniqueidentifier,
[duplicate_of_suggestion_id] uniqueidentifier,
[assigned_staff_id] uniqueidentifier,
[review_due_at] datetimeoffset,
[implementation_target_date] date,
[outcome_summary] nvarchar(450),
[vote_count] int DEFAULT 0 NOT NULL,
[is_demo] bit DEFAULT 0 NOT NULL,
[student_hidden_at] datetimeoffset,
[student_hidden_by] uniqueidentifier,
[deletion_type] nvarchar(450),
[entry_channel] nvarchar(450) DEFAULT N'chat' NOT NULL,
[related_conversation_id] uniqueidentifier,
[routing_service_code] nvarchar(450),
[routing_reason_en] nvarchar(450),
[routing_reason_ar] nvarchar(450),
[routing_confidence] numeric

);
GO

IF OBJECT_ID(N'dbo.tool_calls', N'U') IS NULL
CREATE TABLE [dbo].[tool_calls] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[agent_run_id] uniqueidentifier NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[tool_name] nvarchar(450) NOT NULL,
[arguments] nvarchar(max) DEFAULT N'{}' NOT NULL,
[result] nvarchar(max),
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.universities', N'U') IS NULL
CREATE TABLE [dbo].[universities] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[short_name] nvarchar(256) NOT NULL,
[country] nvarchar(450) DEFAULT N'United Arab Emirates' NOT NULL,
[timezone] nvarchar(450) DEFAULT N'Asia/Dubai' NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.university_colleges', N'U') IS NULL
CREATE TABLE [dbo].[university_colleges] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[code] nvarchar(450),
[name_en] nvarchar(256) NOT NULL,
[name_ar] nvarchar(450),
[source_url] nvarchar(450),
[web_source_id] uniqueidentifier,
[verified_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.university_services', N'U') IS NULL
CREATE TABLE [dbo].[university_services] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[service_unit_id] uniqueidentifier,
[code] nvarchar(256) NOT NULL,
[name_en] nvarchar(450) NOT NULL,
[name_ar] nvarchar(450) NOT NULL,
[description_en] nvarchar(max),
[description_ar] nvarchar(max),
[category] nvarchar(450) DEFAULT N'general' NOT NULL,
[target_audience] nvarchar(450) DEFAULT N'students' NOT NULL,
[authentication_required] bit DEFAULT 1 NOT NULL,
[estimated_processing_days] int DEFAULT 3 NOT NULL,
[service_level_hours] int DEFAULT 72 NOT NULL,
[allows_online_submission] bit DEFAULT 1 NOT NULL,
[allows_agent_submission] bit DEFAULT 1 NOT NULL,
[requires_human_approval] bit DEFAULT 0 NOT NULL,
[risk_level] nvarchar(64) DEFAULT N'level_1' NOT NULL,
[instructions_en] nvarchar(max),
[instructions_ar] nvarchar(max),
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
    CONSTRAINT university_services_estimated_processing_days_check CHECK ((estimated_processing_days >= 0)),
    CONSTRAINT university_services_service_level_hours_check CHECK ((service_level_hours >= 0))

);
GO

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NULL
CREATE TABLE [dbo].[user_roles] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[user_id] uniqueidentifier NOT NULL,
[role] nvarchar(64) NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.web_knowledge_sources', N'U') IS NULL
CREATE TABLE [dbo].[web_knowledge_sources] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[title] nvarchar(450) NOT NULL,
[url] nvarchar(450) NOT NULL,
[owner_unit_id] uniqueidentifier,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[source_category] nvarchar(450) DEFAULT N'service_guide' NOT NULL,
[confidentiality_level] nvarchar(450) DEFAULT N'public' NOT NULL,
[crawl_scope] nvarchar(450) DEFAULT N'single_page' NOT NULL,
[allowed_path_pattern] nvarchar(450),
[excluded_path_patterns] nvarchar(max) DEFAULT N'[]' NOT NULL,
[refresh_frequency] nvarchar(450) DEFAULT N'weekly' NOT NULL,
[trusted_auto_refresh] bit DEFAULT 0 NOT NULL,
[last_checked_at] datetimeoffset,
[last_changed_at] datetimeoffset,
[last_successful_fetch_at] datetimeoffset,
[content_hash] nvarchar(max),
[extracted_text] nvarchar(max),
[change_detected] bit DEFAULT 0 NOT NULL,
[health_status] nvarchar(450) DEFAULT N'healthy' NOT NULL,
[approval_status] nvarchar(450) DEFAULT N'draft' NOT NULL,
[is_active] bit DEFAULT 0 NOT NULL,
[created_by] uniqueidentifier,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[knowledge_domain] nvarchar(450),
[search_vector] nvarchar(max) NULL,
[max_depth] int DEFAULT 1 NOT NULL,
[max_pages] int DEFAULT 25 NOT NULL,
[seed_urls] nvarchar(max) DEFAULT N'[]' NOT NULL,
[allowed_paths] nvarchar(max) DEFAULT N'[]' NOT NULL,
[pages_discovered] int DEFAULT 0 NOT NULL,
[pages_indexed] int DEFAULT 0 NOT NULL,
[pages_failed] int DEFAULT 0 NOT NULL,
[chunk_count] int DEFAULT 0 NOT NULL,
[last_indexed_at] datetimeoffset,
[last_error] nvarchar(450),
[ingestion_status] nvarchar(450) DEFAULT N'pending' NOT NULL

);
GO

IF OBJECT_ID(N'dbo.web_page_chunks', N'U') IS NULL
CREATE TABLE [dbo].[web_page_chunks] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[web_source_id] uniqueidentifier NOT NULL,
[page_id] uniqueidentifier NOT NULL,
[chunk_index] int DEFAULT 0 NOT NULL,
[section_title] nvarchar(450),
[section_path] nvarchar(450),
[page_title] nvarchar(450),
[source_url] nvarchar(450) NOT NULL,
[content] nvarchar(max) NOT NULL,
[token_count] int DEFAULT 0 NOT NULL,
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[content_hash] nvarchar(max),
[fetched_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[indexed_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[search_vector] nvarchar(max) NULL,
[embedding] nvarchar(max)

);
GO

IF OBJECT_ID(N'dbo.web_source_changes', N'U') IS NULL
CREATE TABLE [dbo].[web_source_changes] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[web_source_id] uniqueidentifier NOT NULL,
[previous_content_hash] nvarchar(max),
[new_content_hash] nvarchar(max),
[change_type] nvarchar(450) DEFAULT N'minor' NOT NULL,
[change_summary] nvarchar(450),
[change_percentage] numeric,
[detected_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[reviewed_by] uniqueidentifier,
[review_status] nvarchar(450) DEFAULT N'pending' NOT NULL,
[approved_at] datetimeoffset

);
GO

IF OBJECT_ID(N'dbo.web_source_pages', N'U') IS NULL
CREATE TABLE [dbo].[web_source_pages] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[web_source_id] uniqueidentifier NOT NULL,
[url] nvarchar(256) NOT NULL,
[title] nvarchar(450),
[language] nvarchar(450) DEFAULT N'en' NOT NULL,
[depth] int DEFAULT 0 NOT NULL,
[status] nvarchar(450) DEFAULT N'discovered' NOT NULL,
[error_reason] nvarchar(450),
[content_hash] nvarchar(max),
[text_length] int DEFAULT 0 NOT NULL,
[chunk_count] int DEFAULT 0 NOT NULL,
[fetched_at] datetimeoffset,
[indexed_at] datetimeoffset,
[is_active] bit DEFAULT 1 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO

IF OBJECT_ID(N'dbo.working_calendars', N'U') IS NULL
CREATE TABLE [dbo].[working_calendars] (

[id] uniqueidentifier DEFAULT NEWID() NOT NULL,
[university_id] uniqueidentifier,
[name] nvarchar(450) NOT NULL,
[timezone] nvarchar(450) DEFAULT N'Asia/Dubai' NOT NULL,
[working_days] nvarchar(max) DEFAULT N'[1, 2, 3, 4, 5]' NOT NULL,
[working_start_time] time DEFAULT N'08:00:00' NOT NULL,
[working_end_time] time DEFAULT N'17:00:00' NOT NULL,
[is_default] bit DEFAULT 0 NOT NULL,
[created_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL,
[updated_at] datetimeoffset DEFAULT SYSDATETIMEOFFSET() NOT NULL

);
GO


-- ========== SEQUENCES ==========

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.case_number_seq'))
CREATE SEQUENCE [dbo].[case_number_seq] AS bigint START WITH 1001 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.housing_allocation_seq'))
CREATE SEQUENCE [dbo].[housing_allocation_seq] AS bigint START WITH 1 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.housing_application_seq'))
CREATE SEQUENCE [dbo].[housing_application_seq] AS bigint START WITH 1 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.intercollege_transfer_seq'))
CREATE SEQUENCE [dbo].[intercollege_transfer_seq] AS bigint START WITH 1001 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.internship_assignment_seq'))
CREATE SEQUENCE [dbo].[internship_assignment_seq] AS bigint START WITH 1 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.issued_document_seq'))
CREATE SEQUENCE [dbo].[issued_document_seq] AS bigint START WITH 1 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'dbo.suggestion_number_seq'))
CREATE SEQUENCE [dbo].[suggestion_number_seq] AS bigint START WITH 501 INCREMENT BY 1;
GO


-- ========== UNIQUE / PRIMARY KEYS ==========

--
-- Name: academic_programs academic_programs_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_programs]
    ADD CONSTRAINT academic_programs_code_key UNIQUE (code);
GO

--
-- Name: academic_programs academic_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_programs]
    ADD CONSTRAINT academic_programs_pkey PRIMARY KEY (id);
GO

--
-- Name: academic_terms academic_terms_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_terms]
    ADD CONSTRAINT academic_terms_code_key UNIQUE (code);
GO

--
-- Name: academic_terms academic_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_terms]
    ADD CONSTRAINT academic_terms_pkey PRIMARY KEY (id);
GO

--
-- Name: action_approvals action_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_approvals]
    ADD CONSTRAINT action_approvals_pkey PRIMARY KEY (id);
GO

--
-- Name: action_receipts action_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_pkey PRIMARY KEY (id);
GO

--
-- Name: action_receipts action_receipts_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_receipt_number_key UNIQUE (receipt_number);
GO

--
-- Name: action_request_documents action_request_documents_action_request_id_student_document_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_request_documents]
    ADD CONSTRAINT action_request_documents_action_request_id_student_document_key UNIQUE (action_request_id, student_document_id);
GO

--
-- Name: action_request_documents action_request_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_request_documents]
    ADD CONSTRAINT action_request_documents_pkey PRIMARY KEY (id);
GO

--
-- Name: action_requests action_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: action_requests action_requests_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_receipt_number_key UNIQUE (receipt_number);
GO

--
-- Name: action_revalidation_events action_revalidation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_revalidation_events]
    ADD CONSTRAINT action_revalidation_events_pkey PRIMARY KEY (id);
GO

--
-- Name: action_revalidation_policies action_revalidation_policies_action_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_revalidation_policies]
    ADD CONSTRAINT action_revalidation_policies_action_code_key UNIQUE (action_code);
GO

--
-- Name: action_revalidation_policies action_revalidation_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_revalidation_policies]
    ADD CONSTRAINT action_revalidation_policies_pkey PRIMARY KEY (id);
GO

--
-- Name: agent_model_invocations agent_model_invocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_model_invocations]
    ADD CONSTRAINT agent_model_invocations_pkey PRIMARY KEY (id);
GO

--
-- Name: agent_model_invocations agent_model_invocations_trace_id_call_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_model_invocations]
    ADD CONSTRAINT agent_model_invocations_trace_id_call_sequence_key UNIQUE (trace_id, call_sequence);
GO

--
-- Name: agent_prompt_versions agent_prompt_versions_agent_type_language_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_prompt_versions]
    ADD CONSTRAINT agent_prompt_versions_agent_type_language_version_key UNIQUE (agent_type, language, version);
GO

--
-- Name: agent_prompt_versions agent_prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_prompt_versions]
    ADD CONSTRAINT agent_prompt_versions_pkey PRIMARY KEY (id);
GO

--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_runs]
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);
GO

--
-- Name: agent_tool_executions agent_tool_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_tool_executions]
    ADD CONSTRAINT agent_tool_executions_pkey PRIMARY KEY (id);
GO

--
-- Name: agent_tools agent_tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_tools]
    ADD CONSTRAINT agent_tools_pkey PRIMARY KEY (id);
GO

--
-- Name: agent_tools agent_tools_tool_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_tools]
    ADD CONSTRAINT agent_tools_tool_name_key UNIQUE (tool_name);
GO

--
-- Name: ai_human_edits ai_human_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[ai_human_edits]
    ADD CONSTRAINT ai_human_edits_pkey PRIMARY KEY (id);
GO

--
-- Name: ai_settings ai_settings_is_singleton_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[ai_settings]
    ADD CONSTRAINT ai_settings_is_singleton_key UNIQUE (is_singleton);
GO

--
-- Name: ai_settings ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[ai_settings]
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);
GO

--
-- Name: alert_deduplication alert_deduplication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_deduplication]
    ADD CONSTRAINT alert_deduplication_pkey PRIMARY KEY (id);
GO

--
-- Name: alert_rule_conditions alert_rule_conditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_rule_conditions]
    ADD CONSTRAINT alert_rule_conditions_pkey PRIMARY KEY (id);
GO

--
-- Name: alert_rule_runs alert_rule_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_rule_runs]
    ADD CONSTRAINT alert_rule_runs_pkey PRIMARY KEY (id);
GO

--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_rules]
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alerts]
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);
GO

--
-- Name: appointment_requests appointment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_requests]
    ADD CONSTRAINT appointment_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: appointment_slots appointment_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_slots]
    ADD CONSTRAINT appointment_slots_pkey PRIMARY KEY (id);
GO

--
-- Name: appointment_types appointment_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_types]
    ADD CONSTRAINT appointment_types_pkey PRIMARY KEY (id);
GO

--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[approval_requests]
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: ats_scoring_profiles ats_scoring_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[ats_scoring_profiles]
    ADD CONSTRAINT ats_scoring_profiles_pkey PRIMARY KEY (id);
GO

--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[audit_logs]
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
GO

--
-- Name: automation_events automation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[automation_events]
    ADD CONSTRAINT automation_events_pkey PRIMARY KEY (id);
GO

--
-- Name: automation_policies automation_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[automation_policies]
    ADD CONSTRAINT automation_policies_pkey PRIMARY KEY (id);
GO

--
-- Name: bilingual_terms bilingual_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[bilingual_terms]
    ADD CONSTRAINT bilingual_terms_pkey PRIMARY KEY (id);
GO

--
-- Name: calendar_exceptions calendar_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[calendar_exceptions]
    ADD CONSTRAINT calendar_exceptions_pkey PRIMARY KEY (id);
GO

--
-- Name: campuses campuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[campuses]
    ADD CONSTRAINT campuses_pkey PRIMARY KEY (id);
GO

--
-- Name: career_analysis_versions career_analysis_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_analysis_versions]
    ADD CONSTRAINT career_analysis_versions_pkey PRIMARY KEY (id);
GO

--
-- Name: career_analysis_versions career_analysis_versions_student_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_analysis_versions]
    ADD CONSTRAINT career_analysis_versions_student_id_version_no_key UNIQUE (student_id, version_no);
GO

--
-- Name: career_counselling_events career_counselling_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_counselling_events]
    ADD CONSTRAINT career_counselling_events_pkey PRIMARY KEY (id);
GO

--
-- Name: career_matching_weight_profiles career_matching_weight_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_matching_weight_profiles]
    ADD CONSTRAINT career_matching_weight_profiles_pkey PRIMARY KEY (id);
GO

--
-- Name: career_matching_weight_profiles career_matching_weight_profiles_profile_mode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_matching_weight_profiles]
    ADD CONSTRAINT career_matching_weight_profiles_profile_mode_key UNIQUE (profile_mode);
GO

--
-- Name: career_role_matches career_role_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_role_matches]
    ADD CONSTRAINT career_role_matches_pkey PRIMARY KEY (id);
GO

--
-- Name: career_roles career_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_roles]
    ADD CONSTRAINT career_roles_pkey PRIMARY KEY (id);
GO

--
-- Name: career_roles career_roles_role_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_roles]
    ADD CONSTRAINT career_roles_role_code_key UNIQUE (role_code);
GO

--
-- Name: case_access_restrictions case_access_restrictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_access_restrictions]
    ADD CONSTRAINT case_access_restrictions_pkey PRIMARY KEY (id);
GO

--
-- Name: case_assignments case_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_assignments]
    ADD CONSTRAINT case_assignments_pkey PRIMARY KEY (id);
GO

--
-- Name: case_automation_state case_automation_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_automation_state]
    ADD CONSTRAINT case_automation_state_pkey PRIMARY KEY (case_id);
GO

--
-- Name: case_categories case_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_categories]
    ADD CONSTRAINT case_categories_code_key UNIQUE (code);
GO

--
-- Name: case_categories case_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_categories]
    ADD CONSTRAINT case_categories_pkey PRIMARY KEY (id);
GO

--
-- Name: case_comments case_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_comments]
    ADD CONSTRAINT case_comments_pkey PRIMARY KEY (id);
GO

--
-- Name: case_conflicts_of_interest case_conflicts_of_interest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_conflicts_of_interest]
    ADD CONSTRAINT case_conflicts_of_interest_pkey PRIMARY KEY (id);
GO

--
-- Name: case_escalations case_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_escalations]
    ADD CONSTRAINT case_escalations_pkey PRIMARY KEY (id);
GO

--
-- Name: case_evidence case_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_evidence]
    ADD CONSTRAINT case_evidence_pkey PRIMARY KEY (id);
GO

--
-- Name: case_feedback case_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_feedback]
    ADD CONSTRAINT case_feedback_pkey PRIMARY KEY (id);
GO

--
-- Name: case_handovers case_handovers_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_handovers]
    ADD CONSTRAINT case_handovers_case_id_key UNIQUE (case_id);
GO

--
-- Name: case_handovers case_handovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_handovers]
    ADD CONSTRAINT case_handovers_pkey PRIMARY KEY (id);
GO

--
-- Name: case_information_requests case_information_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_information_requests]
    ADD CONSTRAINT case_information_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: case_monitor_grants case_monitor_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_monitor_grants]
    ADD CONSTRAINT case_monitor_grants_pkey PRIMARY KEY (id);
GO

--
-- Name: case_monitor_grants case_monitor_grants_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_monitor_grants]
    ADD CONSTRAINT case_monitor_grants_user_id_key UNIQUE (user_id);
GO

--
-- Name: case_oversight_actions case_oversight_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_oversight_actions]
    ADD CONSTRAINT case_oversight_actions_pkey PRIMARY KEY (id);
GO

--
-- Name: case_reopen_requests case_reopen_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_reopen_requests]
    ADD CONSTRAINT case_reopen_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: case_resolutions case_resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_resolutions]
    ADD CONSTRAINT case_resolutions_pkey PRIMARY KEY (id);
GO

--
-- Name: case_responsibility_history case_responsibility_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_responsibility_history]
    ADD CONSTRAINT case_responsibility_history_pkey PRIMARY KEY (id);
GO

--
-- Name: case_routing_feedback case_routing_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_routing_feedback]
    ADD CONSTRAINT case_routing_feedback_pkey PRIMARY KEY (id);
GO

--
-- Name: case_sla_events case_sla_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_sla_events]
    ADD CONSTRAINT case_sla_events_pkey PRIMARY KEY (id);
GO

--
-- Name: case_status_history case_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_status_history]
    ADD CONSTRAINT case_status_history_pkey PRIMARY KEY (id);
GO

--
-- Name: cases cases_case_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_case_number_key UNIQUE (case_number);
GO

--
-- Name: cases cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_pkey PRIMARY KEY (id);
GO

--
-- Name: citations citations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[citations]
    ADD CONSTRAINT citations_pkey PRIMARY KEY (id);
GO

--
-- Name: colleges colleges_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[colleges]
    ADD CONSTRAINT colleges_code_key UNIQUE (code);
GO

--
-- Name: colleges colleges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[colleges]
    ADD CONSTRAINT colleges_pkey PRIMARY KEY (id);
GO

--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[consent_records]
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);
GO

--
-- Name: conversation_state conversation_state_conversation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_conversation_id_key UNIQUE (conversation_id);
GO

--
-- Name: conversation_state conversation_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_pkey PRIMARY KEY (id);
GO

--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversations]
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
GO

--
-- Name: course_prerequisites course_prerequisites_course_id_prerequisite_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_prerequisites]
    ADD CONSTRAINT course_prerequisites_course_id_prerequisite_course_id_key UNIQUE (course_id, prerequisite_course_id);
GO

--
-- Name: course_prerequisites course_prerequisites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_prerequisites]
    ADD CONSTRAINT course_prerequisites_pkey PRIMARY KEY (id);
GO

--
-- Name: course_sections course_sections_course_id_academic_term_id_section_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_sections]
    ADD CONSTRAINT course_sections_course_id_academic_term_id_section_number_key UNIQUE (course_id, academic_term_id, section_number);
GO

--
-- Name: course_sections course_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_sections]
    ADD CONSTRAINT course_sections_pkey PRIMARY KEY (id);
GO

--
-- Name: courses courses_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[courses]
    ADD CONSTRAINT courses_code_key UNIQUE (code);
GO

--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[courses]
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);
GO

--
-- Name: cv_ats_scores cv_ats_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cv_ats_scores]
    ADD CONSTRAINT cv_ats_scores_pkey PRIMARY KEY (id);
GO

--
-- Name: cv_upload_scans cv_upload_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cv_upload_scans]
    ADD CONSTRAINT cv_upload_scans_pkey PRIMARY KEY (id);
GO

--
-- Name: data_authority_rules data_authority_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[data_authority_rules]
    ADD CONSTRAINT data_authority_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: departments departments_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[departments]
    ADD CONSTRAINT departments_code_key UNIQUE (code);
GO

--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[departments]
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);
GO

--
-- Name: detected_intents detected_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[detected_intents]
    ADD CONSTRAINT detected_intents_pkey PRIMARY KEY (id);
GO

--
-- Name: document_chunks document_chunks_document_id_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_chunks]
    ADD CONSTRAINT document_chunks_document_id_chunk_index_key UNIQUE (document_id, chunk_index);
GO

--
-- Name: document_chunks document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_chunks]
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);
GO

--
-- Name: document_deletion_records document_deletion_records_document_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_deletion_records]
    ADD CONSTRAINT document_deletion_records_document_id_key UNIQUE (document_id);
GO

--
-- Name: document_deletion_records document_deletion_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_deletion_records]
    ADD CONSTRAINT document_deletion_records_pkey PRIMARY KEY (id);
GO

--
-- Name: document_events document_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_events]
    ADD CONSTRAINT document_events_pkey PRIMARY KEY (id);
GO

--
-- Name: document_retention_policies document_retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_retention_policies]
    ADD CONSTRAINT document_retention_policies_pkey PRIMARY KEY (document_type);
GO

--
-- Name: document_templates document_templates_document_type_language_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_templates]
    ADD CONSTRAINT document_templates_document_type_language_version_key UNIQUE (document_type, language, version);
GO

--
-- Name: document_templates document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_templates]
    ADD CONSTRAINT document_templates_pkey PRIMARY KEY (id);
GO

--
-- Name: document_verification_attempts document_verification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_verification_attempts]
    ADD CONSTRAINT document_verification_attempts_pkey PRIMARY KEY (id);
GO

--
-- Name: document_verification_tombstones document_verification_tombstones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_verification_tombstones]
    ADD CONSTRAINT document_verification_tombstones_pkey PRIMARY KEY (token_hash);
GO

--
-- Name: document_versions document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_versions]
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (id);
GO

--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[email_templates]
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);
GO

--
-- Name: email_templates email_templates_template_code_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[email_templates]
    ADD CONSTRAINT email_templates_template_code_version_key UNIQUE (template_code, version);
GO

--
-- Name: emergency_broadcasts emergency_broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[emergency_broadcasts]
    ADD CONSTRAINT emergency_broadcasts_pkey PRIMARY KEY (id);
GO

--
-- Name: emergency_contacts emergency_contacts_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[emergency_contacts]
    ADD CONSTRAINT emergency_contacts_code_key UNIQUE (code);
GO

--
-- Name: emergency_contacts emergency_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[emergency_contacts]
    ADD CONSTRAINT emergency_contacts_pkey PRIMARY KEY (id);
GO

--
-- Name: escalation_actions escalation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_pkey PRIMARY KEY (id);
GO

--
-- Name: escalation_policies escalation_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_policies]
    ADD CONSTRAINT escalation_policies_pkey PRIMARY KEY (id);
GO

--
-- Name: evaluation_equivalence_groups evaluation_equivalence_groups_group_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_equivalence_groups]
    ADD CONSTRAINT evaluation_equivalence_groups_group_code_key UNIQUE (group_code);
GO

--
-- Name: evaluation_equivalence_groups evaluation_equivalence_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_equivalence_groups]
    ADD CONSTRAINT evaluation_equivalence_groups_pkey PRIMARY KEY (id);
GO

--
-- Name: evaluation_equivalence_items evaluation_equivalence_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_equivalence_items]
    ADD CONSTRAINT evaluation_equivalence_items_pkey PRIMARY KEY (id);
GO

--
-- Name: evaluation_runs evaluation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_runs]
    ADD CONSTRAINT evaluation_runs_pkey PRIMARY KEY (id);
GO

--
-- Name: evaluation_scenarios evaluation_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_scenarios]
    ADD CONSTRAINT evaluation_scenarios_pkey PRIMARY KEY (id);
GO

--
-- Name: evaluation_scenarios evaluation_scenarios_scenario_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_scenarios]
    ADD CONSTRAINT evaluation_scenarios_scenario_code_key UNIQUE (scenario_code);
GO

--
-- Name: exception_events exception_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[exception_events]
    ADD CONSTRAINT exception_events_pkey PRIMARY KEY (id);
GO

--
-- Name: faq_items faq_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[faq_items]
    ADD CONSTRAINT faq_items_pkey PRIMARY KEY (id);
GO

--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[feedback]
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);
GO

--
-- Name: follow_up_policies follow_up_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[follow_up_policies]
    ADD CONSTRAINT follow_up_policies_pkey PRIMARY KEY (id);
GO

--
-- Name: grounding_checks grounding_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[grounding_checks]
    ADD CONSTRAINT grounding_checks_pkey PRIMARY KEY (id);
GO

--
-- Name: hostel_rooms hostel_rooms_hostel_id_room_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[hostel_rooms]
    ADD CONSTRAINT hostel_rooms_hostel_id_room_number_key UNIQUE (hostel_id, room_number);
GO

--
-- Name: hostel_rooms hostel_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[hostel_rooms]
    ADD CONSTRAINT hostel_rooms_pkey PRIMARY KEY (id);
GO

--
-- Name: hostels hostels_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[hostels]
    ADD CONSTRAINT hostels_code_key UNIQUE (code);
GO

--
-- Name: hostels hostels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[hostels]
    ADD CONSTRAINT hostels_pkey PRIMARY KEY (id);
GO

--
-- Name: housing_allocations housing_allocations_allocation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_allocations]
    ADD CONSTRAINT housing_allocations_allocation_number_key UNIQUE (allocation_number);
GO

--
-- Name: housing_allocations housing_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_allocations]
    ADD CONSTRAINT housing_allocations_pkey PRIMARY KEY (id);
GO

--
-- Name: housing_applications housing_applications_application_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_application_number_key UNIQUE (application_number);
GO

--
-- Name: housing_applications housing_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_pkey PRIMARY KEY (id);
GO

--
-- Name: housing_eligibility_rules housing_eligibility_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_eligibility_rules]
    ADD CONSTRAINT housing_eligibility_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: housing_eligibility_rules housing_eligibility_rules_rule_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_eligibility_rules]
    ADD CONSTRAINT housing_eligibility_rules_rule_name_key UNIQUE (rule_name);
GO

--
-- Name: housing_waitlist housing_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_waitlist]
    ADD CONSTRAINT housing_waitlist_pkey PRIMARY KEY (id);
GO

--
-- Name: integration_connectors integration_connectors_connector_name_environment_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_connectors]
    ADD CONSTRAINT integration_connectors_connector_name_environment_key UNIQUE (connector_name, environment);
GO

--
-- Name: integration_connectors integration_connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_connectors]
    ADD CONSTRAINT integration_connectors_pkey PRIMARY KEY (id);
GO

--
-- Name: integration_field_mappings integration_field_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_field_mappings]
    ADD CONSTRAINT integration_field_mappings_pkey PRIMARY KEY (id);
GO

--
-- Name: integration_health_events integration_health_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_health_events]
    ADD CONSTRAINT integration_health_events_pkey PRIMARY KEY (id);
GO

--
-- Name: integration_schema_versions integration_schema_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_schema_versions]
    ADD CONSTRAINT integration_schema_versions_pkey PRIMARY KEY (id);
GO

--
-- Name: integration_test_runs integration_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_test_runs]
    ADD CONSTRAINT integration_test_runs_pkey PRIMARY KEY (id);
GO

--
-- Name: integration_tools integration_tools_connector_id_tool_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_tools]
    ADD CONSTRAINT integration_tools_connector_id_tool_name_key UNIQUE (connector_id, tool_name);
GO

--
-- Name: integration_tools integration_tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_tools]
    ADD CONSTRAINT integration_tools_pkey PRIMARY KEY (id);
GO

--
-- Name: intercollege_transfer_acknowledgements intercollege_transfer_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_acknowledgements]
    ADD CONSTRAINT intercollege_transfer_acknowledgements_pkey PRIMARY KEY (id);
GO

--
-- Name: intercollege_transfer_course_impact intercollege_transfer_course_impact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_course_impact]
    ADD CONSTRAINT intercollege_transfer_course_impact_pkey PRIMARY KEY (id);
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_transfer_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_transfer_number_key UNIQUE (transfer_number);
GO

--
-- Name: internship_assignment_audit internship_assignment_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignment_audit]
    ADD CONSTRAINT internship_assignment_audit_pkey PRIMARY KEY (id);
GO

--
-- Name: internship_assignments internship_assignments_assignment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_assignment_number_key UNIQUE (assignment_number);
GO

--
-- Name: internship_assignments internship_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_pkey PRIMARY KEY (id);
GO

--
-- Name: internship_match_explanations internship_match_explanations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_match_explanations]
    ADD CONSTRAINT internship_match_explanations_pkey PRIMARY KEY (id);
GO

--
-- Name: internship_matching_weights internship_matching_weights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_matching_weights]
    ADD CONSTRAINT internship_matching_weights_pkey PRIMARY KEY (id);
GO

--
-- Name: internship_opportunities internship_opportunities_opportunity_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_opportunities]
    ADD CONSTRAINT internship_opportunities_opportunity_code_key UNIQUE (opportunity_code);
GO

--
-- Name: internship_opportunities internship_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_opportunities]
    ADD CONSTRAINT internship_opportunities_pkey PRIMARY KEY (id);
GO

--
-- Name: internship_organizations internship_organizations_organization_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_organizations]
    ADD CONSTRAINT internship_organizations_organization_code_key UNIQUE (organization_code);
GO

--
-- Name: internship_organizations internship_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_organizations]
    ADD CONSTRAINT internship_organizations_pkey PRIMARY KEY (id);
GO

--
-- Name: internship_waitlist internship_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_waitlist]
    ADD CONSTRAINT internship_waitlist_pkey PRIMARY KEY (id);
GO

--
-- Name: issued_documents issued_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[issued_documents]
    ADD CONSTRAINT issued_documents_pkey PRIMARY KEY (id);
GO

--
-- Name: issued_documents issued_documents_reference_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[issued_documents]
    ADD CONSTRAINT issued_documents_reference_number_key UNIQUE (reference_number);
GO

--
-- Name: issued_documents issued_documents_secure_verification_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[issued_documents]
    ADD CONSTRAINT issued_documents_secure_verification_token_key UNIQUE (secure_verification_token);
GO

--
-- Name: knowledge_approval_requests knowledge_approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_approval_requests]
    ADD CONSTRAINT knowledge_approval_requests_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_audit_log knowledge_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_audit_log]
    ADD CONSTRAINT knowledge_audit_log_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_conflicts knowledge_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_conflicts]
    ADD CONSTRAINT knowledge_conflicts_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_document_categories knowledge_document_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_document_categories]
    ADD CONSTRAINT knowledge_document_categories_code_key UNIQUE (code);
GO

--
-- Name: knowledge_document_categories knowledge_document_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_document_categories]
    ADD CONSTRAINT knowledge_document_categories_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_documents knowledge_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_gaps knowledge_gaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_gaps]
    ADD CONSTRAINT knowledge_gaps_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_issue_reports knowledge_issue_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_issue_reports]
    ADD CONSTRAINT knowledge_issue_reports_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_retrieval_logs knowledge_retrieval_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_retrieval_logs]
    ADD CONSTRAINT knowledge_retrieval_logs_pkey PRIMARY KEY (id);
GO

--
-- Name: knowledge_sources knowledge_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_sources]
    ADD CONSTRAINT knowledge_sources_pkey PRIMARY KEY (id);
GO

--
-- Name: library_hours_exceptions library_hours_exceptions_library_location_id_exception_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_hours_exceptions]
    ADD CONSTRAINT library_hours_exceptions_library_location_id_exception_date_key UNIQUE (library_location_id, exception_date);
GO

--
-- Name: library_hours_exceptions library_hours_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_hours_exceptions]
    ADD CONSTRAINT library_hours_exceptions_pkey PRIMARY KEY (id);
GO

--
-- Name: library_locations library_locations_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_locations]
    ADD CONSTRAINT library_locations_code_key UNIQUE (code);
GO

--
-- Name: library_locations library_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_locations]
    ADD CONSTRAINT library_locations_pkey PRIMARY KEY (id);
GO

--
-- Name: library_opening_hours library_opening_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_opening_hours]
    ADD CONSTRAINT library_opening_hours_pkey PRIMARY KEY (id);
GO

--
-- Name: library_provider_settings library_provider_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_provider_settings]
    ADD CONSTRAINT library_provider_settings_pkey PRIMARY KEY (id);
GO

--
-- Name: library_provider_settings library_provider_settings_provider_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_provider_settings]
    ADD CONSTRAINT library_provider_settings_provider_key_key UNIQUE (provider_key);
GO

--
-- Name: library_search_events library_search_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_search_events]
    ADD CONSTRAINT library_search_events_pkey PRIMARY KEY (id);
GO

--
-- Name: library_services library_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_services]
    ADD CONSTRAINT library_services_pkey PRIMARY KEY (id);
GO

--
-- Name: library_services library_services_service_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_services]
    ADD CONSTRAINT library_services_service_key_key UNIQUE (service_key);
GO

--
-- Name: message_attachments message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[message_attachments]
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (id);
GO

--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[messages]
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
GO

--
-- Name: model_routing_rules model_routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[model_routing_rules]
    ADD CONSTRAINT model_routing_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: model_routing_rules model_routing_rules_task_type_complexity_level_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[model_routing_rules]
    ADD CONSTRAINT model_routing_rules_task_type_complexity_level_key UNIQUE (task_type, complexity_level);
GO

--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_deliveries]
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);
GO

--
-- Name: notification_delivery_logs notification_delivery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_delivery_logs]
    ADD CONSTRAINT notification_delivery_logs_pkey PRIMARY KEY (id);
GO

--
-- Name: notification_dispatch_state notification_dispatch_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_dispatch_state]
    ADD CONSTRAINT notification_dispatch_state_pkey PRIMARY KEY (id);
GO

--
-- Name: notification_event_types notification_event_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_event_types]
    ADD CONSTRAINT notification_event_types_pkey PRIMARY KEY (event_type);
GO

--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_events]
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);
GO

--
-- Name: notification_group_members notification_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_group_members]
    ADD CONSTRAINT notification_group_members_pkey PRIMARY KEY (id);
GO

--
-- Name: notification_groups notification_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_groups]
    ADD CONSTRAINT notification_groups_pkey PRIMARY KEY (code);
GO

--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_preferences]
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);
GO

--
-- Name: notification_settings notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_settings]
    ADD CONSTRAINT notification_settings_pkey PRIMARY KEY (id);
GO

--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_templates]
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);
GO

--
-- Name: operation_idempotency operation_idempotency_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[operation_idempotency]
    ADD CONSTRAINT operation_idempotency_idempotency_key_key UNIQUE (idempotency_key);
GO

--
-- Name: operation_idempotency operation_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[operation_idempotency]
    ADD CONSTRAINT operation_idempotency_pkey PRIMARY KEY (id);
GO

--
-- Name: operational_insights operational_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[operational_insights]
    ADD CONSTRAINT operational_insights_pkey PRIMARY KEY (id);
GO

--
-- Name: performance_budgets performance_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[performance_budgets]
    ADD CONSTRAINT performance_budgets_pkey PRIMARY KEY (id);
GO

--
-- Name: performance_budgets performance_budgets_response_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[performance_budgets]
    ADD CONSTRAINT performance_budgets_response_category_key UNIQUE (response_category);
GO

--
-- Name: pilot_test_sessions pilot_test_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[pilot_test_sessions]
    ADD CONSTRAINT pilot_test_sessions_pkey PRIMARY KEY (id);
GO

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[profiles]
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
GO

--
-- Name: program_basket_courses program_basket_courses_basket_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_basket_courses]
    ADD CONSTRAINT program_basket_courses_basket_id_course_id_key UNIQUE (basket_id, course_id);
GO

--
-- Name: program_basket_courses program_basket_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_basket_courses]
    ADD CONSTRAINT program_basket_courses_pkey PRIMARY KEY (id);
GO

--
-- Name: program_courses program_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_courses]
    ADD CONSTRAINT program_courses_pkey PRIMARY KEY (id);
GO

--
-- Name: program_courses program_courses_program_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_courses]
    ADD CONSTRAINT program_courses_program_id_course_id_key UNIQUE (program_id, course_id);
GO

--
-- Name: program_requirement_baskets program_requirement_baskets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_requirement_baskets]
    ADD CONSTRAINT program_requirement_baskets_pkey PRIMARY KEY (id);
GO

--
-- Name: program_requirement_baskets program_requirement_baskets_program_id_code_effective_catal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_requirement_baskets]
    ADD CONSTRAINT program_requirement_baskets_program_id_code_effective_catal_key UNIQUE (program_id, code, effective_catalog_year);
GO

--
-- Name: programme_course_equivalencies programme_course_equivalencie_source_programme_id_source_co_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_course_equivalencies]
    ADD CONSTRAINT programme_course_equivalencie_source_programme_id_source_co_key UNIQUE (source_programme_id, source_course_id, target_programme_id);
GO

--
-- Name: programme_course_equivalencies programme_course_equivalencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_course_equivalencies]
    ADD CONSTRAINT programme_course_equivalencies_pkey PRIMARY KEY (id);
GO

--
-- Name: programme_transfer_capacity programme_transfer_capacity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_transfer_capacity]
    ADD CONSTRAINT programme_transfer_capacity_pkey PRIMARY KEY (id);
GO

--
-- Name: programme_transfer_capacity programme_transfer_capacity_programme_id_academic_term_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_transfer_capacity]
    ADD CONSTRAINT programme_transfer_capacity_programme_id_academic_term_id_key UNIQUE (programme_id, academic_term_id);
GO

--
-- Name: quality_targets quality_targets_metric_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[quality_targets]
    ADD CONSTRAINT quality_targets_metric_key_key UNIQUE (metric_key);
GO

--
-- Name: quality_targets quality_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[quality_targets]
    ADD CONSTRAINT quality_targets_pkey PRIMARY KEY (id);
GO

--
-- Name: release_readiness release_readiness_gate_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[release_readiness]
    ADD CONSTRAINT release_readiness_gate_key_key UNIQUE (gate_key);
GO

--
-- Name: release_readiness release_readiness_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[release_readiness]
    ADD CONSTRAINT release_readiness_pkey PRIMARY KEY (id);
GO

--
-- Name: response_cache_metadata response_cache_metadata_cache_key_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_cache_metadata]
    ADD CONSTRAINT response_cache_metadata_cache_key_language_key UNIQUE (cache_key, language);
GO

--
-- Name: response_cache_metadata response_cache_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_cache_metadata]
    ADD CONSTRAINT response_cache_metadata_pkey PRIMARY KEY (id);
GO

--
-- Name: response_performance_logs response_performance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_performance_logs]
    ADD CONSTRAINT response_performance_logs_pkey PRIMARY KEY (id);
GO

--
-- Name: response_quality_reviews response_quality_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_quality_reviews]
    ADD CONSTRAINT response_quality_reviews_pkey PRIMARY KEY (id);
GO

--
-- Name: risk_flags risk_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[risk_flags]
    ADD CONSTRAINT risk_flags_pkey PRIMARY KEY (id);
GO

--
-- Name: routing_decisions routing_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_pkey PRIMARY KEY (id);
GO

--
-- Name: routing_rules routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_rules]
    ADD CONSTRAINT routing_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: scheduled_job_runs scheduled_job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[scheduled_job_runs]
    ADD CONSTRAINT scheduled_job_runs_pkey PRIMARY KEY (id);
GO

--
-- Name: service_availability_audit service_availability_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_availability_audit]
    ADD CONSTRAINT service_availability_audit_pkey PRIMARY KEY (id);
GO

--
-- Name: service_availability_windows service_availability_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_availability_windows]
    ADD CONSTRAINT service_availability_windows_pkey PRIMARY KEY (id);
GO

--
-- Name: service_baselines service_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_baselines]
    ADD CONSTRAINT service_baselines_pkey PRIMARY KEY (id);
GO

--
-- Name: service_baselines service_baselines_university_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_baselines]
    ADD CONSTRAINT service_baselines_university_service_id_key UNIQUE (university_service_id);
GO

--
-- Name: service_degradation_state service_degradation_state_component_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_degradation_state]
    ADD CONSTRAINT service_degradation_state_component_key UNIQUE (component);
GO

--
-- Name: service_degradation_state service_degradation_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_degradation_state]
    ADD CONSTRAINT service_degradation_state_pkey PRIMARY KEY (id);
GO

--
-- Name: service_impact_baselines service_impact_baselines_journey_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_impact_baselines]
    ADD CONSTRAINT service_impact_baselines_journey_code_key UNIQUE (journey_code);
GO

--
-- Name: service_impact_baselines service_impact_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_impact_baselines]
    ADD CONSTRAINT service_impact_baselines_pkey PRIMARY KEY (id);
GO

--
-- Name: service_improvements service_improvements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_improvements]
    ADD CONSTRAINT service_improvements_pkey PRIMARY KEY (id);
GO

--
-- Name: service_knowledge_health service_knowledge_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_knowledge_health]
    ADD CONSTRAINT service_knowledge_health_pkey PRIMARY KEY (service_id);
GO

--
-- Name: service_level_rules service_level_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_level_rules]
    ADD CONSTRAINT service_level_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: service_owner_action_permissions service_owner_action_permissi_service_unit_id_role_action_c_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_owner_action_permissions]
    ADD CONSTRAINT service_owner_action_permissi_service_unit_id_role_action_c_key UNIQUE (service_unit_id, role, action_code);
GO

--
-- Name: service_owner_action_permissions service_owner_action_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_owner_action_permissions]
    ADD CONSTRAINT service_owner_action_permissions_pkey PRIMARY KEY (id);
GO

--
-- Name: service_owner_ai_preferences service_owner_ai_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_owner_ai_preferences]
    ADD CONSTRAINT service_owner_ai_preferences_pkey PRIMARY KEY (id);
GO

--
-- Name: service_owner_ai_preferences service_owner_ai_preferences_staff_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_owner_ai_preferences]
    ADD CONSTRAINT service_owner_ai_preferences_staff_profile_id_key UNIQUE (staff_profile_id);
GO

--
-- Name: service_process_metrics service_process_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_process_metrics]
    ADD CONSTRAINT service_process_metrics_pkey PRIMARY KEY (id);
GO

--
-- Name: service_requirements service_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_requirements]
    ADD CONSTRAINT service_requirements_pkey PRIMARY KEY (id);
GO

--
-- Name: service_staff service_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_staff]
    ADD CONSTRAINT service_staff_pkey PRIMARY KEY (id);
GO

--
-- Name: service_staff service_staff_staff_profile_id_service_unit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_staff]
    ADD CONSTRAINT service_staff_staff_profile_id_service_unit_id_key UNIQUE (staff_profile_id, service_unit_id);
GO

--
-- Name: service_unit_owners service_unit_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_unit_owners]
    ADD CONSTRAINT service_unit_owners_pkey PRIMARY KEY (id);
GO

--
-- Name: service_units service_units_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_code_key UNIQUE (code);
GO

--
-- Name: service_units service_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_pkey PRIMARY KEY (id);
GO

--
-- Name: service_workflow_steps service_workflow_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_workflow_steps]
    ADD CONSTRAINT service_workflow_steps_pkey PRIMARY KEY (id);
GO

--
-- Name: service_workflow_steps service_workflow_steps_university_service_id_step_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_workflow_steps]
    ADD CONSTRAINT service_workflow_steps_university_service_id_step_number_key UNIQUE (university_service_id, step_number);
GO

--
-- Name: staff_availability_rules staff_availability_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_availability_rules]
    ADD CONSTRAINT staff_availability_rules_pkey PRIMARY KEY (id);
GO

--
-- Name: staff_profiles staff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_profiles]
    ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (user_id);
GO

--
-- Name: staff_profiles staff_profiles_staff_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_profiles]
    ADD CONSTRAINT staff_profiles_staff_code_key UNIQUE (staff_code);
GO

--
-- Name: structured_data_sources structured_data_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[structured_data_sources]
    ADD CONSTRAINT structured_data_sources_pkey PRIMARY KEY (id);
GO

--
-- Name: student_alerts student_alerts_alert_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_alert_id_student_id_key UNIQUE (alert_id, student_id);
GO

--
-- Name: student_alerts student_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_pkey PRIMARY KEY (id);
GO

--
-- Name: student_appointments student_appointments_confirmation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_confirmation_code_key UNIQUE (confirmation_code);
GO

--
-- Name: student_appointments student_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_pkey PRIMARY KEY (id);
GO

--
-- Name: student_appointments student_appointments_student_id_appointment_slot_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_student_id_appointment_slot_id_key UNIQUE (student_id, appointment_slot_id);
GO

--
-- Name: student_career_profiles student_career_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_career_profiles]
    ADD CONSTRAINT student_career_profiles_pkey PRIMARY KEY (id);
GO

--
-- Name: student_career_profiles student_career_profiles_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_career_profiles]
    ADD CONSTRAINT student_career_profiles_student_id_key UNIQUE (student_id);
GO

--
-- Name: student_course_history student_course_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_course_history]
    ADD CONSTRAINT student_course_history_pkey PRIMARY KEY (id);
GO

--
-- Name: student_current_enrollments student_current_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_current_enrollments]
    ADD CONSTRAINT student_current_enrollments_pkey PRIMARY KEY (id);
GO

--
-- Name: student_current_enrollments student_current_enrollments_student_id_course_section_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_current_enrollments]
    ADD CONSTRAINT student_current_enrollments_student_id_course_section_id_key UNIQUE (student_id, course_section_id);
GO

--
-- Name: student_cv_documents student_cv_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_cv_documents]
    ADD CONSTRAINT student_cv_documents_pkey PRIMARY KEY (id);
GO

--
-- Name: student_documents student_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_documents]
    ADD CONSTRAINT student_documents_pkey PRIMARY KEY (id);
GO

--
-- Name: student_field_provenance student_field_provenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_field_provenance]
    ADD CONSTRAINT student_field_provenance_pkey PRIMARY KEY (id);
GO

--
-- Name: student_field_provenance student_field_provenance_student_id_field_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_field_provenance]
    ADD CONSTRAINT student_field_provenance_student_id_field_key_key UNIQUE (student_id, field_key);
GO

--
-- Name: student_holds student_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_holds]
    ADD CONSTRAINT student_holds_pkey PRIMARY KEY (id);
GO

--
-- Name: student_housing_preferences student_housing_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_housing_preferences]
    ADD CONSTRAINT student_housing_preferences_pkey PRIMARY KEY (id);
GO

--
-- Name: student_housing_preferences student_housing_preferences_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_housing_preferences]
    ADD CONSTRAINT student_housing_preferences_student_id_key UNIQUE (student_id);
GO

--
-- Name: student_internship_preferences student_internship_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_internship_preferences]
    ADD CONSTRAINT student_internship_preferences_pkey PRIMARY KEY (id);
GO

--
-- Name: student_internship_preferences student_internship_preferences_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_internship_preferences]
    ADD CONSTRAINT student_internship_preferences_student_id_key UNIQUE (student_id);
GO

--
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (user_id);
GO

--
-- Name: student_profiles student_profiles_student_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_student_number_key UNIQUE (student_number);
GO

--
-- Name: student_requirements student_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_requirements]
    ADD CONSTRAINT student_requirements_pkey PRIMARY KEY (id);
GO

--
-- Name: student_service_reminders student_service_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_service_reminders]
    ADD CONSTRAINT student_service_reminders_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_assessments suggestion_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_assessments]
    ADD CONSTRAINT suggestion_assessments_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_duplicates suggestion_duplicates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_duplicates]
    ADD CONSTRAINT suggestion_duplicates_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_reviews suggestion_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_reviews]
    ADD CONSTRAINT suggestion_reviews_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_similarities suggestion_similarities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_similarities]
    ADD CONSTRAINT suggestion_similarities_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_similarities suggestion_similarities_source_suggestion_id_similar_sugges_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_similarities]
    ADD CONSTRAINT suggestion_similarities_source_suggestion_id_similar_sugges_key UNIQUE (source_suggestion_id, similar_suggestion_id);
GO

--
-- Name: suggestion_updates suggestion_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_updates]
    ADD CONSTRAINT suggestion_updates_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_votes suggestion_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_votes]
    ADD CONSTRAINT suggestion_votes_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestion_votes suggestion_votes_suggestion_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_votes]
    ADD CONSTRAINT suggestion_votes_suggestion_id_student_id_key UNIQUE (suggestion_id, student_id);
GO

--
-- Name: suggestions suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_pkey PRIMARY KEY (id);
GO

--
-- Name: suggestions suggestions_reference_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_reference_number_key UNIQUE (reference_number);
GO

--
-- Name: tool_calls tool_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[tool_calls]
    ADD CONSTRAINT tool_calls_pkey PRIMARY KEY (id);
GO

--
-- Name: universities universities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[universities]
    ADD CONSTRAINT universities_pkey PRIMARY KEY (id);
GO

--
-- Name: universities universities_short_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[universities]
    ADD CONSTRAINT universities_short_name_key UNIQUE (short_name);
GO

--
-- Name: university_colleges university_colleges_name_en_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[university_colleges]
    ADD CONSTRAINT university_colleges_name_en_key UNIQUE (name_en);
GO

--
-- Name: university_colleges university_colleges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[university_colleges]
    ADD CONSTRAINT university_colleges_pkey PRIMARY KEY (id);
GO

--
-- Name: university_services university_services_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[university_services]
    ADD CONSTRAINT university_services_code_key UNIQUE (code);
GO

--
-- Name: university_services university_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[university_services]
    ADD CONSTRAINT university_services_pkey PRIMARY KEY (id);
GO

--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[user_roles]
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
GO

--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[user_roles]
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
GO

--
-- Name: web_knowledge_sources web_knowledge_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_knowledge_sources]
    ADD CONSTRAINT web_knowledge_sources_pkey PRIMARY KEY (id);
GO

--
-- Name: web_page_chunks web_page_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_page_chunks]
    ADD CONSTRAINT web_page_chunks_pkey PRIMARY KEY (id);
GO

--
-- Name: web_source_changes web_source_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_source_changes]
    ADD CONSTRAINT web_source_changes_pkey PRIMARY KEY (id);
GO

--
-- Name: web_source_pages web_source_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_source_pages]
    ADD CONSTRAINT web_source_pages_pkey PRIMARY KEY (id);
GO

--
-- Name: web_source_pages web_source_pages_web_source_id_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_source_pages]
    ADD CONSTRAINT web_source_pages_web_source_id_url_key UNIQUE (web_source_id, url);
GO

--
-- Name: working_calendars working_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[working_calendars]
    ADD CONSTRAINT working_calendars_pkey PRIMARY KEY (id);
GO


-- ========== INDEXES ==========

--
-- Name: agent_model_invocations_latency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [agent_model_invocations_latency_idx] ON [dbo].[agent_model_invocations] (created_at DESC, total_duration_ms DESC);
GO

--
-- Name: agent_model_invocations_purpose_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [agent_model_invocations_purpose_idx] ON [dbo].[agent_model_invocations] (purpose, created_at DESC);
GO

--
-- Name: agent_model_invocations_trace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [agent_model_invocations_trace_idx] ON [dbo].[agent_model_invocations] (trace_id, call_sequence);
GO

--
-- Name: alert_dedup_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [alert_dedup_unique] ON [dbo].[alert_deduplication] (student_id, alert_rule_id, condition_key);
GO

--
-- Name: ats_scoring_profiles_active_scope_idx; Type: INDEX; Schema: public; Owner: -
--

-- skipped expression index (same predicate; SQL Server needs a computed column)
-- CREATE UNIQUE INDEX [ats_scoring_profiles_active_scope_idx] ON [dbo].[ats_scoring_profiles] (scope, COALESCE(role_code, N''), weights_version);
GO

--
-- Name: bilingual_terms_canonical_idx; Type: INDEX; Schema: public; Owner: -
--

-- skipped expression index (same predicate; SQL Server needs a computed column)
-- CREATE UNIQUE INDEX [bilingual_terms_canonical_idx] ON [dbo].[bilingual_terms] (lower(canonical_en));
GO

--
-- Name: case_feedback_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [case_feedback_unique] ON [dbo].[case_feedback] (case_id, student_id);
GO

--
-- Name: case_reopen_requests_case_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [case_reopen_requests_case_kind_idx] ON [dbo].[case_reopen_requests] (case_id, kind);
GO

--
-- Name: case_sla_events_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [case_sla_events_unique] ON [dbo].[case_sla_events] (case_id, event_type, threshold_percentage);
GO

--
-- Name: cases_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [cases_actor_idx] ON [dbo].[cases] (current_responsible_actor);
GO

--
-- Name: cases_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [cases_severity_idx] ON [dbo].[cases] (severity);
GO

--
-- Name: cases_student_hidden_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [cases_student_hidden_idx] ON [dbo].[cases] (student_id, student_hidden_at, status, case_type);
GO

--
-- Name: cv_ats_scores_student_calc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [cv_ats_scores_student_calc_idx] ON [dbo].[cv_ats_scores] (student_id, calculated_at DESC);
GO

--
-- Name: cv_ats_scores_unique_run_idx; Type: INDEX; Schema: public; Owner: -
--

-- skipped expression index (same predicate; SQL Server needs a computed column)
-- CREATE UNIQUE INDEX [cv_ats_scores_unique_run_idx] ON [dbo].[cv_ats_scores] (cv_id, score_kind, COALESCE(role_code, N''), scoring_version, weights_version);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: document_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX document_chunks_embedding_idx ON public.document_chunks USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: emergency_contacts_active_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [emergency_contacts_active_priority_idx] ON [dbo].[emergency_contacts] (is_active, priority);
GO

--
-- Name: exception_events_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [exception_events_code_idx] ON [dbo].[exception_events] (code, created_at DESC);
GO

--
-- Name: idx_action_requests_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_action_requests_student] ON [dbo].[action_requests] (student_id);
GO

--
-- Name: idx_agent_runs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_agent_runs_created] ON [dbo].[agent_runs] (created_at DESC);
GO

--
-- Name: idx_agent_runs_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_agent_runs_user_created] ON [dbo].[agent_runs] (user_id, created_at DESC);
GO

--
-- Name: idx_appointment_requests_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_appointment_requests_case] ON [dbo].[appointment_requests] (case_id);
GO

--
-- Name: idx_appointment_requests_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_appointment_requests_staff] ON [dbo].[appointment_requests] (assigned_staff_id, request_status);
GO

--
-- Name: idx_appointment_requests_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_appointment_requests_student] ON [dbo].[appointment_requests] (student_id, request_status);
GO

--
-- Name: idx_appts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_appts_student] ON [dbo].[student_appointments] (student_id);
GO

--
-- Name: idx_assignments_related_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_assignments_related_case] ON [dbo].[internship_assignments] (related_case_id);
GO

--
-- Name: idx_ats_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_ats_student] ON [dbo].[cv_ats_scores] (student_id, calculated_at DESC);
GO

--
-- Name: idx_audit_actor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_audit_actor_created] ON [dbo].[audit_logs] (actor_id, created_at DESC);
GO

--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_audit_created] ON [dbo].[audit_logs] (created_at DESC);
GO

--
-- Name: idx_audit_entity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_audit_entity_created] ON [dbo].[audit_logs] (entity_type, created_at DESC);
GO

--
-- Name: idx_automation_events_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_automation_events_action] ON [dbo].[automation_events] (action_key, created_at DESC);
GO

--
-- Name: idx_automation_events_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_automation_events_case] ON [dbo].[automation_events] (case_id, created_at DESC);
GO

--
-- Name: idx_basket_courses_basket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_basket_courses_basket] ON [dbo].[program_basket_courses] (basket_id);
GO

--
-- Name: idx_baskets_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_baskets_program] ON [dbo].[program_requirement_baskets] (program_id);
GO

--
-- Name: idx_career_events_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_career_events_student] ON [dbo].[career_counselling_events] (student_id, created_at DESC);
GO

--
-- Name: idx_career_matches_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_career_matches_student] ON [dbo].[career_role_matches] (student_id, calculated_at DESC);
GO

--
-- Name: idx_career_versions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_career_versions_student] ON [dbo].[career_analysis_versions] (student_id, version_no DESC);
GO

--
-- Name: idx_case_comments_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_case_comments_case] ON [dbo].[case_comments] (case_id, created_at);
GO

--
-- Name: idx_case_oversight_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_case_oversight_case] ON [dbo].[case_oversight_actions] (case_id, created_at DESC);
GO

--
-- Name: idx_case_oversight_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_case_oversight_type] ON [dbo].[case_oversight_actions] (action_type, created_at DESC);
GO

--
-- Name: idx_case_resp_history_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_case_resp_history_case] ON [dbo].[case_responsibility_history] (case_id, started_at DESC);
GO

--
-- Name: idx_cases_assigned_to_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_assigned_to_status] ON [dbo].[cases] (assigned_to, status);
GO

--
-- Name: idx_cases_monitor_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_monitor_actor] ON [dbo].[cases] (current_responsible_actor, status, updated_at DESC) WHERE (deleted_at IS NULL);
GO

--
-- Name: idx_cases_monitor_escalation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_monitor_escalation] ON [dbo].[cases] (escalation_level, status) WHERE (deleted_at IS NULL);
GO

--
-- Name: idx_cases_monitor_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_monitor_owner] ON [dbo].[cases] (assigned_to, status, updated_at DESC) WHERE (deleted_at IS NULL);
GO

--
-- Name: idx_cases_monitor_type_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_monitor_type_activity] ON [dbo].[cases] (case_type, status, last_activity_at DESC) WHERE (deleted_at IS NULL);
GO

--
-- Name: idx_cases_monitor_unit_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_monitor_unit_due] ON [dbo].[cases] (service_unit_id, status, resolution_due_at) WHERE (deleted_at IS NULL);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_cases_number_trgm; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_cases_number_trgm ON public.cases USING gin (case_number public.gin_trgm_ops);


--
-- Name: idx_cases_related_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_related_assignment] ON [dbo].[cases] (related_internship_assignment_id);
GO

--
-- Name: idx_cases_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_status_created] ON [dbo].[cases] (status, created_at DESC);
GO

--
-- Name: idx_cases_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_student] ON [dbo].[cases] (student_id, created_at DESC);
GO

--
-- Name: idx_cases_student_visible_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_student_visible_created] ON [dbo].[cases] (student_id, created_at DESC) WHERE (student_hidden_at IS NULL);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_cases_title_trgm; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_cases_title_trgm ON public.cases USING gin (title public.gin_trgm_ops);


--
-- Name: idx_cases_unit_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_unit_due] ON [dbo].[cases] (service_unit_id, resolution_due_at);
GO

--
-- Name: idx_cases_unit_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_unit_status] ON [dbo].[cases] (service_unit_id, status);
GO

--
-- Name: idx_cases_unit_status_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_unit_status_activity] ON [dbo].[cases] (service_unit_id, status, last_activity_at DESC);
GO

--
-- Name: idx_cases_unit_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cases_unit_type_created] ON [dbo].[cases] (service_unit_id, case_type, created_at DESC);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_chunks_content_trgm; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_chunks_content_trgm ON public.document_chunks USING gin (content public.gin_trgm_ops);


--
-- Name: idx_chunks_doc_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_chunks_doc_active] ON [dbo].[document_chunks] (document_id) WHERE is_active = 1;
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_chunks_search_vector; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_chunks_search_vector ON public.document_chunks USING gin (search_vector);


--
-- Name: idx_conv_state_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_conv_state_conversation] ON [dbo].[conversation_state] (conversation_id);
GO

--
-- Name: idx_conversations_case_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_conversations_case_updated] ON [dbo].[conversations] (related_case_id, updated_at DESC);
GO

--
-- Name: idx_conversations_related_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_conversations_related_case] ON [dbo].[conversations] (related_case_id);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_conversations_title_trgm; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_conversations_title_trgm ON public.conversations USING gin (title public.gin_trgm_ops);


--
-- Name: idx_conversations_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_conversations_user_created] ON [dbo].[conversations] (user_id, created_at DESC);
GO

--
-- Name: idx_conversations_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_conversations_user_updated] ON [dbo].[conversations] (user_id, updated_at DESC);
GO

--
-- Name: idx_cv_docs_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cv_docs_student] ON [dbo].[student_cv_documents] (student_id, uploaded_at DESC);
GO

--
-- Name: idx_cv_scans_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_cv_scans_student] ON [dbo].[cv_upload_scans] (student_id, created_at DESC);
GO

--
-- Name: idx_document_deletion_records_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_document_deletion_records_student] ON [dbo].[document_deletion_records] (student_id, deleted_at DESC);
GO

--
-- Name: idx_document_events_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_document_events_doc] ON [dbo].[document_events] (document_id, created_at DESC);
GO

--
-- Name: idx_dva_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_dva_client] ON [dbo].[document_verification_attempts] (client_hash, created_at DESC);
GO

--
-- Name: idx_dva_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_dva_token] ON [dbo].[document_verification_attempts] (token_hash, created_at DESC);
GO

--
-- Name: idx_eval_runs_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_eval_runs_batch] ON [dbo].[evaluation_runs] (batch_id, created_at DESC);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_faq_search_vector; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_faq_search_vector ON public.faq_items USING gin (search_vector);


--
-- Name: idx_grounding_checks_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_grounding_checks_created] ON [dbo].[grounding_checks] (created_at DESC);
GO

--
-- Name: idx_holds_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_holds_student] ON [dbo].[student_holds] (student_id);
GO

--
-- Name: idx_ict_ack_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_ict_ack_request] ON [dbo].[intercollege_transfer_acknowledgements] (transfer_request_id);
GO

--
-- Name: idx_ict_impact_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_ict_impact_request] ON [dbo].[intercollege_transfer_course_impact] (transfer_request_id);
GO

--
-- Name: idx_ict_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_ict_student] ON [dbo].[intercollege_transfer_requests] (student_id, transfer_status);
GO

--
-- Name: idx_internship_assignments_clearance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_internship_assignments_clearance] ON [dbo].[internship_assignments] (government_clearance_status);
GO

--
-- Name: idx_internship_audit_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_internship_audit_assignment] ON [dbo].[internship_assignment_audit] (assignment_id, created_at);
GO

--
-- Name: idx_internship_match_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_internship_match_student] ON [dbo].[internship_match_explanations] (student_id, calculated_at DESC);
GO

--
-- Name: idx_internship_one_active_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [idx_internship_one_active_assignment] ON [dbo].[internship_assignments] (student_id) WHERE (assignment_status IN (N'reserved', N'assigned', N'confirmed', N'registered', N'human_review'));
GO

--
-- Name: idx_issued_documents_retention; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_issued_documents_retention] ON [dbo].[issued_documents] (retention_expires_at) WHERE (deleted_at IS NULL);
GO

--
-- Name: idx_issued_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_issued_documents_status] ON [dbo].[issued_documents] (document_status);
GO

--
-- Name: idx_issued_documents_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_issued_documents_student] ON [dbo].[issued_documents] (student_id, issued_at DESC);
GO

--
-- Name: idx_kdocs_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_kdocs_current] ON [dbo].[knowledge_documents] (is_current, approval_status);
GO

--
-- Name: idx_kdocs_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_kdocs_unit] ON [dbo].[knowledge_documents] (service_unit_id);
GO

--
-- Name: idx_krl_retrieved_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_krl_retrieved_at] ON [dbo].[knowledge_retrieval_logs] (retrieved_at DESC);
GO

--
-- Name: idx_krl_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_krl_trace] ON [dbo].[knowledge_retrieval_logs] (trace_id);
GO

--
-- Name: idx_messages_conv_created_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_messages_conv_created_desc] ON [dbo].[messages] (conversation_id, created_at DESC);
GO

--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_messages_conversation] ON [dbo].[messages] (conversation_id, created_at);
GO

--
-- Name: idx_nd_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_nd_created] ON [dbo].[notification_deliveries] (created_at DESC);
GO

--
-- Name: idx_nd_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_nd_pending] ON [dbo].[notification_deliveries] (status, next_attempt_at) WHERE (status IN (N'queued', N'retrying'));
GO

--
-- Name: idx_nd_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_nd_recipient] ON [dbo].[notification_deliveries] (recipient_user_id, created_at DESC);
GO

--
-- Name: idx_notification_events_sev_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_notification_events_sev_created] ON [dbo].[notification_events] (severity, created_at DESC);
GO

--
-- Name: idx_receipts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_receipts_student] ON [dbo].[action_receipts] (student_id, submitted_at DESC);
GO

--
-- Name: idx_revalidation_events_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_revalidation_events_action] ON [dbo].[action_revalidation_events] (action_code, executed_at DESC);
GO

--
-- Name: idx_revalidation_events_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_revalidation_events_student] ON [dbo].[action_revalidation_events] (student_id, executed_at DESC);
GO

--
-- Name: idx_rpl_category_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_rpl_category_created] ON [dbo].[response_performance_logs] (response_category, created_at DESC);
GO

--
-- Name: idx_rpl_path_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_rpl_path_total] ON [dbo].[response_performance_logs] (execution_path, total_duration_ms);
GO

--
-- Name: idx_rpl_slowest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_rpl_slowest] ON [dbo].[response_performance_logs] (total_duration_ms DESC, created_at DESC);
GO

--
-- Name: idx_rpl_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_rpl_trace] ON [dbo].[response_performance_logs] (trace_id);
GO

--
-- Name: idx_saw_opens; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_saw_opens] ON [dbo].[service_availability_windows] (opens_at);
GO

--
-- Name: idx_saw_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_saw_service] ON [dbo].[service_availability_windows] (service_id, status);
GO

--
-- Name: idx_sce_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_sce_student] ON [dbo].[student_current_enrollments] (student_id);
GO

--
-- Name: idx_sch_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_sch_student] ON [dbo].[student_course_history] (student_id);
GO

--
-- Name: idx_sdocs_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_sdocs_student] ON [dbo].[student_documents] (student_id);
GO

--
-- Name: idx_service_units_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_service_units_code] ON [dbo].[service_units] (code);
GO

--
-- Name: idx_slots_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_slots_type_time] ON [dbo].[appointment_slots] (appointment_type_id, start_time);
GO

--
-- Name: idx_sreq_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_sreq_student] ON [dbo].[student_requirements] (student_id);
GO

--
-- Name: idx_ssr_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_ssr_due] ON [dbo].[student_service_reminders] (status, scheduled_for);
GO

--
-- Name: idx_ssr_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [idx_ssr_unique_active] ON [dbo].[student_service_reminders] (student_id, service_id, availability_window_id, reminder_type) WHERE (status = N'scheduled');
GO

--
-- Name: idx_staff_profiles_unit_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_staff_profiles_unit_active] ON [dbo].[staff_profiles] (service_unit_id, is_active, availability_status);
GO

--
-- Name: idx_student_alerts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_student_alerts_student] ON [dbo].[student_alerts] (student_id, status);
GO

--
-- Name: idx_student_alerts_student_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_student_alerts_student_created] ON [dbo].[student_alerts] (student_id, created_at DESC);
GO

--
-- Name: idx_student_alerts_student_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_student_alerts_student_status] ON [dbo].[student_alerts] (student_id, status, created_at DESC);
GO

--
-- Name: idx_student_alerts_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_student_alerts_unread] ON [dbo].[student_alerts] (student_id) WHERE (is_read = 0);
GO

--
-- Name: idx_student_profiles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_student_profiles_user] ON [dbo].[student_profiles] (user_id);
GO

--
-- Name: idx_suggestions_student_visible_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_suggestions_student_visible_created] ON [dbo].[suggestions] (student_id, created_at DESC) WHERE (student_hidden_at IS NULL);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_suggestions_title_trgm; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_suggestions_title_trgm ON public.suggestions USING gin (title public.gin_trgm_ops);


--
-- Name: idx_suggestions_unit_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_suggestions_unit_status_created] ON [dbo].[suggestions] (service_unit_id, status, created_at DESC);
GO

--
-- Name: idx_tool_exec_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_tool_exec_owner] ON [dbo].[agent_tool_executions] (requested_by_profile_id, started_at DESC);
GO

--
-- Name: idx_tool_exec_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_tool_exec_run] ON [dbo].[agent_tool_executions] (agent_run_id);
GO

--
-- Name: idx_tools_connector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_tools_connector] ON [dbo].[integration_tools] (connector_id, enabled);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: idx_web_search_vector; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX idx_web_search_vector ON public.web_knowledge_sources USING gin (search_vector);


--
-- Name: idx_web_sources_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [idx_web_sources_active] ON [dbo].[web_knowledge_sources] (is_active, approval_status);
GO

--
-- Name: issued_documents_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [issued_documents_message_id_idx] ON [dbo].[issued_documents] (message_id) WHERE (message_id IS NOT NULL);
GO

--
-- Name: library_opening_hours_loc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [library_opening_hours_loc_idx] ON [dbo].[library_opening_hours] (library_location_id, day_of_week);
GO

--
-- Name: library_search_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [library_search_events_created_idx] ON [dbo].[library_search_events] (created_at DESC);
GO

--
-- Name: notification_events_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [notification_events_dedupe] ON [dbo].[notification_events] (dedupe_key);
GO

--
-- Name: notification_templates_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [notification_templates_unique] ON [dbo].[notification_templates] (event_type, channel, language, version);
GO

--
-- Name: pilot_test_sessions_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [pilot_test_sessions_service_idx] ON [dbo].[pilot_test_sessions] (university_service_id, tested_on DESC);
GO

--
-- Name: profiles_access_revoked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [profiles_access_revoked_idx] ON [dbo].[profiles] (access_revoked_at) WHERE (access_revoked_at IS NOT NULL);
GO

--
-- Name: response_performance_logs_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [response_performance_logs_created_idx] ON [dbo].[response_performance_logs] (created_at DESC);
GO

--
-- Name: response_performance_logs_path_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [response_performance_logs_path_created_idx] ON [dbo].[response_performance_logs] (execution_path, created_at DESC);
GO

--
-- Name: response_performance_logs_supervisor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [response_performance_logs_supervisor_idx] ON [dbo].[response_performance_logs] (supervisor_invoked, created_at DESC);
GO

--
-- Name: response_performance_logs_trace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [response_performance_logs_trace_created_idx] ON [dbo].[response_performance_logs] (trace_id, created_at DESC);
GO

--
-- Name: service_unit_owners_active_primary_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [service_unit_owners_active_primary_idx] ON [dbo].[service_unit_owners] (service_unit_id) WHERE ((ownership_type = N'primary') AND is_active = 1);
GO

--
-- Name: student_cv_documents_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [student_cv_documents_one_current] ON [dbo].[student_cv_documents] (student_id) WHERE ((is_current = 1) AND (deleted_at IS NULL));
GO

--
-- Name: student_cv_documents_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [student_cv_documents_student_idx] ON [dbo].[student_cv_documents] (student_id, uploaded_at DESC);
GO

--
-- Name: suggestions_student_hidden_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [suggestions_student_hidden_idx] ON [dbo].[suggestions] (student_id, student_hidden_at, status);
GO

--
-- Name: uniq_live_housing_allocation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [uniq_live_housing_allocation] ON [dbo].[housing_allocations] (student_id) WHERE (allocation_status IN (N'reserved', N'active'));
GO

--
-- Name: uniq_open_housing_application; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [uniq_open_housing_application] ON [dbo].[housing_applications] (student_id) WHERE (application_status <> N'cancelled' AND application_status <> N'registered' AND application_status <> N'not_eligible');
GO

--
-- Name: uq_ngm_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [uq_ngm_email] ON [dbo].[notification_group_members] (group_code, email) WHERE (email IS NOT NULL);
GO

--
-- Name: uq_ngm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [uq_ngm_user] ON [dbo].[notification_group_members] (group_code, user_id) WHERE (user_id IS NOT NULL);
GO

--
-- Name: uq_notification_deliveries_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX [uq_notification_deliveries_dedupe] ON [dbo].[notification_deliveries] (dedupe_key);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: web_page_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX web_page_chunks_embedding_idx ON public.web_page_chunks USING hnsw (embedding public.vector_cosine_ops);


-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: web_page_chunks_fts_idx; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX web_page_chunks_fts_idx ON public.web_page_chunks USING gin (search_vector);


--
-- Name: web_page_chunks_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [web_page_chunks_page_idx] ON [dbo].[web_page_chunks] (page_id);
GO

--
-- Name: web_page_chunks_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [web_page_chunks_source_idx] ON [dbo].[web_page_chunks] (web_source_id, is_active);
GO

-- skipped PostgreSQL-only index (logic kept as comment)
-- -- -- Name: web_page_chunks_trgm_idx; Type: INDEX; Schema: public; Owner: - -- CREATE INDEX web_page_chunks_trgm_idx ON public.web_page_chunks USING gin (content public.gin_trgm_ops);


--
-- Name: web_source_pages_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX [web_source_pages_source_idx] ON [dbo].[web_source_pages] (web_source_id, status);
GO


-- ========== FOREIGN KEYS ==========

--
-- Name: academic_programs academic_programs_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_programs]
    ADD CONSTRAINT academic_programs_college_id_fkey FOREIGN KEY (college_id) REFERENCES [dbo].[colleges](id) ON DELETE NO ACTION;
GO

--
-- Name: academic_programs academic_programs_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_programs]
    ADD CONSTRAINT academic_programs_department_id_fkey FOREIGN KEY (department_id) REFERENCES [dbo].[departments](id) ON DELETE NO ACTION;
GO

--
-- Name: academic_terms academic_terms_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[academic_terms]
    ADD CONSTRAINT academic_terms_university_id_fkey FOREIGN KEY (university_id) REFERENCES [dbo].[universities](id) ON DELETE NO ACTION;
GO

--
-- Name: action_approvals action_approvals_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_approvals]
    ADD CONSTRAINT action_approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: action_approvals action_approvals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_approvals]
    ADD CONSTRAINT action_approvals_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: action_receipts action_receipts_action_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_action_request_id_fkey FOREIGN KEY (action_request_id) REFERENCES [dbo].[action_requests](id) ON DELETE NO ACTION;
GO

--
-- Name: action_receipts action_receipts_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES [dbo].[student_appointments](id) ON DELETE NO ACTION;
GO

--
-- Name: action_receipts action_receipts_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: action_receipts action_receipts_responsible_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_responsible_unit_id_fkey FOREIGN KEY (responsible_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: action_receipts action_receipts_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_receipts]
    ADD CONSTRAINT action_receipts_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: action_request_documents action_request_documents_action_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_request_documents]
    ADD CONSTRAINT action_request_documents_action_request_id_fkey FOREIGN KEY (action_request_id) REFERENCES [dbo].[action_requests](id) ON DELETE NO ACTION;
GO

--
-- Name: action_request_documents action_request_documents_student_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_request_documents]
    ADD CONSTRAINT action_request_documents_student_document_id_fkey FOREIGN KEY (student_document_id) REFERENCES [dbo].[student_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: action_requests action_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: action_requests action_requests_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: action_requests action_requests_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: action_requests action_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: action_requests action_requests_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[action_requests]
    ADD CONSTRAINT action_requests_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: agent_runs agent_runs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_runs]
    ADD CONSTRAINT agent_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: agent_runs agent_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_runs]
    ADD CONSTRAINT agent_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: agent_tool_executions agent_tool_executions_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_tool_executions]
    ADD CONSTRAINT agent_tool_executions_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES [dbo].[agent_runs](id) ON DELETE NO ACTION;
GO

--
-- Name: agent_tool_executions agent_tool_executions_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_tool_executions]
    ADD CONSTRAINT agent_tool_executions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: agent_tool_executions agent_tool_executions_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[agent_tool_executions]
    ADD CONSTRAINT agent_tool_executions_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES [dbo].[agent_tools](id) ON DELETE NO ACTION;
GO

--
-- Name: ai_human_edits ai_human_edits_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[ai_human_edits]
    ADD CONSTRAINT ai_human_edits_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: ai_human_edits ai_human_edits_editor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[ai_human_edits]
    ADD CONSTRAINT ai_human_edits_editor_profile_id_fkey FOREIGN KEY (editor_profile_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: alert_deduplication alert_deduplication_alert_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_deduplication]
    ADD CONSTRAINT alert_deduplication_alert_rule_id_fkey FOREIGN KEY (alert_rule_id) REFERENCES [dbo].[alert_rules](id) ON DELETE NO ACTION;
GO

--
-- Name: alert_deduplication alert_deduplication_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_deduplication]
    ADD CONSTRAINT alert_deduplication_student_id_fkey FOREIGN KEY (student_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: alert_rule_conditions alert_rule_conditions_alert_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_rule_conditions]
    ADD CONSTRAINT alert_rule_conditions_alert_rule_id_fkey FOREIGN KEY (alert_rule_id) REFERENCES [dbo].[alert_rules](id) ON DELETE NO ACTION;
GO

--
-- Name: alert_rule_runs alert_rule_runs_alert_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_rule_runs]
    ADD CONSTRAINT alert_rule_runs_alert_rule_id_fkey FOREIGN KEY (alert_rule_id) REFERENCES [dbo].[alert_rules](id) ON DELETE NO ACTION;
GO

--
-- Name: alert_rules alert_rules_related_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alert_rules]
    ADD CONSTRAINT alert_rules_related_service_id_fkey FOREIGN KEY (related_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: alerts alerts_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[alerts]
    ADD CONSTRAINT alerts_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_requests appointment_requests_assigned_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_requests]
    ADD CONSTRAINT appointment_requests_assigned_staff_id_fkey FOREIGN KEY (assigned_staff_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_requests appointment_requests_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_requests]
    ADD CONSTRAINT appointment_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_requests appointment_requests_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_requests]
    ADD CONSTRAINT appointment_requests_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_requests appointment_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_requests]
    ADD CONSTRAINT appointment_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_slots appointment_slots_appointment_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_slots]
    ADD CONSTRAINT appointment_slots_appointment_type_id_fkey FOREIGN KEY (appointment_type_id) REFERENCES [dbo].[appointment_types](id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_slots appointment_slots_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_slots]
    ADD CONSTRAINT appointment_slots_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES [dbo].[staff_profiles](user_id) ON DELETE NO ACTION;
GO

--
-- Name: appointment_types appointment_types_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[appointment_types]
    ADD CONSTRAINT appointment_types_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: approval_requests approval_requests_action_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[approval_requests]
    ADD CONSTRAINT approval_requests_action_request_id_fkey FOREIGN KEY (action_request_id) REFERENCES [dbo].[action_requests](id) ON DELETE NO ACTION;
GO

--
-- Name: approval_requests approval_requests_assigned_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[approval_requests]
    ADD CONSTRAINT approval_requests_assigned_approver_id_fkey FOREIGN KEY (assigned_approver_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: approval_requests approval_requests_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[approval_requests]
    ADD CONSTRAINT approval_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: approval_requests approval_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[approval_requests]
    ADD CONSTRAINT approval_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: approval_requests approval_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[approval_requests]
    ADD CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[audit_logs]
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: automation_events automation_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[automation_events]
    ADD CONSTRAINT automation_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: automation_events automation_events_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[automation_events]
    ADD CONSTRAINT automation_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: automation_events automation_events_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[automation_events]
    ADD CONSTRAINT automation_events_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES [dbo].[automation_policies](id) ON DELETE NO ACTION;
GO

--
-- Name: automation_policies automation_policies_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[automation_policies]
    ADD CONSTRAINT automation_policies_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: bilingual_terms bilingual_terms_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[bilingual_terms]
    ADD CONSTRAINT bilingual_terms_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: bilingual_terms bilingual_terms_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[bilingual_terms]
    ADD CONSTRAINT bilingual_terms_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: calendar_exceptions calendar_exceptions_working_calendar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[calendar_exceptions]
    ADD CONSTRAINT calendar_exceptions_working_calendar_id_fkey FOREIGN KEY (working_calendar_id) REFERENCES [dbo].[working_calendars](id) ON DELETE NO ACTION;
GO

--
-- Name: campuses campuses_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[campuses]
    ADD CONSTRAINT campuses_university_id_fkey FOREIGN KEY (university_id) REFERENCES [dbo].[universities](id) ON DELETE NO ACTION;
GO

--
-- Name: career_analysis_versions career_analysis_versions_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_analysis_versions]
    ADD CONSTRAINT career_analysis_versions_cv_id_fkey FOREIGN KEY (cv_id) REFERENCES [dbo].[student_cv_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: career_counselling_events career_counselling_events_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_counselling_events]
    ADD CONSTRAINT career_counselling_events_cv_id_fkey FOREIGN KEY (cv_id) REFERENCES [dbo].[student_cv_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: career_role_matches career_role_matches_career_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_role_matches]
    ADD CONSTRAINT career_role_matches_career_role_id_fkey FOREIGN KEY (career_role_id) REFERENCES [dbo].[career_roles](id) ON DELETE NO ACTION;
GO

--
-- Name: career_role_matches career_role_matches_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[career_role_matches]
    ADD CONSTRAINT career_role_matches_cv_id_fkey FOREIGN KEY (cv_id) REFERENCES [dbo].[student_cv_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: case_access_restrictions case_access_restrictions_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_access_restrictions]
    ADD CONSTRAINT case_access_restrictions_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_access_restrictions case_access_restrictions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_access_restrictions]
    ADD CONSTRAINT case_access_restrictions_created_by_fkey FOREIGN KEY (created_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_assignments case_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_assignments]
    ADD CONSTRAINT case_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: case_assignments case_assignments_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_assignments]
    ADD CONSTRAINT case_assignments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: case_assignments case_assignments_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_assignments]
    ADD CONSTRAINT case_assignments_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_assignments case_assignments_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_assignments]
    ADD CONSTRAINT case_assignments_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: case_automation_state case_automation_state_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_automation_state]
    ADD CONSTRAINT case_automation_state_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_automation_state case_automation_state_paused_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_automation_state]
    ADD CONSTRAINT case_automation_state_paused_by_fkey FOREIGN KEY (paused_by) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: case_categories case_categories_default_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_categories]
    ADD CONSTRAINT case_categories_default_unit_id_fkey FOREIGN KEY (default_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: case_comments case_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_comments]
    ADD CONSTRAINT case_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: case_comments case_comments_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_comments]
    ADD CONSTRAINT case_comments_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_conflicts_of_interest case_conflicts_of_interest_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_conflicts_of_interest]
    ADD CONSTRAINT case_conflicts_of_interest_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_conflicts_of_interest case_conflicts_of_interest_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_conflicts_of_interest]
    ADD CONSTRAINT case_conflicts_of_interest_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_escalations case_escalations_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_escalations]
    ADD CONSTRAINT case_escalations_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_escalations case_escalations_raised_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_escalations]
    ADD CONSTRAINT case_escalations_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: case_evidence case_evidence_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_evidence]
    ADD CONSTRAINT case_evidence_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_evidence case_evidence_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_evidence]
    ADD CONSTRAINT case_evidence_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: case_feedback case_feedback_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_feedback]
    ADD CONSTRAINT case_feedback_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_feedback case_feedback_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_feedback]
    ADD CONSTRAINT case_feedback_student_id_fkey FOREIGN KEY (student_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: case_handovers case_handovers_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_handovers]
    ADD CONSTRAINT case_handovers_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_handovers case_handovers_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_handovers]
    ADD CONSTRAINT case_handovers_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: case_information_requests case_information_requests_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_information_requests]
    ADD CONSTRAINT case_information_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_information_requests case_information_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_information_requests]
    ADD CONSTRAINT case_information_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_oversight_actions case_oversight_actions_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_oversight_actions]
    ADD CONSTRAINT case_oversight_actions_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_reopen_requests case_reopen_requests_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_reopen_requests]
    ADD CONSTRAINT case_reopen_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_reopen_requests case_reopen_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_reopen_requests]
    ADD CONSTRAINT case_reopen_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_reopen_requests case_reopen_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_reopen_requests]
    ADD CONSTRAINT case_reopen_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: case_resolutions case_resolutions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_resolutions]
    ADD CONSTRAINT case_resolutions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_resolutions case_resolutions_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_resolutions]
    ADD CONSTRAINT case_resolutions_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_resolutions case_resolutions_prepared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_resolutions]
    ADD CONSTRAINT case_resolutions_prepared_by_fkey FOREIGN KEY (prepared_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_responsibility_history case_responsibility_history_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_responsibility_history]
    ADD CONSTRAINT case_responsibility_history_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_responsibility_history case_responsibility_history_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_responsibility_history]
    ADD CONSTRAINT case_responsibility_history_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: case_routing_feedback case_routing_feedback_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_routing_feedback]
    ADD CONSTRAINT case_routing_feedback_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_routing_feedback case_routing_feedback_corrected_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_routing_feedback]
    ADD CONSTRAINT case_routing_feedback_corrected_unit_id_fkey FOREIGN KEY (corrected_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: case_routing_feedback case_routing_feedback_original_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_routing_feedback]
    ADD CONSTRAINT case_routing_feedback_original_unit_id_fkey FOREIGN KEY (original_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: case_sla_events case_sla_events_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_sla_events]
    ADD CONSTRAINT case_sla_events_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: case_sla_events case_sla_events_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_sla_events]
    ADD CONSTRAINT case_sla_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_status_history case_status_history_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_status_history]
    ADD CONSTRAINT case_status_history_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: case_status_history case_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[case_status_history]
    ADD CONSTRAINT case_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_category_id_fkey FOREIGN KEY (category_id) REFERENCES [dbo].[case_categories](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_linked_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_linked_suggestion_id_fkey FOREIGN KEY (linked_suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_related_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_related_conversation_id_fkey FOREIGN KEY (related_conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_related_internship_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_related_internship_assignment_id_fkey FOREIGN KEY (related_internship_assignment_id) REFERENCES [dbo].[internship_assignments](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: cases cases_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cases]
    ADD CONSTRAINT cases_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: citations citations_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[citations]
    ADD CONSTRAINT citations_document_id_fkey FOREIGN KEY (document_id) REFERENCES [dbo].[knowledge_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: citations citations_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[citations]
    ADD CONSTRAINT citations_message_id_fkey FOREIGN KEY (message_id) REFERENCES [dbo].[messages](id) ON DELETE NO ACTION;
GO

--
-- Name: citations citations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[citations]
    ADD CONSTRAINT citations_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: colleges colleges_campus_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[colleges]
    ADD CONSTRAINT colleges_campus_id_fkey FOREIGN KEY (campus_id) REFERENCES [dbo].[campuses](id) ON DELETE NO ACTION;
GO

--
-- Name: colleges colleges_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[colleges]
    ADD CONSTRAINT colleges_university_id_fkey FOREIGN KEY (university_id) REFERENCES [dbo].[universities](id) ON DELETE NO ACTION;
GO

--
-- Name: consent_records consent_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[consent_records]
    ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: conversation_state conversation_state_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: conversation_state conversation_state_current_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_current_service_id_fkey FOREIGN KEY (current_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: conversation_state conversation_state_current_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_current_service_unit_id_fkey FOREIGN KEY (current_service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: conversation_state conversation_state_pending_action_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_pending_action_request_id_fkey FOREIGN KEY (pending_action_request_id) REFERENCES [dbo].[action_requests](id) ON DELETE NO ACTION;
GO

--
-- Name: conversation_state conversation_state_related_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_related_case_id_fkey FOREIGN KEY (related_case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: conversation_state conversation_state_related_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversation_state]
    ADD CONSTRAINT conversation_state_related_suggestion_id_fkey FOREIGN KEY (related_suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: conversations conversations_related_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversations]
    ADD CONSTRAINT conversations_related_case_id_fkey FOREIGN KEY (related_case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[conversations]
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: course_prerequisites course_prerequisites_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_prerequisites]
    ADD CONSTRAINT course_prerequisites_course_id_fkey FOREIGN KEY (course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: course_prerequisites course_prerequisites_prerequisite_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_prerequisites]
    ADD CONSTRAINT course_prerequisites_prerequisite_course_id_fkey FOREIGN KEY (prerequisite_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: course_sections course_sections_academic_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_sections]
    ADD CONSTRAINT course_sections_academic_term_id_fkey FOREIGN KEY (academic_term_id) REFERENCES [dbo].[academic_terms](id) ON DELETE NO ACTION;
GO

--
-- Name: course_sections course_sections_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[course_sections]
    ADD CONSTRAINT course_sections_course_id_fkey FOREIGN KEY (course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: courses courses_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[courses]
    ADD CONSTRAINT courses_department_id_fkey FOREIGN KEY (department_id) REFERENCES [dbo].[departments](id) ON DELETE NO ACTION;
GO

--
-- Name: cv_ats_scores cv_ats_scores_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cv_ats_scores]
    ADD CONSTRAINT cv_ats_scores_cv_id_fkey FOREIGN KEY (cv_id) REFERENCES [dbo].[student_cv_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: cv_ats_scores cv_ats_scores_target_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cv_ats_scores]
    ADD CONSTRAINT cv_ats_scores_target_role_id_fkey FOREIGN KEY (target_role_id) REFERENCES [dbo].[career_roles](id) ON DELETE NO ACTION;
GO

--
-- Name: cv_upload_scans cv_upload_scans_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cv_upload_scans]
    ADD CONSTRAINT cv_upload_scans_cv_id_fkey FOREIGN KEY (cv_id) REFERENCES [dbo].[student_cv_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: cv_upload_scans cv_upload_scans_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[cv_upload_scans]
    ADD CONSTRAINT cv_upload_scans_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: data_authority_rules data_authority_rules_owner_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[data_authority_rules]
    ADD CONSTRAINT data_authority_rules_owner_unit_id_fkey FOREIGN KEY (owner_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: departments departments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[departments]
    ADD CONSTRAINT departments_college_id_fkey FOREIGN KEY (college_id) REFERENCES [dbo].[colleges](id) ON DELETE NO ACTION;
GO

--
-- Name: detected_intents detected_intents_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[detected_intents]
    ADD CONSTRAINT detected_intents_message_id_fkey FOREIGN KEY (message_id) REFERENCES [dbo].[messages](id) ON DELETE NO ACTION;
GO

--
-- Name: detected_intents detected_intents_required_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[detected_intents]
    ADD CONSTRAINT detected_intents_required_unit_id_fkey FOREIGN KEY (required_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: detected_intents detected_intents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[detected_intents]
    ADD CONSTRAINT detected_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: document_chunks document_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_chunks]
    ADD CONSTRAINT document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES [dbo].[knowledge_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: document_events document_events_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_events]
    ADD CONSTRAINT document_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES [dbo].[issued_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: document_versions document_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_versions]
    ADD CONSTRAINT document_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: document_versions document_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[document_versions]
    ADD CONSTRAINT document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES [dbo].[knowledge_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: escalation_actions escalation_actions_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: escalation_actions escalation_actions_escalation_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_escalation_policy_id_fkey FOREIGN KEY (escalation_policy_id) REFERENCES [dbo].[escalation_policies](id);
GO

--
-- Name: escalation_actions escalation_actions_new_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_new_assignee_id_fkey FOREIGN KEY (new_assignee_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: escalation_actions escalation_actions_previous_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_previous_assignee_id_fkey FOREIGN KEY (previous_assignee_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: escalation_actions escalation_actions_previous_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_previous_unit_id_fkey FOREIGN KEY (previous_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: escalation_actions escalation_actions_target_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_target_unit_id_fkey FOREIGN KEY (target_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: escalation_actions escalation_actions_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_actions]
    ADD CONSTRAINT escalation_actions_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: escalation_policies escalation_policies_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_policies]
    ADD CONSTRAINT escalation_policies_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: escalation_policies escalation_policies_target_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[escalation_policies]
    ADD CONSTRAINT escalation_policies_target_unit_id_fkey FOREIGN KEY (target_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: evaluation_equivalence_items evaluation_equivalence_items_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_equivalence_items]
    ADD CONSTRAINT evaluation_equivalence_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES [dbo].[evaluation_equivalence_groups](id) ON DELETE NO ACTION;
GO

--
-- Name: evaluation_equivalence_items evaluation_equivalence_items_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_equivalence_items]
    ADD CONSTRAINT evaluation_equivalence_items_student_id_fkey FOREIGN KEY (student_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: evaluation_runs evaluation_runs_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_runs]
    ADD CONSTRAINT evaluation_runs_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES [dbo].[evaluation_scenarios](id) ON DELETE NO ACTION;
GO

--
-- Name: evaluation_scenarios evaluation_scenarios_expected_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[evaluation_scenarios]
    ADD CONSTRAINT evaluation_scenarios_expected_service_unit_id_fkey FOREIGN KEY (expected_service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: faq_items faq_items_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[faq_items]
    ADD CONSTRAINT faq_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES [dbo].[knowledge_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: faq_items faq_items_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[faq_items]
    ADD CONSTRAINT faq_items_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: faq_items faq_items_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[faq_items]
    ADD CONSTRAINT faq_items_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id);
GO

--
-- Name: feedback feedback_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[feedback]
    ADD CONSTRAINT feedback_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: feedback feedback_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[feedback]
    ADD CONSTRAINT feedback_message_id_fkey FOREIGN KEY (message_id) REFERENCES [dbo].[messages](id) ON DELETE NO ACTION;
GO

--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[feedback]
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: follow_up_policies follow_up_policies_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[follow_up_policies]
    ADD CONSTRAINT follow_up_policies_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: grounding_checks grounding_checks_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[grounding_checks]
    ADD CONSTRAINT grounding_checks_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES [dbo].[agent_runs](id) ON DELETE NO ACTION;
GO

--
-- Name: hostel_rooms hostel_rooms_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[hostel_rooms]
    ADD CONSTRAINT hostel_rooms_hostel_id_fkey FOREIGN KEY (hostel_id) REFERENCES [dbo].[hostels](id) ON DELETE NO ACTION;
GO

--
-- Name: hostels hostels_campus_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[hostels]
    ADD CONSTRAINT hostels_campus_id_fkey FOREIGN KEY (campus_id) REFERENCES [dbo].[campuses](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_allocations housing_allocations_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_allocations]
    ADD CONSTRAINT housing_allocations_hostel_id_fkey FOREIGN KEY (hostel_id) REFERENCES [dbo].[hostels](id);
GO

--
-- Name: housing_allocations housing_allocations_housing_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_allocations]
    ADD CONSTRAINT housing_allocations_housing_application_id_fkey FOREIGN KEY (housing_application_id) REFERENCES [dbo].[housing_applications](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_allocations housing_allocations_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_allocations]
    ADD CONSTRAINT housing_allocations_room_id_fkey FOREIGN KEY (room_id) REFERENCES [dbo].[hostel_rooms](id);
GO

--
-- Name: housing_applications housing_applications_final_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_final_hostel_id_fkey FOREIGN KEY (final_hostel_id) REFERENCES [dbo].[hostels](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_applications housing_applications_final_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_final_room_id_fkey FOREIGN KEY (final_room_id) REFERENCES [dbo].[hostel_rooms](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_applications housing_applications_preferred_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_preferred_hostel_id_fkey FOREIGN KEY (preferred_hostel_id) REFERENCES [dbo].[hostels](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_applications housing_applications_proposed_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_proposed_hostel_id_fkey FOREIGN KEY (proposed_hostel_id) REFERENCES [dbo].[hostels](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_applications housing_applications_proposed_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_proposed_room_id_fkey FOREIGN KEY (proposed_room_id) REFERENCES [dbo].[hostel_rooms](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_applications housing_applications_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_applications]
    ADD CONSTRAINT housing_applications_service_id_fkey FOREIGN KEY (service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_waitlist housing_waitlist_housing_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_waitlist]
    ADD CONSTRAINT housing_waitlist_housing_application_id_fkey FOREIGN KEY (housing_application_id) REFERENCES [dbo].[housing_applications](id) ON DELETE NO ACTION;
GO

--
-- Name: housing_waitlist housing_waitlist_preferred_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[housing_waitlist]
    ADD CONSTRAINT housing_waitlist_preferred_hostel_id_fkey FOREIGN KEY (preferred_hostel_id) REFERENCES [dbo].[hostels](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_connectors integration_connectors_owner_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_connectors]
    ADD CONSTRAINT integration_connectors_owner_unit_id_fkey FOREIGN KEY (owner_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: integration_field_mappings integration_field_mappings_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_field_mappings]
    ADD CONSTRAINT integration_field_mappings_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES [dbo].[integration_connectors](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_field_mappings integration_field_mappings_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_field_mappings]
    ADD CONSTRAINT integration_field_mappings_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES [dbo].[integration_tools](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_health_events integration_health_events_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_health_events]
    ADD CONSTRAINT integration_health_events_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES [dbo].[integration_connectors](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_schema_versions integration_schema_versions_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_schema_versions]
    ADD CONSTRAINT integration_schema_versions_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES [dbo].[integration_connectors](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_schema_versions integration_schema_versions_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_schema_versions]
    ADD CONSTRAINT integration_schema_versions_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES [dbo].[integration_tools](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_test_runs integration_test_runs_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_test_runs]
    ADD CONSTRAINT integration_test_runs_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES [dbo].[integration_connectors](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_test_runs integration_test_runs_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_test_runs]
    ADD CONSTRAINT integration_test_runs_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES [dbo].[integration_tools](id) ON DELETE NO ACTION;
GO

--
-- Name: integration_tools integration_tools_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[integration_tools]
    ADD CONSTRAINT integration_tools_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES [dbo].[integration_connectors](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_acknowledgements intercollege_transfer_acknowledgements_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_acknowledgements]
    ADD CONSTRAINT intercollege_transfer_acknowledgements_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_acknowledgements intercollege_transfer_acknowledgements_transfer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_acknowledgements]
    ADD CONSTRAINT intercollege_transfer_acknowledgements_transfer_request_id_fkey FOREIGN KEY (transfer_request_id) REFERENCES [dbo].[intercollege_transfer_requests](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_course_impact intercollege_transfer_course_impact_source_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_course_impact]
    ADD CONSTRAINT intercollege_transfer_course_impact_source_course_id_fkey FOREIGN KEY (source_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_course_impact intercollege_transfer_course_impact_target_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_course_impact]
    ADD CONSTRAINT intercollege_transfer_course_impact_target_course_id_fkey FOREIGN KEY (target_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_course_impact intercollege_transfer_course_impact_transfer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_course_impact]
    ADD CONSTRAINT intercollege_transfer_course_impact_transfer_request_id_fkey FOREIGN KEY (transfer_request_id) REFERENCES [dbo].[intercollege_transfer_requests](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_capacity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_capacity_id_fkey FOREIGN KEY (capacity_id) REFERENCES [dbo].[programme_transfer_capacity](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_source_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_source_college_id_fkey FOREIGN KEY (source_college_id) REFERENCES [dbo].[colleges](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_source_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_source_programme_id_fkey FOREIGN KEY (source_programme_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_target_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_target_college_id_fkey FOREIGN KEY (target_college_id) REFERENCES [dbo].[colleges](id) ON DELETE NO ACTION;
GO

--
-- Name: intercollege_transfer_requests intercollege_transfer_requests_target_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[intercollege_transfer_requests]
    ADD CONSTRAINT intercollege_transfer_requests_target_programme_id_fkey FOREIGN KEY (target_programme_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignment_audit internship_assignment_audit_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignment_audit]
    ADD CONSTRAINT internship_assignment_audit_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES [dbo].[internship_assignments](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignments internship_assignments_government_clearance_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_government_clearance_approved_by_fkey FOREIGN KEY (government_clearance_approved_by) REFERENCES [auth].[users](id);
GO

--
-- Name: internship_assignments internship_assignments_internship_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_internship_course_id_fkey FOREIGN KEY (internship_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignments internship_assignments_match_explanation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_match_explanation_id_fkey FOREIGN KEY (match_explanation_id) REFERENCES [dbo].[internship_match_explanations](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignments internship_assignments_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES [dbo].[internship_opportunities](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignments internship_assignments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES [dbo].[internship_organizations](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignments internship_assignments_related_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_related_case_id_fkey FOREIGN KEY (related_case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_assignments internship_assignments_related_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_assignments]
    ADD CONSTRAINT internship_assignments_related_conversation_id_fkey FOREIGN KEY (related_conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_match_explanations internship_match_explanations_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_match_explanations]
    ADD CONSTRAINT internship_match_explanations_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES [dbo].[internship_opportunities](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_opportunities internship_opportunities_internship_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_opportunities]
    ADD CONSTRAINT internship_opportunities_internship_course_id_fkey FOREIGN KEY (internship_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_opportunities internship_opportunities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_opportunities]
    ADD CONSTRAINT internship_opportunities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES [dbo].[internship_organizations](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_organizations internship_organizations_owner_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_organizations]
    ADD CONSTRAINT internship_organizations_owner_unit_id_fkey FOREIGN KEY (owner_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: internship_waitlist internship_waitlist_offered_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[internship_waitlist]
    ADD CONSTRAINT internship_waitlist_offered_opportunity_id_fkey FOREIGN KEY (offered_opportunity_id) REFERENCES [dbo].[internship_opportunities](id) ON DELETE NO ACTION;
GO

--
-- Name: issued_documents issued_documents_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[issued_documents]
    ADD CONSTRAINT issued_documents_message_id_fkey FOREIGN KEY (message_id) REFERENCES [dbo].[messages](id) ON DELETE NO ACTION;
GO

--
-- Name: issued_documents issued_documents_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[issued_documents]
    ADD CONSTRAINT issued_documents_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES [dbo].[issued_documents](id);
GO

--
-- Name: issued_documents issued_documents_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[issued_documents]
    ADD CONSTRAINT issued_documents_template_id_fkey FOREIGN KEY (template_id) REFERENCES [dbo].[document_templates](id);
GO

--
-- Name: knowledge_conflicts knowledge_conflicts_assigned_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_conflicts]
    ADD CONSTRAINT knowledge_conflicts_assigned_unit_id_fkey FOREIGN KEY (assigned_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: knowledge_documents knowledge_documents_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_category_id_fkey FOREIGN KEY (category_id) REFERENCES [dbo].[knowledge_document_categories](id);
GO

--
-- Name: knowledge_documents knowledge_documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: knowledge_documents knowledge_documents_owner_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_owner_unit_id_fkey FOREIGN KEY (owner_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: knowledge_documents knowledge_documents_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: knowledge_documents knowledge_documents_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_source_id_fkey FOREIGN KEY (source_id) REFERENCES [dbo].[knowledge_sources](id) ON DELETE NO ACTION;
GO

--
-- Name: knowledge_documents knowledge_documents_superseded_by_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_superseded_by_document_id_fkey FOREIGN KEY (superseded_by_document_id) REFERENCES [dbo].[knowledge_documents](id);
GO

--
-- Name: knowledge_documents knowledge_documents_supersedes_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_documents]
    ADD CONSTRAINT knowledge_documents_supersedes_document_id_fkey FOREIGN KEY (supersedes_document_id) REFERENCES [dbo].[knowledge_documents](id);
GO

--
-- Name: knowledge_sources knowledge_sources_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[knowledge_sources]
    ADD CONSTRAINT knowledge_sources_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: library_hours_exceptions library_hours_exceptions_library_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_hours_exceptions]
    ADD CONSTRAINT library_hours_exceptions_library_location_id_fkey FOREIGN KEY (library_location_id) REFERENCES [dbo].[library_locations](id) ON DELETE NO ACTION;
GO

--
-- Name: library_opening_hours library_opening_hours_library_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_opening_hours]
    ADD CONSTRAINT library_opening_hours_library_location_id_fkey FOREIGN KEY (library_location_id) REFERENCES [dbo].[library_locations](id) ON DELETE NO ACTION;
GO

--
-- Name: library_search_events library_search_events_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_search_events]
    ADD CONSTRAINT library_search_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: library_services library_services_library_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[library_services]
    ADD CONSTRAINT library_services_library_location_id_fkey FOREIGN KEY (library_location_id) REFERENCES [dbo].[library_locations](id) ON DELETE NO ACTION;
GO

--
-- Name: message_attachments message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[message_attachments]
    ADD CONSTRAINT message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES [dbo].[messages](id) ON DELETE NO ACTION;
GO

--
-- Name: message_attachments message_attachments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[message_attachments]
    ADD CONSTRAINT message_attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[messages]
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[messages]
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: notification_deliveries notification_deliveries_notification_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_deliveries]
    ADD CONSTRAINT notification_deliveries_notification_event_id_fkey FOREIGN KEY (notification_event_id) REFERENCES [dbo].[notification_events](id) ON DELETE NO ACTION;
GO

--
-- Name: notification_delivery_logs notification_delivery_logs_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_delivery_logs]
    ADD CONSTRAINT notification_delivery_logs_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES [dbo].[alerts](id) ON DELETE NO ACTION;
GO

--
-- Name: notification_delivery_logs notification_delivery_logs_student_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_delivery_logs]
    ADD CONSTRAINT notification_delivery_logs_student_alert_id_fkey FOREIGN KEY (student_alert_id) REFERENCES [dbo].[student_alerts](id) ON DELETE NO ACTION;
GO

--
-- Name: notification_delivery_logs notification_delivery_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_delivery_logs]
    ADD CONSTRAINT notification_delivery_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: notification_events notification_events_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_events]
    ADD CONSTRAINT notification_events_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: notification_events notification_events_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_events]
    ADD CONSTRAINT notification_events_template_id_fkey FOREIGN KEY (template_id) REFERENCES [dbo].[notification_templates](id);
GO

--
-- Name: notification_group_members notification_group_members_group_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_group_members]
    ADD CONSTRAINT notification_group_members_group_code_fkey FOREIGN KEY (group_code) REFERENCES [dbo].[notification_groups](code) ON DELETE NO ACTION;
GO

--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[notification_preferences]
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: operation_idempotency operation_idempotency_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[operation_idempotency]
    ADD CONSTRAINT operation_idempotency_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: operational_insights operational_insights_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[operational_insights]
    ADD CONSTRAINT operational_insights_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: pilot_test_sessions pilot_test_sessions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[pilot_test_sessions]
    ADD CONSTRAINT pilot_test_sessions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: pilot_test_sessions pilot_test_sessions_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[pilot_test_sessions]
    ADD CONSTRAINT pilot_test_sessions_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[profiles]
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: program_basket_courses program_basket_courses_basket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_basket_courses]
    ADD CONSTRAINT program_basket_courses_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES [dbo].[program_requirement_baskets](id) ON DELETE NO ACTION;
GO

--
-- Name: program_basket_courses program_basket_courses_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_basket_courses]
    ADD CONSTRAINT program_basket_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: program_courses program_courses_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_courses]
    ADD CONSTRAINT program_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: program_courses program_courses_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_courses]
    ADD CONSTRAINT program_courses_program_id_fkey FOREIGN KEY (program_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: program_requirement_baskets program_requirement_baskets_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[program_requirement_baskets]
    ADD CONSTRAINT program_requirement_baskets_program_id_fkey FOREIGN KEY (program_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: programme_course_equivalencies programme_course_equivalencies_source_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_course_equivalencies]
    ADD CONSTRAINT programme_course_equivalencies_source_course_id_fkey FOREIGN KEY (source_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: programme_course_equivalencies programme_course_equivalencies_source_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_course_equivalencies]
    ADD CONSTRAINT programme_course_equivalencies_source_programme_id_fkey FOREIGN KEY (source_programme_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: programme_course_equivalencies programme_course_equivalencies_target_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_course_equivalencies]
    ADD CONSTRAINT programme_course_equivalencies_target_course_id_fkey FOREIGN KEY (target_course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: programme_course_equivalencies programme_course_equivalencies_target_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_course_equivalencies]
    ADD CONSTRAINT programme_course_equivalencies_target_programme_id_fkey FOREIGN KEY (target_programme_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: programme_transfer_capacity programme_transfer_capacity_academic_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_transfer_capacity]
    ADD CONSTRAINT programme_transfer_capacity_academic_term_id_fkey FOREIGN KEY (academic_term_id) REFERENCES [dbo].[academic_terms](id) ON DELETE NO ACTION;
GO

--
-- Name: programme_transfer_capacity programme_transfer_capacity_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[programme_transfer_capacity]
    ADD CONSTRAINT programme_transfer_capacity_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: release_readiness release_readiness_evaluated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[release_readiness]
    ADD CONSTRAINT release_readiness_evaluated_by_fkey FOREIGN KEY (evaluated_by) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: response_performance_logs response_performance_logs_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_performance_logs]
    ADD CONSTRAINT response_performance_logs_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES [dbo].[agent_runs](id) ON DELETE NO ACTION;
GO

--
-- Name: response_performance_logs response_performance_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_performance_logs]
    ADD CONSTRAINT response_performance_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES [dbo].[conversations](id) ON DELETE NO ACTION;
GO

--
-- Name: response_performance_logs response_performance_logs_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_performance_logs]
    ADD CONSTRAINT response_performance_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES [dbo].[messages](id) ON DELETE NO ACTION;
GO

--
-- Name: response_quality_reviews response_quality_reviews_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_quality_reviews]
    ADD CONSTRAINT response_quality_reviews_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES [dbo].[agent_runs](id) ON DELETE NO ACTION;
GO

--
-- Name: response_quality_reviews response_quality_reviews_reviewer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[response_quality_reviews]
    ADD CONSTRAINT response_quality_reviews_reviewer_profile_id_fkey FOREIGN KEY (reviewer_profile_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: risk_flags risk_flags_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[risk_flags]
    ADD CONSTRAINT risk_flags_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: risk_flags risk_flags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[risk_flags]
    ADD CONSTRAINT risk_flags_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: routing_decisions routing_decisions_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: routing_decisions routing_decisions_final_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_final_staff_id_fkey FOREIGN KEY (final_staff_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: routing_decisions routing_decisions_final_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_final_unit_id_fkey FOREIGN KEY (final_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: routing_decisions routing_decisions_matched_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_matched_rule_id_fkey FOREIGN KEY (matched_rule_id) REFERENCES [dbo].[routing_rules](id);
GO

--
-- Name: routing_decisions routing_decisions_recommended_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_recommended_staff_id_fkey FOREIGN KEY (recommended_staff_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: routing_decisions routing_decisions_recommended_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_decisions]
    ADD CONSTRAINT routing_decisions_recommended_unit_id_fkey FOREIGN KEY (recommended_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: routing_rules routing_rules_target_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_rules]
    ADD CONSTRAINT routing_rules_target_staff_id_fkey FOREIGN KEY (target_staff_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: routing_rules routing_rules_target_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[routing_rules]
    ADD CONSTRAINT routing_rules_target_unit_id_fkey FOREIGN KEY (target_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: service_availability_windows service_availability_windows_academic_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_availability_windows]
    ADD CONSTRAINT service_availability_windows_academic_term_id_fkey FOREIGN KEY (academic_term_id) REFERENCES [dbo].[academic_terms](id) ON DELETE NO ACTION;
GO

--
-- Name: service_availability_windows service_availability_windows_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_availability_windows]
    ADD CONSTRAINT service_availability_windows_service_id_fkey FOREIGN KEY (service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: service_baselines service_baselines_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_baselines]
    ADD CONSTRAINT service_baselines_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: service_baselines service_baselines_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_baselines]
    ADD CONSTRAINT service_baselines_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: service_impact_baselines service_impact_baselines_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_impact_baselines]
    ADD CONSTRAINT service_impact_baselines_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_improvements service_improvements_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_improvements]
    ADD CONSTRAINT service_improvements_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: service_improvements service_improvements_responsible_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_improvements]
    ADD CONSTRAINT service_improvements_responsible_unit_id_fkey FOREIGN KEY (responsible_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: service_knowledge_health service_knowledge_health_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_knowledge_health]
    ADD CONSTRAINT service_knowledge_health_service_id_fkey FOREIGN KEY (service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: service_level_rules service_level_rules_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_level_rules]
    ADD CONSTRAINT service_level_rules_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_owner_action_permissions service_owner_action_permissions_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_owner_action_permissions]
    ADD CONSTRAINT service_owner_action_permissions_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_owner_ai_preferences service_owner_ai_preferences_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_owner_ai_preferences]
    ADD CONSTRAINT service_owner_ai_preferences_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: service_process_metrics service_process_metrics_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_process_metrics]
    ADD CONSTRAINT service_process_metrics_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: service_requirements service_requirements_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_requirements]
    ADD CONSTRAINT service_requirements_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: service_staff service_staff_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_staff]
    ADD CONSTRAINT service_staff_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_staff service_staff_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_staff]
    ADD CONSTRAINT service_staff_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES [dbo].[staff_profiles](user_id) ON DELETE NO ACTION;
GO

--
-- Name: service_unit_owners service_unit_owners_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_unit_owners]
    ADD CONSTRAINT service_unit_owners_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES [dbo].[profiles](id) ON DELETE NO ACTION;
GO

--
-- Name: service_unit_owners service_unit_owners_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_unit_owners]
    ADD CONSTRAINT service_unit_owners_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_unit_owners service_unit_owners_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_unit_owners]
    ADD CONSTRAINT service_unit_owners_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES [dbo].[staff_profiles](user_id) ON DELETE NO ACTION;
GO

--
-- Name: service_units service_units_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_college_id_fkey FOREIGN KEY (college_id) REFERENCES [dbo].[colleges](id) ON DELETE NO ACTION;
GO

--
-- Name: service_units service_units_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_department_id_fkey FOREIGN KEY (department_id) REFERENCES [dbo].[departments](id) ON DELETE NO ACTION;
GO

--
-- Name: service_units service_units_escalation_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_escalation_unit_id_fkey FOREIGN KEY (escalation_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_units service_units_primary_service_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_primary_service_owner_id_fkey FOREIGN KEY (primary_service_owner_id) REFERENCES [dbo].[staff_profiles](user_id) ON DELETE NO ACTION;
GO

--
-- Name: service_units service_units_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_units]
    ADD CONSTRAINT service_units_university_id_fkey FOREIGN KEY (university_id) REFERENCES [dbo].[universities](id) ON DELETE NO ACTION;
GO

--
-- Name: service_workflow_steps service_workflow_steps_responsible_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_workflow_steps]
    ADD CONSTRAINT service_workflow_steps_responsible_unit_id_fkey FOREIGN KEY (responsible_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: service_workflow_steps service_workflow_steps_university_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[service_workflow_steps]
    ADD CONSTRAINT service_workflow_steps_university_service_id_fkey FOREIGN KEY (university_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: staff_availability_rules staff_availability_rules_appointment_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_availability_rules]
    ADD CONSTRAINT staff_availability_rules_appointment_type_id_fkey FOREIGN KEY (appointment_type_id) REFERENCES [dbo].[appointment_types](id) ON DELETE NO ACTION;
GO

--
-- Name: staff_availability_rules staff_availability_rules_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_availability_rules]
    ADD CONSTRAINT staff_availability_rules_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: staff_availability_rules staff_availability_rules_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_availability_rules]
    ADD CONSTRAINT staff_availability_rules_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES [dbo].[staff_profiles](user_id) ON DELETE NO ACTION;
GO

--
-- Name: staff_profiles staff_profiles_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_profiles]
    ADD CONSTRAINT staff_profiles_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: staff_profiles staff_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[staff_profiles]
    ADD CONSTRAINT staff_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: structured_data_sources structured_data_sources_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[structured_data_sources]
    ADD CONSTRAINT structured_data_sources_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES [dbo].[integration_connectors](id) ON DELETE NO ACTION;
GO

--
-- Name: student_alerts student_alerts_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES [dbo].[alerts](id) ON DELETE NO ACTION;
GO

--
-- Name: student_alerts student_alerts_alert_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_alert_rule_id_fkey FOREIGN KEY (alert_rule_id) REFERENCES [dbo].[alert_rules](id) ON DELETE NO ACTION;
GO

--
-- Name: student_alerts student_alerts_related_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_related_case_id_fkey FOREIGN KEY (related_case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: student_alerts student_alerts_related_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_related_service_id_fkey FOREIGN KEY (related_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: student_alerts student_alerts_source_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_source_unit_id_fkey FOREIGN KEY (source_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: student_alerts student_alerts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_alerts]
    ADD CONSTRAINT student_alerts_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_appointments student_appointments_appointment_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_appointment_slot_id_fkey FOREIGN KEY (appointment_slot_id) REFERENCES [dbo].[appointment_slots](id) ON DELETE NO ACTION;
GO

--
-- Name: student_appointments student_appointments_booked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_booked_by_fkey FOREIGN KEY (booked_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_appointments student_appointments_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_case_id_fkey FOREIGN KEY (case_id) REFERENCES [dbo].[cases](id) ON DELETE NO ACTION;
GO

--
-- Name: student_appointments student_appointments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_appointments]
    ADD CONSTRAINT student_appointments_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_career_profiles student_career_profiles_latest_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_career_profiles]
    ADD CONSTRAINT student_career_profiles_latest_cv_id_fkey FOREIGN KEY (latest_cv_id) REFERENCES [dbo].[student_cv_documents](id) ON DELETE NO ACTION;
GO

--
-- Name: student_course_history student_course_history_academic_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_course_history]
    ADD CONSTRAINT student_course_history_academic_term_id_fkey FOREIGN KEY (academic_term_id) REFERENCES [dbo].[academic_terms](id) ON DELETE NO ACTION;
GO

--
-- Name: student_course_history student_course_history_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_course_history]
    ADD CONSTRAINT student_course_history_course_id_fkey FOREIGN KEY (course_id) REFERENCES [dbo].[courses](id) ON DELETE NO ACTION;
GO

--
-- Name: student_course_history student_course_history_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_course_history]
    ADD CONSTRAINT student_course_history_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_current_enrollments student_current_enrollments_course_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_current_enrollments]
    ADD CONSTRAINT student_current_enrollments_course_section_id_fkey FOREIGN KEY (course_section_id) REFERENCES [dbo].[course_sections](id) ON DELETE NO ACTION;
GO

--
-- Name: student_current_enrollments student_current_enrollments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_current_enrollments]
    ADD CONSTRAINT student_current_enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_documents student_documents_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_documents]
    ADD CONSTRAINT student_documents_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_holds student_holds_issuing_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_holds]
    ADD CONSTRAINT student_holds_issuing_unit_id_fkey FOREIGN KEY (issuing_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: student_holds student_holds_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_holds]
    ADD CONSTRAINT student_holds_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_housing_preferences student_housing_preferences_preferred_hostel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_housing_preferences]
    ADD CONSTRAINT student_housing_preferences_preferred_hostel_id_fkey FOREIGN KEY (preferred_hostel_id) REFERENCES [dbo].[hostels](id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_admission_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_admission_term_id_fkey FOREIGN KEY (admission_term_id) REFERENCES [dbo].[academic_terms](id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_advisor_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_advisor_staff_id_fkey FOREIGN KEY (advisor_staff_id) REFERENCES [dbo].[staff_profiles](user_id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_college_id_fkey FOREIGN KEY (college_id) REFERENCES [dbo].[colleges](id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_current_academic_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_current_academic_term_id_fkey FOREIGN KEY (current_academic_term_id) REFERENCES [dbo].[academic_terms](id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES [dbo].[departments](id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_program_id_fkey FOREIGN KEY (program_id) REFERENCES [dbo].[academic_programs](id) ON DELETE NO ACTION;
GO

--
-- Name: student_profiles student_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_profiles]
    ADD CONSTRAINT student_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_requirements student_requirements_responsible_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_requirements]
    ADD CONSTRAINT student_requirements_responsible_unit_id_fkey FOREIGN KEY (responsible_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: student_requirements student_requirements_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_requirements]
    ADD CONSTRAINT student_requirements_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: student_service_reminders student_service_reminders_availability_window_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_service_reminders]
    ADD CONSTRAINT student_service_reminders_availability_window_id_fkey FOREIGN KEY (availability_window_id) REFERENCES [dbo].[service_availability_windows](id) ON DELETE NO ACTION;
GO

--
-- Name: student_service_reminders student_service_reminders_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[student_service_reminders]
    ADD CONSTRAINT student_service_reminders_service_id_fkey FOREIGN KEY (service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_assessments suggestion_assessments_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_assessments]
    ADD CONSTRAINT suggestion_assessments_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES [dbo].[profiles](id);
GO

--
-- Name: suggestion_assessments suggestion_assessments_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_assessments]
    ADD CONSTRAINT suggestion_assessments_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_duplicates suggestion_duplicates_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_duplicates]
    ADD CONSTRAINT suggestion_duplicates_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_duplicates suggestion_duplicates_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_duplicates]
    ADD CONSTRAINT suggestion_duplicates_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_reviews suggestion_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_reviews]
    ADD CONSTRAINT suggestion_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_reviews suggestion_reviews_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_reviews]
    ADD CONSTRAINT suggestion_reviews_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_similarities suggestion_similarities_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_similarities]
    ADD CONSTRAINT suggestion_similarities_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_similarities suggestion_similarities_similar_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_similarities]
    ADD CONSTRAINT suggestion_similarities_similar_suggestion_id_fkey FOREIGN KEY (similar_suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_similarities suggestion_similarities_source_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_similarities]
    ADD CONSTRAINT suggestion_similarities_source_suggestion_id_fkey FOREIGN KEY (source_suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_updates suggestion_updates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_updates]
    ADD CONSTRAINT suggestion_updates_created_by_fkey FOREIGN KEY (created_by) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_updates suggestion_updates_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_updates]
    ADD CONSTRAINT suggestion_updates_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_votes suggestion_votes_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_votes]
    ADD CONSTRAINT suggestion_votes_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestion_votes suggestion_votes_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestion_votes]
    ADD CONSTRAINT suggestion_votes_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestions suggestions_affected_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_affected_service_id_fkey FOREIGN KEY (affected_service_id) REFERENCES [dbo].[university_services](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestions suggestions_assigned_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_assigned_staff_id_fkey FOREIGN KEY (assigned_staff_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestions suggestions_duplicate_of_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_duplicate_of_suggestion_id_fkey FOREIGN KEY (duplicate_of_suggestion_id) REFERENCES [dbo].[suggestions](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestions suggestions_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: suggestions suggestions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[suggestions]
    ADD CONSTRAINT suggestions_student_id_fkey FOREIGN KEY (student_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: tool_calls tool_calls_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[tool_calls]
    ADD CONSTRAINT tool_calls_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES [dbo].[agent_runs](id) ON DELETE NO ACTION;
GO

--
-- Name: tool_calls tool_calls_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[tool_calls]
    ADD CONSTRAINT tool_calls_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: university_colleges university_colleges_web_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[university_colleges]
    ADD CONSTRAINT university_colleges_web_source_id_fkey FOREIGN KEY (web_source_id) REFERENCES [dbo].[web_knowledge_sources](id) ON DELETE NO ACTION;
GO

--
-- Name: university_services university_services_service_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[university_services]
    ADD CONSTRAINT university_services_service_unit_id_fkey FOREIGN KEY (service_unit_id) REFERENCES [dbo].[service_units](id) ON DELETE NO ACTION;
GO

--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[user_roles]
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES [auth].[users](id) ON DELETE NO ACTION;
GO

--
-- Name: web_knowledge_sources web_knowledge_sources_owner_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_knowledge_sources]
    ADD CONSTRAINT web_knowledge_sources_owner_unit_id_fkey FOREIGN KEY (owner_unit_id) REFERENCES [dbo].[service_units](id);
GO

--
-- Name: web_page_chunks web_page_chunks_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_page_chunks]
    ADD CONSTRAINT web_page_chunks_page_id_fkey FOREIGN KEY (page_id) REFERENCES [dbo].[web_source_pages](id) ON DELETE NO ACTION;
GO

--
-- Name: web_page_chunks web_page_chunks_web_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_page_chunks]
    ADD CONSTRAINT web_page_chunks_web_source_id_fkey FOREIGN KEY (web_source_id) REFERENCES [dbo].[web_knowledge_sources](id) ON DELETE NO ACTION;
GO

--
-- Name: web_source_changes web_source_changes_web_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_source_changes]
    ADD CONSTRAINT web_source_changes_web_source_id_fkey FOREIGN KEY (web_source_id) REFERENCES [dbo].[web_knowledge_sources](id) ON DELETE NO ACTION;
GO

--
-- Name: web_source_pages web_source_pages_web_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[web_source_pages]
    ADD CONSTRAINT web_source_pages_web_source_id_fkey FOREIGN KEY (web_source_id) REFERENCES [dbo].[web_knowledge_sources](id) ON DELETE NO ACTION;
GO

--
-- Name: working_calendars working_calendars_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE [dbo].[working_calendars]
    ADD CONSTRAINT working_calendars_university_id_fkey FOREIGN KEY (university_id) REFERENCES [dbo].[universities](id) ON DELETE NO ACTION;
GO


-- ========== GRANTS ==========

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_case_monitor] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_case_monitor] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_case_monitor_detail] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_case_monitor_detail] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_case_monitor_summary] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_case_monitor_summary] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_governance_overview] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_governance_overview] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_governance_report] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_governance_report] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_owner_monitor] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_owner_monitor] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_owner_performance] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_owner_performance] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_unit_monitor] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[admin_unit_monitor] TO [authenticated];
GO

--
-- Name: TABLE student_appointments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_appointments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_appointments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_appointments] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[book_appointment_slot] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[book_appointment_slot] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[burn_verification_token] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_access_case] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_access_case] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_access_knowledge_file] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_access_knowledge_file] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_approve_knowledge] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_approve_knowledge] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_manage_integrations] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_manage_integrations] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_manage_knowledge] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_manage_knowledge] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_monitor_all_units] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_monitor_all_units] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_monitor_cases] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_monitor_cases] TO [authenticated];
GO

--
-- Name: FUNCTION can_read_case_evidence(_name text, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_read_case_evidence] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_read_case_evidence] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_see_all_cases] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_see_all_cases] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_write_case_evidence] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[can_write_case_evidence] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[cancel_appointment_booking] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[cancel_appointment_booking] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[case_monitor_units] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[case_monitor_units] TO [authenticated];
GO

--
-- Name: TABLE internship_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_assignments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_assignments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_assignments] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[change_internship_assignment] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[check_intercollege_transfer_eligibility] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[check_intercollege_transfer_eligibility] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[check_intercollege_transfer_history] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[check_intercollege_transfer_history] TO [authenticated];
GO

--
-- Name: TABLE notification_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_deliveries] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_deliveries] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_deliveries] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[claim_notification_deliveries] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[decide_internship_clearance] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[delete_my_issued_document] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[delete_my_issued_document] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[evaluation_metrics] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[evaluation_metrics] TO [service_role];
GO

--
-- Name: TABLE intercollege_transfer_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_requests] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[execute_intercollege_transfer] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[expire_student_documents] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[generate_availability_slots] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[generate_availability_slots] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[get_service_availability] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[get_service_availability] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[handle_new_user] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[has_role] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[has_role] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_access_revoked] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_access_revoked] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_housing_staff] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_housing_staff] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_internship_staff] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_internship_staff] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_manager] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_manager] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_staff] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[is_staff] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[list_appointment_availability] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[list_appointment_availability] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[log_service_availability_change] TO [service_role];
GO

--
-- Name: TABLE housing_allocations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_allocations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_allocations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_allocations] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[move_hostel_allocation] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[my_appointments] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[my_appointments] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[next_document_reference] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[owned_service_units] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[owned_service_units] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[owns_case] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[owns_case] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[owns_service_unit] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[owns_service_unit] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[purge_expired_documents] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[purge_my_issued_document] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[purge_my_issued_document] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[remove_my_requests] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[remove_my_requests] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[remove_my_suggestions] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[remove_my_suggestions] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[reschedule_appointment_booking] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[reschedule_appointment_booking] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[reserve_hostel_bed] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[reserve_internship_seat] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[search_knowledge_passages] TO [service_role];
GO

--
-- Name: FUNCTION set_case_number(); Type: ACL; Schema: public; Owner: -
--

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[set_case_number] TO [anon];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[set_case_number] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[set_case_number] TO [service_role];
GO

--
-- Name: FUNCTION set_suggestion_number(); Type: ACL; Schema: public; Owner: -
--

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[set_suggestion_number] TO [anon];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[set_suggestion_number] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[set_suggestion_number] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[staff_can_view_profile] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[staff_can_view_profile] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[staff_unit] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[staff_unit] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[tombstone_document_verification] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[track_case_responsibility] TO [service_role];
GO

--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[update_updated_at_column] TO [anon];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[update_updated_at_column] TO [authenticated];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[update_updated_at_column] TO [service_role];
GO

-- skipped GRANT EXECUTE until procedures exist
-- GRANT EXECUTE ON [dbo].[verify_student_document] TO [service_role];
GO

--
-- Name: TABLE academic_programs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[academic_programs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[academic_programs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[academic_programs] TO [service_role];
GO

--
-- Name: TABLE academic_terms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[academic_terms] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[academic_terms] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[academic_terms] TO [service_role];
GO

--
-- Name: TABLE action_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_approvals] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_approvals] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_approvals] TO [service_role];
GO

--
-- Name: TABLE action_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_receipts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_receipts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_receipts] TO [service_role];
GO

--
-- Name: TABLE action_request_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_request_documents] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_request_documents] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_request_documents] TO [service_role];
GO

--
-- Name: TABLE action_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_requests] TO [service_role];
GO

--
-- Name: TABLE action_revalidation_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_revalidation_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_revalidation_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_revalidation_events] TO [service_role];
GO

--
-- Name: TABLE action_revalidation_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_revalidation_policies] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_revalidation_policies] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[action_revalidation_policies] TO [service_role];
GO

--
-- Name: TABLE agent_model_invocations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_model_invocations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_model_invocations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_model_invocations] TO [service_role];
GO

--
-- Name: TABLE agent_prompt_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_prompt_versions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_prompt_versions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_prompt_versions] TO [service_role];
GO

--
-- Name: TABLE agent_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_runs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_runs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_runs] TO [service_role];
GO

--
-- Name: TABLE agent_tool_executions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_tool_executions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_tool_executions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_tool_executions] TO [service_role];
GO

--
-- Name: TABLE agent_tools; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_tools] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_tools] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[agent_tools] TO [service_role];
GO

--
-- Name: TABLE ai_human_edits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ai_human_edits] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ai_human_edits] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ai_human_edits] TO [service_role];
GO

--
-- Name: TABLE ai_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ai_settings] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ai_settings] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ai_settings] TO [service_role];
GO

--
-- Name: TABLE alert_deduplication; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_deduplication] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_deduplication] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_deduplication] TO [service_role];
GO

--
-- Name: TABLE alert_rule_conditions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rule_conditions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rule_conditions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rule_conditions] TO [service_role];
GO

--
-- Name: TABLE alert_rule_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rule_runs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rule_runs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rule_runs] TO [service_role];
GO

--
-- Name: TABLE alert_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alert_rules] TO [service_role];
GO

--
-- Name: TABLE alerts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alerts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alerts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[alerts] TO [service_role];
GO

--
-- Name: TABLE appointment_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_requests] TO [service_role];
GO

--
-- Name: TABLE appointment_slots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_slots] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_slots] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_slots] TO [service_role];
GO

--
-- Name: TABLE appointment_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_types] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_types] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[appointment_types] TO [service_role];
GO

--
-- Name: TABLE approval_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[approval_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[approval_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[approval_requests] TO [service_role];
GO

--
-- Name: TABLE ats_scoring_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ats_scoring_profiles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ats_scoring_profiles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[ats_scoring_profiles] TO [service_role];
GO

--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[audit_logs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[audit_logs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[audit_logs] TO [service_role];
GO

--
-- Name: TABLE automation_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[automation_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[automation_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[automation_events] TO [service_role];
GO

--
-- Name: TABLE automation_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[automation_policies] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[automation_policies] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[automation_policies] TO [service_role];
GO

--
-- Name: TABLE bilingual_terms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[bilingual_terms] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[bilingual_terms] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[bilingual_terms] TO [service_role];
GO

--
-- Name: TABLE calendar_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[calendar_exceptions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[calendar_exceptions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[calendar_exceptions] TO [service_role];
GO

--
-- Name: TABLE campuses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[campuses] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[campuses] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[campuses] TO [service_role];
GO

--
-- Name: TABLE career_analysis_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_analysis_versions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_analysis_versions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_analysis_versions] TO [service_role];
GO

--
-- Name: TABLE career_counselling_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_counselling_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_counselling_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_counselling_events] TO [service_role];
GO

--
-- Name: TABLE career_matching_weight_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_matching_weight_profiles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_matching_weight_profiles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_matching_weight_profiles] TO [service_role];
GO

--
-- Name: TABLE career_role_matches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_role_matches] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_role_matches] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_role_matches] TO [service_role];
GO

--
-- Name: TABLE career_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_roles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_roles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[career_roles] TO [service_role];
GO

--
-- Name: TABLE case_access_restrictions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_access_restrictions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_access_restrictions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_access_restrictions] TO [service_role];
GO

--
-- Name: TABLE case_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_assignments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_assignments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_assignments] TO [service_role];
GO

--
-- Name: TABLE case_automation_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_automation_state] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_automation_state] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_automation_state] TO [service_role];
GO

--
-- Name: TABLE case_categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_categories] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_categories] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_categories] TO [service_role];
GO

--
-- Name: TABLE case_comments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_comments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_comments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_comments] TO [service_role];
GO

--
-- Name: TABLE case_conflicts_of_interest; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_conflicts_of_interest] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_conflicts_of_interest] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_conflicts_of_interest] TO [service_role];
GO

--
-- Name: TABLE case_escalations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_escalations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_escalations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_escalations] TO [service_role];
GO

--
-- Name: TABLE case_evidence; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_evidence] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_evidence] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_evidence] TO [service_role];
GO

--
-- Name: TABLE case_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_feedback] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_feedback] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_feedback] TO [service_role];
GO

--
-- Name: TABLE case_handovers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_handovers] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_handovers] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_handovers] TO [service_role];
GO

--
-- Name: TABLE case_information_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_information_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_information_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_information_requests] TO [service_role];
GO

--
-- Name: TABLE case_monitor_grants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_monitor_grants] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_monitor_grants] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_monitor_grants] TO [service_role];
GO

--
-- Name: TABLE cases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cases] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cases] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cases] TO [service_role];
GO

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[profiles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[profiles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[profiles] TO [service_role];
GO

--
-- Name: TABLE service_level_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_level_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_level_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_level_rules] TO [service_role];
GO

--
-- Name: TABLE service_units; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_units] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_units] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_units] TO [service_role];
GO

--
-- Name: TABLE student_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_profiles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_profiles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_profiles] TO [service_role];
GO

--
-- Name: TABLE case_monitor_v; Type: ACL; Schema: public; Owner: -
--

-- skipped GRANT on view case_monitor_v (view is reference-only in this script)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_monitor_v] TO [service_role];
GO

--
-- Name: SEQUENCE case_number_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[case_number_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[case_number_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[case_number_seq] TO [service_role];
GO

--
-- Name: TABLE case_oversight_actions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_oversight_actions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_oversight_actions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_oversight_actions] TO [service_role];
GO

--
-- Name: TABLE case_reopen_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_reopen_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_reopen_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_reopen_requests] TO [service_role];
GO

--
-- Name: TABLE case_resolutions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_resolutions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_resolutions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_resolutions] TO [service_role];
GO

--
-- Name: TABLE case_responsibility_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_responsibility_history] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_responsibility_history] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_responsibility_history] TO [service_role];
GO

--
-- Name: TABLE case_routing_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_routing_feedback] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_routing_feedback] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_routing_feedback] TO [service_role];
GO

--
-- Name: TABLE case_sla_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_sla_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_sla_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_sla_events] TO [service_role];
GO

--
-- Name: TABLE case_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_status_history] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_status_history] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[case_status_history] TO [service_role];
GO

--
-- Name: TABLE citations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[citations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[citations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[citations] TO [service_role];
GO

--
-- Name: TABLE colleges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[colleges] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[colleges] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[colleges] TO [service_role];
GO

--
-- Name: TABLE consent_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[consent_records] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[consent_records] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[consent_records] TO [service_role];
GO

--
-- Name: TABLE conversation_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[conversation_state] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[conversation_state] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[conversation_state] TO [service_role];
GO

--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[conversations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[conversations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[conversations] TO [service_role];
GO

--
-- Name: TABLE course_prerequisites; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[course_prerequisites] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[course_prerequisites] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[course_prerequisites] TO [service_role];
GO

--
-- Name: TABLE course_sections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[course_sections] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[course_sections] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[course_sections] TO [service_role];
GO

--
-- Name: TABLE courses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[courses] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[courses] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[courses] TO [service_role];
GO

--
-- Name: TABLE cv_ats_scores; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cv_ats_scores] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cv_ats_scores] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cv_ats_scores] TO [service_role];
GO

--
-- Name: TABLE cv_upload_scans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cv_upload_scans] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cv_upload_scans] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[cv_upload_scans] TO [service_role];
GO

--
-- Name: TABLE data_authority_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[data_authority_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[data_authority_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[data_authority_rules] TO [service_role];
GO

--
-- Name: TABLE departments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[departments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[departments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[departments] TO [service_role];
GO

--
-- Name: TABLE detected_intents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[detected_intents] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[detected_intents] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[detected_intents] TO [service_role];
GO

--
-- Name: TABLE document_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_chunks] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_chunks] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_chunks] TO [service_role];
GO

--
-- Name: TABLE document_deletion_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_deletion_records] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_deletion_records] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_deletion_records] TO [service_role];
GO

--
-- Name: TABLE document_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_events] TO [service_role];
GO

--
-- Name: TABLE document_retention_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_retention_policies] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_retention_policies] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_retention_policies] TO [service_role];
GO

--
-- Name: TABLE document_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_templates] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_templates] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_templates] TO [service_role];
GO

--
-- Name: TABLE document_verification_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_verification_attempts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_verification_attempts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_verification_attempts] TO [service_role];
GO

--
-- Name: TABLE document_verification_tombstones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_verification_tombstones] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_verification_tombstones] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_verification_tombstones] TO [service_role];
GO

--
-- Name: TABLE document_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_versions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_versions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[document_versions] TO [service_role];
GO

--
-- Name: TABLE email_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[email_templates] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[email_templates] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[email_templates] TO [service_role];
GO

--
-- Name: TABLE emergency_broadcasts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[emergency_broadcasts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[emergency_broadcasts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[emergency_broadcasts] TO [service_role];
GO

--
-- Name: TABLE emergency_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[emergency_contacts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[emergency_contacts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[emergency_contacts] TO [service_role];
GO

--
-- Name: TABLE escalation_actions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[escalation_actions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[escalation_actions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[escalation_actions] TO [service_role];
GO

--
-- Name: TABLE escalation_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[escalation_policies] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[escalation_policies] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[escalation_policies] TO [service_role];
GO

--
-- Name: TABLE evaluation_equivalence_groups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_equivalence_groups] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_equivalence_groups] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_equivalence_groups] TO [service_role];
GO

--
-- Name: TABLE evaluation_equivalence_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_equivalence_items] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_equivalence_items] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_equivalence_items] TO [service_role];
GO

--
-- Name: TABLE evaluation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_runs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_runs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_runs] TO [service_role];
GO

--
-- Name: TABLE evaluation_scenarios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_scenarios] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_scenarios] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[evaluation_scenarios] TO [service_role];
GO

--
-- Name: TABLE exception_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[exception_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[exception_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[exception_events] TO [service_role];
GO

--
-- Name: TABLE faq_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[faq_items] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[faq_items] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[faq_items] TO [service_role];
GO

--
-- Name: TABLE feedback; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[feedback] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[feedback] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[feedback] TO [service_role];
GO

--
-- Name: TABLE follow_up_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[follow_up_policies] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[follow_up_policies] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[follow_up_policies] TO [service_role];
GO

--
-- Name: TABLE grounding_checks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[grounding_checks] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[grounding_checks] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[grounding_checks] TO [service_role];
GO

--
-- Name: TABLE hostel_rooms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[hostel_rooms] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[hostel_rooms] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[hostel_rooms] TO [service_role];
GO

--
-- Name: TABLE hostels; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[hostels] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[hostels] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[hostels] TO [service_role];
GO

--
-- Name: SEQUENCE housing_allocation_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[housing_allocation_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[housing_allocation_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[housing_allocation_seq] TO [service_role];
GO

--
-- Name: SEQUENCE housing_application_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[housing_application_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[housing_application_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[housing_application_seq] TO [service_role];
GO

--
-- Name: TABLE housing_applications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_applications] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_applications] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_applications] TO [service_role];
GO

--
-- Name: TABLE housing_eligibility_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_eligibility_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_eligibility_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_eligibility_rules] TO [service_role];
GO

--
-- Name: TABLE housing_waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_waitlist] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_waitlist] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[housing_waitlist] TO [service_role];
GO

--
-- Name: TABLE integration_connectors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_connectors] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_connectors] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_connectors] TO [service_role];
GO

--
-- Name: TABLE integration_field_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_field_mappings] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_field_mappings] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_field_mappings] TO [service_role];
GO

--
-- Name: TABLE integration_health_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_health_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_health_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_health_events] TO [service_role];
GO

--
-- Name: TABLE integration_schema_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_schema_versions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_schema_versions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_schema_versions] TO [service_role];
GO

--
-- Name: TABLE integration_test_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_test_runs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_test_runs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_test_runs] TO [service_role];
GO

--
-- Name: TABLE integration_tools; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_tools] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_tools] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[integration_tools] TO [service_role];
GO

--
-- Name: TABLE intercollege_transfer_acknowledgements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_acknowledgements] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_acknowledgements] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_acknowledgements] TO [service_role];
GO

--
-- Name: TABLE intercollege_transfer_course_impact; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_course_impact] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_course_impact] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[intercollege_transfer_course_impact] TO [service_role];
GO

--
-- Name: SEQUENCE intercollege_transfer_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[intercollege_transfer_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[intercollege_transfer_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[intercollege_transfer_seq] TO [service_role];
GO

--
-- Name: TABLE internship_assignment_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_assignment_audit] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_assignment_audit] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_assignment_audit] TO [service_role];
GO

--
-- Name: SEQUENCE internship_assignment_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[internship_assignment_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[internship_assignment_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[internship_assignment_seq] TO [service_role];
GO

--
-- Name: TABLE internship_match_explanations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_match_explanations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_match_explanations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_match_explanations] TO [service_role];
GO

--
-- Name: TABLE internship_matching_weights; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_matching_weights] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_matching_weights] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_matching_weights] TO [service_role];
GO

--
-- Name: TABLE internship_opportunities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_opportunities] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_opportunities] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_opportunities] TO [service_role];
GO

--
-- Name: TABLE internship_organizations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_organizations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_organizations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_organizations] TO [service_role];
GO

--
-- Name: TABLE internship_waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_waitlist] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_waitlist] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[internship_waitlist] TO [service_role];
GO

--
-- Name: SEQUENCE issued_document_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[issued_document_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[issued_document_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[issued_document_seq] TO [service_role];
GO

--
-- Name: TABLE issued_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[issued_documents] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[issued_documents] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[issued_documents] TO [service_role];
GO

--
-- Name: TABLE knowledge_approval_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_approval_requests] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_approval_requests] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_approval_requests] TO [service_role];
GO

--
-- Name: TABLE knowledge_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_audit_log] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_audit_log] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_audit_log] TO [service_role];
GO

--
-- Name: TABLE knowledge_conflicts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_conflicts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_conflicts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_conflicts] TO [service_role];
GO

--
-- Name: TABLE knowledge_document_categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_document_categories] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_document_categories] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_document_categories] TO [service_role];
GO

--
-- Name: TABLE knowledge_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_documents] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_documents] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_documents] TO [service_role];
GO

--
-- Name: TABLE knowledge_gaps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_gaps] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_gaps] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_gaps] TO [service_role];
GO

--
-- Name: TABLE knowledge_issue_reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_issue_reports] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_issue_reports] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_issue_reports] TO [service_role];
GO

--
-- Name: TABLE knowledge_retrieval_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_retrieval_logs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_retrieval_logs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_retrieval_logs] TO [service_role];
GO

--
-- Name: TABLE knowledge_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_sources] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_sources] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[knowledge_sources] TO [service_role];
GO

--
-- Name: TABLE library_hours_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_hours_exceptions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_hours_exceptions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_hours_exceptions] TO [service_role];
GO

--
-- Name: TABLE library_locations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_locations] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_locations] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_locations] TO [service_role];
GO

--
-- Name: TABLE library_opening_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_opening_hours] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_opening_hours] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_opening_hours] TO [service_role];
GO

--
-- Name: TABLE library_provider_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_provider_settings] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_provider_settings] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_provider_settings] TO [service_role];
GO

--
-- Name: TABLE library_search_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_search_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_search_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_search_events] TO [service_role];
GO

--
-- Name: TABLE library_services; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_services] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_services] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[library_services] TO [service_role];
GO

--
-- Name: TABLE message_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[message_attachments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[message_attachments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[message_attachments] TO [service_role];
GO

--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[messages] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[messages] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[messages] TO [service_role];
GO

--
-- Name: TABLE model_routing_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[model_routing_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[model_routing_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[model_routing_rules] TO [service_role];
GO

--
-- Name: TABLE notification_delivery_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_delivery_logs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_delivery_logs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_delivery_logs] TO [service_role];
GO

--
-- Name: TABLE notification_dispatch_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_dispatch_state] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_dispatch_state] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_dispatch_state] TO [service_role];
GO

--
-- Name: TABLE notification_event_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_event_types] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_event_types] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_event_types] TO [service_role];
GO

--
-- Name: TABLE notification_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_events] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_events] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_events] TO [service_role];
GO

--
-- Name: TABLE notification_group_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_group_members] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_group_members] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_group_members] TO [service_role];
GO

--
-- Name: TABLE notification_groups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_groups] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_groups] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_groups] TO [service_role];
GO

--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_preferences] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_preferences] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_preferences] TO [service_role];
GO

--
-- Name: TABLE notification_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_settings] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_settings] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_settings] TO [service_role];
GO

--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_templates] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_templates] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[notification_templates] TO [service_role];
GO

--
-- Name: TABLE operation_idempotency; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[operation_idempotency] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[operation_idempotency] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[operation_idempotency] TO [service_role];
GO

--
-- Name: TABLE operational_insights; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[operational_insights] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[operational_insights] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[operational_insights] TO [service_role];
GO

--
-- Name: TABLE performance_budgets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[performance_budgets] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[performance_budgets] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[performance_budgets] TO [service_role];
GO

--
-- Name: TABLE pilot_test_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[pilot_test_sessions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[pilot_test_sessions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[pilot_test_sessions] TO [service_role];
GO

--
-- Name: TABLE program_basket_courses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_basket_courses] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_basket_courses] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_basket_courses] TO [service_role];
GO

--
-- Name: TABLE program_courses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_courses] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_courses] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_courses] TO [service_role];
GO

--
-- Name: TABLE program_requirement_baskets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_requirement_baskets] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_requirement_baskets] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[program_requirement_baskets] TO [service_role];
GO

--
-- Name: TABLE programme_course_equivalencies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[programme_course_equivalencies] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[programme_course_equivalencies] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[programme_course_equivalencies] TO [service_role];
GO

--
-- Name: TABLE programme_transfer_capacity; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[programme_transfer_capacity] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[programme_transfer_capacity] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[programme_transfer_capacity] TO [service_role];
GO

--
-- Name: TABLE quality_targets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[quality_targets] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[quality_targets] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[quality_targets] TO [service_role];
GO

--
-- Name: TABLE release_readiness; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[release_readiness] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[release_readiness] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[release_readiness] TO [service_role];
GO

--
-- Name: TABLE response_cache_metadata; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_cache_metadata] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_cache_metadata] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_cache_metadata] TO [service_role];
GO

--
-- Name: TABLE response_performance_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_performance_logs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_performance_logs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_performance_logs] TO [service_role];
GO

--
-- Name: TABLE response_quality_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_quality_reviews] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_quality_reviews] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[response_quality_reviews] TO [service_role];
GO

--
-- Name: TABLE risk_flags; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[risk_flags] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[risk_flags] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[risk_flags] TO [service_role];
GO

--
-- Name: TABLE routing_decisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[routing_decisions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[routing_decisions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[routing_decisions] TO [service_role];
GO

--
-- Name: TABLE routing_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[routing_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[routing_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[routing_rules] TO [service_role];
GO

--
-- Name: TABLE scheduled_job_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[scheduled_job_runs] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[scheduled_job_runs] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[scheduled_job_runs] TO [service_role];
GO

--
-- Name: TABLE service_availability_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_availability_audit] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_availability_audit] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_availability_audit] TO [service_role];
GO

--
-- Name: TABLE service_availability_windows; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_availability_windows] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_availability_windows] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_availability_windows] TO [service_role];
GO

--
-- Name: TABLE service_baselines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_baselines] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_baselines] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_baselines] TO [service_role];
GO

--
-- Name: TABLE service_degradation_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_degradation_state] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_degradation_state] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_degradation_state] TO [service_role];
GO

--
-- Name: TABLE service_impact_baselines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_impact_baselines] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_impact_baselines] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_impact_baselines] TO [service_role];
GO

--
-- Name: TABLE service_improvements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_improvements] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_improvements] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_improvements] TO [service_role];
GO

--
-- Name: TABLE service_knowledge_health; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_knowledge_health] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_knowledge_health] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_knowledge_health] TO [service_role];
GO

--
-- Name: TABLE service_owner_action_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_owner_action_permissions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_owner_action_permissions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_owner_action_permissions] TO [service_role];
GO

--
-- Name: TABLE service_owner_ai_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_owner_ai_preferences] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_owner_ai_preferences] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_owner_ai_preferences] TO [service_role];
GO

--
-- Name: TABLE service_process_metrics; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_process_metrics] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_process_metrics] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_process_metrics] TO [service_role];
GO

--
-- Name: TABLE service_requirements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_requirements] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_requirements] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_requirements] TO [service_role];
GO

--
-- Name: TABLE service_staff; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_staff] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_staff] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_staff] TO [service_role];
GO

--
-- Name: TABLE service_unit_owners; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_unit_owners] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_unit_owners] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_unit_owners] TO [service_role];
GO

--
-- Name: TABLE service_workflow_steps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_workflow_steps] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_workflow_steps] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[service_workflow_steps] TO [service_role];
GO

--
-- Name: TABLE staff_availability_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_availability_rules] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_availability_rules] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_availability_rules] TO [service_role];
GO

--
-- Name: TABLE staff_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_profiles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_profiles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_profiles] TO [service_role];
GO

--
-- Name: TABLE staff_workload_summary; Type: ACL; Schema: public; Owner: -
--

-- skipped GRANT on view staff_workload_summary (view is reference-only in this script)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_workload_summary] TO [anon];
GO

-- skipped GRANT on view staff_workload_summary (view is reference-only in this script)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_workload_summary] TO [authenticated];
GO

-- skipped GRANT on view staff_workload_summary (view is reference-only in this script)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[staff_workload_summary] TO [service_role];
GO

--
-- Name: TABLE structured_data_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[structured_data_sources] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[structured_data_sources] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[structured_data_sources] TO [service_role];
GO

--
-- Name: TABLE student_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_alerts] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_alerts] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_alerts] TO [service_role];
GO

--
-- Name: TABLE student_career_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_career_profiles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_career_profiles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_career_profiles] TO [service_role];
GO

--
-- Name: TABLE student_course_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_course_history] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_course_history] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_course_history] TO [service_role];
GO

--
-- Name: TABLE student_current_enrollments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_current_enrollments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_current_enrollments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_current_enrollments] TO [service_role];
GO

--
-- Name: TABLE student_cv_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_cv_documents] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_cv_documents] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_cv_documents] TO [service_role];
GO

--
-- Name: TABLE student_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_documents] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_documents] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_documents] TO [service_role];
GO

--
-- Name: TABLE student_field_provenance; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_field_provenance] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_field_provenance] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_field_provenance] TO [service_role];
GO

--
-- Name: TABLE student_holds; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_holds] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_holds] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_holds] TO [service_role];
GO

--
-- Name: TABLE student_housing_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_housing_preferences] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_housing_preferences] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_housing_preferences] TO [service_role];
GO

--
-- Name: TABLE student_internship_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_internship_preferences] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_internship_preferences] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_internship_preferences] TO [service_role];
GO

--
-- Name: TABLE student_requirements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_requirements] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_requirements] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_requirements] TO [service_role];
GO

--
-- Name: TABLE student_service_reminders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_service_reminders] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_service_reminders] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[student_service_reminders] TO [service_role];
GO

--
-- Name: TABLE suggestion_assessments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_assessments] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_assessments] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_assessments] TO [service_role];
GO

--
-- Name: TABLE suggestion_duplicates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_duplicates] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_duplicates] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_duplicates] TO [service_role];
GO

--
-- Name: SEQUENCE suggestion_number_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON [dbo].[suggestion_number_seq] TO [anon];
GO

GRANT UPDATE ON [dbo].[suggestion_number_seq] TO [authenticated];
GO

GRANT UPDATE ON [dbo].[suggestion_number_seq] TO [service_role];
GO

--
-- Name: TABLE suggestion_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_reviews] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_reviews] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_reviews] TO [service_role];
GO

--
-- Name: TABLE suggestion_similarities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_similarities] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_similarities] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_similarities] TO [service_role];
GO

--
-- Name: TABLE suggestion_updates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_updates] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_updates] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_updates] TO [service_role];
GO

--
-- Name: TABLE suggestion_votes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_votes] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_votes] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestion_votes] TO [service_role];
GO

--
-- Name: TABLE suggestions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestions] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestions] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[suggestions] TO [service_role];
GO

--
-- Name: TABLE tool_calls; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[tool_calls] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[tool_calls] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[tool_calls] TO [service_role];
GO

--
-- Name: TABLE universities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[universities] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[universities] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[universities] TO [service_role];
GO

--
-- Name: TABLE university_colleges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[university_colleges] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[university_colleges] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[university_colleges] TO [service_role];
GO

--
-- Name: TABLE university_services; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[university_services] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[university_services] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[university_services] TO [service_role];
GO

--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[user_roles] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[user_roles] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[user_roles] TO [service_role];
GO

--
-- Name: TABLE web_knowledge_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_knowledge_sources] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_knowledge_sources] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_knowledge_sources] TO [service_role];
GO

--
-- Name: TABLE web_page_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_page_chunks] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_page_chunks] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_page_chunks] TO [service_role];
GO

--
-- Name: TABLE web_source_changes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_source_changes] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_source_changes] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_source_changes] TO [service_role];
GO

--
-- Name: TABLE web_source_pages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_source_pages] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_source_pages] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[web_source_pages] TO [service_role];
GO

--
-- Name: TABLE working_calendars; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[working_calendars] TO [anon];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[working_calendars] TO [authenticated];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[working_calendars] TO [service_role];
GO


-- ========== REFERENCE SEED ==========

BEGIN TRAN;
GO

BEGIN TRY
--
-- Data for Name: action_revalidation_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[action_revalidation_policies] (id, action_code, service_code, check_service_window, check_holds, hold_types, check_student_status, check_resource_capacity, resource_type, check_existing_assignment, check_eligibility, check_policy_version, check_conflicting_transaction, custom_validation_function, recovery_mode, enabled, notes, created_at, updated_at) VALUES
	('fe204cc0-6c6f-4012-be6f-e7317f6a6b83', 'confirm_internship_assignment', 'SVC-INTERN-APPLY', 1, 1, '{prevents_registration}', 1, 1, 'internship_seat', 1, 1, 0, 1, NULL, 'auto', 1, 'Internship allocation: window, internship-relevant holds, enrolment, existing assignment, live seat, eligibility, clearance.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00'),
	('425111ee-0b17-45ed-9007-fbac15b8df7b', 'join_internship_waitlist', 'SVC-INTERN-APPLY', 1, 0, '{}', 1, 0, NULL, 1, 0, 0, 0, NULL, 'none', 1, 'Waitlist join: window and enrolment only.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00'),
	('d00b8043-c8b3-46f7-b613-6c0987e06b19', 'register_hostel_housing', 'HOUSING-REG', 1, 1, '{prevents_registration}', 1, 1, 'hostel_bed', 1, 1, 0, 1, NULL, 'auto', 1, 'Housing allocation: window, holds, existing allocation, selected room/hostel capacity, eligibility.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00'),
	('d943575d-8335-4e55-be77-776a3c81a375', 'join_housing_waitlist', 'HOUSING-REG', 1, 0, '{}', 1, 0, NULL, 1, 0, 0, 0, NULL, 'none', 1, 'Waitlist join: window and enrolment only.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00'),
	('7cdc6969-0d41-4c3e-95a1-dab9c249479a', 'analyze_intercollege_transfer', 'SVC-COLLEGE-TRANSFER', 1, 1, '{prevents_registration}', 1, 1, 'transfer_seat', 0, 1, 1, 0, NULL, 'confirm', 1, 'Transfer: window, credits, GPA, previous transfers, holds, programme capacity, equivalency version.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00'),
	('e0343dd9-3fe4-4a29-9c84-95095b723764', 'book_appointment', NULL, 0, 0, '{}', 0, 1, 'appointment_slot', 0, 0, 0, 1, NULL, 'auto', 1, 'Appointment: live slot capacity and duplicate/conflicting booking only.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00'),
	('02c6a7b4-1968-44d6-9adf-7912fcd77f5e', 'issue_enrollment_letter', 'SVC-DOC-TWIMC', 1, 0, '{}', 1, 0, NULL, 0, 0, 0, 0, NULL, 'none', 1, 'Document generation: identity, active enrolment and document-service window only.', '2026-08-27 10:57:06.096477+00:00', '2026-08-27 10:57:06.096477+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: agent_prompt_versions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: agent_tools; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[agent_tools] (id, tool_name, agent_type, description, input_schema, output_schema, authentication_required, allowed_roles, risk_level, confirmation_required, human_approval_required, audit_required, timeout_ms, enabled, created_at, updated_at) VALUES
	('f2f9c346-87e9-46dc-b734-156422d6f161', 'find_internship_matches', 'internship', 'Runs the deterministic internship matching engine and returns ranked placements.', '{}', '{}', 1, '["student", "staff"]', 'level_0', 0, 0, 1, 8000, 1, '2026-08-27 10:57:05.180072+00:00', '2026-08-27 10:57:05.180072+00:00'),
	('703e239c-a627-4792-94cc-c1fb2f40ddc7', 'get_internship_status', 'internship', 'Returns the signed-in student current internship placement and course registration.', '{}', '{}', 1, '["student", "staff"]', 'level_0', 0, 0, 1, 8000, 1, '2026-08-27 10:57:05.180072+00:00', '2026-08-27 10:57:05.180072+00:00'),
	('ac01c688-8a29-4422-bdf8-3ef751c8023b', 'confirm_internship_assignment', 'internship', 'Reserves an internship seat transactionally after student confirmation.', '{}', '{}', 1, '["student"]', 'level_2', 1, 0, 1, 8000, 1, '2026-08-27 10:57:05.180072+00:00', '2026-08-27 10:57:05.180072+00:00'),
	('a2d603ad-5af4-46d2-a0b0-db5dc37bd470', 'join_internship_waitlist', 'internship', 'Adds the student to the internship waitlist.', '{}', '{}', 1, '["student"]', 'level_1', 1, 0, 1, 8000, 1, '2026-08-27 10:57:05.180072+00:00', '2026-08-27 10:57:05.180072+00:00'),
	('86067021-7ad1-4db6-a0b5-05d6af8cdc3e', 'check_internship_placement_eligibility', 'internship', 'Checks internship eligibility for the signed-in student.', '{}', '{}', 1, '["student", "staff"]', 'level_0', 0, 0, 1, 8000, 1, '2026-08-27 10:57:05.180072+00:00', '2026-08-27 10:57:05.206139+00:00'),
	('58ee53df-8b01-44c1-8b2d-a4c2ab71967a', 'get_case_result', 'query', 'Show the decided result of the student''s own request.', '{}', '{}', 1, '["student"]', 'level_0', 0, 0, 1, 8000, 1, '2026-09-10 19:08:29.037619+00:00', '2026-09-10 19:08:29.037619+00:00'),
	('e07ac44f-86c7-4a9b-bb0b-1b744e91093a', 'add_case_information', 'action', 'Attach extra information to the student''s existing request.', '{}', '{}', 1, '["student"]', 'level_0', 0, 0, 1, 8000, 1, '2026-09-10 19:08:29.037619+00:00', '2026-09-10 19:08:29.037619+00:00'),
	('fe7b4626-75f6-4817-a019-227f8dfdeb5c', 'modify_case_request', 'action', 'Amend the details of an open request the student submitted.', '{}', '{}', 1, '["student"]', 'level_1', 0, 0, 1, 8000, 1, '2026-09-10 19:08:29.037619+00:00', '2026-09-10 19:08:29.037619+00:00'),
	('d94f82db-5956-4543-a16c-ec441c551dca', 'raise_case_review', 'action', 'Record a question, correction request or objection on a decided request.', '{}', '{}', 1, '["student"]', 'level_1', 0, 0, 1, 8000, 1, '2026-09-10 19:08:29.037619+00:00', '2026-09-10 19:08:29.037619+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: ai_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[ai_settings] (id, is_singleton, provider, model_name, embedding_model, api_key, api_url, temperature, max_output_tokens, confidence_threshold, handoff_threshold, retrieval_top_k, max_tool_calls, request_timeout_ms, daily_cost_limit_usd, agent_flags, ai_enabled, updated_by, created_at, updated_at) VALUES
	('31a12630-e21f-4cda-9f5b-e7bf8a948a4a', 1, 'gemini', 'google/gemini-3.6-flash', 'google/gemini-embedding-001', NULL, 'https://generativelanguage.googleapis.com/v1beta', 0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25, '{"alert": true, "query": true, "action": true, "complaint": true, "knowledge": true, "suggestion": true, "supervisor": true, "case_management": true}', 1, NULL, '2026-08-27 10:57:04.782984+00:00', '2026-08-27 10:57:04.782984+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: ats_scoring_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[ats_scoring_profiles] (id, scope, role_code, engine_version, weights_version, weights, bands, active, created_at, updated_at) VALUES
	('a8dbe021-3e6b-427e-bbfe-d7d49870ffb2', 'general', NULL, 'ats.v2', 'ats-weights.v1', '{"skills": 15, "clarity": 5, "contact": 10, "keyword": 10, "parsing": 15, "education": 10, "achievement": 10, "completeness": 5, "experienceProject": 20}', '[{"min": 90, "labelAr": "جاهزية ممتازة لأنظمة الفرز", "labelEn": "Excellent ATS Readiness"}, {"min": 80, "labelAr": "قوية", "labelEn": "Strong"}, {"min": 70, "labelAr": "جيدة مع تحسينات مقترحة", "labelEn": "Good, with improvements recommended"}, {"min": 60, "labelAr": "تحتاج إلى تحسين", "labelEn": "Needs Improvement"}, {"min": 0, "labelAr": "تحتاج إلى تحسين جوهري", "labelEn": "Significant Improvement Needed"}]', 1, '2026-08-27 10:57:06.122386+00:00', '2026-08-27 10:57:06.122386+00:00'),
	('7005be84-2ffe-46f9-be29-2552f26a9a2f', 'role', NULL, 'ats.v2', 'ats-weights.v1', '{"tools": 15, "projects": 15, "coursework": 10, "experience": 15, "terminology": 5, "certifications": 5, "requiredSkills": 25, "preferredSkills": 10}', '[]', 1, '2026-08-27 10:57:06.148297+00:00', '2026-08-27 10:57:06.148297+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: universities; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[universities] (id, name_en, name_ar, short_name, country, timezone, is_active, created_at, updated_at) VALUES
	('3341f8c7-e8c3-4e2e-b97f-f1907a07a872', 'United Arab Emirates University', 'جامعة الإمارات العربية المتحدة', 'UAEU', 'AE', 'Asia/Dubai', 1, '2026-08-27 10:59:26.145939+00:00', '2026-08-27 10:59:26.145939+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: campuses; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[campuses] (id, university_id, name_en, name_ar, location_en, location_ar, is_active, created_at, updated_at) VALUES
	('49c96405-977f-4263-aa38-7d95ee9fb08b', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', 'Al Maqam Campus', 'حرم المقام', 'Al Ain, Abu Dhabi', 'العين، أبوظبي', 1, '2026-08-27 10:59:26.176856+00:00', '2026-08-27 10:59:26.176856+00:00'),
	('52140276-220a-4ab6-a7b3-9dbbe56529a7', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', 'Al Jimi Campus', 'حرم الجيمي', 'Al Ain, Abu Dhabi', 'العين، أبوظبي', 1, '2026-08-27 10:59:26.176856+00:00', '2026-08-27 10:59:26.176856+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: colleges; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[colleges] (id, university_id, campus_id, code, name_en, name_ar, dean_name, contact_email, is_active, created_at, updated_at) VALUES
	('f134d6c7-f451-44ad-a39d-2aab4dab0615', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'CIT', 'College of Information Technology', 'كلية تقنية المعلومات', NULL, 'cit@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('d71671ac-d5c7-4f7b-b85b-6afaea42e623', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'ENG', 'College of Engineering', 'كلية الهندسة', NULL, 'eng@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('9a83babf-7bed-4653-b37e-34d3daaf7b5b', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'BUS', 'College of Business and Economics', 'كلية الأعمال والاقتصاد', NULL, 'cbe@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('02f2157d-5839-40a6-8570-cc17c8f6d122', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'SCI', 'College of Science', 'كلية العلوم', NULL, 'sci@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('c6ac9d12-3844-406e-8148-7d96eec09265', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'EDU', 'College of Education', 'كلية التربية', NULL, 'edu@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('57e53226-4138-458e-893e-15afb2a6c453', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'HSS', 'College of Humanities and Social Sciences', 'كلية العلوم الإنسانية والاجتماعية', NULL, 'hss@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('3b917c2a-6421-43eb-b09c-c1fae6b8a032', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'LAW', 'College of Law', 'كلية القانون', NULL, 'law@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('f92cf931-7188-4d6d-84d0-ef309f9312ba', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'MED', 'College of Medicine and Health Sciences', 'كلية الطب والعلوم الصحية', NULL, 'cmhs@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('b6929fac-aed3-4f4d-8303-e4a153c6a266', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'AGRI', 'College of Agriculture and Veterinary Medicine', 'كلية الزراعة والطب البيطري', NULL, 'cavm@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('f1685ea1-6f42-4425-baae-0875167ab916', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', '49c96405-977f-4263-aa38-7d95ee9fb08b', 'GRAD', 'College of Graduate Studies', 'كلية الدراسات العليا', NULL, 'cgs@uaeu.ac.ae', 1, '2026-08-27 10:59:26.205662+00:00', '2026-08-27 10:59:26.205662+00:00'),
	('477eb1c9-004d-4917-8c90-2874bb8870ca', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'CCAI', 'College of Computing and Artificial Intelligence', 'كلية الحوسبة والذكاء الاصطناعي', NULL, NULL, 1, '2026-09-12 05:22:30.343828+00:00', '2026-09-12 05:23:19.565884+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[departments] (id, code, name_en, name_ar, is_active, created_at, updated_at, college_id, chair_name, contact_email) VALUES
	('ca386d5a-ac55-45dc-b040-1fe4e142d884', 'SA', 'Student Affairs', 'شؤون الطلبة', 1, '2026-08-27 10:57:04.554362+00:00', '2026-08-27 10:57:04.554362+00:00', NULL, NULL, NULL),
	('c4bacc40-813d-42f9-bf8c-b9a8b041145a', 'ACAD', 'Academic Affairs', 'الشؤون الأكاديمية', 1, '2026-08-27 10:57:04.554362+00:00', '2026-08-27 10:57:04.554362+00:00', NULL, NULL, NULL),
	('ad425ae0-e28d-4c6a-8ae6-54163fc89292', 'FIN', 'Finance', 'الشؤون المالية', 1, '2026-08-27 10:57:04.554362+00:00', '2026-08-27 10:57:04.554362+00:00', NULL, NULL, NULL),
	('a301edc7-5ca0-4af4-a685-2c2606c4422f', 'CS', 'Computer Science', 'علوم الحاسوب', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', 'f134d6c7-f451-44ad-a39d-2aab4dab0615', NULL, NULL),
	('f48dfeb8-bb6e-4a6a-95ee-87f9093b69d3', 'IS', 'Information Systems and Security', 'نظم المعلومات والأمن', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', 'f134d6c7-f451-44ad-a39d-2aab4dab0615', NULL, NULL),
	('cdb2f525-4880-435b-a8a7-71d150dbd052', 'DSAI', 'Data Science and Artificial Intelligence', 'علم البيانات والذكاء الاصطناعي', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', 'f134d6c7-f451-44ad-a39d-2aab4dab0615', NULL, NULL),
	('88565219-8482-42b9-9386-a58768656b5e', 'EE', 'Electrical Engineering', 'الهندسة الكهربائية', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', 'd71671ac-d5c7-4f7b-b85b-6afaea42e623', NULL, NULL),
	('0dd44eff-eaef-4fdf-82b5-9cfbf7280b06', 'ME', 'Mechanical Engineering', 'الهندسة الميكانيكية', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', 'd71671ac-d5c7-4f7b-b85b-6afaea42e623', NULL, NULL),
	('8493044a-7bde-49df-9677-14dc2fb81d6c', 'BUSA', 'Business Administration', 'إدارة الأعمال', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', '9a83babf-7bed-4653-b37e-34d3daaf7b5b', NULL, NULL),
	('9bc76f18-3fc4-48f8-bbe0-67a6410d81e4', 'MATH', 'Mathematical Sciences', 'العلوم الرياضية', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', '02f2157d-5839-40a6-8570-cc17c8f6d122', NULL, NULL),
	('a9bf4b9e-df86-4df9-b498-77f5216af76e', 'BIO', 'Biology', 'علم الأحياء', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', '02f2157d-5839-40a6-8570-cc17c8f6d122', NULL, NULL),
	('decb39b5-c025-4251-8d55-9b7896328bb4', 'EDUC', 'Curriculum and Instruction', 'المناهج وطرق التدريس', 1, '2026-08-27 10:59:26.261427+00:00', '2026-08-27 10:59:26.261427+00:00', 'c6ac9d12-3844-406e-8148-7d96eec09265', NULL, NULL),
	('823b374a-eea9-46c4-b077-e85c4fa15faa', 'GENED', 'General Education', 'المتطلبات العامة', 1, '2026-08-27 10:57:05.410057+00:00', '2026-08-27 10:57:05.410057+00:00', '57e53226-4138-458e-893e-15afb2a6c453', NULL, NULL);
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: service_units; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[service_units] (id, department_id, code, name_en, name_ar, description_en, description_ar, email, is_active, created_at, updated_at, university_id, college_id, contact_email, phone_extension, office_location_en, office_location_ar, service_hours_en, service_hours_ar, escalation_unit_id, primary_service_owner_id, appointment_enabled) VALUES
	('142ab96c-8fe4-4d11-8e8f-11bd63916c4b', NULL, 'GENERAL_SERVICES_DEPAR', 'General Services Department', 'General Services Department', 'UAEU support group: S&C - General Services Department', NULL, NULL, 1, '2026-09-10 18:11:36.915775+00:00', '2026-09-10 18:11:36.915775+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('c07b1936-4425-4811-a2c7-31839e29641f', NULL, 'HR', 'HR', 'HR', 'UAEU support group: S&C - HR', NULL, NULL, 1, '2026-09-10 18:11:36.974212+00:00', '2026-09-10 18:11:36.974212+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('fb519c83-c080-4c37-83d4-a74c9d2a20f7', NULL, 'IT_COLLEGE', 'IT college', 'IT college', 'UAEU support group: S&C - IT college', NULL, NULL, 1, '2026-09-10 18:11:37.037343+00:00', '2026-09-10 18:11:37.037343+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('914dbbdf-8181-4dd6-a047-897ccc738460', NULL, 'PROVOST_OFFICE', 'Provost office', 'Provost office', 'UAEU support group: S&C - Provost office', NULL, NULL, 1, '2026-09-10 18:11:37.102252+00:00', '2026-09-10 18:11:37.102252+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('9d768b99-0080-4ae6-b085-f3bccc0f0348', NULL, 'SG', 'SG', 'SG', 'UAEU support group: S&C - SG', NULL, NULL, 1, '2026-09-10 18:11:37.167855+00:00', '2026-09-10 18:11:37.167855+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('2ed49aec-c466-4954-9c52-e85060601cb2', NULL, 'TENDER_PROCUREMENT', 'Tender & Procurement', 'Tender & Procurement', 'UAEU support group: S&C - Tender & Procurement', NULL, NULL, 1, '2026-09-10 18:11:37.230115+00:00', '2026-09-10 18:11:37.230115+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('fc6b5af9-fc93-496f-9179-6e5d29f74315', NULL, 'UNIVERSITY_COLLEGE', 'University College', 'University College', 'UAEU support group: S&C - University College', NULL, NULL, 1, '2026-09-10 18:11:37.299496+00:00', '2026-09-10 18:11:37.299496+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('13941a2b-5c6d-4537-bb32-7eab9f9cd50e', NULL, 'VC_OFFICE', 'VC Office', 'VC Office', 'UAEU support group: S&C - VC Office', NULL, NULL, 1, '2026-09-10 18:11:37.357233+00:00', '2026-09-10 18:11:37.357233+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('4c94be95-1776-44ef-b3bb-e694df62552f', NULL, 'COLLEGE_OF_SCIENCE', 'College Of Science', 'College Of Science', 'UAEU support group: S&C- College Of Science', NULL, NULL, 1, '2026-09-10 18:11:37.41656+00:00', '2026-09-10 18:11:37.41656+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('f542ab7d-4334-4d0c-a001-22aae416ba4b', NULL, 'DVCRA_RESEARCH_OFFICE', 'DVCRA - Research Office', 'DVCRA - Research Office', 'UAEU support group: S&C- DVCRA - Research Office', NULL, NULL, 1, '2026-09-10 18:11:37.47602+00:00', '2026-09-10 18:11:37.47602+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('dd1cfedd-4161-4150-b4fc-19df240410f1', NULL, 'UOD_UNIVERSITY_OUTREAC', 'UOD - University Outreach Department', 'UOD - University Outreach Department', 'UAEU support group: S&C- UOD - University Outreach Department', NULL, NULL, 1, '2026-09-10 18:11:37.538306+00:00', '2026-09-10 18:11:37.538306+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('fef1912f-7e23-434b-b39e-c9d0f500293d', NULL, 'COLLEGE_OF_LAW', 'College of Law', 'College of Law', 'UAEU support group: S&C-College of Law', NULL, NULL, 1, '2026-09-10 18:11:37.601631+00:00', '2026-09-10 18:11:37.601631+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('6775a757-82a9-42bf-b20b-2a35520012d4', NULL, 'UOD', 'UOD', 'UOD', 'UAEU support group: UOD', NULL, NULL, 1, '2026-09-10 18:11:37.662108+00:00', '2026-09-10 18:11:37.662108+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('c0c0d37c-5e79-474e-8b49-4b14d7e90280', NULL, 'UOD_IC', 'UOD - IC', 'UOD - IC', 'UAEU support group: UOD - IC', NULL, NULL, 1, '2026-09-10 18:11:37.721704+00:00', '2026-09-10 18:11:37.721704+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('48e59ef6-be85-471d-ae41-274d214f50fc', NULL, 'UOD_LS', 'UOD - LS', 'UOD - LS', 'UAEU support group: UOD - LS', NULL, NULL, 1, '2026-09-10 18:11:37.782072+00:00', '2026-09-10 18:11:37.782072+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('c9257945-bee0-41fb-8715-b47a0e5ab15e', NULL, 'UOD_MARKETING', 'UOD - Marketing', 'UOD - Marketing', 'UAEU support group: UOD - Marketing', NULL, NULL, 1, '2026-09-10 18:11:37.841642+00:00', '2026-09-10 18:11:37.841642+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('ecced5a7-3a84-4da6-9db5-0e2eae6143de', NULL, 'UOD_MC', 'UOD - MC', 'UOD - MC', 'UAEU support group: UOD - MC', NULL, NULL, 1, '2026-09-10 18:11:37.903035+00:00', '2026-09-10 18:11:37.903035+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('7e802bdc-dc66-4cd3-afab-9e7c35d3b399', NULL, 'UOD_MULTAQA', 'UOD - Multaqa', 'UOD - Multaqa', 'UAEU support group: UOD - Multaqa', NULL, NULL, 1, '2026-09-10 18:11:37.963328+00:00', '2026-09-10 18:11:37.963328+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('5b068129-ab6c-4722-a898-7958cab97930', 'ca386d5a-ac55-45dc-b040-1fe4e142d884', 'REG', 'Admission & Registration', 'القبول والتسجيل', 'Enrollment, transcripts, course registration', 'التسجيل وكشوف الدرجات', 'registration@uaeu.ac.ae', 1, '2026-08-27 10:57:04.580549+00:00', '2026-08-27 10:57:04.580549+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('91099417-211e-4e93-bb80-9fd23e5816b4', 'ad425ae0-e28d-4c6a-8ae6-54163fc89292', 'FEES', 'Student Finance', 'الشؤون المالية للطلبة', 'Tuition, fees, scholarships and refunds', 'الرسوم والمنح والاستردادات', 'finance@uaeu.ac.ae', 1, '2026-08-27 10:57:04.580549+00:00', '2026-08-27 10:57:04.580549+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('3cfe0883-9559-4382-9d66-13194265e01c', NULL, 'COMP', 'Student Complaints Office', 'مكتب شكاوى الطلبة', 'General, escalated and sensitive student complaints.', 'الشكاوى العامة والمصعّدة والحساسة.', 'complaints@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'complaints@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', NULL, NULL, 0),
	('dd31e880-1f86-4c8e-b824-a2a914729496', 'ca386d5a-ac55-45dc-b040-1fe4e142d884', 'HOUS', 'Student Housing', 'السكن الطلابي', 'Campus accommodation and residence life', 'السكن الجامعي والحياة الطلابية', 'housing@uaeu.ac.ae', 1, '2026-08-27 10:57:04.580549+00:00', '2026-08-27 10:57:04.580549+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('ea605b71-87a7-434d-950d-c3e361adddcb', NULL, 'CES_UNIT', 'CES Unit', 'CES Unit', 'UAEU support group: CES Unit', NULL, NULL, 1, '2026-09-10 18:11:35.350247+00:00', '2026-09-10 18:11:35.350247+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('12405946-9157-4785-a04b-bf9e4870103d', NULL, 'CHANCELLOR_OFFICE', 'Chancellor Office', 'Chancellor Office', 'UAEU support group: Chancellor Office', NULL, NULL, 1, '2026-09-10 18:11:35.441401+00:00', '2026-09-10 18:11:35.441401+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('c9f878a4-a16f-4bc6-9512-cde223e61932', NULL, 'COLLEGE_OF_SCIENCE_COS', 'College of Science COS', 'College of Science COS', 'UAEU support group: College of Science COS', NULL, NULL, 1, '2026-09-10 18:11:35.5063+00:00', '2026-09-10 18:11:35.5063+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('9b8993b6-0627-47e8-adb5-37774a5a9877', NULL, 'DVCSE', 'DVCSE', 'DVCSE', 'UAEU support group: DVCSE', NULL, NULL, 1, '2026-09-10 18:11:35.568229+00:00', '2026-09-10 18:11:35.568229+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('3ba168ff-6a3a-49f4-9e4a-59245f542c50', NULL, 'FMD', 'FMD', 'FMD', 'UAEU support group: FMD', NULL, NULL, 1, '2026-09-10 18:11:35.632056+00:00', '2026-09-10 18:11:35.632056+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('866feaee-abbb-4fb5-9c7e-05d6cd7ec152', NULL, 'GENERAL_SERVICES', 'General Services', 'General Services', 'UAEU support group: General Services', NULL, NULL, 1, '2026-09-10 18:11:35.693268+00:00', '2026-09-10 18:11:35.693268+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('14183488-c822-446e-b473-923bb7151e02', NULL, 'GENERAL_SUPERVISION_OF', 'General Supervision Office', 'General Supervision Office', 'UAEU support group: General Supervision Office', NULL, NULL, 1, '2026-09-10 18:11:35.754983+00:00', '2026-09-10 18:11:35.754983+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('d4d176f7-e9c7-4d74-8b9d-96ce12d8c711', NULL, 'SAS', 'Student Academic Services', 'خدمات الطلبة الأكاديمية', 'Records, enrolment verification and official letters.', 'السجلات وإفادات القيد والرسائل الرسمية.', 'sas@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'sas@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('135bfc65-05ca-491f-a02e-c3c54a5b36e3', NULL, 'HD', 'HD', 'HD', 'UAEU support group: HD', NULL, NULL, 1, '2026-09-10 18:11:35.815942+00:00', '2026-09-10 18:11:35.815942+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('cbf110ab-30d5-459b-8b65-bf7d29279e0f', NULL, 'HR_SERVICES', 'HR Services', 'HR Services', 'UAEU support group: HR Services', NULL, NULL, 1, '2026-09-10 18:11:35.875131+00:00', '2026-09-10 18:11:35.875131+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('aebf9429-5ad0-4a5f-a6eb-973fb59304da', NULL, 'NATIONAL_FELLOW_GROUP', 'National Fellow Group', 'National Fellow Group', 'UAEU support group: National Fellow Group', NULL, NULL, 1, '2026-09-10 18:11:35.936619+00:00', '2026-09-10 18:11:35.936619+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('da75a1ba-81db-420b-a75a-12372b70af46', NULL, 'NATIONAL_FELLOW_RECRUI', 'National Fellow Recruitment Group', 'National Fellow Recruitment Group', 'UAEU support group: National Fellow Recruitment Group', NULL, NULL, 1, '2026-09-10 18:11:36.002078+00:00', '2026-09-10 18:11:36.002078+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('a0b311cd-bd19-4aef-ac02-5de0a8068471', NULL, 'PROCUREMENT', 'Procurement', 'Procurement', 'UAEU support group: Procurement', NULL, NULL, 1, '2026-09-10 18:11:36.068597+00:00', '2026-09-10 18:11:36.068597+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('466b9d1c-6363-4977-b842-c111982c7a6e', NULL, 'PROVOST', 'Provost', 'Provost', 'UAEU support group: Provost', NULL, NULL, 1, '2026-09-10 18:11:36.13079+00:00', '2026-09-10 18:11:36.13079+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('d02357cc-b01e-40bd-b428-19c207745d32', NULL, 'CEC', 'CEC', 'CEC', 'UAEU support group: S&C - CEC', NULL, NULL, 1, '2026-09-10 18:11:36.198955+00:00', '2026-09-10 18:11:36.198955+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('214fbc4f-7628-431a-b055-790f60f08cd7', NULL, 'CEDU', 'CEDU', 'CEDU', 'UAEU support group: S&C - CEDU', NULL, NULL, 1, '2026-09-10 18:11:36.263378+00:00', '2026-09-10 18:11:36.263378+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('2795a440-a34e-4376-abad-e706981e2bf6', NULL, 'CMHS', 'CMHS', 'CMHS', 'UAEU support group: S&C - CMHS', NULL, NULL, 1, '2026-09-10 18:11:36.347991+00:00', '2026-09-10 18:11:36.347991+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('a77e2fc5-3319-40bf-9601-169ec0b045e9', NULL, 'COB', 'COB', 'COB', 'UAEU support group: S&C - COB', NULL, NULL, 1, '2026-09-10 18:11:36.440331+00:00', '2026-09-10 18:11:36.440331+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('a0aa3a45-3cfe-4daf-b1bb-71355c3f28b2', NULL, 'COLLEGE_OF_CAVM', 'College of CAVM', 'College of CAVM', 'UAEU support group: S&C - College of CAVM', NULL, NULL, 1, '2026-09-10 18:11:36.514192+00:00', '2026-09-10 18:11:36.514192+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('a13fd043-dd34-40a1-a5b0-b0b3c70d808a', NULL, 'COLLEGE_OF_CHSS', 'College of CHSS', 'College of CHSS', 'UAEU support group: S&C - College of CHSS', NULL, NULL, 1, '2026-09-10 18:11:36.584489+00:00', '2026-09-10 18:11:36.584489+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('cf7604ee-2a17-4f65-a728-c965567e4dfd', NULL, 'COLLEGE_OF_ENGINEERING', 'College of Engineering', 'College of Engineering', 'UAEU support group: S&C - College of Engineering', NULL, NULL, 1, '2026-09-10 18:11:36.654904+00:00', '2026-09-10 18:11:36.654904+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('3424243d-fe7b-4c80-b655-6575e9e106b5', NULL, 'COLLEGE_OF_GRADUATE_ST', 'College of Graduate studies', 'College of Graduate studies', 'UAEU support group: S&C - College of Graduate studies', NULL, NULL, 1, '2026-09-10 18:11:36.729901+00:00', '2026-09-10 18:11:36.729901+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('d27f1be7-a3a8-4cd7-9e4d-d736265fbfa3', NULL, 'DVCSAE_OFFICE', 'DVCSAE Office', 'DVCSAE Office', 'UAEU support group: S&C - DVCSAE Office', NULL, NULL, 1, '2026-09-10 18:11:36.797116+00:00', '2026-09-10 18:11:36.797116+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('8c6c9c50-5206-44f4-99f9-0b8f2342a7a3', NULL, 'FACILITIES_MANAGEMENT_', 'Facilities Management Department', 'Facilities Management Department', 'UAEU support group: S&C - Facilities Management Department', NULL, NULL, 1, '2026-09-10 18:11:36.855257+00:00', '2026-09-10 18:11:36.855257+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
	('31d33a09-dc8d-42a8-a08b-cf50cc4a13c9', NULL, 'TRANS', 'Transportation Services', 'خدمات النقل', 'Campus bus routes, schedules and transport requests.', 'خطوط الحافلات والجداول وطلبات النقل.', 'transport@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'transport@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('00121099-315d-417e-8d02-c4c2abbc5e06', NULL, 'ADV', 'Academic Advising', 'الإرشاد الأكاديمي', 'Study plans, graduation progress and advising appointments.', 'الخطط الدراسية ومتابعة التخرج ومواعيد الإرشاد.', 'advising@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'advising@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('d1de7e13-18a9-4f26-9347-275275703c96', NULL, 'ITS', 'IT Support', 'الدعم التقني', 'Accounts, network access and campus systems support.', 'الحسابات والوصول للشبكة ودعم أنظمة الحرم الجامعي.', 'ithelp@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'ithelp@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('8148f18f-f490-418a-95b6-613febe31259', NULL, 'LIB', 'Library Services', 'خدمات المكتبة', 'Borrowing, study spaces and research support.', 'الإعارة وقاعات الدراسة ودعم البحث.', 'library@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'library@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0);
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
INSERT INTO [dbo].[service_units] (id, department_id, code, name_en, name_ar, description_en, description_ar, email, is_active, created_at, updated_at, university_id, college_id, contact_email, phone_extension, office_location_en, office_location_ar, service_hours_en, service_hours_ar, escalation_unit_id, primary_service_owner_id, appointment_enabled) VALUES
	('3c4d4404-2255-4c4d-baea-99c69eae5904', NULL, 'ACCESS', 'Accessibility Support', 'الدعم لذوي الهمم', 'Accommodations and accessibility services for students.', 'التسهيلات وخدمات إمكانية الوصول للطلبة.', 'accessibility@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'accessibility@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('e6c1d21b-344e-4f15-b82a-5f1fbdebed7e', NULL, 'HOUSING', 'Student Housing Services', 'خدمات السكن الطلابي', 'Manages student housing eligibility, hostel applications, room allocation, move-in arrangements, and housing support.', 'تتولى إدارة أهلية السكن الطلابي وطلبات السكن وتخصيص الغرف وإجراءات السكن والدعم المرتبط به.', NULL, 1, '2026-08-27 10:57:04.914014+00:00', '2026-08-27 10:57:04.914014+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'housing@demo.uaeu.local', NULL, NULL, NULL, NULL, NULL, '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('8877b972-42f4-4f59-8ba4-f1f38c822a92', NULL, 'HAPPY', 'Student Happiness and Engagement', 'سعادة الطلبة والمشاركة', 'Student experience, events and engagement programmes.', 'تجربة الطالب والفعاليات وبرامج المشاركة.', 'happiness@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'happiness@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 0),
	('695adb9d-ec24-445d-a1fb-687641ce1c7b', NULL, 'CAREER', 'Center for Career Placement & Alumni', 'مركز التوظيف وشؤون الخريجين', 'Internship placement, CV review and career counselling.', 'التدريب العملي ومراجعة السيرة الذاتية والإرشاد المهني.', 'careers@uaeu.ac.ae', 1, '2026-08-27 10:59:26.316073+00:00', '2026-08-27 10:59:26.316073+00:00', '3341f8c7-e8c3-4e2e-b97f-f1907a07a872', NULL, 'careers@uaeu.ac.ae', NULL, NULL, NULL, 'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00', '3cfe0883-9559-4382-9d66-13194265e01c', NULL, 1),
	('5cab5fc5-c634-418d-a943-ee3f6b36ee24', NULL, 'OES', 'Operations and Emergency Section', 'قسم العمليات والطوارئ', NULL, NULL, 'OES@uaeu.ac.ae', 1, '2026-09-12 10:50:06.965618+00:00', '2026-09-12 10:50:06.965618+00:00', NULL, NULL, 'OES@uaeu.ac.ae', '6888', NULL, NULL, NULL, NULL, NULL, NULL, 0);
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: automation_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[automation_policies] (id, action_key, case_type, service_unit_id, risk_level, applies_to_sensitive, autonomy_level, min_confidence, notes, is_active, created_at, updated_at) VALUES
	('74166895-e2bf-4c01-b686-3119f19682aa', 'classification', NULL, NULL, NULL, 0, 'automatic', 0.5, 'Safe default', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('78095b93-7474-4a20-a941-d977426210bb', 'routing', NULL, NULL, NULL, 0, 'automatic', 0.6, 'Safe default', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('7a0280b4-005d-47c4-813f-7b0d6e304ebe', 'assignment', NULL, NULL, NULL, 0, 'automatic', 0.6, 'Safe default', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('88dfff81-a9c3-47a9-a744-89d76277e6a6', 'sla_calculation', NULL, NULL, NULL, 0, 'automatic', 0.0, 'Deterministic', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('31f48dbb-7fd8-41a3-a53b-9d518838262b', 'acknowledgement', NULL, NULL, NULL, 0, 'automatic', 0.0, 'Deterministic', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('22b8ba86-14cf-4b6a-8a33-9afe7d2fb0c4', 'missing_information_request', NULL, NULL, NULL, 0, 'automatic', 0.6, 'Routine request only', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('6d1da5a8-930f-44c1-8002-8cf11087f040', 'reminder', NULL, NULL, NULL, 0, 'automatic', 0.0, 'Policy driven', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('fac50b17-0556-4721-9727-153fa1782683', 'status_update', NULL, NULL, NULL, 0, 'automatic', 0.0, 'Deterministic transitions', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('533925b1-ff7f-46bc-be80-02532639cab5', 'sla_escalation', NULL, NULL, NULL, 0, 'automatic', 0.0, 'Approved escalation rules', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('e86bcbf5-26c1-4bc3-91d2-49391e65ca65', 'student_notification', NULL, NULL, NULL, 0, 'automatic', 0.0, 'Template grounded', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('149dc8ea-f44f-4480-884a-e9a25f679ac7', 'draft_response', NULL, NULL, NULL, 0, 'automatic', 0.5, 'Draft only', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('e96f7707-0503-4f40-9721-d017a85cf7df', 'response_sending', NULL, NULL, NULL, 0, 'automatic_notify', 0.75, 'Routine informational responses', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('8b5d4376-8c05-4fdc-a476-797802c3e7b0', 'resolution_preparation', NULL, NULL, NULL, 0, 'automatic_notify', 0.6, 'Owner visibility', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('64827417-08d3-4291-b322-96e3008d749b', 'resolution_sending', NULL, NULL, NULL, 0, 'owner_approval', 0.9, 'Judgment required', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('f3110669-50af-4fd2-bf45-503107f1d22b', 'case_closure', NULL, NULL, NULL, 0, 'owner_approval', 0.9, 'Judgment required', 1, '2026-08-27 10:57:04.808802+00:00', '2026-08-27 10:57:04.808802+00:00'),
	('176e8f0f-9de5-4268-9488-b24d23d1be46', 'response_sending', NULL, NULL, NULL, 1, 'human_only', 1.0, 'Sensitive cases are human controlled', 1, '2026-08-27 10:57:04.834976+00:00', '2026-08-27 10:57:04.834976+00:00'),
	('d3a5e047-e2ce-4f36-9089-02f92b6c26c1', 'draft_response', NULL, NULL, NULL, 1, 'owner_approval', 1.0, 'Sensitive cases are human controlled', 1, '2026-08-27 10:57:04.834976+00:00', '2026-08-27 10:57:04.834976+00:00'),
	('62d0f9e3-3458-41f5-8c65-e6622e07f63f', 'resolution_preparation', NULL, NULL, NULL, 1, 'human_only', 1.0, 'Sensitive cases are human controlled', 1, '2026-08-27 10:57:04.834976+00:00', '2026-08-27 10:57:04.834976+00:00'),
	('a5c9cd6a-e19a-41d5-9659-419486659d87', 'resolution_sending', NULL, NULL, NULL, 1, 'human_only', 1.0, 'Sensitive cases are human controlled', 1, '2026-08-27 10:57:04.834976+00:00', '2026-08-27 10:57:04.834976+00:00'),
	('7f13ff89-4129-44c7-ace6-f17a8d32374f', 'case_closure', NULL, NULL, NULL, 1, 'human_only', 1.0, 'Sensitive cases are human controlled', 1, '2026-08-27 10:57:04.834976+00:00', '2026-08-27 10:57:04.834976+00:00'),
	('c67c6782-db84-4514-ab75-aa6a2a100a22', 'missing_information_request', NULL, NULL, NULL, 1, 'owner_approval', 1.0, 'Sensitive cases are human controlled', 1, '2026-08-27 10:57:04.834976+00:00', '2026-08-27 10:57:04.834976+00:00'),
	('f67a63ad-45fc-4829-b6d4-25ed29150a4b', 'response_sending', NULL, NULL, 'level_3', 0, 'human_only', 1.0, 'Level 3 actions are human controlled', 1, '2026-08-27 10:57:04.860676+00:00', '2026-08-27 10:57:04.860676+00:00'),
	('b636ca48-be7b-4721-8b2c-25e3f3f1f64d', 'resolution_sending', NULL, NULL, 'level_3', 0, 'human_only', 1.0, 'Level 3 actions are human controlled', 1, '2026-08-27 10:57:04.860676+00:00', '2026-08-27 10:57:04.860676+00:00'),
	('9311902c-0e01-4d41-b2a9-bb9996be4821', 'case_closure', NULL, NULL, 'level_3', 0, 'human_only', 1.0, 'Level 3 actions are human controlled', 1, '2026-08-27 10:57:04.860676+00:00', '2026-08-27 10:57:04.860676+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: bilingual_terms; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: career_matching_weight_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[career_matching_weight_profiles] (id, profile_mode, weights, active, updated_at, created_at) VALUES
	('831ef14c-6ab8-4391-8dab-0e76bb0e27e1', 'academic', '{"tools": 3, "programme": 35, "coursework": 30, "experience": 10, "hardSkills": 10, "preference": 8, "softSkills": 2, "certifications": 2}', 1, '2026-08-27 10:57:05.667196+00:00', '2026-08-27 10:57:05.667196+00:00'),
	('d16a3447-0c40-40dc-9e7b-395bd7f99508', 'cv_enhanced', '{"tools": 10, "programme": 15, "coursework": 15, "experience": 15, "hardSkills": 20, "preference": 15, "softSkills": 5, "certifications": 5}', 1, '2026-08-27 10:57:05.667196+00:00', '2026-08-27 10:57:05.667196+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: case_categories; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[case_categories] (id, code, name_en, name_ar, case_type, default_unit_id, is_sensitive, is_active, created_at) VALUES
	('c964f29b-d839-454a-9ab0-5de6f01591d9', 'REG_ISSUE', 'Registration issue', 'مشكلة في التسجيل', 'complaint', '5b068129-ab6c-4722-a898-7958cab97930', 0, 1, '2026-08-27 10:57:04.608212+00:00'),
	('d7d23b4f-5c96-42f1-ac7c-3bc08379f5b8', 'GRADE', 'Grade or assessment concern', 'مشكلة في الدرجات أو التقييم', 'complaint', '5b068129-ab6c-4722-a898-7958cab97930', 0, 1, '2026-08-27 10:57:04.608212+00:00'),
	('8f54c0e2-deb2-4272-8b74-72abf51dbd2e', 'HOUSING', 'Housing and facilities', 'السكن والمرافق', 'complaint', 'dd31e880-1f86-4c8e-b824-a2a914729496', 0, 1, '2026-08-27 10:57:04.608212+00:00'),
	('62632413-8727-4d53-be7c-f135ae9325f2', 'FINANCE', 'Fees and payments', 'الرسوم والمدفوعات', 'complaint', '91099417-211e-4e93-bb80-9fd23e5816b4', 0, 1, '2026-08-27 10:57:04.608212+00:00'),
	('e83c750c-d875-45c3-85b8-56aa37160f1d', 'SAFETY', 'Safety concern', 'مخاوف تتعلق بالسلامة', 'complaint', 'dd31e880-1f86-4c8e-b824-a2a914729496', 1, 1, '2026-08-27 10:57:04.608212+00:00'),
	('37358936-ae49-494e-b673-c266e5294b18', 'HARASS', 'Harassment or discrimination', 'التحرش أو التمييز', 'complaint', '5b068129-ab6c-4722-a898-7958cab97930', 1, 1, '2026-08-27 10:57:04.608212+00:00'),
	('20e3cc6d-b033-4c6b-9f8a-86dd90811ec2', 'STAFF', 'Staff conduct', 'سلوك الموظفين', 'complaint', '5b068129-ab6c-4722-a898-7958cab97930', 1, 1, '2026-08-27 10:57:04.608212+00:00'),
	('f0e741b7-4474-401f-8dfa-0f1830f4aae4', 'SERVICE_IMP', 'Service improvement', 'تحسين الخدمة', 'suggestion', '5b068129-ab6c-4722-a898-7958cab97930', 0, 1, '2026-08-27 10:57:04.608212+00:00'),
	('dbd5e58d-4226-4c19-aac6-143362a8cd87', 'CAMPUS_LIFE', 'Campus life', 'الحياة الجامعية', 'suggestion', 'dd31e880-1f86-4c8e-b824-a2a914729496', 0, 1, '2026-08-27 10:57:04.608212+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: data_authority_rules; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: document_retention_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[document_retention_policies] (document_type, retention_days, label_en, label_ar, updated_by, updated_at) VALUES
	('to_whom_it_may_concern', 30, 'To Whom It May Concern letter', 'شهادة إلى من يهمه الأمر', NULL, '2026-08-27 10:57:05.539201+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: document_templates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[document_templates] (id, document_type, language, version, status, title, header_text, body_template, footer_text, signatory_block, disclaimer, required_fields, optional_fields, validity_days, effective_date, is_active, created_at, updated_at) VALUES
	('8524b87a-9f91-471a-b904-cef24c583e02', 'to_whom_it_may_concern', 'en', 1, 'approved', 'TO WHOM IT MAY CONCERN', 'United Arab Emirates University', 'This is to certify that:

{{student_name}}
Student ID: {{student_id}}

is currently enrolled at the United Arab Emirates University in the:

{{programme}}
{{college}}

for the {{academic_term}}.

The student is currently registered as an active student of the University.

This letter is issued upon the student''s request for whatever purpose it may serve.', 'United Arab Emirates University · Al Ain, United Arab Emirates', 'Office of the Registrar
United Arab Emirates University', 'Demonstration document — issued by the Sanadi demonstration environment. This document is not an officially signed or sealed UAEU record.', '["student_name", "student_id", "academic_term"]', '["programme", "college", "expected_graduation", "registered_credits", "campus"]', 90, '2026-08-27', 1, '2026-08-27 10:57:05.48782+00:00', '2026-08-27 10:57:05.48782+00:00'),
	('ebda0ff6-46f2-4087-864a-d369698aeac9', 'to_whom_it_may_concern', 'ar', 1, 'approved', 'إلى من يهمه الأمر', 'جامعة الإمارات العربية المتحدة', 'نفيد بأن الطالب/ة:

{{student_name}}
الرقم الجامعي: {{student_id}}

مقيد/ة حالياً في جامعة الإمارات العربية المتحدة في:

{{programme}}
{{college}}

للفصل الدراسي {{academic_term}}.

والطالب/ة مسجل/ة حالياً كطالب/ة منتظم/ة في الجامعة.

وقد أُعطيت له/لها هذه الشهادة بناءً على طلبه/ها دون أدنى مسؤولية على الجامعة.', 'جامعة الإمارات العربية المتحدة · العين، الإمارات العربية المتحدة', 'مكتب التسجيل
جامعة الإمارات العربية المتحدة', 'وثيقة توضيحية صادرة عن بيئة العرض التجريبي لسندي، وهي ليست وثيقة رسمية موقعة أو مختومة من الجامعة.', '["student_name", "student_id", "academic_term"]', '["programme", "college", "expected_graduation", "registered_credits", "campus"]', 90, '2026-08-27', 0, '2026-08-27 10:57:05.48782+00:00', '2026-08-27 10:57:05.590077+00:00'),
	('d969b2f0-0cf9-4876-a8ab-fd2cab21149f', 'to_whom_it_may_concern', 'ar', 2, 'approved', 'إلى من يهمه الأمر', 'جامعة الإمارات العربية المتحدة', 'تشهد جامعة الإمارات العربية المتحدة بأن الطالب/الطالبة:

{{student_name}}

الرقم الجامعي: {{student_id}}

مسجل/مسجلة حالياً في جامعة الإمارات العربية المتحدة في برنامج:

{{programme}}

بكلية:

{{college}}

وهو/هي طالب/طالبة مسجل/مسجلة حالياً في الجامعة للفصل الدراسي:

{{academic_term}}

وقد أُصدرت هذه الشهادة بناءً على طلب الطالب/الطالبة لتقديمها إلى من يهمه الأمر، دون أدنى مسؤولية على الجامعة.', 'جامعة الإمارات العربية المتحدة · العين، الإمارات العربية المتحدة · www.uaeu.ac.ae', 'مكتب التسجيل
قطاع شؤون الطلبة
جامعة الإمارات العربية المتحدة', 'وثيقة توضيحية صادرة عن بيئة العرض التجريبي لسندي، وهي ليست وثيقة رسمية موقعة أو مختومة من الجامعة.', '[]', '[]', 90, '2026-08-27', 1, '2026-08-27 10:57:05.616065+00:00', '2026-08-27 10:57:05.616065+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: email_templates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[email_templates] (id, template_code, name_en, name_ar, subject_en, subject_ar, body_en, body_ar, cta_label_en, cta_label_ar, severity, enabled, version, effective_from, effective_to, created_at, updated_at) VALUES
	('25874b9f-e326-4a8c-a743-a01318cefb42', 'student_action_required', 'Student action required', 'مطلوب إجراء من الطالب', 'Action Required — Your Sanadi Request', 'مطلوب إجراء — طلبك في سندي', 'Hello {{recipient_name}},

Sanadi needs your action to continue your request:

**{{service_name}}**

{{action_summary}}

Please sign in to Sanadi to review and continue.', 'مرحباً {{recipient_name}}،

يحتاج سندي إلى إجراء منك لمتابعة طلبك:

**{{service_name}}**

{{action_summary}}

يرجى تسجيل الدخول إلى سندي للمراجعة والمتابعة.', 'Open Sanadi', 'فتح سندي', 'important', 1, 1, '2026-08-27 10:57:06.873535+00:00', NULL, '2026-08-27 10:57:06.873535+00:00', '2026-08-27 10:57:06.873535+00:00'),
	('dc641e22-8f99-42a4-a618-d0801edbc37b', 'student_update', 'Student service update', 'تحديث خدمة الطالب', '{{headline}} — Sanadi', '{{headline}} — سندي', 'Hello {{recipient_name}},

{{message}}

You can review the full details in Sanadi.', 'مرحباً {{recipient_name}}،

{{message}}

يمكنك مراجعة التفاصيل كاملة في سندي.', 'View in Sanadi', 'عرض في سندي', 'important', 1, 1, '2026-08-27 10:57:06.873535+00:00', NULL, '2026-08-27 10:57:06.873535+00:00', '2026-08-27 10:57:06.873535+00:00'),
	('b60b7a95-96d6-4671-b850-fb72cbc7b7c7', 'owner_action_required', 'Service owner action required', 'مطلوب إجراء من مالك الخدمة', 'Action Required — {{service_name}}', 'مطلوب إجراء — {{service_name}}', 'Hello {{recipient_name}},

A Sanadi case requires your attention.

Case: {{case_number}}

Reason: {{attention_reason}}

SLA Status: {{sla_status}}', 'مرحباً {{recipient_name}}،

هناك حالة في سندي تتطلب انتباهك.

رقم الحالة: {{case_number}}

السبب: {{attention_reason}}

حالة مستوى الخدمة: {{sla_status}}', 'Review Case', 'مراجعة الحالة', 'critical', 1, 1, '2026-08-27 10:57:06.873535+00:00', NULL, '2026-08-27 10:57:06.873535+00:00', '2026-08-27 10:57:06.873535+00:00'),
	('4664f509-a663-4598-bacb-e9c13593825b', 'owner_daily_digest', 'Service owner daily digest', 'الملخص اليومي لمالك الخدمة', 'Sanadi Daily Service Summary — {{unit_name}}', 'ملخص سندي اليومي للخدمة — {{unit_name}}', 'Hello {{recipient_name}},

Here is today''s summary for **{{unit_name}}**:

{{summary_lines}}

Open Sanadi to action these items.', 'مرحباً {{recipient_name}}،

إليك ملخص اليوم لـ **{{unit_name}}**:

{{summary_lines}}

افتح سندي لاتخاذ الإجراءات اللازمة.', 'Open Workspace', 'فتح مساحة العمل', 'normal', 1, 1, '2026-08-27 10:57:06.873535+00:00', NULL, '2026-08-27 10:57:06.873535+00:00', '2026-08-27 10:57:06.873535+00:00'),
	('a4a06d61-18c4-458f-93cd-ef950433d13e', 'admin_operational_alert', 'Administrator operational alert', 'تنبيه تشغيلي للمسؤول', 'Sanadi Operational Alert — {{headline}}', 'تنبيه تشغيلي في سندي — {{headline}}', 'Hello {{recipient_name}},

An operational condition requires administrator attention.

{{message}}

Severity: {{severity}}', 'مرحباً {{recipient_name}}،

هناك حالة تشغيلية تتطلب انتباه المسؤول.

{{message}}

مستوى الخطورة: {{severity}}', 'Open Operations', 'فتح لوحة التشغيل', 'critical', 1, 1, '2026-08-27 10:57:06.873535+00:00', NULL, '2026-08-27 10:57:06.873535+00:00', '2026-08-27 10:57:06.873535+00:00'),
	('7c12610b-4b7d-4e50-a7b3-f179faace97f', 'emergency_alert', 'Emergency university alert', 'تنبيه جامعي طارئ', 'Important University Alert — {{alert_title}}', 'تنبيه جامعي مهم — {{alert_title}}', '{{approved_emergency_message}}

For the latest information, please open Sanadi or follow the official university instructions.', '{{approved_emergency_message}}

للحصول على آخر المعلومات، يرجى فتح سندي أو اتباع تعليمات الجامعة الرسمية.', 'View Alert', 'عرض التنبيه', 'emergency', 1, 1, '2026-08-27 10:57:06.873535+00:00', NULL, '2026-08-27 10:57:06.873535+00:00', '2026-08-27 10:57:06.873535+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: emergency_contacts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[emergency_contacts] (id, code, label_en, label_ar, description_en, description_ar, phone, url, kind, sort_order, is_active, created_at, updated_at, category_en, category_ar, emergency_type_en, emergency_type_ar, responsible_unit_en, responsible_unit_ar, mobile_number, emergency_number, email, notes_en, notes_ar, keywords, priority) VALUES
	('46f78002-d04e-4cc7-88e7-01dc1a748e30', 'national_emergency', 'National emergency (UAE)', 'الطوارئ الوطنية (الإمارات)', 'Police, ambulance and fire — immediate danger to life, health or safety.', 'الشرطة والإسعاف والدفاع المدني — الخطر المباشر على الحياة أو الصحة أو السلامة.', '999', NULL, 'national', 10, 1, '2026-08-27 10:57:05.867531+00:00', '2026-08-27 10:57:05.867531+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', 100),
	('b14bb693-08d0-425b-abee-edca150d4c3d', 'national_ambulance', 'Ambulance', 'الإسعاف', 'Medical emergencies requiring an ambulance.', 'الحالات الطبية الطارئة التي تتطلب سيارة إسعاف.', '998', NULL, 'national', 20, 1, '2026-08-27 10:57:05.867531+00:00', '2026-08-27 10:57:05.867531+00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', 100),
	('0845a348-05f7-4b78-bf18-3df6a79d1186', 'campus_health', 'Urgent Medical Help', 'الإسعاف الطبي العاجل', NULL, NULL, NULL, NULL, 'campus', 10, 1, '2026-09-10 17:00:22.577136+00:00', '2026-09-10 17:00:22.577136+00:00', 'Health Emergency', 'طوارئ صحية', 'Urgent medical emergency', 'حالة صحية طارئة', 'Urgent Medical Help', 'الإسعاف الطبي العاجل', '050 927 5824', '4004', NULL, NULL, NULL, '{medical,health,clinic,ambulance,injury,injured,bleeding,faint,fainted,unconscious,sick,ill,pain,doctor,nurse,breathing,allergic,seizure,heart,accident,طبي,صحية,صحي,إسعاف,مريض,مرض,إصابة,جرح,نزيف,إغماء,ألم,طبيب,تنفس,حساسية,حادث}', 10),
	('b780bfbe-7151-452d-95cc-912f0ccb85a5', 'campus_fire', 'Operations and Emergency Section', 'قسم العمليات والطوارئ', NULL, NULL, NULL, NULL, 'campus', 20, 1, '2026-09-10 17:00:22.577136+00:00', '2026-09-10 17:00:22.577136+00:00', 'General Emergency', 'طوارئ عامة', 'Fire / Fire alarm', 'حريق / إنذار حريق', 'Operations and Emergency Section', 'قسم العمليات والطوارئ', NULL, '6888', 'OES@uaeu.ac.ae', NULL, NULL, '{fire,smoke,burning,flame,"fire alarm",alarm,evacuate,evacuation,explosion,"gas leak",حريق,دخان,نار,إنذار,اشتعال,إخلاء,انفجار,"تسرب غاز"}', 10),
	('ed5263a6-29f4-4639-88ff-0d3d6065f73f', 'campus_maintenance', 'Khadamat', 'خدمات', NULL, NULL, NULL, NULL, 'campus', 30, 1, '2026-09-10 17:00:22.577136+00:00', '2026-09-10 17:00:22.577136+00:00', 'Maintenance', 'صيانة', 'Electricity / Water / Air Conditioning / Faults', 'كهرباء / مياه / تكييف / أعطال', 'Khadamat', 'خدمات', NULL, '8000', 'servicedesk@khadamat.ae', NULL, NULL, '{maintenance,electricity,power,"power cut",light,lights,water,leak,leaking,plumbing,"air conditioning",ac,a/c,aircon,cooling,heater,fault,broken,"not working",elevator,lift,toilet,sink,drain,صيانة,كهرباء,"انقطاع الكهرباء",إنارة,مياه,ماء,تسرب,تسريب,سباكة,تكييف,مكيف,تبريد,عطل,أعطال,معطل,"لا يعمل",مصعد,حمام,مغسلة}', 20),
	('0679a87a-43c0-4d16-94e3-85a0380970af', 'campus_security', 'FMD — Security and Lost & Found', 'إدارة المرافق — الأمن والمفقودات', NULL, NULL, NULL, NULL, 'campus', 40, 1, '2026-09-10 17:00:22.577136+00:00', '2026-09-10 17:00:22.577136+00:00', 'Security', 'أمن', 'Security incidents / Lost property', 'حوادث أمنية / فقدان ممتلكات', 'FMD', 'إدارة المرافق', NULL, '4488', 'LostNFound@uaeu.ac.ae', NULL, NULL, '{security,guard,theft,stolen,steal,robbery,lost,missing,"lost property","lost and found",wallet,phone,bag,laptop,keys,"id card",suspicious,intruder,"harassment on campus",vandalism,أمن,حارس,سرقة,مسروق,فقدت,فقدان,ضائع,مفقود,محفظة,هاتف,جوال,حقيبة,مفاتيح,بطاقة,مشبوه,تخريب,ممتلكات}', 20);
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: escalation_policies; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: follow_up_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[follow_up_policies] (id, entity_type, case_type, service_unit_id, waiting_state, first_reminder_after_hours, second_reminder_after_hours, final_reminder_after_hours, escalation_after_hours, notify_student, notify_owner, notify_manager, maximum_reminders, is_active, created_at, updated_at) VALUES
	('a88e2312-a28d-47e9-8d13-7a470a67a280', 'case', NULL, NULL, 'awaiting_student', 48, 120, 192, 240, 1, 1, 0, 3, 1, '2026-08-27 10:57:04.887288+00:00', '2026-08-27 10:57:04.887288+00:00'),
	('ed574e8d-a3de-4938-84d3-dd81ccc3c628', 'case', NULL, NULL, 'awaiting_internal_action', 24, 72, 120, 168, 0, 1, 1, 3, 1, '2026-08-27 10:57:04.887288+00:00', '2026-08-27 10:57:04.887288+00:00'),
	('fd8e85b5-3803-4a13-a0bc-7fa6d41fe26b', 'case', NULL, NULL, 'awaiting_approval', 24, 48, 72, 96, 0, 1, 1, 3, 1, '2026-08-27 10:57:04.887288+00:00', '2026-08-27 10:57:04.887288+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: housing_eligibility_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[housing_eligibility_rules] (id, rule_name, description_en, description_ar, condition_type, condition_value, mandatory, effective_date, expiry_date, priority, is_active, created_at, updated_at) VALUES
	('005381db-f910-4018-ad20-a09ee3255ed3', 'active_enrollment', 'Student must have active enrollment.', 'يجب أن يكون الطالب مسجلاً بشكل فعّال.', 'enrollment', '{"account_status": "active"}', 1, '2026-08-27', NULL, 10, 1, '2026-08-27 10:57:05.01998+00:00', '2026-08-27 10:57:05.01998+00:00'),
	('a3717971-485f-49ce-bdac-f772ac62b08e', 'no_active_allocation', 'Student must not already have an active hostel allocation.', 'يجب ألا يكون لدى الطالب تخصيص سكن فعّال.', 'allocation', '{"max_active": 0}', 1, '2026-08-27', NULL, 20, 1, '2026-08-27 10:57:05.01998+00:00', '2026-08-27 10:57:05.01998+00:00'),
	('c5071bdd-3c75-49d3-9955-8f2c2edbe99e', 'no_disciplinary_restriction', 'Student must not have an unresolved housing disciplinary restriction.', 'يجب ألا يكون على الطالب قيد تأديبي غير محلول متعلق بالسكن.', 'restriction', '{"allowed": false}', 1, '2026-08-27', NULL, 30, 1, '2026-08-27 10:57:05.01998+00:00', '2026-08-27 10:57:05.01998+00:00'),
	('a1145a3f-c128-444f-8136-f96ccd1644ad', 'no_outstanding_balance', 'Student must not have an outstanding housing balance above the configured threshold.', 'يجب ألا يتجاوز رصيد السكن غير المسدد الحد المسموح.', 'balance', '{"threshold": 0}', 1, '2026-08-27', NULL, 40, 1, '2026-08-27 10:57:05.01998+00:00', '2026-08-27 10:57:05.01998+00:00'),
	('deeba98b-6f6b-48ca-9909-fcc3b50ac8a5', 'residency_priority', 'Priority may be given to students whose residency status qualifies for university housing.', 'قد تُمنح الأولوية للطلبة الذين تؤهلهم حالة إقامتهم للسكن الجامعي.', 'residency', '{"qualifying": ["non_local", "off_campus", "on_campus"]}', 0, '2026-08-27', NULL, 50, 1, '2026-08-27 10:57:05.01998+00:00', '2026-08-27 10:57:05.01998+00:00'),
	('50742184-273e-4305-bdbc-75c440008d26', 'accept_housing_terms', 'Student must accept housing terms before registration is finalized.', 'يجب على الطالب قبول شروط السكن قبل استكمال التسجيل.', 'terms', '{"required": true}', 1, '2026-08-27', NULL, 60, 1, '2026-08-27 10:57:05.01998+00:00', '2026-08-27 10:57:05.01998+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: internship_matching_weights; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[internship_matching_weights] (id, version, programme_fit_weight, skills_course_weight, gpa_weight, location_weight, preference_weight, other_weight, effective_from, approved_by, is_active, created_at) VALUES
	('7624b462-5380-4c31-96c6-9d6eb09f1dd4', 1, 35.00, 25.00, 15.00, 10.00, 10.00, 5.00, '2026-08-27 10:57:05.073365+00:00', NULL, 1, '2026-08-27 10:57:05.073365+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: knowledge_document_categories; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: library_provider_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[library_provider_settings] (id, provider_key, provider_name, base_url, auth_method, auth_header_name, auth_query_param, api_key_secret_name, extra_headers, search_path, item_path, availability_path, location_path, eaccess_path, catalogue_url_template, query_param_map, response_map, timeout_ms, max_retries, enabled, health_status, last_success_at, last_error, last_error_at, last_latency_ms, created_at, updated_at) VALUES
	('47df26a6-8eb8-48c2-a584-85a362003517', 'library_search', 'OCLC WorldCat Discovery', 'https://americas.discovery.api.oclc.org/worldcat/search/v2', 'basic_client_credentials', 'X-API-Key', NULL, 'LIBRARY_API_KEY', '{}', '/brief-bibs', '/bibs/{id}', NULL, NULL, NULL, 'https://search.worldcat.org/title/{id}', '{}', '{}', 8000, 1, 1, 'healthy', '2026-09-08 12:08:20.735+00:00', NULL, NULL, 2787, '2026-08-27 10:57:06.331365+00:00', '2026-08-27 10:57:06.357639+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: model_routing_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[model_routing_rules] (id, task_type, complexity_level, preferred_provider, preferred_model, fallback_model, maximum_input_tokens, maximum_output_tokens, timeout_ms, is_active, created_at, updated_at) VALUES
	('40d6c156-c439-453d-8cf8-7a26b80ea74d', 'supervisor', 'complex', 'lovable', 'google/gemini-3.6-flash', 'google/gemini-3.6-flash', 8000, 1500, 20000, 1, '2026-08-27 10:57:05.257788+00:00', '2026-08-27 10:57:05.257788+00:00'),
	('2d986a07-0220-4798-a26c-0b20c5d7b9af', 'orchestration', 'simple', 'lovable', 'google/gemini-3.7-flash', 'google/gemini-3.6-flash', 8000, 1500, 20000, 1, '2026-08-27 10:57:05.257788+00:00', '2026-08-27 10:57:07.006741+00:00'),
	('42476f72-29d2-463e-a80c-c55a9d53c499', 'supervisor', 'simple', 'lovable', 'google/gemini-3.7-flash', 'google/gemini-3.6-flash', 8000, 1200, 15000, 1, '2026-08-27 10:57:05.257788+00:00', '2026-08-27 10:57:07.006741+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: notification_event_types; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[notification_event_types] (event_type, name_en, name_ar, severity, category, audience, email_enabled, student_optional, digest_eligible, admin_group_code, template_code, throttle_seconds, enabled, created_at, updated_at) VALUES
	('STUDENT_ACTION_REQUIRED', 'Action required', 'مطلوب إجراء', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_action_required', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('CASE_CREATED', 'Request submitted', 'تم إرسال الطلب', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 60, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('CASE_RESOLVED', 'Request resolved', 'تم حل الطلب', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('CASE_REOPENED', 'Request reopened', 'إعادة فتح الطلب', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('CASE_ESCALATED', 'Request escalated', 'تصعيد الطلب', 'important', 'service_updates', 'student', 1, 1, 0, NULL, 'student_update', 300, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('COMPLAINT_RESPONSE_AVAILABLE', 'Complaint response available', 'رد على الشكوى متاح', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('SUGGESTION_DECISION', 'Suggestion decision', 'قرار بشأن الاقتراح', 'important', 'service_updates', 'student', 1, 1, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('INTERNSHIP_PLACEMENT_OFFERED', 'Internship placement offered', 'عرض تدريب', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('INTERNSHIP_CONFIRMATION_REQUIRED', 'Internship confirmation required', 'مطلوب تأكيد التدريب', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_action_required', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('INTERNSHIP_CLEARANCE_REQUIRED', 'Internship clearance required', 'مطلوب تصريح حكومي', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_action_required', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('INTERNSHIP_FINALIZED', 'Internship finalised', 'اعتماد التدريب', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('HOUSING_ALLOCATION_OFFERED', 'Housing allocation offered', 'عرض سكن', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('HOUSING_CONFIRMED', 'Housing confirmed', 'تأكيد السكن', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('TRANSFER_WINDOW_OPEN', 'Transfer window open', 'فتح باب التحويل', 'normal', 'reminders', 'student', 1, 1, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('TRANSFER_CONFIRMATION_REQUIRED', 'Transfer confirmation required', 'مطلوب تأكيد التحويل', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_action_required', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('TRANSFER_COMPLETED', 'Transfer completed', 'اكتمال التحويل', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('APPOINTMENT_BOOKED', 'Appointment booked', 'تم حجز الموعد', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('APPOINTMENT_CHANGED', 'Appointment changed', 'تغيير الموعد', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('APPOINTMENT_CANCELLED', 'Appointment cancelled', 'إلغاء الموعد', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('APPOINTMENT_REMINDER', 'Appointment reminder', 'تذكير بالموعد', 'normal', 'reminders', 'student', 1, 1, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('DOCUMENT_READY', 'Document ready', 'المستند جاهز', 'important', 'service_updates', 'student', 1, 0, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('CAREER_REPORT_READY', 'Career report ready', 'تقرير المسار المهني جاهز', 'normal', 'career', 'student', 1, 1, 0, NULL, 'student_update', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('OWNER_APPROVAL_REQUIRED', 'Owner approval required', 'مطلوب اعتماد المالك', 'critical', 'owner_action', 'owner', 1, 0, 0, NULL, 'owner_action_required', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('OWNER_DECISION_REQUIRED', 'Owner decision required', 'مطلوب قرار المالك', 'critical', 'owner_action', 'owner', 1, 0, 0, NULL, 'owner_action_required', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('OWNER_CASE_WAITING', 'Case waiting for owner', 'حالة بانتظار المالك', 'normal', 'owner_action', 'owner', 0, 0, 1, NULL, 'owner_daily_digest', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('SLA_WARNING', 'SLA warning', 'تحذير مستوى الخدمة', 'important', 'owner_action', 'owner', 1, 0, 1, NULL, 'owner_action_required', 900, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('SLA_CRITICAL', 'SLA critical', 'مستوى الخدمة حرج', 'critical', 'owner_action', 'owner', 1, 0, 0, NULL, 'owner_action_required', 600, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('SLA_BREACHED', 'SLA breached', 'خرق مستوى الخدمة', 'critical', 'owner_action', 'owner_manager', 1, 0, 0, NULL, 'owner_action_required', 600, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('SEVERE_SLA_ESCALATION', 'Severe SLA escalation', 'تصعيد حاد لمستوى الخدمة', 'critical', 'admin_ops', 'admin', 1, 0, 0, 'ops_admins', 'admin_operational_alert', 1800, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('SYSTEM_MAJOR_OUTAGE', 'Major service outage', 'انقطاع كبير في الخدمة', 'critical', 'admin_ops', 'admin', 1, 0, 0, 'ops_admins', 'admin_operational_alert', 1800, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('INTEGRATION_CRITICAL_FAILURE', 'Critical integration failure', 'فشل حرج في التكامل', 'critical', 'admin_ops', 'admin', 1, 0, 0, 'ops_admins', 'admin_operational_alert', 1800, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('EMAIL_DELIVERY_FAILURE', 'Email delivery failure', 'فشل إرسال البريد', 'critical', 'admin_ops', 'admin', 1, 0, 0, 'ops_admins', 'admin_operational_alert', 3600, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00'),
	('EMERGENCY_ALERT', 'Emergency alert', 'تنبيه طارئ', 'emergency', 'emergency', 'broadcast', 1, 0, 0, 'emergency_admins', 'emergency_alert', 0, 1, '2026-08-27 10:57:06.902246+00:00', '2026-08-27 10:57:06.902246+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: notification_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[notification_settings] (id, emails_enabled, public_app_url, sender_name, demo_email_mode, demo_redirect_email, digest_enabled, digest_hour, max_retries, batch_size, updated_at) VALUES
	(1, 1, 'https://sanadi.online', 'Sanadi', 1, NULL, 1, 7, 3, 25, '2026-08-27 10:57:06.792192+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: notification_templates; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: performance_budgets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: quality_targets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: routing_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[routing_rules] (id, rule_name, priority, conditions, target_unit_id, target_role, target_staff_id, requires_human_review, assignment_method, is_active, created_at, updated_at) VALUES
	('98333931-2731-4a81-85f4-c786c51ac1bd', 'Housing — allocation and hostel life', 15, '{"routing_service_code": "housing"}', 'e6c1d21b-344e-4f15-b82a-5f1fbdebed7e', NULL, NULL, 0, 'lowest_workload', 1, '2026-08-27 10:57:06.487598+00:00', '2026-08-27 10:57:06.487598+00:00'),
	('33c5656c-44d8-4689-8a6a-ac0353a7ddc3', 'Registration blocked — financial hold', 20, '{"root_cause_code": "financial_hold", "routing_service_code": "registration"}', '91099417-211e-4e93-bb80-9fd23e5816b4', NULL, NULL, 0, 'lowest_workload', 1, '2026-08-27 10:57:06.513352+00:00', '2026-08-27 10:57:06.513352+00:00'),
	('5561fefe-ebe0-4bee-97d1-77cef7352eba', 'Registration blocked — academic restriction', 21, '{"root_cause_code": "academic_hold", "routing_service_code": "registration"}', '5b068129-ab6c-4722-a898-7958cab97930', NULL, NULL, 0, 'lowest_workload', 1, '2026-08-27 10:57:06.539042+00:00', '2026-08-27 10:57:06.539042+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

BEGIN TRY
--
-- Data for Name: university_services; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO [dbo].[university_services] (id, service_unit_id, code, name_en, name_ar, description_en, description_ar, category, target_audience, authentication_required, estimated_processing_days, service_level_hours, allows_online_submission, allows_agent_submission, requires_human_approval, risk_level, instructions_en, instructions_ar, is_active, created_at, updated_at) VALUES
	('860f79a1-fc4a-43b6-85e6-63ffb648c21f', 'd4d176f7-e9c7-4d74-8b9d-96ce12d8c711', 'SVC-CAREER-COUNSEL', 'Career counselling', 'الإرشاد المهني', 'CV analysis, career matching and skill gap guidance.', 'تحليل السيرة الذاتية ومطابقة المسارات المهنية.', 'career', 'students', 1, 3, 72, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:57:05.91871+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('8a9bafa9-2b25-46ca-9ef6-b21412991d08', 'd4d176f7-e9c7-4d74-8b9d-96ce12d8c711', 'SVC-GENERAL-QUERY', 'General query', 'استفسار عام', 'Ask Sanadi anything about university services.', 'اسأل سندي عن أي خدمة جامعية.', 'general', 'students', 1, 3, 72, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:57:05.91871+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('b2435027-27ce-43e4-b78f-769267334fd3', '5b068129-ab6c-4722-a898-7958cab97930', 'SVC-ENROL-VERIFY', 'Enrolment verification letter', 'إفادة قيد', 'Official proof of current enrolment.', 'إثبات رسمي للقيد الحالي.', 'documents', 'students', 1, 1, 24, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('714ee709-3db8-4e15-a3a9-2e165554b119', 'd4d176f7-e9c7-4d74-8b9d-96ce12d8c711', 'SVC-TRANSCRIPT', 'Official transcript request', 'طلب كشف درجات رسمي', 'Request a sealed official transcript.', 'طلب كشف درجات رسمي مختوم.', 'documents', 'students', 1, 3, 72, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('b1cc0a6a-128a-4029-b2f7-b55406eb185e', '00121099-315d-417e-8d02-c4c2abbc5e06', 'SVC-ADVISING-APPT', 'Academic advising appointment', 'موعد إرشاد أكاديمي', 'Book a session with an academic advisor.', 'حجز جلسة مع مرشد أكاديمي.', 'appointments', 'students', 1, 1, 48, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('cc41f8c5-6a1e-4aa0-b9a4-f1343df86bc3', 'e6c1d21b-344e-4f15-b82a-5f1fbdebed7e', 'HOUSING-REG', 'Student Housing Registration', 'التسجيل في السكن الطلابي', 'Register for a place in university student housing. Standard eligible applications are completed immediately; exceptions are referred for human approval.', 'التسجيل للحصول على مكان في السكن الجامعي. تُنجز الطلبات المؤهلة القياسية فوراً، وتُحال الاستثناءات للموافقة البشرية.', 'housing', 'students', 1, 0, 24, 1, 1, 0, 'level_2', 'The assistant checks your eligibility and hostel availability, proposes a room and registers you after your explicit confirmation.', 'يتحقق المساعد من أهليتك ومن توفر السكن، ويقترح غرفة ويسجلك بعد تأكيدك الصريح.', 0, '2026-08-27 10:57:04.940729+00:00', '2026-08-27 11:44:04.37117+00:00'),
	('9ec56509-0a4c-48e1-b6c0-ae7f8c05abfc', '00121099-315d-417e-8d02-c4c2abbc5e06', 'SVC-TRANSFER-ICT', 'Inter-college programme transfer', 'التحويل بين الكليات', 'Apply to transfer to another college programme.', 'التقديم للتحويل إلى برنامج في كلية أخرى.', 'academic', 'students', 1, 10, 240, 1, 1, 1, 'level_1', NULL, NULL, 0, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 11:44:04.37117+00:00'),
	('de55c9b9-f543-4c6c-959e-72a4adcf2025', 'd4d176f7-e9c7-4d74-8b9d-96ce12d8c711', 'SVC-DOC-TWIMC', 'To whom it may concern letter', 'شهادة إلى من يهمه الأمر', 'Verified enrolment letter in English or Arabic.', 'خطاب إثبات قيد معتمد بالعربية أو الإنجليزية.', 'records', 'students', 1, 0, 0, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:57:05.91871+00:00', '2026-08-27 14:37:39.909508+00:00'),
	('6c802090-3215-4680-b50c-61ed3974b52e', 'd1de7e13-18a9-4f26-9347-275275703c96', 'SVC-IT-SUPPORT', 'IT support request', 'طلب دعم تقني', 'Report an account, network or system issue.', 'الإبلاغ عن مشكلة في الحساب أو الشبكة أو النظام.', 'support', 'students', 1, 2, 24, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('dff70469-1ed3-42ef-b5d6-3aaab98f2935', '8148f18f-f490-418a-95b6-613febe31259', 'SVC-LIB-SUPPORT', 'Library support request', 'طلب دعم المكتبة', 'Borrowing, study room and research help.', 'الإعارة وقاعات الدراسة ودعم البحث.', 'support', 'students', 1, 2, 48, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('d203581e-1549-45ec-b743-0c6f73aa5a0c', '31d33a09-dc8d-42a8-a08b-cf50cc4a13c9', 'SVC-TRANSPORT', 'Transportation request', 'طلب خدمة النقل', 'Bus route, schedule and transport enquiries.', 'استفسارات خطوط الحافلات والجداول والنقل.', 'support', 'students', 1, 3, 72, 1, 1, 0, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('abf5cfa1-1d1c-422e-8ab6-e6a06d9ce8ec', '91099417-211e-4e93-bb80-9fd23e5816b4', 'SVC-FEES', 'Fees and payment support', 'دعم الرسوم والدفع', 'Payment plans, holds and invoice questions.', 'خطط السداد والإيقافات واستفسارات الفواتير.', 'finance', 'students', 1, 3, 72, 1, 1, 1, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('68c567b6-6cc2-4481-9e50-cbe87b3bd2c5', '3c4d4404-2255-4c4d-baea-99c69eae5904', 'SVC-ACCESSIBILITY', 'Accessibility support request', 'طلب دعم إمكانية الوصول', 'Request accommodations and accessibility services.', 'طلب التسهيلات وخدمات إمكانية الوصول.', 'support', 'students', 1, 5, 120, 1, 1, 1, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('cd5168b2-7e66-49cc-b239-0f7b07ffb92f', '3cfe0883-9559-4382-9d66-13194265e01c', 'SVC-COMPLAINT', 'Student complaint', 'شكوى طالب', 'Submit a formal complaint for review.', 'تقديم شكوى رسمية للمراجعة.', 'complaints', 'students', 1, 5, 120, 1, 1, 1, 'level_1', NULL, NULL, 1, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 10:59:32.588807+00:00'),
	('98be0c54-bb3a-44d2-a748-8951ade9a575', '695adb9d-ec24-445d-a1fb-687641ce1c7b', 'SVC-INTERNSHIP', 'Internship placement request', 'طلب تدريب عملي', 'Apply for an internship placement.', 'التقديم على فرصة تدريب عملي.', 'career', 'students', 1, 7, 168, 1, 1, 1, 'level_1', NULL, NULL, 0, '2026-08-27 10:59:26.39664+00:00', '2026-08-27 11:44:04.37117+00:00'),
	('6c43372e-8268-4d34-b4f2-6e0f0b879b94', NULL, 'SVC-CAMPUS-ENTRY', 'Campus entry permit (proactive)', 'تصريح دخول الحرم الجامعي (خدمة استباقية)', 'This service is now proactive. You do not need to submit a separate request. Simply proceed to the designated parking area and use your UAEU ID to access/open the gate.', 'أصبحت هذه الخدمة استباقية، ولا تحتاج إلى تقديم طلب منفصل. يمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات لفتح البوابة والدخول.', 'proactive', 'students', 0, 0, 72, 0, 0, 0, 'level_1', 'This service is now proactive. You do not need to submit a separate request. Simply proceed to the designated parking area and use your UAEU ID to access/open the gate.', 'أصبحت هذه الخدمة استباقية، ولا تحتاج إلى تقديم طلب منفصل. يمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات لفتح البوابة والدخول.', 1, '2026-09-10 19:45:41.332731+00:00', '2026-09-10 19:45:41.332731+00:00');
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
END CATCH;
GO

--
-- PostgreSQL database dump complete
--



-- Remove every pointer to a person: this seed ships no staff or student rows.
UPDATE [dbo].service_units SET primary_service_owner_id = NULL WHERE primary_service_owner_id IS NOT NULL;
GO

UPDATE [dbo].routing_rules SET target_staff_id = NULL WHERE target_staff_id IS NOT NULL;
GO

COMMIT;
GO


-- ========== FUNCTIONS / VIEWS / TRIGGERS (reference only) ==========
-- Original PostgreSQL routine logic is preserved below as comments.
-- SQL Server cannot execute plpgsql; tables/seed above are the runnable schema.

-- ========== FUNCTIONS / PROCEDURES ==========

-- SET XACT_ABORT OFF;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_case_monitor](
--   @_search nvarchar(450) = NULL,
--   @_unit uniqueidentifier = NULL,
--   @_type nvarchar(450) = NULL,
--   @_status nvarchar(450) = NULL,
--   @_sla nvarchar(450) = NULL,
--   @_actor nvarchar(450) = NULL,
--   @_escalation nvarchar(450) = NULL,
--   @_priority nvarchar(450) = NULL,
--   @_owner uniqueidentifier = NULL,
--   @_view nvarchar(450) = N'open',
--   @_since datetimeoffset = NULL,
--   @_sort nvarchar(450) = N'risk',
--   @_page int = 1,
--   @_page_size int = 25
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_total bigint;
--   DECLARE @@_items nvarchar(max);
--   DECLARE @@_offset int = GREATEST(0, (COALESCE(@_page,1) - 1) * LEAST(GREATEST(COALESCE(@_page_size,25),5),100));
--   DECLARE @@_limit int = LEAST(GREATEST(COALESCE(@_page_size,25),5),100);
--   DECLARE @@_pattern nvarchar(450) = CASE WHEN COALESCE(LEN(trim(@_search)),0) >= 2;
--   DECLARE @THEN '%' || replace(replace(trim(@_search), '%',' '), '@_',' ') || '%' END;

--   IF  @_uid IS NULL OR NOT [dbo].[can_monitor_cases](@_uid) BEGIN
--     THROW 50000, 'Not authorised for case monitoring', 1;
--   END
--   SET @_all = [dbo].[can_monitor_all_units](@_uid);

--   WITH scoped AS (
--     SELECT v.* FROM [dbo].[case_monitor_v] v
--      WHERE (@_all OR v.service_unit_id IN (SELECT service_unit_id FROM [dbo].[case_monitor_units](@_uid)))
--        AND (@_unit IS NULL OR v.service_unit_id = @_unit)
--        AND (@_type IS NULL OR @_type = 'all' OR v.case_type = @_type)
--        AND (@_priority IS NULL OR @_priority = 'all' OR v.urgency = @_priority OR v.severity = @_priority)
--        AND (@_owner IS NULL OR v.assigned_to = @_owner)
--        AND (@_since IS NULL OR v.created_at >= @_since)
--        AND (@_actor IS NULL OR @_actor = 'all' OR v.actor = @_actor)
--        AND (@_sla IS NULL OR @_sla = 'all' OR v.sla_status = @_sla)
--        AND (@_status IS NULL OR @_status = 'all' OR v.status = @_status)
--        AND (@_escalation IS NULL OR @_escalation = 'all'
--             OR (@_escalation = 'none' AND COALESCE(v.escalation_level,0) = 0)
--             OR (@_escalation = 'escalated' AND COALESCE(v.escalation_level,0) > 0)
--             OR (@_escalation = 'unresolved' AND v.escalation_unresolved))
--        AND (
--          CASE COALESCE(@_view,'open')
--            WHEN 'all' THEN 1
--            WHEN 'open' THEN NOT v.is_closed
--            WHEN 'intervention' THEN NOT v.is_closed AND (
--                 v.sla_status IN ('breached','critical') OR v.response_overdue
--                 OR v.escalation_unresolved OR v.stalled OR v.critical_alert
--                 OR COALESCE(v.reopened_count,0) >= 2)
--            WHEN 'complaints' THEN v.case_type = 'complaint' AND NOT v.is_closed
--            WHEN 'suggestions' THEN v.case_type = 'suggestion' AND NOT v.is_closed
--            WHEN 'alerts' THEN v.case_type = 'alert' AND NOT v.is_closed
--            WHEN 'reopened' THEN COALESCE(v.reopened_count,0) > 0
--            WHEN 'closure' THEN v.closure_incomplete
--            ELSE NOT v.is_closed
--          END)
--        AND (@_pattern IS NULL OR (
--               v.case_number LIKE @_pattern OR v.title LIKE @_pattern
--               OR COALESCE(v.student_name,'') LIKE @_pattern
--               OR COALESCE(v.student_number,'') LIKE @_pattern
--               OR COALESCE(v.owner_name,'') LIKE @_pattern
--               OR COALESCE(v.unit_name_en,'') LIKE @_pattern
--               OR COALESCE(v.unit_name_ar,'') LIKE @_pattern
--               OR COALESCE(v.routing_service_code,'') LIKE @_pattern))
--   ), ranked AS (
--     SELECT s.*,
--            CASE WHEN s.critical_alert THEN 1
--                 WHEN s.sla_status = 'breached' THEN 2
--                 WHEN s.sla_status = 'critical' THEN 3
--                 WHEN s.response_overdue THEN 4
--                 WHEN s.escalation_unresolved THEN 5
--                 WHEN s.sla_status = 'attention' THEN 6
--                 WHEN s.stalled THEN 7
--                 ELSE 8 END AS risk_rank
--       FROM scoped s
--   ), counted AS (SELECT count(*) AS n FROM ranked)
--   SELECT (SELECT n FROM counted),
--          COALESCE((CONVERT(nvarchar(max), p) ORDER BY p.ord), N'[]')
--     INTO @_total, @_items
--     FROM (
--       SELECT r.*, row_number() OVER (
--         ORDER BY
--           CASE WHEN @_sort = 'risk' THEN r.risk_rank END ASC,
--           CASE WHEN @_sort = 'risk' THEN r.sla_due_at END ASC NULLS LAST,
--           CASE WHEN @_sort = 'waiting' THEN r.waiting_seconds END DESC,
--           CASE WHEN @_sort = 'due' THEN r.sla_due_at END ASC NULLS LAST,
--           CASE WHEN @_sort = 'updated' THEN r.last_activity_at END DESC NULLS LAST,
--           CASE WHEN @_sort = 'created' THEN r.created_at END DESC,
--           r.created_at ASC
--       ) AS ord
--       FROM ranked r
--       ORDER BY ord
--       OFFSET @_offset LIMIT @_limit
--     ) p;

--   RETURN (SELECT @_items AS [items], @_total AS [total], COALESCE(@_page,1) AS [page], @_limit AS [pageSize] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_case_monitor_detail](
--   @_case_id uniqueidentifier
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_row nvarchar(max);

--   IF  @_uid IS NULL OR NOT [dbo].[can_monitor_cases](@_uid) BEGIN
--     THROW 50000, 'Not authorised for case monitoring', 1;
--   END
--   SET @_all = [dbo].[can_monitor_all_units](@_uid);

--   SELECT @_row = CONVERT(nvarchar(max), v) FROM [dbo].[case_monitor_v] v
--    WHERE v.id = @_case_id
--      AND (@_all OR v.service_unit_id IN (SELECT service_unit_id FROM [dbo].[case_monitor_units](@_uid)));

--   IF  @_row IS NULL BEGIN
--     THROW 50000, 'Case not found in your monitoring scope', 1;
--   END
--   RETURN (SELECT @_row AS [case], COALESCE((
--       SELECT (jsonb_build_object(
--         'actor', h.actor, 'startedAt', h.started_at, 'endedAt', h.ended_at,
--         'durationSeconds', h.duration_seconds, 'unitId', h.service_unit_id, 'reason', h.reason)
--         ORDER BY h.started_at DESC)
--       FROM [dbo].[case_responsibility_history] h WHERE h.case_id = @_case_id), N'[]') AS [responsibility], COALESCE((
--       SELECT (jsonb_build_object('from', s.from_status, 'to', s.to_status, 'note', s.note, 'at', s.created_at)
--         ORDER BY s.created_at DESC)
--       FROM [dbo].[case_status_history] s WHERE s.case_id = @_case_id ), N'[]') AS [statusHistory], COALESCE((
--       SELECT (jsonb_build_object('type', e.event_type, 'threshold', e.threshold_percentage,
--         'at', e.triggered_at, 'acknowledgedAt', e.acknowledged_at, 'action', e.action_taken)
--         ORDER BY e.triggered_at DESC)
--       FROM [dbo].[case_sla_events] e WHERE e.case_id = @_case_id), N'[]') AS [slaEvents], COALESCE((
--       SELECT (jsonb_build_object('level', a.escalation_level, 'reason', a.reason,
--         'at', a.triggered_at, 'acknowledgedAt', a.acknowledged_at, 'resolvedAt', a.resolved_at)
--         ORDER BY a.triggered_at DESC)
--       FROM [dbo].[escalation_actions] a WHERE a.case_id = @_case_id), N'[]') AS [escalations], COALESCE((
--       SELECT (jsonb_build_object('type', o.action_type, 'reason', o.reason, 'at', o.created_at)
--         ORDER BY o.created_at DESC)
--       FROM [dbo].[case_oversight_actions] o WHERE o.case_id = @_case_id), N'[]') AS [oversight] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_case_monitor_summary](
  
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_out nvarchar(max);

--   IF  @_uid IS NULL OR NOT [dbo].[can_monitor_cases](@_uid) BEGIN
--     THROW 50000, 'Not authorised for case monitoring', 1;
--   END
--   SET @_all = [dbo].[can_monitor_all_units](@_uid);

--   SELECT @_out = (SELECT count(*) FILTER (WHERE NOT v.is_closed) AS [active], count(*) FILTER (WHERE NOT v.is_closed AND v.actor IN ('service_owner','specific_officer','manager','staff')) AS [pendingOwner], count(*) FILTER (WHERE v.response_overdue) AS [responseOverdue], count(*) FILTER (WHERE v.sla_status = 'attention') AS [attention], count(*) FILTER (WHERE v.sla_status = 'critical') AS [critical], count(*) FILTER (WHERE v.sla_status = 'breached') AS [breached], count(*) FILTER (WHERE v.sla_status = 'paused') AS [paused], count(*) FILTER (WHERE NOT v.is_closed AND COALESCE(v.escalation_level,0) > 0) AS [escalated], count(*) FILTER (WHERE NOT v.is_closed AND v.actor = 'student') AS [waitingStudent], count(*) FILTER (WHERE NOT v.is_closed AND v.actor = 'external_party') AS [waitingExternal], count(*) FILTER (WHERE NOT v.is_closed AND v.actor = 'ai') AS [aiHandling], count(*) FILTER (WHERE v.critical_alert) AS [criticalAlerts], count(*) FILTER (WHERE v.stalled) AS [stalled], count(*) FILTER (WHERE v.closure_incomplete) AS [closureIncomplete], count(*) FILTER (WHERE NOT v.is_closed AND v.case_type = 'complaint') AS [openComplaints], count(*) FILTER (WHERE NOT v.is_closed AND v.case_type = 'suggestion') AS [openSuggestions], count(*) FILTER (WHERE NOT v.is_closed AND COALESCE(v.reopened_count,0) > 0) AS [reopened], count(*) FILTER (WHERE v.created_at >= date_trunc('day', SYSDATETIMEOFFSET())) AS [todayHandled], count(*) FILTER (WHERE v.resolved_at >= date_trunc('day', SYSDATETIMEOFFSET())) AS [todayResolved] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
--   FROM [dbo].[case_monitor_v] v
--   WHERE (@_all OR v.service_unit_id IN (SELECT service_unit_id FROM [dbo].[case_monitor_units](@_uid)));

--   RETURN @_out;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_governance_overview](
  
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_new nvarchar(max) = array['draft','submitted','acknowledged','classified','routed','assigned'];
--   DECLARE @@_prog nvarchar(max) = array['in_progress','in_review','ai_processing','resolution_proposed','escalated','on_hold','waiting_external','reopened','transferred','awaiting_student','student_confirmation'];
--   DECLARE @@_result nvarchar(max);

--   SELECT @_all = [dbo].[can_monitor_all_units](@_uid);
--   IF  not coalesce(@_all, 0) BEGIN
--     THROW 50000, 'Not authorised for university-wide monitoring', 1;
--   END
--   with c as (
--     select * from [dbo].[cases] where deleted_at is null
--   ),
--   totals as (
--     select
--       count(*) as total,
--       count(*) filter (where case_type = 'query') as queries,
--       count(*) filter (where case_type = 'complaint') as complaints,
--       count(*) filter (where case_type = 'suggestion') as suggestions,
--       count(*) filter (where case_type = 'alert') as alerts,
--       count(*) filter (where case_type = 'service_request') as requests,
--       count(*) filter (where status = any(@_new)) as open_new,
--       count(*) filter (where status = any(@_prog)) as in_progress,
--       count(*) filter (where status = 'resolved') as resolved,
--       count(*) filter (where status = 'closed') as closed
--     from c
--   ),
--   perf as (
--     select
--       avg(DATEDIFF_BIG(SECOND, '19700101', (coalesce(resolved_at, closed_at) - created_at)) / 3600.0)
--         filter (where coalesce(resolved_at, closed_at) is not null) as avg_resolution_hours,
--       count(*) filter (
--         where status <> all(array['resolved','closed'])
--           and resolution_due_at is not null and resolution_due_at > SYSDATETIMEOFFSET() + interval '24 hours'
--       ) as within_sla,
--       count(*) filter (
--         where status <> all(array['resolved','closed'])
--           and resolution_due_at is not null
--           and resolution_due_at > SYSDATETIMEOFFSET() and resolution_due_at <= SYSDATETIMEOFFSET() + interval '24 hours'
--       ) as approaching_sla,
--       count(*) filter (
--         where status <> all(array['resolved','closed'])
--           and resolution_due_at is not null and resolution_due_at < SYSDATETIMEOFFSET()
--       ) as breached_sla,
--       count(*) filter (
--         where case_type = 'alert' and coalesce(severity,'') in ('critical','important')
--           and status <> all(array['resolved','closed'])
--       ) as critical_alerts
--     from c
--   ),
--   units as (
--     select
--       su.id as unit_id,
--       su.name_en, su.name_ar,
--       count(*) filter (where c.status = any(@_new  +  @_prog)) as open_cases,
--       count(*) filter (
--         where c.status <> all(array['resolved','closed'])
--           and c.resolution_due_at is not null and c.resolution_due_at < SYSDATETIMEOFFSET()
--       ) as breached,
--       count(*) filter (
--         where c.case_type = 'complaint' and c.status <> all(array['resolved','closed'])
--       ) as open_complaints,
--       count(*) filter (
--         where c.case_type = 'alert' and c.status <> all(array['resolved','closed'])
--       ) as open_alerts
--     from [dbo].[service_units] su
--     join c on c.service_unit_id = su.id
--     group by su.id, su.name_en, su.name_ar
--   ),
--   recent as (
--     select (x order by JSON_VALUE(x, '$.at') desc) as items from (
--       select (SELECT c.id AS [id], c.case_number AS [caseNumber], c.title AS [title], c.case_type AS [type], c.status AS [status], su.name_en AS [unitEn], su.name_ar AS [unitAr], coalesce(c.last_activity_at, c.updated_at, c.created_at) AS [at] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) as x
--       from c left join [dbo].[service_units] su on su.id = c.service_unit_id
--       order by coalesce(c.last_activity_at, c.updated_at, c.created_at) desc
      
--     ) s
--   )
--   select (SELECT (select CONVERT(nvarchar(max), t) from totals t) AS [totals], (select CONVERT(nvarchar(max), p) from perf p) AS [performance], coalesce((
--       select (CONVERT(nvarchar(max), u) order by u.breached desc, u.open_cases desc)
--       from units u
--       where u.breached > 0 or u.open_complaints > 0 or u.open_alerts > 0 or u.open_cases >= 5
--     ), N'[]') AS [unitsNeedingAttention], coalesce((SELECT @_result = items from recent), N'[]') AS [recent] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

--   RETURN @_result;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_governance_report](
--   @_from datetimeoffset = NULL,
--   @_to datetimeoffset = NULL,
--   @_unit uniqueidentifier = NULL,
--   @_owner uniqueidentifier = NULL,
--   @_type nvarchar(450) = NULL,
--   @_status nvarchar(450) = NULL
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_result nvarchar(max);

--   SELECT @_all = [dbo].[can_monitor_all_units](@_uid);
--   IF  not coalesce(@_all, 0) BEGIN
--     THROW 50000, 'Not authorised for university-wide monitoring', 1;
--   END
--   with c as (
--     select cs.*, su.name_en as unit_en, su.name_ar as unit_ar,
--            coalesce(p.full_name, p.email) as owner_name
--     from [dbo].[cases] cs
--     left join [dbo].[service_units] su on su.id = cs.service_unit_id
--     left join [dbo].[profiles] p on p.id = cs.assigned_to
--     where cs.deleted_at is null
--       and (@_from is null or cs.created_at >= @_from)
--       and (@_to is null or cs.created_at <= @_to)
--       and (@_unit is null or cs.service_unit_id = @_unit)
--       and (@_owner is null or cs.assigned_to = @_owner)
--       and (@_type is null or cs.case_type = @_type)
--       and (@_status is null or cs.status = @_status)
--   ),
--   metrics as (
--     select
--       count(*) as total,
--       count(*) filter (where case_type = 'query') as queries,
--       count(*) filter (where case_type = 'complaint') as complaints,
--       count(*) filter (where case_type = 'suggestion') as suggestions,
--       count(*) filter (where case_type = 'alert') as alerts,
--       count(*) filter (where case_type = 'service_request') as requests,
--       count(*) filter (where status = 'resolved') as resolved,
--       count(*) filter (where status = 'closed') as closed,
--       count(*) filter (where status not in ('resolved','closed')) as unresolved,
--       avg(DATEDIFF_BIG(SECOND, '19700101', (coalesce(resolved_at, closed_at) - created_at)) / 3600.0)
--         filter (where coalesce(resolved_at, closed_at) is not null) as avg_resolution_hours,
--       count(*) filter (
--         where coalesce(resolved_at, closed_at) is not null
--           and (resolution_due_at is null or coalesce(resolved_at, closed_at) <= resolution_due_at)
--       ) as met_sla,
--       count(*) filter (
--         where resolution_due_at is not null
--           and ((coalesce(resolved_at, closed_at) is not null and coalesce(resolved_at, closed_at) > resolution_due_at)
--             or (coalesce(resolved_at, closed_at) is null and resolution_due_at < SYSDATETIMEOFFSET()))
--       ) as breached_sla
--     from c
--   ),
--   rows as (
--     select coalesce((CONVERT(nvarchar(max), x) order by x.created_at desc), N'[]') as items
--     from (
--       select case_number, title, case_type as case_type, status as status,
--              unit_en, unit_ar, owner_name, created_at,
--              coalesce(resolved_at, closed_at) as completed_at,
--              resolution_due_at,
--              DATEDIFF_BIG(SECOND, '19700101', (coalesce(resolved_at, closed_at) - created_at)) / 3600.0 as resolution_hours
--       from c
--       order by created_at desc
      
--     ) x
--   ),
--   by_unit as (
--     select coalesce((CONVERT(nvarchar(max), u) order by u.total desc), N'[]') as items
--     from (
--       select coalesce(unit_en, 'Unassigned') as unit_en, coalesce(unit_ar, 'غير مُسندة') as unit_ar,
--              count(*) as total,
--              count(*) filter (where status in ('resolved','closed')) as completed,
--              count(*) filter (where status not in ('resolved','closed')) as open_cases,
--              avg(DATEDIFF_BIG(SECOND, '19700101', (coalesce(resolved_at, closed_at) - created_at)) / 3600.0)
--                filter (where coalesce(resolved_at, closed_at) is not null) as avg_resolution_hours
--       from c group by 1, 2
--     ) u
--   ),
--   by_owner as (
--     select coalesce((CONVERT(nvarchar(max), o) order by o.total desc), N'[]') as items
--     from (
--       select coalesce(owner_name, 'Unassigned') as owner_name,
--              count(*) as total,
--              count(*) filter (where status in ('resolved','closed')) as completed,
--              count(*) filter (where status not in ('resolved','closed')) as open_cases
--       from c group by 1
--     ) o
--   )
--   SELECT @_result = (SELECT (select CONVERT(nvarchar(max), m) from metrics m) AS [metrics], (select items from rows) AS [rows], (select items from by_unit) AS [byUnit], (select items from by_owner) AS [byOwner] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

--   RETURN @_result;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_owner_monitor](
  
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_out nvarchar(max);

--   IF  @_uid IS NULL OR NOT [dbo].[can_monitor_cases](@_uid) BEGIN
--     THROW 50000, 'Not authorised for case monitoring', 1;
--   END
--   SET @_all = [dbo].[can_monitor_all_units](@_uid);

--   SELECT @_out = COALESCE((t ORDER BY (JSON_VALUE(t, '$.activeCases')) DESC), N'[]')
--   FROM (
--     SELECT (SELECT v.assigned_to AS [ownerId], COALESCE(v.owner_name, 'Unassigned') AS [ownerName], COALESCE(v.unit_name_en, '—') AS [unitEn], COALESCE(v.unit_name_ar, '—') AS [unitAr], count(*) FILTER (WHERE NOT v.is_closed) AS [activeCases], count(*) FILTER (WHERE v.response_overdue) AS [overdueResponses], count(*) FILTER (WHERE v.sla_status = 'breached') AS [breached], count(*) FILTER (WHERE v.escalation_unresolved) AS [unresolvedEscalations], count(*) FILTER (WHERE v.is_closed) AS [closedCases], and NULL while nothing has been completed:
--       -- an officer with no closed case has no compliance record AS [@___A_share_between_0_and_1], CASE
--         WHEN count(*) FILTER (WHERE v.is_closed) = 0 THEN NULL
--         ELSE ROUND(
--           count(*) FILTER (WHERE v.is_closed AND (v.sla_due_at IS NULL OR v.resolved_at <= v.sla_due_at))
--           / count(*) FILTER (WHERE v.is_closed), 4)
--       END AS [not_a_bad_one_________slaCompliance_], not the time allowed.
--       'medianResponseHours' AS [@___Time_actually_taken_to_first_respond_], NULL AS [ROUND__percentile_cont_0_5__WITHIN_GROUP] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS t
--     FROM [dbo].[case_monitor_v] v
--     WHERE v.assigned_to IS NOT NULL
--       AND (@_all OR v.service_unit_id IN (SELECT service_unit_id FROM [dbo].[case_monitor_units](@_uid)))
--     GROUP BY v.assigned_to, v.owner_name, v.unit_name_en, v.unit_name_ar
--   ) s;

--   RETURN @_out;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_owner_performance](
  
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_result nvarchar(max);

--   SELECT @_all = [dbo].[can_monitor_all_units](@_uid);
--   IF  not coalesce(@_all, 0) BEGIN
--     THROW 50000, 'Not authorised for university-wide monitoring', 1;
--   END
--   SELECT @_result = coalesce((CONVERT(nvarchar(max), r) order by r.open_cases desc), N'[]')
--   from (
--     select
--       p.id as owner_id,
--       coalesce(p.full_name, p.email, 'Unassigned') as owner_name,
--       su.name_en as unit_en,
--       su.name_ar as unit_ar,
--       count(*) as assigned,
--       count(*) filter (where c.status not in ('resolved','closed')) as open_cases,
--       count(*) filter (where c.status = 'resolved') as resolved,
--       count(*) filter (where c.status = 'closed') as closed,
--       count(*) filter (where c.case_type = 'complaint') as complaints,
--       count(*) filter (
--         where c.status not in ('resolved','closed')
--           and c.resolution_due_at is not null and c.resolution_due_at < SYSDATETIMEOFFSET()
--       ) as overdue,
--       avg(DATEDIFF_BIG(SECOND, '19700101', (coalesce(c.resolved_at, c.closed_at) - c.created_at)) / 3600.0)
--         filter (where coalesce(c.resolved_at, c.closed_at) is not null) as avg_handling_hours,
--       (count(*) filter (
--          where coalesce(c.resolved_at, c.closed_at) is not null
--            and (c.resolution_due_at is null or coalesce(c.resolved_at, c.closed_at) <= c.resolution_due_at)
--        )
--        / nullif(count(*) filter (where coalesce(c.resolved_at, c.closed_at) is not null), 0)) as sla_compliance,
--       (count(*) filter (where c.status in ('resolved','closed'))
--        / nullif(count(*), 0)) as resolution_rate
--     from [dbo].[cases] c
--     join [dbo].[profiles] p on p.id = c.assigned_to
--     left join [dbo].[service_units] su on su.id = c.service_unit_id
--     where c.deleted_at is null
--     group by p.id, p.full_name, p.email, su.name_en, su.name_ar
--   ) r;

--   RETURN @_result;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[admin_unit_monitor](
  
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_all bit;
--   DECLARE @@_out nvarchar(max);

--   IF  @_uid IS NULL OR NOT [dbo].[can_monitor_cases](@_uid) BEGIN
--     THROW 50000, 'Not authorised for case monitoring', 1;
--   END
--   SET @_all = [dbo].[can_monitor_all_units](@_uid);

--   SELECT @_out = COALESCE((t ORDER BY (JSON_VALUE(t, '$.breached')) DESC, (JSON_VALUE(t, '$.active')) DESC), N'[]')
--   FROM (
--     SELECT (SELECT v.service_unit_id AS [unitId], COALESCE(v.unit_name_en, 'Unassigned') AS [unitEn], COALESCE(v.unit_name_ar, 'غير محدد') AS [unitAr], count(*) FILTER (WHERE NOT v.is_closed) AS [active], count(*) FILTER (WHERE NOT v.is_closed AND v.actor IN ('service_owner','specific_officer','manager','staff')) AS [ownerPending], count(*) FILTER (WHERE NOT v.is_closed AND v.actor = 'student') AS [studentPending], count(*) FILTER (WHERE NOT v.is_closed AND v.actor = 'external_party') AS [externalPending], count(*) FILTER (WHERE v.sla_status = 'attention') AS [attention], count(*) FILTER (WHERE v.sla_status = 'critical') AS [critical], count(*) FILTER (WHERE v.sla_status = 'breached') AS [breached], count(*) FILTER (WHERE v.critical_alert) AS [criticalAlerts], count(*) FILTER (WHERE v.response_overdue) AS [responseOverdue], ROUND(100.0 * count(*) FILTER (WHERE v.automation_level = 'automated') / GREATEST(count(*),1)) AS [automationRate], ROUND((percentile_cont(0.5) WITHIN GROUP (
--           ORDER BY DATEDIFF_BIG(SECOND, '19700101', (v.resolved_at - v.created_at)) / 3600.0)), 1) AS [medianResolutionHours] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS t
--     FROM [dbo].[case_monitor_v] v
--     WHERE (@_all OR v.service_unit_id IN (SELECT service_unit_id FROM [dbo].[case_monitor_units](@_uid)))
--     GROUP BY v.service_unit_id, v.unit_name_en, v.unit_name_ar
--   ) s;

--   RETURN @_out;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[book_appointment_slot]
--   @_slot_id uniqueidentifier,
--   @_purpose nvarchar(450) = NULL
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@s public.appointment_slots;
--   DECLARE @@t public.appointment_types;
--   DECLARE @@appt public.student_appointments;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();
--   DECLARE @@code nvarchar(450);

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;

--   SELECT @s = * FROM [dbo].[appointment_slots] WHERE id = @_slot_id FOR UPDATE;
--   IF @s.id IS NULL THEN THROW 50000, 'SLOT_NOT_FOUND', 1; END IF;
--   IF @s.status <> 'open' OR @s.booked_count >= @s.capacity THEN THROW 50000, 'SLOT_UNAVAILABLE', 1; END IF;
--   IF @s.start_time <= SYSDATETIMEOFFSET() THEN THROW 50000, 'SLOT_IN_PAST', 1; END IF;

--   IF EXISTS (SELECT 1 FROM [dbo].[student_appointments] a
--               WHERE a.student_id = @uid AND a.appointment_slot_id = @s.id
--                 AND a.status <> 'cancelled') THEN
--     THROW 50000, 'DUPLICATE_APPOINTMENT', 1;
--   END
--   IF EXISTS (SELECT 1 FROM [dbo].[student_appointments] a
--               JOIN [dbo].[appointment_slots] os ON os.id = a.appointment_slot_id
--              WHERE a.student_id = @uid AND a.status NOT IN ('cancelled','completed')
--                AND os.start_time < @s.end_time AND os.end_time > @s.start_time) THEN
--     THROW 50000, 'CONFLICTING_APPOINTMENT', 1;
--   END
--   SELECT @t = * FROM [dbo].[appointment_types] WHERE id = @s.appointment_type_id;

--   SET @code = 'APT-'  +  upper(substr(replace(NEWID(),'-',''), 1, 6));

--   INSERT INTO [dbo].[student_appointments]
--     (student_id, appointment_slot_id, purpose, status, booked_by, confirmation_code)
--   VALUES (@uid, @s.id, NULLIF(left(COALESCE(@_purpose,''), 500), ''),
--           CASE WHEN COALESCE(@t.requires_approval, 0) THEN 'pending' ELSE 'confirmed' END,
--           @uid, @code)
--   RETURNING * INTO @appt;

--   UPDATE [dbo].[appointment_slots]
--      SET booked_count = booked_count + 1,
--          status = CASE WHEN booked_count + 1 >= capacity THEN 'booked' ELSE status END
--    WHERE id = @s.id;

--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (@uid, 'appointment.booked', 'student_appointments', @appt.id,
--     (SELECT @s.id AS [slot_id], @code AS [confirmation_code], @s.capacity AS [capacity], @s.booked_count AS [booked_before], @s.booked_count + 1 AS [booked_after] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @appt;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[burn_verification_token]
--   @_document_id uniqueidentifier
-- AS
-- BEGIN
--   SET NOCOUNT ON;

--   UPDATE [dbo].[issued_documents]
--      SET secure_verification_token = 'burned-'  +  replace(NEWID(), '-', '')
--    WHERE id = @_document_id;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_access_case](
--   @_case_id uniqueidentifier,
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (
--     SELECT 1 FROM [dbo].[cases] c WHERE c.id = @_case_id AND (
--       c.student_id = @_user_id
--       OR [dbo].[can_see_all_cases](@_user_id)
--       OR ([dbo].[is_staff](@_user_id) AND (c.assigned_to = @_user_id OR [dbo].[owns_service_unit](@_user_id, c.service_unit_id)))
--     )
--   ));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_access_knowledge_file](
--   @_name nvarchar(450),
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@doc_unit uniqueidentifier;

--   IF  NOT [dbo].[can_manage_knowledge](@_user_id) BEGIN
--     RETURN 0;
--   END
--   IF  [dbo].[has_role](@_user_id, 'system_admin') BEGIN
--     RETURN 1;
--   END
--   SELECT @doc_unit = kd.owner_unit_id
--   FROM [dbo].[knowledge_documents] kd
--   WHERE kd.storage_path = @_name
--   ;
--   IF  NOT FOUND OR @doc_unit IS NULL BEGIN
--     RETURN 1; -- staging upload or document without an owning unit
--   END
--   RETURN @doc_unit = [dbo].[staff_unit](@_user_id);

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_approve_knowledge](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id
--     AND role IN ('knowledge_approver','system_admin')));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_manage_integrations](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id
--     AND role IN ('integration_admin','system_admin')));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_manage_knowledge](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id
--     AND role IN ('knowledge_manager','knowledge_approver','system_admin')));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_monitor_all_units](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN ([dbo].[has_role](@_user_id, 'system_admin')
--       OR [dbo].[has_role](@_user_id, 'leadership_viewer')
--       OR EXISTS (
--            SELECT 1 FROM [dbo].[case_monitor_grants] g
--             WHERE g.user_id = @_user_id AND g.is_active AND g.scope = 'all_units'
--          ));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_monitor_cases](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN ([dbo].[can_monitor_all_units](@_user_id)
--       OR [dbo].[has_role](@_user_id, 'auditor')
--       OR [dbo].[has_role](@_user_id, 'service_manager')
--       OR EXISTS (SELECT 1 FROM [dbo].[case_monitor_grants] g WHERE g.user_id = @_user_id AND g.is_active));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_read_case_evidence](
--   @_name nvarchar(450),
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@parts nvarchar(max); seg nvarchar(450);

--   IF @_user_id IS NULL THEN RETURN 0; END IF;
--   SET @parts = [storage].[foldername](@_name);
--   IF @parts[1] = @_user_id THEN RETURN 1; END IF;
--   IF NOT [dbo].[is_staff](@_user_id) THEN RETURN 0; END IF;
--   IF array_length(@parts, 1) < 2 THEN RETURN 0; END IF;
--   SET seg = @parts[2];
--   IF  seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' BEGIN
--     RETURN [dbo].[can_access_case](seg, @_user_id);
--   END
--   RETURN 0;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_see_all_cases](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id
--     AND role IN ('service_manager','system_admin','auditor','leadership_viewer'))
--    AND NOT [dbo].[is_access_revoked](@_user_id));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[can_write_case_evidence](
--   @_name nvarchar(450),
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@parts nvarchar(max); seg nvarchar(450);

--   SET @parts = [storage].[foldername](@_name);
--   IF  @parts[1] IS DISTINCT FROM @_user_id BEGIN
--     RETURN 0;
--   END
--   -- exactly one folder level below the owner's folder: no arbitrary nesting
--   IF  array_length(@parts, 1) IS DISTINCT FROM 2 BEGIN
--     RETURN 0;
--   END
--   SET seg = @parts[2];
--   IF  seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' BEGIN
--     RETURN [dbo].[can_access_case](seg, @_user_id);
--   END
--   -- staging folders are restricted to the approved assistant staging area
--   RETURN seg = 'chat';

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[cancel_appointment_booking]
--   @_appointment_id uniqueidentifier,
--   @_reason nvarchar(450) = NULL
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@a public.student_appointments;
--   DECLARE @@s public.appointment_slots;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;

--   SELECT @a = * FROM [dbo].[student_appointments]
--    WHERE id = @_appointment_id AND student_id = @uid FOR UPDATE;
--   IF @a.id IS NULL THEN THROW 50000, 'APPOINTMENT_NOT_FOUND', 1; END IF;
--   IF @a.status = 'cancelled' THEN THROW 50000, 'ALREADY_CANCELLED', 1; END IF;
--   IF @a.status = 'completed' THEN THROW 50000, 'ALREADY_COMPLETED', 1; END IF;

--   SELECT @s = * FROM [dbo].[appointment_slots] WHERE id = @a.appointment_slot_id FOR UPDATE;

--   UPDATE [dbo].[student_appointments]
--      SET status = 'cancelled',
--          cancelled_at = SYSDATETIMEOFFSET(),
--          purpose = CASE WHEN @_reason IS NULL OR @_reason = '' THEN purpose
--                         ELSE left(COALESCE(purpose  +  ' | ', '')  +  'Cancelled: '  +  @_reason, 500) END
--    WHERE id = @a.id
--    RETURNING * INTO @a;

--   UPDATE [dbo].[appointment_slots]
--      SET booked_count = GREATEST(0, booked_count - 1),
--          status = CASE WHEN status = 'booked' THEN 'open' ELSE status END
--    WHERE id = @s.id;

--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (@uid, 'appointment.cancelled', 'student_appointments', @a.id,
--     (SELECT @s.id AS [slot_id], @a.confirmation_code AS [confirmation_code] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @a;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[case_monitor_units]
--   @_user_id uniqueidentifier
-- AS
-- BEGIN
--   SET NOCOUNT ON;

--   SELECT u.id FROM [dbo].[service_units] u
--    WHERE [dbo].[can_monitor_all_units](@_user_id)
--   UNION
--   SELECT unnest(g.unit_ids) FROM [dbo].[case_monitor_grants] g
--    WHERE g.user_id = @_user_id AND g.is_active AND g.scope = 'units'
--   UNION
--   SELECT o.service_unit_id FROM [dbo].[owned_service_units](@_user_id) o;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[change_internship_assignment]
--   @_assignment_id uniqueidentifier,
--   @_new_opportunity_id uniqueidentifier,
--   @_reason nvarchar(450)
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@a public.internship_assignments;
--   DECLARE @@oldopp public.internship_opportunities;
--   DECLARE @@newopp public.internship_opportunities;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;
--   SELECT @a = * FROM [dbo].[internship_assignments] WHERE id = @_assignment_id FOR UPDATE;
--   IF @a IS NULL THEN THROW 50000, 'Assignment not found', 1; END IF;
--   IF  @a.student_id <> @uid AND NOT [dbo].[is_internship_staff](@uid) BEGIN
--     THROW 50000, 'Not authorised for this assignment', 1;
--   END
--   IF  @a.assignment_status NOT IN ('reserved','assigned','confirmed') BEGIN
--     THROW 50000, 'This placement can no longer be changed automatically', 1;
--   END
--   IF @a.opportunity_id = @_new_opportunity_id THEN SELECT @a; END IF;

--   SELECT @newopp = * FROM [dbo].[internship_opportunities] WHERE id = @_new_opportunity_id FOR UPDATE;
--   IF  @newopp IS NULL OR @newopp.active_status <> 'active' OR @newopp.available_seats < 1 BEGIN
--     THROW 50000, 'SEATS_FULL', 1;
--   END
--   SELECT @oldopp = * FROM [dbo].[internship_opportunities] WHERE id = @a.opportunity_id FOR UPDATE;

--   UPDATE [dbo].[internship_opportunities] SET assigned_seats = GREATEST(assigned_seats - 1, 0) WHERE id = @oldopp.id;
--   UPDATE [dbo].[internship_opportunities] SET assigned_seats = assigned_seats + 1 WHERE id = @newopp.id;

--   UPDATE [dbo].[internship_assignments]
--      SET opportunity_id = @newopp.id,
--          organization_id = @newopp.organization_id,
--          internship_start_date = @newopp.start_date,
--          internship_end_date = @newopp.end_date,
--          internship_course_id = @newopp.internship_course_id,
--          assignment_status = 'assigned',
--          course_registration_status = 'not_started',
--          seats_before = @newopp.available_seats + 1,
--          seats_after = @newopp.available_seats,
--          owner_notes = COALESCE(owner_notes, '') 
--    WHERE id = @a.id RETURNING * INTO @a;

--   INSERT INTO [dbo].[internship_assignment_audit] (assignment_id, student_id, event_type, actor_type, actor_id, details)
--   VALUES (@a.id, @a.student_id, 'assignment_changed',
--     CASE WHEN [dbo].[is_internship_staff](@uid) AND @uid <> @a.student_id THEN 'human' ELSE 'agent' END, @uid,
--     (SELECT @oldopp.opportunity_code AS [from], @newopp.opportunity_code AS [to], @_reason AS [reason] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @a;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[check_intercollege_transfer_eligibility](
--   @_student_id uniqueidentifier,
--   @_target_programme_id uniqueidentifier = NULL
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@sp public.student_profiles;
--   DECLARE @@cnt int = 0;
--   DECLARE @@seats int = NULL;
--   DECLARE @@cap public.programme_transfer_capacity;
--   DECLARE @@failed nvarchar(max) = N'[]';
--   DECLARE @@credits int = 0;
--   DECLARE @@gpa numeric = NULL;
--   DECLARE @@min_cr constant int = 12;
--   DECLARE @@max_cr constant int = 36;
--   DECLARE @@min_gpa constant numeric = 2.50;

--   IF [auth].[uid]() IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;
--   IF  [auth].[uid]() <> @_student_id AND NOT [dbo].[is_staff]([auth].[uid]()) BEGIN
--     THROW 50000, 'Not authorised to read this eligibility', 1;
--   END
--   SELECT @sp = * FROM [dbo].[student_profiles] WHERE user_id = @_student_id;
--   IF  @sp.user_id IS NULL BEGIN
--     RETURN (SELECT 'not_eligible' AS [eligibility_status], (SELECT 'no_academic_record' FOR JSON PATH) AS [failed_rules], 'ict-rules-v3' AS [rule_version] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   SET @credits = COALESCE(@sp.completed_credit_hours, 0);
--   SET @gpa = @sp.cumulative_gpa;

--   SELECT @cnt = count(*) FROM [dbo].[intercollege_transfer_requests]
--    WHERE student_id = @_student_id AND transfer_status = 'completed';

--   IF  @_target_programme_id IS NOT NULL BEGIN
--     SELECT @cap = * FROM [dbo].[programme_transfer_capacity]
--      WHERE programme_id = @_target_programme_id AND is_active
--      ORDER BY academic_term_id NULLS LAST ;
--     SET @seats = @cap.available_transfer_seats;
--   END
--   IF @credits < @min_cr THEN SET @failed = @failed  +  CONVERT(nvarchar(max), N'below_minimum_credits'); END IF;
--   IF @credits > @max_cr THEN SET @failed = @failed  +  CONVERT(nvarchar(max), N'above_maximum_credits'); END IF;
--   IF  @gpa IS NULL BEGIN
--     SET @failed = @failed  +  CONVERT(nvarchar(max), N'gpa_unavailable');
--   END ELSE IF  @gpa < @min_gpa BEGIN
--     SET @failed = @failed  +  CONVERT(nvarchar(max), N'gpa_below_minimum');
--   END
--   IF @cnt >= 1 THEN SET @failed = @failed  +  CONVERT(nvarchar(max), N'previous_transfer_exists'); END IF;
--   IF  @_target_programme_id IS NOT NULL AND @cap.id IS NULL BEGIN
--     SET @failed = @failed  +  CONVERT(nvarchar(max), N'capacity_data_unavailable');
--   END ELSE IF  @_target_programme_id IS NOT NULL AND COALESCE(@seats,0) < 1 BEGIN
--     SET @failed = @failed  +  CONVERT(nvarchar(max), N'no_available_seats');
--   END
--   RETURN (SELECT @credits AS [completed_credit_hours], @min_cr AS [minimum_required_credits], @max_cr AS [maximum_allowed_credits], @gpa AS [current_gpa], @min_gpa AS [minimum_required_gpa], @cnt AS [previous_intercollege_transfer_count], @_target_programme_id AS [target_programme_id], @seats AS [target_programme_available_seats], @cap.id AS [target_programme_capacity_id], @cap.total_transfer_seats AS [target_programme_total_seats], CASE WHEN jsonb_array_length(@failed) = 0 THEN 'eligible' ELSE 'not_eligible' END AS [eligibility_status], @failed AS [failed_rules], 'ict-rules-v3' AS [rule_version] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[check_intercollege_transfer_history](
--   @_student_id uniqueidentifier
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@last_row public.intercollege_transfer_requests;
--   DECLARE @@cnt int;

--   IF [auth].[uid]() IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;
--   IF  [auth].[uid]() <> @_student_id AND NOT [dbo].[is_staff]([auth].[uid]()) BEGIN
--     THROW 50000, 'Not authorised to read this transfer history', 1;
--   END
--   SELECT @cnt = count(*) FROM [dbo].[intercollege_transfer_requests]
--    WHERE student_id = @_student_id AND transfer_status = 'completed';
--   SELECT @last_row = * FROM [dbo].[intercollege_transfer_requests]
--    WHERE student_id = @_student_id AND transfer_status = 'completed'
--    ORDER BY executed_at DESC NULLS LAST ;
--   RETURN (SELECT @cnt AS [transfer_count], @last_row.executed_at AS [previous_transfer_date], @last_row.transfer_number AS [previous_transfer_number], (SELECT name_en FROM [dbo].[academic_programs] WHERE id = @last_row.source_programme_id) AS [previous_from_programme], (SELECT name_ar FROM [dbo].[academic_programs] WHERE id = @last_row.source_programme_id) AS [previous_from_programme_ar], (SELECT name_en FROM [dbo].[academic_programs] WHERE id = @last_row.target_programme_id) AS [previous_to_programme], (SELECT name_ar FROM [dbo].[academic_programs] WHERE id = @last_row.target_programme_id) AS [previous_to_programme_ar], CASE WHEN @cnt >= 1 THEN 'blocked' ELSE 'allowed' END AS [eligibility] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[claim_notification_deliveries]
--   @_limit int = 25
-- AS
-- BEGIN
--   SET NOCOUNT ON;
-- SELECT QUERY
--   UPDATE [dbo].[notification_deliveries] d
--      SET status = 'sending', locked_at = SYSDATETIMEOFFSET(), updated_at = SYSDATETIMEOFFSET()
--    WHERE d.id IN (
--      SELECT id FROM [dbo].[notification_deliveries]
--       WHERE status IN ('queued','retrying')
--         AND next_attempt_at <= SYSDATETIMEOFFSET()
--       ORDER BY (severity = 'emergency') DESC, (severity = 'critical') DESC, next_attempt_at ASC
--       LIMIT GREATEST(1, LEAST(@_limit, 100))
--       FOR UPDATE SKIP LOCKED
--    )
--   RETURNING d.*;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[decide_internship_clearance]
--   @_assignment_id uniqueidentifier,
--   @_decision nvarchar(450),
--   @_reason nvarchar(450) = NULL
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@a public.internship_assignments;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();
--   DECLARE @@opp public.internship_opportunities;

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;
--   IF  NOT [dbo].[is_internship_staff](@uid) BEGIN
--     THROW 50000, 'Only Career & Internship Services staff can decide government clearance', 1;
--   END
--   IF  @_decision NOT IN ('approved','rejected','returned_for_clarification') BEGIN
--     THROW 50000, 'Invalid clearance decision', 1;
--   END
--   IF  @_decision <> 'approved' AND (@_reason IS NULL OR LEN(TRIM(@_reason)) < 5) BEGIN
--     THROW 50000, 'A reason is required for this decision', 1;
--   END
--   SELECT @a = * FROM [dbo].[internship_assignments] WHERE id = @_assignment_id FOR UPDATE;
--   IF @a IS NULL THEN THROW 50000, 'Assignment not found', 1; END IF;
--   IF  @a.government_clearance_status = 'approved' BEGIN
--     THROW 50000, 'Government clearance is already approved for this allocation', 1;
--   END
--   IF  @a.government_clearance_required IS NOT TRUE BEGIN
--     THROW 50000, 'This allocation does not require government clearance', 1;
--   END
--   IF  @_decision = 'approved' BEGIN
--     UPDATE [dbo].[internship_assignments]
--        SET government_clearance_status = 'approved',
--            government_clearance_approved_by = @uid,
--            government_clearance_approved_at = SYSDATETIMEOFFSET(),
--            government_clearance_rejection_reason = NULL,
--            final_allocation_at = SYSDATETIMEOFFSET(),
--            assignment_status = 'registered',
--            owner_review_status = 'approved',
--            requires_human_review = 0
--      WHERE id = @a.id RETURNING * INTO @a;
--   END ELSE IF  @_decision = 'returned_for_clarification' BEGIN
--     UPDATE [dbo].[internship_assignments]
--        SET government_clearance_status = 'returned_for_clarification',
--            government_clearance_rejection_reason = @_reason,
--            requires_human_review = 1
--      WHERE id = @a.id RETURNING * INTO @a;
--   END ELSE BEGIN
--     SELECT @opp = * FROM [dbo].[internship_opportunities] WHERE id = @a.opportunity_id FOR UPDATE;
--     IF  @opp.id IS NOT NULL BEGIN
--       UPDATE [dbo].[internship_opportunities]
--          SET assigned_seats = GREATEST(assigned_seats - 1, 0)
--        WHERE id = @opp.id;
--     END
--     UPDATE [dbo].[internship_assignments]
--        SET government_clearance_status = 'rejected',
--            government_clearance_rejection_reason = @_reason,
--            assignment_status = 'cancelled',
--            requires_human_review = 0,
--            final_allocation_at = NULL
--      WHERE id = @a.id RETURNING * INTO @a;
--   END
--   INSERT INTO [dbo].[internship_assignment_audit] (assignment_id, student_id, event_type, actor_type, actor_id, details)
--   VALUES (@a.id, @a.student_id,
--     CASE @_decision
--       WHEN 'approved' THEN 'government_clearance_approved'
--       WHEN 'rejected' THEN 'government_clearance_rejected'
--       ELSE 'government_clearance_returned' END,
--     'human', @uid,
--     (SELECT @_reason AS [reason], @a.assignment_number AS [assignment_number], SYSDATETIMEOFFSET() AS [decided_at] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @a;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[delete_my_issued_document]
--   @_document_id uniqueidentifier
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@d public.issued_documents;
--   DECLARE @@old_path nvarchar(450);

--   IF [auth].[uid]() IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;
--   SELECT @d = * FROM [dbo].[issued_documents] WHERE id = @_document_id FOR UPDATE;
--   IF  @d.id IS NULL OR @d.student_id <> [auth].[uid]() BEGIN
--     THROW 50000, 'This document is not available.', 1;
--   END
--   SET @old_path = @d.file_path;

--   IF  @d.deleted_at IS NULL BEGIN
--     UPDATE [dbo].[issued_documents]
--        SET document_status = 'deleted_by_student',
--            verification_status = 'revoked',
--            verification_revoked_at = SYSDATETIMEOFFSET(),
--            deleted_at = SYSDATETIMEOFFSET(),
--            deleted_by = [auth].[uid](),
--            deletion_reason = 'Student Requested',
--            file_path = NULL
--      WHERE id = @d.id;

--     INSERT INTO [dbo].[document_events] (document_id, reference_number, event_type, actor_type, actor_id, details)
--     VALUES (@d.id, @d.reference_number, 'deleted_by_student', 'student', [auth].[uid](),
--             (SELECT 'Student Requested' AS [reason], @d.document_hash AS [document_hash] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--     INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--     VALUES ([auth].[uid](), 'document.deleted_by_student', 'issued_document', @d.id,
--             (SELECT @d.reference_number AS [reference], @d.document_type AS [documentType] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));
--   END
--   SELECT (SELECT @d.reference_number AS [reference], @old_path AS [filePath] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[evaluation_metrics](
--   @_from datetimeoffset = NULL,
--   @_to datetimeoffset = NULL
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@f datetimeoffset = coalesce(@_from, SYSDATETIMEOFFSET() - interval '365 days');
--   DECLARE @@t datetimeoffset = coalesce(@_to, SYSDATETIMEOFFSET());
--   DECLARE @@result nvarchar(max);

--   IF  not ([dbo].[has_role]([auth].[uid](),'system_admin') or [dbo].[is_manager]([auth].[uid]())) BEGIN
--     THROW 50000, 'not_authorised', 1;
--   END
--   with c as (
--     select * from [dbo].[cases]
--     where deleted_at is null and created_at >= @f and created_at <= @t
--   ),
--   done as (
--     select * from c where status in ('resolved','closed')
--   )
--   select (SELECT jsonb_build_object('from', @f, 'to', @t) AS [range], jsonb_build_object(
--       'interactions', (select count(*) from c)
--         + (select count(*) from [dbo].[messages] m where m.created_at between @f and @t),
--       'chat_messages', (select count(*) from [dbo].[messages] m where m.created_at between @f and @t),
--       'conversations', (select count(*) from [dbo].[conversations] v where v.created_at between @f and @t),
--       'cases', (select count(*) from c),
--       'queries', (select count(*) from c where case_type = 'query'),
--       'complaints', (select count(*) from c where case_type = 'complaint'),
--       'suggestions', (select count(*) from c where case_type = 'suggestion'),
--       'alerts', (select count(*) from c where case_type = 'alert'),
--       'requests', (select count(*) from c where case_type = 'service_request')
--     ) AS [volumes], jsonb_build_object(
--       'ai_resolved', (select count(*) from done where assigned_to is null and escalated_at is null),
--       'human_escalated', (select count(*) from c where escalated_at is not null or assigned_to is not null),
--       'resolved', (select count(*) from c where status = 'resolved'),
--       'closed', (select count(*) from c where status = 'closed'),
--       'open', (select count(*) from c where status not in ('resolved','closed','withdrawn','duplicate','rejected'))
--     ) AS [handling], jsonb_build_object(
--       'first_response_sample', (select count(*) from c where first_response_at is not null),
--       'avg_first_response_hours', (
--         select round(avg(DATEDIFF_BIG(SECOND, '19700101', (first_response_at - created_at)) / 3600), 2)
--         from c where first_response_at is not null
--       ),
--       'resolution_sample', (select count(*) from done where coalesce(resolved_at, closed_at) is not null),
--       'avg_resolution_hours', (
--         select round(avg(DATEDIFF_BIG(SECOND, '19700101', (coalesce(resolved_at, closed_at) - created_at)) / 3600), 2)
--         from done where coalesce(resolved_at, closed_at) is not null
--       )
--     ) AS [timing], jsonb_build_object(
--       'sample', (select count(*) from done where resolution_due_at is not null and coalesce(resolved_at, closed_at) is not null),
--       'met', (select count(*) from done where resolution_due_at is not null and coalesce(resolved_at, closed_at) is not null
--                 and coalesce(resolved_at, closed_at) <= resolution_due_at)
--     ) AS [sla], jsonb_build_object(
--       'staff_touchpoints', (select count(*) from [dbo].[case_status_history] h
--                               join c on c.id = h.case_id where h.changed_by is not null),
--       'student_entered_fields', (select count(*) from [dbo].[case_information_requests] r
--                                    join c on c.id = r.case_id where r.responded_at is not null),
--       'information_requests', (select count(*) from [dbo].[case_information_requests] r join c on c.id = r.case_id),
--       'reused_known_fields', (select count(*) from [dbo].[student_field_provenance]),
--       'status_transitions', (select count(*) from [dbo].[case_status_history] h join c on c.id = h.case_id),
--       'in_person_visits', (select count(*) from c where entry_channel = 'in_person')
--     ) AS [effort], jsonb_build_object(
--       'decided_sample', (select count(*) from done),
--       'reopen_or_objection', (select count(*) from [dbo].[case_reopen_requests] r join c on c.id = r.case_id)
--     ) AS [reviews], jsonb_build_object(
--       'baselines', (select count(*) from [dbo].[service_baselines]),
--       'pilot_sessions', (select count(*) from [dbo].[pilot_test_sessions]),
--       'pilot_participants', (select coalesce(sum(participant_count),0) from [dbo].[pilot_test_sessions]),
--       'handovers', (select count(*) from [dbo].[case_handovers]),
--       'exception_events', (select count(*) from [dbo].[exception_events]),
--       'approvals', (select count(*) from [dbo].[action_approvals]),
--       'action_receipts', (select count(*) from [dbo].[action_receipts]),
--       'reviews_by_kind', (select coalesce(jsonb_object_agg(kind, n), N'{}')
--                             from (select coalesce(kind,'reopen') as kind, count(*) as n
--                                     from [dbo].[case_reopen_requests] group by 1) k),
--       'provenance_fields', (select count(*) from [dbo].[student_field_provenance]),
--       'issued_documents', (select count(*) from [dbo].[issued_documents]),
--       'revoked_accounts', (select count(*) from [dbo].[profiles] where access_revoked_at is not null),
--       'assistant_conversations', (select count(*) from [dbo].[conversations])
--     ) AS [evidence] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) into @result;

--   RETURN @result;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[execute_intercollege_transfer]
--   @_request_id uniqueidentifier,
--   @_fingerprint nvarchar(450)
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@r public.intercollege_transfer_requests;
--   DECLARE @@sp public.student_profiles;
--   DECLARE @@ack public.intercollege_transfer_acknowledgements;
--   DECLARE @@tp public.academic_programs;
--   DECLARE @@cap public.programme_transfer_capacity;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();
--   DECLARE @@cnt int;
--   DECLARE @@num nvarchar(450);
--   DECLARE @@credits int;
--   DECLARE @@seats_before int;

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;

--   SELECT @r = * FROM [dbo].[intercollege_transfer_requests] WHERE id = @_request_id FOR UPDATE;
--   IF @r.id IS NULL THEN THROW 50000, 'Transfer request not found', 1; END IF;
--   IF @r.student_id <> @uid THEN THROW 50000, 'Not authorised for this transfer request', 1; END IF;
--   IF @r.transfer_status = 'completed' THEN SELECT @r; END IF;
--   IF  @r.transfer_status NOT IN ('pending_execution','awaiting_student_confirmation','eligible','awaiting_student_review') BEGIN
--     THROW 50000, 'This transfer request cannot be executed in its current state', 1;
--   END
--   IF @r.analysis_version IS DISTINCT FROM @_fingerprint THEN THROW 50000, 'STALE_ANALYSIS', 1; END IF;
--   IF @r.requires_human_review THEN THROW 50000, 'HUMAN_REVIEW_REQUIRED', 1; END IF;

--   SELECT @sp = * FROM [dbo].[student_profiles] WHERE user_id = @uid FOR UPDATE;
--   IF @sp.user_id IS NULL THEN THROW 50000, 'Student academic record not found', 1; END IF;

--   SELECT @cnt = count(*) FROM [dbo].[intercollege_transfer_requests]
--    WHERE student_id = @uid AND transfer_status = 'completed';
--   IF @cnt >= 1 THEN THROW 50000, 'ONE_TRANSFER_ONLY', 1; END IF;

--   IF @sp.program_id IS DISTINCT FROM @r.source_programme_id THEN THROW 50000, 'STALE_ANALYSIS', 1; END IF;

--   SET @credits = COALESCE(@sp.completed_credit_hours, 0);
--   IF @credits < 12 THEN THROW 50000, 'CREDITS_BELOW_MINIMUM', 1; END IF;
--   IF @credits > 36 THEN THROW 50000, 'CREDITS_ABOVE_MAXIMUM', 1; END IF;

--   IF  round(COALESCE(@sp.cumulative_gpa, 0), 2) IS DISTINCT FROM round(COALESCE(@r.current_gpa, -1), 2) BEGIN
--     THROW 50000, 'STALE_ANALYSIS', 1;
--   END
--   IF COALESCE(@sp.cumulative_gpa, 0) < 2.50 THEN THROW 50000, 'GPA_BELOW_MINIMUM', 1; END IF;
--   IF COALESCE(@r.projected_gpa, 0) < 2.50 THEN THROW 50000, 'PROJECTED_GPA_BELOW_MINIMUM', 1; END IF;

--   SELECT @tp = * FROM [dbo].[academic_programs] WHERE id = @r.target_programme_id;
--   IF @tp.id IS NULL OR NOT @tp.is_active THEN THROW 50000, 'TARGET_PROGRAMME_UNAVAILABLE', 1; END IF;

--   SELECT @cap = * FROM [dbo].[programme_transfer_capacity]
--    WHERE programme_id = @tp.id AND is_active
--    ORDER BY academic_term_id NULLS LAST  FOR UPDATE;
--   IF @cap.id IS NULL THEN THROW 50000, 'CAPACITY_DATA_UNAVAILABLE', 1; END IF;
--   SET @seats_before = @cap.available_transfer_seats;
--   IF @seats_before < 1 THEN THROW 50000, 'NO_AVAILABLE_SEATS', 1; END IF;

--   SELECT @ack = * FROM [dbo].[intercollege_transfer_acknowledgements]
--    WHERE transfer_request_id = @r.id ORDER BY acknowledged_at DESC ;
--   IF @ack.id IS NULL
--      OR NOT (@ack.credit_loss_accepted AND @ack.gpa_change_accepted AND @ack.graduation_delay_accepted
--              AND @ack.financial_consequence_accepted AND @ack.one_transfer_rule_accepted
--              AND @ack.capacity_accepted AND @ack.final_transfer_confirmed) THEN
--     THROW 50000, 'ACKNOWLEDGEMENTS_REQUIRED', 1;
--   END
--   UPDATE [dbo].[programme_transfer_capacity]
--      SET assigned_transfer_seats = assigned_transfer_seats + 1
--    WHERE id = @cap.id;

--   SET @num = 'ICT-'  +  to_char(SYSDATETIMEOFFSET(),'YYYY')  +  '-'  +  lpad(nextval('[dbo].[intercollege_transfer_seq]'), 4, '0');

--   UPDATE [dbo].[student_profiles]
--      SET program_id = @tp.id,
--          college_id = @tp.college_id,
--          department_id = @tp.department_id,
--          program = @tp.name_en,
--          college = (SELECT name_en FROM [dbo].[colleges] WHERE id = @tp.college_id)
--    WHERE user_id = @uid;

--   UPDATE [dbo].[intercollege_transfer_requests]
--      SET transfer_number = @num,
--          transfer_status = 'completed',
--          eligibility_status = 'eligible',
--          executed_at = SYSDATETIMEOFFSET(),
--          acknowledgement_version = @ack.terms_version,
--          capacity_id = @cap.id,
--          @seats_before = @seats_before,
--          seats_after = @seats_before - 1,
--          rule_version = 'ict-rules-v3',
--          student_confirmed_at = COALESCE(student_confirmed_at, @ack.acknowledged_at)
--    WHERE id = @r.id
--    RETURNING * INTO @r;

--   INSERT INTO [dbo].[student_alerts] (student_id, alert_type, title_en, title_ar, body_en, body_ar, severity, action_label_en, action_label_ar, action_url)
--   VALUES (@uid, 'academic', 'Inter-College Transfer completed', 'اكتمل التحويل بين الكليات',
--           'Your programme has been updated. Transfer reference: '  +  @num,
--           'تم تحديث برنامجك الأكاديمي. مرجع التحويل: '  +  @num,
--           'success', 'View transfer', 'عرض التحويل', '/transfer');

--   SELECT @r;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[expire_student_documents]
--   @_limit int = 200
-- AS
-- BEGIN
--   SET NOCOUNT ON;
-- SELECT QUERY
--   WITH due AS (
--     SELECT d.id, d.reference_number, d.file_path
--       FROM [dbo].[issued_documents] d
--      WHERE d.deleted_at IS NULL
--        AND d.retention_expires_at IS NOT NULL
--        AND d.retention_expires_at <= SYSDATETIMEOFFSET()
--      ORDER BY d.retention_expires_at
--      LIMIT GREATEST(@_limit, 1)
--      FOR UPDATE SKIP LOCKED
--   ), upd AS (
--     UPDATE [dbo].[issued_documents] t
--        SET document_status = 'expired',
--            verification_status = 'revoked',
--            verification_revoked_at = COALESCE(t.verification_revoked_at, SYSDATETIMEOFFSET()),
--            deleted_at = SYSDATETIMEOFFSET(),
--            deletion_reason = COALESCE(t.deletion_reason, 'Retention period elapsed'),
--            file_path = NULL
--       FROM due
--      WHERE t.id = due.id
--      RETURNING t.id
--   ), ev AS (
--     INSERT INTO [dbo].[document_events] (document_id, reference_number, event_type, actor_type, details)
--     SELECT due.id, due.reference_number, 'auto_expired', 'system',
--            (SELECT 'Retention period elapsed' AS [reason], SYSDATETIMEOFFSET() AS [expired_at] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
--       FROM due JOIN upd ON upd.id = due.id
--     RETURNING 1
--   )
--   SELECT due.id, due.reference_number, due.file_path
--     FROM due JOIN upd ON upd.id = due.id;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[generate_availability_slots]
--   @_rule_id uniqueidentifier,
--   @_weeks int = 4
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@r public.staff_availability_rules%ROWTYPE;
--   DECLARE @@d date;
--   DECLARE @@horizon date;
--   DECLARE @@t datetimeoffset;
--   DECLARE @@slot_end datetimeoffset;
--   DECLARE @@created int = 0;

--   IF  NOT has_role([auth].[uid](), N'system_admin') BEGIN
--     THROW 50000, 'not authorised', 1;
--   END
--   SELECT @r = * FROM [dbo].[staff_availability_rules] WHERE id = @_rule_id;
--   IF  @r.id IS NULL OR NOT @r.is_active OR @r.appointment_type_id IS NULL BEGIN
--     SELECT 0;
--   END
--   SET @horizon = LEAST(COALESCE(@r.valid_to, CONVERT(date, SYSDATETIMEOFFSET()) + (@_weeks * 7)), CONVERT(date, SYSDATETIMEOFFSET()) + (@_weeks * 7));
--   SET @d = GREATEST(@r.valid_from, CONVERT(date, SYSDATETIMEOFFSET()));
--   WHILE @d <= @horizon LOOP
--     IF  EXTRACT(DOW FROM @d) = @r.weekday BEGIN
--       SET @t = (@d + make_interval(mins => @r.start_minute)) AT TIME ZONE 'Asia/Dubai';
--       WHILE (@t + make_interval(mins => @r.slot_minutes)) <= ((@d + make_interval(mins => @r.end_minute)) AT TIME ZONE 'Asia/Dubai') LOOP
--         SET @slot_end = @t + make_interval(mins => @r.slot_minutes);
--         IF @t > SYSDATETIMEOFFSET() AND NOT EXISTS (
--           SELECT 1 FROM [dbo].[appointment_slots] s
--            WHERE s.appointment_type_id = @r.appointment_type_id
--              AND s.start_time = @t
--              AND s.staff_profile_id IS NOT DISTINCT FROM @r.staff_profile_id
--         ) THEN
--           INSERT INTO [dbo].[appointment_slots]
--             (appointment_type_id, staff_profile_id, start_time, end_time, capacity, status, location, meeting_link, data_source, is_demo_record)
--           VALUES
--             (@r.appointment_type_id, @r.staff_profile_id, @t, @slot_end, @r.capacity, 'open', @r.location, @r.meeting_link, 'admin', 0);
--           SET @created = @created + 1;
--         END
--         SET @t = @slot_end;
--       END LOOP;
--     END
--     SET @d = @d + 1;
--   END LOOP;
--   SELECT @created;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[get_service_availability](
--   @_service_id uniqueidentifier,
--   @_at datetimeoffset = SYSDATETIMEOFFSET()
-- )
-- RETURNS nvarchar(max)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   DECLARE @@svc record;
--   DECLARE @@w record;
--   DECLARE @@cur record;
--   DECLARE @@nxt record;
--   DECLARE @@status nvarchar(450);
--   DECLARE @@is_avail bit = 0;
--   DECLARE @@atype nvarchar(450) = 'always_available';
--   DECLARE @@reminders bit = 1;
--   DECLARE @@prelim bit = 0;
--   DECLARE @@reason_en nvarchar(450);
--   DECLARE @@reason_ar nvarchar(450);
--   DECLARE @@msg_en nvarchar(450);
--   DECLARE @@msg_ar nvarchar(450);
--   DECLARE @@opens datetimeoffset;
--   DECLARE @@closes datetimeoffset;
--   DECLARE @@next_open datetimeoffset;
--   DECLARE @@next_close datetimeoffset;
--   DECLARE @@cur_id uniqueidentifier;
--   DECLARE @@next_id uniqueidentifier;
--   DECLARE @@has_windows bit = 0;

--   SELECT @svc = * FROM [dbo].[university_services] WHERE id = @_service_id;
--   IF  @svc IS NULL BEGIN
--     RETURN (SELECT @_service_id AS [service_id], 0 AS [exists], 0 AS [is_available], 'closed' AS [@status] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   IF  NOT @svc.is_active BEGIN
--     RETURN (SELECT @_service_id AS [service_id], 1 AS [exists], @svc.code AS [service_code], @svc.name_en AS [service_name_en], @svc.name_ar AS [service_name_ar], 0 AS [is_available], 'admin_disabled' AS [@status], 'admin_disabled' AS [availability_type], 0 AS [reminders_enabled], 0 AS [preliminary_check_allowed] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   -- blocking overrides first
--   SELECT @w = * FROM [dbo].[service_availability_windows]
--    WHERE service_id = @_service_id AND @status = 'active'
--      AND availability_type IN ('admin_disabled','temporarily_closed')
--    ORDER BY updated_at DESC ;
--   IF  @w.id IS NOT NULL BEGIN
--     RETURN (SELECT @_service_id AS [service_id], 1 AS [exists], @svc.code AS [service_code], @svc.name_en AS [service_name_en], @svc.name_ar AS [service_name_ar], 0 AS [is_available], CASE WHEN @w.availability_type = 'admin_disabled' THEN 'admin_disabled' ELSE 'temporarily_suspended' END AS [@status], @w.availability_type AS [availability_type], null AS [current_window_id], @w.opens_at AS [opens_at], @w.closes_at AS [closes_at], @w.opens_at AS [next_open_at], null AS [next_close_at], @w.@reason_en AS [@reason_en], @w.@reason_ar AS [@reason_ar], @w.student_message_en AS [student_message_en], @w.student_message_ar AS [student_message_ar], @w.reminders_enabled AS [reminders_enabled], @w.preliminary_check_allowed AS [preliminary_check_allowed], @w.timezone AS [timezone] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   SELECT @has_windows = EXISTS(SELECT 1 FROM [dbo].[service_availability_windows] WHERE service_id = @_service_id AND @status = 'active');

--   IF  NOT @has_windows BEGIN
--     RETURN (SELECT @_service_id AS [service_id], 1 AS [exists], @svc.code AS [service_code], @svc.name_en AS [service_name_en], @svc.name_ar AS [service_name_ar], 1 AS [is_available], 'always_available' AS [@status], 'always_available' AS [availability_type], 0 AS [reminders_enabled], 0 AS [preliminary_check_allowed], 'Asia/Dubai' AS [timezone] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   -- always available window wins
--   SELECT @w = * FROM [dbo].[service_availability_windows]
--    WHERE service_id = @_service_id AND @status = 'active' AND availability_type = 'always_available'
--    ;
--   IF  @w.id IS NOT NULL BEGIN
--     RETURN (SELECT @_service_id AS [service_id], 1 AS [exists], @svc.code AS [service_code], @svc.name_en AS [service_name_en], @svc.name_ar AS [service_name_ar], 1 AS [is_available], 'always_available' AS [@status], 'always_available' AS [availability_type], @w.id AS [current_window_id], 0 AS [reminders_enabled], @w.preliminary_check_allowed AS [preliminary_check_allowed], @w.timezone AS [timezone] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   SELECT @cur = * FROM [dbo].[service_availability_windows]
--    WHERE service_id = @_service_id AND @status = 'active'
--      AND opens_at IS NOT NULL AND opens_at <= @_at
--      AND (closes_at IS NULL OR closes_at > @_at)
--    ORDER BY opens_at DESC ;

--   SELECT @nxt = * FROM [dbo].[service_availability_windows]
--    WHERE service_id = @_service_id AND @status = 'active'
--      AND opens_at IS NOT NULL AND opens_at > @_at
--    ORDER BY opens_at ASC ;

--   IF  @cur.id IS NOT NULL BEGIN
--     SET @is_avail = 1;
--     SET @cur_id = @cur.id; SET @opens = @cur.opens_at; SET @closes = @cur.closes_at;
--     SET @atype = @cur.availability_type;
--     SET @reason_en = @cur.@reason_en; SET @reason_ar = @cur.@reason_ar;
--     SET @msg_en = @cur.student_message_en; SET @msg_ar = @cur.student_message_ar;
--     SET @prelim = @cur.preliminary_check_allowed; SET @reminders = 0;
--     SET @next_close = @cur.closes_at;
--     SET @status = CASE WHEN @cur.closes_at IS NOT NULL AND @cur.closes_at - @_at < interval '3 days'
--                    THEN 'closing_soon' ELSE 'open' END;
--   END ELSE BEGIN
--     SET @is_avail = 0;
--     IF  @nxt.id IS NOT NULL BEGIN
--       SET @next_open = @nxt.opens_at; SET @next_close = @nxt.closes_at;
--       SET @next_id = @nxt.id;
--       SET @atype = @nxt.availability_type;
--       SET @reason_en = @nxt.@reason_en; SET @reason_ar = @nxt.@reason_ar;
--       SET @msg_en = @nxt.student_message_en; SET @msg_ar = @nxt.student_message_ar;
--       SET @reminders = @nxt.reminders_enabled; SET @prelim = @nxt.preliminary_check_allowed;
--       SET @status = CASE WHEN @nxt.opens_at - @_at < interval '7 days' THEN 'opens_soon' ELSE 'closed' END;
--     END ELSE BEGIN
--       SELECT @w = * FROM [dbo].[service_availability_windows]
--         WHERE service_id = @_service_id AND @status = 'active'
--         ORDER BY COALESCE(closes_at, opens_at) DESC NULLS LAST ;
--       SET @reason_en = @w.@reason_en; SET @reason_ar = @w.@reason_ar;
--       SET @msg_en = @w.student_message_en; SET @msg_ar = @w.student_message_ar;
--       SET @reminders = 0; SET @prelim = COALESCE(@w.preliminary_check_allowed,0);
--       SET @atype = COALESCE(@w.availability_type,'date_range');
--       SET @status = 'closed';
--     END
--   END
--   RETURN (SELECT @_service_id AS [service_id], 1 AS [exists], @svc.code AS [service_code], @svc.name_en AS [service_name_en], @svc.name_ar AS [service_name_ar], @is_avail AS [is_available], @status AS [@status], @atype AS [availability_type], @cur_id AS [current_window_id], @next_id AS [next_window_id], @opens AS [opens_at], @closes AS [closes_at], @next_open AS [next_open_at], @next_close AS [next_close_at], @reason_en AS [@reason_en], @reason_ar AS [@reason_ar], @msg_en AS [student_message_en], @msg_ar AS [student_message_ar], @reminders AS [reminders_enabled], @prelim AS [preliminary_check_allowed], 'Asia/Dubai' AS [timezone] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- trigger function [dbo].[handle_new_user] inlined at CREATE TRIGGER


-- CREATE OR ALTER FUNCTION [dbo].[has_role](
--   @_user_id uniqueidentifier,
--   @_role nvarchar(64)
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id AND role = @_role)
--      AND (@_role = N'student' OR NOT [dbo].[is_access_revoked](@_user_id)));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[is_access_revoked](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[profiles] WHERE id = @_user_id AND access_revoked_at IS NOT NULL));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[is_housing_staff](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (
--     SELECT 1 FROM [dbo].[staff_profiles] sp
--     JOIN [dbo].[service_units] su ON su.id = sp.service_unit_id
--     WHERE sp.user_id = @_user_id AND su.code = 'HOUSING'
--   ) OR EXISTS (
--     SELECT 1 FROM [dbo].[service_staff] ss
--     JOIN [dbo].[service_units] su ON su.id = ss.service_unit_id
--     WHERE ss.staff_profile_id = @_user_id AND su.code = 'HOUSING'
--   ) OR EXISTS (
--     SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id AND role IN ('service_manager','system_admin')
--   ));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[is_internship_staff](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (
--     SELECT 1 FROM [dbo].[staff_profiles] sp
--     JOIN [dbo].[service_units] su ON su.id = sp.service_unit_id
--     WHERE sp.user_id = @_user_id AND su.code = 'CAREER'
--   ) OR EXISTS (
--     SELECT 1 FROM [dbo].[service_staff] ss
--     JOIN [dbo].[service_units] su ON su.id = ss.service_unit_id
--     WHERE ss.staff_profile_id = @_user_id AND su.code = 'CAREER'
--   ) OR EXISTS (
--     SELECT 1 FROM [dbo].[service_units] su
--     WHERE su.code = 'CAREER' AND su.primary_service_owner_id = @_user_id
--   ) OR EXISTS (
--     SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id AND role IN ('service_manager','system_admin')
--   ));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[is_manager](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id
--     AND role IN ('service_manager','system_admin'))
--    AND NOT [dbo].[is_access_revoked](@_user_id));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[is_staff](
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[user_roles] WHERE user_id = @_user_id
--     AND role IN ('service_officer','service_owner','service_manager','knowledge_manager','system_admin','auditor','leadership_viewer'))
--    AND NOT [dbo].[is_access_revoked](@_user_id));
-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[list_appointment_availability]
--   @_unit_code nvarchar(450) = NULL,
--   @_type_query nvarchar(450) = NULL,
--   @_from datetimeoffset = SYSDATETIMEOFFSET(),
--   @_to datetimeoffset = (SYSDATETIMEOFFSET() + N'30 days'),
--   @_limit int = 60
-- AS
-- BEGIN
--   SET NOCOUNT ON;

--   SELECT s.id, s.start_time, s.end_time, (s.capacity - s.booked_count),
--          t.id, t.name_en, t.name_ar, t.duration_minutes, t.location_type, t.requires_approval,
--          u.id, u.code, u.name_en, u.name_ar, COALESCE(u.contact_email, u.email),
--          sp.user_id, p.full_name, p.email,
--          s.location, s.meeting_link
--     FROM [dbo].[appointment_slots] s
--     JOIN [dbo].[appointment_types] t ON t.id = s.appointment_type_id
--     LEFT JOIN [dbo].[service_units] u ON u.id = t.service_unit_id
--     LEFT JOIN [dbo].[staff_profiles] sp ON sp.user_id = s.staff_profile_id
--     LEFT JOIN [dbo].[profiles] p ON p.id = s.staff_profile_id
--    WHERE [auth].[uid]() IS NOT NULL
--      AND s.status = 'open'
--      AND s.is_demo_record = 0
--      AND t.is_demo_record = 0
--      AND s.booked_count < s.capacity
--      AND t.is_active
--      AND s.start_time >= GREATEST(@_from, SYSDATETIMEOFFSET())
--      AND s.start_time <= @_to
--      AND (@_unit_code IS NULL OR u.code = @_unit_code)
--      AND (@_type_query IS NULL OR (t.name_en  +  ' '  +  t.name_ar) LIKE '%'  +  @_type_query  +  '%')
--    ORDER BY s.start_time
--    LIMIT GREATEST(1, LEAST(@_limit, 200));

-- END;
-- GO

-- trigger function [dbo].[log_service_availability_change] inlined at CREATE TRIGGER


-- CREATE OR ALTER PROCEDURE [dbo].[move_hostel_allocation]
--   @_allocation_id uniqueidentifier,
--   @_new_room_id uniqueidentifier,
--   @_reason nvarchar(450)
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@alloc public.housing_allocations;
--   DECLARE @@oldroom public.hostel_rooms;
--   DECLARE @@newroom public.hostel_rooms;

--   IF  NOT [dbo].[is_housing_staff]([auth].[uid]()) BEGIN
--     THROW 50000, 'Only housing staff can move an allocation', 1;
--   END
--   IF  @_reason IS NULL OR LEN(TRIM(@_reason)) < 5 BEGIN
--     THROW 50000, 'A reason is required to change an allocation', 1;
--   END
--   SELECT @alloc = * FROM [dbo].[housing_allocations] WHERE id = @_allocation_id FOR UPDATE;
--   IF @alloc IS NULL THEN THROW 50000, 'Allocation not found', 1; END IF;
--   IF @alloc.room_id = @_new_room_id THEN SELECT @alloc; END IF;

--   SELECT @newroom = * FROM [dbo].[hostel_rooms] WHERE id = @_new_room_id FOR UPDATE;
--   IF  @newroom IS NULL OR @newroom.available_beds < 1 BEGIN
--     THROW 50000, 'The selected room has no available bed', 1;
--   END
--   SELECT @oldroom = * FROM [dbo].[hostel_rooms] WHERE id = @alloc.room_id FOR UPDATE;

--   UPDATE [dbo].[hostel_rooms]
--      SET occupied_beds = GREATEST(occupied_beds - 1, 0),
--          available_beds = LEAST(capacity, capacity - GREATEST(occupied_beds - 1, 0)),
--          status = 'available'
--    WHERE id = @oldroom.id;
--   UPDATE [dbo].[hostels]
--      SET current_occupancy = GREATEST(current_occupancy - 1, 0),
--          available_capacity = LEAST(total_capacity, total_capacity - GREATEST(current_occupancy - 1, 0))
--    WHERE id = @oldroom.hostel_id;

--   UPDATE [dbo].[hostel_rooms]
--      SET occupied_beds = occupied_beds + 1,
--          available_beds = GREATEST(capacity - (occupied_beds + 1), 0),
--          status = CASE WHEN capacity - (occupied_beds + 1) <= 0 THEN 'full' ELSE 'available' END
--    WHERE id = @newroom.id;
--   UPDATE [dbo].[hostels]
--      SET current_occupancy = current_occupancy + 1,
--          available_capacity = GREATEST(total_capacity - (current_occupancy + 1), 0)
--    WHERE id = @newroom.hostel_id;

--   UPDATE [dbo].[housing_allocations]
--      SET hostel_id = @newroom.hostel_id, room_id = @newroom.id,
--          bed_label = @newroom.room_number  +  '-BED-'  +  (@newroom.occupied_beds + 1),
--          reviewed_by_owner_id = [auth].[uid](), reviewed_at = SYSDATETIMEOFFSET(), override_reason = @_reason
--    WHERE id = @alloc.id RETURNING * INTO @alloc;

--   UPDATE [dbo].[housing_applications]
--      SET final_hostel_id = @newroom.hostel_id, final_room_id = @newroom.id
--    WHERE id = @alloc.housing_application_id;

--   SELECT @alloc;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[my_appointments]
--   @_include_past bit = 0
-- AS
-- BEGIN
--   SET NOCOUNT ON;

--   SELECT a.id, a.confirmation_code, a.status, a.purpose,
--          s.id, s.start_time, s.end_time,
--          t.name_en, t.name_ar, t.location_type,
--          u.code, u.name_en, u.name_ar, COALESCE(u.contact_email, u.email),
--          p.full_name, p.email,
--          s.location, s.meeting_link
--     FROM [dbo].[student_appointments] a
--     JOIN [dbo].[appointment_slots] s ON s.id = a.appointment_slot_id
--     JOIN [dbo].[appointment_types] t ON t.id = s.appointment_type_id
--     LEFT JOIN [dbo].[service_units] u ON u.id = t.service_unit_id
--     LEFT JOIN [dbo].[profiles] p ON p.id = s.staff_profile_id
--    WHERE a.student_id = [auth].[uid]()
--      AND (@_include_past OR (s.start_time >= SYSDATETIMEOFFSET() - interval '1 day' AND a.status <> 'cancelled'))
--    ORDER BY s.start_time;

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[next_document_reference](
--   @_doc_code nvarchar(450)
-- )
-- RETURNS nvarchar(450)
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN ('UAEU-'  +  upper(@_doc_code)  +  '-'  +  to_char(SYSDATETIMEOFFSET(),'YYYY')  +  '-'
--        +  lpad(nextval('[dbo].[issued_document_seq]'), 6, '0'));
-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[owned_service_units]
--   @_user_id uniqueidentifier
-- AS
-- BEGIN
--   SET NOCOUNT ON;

--   SELECT sp.service_unit_id FROM [dbo].[staff_profiles] sp
--     WHERE sp.user_id = @_user_id AND sp.service_unit_id IS NOT NULL
--   UNION
--   SELECT o.service_unit_id FROM [dbo].[service_unit_owners] o
--     WHERE o.staff_profile_id = @_user_id
--       AND o.is_active
--       AND (o.ended_at IS NULL OR o.ended_at > SYSDATETIMEOFFSET());

-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[owns_case](
--   @_case_id uniqueidentifier,
--   @_user_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (EXISTS (SELECT 1 FROM [dbo].[cases] c WHERE c.id = @_case_id AND c.student_id = @_user_id));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[owns_service_unit](
--   @_user_id uniqueidentifier,
--   @_unit_id uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (@_unit_id IS NOT NULL
--      AND EXISTS (SELECT 1 FROM [dbo].[owned_service_units](@_user_id) u WHERE u.service_unit_id = @_unit_id));
-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[purge_expired_documents]
--   @_limit int = 200
-- AS
-- BEGIN
--   SET NOCOUNT ON;
-- SELECT QUERY
--   WITH due AS (
--     SELECT d.id, d.reference_number, d.file_path, d.document_type, d.student_id, d.issued_at,
--            CASE
--              WHEN d.deleted_by IS NOT NULL OR d.document_status = 'deleted_by_student'
--                THEN 'Student Requested'
--              WHEN d.document_status = 'revoked' THEN 'Administrator Action'
--              ELSE 'Automatic Retention Expiry'
--            END AS deletion_type
--       FROM [dbo].[issued_documents] d
--       LEFT JOIN [dbo].[document_retention_policies] p ON p.document_type = d.document_type
--      WHERE d.issued_at <= SYSDATETIMEOFFSET() - (COALESCE(p.retention_days, 30)  +  ' days')
--         -- legacy soft-deleted / expired rows are finished off so no letter lingers in limbo
--         OR d.deleted_at IS NOT NULL
--         OR d.document_status IN ('deleted_by_student', 'expired', 'revoked')
--      ORDER BY d.issued_at
--      LIMIT GREATEST(@_limit, 1)
--      FOR UPDATE OF d SKIP LOCKED
--   ), audit AS (
--     INSERT INTO [dbo].[document_deletion_records]
--       (document_id, reference_number, document_type, student_id, created_at, deleted_at, deletion_type, actor_type, actor_id)
--     SELECT due.id, due.reference_number, due.document_type, due.student_id, due.issued_at, SYSDATETIMEOFFSET(),
--            due.deletion_type,
--            CASE WHEN due.deletion_type = 'Student Requested' THEN 'student'
--                 WHEN due.deletion_type = 'Administrator Action' THEN 'human'
--                 ELSE 'system' END,
--            NULL
--       FROM due
--     ;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[purge_my_issued_document]
--   @_document_id uniqueidentifier
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@d public.issued_documents;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;

--   SELECT @d = * FROM [dbo].[issued_documents] WHERE id = @_document_id FOR UPDATE;
--   -- Same message for "not yours" and "already gone": no existence signal is leaked.
--   IF  @d.id IS NULL OR @d.student_id <> @uid BEGIN
--     THROW 50000, 'This document is not available.', 1;
--   END
--   INSERT INTO [dbo].[document_deletion_records]
--     (document_id, reference_number, document_type, student_id, created_at, deleted_at, deletion_type, actor_type, actor_id)
--   VALUES (@d.id, @d.reference_number, @d.document_type, @d.student_id, @d.issued_at, SYSDATETIMEOFFSET(), 'Student Requested', 'student', @uid)
--   ;

--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (@uid, 'document.permanently_deleted', 'issued_document', @d.id,
--           (SELECT @d.reference_number AS [reference], @d.document_type AS [documentType], 'Student Requested' AS [deletionType] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   UPDATE [dbo].[issued_documents] SET superseded_by = NULL WHERE superseded_by = @d.id;
--   DELETE FROM [dbo].[issued_documents] WHERE id = @d.id;

--   SELECT (SELECT @d.reference_number AS [reference], @d.file_path AS [filePath] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[remove_my_requests]
--   @_case_ids nvarchar(max) = NULL[],
--   @_scope nvarchar(450) = N'selected'
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_requested int = 0;
--   DECLARE @@_removed_ids nvarchar(max) = '{}';

--   IF  @_uid IS NULL BEGIN
--     THROW 50000, 'Unauthorized', 1;
--   END
--   IF  @_scope NOT IN ('selected', 'all_resolved') BEGIN
--     THROW 50000, 'Invalid scope', 1;
--   END
--   IF  @_scope = 'selected' BEGIN
--     SET @_requested = COALESCE(array_length(@_case_ids, 1), 0);
--     IF  @_requested = 0 BEGIN
--       SELECT (SELECT 0 AS [requested], 0 AS [removed], 0 AS [skipped] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--     END
--   END
--   WITH eligible AS (
--     SELECT c.id
--     FROM [dbo].[cases] c
--     WHERE c.student_id = @_uid
--       AND c.student_hidden_at IS NULL
--       AND c.status IN ('resolved', 'closed')
--       -- Complaints stay out of "remove all"; they can only be removed one by one.
--       AND (@_scope = 'selected' OR c.case_type <> 'complaint')
--       AND (@_scope <> 'selected' OR c.id = ANY(@_case_ids))
--     FOR UPDATE
--   ), updated AS (
--     UPDATE [dbo].[cases] c
--        SET student_hidden_at = SYSDATETIMEOFFSET(),
--            student_hidden_by = @_uid,
--            deletion_type = 'student_hidden'
--       FROM eligible e
--      WHERE c.id = e.id
--     RETURNING c.id
--   )
--   SELECT @_removed_ids = COALESCE(array_agg(id), '{}') FROM updated;

--   IF  @_scope <> 'selected' BEGIN
--     SET @_requested = COALESCE(array_length(@_removed_ids, 1), 0);
--   END
--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (
--     @_uid, 'STUDENT_REMOVE_REQUESTS', 'cases', @_uid,
--     (SELECT @_scope AS [scope], 'Student Requested' AS [reason], 'student_hidden' AS [removal_type], @_requested AS [requested_count], COALESCE(array_length(@_removed_ids, 1), 0) AS [removed_count], GREATEST(@_requested - COALESCE(array_length(@_removed_ids, 1), 0), 0) AS [skipped_count], CONVERT(nvarchar(max), @_removed_ids) AS [case_ids] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
--   );

--   SELECT (SELECT @_requested AS [requested], COALESCE(array_length(@_removed_ids, 1), 0) AS [removed], GREATEST(@_requested - COALESCE(array_length(@_removed_ids, 1), 0), 0) AS [skipped] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[remove_my_suggestions]
--   @_suggestion_ids nvarchar(max) = NULL[],
--   @_scope nvarchar(450) = N'selected'
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@_uid uniqueidentifier = [auth].[uid]();
--   DECLARE @@_requested int = 0;
--   DECLARE @@_removed_ids nvarchar(max) = '{}';

--   IF  @_uid IS NULL BEGIN
--     THROW 50000, 'Unauthorized', 1;
--   END
--   IF  @_scope NOT IN ('selected', 'all_suggestions') BEGIN
--     THROW 50000, 'Invalid scope', 1;
--   END
--   IF  @_scope = 'selected' BEGIN
--     SET @_requested = COALESCE(array_length(@_suggestion_ids, 1), 0);
--     IF  @_requested = 0 BEGIN
--       SELECT (SELECT 0 AS [requested], 0 AS [removed], 0 AS [skipped] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--     END
--   END
--   WITH eligible AS (
--     SELECT s.id
--     FROM [dbo].[suggestions] s
--     WHERE s.student_id = @_uid
--       AND s.student_hidden_at IS NULL
--       -- Suggestions inside an active review/implementation workflow stay visible.
--       AND s.status IN ('draft', 'submitted', 'implemented', 'closed', 'not_proceeding')
--       AND (@_scope <> 'selected' OR s.id = ANY(@_suggestion_ids))
--     FOR UPDATE
--   ), updated AS (
--     UPDATE [dbo].[suggestions] s
--        SET student_hidden_at = SYSDATETIMEOFFSET(),
--            student_hidden_by = @_uid,
--            deletion_type = 'student_hidden'
--       FROM eligible e
--      WHERE s.id = e.id
--     RETURNING s.id
--   )
--   SELECT @_removed_ids = COALESCE(array_agg(id), '{}') FROM updated;

--   IF  @_scope <> 'selected' BEGIN
--     SET @_requested = COALESCE(array_length(@_removed_ids, 1), 0);
--   END
--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (
--     @_uid, 'STUDENT_REMOVE_SUGGESTIONS', 'suggestions', @_uid,
--     (SELECT @_scope AS [scope], 'Student Requested' AS [reason], 'student_hidden' AS [removal_type], @_requested AS [requested_count], COALESCE(array_length(@_removed_ids, 1), 0) AS [removed_count], GREATEST(@_requested - COALESCE(array_length(@_removed_ids, 1), 0), 0) AS [skipped_count], CONVERT(nvarchar(max), @_removed_ids) AS [suggestion_ids] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
--   );

--   SELECT (SELECT @_requested AS [requested], COALESCE(array_length(@_removed_ids, 1), 0) AS [removed], GREATEST(@_requested - COALESCE(array_length(@_removed_ids, 1), 0), 0) AS [skipped] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[reschedule_appointment_booking]
--   @_appointment_id uniqueidentifier,
--   @_new_slot_id uniqueidentifier
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@a public.student_appointments;
--   DECLARE @@olds public.appointment_slots;
--   DECLARE @@news public.appointment_slots;
--   DECLARE @@t public.appointment_types;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;

--   SELECT @a = * FROM [dbo].[student_appointments]
--    WHERE id = @_appointment_id AND student_id = @uid FOR UPDATE;
--   IF @a.id IS NULL THEN THROW 50000, 'APPOINTMENT_NOT_FOUND', 1; END IF;
--   IF @a.status IN ('cancelled','completed') THEN THROW 50000, 'APPOINTMENT_NOT_ACTIVE', 1; END IF;
--   IF @a.appointment_slot_id = @_new_slot_id THEN THROW 50000, 'SAME_SLOT', 1; END IF;

--   SELECT @news = * FROM [dbo].[appointment_slots] WHERE id = @_new_slot_id FOR UPDATE;
--   IF @news.id IS NULL THEN THROW 50000, 'SLOT_NOT_FOUND', 1; END IF;
--   IF @news.status <> 'open' OR @news.booked_count >= @news.capacity THEN THROW 50000, 'SLOT_UNAVAILABLE', 1; END IF;
--   IF @news.start_time <= SYSDATETIMEOFFSET() THEN THROW 50000, 'SLOT_IN_PAST', 1; END IF;

--   SELECT @olds = * FROM [dbo].[appointment_slots] WHERE id = @a.appointment_slot_id FOR UPDATE;

--   IF EXISTS (SELECT 1 FROM [dbo].[student_appointments] x
--                JOIN [dbo].[appointment_slots] xs ON xs.id = x.appointment_slot_id
--               WHERE x.student_id = @uid AND x.id <> @a.id
--                 AND x.status NOT IN ('cancelled','completed')
--                 AND xs.start_time < @news.end_time AND xs.end_time > @news.start_time) THEN
--     THROW 50000, 'CONFLICTING_APPOINTMENT', 1;
--   END
--   SELECT @t = * FROM [dbo].[appointment_types] WHERE id = @news.appointment_type_id;

--   UPDATE [dbo].[appointment_slots]
--      SET booked_count = GREATEST(0, booked_count - 1),
--          status = CASE WHEN status = 'booked' THEN 'open' ELSE status END
--    WHERE id = @olds.id;

--   UPDATE [dbo].[appointment_slots]
--      SET booked_count = booked_count + 1,
--          status = CASE WHEN booked_count + 1 >= capacity THEN 'booked' ELSE status END
--    WHERE id = @news.id;

--   UPDATE [dbo].[student_appointments]
--      SET appointment_slot_id = @news.id,
--          status = CASE WHEN COALESCE(@t.requires_approval, 0) THEN 'pending' ELSE 'confirmed' END
--    WHERE id = @a.id
--    RETURNING * INTO @a;

--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (@uid, 'appointment.rescheduled', 'student_appointments', @a.id,
--     (SELECT @olds.id AS [from_slot], @news.id AS [to_slot], @a.confirmation_code AS [confirmation_code] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @a;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[reserve_hostel_bed]
--   @_application_id uniqueidentifier,
--   @_room_id uniqueidentifier,
--   @_move_in date,
--   @_agent_run_id uniqueidentifier = NULL,
--   @_allocated_by nvarchar(450) = N'agent'
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@app public.housing_applications;
--   DECLARE @@room public.hostel_rooms;
--   DECLARE @@alloc public.housing_allocations;
--   DECLARE @@hst public.hostels;
--   DECLARE @@num nvarchar(450);

--   SELECT @app = * FROM [dbo].[housing_applications] WHERE id = @_application_id FOR UPDATE;
--   IF @app IS NULL THEN THROW 50000, 'Housing application not found', 1; END IF;
--   IF  @app.student_id <> [auth].[uid]() AND NOT [dbo].[is_housing_staff]([auth].[uid]()) BEGIN
--     THROW 50000, 'Not authorised for this housing application', 1;
--   END
--   SELECT @room = * FROM [dbo].[hostel_rooms] WHERE id = @_room_id FOR UPDATE;
--   IF  @room IS NULL OR @room.available_beds < 1 OR @room.status <> 'available' BEGIN
--     THROW 50000, 'BED_UNAVAILABLE', 1;
--   END
--   SELECT @hst = * FROM [dbo].[hostels] WHERE id = @room.hostel_id FOR UPDATE;
--   IF  @hst.id IS NULL OR NOT @hst.is_active OR @hst.available_capacity < 1 BEGIN
--     THROW 50000, 'HOSTEL_UNAVAILABLE', 1;
--   END
--   IF EXISTS (SELECT 1 FROM [dbo].[housing_allocations]
--              WHERE student_id = @app.student_id AND allocation_status IN ('reserved','active')) THEN
--     THROW 50000, 'DUPLICATE_ALLOCATION', 1;
--   END
--   SET @num = 'ALLOC-DEMO-'  +  to_char(SYSDATETIMEOFFSET(),'YYYY')  +  '-'  +  lpad(nextval('[dbo].[housing_allocation_seq]'), 4, '0');

--   INSERT INTO [dbo].[housing_allocations] (
--     allocation_number, housing_application_id, student_id, hostel_id, room_id, bed_label,
--     allocation_status, move_in_date, allocated_by_type, allocated_by_agent_run_id
--   ) VALUES (
--     @num, @app.id, @app.student_id, @room.hostel_id, @room.id,
--     @room.room_number  +  '-BED-'  +  (@room.occupied_beds + 1),
--     'reserved', @_move_in, @_allocated_by, @_agent_run_id
--   ) RETURNING * INTO @alloc;

--   UPDATE [dbo].[hostel_rooms]
--      SET occupied_beds = occupied_beds + 1,
--          available_beds = GREATEST(capacity - (occupied_beds + 1), 0),
--          status = CASE WHEN capacity - (occupied_beds + 1) <= 0 THEN 'full' ELSE 'available' END
--    WHERE id = @room.id;

--   UPDATE [dbo].[hostels]
--      SET current_occupancy = current_occupancy + 1,
--          available_capacity = GREATEST(total_capacity - (current_occupancy + 1), 0)
--    WHERE id = @room.hostel_id;

--   UPDATE [dbo].[housing_applications]
--      SET final_hostel_id = @room.hostel_id, final_room_id = @room.id,
--          application_status = 'registered', registered_at = SYSDATETIMEOFFSET(),
--          submitted_at = COALESCE(submitted_at, SYSDATETIMEOFFSET())
--    WHERE id = @app.id;

--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES ([auth].[uid](), 'housing.bed_reserved', 'housing_allocations', @alloc.id,
--     (SELECT @num AS [allocation_number], @room.id AS [room_id], @room.hostel_id AS [hostel_id], @room.available_beds AS [beds_before], GREATEST(@room.capacity - (@room.occupied_beds + 1), 0) AS [beds_after], @app.id AS [application_id], @_allocated_by AS [allocated_by] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @alloc;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[reserve_internship_seat]
--   @_opportunity_id uniqueidentifier,
--   @_match_score numeric = NULL,
--   @_match_explanation_id uniqueidentifier = NULL,
--   @_agent_run_id uniqueidentifier = NULL,
--   @_assigned_by nvarchar(450) = N'agent'
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@opp public.internship_opportunities;
--   DECLARE @@org public.internship_organizations;
--   DECLARE @@a public.internship_assignments;
--   DECLARE @@uid uniqueidentifier = [auth].[@uid]();
--   DECLARE @@seats_before int;
--   DECLARE @@owner_id uniqueidentifier;

--   IF @uid IS NULL THEN THROW 50000, 'Not authenticated', 1; END IF;

--   IF EXISTS (SELECT 1 FROM [dbo].[internship_assignments]
--              WHERE student_id = @uid
--                AND assignment_status IN ('reserved','assigned','confirmed','registered','human_review')) THEN
--     THROW 50000, 'DUPLICATE_ASSIGNMENT', 1;
--   END
--   SELECT @opp = * FROM [dbo].[internship_opportunities] WHERE id = @_opportunity_id FOR UPDATE;
--   IF  @opp IS NULL OR @opp.active_status <> 'active' BEGIN
--     THROW 50000, 'OPPORTUNITY_CLOSED', 1;
--   END
--   IF  @opp.available_seats < 1 BEGIN
--     THROW 50000, 'SEATS_FULL', 1;
--   END
--   SET @seats_before = @opp.available_seats;

--   SELECT @org = * FROM [dbo].[internship_organizations] WHERE id = @opp.organization_id;
--   SELECT @owner_id = primary_service_owner_id FROM [dbo].[service_units] WHERE code = 'CAREER';

--   UPDATE [dbo].[internship_opportunities]
--      SET assigned_seats = assigned_seats + 1
--    WHERE id = @opp.id;

--   INSERT INTO [dbo].[internship_assignments] (
--     assignment_number, student_id, opportunity_id, organization_id, match_score, match_explanation_id,
--     assignment_status, assigned_by_type, assigned_by_agent_run_id, student_confirmed_at, assigned_at,
--     internship_start_date, internship_end_date, internship_course_id,
--     course_registration_status, employer_acceptance_status, owner_review_status,
--     service_owner_id, requires_human_review, @seats_before, seats_after
--   ) VALUES (
--     'INT-DEMO-'  +  to_char(SYSDATETIMEOFFSET(),'YYYY')  +  '-'  +  lpad(nextval('[dbo].[internship_assignment_seq]'), 4, '0'),
--     @uid, @opp.id, @opp.organization_id, @_match_score, @_match_explanation_id,
--     CASE WHEN @opp.requires_employer_review THEN 'reserved' ELSE 'assigned' END,
--     @_assigned_by, @_agent_run_id, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(),
--     @opp.start_date, @opp.end_date, @opp.internship_course_id,
--     'not_started',
--     CASE WHEN @opp.requires_employer_review THEN 'pending' ELSE 'not_required' END,
--     CASE WHEN @opp.requires_employer_review THEN 'pending' ELSE 'not_required' END,
--     @owner_id, @opp.requires_employer_review, @seats_before, @seats_before - 1
--   ) RETURNING * INTO @a;

--   INSERT INTO [dbo].[internship_assignment_audit] (assignment_id, student_id, event_type, actor_type, actor_id, details)
--   VALUES (@a.id, @uid, 'seat_reserved', @_assigned_by, @uid,
--     (SELECT @opp.opportunity_code AS [opportunity], @org.name_en AS [organization], @_match_score AS [match_score], @seats_before AS [@seats_before], @seats_before - 1 AS [seats_after] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   INSERT INTO [dbo].[audit_logs] (actor_id, action, entity_type, entity_id, metadata)
--   VALUES (@uid, 'internship.seat_reserved', 'internship_assignments', @a.id,
--     (SELECT @a.assignment_number AS [assignment_number], @opp.id AS [opportunity_id], @seats_before AS [@seats_before], @seats_before - 1 AS [seats_after], @_assigned_by AS [assigned_by] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   SELECT @a;

-- END;
-- GO

-- CREATE OR ALTER PROCEDURE [dbo].[search_knowledge_passages]
--   @p_query nvarchar(450),
--   @p_lang nvarchar(450) = N'en',
--   @p_clearance int = 1,
--   @p_domain nvarchar(450) = NULL,
--   @p_limit int = 5,
--   @p_candidates int = 40,
--   @p_section_terms nvarchar(max) = N'[]',
--   @p_query_embedding nvarchar(450) = NULL
-- AS
-- BEGIN
--   SET NOCOUNT ON;

-- WITH q AS (
--   SELECT
--     coalesce(
--       to_tsquery('simple', nullif(array_to_string(ARRAY(
--         SELECT DISTINCT lex FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(@p_query, '')))) AS lex
--         WHERE LEN(lex) > 2
--       ), ' | '), '')),
--       N''
--     ) AS tsq,
--     ARRAY(
--       SELECT DISTINCT lex FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(@p_query, '')))) AS lex
--       WHERE LEN(lex) > 2
--     ) AS words,
--     lower(coalesce(@p_query, '')) AS raw,
--     CONVERT(date, SYSDATETIMEOFFSET()) AS today,
--     ARRAY(SELECT lower(t) FROM unnest(coalesce(@p_section_terms, N'[]')) AS t WHERE LEN(t) > 2) AS sect,
--     nullif(TRIM(coalesce(@p_query_embedding, '')), '') AS qvec,
--     CASE
--       WHEN @p_clearance >= 4 THEN N'["public","student_authenticated","staff_only","restricted","highly_restricted"]'
--       WHEN @p_clearance = 3 THEN N'["public","student_authenticated","staff_only","restricted"]'
--       WHEN @p_clearance = 2 THEN N'["public","student_authenticated","staff_only"]'
--       ELSE N'["public","student_authenticated"]'
--     END AS allowed
-- ),
-- chunks AS (
--   SELECT
--     N'document' AS source_type,
--     d.id AS source_id,
--     c.id AS chunk_id,
--     d.title,
--     c.section_title,
--     left(c.content, 900) AS snippet,
--     d.citation_url,
--     CASE WHEN @p_lang = 'ar' THEN u.name_ar ELSE u.name_en END AS owning_unit,
--     d.version,
--     d.effective_date,
--     d.confidentiality_level AS confidentiality,
--     coalesce(d.knowledge_domain, 'general') AS knowledge_domain,
--     d.language AS language,
--     d.document_type,
--     c.page_number,
--     ts_rank_cd(c.search_vector, q.tsq, 32) AS lexical_score,
--     word_similarity(q.raw, left(c.content, 2000)) AS fuzzy_score,
--     (CASE WHEN q.qvec IS NOT NULL AND c.embedding IS NOT NULL
--           THEN greatest(0, 1 - (c.embedding <=> q.qvec)) ELSE 0 END) AS semantic_score,
--     (CASE d.document_type
--        WHEN 'policy' THEN 1.0 WHEN 'regulation' THEN 1.0
--        WHEN 'procedure' THEN 0.9 WHEN 'guide' THEN 0.8
--        WHEN 'service_guide' THEN 0.8 ELSE 0.7 END) AS authority,
--     0 AS stale
--   FROM [dbo].[document_chunks] c
--   JOIN [dbo].[knowledge_documents] d ON d.id = c.document_id
--   LEFT JOIN [dbo].[service_units] u ON u.id = coalesce(d.owner_unit_id, d.service_unit_id)
--   CROSS JOIN q
--   WHERE c.is_active
--     AND d.is_active AND d.deleted_at IS NULL
--     AND d.approval_status = 'approved'
--     AND d.is_current
--     AND d.superseded_by_document_id IS NULL
--     AND (d.effective_date IS NULL OR d.effective_date <= q.today)
--     AND (d.expiry_date IS NULL OR d.expiry_date >= q.today)
--     AND d.confidentiality_level = ANY (q.allowed)
--     AND (@p_domain IS NULL OR coalesce(d.knowledge_domain, 'general') IN (@p_domain, 'general'))
--     AND (c.search_vector @@ q.tsq
--          OR word_similarity(q.raw, left(c.content, 2000)) > 0.3
--          OR (q.qvec IS NOT NULL AND c.embedding IS NOT NULL AND (c.embedding <=> q.qvec) < 0.62)
--          OR EXISTS (SELECT 1 FROM unnest(q.sect) AS t
--                     WHERE lower(coalesce(c.section_title, '')) LIKE '%'  +  t  +  '%'
--                        OR lower(coalesce(c.section_path, '')) LIKE '%'  +  t  +  '%'))
-- ),
-- faqs AS (
--   SELECT
--     N'faq', f.id, NULL,
--     CASE WHEN @p_lang = 'ar' THEN f.question_ar ELSE f.question_en END,
--     f.source_section,
--     left(CASE WHEN @p_lang = 'ar' THEN f.answer_ar ELSE f.answer_en END, 900),
--     NULL,
--     CASE WHEN @p_lang = 'ar' THEN u.name_ar ELSE u.name_en END,
--     NULL,
--     f.effective_date,
--     N'student_authenticated',
--     coalesce(f.knowledge_domain, 'general'),
--     @p_lang,
--     N'faq',
--     NULL,
--     ts_rank_cd(f.search_vector, q.tsq, 32),
--     word_similarity(q.raw, coalesce(f.question_en, '')  +  ' '  +  coalesce(f.question_ar, '')),
--     0,
--     0.6,
--     0
--   FROM [dbo].[faq_items] f
--   CROSS JOIN q
--   LEFT JOIN [dbo].[service_units] u ON u.id = f.service_unit_id
--   WHERE f.is_active
--     AND f.approval_status = 'approved'
--     AND (f.effective_date IS NULL OR f.effective_date <= q.today)
--     AND (f.expiry_date IS NULL OR f.expiry_date >= q.today)
--     AND (@p_domain IS NULL OR coalesce(f.knowledge_domain, 'general') IN (@p_domain, 'general'))
--     AND (f.search_vector @@ q.tsq
--          OR word_similarity(q.raw, coalesce(f.question_en, '')  +  ' '  +  coalesce(f.question_ar, '')) > 0.35)
-- ),
-- webs AS (
--   SELECT
--     N'web_source', w.id, wc.id,
--     coalesce(wc.page_title, w.title),
--     wc.section_title,
--     left(wc.content, 900),
--     wc.source_url,
--     CASE WHEN @p_lang = 'ar' THEN u.name_ar ELSE u.name_en END,
--     NULL, NULL,
--     w.confidentiality_level,
--     coalesce(w.knowledge_domain, 'general'),
--     wc.language,
--     N'web_page',
--     NULL,
--     ts_rank_cd(wc.search_vector, q.tsq, 32),
--     word_similarity(q.raw, left(wc.content, 2000)),
--     (CASE WHEN q.qvec IS NOT NULL AND wc.embedding IS NOT NULL
--           THEN greatest(0, 1 - (wc.embedding <=> q.qvec)) ELSE 0 END),
--     0.85,
--     (w.change_detected
--       OR w.last_successful_fetch_at IS NULL
--       OR w.last_successful_fetch_at < SYSDATETIMEOFFSET() - interval '120 days')
--   FROM [dbo].[web_page_chunks] wc
--   JOIN [dbo].[web_knowledge_sources] w ON w.id = wc.web_source_id
--   CROSS JOIN q
--   LEFT JOIN [dbo].[service_units] u ON u.id = w.owner_unit_id
--   WHERE wc.is_active
--     AND w.is_active
--     AND w.approval_status = 'approved'
--     AND w.confidentiality_level = ANY (q.allowed)
--     AND (@p_domain IS NULL OR coalesce(w.knowledge_domain, 'general') IN (@p_domain, 'general'))
--     AND (wc.search_vector @@ q.tsq
--          OR word_similarity(q.raw, left(wc.content, 2000)) > 0.3
--          OR (q.qvec IS NOT NULL AND wc.embedding IS NOT NULL AND (wc.embedding <=> q.qvec) < 0.62)
--          OR EXISTS (SELECT 1 FROM unnest(q.sect) AS t
--                     WHERE lower(coalesce(wc.section_title, '')) LIKE '%'  +  t  +  '%'))
-- ),
-- unioned AS (
--   SELECT * FROM chunks
--   UNION ALL SELECT * FROM faqs
--   UNION ALL SELECT * FROM webs
-- ),
-- scored AS (
--   SELECT
--     u.*,
--     (
--       0.24 * least(coalesce(u.lexical_score, 0), 1.0)
--       + 0.20 * (
--           SELECT coalesce(
--             count(*) FILTER (
--               WHERE position(w IN lower(coalesce(u.title,'')  +  ' '  +  coalesce(u.section_title,'')  +  ' '  +  coalesce(u.snippet,''))) > 0
--             ) / nullif(count(*), 0), 0)
--           FROM unnest(q.words) AS w
--         )
--       + 0.10 * least(coalesce(u.fuzzy_score, 0), 1.0)
--       + 0.22 * least(coalesce(u.semantic_score, 0), 1.0)
--       + 0.18 * u.authority
--       + CASE WHEN u.language = @p_lang THEN 0.05 ELSE 0 END
--       + CASE WHEN u.chunk_id IS NOT NULL THEN 0.03 ELSE 0 END
--       + CASE WHEN u.section_title IS NOT NULL AND EXISTS (
--                SELECT 1 FROM unnest(q.sect) AS t WHERE lower(u.section_title) LIKE '%'  +  t  +  '%')
--              THEN 0.45 ELSE 0 END
--       - CASE WHEN array_length(q.sect, 1) IS NOT NULL
--                   AND NOT EXISTS (SELECT 1 FROM unnest(q.sect) AS t
--                                   WHERE lower(coalesce(u.section_title,'')) LIKE '%'  +  t  +  '%'
--                                      OR lower(coalesce(u.title,'')) LIKE '%'  +  t  +  '%')
--              THEN 0.12 ELSE 0 END
--       + CASE WHEN u.section_title IS NOT NULL AND EXISTS (
--                SELECT 1 FROM unnest(q.words) AS w WHERE position(w IN lower(u.section_title)) > 0)
--              THEN 0.10 ELSE 0 END
--       - CASE WHEN u.stale THEN 0.15 ELSE 0 END
--       - CASE
--           WHEN u.effective_date IS NOT NULL
--             THEN least(greatest((CONVERT(date, SYSDATETIMEOFFSET()) - u.effective_date) / 3650.0, 0), 0.05)
--           ELSE 0.02 END
--     ) AS score
--   FROM unioned u CROSS JOIN q
-- )
-- SELECT
--   s.source_type, s.source_id, s.chunk_id, s.title, s.section_title, s.snippet,
--   s.citation_url, s.owning_unit, s.version, s.effective_date, s.confidentiality,
--   s.knowledge_domain, s.language, s.document_type, s.page_number,
--   s.lexical_score, s.fuzzy_score, s.semantic_score, s.authority, s.score, s.stale
-- FROM (SELECT * FROM scored ORDER BY score DESC LIMIT @p_candidates) s
-- ORDER BY s.score DESC
-- LIMIT @p_limit;

-- END;
-- GO

-- trigger function [dbo].[set_case_number] inlined at CREATE TRIGGER


-- trigger function [dbo].[set_suggestion_number] inlined at CREATE TRIGGER


-- CREATE OR ALTER FUNCTION [dbo].[staff_can_view_profile](
--   @_viewer uniqueidentifier,
--   @_profile uniqueidentifier
-- )
-- RETURNS bit
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN ([dbo].[has_role](@_viewer, 'system_admin')
--     OR [dbo].[has_role](@_viewer, 'auditor')
--     OR EXISTS (
--       SELECT 1
--       FROM [dbo].[cases] c
--       WHERE c.student_id = @_profile
--         AND (
--           c.assigned_to = @_viewer
--           OR [dbo].[owns_service_unit](@_viewer, c.service_unit_id)
--           OR (
--             c.assigned_to IS NULL
--             AND (
--               c.service_unit_id = [dbo].[staff_unit](@_viewer)
--               OR EXISTS (
--                 SELECT 1 FROM [dbo].[staff_profiles] sp
--                 WHERE sp.user_id = @_viewer AND sp.service_unit_id = c.service_unit_id AND sp.is_active
--               )
--               OR EXISTS (
--                 SELECT 1
--                 FROM [dbo].[service_staff] ss
--                 JOIN [dbo].[staff_profiles] sp ON sp.user_id = ss.staff_profile_id
--                 WHERE sp.user_id = @_viewer AND ss.service_unit_id = c.service_unit_id AND ss.is_active
--               )
--             )
--           )
--         )
--     ));
-- END;
-- GO

-- CREATE OR ALTER FUNCTION [dbo].[staff_unit](
--   @_user_id uniqueidentifier
-- )
-- RETURNS uniqueidentifier
-- WITH EXECUTE AS OWNER
-- AS
-- BEGIN
--   RETURN (service_unit_id FROM [dbo].[staff_profiles] WHERE user_id = @_user_id);
-- END;
-- GO

-- trigger function [dbo].[tombstone_document_verification] inlined at CREATE TRIGGER


-- trigger function [dbo].[track_case_responsibility] inlined at CREATE TRIGGER


-- trigger function [dbo].[update_updated_at_column] inlined at CREATE TRIGGER


-- CREATE OR ALTER PROCEDURE [dbo].[verify_student_document]
--   @_token nvarchar(450),
--   @_client_hash nvarchar(450)
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   DECLARE @@d public.issued_documents;
--   DECLARE @@display_name nvarchar(450);
--   DECLARE @@parts nvarchar(max);
--   DECLARE @@effective_status nvarchar(450);
--   DECLARE @@thash nvarchar(450) = encode(sha256(convert_to(COALESCE(@_token,''), 'UTF8')), 'hex');
--   DECLARE @@chash nvarchar(450) = left(COALESCE(NULLIF(TRIM(@_client_hash), ''), 'unknown'), 128);
--   DECLARE @@per_minute int;
--   DECLARE @@per_hour int;
--   DECLARE @@tomb public.document_verification_tombstones;

--   SELECT @per_minute = count(*) FROM [dbo].[document_verification_attempts]
--    WHERE client_hash = @chash AND created_at > SYSDATETIMEOFFSET() - interval '1 minute';
--   SELECT @per_hour = count(*) FROM [dbo].[document_verification_attempts]
--    WHERE client_hash = @chash AND created_at > SYSDATETIMEOFFSET() - interval '1 hour';

--   IF  @per_minute >= 10 OR @per_hour >= 60 BEGIN
--     INSERT INTO [dbo].[document_verification_attempts] (token_hash, client_hash, outcome)
--     VALUES (@thash, @chash, 'rate_limited');
--     SELECT (SELECT 0 AS [found], 1 AS [rateLimited] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   IF  @_token IS NULL OR LEN(@_token) < 32 OR @_token !~ '^[A-Za-z0-9_-]+$' OR @_token LIKE 'burned-%' BEGIN
--     INSERT INTO [dbo].[document_verification_attempts] (token_hash, client_hash, outcome)
--     VALUES (@thash, @chash, 'malformed');
--     SELECT (SELECT 0 AS [found] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   SELECT @d = * FROM [dbo].[issued_documents] WHERE secure_verification_token = @_token;
--   IF  @d.id IS NULL BEGIN
--     SELECT @tomb = * FROM [dbo].[document_verification_tombstones] WHERE token_hash = @thash;
--     IF  @tomb.token_hash IS NOT NULL BEGIN
--       INSERT INTO [dbo].[document_verification_attempts] (token_hash, client_hash, outcome)
--       VALUES (@thash, @chash, 'unavailable');
--       SELECT (SELECT 1 AS [found], 'unavailable' AS [status] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--     END
--     INSERT INTO [dbo].[document_verification_attempts] (token_hash, client_hash, outcome)
--     VALUES (@thash, @chash, 'not_found');
--     SELECT (SELECT 0 AS [found] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   SET @effective_status = CASE
--       WHEN @d.document_status = 'deleted_by_student' OR @d.deleted_by IS NOT NULL THEN 'withdrawn'
--       WHEN @d.verification_status = 'revoked' OR @d.document_status = 'revoked' THEN 'withdrawn'
--       WHEN @d.document_status = 'expired' THEN 'expired'
--       WHEN @d.retention_expires_at IS NOT NULL AND @d.retention_expires_at < SYSDATETIMEOFFSET() THEN 'expired'
--       WHEN @d.expires_at IS NOT NULL AND @d.expires_at < SYSDATETIMEOFFSET() THEN 'expired'
--       ELSE @d.document_status END;

--   UPDATE [dbo].[issued_documents]
--      SET verification_count = verification_count + 1,
--          secure_verification_token = CASE
--            WHEN @effective_status <> 'valid'
--              THEN 'burned-'  +  replace(NEWID(), '-', '')
--            ELSE secure_verification_token END
--    WHERE id = @d.id;

--   IF  @effective_status <> 'valid' BEGIN
--     INSERT INTO [dbo].[document_verification_tombstones] (token_hash, reference_number, reason)
--     VALUES (@thash, @d.reference_number, @effective_status)
--     ;
--   END
--   INSERT INTO [dbo].[document_events] (document_id, reference_number, event_type, actor_type, details)
--   VALUES (@d.id, @d.reference_number, 'verified', 'public',
--           (SELECT @effective_status AS [status], @chash AS [client] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

--   INSERT INTO [dbo].[document_verification_attempts] (token_hash, client_hash, outcome)
--   VALUES (@thash, @chash, @effective_status);

--   IF  @effective_status <> 'valid' BEGIN
--     SELECT (SELECT 1 AS [found], 'unavailable' AS [status], @d.reference_number AS [reference] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
--   END
--   SET @parts = string_to_array(TRIM(COALESCE(JSON_VALUE(@d.snapshot, '$.studentName'),'')), ' ');
--   SET @display_name = COALESCE(JSON_VALUE(@d.snapshot, '$.studentName'),'');
--   IF  array_length(@parts,1) > 2 BEGIN
--     SET @display_name = @parts[1]  +  ' '  +  left(@parts[2],1)  +  '. '  +  @parts[array_length(@parts,1)];
--   END
--   SELECT (SELECT 1 AS [found], 'valid' AS [status], @d.document_type AS [documentType], @d.title_en AS [titleEn], @d.title_ar AS [titleAr], @d.reference_number AS [reference], @display_name AS [studentName], JSON_VALUE(@d.snapshot, '$.studentNameAr') AS [studentNameAr], JSON_VALUE(@d.snapshot, '$.programmeEn') AS [programme], JSON_VALUE(@d.snapshot, '$.programmeAr') AS [programmeAr], JSON_VALUE(@d.snapshot, '$.collegeEn') AS [college], JSON_VALUE(@d.snapshot, '$.collegeAr') AS [collegeAr], @d.issued_at AS [issuedAt], @d.retention_expires_at AS [expiresAt], @d.language AS [language], @d.document_hash AS [documentHash], @d.digitally_signed AS [digitallySigned], @d.is_demo_document AS [isDemoDocument] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

-- END;
-- GO


-- ========== VIEWS ==========

--
-- Name: case_monitor_v; Type: VIEW; Schema: public; Owner: -
--

-- CREATE OR ALTER VIEW [dbo].[case_monitor_v] AS
--  WITH base AS (
--          SELECT c.id,
--             c.case_number,
--             c.case_type,
--             c.title,
--             c.status,
--             c.urgency,
--             c.severity,
--             c.service_unit_id,
--             c.assigned_to,
--             c.student_id,
--             c.created_at,
--             c.updated_at,
--             c.last_activity_at,
--             c.escalation_level,
--             c.escalated_at,
--             c.acknowledged_at,
--             c.reopened_count,
--             c.is_sensitive,
--             c.sensitivity_level,
--             c.resolved_at,
--             c.closed_at,
--             c.resolution_communicated_at,
--             c.response_state,
--             c.sla_paused_at,
--             c.sla_paused_minutes,
--             c.first_response_due_at,
--             c.resolution_due_at,
--             c.due_at,
--             c.routing_service_code,
--             c.routing_topic,
--             c.root_cause_code,
--             c.next_action_en,
--             c.next_action_ar,
--             c.alert_type,
--             c.automation_level,
--             COALESCE(c.current_responsible_actor, N'ai') AS actor,
--             COALESCE(c.responsible_since, c.last_activity_at, c.created_at) AS responsible_since,
--             u.name_en AS unit_name_en,
--             u.name_ar AS unit_name_ar,
--             u.code AS unit_code,
--             ap.full_name AS owner_name,
--             spf.full_name AS student_name,
--             sp.student_number,
--             COALESCE(r.owner_response_hours, 8) AS owner_response_hours,
--             COALESCE(r.stall_hours, 24) AS stall_hours,
--             COALESCE(r.pause_on_student, 1) AS pause_on_student,
--             (((c.status) IN (N'closed', N'resolved', N'withdrawn', N'rejected', N'duplicate')) OR (c.closed_at IS NOT NULL)) AS is_closed
--            FROM ((((([dbo].[cases] c
--              LEFT JOIN [dbo].[service_units] u ON ((u.id = c.service_unit_id)))
--              LEFT JOIN [dbo].[profiles] ap ON ((ap.id = c.assigned_to)))
--              LEFT JOIN [dbo].[profiles] spf ON ((spf.id = c.student_id)))
--              LEFT JOIN [dbo].[student_profiles] sp ON ((sp.user_id = c.student_id)))
--              LEFT JOIN LATERAL ( SELECT s.owner_response_hours,
--                     s.stall_hours,
--                     s.pause_on_student
--                    FROM [dbo].[service_level_rules] s
--                   WHERE ((s.case_type = c.case_type) AND ((s.service_unit_id = c.service_unit_id) OR (s.service_unit_id IS NULL)) AND ((s.urgency = c.urgency) OR (s.urgency IS NULL)))
--                   ORDER BY (s.service_unit_id IS NOT NULL) DESC, (s.urgency IS NOT NULL) DESC
--                  LIMIT 1) r ON (1))
--           WHERE (c.deleted_at IS NULL)
--         ), derived AS (
--          SELECT b.id,
--             b.case_number,
--             b.case_type,
--             b.title,
--             b.status,
--             b.urgency,
--             b.severity,
--             b.service_unit_id,
--             b.assigned_to,
--             b.student_id,
--             b.created_at,
--             b.updated_at,
--             b.last_activity_at,
--             b.escalation_level,
--             b.escalated_at,
--             b.acknowledged_at,
--             b.reopened_count,
--             b.is_sensitive,
--             b.sensitivity_level,
--             b.resolved_at,
--             b.closed_at,
--             b.resolution_communicated_at,
--             b.response_state,
--             b.sla_paused_at,
--             b.sla_paused_minutes,
--             b.first_response_due_at,
--             b.resolution_due_at,
--             b.due_at,
--             b.routing_service_code,
--             b.routing_topic,
--             b.root_cause_code,
--             b.next_action_en,
--             b.next_action_ar,
--             b.alert_type,
--             b.automation_level,
--             b.actor,
--             b.responsible_since,
--             b.unit_name_en,
--             b.unit_name_ar,
--             b.unit_code,
--             b.owner_name,
--             b.student_name,
--             b.student_number,
--             b.owner_response_hours,
--             b.stall_hours,
--             b.pause_on_student,
--             b.is_closed,
--             COALESCE(b.resolution_due_at, b.due_at) AS sla_due_at,
--             ((b.sla_paused_at IS NOT NULL) OR (b.pause_on_student AND (b.actor = N'student'))) AS sla_paused,
--                 CASE
--                     WHEN (b.actor IN (N'service_owner', N'specific_officer', N'manager', N'staff')) THEN (b.responsible_since + make_interval(hours => b.owner_response_hours))
--                     ELSE NULL
--                 END AS owner_response_due_at,
--             GREATEST(0, (DATEDIFF_BIG(SECOND, '19700101', (SYSDATETIMEOFFSET() - b.responsible_since)))) AS waiting_seconds,
--             GREATEST(0, (DATEDIFF_BIG(SECOND, '19700101', (SYSDATETIMEOFFSET() - COALESCE(b.last_activity_at, b.created_at))))) AS inactive_seconds
--            FROM base b
--         )
--  SELECT id,
--     case_number,
--     case_type,
--     title,
--     status,
--     urgency,
--     severity,
--     service_unit_id,
--     assigned_to,
--     student_id,
--     created_at,
--     updated_at,
--     last_activity_at,
--     escalation_level,
--     escalated_at,
--     acknowledged_at,
--     reopened_count,
--     is_sensitive,
--     sensitivity_level,
--     resolved_at,
--     closed_at,
--     resolution_communicated_at,
--     response_state,
--     sla_paused_at,
--     sla_paused_minutes,
--     first_response_due_at,
--     resolution_due_at,
--     due_at,
--     routing_service_code,
--     routing_topic,
--     root_cause_code,
--     next_action_en,
--     next_action_ar,
--     alert_type,
--     automation_level,
--     actor,
--     responsible_since,
--     unit_name_en,
--     unit_name_ar,
--     unit_code,
--     owner_name,
--     student_name,
--     student_number,
--     owner_response_hours,
--     stall_hours,
--     pause_on_student,
--     is_closed,
--     sla_due_at,
--     sla_paused,
--     owner_response_due_at,
--     waiting_seconds,
--     inactive_seconds,
--         CASE
--             WHEN is_closed THEN N'completed'
--             WHEN sla_paused THEN N'paused'
--             WHEN (sla_due_at IS NULL) THEN N'on_track'
--             WHEN (SYSDATETIMEOFFSET() > sla_due_at) THEN N'breached'
--             WHEN (SYSDATETIMEOFFSET() > (sla_due_at - ((sla_due_at - created_at) * 0.10 precision))) THEN N'critical'
--             WHEN (SYSDATETIMEOFFSET() > (sla_due_at - ((sla_due_at - created_at) * 0.25 precision))) THEN N'attention'
--             ELSE N'on_track'
--         END AS sla_status,
--         CASE
--             WHEN ((sla_due_at IS NOT NULL) AND (SYSDATETIMEOFFSET() > sla_due_at) AND (NOT is_closed)) THEN (DATEDIFF_BIG(SECOND, '19700101', (SYSDATETIMEOFFSET() - sla_due_at)))
--             ELSE 0
--         END AS breach_seconds,
--     ((owner_response_due_at IS NOT NULL) AND (SYSDATETIMEOFFSET() > owner_response_due_at) AND (NOT is_closed)) AS response_overdue,
--     ((NOT is_closed) AND (inactive_seconds > (stall_hours * 3600))) AS stalled,
--     ((((status) IN (N'resolved', N'closed')) OR (resolved_at IS NOT NULL)) AND (resolution_communicated_at IS NULL)) AS closure_incomplete,
--     (((case_type) = N'alert') AND (COALESCE(severity, (urgency)) IN (N'critical', N'high')) AND (acknowledged_at IS NULL) AND (NOT is_closed)) AS critical_alert,
--     ((COALESCE(escalation_level, 0) > 0) AND (NOT is_closed) AND (acknowledged_at IS NULL)) AS escalation_unresolved
--    FROM derived d;
-- GO

--
-- Name: staff_workload_summary; Type: VIEW; Schema: public; Owner: -
--

-- CREATE OR ALTER VIEW [dbo].[staff_workload_summary] AS
--  SELECT sp.user_id AS staff_profile_id,
--     sp.service_unit_id,
--     count(c.id) FILTER (WHERE (c.status NOT IN (N'resolved', N'closed'))) AS active_cases,
--     count(c.id) FILTER (WHERE ((c.status NOT IN (N'resolved', N'closed')) AND (c.resolution_due_at < SYSDATETIMEOFFSET()))) AS overdue_cases,
--     count(c.id) FILTER (WHERE ((c.status NOT IN (N'resolved', N'closed')) AND (c.urgency IN (N'high', N'critical')))) AS high_priority_cases,
--     GREATEST(0, (15 - count(c.id) FILTER (WHERE (c.status NOT IN (N'resolved', N'closed'))))) AS available_capacity,
--     max(c.created_at) AS last_assignment_at
--    FROM ([dbo].[staff_profiles] sp
--      LEFT JOIN [dbo].[cases] c ON ((c.assigned_to = sp.user_id)))
--   GROUP BY sp.user_id, sp.service_unit_id;
-- GO


-- ========== TRIGGERS ==========

-- CREATE OR ALTER TRIGGER [emergency_contacts_updated_at] ON [dbo].[emergency_contacts]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[emergency_contacts] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_data_authority_rules] ON [dbo].[data_authority_rules]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[data_authority_rules] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_integration_connectors] ON [dbo].[integration_connectors]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[integration_connectors] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_integration_field_mappings] ON [dbo].[integration_field_mappings]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[integration_field_mappings] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_integration_tools] ON [dbo].[integration_tools]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[integration_tools] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_knowledge_approval_requests] ON [dbo].[knowledge_approval_requests]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[knowledge_approval_requests] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_knowledge_document_categories] ON [dbo].[knowledge_document_categories]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[knowledge_document_categories] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_knowledge_gaps] ON [dbo].[knowledge_gaps]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[knowledge_gaps] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_structured_data_sources] ON [dbo].[structured_data_sources]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[structured_data_sources] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [set_updated_at_web_knowledge_sources] ON [dbo].[web_knowledge_sources]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[web_knowledge_sources] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_actionapp_updated] ON [dbo].[action_approvals]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[action_approvals] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_agent_tools_updated] ON [dbo].[agent_tools]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[agent_tools] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_ai_settings_updated] ON [dbo].[ai_settings]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[ai_settings] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_alerts_updated] ON [dbo].[alerts]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[alerts] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_approval_requests_updated] ON [dbo].[approval_requests]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[approval_requests] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_appt_types_updated] ON [dbo].[appointment_types]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[appointment_types] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_automation_policies_updated] ON [dbo].[automation_policies]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[automation_policies] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_availability_rules_updated] ON [dbo].[staff_availability_rules]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[staff_availability_rules] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_campuses_updated] ON [dbo].[campuses]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[campuses] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_career_profiles_updated] ON [dbo].[student_career_profiles]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[student_career_profiles] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_career_roles_updated] ON [dbo].[career_roles]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[career_roles] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_career_weight_profiles_updated] ON [dbo].[career_matching_weight_profiles]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[career_matching_weight_profiles] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_case_automation_state_updated] ON [dbo].[case_automation_state]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[case_automation_state] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_case_number] ON [dbo].[cases]
-- AFTER INSERT
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET case_number = CONCAT('C', RIGHT('000000' + CAST(NEXT VALUE FOR [dbo].[case_number_seq] AS varchar(12)), 6))
--   FROM [dbo].[cases] t INNER JOIN inserted i ON i.id = t.id
--   WHERE t.case_number IS NULL OR t.case_number = '';
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_case_resolutions_updated] ON [dbo].[case_resolutions]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[case_resolutions] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_cases_updated] ON [dbo].[cases]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[cases] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_colleges_updated] ON [dbo].[colleges]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[colleges] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_conv_state_updated] ON [dbo].[conversation_state]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[conversation_state] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_conv_updated] ON [dbo].[conversations]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[conversations] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_courses_updated] ON [dbo].[courses]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[courses] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_degradation_updated] ON [dbo].[service_degradation_state]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_degradation_state] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_document_templates_updated] ON [dbo].[document_templates]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[document_templates] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_eb_updated] ON [dbo].[emergency_broadcasts]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[emergency_broadcasts] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_email_templates_updated] ON [dbo].[email_templates]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[email_templates] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_follow_up_policies_updated] ON [dbo].[follow_up_policies]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[follow_up_policies] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_holds_updated] ON [dbo].[student_holds]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[student_holds] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_hostel_rooms_updated] ON [dbo].[hostel_rooms]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[hostel_rooms] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_hostels_updated] ON [dbo].[hostels]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[hostels] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_housing_allocations_updated] ON [dbo].[housing_allocations]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[housing_allocations] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_housing_applications_updated] ON [dbo].[housing_applications]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[housing_applications] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_housing_prefs_updated] ON [dbo].[student_housing_preferences]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[student_housing_preferences] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_housing_rules_updated] ON [dbo].[housing_eligibility_rules]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[housing_eligibility_rules] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_housing_waitlist_updated] ON [dbo].[housing_waitlist]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[housing_waitlist] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_ict_updated] ON [dbo].[intercollege_transfer_requests]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[intercollege_transfer_requests] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_info_requests_updated] ON [dbo].[case_information_requests]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[case_information_requests] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_internship_assignments_updated] ON [dbo].[internship_assignments]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[internship_assignments] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_internship_opps_updated] ON [dbo].[internship_opportunities]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[internship_opportunities] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_internship_orgs_updated] ON [dbo].[internship_organizations]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[internship_organizations] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_internship_waitlist_updated] ON [dbo].[internship_waitlist]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[internship_waitlist] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_issued_documents_updated] ON [dbo].[issued_documents]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[issued_documents] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_kdoc_updated] ON [dbo].[knowledge_documents]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[knowledge_documents] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_model_routing_updated] ON [dbo].[model_routing_rules]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[model_routing_rules] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_nd_updated] ON [dbo].[notification_deliveries]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[notification_deliveries] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_net_updated] ON [dbo].[notification_event_types]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[notification_event_types] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_notifprefs_updated] ON [dbo].[notification_preferences]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[notification_preferences] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_owner_ai_prefs_updated] ON [dbo].[service_owner_ai_preferences]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_owner_ai_preferences] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_perf_budgets_updated] ON [dbo].[performance_budgets]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[performance_budgets] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_profiles_updated] ON [dbo].[profiles]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[profiles] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_prog_equiv_updated] ON [dbo].[programme_course_equivalencies]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[programme_course_equivalencies] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_programs_updated] ON [dbo].[academic_programs]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[academic_programs] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_prompt_versions_updated] ON [dbo].[agent_prompt_versions]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[agent_prompt_versions] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_quality_targets_updated] ON [dbo].[quality_targets]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[quality_targets] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_receipts_updated] ON [dbo].[action_receipts]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[action_receipts] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_release_readiness_updated] ON [dbo].[release_readiness]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[release_readiness] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_revalidation_policies_updated] ON [dbo].[action_revalidation_policies]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[action_revalidation_policies] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_routing_rules_updated] ON [dbo].[routing_rules]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[routing_rules] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- -- -- Name: service_availability_windows trg_saw_audit; Type: TRIGGER; Schema: public; Owner: - -- CREATE TRIGGER trg_saw_audit AFTER INSERT OR DELETE OR UPDATE ON public.service_availability_windows FOR EACH ROW EXECUTE FUNCTION public.log_service_availability_change();


-- CREATE OR ALTER TRIGGER [trg_saw_updated] ON [dbo].[service_availability_windows]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_availability_windows] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_sections_updated] ON [dbo].[course_sections]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[course_sections] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_service_improvements_updated] ON [dbo].[service_improvements]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_improvements] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_service_staff_updated] ON [dbo].[service_staff]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_staff] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_service_unit_owners_updated] ON [dbo].[service_unit_owners]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_unit_owners] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_slots_updated] ON [dbo].[appointment_slots]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[appointment_slots] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_sreq_updated] ON [dbo].[student_requirements]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[student_requirements] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_student_internship_prefs_updated] ON [dbo].[student_internship_preferences]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[student_internship_preferences] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_suggestion_number] ON [dbo].[suggestions]
-- AFTER INSERT
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET suggestion_number = CONCAT('S', RIGHT('000000' + CAST(NEXT VALUE FOR [dbo].[suggestion_number_seq] AS varchar(12)), 6))
--   FROM [dbo].[suggestions] t INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_suggestions_updated] ON [dbo].[suggestions]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[suggestions] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_terms_bilingual_updated] ON [dbo].[bilingual_terms]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[bilingual_terms] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_terms_updated] ON [dbo].[academic_terms]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[academic_terms] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_tombstone_document_verification] ON [dbo].[issued_documents]
-- AFTER DELETE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   -- original trigger function: public.tombstone_document_verification — same event and table
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_track_case_responsibility_ins] ON [dbo].[cases]
-- AFTER INSERT
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   -- original trigger function: public.track_case_responsibility — same event and table
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_track_case_responsibility_upd] ON [dbo].[cases]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   -- original trigger function: public.track_case_responsibility — same event and table
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_transfer_capacity_updated] ON [dbo].[programme_transfer_capacity]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[programme_transfer_capacity] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_universities_updated] ON [dbo].[universities]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[universities] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [trg_uservices_updated] ON [dbo].[university_services]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[university_services] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_appointment_requests_updated_at] ON [dbo].[appointment_requests]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[appointment_requests] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_case_monitor_grants_updated_at] ON [dbo].[case_monitor_grants]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[case_monitor_grants] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_program_basket_courses_updated_at] ON [dbo].[program_basket_courses]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[program_basket_courses] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_program_requirement_baskets_updated_at] ON [dbo].[program_requirement_baskets]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[program_requirement_baskets] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_service_owner_action_permissions_updated_at] ON [dbo].[service_owner_action_permissions]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[service_owner_action_permissions] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_university_colleges_updated_at] ON [dbo].[university_colleges]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[university_colleges] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO

-- CREATE OR ALTER TRIGGER [update_web_source_pages_updated_at] ON [dbo].[web_source_pages]
-- AFTER UPDATE
-- AS
-- BEGIN
--   SET NOCOUNT ON;
--   UPDATE t SET updated_at = SYSDATETIMEOFFSET()
--   FROM [dbo].[web_source_pages] t
--   INNER JOIN inserted i ON i.id = t.id;
-- END;
-- GO


-- ========== RLS POLICIES (predicates preserved) ==========

BEGIN TRAN;

INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Administrators and auditors read issued documents', N'dbo.issued_documents', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''auditor'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Administrators read document events', N'dbo.document_events', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''auditor'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Administrators revoke issued documents', N'dbo.issued_documents', N'FOR UPDATE TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage AI settings', N'dbo.ai_settings', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage basket courses', N'dbo.program_basket_courses', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage baskets', N'dbo.program_requirement_baskets', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage emergency contacts', N'dbo.emergency_contacts', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage evaluation scenarios', N'dbo.evaluation_scenarios', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage matching weights', N'dbo.career_matching_weight_profiles', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage monitoring grants', N'dbo.case_monitor_grants', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage prompt versions', N'dbo.agent_prompt_versions', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage retention policies', N'dbo.document_retention_policies', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage templates', N'dbo.document_templates', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[can_manage_knowledge]([auth].[uid]()))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[can_manage_knowledge]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins manage tools', N'dbo.agent_tools', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Admins record evaluation runs', N'dbo.evaluation_runs', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Authenticated can read retention policies', N'dbo.document_retention_policies', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Authenticated users can read active transfer capacity', N'dbo.programme_transfer_capacity', N'FOR SELECT TO authenticated USING ((is_active OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Authenticated users read templates', N'dbo.document_templates', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Basket courses are readable by signed-in users', N'dbo.program_basket_courses', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Baskets are readable by signed-in users', N'dbo.program_requirement_baskets', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Career staff read shared career profiles', N'dbo.student_career_profiles', N'FOR SELECT TO authenticated USING ((shared_with_counsellor AND [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Knowledge managers maintain colleges', N'dbo.university_colleges', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Knowledge managers manage crawled pages', N'dbo.web_source_pages', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Knowledge managers manage web passages', N'dbo.web_page_chunks', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Managers manage career roles', N'dbo.career_roles', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Managers read exception events', N'dbo.exception_events', N'FOR SELECT TO authenticated USING ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Monitors read oversight actions', N'dbo.case_oversight_actions', N'FOR SELECT TO authenticated USING (([dbo].[can_monitor_cases]([auth].[uid]()) OR [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Monitors record oversight actions', N'dbo.case_oversight_actions', N'FOR INSERT TO authenticated WITH CHECK (((actor_id = [auth].[uid]()) AND [dbo].[can_monitor_cases]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Owners manage their conversation state', N'dbo.conversation_state', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Owners read their tool executions', N'dbo.agent_tool_executions', N'FOR SELECT TO authenticated USING (((requested_by_profile_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Owners record their tool executions', N'dbo.agent_tool_executions', N'FOR INSERT TO authenticated WITH CHECK ((requested_by_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Owners update their tool executions', N'dbo.agent_tool_executions', N'FOR UPDATE TO authenticated USING ((requested_by_profile_id = [auth].[uid]())) WITH CHECK ((requested_by_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Signed-in users can read active emergency contacts', N'dbo.emergency_contacts', N'FOR SELECT TO authenticated USING (is_active);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Signed-in users can read verified colleges', N'dbo.university_colleges', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Signed-in users read active career roles', N'dbo.career_roles', N'FOR SELECT TO authenticated USING ((active OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff and case participants read responsibility history', N'dbo.case_responsibility_history', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff can view crawled pages', N'dbo.web_source_pages', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff can view web passages', N'dbo.web_page_chunks', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff manage transfer capacity', N'dbo.programme_transfer_capacity', N'TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read AI settings', N'dbo.ai_settings', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read ats scoring profiles', N'dbo.ats_scoring_profiles', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read career matching weights', N'dbo.career_matching_weight_profiles', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read conversation state', N'dbo.conversation_state', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read evaluation runs', N'dbo.evaluation_runs', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read evaluation scenarios', N'dbo.evaluation_scenarios', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read field provenance', N'dbo.student_field_provenance', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read handovers for cases they may access', N'dbo.case_handovers', N'FOR SELECT TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read internship matching weights', N'dbo.internship_matching_weights', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read prompt versions', N'dbo.agent_prompt_versions', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff read the tool catalogue', N'dbo.agent_tools', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff review verification attempts', N'dbo.document_verification_attempts', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Staff update receipts', N'dbo.action_receipts', N'FOR UPDATE TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Student or responsible staff update the request', N'dbo.appointment_requests', N'FOR UPDATE TO authenticated USING (((student_id = [auth].[uid]()) OR ((case_id IS NOT NULL) AND [dbo].[can_access_case](case_id, [auth].[uid]())))) WITH CHECK (((student_id = [auth].[uid]()) OR ((case_id IS NOT NULL) AND [dbo].[can_access_case](case_id, [auth].[uid]()))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students create their own appointment requests', N'dbo.appointment_requests', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students create their receipts', N'dbo.action_receipts', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students delete their own career analysis versions', N'dbo.career_analysis_versions', N'FOR DELETE TO authenticated USING ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students manage their own ATS scores', N'dbo.cv_ats_scores', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students manage their own CVs', N'dbo.student_cv_documents', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students manage their own career matches', N'dbo.career_role_matches', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students manage their own career profile', N'dbo.student_career_profiles', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read own document events', N'dbo.document_events', N'FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM [dbo].[issued_documents] d
  WHERE ((d.id = document_events.document_id) AND (d.student_id = [auth].[uid]())))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read own issued documents', N'dbo.issued_documents', N'FOR SELECT TO authenticated USING ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read their own appointment requests', N'dbo.appointment_requests', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR ((case_id IS NOT NULL) AND [dbo].[can_access_case](case_id, [auth].[uid]()))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read their own career analysis history', N'dbo.career_analysis_versions', N'FOR SELECT TO authenticated USING ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read their own career events', N'dbo.career_counselling_events', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_manager]([auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read their own deletion records', N'dbo.document_deletion_records', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read their own field provenance', N'dbo.student_field_provenance', N'FOR SELECT TO authenticated USING ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students read their receipts', N'dbo.action_receipts', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students record their own CV scans', N'dbo.cv_upload_scans', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students record their own career analysis versions', N'dbo.career_analysis_versions', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students see their own CV scans', N'dbo.cv_upload_scans', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Students write their own career events', N'dbo.career_counselling_events', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'Users read their own monitoring grant', N'dbo.case_monitor_grants', N'FOR SELECT TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admin manage alert rules', N'dbo.alert_rules', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admin manage roles', N'dbo.user_roles', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admin manage staff profiles', N'dbo.staff_profiles', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage alert conditions', N'dbo.alert_rule_conditions', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage appt types', N'dbo.appointment_types', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage availability', N'dbo.service_availability_windows', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage availability rules', N'dbo.staff_availability_rules', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage calendar exceptions', N'dbo.calendar_exceptions', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage calendars', N'dbo.working_calendars', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage campuses', N'dbo.campuses', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage categories', N'dbo.case_categories', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage colleges', N'dbo.colleges', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage courses', N'dbo.courses', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage degradation', N'dbo.service_degradation_state', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage deliveries', N'dbo.notification_deliveries', N'FOR UPDATE TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage departments', N'dbo.departments', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage escalation policies', N'dbo.escalation_policies', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage impact baselines', N'dbo.service_impact_baselines', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage prereqs', N'dbo.course_prerequisites', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage program courses', N'dbo.program_courses', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage programs', N'dbo.academic_programs', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage revalidation policies', N'dbo.action_revalidation_policies', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage routing rules', N'dbo.model_routing_rules', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage routing rules', N'dbo.routing_rules', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage sections', N'dbo.course_sections', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage service reqs', N'dbo.service_requirements', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage service staff', N'dbo.service_staff', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage service unit owners', N'dbo.service_unit_owners', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage services', N'dbo.university_services', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage slots', N'dbo.appointment_slots', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage templates', N'dbo.notification_templates', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage terms', N'dbo.academic_terms', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage units', N'dbo.service_units', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage universities', N'dbo.universities', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins manage workflow steps', N'dbo.service_workflow_steps', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins read deliveries', N'dbo.notification_deliveries', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''service_manager'') OR [dbo].[has_role]([auth].[uid](), N''leadership_viewer'') OR [dbo].[has_role]([auth].[uid](), N''auditor'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins write course history', N'dbo.student_course_history', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'admins write enrollments', N'dbo.student_current_enrollments', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'append internship audit', N'dbo.internship_assignment_audit', N'FOR INSERT TO authenticated WITH CHECK (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'auditors read audit logs', N'dbo.audit_logs', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''auditor'') OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'availability readable by signed-in users', N'dbo.service_availability_windows', N'FOR SELECT TO authenticated USING ((student_visible OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'broadcasts managed by admins', N'dbo.emergency_broadcasts', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'broadcasts readable by oversight', N'dbo.emergency_broadcasts', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''leadership_viewer'') OR [dbo].[has_role]([auth].[uid](), N''auditor'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case assignments read', N'dbo.case_assignments', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case assignments write', N'dbo.case_assignments', N'TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]()))) WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case comments read', N'dbo.case_comments', N'FOR SELECT TO authenticated USING (([dbo].[can_access_case](case_id, [auth].[uid]()) AND ((NOT is_internal) OR [dbo].[is_staff]([auth].[uid]()))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case comments write', N'dbo.case_comments', N'FOR INSERT TO authenticated WITH CHECK (((author_id = [auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]()) AND ((NOT is_internal) OR [dbo].[is_staff]([auth].[uid]()))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case escalations read', N'dbo.case_escalations', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case escalations write', N'dbo.case_escalations', N'FOR INSERT TO authenticated WITH CHECK (((raised_by = [auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case evidence read', N'dbo.case_evidence', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case evidence write', N'dbo.case_evidence', N'FOR INSERT TO authenticated WITH CHECK (((uploaded_by = [auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case history access', N'dbo.case_status_history', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case history write', N'dbo.case_status_history', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'case participants read automation state', N'dbo.case_automation_state', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'categories managed by knowledge managers', N'dbo.knowledge_document_categories', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'categories readable by signed-in users', N'dbo.knowledge_document_categories', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'clear own transfer impact', N'dbo.intercollege_transfer_course_impact', N'FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM [dbo].[intercollege_transfer_requests] r
  WHERE ((r.id = intercollege_transfer_course_impact.transfer_request_id) AND (r.student_id = [auth].[uid]()) AND (r.transfer_status <> N''completed'')))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'dispatch state managed by admins', N'dbo.notification_dispatch_state', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'dispatch state readable by admins', N'dbo.notification_dispatch_state', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''service_manager'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'email templates managed by admins', N'dbo.email_templates', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'email templates readable by staff', N'dbo.email_templates', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'event types managed by admins', N'dbo.notification_event_types', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'event types readable by staff', N'dbo.notification_event_types', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'group members managed by admins', N'dbo.notification_group_members', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'group members readable by admins', N'dbo.notification_group_members', N'FOR SELECT TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''leadership_viewer'') OR (user_id = [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'groups managed by admins', N'dbo.notification_groups', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'groups readable by staff', N'dbo.notification_groups', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'hostels readable by signed-in users', N'dbo.hostels', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'housing staff manage hostels', N'dbo.hostels', N'TO authenticated USING ([dbo].[is_housing_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_housing_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'housing staff manage rooms', N'dbo.hostel_rooms', N'TO authenticated USING ([dbo].[is_housing_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_housing_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'housing staff read preferences', N'dbo.student_housing_preferences', N'FOR SELECT TO authenticated USING ([dbo].[is_housing_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'housing staff update allocations', N'dbo.housing_allocations', N'FOR UPDATE TO authenticated USING ([dbo].[is_housing_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_housing_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'housing staff update waitlist', N'dbo.housing_waitlist', N'FOR UPDATE TO authenticated USING ([dbo].[is_housing_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_housing_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'info requests readable by participants', N'dbo.case_information_requests', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'insert audit logs', N'dbo.audit_logs', N'FOR INSERT TO authenticated WITH CHECK ((actor_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'insert own acknowledgements', N'dbo.intercollege_transfer_acknowledgements', N'FOR INSERT TO authenticated WITH CHECK (((student_id = [auth].[uid]()) AND (EXISTS ( SELECT 1
   FROM [dbo].[intercollege_transfer_requests] r
  WHERE ((r.id = intercollege_transfer_acknowledgements.transfer_request_id) AND (r.student_id = [auth].[uid]()) AND (r.transfer_status <> N''completed''))))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'insert own match explanations', N'dbo.internship_match_explanations', N'FOR INSERT TO authenticated WITH CHECK (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'insert own profile', N'dbo.profiles', N'FOR INSERT TO authenticated WITH CHECK ((id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write data_authority_rules', N'dbo.data_authority_rules', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write integration_connectors', N'dbo.integration_connectors', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write integration_field_mappings', N'dbo.integration_field_mappings', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write integration_health_events', N'dbo.integration_health_events', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write integration_schema_versions', N'dbo.integration_schema_versions', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write integration_test_runs', N'dbo.integration_test_runs', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write integration_tools', N'dbo.integration_tools', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'integration admins write structured_data_sources', N'dbo.structured_data_sources', N'TO authenticated USING ([dbo].[can_manage_integrations]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_integrations]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship opportunities readable by signed-in users', N'dbo.internship_opportunities', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship orgs readable by signed-in users', N'dbo.internship_organizations', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship staff manage opportunities', N'dbo.internship_opportunities', N'TO authenticated USING ([dbo].[is_internship_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_internship_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship staff manage orgs', N'dbo.internship_organizations', N'TO authenticated USING ([dbo].[is_internship_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_internship_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship staff manage weights', N'dbo.internship_matching_weights', N'TO authenticated USING ([dbo].[is_internship_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_internship_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship staff update assignments', N'dbo.internship_assignments', N'FOR UPDATE TO authenticated USING ([dbo].[is_internship_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_internship_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'internship staff update waitlist', N'dbo.internship_waitlist', N'FOR UPDATE TO authenticated USING ([dbo].[is_internship_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_internship_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'join own internship waitlist', N'dbo.internship_waitlist', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'km manage chunks', N'dbo.document_chunks', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin''))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'km manage docs', N'dbo.knowledge_documents', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin''))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'km manage faq', N'dbo.faq_items', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin''))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'km manage sources', N'dbo.knowledge_sources', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin''))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'km manage versions', N'dbo.document_versions', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin''))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''knowledge_manager'') OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write knowledge_approval_requests', N'dbo.knowledge_approval_requests', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write knowledge_conflicts', N'dbo.knowledge_conflicts', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write knowledge_gaps', N'dbo.knowledge_gaps', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write knowledge_issue_reports', N'dbo.knowledge_issue_reports', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write service_knowledge_health', N'dbo.service_knowledge_health', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write web_knowledge_sources', N'dbo.web_knowledge_sources', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'knowledge managers write web_source_changes', N'dbo.web_source_changes', N'TO authenticated USING ([dbo].[can_manage_knowledge]([auth].[uid]())) WITH CHECK ([dbo].[can_manage_knowledge]([auth].[uid]()));');
GO
-- -- -- Name: library_search_events library_events_insert_own; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_events_insert_own ON public.library_search_events FOR INSERT TO authenticated WITH CHECK ((student_id = auth.uid()));

-- -- -- Name: library_search_events library_events_staff_read; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_events_staff_read ON public.library_search_events FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'system_admin'::public.app_role) OR public.has_role(auth.uid(), 'service_manager'::public.app_role) OR public.has_role(auth.uid(), 'service_owner'::public.app_role) OR public.has_role(auth.uid(), 'integration_admin'::public.app_role)));

-- -- -- Name: library_hours_exceptions library_exceptions_admin; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_exceptions_admin ON public.library_hours_exceptions TO authenticated USING (public.has_role(auth.uid(), 'system_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'system_admin'::public.app_role));

-- -- -- Name: library_hours_exceptions library_exceptions_read; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_exceptions_read ON public.library_hours_exceptions FOR SELECT TO authenticated USING (true);

-- -- -- Name: library_opening_hours library_hours_admin; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_hours_admin ON public.library_opening_hours TO authenticated USING (public.has_role(auth.uid(), 'system_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'system_admin'::public.app_role));

-- -- -- Name: library_opening_hours library_hours_read; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_hours_read ON public.library_opening_hours FOR SELECT TO authenticated USING (true);

-- -- -- Name: library_locations library_locations_admin; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_locations_admin ON public.library_locations TO authenticated USING (public.has_role(auth.uid(), 'system_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'system_admin'::public.app_role));

-- -- -- Name: library_locations library_locations_read; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_locations_read ON public.library_locations FOR SELECT TO authenticated USING (true);

-- -- -- Name: library_provider_settings library_provider_admin; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_provider_admin ON public.library_provider_settings TO authenticated USING ((public.has_role(auth.uid(), 'system_admin'::public.app_role) OR public.has_role(auth.uid(), 'integration_admin'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'system_admin'::public.app_role) OR public.has_role(auth.uid(), 'integration_admin'::public.app_role)));

-- -- -- Name: library_services library_services_admin; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_services_admin ON public.library_services TO authenticated USING (public.has_role(auth.uid(), 'system_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'system_admin'::public.app_role));

-- -- -- Name: library_services library_services_read; Type: POLICY; Schema: public; Owner: - -- CREATE POLICY library_services_read ON public.library_services FOR SELECT TO authenticated USING (true);

INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers create restrictions', N'dbo.case_access_restrictions', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers decide approvals', N'dbo.approval_requests', N'FOR UPDATE TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers decide reopen requests', N'dbo.case_reopen_requests', N'FOR UPDATE TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage action permissions', N'dbo.service_owner_action_permissions', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage automation policies', N'dbo.automation_policies', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage budgets', N'dbo.performance_budgets', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage conflicts', N'dbo.case_conflicts_of_interest', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage equivalence groups', N'dbo.evaluation_equivalence_groups', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage equivalence items', N'dbo.evaluation_equivalence_items', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage follow up policies', N'dbo.follow_up_policies', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage improvements', N'dbo.service_improvements', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage insights', N'dbo.operational_insights', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage process metrics', N'dbo.service_process_metrics', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage quality targets', N'dbo.quality_targets', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage readiness', N'dbo.release_readiness', N'TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers manage terms', N'dbo.bilingual_terms', N'TO authenticated USING (([dbo].[is_manager]([auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''knowledge_manager''))) WITH CHECK (([dbo].[is_manager]([auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''knowledge_manager'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers read conflicts', N'dbo.case_conflicts_of_interest', N'FOR SELECT TO authenticated USING ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers read insights', N'dbo.operational_insights', N'FOR SELECT TO authenticated USING ([dbo].[can_see_all_cases]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers read restrictions', N'dbo.case_access_restrictions', N'FOR SELECT TO authenticated USING ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers update escalation actions', N'dbo.escalation_actions', N'FOR UPDATE TO authenticated USING ([dbo].[is_manager]([auth].[uid]())) WITH CHECK ([dbo].[is_manager]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers write pilot sessions', N'dbo.pilot_test_sessions', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[is_manager]([auth].[uid]()))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[is_manager]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'managers write service baselines', N'dbo.service_baselines', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[is_manager]([auth].[uid]()))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[is_manager]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own action approvals', N'dbo.action_approvals', N'TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[can_see_all_cases]([auth].[uid]()))) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own action docs', N'dbo.action_request_documents', N'FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM [dbo].[action_requests] a
  WHERE ((a.id = action_request_documents.action_request_id) AND ((a.student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]()))))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own action docs insert', N'dbo.action_request_documents', N'FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM [dbo].[action_requests] a
  WHERE ((a.id = action_request_documents.action_request_id) AND (a.student_id = [auth].[uid]())))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own action requests', N'dbo.action_requests', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own action requests insert', N'dbo.action_requests', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own action requests update', N'dbo.action_requests', N'FOR UPDATE TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]()))) WITH CHECK (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own agent runs', N'dbo.agent_runs', N'TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''auditor''))) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own appointments', N'dbo.student_appointments', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own appointments insert', N'dbo.student_appointments', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own appointments update', N'dbo.student_appointments', N'FOR UPDATE TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]()))) WITH CHECK (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own attachments', N'dbo.message_attachments', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own citations', N'dbo.citations', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own consents', N'dbo.consent_records', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own conversations', N'dbo.conversations', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own course history', N'dbo.student_course_history', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own deliveries', N'dbo.notification_deliveries', N'FOR SELECT TO authenticated USING ((recipient_user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own documents', N'dbo.student_documents', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own documents insert', N'dbo.student_documents', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own enrollments', N'dbo.student_current_enrollments', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own feedback', N'dbo.feedback', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own holds', N'dbo.student_holds', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own idempotency insert', N'dbo.operation_idempotency', N'FOR INSERT TO authenticated WITH CHECK ((user_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own idempotency records', N'dbo.operation_idempotency', N'FOR SELECT TO authenticated USING (((user_profile_id = [auth].[uid]()) OR [dbo].[is_manager]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own idempotency update', N'dbo.operation_idempotency', N'FOR UPDATE TO authenticated USING ((user_profile_id = [auth].[uid]())) WITH CHECK ((user_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own intents', N'dbo.detected_intents', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own internship assignment', N'dbo.internship_assignments', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own internship preferences', N'dbo.student_internship_preferences', N'TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]()))) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own internship waitlist', N'dbo.internship_waitlist', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own match explanations', N'dbo.internship_match_explanations', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own messages', N'dbo.messages', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own notif logs', N'dbo.notification_delivery_logs', N'FOR SELECT TO authenticated USING ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own notif prefs', N'dbo.notification_preferences', N'TO authenticated USING ((user_id = [auth].[uid]())) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own profile', N'dbo.profiles', N'FOR SELECT TO authenticated USING (((id = [auth].[uid]()) OR [dbo].[staff_can_view_profile]([auth].[uid](), id)));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own requirements', N'dbo.student_requirements', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own revalidation events', N'dbo.action_revalidation_events', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_manager]([auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''auditor'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own student alerts', N'dbo.student_alerts', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own student profile', N'dbo.student_profiles', N'TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]()))) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own tool calls', N'dbo.tool_calls', N'TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''auditor''))) WITH CHECK ((user_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'own votes', N'dbo.suggestion_votes', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'owners manage own ai preferences', N'dbo.service_owner_ai_preferences', N'TO authenticated USING (((staff_profile_id = [auth].[uid]()) OR [dbo].[is_manager]([auth].[uid]()))) WITH CHECK (((staff_profile_id = [auth].[uid]()) OR [dbo].[is_manager]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'participants read reopen requests', N'dbo.case_reopen_requests', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR ([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]()))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'participants update info requests', N'dbo.case_information_requests', N'FOR UPDATE TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]())) WITH CHECK ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'participants update resolutions', N'dbo.case_resolutions', N'FOR UPDATE TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]())) WITH CHECK ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'profiles owner only insert', N'dbo.profiles', N'AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'profiles owner only update', N'dbo.profiles', N'AS RESTRICTIVE FOR UPDATE TO authenticated USING ((id = [auth].[uid]())) WITH CHECK ((id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read active alerts', N'dbo.alerts', N'FOR SELECT TO authenticated USING (is_active);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read appt types', N'dbo.appointment_types', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read campuses', N'dbo.campuses', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read categories', N'dbo.case_categories', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read chunks', N'dbo.document_chunks', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read colleges', N'dbo.colleges', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read courses', N'dbo.courses', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read departments', N'dbo.departments', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read doc versions', N'dbo.document_versions', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read equivalencies', N'dbo.programme_course_equivalencies', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read faq', N'dbo.faq_items', N'FOR SELECT TO authenticated USING (is_active);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read knowledge sources', N'dbo.knowledge_sources', N'FOR SELECT TO authenticated USING (is_active);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read own acknowledgements', N'dbo.intercollege_transfer_acknowledgements', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read own internship audit', N'dbo.internship_assignment_audit', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_internship_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read own roles', N'dbo.user_roles', N'FOR SELECT TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''auditor'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read own transfer impact', N'dbo.intercollege_transfer_course_impact', N'FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM [dbo].[intercollege_transfer_requests] r
  WHERE ((r.id = intercollege_transfer_course_impact.transfer_request_id) AND ((r.student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]()))))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read prereqs', N'dbo.course_prerequisites', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read program courses', N'dbo.program_courses', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read programs', N'dbo.academic_programs', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read published docs', N'dbo.knowledge_documents', N'FOR SELECT TO authenticated USING (((is_active AND (deleted_at IS NULL) AND (approval_status = N''approved'') AND (confidentiality = N''public'')) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read revalidation policies', N'dbo.action_revalidation_policies', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read sections', N'dbo.course_sections', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read service reqs', N'dbo.service_requirements', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read services', N'dbo.university_services', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read slots', N'dbo.appointment_slots', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read staff profiles', N'dbo.staff_profiles', N'FOR SELECT TO authenticated USING (((user_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read suggestion updates', N'dbo.suggestion_updates', N'FOR SELECT TO authenticated USING ((visible_to_student OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read terms', N'dbo.academic_terms', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read units', N'dbo.service_units', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read universities', N'dbo.universities', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read votes', N'dbo.suggestion_votes', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'read workflow steps', N'dbo.service_workflow_steps', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'recipients read notifications', N'dbo.notification_events', N'FOR SELECT TO authenticated USING (((recipient_profile_id = [auth].[uid]()) OR [dbo].[has_role]([auth].[uid](), N''system_admin'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'recipients update notifications', N'dbo.notification_events', N'FOR UPDATE TO authenticated USING ((recipient_profile_id = [auth].[uid]())) WITH CHECK ((recipient_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'resolutions readable by case participants', N'dbo.case_resolutions', N'FOR SELECT TO authenticated USING ([dbo].[can_access_case](case_id, [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'reviewers update own reviews', N'dbo.response_quality_reviews', N'FOR UPDATE TO authenticated USING ((reviewer_profile_id = [auth].[uid]())) WITH CHECK ((reviewer_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'risk flags read', N'dbo.risk_flags', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'risk flags write', N'dbo.risk_flags', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'rooms readable by signed-in users', N'dbo.hostel_rooms', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'rules readable by signed-in users', N'dbo.housing_eligibility_rules', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'settings managed by admins', N'dbo.notification_settings', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'settings readable by staff', N'dbo.notification_settings', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'signed in users read degradation', N'dbo.service_degradation_state', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'sla manage', N'dbo.service_level_rules', N'TO authenticated USING ([dbo].[has_role]([auth].[uid](), N''system_admin'')) WITH CHECK ([dbo].[has_role]([auth].[uid](), N''system_admin''));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'sla read', N'dbo.service_level_rules', N'FOR SELECT TO authenticated USING (1);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff ack sla events', N'dbo.case_sla_events', N'FOR UPDATE TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]()))) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff append knowledge audit', N'dbo.knowledge_audit_log', N'FOR INSERT TO authenticated WITH CHECK (((actor_id = [auth].[uid]()) AND [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff create approvals', N'dbo.approval_requests', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff create escalation actions', N'dbo.escalation_actions', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff create info requests', N'dbo.case_information_requests', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff create student alerts', N'dbo.student_alerts', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff manage alerts', N'dbo.alerts', N'TO authenticated USING (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''service_manager''))) WITH CHECK (([dbo].[has_role]([auth].[uid](), N''system_admin'') OR [dbo].[has_role]([auth].[uid](), N''service_manager'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff manage equivalencies', N'dbo.programme_course_equivalencies', N'TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff manage holds', N'dbo.student_holds', N'TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff manage requirements', N'dbo.student_requirements', N'TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff manage resolutions', N'dbo.case_resolutions', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff manage similarities', N'dbo.suggestion_similarities', N'TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read action permissions for their units', N'dbo.service_owner_action_permissions', N'FOR SELECT TO authenticated USING (([dbo].[is_manager]([auth].[uid]()) OR ([dbo].[is_staff]([auth].[uid]()) AND [dbo].[owns_service_unit]([auth].[uid](), service_unit_id))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read ai human edits', N'dbo.ai_human_edits', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read alert conditions', N'dbo.alert_rule_conditions', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read alert rules', N'dbo.alert_rules', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read alert runs', N'dbo.alert_rule_runs', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read approvals', N'dbo.approval_requests', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read assessments', N'dbo.suggestion_assessments', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read automation events', N'dbo.automation_events', N'FOR SELECT TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) OR ((case_id IS NOT NULL) AND [dbo].[can_access_case](case_id, [auth].[uid]()))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read automation policies', N'dbo.automation_policies', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read availability audit', N'dbo.service_availability_audit', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read budgets', N'dbo.performance_budgets', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read cache metadata', N'dbo.response_cache_metadata', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read calendar exceptions', N'dbo.calendar_exceptions', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read calendars', N'dbo.working_calendars', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read case linked conversations', N'dbo.conversations', N'FOR SELECT TO authenticated USING (((related_case_id IS NOT NULL) AND [dbo].[can_access_case](related_case_id, [auth].[uid]()) AND [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read case linked messages', N'dbo.messages', N'FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM [dbo].[conversations] c
  WHERE ((c.id = messages.conversation_id) AND (c.related_case_id IS NOT NULL) AND [dbo].[can_access_case](c.related_case_id, [auth].[uid]()) AND [dbo].[is_staff]([auth].[uid]())))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read data_authority_rules', N'dbo.data_authority_rules', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read dedup', N'dbo.alert_deduplication', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read equivalence groups', N'dbo.evaluation_equivalence_groups', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read equivalence items', N'dbo.evaluation_equivalence_items', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read escalation actions', N'dbo.escalation_actions', N'FOR SELECT TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read escalation policies', N'dbo.escalation_policies', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read feedback', N'dbo.case_feedback', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read follow up policies', N'dbo.follow_up_policies', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read grounding checks', N'dbo.grounding_checks', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read impact baselines', N'dbo.service_impact_baselines', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read improvements', N'dbo.service_improvements', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read integration_connectors', N'dbo.integration_connectors', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read integration_field_mappings', N'dbo.integration_field_mappings', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read integration_health_events', N'dbo.integration_health_events', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read integration_schema_versions', N'dbo.integration_schema_versions', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read integration_test_runs', N'dbo.integration_test_runs', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read integration_tools', N'dbo.integration_tools', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read job runs', N'dbo.scheduled_job_runs', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read knowledge_approval_requests', N'dbo.knowledge_approval_requests', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read knowledge_audit_log', N'dbo.knowledge_audit_log', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read knowledge_conflicts', N'dbo.knowledge_conflicts', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read knowledge_gaps', N'dbo.knowledge_gaps', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read knowledge_issue_reports', N'dbo.knowledge_issue_reports', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read knowledge_retrieval_logs', N'dbo.knowledge_retrieval_logs', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read model invocation telemetry', N'dbo.agent_model_invocations', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read own availability rules', N'dbo.staff_availability_rules', N'FOR SELECT TO authenticated USING ((staff_profile_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read performance logs', N'dbo.response_performance_logs', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read pilot sessions', N'dbo.pilot_test_sessions', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read process metrics', N'dbo.service_process_metrics', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read quality targets', N'dbo.quality_targets', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read readiness', N'dbo.release_readiness', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read reviews', N'dbo.response_quality_reviews', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read routing decisions', N'dbo.routing_decisions', N'FOR SELECT TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read routing feedback for accessible cases', N'dbo.case_routing_feedback', N'FOR SELECT TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read routing rules', N'dbo.model_routing_rules', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read routing rules', N'dbo.routing_rules', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read service baselines', N'dbo.service_baselines', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read service staff', N'dbo.service_staff', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read service unit owners', N'dbo.service_unit_owners', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read service_knowledge_health', N'dbo.service_knowledge_health', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read similarities', N'dbo.suggestion_similarities', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read sla events', N'dbo.case_sla_events', N'FOR SELECT TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read structured_data_sources', N'dbo.structured_data_sources', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read templates', N'dbo.notification_templates', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read unit cases', N'dbo.cases', N'FOR SELECT TO authenticated USING (([dbo].[can_see_all_cases]([auth].[uid]()) OR ([dbo].[is_staff]([auth].[uid]()) AND ((assigned_to = [auth].[uid]()) OR [dbo].[owns_service_unit]([auth].[uid](), service_unit_id)))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read unit suggestions', N'dbo.suggestions', N'FOR SELECT TO authenticated USING (([dbo].[can_see_all_cases]([auth].[uid]()) OR ([dbo].[is_staff]([auth].[uid]()) AND (service_unit_id = [dbo].[staff_unit]([auth].[uid]())))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read web_knowledge_sources', N'dbo.web_knowledge_sources', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff read web_source_changes', N'dbo.web_source_changes', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff report knowledge issues', N'dbo.knowledge_issue_reports', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND (reported_by = [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff report misrouting on their cases', N'dbo.case_routing_feedback', N'FOR INSERT TO authenticated WITH CHECK (((reported_by = [auth].[uid]()) AND [dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff update assessments', N'dbo.suggestion_assessments', N'FOR UPDATE TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff update automation state', N'dbo.case_automation_state', N'FOR UPDATE TO authenticated USING (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]()))) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff update documents', N'dbo.student_documents', N'FOR UPDATE TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff update transfers', N'dbo.intercollege_transfer_requests', N'FOR UPDATE TO authenticated USING ([dbo].[is_staff]([auth].[uid]())) WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff update unit cases', N'dbo.cases', N'FOR UPDATE TO authenticated USING (([dbo].[can_see_all_cases]([auth].[uid]()) OR ([dbo].[is_staff]([auth].[uid]()) AND ((assigned_to = [auth].[uid]()) OR [dbo].[owns_service_unit]([auth].[uid](), service_unit_id)))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff update unit suggestions', N'dbo.suggestions', N'FOR UPDATE TO authenticated USING (([dbo].[can_see_all_cases]([auth].[uid]()) OR ([dbo].[is_staff]([auth].[uid]()) AND (service_unit_id = [dbo].[staff_unit]([auth].[uid]())))));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff write ai human edits', N'dbo.ai_human_edits', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND (editor_profile_id = [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff write assessments', N'dbo.suggestion_assessments', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff write reviews', N'dbo.response_quality_reviews', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND (reviewer_profile_id = [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff write routing decisions', N'dbo.routing_decisions', N'FOR INSERT TO authenticated WITH CHECK (([dbo].[is_staff]([auth].[uid]()) AND [dbo].[can_access_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'staff write suggestion updates', N'dbo.suggestion_updates', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students and housing staff update applications', N'dbo.housing_applications', N'FOR UPDATE TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_housing_staff]([auth].[uid]()))) WITH CHECK (((student_id = [auth].[uid]()) OR [dbo].[is_housing_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students create cases', N'dbo.cases', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students create own housing applications', N'dbo.housing_applications', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students create own transfers', N'dbo.intercollege_transfer_requests', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students create reopen requests', N'dbo.case_reopen_requests', N'FOR INSERT TO authenticated WITH CHECK (((student_id = [auth].[uid]()) AND [dbo].[owns_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students join waitlist', N'dbo.housing_waitlist', N'FOR INSERT TO authenticated WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students manage own feedback', N'dbo.case_feedback', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK (((student_id = [auth].[uid]()) AND [dbo].[owns_case](case_id, [auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students manage own housing preferences', N'dbo.student_housing_preferences', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students manage own reminders', N'dbo.student_service_reminders', N'TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]()))) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students own suggestions', N'dbo.suggestions', N'TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students read own allocations', N'dbo.housing_allocations', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_housing_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students read own cases', N'dbo.cases', N'FOR SELECT TO authenticated USING ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students read own housing applications', N'dbo.housing_applications', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_housing_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students read own transfers', N'dbo.intercollege_transfer_requests', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students read own waitlist', N'dbo.housing_waitlist', N'FOR SELECT TO authenticated USING (((student_id = [auth].[uid]()) OR [dbo].[is_housing_staff]([auth].[uid]())));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students update own draft cases', N'dbo.cases', N'FOR UPDATE TO authenticated USING ((student_id = [auth].[uid]())) WITH CHECK ((student_id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'students update own open transfers', N'dbo.intercollege_transfer_requests', N'FOR UPDATE TO authenticated USING (((student_id = [auth].[uid]()) AND (transfer_status <> N''completed''))) WITH CHECK (((student_id = [auth].[uid]()) AND (transfer_status <> N''completed'')));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'suggestion dupes read', N'dbo.suggestion_duplicates', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'suggestion reviews read', N'dbo.suggestion_reviews', N'FOR SELECT TO authenticated USING ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'suggestion reviews write', N'dbo.suggestion_reviews', N'FOR INSERT TO authenticated WITH CHECK ([dbo].[is_staff]([auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'terms readable by signed in users', N'dbo.bilingual_terms', N'FOR SELECT TO authenticated USING (is_active);');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'update own profile', N'dbo.profiles', N'FOR UPDATE TO authenticated USING ((id = [auth].[uid]())) WITH CHECK ((id = [auth].[uid]()));');
GO
INSERT INTO [dbo].[rls_policies] (policy_name, table_name, definition)
VALUES (N'write own transfer impact', N'dbo.intercollege_transfer_course_impact', N'FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM [dbo].[intercollege_transfer_requests] r
  WHERE ((r.id = intercollege_transfer_course_impact.transfer_request_id) AND (r.student_id = [auth].[uid]()) AND (r.transfer_status <> N''completed'')))));');
GO
COMMIT;
GO
