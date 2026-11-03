/** Fictional demonstration data for the Knowledge & Integrations Center. */
import type { Db } from "../agent/tools.server";
import { checksum, chunkText } from "./processing.server";

const CATEGORIES: [string, string, string][] = [
  ["policy", "Policy", "سياسة"],
  ["regulation", "Regulation", "لائحة"],
  ["procedure", "Procedure", "إجراء"],
  ["service_guide", "Service Guide", "دليل خدمة"],
  ["student_handbook", "Student Handbook", "دليل الطالب"],
  ["academic_guide", "Academic Guide", "دليل أكاديمي"],
  ["faq", "FAQ", "أسئلة شائعة"],
  ["circular", "Circular", "تعميم"],
  ["form_instructions", "Form Instructions", "تعليمات النماذج"],
  ["programme_requirement", "Programme Requirement", "متطلبات البرنامج"],
  ["course_requirement", "Course Requirement", "متطلبات المقرر"],
  ["internship_guide", "Internship Guide", "دليل التدريب"],
  ["graduation_guide", "Graduation Guide", "دليل التخرج"],
  ["housing_guide", "Housing Guide", "دليل السكن"],
  ["transportation_guide", "Transportation Guide", "دليل النقل"],
  ["it_guide", "IT Guide", "دليل تقنية المعلومات"],
  ["library_guide", "Library Guide", "دليل المكتبة"],
  ["accessibility_guide", "Accessibility Guide", "دليل الدعم"],
  ["financial_guide", "Financial Guide", "دليل مالي"],
  ["other", "Other", "أخرى"],
];

