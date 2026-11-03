using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using System.Text.Json.Nodes;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Application.Documents;
using Sanadi.Infrastructure.Documents;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;
using Sanadi.Infrastructure.Storage;

// Isolated synthetic LocalDB fixture. Never reads appsettings or connects to the application database.
var root = Path.GetFullPath(args.Single());
var name = "SanadiDocumentTest_" + Guid.NewGuid().ToString("N");
var storageRoot = Path.Combine(Path.GetTempPath(), name);
await using var admin = new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync();
await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory = new SqlConnectionFactory(Options.Create(new SqlOptions
    {
        ConnectionString = $@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true"
    }));
    await using var db = factory.Create();
    await db.OpenAsync();
    var schema = File.ReadAllText(Path.Combine(root, "sql/sanadi_schema.sql"));
    foreach (var table in new[] { "issued_documents", "document_templates", "document_retention_policies", "document_events", "document_deletion_records", "document_verification_tombstones", "audit_logs", "conversations", "messages", "agent_runs" })
    {
        var match = Regex.Match(schema, @"CREATE TABLE \[dbo\]\.\[" + table + @"\][\s\S]*?^GO\s*$", RegexOptions.Multiline);
        Check(match.Success, $"Missing fixture table {table}");
        await db.ExecuteAsync(Regex.Replace(match.Value, @"^GO\s*$", "", RegexOptions.Multiline));
    }
    await db.ExecuteAsync("""
        ALTER TABLE dbo.issued_documents ADD PRIMARY KEY(id);
        ALTER TABLE dbo.document_verification_tombstones ADD PRIMARY KEY(token_hash);
        ALTER TABLE dbo.document_events ADD FOREIGN KEY(document_id) REFERENCES dbo.issued_documents(id);
        ALTER TABLE dbo.issued_documents ADD FOREIGN KEY(superseded_by) REFERENCES dbo.issued_documents(id);
        CREATE SEQUENCE dbo.issued_document_seq AS bigint START WITH 1 INCREMENT BY 1;
        CREATE SCHEMA storage;
        """.Replace("CREATE SCHEMA storage;", "EXEC('CREATE SCHEMA storage');"));
    await db.ExecuteAsync("""
        CREATE TABLE storage.objects(id uniqueidentifier DEFAULT NEWID(), bucket_id nvarchar(256),
          name nvarchar(1024), owner uniqueidentifier, metadata nvarchar(max), updated_at datetimeoffset);
        INSERT dbo.document_retention_policies(document_type, retention_days) VALUES(N'to_whom_it_may_concern',30);
        INSERT dbo.document_templates(document_type,language,title,body_template,validity_days)
        VALUES(N'to_whom_it_may_concern',N'en',N'To Whom It May Concern',
          N'This certifies that {{student_name}}, {{student_id}}, is enrolled in {{programme}} at {{college}} for {{academic_term}}.',30),
          (N'to_whom_it_may_concern',N'ar',N'إلى من يهمه الأمر',N'تشهد الجامعة بأن {{student_name}} مسجل في {{programme}}.',30);
        """);
    var procs = File.ReadAllText(Path.Combine(root, "sql/2026-09-21-usp-api-direct-queries.sql")) + "\n" +
        File.ReadAllText(Path.Combine(root, "sql/usp_procedures.sql")) + "\n" +
        File.ReadAllText(Path.Combine(root, "sql/usp_rpc.sql"));
    foreach (Match m in Regex.Matches(procs, @"CREATE OR ALTER PROCEDURE dbo\.(usp_Documents_\w+|usp_NextDocumentReference|usp_StorageUpsertObject|usp_Assistant_InsertConversation|usp_Assistant_InsertUserMessage|usp_Assistant_InsertRunAndMessage|usp_Assistant_OwnsConversation|usp_Assistant_GetLastAssistantMetadata)\b[\s\S]*?^GO\s*$", RegexOptions.Multiline))
    {
        if (m.Groups[1].Value == "usp_Documents_GetStudentContext") continue;
        await db.ExecuteAsync(Regex.Replace(m.Value, @"^GO\s*$", "", RegexOptions.Multiline));
    }
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Documents_GetStudentContext @id uniqueidentifier AS
        SELECT N'Test Student' full_name, N'202600001' student_number, N'active' account_status,
          N'Computer Science' programme_en, N'علوم الحاسوب' programme_ar, N'Information Technology' college_en,
          N'تقنية المعلومات' college_ar, N'Fall 2026' term_en, N'خريف 2026' term_ar,
          CAST('2027-06-01' AS date) expected_graduation_date;
        """);
    foreach (var batch in Regex.Split(File.ReadAllText(Path.Combine(root, "sql/VS_2026-09-29-document-delete-fix.sql")), @"^GO\s*$", RegexOptions.Multiline))
        if (!string.IsNullOrWhiteSpace(batch)) await db.ExecuteAsync(batch);

    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT N'openai' provider,N'synthetic' model_name,N'test' api_key,N'https://model.example.test/v1' api_url,
          CAST(1 AS bit) ai_enabled,CAST(0 AS bit) enable_thinking;
        """);
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_AiAdmin_ListTools AS
        SELECT N'issue_enrollment_letter' tool_name,N'document' agent_type,N'Issue a certificate of current enrolment.' description,CAST(1 AS bit) enabled;
        """);
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Assistant_GetToolPolicy @name nvarchar(200) AS
        SELECT CAST(NULL AS uniqueidentifier) Id,CAST(1 AS bit) Enabled,N'level_1' Risk,CAST(0 AS bit) Confirmation,
          CAST(0 AS bit) HumanApproval,N'["student"]' Roles;
        """);
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Assistant_GetUserRoles @userId uniqueidentifier AS SELECT N'student';
        """);

    var student = Guid.NewGuid();
    var context = new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = student, IsAuthenticated = true, Roles = ["student"] };
    context.Request.Scheme = "http";
    context.Request.Host = new HostString("internal-api", 5281);
    var storage = new LocalObjectStorage(factory, Options.Create(new StorageOptions { RootPath = storageRoot }));
    var opts = Options.Create(new DocumentOptions { PublicAppUrl = "https://ui.example.test" });
    var issuer = new EnrolmentLetterIssuer(factory, storage, new SkiaLetterPdfRenderer(opts), opts);
    var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Storage:PublicBaseUrl"] = "https://api.example.test" }).Build();
    var controller = new DocumentsController(factory, storage, issuer, config)
        { ControllerContext = new ControllerContext { HttpContext = context } };

    using var loggers = LoggerFactory.Create(b => b.AddConsole());
    var assistant = new AssistantController(factory, new RoutingModel(), config, issuer,
        new Sanadi.Infrastructure.Appointments.AppointmentChatService(), loggers.CreateLogger<AssistantController>())
        { ControllerContext = new ControllerContext { HttpContext = context } };
    context.Response.Body = new MemoryStream();
    await assistant.Stream(new("I need an enrolment letter", null, "en", null), default);
    context.Response.Body.Position = 0;
    var events = (await new StreamReader(context.Response.Body, leaveOpen: true).ReadToEndAsync())
        .Split('\n').Where(l => l.StartsWith("data:")).Select(l => JsonNode.Parse(l[5..])!).ToList();
    Check(!events.Any(e => (string?)e["type"] == "error"), "Chat letter stream must not emit an error");
    var final = events.Single(e => (string?)e["type"] == "final")["response"]!;
    Check((string?)final["responseType"] == "receipt" && final["issuedDocument"]?["documentId"] is not null,
        "Chat must return the issued letter card and receipt");
    Check(events.Any(e => (string?)e["type"] == "token"), "Chat must stream visible answer text");
    Console.WriteLine("PASS chat: enrolment request streams tokens, final receipt and issued document card");

    // Voice must retain the real text endpoint's answer/card and share its idempotent issuer.
    var parityStudent = Guid.NewGuid();
    context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = parityStudent, IsAuthenticated = true, Roles = ["student"] };
    var voice = new VoiceAssistantController(assistant, loggers.CreateLogger<VoiceAssistantController>())
        { ControllerContext = new ControllerContext { HttpContext = context } };
    foreach (var (question, language) in new[] { ("I need an enrolment letter.", "en"), ("أحتاج إلى إفادة تسجيل.", "ar") })
    {
        var textReply = (JsonObject)((JsonResult)await assistant.Ask(new(question, null, language, null, "mira"), default)).Value!;
        var conversationId = Guid.Parse((string)textReply["conversationId"]!);
        var voiceReply = (VoiceAssistantController.VoiceTurnResult)((JsonResult)await voice.Ask(
            new(question, conversationId, language, "mira"), default)).Value!;
        foreach (var field in new[] { "answer", "agent", "responseType", "verified", "proposedActions", "nextSteps", "citations" })
            Check(JsonNode.DeepEquals(textReply[field], voiceReply.Response[field]), "Text/voice letter parity: " + language + " " + field);
        foreach (var field in new[] { "documentId", "referenceNumber", "language", "status" })
            Check(JsonNode.DeepEquals(textReply["issuedDocument"]![field], voiceReply.Response["issuedDocument"]![field]),
                "Text/voice must keep the same document: " + language + " " + field);
        Check((string?)voiceReply.Response["responseType"] == "receipt" && voiceReply.Response["clarifyingQuestion"] is null,
            "Both languages issue immediately from the same authenticated profile");
        Check(voiceReply.Speech.Length > 0 && voiceReply.Speech.Length < ((string)voiceReply.Response["answer"]!).Length,
            "Speak a brief source-based overview while displaying the complete answer");
    }
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.issued_documents WHERE student_id=@id", new { id = parityStudent }) == 2,
        "Repeated text/voice requests reuse one document per language");
    context.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser { UserId = student, IsAuthenticated = true, Roles = ["student"] };
    Console.WriteLine("PASS EN/AR text/voice letter answer, card and action parity; immediate issuance, short spoken overview and no duplicate document");

    foreach (var language in new[] { "en", "ar", "bilingual" })
    {
        Console.WriteLine($"Issuing {language} letter through DocumentsController...");
        var issued = JsonSerializer.SerializeToElement(await controller.Issue(new(language, "general", new(null, null, null, true), null), default));
        var id = issued.GetProperty("letter").GetProperty("id").GetGuid();
        var replay = await issuer.IssueAsync(student, language, "general", new(), Guid.NewGuid(), null);
        Check(replay.Id == id && replay.Replayed, "Assistant shared issuer reuses the recent letter");
        var signed = JsonSerializer.SerializeToElement(await controller.Download(new(id), default));
        var url = new Uri(signed.GetProperty("url").GetString()!);
        Check(url.Scheme == "https", "Public download must use HTTPS behind HTTP proxy");
        var path = Uri.UnescapeDataString(url.AbsolutePath.Split("/student-letters/")[1]);
        var token = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(url.Query)["token"].ToString();
        var file = (FileStreamResult)await new StorageSignController(storage).DownloadSigned("student-letters", path, token, default);
        await using (file.FileStream)
        {
            var bytes = new byte[5];
            await file.FileStream.ReadExactlyAsync(bytes);
            Check(Encoding.ASCII.GetString(bytes) == "%PDF-", "Downloaded content must be a PDF");
        }
        // Simulate a tombstone left by the previous non-transactional deletion procedure.
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(replay.VerifyToken))).ToLowerInvariant();
        if (language == "en")
        {
            try
            {
                await db.ExecuteAsync(DbProc.Call("usp_Documents_DeleteStudentDocument", new
                    { DocumentId = id, id = Guid.NewGuid(), tokenHash = hash, reference = replay.ReferenceNumber }));
                throw new Exception("Another student must not be allowed to delete this letter");
            }
            catch (SqlException ex) when (ex.Number == 50001) { }
            await db.ExecuteAsync("ALTER TABLE dbo.document_deletion_records ADD CONSTRAINT test_audit_failure CHECK (1=0)");
            try
            {
                await controller.Delete(new(id), default);
                throw new Exception("Expected the simulated audit failure");
            }
            catch (SqlException ex) when (ex.Number == 547) { }
            Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.issued_documents WHERE id=@id", new { id }) == 1, "Failed deletion must retain the document");
            Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.document_verification_tombstones WHERE token_hash=@hash", new { hash }) == 0, "Failed deletion must roll back the tombstone");
            Check(File.Exists(Path.Combine(storageRoot, "student-letters", path)), "Failed deletion must retain the PDF");
            await db.ExecuteAsync("ALTER TABLE dbo.document_deletion_records DROP CONSTRAINT test_audit_failure");
            Console.WriteLine("PASS deletion ownership and rollback after simulated audit failure");
        }
        await db.ExecuteAsync("INSERT dbo.document_verification_tombstones(token_hash) VALUES(@hash)", new { hash });
        await controller.Delete(new(id), default);
        Check(!File.Exists(Path.Combine(storageRoot, "student-letters", path)), "PDF must be deleted");
        Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.issued_documents WHERE id=@id", new { id }) == 0, "Document removed");
        Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.document_deletion_records WHERE document_id=@id AND document_type IS NOT NULL AND created_at IS NOT NULL", new { id }) == 1, "Deletion audited with original details");
        Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.document_events WHERE reference_number=@reference AND document_id IS NULL", new { reference = replay.ReferenceNumber }) == 3, "Issuance and download audit retained");
        Console.WriteLine($"PASS {language}: issue, assistant issuer replay, HTTPS sign, PDF download, deletion, audit retention");
    }
}
finally
{
    SqlConnection.ClearAllPools();
    // Only the uniquely named database and directory created by this check are removed.
    await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");
    var cleanupRoot = Path.GetFullPath(storageRoot);
    Check(cleanupRoot.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase)
        && Path.GetFileName(cleanupRoot) == name, "Cleanup must stay inside the test directory");
    if (Directory.Exists(cleanupRoot)) Directory.Delete(cleanupRoot, recursive: true);
}

static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

sealed class RoutingModel : HttpMessageHandler, IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(this,false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        var prompt=await request.Content!.ReadAsStringAsync(ct);
        var content=prompt.Contains("ROUTE CATALOGUE")||prompt.Contains("Resolve a disagreement")
            ? """{"routingIntents":["document"],"intentConfidence":0.99,"continueWorkflow":false}"""
            : prompt.Contains("Compare the desired outcome") ? """{"authorized":true,"confidence":0.99}"""
            : """{"scope":"signed_in_student","directTool":"issue_enrollment_letter","greetingOnly":false,"intentConfidence":0.99}""";
        return new(System.Net.HttpStatusCode.OK) { Content=new StringContent(JsonSerializer.Serialize(new{choices=new[]{new{message=new{content}}}}),Encoding.UTF8,"application/json") };
    }
}
