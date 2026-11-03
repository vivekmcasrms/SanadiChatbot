using System.Text.Json;
using Dapper;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.AI;

/// <summary>
/// Voice operational metrics in existing audit storage. No audio or transcript is stored.
/// </summary>
public sealed class VoiceMetricsStore(ISqlConnectionFactory? sql = null, ILogger<VoiceMetricsStore>? logger = null)
{
    public async Task RecordAsync(string type, string? language, string? detail, Guid? userId,
        double? durationMs = null, Guid? turnId = null)
    {
        if (sql is null) return;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await using var db = sql.Create();
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT dbo.audit_logs(actor_id,action,entity_type,entity_id,metadata)
                VALUES(@userId,N'voice.metric',N'voice_turn',@turnId,@metadata);
                """, new { userId, turnId, metadata = JsonSerializer.Serialize(new {
                    type, language, durationMs = durationMs is >= 0 and <= 3_600_000 ? durationMs : null
                }) }, cancellationToken: timeout.Token));
        }
        catch (Exception error) { logger?.LogWarning("Voice metric persistence failed ({ErrorType})", error.GetType().Name); }
    }

    public async Task<object> SnapshotAsync(int days, CancellationToken ct)
    {
        if (sql is null) throw new InvalidOperationException("Voice metrics storage is unavailable.");
        var since = DateTimeOffset.UtcNow.AddDays(-Math.Clamp(days, 1, 90));
        await using var db = sql.Create();
        var rows = (await db.QueryAsync<Metric>(new CommandDefinition("""
            SELECT JSON_VALUE(metadata,'$.type') AS Type,
                   JSON_VALUE(metadata,'$.language') AS Language, COUNT_BIG(*) AS Count,
                   AVG(TRY_CONVERT(float,JSON_VALUE(metadata,'$.durationMs'))) AS AverageMs
            FROM dbo.audit_logs
            WHERE action=N'voice.metric' AND created_at>=@since AND ISJSON(metadata)=1
            GROUP BY JSON_VALUE(metadata,'$.type'),JSON_VALUE(metadata,'$.language');
            """, new { since }, cancellationToken: ct))).ToArray();
        long Count(string type) => rows.Where(r => r.Type == type).Sum(r => r.Count);
        long Lang(string type, string lang) => rows.Where(r => r.Type == type && r.Language == lang).Sum(r => r.Count);
        var interactions = Count("voice_interaction");
        var ok = Count("transcription_ok");
        var fail = Count("transcription_fail") + Count("speech_service_fail");
        var clarify = Count("clarification_needed");
        var actions = Count("voice_action_completed");
        return new
        {
            windowDays = Math.Clamp(days,1,90), storage = "database",
            voiceInteractions = interactions,
            arabicVoiceInteractions = Lang("voice_interaction", "ar"),
            englishVoiceInteractions = Lang("voice_interaction", "en"),
            successfulTranscriptionRate = ok + Count("transcription_fail") == 0 ? 0 : (int)Math.Round(ok * 100d / (ok + Count("transcription_fail"))),
            clarificationRate = interactions == 0 ? 0 : (int)Math.Round(clarify * 100d / interactions),
            voiceToActionCompletionRate = interactions == 0 ? 0 : (int)Math.Round(actions * 100d / interactions),
            speechServiceFailureRate = ok + fail == 0 ? 0 : (int)Math.Round(fail * 100d / (ok + fail)),
            totals = new { ok, fail, clarify, actions },
            interruptions = Count("interrupted"), timings = rows.Where(r => r.AverageMs is not null),
        };
    }

    private sealed record Metric(string Type, string? Language, long Count, double? AverageMs);
}
