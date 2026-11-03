using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Diagnostics;

namespace Sanadi.Infrastructure.Auth;

internal static class SsoTokenRequests
{
    internal static async Task<JsonDocument> PostAsync(HttpClient client, string endpoint,
        SsoSettings settings, IReadOnlyDictionary<string, string> values,
        string errorCode, string errorMessage, CancellationToken ct)
    {
        var step = "SSO_PROVIDER_TOKEN_REQUEST";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            { Content = new FormUrlEncodedContent(values) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
            using var response = await client.SendAsync(request, ct);
            SsoDiagnostics.Step(step, response.IsSuccessStatusCode ? "ok" : "rejected", statusCode: (int)response.StatusCode);
            if (!response.IsSuccessStatusCode) throw new SanadiException(errorMessage, 401, errorCode);
            step = "SSO_PROVIDER_TOKEN_RESPONSE_PARSE";
            SsoDiagnostics.Step(step, "begin");
            var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            SsoDiagnostics.Step(step);
            return document;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }
}
