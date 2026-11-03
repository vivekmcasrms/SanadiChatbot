using Microsoft.Extensions.Options;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;
using Dapper;

namespace Sanadi.Infrastructure.Storage;

public sealed class LocalObjectStorage(
    ISqlConnectionFactory connections,
    IOptions<StorageOptions> options) : IObjectStorage
{
    private static readonly HashSet<string> Buckets = new(StringComparer.OrdinalIgnoreCase)
    {
        "case-evidence", "knowledge-files", "student-letters", "student-cvs"
    };

    public async Task UploadAsync(string bucket, string path, Stream content, string contentType, Guid ownerId, bool upsert, CancellationToken cancellationToken)
    {
        GuardBucket(bucket);
        var full = Resolve(bucket, path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        if (File.Exists(full) && !upsert) throw new SanadiException("Object already exists.", 409, "duplicate");
        var temporary = full + "." + Guid.NewGuid().ToString("N") + ".upload";
        try
        {
            await using (var fs = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                             81920, FileOptions.Asynchronous))
            {
                await content.CopyToAsync(fs, cancellationToken);
                if (fs.Length == 0) throw new SanadiException("Empty uploads are not allowed.");
                await fs.FlushAsync(cancellationToken);
            }
            cancellationToken.ThrowIfCancellationRequested();
            await using var conn = connections.Create();
            await conn.ExecuteAsync(DbProc.Call("usp_StorageUpsertObject",
                new { bucket, path, ownerId, meta = System.Text.Json.JsonSerializer.Serialize(new { contentType }) },
                cancellationToken));
            cancellationToken.ThrowIfCancellationRequested();
            // Same-directory rename publishes only a fully received, closed file.
            File.Move(temporary, full, overwrite: upsert);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public async Task<StoredObject?> DownloadAsync(string bucket, string path, ICurrentUser user, CancellationToken cancellationToken)
    {
        GuardBucket(bucket);
        if (!user.IsAuthenticated) throw new UnauthorizedException();
        var full = Resolve(bucket, path);
        if (!File.Exists(full)) return null;
        var stream = File.OpenRead(full);
        return new StoredObject(bucket, path, "application/octet-stream", stream.Length, stream);
    }

    public Task DeleteAsync(string bucket, IReadOnlyList<string> paths, ICurrentUser user, CancellationToken cancellationToken)
    {
        GuardBucket(bucket);
        if (!user.IsAuthenticated) throw new UnauthorizedException();
        foreach (var path in paths)
        {
            var full = Resolve(bucket, path);
            if (File.Exists(full)) File.Delete(full);
        }
        return Task.CompletedTask;
    }

    public Task<string> CreateSignedUrlAsync(string bucket, string path, int expiresInSeconds, ICurrentUser user, CancellationToken cancellationToken)
    {
        GuardBucket(bucket);
        if (!user.IsAuthenticated) throw new UnauthorizedException();
        var exp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + Math.Max(30, expiresInSeconds);
        var actor = user.UserId?.ToString("D") ?? "service";
        var token = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{bucket}|{path}|{exp}|{actor}"));
        // Relative path: supabase-js concatenates this onto {origin}/storage/v1.
        var url = $"/object/sign/{bucket}/{path}?token={Uri.EscapeDataString(token)}";
        return Task.FromResult(url);
    }

    public bool IsValidSignedToken(string bucket, string path, string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            var raw = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(token));
            var parts = raw.Split('|');
            if (parts.Length != 4) return false;
            if (!parts[0].Equals(bucket, StringComparison.OrdinalIgnoreCase)) return false;
            if (!parts[1].Equals(path, StringComparison.Ordinal)) return false;
            if (!long.TryParse(parts[2], out var exp) || exp < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;
            return parts[3] is "service" || Guid.TryParse(parts[3], out _);
        }
        catch
        {
            return false;
        }
    }

    private string Resolve(string bucket, string path)
    {
        var safe = path.Replace('\\', '/').TrimStart('/');
        if (safe.Contains("..", StringComparison.Ordinal)) throw new SanadiException("Invalid path.");
        var root = Path.GetFullPath(options.Value.RootPath);
        var full = Path.GetFullPath(Path.Combine(root, bucket, safe));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new SanadiException("Invalid path.");
        return full;
    }

    private static void GuardBucket(string bucket)
    {
        if (!Buckets.Contains(bucket)) throw new SanadiException("Unknown storage bucket.");
    }
}
