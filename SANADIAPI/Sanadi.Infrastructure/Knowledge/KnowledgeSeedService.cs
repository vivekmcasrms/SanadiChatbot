using System.Data.Common;
using Dapper;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

/// <summary>Seeds demonstration Knowledge & Integrations Center data.</summary>
public sealed class KnowledgeSeedService
{
    private static readonly (string Code, string En, string Ar)[] Categories =
    [
        ("policy","Policy","سياسة"),("regulation","Regulation","لائحة"),("procedure","Procedure","إجراء"),
        ("service_guide","Service Guide","دليل خدمة"),("student_handbook","Student Handbook","دليل الطالب"),
        ("academic_guide","Academic Guide","دليل أكاديمي"),("faq","FAQ","أسئلة شائعة"),("circular","Circular","تعميم"),
        ("form_instructions","Form Instructions","تعليمات النماذج"),("programme_requirement","Programme Requirement","متطلبات البرنامج"),
        ("course_requirement","Course Requirement","متطلبات المقرر"),("internship_guide","Internship Guide","دليل التدريب"),
        ("graduation_guide","Graduation Guide","دليل التخرج"),("housing_guide","Housing Guide","دليل السكن"),
        ("transportation_guide","Transportation Guide","دليل النقل"),("it_guide","IT Guide","دليل تقنية المعلومات"),
        ("library_guide","Library Guide","دليل المكتبة"),("accessibility_guide","Accessibility Guide","دليل الدعم"),
        ("financial_guide","Financial Guide","دليل مالي"),("other","Other","أخرى")
    ];

    private static readonly (string Title, string Type, string Category, string Version, string Lang, string Conf, string Body)[] Docs =
    [
        ("Undergraduate Academic Regulations","regulation","regulation","4.2","en","public","## Article 1 — Academic load\nA full-time undergraduate student registers between 12 and 18 credit hours per semester.\n\n## Article 2 — Academic standing\nA cumulative GPA below 2.0 places the student on academic probation.\n\n## Article 3 — Graduation\nA bachelor degree requires the completion of 120 credit hours with a minimum cumulative GPA of 2.0."),
        ("Internship Placement Policy","policy","internship_guide","3.0","en","public","## Section 1 — Eligibility\nStudents may apply for internship placement after completing 80 credit hours.\n\n## Section 2 — Holds\nA student with an active financial or academic hold may not begin a placement.\n\n## Section 3 — Duration\nThe standard placement is eight continuous weeks."),
        ("Registration Procedure","procedure","procedure","2.5","en","student_authenticated","## Step 1\nClear all active holds before the registration window opens.\n\n## Step 2\nMeet the academic advisor and approve the study plan.\n\n## Step 3\nRegister sections online during the assigned time slot."),
        ("Financial Holds and Payment Plans","policy","financial_guide","1.8","en","student_authenticated","## Section 1\nAn unpaid balance above AED 1,000 creates a financial hold that prevents registration.\n\n## Section 2\nStudents may request an instalment plan from Student Accounts before the deadline."),
        ("Graduation Clearance Guide","service_guide","graduation_guide","2.0","en","public","## Requirements\nGraduation clearance requires 120 credit hours, a cleared library record and no active holds.\n\n## Timeline\nApply for clearance at least six weeks before the end of the final semester."),
        ("Student Housing Handbook","service_guide","housing_guide","5.1","en","student_authenticated","## Allocation\nHousing is allocated by distance from campus and academic year.\n\n## Conduct\nQuiet hours run from 22:00 to 07:00 daily."),
        ("Campus Transportation Guide","service_guide","transportation_guide","1.4","en","public","## Routes\nBuses run between Al Ain City and the campus every 30 minutes.\n\n## Passes\nA valid student card is required to board."),
        ("IT Services Guide","service_guide","it_guide","3.3","en","public","## Accounts\nEach student receives a university email account valid until graduation.\n\n## Wi-Fi\nEduroam credentials are the same as the portal credentials."),
        ("Library Borrowing Rules","regulation","library_guide","2.2","en","public","## Loans\nUndergraduate students may borrow up to eight items for 14 days.\n\n## Fines\nLate returns create a library hold that blocks graduation clearance."),
        ("Accessibility Support Procedure","procedure","accessibility_guide","1.1","en","student_authenticated","## Registration\nStudents register with the Accessibility Office and provide documentation.\n\n## Accommodations\nApproved accommodations include extended examination time and note-taking support."),
        ("لائحة الدراسة الجامعية","regulation","regulation","4.2","ar","public","## المادة الأولى\nيسجل الطالب المنتظم من 12 إلى 18 ساعة معتمدة في الفصل الدراسي.\n\n## المادة الثانية\nيوضع الطالب تحت الإنذار الأكاديمي إذا قل معدله التراكمي عن 2.0."),
        ("سياسة التدريب العملي","policy","internship_guide","3.0","ar","public","## القسم الأول\nيجوز للطالب التقدم للتدريب العملي بعد إتمام 80 ساعة معتمدة.\n\n## القسم الثاني\nلا يجوز بدء التدريب مع وجود إيقاف مالي أو أكاديمي فعّال."),
        ("إجراءات التسجيل","procedure","procedure","2.5","ar","student_authenticated","## الخطوة الأولى\nإزالة جميع أنواع الإيقاف قبل فتح فترة التسجيل.\n\n## الخطوة الثانية\nمقابلة المرشد الأكاديمي واعتماد الخطة الدراسية."),
        ("دليل التخرج","service_guide","graduation_guide","2.0","ar","public","## المتطلبات\nيتطلب إخلاء الطرف للتخرج إتمام 120 ساعة معتمدة وعدم وجود أي إيقاف فعّال."),
        ("Examination Regulations","regulation","regulation","3.1","en","public","## Attendance\nA student absent from more than 20% of classes may be barred from the final examination.\n\n## Deferral\nDeferred examinations require documented medical evidence."),
        ("Student Complaints Procedure","procedure","procedure","2.0","en","public","## Submission\nComplaints are submitted online and acknowledged within one working day.\n\n## Escalation\nUnresolved complaints escalate to the service manager after five working days."),
        ("Scholarship Continuation Policy","policy","financial_guide","1.5","en","student_authenticated","## Continuation\nScholarship continuation requires a cumulative GPA of at least 3.0 and 15 registered credit hours."),
        ("Academic Advising Service Guide","service_guide","academic_guide","1.9","en","public","## Appointments\nAdvising appointments are booked online and last 30 minutes.\n\n## Preparation\nBring the current study plan and the degree audit."),
        ("Internship Placement Policy (superseded 2023 edition)","policy","internship_guide","2.0","en","public","## Section 1 — Eligibility\nStudents may apply for internship placement after completing 75 credit hours."),
        ("Course Withdrawal Circular","circular","circular","1.0","en","public","## Deadline\nWithdrawal without academic penalty closes at the end of week ten.")
    ];

