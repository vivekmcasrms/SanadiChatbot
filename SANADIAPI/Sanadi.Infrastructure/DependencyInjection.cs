using Microsoft.Extensions.DependencyInjection;
using Sanadi.Application.Auth;
using Sanadi.Application.Data;
using Sanadi.Application.Documents;
using Sanadi.Application.Realtime;
using Sanadi.Application.Rpc;
using Sanadi.Application.Security;
using Sanadi.Application.Storage;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Data;
using Sanadi.Infrastructure.Documents;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;
using Sanadi.Infrastructure.Realtime;
using Sanadi.Infrastructure.Rpc;
using Sanadi.Infrastructure.Library;
using Sanadi.Infrastructure.Knowledge;
using Sanadi.Infrastructure.Storage;

namespace Sanadi.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddSanadiInfrastructure(this IServiceCollection services, Microsoft.Extensions.Configuration.IConfiguration configuration)
    {
        services.Configure<SqlOptions>(configuration.GetSection(SqlOptions.Section));
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.Section));
        services.Configure<ApiKeyOptions>(configuration.GetSection(ApiKeyOptions.Section));
        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.Section));
        services.Configure<DocumentOptions>(configuration.GetSection(DocumentOptions.Section));

        services.AddMemoryCache();
        services.AddHttpClient("OclcLibrary", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(25);
        });
        services.AddHttpClient("Sso", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(30);
        });
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<ISqlConnectionFactory, SqlConnectionFactory>();
        services.AddSingleton<SchemaCatalog>();
        services.AddSingleton<ITokenService, JwtTokenService>();
        services.AddScoped<IPermissionService, PermissionService>();
        services.AddScoped<IAuthService, SqlAuthService>();
        services.AddScoped<SqlAuthSessionStore>();
        services.AddScoped<ISsoSettingsProvider, SqlSsoSettingsProvider>();
        services.AddScoped<ISsoStateStore, SqlSsoStateStore>();
        services.AddScoped<ISsoService, SsoService>();
        services.AddScoped<ISsoEmailTokenStore, SqlSsoEmailTokenStore>();
        services.AddScoped<ISsoEmailTokens, SsoEmailTokens>();
        services.AddHttpClient("SsoEmailToken", client => client.Timeout = TimeSpan.FromSeconds(30))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
            .RedactLoggedHeaders(_ => true);
        services.AddScoped<IDataQueryService, SqlDataQueryService>();
        services.AddScoped<IObjectStorage, LocalObjectStorage>();
        services.AddSingleton<ILetterPdfRenderer, SkiaLetterPdfRenderer>();
        services.AddScoped<IEnrolmentLetterIssuer, EnrolmentLetterIssuer>();
        services.AddSingleton<IRealtimePublisher, NullRealtimePublisher>();
        services.AddScoped<IRpcExecutor, RpcExecutor>();
        services.AddScoped<OclcLibrarySearchService>();
        services.AddScoped<Sanadi.Infrastructure.Appointments.AppointmentChatService>();
        services.AddScoped<Sanadi.Infrastructure.AppFunctions.AppointmentAvailabilityFunctions>();
        services.AddScoped<Sanadi.Infrastructure.AppFunctions.AcademicFunctions>();
        services.AddScoped<Sanadi.Infrastructure.AppFunctions.FunctionData>();
        services.AddScoped<Sanadi.Infrastructure.AppFunctions.QualityFunctions>();
        services.AddScoped<Sanadi.Infrastructure.AppFunctions.EvaluationFunctions>();
        services.AddScoped<Sanadi.Infrastructure.AppFunctions.VoiceTranscriptionService>();
        services.AddHttpClient("VoiceTranscription", client => client.Timeout = Timeout.InfiniteTimeSpan);
        services.AddHttpClient("KnowledgeEmbeddings", client => client.Timeout = TimeSpan.FromSeconds(60));
        services.AddHttpClient("KnowledgeCrawl", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("SanadiKnowledgeBot/1.0");
        });

        services.AddScoped<IEmbeddingSettingsProvider, SqlEmbeddingSettingsProvider>();
        services.AddScoped<KnowledgeEmbeddingsService>();
        services.AddScoped<KnowledgeRetrievalService>();
        services.AddScoped<KnowledgeIngestService>();
        services.AddScoped<KnowledgeDocumentOpsService>();
        services.AddScoped<KnowledgeWebCrawlService>();
        services.AddScoped<KnowledgeConnectorsService>();
        services.AddScoped<KnowledgeSourcesService>();
        services.AddScoped<KnowledgeSeedService>();

        services.AddScoped<IRpcHandler, HasRoleHandler>();
        services.AddScoped<IRpcHandler, IsStaffHandler>();
        services.AddScoped<IRpcHandler, IsManagerHandler>();
        services.AddScoped<IRpcHandler, CanAccessCaseHandler>();
        services.AddScoped<IRpcHandler, CanMonitorCasesHandler>();
        services.AddScoped<IRpcHandler, CanMonitorAllUnitsHandler>();
        services.AddScoped<IRpcHandler, StaffUnitHandler>();
        services.AddScoped<IRpcHandler, IsAccessRevokedHandler>();
        services.AddScoped<IRpcHandler, ListAppointmentAvailabilityHandler>();
        services.AddScoped<IRpcHandler, MyAppointmentsHandler>();
        services.AddScoped<IRpcHandler, BookAppointmentHandler>();
        services.AddScoped<IRpcHandler, CancelAppointmentHandler>();
        services.AddScoped<IRpcHandler, RescheduleAppointmentHandler>();
        services.AddScoped<IRpcHandler, GetServiceAvailabilityHandler>();
        services.AddScoped<IRpcHandler, GenerateAvailabilitySlotsHandler>();
        services.AddScoped<IRpcHandler, SearchKnowledgeHandler>();
        services.AddScoped<IRpcHandler, NextDocumentReferenceHandler>();
        services.AddScoped<IRpcHandler, VerifyStudentDocumentHandler>();
        services.AddScoped<IRpcHandler, PurgeExpiredDocumentsHandler>();
        services.AddScoped<IRpcHandler, PurgeMyIssuedDocumentHandler>();
        services.AddScoped<IRpcHandler, ClaimNotificationDeliveriesHandler>();
        services.AddScoped<IRpcHandler, RemoveMyRequestsHandler>();
        services.AddScoped<IRpcHandler, RemoveMySuggestionsHandler>();
        services.AddScoped<IRpcHandler, AdminCaseMonitorSummaryHandler>();
        services.AddScoped<IRpcHandler, AdminUnitMonitorHandler>();
        services.AddScoped<IRpcHandler, AdminOwnerMonitorHandler>();
        services.AddScoped<IRpcHandler, AdminCaseMonitorHandler>();
        services.AddScoped<IRpcHandler, AdminCaseMonitorDetailHandler>();
        services.AddScoped<IRpcHandler, AdminGovernanceOverviewHandler>();
        services.AddScoped<IRpcHandler, AdminOwnerPerformanceHandler>();
        services.AddScoped<IRpcHandler, AdminGovernanceReportHandler>();
        services.AddScoped<IRpcHandler, EvaluationMetricsHandler>();
        services.AddScoped<IRpcHandler, ChangeInternshipAssignmentHandler>();
        return services;
    }
}
