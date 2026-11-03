using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Sanadi.Api.Notifications;

namespace Sanadi.Api.Tests;

public sealed class EmailApiFileLogTests
{
    [Theory]
    [InlineData(200)]
    [InlineData(400)]
    public async Task Disabled_logging_preserves_email_parameters_status_and_response(int status)
    {
        using var f = new Fixture();
        const string response = "{\"code\":400,\"message\":\"Application is not found\"}";
        var transport = new Transport((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status)
            { Content = new StringContent(response) }));
        using var client = f.Client(transport);
        using var request = Request();
        var original = await request.Content!.ReadAsStringAsync();
        using var received = await client.SendAsync(request);
        Assert.Equal(status, (int)received.StatusCode);
        Assert.Equal(response, await received.Content.ReadAsStringAsync());
        Assert.Equal(original, transport.RequestBody);
        Assert.Equal("Bearer opaque-test-access", transport.Authorization);
        Assert.Equal(1, transport.Calls);
        f.AssertNoLogFiles();
    }

    [Fact]
    public async Task Disabled_logging_never_writes_response_credentials_to_disk()
    {
        using var f = new Fixture();
        const string body = "{\"token\":\"returned-secret\",\"nested\":[{\"clientSecret\":\"client-secret\",\"access_token\":\"access-secret\"}],\"message\":\"Echo opaque-test-access\"}";
        using var client = f.Client(new Transport((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
            { Content = new StringContent(body) })));
        using var request = Request();
        using var response = await client.SendAsync(request);
        Assert.Equal(body, await response.Content.ReadAsStringAsync());
        f.AssertNoLogFiles();
    }

    [Fact]
    public async Task Disabled_logging_preserves_non_JSON_gateway_error_body()
    {
        using var f = new Fixture();
        const string body = "<html>Gateway unavailable</html>";
        using var client = f.Client(new Transport((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway)
            { Content = new StringContent(body) })));
        using var request = Request();
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal(body, await response.Content.ReadAsStringAsync());
        f.AssertNoLogFiles();
    }

    [Fact]
    public async Task Disabled_logging_preserves_the_original_transport_exception()
    {
        using var f = new Fixture();
        var error = new HttpRequestException("Connection failed for opaque-test-access");
        using var client = f.Client(new Transport((_, _) => Task.FromException<HttpResponseMessage>(error)));
        using var request = Request();
        Assert.Same(error, await Assert.ThrowsAsync<HttpRequestException>(() => client.SendAsync(request)));
        f.AssertNoLogFiles();
    }

    [Fact]
    public async Task Unwritable_log_directory_does_not_prevent_or_repeat_the_send()
    {
        using var f = new Fixture();
        var blocker = Path.Combine(f.Directory.FullName, "not-a-directory");
        await File.WriteAllTextAsync(blocker, "test");
        var transport = new Transport((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent("{\"code\":200}") }));
        using var client = new HttpClient(new EmailApiLoggingHandler(new EmailApiFileLog(blocker)) { InnerHandler = transport });
        using var request = Request();
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, transport.Calls);
        Assert.Equal("{\"code\":200}", await response.Content.ReadAsStringAsync());
        Assert.Equal("test", await File.ReadAllTextAsync(blocker));
        Assert.Single(f.Directory.EnumerateFileSystemInfos());
    }

    [Fact]
    public async Task Concurrent_sends_complete_once_each_without_creating_logs()
    {
        using var f = new Fixture();
        var transport = new Transport((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent("{\"code\":200}") }));
        using var client = f.Client(transport);
        await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            using var request = Request();
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("{\"code\":200}", await response.Content.ReadAsStringAsync());
        }));
        Assert.Equal(8, transport.Calls);
        f.AssertNoLogFiles();
    }

    [Fact]
    public async Task Disabled_logging_does_not_read_details_or_create_a_directory()
    {
        using var f = new Fixture();
        var log = new EmailApiFileLog(f.LogDirectory);
        var read = false;
        await log.WriteAsync(Guid.NewGuid(), "request", () =>
        {
            read = true;
            throw new InvalidOperationException("Logging must not consume request or response bodies.");
        }, "synthetic-secret");
        Assert.False(read);
        f.AssertNoLogFiles();
    }

    [Fact]
    public async Task Disabled_logging_leaves_existing_files_unchanged()
    {
        using var f = new Fixture();
        var existing = Path.Combine(f.Directory.FullName, "existing-log.txt");
        await File.WriteAllTextAsync(existing, "existing-content");
        await new EmailApiFileLog(f.Directory.FullName).WriteAsync(Guid.NewGuid(), "response",
            () => Task.FromResult<object>(new { token = "synthetic-secret" }), "synthetic-secret");
        Assert.Equal("existing-content", await File.ReadAllTextAsync(existing));
        Assert.Single(f.Directory.EnumerateFileSystemInfos());
    }

    private static HttpRequestMessage Request()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "https://mail.test/general/common/send-email")
        {
            Content = JsonContent.Create(new TicketEmailDispatcher.EmailRequest("recipient@example.test", "cc@example.test",
                "bcc@example.test", "Test subject", "<p>English body</p>", "<p>اختبار الإشعارات</p>", "configured-template", "configured-app"))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "opaque-test-access");
        return request;
    }

    private sealed class Fixture : IDisposable
    {
        public DirectoryInfo Directory { get; } = System.IO.Directory.CreateTempSubdirectory("SanadiEmailLogTests-");
        public string LogDirectory => Path.Combine(Directory.FullName, "logs");
        public HttpClient Client(HttpMessageHandler transport) => new(new EmailApiLoggingHandler(new EmailApiFileLog(LogDirectory))
            { InnerHandler = transport });
        public void AssertNoLogFiles()
        {
            Assert.False(System.IO.Directory.Exists(LogDirectory));
            Assert.Empty(Directory.EnumerateFileSystemInfos());
        }
        public void Dispose() => Directory.Delete(recursive: true);
    }

    private sealed class Transport(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        public string? RequestBody, Authorization;
        public int Calls;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            RequestBody = await request.Content!.ReadAsStringAsync(ct);
            Authorization = request.Headers.Authorization?.ToString();
            return await send(request, ct);
        }
    }
}
