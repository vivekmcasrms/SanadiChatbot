using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using QRCoder;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Sanadi.Application;

namespace Sanadi.Infrastructure.Documents;

public class DocumentOptions
{
    /// <summary>Left empty, verification links are rendered relative to the running host.</summary>
    public string PublicAppUrl { get; set; } = string.Empty;
    public string UniversityNameEn { get; set; } = "United Arab Emirates University";
    public string UniversityNameAr { get; set; } = "جامعة الإمارات العربية المتحدة";
}

public class QuestPdfLetterService(IOptions<DocumentOptions> options) : IPdfLetterService
{
    private readonly DocumentOptions _o = options.Value;

    static QuestPdfLetterService() => QuestPDF.Settings.License = LicenseType.Community;

    public Task<(byte[] Pdf, string VerificationToken)> BuildEnrolmentLetterAsync(StudentSnapshot s, Lang lang,
        string purpose, bool includeGraduationDate, CancellationToken ct = default)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var verifyPath = $"/verify/{token}";
        var verifyUrl = string.IsNullOrWhiteSpace(_o.PublicAppUrl)
            ? verifyPath
            : _o.PublicAppUrl.TrimEnd('/') + verifyPath;

        using var qrGenerator = new QRCodeGenerator();
        using var qrData = qrGenerator.CreateQrCode(verifyUrl, QRCodeGenerator.ECCLevel.Q);
        var qrPng = new PngByteQRCode(qrData).GetGraphic(10);

        var arabic = lang == Lang.Ar;
        var issued = DateTime.UtcNow.ToString("dd MMMM yyyy");

        var bytes = Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2, Unit.Centimetre);
                page.DefaultTextStyle(t => t.FontSize(11).FontFamily(arabic ? "Amiri" : "Helvetica"));
                if (arabic) page.ContentFromRightToLeft();

                page.Header().Column(col =>
                {
                    col.Item().Text(arabic ? _o.UniversityNameAr : _o.UniversityNameEn)
                        .FontSize(16).SemiBold();
                    col.Item().Text(arabic ? "خدمات الطلبة الأكاديمية" : "Student Academic Services")
                        .FontSize(11).FontColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(10).LineHorizontal(1);
                });

                page.Content().PaddingVertical(20).Column(col =>
                {
                    col.Spacing(12);
                    col.Item().AlignCenter().Text(arabic ? "إلى من يهمه الأمر" : "TO WHOM IT MAY CONCERN")
                        .FontSize(14).Bold();

                    col.Item().Text(arabic
                        ? $"تشهد جامعة الإمارات العربية المتحدة بأن الطالب/ة {s.FullName} (الرقم الجامعي {s.StudentNumber}) مسجل/ة حالياً في برنامج {s.Programme}."
                        : $"This is to certify that {s.FullName} (Student Number {s.StudentNumber}) is currently enrolled at the {_o.UniversityNameEn} in the {s.Programme} programme.");

                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn(2); });
                        void Row(string label, string? value)
                        {
                            table.Cell().PaddingVertical(3).Text(label).SemiBold();
                            table.Cell().PaddingVertical(3).Text(value ?? "-");
                        }
                        Row(arabic ? "الكلية" : "College", s.College);
                        Row(arabic ? "المستوى" : "Level", s.Level);
                        Row(arabic ? "الحالة الأكاديمية" : "Academic standing", s.Standing);
                        Row(arabic ? "الساعات المكتملة" : "Completed credit hours", s.CompletedCredits.ToString());
                        if (includeGraduationDate)
                            Row(arabic ? "تاريخ التخرج المتوقع" : "Expected graduation",
                                s.ExpectedGraduation?.ToString("MMMM yyyy"));
                        Row(arabic ? "الغرض" : "Purpose", purpose);
                    });

                    col.Item().Text(arabic
                        ? "صدرت هذه الإفادة بناءً على طلب الطالب/ة دون أدنى مسؤولية على الجامعة."
                        : "This letter is issued upon the student's request and carries no liability for the University.");
                });

                page.Footer().Row(row =>
                {
                    row.RelativeItem().Column(c =>
                    {
                        c.Item().Text($"{(arabic ? "تاريخ الإصدار" : "Issued")}: {issued}").FontSize(9);
                        c.Item().Text($"{(arabic ? "رمز التحقق" : "Verification reference")}: {token}").FontSize(9);
                        c.Item().Text(verifyUrl).FontSize(8).FontColor(Colors.Grey.Darken1);
                    });
                    row.ConstantItem(70).Image(qrPng);
                });
            });
        }).GeneratePdf();

        return Task.FromResult((bytes, token));
    }
}