const DOCS: { title: string; type: string; category: string; version: string; lang: "en" | "ar"; body: string; conf: string }[] = [
  { title: "Undergraduate Academic Regulations", type: "regulation", category: "regulation", version: "4.2", lang: "en", conf: "public", body: "## Article 1 — Academic load\nA full-time undergraduate student registers between 12 and 18 credit hours per semester.\n\n## Article 2 — Academic standing\nA cumulative GPA below 2.0 places the student on academic probation.\n\n## Article 3 — Graduation\nA bachelor degree requires the completion of 120 credit hours with a minimum cumulative GPA of 2.0." },
  { title: "Internship Placement Policy", type: "policy", category: "internship_guide", version: "3.0", lang: "en", conf: "public", body: "## Section 1 — Eligibility\nStudents may apply for internship placement after completing 80 credit hours.\n\n## Section 2 — Holds\nA student with an active financial or academic hold may not begin a placement.\n\n## Section 3 — Duration\nThe standard placement is eight continuous weeks." },
  { title: "Registration Procedure", type: "procedure", category: "procedure", version: "2.5", lang: "en", conf: "student_authenticated", body: "## Step 1\nClear all active holds before the registration window opens.\n\n## Step 2\nMeet the academic advisor and approve the study plan.\n\n## Step 3\nRegister sections online during the assigned time slot." },
  { title: "Financial Holds and Payment Plans", type: "policy", category: "financial_guide", version: "1.8", lang: "en", conf: "student_authenticated", body: "## Section 1\nAn unpaid balance above AED 1,000 creates a financial hold that prevents registration.\n\n## Section 2\nStudents may request an instalment plan from Student Accounts before the deadline." },
  { title: "Graduation Clearance Guide", type: "service_guide", category: "graduation_guide", version: "2.0", lang: "en", conf: "public", body: "## Requirements\nGraduation clearance requires 120 credit hours, a cleared library record and no active holds.\n\n## Timeline\nApply for clearance at least six weeks before the end of the final semester." },
  { title: "Student Housing Handbook", type: "service_guide", category: "housing_guide", version: "5.1", lang: "en", conf: "student_authenticated", body: "## Allocation\nHousing is allocated by distance from campus and academic year.\n\n## Conduct\nQuiet hours run from 22:00 to 07:00 daily." },
  { title: "Campus Transportation Guide", type: "service_guide", category: "transportation_guide", version: "1.4", lang: "en", conf: "public", body: "## Routes\nBuses run between Al Ain City and the campus every 30 minutes.\n\n## Passes\nA valid student card is required to board." },
  { title: "IT Services Guide", type: "service_guide", category: "it_guide", version: "3.3", lang: "en", conf: "public", body: "## Accounts\nEach student receives a university email account valid until graduation.\n\n## Wi-Fi\nEduroam credentials are the same as the portal credentials." },
  { title: "Library Borrowing Rules", type: "regulation", category: "library_guide", version: "2.2", lang: "en", conf: "public", body: "## Loans\nUndergraduate students may borrow up to eight items for 14 days.\n\n## Fines\nLate returns create a library hold that blocks graduation clearance." },
  { title: "Accessibility Support Procedure", type: "procedure", category: "accessibility_guide", version: "1.1", lang: "en", conf: "student_authenticated", body: "## Registration\nStudents register with the Accessibility Office and provide documentation.\n\n## Accommodations\nApproved accommodations include extended examination time and note-taking support." },
  { title: "لائحة الدراسة الجامعية", type: "regulation", category: "regulation", version: "4.2", lang: "ar", conf: "public", body: "## المادة الأولى\nيسجل الطالب المنتظم من 12 إلى 18 ساعة معتمدة في الفصل الدراسي.\n\n## المادة الثانية\nيوضع الطالب تحت الإنذار الأكاديمي إذا قل معدله التراكمي عن 2.0." },
  { title: "سياسة التدريب العملي", type: "policy", category: "internship_guide", version: "3.0", lang: "ar", conf: "public", body: "## القسم الأول\nيجوز للطالب التقدم للتدريب العملي بعد إتمام 80 ساعة معتمدة.\n\n## القسم الثاني\nلا يجوز بدء التدريب مع وجود إيقاف مالي أو أكاديمي فعّال." },
  { title: "إجراءات التسجيل", type: "procedure", category: "procedure", version: "2.5", lang: "ar", conf: "student_authenticated", body: "## الخطوة الأولى\nإزالة جميع أنواع الإيقاف قبل فتح فترة التسجيل.\n\n## الخطوة الثانية\nمقابلة المرشد الأكاديمي واعتماد الخطة الدراسية." },
  { title: "دليل التخرج", type: "service_guide", category: "graduation_guide", version: "2.0", lang: "ar", conf: "public", body: "## المتطلبات\nيتطلب إخلاء الطرف للتخرج إتمام 120 ساعة معتمدة وعدم وجود أي إيقاف فعّال." },
  { title: "Examination Regulations", type: "regulation", category: "regulation", version: "3.1", lang: "en", conf: "public", body: "## Attendance\nA student absent from more than 20% of classes may be barred from the final examination.\n\n## Deferral\nDeferred examinations require documented medical evidence." },
  { title: "Student Complaints Procedure", type: "procedure", category: "procedure", version: "2.0", lang: "en", conf: "public", body: "## Submission\nComplaints are submitted online and acknowledged within one working day.\n\n## Escalation\nUnresolved complaints escalate to the service manager after five working days." },
  { title: "Scholarship Continuation Policy", type: "policy", category: "financial_guide", version: "1.5", lang: "en", conf: "student_authenticated", body: "## Continuation\nScholarship continuation requires a cumulative GPA of at least 3.0 and 15 registered credit hours." },
  { title: "Academic Advising Service Guide", type: "service_guide", category: "academic_guide", version: "1.9", lang: "en", conf: "public", body: "## Appointments\nAdvising appointments are booked online and last 30 minutes.\n\n## Preparation\nBring the current study plan and the degree audit." },
  { title: "Internship Placement Policy (superseded 2023 edition)", type: "policy", category: "internship_guide", version: "2.0", lang: "en", conf: "public", body: "## Section 1 — Eligibility\nStudents may apply for internship placement after completing 75 credit hours." },
  { title: "Course Withdrawal Circular", type: "circular", category: "circular", version: "1.0", lang: "en", conf: "public", body: "## Deadline\nWithdrawal without academic penalty closes at the end of week ten." },
];