    public async Task<object> SeedAsync(DbConnection db, Guid userId)
    {
        for (var i = 0; i < Categories.Length; i++)
        {
            var c = Categories[i];
            var exists = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Seed_CountCategory", new { c.Code }));
            if (exists == 0)
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_InsertCategory",
                    new { c.Code, c.En, c.Ar, sort = (i + 1) * 10 }));
        }
        var categories = (await db.QueryAsync<(Guid id, string code)>(DbProc.Call("usp_Knowledge_Seed_ListCategories", null))).ToList();
        Guid? CategoryId(string code) => categories.FirstOrDefault(c => c.code == code).id is var id && id != Guid.Empty ? id : null;
        var units = (await db.QueryAsync<(Guid id, string code)>(DbProc.Call("usp_Knowledge_Seed_ListUnits", null))).ToList();
        Guid? UnitId(int i) => units.Count == 0 ? null : units[i % units.Count].id;

        var documents = 0;
        const string supersededTitle = "Internship Placement Policy (superseded 2023 edition)";
        var idByTitle = new Dictionary<string, Guid>(StringComparer.Ordinal);
        for (var i = 0; i < Docs.Length; i++)
        {
            var d = Docs[i];
            var existing = await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Knowledge_Seed_FindDocumentByTitle", new { d.Title }));
            if (existing is Guid eid) { idByTitle[d.Title] = eid; continue; }
            var isSuperseded = d.Title == supersededTitle;
            var sum = KnowledgeProcessing.Checksum(d.Body);
            var id = Guid.NewGuid();
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_InsertDocument", new
            {
                id, d.Title, desc = d.Body[..Math.Min(300, d.Body.Length)], d.Type, cat = CategoryId(d.Category),
                unit = UnitId(i), d.Lang, d.Version, effective = isSuperseded ? "2023-09-01" : "2025-09-01",
                d.Conf, file = $"{d.Title.ToLowerInvariant().Replace(' ', '-')}.md", size = d.Body.Length, sum,
                approval = isSuperseded ? "superseded" : "published", userId, active = !isSuperseded
            }));
            idByTitle[d.Title] = id;
            documents++;
            foreach (var c in KnowledgeProcessing.ChunkText(d.Body))
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_InsertChunk",
                    new { cid = Guid.NewGuid(), id, c.ChunkNumber, c.Content, c.TokenCount, c.SectionTitle, c.SectionPath, c.SourceLocator, active = !isSuperseded }));
            }
        }
        if (idByTitle.TryGetValue("Internship Placement Policy", out var current) && idByTitle.TryGetValue(supersededTitle, out var old))
        {
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_LinkSupersedes", new { current, old }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_LinkSupersededBy", new { current, old }));
        }

        var faqs = 0;
        (string QEn, string QAr, string AEn, string AAr)[] faqRows =
        [
            ("When can I apply for an internship?","متى يمكنني التقدم للتدريب العملي؟","You can apply for internship placement once you have completed 80 credit hours and have no active holds.","يمكنك التقدم للتدريب العملي بعد إتمام 80 ساعة معتمدة وعدم وجود إيقاف فعّال."),
            ("How many credit hours do I need to graduate?","كم ساعة معتمدة أحتاج للتخرج؟","A bachelor degree requires 120 credit hours with a cumulative GPA of at least 2.0.","تتطلب درجة البكالوريوس 120 ساعة معتمدة بمعدل تراكمي لا يقل عن 2.0."),
            ("Why can I not register for courses?","لماذا لا أستطيع التسجيل في المقررات؟","Registration is blocked while a financial, academic or library hold is active on your record.","يتم إيقاف التسجيل عند وجود إيقاف مالي أو أكاديمي أو مكتبي فعّال."),
            ("How do I remove a financial hold?","كيف أزيل الإيقاف المالي؟","Settle the outstanding balance or agree an instalment plan with Student Accounts; the hold is cleared within one working day.","قم بتسديد الرصيد المستحق أو الاتفاق على خطة تقسيط مع قسم حسابات الطلبة، ويُرفع الإيقاف خلال يوم عمل."),
            ("What is the minimum GPA to avoid probation?","ما الحد الأدنى للمعدل لتجنب الإنذار؟","A cumulative GPA of 2.0 or above keeps you in good academic standing.","المعدل التراكمي 2.0 فأعلى يبقيك في وضع أكاديمي جيد.")
        ];
        for (var i = 0; i < faqRows.Length; i++)
        {
            var f = faqRows[i];
            if (await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Seed_CountFaq", new { f.QEn })) > 0) continue;
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_InsertFaq",
                new { f.QEn, f.QAr, f.AEn, f.AAr, unit = UnitId(i), userId, priority = 100 - i }));
            faqs++;
        }

        var webSources = 0;
        var connectors = 0; var tools = 0;
        var connectorIds = new Dictionary<string, Guid>(StringComparer.Ordinal);
        (string Name, string System, string Auth, string En, string Ar)[] connectorDefs =
        [
            ("sis_core","Student Information System","oauth2_client_credentials","Student Information System","نظام معلومات الطالب"),
            ("registration_api","Registration System","api_key","Registration System","نظام التسجيل"),
            ("internship_api","Internship System","api_key","Internship System","نظام التدريب")
        ];
        for (var i = 0; i < connectorDefs.Length; i++)
        {
            var c = connectorDefs[i];
            var existing = await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Knowledge_Seed_FindConnector", new { c.Name }));
            if (existing is Guid eid) { connectorIds[c.Name] = eid; continue; }

        }
        (string Connector, string Name, string En, string Ar)[] toolDefs =
        [
            ("sis_core","get_student_academic_summary","Academic summary","الملخص الأكاديمي"),
            ("sis_core","get_student_holds","Active holds","الإيقافات الفعّالة"),
            ("registration_api","get_course_availability","Course availability","توفر المقررات"),
            ("internship_api","get_internship_status","Internship eligibility","أهلية التدريب")
        ];
        foreach (var t in toolDefs)
        {
            if (!connectorIds.TryGetValue(t.Connector, out var cid)) continue;
            if (await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Seed_CountTool", new { cid, t.Name })) > 0) continue;
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Seed_InsertTool",
                new { cid, t.Name, t.En, t.Ar, desc = t.En, path = $"/{t.Name}" }));
            tools++;
        }

        return new { documents, faqs, webSources, connectors, tools, seeded = true };
    }
}
