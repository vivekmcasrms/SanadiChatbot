using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using QRCoder;
using Sanadi.Application.Documents;
using SkiaSharp;
using Topten.RichTextKit;

namespace Sanadi.Infrastructure.Documents;

/// <summary>
/// The existing institutional letter layout, rendered as vector PDF with embedded
/// fonts. SkiaSharp and RichTextKit require no commercial PDF subscription.
/// </summary>
public sealed class SkiaLetterPdfRenderer(IOptions<DocumentOptions> options) : ILetterPdfRenderer
{
    private const float PageWidth = 595, PageHeight = 842, Margin = 50, Bottom = 16;
    private const float Width = PageWidth - 2 * Margin;
    private static readonly SKColor Ink = SKColor.Parse("#212124"), Muted = SKColor.Parse("#6B6B75"),
        Rule = SKColor.Parse("#D1C7BC"), Hairline = SKColor.Parse("#DED9D4"),
        Panel = SKColor.Parse("#F8F6F4"), Link = SKColor.Parse("#3D296F");
    private static readonly Lazy<LetterFonts> Fonts = new(() => new LetterFonts());

    public byte[] Render(IReadOnlyList<LetterSection> sections)
    {
        if (sections.Count == 0) throw new ArgumentException("At least one letter section is required.", nameof(sections));
        var brand = SKColor.TryParse(options.Value.BrandColor, out var configured) ? configured : SKColor.Parse("#D3202E");
        using var output = new MemoryStream();
        // The previous renderer used quarter-point page dimensions (288 DPI).
        var metadata = SKDocumentPdfMetadata.Default;
        metadata.RasterDpi = 288;
        using var document = SKDocument.CreatePdf(output, metadata);
        using var logo = SKImage.FromEncodedData(Asset("uaeu-logo.jpg"));
        foreach (var section in sections)
        {
            using var generator = new QRCodeGenerator();
            using var code = generator.CreateQrCode(section.VerifyUrl, QRCodeGenerator.ECCLevel.M);
            using var qr = SKImage.FromEncodedData(new PngByteQRCode(code).GetGraphic(5));
            var blocks = Layout(section, brand, logo, qr);
            var page = new List<Block>();
            float height = 0;
            foreach (var block in blocks)
            {
                if (block.Height > PageHeight - Bottom)
                    throw new InvalidOperationException("A letter element is too tall to fit on an A4 page.");
                if (height + block.Height > PageHeight - Bottom && page.Count > 0)
                {
                    DrawPage(document, page, height);
                    page.Clear();
                    height = block.ContinuationTop;
                    if (height > 0) page.Add(new(height, (_, _) => { }));
                }
                page.Add(block);
                height += block.Height;
            }
            if (page.Count > 0) DrawPage(document, page, height);
        }
        document.Close();
        return output.ToArray();
    }

    private static void DrawPage(SKDocument document, List<Block> blocks, float height)
    {
        var canvas = document.BeginPage(PageWidth, Math.Max(1, height) + Bottom);
        float y = 0;
        foreach (var block in blocks)
        {
            block.Draw(canvas, y);
            y += block.Height;
        }
        document.EndPage();
    }