const FAQS: [string, string, string, string][] = [
  ["When can I apply for an internship?", "متى يمكنني التقدم للتدريب العملي؟", "You can apply for internship placement once you have completed 80 credit hours and have no active holds.", "يمكنك التقدم للتدريب العملي بعد إتمام 80 ساعة معتمدة وعدم وجود إيقاف فعّال."],
  ["How many credit hours do I need to graduate?", "كم ساعة معتمدة أحتاج للتخرج؟", "A bachelor degree requires 120 credit hours with a cumulative GPA of at least 2.0.", "تتطلب درجة البكالوريوس 120 ساعة معتمدة بمعدل تراكمي لا يقل عن 2.0."],
  ["Why can I not register for courses?", "لماذا لا أستطيع التسجيل في المقررات؟", "Registration is blocked while a financial, academic or library hold is active on your record.", "يتم إيقاف التسجيل عند وجود إيقاف مالي أو أكاديمي أو مكتبي فعّال."],
  ["How do I remove a financial hold?", "كيف أزيل الإيقاف المالي؟", "Settle the outstanding balance or agree an instalment plan with Student Accounts; the hold is cleared within one working day.", "قم بتسديد الرصيد المستحق أو الاتفاق على خطة تقسيط مع قسم حسابات الطلبة، ويُرفع الإيقاف خلال يوم عمل."],
  ["What is the minimum GPA to avoid probation?", "ما الحد الأدنى للمعدل لتجنب الإنذار؟", "A cumulative GPA of 2.0 or above keeps you in good academic standing.", "المعدل التراكمي 2.0 فأعلى يبقيك في وضع أكاديمي جيد."],
  ["How long does a complaint take?", "كم يستغرق النظر في الشكوى؟", "Complaints are acknowledged within one working day and normally resolved within five working days.", "يتم الإقرار باستلام الشكوى خلال يوم عمل وتُحل عادة خلال خمسة أيام عمل."],
  ["How do I book an advising appointment?", "كيف أحجز موعد إرشاد أكاديمي؟", "Book online through the Sanadi; appointments last 30 minutes.", "احجز عبر تطبيق سندي، ومدة الموعد 30 دقيقة."],
  ["How many library items can I borrow?", "كم عدد الكتب التي يمكن استعارتها؟", "Undergraduate students may borrow up to eight items for 14 days.", "يمكن لطلبة البكالوريوس استعارة ثمانية عناوين لمدة 14 يوماً."],
  ["What are the bus timings?", "ما مواعيد الحافلات؟", "Buses run between Al Ain City and the campus every 30 minutes from 06:45 to 20:15.", "تعمل الحافلات بين مدينة العين والحرم الجامعي كل 30 دقيقة من 06:45 حتى 20:15."],
  ["How do I reset my portal password?", "كيف أعيد ضبط كلمة مرور البوابة؟", "Use the self-service reset link; contact the IT Service Desk if the account is locked.", "استخدم رابط إعادة الضبط الذاتي، وتواصل مع مكتب خدمة تقنية المعلومات إذا كان الحساب مقفلاً."],
  ["When is the withdrawal deadline?", "ما آخر موعد للانسحاب؟", "Withdrawal without academic penalty closes at the end of week ten.", "ينتهي الانسحاب دون عقوبة أكاديمية بنهاية الأسبوع العاشر."],
  ["Can I defer an examination?", "هل يمكن تأجيل الامتحان؟", "Deferred examinations require documented medical evidence submitted before the examination date.", "يتطلب تأجيل الامتحان تقديم تقرير طبي موثق قبل موعد الامتحان."],
  ["What keeps my scholarship active?", "ما شروط استمرار المنحة؟", "Maintain a cumulative GPA of 3.0 and register at least 15 credit hours each semester.", "الحفاظ على معدل تراكمي 3.0 وتسجيل 15 ساعة معتمدة على الأقل كل فصل."],
  ["How is housing allocated?", "كيف يتم توزيع السكن؟", "Housing is allocated by distance from campus and academic year.", "يتم توزيع السكن حسب بعد مكان الإقامة عن الحرم الجامعي والسنة الدراسية."],
  ["What accommodations are available?", "ما التسهيلات المتاحة؟", "Approved accommodations include extended examination time and note-taking support.", "تشمل التسهيلات المعتمدة وقتاً إضافياً في الامتحانات ودعم تدوين الملاحظات."],
  ["How do I get a graduation clearance?", "كيف أحصل على إخلاء الطرف للتخرج؟", "Apply at least six weeks before the end of your final semester and clear all holds.", "قدّم الطلب قبل ستة أسابيع من نهاية الفصل الأخير وأزل جميع أنواع الإيقاف."],
  ["What is the maximum course load?", "ما الحد الأقصى للعبء الدراسي؟", "A full-time student may register up to 18 credit hours per semester.", "يمكن للطالب المنتظم تسجيل حتى 18 ساعة معتمدة في الفصل."],
  ["Who is my academic advisor?", "من هو مرشدي الأكاديمي؟", "Your advisor is shown in the Sanadi profile and in the degree audit.", "يظهر اسم المرشد في ملفك داخل سندي وفي تدقيق الخطة الدراسية."],
  ["Can I change my major?", "هل يمكن تغيير التخصص؟", "Major changes are reviewed by the college and require a cumulative GPA of 2.5.", "يخضع تغيير التخصص لمراجعة الكلية ويتطلب معدلاً تراكمياً 2.5."],
  ["How do I appeal a grade?", "كيف أتظلم على درجة؟", "Submit a grade appeal within ten working days of the result publication.", "قدّم التظلم خلال عشرة أيام عمل من إعلان النتيجة."],
  ["Is attendance mandatory?", "هل الحضور إلزامي؟", "Absence above 20% of classes may bar you from the final examination.", "الغياب بأكثر من 20% من المحاضرات قد يحرمك من الامتحان النهائي."],
  ["How do I request an official transcript?", "كيف أطلب كشف درجات رسمي؟", "Request it through the Registration service; standard processing is three working days.", "اطلبه عبر خدمة التسجيل، ومدة المعالجة القياسية ثلاثة أيام عمل."],
  ["What is the internship duration?", "ما مدة التدريب العملي؟", "The standard placement is eight continuous weeks.", "المدة القياسية للتدريب ثمانية أسابيع متصلة."],
  ["Where can I see my case status?", "أين أتابع حالة طلبي؟", "Open My requests in the Sanadi to see the status and the next action.", "افتح صفحة طلباتي في سندي لمتابعة الحالة والإجراء التالي."],
  ["Can the assistant submit a complaint for me?", "هل يمكن للمساعد تقديم شكوى نيابة عني؟", "Yes — the assistant prepares the complaint and submits it only after you confirm.", "نعم، يجهز المساعد الشكوى ويقدمها بعد تأكيدك فقط."],
];

