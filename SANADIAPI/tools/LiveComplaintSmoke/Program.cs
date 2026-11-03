using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

// Synthetic database and model responses only; no production writes or credentials.
var root = Path.GetFullPath(args.Single());
var name = "SanadiLiveRoutingTest_" + Guid.NewGuid().ToString("N");
await using var admin = new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync(); await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory = new SqlConnectionFactory(Options.Create(new SqlOptions { ConnectionString = $@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true" }));
    await using var db = factory.Create(); await db.OpenAsync();
    var schema = File.ReadAllText(Path.Combine(root, "sql/sanadi_schema.sql"));
    foreach (var table in new[] { "service_units", "case_categories", "routing_rules", "cases", "case_status_history", "audit_logs", "notification_events" })
    {
        var match = Regex.Match(schema, @"CREATE TABLE \[dbo\]\.\[" + table + @"\][\s\S]*?^GO\s*$", RegexOptions.Multiline);
        await db.ExecuteAsync(Regex.Replace(match.Value, @"^GO\s*$", "", RegexOptions.Multiline));
    }
    var source = File.ReadAllText(Path.Combine(root, "sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach (var proc in new[] { "usp_Interactions_GetUnitRow", "usp_Interactions_InsertCase", "usp_Notify_MarkAllRead" })
    {
        var match = Regex.Match(source, @"CREATE OR ALTER PROCEDURE dbo\." + proc + @"\b[\s\S]*?^GO\s*$", RegexOptions.Multiline);
        await db.ExecuteAsync(Regex.Replace(match.Value, @"^GO\s*$", "", RegexOptions.Multiline));
    }
    foreach (var batch in Regex.Split(File.ReadAllText(Path.Combine(root, "sql/VS_2026-09-29-live-complaint-routing.sql")), @"^GO\s*$", RegexOptions.Multiline))
        if (!string.IsNullOrWhiteSpace(batch)) await db.ExecuteAsync(batch);
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT CAST(1 AS bit) ai_enabled, N'custom' provider, N'test-model' model_name,
          N'test-key' api_key, N'https://model.example.test' api_url, CAST(0 AS bit) enable_thinking;
        """);
    var student = Guid.NewGuid(); var housing = Guid.NewGuid(); var general = Guid.NewGuid();
    await db.ExecuteAsync("""
        INSERT dbo.service_units(id,code,name_en,name_ar,description_en) VALUES
        (@housing,N'custom-housing',N'Student Housing Services',N'خدمات السكن',N'Room and accommodation maintenance'),
        (@general,N'custom-general',N'Student Services',N'خدمات الطلبة',N'General student enquiries');
        """, new { housing, general });
    var context = new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = student, IsAuthenticated = true, Roles = ["student"] };
    var model = new Model(housing);
    var controller = new InteractionsController(factory, model, NullLogger<InteractionsController>.Instance)
    { ControllerContext = new ControllerContext { HttpContext = context } };
    var vague = new InteractionsController.Input("My problem", "I have a problem", "complaint", "medium", null, null, null, null, null, null, false, null, null, "en");
    var initial = JsonSerializer.SerializeToElement(await controller.Preview(vague, default));
    Check(initial.GetProperty("unitId").ValueKind == JsonValueKind.Null && initial.GetProperty("serviceLabel").GetProperty("en").GetString() == "Student Services", "Vague complaint starts with general Student Services intake");
    var specific = vague with { Description = "I have a problem: my room AC is not working" };
    var updated = JsonSerializer.SerializeToElement(await controller.Preview(specific, default));
    Check(updated.GetProperty("unitId").GetGuid() == housing, "New detail changes AI selection to Housing");
    Check(updated.GetProperty("serviceLabel").GetProperty("en").GetString() == "Student Housing Services", "Preview uses database unit name");
    var result = JsonSerializer.SerializeToElement(await controller.Submit(specific));
    var caseId = result.GetProperty("id").GetGuid();
    Check(await db.ExecuteScalarAsync<Guid>("SELECT service_unit_id FROM dbo.cases WHERE id=@caseId", new { caseId }) == housing, "Submitted case uses preview unit");
    Check(model.Calls == 2, "Preview decision reused on submit for unchanged data");
    var reverted = JsonSerializer.SerializeToElement(await controller.Preview(vague, default));
    Check(reverted.GetProperty("unitId").ValueKind == JsonValueKind.Null, "Removing details restores general route");
    Console.WriteLine("PASS AI-selected unit updates, current database names, preview/submit consistency, unchanged complaint type and cache");
    await db.ExecuteAsync("""
        INSERT dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body)
        SELECT TOP (205) N'case_submitted',N'case',@caseId,@student,N'in_app',N'Test',N'Test' FROM sys.all_objects;
        INSERT dbo.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body)
        VALUES(N'case_submitted',N'case',@caseId,NEWID(),N'in_app',N'Test',N'Test');
        """, new { caseId, student });
    Check(await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Notify_CountUnread", new { userId = student })) == 205, "Count includes all unread rows and excludes another user");
    await db.ExecuteAsync(DbProc.Call("usp_Notify_MarkAllRead", new { userId = student }));
    Check(await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Notify_CountUnread", new { userId = student })) == 0, "Mark read clears badge count");
    Console.WriteLine("PASS full unread count, recipient scoping and mark-read count");
}
finally { SqlConnection.ClearAllPools(); await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]"); }
static void Check(bool value, string reason) { if (!value) throw new Exception(reason); }

sealed class Model(Guid housing) : HttpMessageHandler, IHttpClientFactory
{
    public int Calls;
    public HttpClient CreateClient(string name) => new(this, false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Calls++;
        if (request.Headers.Authorization?.Parameter != "test-key") throw new Exception("Missing provider authentication");
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
        var prompt = body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!;
        var input = prompt.Split("COMPLAINT:\n")[1];
        Guid? id = input.Contains("AC is not working") ? housing : null;
        return new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new
        { choices = new[] { new { message = new { content = JsonSerializer.Serialize(new { unitId = id, confidence = .95 }) } } } }), Encoding.UTF8, "application/json") };
    }
}
