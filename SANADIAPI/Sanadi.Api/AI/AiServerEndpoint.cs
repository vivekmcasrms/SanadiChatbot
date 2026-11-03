namespace Sanadi.Api.AI;

/// <summary>Accept a configured gateway base or an existing chat/speech/transcription endpoint.</summary>
internal static class AiServerEndpoint
{
    internal static Uri For(string configuredUrl, string operation)
    {
        if (!Uri.TryCreate(configuredUrl.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("Invalid AI server URL.");
        var builder = new UriBuilder(uri);
        var path = builder.Path.TrimEnd('/');
        foreach (var suffix in new[] { "/chat/completions", "/audio/speech", "/audio/transcriptions" })
            if (path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                path = path[..^suffix.Length];
                break;
            }
        builder.Path = $"{path}/{operation.Trim('/')}";
        builder.Fragment = "";
        return builder.Uri;
    }
}
