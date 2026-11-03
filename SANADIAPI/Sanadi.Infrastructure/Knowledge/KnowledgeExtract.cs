using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace Sanadi.Infrastructure.Knowledge;

/// <summary>Server-side text extraction; image-only PDFs require OCR or pasted text.</summary>
public static class KnowledgeExtract
{
    public sealed record Extraction(string Text, int? Pages, string? Error);

    public static Extraction ExtractDocumentText(byte[] bytes, string mimeType, string? fileName = null)
    {
        try
        {
            if (bytes.Length == 0) return new Extraction("", null, "The uploaded file is empty; re-upload it.");
            mimeType = KnowledgeProcessing.ResolveMimeType(mimeType, fileName);
            if (bytes.AsSpan().StartsWith("%PDF-"u8)) mimeType = "application/pdf";
            if (mimeType is "text/plain" or "text/markdown" or "text/csv")
                return new Extraction(Encoding.UTF8.GetString(bytes).Replace("\0", "").Trim(), null, null);

            if (mimeType.Contains("wordprocessingml", StringComparison.OrdinalIgnoreCase))
                return ExtractDocx(bytes);
            if (mimeType.Contains("presentationml", StringComparison.OrdinalIgnoreCase))
                return ExtractPptx(bytes);
            if (mimeType.Contains("spreadsheetml", StringComparison.OrdinalIgnoreCase))
                return ExtractXlsx(bytes);
            if (mimeType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase))
            {
                using var pdf = PdfDocument.Open(bytes);
                var text = string.Join("\n\f\n", pdf.GetPages().Select(p => ContentOrderTextExtractor.GetText(p))).Trim();
                return new Extraction(text, pdf.NumberOfPages, string.IsNullOrWhiteSpace(text)
                    ? "No selectable text was found in this PDF. Run OCR or paste the document text instead." : null);
            }

            return new Extraction("", null, $"Unsupported mime type for extraction: {mimeType}");
        }
        catch (Exception ex)
        {
            return new Extraction("", null, ex.Message);
        }
    }

    private static Extraction ExtractDocx(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
        var entry = zip.GetEntry("word/document.xml");
        if (entry is null) return new Extraction("", null, "The Word file does not contain a readable document part.");
        using var stream = entry.Open();
        var xml = XDocument.Load(stream);
        XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        var paras = xml.Descendants(w + "p")
            .Select(p => string.Concat(p.Descendants(w + "t").Select(t => t.Value)))
            .Where(s => !string.IsNullOrWhiteSpace(s));
        return new Extraction(string.Join("\n", paras).Trim(), null, null);
    }

    private static Extraction ExtractPptx(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
        var slides = zip.Entries
            .Where(e => Regex.IsMatch(e.FullName, @"^ppt/slides/slide\d+\.xml$"))
            .OrderBy(e => int.Parse(Regex.Match(e.FullName, @"\d+").Value))
            .ToList();
        XNamespace a = "http://schemas.openxmlformats.org/drawingml/2006/main";
        var parts = new List<string>();
        for (var i = 0; i < slides.Count; i++)
        {
            using var stream = slides[i].Open();
            var xml = XDocument.Load(stream);
            var body = string.Join("\n", xml.Descendants(a + "t").Select(t => t.Value).Where(s => !string.IsNullOrWhiteSpace(s)));
            if (!string.IsNullOrWhiteSpace(body)) parts.Add($"## Slide {i + 1}\n\n{body}");
        }
        return new Extraction(string.Join("\n\n", parts), slides.Count == 0 ? null : slides.Count, null);
    }

    private static Extraction ExtractXlsx(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
        var shared = new List<string>();
        var sharedEntry = zip.GetEntry("xl/sharedStrings.xml");
        if (sharedEntry is not null)
        {
            using var stream = sharedEntry.Open();
            var xml = XDocument.Load(stream);
            XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            foreach (var si in xml.Descendants(main + "si"))
                shared.Add(string.Concat(si.Descendants(main + "t").Select(t => t.Value)));
        }

        var sheets = zip.Entries.Where(e => Regex.IsMatch(e.FullName, @"^xl/worksheets/sheet\d+\.xml$")).OrderBy(e => e.FullName).ToList();
        var lines = new List<string>();
        XNamespace s = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        for (var i = 0; i < sheets.Count; i++)
        {
            lines.Add($"## Sheet {i + 1}");
            using var stream = sheets[i].Open();
            var xml = XDocument.Load(stream);
            foreach (var row in xml.Descendants(s + "row"))
            {
                var cells = new List<string>();
                foreach (var cell in row.Elements(s + "c"))
                {
                    var type = (string?)cell.Attribute("t");
                    var v = cell.Element(s + "v")?.Value ?? "";
                    if (type == "s" && int.TryParse(v, out var idx) && idx >= 0 && idx < shared.Count)
                        cells.Add(shared[idx]);
                    else
                        cells.Add(v);
                }
                if (cells.Any(c => !string.IsNullOrWhiteSpace(c))) lines.Add(string.Join("\t", cells));
            }
        }
        return new Extraction(string.Join("\n", lines).Trim(), null, null);
    }
}
