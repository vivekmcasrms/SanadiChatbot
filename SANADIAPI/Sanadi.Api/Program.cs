using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using Sanadi.Api.Middleware;
using Sanadi.Api.Security;
using Sanadi.Infrastructure;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Api.Diagnostics;

var builder = WebApplication.CreateBuilder(args);
Sanadi.Api.AI.AssistantRouting.Validate();
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);
builder.Services.AddSanadiInfrastructure(builder.Configuration);
builder.Services.AddControllers(options => options.Filters.Add<Sanadi.Api.Middleware.ApiFunctionErrorLoggingFilter>())
    .ConfigureApiBehaviorOptions(ApiRequestValidation.Configure)
    .AddJsonOptions(o =>
{
    // Keep property names as declared on DTOs/anonymous payloads (camelCase in
    // controllers), and accept either casing from the SPA.
    o.JsonSerializerOptions.PropertyNamingPolicy = null;
    o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.Configure<RouteOptions>(o =>
    o.ConstraintMap["notreserved"] = typeof(Sanadi.Api.Routing.NotReservedStorageBucketConstraint));
builder.Services.AddSignalR();
builder.Services.AddHttpContextAccessor();
builder.Services.AddTokenEndpointEgressGuard();

var jwt = builder.Configuration.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
var signingKey = string.IsNullOrWhiteSpace(jwt.SigningKey)
    ? "CHANGE-ME-TO-A-LONG-RANDOM-SECRET-KEY-32+"
    : jwt.SigningKey;

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Keep JWT claim names (sub, email, role) as issued so the existing
        // supabase-js client can read them the same way it did from GoTrue.
        options.MapInboundClaims = false;
        options.IncludeErrorDetails = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = "sub",
            RoleClaimType = "role"
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                if (string.IsNullOrWhiteSpace(ctx.Token) &&
                    !ctx.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) &&
                    ctx.Request.Cookies.TryGetValue(Sanadi.Api.Controllers.AuthController.AccessCookie, out var cookieToken))
                {
                    ctx.Token = cookieToken;
                }
                return Task.CompletedTask;
            },
            OnTokenValidated = async ctx =>
            {
                var sessionClaim = ctx.Principal?.FindFirst("sid")?.Value;
                Guid? sessionId = Guid.TryParse(sessionClaim, out var sid) ? sid : null;
                var header = ctx.Request.Headers.Authorization.ToString();
                var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                    ? header[7..].Trim() : ctx.Request.Cookies[Sanadi.Api.Controllers.AuthController.AccessCookie] ?? "";
                var sessions = ctx.HttpContext.RequestServices.GetRequiredService<Sanadi.Infrastructure.Auth.SqlAuthSessionStore>();
                if (!await sessions.IsActiveAsync(token, sessionId, ctx.HttpContext.RequestAborted))
                    ctx.Fail("Session has been signed out.");
            },
            OnAuthenticationFailed = ctx =>
            {
                SsoDiagnostics.Error("AUTH_TOKEN_VALIDATION", ctx.Exception);
                ctx.NoResult();
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddSingleton<Sanadi.Api.Survey.SurveyLinkCodec>();
builder.Services.AddScoped<Sanadi.Api.Notifications.ITicketEmailRepository, Sanadi.Api.Notifications.TicketEmailRepository>();
builder.Services.AddScoped<Sanadi.Api.Notifications.ITicketSurveyLinks, Sanadi.Api.Notifications.TicketSurveyLinks>();
builder.Services.AddScoped<Sanadi.Api.Notifications.TicketEmailDispatcher>();
builder.Services.AddScoped<Sanadi.Api.Notifications.IUniversityEmailAuthorizationRepository, Sanadi.Api.Notifications.UniversityEmailAuthorizationRepository>();
builder.Services.AddScoped<Sanadi.Api.Notifications.IUniversityEmailAuthorization, Sanadi.Api.Notifications.UniversityEmailAuthorization>();
builder.Services.AddHttpClient("UniversityEmailAuthorization", client =>
    { client.Timeout = TimeSpan.FromSeconds(30); client.MaxResponseContentBufferSize = 64 * 1024; })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
    .RedactLoggedHeaders(_ => true);
builder.Services.AddSingleton(sp => new Sanadi.Api.Notifications.EmailApiFileLog(
    Path.Combine(builder.Environment.ContentRootPath, "App_Data", "logs", "email"),
    sp.GetRequiredService<ILogger<Sanadi.Api.Notifications.EmailApiFileLog>>()));
builder.Services.AddTransient<Sanadi.Api.Notifications.EmailApiLoggingHandler>();
builder.Services.AddHttpClient("UniversityEmail", client => client.Timeout = TimeSpan.FromSeconds(30))
    .AddHttpMessageHandler<Sanadi.Api.Notifications.EmailApiLoggingHandler>()
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
    .RedactLoggedHeaders(_ => true);
builder.Services.AddHostedService<Sanadi.Api.Notifications.TicketEmailWorker>();

var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>();
builder.Services.AddCors(o => o.AddPolicy("app", p => p
    .WithOrigins(origins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))
    .WithExposedHeaders("Content-Range", "content-range")));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddFixedWindowLimiter("survey", cfg =>
    {
        cfg.PermitLimit = 30;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    o.AddFixedWindowLimiter("sso-diagnostics", cfg =>
    {
        cfg.PermitLimit = 120;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    o.AddFixedWindowLimiter("login", cfg =>
    {
        cfg.PermitLimit = 10;
        cfg.Window = TimeSpan.FromMinutes(1);
    });
    o.AddConcurrencyLimiter("sso", cfg =>
    {
        cfg.PermitLimit = 2000;
        cfg.QueueLimit = 0;
    });
    o.AddConcurrencyLimiter("voice", cfg =>
    {
        cfg.PermitLimit = 8;
        cfg.QueueLimit = 0;
    });
    // Optional public-clip preparation must not consume active voice-call/STT permits.
    o.AddConcurrencyLimiter("voice-presentation", cfg =>
    {
        cfg.PermitLimit = 2;
        cfg.QueueLimit = 0;
    });
    o.AddConcurrencyLimiter("voice-activity", cfg =>
    {
        cfg.PermitLimit = 8;
        cfg.QueueLimit = 0;
    });
    o.AddPolicy("voice-activity-ticket", context =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? context.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
            }));
});

