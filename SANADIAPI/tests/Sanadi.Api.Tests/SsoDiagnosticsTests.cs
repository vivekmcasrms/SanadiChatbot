using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class SsoDiagnosticsTests
{
    [Fact]
    public void Exception_messages_and_raw_correlation_secrets_are_never_recorded()
    {
        const string secret = "password=never-log-this;access_token=also-secret";
        var events = new List<SsoDiagnosticEvent>();
        using (SsoDiagnostics.BeginRequest(events.Add, "request-1", Guid.NewGuid().ToString()))
        {
            SsoDiagnostics.Error("SSO_CALLBACK", new InvalidOperationException(secret, new Exception(secret)));
            SsoDiagnostics.Step("SSO_STATE", reference: SsoDiagnostics.Reference(secret));
        }
        Assert.DoesNotContain(secret, JsonSerializer.Serialize(events));
        Assert.Equal(2, events[0].Errors!.Count);
        Assert.Equal("unexpected_error", events[0].Code);
        Assert.Equal(64, events[1].Reference!.Length);
        Assert.Equal(SsoDiagnostics.Reference(secret), events[1].Reference);
    }

    [Theory]
    [InlineData("Jwt:SigningKey must be at least 32 characters.", "jwt_signing_key_invalid")]
    [InlineData("The ConnectionString property has not been initialized.", "sql_connection_string_missing")]
    public void Configuration_failures_have_actionable_codes_without_raw_messages(string message, string code)
    {
        var events = new List<SsoDiagnosticEvent>();
        using (SsoDiagnostics.BeginRequest(events.Add, "request-1", null))
            SsoDiagnostics.Error("SSO_START", new InvalidOperationException(message));
        Assert.Equal(code, Assert.Single(events).Code);
        Assert.DoesNotContain(message, JsonSerializer.Serialize(events));
    }

    [Fact]
    public void A_failed_logging_sink_does_not_change_login_execution()
    {
        using var scope = SsoDiagnostics.BeginRequest(_ => throw new IOException("disk unavailable"), "request-1", null);
        SsoDiagnostics.Step("SSO_START");
        SsoDiagnostics.Error("SSO_START", new Exception("private error"));
        SsoDiagnostics.ClientStep("AUTH_SUBMIT", "sso_start", Guid.NewGuid().ToString());
        SsoDiagnostics.SqlTarget("sql-server", "database");
    }

    [Fact]
    public async Task Concurrent_requests_have_separate_contexts_and_dispose_restores_previous_scope()
    {
        var first = new List<SsoDiagnosticEvent>();
        var second = new List<SsoDiagnosticEvent>();
        using (SsoDiagnostics.BeginRequest(first.Add, "outer", null))
        {
            await Task.Run(() =>
            {
                using var scope = SsoDiagnostics.BeginRequest(second.Add, "inner", null);
                SsoDiagnostics.Step("INNER");
            });
            SsoDiagnostics.Step("OUTER");
        }
        SsoDiagnostics.Step("AFTER_SCOPE");
        Assert.Equal("outer", Assert.Single(first).RequestId);
        Assert.Equal("inner", Assert.Single(second).RequestId);
    }

    [Fact]
    public void Browser_trace_uses_only_allowed_fields_and_never_records_arbitrary_codes()
    {
        const string privateText = "token=secret\r\nforged-log-line";
        var events = new List<SsoDiagnosticEvent>();
        var controller = new AuthController(null!, null!, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance);
        using (SsoDiagnostics.BeginRequest(events.Add, "request-1", null))
        {
            var response = controller.TraceSso(new("AUTH_FAILED", privateText, Guid.NewGuid().ToString(), privateText, -1));
            Assert.IsType<NoContentResult>(response);
        }
        var entry = Assert.Single(events);
        Assert.Equal("unclassified", entry.Code);
        Assert.Equal("browser", entry.Source);
        Assert.Null(entry.Operation);
        Assert.Null(entry.DurationMs);
        Assert.DoesNotContain(privateText, JsonSerializer.Serialize(events));
    }

    [Fact]
    public void Invalid_flow_ids_and_unknown_steps_cannot_forge_browser_milestones()
    {
        var events = new List<SsoDiagnosticEvent>();
        var controller = new AuthController(null!, null!, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance);
        using (SsoDiagnostics.BeginRequest(events.Add, "request-1", null))
        {
            Assert.IsType<BadRequestResult>(controller.TraceSso(new("AUTH_SUBMIT", "sso_start", "not-a-guid")));
            Assert.IsType<BadRequestResult>(controller.TraceSso(new("SQL_TARGET", "sso_start", Guid.NewGuid().ToString())));
        }
        Assert.Empty(events);
    }
}
