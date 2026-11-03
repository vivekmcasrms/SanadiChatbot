using System.Text;
using HtmlAgilityPack;
using Sanadi.Application.Knowledge;
using UglyToad.PdfPig;

namespace Sanadi.Infrastructure.Knowledge;

/// <summary>Extracts every page of a PDF (no 50-page cap), or plain text / DOCX-as-text.</summary>
public class PdfTextExtractor : IDocumentTextExtractor
{
    public Task<IReadOnlyList<RawPage>> ExtractAsync(Stream input, string fileName, CancellationToken ct = default)
    {
        var pages = new List<RawPage>();
        if (fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            using var pdf = PdfDocument.Open(input);
            foreach (var page in pdf.GetPages())
                pages.Add(new RawPage(page.Number, page.Text));
        }
        else
        {
            using var reader = new StreamReader(input, Encoding.UTF8);
            pages.Add(new RawPage(1, reader.ReadToEnd()));
        }
        return Task.FromResult<IReadOnlyList<RawPage>>(pages);
    }
}

public class HttpWebFetcher(HttpClient http) : IWebFetcher
{
    public async Task<(string Title, string Text, IReadOnlyList<string> Links)> FetchAsync(string url,
        CancellationToken ct = default)
    {
        var html = await http.GetStringAsync(url, ct);
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        foreach (var node in doc.DocumentNode
                     .SelectNodes("//script|//style|//nav|//footer|//header|//noscript")?.ToList()
                 ?? new List<HtmlNode>())
            node.Remove();

        var title = doc.DocumentNode.SelectSingleNode("//title")?.InnerText.Trim() ?? url;
        var body = new StringBuilder();
        foreach (var node in doc.DocumentNode.SelectNodes("//h1|//h2|//h3|//h4|//p|//li") ?? new HtmlNodeCollection(null))
        {
            var text = HtmlEntity.DeEntitize(node.InnerText)?.Trim();
            if (string.IsNullOrWhiteSpace(text)) continue;
            // Keep headings on their own line so the chunker can bind them to their content.
            body.AppendLine(node.Name.StartsWith('h') ? text.TrimEnd('.') : text);
        }

        var links = (doc.DocumentNode.SelectNodes("//a[@href]") ?? new HtmlNodeCollection(null))
            .Select(a => a.GetAttributeValue("href", ""))
            .Where(h => h.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            .Distinct().Take(50).ToList();

        return (title, body.ToString(), links);
    }
}
