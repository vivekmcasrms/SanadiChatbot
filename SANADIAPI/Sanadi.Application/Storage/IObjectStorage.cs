using Sanadi.Domain.Security;

namespace Sanadi.Application.Storage;

public sealed record StoredObject(string Bucket, string Path, string ContentType, long Length, Stream Content);

public interface IObjectStorage
{
    Task UploadAsync(string bucket, string path, Stream content, string contentType, Guid ownerId, bool upsert, CancellationToken cancellationToken);
    Task<StoredObject?> DownloadAsync(string bucket, string path, ICurrentUser user, CancellationToken cancellationToken);
    Task DeleteAsync(string bucket, IReadOnlyList<string> paths, ICurrentUser user, CancellationToken cancellationToken);
    Task<string> CreateSignedUrlAsync(string bucket, string path, int expiresInSeconds, ICurrentUser user, CancellationToken cancellationToken);
    bool IsValidSignedToken(string bucket, string path, string? token);
}
