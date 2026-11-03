using System.Data;
using System.Data.Common;
using Dapper;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Notifications;

/// <summary>
/// Pushes in-app notification_events for students, staff and admins.
/// Mirrors the Node emitNotification contract used by routing / case-actions.
/// Failures must never break the caller workflow.
/// </summary>
internal static class InAppNotify
{
    public static ILogger Logger { get; set; } = NullLogger.Instance;
    public static async Task PushAsync(
        DbConnection db,
        string eventType,
        Guid recipientId,
        Guid entityId,
        string body,
        string actionUrl,
        Guid? caseId = null,
        Guid? unitId = null,
        Guid? actorId = null,
        string? title = null,
        string? dedupeKey = null,
        IDbTransaction? tx = null,
        CancellationToken ct = default)
    {
        if (ct.IsCancellationRequested) return;
        try
        {
            var key = dedupeKey ?? $"notify:{eventType}:{entityId}:{recipientId}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await db.ExecuteAsync(DbProc.Call(
                "usp_Notify_PushInApp",
                new
                {
                    type = eventType,
                    recipient = recipientId,
                    entityId,
                    caseId,
                    unit = unitId,
                    actor = actorId,
                    body,
                    url = actionUrl,
                    title = title ?? "Update",
                    key,
                },
                ct,
                tx));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Notification delivery is best-effort and must not undo the caller's work.
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "API function {Function} failed", nameof(PushAsync));
        }
    }

    /// <summary>Student receipt + staff assignment (+ optional student "who is following it").</summary>
    public static async Task PushCaseOpenedAsync(
        DbConnection db,
        Guid caseId,
        string caseNumber,
        Guid studentId,
        Guid? unitId,
        Guid? assigneeId,
        string? urgency,
        Guid? actorId = null,
        string? unitLabel = null,
        CancellationToken ct = default)
    {
        if (ct.IsCancellationRequested) return;
        await PushAsync(
            db,
            "case_submitted",
            studentId,
            caseId,
            $"Request {caseNumber} received",
            $"/requests/{caseId}",
            caseId,
            unitId,
            actorId,
            "Request received",
            $"submitted:{caseId}",
            ct: ct);

        if (assigneeId is Guid staff)
        {
            var urgent = string.Equals(urgency, "critical", StringComparison.OrdinalIgnoreCase)
                || string.Equals(urgency, "high", StringComparison.OrdinalIgnoreCase);
            await PushAsync(
                db,
                urgent ? "urgent_assignment" : "new_assignment",
                staff,
                caseId,
                urgent
                    ? $"URGENT — {urgency} case assigned to you: {caseNumber}"
                    : $"New case assigned to you: {caseNumber}",
                $"/requests/{caseId}",
                caseId,
                unitId,
                actorId,
                urgent ? "Urgent assignment" : "New assignment",
                $"assign:{caseId}:{staff}",
                ct: ct);

            await PushCaseAssignedToStudentAsync(db, caseId, caseNumber, studentId, staff, unitId, actorId, unitLabel, ct);
        }
    }

    public static async Task PushCaseAssignedToStudentAsync(
        DbConnection db,
        Guid caseId,
        string caseNumber,
        Guid studentId,
        Guid assigneeId,
        Guid? unitId,
        Guid? actorId = null,
        string? unitLabel = null,
        CancellationToken ct = default,
        IDbTransaction? tx = null)
    {
        if (ct.IsCancellationRequested) return;
        try
        {
            await db.ExecuteAsync(DbProc.Call(
                "usp_Notify_PushCaseAssignedStudent",
                new
                {
                    caseId,
                    studentId,
                    assigneeId,
                    unitId,
                    actor = actorId,
                    caseNumber,
                    unitLabel,
                    key = $"assigned-student:{caseId}:{assigneeId}",
                },
                ct,
                tx));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            Logger.LogError(ex, "API function {Function} failed", nameof(PushCaseOpenedAsync));
        }
    }

    public static async Task PushAdminsAsync(
        DbConnection db,
        string eventType,
        Guid caseId,
        string caseNumber,
        string body,
        Guid? unitId,
        Guid? actorId,
        string dedupePrefix,
        IDbTransaction? tx = null,
        CancellationToken ct = default)
    {
        if (ct.IsCancellationRequested) return;
        try
        {
            var admins = (await db.QueryAsync<Guid>(DbProc.Call("usp_Notify_ListAdminRecipients", null, ct, tx))).ToArray();
            foreach (var adminId in admins)
            {
                if (actorId is Guid a && a == adminId) continue;
                await PushAsync(
                    db,
                    eventType,
                    adminId,
                    caseId,
                    body,
                    $"/monitoring",
                    caseId,
                    unitId,
                    actorId,
                    "Oversight update",
                    $"{dedupePrefix}:{caseId}:{adminId}",
                    tx,
                    ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            Logger.LogError(ex, "API function {Function} failed", nameof(PushAdminsAsync));
        }
    }
}
