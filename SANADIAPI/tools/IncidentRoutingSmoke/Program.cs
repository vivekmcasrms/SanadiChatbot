using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

// Synthetic LocalDB only. Never loads deployment settings or production credentials.
var root = Path.GetFullPath(args.Single());
var name = "SanadiIncidentTest_" + Guid.NewGuid().ToString("N");
await using var admin = new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync();
await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory = new SqlConnectionFactory(Options.Create(new SqlOptions
    { ConnectionString = $@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true" }));
    await using var db = factory.Create();
    await db.OpenAsync();
    var schema = File.ReadAllText(Path.Combine(root, "sql/sanadi_schema.sql"));
    foreach (var table in new[] { "conversations", "messages", "agent_runs", "user_roles", "agent_tools", "emergency_contacts", "service_units", "cases", "action_requests", "agent_tool_executions", "action_receipts", "audit_logs" })
    {
        var match = Regex.Match(schema, @"CREATE TABLE \[dbo\]\.\[" + table + @"\][\s\S]*?^GO\s*$", RegexOptions.Multiline);
        Check(match.Success, $"Missing fixture table {table}");
        await db.ExecuteAsync(Regex.Replace(match.Value, @"^GO\s*$", "", RegexOptions.Multiline));
    }
    var procs = File.ReadAllText(Path.Combine(root, "sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach (Match m in Regex.Matches(procs, @"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_\w+[\s\S]*?^GO\s*$", RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(m.Value, @"^GO\s*$", "", RegexOptions.Multiline));
    foreach (var batch in Regex.Split(File.ReadAllText(Path.Combine(root, "sql/VS_2026-09-29-chat-incident-routing.sql")), @"^GO\s*$", RegexOptions.Multiline))
        if (!string.IsNullOrWhiteSpace(batch)) await db.ExecuteAsync(batch);
    var student = Guid.NewGuid(); var unit = Guid.NewGuid(); var owner = Guid.NewGuid(); var contact = Guid.NewGuid();
    await db.ExecuteAsync("""
        INSERT dbo.service_units(id,code,name_en,name_ar,primary_service_owner_id)
        VALUES(@unit,N'HOUSING',N'Student Housing Services',N'خدمات السكن الطلابي',@owner);
        INSERT dbo.emergency_contacts(id,code,label_en,label_ar,responsible_unit_en,responsible_unit_ar,
          category_en,category_ar,emergency_type_en,emergency_number,email,keywords,priority)
        VALUES(@contact,N'campus_maintenance',N'Khadamat',N'خدمات',N'Khadamat',N'خدمات',
          N'Maintenance',N'صيانة',N'Electricity / Water / Air Conditioning / Faults',N'test-extension',
          N'maintenance@example.test',N'["ac","not working","مكيف","لا يعمل"]',20);
        """, new { unit, owner, contact });
    var context = new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = student, IsAuthenticated = true, Roles = ["student"] };
    context.Response.Body = new MemoryStream();
    var assistant = new AssistantController(factory, new NoAiCalls(), new ConfigurationBuilder().Build(), null!,
        new Sanadi.Infrastructure.Appointments.AppointmentChatService(), NullLogger<AssistantController>.Instance)
    { ControllerContext = new ControllerContext { HttpContext = context } };
    const string report = "My room is very hot seems like AC is not working";
    await assistant.Stream(new(report, null, "en", null), default);
    context.Response.Body.Position = 0;
    var events = (await new StreamReader(context.Response.Body, leaveOpen: true).ReadToEndAsync())
        .Split('\n').Where(l => l.StartsWith("data:")).Select(l => JsonNode.Parse(l[5..])!).ToList();
    Check(!events.Any(e => (string?)e["type"] == "error"), "Chat stream must not emit an error");
    var final = events.Single(e => (string?)e["type"] == "final")["response"]!;
    Check((string?)final["agent"] == "alert", "Responsible incident agent selected");
    Check((string?)final["classification"]?["category"] == "campus_maintenance", "Maintenance category selected");
    Check(final["answer"]!.GetValue<string>().Contains("test-extension"), "Configured contact channel displayed");
    Check(events.Any(e => (string?)e["type"] == "stage" && (string?)e["stage"] == "emergency"), "Responsible agent stage emitted");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases") == 0, "No case before student confirmation");
    var action = final["proposedActions"]![0]!;
    Check((string?)action["labelEn"] == "Notify Khadamat now", "Confirmation button names responsible contact");
    Check((string?)action["risk"] == "level_2", "Original student-confirmation policy restored");
    var conversation = Guid.Parse((string)final["conversationId"]!);
    var message = Guid.Parse((string)final["messageId"]!);
    // A browser-supplied unit must not override the registered contact's route.
    action["args"]!["unitCode"] = "REG";
    var request = new AssistantController.ActionRequest("report_alert", action["args"]!.AsObject(), conversation, "en", message, "report_alert");
    context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = Guid.NewGuid(), IsAuthenticated = true, Roles = ["student"] };
    try
    {
        await assistant.Execute(request, default);
        throw new Exception("Action endpoint must reject another student's conversation");
    }
    catch (ForbiddenException) { }
    finally
    {
        context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = student, IsAuthenticated = true, Roles = ["student"] };
    }
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.action_requests") == 0,
        "Ownership rejection happens before recording or executing any action");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases") == 0,
        "Ownership rejection creates no case");
    Console.WriteLine("PASS action endpoint rejects an unowned conversation before any writes");
    var executed = (JsonResult)await assistant.Execute(request, default);
    var receipt = JsonSerializer.SerializeToNode(executed.Value)!;
    Check(receipt["receipt"] is not null, "Confirmation returns a receipt");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases WHERE student_id=@student AND service_unit_id=@unit AND assigned_to=@owner AND related_conversation_id=@conversation AND status=N'assigned' AND routing_service_code=N'housing'", new { student, unit, owner, conversation }) == 1,
        "Approved case assigned to configured Student Housing owner and linked to chat");
    await assistant.Execute(request, default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases") == 1, "Repeated confirmation is idempotent");
    var meta = await db.ExecuteScalarAsync<string>("SELECT metadata FROM dbo.messages WHERE id=@message", new { message });
    Check(JsonNode.Parse(meta!)!["proposedActions"]!.AsArray().Count == 1, "Proposal survives reloading chat history");
    Console.WriteLine("PASS exact AC report: SSE answer, agent/category, contact, confirmation, routed case, receipt, history, duplicate prevention");

    // Disabling a contact stops matching it. A disabled tool still allows contact information, but no write proposal.
    await db.ExecuteAsync("""
        INSERT dbo.agent_tools(tool_name,agent_type,description,risk_level,confirmation_required,human_approval_required,allowed_roles,enabled)
        VALUES(N'report_alert',N'alert',N'Test',N'level_2',1,0,N'["student"]',0);
        """);
    var disabled = (JsonResult)await assistant.Ask(new(report, conversation, "en", null), default);
    Check(((JsonObject)disabled.Value!)["proposedActions"]!.AsArray().Count == 0, "Disabled tool not proposed");
    await db.ExecuteAsync("UPDATE dbo.agent_tools SET enabled=1,human_approval_required=1 WHERE tool_name=N'report_alert'");
    var approval = (JsonObject)((JsonResult)await assistant.Ask(new(report, conversation, "en", null), default)).Value!;
    var gated = approval["proposedActions"]![0]!;
    Check((bool)gated["humanApprovalRequired"]!, "Configured staff approval preserved");
    await assistant.Execute(new("report_alert", gated["args"]!.AsObject(), conversation, "en", Guid.Parse((string)approval["messageId"]!), "report_alert"), default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases") == 1, "Staff approval requirement prevents immediate case execution");
    Console.WriteLine("PASS configured disabled-tool and staff-approval policies preserved");
    try
    {
        await db.ExecuteAsync(DbProc.Call("usp_Assistant_InsertIncidentCase", new
        {
            id = Guid.NewGuid(), reference = "TEST-UNOWNED", userId = Guid.NewGuid(), title = report,
            description = report, lang = "en", contactId = contact, conversationId = conversation
        }));
        throw new Exception("Unowned conversation must be rejected");
    }
    catch (SqlException ex) when (ex.Number == 50001) { }
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases") == 1, "Rejected route leaves no partial case");
    await db.ExecuteAsync("UPDATE dbo.emergency_contacts SET is_active=0 WHERE id=@contact", new { contact });
    Check(!(await db.QueryAsync(DbProc.Call("usp_Assistant_GetIncidentContacts", null))).Any(), "Inactive contacts are excluded");
    Console.WriteLine("PASS ownership rejection, rollback and inactive-contact filtering");
}
finally
{
    SqlConnection.ClearAllPools();
    await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");
}
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
sealed class NoAiCalls : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => throw new Exception("Verified contact routing must not depend on model inference");
}