builder.Services.AddHttpClient("AppServerProxy", client =>
{
    client.Timeout = Timeout.InfiniteTimeSpan;
});
builder.Services.AddHttpClient("AssistantModel", client =>
{
    client.Timeout = TimeSpan.FromSeconds(50);
});
builder.Services.AddHttpClient("VoiceInference", client =>
{
    // Spoken turns include ASR, assistant inference, and synthesis. The caller's
    // cancellation token still interrupts all three requests immediately.
    client.Timeout = TimeSpan.FromMinutes(3);
});
builder.Services.AddHttpClient("VoiceTranscription", client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
    .RedactLoggedHeaders(_ => true);
builder.Services.AddScoped<Sanadi.Api.AI.VoiceSpeechSynthesis>();
builder.Services.AddScoped<Sanadi.Api.AI.PrivateVoiceService>();
builder.Services.AddScoped<Sanadi.Api.AI.OllamaVoiceTranscription>();
builder.Services.AddScoped<Sanadi.Infrastructure.AppFunctions.IVoiceTranscriptTranslator, Sanadi.Api.AI.VoiceTranscriptTranslator>();
builder.Services.AddScoped<Sanadi.Infrastructure.AppFunctions.IVoiceTranscriber>(services =>
    services.GetRequiredService<Sanadi.Api.AI.OllamaVoiceTranscription>());
builder.Services.AddScoped<Sanadi.Api.AI.AdvisorSpeech>();
builder.Services.AddHttpClient("ConfiguredSpeech", client => client.Timeout = TimeSpan.FromSeconds(60))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddScoped<Sanadi.Api.AI.ConfiguredSpeech>();
builder.Services.AddSingleton<Sanadi.Api.AI.VoiceWelcomeAudio>();
builder.Services.AddSingleton<Sanadi.Api.AI.VoiceRoomTickets>();
builder.Services.AddSingleton<Sanadi.Api.AI.VoiceActivityDetector>();
builder.Services.AddSingleton<Sanadi.Api.AI.VoiceActivitySessions>();
builder.Services.AddSingleton<Sanadi.Api.AI.VoiceMetricsStore>();
// The voice chat endpoint (api/voice/chat) reuses the assistant engine without
// going through the text chat endpoints (api/chat).
builder.Services.AddScoped<Sanadi.Api.Controllers.AssistantController>();

var app = builder.Build();
Sanadi.Api.Notifications.InAppNotify.Logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(Sanadi.Api.Notifications.InAppNotify).FullName!);

app.UseMiddleware<ApiSecurityHeadersMiddleware>();

// CORS must wrap the pipeline so preflight and error responses still get
// Access-Control-Allow-Origin for the UI host (sanadit.uaeu.ac.ae).
app.UseCors("app");
// Wrap the error boundary to record the final auth HTTP status, including handled 500 responses.
app.UseMiddleware<SsoDiagnosticsMiddleware>();
// One error boundary covers proxy, authentication, controller and response-writing failures.
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
// Static UI has no Node — app functions/chat are served via the API host and
// forwarded to the local App Server process (business logic unchanged).
app.UseMiddleware<AppServerProxyMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<CurrentUserMiddleware>();
app.UseRateLimiter();
app.MapControllers();
app.MapHub<Sanadi.Api.Realtime.TableHub>("/realtime/v1/websocket");

app.Run();
