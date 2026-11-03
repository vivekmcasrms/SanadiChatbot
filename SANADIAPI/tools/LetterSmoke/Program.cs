using Microsoft.Extensions.Options;
using Sanadi.Application.Documents;
using Sanadi.Infrastructure.Documents;
using UglyToad.PdfPig;

var opts = Options.Create(new DocumentOptions { BrandColor = "#D3202E", PublicAppUrl = "https://sanadit.uaeu.ac.ae" });
var renderer = new SkiaLetterPdfRenderer(opts);

LetterSection En() => new() {
  Language = "en",
  Header = "United Arab Emirates University",
  SubHeader = "Student Affairs — issued through Sanadi",
  Title = "TO WHOM IT MAY CONCERN",
  Body = "This is to certify that:\n\nRashid Al Nuaimi\n\nStudent ID: 202102\n\nis currently enrolled at the United Arab Emirates University in the:\n\nBSc Data Science and Artificial Intelligence\n\nCollege of Information Technology\n\nfor the Summer 2026.\n\nThe student is currently registered as an active student of the University.\n\nThis letter is issued upon the student's request for whatever purpose it may serve.",
  Footer = "United Arab Emirates University · Al Ain, United Arab Emirates",
  Signatory = "Office of the Registrar\nUnited Arab Emirates University",
  IssuedLabel = "Issued on", IssuedValue = "21 September 2026",
  ReferenceLabel = "Document reference", ReferenceValue = "UAEU-TWIMC-2026-000048",
  VerifyLabel = "Document verification",
  VerifyHint = "Scan the QR code or use the link below to verify the authenticity and current status of this document.",
  VerifyUrl = "https://sanadi.online/verify/3cd0fb05f5644a5dfb311c4381205c0beafb6fc0b678f7f3",
  PageLabel = "Page 1 of 1",
  MetaFacts = [ new LetterFact("Reference", "UAEU-TWIMC-2026-000048"), new LetterFact("Issue date", "21 September 2026") ],
  PanelTitle = "Student information",
  StudentFacts = [
    new LetterFact("Name", "Rashid Al Nuaimi"),
    new LetterFact("Student number", "202102"),
    new LetterFact("College", "College of Information Technology"),
    new LetterFact("Programme", "BSc Data Science and Artificial Intelligence"),
    new LetterFact("Enrollment status", "Active"),
    new LetterFact("Academic term", "Summer 2026"),
  ],
};

LetterSection Ar() => new() {
  Language = "ar",
  Header = "جامعة الإمارات العربية المتحدة",
  SubHeader = "شؤون الطلبة — خدمة سندي الرقمية",
  Title = "إلى من يهمه الأمر",
  Body = "تشهد جامعة الإمارات العربية المتحدة بأن:\n\nراشد النعيمي\n\nالرقم الجامعي: 202102\n\nمسجل حالياً في جامعة الإمارات العربية المتحدة في:\n\nبكالوريوس علوم البيانات والذكاء الاصطناعي\n\nكلية تقنية المعلومات\n\nلفصل صيف 2026.\n\nالطالب مسجل حالياً كطالب منتظم في الجامعة.\n\nصدرت هذه الإفادة بناءً على طلب الطالب لأي غرض قد تخدمه.",
  Footer = "جامعة الإمارات العربية المتحدة · العين، الإمارات العربية المتحدة",
  Signatory = "مكتب المسجل\nجامعة الإمارات العربية المتحدة",
  IssuedLabel = "تاريخ الإصدار", IssuedValue = "21 سبتمبر 2026",
  ReferenceLabel = "الرقم المرجعي", ReferenceValue = "UAEU-TWIMC-2026-000048",
  VerifyLabel = "التحقق من الوثيقة",
  VerifyHint = "امسح رمز الاستجابة السريعة أو استخدم الرابط أدناه للتحقق من صحة الوثيقة وحالتها الحالية.",
  VerifyUrl = "https://sanadi.online/verify/3cd0fb05f5644a5dfb311c4381205c0beafb6fc0b678f7f3",
  PageLabel = "صفحة 1 من 1",
  MetaFacts = [ new LetterFact("الرقم المرجعي", "UAEU-TWIMC-2026-000048"), new LetterFact("تاريخ الإصدار", "21 سبتمبر 2026") ],
  PanelTitle = "بيانات الطالب المعتمدة",
  StudentFacts = [
    new LetterFact("اسم الطالب", "راشد النعيمي"),
    new LetterFact("الرقم الجامعي", "202102"),
    new LetterFact("الكلية", "كلية تقنية المعلومات"),
    new LetterFact("البرنامج", "بكالوريوس علوم البيانات والذكاء الاصطناعي"),
    new LetterFact("حالة القيد", "مقيد / منتظم"),
    new LetterFact("الفصل الدراسي", "صيف 2026"),
  ],
};

static int Pages(byte[] pdf)
{
  using var doc = PdfDocument.Open(new MemoryStream(pdf));
  return doc.NumberOfPages;
}

var outDir = @"d:\UAEU Projects\Dr_Nazar\Latest\SANADIAPI\tools\LetterSmoke\out";
Directory.CreateDirectory(outDir);
var en = renderer.Render([En()]);
var ar = renderer.Render([Ar()]);
var bi = renderer.Render([En(), Ar()]);
File.WriteAllBytes(Path.Combine(outDir, "en.pdf"), en);
File.WriteAllBytes(Path.Combine(outDir, "ar.pdf"), ar);
File.WriteAllBytes(Path.Combine(outDir, "bi.pdf"), bi);
Console.WriteLine($"en bytes={en.Length} pages={Pages(en)}");
Console.WriteLine($"ar bytes={ar.Length} pages={Pages(ar)}");
Console.WriteLine($"bi bytes={bi.Length} pages={Pages(bi)}");
