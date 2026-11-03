using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Knowledge;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;
using Sanadi.Infrastructure.Storage;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace Sanadi.Api.Tests;

public sealed class KnowledgeUploadTests
{
    [Fact]
    public async Task Multipart_upload_reads_cached_file_not_consumed_request_body()
    {
        var storage = new CaptureStorage();
        var context = new DefaultHttpContext();
        context.Items[CurrentUserMiddleware.ItemKey] = CurrentUser.ServiceRole();
        context.Request.ContentType = "multipart/form-data; boundary=test";
        context.Request.Body = Stream.Null;
        var bytes = Encoding.UTF8.GetBytes("%PDF-test-file");
        context.Request.Form = new FormCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>(),
            new FormFileCollection { new FormFile(new MemoryStream(bytes), 0, bytes.Length, "", "research.pdf")
            { Headers = new HeaderDictionary(), ContentType = "application/pdf" } });
        var controller = new StorageController(storage) { ControllerContext = new ControllerContext { HttpContext = context } };
        await controller.Upload("knowledge-files", "test.pdf", default);
        Assert.Equal(bytes, storage.Bytes);
        Assert.Equal("application/pdf", storage.Mime);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Empty_or_interrupted_upload_preserves_existing_file(bool interrupted)
    {
        var root = Path.Combine(Path.GetTempPath(), "sanadi-upload-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "knowledge-files"));
        var target = Path.Combine(root, "knowledge-files", "existing.pdf");
        await File.WriteAllTextAsync(target, "previous contents");
        try
        {
            var storage = new LocalObjectStorage(new NoDatabase(), Options.Create(new StorageOptions { RootPath = root }));
            await using Stream input = interrupted ? new InterruptedStream() : new MemoryStream();
            await Assert.ThrowsAnyAsync<Exception>(() => storage.UploadAsync("knowledge-files", "existing.pdf", input,
                "application/pdf", Guid.NewGuid(), true, default));
            Assert.Equal("previous contents", await File.ReadAllTextAsync(target));
            Assert.Single(Directory.GetFiles(Path.Combine(root, "knowledge-files")));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public void Selectable_pdf_extracts_text_and_page_breaks()
    {
        var builder = new PdfDocumentBuilder();
        var font = builder.AddStandard14Font(Standard14Font.Helvetica);
        builder.AddPage(PageSize.A4).AddText("Research objectives", 12, new PdfPoint(20, 700), font);
        builder.AddPage(PageSize.A4).AddText("Research responsibilities", 12, new PdfPoint(20, 700), font);
        var result = KnowledgeExtract.ExtractDocumentText(builder.Build(), "application/octet-stream", "policy.PDF");
        Assert.Null(result.Error);
        Assert.Equal(2, result.Pages);
        Assert.Contains("Research objectives", result.Text);
        Assert.Contains("\f", result.Text);
        Assert.Contains("Research responsibilities", result.Text);
    }

    [Fact]
    public void Image_only_pdf_reports_ocr_requirement()
    {
        var builder = new PdfDocumentBuilder();
        builder.AddPage(PageSize.A4);
        var result = KnowledgeExtract.ExtractDocumentText(builder.Build(), "application/pdf");
        Assert.Contains("OCR", result.Error);
        Assert.True(string.IsNullOrWhiteSpace(result.Text));
    }

    [Theory]
    [InlineData("APPLICATION/PDF; charset=binary", "policy.bin", "application/pdf")]
    [InlineData("application/octet-stream", "POLICY.PDF", "application/pdf")]
    [InlineData("", "policy.md", "text/markdown")]
    [InlineData("application/x-executable", "policy.pdf", "application/x-executable")]
    public void Normalises_mime_and_falls_back_only_for_generic_types(string mime, string file, string expected) =>
        Assert.Equal(expected, KnowledgeProcessing.ResolveMimeType(mime, file));

    [Fact]
    public void Empty_and_corrupt_pdf_do_not_produce_text()
    {
        Assert.NotNull(KnowledgeExtract.ExtractDocumentText([], "application/pdf").Error);
        Assert.NotNull(KnowledgeExtract.ExtractDocumentText("%PDF-broken"u8.ToArray(), "application/pdf").Error);
    }

    [Fact]
    public void Pdf_pages_and_parenthesized_article_headings_keep_correct_locations()
    {
        var chunks = KnowledgeProcessing.ChunkText("TABLE OF CONTENTS\nChapter (1): Research ....... 2\n\f\nChapter (1): Research\nArticle (1): Definitions\nResearch means systematic inquiry.\n\f\nPolicy Statement\nConduct responsible research.\n\f\nPolicy Statement\nFollow the approved procedures.\n\f\nPolicy Statement\nKeep appropriate records.");
        var definition = Assert.Single(chunks.Where(c => c.Content.Contains("systematic inquiry")));
        Assert.Equal(2, definition.PageNumber);
        Assert.Equal("Article (1): Definitions", definition.SectionTitle);
        Assert.Equal(new int?[] { 3, 4, 5 }, chunks.Where(c => c.SectionTitle == "Policy Statement").Select(c => c.PageNumber));
    }

    private sealed class NoDatabase : ISqlConnectionFactory
    {
        public SqlConnection Create() => throw new InvalidOperationException("Invalid uploads must not reach the database.");
    }

    private sealed class InterruptedStream : MemoryStream
    {
        public override async Task CopyToAsync(Stream destination, int bufferSize, CancellationToken cancellationToken)
        {
            await destination.WriteAsync("partial"u8.ToArray(), cancellationToken);
            throw new IOException("Simulated interrupted request");
        }
    }

    private sealed class CaptureStorage : IObjectStorage
    {
        public byte[]? Bytes;
        public string? Mime;
        public async Task UploadAsync(string bucket, string path, Stream content, string contentType, Guid ownerId, bool upsert, CancellationToken ct)
        {
            using var output = new MemoryStream();
            await content.CopyToAsync(output, ct);
            Bytes = output.ToArray(); Mime = contentType;
        }
        public Task<StoredObject?> DownloadAsync(string bucket, string path, ICurrentUser user, CancellationToken ct) => throw new NotImplementedException();
        public Task DeleteAsync(string bucket, IReadOnlyList<string> paths, ICurrentUser user, CancellationToken ct) => throw new NotImplementedException();
        public Task<string> CreateSignedUrlAsync(string bucket, string path, int expiresInSeconds, ICurrentUser user, CancellationToken ct) => throw new NotImplementedException();
        public bool IsValidSignedToken(string bucket, string path, string? token) => false;
    }
}