    private static List<Block> Layout(LetterSection section, SKColor brand, SKImage logo, SKImage qr)
    {
        var ar = section.Language.Equals("ar", StringComparison.OrdinalIgnoreCase);
        var direction = ar ? TextDirection.RTL : TextDirection.LTR;
        var align = ar ? TextAlignment.Right : TextAlignment.Left;
        var blocks = new List<Block>();
        void Gap(float height) => blocks.Add(new(height, (_, _) => { }));
        void Line(float thickness, SKColor color, float width = Width) => blocks.Add(new(thickness,
            (canvas, y) => Fill(canvas, new SKRect(Margin + (Width - width) / 2, y, Margin + (Width + width) / 2, y + thickness), color)));
        TextLayout Text(string value, float size, bool bold = false, SKColor? color = null,
            float width = Width, TextAlignment? alignment = null, float? leading = null)
            => CreateText(value, size, ar, bold, color ?? Ink, width, alignment ?? align, direction, leading);
        void AddText(TextLayout text, float x = Margin) => blocks.Add(new(text.Height, (canvas, y) => text.Paint(canvas, x, y)));

        Line(5, brand);
        Gap(12);
        blocks.Add(new(46, (canvas, y) => Image(canvas, logo, new SKRect(Margin, y, Margin + Width, y + 46))));
        Gap(5);
        AddText(Text(section.SubHeader, 8, color: Muted, alignment: TextAlignment.Center));
        Gap(5);
        Line(.9f, brand);

        if (section.MetaFacts.Count > 0)
        {
            Gap(10);
            TextLayout Meta(LetterFact fact, TextAlignment alignment)
            {
                var block = NewText(section.MetaFacts.Count > 1 ? Width / 2 : Width, alignment, direction);
                block.AddText(fact.Label + ": ", Style(7.5f, ar, false, Muted));
                block.AddText(fact.Value, Style(8.2f, ar, true, Ink));
                return new(block);
            }
            var first = Meta(section.MetaFacts[0], align);
            var second = section.MetaFacts.Count > 1 ? Meta(section.MetaFacts[1], TextAlignment.Right) : null;
            blocks.Add(new(Math.Max(first.Height, second?.Height ?? 0), (canvas, y) =>
            {
                first.Paint(canvas, Margin + (ar && second is not null ? Width / 2 : 0), y);
                second?.Paint(canvas, Margin + (ar ? 0 : Width / 2), y);
            }));
        }

        Gap(12);
        AddText(Text(section.Title, 13.5f, true, brand, alignment: TextAlignment.Center));
        Gap(2);
        Line(.75f, brand, Math.Clamp(section.Title.Length * 6.2f, 70, 300));

        if (section.StudentFacts.Count > 0)
        {
            Gap(10);
            const float padding = 12, labelWidth = 118;
            var innerWidth = Width - padding * 2;
            var heading = Text(section.PanelTitle, 8.5f, true, brand, innerWidth);
            var rows = section.StudentFacts.Select(fact => (
                Label: Text(fact.Label, 8, color: Muted, width: labelWidth),
                Value: Text(fact.Value, 8.6f, true, width: innerWidth - labelWidth))).ToArray();
            var height = 14 + heading.Height + 5 + rows.Sum(row => Math.Max(row.Label.Height, row.Value.Height) + 2.5f);
            blocks.Add(new(height, (canvas, y) =>
            {
                var box = new SKRect(Margin, y, Margin + Width, y + height);
                Fill(canvas, box, Panel);
                Border(canvas, box, .6f, Hairline);
                heading.Paint(canvas, Margin + padding, y + 7);
                var rowY = y + 7 + heading.Height + 5;
                foreach (var row in rows)
                {
                    row.Label.Paint(canvas, Margin + padding + (ar ? innerWidth - labelWidth : 0), rowY);
                    row.Value.Paint(canvas, Margin + padding + (ar ? 0 : labelWidth), rowY);
                    rowY += Math.Max(row.Label.Height, row.Value.Height) + 2.5f;
                }
                var accent = ar ? Margin + Width - 2.5f : Margin;
                Fill(canvas, new SKRect(accent, y, accent + 2.5f, y + height), brand);
            }));
        }

        var bodySize = ar ? 10f : 9.5f;
        var bodyLead = ar ? 1.28f : 1.2f;
        Gap(18);
        var bodyStart = blocks.Count;
        var paragraphs = Regex.Split(section.Body ?? "", @"\n{2,}")
            .Select(p => string.Join("\n", p.Split('\n').Select(l => l.Trim())).Trim())
            .Where(p => p.Length > 0).ToArray();
        for (var i = 0; i < paragraphs.Length; i++)
        {
            foreach (var value in paragraphs[i].Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var bold = section.StudentFacts.Any(f => string.Equals(value, f.Value.Trim(), StringComparison.OrdinalIgnoreCase));
                var text = Text(value, bodySize, bold, leading: bodyLead);
                if (text.Block.LineCount <= 1) AddText(text);
                else
                {
                    // Keep wrapped body lines independently pageable, without rasterizing text.
                    var runes = value.EnumerateRunes().Select(r => r.ToString()).ToArray();
                    foreach (var line in text.Block.Lines)
                        AddText(Text(string.Concat(runes.Skip(line.Start).Take(line.Length)).TrimEnd(), bodySize, bold, leading: bodyLead));
                }
            }
            if (i < paragraphs.Length - 1) Gap(3.5f);
        }
        // The existing body container repeats its top padding when it flows to
        // another page. Preserve that spacing and the resulting page breaks.
        for (var i = bodyStart; i < blocks.Count; i++)
            blocks[i] = blocks[i] with { ContinuationTop = 18 };

        var fourLineGap = bodySize * bodyLead * 4;
        if (!string.IsNullOrWhiteSpace(section.Signatory))
        {
            Gap(fourLineGap);
            foreach (var line in section.Signatory.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                AddText(Text(line, 9, color: Muted));
        }
        Gap(fourLineGap);
        Line(.65f, Rule);
        Gap(7);
        var verifyWidth = Width - 58 - 11;
        var label = Text(section.VerifyLabel, 8.8f, true, brand, verifyWidth);
        var hint = Text(section.VerifyHint, 7.2f, color: Muted, width: verifyWidth, leading: 1.18f);
        var url = Text(section.VerifyUrl, 7.2f, color: Link, width: verifyWidth);
        var verifyTextHeight = label.Height + 2 + hint.Height + 3 + url.Height;
        var verifyHeight = Math.Max(58, verifyTextHeight);
        blocks.Add(new(verifyHeight, (canvas, y) =>
        {
            var qrX = Margin + (ar ? Width - 58 : 0);
            Border(canvas, new SKRect(qrX, y, qrX + 58, y + 58), .55f, Hairline);
            Image(canvas, qr, new SKRect(qrX + 2, y + 2, qrX + 56, y + 56));
            var textX = Margin + (ar ? 0 : 69);
            var textY = y + (verifyHeight - verifyTextHeight) / 2;
            label.Paint(canvas, textX, textY);
            textY += label.Height + 2;
            hint.Paint(canvas, textX, textY);
            textY += hint.Height + 3;
            url.Paint(canvas, textX, textY);
            foreach (var line in url.Block.Lines)
            {
                var left = textX + (ar ? verifyWidth - line.Width : 0);
                var run = line.Runs.First();
                using var font = new SKFont(run.Typeface, run.Style.FontSize);
                var underline = font.Metrics.UnderlinePosition ?? 1;
                var thickness = font.Metrics.UnderlineThickness ?? .3f;
                var baseline = textY + line.YCoord + line.BaseLine;
                Fill(canvas, new SKRect(left, baseline + underline - thickness / 2, left + line.Width, baseline + underline + thickness / 2), Link);
            }
            canvas.DrawUrlAnnotation(new SKRect(textX, textY, textX + verifyWidth, textY + url.Height), section.VerifyUrl);
        }));
        Gap(7);
        Line(.65f, Rule);
        Gap(4);
        AddText(Text(section.Header, 7.8f, true, brand, alignment: TextAlignment.Center));
        if (!string.IsNullOrWhiteSpace(section.Footer))
            AddText(Text(section.Footer, 6.8f, color: Muted, alignment: TextAlignment.Center));
        AddText(Text(section.PageLabel, 6.4f, color: Muted, alignment: TextAlignment.Center));
        return blocks;
    }

    private static TextBlock NewText(float width, TextAlignment alignment, TextDirection direction) => new()
    {
        MaxWidth = width, Alignment = alignment, BaseDirection = direction, FontMapper = Fonts.Value
    };

    private static Style Style(float size, bool ar, bool bold, SKColor color, float? leading = null)
    {
        var style = new Style { FontFamily = ar ? "Amiri" : "Lato", FontSize = size, FontWeight = bold && ar ? 700 : 400, TextColor = color };
        if (leading.HasValue)
        {
            using var font = new SKFont(Fonts.Value.TypefaceFromStyle(style, false), size);
            var metrics = font.Metrics;
            // The approved template defines explicit leading as a multiple of the
            // font size, while RichTextKit expresses it relative to font metrics.
            style.LineHeight = size * leading.Value / (metrics.Descent - metrics.Ascent);
        }
        return style;
    }

    private static TextLayout CreateText(string value, float size, bool ar, bool bold, SKColor color,
        float width, TextAlignment alignment, TextDirection direction, float? leading)
    {
        var block = NewText(width, alignment, direction);
        block.AddText(value, Style(size, ar, bold, color, leading));
        return new(block);
    }

    private sealed class TextLayout(TextBlock block)
    {
        public TextBlock Block { get; } = block;
        public float Height => Block.MeasuredHeight;
        public void Paint(SKCanvas canvas, float x, float y)
        {
            _ = Block.MeasuredHeight; // Complete shaping and line layout before reading runs.
            foreach (var run in Block.FontRuns)
            {
                if (run.Glyphs.Length == 0 || run.RunKind == FontRunKind.TrailingWhitespace) continue;
                // Supply original UTF-8 text and clusters as well as shaped glyphs.
                // Glyph-only painting loses searchable text for Arabic and Latin ligatures.
                var codePoints = run.CodePoints.ToArray();
                var text = new StringBuilder();
                var offsets = new uint[codePoints.Length];
                uint byteOffset = 0;
                for (var i = 0; i < codePoints.Length; i++)
                {
                    offsets[i] = byteOffset;
                    var rune = new Rune(codePoints[i]);
                    text.Append(rune.ToString());
                    byteOffset += (uint)rune.Utf8SequenceLength;
                }
                var utf8 = Encoding.UTF8.GetBytes(text.ToString());
                var clusters = run.Clusters.ToArray().Select(cluster => offsets[cluster - run.Start]).ToArray();
                using var font = new SKFont(run.Typeface, run.Style.FontSize) { Subpixel = true, Hinting = SKFontHinting.None };
                using var builder = new SKTextBlobBuilder();
                var buffer = builder.AllocatePositionedTextRun(font, run.Glyphs.Length, utf8.Length);
                buffer.SetGlyphs(run.Glyphs.AsSpan());
                buffer.SetPositions(run.GlyphPositions.AsSpan());
                buffer.SetClusters(clusters);
                buffer.SetText(utf8);
                using var blob = builder.Build();
                using var paint = new SKPaint { Color = run.Style.TextColor, IsAntialias = true };
                canvas.DrawText(blob, x, y, paint);
            }
        }
    }

    private sealed record Block(float Height, Action<SKCanvas, float> Draw, float ContinuationTop = 0);

    private sealed class LetterFonts : FontMapper
    {
        private readonly SKTypeface _latin = Load("Lato-Regular.ttf");
        private readonly SKTypeface _arabic = Load("amiri-regular.ttf");
        private readonly SKTypeface _arabicBold = Load("amiri-bold.ttf");
        private static SKTypeface Load(string name)
        {
            using var data = SKData.CreateCopy(Asset(name));
            return SKTypeface.FromData(data);
        }
        public override SKTypeface TypefaceFromStyle(IStyle style, bool ignoreFontVariants) =>
            style.FontFamily == "Amiri" ? (style.FontWeight >= 700 ? _arabicBold : _arabic) : _latin;
    }

    private static byte[] Asset(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Sanadi.Letter." + name)
            ?? throw new InvalidOperationException($"Embedded letter asset '{name}' is missing.");
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }

    private static void Fill(SKCanvas canvas, SKRect bounds, SKColor color)
    {
        using var paint = new SKPaint { Color = color, IsAntialias = true };
        canvas.DrawRect(bounds, paint);
    }

    private static void Border(SKCanvas canvas, SKRect bounds, float width, SKColor color)
    {
        using var paint = new SKPaint { Color = color, IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = width };
        canvas.DrawRect(bounds, paint);
    }

    private static void Image(SKCanvas canvas, SKImage image, SKRect bounds)
    {
        var scale = Math.Min(bounds.Width / image.Width, bounds.Height / image.Height);
        var width = image.Width * scale;
        var height = image.Height * scale;
        canvas.DrawImage(image, new SKRect(bounds.MidX - width / 2, bounds.MidY - height / 2, bounds.MidX + width / 2, bounds.MidY + height / 2), SKSamplingOptions.Default);
    }
}
