using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Infrastructure.Diagnostics;

public sealed record SsoDiagnosticError(string Type, string Code, int HResult,
    int? SqlNumber, byte? SqlState, string? SqlProcedure, int? SqlLine,
    IReadOnlyList<string> Frames, int? HttpStatusCode = null, string? NetworkCode = null);

public sealed record SsoDiagnosticEvent(DateTimeOffset TimestampUtc, string RequestId,
    string? FlowId, string Step, string Outcome, string? Operation = null,
    int? StatusCode = null, string? Reference = null, string? Code = null,
    double? DurationMs = null, IReadOnlyList<SsoDiagnosticError>? Errors = null, string Source = "server",
    string? DatabaseServer = null, string? DatabaseName = null, long? DroppedEntries = null);

/// <summary>Request-local, best-effort diagnostics. No credentials, payloads or exception messages are recorded.</summary>
public static class SsoDiagnostics
{
    private sealed record Context(Action<SsoDiagnosticEvent> Write, string RequestId, string? FlowId);
    private static readonly AsyncLocal<Context?> Current = new();

    public static IDisposable BeginRequest(Action<SsoDiagnosticEvent> write, string requestId, string? flowId)
    {
        var previous = Current.Value;
        Current.Value = new Context(write, Label(requestId, 128) ?? "unknown",
            Guid.TryParse(flowId, out var parsed) ? parsed.ToString("D") : null);
        return new Scope(previous);
    }

    public static void Step(string step, string outcome = "ok", string? operation = null,
        int? statusCode = null, string? reference = null)
    {
        try
        {
            var context = Current.Value;
            if (context is null) return;
            context.Write(new SsoDiagnosticEvent(DateTimeOffset.UtcNow, context.RequestId, context.FlowId,
                Label(step) ?? "unknown", Label(outcome) ?? "unknown", Label(operation), statusCode,
                reference is { Length: 64 } && reference.All(Uri.IsHexDigit) ? reference : null));
        }
        catch { /* Diagnostics must never change sign-in behavior. */ }
    }

    public static void Error(string step, Exception exception, string? operation = null)
    {
        try
        {
            var context = Current.Value;
            if (context is null) return;
            var errors = new List<SsoDiagnosticError>();
            for (Exception? current = exception; current is not null && errors.Count < 8; current = current.InnerException)
            {
                var sql = current as SqlException;
                var frames = new StackTrace(current, false).GetFrames()?.Take(8).Select(frame =>
                {
                    var method = frame.GetMethod();
                    return Label($"{method?.DeclaringType?.FullName}.{method?.Name}", 220) ?? "unknown";
                }).ToArray() ?? [];
                errors.Add(new SsoDiagnosticError(Label(current.GetType().FullName, 180) ?? "Exception",
                    ErrorCode(current), current.HResult, sql?.Number, sql?.State,
                    Label(sql?.Procedure, 160), sql?.LineNumber, Array.AsReadOnly(frames),
                    current is HttpRequestException http && http.StatusCode.HasValue ? (int)http.StatusCode.Value : null,
                    current is System.Net.Sockets.SocketException socket ? socket.SocketErrorCode.ToString() :
                    current is HttpRequestException request ? request.HttpRequestError.ToString() : null));
            }
            context.Write(new SsoDiagnosticEvent(DateTimeOffset.UtcNow, context.RequestId, context.FlowId,
                Label(step) ?? "unknown", exception is OperationCanceledException ? "cancelled" : "error",
                Label(operation), (exception as SanadiException)?.StatusCode, Code: ErrorCode(exception),
                Errors: errors.AsReadOnly()));
        }
        catch { /* Logging failures are isolated from authentication. */ }
    }

    public static void ClientStep(string step, string? code, string flowId, string? stage = null, double? ms = null)
    {
        try
        {
            var context = Current.Value;
            if (context is null || !Guid.TryParse(flowId, out var parsed)) return;
            context.Write(new SsoDiagnosticEvent(DateTimeOffset.UtcNow, context.RequestId, parsed.ToString("D"),
                Label(step) ?? "unknown", step == "AUTH_FAILED" ? "error" : "ok", Label(stage),
                Code: Label(code), DurationMs: ms is >= 0 and <= 3_600_000 ? Math.Round(ms.Value, 1) : null,
                Source: "browser"));
        }
        catch { }
    }

    public static string? Reference(string? value)
    {
        try
        {
            return string.IsNullOrEmpty(value) || value.Length > 4096 ? null :
                Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
        }
        catch { return null; }
    }

    public static void SqlTarget(string? server, string? database)
    {
        try
        {
            var context = Current.Value;
            if (context is null) return;
            context.Write(new SsoDiagnosticEvent(DateTimeOffset.UtcNow, context.RequestId, context.FlowId,
                "SQL_TARGET", "ok", DatabaseServer: Label(server, 160), DatabaseName: Label(database, 128)));
        }
        catch { }
    }

    private static string ErrorCode(Exception error) => error switch
    {
        SanadiException known => Label(known.Code) ?? "application_error",
        SqlException sql => sql.Number switch
        {
            18456 => "sql_login_failed", 4060 => "sql_database_unavailable", 229 => "sql_permission_denied",
            2812 => "sql_procedure_missing", 208 => "sql_object_missing", 207 => "sql_column_missing",
            201 => "sql_parameter_missing", 8144 => "sql_parameter_mismatch", -2 => "sql_timeout",
            _ => "sql_error"
        },
        InvalidOperationException when error.Message == "Jwt:SigningKey must be at least 32 characters." => "jwt_signing_key_invalid",
        InvalidOperationException when error.Message == "The ConnectionString property has not been initialized." => "sql_connection_string_missing",
        ArgumentException when error.Message.StartsWith("Keyword not supported:", StringComparison.Ordinal) ||
            error.Message.StartsWith("Format of the initialization string does not conform", StringComparison.Ordinal) => "sql_connection_string_invalid",
        System.Security.Cryptography.CryptographicException => "cryptography_failed",
        System.Security.Authentication.AuthenticationException => "tls_authentication_failed",
        HttpRequestException => "upstream_http_failed",
        OperationCanceledException => "operation_cancelled",
        UnauthorizedAccessException => "permission_denied",
        _ => "unexpected_error"
    };

    // Labels are code-owned identifiers; removing controls also prevents forged log lines.
    private static string? Label(string? value, int maxLength = 96) => string.IsNullOrWhiteSpace(value) ? null :
        new string(value.Take(maxLength).Select(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.' or ':' or '+' or '`' ? c : '_').ToArray());

    private sealed class Scope(Context? previous) : IDisposable
    {
        private bool disposed;
        public void Dispose()
        {
            if (disposed) return;
            Current.Value = previous;
            disposed = true;
        }
    }
}
