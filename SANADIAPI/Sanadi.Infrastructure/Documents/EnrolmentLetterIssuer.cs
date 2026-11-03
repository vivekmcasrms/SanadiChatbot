using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Extensions.Options;
using Sanadi.Application.Documents;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Documents;

/// <summary>
/// Shared TWIMC issuance path used by Documents and Assistant controllers.
/// Mirrors <c>letters.server.ts</c>: template fill → branded PDF → hash → store → record.
/// </summary>
public sealed class EnrolmentLetterIssuer(
    ISqlConnectionFactory sql,
    IObjectStorage storage,
    ILetterPdfRenderer pdf,
    IOptions<DocumentOptions> documentOptions) : IEnrolmentLetterIssuer
{
    private const string DocumentCode = "TWIMC";
    private const string Bucket = "student-letters";

    public async Task<IssuedEnrolmentLetter> IssueAsync(
        Guid studentId,
        string language,
        string purpose,
        LetterFieldFlags fields,
        Guid? conversationId,
        string? requestOrigin,
        CancellationToken cancellationToken = default)
    {
        var lang = language is "ar" or "bilingual" ? language : "en";
        purpose = string.IsNullOrWhiteSpace(purpose) ? "general" : purpose;

        await using var db = sql.Create();
        var ctx = await LoadContext(db, studentId);
        if (!ctx.Eligible)
            throw new SanadiException(ctx.BlockingReason ?? "This document cannot be issued.");

        var recent = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetRecentTwimc",
            new { id = studentId, lang, purpose }, cancellationToken));
        // Skip replay of legacy plain-text PDFs (< 5 KB) so students get the branded letter.
        if (recent is not null && (int?)recent.file_size_bytes is int size && size >= 5_000)
            return MapIssued(recent, await RetentionDays(db, cancellationToken), replayed: true);

        var langsJson = JsonSerializer.Serialize(lang == "bilingual" ? new[] { "en", "ar" } : new[] { lang });
        var templates = (await db.QueryAsync(DbProc.Call("usp_Documents_ListApprovedTemplates",
                new { langsJson }, cancellationToken)))
            .GroupBy(x => (string)x.language)
            .Select(x => x.First())
            .ToArray();
        if (templates.Length != (lang == "bilingual" ? 2 : 1))
            throw new SanadiException("No approved template is configured for this document.");

        var reference = await db.ExecuteScalarAsync<string>(DbProc.Call("usp_NextDocumentReference",
            new { code = DocumentCode }, cancellationToken));
        if (string.IsNullOrWhiteSpace(reference))
            throw new SanadiException("A document reference number could not be generated.");

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        var publicOrigin = DocumentPublicUrl.Resolve(documentOptions, requestOrigin);
        var verifyUrl = DocumentPublicUrl.VerificationUrl(publicOrigin, token);
        var issued = DateTimeOffset.UtcNow;
        var validity = (int?)templates[0].validity_days;
        var retention = await RetentionDays(db, cancellationToken);
        var expires = validity is null ? (DateTimeOffset?)null : issued.AddDays(validity.Value);
        var retentionAt = issued.AddDays(retention);

        var sections = new List<LetterSection>();
        for (var i = 0; i < templates.Length; i++)
        {
            var t = templates[i];
            sections.Add(BuildSection(t, ctx, fields, reference, issued, verifyUrl, i, templates.Length));
        }

        var pdfBytes = pdf.Render(sections);
        var hash = Convert.ToHexString(SHA256.HashData(pdfBytes)).ToLowerInvariant();
        var path = $"{studentId:D}/{reference}.pdf";
        await using (var stream = new MemoryStream(pdfBytes))
            await storage.UploadAsync(Bucket, path, stream, "application/pdf", studentId, true, cancellationToken);

        var docId = Guid.NewGuid();
        var versions = string.Join("+", templates.Select(t => $"{t.language}.v{t.version}"));
        var fieldsJson = JsonSerializer.Serialize(new
        {
            IncludeProgramme = fields.IncludeProgramme,
            IncludeCollege = fields.IncludeCollege,
            IncludeTerm = fields.IncludeTerm,
            IncludeExpectedGraduation = fields.IncludeExpectedGraduation
        });
        var snapshot = JsonSerializer.Serialize(new
        {
            studentName = ctx.StudentName,
            studentNumber = ctx.StudentNumber,
            programmeEn = ctx.ProgrammeEn,
            programmeAr = ctx.ProgrammeAr,
            collegeEn = ctx.CollegeEn,
            collegeAr = ctx.CollegeAr,
            termEn = ctx.TermEn,
            termAr = ctx.TermAr,
            enrollmentStatus = ctx.EnrollmentStatus,
            expectedGraduation = fields.IncludeExpectedGraduation ? ctx.ExpectedGraduation : null
        });

        await db.ExecuteAsync(DbProc.Call("usp_Documents_IssueTwimc", new
        {
            docId,
            id = studentId,
            reference,
            lang,
            purpose,
            path,
            size = pdfBytes.Length,
            token,
            hash,
            template = (Guid?)templates[0].id,
            versions,
            fields = fieldsJson,
            snapshot,
            conversation = conversationId,
            issued,
            expires,
            retentionAt,
            details = JsonSerializer.Serialize(new { reference, language = lang, purpose, templateVersion = versions, documentHash = hash }),
            tokenDetails = JsonSerializer.Serialize(new { tokenLength = token.Length })
        }, cancellationToken));

        var row = await db.QuerySingleAsync(DbProc.Call("usp_Documents_GetIssuedById", new { docId }, cancellationToken));
        return MapIssued(row, retention, replayed: false, verifyUrlOverride: verifyUrl);
    }

    private static LetterSection BuildSection(
        dynamic template,
        StudentContext ctx,
        LetterFieldFlags fields,
        string reference,
        DateTimeOffset issued,
        string verifyUrl,
        int index,
        int total)
    {
        var ar = (string)template.language == "ar";
        var programme = ar ? ctx.ProgrammeAr ?? ctx.ProgrammeEn : ctx.ProgrammeEn;
        var college = ar ? ctx.CollegeAr ?? ctx.CollegeEn : ctx.CollegeEn;
        var term = ar ? ctx.TermAr ?? ctx.TermEn : ctx.TermEn;
        var enrollment = ctx.EnrollmentStatus == "active"
            ? (ar ? "مقيد / منتظم" : "Active")
            : ctx.EnrollmentStatus;
        var studentName = ar ? (ctx.StudentNameAr ?? ctx.StudentName) : ctx.StudentName;
        var issuedValue = FormatDate(issued, ar);

        var studentFacts = new List<LetterFact>
        {
            new(ar ? "اسم الطالب" : "Name", studentName),
            new(ar ? "الرقم الجامعي" : "Student number", ctx.StudentNumber ?? "—"),
        };
        if (fields.IncludeCollege && !string.IsNullOrWhiteSpace(college))
            studentFacts.Add(new(ar ? "الكلية" : "College", college!));
        if (fields.IncludeProgramme && !string.IsNullOrWhiteSpace(programme))
            studentFacts.Add(new(ar ? "البرنامج" : "Programme", programme!));
        studentFacts.Add(new(ar ? "حالة القيد" : "Enrollment status", enrollment));
        if (fields.IncludeTerm && !string.IsNullOrWhiteSpace(term))
            studentFacts.Add(new(ar ? "الفصل الدراسي" : "Academic term", term!));

        return new LetterSection
        {
            Language = ar ? "ar" : "en",
            Header = (string?)template.header_text
                ?? (ar ? "جامعة الإمارات العربية المتحدة" : "United Arab Emirates University"),
            SubHeader = ar ? "شؤون الطلبة — خدمة سندي الرقمية" : "Student Affairs — issued through Sanadi",
            Title = (string)template.title,
            Body = FillBody((string)template.body_template, ctx, fields, ar, reference, issued),
            Footer = (string?)template.footer_text ?? "",
            Signatory = (string?)template.signatory_block ?? "",
            Disclaimer = (string?)template.disclaimer,
            IssuedLabel = ar ? "تاريخ الإصدار" : "Issued on",
            IssuedValue = issuedValue,
            ReferenceLabel = ar ? "الرقم المرجعي للوثيقة" : "Document reference",
            ReferenceValue = reference,
            VerifyLabel = ar ? "التحقق من الوثيقة" : "Document verification",
            VerifyHint = ar
                ? "امسح رمز الاستجابة السريعة أو استخدم الرابط أدناه للتحقق من صحة الوثيقة وحالتها الحالية."
                : "Scan the QR code or use the link below to verify the authenticity and current status of this document.",
            VerifyUrl = verifyUrl,
            RetentionNote = null,
            DemoBadge = null,
            PageLabel = ar ? $"صفحة {index + 1} من {total}" : $"Page {index + 1} of {total}",
            MetaFacts =
            [
                new(ar ? "الرقم المرجعي" : "Reference", reference),
                new(ar ? "تاريخ الإصدار" : "Issue date", issuedValue),
            ],
            PanelTitle = ar ? "بيانات الطالب المعتمدة" : "Student information",
            StudentFacts = studentFacts,
            TrustBadge = null,
        };
    }

    private static string FillBody(
        string body,
        StudentContext ctx,
        LetterFieldFlags fields,
        bool ar,
        string reference,
        DateTimeOffset date)
    {
        var programme = fields.IncludeProgramme
            ? (ar ? ctx.ProgrammeAr ?? ctx.ProgrammeEn : ctx.ProgrammeEn)
            : "";
        var college = fields.IncludeCollege
            ? (ar ? ctx.CollegeAr ?? ctx.CollegeEn : ctx.CollegeEn)
            : "";
        var term = fields.IncludeTerm
            ? (ar ? ctx.TermAr ?? ctx.TermEn : ctx.TermEn)
            : (ar ? "الفصل الدراسي الحالي" : "current academic term");

        var values = new Dictionary<string, string?>
        {
            ["student_name"] = ctx.StudentName,
            ["student_id"] = ctx.StudentNumber ?? "—",
            ["programme"] = programme ?? "",
            ["college"] = college ?? "",
            ["academic_term"] = term ?? "",
            ["issue_date"] = FormatDate(date, ar),
            ["reference_number"] = reference,
        };

        var filled = Regex.Replace(body, @"\{\{(\w+)\}\}", m => values.GetValueOrDefault(m.Groups[1].Value) ?? m.Value);
        var lines = filled.Split('\n');
        var cleaned = new List<string>();
        for (var i = 0; i < lines.Length; i++)
        {
            if (lines[i].Trim() == "" && (cleaned.Count == 0 || cleaned[^1].Trim() == ""))
                continue;
            cleaned.Add(lines[i]);
        }
        filled = string.Join("\n", cleaned);

        if (fields.IncludeExpectedGraduation && ctx.ExpectedGraduation is not null)
        {
            var g = FormatDate(ctx.ExpectedGraduation.Value, ar);
            filled += ar
                ? $"\n\nتاريخ التخرج المتوقع: {g} (تقديري وفق الخطة الدراسية الحالية)."
                : $"\n\nExpected graduation date: {g} (estimated on the current study plan).";
        }

        return filled.Trim();
    }

    private static string FormatDate(DateTimeOffset date, bool ar)
    {
        // Month names are embedded tables — never CultureInfo / OS locale.
        string[] monthsEn =
        [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        string[] monthsAr =
        [
            "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
            "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
        ];
        var utc = date.UtcDateTime;
        var month = (ar ? monthsAr : monthsEn)[utc.Month - 1];
        return $"{utc.Day} {month} {utc.Year}";
    }

    private static async Task<int> RetentionDays(System.Data.Common.DbConnection db, CancellationToken ct) =>
        await db.ExecuteScalarAsync<int?>(DbProc.Call("usp_Documents_GetRetentionDays", null, ct)) ?? 30;

    private static async Task<StudentContext> LoadContext(System.Data.Common.DbConnection db, Guid id)
    {
        var r = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetStudentContext", new { id }, CancellationToken.None));
        var exists = r is not null && r.student_number is not null;
        var status = (string?)r?.account_status ?? "unknown";
        string? reason = !exists
            ? "No academic record is linked to this account, so an enrollment letter cannot be issued."
            : status != "active"
                ? $"Your enrollment status is recorded as \"{status}\", so a letter confirming active enrollment cannot be issued."
                : r?.programme_en is null
                    ? "Your academic programme is missing from the student record, so the letter cannot state your programme."
                    : null;

        DateTimeOffset? graduation = null;
        if (r?.expected_graduation_date is DateTime dt) graduation = new DateTimeOffset(dt, TimeSpan.Zero);
        else if (r?.expected_graduation_date is DateTimeOffset dto) graduation = dto;

        return new StudentContext(
            Eligible: reason is null,
            BlockingReason: reason,
            StudentName: (string?)r?.full_name ?? (string?)r?.email ?? "UAEU student",
            StudentNameAr: (string?)r?.full_name,
            StudentNumber: (string?)r?.student_number,
            ProgrammeEn: (string?)r?.programme_en,
            ProgrammeAr: (string?)r?.programme_ar,
            CollegeEn: (string?)r?.college_en,
            CollegeAr: (string?)r?.college_ar,
            TermEn: (string?)r?.term_en,
            TermAr: (string?)r?.term_ar,
            EnrollmentStatus: status,
            ExpectedGraduation: graduation);
    }

    private static IssuedEnrolmentLetter MapIssued(dynamic d, int retention, bool replayed, string? verifyUrlOverride = null)
    {
        var token = (string)d.secure_verification_token;
        return new IssuedEnrolmentLetter(
            Id: (Guid)d.id,
            ReferenceNumber: (string)d.reference_number,
            Language: (string)d.language,
            Purpose: (string)d.purpose,
            Status: (string)d.document_status,
            IssuedAt: (DateTimeOffset)d.issued_at,
            ExpiresAt: d.expires_at as DateTimeOffset?,
            RetentionExpiresAt: (DateTimeOffset)d.retention_expires_at,
            RetentionDays: retention,
            VerifyUrl: verifyUrlOverride ?? $"/verify/{token}",
            VerifyToken: token,
            DocumentHash: (string)d.document_hash,
            TemplateVersion: (string)d.template_version,
            IsDemoDocument: (bool)d.is_demo_document,
            FileName: $"{d.reference_number}.pdf",
            Replayed: replayed);
    }

    private sealed record StudentContext(
        bool Eligible,
        string? BlockingReason,
        string StudentName,
        string? StudentNameAr,
        string? StudentNumber,
        string? ProgrammeEn,
        string? ProgrammeAr,
        string? CollegeEn,
        string? CollegeAr,
        string? TermEn,
        string? TermAr,
        string EnrollmentStatus,
        DateTimeOffset? ExpectedGraduation);
}
