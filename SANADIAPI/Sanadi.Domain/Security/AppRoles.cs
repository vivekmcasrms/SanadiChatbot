namespace Sanadi.Domain.Security;

/// <summary>Same role set as the React app and dbo.user_roles.</summary>
public static class AppRoles
{
    public const string Student = "student";
    public const string ServiceOfficer = "service_officer";
    public const string ServiceOwner = "service_owner";
    public const string ServiceManager = "service_manager";
    public const string KnowledgeManager = "knowledge_manager";
    public const string SystemAdmin = "system_admin";
    public const string Auditor = "auditor";
    public const string LeadershipViewer = "leadership_viewer";
    public const string IntegrationAdmin = "integration_admin";
    public const string KnowledgeApprover = "knowledge_approver";

    public static readonly string[] Staff =
    [
        ServiceOfficer, ServiceOwner, ServiceManager, KnowledgeManager,
        SystemAdmin, Auditor, LeadershipViewer, IntegrationAdmin, KnowledgeApprover
    ];

    public static readonly string[] Managers = [ServiceManager, SystemAdmin];
    public static readonly string[] SeeAllCases = [ServiceManager, SystemAdmin, Auditor, LeadershipViewer];
}