const WEB_SOURCES: { title: string; url: string; category: string; lang: "en" | "ar" }[] = [
  { title: "DEMO · Registration service page", url: "https://demo.example.local/registration", category: "service_guide", lang: "en" },
  { title: "DEMO · Internship office page", url: "https://demo.example.local/internship", category: "service_guide", lang: "en" },
  { title: "DEMO · Graduation clearance page", url: "https://demo.example.local/graduation", category: "service_guide", lang: "en" },
  { title: "DEMO · Student accounts page", url: "https://demo.example.local/student-accounts", category: "financial_guide", lang: "en" },
  { title: "DEMO · Academic regulations page", url: "https://demo.example.local/policy/academic-regulations", category: "policy", lang: "en" },
  { title: "DEMO · صفحة التسجيل", url: "https://demo.example.local/ar/registration", category: "service_guide", lang: "ar" },
  { title: "DEMO · Housing page", url: "https://demo.example.local/housing", category: "housing_guide", lang: "en" },
  { title: "DEMO · IT service desk page", url: "https://demo.example.local/it-support", category: "it_guide", lang: "en" },
];

const CONNECTORS: { name: string; system: string; type: string; env: string; auth: string; en: string; ar: string }[] = [
  { name: "sis_core", system: "Student Information System", type: "rest_api", env: "development", auth: "oauth2_client_credentials", en: "Student Information System", ar: "نظام معلومات الطالب" },
  { name: "registration_api", system: "Registration System", type: "rest_api", env: "development", auth: "api_key", en: "Registration System", ar: "نظام التسجيل" },
  { name: "advising_api", system: "Academic Advising", type: "rest_api", env: "development", auth: "bearer_token", en: "Academic Advising", ar: "الإرشاد الأكاديمي" },
  { name: "internship_api", system: "Internship System", type: "rest_api", env: "test", auth: "api_key", en: "Internship System", ar: "نظام التدريب" },
  { name: "graduation_api", system: "Graduation System", type: "rest_api", env: "test", auth: "api_key", en: "Graduation System", ar: "نظام التخرج" },
  { name: "student_accounts_api", system: "Student Accounts", type: "rest_api", env: "uat", auth: "basic_auth", en: "Student Accounts", ar: "حسابات الطلبة" },
  { name: "it_service_desk", system: "IT Service Desk", type: "rest_api", env: "development", auth: "none", en: "IT Service Desk", ar: "مكتب خدمة تقنية المعلومات" },
  { name: "transport_api", system: "Transportation System", type: "rest_api", env: "development", auth: "none", en: "Transportation System", ar: "نظام النقل" },
];

