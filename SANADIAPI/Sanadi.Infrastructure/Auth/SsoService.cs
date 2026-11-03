using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Infrastructure.Auth;

public sealed class SsoService(
    ISsoSettingsProvider settingsProvider,
    ISsoStateStore stateStore,
    IAuthService auth,
    IHttpClientFactory httpClientFactory,
    IOptions<JwtOptions> jwtOptions,
    TimeProvider clock,
    ISsoEmailTokens? emailTokens = null,
    ILogger<SsoService>? logger = null) : ISsoService
{
    private static readonly TimeSpan FlowLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(2);

    public async Task<SsoInitiation> InitiateAsync(CancellationToken cancellationToken, bool forceLogin = false, string? browserChallenge = null)
    {
        var step = "SSO_INITIATE";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            var settings = await GetValidatedSettingsAsync(cancellationToken);
            var scopes = settings.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
            if (!scopes.Contains("email", StringComparer.OrdinalIgnoreCase)) scopes.Add("email");
            var state = RandomUrlSafe(32);
            var nonce = RandomUrlSafe(32);
            var verifier = RandomUrlSafe(64);
            var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
            var stateReference = SsoDiagnostics.Reference(state);
            step = "SSO_STATE_PROTECT";
            SsoDiagnostics.Step(step, "begin", reference: stateReference);
            var context = Protect(new FlowContext(nonce, verifier, browserChallenge));
            SsoDiagnostics.Step(step, reference: stateReference);

            step = "SSO_STATE_STORE";
            SsoDiagnostics.Step(step, "begin", reference: stateReference);
            await stateStore.StoreAsync(
                Hash(state),
                context,
                clock.GetUtcNow().Add(FlowLifetime),
                cancellationToken);
            SsoDiagnostics.Step(step, reference: stateReference);

            step = "SSO_PROVIDER_REDIRECT_BUILD";
            SsoDiagnostics.Step(step, "begin");
            var query = new Dictionary<string, string>
            {
                ["client_id"] = settings.ClientId,
                ["response_type"] = "code",
                ["redirect_uri"] = settings.RedirectUri,
                ["scope"] = string.Join(' ', scopes),
                ["state"] = state,
                ["nonce"] = nonce,
                ["code_challenge"] = challenge,
                ["code_challenge_method"] = "S256"
            };
            if (forceLogin) { query["prompt"] = "login"; query["max_age"] = "0"; }

            var initiation = new SsoInitiation(AddQueryString(settings.AuthorizationEndpoint, query));
            SsoDiagnostics.Step(step, reference: stateReference);
            return initiation;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    public async Task<string?> LogoutRedirectAsync(CancellationToken cancellationToken)
    {
        var settings = await GetValidatedSettingsAsync(cancellationToken);
        var authorization = new Uri(settings.AuthorizationEndpoint);
        var origin = authorization.GetLeftPart(UriPartial.Authority);
        var metadata = await LoadMetadataAsync(new Uri(origin), origin, cancellationToken);
        if (!Uri.TryCreate(metadata.EndSessionEndpoint, UriKind.Absolute, out var endpoint) ||
            endpoint.Scheme != "https" || !string.Equals(endpoint.GetLeftPart(UriPartial.Authority), origin, StringComparison.OrdinalIgnoreCase))
            return null;
        return AddQueryString(endpoint.AbsoluteUri, new Dictionary<string, string>
        {
            ["client_id"] = settings.ClientId,
            ["post_logout_redirect_uri"] = settings.UiOrigin.TrimEnd('/') + "/auth"
        });
    }

    public async Task<SsoCompletion> CompleteAsync(
        SsoCallbackRequest request,
        CancellationToken cancellationToken)
    {
        var step = "SSO_CALLBACK_COMPLETE";
        SsoDiagnostics.Step(step, "begin", reference: SsoDiagnostics.Reference(request.State));
        try
        {
            var settings = await GetValidatedSettingsAsync(cancellationToken);
            step = "SSO_CALLBACK_STATE_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (string.IsNullOrWhiteSpace(request.State))
                throw SsoFailure("The SSO response did not contain a valid state.", "sso_invalid_state");
            SsoDiagnostics.Step(step);

            step = "SSO_CALLBACK_STATE_CONSUME";
            SsoDiagnostics.Step(step, "begin", reference: SsoDiagnostics.Reference(request.State));
            var protectedContext = await stateStore.ConsumeAsync(
                Hash(request.State),
                clock.GetUtcNow(),
                cancellationToken);
            if (string.IsNullOrWhiteSpace(protectedContext))
                throw SsoFailure("The SSO request has expired or was already used.", "sso_invalid_state");

            if (protectedContext == "sso_expired")
                throw SsoFailure("The SSO request has expired.", "sso_expired");
            SsoDiagnostics.Step(step);

            step = "SSO_CALLBACK_STATE_UNPROTECT";
            SsoDiagnostics.Step(step, "begin");
            var flow = Unprotect<FlowContext>(protectedContext);
            SsoDiagnostics.Step(step);
            step = "SSO_CALLBACK_PROVIDER_RESULT";
            SsoDiagnostics.Step(step, "begin");
            if (request.Error == "login_required")
                throw SsoFailure("The SSO session has expired.", "sso_expired");
            if (!string.IsNullOrWhiteSpace(request.Error))
                throw SsoFailure("SSO authentication was not completed.", "sso_provider_error");
            if (string.IsNullOrWhiteSpace(request.Code))
                throw SsoFailure("The SSO authorization code is missing.", "sso_invalid_code");
            SsoDiagnostics.Step(step);

            step = "SSO_CODE_EXCHANGE";
            var token = await ExchangeCodeAsync(settings, request.Code, flow.PkceVerifier, cancellationToken);
            step = "SSO_ID_TOKEN_VALIDATE";
            var principal = await ValidateIdTokenAsync(settings, token.IdToken, flow.Nonce, cancellationToken);

            step = "SSO_IDENTITY_RESOLVE";
            SsoDiagnostics.Step(step, "begin");
            var emailClaim = TrustedEmail(principal.Claims);
            var name = TrustedName(principal.Claims);
            var username = ProviderUsername(principal.Claims);
            if (emailClaim is null || name is null)
            {
                SsoDiagnostics.Step("SSO_IDENTITY_USERINFO_FALLBACK", "begin");
                var subject = principal.FindFirst("sub")?.Value ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                var userInfo = await ReadUserInfoAsync(settings, token.AccessToken, subject, cancellationToken);
                emailClaim ??= userInfo.Email;
                name ??= userInfo.Name;
                if (emailClaim is null)
                {
                    if (username is not null && userInfo.Username is not null &&
                        !string.Equals(username, userInfo.Username, StringComparison.OrdinalIgnoreCase))
                        throw SsoFailure("The SSO username does not match the authenticated identity.", "sso_invalid_identity");
                    username ??= userInfo.Username;
                }
                SsoDiagnostics.Step("SSO_IDENTITY_USERINFO_FALLBACK");
            }
            // UAEU's provider can return only `username`, even with the email scope.
            // Map that authenticated claim using the configured university domain;
            // the existing SQL lookup still requires a registered, active account and roles.
            emailClaim ??= EmailFromUsername(username, settings.RequiredEmailDomain);
            var email = NormalizeEmail(emailClaim ?? "");
            ValidateEmail(email);
            // Some university identity providers expose only a username/email, not
            // a display-name claim. Still pass the authenticated username to the
            // existing account validation procedure instead of null.
            name ??= email[..email.LastIndexOf('@')];
            SsoDiagnostics.Step(step);
            step = "SSO_ACCOUNT_LOGIN";
            SsoDiagnostics.Step(step, "begin");
            var tokens = await auth.LoginWithSsoAsync(new SsoLoginRequest(email, name), cancellationToken);
            SsoDiagnostics.Step(step);
            if (emailTokens is not null)
            {
                try
                {
                    SsoDiagnostics.Step("SSO_DELEGATED_TOKEN_RETAIN", "begin");
                    await emailTokens.CaptureAsync(tokens, settings, token.AccessToken, token.RefreshToken,
                        token.ExpiresAt, cancellationToken);
                    SsoDiagnostics.Step("SSO_DELEGATED_TOKEN_RETAIN");
                }
                catch (Exception ex)
                {
                    SsoDiagnostics.Error("SSO_DELEGATED_TOKEN_RETAIN", ex);
                    // An email integration/storage failure must not undo a successful login.
                    logger?.LogWarning("SSO login succeeded, but the delegated email token could not be retained.");
                }
            }
            var ticket = RandomUrlSafe(32);
            var expiresAt = clock.GetUtcNow().Add(TicketLifetime);
            var ticketReference = SsoDiagnostics.Reference("session-ticket|" + ticket);
            step = "SSO_SESSION_TICKET_PROTECT_STORE";
            SsoDiagnostics.Step(step, "begin", reference: ticketReference);
            await stateStore.StoreAsync(Hash("session-ticket|" + ticket),
                Protect(new SessionTicket(tokens, expiresAt, flow.BrowserChallenge), "session-ticket"), expiresAt, cancellationToken);
            SsoDiagnostics.Step(step, reference: ticketReference);
            step = "SSO_UI_REDIRECT_BUILD";
            SsoDiagnostics.Step(step, "begin");
            var completion = new SsoCompletion(tokens,
                AddQueryString(BuildUiRedirect(settings.UiOrigin, null), new Dictionary<string, string> { ["ssoTicket"] = ticket }));
            SsoDiagnostics.Step(step, reference: ticketReference);
            return completion;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    public async Task<AuthTokens> RedeemSessionAsync(string ticket, CancellationToken cancellationToken, string? verifier = null)
    {
        var step = "SSO_SESSION_TICKET_CHECK";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            if (string.IsNullOrWhiteSpace(ticket) || ticket.Length != 43)
                throw SsoFailure("The SSO session ticket is invalid or expired.", "sso_invalid_ticket");
            var ticketReference = SsoDiagnostics.Reference("session-ticket|" + ticket);
            SsoDiagnostics.Step(step, reference: ticketReference);
            step = "SSO_SESSION_TICKET_CONSUME";
            SsoDiagnostics.Step(step, "begin", reference: ticketReference);
            var payload = await stateStore.ConsumeAsync(Hash("session-ticket|" + ticket), clock.GetUtcNow(), cancellationToken);
            if (string.IsNullOrWhiteSpace(payload) || payload == "sso_expired")
                throw SsoFailure("The SSO session ticket is invalid or expired.", "sso_invalid_ticket");
            SsoDiagnostics.Step(step);
            step = "SSO_SESSION_TICKET_UNPROTECT";
            SsoDiagnostics.Step(step, "begin");
            SessionTicket session;
            try { session = Unprotect<SessionTicket>(payload, "session-ticket"); }
            catch (SanadiException) { throw SsoFailure("The SSO session ticket is invalid.", "sso_invalid_ticket"); }
            SsoDiagnostics.Step(step);
            step = "SSO_SESSION_TICKET_EXPIRY_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (session.ExpiresAt <= clock.GetUtcNow())
                throw SsoFailure("The SSO session ticket has expired.", "sso_invalid_ticket");
            SsoDiagnostics.Step(step);
            step = "SSO_SESSION_BROWSER_PROOF_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (session.BrowserChallenge is not null &&
                (string.IsNullOrWhiteSpace(verifier) || verifier.Length != 43 ||
                 !FixedTimeEquals(Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))), session.BrowserChallenge)))
                throw SsoFailure("The SSO session ticket does not belong to this browser.", "sso_invalid_ticket");
            SsoDiagnostics.Step(step);
            SsoDiagnostics.Step("SSO_SESSION_TICKET_REDEEMED", reference: ticketReference);
            return session.Tokens;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    public async Task<string> FailureRedirectAsync(string errorCode, CancellationToken cancellationToken)
    {
        const string step = "SSO_FAILURE_REDIRECT_BUILD";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            var settings = await settingsProvider.GetAsync(cancellationToken);
            var redirect = BuildUiRedirect(settings.UiOrigin, errorCode);
            SsoDiagnostics.Step(step);
            return redirect;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private async Task<SsoSettings> GetValidatedSettingsAsync(CancellationToken cancellationToken)
    {
        var step = "SSO_SETTINGS_LOAD";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            var settings = await settingsProvider.GetAsync(cancellationToken);
            SsoDiagnostics.Step(step);
            step = "SSO_SETTINGS_ENABLED_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (!settings.IsEnabled)
                throw new SanadiException("SSO is currently unavailable.", 503, "sso_disabled");
            SsoDiagnostics.Step(step);

            step = "SSO_SETTINGS_AUTHORIZATION_ENDPOINT_CHECK";
            SsoDiagnostics.Step(step, "begin");
            RequireAbsoluteHttps(settings.AuthorizationEndpoint, "authorization endpoint");
            SsoDiagnostics.Step(step);
            step = "SSO_SETTINGS_TOKEN_ENDPOINT_CHECK";
            SsoDiagnostics.Step(step, "begin");
            RequireAbsoluteHttps(settings.TokenEndpoint, "token endpoint");
            SsoDiagnostics.Step(step);
            step = "SSO_SETTINGS_CALLBACK_URI_CHECK";
            SsoDiagnostics.Step(step, "begin");
            RequireAbsoluteHttps(settings.RedirectUri, "redirect URI");
            SsoDiagnostics.Step(step);
            step = "SSO_SETTINGS_UI_ORIGIN_CHECK";
            SsoDiagnostics.Step(step, "begin");
            RequireAbsoluteHttps(settings.UiOrigin, "UI origin");
            SsoDiagnostics.Step(step);
            step = "SSO_SETTINGS_CREDENTIALS_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (string.IsNullOrWhiteSpace(settings.ClientId) || string.IsNullOrWhiteSpace(settings.ClientSecret))
                throw new SanadiException("SSO client credentials are not configured.", 503, "sso_not_configured");
            SsoDiagnostics.Step(step);
            step = "SSO_SETTINGS_SCOPE_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (!settings.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Contains("openid", StringComparer.OrdinalIgnoreCase))
                throw new SanadiException("SSO scope must include openid.", 503, "sso_not_configured");
            SsoDiagnostics.Step(step);
            return settings;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private async Task<TokenResponse> ExchangeCodeAsync(
        SsoSettings settings,
        string code,
        string verifier,
        CancellationToken cancellationToken)
    {
        var step = "SSO_CODE_EXCHANGE";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            var values = new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = code,
                ["redirect_uri"] = settings.RedirectUri,
                ["client_id"] = settings.ClientId,
                ["code_verifier"] = verifier
            };
            using var document = await PostClientAuthenticatedFormAsync(
                settings.TokenEndpoint,
                settings,
                values,
                cancellationToken);

            step = "SSO_PROVIDER_TOKEN_FIELDS_CHECK";
            SsoDiagnostics.Step(step, "begin");
            var accessToken = StringProperty(document.RootElement, "access_token");
            var idToken = StringProperty(document.RootElement, "id_token");
            if (string.IsNullOrWhiteSpace(accessToken) || string.IsNullOrWhiteSpace(idToken))
                throw SsoFailure("The SSO provider returned an invalid token response.", "sso_invalid_code");
            var token = new TokenResponse(accessToken, idToken, StringProperty(document.RootElement, "refresh_token"),
                SsoEmailTokens.Expiry(document.RootElement, clock.GetUtcNow()));
            SsoDiagnostics.Step(step);
            SsoDiagnostics.Step("SSO_CODE_EXCHANGE");
            return token;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private async Task ValidateAccessTokenAsync(
        SsoSettings settings,
        string accessToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(settings.IntrospectEndpoint)) return;
        RequireAbsoluteHttps(settings.IntrospectEndpoint, "introspection endpoint");
        using var document = await PostClientAuthenticatedFormAsync(
            settings.IntrospectEndpoint,
            settings,
            new Dictionary<string, string> { ["token"] = accessToken },
            cancellationToken);
        if (!BooleanProperty(document.RootElement, "active"))
            throw SsoFailure("The SSO access token is invalid or expired.", "sso_invalid_token");
    }

    private async Task<ClaimsPrincipal> ValidateIdTokenAsync(
        SsoSettings settings,
        string idToken,
        string expectedNonce,
        CancellationToken cancellationToken)
    {
        var step = "SSO_ID_TOKEN_PARSE";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            JwtSecurityToken unvalidated;
            try
            {
                unvalidated = new JwtSecurityTokenHandler().ReadJwtToken(idToken);
            }
            catch (Exception ex)
            {
                SsoDiagnostics.Error(step, ex);
                throw SsoFailure("The SSO identity token is invalid.", "sso_invalid_token");
            }
            SsoDiagnostics.Step(step);

            step = "SSO_ID_TOKEN_ISSUER_CHECK";
            SsoDiagnostics.Step(step, "begin");
            var authorizationOrigin = new Uri(settings.AuthorizationEndpoint).GetLeftPart(UriPartial.Authority);
            if (!Uri.TryCreate(unvalidated.Issuer, UriKind.Absolute, out var issuerUri) ||
                !string.Equals(issuerUri.GetLeftPart(UriPartial.Authority), authorizationOrigin, StringComparison.OrdinalIgnoreCase))
            {
                throw SsoFailure("The SSO token issuer is invalid.", "sso_invalid_token");
            }
            SsoDiagnostics.Step(step);

            step = "SSO_PROVIDER_METADATA_LOAD";
            var metadata = await LoadMetadataAsync(issuerUri, authorizationOrigin, cancellationToken);
            step = "SSO_PROVIDER_SIGNING_KEYS_REQUEST";
            SsoDiagnostics.Step(step, "begin");
            using var jwksResponse = await Client().GetAsync(metadata.JwksUri, cancellationToken);
            SsoDiagnostics.Step(step, jwksResponse.IsSuccessStatusCode ? "ok" : "rejected", statusCode: (int)jwksResponse.StatusCode);
            if (!jwksResponse.IsSuccessStatusCode)
                throw SsoFailure("SSO signing keys are unavailable.", "sso_provider_unavailable", 503);
            step = "SSO_PROVIDER_SIGNING_KEYS_PARSE";
            SsoDiagnostics.Step(step, "begin");
            var jwksJson = await jwksResponse.Content.ReadAsStringAsync(cancellationToken);
            var signingKeys = new JsonWebKeySet(jwksJson).GetSigningKeys();
            SsoDiagnostics.Step(step);

            step = "SSO_ID_TOKEN_VALIDATE";
            SsoDiagnostics.Step(step, "begin");
            ClaimsPrincipal principal;
            try
            {
                principal = new JwtSecurityTokenHandler().ValidateToken(idToken, new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = metadata.Issuer,
                    ValidateAudience = true,
                    ValidAudience = settings.ClientId,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKeys = signingKeys,
                    ValidateLifetime = true,
                    RequireExpirationTime = true,
                    RequireSignedTokens = true,
                    ClockSkew = TimeSpan.FromMinutes(1)
                }, out _);
            }
            catch (SecurityTokenExpiredException ex)
            {
                SsoDiagnostics.Error(step, ex);
                throw SsoFailure("The SSO identity token has expired.", "sso_expired");
            }
            catch (Exception ex)
            {
                SsoDiagnostics.Error(step, ex);
                throw SsoFailure("The SSO identity token could not be validated.", "sso_invalid_token");
            }
            SsoDiagnostics.Step(step);

            step = "SSO_ID_TOKEN_NONCE_CHECK";
            SsoDiagnostics.Step(step, "begin");
            var nonce = principal.FindFirst("nonce")?.Value;
            if (!FixedTimeEquals(nonce, expectedNonce))
                throw SsoFailure("The SSO nonce is invalid.", "sso_invalid_nonce");
            SsoDiagnostics.Step(step);
            return principal;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private async Task<ProviderMetadata> LoadMetadataAsync(
        Uri issuer,
        string authorizationOrigin,
        CancellationToken cancellationToken)
    {
        SsoDiagnostics.Step("SSO_PROVIDER_METADATA_LOAD", "begin");
        var candidates = new[]
        {
            issuer.ToString().TrimEnd('/') + "/.well-known/openid-configuration",
            authorizationOrigin + "/.well-known/openid-configuration",
            authorizationOrigin + "/as/.well-known/openid-configuration"
        }.Distinct(StringComparer.OrdinalIgnoreCase);

        var attempt = 0;
        foreach (var candidate in candidates)
        {
            var operation = "discovery_attempt_" + ++attempt;
            var step = "SSO_PROVIDER_METADATA_REQUEST";
            try
            {
                SsoDiagnostics.Step(step, "begin", operation);
                using var response = await Client().GetAsync(candidate, cancellationToken);
                SsoDiagnostics.Step(step, response.IsSuccessStatusCode ? "ok" : "rejected", operation, (int)response.StatusCode);
                if (!response.IsSuccessStatusCode) continue;
                step = "SSO_PROVIDER_METADATA_PARSE";
                SsoDiagnostics.Step(step, "begin", operation);
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                SsoDiagnostics.Step(step, operation: operation);
                step = "SSO_PROVIDER_METADATA_VALIDATE";
                SsoDiagnostics.Step(step, "begin", operation);
                var configuredIssuer = StringProperty(document.RootElement, "issuer");
                var jwksUri = StringProperty(document.RootElement, "jwks_uri");
                if (!Uri.TryCreate(configuredIssuer, UriKind.Absolute, out var configuredIssuerUri) ||
                    !Uri.TryCreate(jwksUri, UriKind.Absolute, out var jwks) ||
                    !string.Equals(configuredIssuerUri.GetLeftPart(UriPartial.Authority), authorizationOrigin, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(jwks.GetLeftPart(UriPartial.Authority), authorizationOrigin, StringComparison.OrdinalIgnoreCase))
                {
                    SsoDiagnostics.Step(step, "rejected", operation);
                    continue;
                }
                SsoDiagnostics.Step(step, operation: operation);
                SsoDiagnostics.Step("SSO_PROVIDER_METADATA_LOAD");
                return new ProviderMetadata(configuredIssuer, jwksUri, StringProperty(document.RootElement, "end_session_endpoint"));
            }
            catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                SsoDiagnostics.Error(step, ex, operation);
                // Try the next standards-compliant discovery location.
            }
            catch (HttpRequestException ex)
            {
                SsoDiagnostics.Error(step, ex, operation);
                // Try the next standards-compliant discovery location.
            }
            catch (JsonException ex)
            {
                SsoDiagnostics.Error(step, ex, operation);
                // Try the next standards-compliant discovery location.
            }
        }
        throw SsoFailure("SSO provider metadata is unavailable.", "sso_provider_unavailable", 503);
    }

    private async Task<(string? Email, string? Name, string? Username)> ReadUserInfoAsync(
        SsoSettings settings,
        string accessToken,
        string? expectedSubject,
        CancellationToken cancellationToken)
    {
        var step = "SSO_PROVIDER_USERINFO_ENDPOINT_CHECK";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            if (string.IsNullOrWhiteSpace(settings.UserInfoEndpoint))
            {
                SsoDiagnostics.Step(step, "skipped", "not_configured");
                return (null, null, null);
            }
            RequireAbsoluteHttps(settings.UserInfoEndpoint, "user-info endpoint");
            SsoDiagnostics.Step(step);
            step = "SSO_PROVIDER_USERINFO_REQUEST";
            SsoDiagnostics.Step(step, "begin");
            using var request = new HttpRequestMessage(HttpMethod.Get, settings.UserInfoEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await Client().SendAsync(request, cancellationToken);
            SsoDiagnostics.Step(step, response.IsSuccessStatusCode ? "ok" : "rejected", statusCode: (int)response.StatusCode);
            if (!response.IsSuccessStatusCode)
                throw SsoFailure("The SSO user profile could not be validated.", "sso_invalid_identity");
            step = "SSO_PROVIDER_USERINFO_PARSE";
            SsoDiagnostics.Step(step, "begin");
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            SsoDiagnostics.Step(step);
            step = "SSO_PROVIDER_USERINFO_SUBJECT_CHECK";
            SsoDiagnostics.Step(step, "begin");
            var subject = StringProperty(document.RootElement, "sub");
            if (string.IsNullOrWhiteSpace(expectedSubject) ||
                !string.Equals(subject, expectedSubject, StringComparison.Ordinal))
                throw SsoFailure("The SSO user profile does not match the authenticated identity.", "sso_invalid_identity");
            SsoDiagnostics.Step(step);
            step = "SSO_PROVIDER_USERINFO_CLAIMS_READ";
            SsoDiagnostics.Step(step, "begin");
            var result = (TrustedEmail(document.RootElement), TrustedName(document.RootElement),
                ProviderUsername(document.RootElement.EnumerateObject()
                    .Where(p => p.Value.ValueKind == JsonValueKind.String)
                    .Select(p => new Claim(p.Name, p.Value.GetString()!))));
            SsoDiagnostics.Step(step);
            return result;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private async Task<JsonDocument> PostClientAuthenticatedFormAsync(
        string endpoint,
        SsoSettings settings,
        IReadOnlyDictionary<string, string> values,
        CancellationToken cancellationToken)
    {
        return await SsoTokenRequests.PostAsync(Client(), endpoint, settings, values,
            "sso_invalid_code", "The SSO authorization code is invalid or expired.", cancellationToken);
    }

    private HttpClient Client() => httpClientFactory.CreateClient("Sso");

    private string Protect<T>(T context, string? purpose = null)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(context);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(StateEncryptionKey(), tag.Length);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, purpose is null ? null : Encoding.UTF8.GetBytes(purpose));
        var result = new byte[1 + nonce.Length + tag.Length + ciphertext.Length];
        result[0] = 1;
        nonce.CopyTo(result, 1);
        tag.CopyTo(result, 1 + nonce.Length);
        ciphertext.CopyTo(result, 1 + nonce.Length + tag.Length);
        return Base64Url(result);
    }

    private T Unprotect<T>(string value, string? purpose = null) where T : class
    {
        try
        {
            var payload = FromBase64Url(value);
            if (payload.Length < 30 || payload[0] != 1) throw new CryptographicException();
            var nonce = payload.AsSpan(1, 12);
            var tag = payload.AsSpan(13, 16);
            var ciphertext = payload.AsSpan(29);
            var plaintext = new byte[ciphertext.Length];
            using var aes = new AesGcm(StateEncryptionKey(), tag.Length);
            aes.Decrypt(nonce, ciphertext, tag, plaintext, purpose is null ? null : Encoding.UTF8.GetBytes(purpose));
            return JsonSerializer.Deserialize<T>(plaintext) ?? throw new CryptographicException();
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or JsonException)
        {
            SsoDiagnostics.Error(purpose == "session-ticket" ? "SSO_SESSION_TICKET_UNPROTECT" : "SSO_CALLBACK_STATE_UNPROTECT", ex);
            throw SsoFailure("The SSO request state is invalid.", "sso_invalid_state");
        }
    }

    private byte[] StateEncryptionKey()
    {
        var signingKey = jwtOptions.Value.SigningKey;
        if (string.IsNullOrWhiteSpace(signingKey) || signingKey.Length < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be at least 32 characters.");
        SsoDiagnostics.Step("SSO_STATE_SIGNING_KEY_CHECK");
        return SHA256.HashData(Encoding.UTF8.GetBytes("Sanadi.SsoState.v1|" + signingKey));
    }

    private static string? TrustedEmail(JsonElement element)
    {
        foreach (var name in new[] { "email", "EmailId", "UserEmail", "mail", "upn", "preferred_username" })
        {
            foreach (var property in element.EnumerateObject())
                if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase) &&
                    property.Value.ValueKind == JsonValueKind.String &&
                    IsEmailValue(property.Value.GetString()))
                    return property.Value.GetString();
        }
        return null;
    }

    private static string? ProviderUsername(IEnumerable<Claim> claims)
    {
        // Display names, numeric subjects and browser-supplied identifiers are not account keys.
        var values = claims.Where(c => c.Type.Equals("username", StringComparison.OrdinalIgnoreCase))
            .Select(c => c.Value.Trim()).Where(v => v.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (values.Length > 1)
            throw SsoFailure("The SSO provider returned conflicting usernames.", "sso_invalid_identity");
        return values.SingleOrDefault();
    }

    private static string? EmailFromUsername(string? username, string? configuredDomain)
    {
        var domain = configuredDomain?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(domain) ||
            Uri.CheckHostName(domain) != UriHostNameType.Dns || !domain.Contains('.') ||
            !System.Text.RegularExpressions.Regex.IsMatch(username, @"\A[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?\z") ||
            username.Contains("..", StringComparison.Ordinal)) return null;
        var email = $"{username}@{domain}";
        return IsEmailValue(email) ? email : null;
    }

    private static string? TrustedEmail(IEnumerable<Claim> claims)
    {
        foreach (var name in new[] { "email", ClaimTypes.Email, "EmailId", "UserEmail", "mail", "upn", ClaimTypes.Upn, "preferred_username" })
        {
            var value = claims.FirstOrDefault(c => c.Type.Equals(name, StringComparison.OrdinalIgnoreCase) && IsEmailValue(c.Value))?.Value;
            if (IsEmailValue(value)) return value;
        }
        return null;
    }

    private static string? TrustedName(IEnumerable<Claim> claims)
    {
        var claimList = claims.ToArray();
        foreach (var name in new[] { "name", ClaimTypes.Name, "display_name", "displayName", "preferred_name" })
        {
            var value = claimList.FirstOrDefault(c => c.Type.Equals(name, StringComparison.OrdinalIgnoreCase))?.Value;
            if (UsableName(value)) return value!.Trim();
        }
        var given = claimList.FirstOrDefault(c => c.Type.Equals("givenName", StringComparison.OrdinalIgnoreCase))?.Value?.Trim();
        var family = claimList.FirstOrDefault(c => c.Type.Equals("sn", StringComparison.OrdinalIgnoreCase))?.Value?.Trim();
        var fullName = string.Join(" ", new[] { given, family }.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (UsableName(fullName)) return fullName;

        foreach (var usernameClaim in new[] { "username", "user_name", "preferred_username", "unique_name", "uid", "sAMAccountName" })
        {
            var value = claimList.FirstOrDefault(c => c.Type.Equals(usernameClaim, StringComparison.OrdinalIgnoreCase))?.Value;
            if (UsableName(value)) return value!.Trim();
        }
        return null;
    }

    private static string? TrustedName(JsonElement element)
    {
        foreach (var name in new[] { "name", "display_name", "displayName", "preferred_name" })
        {
            var value = StringProperty(element, name);
            if (UsableName(value)) return value!.Trim();
        }
        var given = StringProperty(element, "given_name")?.Trim();
        var family = StringProperty(element, "family_name")?.Trim();
        var fullName = string.Join(" ", new[] { given, family }.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (UsableName(fullName)) return fullName;
        foreach (var usernameClaim in new[] { "username", "user_name", "preferred_username", "unique_name", "uid", "sAMAccountName" })
        {
            var value = StringProperty(element, usernameClaim);
            if (UsableName(value)) return value!.Trim();
        }
        return null;
    }

    private static bool UsableName(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        !IsEmailValue(value) &&
        !System.Text.RegularExpressions.Regex.IsMatch(value.Trim(), @"^\d+$");

    private static bool IsEmailValue(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        System.Net.Mail.MailAddress.TryCreate(value.Trim(), out var address) &&
        address.Address.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase) &&
        address.Host.Contains('.');

    private static void ValidateEmail(string email)
    {
        var at = email.LastIndexOf('@');
        if (at <= 0 || at == email.Length - 1)
            throw SsoFailure("The SSO provider did not return a valid university email.", "sso_invalid_identity");
    }

    private static string NormalizeEmail(string value) => value.Trim().ToLowerInvariant();
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string RandomUrlSafe(int bytes) => Base64Url(RandomNumberGenerator.GetBytes(bytes));
    private static string Base64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] FromBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized = normalized.PadRight(normalized.Length + (4 - normalized.Length % 4) % 4, '=');
        return Convert.FromBase64String(normalized);
    }

    private static bool FixedTimeEquals(string? left, string right)
    {
        if (left is null) return false;
        var a = Encoding.UTF8.GetBytes(left);
        var b = Encoding.UTF8.GetBytes(right);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    private static string AddQueryString(string endpoint, IReadOnlyDictionary<string, string> values)
    {
        var separator = endpoint.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return endpoint + separator + string.Join("&", values.Select(pair =>
            $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));
    }

    private static string BuildUiRedirect(string uiOrigin, string? errorCode)
    {
        RequireAbsoluteHttps(uiOrigin, "UI origin");
        var target = new Uri(new Uri(uiOrigin.TrimEnd('/') + "/"), "auth/callback").ToString();
        return errorCode is null ? target : target + "?ssoError=" + Uri.EscapeDataString(errorCode);
    }

    private static void RequireAbsoluteHttps(string? value, string label)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback))
            throw new SanadiException($"The SSO {label} is not configured securely.", 503, "sso_not_configured");
    }

    private static string? StringProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool BooleanProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) &&
        (value.ValueKind == JsonValueKind.True ||
         (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed) && parsed));

    private static SanadiException SsoFailure(string message, string code, int status = 401) =>
        new(message, status, code);

    private sealed record FlowContext(string Nonce, string PkceVerifier, string? BrowserChallenge = null);
    private sealed record SessionTicket(AuthTokens Tokens, DateTimeOffset ExpiresAt, string? BrowserChallenge);
    private sealed record TokenResponse(string AccessToken, string IdToken, string? RefreshToken, DateTimeOffset ExpiresAt);
    private sealed record ProviderMetadata(string Issuer, string JwksUri, string? EndSessionEndpoint);
}
