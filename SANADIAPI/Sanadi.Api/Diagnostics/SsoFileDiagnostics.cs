using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Options;
using Sanadi.Infrastructure.Diagnostics;

namespace Sanadi.Api.Diagnostics;

public sealed class SsoDiagnosticsOptions
{
    public const string Section = "SsoDiagnostics";
    public bool Enabled { get; set; } = true;
    public int RetentionDays { get; set; } = 7;
    public int MaxFileSizeMb { get; set; } = 5;
    public int MaxFilesPerDay { get; set; } = 4;
}

/// <summary>A bounded, server-local log independent of the general ILogger minimum level.</summary>
public sealed class SsoFileDiagnostics : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Channel<SsoDiagnosticEvent> queue = Channel.CreateBounded<SsoDiagnosticEvent>(
        new BoundedChannelOptions(1024) { SingleReader = true, SingleWriter = false, FullMode = BoundedChannelFullMode.Wait });
    private readonly ILogger<SsoFileDiagnostics> logger;
    private readonly bool enabled;
    private readonly string directory;
    private readonly int retentionDays;
    private readonly long maxFileBytes;
    private readonly int maxFilesPerDay;
    private DateOnly activeDate;
    private int sequence = 1;
    private long droppedEntries;
    private DateTimeOffset nextFailureReport;

    public SsoFileDiagnostics(IHostEnvironment environment, IOptions<SsoDiagnosticsOptions> options,
        ILogger<SsoFileDiagnostics> logger)
    {
        this.logger = logger;
        var settings = options.Value;
        enabled = settings.Enabled;
        retentionDays = Math.Clamp(settings.RetentionDays, 1, 30);
        maxFileBytes = Math.Clamp(settings.MaxFileSizeMb, 1, 20) * 1024L * 1024L;
        maxFilesPerDay = Math.Clamp(settings.MaxFilesPerDay, 1, 10);
        // A fixed, non-public path prevents request/configuration values from selecting arbitrary files.
        directory = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "App_Data", "logs", "sso"));
        if (environment is IWebHostEnvironment web && !string.IsNullOrWhiteSpace(web.WebRootPath))
        {
            var webRoot = Path.GetFullPath(web.WebRootPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if ((directory + Path.DirectorySeparatorChar).StartsWith(webRoot, StringComparison.OrdinalIgnoreCase))
            {
                enabled = false;
                try { logger.LogError("SSO text logging is disabled because its directory is under the web root."); }
                catch { }
            }
        }
    }

    public void Write(SsoDiagnosticEvent entry)
    {
        if (!enabled) return;
        // Never wait for the filesystem, and never throw into the authentication request.
        try
        {
            if (!queue.Writer.TryWrite(entry)) Interlocked.Increment(ref droppedEntries);
        }
        catch { }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!enabled) return;
        Write(new SsoDiagnosticEvent(DateTimeOffset.UtcNow, "startup", null, "SSO_LOG_READY", "ok"));
        // StopAsync completes the writer so queued entries can drain during graceful shutdown.
        await foreach (var entry in queue.Reader.ReadAllAsync())
        {
            try
            {
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                if (activeDate != today)
                {
                    Directory.CreateDirectory(directory);
                    activeDate = today;
                    sequence = 1;
                    PruneExpired(today);
                }
                var line = JsonSerializer.Serialize(entry, JsonOptions);
                if (Encoding.UTF8.GetByteCount(line) > 24 * 1024) continue;
                var dropped = Interlocked.Exchange(ref droppedEntries, 0);
                if (dropped > 0)
                {
                    var notice = new SsoDiagnosticEvent(DateTimeOffset.UtcNow, "logger", null,
                        "SSO_LOG_DROPPED", "warning", Code: "queue_full", DroppedEntries: dropped);
                    line = JsonSerializer.Serialize(notice, JsonOptions) + Environment.NewLine + line;
                }
                var lineBytes = Encoding.UTF8.GetBytes(line + Environment.NewLine);
                string path;
                while (true)
                {
                    path = Path.Combine(directory, $"sso-{today:yyyy-MM-dd}-{Environment.ProcessId}-{sequence:D3}.txt");
                    if (!File.Exists(path) || new FileInfo(path).Length + lineBytes.Length <= maxFileBytes) break;
                    if (sequence >= maxFilesPerDay) { path = ""; break; }
                    sequence++;
                }
                if (path.Length == 0)
                {
                    ReportFailure("daily_size_limit");
                    continue;
                }
                await using var output = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read,
                    4096, FileOptions.Asynchronous);
                await output.WriteAsync(lineBytes);
                await output.FlushAsync();
            }
            catch (Exception ex)
            {
                // No exception message or caller data is sent to other log sinks.
                ReportFailure(ex is UnauthorizedAccessException ? "directory_permission_denied" : "file_write_failed");
            }
        }
    }

    private void PruneExpired(DateOnly today)
    {
        foreach (var file in Directory.EnumerateFiles(directory, "sso-*.txt", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileName(file);
            if (name.Length < 15 || !DateOnly.TryParseExact(name.AsSpan(4, 10), "yyyy-MM-dd",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ||
                date > today.AddDays(-retentionDays)) continue;
            try { File.Delete(file); }
            catch { ReportFailure("retention_cleanup_failed"); }
        }
    }

    private void ReportFailure(string code)
    {
        if (DateTimeOffset.UtcNow < nextFailureReport) return;
        nextFailureReport = DateTimeOffset.UtcNow.AddMinutes(5);
        try
        {
            logger.LogError("SSO text logging could not write/retain a diagnostic entry. Code={Code}. " +
                "Check available disk space and the API process Modify permission on App_Data/logs/sso. " +
                "Authentication continues unchanged.", code);
        }
        catch { }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        queue.Writer.TryComplete();
        await base.StopAsync(cancellationToken);
    }
}
