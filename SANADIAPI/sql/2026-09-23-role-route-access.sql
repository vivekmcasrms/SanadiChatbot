/*
  Database-owned page authorization.
  Apply once to the Sanadi SQL Server database. Administrators can change the
  rows later without rebuilding the UI or API. Longest matching path wins.
*/
IF OBJECT_ID(N'dbo.app_route_policies', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_route_policies (
        id uniqueidentifier NOT NULL CONSTRAINT PK_app_route_policies PRIMARY KEY DEFAULT NEWID(),
        route_pattern nvarchar(256) NOT NULL,
        audience nvarchar(32) NOT NULL,
        is_enabled bit NOT NULL CONSTRAINT DF_app_route_policies_enabled DEFAULT 1,
        description nvarchar(450) NULL,
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_app_route_policies_updated DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT UQ_app_route_policies_pattern UNIQUE(route_pattern),
        CONSTRAINT CK_app_route_policies_audience CHECK (audience IN (N'student',N'staff',N'shared'))
    );
END;
GO

IF OBJECT_ID(N'dbo.app_route_policy_roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_route_policy_roles (
        policy_id uniqueidentifier NOT NULL,
        role nvarchar(64) NOT NULL,
        CONSTRAINT PK_app_route_policy_roles PRIMARY KEY(policy_id, role),
        CONSTRAINT FK_app_route_policy_roles_policy FOREIGN KEY(policy_id)
          REFERENCES dbo.app_route_policies(id) ON DELETE CASCADE
    );
END;
GO

DECLARE @policies TABLE(route_pattern nvarchar(256), audience nvarchar(32), description nvarchar(450));
INSERT @policies VALUES
 (N'/academic',N'student',N'Student academic view'),(N'/alerts',N'student',N'Student alerts'),
 (N'/assistant',N'student',N'Student assistant'),(N'/campus-services',N'student',N'Student campus services'),
 (N'/career',N'student',N'Student career counselling'),(N'/documents',N'student',N'Student documents'),
 (N'/library',N'student',N'Student library'),(N'/my-notifications',N'student',N'Student notifications'),
 (N'/requests',N'student',N'Student requests'),(N'/submit',N'student',N'Student submissions'),
 (N'/help',N'shared',N'Help'),(N'/settings',N'shared',N'Account settings'),
 (N'/dashboard',N'staff',N'Staff dashboard'),(N'/owner-console',N'staff',N'Unit operations'),
 (N'/staff',N'staff',N'Staff queues'),(N'/knowledge',N'staff',N'Knowledge search'),
 (N'/knowledge-center',N'staff',N'Knowledge and integration administration'),
 (N'/leadership',N'staff',N'Leadership insights'),(N'/monitoring',N'staff',N'Case monitoring'),
 (N'/evaluation',N'staff',N'Evaluation'),(N'/acceptance',N'staff',N'Acceptance verification'),
 (N'/admin',N'staff',N'Administration'),(N'/ai-ops',N'staff',N'AI operations'),
 (N'/appointment-availability',N'staff',N'Appointment administration'),
 (N'/demo-accounts',N'staff',N'Account directory'),(N'/job-runs',N'staff',N'Scheduled jobs'),
 (N'/learning',N'staff',N'Learning center'),(N'/notifications',N'staff',N'Notification operations'),
 (N'/permissions',N'staff',N'Permission administration'),(N'/reports',N'staff',N'Reports'),
 (N'/services',N'staff',N'Service administration'),(N'/units',N'staff',N'Unit administration');

MERGE dbo.app_route_policies AS target
USING @policies AS source ON source.route_pattern=target.route_pattern
WHEN MATCHED THEN UPDATE SET audience=source.audience,description=source.description,is_enabled=1,updated_at=SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT(route_pattern,audience,description) VALUES(source.route_pattern,source.audience,source.description);
GO

DELETE r FROM dbo.app_route_policy_roles r
JOIN dbo.app_route_policies p ON p.id=r.policy_id;

DECLARE @roles TABLE(route_pattern nvarchar(256), role nvarchar(64));
INSERT @roles VALUES
 (N'/academic',N'student'),(N'/alerts',N'student'),(N'/assistant',N'student'),(N'/campus-services',N'student'),
 (N'/career',N'student'),(N'/documents',N'student'),(N'/library',N'student'),(N'/my-notifications',N'student'),
 (N'/requests',N'student'),(N'/submit',N'student'),
 (N'/dashboard',N'service_officer'),(N'/dashboard',N'service_owner'),(N'/dashboard',N'service_manager'),
 (N'/dashboard',N'knowledge_manager'),(N'/dashboard',N'knowledge_approver'),(N'/dashboard',N'integration_admin'),
 (N'/dashboard',N'system_admin'),(N'/dashboard',N'auditor'),(N'/dashboard',N'leadership_viewer'),
 (N'/owner-console',N'service_officer'),(N'/owner-console',N'service_owner'),(N'/owner-console',N'service_manager'),(N'/owner-console',N'system_admin'),
 (N'/staff',N'service_officer'),(N'/staff',N'service_manager'),(N'/staff',N'system_admin'),
 (N'/knowledge',N'knowledge_manager'),(N'/knowledge',N'knowledge_approver'),(N'/knowledge',N'system_admin'),
 (N'/knowledge-center',N'knowledge_manager'),(N'/knowledge-center',N'knowledge_approver'),(N'/knowledge-center',N'integration_admin'),(N'/knowledge-center',N'system_admin'),
 (N'/leadership',N'service_manager'),(N'/leadership',N'leadership_viewer'),(N'/leadership',N'system_admin'),(N'/leadership',N'auditor'),
 (N'/monitoring',N'service_manager'),(N'/monitoring',N'leadership_viewer'),(N'/monitoring',N'system_admin'),
 (N'/evaluation',N'service_manager'),(N'/evaluation',N'system_admin'),
 (N'/job-runs',N'service_manager');

INSERT dbo.app_route_policy_roles(policy_id,role)
SELECT p.id,r.role FROM @roles r JOIN dbo.app_route_policies p ON p.route_pattern=r.route_pattern;

DECLARE @adminRoutes TABLE(route_pattern nvarchar(256));
INSERT @adminRoutes VALUES (N'/acceptance'),(N'/admin'),(N'/ai-ops'),(N'/appointment-availability'),
 (N'/demo-accounts'),(N'/job-runs'),(N'/learning'),(N'/notifications'),(N'/permissions'),(N'/reports'),(N'/services'),(N'/units');
INSERT dbo.app_route_policy_roles(policy_id,role)
SELECT p.id,N'system_admin' FROM @adminRoutes a JOIN dbo.app_route_policies p ON p.route_pattern=a.route_pattern;
GO

CREATE OR ALTER PROCEDURE dbo.usp_AuthorizeAppRoute
    @userId uniqueidentifier,
    @path nvarchar(512)
AS
BEGIN
    SET NOCOUNT ON;
    SET @path=LOWER(LEFT(COALESCE(NULLIF(@path,N''),N'/'),512));
    IF LEN(@path)>1 AND RIGHT(@path,1)=N'/' SET @path=LEFT(@path,LEN(@path)-1);

    DECLARE @policyId uniqueidentifier,@audience nvarchar(32),@revoked bit=0,@isStaff bit=0,@allowed bit=0;
    SELECT TOP(1) @policyId=id,@audience=audience FROM dbo.app_route_policies
      WHERE is_enabled=1 AND (@path=route_pattern OR @path LIKE route_pattern+N'/%')
      ORDER BY LEN(route_pattern) DESC;
    SELECT @revoked=CASE WHEN access_revoked_at IS NULL THEN 0 ELSE 1 END FROM dbo.profiles WHERE id=@userId;
    IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role IN
      (N'service_officer',N'service_owner',N'service_manager',N'knowledge_manager',N'knowledge_approver',
       N'integration_admin',N'system_admin',N'auditor',N'leadership_viewer')) SET @isStaff=1;

    IF @policyId IS NOT NULL AND @revoked=0
    BEGIN
      IF @audience=N'shared' SET @allowed=1;
      ELSE IF @audience=N'student' AND @isStaff=0 AND EXISTS
        (SELECT 1 FROM dbo.app_route_policy_roles pr JOIN dbo.user_roles ur ON ur.role=pr.role
         WHERE pr.policy_id=@policyId AND ur.user_id=@userId) SET @allowed=1;
      ELSE IF @audience=N'staff' AND @isStaff=1 AND EXISTS
        (SELECT 1 FROM dbo.app_route_policy_roles pr JOIN dbo.user_roles ur ON ur.role=pr.role
         WHERE pr.policy_id=@policyId AND ur.user_id=@userId) SET @allowed=1;
    END;

    DECLARE @landing nvarchar(256)=N'/assistant';
    IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'system_admin') SET @landing=N'/dashboard';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'service_manager') SET @landing=N'/dashboard';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'auditor') SET @landing=N'/dashboard?view=audit';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'integration_admin') SET @landing=N'/knowledge-center?tab=connections';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role IN(N'knowledge_manager',N'knowledge_approver')) SET @landing=N'/knowledge-center?tab=documents';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'service_owner') SET @landing=N'/owner-console?tab=dashboard';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'service_officer') SET @landing=N'/staff?view=queue';
    ELSE IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_id=@userId AND role=N'leadership_viewer') SET @landing=N'/leadership';

    SELECT @allowed AS allowed,@landing AS landing,@audience AS audience;
END;
GO
