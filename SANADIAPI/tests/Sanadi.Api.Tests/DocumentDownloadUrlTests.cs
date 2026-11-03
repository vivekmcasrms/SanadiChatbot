using Microsoft.AspNetCore.Http;
using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class DocumentDownloadUrlTests
{
    [Fact]
    public void Public_https_configuration_wins_over_internal_http_request()
    {
        var request = new DefaultHttpContext().Request;
        request.Scheme = "http";
        request.Host = new HostString("internal-api", 5281);
        request.PathBase = "/internal";
        Assert.Equal("https://api.test", DocumentsController.DownloadBaseUrl(request, " https://api.test/ "));
    }

    [Fact]
    public void Configured_public_path_is_preserved_without_internal_path_duplication()
    {
        var request = new DefaultHttpContext().Request;
        request.PathBase = "/internal";
        Assert.Equal("https://api.test/sanadi", DocumentsController.DownloadBaseUrl(request, "https://api.test/sanadi/"));
    }

    [Fact]
    public void Unconfigured_local_development_keeps_request_origin()
    {
        var request = new DefaultHttpContext().Request;
        request.Scheme = "http";
        request.Host = new HostString("localhost", 5281);
        request.PathBase = "/api-host";
        Assert.Equal("http://localhost:5281/api-host", DocumentsController.DownloadBaseUrl(request, null));
    }

    [Theory]
    [InlineData("not-an-address")]
    [InlineData("https://api.test?wrong=query")]
    [InlineData("javascript:invalid")]
    public void Invalid_public_configuration_is_rejected(string configured)
    {
        Assert.Throws<SanadiException>(() => DocumentsController.DownloadBaseUrl(new DefaultHttpContext().Request, configured));
    }
}
