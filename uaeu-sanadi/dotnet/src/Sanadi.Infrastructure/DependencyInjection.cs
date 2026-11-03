using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Sanadi.Application;
using Sanadi.Application.Agent;
using Sanadi.Application.Knowledge;
using Sanadi.Application.Services;
using Sanadi.Infrastructure.Ai;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Documents;
using Sanadi.Infrastructure.Knowledge;
using Sanadi.Infrastructure.Persistence;
using Sanadi.Infrastructure.Platform;

namespace Sanadi.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddSanadi(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<AiOptions>(config.GetSection("Ai"));
        services.Configure<StorageOptions>(config.GetSection("Storage"));
        services.Configure<SmtpOptions>(config.GetSection("Smtp"));
        services.Configure<DocumentOptions>(config.GetSection("Documents"));
        services.Configure<SupabaseAuthOptions>(config.GetSection("Auth"));

        services.AddDbContext<SanadiDbContext>(o =>
            o.UseNpgsql(config.GetConnectionString("Postgres")));
        services.AddScoped<ISanadiDbContext>(sp => sp.GetRequiredService<SanadiDbContext>());

        services.AddHttpClient<IChatModel, LovableAiChatModel>((sp, c) =>
        {
            var key = config["Ai:ApiKey"];
            if (!string.IsNullOrWhiteSpace(key)) c.DefaultRequestHeaders.Add("Authorization", $"Bearer {key}");
            c.Timeout = TimeSpan.FromMinutes(3);
        });
        services.AddHttpClient<IEmbeddingModel, LovableEmbeddingModel>((sp, c) =>
        {
            var key = config["Ai:ApiKey"];
            if (!string.IsNullOrWhiteSpace(key)) c.DefaultRequestHeaders.Add("Authorization", $"Bearer {key}");
        });
        services.AddHttpClient<SupabaseAuthService>();
        services.AddHttpClient<IWebFetcher, HttpWebFetcher>(c =>
            c.DefaultRequestHeaders.Add("User-Agent", "SanadiKnowledgeBot/1.0"));

        services.AddScoped<IKnowledgeRetriever, HybridKnowledgeRetriever>();
        services.AddScoped<IDocumentTextExtractor, PdfTextExtractor>();
        services.AddSingleton<IFileStorage, LocalFileStorage>();
        services.AddScoped<IEmailSender, SmtpEmailSender>();
        services.AddScoped<IPdfLetterService, QuestPdfLetterService>();

        services.AddScoped<StudentContextService>();
        services.AddScoped<CaseService>();
        services.AddScoped<DocumentService>();
        services.AddScoped<KnowledgeCenterService>();
        services.AddScoped<ToolRegistry>();
        services.AddScoped<AgentOrchestrator>();

        return services;
    }
}
