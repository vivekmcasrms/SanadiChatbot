using Microsoft.Extensions.Options;

namespace Sanadi.Infrastructure.Documents;

public sealed class DocumentOptions
{
    public const string Section = "Documents";

    /// <summary>
    /// Public web app origin used in QR codes and printed verification links.
    /// Never point this at a preview host — configuration only.
    /// </summary>
    public string PublicAppUrl { get; set; } = string.Empty;

    /// <summary>UAEU brand red used for chrome, rules and accents.</summary>
    public string BrandColor { get; set; } = "#D3202E";
}

public static class DocumentPublicUrl
{
    public static string Resolve(IOptions<DocumentOptions> options, string? requestOrigin)
    {
        var configured = options.Value.PublicAppUrl?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return configured.TrimEnd('/');

        if (!string.IsNullOrWhiteSpace(requestOrigin))
        {
            try
            {
                var origin = new Uri(requestOrigin).GetLeftPart(UriPartial.Authority).TrimEnd('/');
                if (!origin.Contains("localhost", StringComparison.OrdinalIgnoreCase) &&
                    !origin.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase))
                    return origin;
            }
            catch
            {
                /* fall through */
            }
        }

        return "http://localhost:8080";
    }

    public static string VerificationUrl(string publicOrigin, string token) =>
        $"{publicOrigin.TrimEnd('/')}/verify/{Uri.EscapeDataString(token)}";
}
