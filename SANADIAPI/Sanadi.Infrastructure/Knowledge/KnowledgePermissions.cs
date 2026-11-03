using System.Data.Common;
using System.Text.Json;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed record CenterPermissions(
    string[] Roles,
    bool IsStaff,
    bool IsAdmin,
    bool IsAuditor,
    bool CanViewCenter,
    bool CanManageKnowledge,
    bool CanApproveKnowledge,
    bool CanManageIntegrations);

public static class KnowledgePermissions
{
    private static readonly string[] StaffRoles =
    [
        "service_officer", "service_owner", "service_manager", "knowledge_manager",
        "knowledge_approver", "integration_admin", "system_admin", "auditor", "leadership_viewer"
    ];

    private static readonly string[] ConfidentialityOrder =
        ["public", "student_authenticated", "staff_only", "restricted", "highly_restricted"];

    public static async Task<CenterPermissions> LoadAsync(DbConnection db, Guid userId)
    {
        var roles = (await db.QueryAsync<string>(DbProc.Call("usp_Knowledge_Permissions_ListRoles", new { userId })))
            .Select(r => r ?? "").ToArray();
        return FromRoles(roles);
    }

    public static CenterPermissions FromRoles(IEnumerable<string> roles)
    {
        var list = roles.Select(r => r ?? "").ToArray();
        bool Has(string r) => list.Contains(r, StringComparer.OrdinalIgnoreCase);
        var isAdmin = Has("system_admin");
        var isStaff = list.Any(r => StaffRoles.Contains(r, StringComparer.OrdinalIgnoreCase));
        return new CenterPermissions(
            list,
            isStaff,
            isAdmin,
            Has("auditor"),
            isStaff,
            isAdmin || Has("knowledge_manager") || Has("knowledge_approver"),
            isAdmin || Has("knowledge_approver"),
            isAdmin || Has("integration_admin"));
    }

    public static void Assert(bool condition, string message)
    {
        if (!condition) throw new ForbiddenException(message);
    }

    public static int ClearanceFor(CenterPermissions perms)
    {
        if (perms.IsAdmin) return 4;
        if (perms.CanManageKnowledge || perms.CanManageIntegrations) return 3;
        if (perms.IsStaff) return 2;
        return 1;
    }

    public static bool AllowedConfidentiality(string level, int clearance)
    {
        var idx = Array.IndexOf(ConfidentialityOrder, level);
        return idx >= 0 && idx <= clearance;
    }

    public static async Task AuditAsync(
        DbConnection db,
        Guid actorId,
        string action,
        string entityType,
        Guid? entityId,
        string summary,
        object? details = null)
    {
        var json = details is null ? "{}" : JsonSerializer.Serialize(details);
        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Audit_Insert",
            new { actorId, action, entityType, entityId, summary, json }));
    }

    public static object ToDto(CenterPermissions p) => new
    {
        roles = p.Roles,
        isStaff = p.IsStaff,
        isAdmin = p.IsAdmin,
        isAuditor = p.IsAuditor,
        canViewCenter = p.CanViewCenter,
        canManageKnowledge = p.CanManageKnowledge,
        canApproveKnowledge = p.CanApproveKnowledge,
        canManageIntegrations = p.CanManageIntegrations
    };
}