const TOOLS: { connector: string; name: string; en: string; ar: string; risk: string; desc: string }[] = [
  { connector: "sis_core", name: "get_student_academic_summary", en: "Academic summary", ar: "الملخص الأكاديمي", risk: "low", desc: "Returns programme, GPA, credit hours and academic standing for the signed-in student." },
  { connector: "sis_core", name: "get_student_holds", en: "Active holds", ar: "الإيقافات الفعّالة", risk: "low", desc: "Returns the active holds recorded for the signed-in student." },
  { connector: "sis_core", name: "get_student_registration_status", en: "Registration status", ar: "حالة التسجيل", risk: "low", desc: "Returns registered credit hours and whether registration is blocked." },
  { connector: "registration_api", name: "get_course_availability", en: "Course availability", ar: "توفر المقررات", risk: "low", desc: "Returns section capacity and seats available for a course code." },
  { connector: "registration_api", name: "get_student_registration_status", en: "Registration check", ar: "فحص التسجيل", risk: "low", desc: "Duplicate registration read used for source-priority demonstrations." },
  { connector: "advising_api", name: "get_available_appointments", en: "Available appointments", ar: "المواعيد المتاحة", risk: "low", desc: "Returns open advising appointment slots." },
  { connector: "advising_api", name: "get_advising_appointments", en: "My advising appointments", ar: "مواعيدي الإرشادية", risk: "low", desc: "Returns the signed-in student's advising appointments." },
  { connector: "internship_api", name: "get_internship_status", en: "Internship eligibility", ar: "أهلية التدريب", risk: "low", desc: "Returns completed credits against the internship credit requirement." },
  { connector: "graduation_api", name: "get_graduation_status", en: "Graduation progress", ar: "تقدم التخرج", risk: "low", desc: "Returns graduation progress and blocking holds." },
  { connector: "student_accounts_api", name: "get_student_account_balance", en: "Account balance", ar: "الرصيد المالي", risk: "medium", desc: "Returns the outstanding balance for the signed-in student." },
  { connector: "it_service_desk", name: "get_it_service_status", en: "IT service status", ar: "حالة خدمات تقنية المعلومات", risk: "low", desc: "Returns operational status of core IT services." },
  { connector: "transport_api", name: "get_transport_schedule", en: "Bus schedule", ar: "جدول الحافلات", risk: "low", desc: "Returns campus bus routes and timings." },
  { connector: "sis_core", name: "get_case_status", en: "Case status", ar: "حالة الطلب", risk: "low", desc: "Returns the status of the signed-in student's cases." },
];

const GAPS: [string, string, number, string][] = [
  ["postgraduate internship rules", "en", 14, "policy"],
  ["exam deferral for medical reasons", "en", 11, "procedure"],
  ["مواعيد إعادة القيد", "ar", 9, "faq"],
  ["credit transfer from other universities", "en", 8, "policy"],
  ["parking permits for students", "en", 7, "service_guide"],
  ["الرسوم الدراسية للفصل الصيفي", "ar", 7, "financial_guide"],
  ["graduate assistantship applications", "en", 6, "service_guide"],
  ["late registration penalty amount", "en", 6, "regulation"],
  ["مواعيد سكن الطالبات", "ar", 5, "housing_guide"],
  ["internship insurance coverage", "en", 4, "policy"],
];

