using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Sanadi.Infrastructure.Auth;

public class SupabaseAuthOptions
{
    /// <summary>Base URL of the GoTrue/auth server, e.g. https://xyz.supabase.co</summary>
    public string Url { get; set; } = "";
    public string AnonKey { get; set; } = "";
    /// <summary>HS256 JWT secret used to validate bearer tokens issued by the auth server.</summary>
    public string JwtSecret { get; set; } = "";
    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "authenticated";
}

public sealed record SignInResult(bool Success, Guid UserId, string Email, string AccessToken, string? Error);

/// <summary>Password sign-in against the existing auth server, so current
/// student, owner and admin accounts keep working unchanged.</summary>
public class SupabaseAuthService(HttpClient http, IOptions<SupabaseAuthOptions> options)
{
    private readonly SupabaseAuthOptions _o = options.Value;

    public async Task<SignInResult> SignInAsync(string email, string password, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_o.Url.TrimEnd('/')}/auth/v1/token?grant_type=password")
        {
            Content = JsonContent.Create(new { email, password }),
        };
        req.Headers.Add("apikey", _o.AnonKey);

        using var res = await http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            return new SignInResult(false, Guid.Empty, email, "", "Incorrect email or password. Please check your details and try again.");

        using var doc = JsonDocument.Parse(body);
        var token = doc.RootElement.GetProperty("access_token").GetString()!;
        var userId = Guid.Parse(doc.RootElement.GetProperty("user").GetProperty("id").GetString()!);
        return new SignInResult(true, userId, email, token, null);
    }
}