export async function seedKnowledgeCenter(db: Db, userId: string) {
  // Categories -------------------------------------------------------------
  await db.from("knowledge_document_categories").upsert(
    CATEGORIES.map(([code, en, ar], i) => ({ code, name_en: en, name_ar: ar, sort_order: (i + 1) * 10 })),
    { onConflict: "code" },
  );
  const { data: categories } = await db.from("knowledge_document_categories").select("id, code");
  const categoryId = (code: string) => categories?.find((c) => c.code === code)?.id ?? null;

  const { data: units } = await db.from("service_units").select("id, code").limit(20);
  const unitId = (i: number) => units?.[i % Math.max(units.length, 1)]?.id ?? null;

  // Documents --------------------------------------------------------------
  let documents = 0;
  const supersededTitle = "Internship Placement Policy (superseded 2023 edition)";
  const idByTitle = new Map<string, string>();
  for (const [i, d] of DOCS.entries()) {
    const { data: existing } = await db.from("knowledge_documents").select("id").eq("title", d.title).maybeSingle();
    if (existing) {
      idByTitle.set(d.title, existing.id);
      continue;
    }
    const isSuperseded = d.title === supersededTitle;
    const sum = await checksum(d.body);
    const { data: doc } = await db.from("knowledge_documents").insert({
      title: d.title,
      description: d.body.slice(0, 300),
      document_type: d.type,
      category_id: categoryId(d.category),
      owner_unit_id: unitId(i),
      service_unit_id: unitId(i),
      language: d.lang,
      authoritative_language: d.lang,
      version: d.version,
      effective_date: isSuperseded ? "2023-09-01" : "2025-09-01",
      review_date: "2026-09-01",
      confidentiality_level: d.conf,
      file_name: `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
      mime_type: "text/markdown",
      file_size_bytes: d.body.length,
      checksum: sum,
      detected_language: d.lang,
      extraction_status: "completed",
      chunking_status: "completed",
      embedding_status: "completed",
      indexing_status: "completed",
      quality_status: "passed",
      processing_status: "published",
      approval_status: isSuperseded ? "superseded" : "published",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      is_active: !isSuperseded,
      is_current: !isSuperseded,
      created_by: userId,
    }).select("id").single();
    if (!doc) continue;
    idByTitle.set(d.title, doc.id);
    documents += 1;
    const chunks = chunkText(d.body);
    await db.from("document_chunks").insert(chunks.map((c) => ({
      document_id: doc.id,
      chunk_index: c.chunkNumber,
      content: c.content,
      token_count: c.tokenCount,
      section_title: c.sectionTitle,
      section_path: c.sectionPath,
      source_locator: c.sourceLocator,
      is_active: !isSuperseded,
    })));
  }
  const currentInternship = idByTitle.get("Internship Placement Policy");
  const oldInternship = idByTitle.get(supersededTitle);
  if (currentInternship && oldInternship) {
    await db.from("knowledge_documents").update({ supersedes_document_id: oldInternship }).eq("id", currentInternship);
    await db.from("knowledge_documents").update({ superseded_by_document_id: currentInternship }).eq("id", oldInternship);
  }

  // FAQs -------------------------------------------------------------------
  let faqs = 0;
  for (const [i, [qEn, qAr, aEn, aAr]] of FAQS.entries()) {
    const { data: existing } = await db.from("faq_items").select("id").eq("question_en", qEn).maybeSingle();
    if (existing) continue;
    await db.from("faq_items").insert({
      question_en: qEn,
      question_ar: qAr,
      answer_en: aEn,
      answer_ar: aAr,
      service_unit_id: unitId(i),
      approval_status: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      effective_date: "2025-09-01",
      review_date: "2026-09-01",
      priority: 100 - i,
      is_active: true,
    });
    faqs += 1;
  }

  // Web sources ------------------------------------------------------------
  let webSources = 0;
  const webIds: string[] = [];
  for (const [i, w] of WEB_SOURCES.entries()) {
    const { data: existing } = await db.from("web_knowledge_sources").select("id").eq("url", w.url).maybeSingle();
    if (existing) {
      webIds.push(existing.id);
      continue;
    }
    const { data: row } = await db.from("web_knowledge_sources").insert({
      title: w.title,
      url: w.url,
      language: w.lang,
      source_category: w.category,
      confidentiality_level: "public",
      owner_unit_id: unitId(i),
      refresh_frequency: "weekly",
      approval_status: "approved",
      is_active: true,
      created_by: userId,
    }).select("id").single();
    if (row) {
      webIds.push(row.id);
      webSources += 1;
    }
  }
  let webChanges = 0;
  for (const id of webIds.slice(0, 5)) {
    const { count } = await db.from("web_source_changes").select("id", { count: "exact", head: true }).eq("web_source_id", id);
    if (count) continue;
    await db.from("web_source_changes").insert({
      web_source_id: id,
      previous_content_hash: "seed-previous",
      new_content_hash: "seed-current",
      change_type: webChanges === 0 ? "major" : webChanges === 1 ? "moderate" : "minor",
      change_summary: "Demonstration change event created during seeding.",
      change_percentage: webChanges === 0 ? 46.2 : webChanges === 1 ? 18.4 : 3.1,
      review_status: "pending",
    });
    await db.from("web_knowledge_sources").update({ change_detected: true, approval_status: "changed_pending_review" }).eq("id", id);
    webChanges += 1;
  }

  // Connectors and tools ---------------------------------------------------
  let connectors = 0;
  const connectorIds = new Map<string, string>();
  for (const [i, c] of CONNECTORS.entries()) {
    const { data: existing } = await db.from("integration_connectors").select("id").eq("connector_name", c.name).eq("environment", c.env).maybeSingle();
    if (existing) {
      connectorIds.set(c.name, existing.id);
      continue;
    }
    const { data: row } = await db.from("integration_connectors").insert({
      connector_name: c.name,
      display_name_en: `DEMO CONNECTOR · ${c.en}`,
      display_name_ar: `موصل تجريبي · ${c.ar}`,
      source_system: c.system,
      connector_type: c.type,
      environment: c.env,
      base_url: `https://demo.example.local/api/${c.name}`,
      authentication_type: c.auth,
      credential_secret_name: c.auth === "none" ? null : `DEMO_${c.name.toUpperCase()}_CREDENTIAL`,
      credential_configured: c.auth !== "none",
      owner_unit_id: unitId(i),
      technical_owner: "Integration Office (demo)",
      business_owner: "Service Owner (demo)",
      data_classification: c.name === "student_accounts_api" ? "confidential" : "internal",
      is_demo: true,
      read_enabled: true,
      write_enabled: false,
      health_status: "healthy",
      created_by: userId,
    }).select("id").single();
    if (row) {
      connectorIds.set(c.name, row.id);
      connectors += 1;
    }
  }

  let tools = 0;
  for (const t of TOOLS) {
    const connectorId = connectorIds.get(t.connector);
    if (!connectorId) continue;
    const { data: existing } = await db.from("integration_tools").select("id").eq("connector_id", connectorId).eq("tool_name", t.name).maybeSingle();
    if (existing) continue;
    await db.from("integration_tools").insert({
      connector_id: connectorId,
      tool_name: t.name,
      display_name_en: t.en,
      display_name_ar: t.ar,
      description: t.desc,
      operation_type: "read",
      endpoint_path: `/${t.name}`,
      http_method: "GET",
      allowed_roles: ["student", "service_officer", "service_manager", "system_admin"] as never,
      risk_level: t.risk,
      enabled: true,
    });
    tools += 1;
  }

  // Field mappings ---------------------------------------------------------
  const sis = connectorIds.get("sis_core");
  let mappings = 0;
  if (sis) {
    const rows = [
      { external_field: "student_number", internal_field: "fictional_student_number", data_type: "string", sensitive: true, masking_rule: "last4", transformation_rule: null },
      { external_field: "cumulative_gpa", internal_field: "cumulative_gpa", data_type: "number", sensitive: false, masking_rule: null, transformation_rule: "number" },
      { external_field: "completed_credit_hours", internal_field: "completed_credits", data_type: "number", sensitive: false, masking_rule: null, transformation_rule: "number" },
      { external_field: "expected_graduation_date", internal_field: "expected_graduation_date", data_type: "date", sensitive: false, masking_rule: null, transformation_rule: "date_iso" },
      { external_field: "academic_standing", internal_field: "academic_standing", data_type: "string", sensitive: false, masking_rule: null, transformation_rule: "upper" },
    ];
    for (const r of rows) {
      const { data: existing } = await db.from("integration_field_mappings").select("id").eq("connector_id", sis).eq("external_field", r.external_field).maybeSingle();
      if (existing) continue;
      await db.from("integration_field_mappings").insert({ connector_id: sis, ...r });
      mappings += 1;
    }
  }

  // Source-of-truth rules --------------------------------------------------
  const domains: [string, string, string][] = [
    ["student_profile", "live_api", "approved_document"],
    ["gpa", "live_api", "approved_document"],
    ["registration", "live_api", "approved_policy"],
    ["holds", "live_api", "approved_faq"],
    ["course_availability", "live_api", "approved_web_source"],
    ["graduation_status", "live_api", "approved_policy"],
    ["internship_status", "live_api", "approved_policy"],
    ["complaint_status", "internal_database", "approved_service_guide"],
    ["appointment_availability", "live_api", "internal_database"],
    ["policy_requirements", "approved_policy", "approved_service_guide"],
    ["service_instructions", "approved_service_guide", "approved_faq"],
  ];
  let authorityRules = 0;
  for (const [domain, primary, secondary] of domains) {
    const { data: existing } = await db.from("data_authority_rules").select("id").eq("data_domain", domain).maybeSingle();
    if (existing) continue;
    await db.from("data_authority_rules").insert({
      data_domain: domain,
      primary_source_type: primary,
      secondary_source_type: secondary,
      conflict_behavior: "prefer_primary",
      cache_allowed: primary !== "live_api",
      maximum_staleness_minutes: primary === "live_api" ? 5 : 1440,
    });
    authorityRules += 1;
  }

  // Gaps and conflicts -----------------------------------------------------
  let gaps = 0;
  for (const [topic, lang, count, recommended] of GAPS) {
    const { data: existing } = await db.from("knowledge_gaps").select("id").eq("normalized_topic", topic).maybeSingle();
    if (existing) continue;
    await db.from("knowledge_gaps").insert({
      normalized_topic: topic,
      sample_questions: [`${topic}?`] as never,
      language: lang,
      occurrence_count: count,
      average_confidence: 0.3 + (count % 4) / 10,
      human_handoff_count: Math.max(1, Math.round(count / 3)),
      negative_feedback_count: Math.max(0, Math.round(count / 4)),
      recommended_source_type: recommended,
      priority_score: count * 1.5,
      status: "detected",
    });
    gaps += 1;
  }

  const conflictSeeds: [string, string, string, string, string][] = [
    ["internship credit threshold", "high", "document", "faq", "Policy states 80 credit hours while an older document states 75."],
    ["graduation credit total", "medium", "document", "web_source", "Guide states 120 credit hours while the web page states 126."],
    ["withdrawal deadline", "medium", "document", "faq", "Circular states week ten while the FAQ states week eight."],
    ["library loan period", "low", "document", "faq", "Rules state 14 days while the FAQ states 21 days."],
    ["scholarship GPA requirement", "critical", "document", "faq", "Policy states 3.0 while the FAQ states 2.75."],
  ];
  let conflicts = 0;
  for (const [topic, severity, one, two, summary] of conflictSeeds) {
    const { data: existing } = await db.from("knowledge_conflicts").select("id").eq("affected_topic", topic).maybeSingle();
    if (existing) continue;
    await db.from("knowledge_conflicts").insert({
      conflict_type: "contradiction",
      source_one_type: one,
      source_two_type: two,
      affected_topic: topic,
      conflicting_statement_one: summary.split(" while ")[0] ?? summary,
      conflicting_statement_two: summary.split(" while ")[1] ?? summary,
      severity,
      resolution_status: "open",
    });
    conflicts += 1;
  }

  // Coverage snapshot ------------------------------------------------------
  const { data: services } = await db.from("university_services").select("id").limit(25);
  let coverage = 0;
  for (const [i, s] of (services ?? []).entries()) {
    const total = 10 + (i % 5);
    const approved = Math.max(3, total - (i % 4));
    await db.from("service_knowledge_health").upsert({
      service_id: s.id,
      total_known_topics: total,
      topics_with_approved_source: approved,
      topics_with_en_content: approved,
      topics_with_ar_content: Math.max(2, approved - (i % 3)),
      topics_with_current_source: approved,
      topics_with_authoritative_source: Math.max(2, approved - 1),
      unresolved_conflicts: i % 2,
      knowledge_gaps: i % 3,
      coverage_score: Math.round((approved / total) * 100),
      updated_at: new Date().toISOString(),
    }, { onConflict: "service_id" });
    coverage += 1;
  }

  return { documents, faqs, webSources, webChanges, connectors, tools, mappings, authorityRules, gaps, conflicts, coverage };
}
