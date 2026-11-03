/* =====================================================================
   VivekTodaydate.sql
   Consolidated SQL Server (T-SQL) conversion of every file under
   UAEU-SANAD-MAIN-2/supabase/migrations, generated 2026-09-17.

   Source folder: UAEU-SANAD-MAIN-2/supabase/migrations (41 files,
   20260827110045_*.sql through 20260917130000_*.sql).

   Conversion notes (read before running):
   - All DDL/DML that has a direct SQL Server equivalent is translated
     below and made idempotent with IF OBJECT_ID / IF COL_LENGTH guards,
     so this file is safe to run against a database that already has the
     Sanadi.Api baseline schema (SANADIAPI/sql/sanadi_schema.sql).
   - Postgres Row Level Security (CREATE POLICY), Supabase Storage
     policies, SECURITY DEFINER PL/pgSQL functions, auth.uid()-based
     authorization, and REPLICA IDENTITY are Postgres/Supabase runtime
     features with no SQL Server equivalent. That authorization logic is
     already implemented in the C# API (Sanadi.Infrastructure.Auth.
     PermissionService, Sanadi.Api.Controllers.DataController /
     StorageController / RpcController). Re-declaring fake SQL Server
     objects for these would not enforce anything and is intentionally
     omitted; each such source file is called out in a comment below.
   - pgvector (CREATE EXTENSION vector, HNSW indexes, the
     search_knowledge_passages embedding ranking function) has no SQL
     Server equivalent in this deployment and is intentionally omitted;
     semantic search is served by Sanadi.Infrastructure instead.
   - Postgres arrays (text[]) and jsonb are stored as SQL Server
     nvarchar(max) JSON text, matching the pattern already used in
     SANADIAPI/sql/sanadi_schema.sql.
   ===================================================================== */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------
   20260827110045_7627c045-4dc9-4692-bab9-788c3d64f440.sql
   Postgres trigger binding a case-responsibility PL/pgSQL function.
   Case responsibility tracking is implemented in the C# API instead.
   No SQL Server equivalent object is created.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260827114404_f2db9bea-e5d6-46e8-a8fe-ec10da4e3c63.sql
   Deactivate retired services (data-only).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.university_services', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.university_services
    SET is_active = 0, updated_at = SYSDATETIMEOFFSET()
    WHERE code IN
    (
        N'SVC-INTERNSHIP', N'SVC-INTERN-APPLY', N'HOUSING-REG',
        N'SVC-HOUSING', N'SVC-TRANSFER-ICT', N'SVC-COLLEGE-TRANSFER'
    );
END;
GO

/* ---------------------------------------------------------------------
   20260827135800_234f29f2-39f9-4f7c-81e5-fa4f59f3ac21.sql
   Seed career_roles (array columns stored as JSON text on this table).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.career_roles', N'U') IS NOT NULL
BEGIN
    MERGE dbo.career_roles AS target
    USING (VALUES
        (N'SW_ENGINEER', N'Software Engineer', N'مهندس برمجيات', N'software engineering',
         N'Designs, builds and maintains software applications and services.',
         N'يصمم ويطور ويصون التطبيقات والخدمات البرمجية.',
         N'["BSc Computer Science","Computer Science","Information Systems and Security","BSc Information Systems and Security"]',
         N'entry',
         N'["Programming","Data Structures","Algorithms","Object Oriented Programming"]',
         N'["Web Development","APIs","Databases","Testing"]',
         N'["Problem solving","Teamwork","Communication"]',
         N'["Git","Docker","VS Code","Postman"]',
         N'["Programming","Data Structures","Software Engineering","Databases"]',
         N'["AWS Certified Developer"]',
         N'One internship or two substantial software projects.',
         N'A public code portfolio with 2-3 working applications.',
         N'["technology","banking","government"]',
         N'["software engineer","backend","frontend","full stack","git","api"]'),
        (N'DATA_ANALYST', N'Data Analyst', N'محلل بيانات', N'data and analytics',
         N'Turns raw data into dashboards, reports and business insight.',
         N'يحوّل البيانات الخام إلى لوحات ومؤشرات ورؤى تدعم القرار.',
         N'["BSc Data Science and Artificial Intelligence","Data Science","BSc Mathematical Sciences","Mathematical Sciences","Bachelor of Business Administration","Information Systems and Security"]',
         N'entry',
         N'["SQL","Statistics","Data Visualisation","Excel"]',
         N'["Python","Data Cleaning","Reporting"]',
         N'["Analytical thinking","Attention to detail","Communication"]',
         N'["Power BI","Tableau","SQL","Excel"]',
         N'["Statistics","Databases","Data Analysis","Mathematics"]',
         N'["Microsoft Power BI Data Analyst"]',
         N'One analytics internship or coursework projects with real datasets.',
         N'Two dashboards or analysis notebooks with documented findings.',
         N'["banking","technology","government","healthcare"]',
         N'["data analyst","sql","power bi","tableau","dashboard"]'),
        (N'DATA_SCIENTIST', N'Data Scientist', N'عالم بيانات', N'data and analytics',
         N'Builds predictive models and machine learning solutions.',
         N'يبني النماذج التنبؤية وحلول تعلم الآلة.',
         N'["BSc Data Science and Artificial Intelligence","Data Science","BSc Mathematical Sciences","BSc Computer Science"]',
         N'entry',
         N'["Python","Machine Learning","Statistics","SQL"]',
         N'["Deep Learning","Feature Engineering","Model Evaluation"]',
         N'["Analytical thinking","Curiosity","Communication"]',
         N'["Python","Jupyter","scikit-learn","TensorFlow"]',
         N'["Machine Learning","Statistics","Linear Algebra","Programming"]',
         N'["TensorFlow Developer Certificate"]',
         N'Research assistantship, internship or applied ML projects.',
         N'Two end-to-end ML projects with evaluation metrics.',
         N'["technology","healthcare","energy"]',
         N'["data scientist","machine learning","python","model","pandas"]'),
        (N'AI_ENGINEER', N'AI / Machine Learning Engineer', N'مهندس ذكاء اصطناعي', N'artificial intelligence',
         N'Deploys and operates AI models in production systems.',
         N'ينشر ويشغّل نماذج الذكاء الاصطناعي ضمن الأنظمة الإنتاجية.',
         N'["BSc Data Science and Artificial Intelligence","BSc Computer Science","Data Science"]',
         N'entry',
         N'["Python","Machine Learning","APIs","Programming"]',
         N'["MLOps","Cloud Computing","Deep Learning"]',
         N'["Problem solving","Collaboration","Communication"]',
         N'["Docker","Git","AWS","Python"]',
         N'["Machine Learning","Programming","Cloud Computing"]',
         N'["AWS Certified Machine Learning"]',
         N'Internship or capstone deploying a model behind an API.',
         N'A deployed demo with documented architecture.',
         N'["technology","government"]',
         N'["machine learning engineer","mlops","deployment","python","docker"]'),
        (N'CYBERSECURITY_ANALYST', N'Cybersecurity Analyst', N'محلل أمن سيبراني', N'cybersecurity',
         N'Monitors, detects and responds to security threats.',
         N'يراقب التهديدات الأمنية ويكتشفها ويستجيب لها.',
         N'["BSc Information Systems and Security","Information Systems and Security","BSc Computer Science"]',
         N'entry',
         N'["Network Security","Incident Response","Risk Assessment","Operating Systems"]',
         N'["SIEM","Penetration Testing","Cryptography"]',
         N'["Attention to detail","Integrity","Communication"]',
         N'["Wireshark","Splunk","Kali Linux"]',
         N'["Network Security","Information Security","Operating Systems"]',
         N'["CompTIA Security+"]',
         N'Security internship or a documented lab environment.',
         N'Write-ups of security labs or CTF participation.',
         N'["banking","government","technology"]',
         N'["cybersecurity","soc analyst","siem","security+","incident response"]'),
        (N'IT_SUPPORT', N'IT Systems Administrator', N'مسؤول أنظمة تقنية المعلومات', N'information technology',
         N'Runs, secures and supports institutional IT infrastructure.',
         N'يشغّل ويؤمّن ويدعم البنية التحتية لتقنية المعلومات.',
         N'["BSc Information Systems and Security","BSc Computer Science","Information Systems and Security"]',
         N'entry',
         N'["Networking","Operating Systems","Troubleshooting"]',
         N'["Cloud Computing","Scripting","Active Directory"]',
         N'["Service orientation","Patience","Communication"]',
         N'["Linux","Windows Server","PowerShell"]',
         N'["Networking","Operating Systems","Information Systems"]',
         N'["CompTIA Network+"]',
         N'Helpdesk or campus IT experience is valued.',
         N'Documented home lab or automation scripts.',
         N'["technology","education","government"]',
         N'["system administrator","it support","networking","linux"]'),
        (N'BUSINESS_ANALYST', N'Business Analyst', N'محلل أعمال', N'business',
         N'Bridges business needs and technical delivery through analysis.',
         N'يربط احتياجات العمل بالتنفيذ التقني عبر التحليل.',
         N'["Bachelor of Business Administration","BSc Information Systems and Security","Business Administration"]',
         N'entry',
         N'["Requirements Analysis","Process Mapping","Excel","Reporting"]',
         N'["SQL","Stakeholder Management","Agile"]',
         N'["Communication","Critical thinking","Negotiation"]',
         N'["Excel","Jira","Visio","Power BI"]',
         N'["Management","Business Analysis","Statistics","Accounting"]',
         N'["IIBA ECBA"]',
         N'An internship in operations, consulting or a project team.',
         N'Two case studies with process diagrams.',
         N'["banking","consulting","government"]',
         N'["business analyst","requirements","process improvement","stakeholder"]'),
        (N'MARKETING_SPECIALIST', N'Marketing Specialist', N'أخصائي تسويق', N'business',
         N'Plans and runs marketing campaigns and brand communication.',
         N'يخطط وينفذ الحملات التسويقية والتواصل مع الجمهور.',
         N'["Bachelor of Business Administration","Business Administration"]',
         N'entry',
         N'["Marketing","Content Creation","Market Research"]',
         N'["Digital Marketing","Analytics","Copywriting"]',
         N'["Creativity","Communication","Teamwork"]',
         N'["Canva","Google Analytics","Meta Business Suite"]',
         N'["Marketing","Management","Communication"]',
         N'["Google Analytics Certification"]',
         N'Campus club, internship or freelance campaign experience.',
         N'A portfolio of campaigns or content samples.',
         N'["retail","media","technology"]',
         N'["marketing","campaign","social media","seo","content"]'),
        (N'FINANCIAL_ANALYST', N'Financial Analyst', N'محلل مالي', N'business',
         N'Analyses financial data to support budgeting and investment decisions.',
         N'يحلل البيانات المالية لدعم قرارات الميزانية والاستثمار.',
         N'["Bachelor of Business Administration","Business Administration","BSc Mathematical Sciences"]',
         N'entry',
         N'["Financial Analysis","Accounting","Excel","Statistics"]',
         N'["Valuation","Forecasting","SQL"]',
         N'["Attention to detail","Integrity","Analytical thinking"]',
         N'["Excel","Power BI","Bloomberg Terminal"]',
         N'["Accounting","Finance","Statistics","Mathematics"]',
         N'["CFA Level I"]',
         N'Internship in a bank, audit firm or finance department.',
         N'Financial models or investment memos.',
         N'["banking","energy","government"]',
         N'["financial analyst","forecasting","valuation","excel","accounting"]'),
        (N'ELECTRICAL_ENGINEER', N'Electrical Engineer', N'مهندس كهربائي', N'engineering',
         N'Designs and tests electrical systems, power and control equipment.',
         N'يصمم ويختبر الأنظمة الكهربائية ومعدات الطاقة والتحكم.',
         N'["BSc Electrical Engineering","Electrical Engineering"]',
         N'entry',
         N'["Circuit Design","Electronics","Control Systems","Physics"]',
         N'["Embedded Systems","Power Systems","Signal Processing"]',
         N'["Attention to detail","Safety awareness","Teamwork"]',
         N'["MATLAB","AutoCAD","LTspice"]',
         N'["General Physics","Circuits","Control Systems","Mathematics"]',
         N'["Engineer Licence (SOE)"]',
         N'Industrial training or a hardware capstone project.',
         N'Documented hardware builds with schematics.',
         N'["energy","utilities","manufacturing"]',
         N'["electrical engineer","circuits","power systems","matlab","plc"]'),
        (N'MECHANICAL_ENGINEER', N'Mechanical Engineer', N'مهندس ميكانيكي', N'engineering',
         N'Designs mechanical systems, components and manufacturing processes.',
         N'يصمم الأنظمة والمكونات الميكانيكية وعمليات التصنيع.',
         N'["BSc Mechanical Engineering","Mechanical Engineering"]',
         N'entry',
         N'["CAD","Thermodynamics","Mechanics","Physics"]',
         N'["Finite Element Analysis","Manufacturing","Materials"]',
         N'["Problem solving","Teamwork","Safety awareness"]',
         N'["SolidWorks","AutoCAD","ANSYS"]',
         N'["General Physics","Thermodynamics","Mechanics","Mathematics"]',
         N'["Engineer Licence (SOE)"]',
         N'Industrial training placement or a design competition team.',
         N'CAD models and a capstone design report.',
         N'["manufacturing","energy","construction"]',
         N'["mechanical engineer","solidworks","cad","thermodynamics","ansys"]'),
        (N'TEACHER', N'School Teacher', N'معلم', N'education',
         N'Plans lessons, teaches and assesses learning in schools.',
         N'يخطط الدروس ويقوم بالتدريس وتقييم التعلم في المدارس.',
         N'["Bachelor of Education","Education","BSc Mathematical Sciences","BSc Biology"]',
         N'entry',
         N'["Lesson Planning","Classroom Management","Assessment"]',
         N'["Educational Technology","Curriculum Design","Inclusive Education"]',
         N'["Communication","Patience","Empathy"]',
         N'["Microsoft Teams","Google Classroom"]',
         N'["Education","Psychology","Teaching Methods"]',
         N'["Teaching Licence (UAE)"]',
         N'Practicum or teaching practice placement.',
         N'A teaching portfolio with lesson plans and reflections.',
         N'["education","government"]',
         N'["teacher","lesson planning","classroom","curriculum","assessment"]'),
        (N'LAB_SCIENTIST', N'Laboratory Scientist', N'أخصائي مختبرات', N'science and research',
         N'Runs laboratory experiments, analysis and quality testing.',
         N'ينفذ التجارب المخبرية والتحاليل واختبارات الجودة.',
         N'["BSc Biology","Biology"]',
         N'entry',
         N'["Laboratory Techniques","Data Recording","Biology","Quality Control"]',
         N'["Microbiology","Biochemistry","Research Methods"]',
         N'["Attention to detail","Integrity","Teamwork"]',
         N'["Microscopy","SPSS","Excel"]',
         N'["Biology","Chemistry","Research Methods","Statistics"]',
         N'["Good Laboratory Practice"]',
         N'Research assistantship or laboratory internship.',
         N'Lab reports or a research poster.',
         N'["healthcare","research","environment"]',
         N'["laboratory","research assistant","sample analysis","quality control"]')
    ) AS src
    (
        role_code, title_en, title_ar, career_family, description_en, description_ar,
        suitable_programmes, typical_entry_level, required_hard_skills, preferred_hard_skills,
        required_soft_skills, preferred_tools, preferred_courses, certifications,
        experience_expectations, portfolio_expectations, industry_sectors, ats_keywords
    )
    ON target.role_code = src.role_code
    WHEN NOT MATCHED BY TARGET THEN
        INSERT
        (
            role_code, title_en, title_ar, career_family, description_en, description_ar,
            suitable_programmes, typical_entry_level, required_hard_skills, preferred_hard_skills,
            required_soft_skills, preferred_tools, preferred_courses, certifications,
            experience_expectations, portfolio_expectations, industry_sectors, ats_keywords, active
        )
        VALUES
        (
            src.role_code, src.title_en, src.title_ar, src.career_family, src.description_en, src.description_ar,
            src.suitable_programmes, src.typical_entry_level, src.required_hard_skills, src.preferred_hard_skills,
            src.required_soft_skills, src.preferred_tools, src.preferred_courses, src.certifications,
            src.experience_expectations, src.portfolio_expectations, src.industry_sectors, src.ats_keywords, 1
        );
END;
GO

/* ---------------------------------------------------------------------
   20260828100234_e39fc3af-c5f1-4b50-a8e8-d9980d4d8c89.sql
   Unique indexes for notification dedupe keys.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.notification_events', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'notification_events_dedupe' AND object_id = OBJECT_ID(N'dbo.notification_events'))
BEGIN
    CREATE UNIQUE INDEX notification_events_dedupe ON dbo.notification_events (dedupe_key);
END;
GO

IF OBJECT_ID(N'dbo.notification_deliveries', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_notification_deliveries_dedupe' AND object_id = OBJECT_ID(N'dbo.notification_deliveries'))
BEGIN
    CREATE UNIQUE INDEX uq_notification_deliveries_dedupe ON dbo.notification_deliveries (dedupe_key);
END;
GO

/* ---------------------------------------------------------------------
   20260828101701_f829f4db-10f3-4915-9f2d-a1ff308ebee2.sql
   RLS policy: students delete their own career analysis versions.
   Enforced by Sanadi.Api authorization instead; no SQL Server object.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260828111921_7196f0fd-56f1-449c-99ef-e3ba37a79409.sql
   Backfill: open a case for every open suggestion lacking one.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.suggestions', N'U') IS NOT NULL AND OBJECT_ID(N'dbo.cases', N'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.cases
    (
        case_number, student_id, case_type, service_unit_id, title, description, status,
        urgency, severity, language, entry_channel, current_responsible_actor, automation_level,
        human_review_required, attention_reason, linked_suggestion_id, related_conversation_id,
        routing_service_code, routing_reason_en, routing_reason_ar, routing_confidence, assigned_to, created_at
    )
    SELECT
        N'', s.student_id, N'suggestion', s.service_unit_id, s.title, s.description,
        CASE WHEN o.staff_profile_id IS NULL THEN N'submitted' ELSE N'assigned' END,
        N'medium', N'normal', s.language, ISNULL(s.entry_channel, N'chat'),
        N'service_owner', N'human_review', 1,
        N'A student suggestion needs a decision from the service owner',
        s.id, s.related_conversation_id,
        s.routing_service_code, s.routing_reason_en, s.routing_reason_ar, s.routing_confidence,
        o.staff_profile_id, s.created_at
    FROM dbo.suggestions s
    OUTER APPLY
    (
        SELECT TOP (1) suo.staff_profile_id
        FROM dbo.service_unit_owners suo
        WHERE suo.service_unit_id = s.service_unit_id AND suo.is_active = 1
        ORDER BY suo.created_at
    ) o
    WHERE s.deleted_at IS NULL
      AND s.status NOT IN (N'closed', N'implemented', N'not_proceeding')
      AND NOT EXISTS (SELECT 1 FROM dbo.cases c WHERE c.linked_suggestion_id = s.id);
END;
GO

/* ---------------------------------------------------------------------
   20260828113755_4c138964-48bc-4c21-b8e9-e6423f0526de.sql
   PL/pgSQL functions: admin_governance_overview / admin_owner_performance /
   admin_governance_report. Already ported to C# in
   Sanadi.Infrastructure.Rpc.OperationalRpcHandlers
   (AdminGovernanceOverviewHandler, AdminOwnerPerformanceHandler,
   AdminGovernanceReportHandler). No SQL Server function is recreated.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260828114912_53ee8172-cd39-44f7-b188-a1e02c3a8ce3.sql
   PL/pgSQL function admin_owner_monitor, ported to
   Sanadi.Infrastructure.Rpc.OperationalRpcHandlers.AdminOwnerMonitorHandler.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260828123740_ed517399-fd80-4f11-956b-73b20643acff.sql
   20260828123908_e6f00234-c3e6-4dc0-a727-10af4a5a021e.sql
   20260828210957_46f67627-e7b5-45ce-a110-5f58c9546690.sql
   RLS policy tightening, SECURITY DEFINER grant/revoke, storage
   policies for case-evidence, and a patched search_knowledge_passages
   function. All enforced by Sanadi.Api (CurrentUserMiddleware,
   PermissionService, StorageController) and
   Sanadi.Infrastructure.Rpc.CoreRpcHandlers.SearchKnowledgeHandler.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260902073159_1f2b2217-f8c5-4170-97e1-806b903e2590.sql
   pgvector extension, embedding columns/HNSW indexes, and the
   patched search_knowledge_passages ranking function. No SQL Server
   equivalent; knowledge search runs through Sanadi.Infrastructure
   instead of an in-database vector index.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260910170022_86a43501-2308-4192-a7f8-0a8d2a33b333.sql
   emergency_contacts: new columns, index, seed data.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.emergency_contacts', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.emergency_contacts', N'category_en') IS NULL ALTER TABLE dbo.emergency_contacts ADD category_en nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'category_ar') IS NULL ALTER TABLE dbo.emergency_contacts ADD category_ar nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'emergency_type_en') IS NULL ALTER TABLE dbo.emergency_contacts ADD emergency_type_en nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'emergency_type_ar') IS NULL ALTER TABLE dbo.emergency_contacts ADD emergency_type_ar nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'responsible_unit_en') IS NULL ALTER TABLE dbo.emergency_contacts ADD responsible_unit_en nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'responsible_unit_ar') IS NULL ALTER TABLE dbo.emergency_contacts ADD responsible_unit_ar nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'mobile_number') IS NULL ALTER TABLE dbo.emergency_contacts ADD mobile_number nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'emergency_number') IS NULL ALTER TABLE dbo.emergency_contacts ADD emergency_number nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'email') IS NULL ALTER TABLE dbo.emergency_contacts ADD email nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'notes_en') IS NULL ALTER TABLE dbo.emergency_contacts ADD notes_en nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'notes_ar') IS NULL ALTER TABLE dbo.emergency_contacts ADD notes_ar nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.emergency_contacts', N'keywords') IS NULL ALTER TABLE dbo.emergency_contacts ADD keywords nvarchar(max) NOT NULL CONSTRAINT DF_emergency_contacts_keywords DEFAULT (N'[]');
    IF COL_LENGTH(N'dbo.emergency_contacts', N'priority') IS NULL ALTER TABLE dbo.emergency_contacts ADD priority int NOT NULL CONSTRAINT DF_emergency_contacts_priority DEFAULT (100);
END;
GO

IF OBJECT_ID(N'dbo.emergency_contacts', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'emergency_contacts_active_priority_idx' AND object_id = OBJECT_ID(N'dbo.emergency_contacts'))
BEGIN
    CREATE INDEX emergency_contacts_active_priority_idx ON dbo.emergency_contacts (is_active, priority);
END;
GO

IF OBJECT_ID(N'dbo.emergency_contacts', N'U') IS NOT NULL
BEGIN
    MERGE dbo.emergency_contacts AS target
    USING (VALUES
        (N'campus_health', N'campus', N'Urgent Medical Help', N'الإسعاف الطبي العاجل',
         N'Health Emergency', N'طوارئ صحية', N'Urgent medical emergency', N'حالة صحية طارئة',
         N'Urgent Medical Help', N'الإسعاف الطبي العاجل', N'050 927 5824', N'4004', NULL,
         N'["medical","health","clinic","ambulance","injury","injured","bleeding","faint","fainted","unconscious","sick","ill","pain","doctor","nurse","breathing","allergic","seizure","heart","accident","طبي","صحية","صحي","إسعاف","مريض","مرض","إصابة","جرح","نزيف","إغماء","ألم","طبيب","تنفس","حساسية","حادث"]',
         10, 10, 1),
        (N'campus_fire', N'campus', N'Operations and Emergency Section', N'قسم العمليات والطوارئ',
         N'General Emergency', N'طوارئ عامة', N'Fire / Fire alarm', N'حريق / إنذار حريق',
         N'Operations and Emergency Section', N'قسم العمليات والطوارئ', NULL, N'6888', N'OES@uaeu.ac.ae',
         N'["fire","smoke","burning","flame","fire alarm","alarm","evacuate","evacuation","explosion","gas leak","حريق","دخان","نار","إنذار","اشتعال","إخلاء","انفجار","تسرب غاز"]',
         10, 20, 1),
        (N'campus_maintenance', N'campus', N'Khadamat', N'خدمات',
         N'Maintenance', N'صيانة', N'Electricity / Water / Air Conditioning / Faults', N'كهرباء / مياه / تكييف / أعطال',
         N'Khadamat', N'خدمات', NULL, N'8000', N'servicedesk@khadamat.ae',
         N'["maintenance","electricity","power","power cut","light","lights","water","leak","leaking","plumbing","air conditioning","ac","a/c","aircon","cooling","heater","fault","broken","not working","elevator","lift","toilet","sink","drain","صيانة","كهرباء","انقطاع الكهرباء","إنارة","مياه","ماء","تسرب","تسريب","سباكة","تكييف","مكيف","تبريد","عطل","أعطال","معطل","لا يعمل","مصعد","حمام","مغسلة"]',
         20, 30, 1),
        (N'campus_security', N'campus', N'FMD — Security and Lost & Found', N'إدارة المرافق — الأمن والمفقودات',
         N'Security', N'أمن', N'Security incidents / Lost property', N'حوادث أمنية / فقدان ممتلكات',
         N'FMD', N'إدارة المرافق', NULL, N'4488', N'LostNFound@uaeu.ac.ae',
         N'["security","guard","theft","stolen","steal","robbery","lost","missing","lost property","lost and found","wallet","phone","bag","laptop","keys","id card","suspicious","intruder","harassment on campus","vandalism","أمن","حارس","سرقة","مسروق","فقدت","فقدان","ضائع","مفقود","محفظة","هاتف","جوال","حقيبة","مفاتيح","بطاقة","مشبوه","تخريب","ممتلكات"]',
         20, 40, 1)
    ) AS src
    (
        code, kind, label_en, label_ar, category_en, category_ar, emergency_type_en, emergency_type_ar,
        responsible_unit_en, responsible_unit_ar, mobile_number, emergency_number, email,
        keywords, priority, sort_order, is_active
    )
    ON target.code = src.code
    WHEN MATCHED THEN UPDATE SET
        label_en = src.label_en, label_ar = src.label_ar,
        category_en = src.category_en, category_ar = src.category_ar,
        emergency_type_en = src.emergency_type_en, emergency_type_ar = src.emergency_type_ar,
        responsible_unit_en = src.responsible_unit_en, responsible_unit_ar = src.responsible_unit_ar,
        mobile_number = src.mobile_number, emergency_number = src.emergency_number, email = src.email,
        keywords = src.keywords, priority = src.priority, sort_order = src.sort_order,
        is_active = 1, updated_at = SYSDATETIMEOFFSET()
    WHEN NOT MATCHED BY TARGET THEN
        INSERT
        (
            code, kind, label_en, label_ar, category_en, category_ar, emergency_type_en, emergency_type_ar,
            responsible_unit_en, responsible_unit_ar, mobile_number, emergency_number, email,
            keywords, priority, sort_order, is_active
        )
        VALUES
        (
            src.code, src.kind, src.label_en, src.label_ar, src.category_en, src.category_ar,
            src.emergency_type_en, src.emergency_type_ar, src.responsible_unit_en, src.responsible_unit_ar,
            src.mobile_number, src.emergency_number, src.email, src.keywords, src.priority, src.sort_order, src.is_active
        );
END;
GO

/* ---------------------------------------------------------------------
   20260910173225_47a80c1c-9477-4d80-b58a-f26ef2abf885.sql
   issued_documents: message_id column and index.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.issued_documents', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.issued_documents', N'message_id') IS NULL
        ALTER TABLE dbo.issued_documents ADD message_id uniqueidentifier NULL;
END;
GO

IF OBJECT_ID(N'dbo.issued_documents', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'issued_documents_message_id_idx' AND object_id = OBJECT_ID(N'dbo.issued_documents'))
BEGIN
    CREATE INDEX issued_documents_message_id_idx ON dbo.issued_documents (message_id) WHERE message_id IS NOT NULL;
END;
GO

/* ---------------------------------------------------------------------
   20260910181023_75f3e4e1-ea00-4e72-a1ab-a3267cbee241.sql
   staff_profiles: new columns/constraints; cases index.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.staff_profiles', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.staff_profiles', N'staff_code') IS NULL ALTER TABLE dbo.staff_profiles ADD staff_code nvarchar(256) NULL;
    IF COL_LENGTH(N'dbo.staff_profiles', N'is_active') IS NULL ALTER TABLE dbo.staff_profiles ADD is_active bit NOT NULL CONSTRAINT DF_staff_profiles_is_active DEFAULT (1);
    IF COL_LENGTH(N'dbo.staff_profiles', N'availability_status') IS NULL ALTER TABLE dbo.staff_profiles ADD availability_status nvarchar(450) NOT NULL CONSTRAINT DF_staff_profiles_availability_status DEFAULT (N'available');
    IF COL_LENGTH(N'dbo.staff_profiles', N'last_assigned_at') IS NULL ALTER TABLE dbo.staff_profiles ADD last_assigned_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.staff_profiles', N'must_change_password') IS NULL ALTER TABLE dbo.staff_profiles ADD must_change_password bit NOT NULL CONSTRAINT DF_staff_profiles_must_change_password DEFAULT (0);

END;
GO

-- Separate batch: availability_status/staff_code must exist before these constraints reference them.
IF OBJECT_ID(N'dbo.staff_profiles', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'staff_profiles_availability_status_check')
        ALTER TABLE dbo.staff_profiles ADD CONSTRAINT staff_profiles_availability_status_check
            CHECK (availability_status IN (N'available', N'unavailable', N'on_leave'));
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'staff_profiles_staff_code_key')
        ALTER TABLE dbo.staff_profiles ADD CONSTRAINT staff_profiles_staff_code_key UNIQUE (staff_code);
END;
GO

IF OBJECT_ID(N'dbo.cases', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_cases_assigned_to_status' AND object_id = OBJECT_ID(N'dbo.cases'))
BEGIN
    CREATE INDEX idx_cases_assigned_to_status ON dbo.cases (assigned_to, status);
END;
GO

/* ---------------------------------------------------------------------
   20260910183743_05230cff-4153-414b-9570-bd05582f029b.sql
   profiles: access-revocation columns + index.
   PL/pgSQL helper functions (is_access_revoked/has_role/is_staff/
   is_manager) are ported to Sanadi.Infrastructure.Auth.PermissionService
   and the usp_* stored procedures already in sanadi_schema.sql.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.profiles', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.profiles', N'access_revoked_at') IS NULL ALTER TABLE dbo.profiles ADD access_revoked_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.profiles', N'access_revoked_by') IS NULL ALTER TABLE dbo.profiles ADD access_revoked_by uniqueidentifier NULL;
    IF COL_LENGTH(N'dbo.profiles', N'access_revoked_reason') IS NULL ALTER TABLE dbo.profiles ADD access_revoked_reason nvarchar(450) NULL;
END;
GO

IF OBJECT_ID(N'dbo.profiles', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'profiles_access_revoked_idx' AND object_id = OBJECT_ID(N'dbo.profiles'))
BEGIN
    CREATE INDEX profiles_access_revoked_idx ON dbo.profiles (access_revoked_at) WHERE access_revoked_at IS NOT NULL;
END;
GO

/* ---------------------------------------------------------------------
   20260910184543_d9075ed7-4702-4601-b15a-cde06672ca96.sql
   case_handovers (already present in sanadi_schema.sql baseline) and
   exception_events (created below with its later column additions).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.exception_events', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.exception_events
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_exception_events_id DEFAULT (NEWID()) PRIMARY KEY,
        code nvarchar(450) NOT NULL,
        severity nvarchar(450) NOT NULL CONSTRAINT DF_exception_events_severity DEFAULT (N'warning'),
        user_id uniqueidentifier NULL,
        case_id uniqueidentifier NULL,
        conversation_id uniqueidentifier NULL,
        detail nvarchar(450) NULL,
        context nvarchar(max) NOT NULL CONSTRAINT DF_exception_events_context DEFAULT (N'{}'),
        recovered bit NOT NULL CONSTRAINT DF_exception_events_recovered DEFAULT (0),
        recovery_action nvarchar(450) NULL,
        escalated bit NOT NULL CONSTRAINT DF_exception_events_escalated DEFAULT (0),
        created_at datetimeoffset NOT NULL CONSTRAINT DF_exception_events_created_at DEFAULT (SYSDATETIMEOFFSET())
    );
END;
GO

IF OBJECT_ID(N'dbo.exception_events', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'exception_events_code_idx' AND object_id = OBJECT_ID(N'dbo.exception_events'))
BEGIN
    CREATE INDEX exception_events_code_idx ON dbo.exception_events (code, created_at DESC);
END;
GO

/* ---------------------------------------------------------------------
   20260910185751_735760e6-e87a-4e1a-875c-2a7081b357ac.sql
   case_reopen_requests: new columns + index.
   student_field_provenance already present in sanadi_schema.sql.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.case_reopen_requests', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.case_reopen_requests', N'kind') IS NULL ALTER TABLE dbo.case_reopen_requests ADD kind nvarchar(450) NOT NULL CONSTRAINT DF_case_reopen_requests_kind DEFAULT (N'objection');
    IF COL_LENGTH(N'dbo.case_reopen_requests', N'original_status') IS NULL ALTER TABLE dbo.case_reopen_requests ADD original_status nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.case_reopen_requests', N'original_outcome_en') IS NULL ALTER TABLE dbo.case_reopen_requests ADD original_outcome_en nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.case_reopen_requests', N'original_outcome_ar') IS NULL ALTER TABLE dbo.case_reopen_requests ADD original_outcome_ar nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.case_reopen_requests', N'original_decided_at') IS NULL ALTER TABLE dbo.case_reopen_requests ADD original_decided_at datetimeoffset NULL;
END;
GO

IF OBJECT_ID(N'dbo.case_reopen_requests', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'case_reopen_requests_case_kind_idx' AND object_id = OBJECT_ID(N'dbo.case_reopen_requests'))
BEGIN
    CREATE INDEX case_reopen_requests_case_kind_idx ON dbo.case_reopen_requests (case_id, kind);
END;
GO

/* ---------------------------------------------------------------------
   20260910191110_d0e0150b-7089-4ebe-ab00-25b14411dbf1.sql
   service_baselines / pilot_test_sessions already present in
   sanadi_schema.sql. evaluation_metrics PL/pgSQL function is ported to
   Sanadi.Infrastructure.Rpc.OperationalRpcHandlers.EvaluationMetricsHandler.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260910194541_494c1cc9-7932-4b59-b0e7-70adb1956919.sql
   Seed the proactive campus-entry service.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.university_services', N'U') IS NOT NULL
BEGIN
    MERGE dbo.university_services AS target
    USING (SELECT
        N'SVC-CAMPUS-ENTRY' AS code,
        N'Campus entry permit (proactive)' AS name_en,
        N'تصريح دخول الحرم الجامعي (خدمة استباقية)' AS name_ar,
        N'This service is now proactive. You do not need to submit a separate request. Simply proceed to the designated parking area and use your UAEU ID to access/open the gate.' AS description_en,
        N'أصبحت هذه الخدمة استباقية، ولا تحتاج إلى تقديم طلب منفصل. يمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات لفتح البوابة والدخول.' AS description_ar,
        N'proactive' AS category
    ) AS src
    ON target.code = src.code
    WHEN MATCHED THEN UPDATE SET
        name_en = src.name_en, name_ar = src.name_ar,
        description_en = src.description_en, description_ar = src.description_ar,
        category = src.category,
        allows_online_submission = 0, allows_agent_submission = 0, requires_human_approval = 0,
        instructions_en = src.description_en, instructions_ar = src.description_ar,
        is_active = 1
    WHEN NOT MATCHED BY TARGET THEN
        INSERT
        (
            service_unit_id, code, name_en, name_ar, description_en, description_ar, category,
            target_audience, authentication_required, estimated_processing_days,
            allows_online_submission, allows_agent_submission, requires_human_approval,
            instructions_en, instructions_ar, is_active
        )
        VALUES
        (
            NULL, src.code, src.name_en, src.name_ar, src.description_en, src.description_ar, src.category,
            N'students', 0, 0, 0, 0, 0, src.description_en, src.description_ar, 1
        );
END;
GO

/* ---------------------------------------------------------------------
   20260911122652_406428ef-dfcd-4561-a058-dbe6c667325b.sql
   response_performance_logs: new columns + index.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.response_performance_logs', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.response_performance_logs', N'routing_ms') IS NULL ALTER TABLE dbo.response_performance_logs ADD routing_ms int NULL;
    IF COL_LENGTH(N'dbo.response_performance_logs', N'student_context_ms') IS NULL ALTER TABLE dbo.response_performance_logs ADD student_context_ms int NULL;
    IF COL_LENGTH(N'dbo.response_performance_logs', N'external_api_ms') IS NULL ALTER TABLE dbo.response_performance_logs ADD external_api_ms int NULL;
    IF COL_LENGTH(N'dbo.response_performance_logs', N'model_queue_ms') IS NULL ALTER TABLE dbo.response_performance_logs ADD model_queue_ms int NULL;
END;
GO

IF OBJECT_ID(N'dbo.response_performance_logs', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_rpl_path_total' AND object_id = OBJECT_ID(N'dbo.response_performance_logs'))
BEGIN
    CREATE INDEX idx_rpl_path_total ON dbo.response_performance_logs (execution_path, total_duration_ms);
END;
GO

/* ---------------------------------------------------------------------
   20260912054911_9d82355b-4915-4474-ba8e-5cb06e5ccbc1.sql
   program_requirement_baskets / program_basket_courses already present
   in sanadi_schema.sql (with their indexes). updated_at triggers are
   maintained by the application layer instead of a Postgres trigger.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260912065259_bf475fd0-cfc5-40e2-9d84-7166699e8830.sql
   20260912112756_38ff9b38-6c02-4e73-9350-1449e7cefd69.sql
   can_write_case_evidence / can_read_case_evidence / staff_can_view_profile
   PL/pgSQL functions and storage/profile RLS policies. Ported to
   Sanadi.Infrastructure.Auth.PermissionService.CanAccessCaseAsync and
   Sanadi.Api.Controllers.StorageController.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260912074910_959238e8-26a9-433c-815f-c22fa1fb73e0.sql
   Data corrections (data-only).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.service_units', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.service_units SET name_en = N'Center for Career Placement & Alumni', name_ar = N'مركز التوظيف وشؤون الخريجين' WHERE code = N'CAREER';
END;
GO

IF OBJECT_ID(N'dbo.appointment_slots', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.appointment_slots SET location = NULL WHERE location IS NOT NULL;
END;
GO

/* ---------------------------------------------------------------------
   20260912075150_2d62f0c4-aac5-42f5-8ade-4177075ad1b2.sql
   appointment_slots / appointment_types: demo-data flags.
   list_appointment_availability PL/pgSQL function is ported to
   Sanadi.Infrastructure.Rpc.CoreRpcHandlers.ListAppointmentAvailabilityHandler.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.appointment_slots', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.appointment_slots', N'data_source') IS NULL ALTER TABLE dbo.appointment_slots ADD data_source nvarchar(450) NOT NULL CONSTRAINT DF_appointment_slots_data_source DEFAULT (N'manual');
    IF COL_LENGTH(N'dbo.appointment_slots', N'is_demo_record') IS NULL ALTER TABLE dbo.appointment_slots ADD is_demo_record bit NOT NULL CONSTRAINT DF_appointment_slots_is_demo_record DEFAULT (0);
END;
GO

IF OBJECT_ID(N'dbo.appointment_types', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.appointment_types', N'data_source') IS NULL ALTER TABLE dbo.appointment_types ADD data_source nvarchar(450) NOT NULL CONSTRAINT DF_appointment_types_data_source DEFAULT (N'manual');
    IF COL_LENGTH(N'dbo.appointment_types', N'is_demo_record') IS NULL ALTER TABLE dbo.appointment_types ADD is_demo_record bit NOT NULL CONSTRAINT DF_appointment_types_is_demo_record DEFAULT (0);
END;
GO

IF OBJECT_ID(N'dbo.appointment_types', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.appointment_types SET data_source = N'seed', is_demo_record = 1;
END;
GO

IF OBJECT_ID(N'dbo.appointment_slots', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.appointment_slots SET data_source = N'seed', is_demo_record = 1;
END;
GO

/* ---------------------------------------------------------------------
   20260912080432_77cd64de-cff1-4691-9b77-0f8517bccd5e.sql
   service_units.appointment_enabled column; staff_availability_rules
   already present in sanadi_schema.sql. generate_availability_slots
   PL/pgSQL function is ported to
   Sanadi.Infrastructure.Rpc.CoreRpcHandlers.GenerateAvailabilitySlotsHandler.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.service_units', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.service_units', N'appointment_enabled') IS NULL
        ALTER TABLE dbo.service_units ADD appointment_enabled bit NOT NULL CONSTRAINT DF_service_units_appointment_enabled DEFAULT (0);
END;
GO

-- Separate batch: appointment_enabled must exist before it can be referenced below.
IF OBJECT_ID(N'dbo.service_units', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.service_units SET appointment_enabled = 1 WHERE code = N'CAREER';
END;
GO

/* ---------------------------------------------------------------------
   20260912083422_b195f8dd-7e54-4c3a-abb1-873503d33cec.sql
   appointment_requests already present in sanadi_schema.sql.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260912093201_4fb6ed13-080d-4a70-8f5d-3eb826942378.sql
   RLS policy scoping for agent_prompt_versions, profiles, and
   knowledge-files storage. Enforced by Sanadi.Api instead.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260912103845_ddb3a8db-05ab-41ae-865b-65b9130d2ffc.sql
   cases.structured_details already present in sanadi_schema.sql.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260912105006_f05fc001-e912-433a-9bdf-7f834e6e8428.sql
   Emergency/operations routing unit + can_access_case function (ported
   to Sanadi.Infrastructure.Auth.PermissionService.CanAccessCaseAsync).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.service_units', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'OES')
    BEGIN
        INSERT INTO dbo.service_units (code, name_en, name_ar, is_active, email, contact_email, phone_extension)
        VALUES (N'OES', N'Operations and Emergency Section', N'قسم العمليات والطوارئ', 1, N'OES@uaeu.ac.ae', N'OES@uaeu.ac.ae', N'6888');
    END;
END;
GO

/* ---------------------------------------------------------------------
   20260913123920_a8882849-7942-4bb4-a23a-f4ad13eb8f0a.sql
   New tables: learning_signals, learning_candidates, learned_routing_rules.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.learning_signals', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.learning_signals
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_learning_signals_id DEFAULT (NEWID()) PRIMARY KEY,
        created_at datetimeoffset NOT NULL CONSTRAINT DF_learning_signals_created_at DEFAULT (SYSDATETIMEOFFSET()),
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_learning_signals_updated_at DEFAULT (SYSDATETIMEOFFSET()),
        conversation_id uniqueidentifier NULL,
        message_id uniqueidentifier NULL,
        case_id uniqueidentifier NULL,
        student_id uniqueidentifier NULL,
        original_domain nvarchar(450) NULL,
        original_intent nvarchar(450) NULL,
        original_unit_id uniqueidentifier NULL,
        original_staff_id uniqueidentifier NULL,
        corrected_domain nvarchar(450) NULL,
        corrected_intent nvarchar(450) NULL,
        corrected_unit_id uniqueidentifier NULL,
        corrected_staff_id uniqueidentifier NULL,
        correction_type nvarchar(450) NOT NULL,
        correction_source nvarchar(450) NOT NULL,
        reason_code nvarchar(450) NULL,
        original_user_text nvarchar(max) NULL,
        relevant_context_summary nvarchar(max) NULL,
        staff_comment nvarchar(max) NULL,
        student_feedback nvarchar(max) NULL,
        outcome nvarchar(450) NULL,
        confidence decimal(4,3) NOT NULL CONSTRAINT DF_learning_signals_confidence DEFAULT (0.500),
        policy_sensitive bit NOT NULL CONSTRAINT DF_learning_signals_policy_sensitive DEFAULT (0),
        status nvarchar(450) NOT NULL CONSTRAINT DF_learning_signals_status DEFAULT (N'NEW'),
        candidate_id uniqueidentifier NULL,
        reviewed_by uniqueidentifier NULL,
        reviewed_at datetimeoffset NULL,
        CONSTRAINT learning_signals_correction_type_check CHECK (correction_type IN
            (N'INTENT_CORRECTION', N'DOMAIN_CORRECTION', N'ROUTING_CORRECTION', N'UNIT_REASSIGNMENT',
             N'STAFF_REASSIGNMENT', N'KNOWLEDGE_GAP', N'RESPONSE_QUALITY', N'WORKFLOW_FAILURE',
             N'FALSE_RESOLUTION', N'CASE_REOPEN', N'STUDENT_CLARIFICATION', N'OTHER')),
        CONSTRAINT learning_signals_correction_source_check CHECK (correction_source IN (N'STAFF', N'STUDENT', N'SYSTEM', N'ADMIN')),
        CONSTRAINT learning_signals_status_check CHECK (status IN (N'NEW', N'CLUSTERED', N'REVIEWED', N'DISMISSED')),
        CONSTRAINT FK_learning_signals_original_unit FOREIGN KEY (original_unit_id) REFERENCES dbo.service_units(id) ON DELETE NO ACTION,
        CONSTRAINT FK_learning_signals_corrected_unit FOREIGN KEY (corrected_unit_id) REFERENCES dbo.service_units(id) ON DELETE NO ACTION
    );
    CREATE INDEX idx_learning_signals_type_created ON dbo.learning_signals (correction_type, created_at DESC);
    CREATE INDEX idx_learning_signals_status ON dbo.learning_signals (status, created_at DESC);
    CREATE INDEX idx_learning_signals_case ON dbo.learning_signals (case_id);
    CREATE INDEX idx_learning_signals_candidate ON dbo.learning_signals (candidate_id);
END;
GO

IF OBJECT_ID(N'dbo.learning_candidates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.learning_candidates
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_learning_candidates_id DEFAULT (NEWID()) PRIMARY KEY,
        created_at datetimeoffset NOT NULL CONSTRAINT DF_learning_candidates_created_at DEFAULT (SYSDATETIMEOFFSET()),
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_learning_candidates_updated_at DEFAULT (SYSDATETIMEOFFSET()),
        candidate_type nvarchar(100) NOT NULL,
        pattern_key nvarchar(300) NOT NULL,
        title nvarchar(450) NOT NULL,
        description nvarchar(max) NOT NULL,
        pattern nvarchar(max) NOT NULL CONSTRAINT DF_learning_candidates_pattern DEFAULT (N'{}'),
        evidence_count int NOT NULL CONSTRAINT DF_learning_candidates_evidence_count DEFAULT (0),
        affected_domains nvarchar(max) NOT NULL CONSTRAINT DF_learning_candidates_affected_domains DEFAULT (N'[]'),
        affected_units nvarchar(max) NOT NULL CONSTRAINT DF_learning_candidates_affected_units DEFAULT (N'[]'),
        example_messages nvarchar(max) NOT NULL CONSTRAINT DF_learning_candidates_example_messages DEFAULT (N'[]'),
        proposed_change nvarchar(max) NOT NULL CONSTRAINT DF_learning_candidates_proposed_change DEFAULT (N'{}'),
        current_behaviour nvarchar(max) NULL,
        confidence decimal(4,3) NOT NULL CONSTRAINT DF_learning_candidates_confidence DEFAULT (0.500),
        risk_level nvarchar(450) NOT NULL CONSTRAINT DF_learning_candidates_risk_level DEFAULT (N'low'),
        status nvarchar(450) NOT NULL CONSTRAINT DF_learning_candidates_status DEFAULT (N'PROPOSED'),
        review_note nvarchar(max) NULL,
        approved_by uniqueidentifier NULL,
        approved_at datetimeoffset NULL,
        activated_at datetimeoffset NULL,
        baseline_metrics nvarchar(max) NULL,
        impact_metrics nvarchar(max) NULL,
        CONSTRAINT learning_candidates_candidate_type_check CHECK (candidate_type IN
            (N'ROUTING_RULE', N'INTENT_ALIAS', N'UNIT_ALIAS', N'KNOWLEDGE_GAP', N'CLARIFICATION_RULE',
             N'TOOL_SELECTION_RULE', N'PROMPT_IMPROVEMENT', N'WORKFLOW_IMPROVEMENT')),
        CONSTRAINT learning_candidates_risk_level_check CHECK (risk_level IN (N'low', N'medium', N'high')),
        CONSTRAINT learning_candidates_status_check CHECK (status IN (N'PROPOSED', N'APPROVED', N'REJECTED', N'DEFERRED', N'ACTIVE'))
    );
    CREATE UNIQUE INDEX idx_learning_candidates_pattern ON dbo.learning_candidates (candidate_type, pattern_key);
END;
GO

IF OBJECT_ID(N'dbo.learning_signals', N'U') IS NOT NULL AND OBJECT_ID(N'dbo.learning_candidates', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'learning_signals_candidate_fk')
BEGIN
    ALTER TABLE dbo.learning_signals
        ADD CONSTRAINT learning_signals_candidate_fk FOREIGN KEY (candidate_id) REFERENCES dbo.learning_candidates(id) ON DELETE SET NULL;
END;
GO

IF OBJECT_ID(N'dbo.learned_routing_rules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.learned_routing_rules
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_learned_routing_rules_id DEFAULT (NEWID()) PRIMARY KEY,
        created_at datetimeoffset NOT NULL CONSTRAINT DF_learned_routing_rules_created_at DEFAULT (SYSDATETIMEOFFSET()),
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_learned_routing_rules_updated_at DEFAULT (SYSDATETIMEOFFSET()),
        rule_name nvarchar(450) NOT NULL,
        trigger_context nvarchar(max) NULL,
        trigger_phrases nvarchar(max) NOT NULL CONSTRAINT DF_learned_routing_rules_trigger_phrases DEFAULT (N'[]'),
        pending_domain nvarchar(450) NULL,
        target_domain nvarchar(450) NULL,
        target_service nvarchar(450) NULL,
        target_unit_id uniqueidentifier NULL CONSTRAINT FK_learned_routing_rules_target_unit REFERENCES dbo.service_units(id) ON DELETE SET NULL,
        priority int NOT NULL CONSTRAINT DF_learned_routing_rules_priority DEFAULT (100),
        confidence decimal(4,3) NOT NULL CONSTRAINT DF_learned_routing_rules_confidence DEFAULT (0.800),
        approved_by uniqueidentifier NULL,
        effective_from datetimeoffset NOT NULL CONSTRAINT DF_learned_routing_rules_effective_from DEFAULT (SYSDATETIMEOFFSET()),
        active bit NOT NULL CONSTRAINT DF_learned_routing_rules_active DEFAULT (1),
        source_candidate_id uniqueidentifier NULL CONSTRAINT FK_learned_routing_rules_source_candidate REFERENCES dbo.learning_candidates(id) ON DELETE SET NULL,
        applied_count int NOT NULL CONSTRAINT DF_learned_routing_rules_applied_count DEFAULT (0)
    );
    CREATE INDEX idx_learned_routing_active ON dbo.learned_routing_rules (active, priority);
END;
GO

/* ---------------------------------------------------------------------
   20260913125825_e818603a-8886-447b-81f5-b5f9a76f8f14.sql
   learned_routing_rules: new columns/constraints; new tables
   learned_rule_decisions and learning_config.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.learned_routing_rules', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'description') IS NULL ALTER TABLE dbo.learned_routing_rules ADD description nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'rule_type') IS NULL ALTER TABLE dbo.learned_routing_rules ADD rule_type nvarchar(450) NOT NULL CONSTRAINT DF_learned_routing_rules_rule_type DEFAULT (N'ROUTING_RULE');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'trigger_patterns') IS NULL ALTER TABLE dbo.learned_routing_rules ADD trigger_patterns nvarchar(max) NOT NULL CONSTRAINT DF_learned_routing_rules_trigger_patterns DEFAULT (N'[]');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'required_context') IS NULL ALTER TABLE dbo.learned_routing_rules ADD required_context nvarchar(max) NOT NULL CONSTRAINT DF_learned_routing_rules_required_context DEFAULT (N'{}');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'excluded_context') IS NULL ALTER TABLE dbo.learned_routing_rules ADD excluded_context nvarchar(max) NOT NULL CONSTRAINT DF_learned_routing_rules_excluded_context DEFAULT (N'{}');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'source_language') IS NULL ALTER TABLE dbo.learned_routing_rules ADD source_language nvarchar(450) NOT NULL CONSTRAINT DF_learned_routing_rules_source_language DEFAULT (N'both');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'target_intent') IS NULL ALTER TABLE dbo.learned_routing_rules ADD target_intent nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'target_service_id') IS NULL ALTER TABLE dbo.learned_routing_rules ADD target_service_id uniqueidentifier NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'evidence_count') IS NULL ALTER TABLE dbo.learned_routing_rules ADD evidence_count int NOT NULL CONSTRAINT DF_learned_routing_rules_evidence_count DEFAULT (0);
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'historical_accuracy') IS NULL ALTER TABLE dbo.learned_routing_rules ADD historical_accuracy decimal(5,4) NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'shadow_accuracy') IS NULL ALTER TABLE dbo.learned_routing_rules ADD shadow_accuracy decimal(5,4) NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'shadow_samples') IS NULL ALTER TABLE dbo.learned_routing_rules ADD shadow_samples int NOT NULL CONSTRAINT DF_learned_routing_rules_shadow_samples DEFAULT (0);
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'risk_level') IS NULL ALTER TABLE dbo.learned_routing_rules ADD risk_level nvarchar(450) NOT NULL CONSTRAINT DF_learned_routing_rules_risk_level DEFAULT (N'low');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'status') IS NULL ALTER TABLE dbo.learned_routing_rules ADD status nvarchar(450) NOT NULL CONSTRAINT DF_learned_routing_rules_status DEFAULT (N'ACTIVE');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'activation_mode') IS NULL ALTER TABLE dbo.learned_routing_rules ADD activation_mode nvarchar(450) NOT NULL CONSTRAINT DF_learned_routing_rules_activation_mode DEFAULT (N'HUMAN_APPROVAL');
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'approved_at') IS NULL ALTER TABLE dbo.learned_routing_rules ADD approved_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'last_evaluated_at') IS NULL ALTER TABLE dbo.learned_routing_rules ADD last_evaluated_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'success_count') IS NULL ALTER TABLE dbo.learned_routing_rules ADD success_count int NOT NULL CONSTRAINT DF_learned_routing_rules_success_count DEFAULT (0);
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'failure_count') IS NULL ALTER TABLE dbo.learned_routing_rules ADD failure_count int NOT NULL CONSTRAINT DF_learned_routing_rules_failure_count DEFAULT (0);
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'rollback_reason') IS NULL ALTER TABLE dbo.learned_routing_rules ADD rollback_reason nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'paused_at') IS NULL ALTER TABLE dbo.learned_routing_rules ADD paused_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.learned_routing_rules', N'baseline_metrics') IS NULL ALTER TABLE dbo.learned_routing_rules ADD baseline_metrics nvarchar(max) NOT NULL CONSTRAINT DF_learned_routing_rules_baseline_metrics DEFAULT (N'{}');
END;
GO

-- Separate batch: the columns above must exist before they can be referenced below.
IF OBJECT_ID(N'dbo.learned_routing_rules', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'learned_routing_rules_status_check')
        ALTER TABLE dbo.learned_routing_rules DROP CONSTRAINT learned_routing_rules_status_check;
    ALTER TABLE dbo.learned_routing_rules ADD CONSTRAINT learned_routing_rules_status_check
        CHECK (status IN (N'PROPOSED', N'VALIDATING', N'SHADOW', N'VALIDATED', N'APPROVED', N'ACTIVE', N'PAUSED', N'REJECTED', N'ROLLED_BACK'));

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'learned_routing_rules_activation_mode_check')
        ALTER TABLE dbo.learned_routing_rules DROP CONSTRAINT learned_routing_rules_activation_mode_check;
    ALTER TABLE dbo.learned_routing_rules ADD CONSTRAINT learned_routing_rules_activation_mode_check
        CHECK (activation_mode IN (N'AUTO', N'HUMAN_APPROVAL'));

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'learned_routing_rules_risk_check')
        ALTER TABLE dbo.learned_routing_rules DROP CONSTRAINT learned_routing_rules_risk_check;
    ALTER TABLE dbo.learned_routing_rules ADD CONSTRAINT learned_routing_rules_risk_check
        CHECK (risk_level IN (N'low', N'medium', N'high'));
END;
GO

IF OBJECT_ID(N'dbo.learned_routing_rules', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.learned_routing_rules SET status = CASE WHEN active = 1 THEN N'ACTIVE' ELSE N'PAUSED' END
    WHERE status IS NULL OR status = N'';
END;
GO

IF OBJECT_ID(N'dbo.learned_routing_rules', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'learned_routing_rules_status_idx' AND object_id = OBJECT_ID(N'dbo.learned_routing_rules'))
BEGIN
    CREATE INDEX learned_routing_rules_status_idx ON dbo.learned_routing_rules (status, priority);
END;
GO

IF OBJECT_ID(N'dbo.learned_rule_decisions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.learned_rule_decisions
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_learned_rule_decisions_id DEFAULT (NEWID()) PRIMARY KEY,
        created_at datetimeoffset NOT NULL CONSTRAINT DF_learned_rule_decisions_created_at DEFAULT (SYSDATETIMEOFFSET()),
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_learned_rule_decisions_updated_at DEFAULT (SYSDATETIMEOFFSET()),
        rule_id uniqueidentifier NULL CONSTRAINT FK_learned_rule_decisions_rule REFERENCES dbo.learned_routing_rules(id) ON DELETE CASCADE,
        conversation_id uniqueidentifier NULL,
        case_id uniqueidentifier NULL,
        mode nvarchar(450) NOT NULL CONSTRAINT DF_learned_rule_decisions_mode DEFAULT (N'ACTIVE'),
        matched_phrase nvarchar(450) NULL,
        matched_context nvarchar(max) NOT NULL CONSTRAINT DF_learned_rule_decisions_matched_context DEFAULT (N'{}'),
        language nvarchar(450) NULL,
        previous_target nvarchar(450) NULL,
        selected_target nvarchar(450) NULL,
        shadow_prediction nvarchar(450) NULL,
        actual_target nvarchar(450) NULL,
        confidence decimal(4,3) NULL,
        evidence_count int NULL,
        activation_mode nvarchar(450) NULL,
        outcome nvarchar(450) NOT NULL CONSTRAINT DF_learned_rule_decisions_outcome DEFAULT (N'PENDING'),
        outcome_reason nvarchar(max) NULL,
        latency_ms int NULL
    );
    CREATE INDEX learned_rule_decisions_rule_idx ON dbo.learned_rule_decisions (rule_id, created_at DESC);
    CREATE INDEX learned_rule_decisions_conversation_idx ON dbo.learned_rule_decisions (conversation_id, created_at DESC);
END;
GO

IF OBJECT_ID(N'dbo.learning_config', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.learning_config
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_learning_config_id DEFAULT (NEWID()) PRIMARY KEY,
        is_singleton bit NOT NULL CONSTRAINT DF_learning_config_is_singleton DEFAULT (1),
        created_at datetimeoffset NOT NULL CONSTRAINT DF_learning_config_created_at DEFAULT (SYSDATETIMEOFFSET()),
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_learning_config_updated_at DEFAULT (SYSDATETIMEOFFSET()),
        threshold_low int NOT NULL CONSTRAINT DF_learning_config_threshold_low DEFAULT (3),
        threshold_normal int NOT NULL CONSTRAINT DF_learning_config_threshold_normal DEFAULT (5),
        threshold_high int NOT NULL CONSTRAINT DF_learning_config_threshold_high DEFAULT (10),
        min_historical_accuracy decimal(4,3) NOT NULL CONSTRAINT DF_learning_config_min_historical_accuracy DEFAULT (0.95),
        min_shadow_samples int NOT NULL CONSTRAINT DF_learning_config_min_shadow_samples DEFAULT (10),
        min_shadow_accuracy decimal(4,3) NOT NULL CONSTRAINT DF_learning_config_min_shadow_accuracy DEFAULT (0.90),
        auto_activation_enabled bit NOT NULL CONSTRAINT DF_learning_config_auto_activation_enabled DEFAULT (1),
        pause_confidence decimal(4,3) NOT NULL CONSTRAINT DF_learning_config_pause_confidence DEFAULT (0.55),
        pause_failure_streak int NOT NULL CONSTRAINT DF_learning_config_pause_failure_streak DEFAULT (3),
        updated_by uniqueidentifier NULL,
        CONSTRAINT learning_config_is_singleton_key UNIQUE (is_singleton)
    );
END;
GO

IF OBJECT_ID(N'dbo.learning_config', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.learning_config)
BEGIN
    INSERT INTO dbo.learning_config (is_singleton) VALUES (1);
END;
GO

/* ---------------------------------------------------------------------
   20260914092447_76eb102b-f98d-4605-be14-51908e79040c.sql
   ai_settings / model_routing_rules: new columns (idempotent; already
   applied by SANADIAPI/sql/ai_settings_gemini.sql and
   SANADIAPI/sql/2026-09-17-ai-provider-settings.sql).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.ai_settings', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.ai_settings', N'fallback_provider') IS NULL ALTER TABLE dbo.ai_settings ADD fallback_provider nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.ai_settings', N'fallback_model') IS NULL ALTER TABLE dbo.ai_settings ADD fallback_model nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.ai_settings', N'reasoning_effort') IS NULL ALTER TABLE dbo.ai_settings ADD reasoning_effort nvarchar(50) NOT NULL CONSTRAINT DF_ai_settings_reasoning_effort_2 DEFAULT (N'none');
END;
GO

IF OBJECT_ID(N'dbo.model_routing_rules', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.model_routing_rules', N'fallback_provider') IS NULL ALTER TABLE dbo.model_routing_rules ADD fallback_provider nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.model_routing_rules', N'reasoning_effort') IS NULL ALTER TABLE dbo.model_routing_rules ADD reasoning_effort nvarchar(450) NULL;
END;
GO

/* ---------------------------------------------------------------------
   20260915053313_461722cd-6e8c-486c-b0af-62b8ab158115.sql
   can_manage_knowledge / can_approve_knowledge / can_manage_integrations /
   can_monitor_all_units / can_monitor_cases PL/pgSQL helpers. Ported to
   Sanadi.Infrastructure.Auth.PermissionService and the corresponding
   usp_Can* stored procedures in sanadi_schema.sql.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260915053645_4dd9a20c-1b42-4c97-9148-20e7eb3e12b1.sql
   exception_events: trace_id column + indexes.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.exception_events', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.exception_events', N'trace_id') IS NULL ALTER TABLE dbo.exception_events ADD trace_id nvarchar(450) NULL;
END;
GO

IF OBJECT_ID(N'dbo.exception_events', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'exception_events_created_at_idx' AND object_id = OBJECT_ID(N'dbo.exception_events'))
BEGIN
    CREATE INDEX exception_events_created_at_idx ON dbo.exception_events (created_at DESC);
END;
GO

IF OBJECT_ID(N'dbo.exception_events', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'exception_events_trace_idx' AND object_id = OBJECT_ID(N'dbo.exception_events'))
BEGIN
    CREATE INDEX exception_events_trace_idx ON dbo.exception_events (trace_id);
END;
GO

/* ---------------------------------------------------------------------
   20260915172224_3fcc52c1-4873-410c-acd2-d51ebb480056.sql
   cases: meeting scheduling columns, constraint and index.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.cases', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.cases', N'meeting_at') IS NULL ALTER TABLE dbo.cases ADD meeting_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.cases', N'meeting_mode') IS NULL ALTER TABLE dbo.cases ADD meeting_mode nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.cases', N'meeting_location') IS NULL ALTER TABLE dbo.cases ADD meeting_location nvarchar(450) NULL;
    IF COL_LENGTH(N'dbo.cases', N'meeting_note') IS NULL ALTER TABLE dbo.cases ADD meeting_note nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.cases', N'meeting_set_by') IS NULL ALTER TABLE dbo.cases ADD meeting_set_by uniqueidentifier NULL;
    IF COL_LENGTH(N'dbo.cases', N'meeting_set_at') IS NULL ALTER TABLE dbo.cases ADD meeting_set_at datetimeoffset NULL;
END;
GO

-- Separate batch: meeting_mode must exist before the CHECK constraint can reference it.
IF OBJECT_ID(N'dbo.cases', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'cases_meeting_mode_check')
BEGIN
    ALTER TABLE dbo.cases ADD CONSTRAINT cases_meeting_mode_check
        CHECK (meeting_mode IS NULL OR meeting_mode IN (N'in_person', N'online', N'phone'));
END;
GO

IF OBJECT_ID(N'dbo.cases', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'cases_meeting_at_idx' AND object_id = OBJECT_ID(N'dbo.cases'))
BEGIN
    CREATE INDEX cases_meeting_at_idx ON dbo.cases (meeting_at) WHERE meeting_at IS NOT NULL;
END;
GO

/* ---------------------------------------------------------------------
   20260915175813_23c24143-9547-4603-9bb8-f0330d0a3936.sql
   New table: chat_action_completions.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.chat_action_completions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_action_completions
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_chat_action_completions_id DEFAULT (NEWID()) PRIMARY KEY,
        student_id uniqueidentifier NOT NULL,
        conversation_id uniqueidentifier NULL,
        message_id uniqueidentifier NULL,
        action_key nvarchar(450) NOT NULL,
        action_type nvarchar(450) NOT NULL,
        created_case_id uniqueidentifier NULL,
        reference_number nvarchar(450) NULL,
        result_message nvarchar(max) NULL,
        receipt nvarchar(max) NULL,
        idempotency_key nvarchar(450) NOT NULL,
        submitted_at datetimeoffset NOT NULL CONSTRAINT DF_chat_action_completions_submitted_at DEFAULT (SYSDATETIMEOFFSET()),
        created_at datetimeoffset NOT NULL CONSTRAINT DF_chat_action_completions_created_at DEFAULT (SYSDATETIMEOFFSET()),
        updated_at datetimeoffset NOT NULL CONSTRAINT DF_chat_action_completions_updated_at DEFAULT (SYSDATETIMEOFFSET())
    );
    CREATE UNIQUE INDEX chat_action_completions_key_idx ON dbo.chat_action_completions (idempotency_key);
    CREATE INDEX chat_action_completions_conv_idx ON dbo.chat_action_completions (student_id, conversation_id);
END;
GO

/* ---------------------------------------------------------------------
   20260915182734_fa0c9cdd-3061-4915-b2ee-a4cfe6421727.sql
   ALTER TABLE ... REPLICA IDENTITY FULL is a Postgres logical-replication
   setting with no SQL Server equivalent; not applicable here.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   20260915184544_beba6ece-2f7b-4409-a23b-4a5dd918634c.sql
   exception_events: resolution/test-scenario columns + index.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.exception_events', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.exception_events', N'resolved_at') IS NULL ALTER TABLE dbo.exception_events ADD resolved_at datetimeoffset NULL;
    IF COL_LENGTH(N'dbo.exception_events', N'student_message') IS NULL ALTER TABLE dbo.exception_events ADD student_message nvarchar(max) NULL;
    IF COL_LENGTH(N'dbo.exception_events', N'is_test') IS NULL ALTER TABLE dbo.exception_events ADD is_test bit NOT NULL CONSTRAINT DF_exception_events_is_test DEFAULT (0);
    IF COL_LENGTH(N'dbo.exception_events', N'scenario') IS NULL ALTER TABLE dbo.exception_events ADD scenario nvarchar(450) NULL;
END;
GO

IF OBJECT_ID(N'dbo.exception_events', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'exception_events_is_test_idx' AND object_id = OBJECT_ID(N'dbo.exception_events'))
BEGIN
    CREATE INDEX exception_events_is_test_idx ON dbo.exception_events (is_test, created_at DESC);
END;
GO

/* =====================================================================
   20260917130000_ai_provider_switch_settings.sql
   AI provider switching: is_enabled/api_key/api_url columns, filtered
   unique index, and disabled Ollama/OpenAI/Anthropic/alternate-Gemini
   rows. The existing enabled Gemini row is not modified.
   ===================================================================== */
IF COL_LENGTH(N'dbo.ai_settings', N'api_key') IS NULL
BEGIN
    ALTER TABLE dbo.ai_settings ADD api_key nvarchar(4000) NULL;
END;
GO

IF COL_LENGTH(N'dbo.ai_settings', N'api_url') IS NULL
BEGIN
    ALTER TABLE dbo.ai_settings ADD api_url nvarchar(1000) NULL;
END;
GO

IF COL_LENGTH(N'dbo.ai_settings', N'is_enabled') IS NULL
BEGIN
    ALTER TABLE dbo.ai_settings ADD is_enabled bit NOT NULL
        CONSTRAINT DF_ai_settings_is_enabled DEFAULT (1) WITH VALUES;
END;
GO

IF EXISTS
(
    SELECT 1 FROM sys.key_constraints
    WHERE name = N'ai_settings_is_singleton_key'
      AND parent_object_id = OBJECT_ID(N'dbo.ai_settings')
)
BEGIN
    ALTER TABLE dbo.ai_settings DROP CONSTRAINT ai_settings_is_singleton_key;
END;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_ai_settings_one_enabled'
      AND object_id = OBJECT_ID(N'dbo.ai_settings')
)
BEGIN
    CREATE UNIQUE INDEX UX_ai_settings_one_enabled
        ON dbo.ai_settings(is_enabled)
        WHERE is_enabled = 1;
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ai_settings WHERE provider = N'ollama' AND model_name = N'llama3.1')
BEGIN
    INSERT INTO dbo.ai_settings
    (
        is_singleton, is_enabled, provider, model_name, embedding_model,
        api_key, api_url, fallback_provider, fallback_model, reasoning_effort,
        temperature, max_output_tokens, confidence_threshold, handoff_threshold,
        retrieval_top_k, max_tool_calls, request_timeout_ms, daily_cost_limit_usd,
        agent_flags, ai_enabled, created_at, updated_at
    )
    VALUES
    (
        0, 0, N'ollama', N'llama3.1', N'',
        NULL, N'http://127.0.0.1:11434/v1', NULL, NULL, N'none',
        0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
        N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
        1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ai_settings WHERE provider = N'openai' AND model_name = N'gpt-4o-mini')
BEGIN
    INSERT INTO dbo.ai_settings
    (
        is_singleton, is_enabled, provider, model_name, embedding_model,
        api_key, api_url, fallback_provider, fallback_model, reasoning_effort,
        temperature, max_output_tokens, confidence_threshold, handoff_threshold,
        retrieval_top_k, max_tool_calls, request_timeout_ms, daily_cost_limit_usd,
        agent_flags, ai_enabled, created_at, updated_at
    )
    VALUES
    (
        0, 0, N'openai', N'gpt-4o-mini', N'openai/text-embedding-3-small',
        NULL, N'https://api.openai.com/v1', NULL, NULL, N'none',
        0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
        N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
        1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ai_settings WHERE provider = N'anthropic' AND model_name = N'claude-3-5-sonnet-latest')
BEGIN
    INSERT INTO dbo.ai_settings
    (
        is_singleton, is_enabled, provider, model_name, embedding_model,
        api_key, api_url, fallback_provider, fallback_model, reasoning_effort,
        temperature, max_output_tokens, confidence_threshold, handoff_threshold,
        retrieval_top_k, max_tool_calls, request_timeout_ms, daily_cost_limit_usd,
        agent_flags, ai_enabled, created_at, updated_at
    )
    VALUES
    (
        0, 0, N'anthropic', N'claude-3-5-sonnet-latest', N'',
        NULL, N'https://api.anthropic.com/v1', NULL, NULL, N'none',
        0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
        N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
        1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ai_settings WHERE provider = N'gemini' AND model_name = N'google/gemini-2.5-flash')
BEGIN
    INSERT INTO dbo.ai_settings
    (
        is_singleton, is_enabled, provider, model_name, embedding_model,
        api_key, api_url, fallback_provider, fallback_model, reasoning_effort,
        temperature, max_output_tokens, confidence_threshold, handoff_threshold,
        retrieval_top_k, max_tool_calls, request_timeout_ms, daily_cost_limit_usd,
        agent_flags, ai_enabled, created_at, updated_at
    )
    VALUES
    (
        0, 0, N'gemini', N'google/gemini-2.5-flash', N'google/gemini-embedding-001',
        NULL, N'https://generativelanguage.googleapis.com/v1beta', NULL, NULL, N'none',
        0.2, 1200, 0.55, 0.4, 6, 8, 45000, 25,
        N'{"alert":true,"query":true,"action":true,"complaint":true,"knowledge":true,"suggestion":true,"supervisor":true,"case_management":true}',
        1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
    );
END;
GO

-- Example switch (not executed): only one provider row may have is_enabled = 1.
-- UPDATE dbo.ai_settings SET is_enabled = CASE WHEN provider = N'ollama' THEN 1 ELSE 0 END, updated_at = SYSDATETIMEOFFSET();
-- UPDATE dbo.ai_settings SET api_key = N'<server-secret-only>' WHERE provider = N'ollama';

/* =====================================================================
   SEED DATA SECTION
   Converted from UAEU-SANAD-MAIN-2/supabase/seed/institution-reference.sql
   and UAEU-SANAD-MAIN-2/supabase/seed/rag-demo-corpus.sql (PostgreSQL)
   into idempotent T-SQL. Safe to re-run: every INSERT is guarded by a
   NOT EXISTS / WHERE NOT EXISTS check keyed on a natural key (code,
   name, title, etc.), matching the original Postgres seed semantics.
   ===================================================================== */

/* ---------------------------------------------------------------------
   institution-reference.sql
   --------------------------------------------------------------------- */

-- ---------- university & campuses ----------
INSERT INTO dbo.universities (name_en, name_ar, short_name, country, timezone)
SELECT N'United Arab Emirates University', N'جامعة الإمارات العربية المتحدة', N'UAEU', N'AE', N'Asia/Dubai'
WHERE NOT EXISTS (SELECT 1 FROM dbo.universities WHERE short_name = N'UAEU');
GO

INSERT INTO dbo.campuses (university_id, name_en, name_ar, location_en, location_ar)
SELECT u.id, v.en, v.ar, v.len, v.lar
FROM dbo.universities u
CROSS JOIN (VALUES
    (N'Al Maqam Campus', N'حرم المقام', N'Al Ain, Abu Dhabi', N'العين، أبوظبي'),
    (N'Al Jimi Campus', N'حرم الجيمي', N'Al Ain, Abu Dhabi', N'العين، أبوظبي')
) AS v(en, ar, len, lar)
WHERE u.short_name = N'UAEU'
  AND NOT EXISTS (SELECT 1 FROM dbo.campuses c WHERE c.name_en = v.en);
GO

-- ---------- colleges ----------
INSERT INTO dbo.colleges (university_id, campus_id, code, name_en, name_ar, contact_email)
SELECT u.id,
       (SELECT TOP 1 id FROM dbo.campuses WHERE name_en = N'Al Maqam Campus'),
       v.code, v.en, v.ar, v.email
FROM dbo.universities u
CROSS JOIN (VALUES
    (N'CIT',  N'College of Information Technology', N'كلية تقنية المعلومات', N'cit@uaeu.ac.ae'),
    (N'ENG',  N'College of Engineering', N'كلية الهندسة', N'eng@uaeu.ac.ae'),
    (N'BUS',  N'College of Business and Economics', N'كلية الأعمال والاقتصاد', N'cbe@uaeu.ac.ae'),
    (N'SCI',  N'College of Science', N'كلية العلوم', N'sci@uaeu.ac.ae'),
    (N'EDU',  N'College of Education', N'كلية التربية', N'edu@uaeu.ac.ae'),
    (N'HSS',  N'College of Humanities and Social Sciences', N'كلية العلوم الإنسانية والاجتماعية', N'hss@uaeu.ac.ae'),
    (N'LAW',  N'College of Law', N'كلية القانون', N'law@uaeu.ac.ae'),
    (N'MED',  N'College of Medicine and Health Sciences', N'كلية الطب والعلوم الصحية', N'cmhs@uaeu.ac.ae'),
    (N'AGRI', N'College of Agriculture and Veterinary Medicine', N'كلية الزراعة والطب البيطري', N'cavm@uaeu.ac.ae'),
    (N'GRAD', N'College of Graduate Studies', N'كلية الدراسات العليا', N'cgs@uaeu.ac.ae')
) AS v(code, en, ar, email)
WHERE u.short_name = N'UAEU'
  AND NOT EXISTS (SELECT 1 FROM dbo.colleges c WHERE c.code = v.code);
GO

-- Public-facing college facts used by the knowledge/facts tool.
-- Guarded on both code and name_en: university_colleges has a unique
-- constraint on name_en, so a pre-existing row with a matching name but a
-- different/blank code must also block the insert (Msg 2627 otherwise).
INSERT INTO dbo.university_colleges (code, name_en, name_ar, source_url, verified_at)
SELECT c.code, c.name_en, c.name_ar, N'https://www.uaeu.ac.ae/en/colleges.shtml', SYSDATETIMEOFFSET()
FROM dbo.colleges c
WHERE NOT EXISTS (SELECT 1 FROM dbo.university_colleges uc WHERE uc.code = c.code)
  AND NOT EXISTS (SELECT 1 FROM dbo.university_colleges uc WHERE uc.name_en = c.name_en);
GO

-- ---------- departments ----------
INSERT INTO dbo.departments (code, name_en, name_ar, college_id)
SELECT v.code, v.en, v.ar, (SELECT id FROM dbo.colleges WHERE code = v.college)
FROM (VALUES
    (N'CS',   N'Computer Science', N'علوم الحاسوب', N'CIT'),
    (N'IS',   N'Information Systems and Security', N'نظم المعلومات والأمن', N'CIT'),
    (N'DSAI', N'Data Science and Artificial Intelligence', N'علم البيانات والذكاء الاصطناعي', N'CIT'),
    (N'EE',   N'Electrical Engineering', N'الهندسة الكهربائية', N'ENG'),
    (N'ME',   N'Mechanical Engineering', N'الهندسة الميكانيكية', N'ENG'),
    (N'BUSA', N'Business Administration', N'إدارة الأعمال', N'BUS'),
    (N'MATH', N'Mathematical Sciences', N'العلوم الرياضية', N'SCI'),
    (N'BIO',  N'Biology', N'علم الأحياء', N'SCI'),
    (N'EDUC', N'Curriculum and Instruction', N'المناهج وطرق التدريس', N'EDU')
) AS v(code, en, ar, college)
WHERE NOT EXISTS (SELECT 1 FROM dbo.departments d WHERE d.code = v.code);
GO

IF EXISTS (SELECT 1 FROM dbo.departments WHERE code = N'GENED')
BEGIN
    UPDATE dbo.departments SET college_id = (SELECT id FROM dbo.colleges WHERE code = N'HSS')
    WHERE code = N'GENED' AND college_id IS NULL;
END;
GO

-- ---------- service units ----------
INSERT INTO dbo.service_units (code, name_en, name_ar, description_en, description_ar, contact_email, email, university_id, service_hours_en, service_hours_ar)
SELECT v.code, v.en, v.ar, v.den, v.dar, v.email, v.email,
       (SELECT id FROM dbo.universities WHERE short_name = N'UAEU'),
       N'Sunday to Thursday, 08:00-16:00', N'الأحد إلى الخميس، 08:00-16:00'
FROM (VALUES
    (N'SAS',    N'Student Academic Services', N'خدمات الطلبة الأكاديمية', N'Records, enrolment verification and official letters.', N'السجلات وإفادات القيد والرسائل الرسمية.', N'sas@uaeu.ac.ae'),
    (N'ADV',    N'Academic Advising', N'الإرشاد الأكاديمي', N'Study plans, graduation progress and advising appointments.', N'الخطط الدراسية ومتابعة التخرج ومواعيد الإرشاد.', N'advising@uaeu.ac.ae'),
    (N'CAREER', N'Career and Internship Services', N'خدمات المهن والتدريب', N'Internship placement, CV review and career counselling.', N'التدريب العملي ومراجعة السيرة الذاتية والإرشاد المهني.', N'careers@uaeu.ac.ae'),
    (N'ITS',    N'IT Support', N'الدعم التقني', N'Accounts, network access and campus systems support.', N'الحسابات والوصول للشبكة ودعم أنظمة الحرم الجامعي.', N'ithelp@uaeu.ac.ae'),
    (N'LIB',    N'Library Services', N'خدمات المكتبة', N'Borrowing, study spaces and research support.', N'الإعارة وقاعات الدراسة ودعم البحث.', N'library@uaeu.ac.ae'),
    (N'TRANS',  N'Transportation Services', N'خدمات النقل', N'Campus bus routes, schedules and transport requests.', N'خطوط الحافلات والجداول وطلبات النقل.', N'transport@uaeu.ac.ae'),
    (N'COMP',   N'Student Complaints Office', N'مكتب شكاوى الطلبة', N'General, escalated and sensitive student complaints.', N'الشكاوى العامة والمصعّدة والحساسة.', N'complaints@uaeu.ac.ae'),
    (N'ACCESS', N'Accessibility Support', N'الدعم لذوي الهمم', N'Accommodations and accessibility services for students.', N'التسهيلات وخدمات إمكانية الوصول للطلبة.', N'accessibility@uaeu.ac.ae'),
    (N'HAPPY',  N'Student Happiness and Engagement', N'سعادة الطلبة والمشاركة', N'Student experience, events and engagement programmes.', N'تجربة الطالب والفعاليات وبرامج المشاركة.', N'happiness@uaeu.ac.ae')
) AS v(code, en, ar, den, dar, email)
WHERE NOT EXISTS (SELECT 1 FROM dbo.service_units su WHERE su.code = v.code);
GO

UPDATE su
SET escalation_unit_id = (SELECT id FROM dbo.service_units WHERE code = N'COMP')
FROM dbo.service_units su
WHERE su.escalation_unit_id IS NULL AND su.code <> N'COMP';
GO

UPDATE su
SET university_id = COALESCE(su.university_id, (SELECT id FROM dbo.universities WHERE short_name = N'UAEU'))
FROM dbo.service_units su;
GO

-- ---------- university services ----------
INSERT INTO dbo.university_services
    (service_unit_id, code, name_en, name_ar, description_en, description_ar, category, target_audience,
     authentication_required, estimated_processing_days, service_level_hours, allows_online_submission,
     allows_agent_submission, requires_human_approval)
SELECT (SELECT id FROM dbo.service_units WHERE code = v.unit), v.code, v.en, v.ar, v.den, v.dar,
       v.category, N'students', 1, v.days, v.sla, 1, v.agent, v.approval
FROM (VALUES
    (N'REG',    N'SVC-ENROL-VERIFY',   N'Enrolment verification letter', N'إفادة قيد', N'Official proof of current enrolment.', N'إثبات رسمي للقيد الحالي.', N'documents', 1, 24, 1, 0),
    (N'SAS',    N'SVC-TRANSCRIPT',     N'Official transcript request', N'طلب كشف درجات رسمي', N'Request a sealed official transcript.', N'طلب كشف درجات رسمي مختوم.', N'documents', 3, 72, 1, 0),
    (N'ADV',    N'SVC-ADVISING-APPT',  N'Academic advising appointment', N'موعد إرشاد أكاديمي', N'Book a session with an academic advisor.', N'حجز جلسة مع مرشد أكاديمي.', N'appointments', 1, 48, 1, 0),
    (N'ADV',    N'SVC-TRANSFER-ICT',   N'Inter-college programme transfer', N'التحويل بين الكليات', N'Apply to transfer to another college programme.', N'التقديم للتحويل إلى برنامج في كلية أخرى.', N'academic', 10, 240, 1, 1),
    (N'CAREER', N'SVC-INTERNSHIP',     N'Internship placement request', N'طلب تدريب عملي', N'Apply for an internship placement.', N'التقديم على فرصة تدريب عملي.', N'career', 7, 168, 1, 1),
    (N'ITS',    N'SVC-IT-SUPPORT',     N'IT support request', N'طلب دعم تقني', N'Report an account, network or system issue.', N'الإبلاغ عن مشكلة في الحساب أو الشبكة أو النظام.', N'support', 2, 24, 1, 0),
    (N'LIB',    N'SVC-LIB-SUPPORT',    N'Library support request', N'طلب دعم المكتبة', N'Borrowing, study room and research help.', N'الإعارة وقاعات الدراسة ودعم البحث.', N'support', 2, 48, 1, 0),
    (N'TRANS',  N'SVC-TRANSPORT',      N'Transportation request', N'طلب خدمة النقل', N'Bus route, schedule and transport enquiries.', N'استفسارات خطوط الحافلات والجداول والنقل.', N'support', 3, 72, 1, 0),
    (N'FEES',   N'SVC-FEES',           N'Fees and payment support', N'دعم الرسوم والدفع', N'Payment plans, holds and invoice questions.', N'خطط السداد والإيقافات واستفسارات الفواتير.', N'finance', 3, 72, 1, 1),
    (N'ACCESS', N'SVC-ACCESSIBILITY',  N'Accessibility support request', N'طلب دعم إمكانية الوصول', N'Request accommodations and accessibility services.', N'طلب التسهيلات وخدمات إمكانية الوصول.', N'support', 5, 120, 1, 1),
    (N'COMP',   N'SVC-COMPLAINT',      N'Student complaint', N'شكوى طالب', N'Submit a formal complaint for review.', N'تقديم شكوى رسمية للمراجعة.', N'complaints', 5, 120, 1, 1)
) AS v(unit, code, en, ar, den, dar, category, days, sla, agent, approval)
WHERE NOT EXISTS (SELECT 1 FROM dbo.university_services s WHERE s.code = v.code);
GO

UPDATE s
SET service_unit_id = COALESCE(s.service_unit_id, (SELECT id FROM dbo.service_units WHERE code = N'SAS'))
FROM dbo.university_services s;
GO

-- ---------- academic terms ----------
INSERT INTO dbo.academic_terms
    (university_id, code, name_en, name_ar, start_date, end_date, registration_start, registration_end,
     add_drop_deadline, withdrawal_deadline, exam_start, exam_end, is_current)
SELECT (SELECT id FROM dbo.universities WHERE short_name = N'UAEU'),
       v.code, v.en, v.ar, v.sd, v.ed, v.rs, v.re, v.ad, v.wd, v.xs, v.xe, v.cur
FROM (VALUES
    (N'2025FA', N'Fall 2025', N'خريف 2025', '2025-08-24','2025-12-18','2025-07-06','2025-08-28','2025-09-04','2025-11-06','2025-12-08','2025-12-18', 0),
    (N'2026SP', N'Spring 2026', N'ربيع 2026', '2026-01-11','2026-05-14','2025-11-30','2026-01-15','2026-01-22','2026-04-02','2026-05-04','2026-05-14', 0),
    (N'2026SU', N'Summer 2026', N'صيف 2026', '2026-06-07','2026-08-06','2026-05-17','2026-06-11','2026-06-14','2026-07-09','2026-07-30','2026-08-06', 1),
    (N'2026FA', N'Fall 2026', N'خريف 2026', '2026-08-23','2026-12-17','2026-07-05','2026-08-27','2026-09-03','2026-11-05','2026-12-07','2026-12-17', 0)
) AS v(code, en, ar, sd, ed, rs, re, ad, wd, xs, xe, cur)
WHERE NOT EXISTS (SELECT 1 FROM dbo.academic_terms t WHERE t.code = v.code);
GO

-- ---------- academic programmes ----------
INSERT INTO dbo.academic_programs
    (college_id, department_id, code, name_en, name_ar, degree_level, total_credit_hours,
     minimum_gpa, internship_required, internship_minimum_credits, maximum_study_years)
SELECT (SELECT id FROM dbo.colleges WHERE code = v.college),
       (SELECT id FROM dbo.departments WHERE code = v.dept),
       v.code, v.en, v.ar, N'bachelor', v.credits, 2.00, v.intern, v.intern_min, 7
FROM (VALUES
    (N'BSCS',   N'CIT', N'CS',   N'BSc Computer Science', N'بكالوريوس علوم الحاسوب', 126, 1, 90),
    (N'BSDSAI', N'CIT', N'DSAI', N'BSc Data Science and Artificial Intelligence', N'بكالوريوس علم البيانات والذكاء الاصطناعي', 126, 1, 90),
    (N'BSIS',   N'CIT', N'IS',   N'BSc Information Systems and Security', N'بكالوريوس نظم المعلومات والأمن', 126, 1, 90),
    (N'BSEE',   N'ENG', N'EE',   N'BSc Electrical Engineering', N'بكالوريوس الهندسة الكهربائية', 137, 1, 95),
    (N'BSME',   N'ENG', N'ME',   N'BSc Mechanical Engineering', N'بكالوريوس الهندسة الميكانيكية', 137, 1, 95),
    (N'BBA',    N'BUS', N'BUSA', N'Bachelor of Business Administration', N'بكالوريوس إدارة الأعمال', 120, 1, 84),
    (N'BSMATH', N'SCI', N'MATH', N'BSc Mathematical Sciences', N'بكالوريوس العلوم الرياضية', 120, 0, 90),
    (N'BSBIO',  N'SCI', N'BIO',  N'BSc Biology', N'بكالوريوس علم الأحياء', 120, 0, 90),
    (N'BED',    N'EDU', N'EDUC', N'Bachelor of Education', N'بكالوريوس التربية', 126, 1, 90)
) AS v(code, college, dept, en, ar, credits, intern, intern_min)
WHERE NOT EXISTS (SELECT 1 FROM dbo.academic_programs p WHERE p.code = v.code);
GO

-- ---------- programme study plans (shared university requirements) ----------
INSERT INTO dbo.program_courses (program_id, course_id, requirement_type, recommended_year, recommended_semester, is_required)
SELECT p.id, c.id, N'university_requirement', 1, 1, 1
FROM dbo.academic_programs p
CROSS JOIN dbo.courses c
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.program_courses pc WHERE pc.program_id = p.id AND pc.course_id = c.id
);
GO

-- ---------- course sections for the current term ----------
INSERT INTO dbo.course_sections
    (course_id, academic_term_id, section_number, instructor_name, capacity, enrolled_count, meeting_schedule, room, status)
SELECT c.id, t.id, s.num, N'Demo Instructor', 30, 0,
       CASE s.num WHEN N'01' THEN N'Sun/Tue 09:00-10:15' ELSE N'Mon/Wed 11:00-12:15' END,
       N'Building F1 - ' + c.code, N'open'
FROM dbo.courses c
CROSS JOIN (SELECT TOP 1 id FROM dbo.academic_terms WHERE is_current = 1) t
CROSS JOIN (VALUES (N'01'), (N'02')) AS s(num)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.course_sections cs
    WHERE cs.course_id = c.id AND cs.academic_term_id = t.id AND cs.section_number = s.num
);
GO

-- ---------- transfer capacity ----------
INSERT INTO dbo.programme_transfer_capacity
    (programme_id, academic_term_id, total_transfer_seats, reserved_transfer_seats, assigned_transfer_seats, is_active, is_demo_record)
SELECT p.id, (SELECT TOP 1 id FROM dbo.academic_terms WHERE is_current = 1), 20, 0, 0, 1, 1
FROM dbo.academic_programs p
WHERE NOT EXISTS (SELECT 1 FROM dbo.programme_transfer_capacity tc WHERE tc.programme_id = p.id);
GO

-- ---------- appointments ----------
INSERT INTO dbo.appointment_types (service_unit_id, name_en, name_ar, duration_minutes, location_type, requires_approval)
SELECT (SELECT id FROM dbo.service_units WHERE code = v.unit), v.en, v.ar, v.mins, v.loc, 0
FROM (VALUES
    (N'ADV',    N'Academic advising session', N'جلسة إرشاد أكاديمي', 30, N'in_person'),
    (N'CAREER', N'Career counselling session', N'جلسة إرشاد مهني', 45, N'in_person'),
    (N'ACCESS', N'Accessibility needs review', N'مراجعة احتياجات إمكانية الوصول', 45, N'in_person')
) AS v(unit, en, ar, mins, loc)
WHERE NOT EXISTS (SELECT 1 FROM dbo.appointment_types a WHERE a.name_en = v.en);
GO

-- generate_series(1,10) day offsets x generate_series(9,13) hour offsets,
-- rewritten as numbered CTEs since T-SQL has no generate_series().
;WITH Days AS (
    SELECT TOP (10) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS d
    FROM sys.all_objects
),
Hours AS (
    SELECT TOP (5) 8 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS h
    FROM sys.all_objects
),
Slots AS (
    SELECT DATEADD(HOUR, h, DATEADD(DAY, d, CAST(CAST(SYSDATETIMEOFFSET() AS date) AS datetimeoffset))) AS slot_start
    FROM Days CROSS JOIN Hours
)
INSERT INTO dbo.appointment_slots (appointment_type_id, start_time, end_time, capacity, booked_count, status)
SELECT a.id,
       g.slot_start,
       DATEADD(MINUTE, a.duration_minutes, g.slot_start),
       1, 0, N'open'
FROM dbo.appointment_types a
CROSS JOIN Slots g
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.appointment_slots s2
    WHERE s2.appointment_type_id = a.id AND s2.start_time = g.slot_start
);
GO

/* ---------------------------------------------------------------------
   rag-demo-corpus.sql
   Demo/test knowledge base documents + chunks for RAG retrieval
   validation. Postgres used
     WITH ins AS (INSERT ... RETURNING id) INSERT INTO document_chunks ...
   which has no direct T-SQL equivalent; rewritten per document as:
     DECLARE @doc_id UNIQUEIDENTIFIER;
     IF NOT EXISTS (... same title ...) BEGIN
         INSERT INTO dbo.knowledge_documents (...) OUTPUT INSERTED.id INTO @ids VALUES (...);
         SET @doc_id = (SELECT TOP 1 id FROM @ids);
         INSERT INTO dbo.document_chunks (...) SELECT @doc_id, ... FROM (VALUES (...)) AS v(idx, content, section);
     END
   --------------------------------------------------------------------- */

-- 1. Undergraduate Course Registration Policy (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Undergraduate Course Registration Policy (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Undergraduate Course Registration Policy (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'policy', N'1.0', '2026-01-05', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'registration',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"registration"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'Registration for each semester opens in three waves: priority registration for graduating students, then by completed credit hours in descending order, then open registration for all undergraduates. Each wave lasts three working days.', N'Registration periods'),
        (1, N'A student in good academic standing may register for a maximum of 18 credit hours in a regular semester. Students on academic probation are limited to 12 credit hours until their cumulative GPA returns to 2.00 or above.', N'Credit load limits'),
        (2, N'A load above 18 credit hours, up to 21, requires written approval from the academic advisor and the college dean. Overload is granted only to students with a cumulative GPA of 3.30 or higher who are within two semesters of graduation.', N'Overload approval'),
        (3, N'Full-time undergraduate status requires at least 12 registered credit hours. Dropping below 12 credit hours affects scholarship eligibility, campus housing eligibility and student visa status where applicable.', N'Minimum load'),
        (4, N'Students may add or drop courses without academic or financial penalty during the first week of classes. Courses dropped in this period do not appear on the academic transcript.', N'Add and drop period'),
        (5, N'The registration system blocks any course whose prerequisites are not completed with the minimum required grade. Prerequisite waivers are issued only by the course-owning department and must be recorded before the add and drop period closes.', N'Prerequisites'),
        (6, N'Financial, library, disciplinary and advising holds block registration. Holds must be cleared by the unit that placed them; the Registration Department cannot remove a hold placed by another unit.', N'Registration holds'),
        (7, N'Two courses whose scheduled meeting times overlap by any amount cannot be registered together. Laboratory and lecture sections of the same course are treated as a single registration unit.', N'Time conflicts'),
        (8, N'A course in which a grade of D+ or lower was earned may be repeated twice. The highest grade is counted in the cumulative GPA, while all attempts remain visible on the transcript.', N'Repeating a course'),
        (9, N'The summer session allows a maximum of 9 credit hours. Courses with laboratory components may be excluded from the summer offering when contact hours cannot be met.', N'Summer registration'),
        (10, N'Late registration is permitted during the second week of classes with a late fee and advisor approval. No registration is accepted after the second week under any circumstance.', N'Late registration'),
        (11, N'A change of section within the same course is treated as an add and drop transaction and is subject to the same deadlines and seat availability rules.', N'Section changes')
    ) AS v(idx, content, section);
END;
GO

-- 2. دليل التسجيل للطلبة الجامعيين (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل التسجيل للطلبة الجامعيين (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل التسجيل للطلبة الجامعيين (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-01-05', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'registration',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"registration"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يفتح التسجيل على ثلاث مراحل: أولوية لطلبة التخرج، ثم حسب الساعات المكتسبة تنازلياً، ثم تسجيل مفتوح لجميع الطلبة. تستمر كل مرحلة ثلاثة أيام عمل.', N'فترات التسجيل'),
        (1, N'يحق للطالب المنتظم التسجيل بحد أقصى 18 ساعة معتمدة في الفصل الاعتيادي، بينما يقتصر الطالب المُنذَر أكاديمياً على 12 ساعة معتمدة حتى يرتفع معدله التراكمي إلى 2.00.', N'الحد الأعلى للساعات'),
        (2, N'يتطلب تجاوز 18 ساعة وحتى 21 ساعة موافقة المرشد الأكاديمي وعميد الكلية، ويُمنح للطلبة الحاصلين على معدل تراكمي 3.30 فأعلى والمتوقع تخرجهم خلال فصلين.', N'التسجيل الإضافي'),
        (3, N'يشترط تسجيل 12 ساعة معتمدة على الأقل لاعتبار الطالب منتظماً، ويؤثر النزول عن هذا الحد على المنح الدراسية والسكن الجامعي وحالة الإقامة الدراسية.', N'الحد الأدنى للتسجيل'),
        (4, N'يمكن حذف أو إضافة المقررات دون أثر أكاديمي أو مالي خلال الأسبوع الأول من الدراسة، ولا تظهر المقررات المحذوفة في هذه الفترة على كشف الدرجات.', N'فترة الحذف والإضافة'),
        (5, N'يمنع النظام تسجيل أي مقرر لم تُستوفَ متطلباته السابقة بالدرجة الدنيا المطلوبة، ولا يُقبل الاستثناء إلا من القسم صاحب المقرر قبل انتهاء فترة الحذف والإضافة.', N'المتطلبات السابقة'),
        (6, N'تمنع الحجوزات المالية وحجوزات المكتبة والحجوزات التأديبية والإرشادية إتمام التسجيل، ويجب رفعها من الجهة التي وضعتها وليس من قسم التسجيل.', N'حجب التسجيل'),
        (7, N'لا يمكن الجمع بين مقررين يتعارض وقتهما ولو جزئياً، وتُعامل المحاضرة والمختبر لنفس المقرر كوحدة تسجيل واحدة.', N'تعارض الأوقات'),
        (8, N'يجوز إعادة المقرر الذي حصل فيه الطالب على تقدير D+ أو أقل مرتين كحد أقصى، ويُحتسب أعلى تقدير في المعدل التراكمي مع بقاء جميع المحاولات في السجل.', N'إعادة المقرر'),
        (9, N'الحد الأعلى للفصل الصيفي 9 ساعات معتمدة، وقد تُستثنى المقررات ذات المختبرات عند تعذر استيفاء ساعات التواصل.', N'التسجيل الصيفي')
    ) AS v(idx, content, section);
END;
GO

-- 3. Course Withdrawal Policy (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Course Withdrawal Policy (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Course Withdrawal Policy (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'policy', N'1.0', '2026-01-10', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'withdrawal',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"withdrawal"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'A student may withdraw from an individual course from the second week of classes until the end of week ten of a regular semester. A grade of W is recorded and does not affect the cumulative GPA.', N'Standard withdrawal window'),
        (1, N'Withdrawal after week ten is considered a late withdrawal and requires documented exceptional circumstances such as prolonged illness, bereavement or an approved medical leave. Late withdrawal requests are reviewed by a college committee, not by the assistant.', N'Late withdrawal'),
        (2, N'A late withdrawal request must include a medical report from a licensed clinic, an official letter, or comparable documentary evidence covering the period in which attendance or assessment was affected.', N'Evidence for late withdrawal'),
        (3, N'A student may accumulate no more than four course withdrawals across the whole undergraduate degree. A fifth withdrawal is refused unless a college committee grants an exception.', N'Withdrawal limits'),
        (4, N'Withdrawal from all registered courses in one semester is a semester withdrawal. It requires advisor clearance, financial clearance and, for residents, notification to Student Housing Services.', N'Complete semester withdrawal'),
        (5, N'Withdrawals during the first two weeks are eligible for a tuition refund according to the published refund schedule. Withdrawals after week two carry no refund entitlement.', N'Financial effect'),
        (6, N'Withdrawn credit hours count as attempted hours for academic progress monitoring and may affect scholarship conditions that require a minimum number of earned credit hours per year.', N'Effect on academic standing'),
        (7, N'Students holding a study residence permit must maintain full-time status. A withdrawal that reduces the registered load below 12 credit hours requires prior clearance from Student Academic Services.', N'Effect on international students'),
        (8, N'An internship course may not be withdrawn after the placement has started without written agreement from Career and Internship Services and the host organisation.', N'Withdrawal from an internship course'),
        (9, N'A processed withdrawal may only be reversed during the same withdrawal window and only when the seat is still available in the same section.', N'Reversal of a withdrawal')
    ) AS v(idx, content, section);
END;
GO

-- 4. دليل الانسحاب من المقررات (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل الانسحاب من المقررات (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل الانسحاب من المقررات (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-01-10', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'withdrawal',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"withdrawal"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يجوز للطالب الانسحاب من مقرر منفرد اعتباراً من الأسبوع الثاني وحتى نهاية الأسبوع العاشر من الفصل الاعتيادي، ويُرصد تقدير W دون التأثير على المعدل التراكمي.', N'فترة الانسحاب المعتادة'),
        (1, N'يُعد الانسحاب بعد الأسبوع العاشر انسحاباً متأخراً ويستلزم ظروفاً استثنائية موثقة، وتتولى لجنة الكلية دراسته ولا يبتّ فيه المساعد الذكي.', N'الانسحاب المتأخر'),
        (2, N'يجب أن يرفق طلب الانسحاب المتأخر تقريراً طبياً من جهة مرخصة أو خطاباً رسمياً يغطي الفترة التي تأثر فيها الحضور أو التقييم.', N'المستندات المطلوبة'),
        (3, N'لا يزيد مجموع حالات الانسحاب عن أربعة مقررات طوال مرحلة البكالوريوس، ويُرفض الطلب الخامس ما لم توافق لجنة الكلية استثناءً.', N'حدود الانسحاب'),
        (4, N'يتطلب الانسحاب من جميع المقررات موافقة المرشد الأكاديمي والإخلاء المالي، وإشعار خدمات السكن الطلابي لقاطني السكن.', N'الانسحاب من الفصل بالكامل'),
        (5, N'يستحق الطالب استرداد الرسوم وفق الجدول المعلن عند الانسحاب خلال الأسبوعين الأولين، ولا يوجد استرداد بعد الأسبوع الثاني.', N'الأثر المالي'),
        (6, N'تُحتسب الساعات المنسحب منها ضمن الساعات المحاولة في متابعة التقدم الأكاديمي، وقد تؤثر على شروط المنح التي تشترط حداً أدنى من الساعات المكتسبة سنوياً.', N'الأثر على الوضع الأكاديمي'),
        (7, N'يجب على حاملي الإقامة الدراسية الحفاظ على وضع الانتظام، ويستلزم الانسحاب الذي يخفض العبء دون 12 ساعة موافقة مسبقة من خدمات الطلبة الأكاديمية.', N'طلبة الإقامة الدراسية')
    ) AS v(idx, content, section);
END;
GO

-- 5. Internship Eligibility and Placement Policy (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Internship Eligibility and Placement Policy (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Internship Eligibility and Placement Policy (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'policy', N'1.0', '2026-01-20', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'internship',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"internship"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'A student becomes eligible to register for the internship course after completing 80 credit hours of the degree plan. Registered but incomplete hours do not count towards the threshold.', N'Credit hour threshold'),
        (1, N'A minimum cumulative GPA of 2.00 is required to start an internship. Students below 2.00 are advised to raise their standing before applying, as host organisations may set higher requirements.', N'GPA requirement'),
        (2, N'The standard internship is 240 contact hours completed over eight to twelve weeks. Part-time placements are accepted when the total contact hours are met within one semester.', N'Duration'),
        (3, N'An active financial hold or an unresolved disciplinary case blocks internship placement. Government administration clearance is required before placement in a public-sector host organisation.', N'Holds and clearances'),
        (4, N'Placements are matched using the student''s programme, completed courses, declared skills and preferred emirate. Matching results are advisory; the final placement decision rests with the host organisation.', N'Placement matching'),
        (5, N'An internship application requires an up-to-date CV, a current academic transcript, a signed training agreement and, for some hosts, a passport or Emirates ID copy.', N'Application documents'),
        (6, N'Every placement has an academic supervisor from the college and a workplace supervisor from the host organisation. Both submit an evaluation at the end of the placement.', N'Supervision'),
        (7, N'More than three unexcused absence days during a placement may result in a failing internship grade. Absence for medical reasons must be reported to both supervisors within 48 hours.', N'Attendance and absence'),
        (8, N'The internship grade combines the workplace supervisor evaluation, the academic supervisor report and the final student reflective report, and is recorded as pass or fail.', N'Evaluation and grade'),
        (9, N'A placement may be changed only within the first two weeks and only when the host organisation confirms the release in writing.', N'Changing a placement'),
        (10, N'Summer placements follow the same eligibility rules but must complete the full contact hours before the start of the following semester.', N'Summer internships'),
        (11, N'Students on placement are covered by the university student insurance. Any workplace incident must be reported to Career and Internship Services on the same working day.', N'Insurance and safety')
    ) AS v(idx, content, section);
END;
GO

-- 6. دليل التدريب العملي (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل التدريب العملي (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل التدريب العملي (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-01-20', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'internship',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"internship"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يصبح الطالب مؤهلاً لتسجيل مقرر التدريب العملي بعد إتمام 80 ساعة معتمدة من الخطة الدراسية، ولا تُحتسب الساعات المسجلة غير المكتملة ضمن هذا الشرط.', N'شرط الساعات المعتمدة'),
        (1, N'يشترط معدل تراكمي لا يقل عن 2.00 لبدء التدريب، وقد تشترط بعض جهات التدريب معدلاً أعلى.', N'شرط المعدل التراكمي'),
        (2, N'المدة المعيارية 240 ساعة تدريبية تُنجز خلال ثمانية إلى اثني عشر أسبوعاً، ويُقبل التدريب الجزئي إذا اكتملت الساعات خلال الفصل نفسه.', N'مدة التدريب'),
        (3, N'يمنع الحجز المالي أو القضية التأديبية غير المنتهية إتمام التدريب، ويُشترط تصريح الإدارة الحكومية للتدريب في الجهات الحكومية.', N'الحجوزات والتصاريح'),
        (4, N'تُقترح فرص التدريب بناءً على البرنامج الأكاديمي والمقررات المنجزة والمهارات والإمارة المفضلة، ويبقى القرار النهائي لجهة التدريب.', N'مطابقة الفرص'),
        (5, N'يتطلب الطلب سيرة ذاتية محدثة وكشف درجات حديثاً واتفاقية تدريب موقعة، وقد تطلب بعض الجهات نسخة من الهوية الإماراتية أو جواز السفر.', N'مستندات الطلب'),
        (6, N'لكل تدريب مشرف أكاديمي من الكلية ومشرف ميداني من جهة التدريب، ويقدم كلاهما تقييماً في نهاية المدة.', N'الإشراف'),
        (7, N'قد يؤدي تجاوز ثلاثة أيام غياب دون عذر إلى رسوب الطالب في التدريب، ويجب إبلاغ المشرفين خلال 48 ساعة في حالات الغياب المرضي.', N'الحضور والغياب'),
        (8, N'تُحتسب درجة التدريب من تقييم المشرف الميداني وتقرير المشرف الأكاديمي والتقرير الختامي للطالب، وتُرصد نجاحاً أو رسوباً.', N'التقييم والدرجة'),
        (9, N'يشمل تأمين الطلبة المتدربين أثناء فترة التدريب، ويجب إبلاغ خدمات المهن والتدريب بأي حادث في نفس يوم العمل.', N'التأمين والسلامة')
    ) AS v(idx, content, section);
END;
GO

-- 7. Student Housing Allocation Policy (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Student Housing Allocation Policy (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Student Housing Allocation Policy (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'policy', N'1.0', '2026-02-10', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'housing',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'HOUS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'HOUS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"housing"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'On-campus housing is offered to full-time undergraduate students registered for at least 12 credit hours whose permanent address is outside Al Ain. Priority is given to first-year and final-year students.', N'Eligibility'),
        (1, N'Housing applications open eight weeks before the start of each semester and close two weeks before classes begin. Late applications are placed on the waiting list only.', N'Application window'),
        (2, N'Rooms are allocated by application date, academic level and documented accessibility or medical needs. Roommate preferences are honoured when both students request each other before the closing date.', N'Room allocation'),
        (3, N'A bed reservation is confirmed only after the housing fee deposit is recorded. Unconfirmed reservations expire after 72 hours and the bed returns to the available pool.', N'Bed reservation'),
        (4, N'Housing fees are charged per semester. A resident who checks out before the end of week four receives a fifty per cent refund; no refund is issued after week four.', N'Fees and refunds'),
        (5, N'Check-in requires an Emirates ID, a residence permit copy where applicable and a signed room condition report. Check-out requires a room inspection and the return of keys and access cards.', N'Check-in and check-out'),
        (6, N'Routine maintenance requests are resolved within three working days. Requests affecting safety, water supply, electricity or air conditioning are treated as urgent and resolved within 24 hours.', N'Maintenance requests'),
        (7, N'Visitors are permitted only in designated common areas during published visiting hours. Quiet hours are observed from 11 pm to 7 am daily and are extended during examination weeks.', N'Visitors and quiet hours'),
        (8, N'Cooking appliances, smoking and unauthorised room changes are prohibited. Repeated conduct violations may lead to the withdrawal of housing eligibility for the following semester.', N'Conduct in residence'),
        (9, N'Residence halls close during the winter and summer breaks except for approved stay-over requests submitted at least ten days in advance.', N'Vacation periods'),
        (10, N'Residents are eligible for the campus bus service. Bus schedules and any changes are published by Transportation Services in both Arabic and English.', N'Transport link'),
        (11, N'Accessible rooms are reserved for students registered with Accessibility Support Services and are allocated before general room assignment.', N'Accessibility accommodation')
    ) AS v(idx, content, section);
END;
GO

-- 8. دليل السكن الطلابي (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل السكن الطلابي (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل السكن الطلابي (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-02-10', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'housing',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'HOUS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'HOUS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"housing"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يُتاح السكن الجامعي للطلبة المنتظمين المسجلين 12 ساعة معتمدة على الأقل ممن تقع إقامتهم الدائمة خارج مدينة العين، مع أولوية لطلبة السنة الأولى وسنة التخرج.', N'شروط الأهلية'),
        (1, N'يفتح باب التقديم قبل ثمانية أسابيع من بداية الفصل ويغلق قبل أسبوعين من انطلاق الدراسة، وتوضع الطلبات المتأخرة على قائمة الانتظار.', N'فترة التقديم'),
        (2, N'تُوزع الغرف حسب تاريخ التقديم والمستوى الدراسي والاحتياجات الطبية الموثقة، وتُراعى رغبات الشريك في السكن عند تقديم الطرفين للطلب قبل موعد الإغلاق.', N'توزيع الغرف'),
        (3, N'لا يُعتمد حجز السرير إلا بعد تسجيل دفعة رسوم السكن، وتنتهي صلاحية الحجز غير المؤكد خلال 72 ساعة ليعود السرير إلى الأسرّة المتاحة.', N'حجز السرير'),
        (4, N'تُحتسب رسوم السكن لكل فصل دراسي، ويستحق المغادر قبل نهاية الأسبوع الرابع استرداد خمسين بالمئة، ولا استرداد بعد ذلك.', N'الرسوم والاسترداد'),
        (5, N'يتطلب الاستلام الهوية الإماراتية وتقرير حالة الغرفة موقعاً، ويتطلب الإخلاء معاينة الغرفة وتسليم المفاتيح وبطاقات الدخول.', N'الاستلام والإخلاء'),
        (6, N'تُنجز طلبات الصيانة الاعتيادية خلال ثلاثة أيام عمل، وتُعامل الأعطال المتعلقة بالسلامة أو الكهرباء أو التكييف كطلبات عاجلة تُنجز خلال 24 ساعة.', N'طلبات الصيانة'),
        (7, N'يُسمح باستقبال الزوار في الأماكن المخصصة ضمن الأوقات المعلنة، وتُطبق ساعات الهدوء من الحادية عشرة مساءً حتى السابعة صباحاً وتُمدد في فترة الامتحانات.', N'الزوار وساعات الهدوء')
    ) AS v(idx, content, section);
END;
GO

-- 9. Inter-College Transfer Policy (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Inter-College Transfer Policy (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Inter-College Transfer Policy (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'policy', N'1.0', '2026-01-18', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'transfer',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"transfer"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'An inter-college transfer request is accepted from students who have completed between 12 and 38 credit hours. Requests outside this window are refused because the receiving college cannot map the remaining plan.', N'Credit window'),
        (1, N'A cumulative GPA of 2.50 or above is required. Some colleges publish a higher programme-specific threshold, which overrides the university minimum.', N'GPA requirement'),
        (2, N'Transfer applications are accepted during the two weeks following the publication of final grades and before the start of the next registration wave.', N'Application timing'),
        (3, N'Every transfer is subject to a confirmed seat in the receiving programme. Seats are allocated in order of application once eligibility is verified, and a reserved seat expires if the student does not confirm within five working days.', N'Seat availability'),
        (4, N'The receiving college maps completed courses to the new degree plan. Courses that do not map become free elective credit or are excluded, which may extend the expected graduation date.', N'Course mapping'),
        (5, N'Before confirmation, the student receives an impact analysis showing mapped credit hours, lost credit hours and the revised expected graduation semester.', N'Graduation delay analysis'),
        (6, N'A student may complete only one inter-college transfer during the undergraduate degree. A second transfer requires an exception approved by the college dean.', N'One transfer rule'),
        (7, N'A transfer may change scholarship conditions where the award is tied to a specific programme. Student Accounts confirms the financial effect before the transfer is finalised.', N'Effect on scholarships'),
        (8, N'Course withdrawals recorded before the transfer remain on the transcript and continue to count towards the four-withdrawal limit.', N'Withdrawn courses on transfer'),
        (9, N'An approved transfer does not cancel a housing allocation, but it may change internship eligibility because the credit hour count is recalculated against the new degree plan.', N'Effect on housing and internship')
    ) AS v(idx, content, section);
END;
GO

-- 10. دليل التحويل بين الكليات (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل التحويل بين الكليات (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل التحويل بين الكليات (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-01-18', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'transfer',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"transfer"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يُقبل طلب التحويل بين الكليات من الطلبة الذين أنجزوا بين 12 و38 ساعة معتمدة، ويُرفض الطلب خارج هذا النطاق لتعذر مطابقة الخطة المتبقية.', N'نطاق الساعات'),
        (1, N'يشترط معدل تراكمي 2.50 فأعلى، وقد تعلن بعض الكليات حداً أعلى خاصاً بالبرنامج يُعمل به بدلاً من الحد الجامعي.', N'شرط المعدل'),
        (2, N'تُقبل طلبات التحويل خلال أسبوعين من إعلان النتائج النهائية وقبل بدء مرحلة التسجيل التالية.', N'موعد التقديم'),
        (3, N'يخضع كل تحويل لتوفر مقعد مؤكد في البرنامج المستقبِل، ويُحجز المقعد بترتيب الطلبات وينتهي الحجز إذا لم يؤكد الطالب خلال خمسة أيام عمل.', N'توفر المقاعد'),
        (4, N'تتولى الكلية المستقبِلة معادلة المقررات المنجزة مع الخطة الجديدة، وقد تتحول المقررات غير المطابقة إلى مواد اختيارية حرة أو تُستبعد مما قد يؤخر التخرج.', N'معادلة المقررات'),
        (5, N'يحصل الطالب قبل التأكيد على تحليل يوضح الساعات المعادَلة والساعات المفقودة وفصل التخرج المتوقع بعد التحويل.', N'تحليل أثر التخرج'),
        (6, N'يُسمح بتحويل واحد بين الكليات خلال مرحلة البكالوريوس، ويتطلب التحويل الثاني استثناءً من عميد الكلية.', N'مرة واحدة'),
        (7, N'قد يغير التحويل شروط المنحة المرتبطة ببرنامج محدد، ولا يلغي تخصيص السكن، وقد يعيد احتساب أهلية التدريب العملي وفق الخطة الجديدة.', N'الأثر على المنح والسكن')
    ) AS v(idx, content, section);
END;
GO

-- 11. Official Student Documents Procedure (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Official Student Documents Procedure (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Official Student Documents Procedure (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'procedure', N'1.0', '2026-02-01', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'documents',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"documents"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'Students may request an enrolment letter, a to whom it may concern letter, an unofficial transcript, a grade report and a graduation expectation letter through the digital services portal.', N'Available documents'),
        (1, N'Digitally generated letters are issued immediately. Documents requiring manual verification, such as sealed transcripts, take up to three working days.', N'Processing time'),
        (2, N'Every generated letter carries a QR code and a verification token. Any recipient can verify a letter without signing in, and verification shows the issue date and document status.', N'Verification'),
        (3, N'Generated documents remain downloadable for thirty days, after which the file is permanently deleted. A new copy can be generated at any time while the student is active.', N'Retention'),
        (4, N'Letters are available in Arabic and English. The Arabic version is generated right to left with the official Arabic name recorded in the student record.', N'Language'),
        (5, N'Names printed on official documents follow the passport or Emirates ID record. Corrections must be made in the student record before the document is generated.', N'Accuracy of personal data'),
        (6, N'Letters addressed to an embassy or a government entity must name the recipient entity. A generic letter may be refused by the receiving authority.', N'Documents for embassies'),
        (7, N'An active financial hold blocks sealed transcripts and graduation documents, but does not block a basic enrolment letter.', N'Documents with financial holds'),
        (8, N'Degree certificates and final sealed transcripts are issued by Student Academic Services after graduation clearance is complete and are collected in person or by an authorised representative.', N'Graduation documents'),
        (9, N'A replacement of a sealed document is issued on request with a replacement fee, and the earlier copy remains valid unless it was reported as compromised.', N'Lost documents')
    ) AS v(idx, content, section);
END;
GO

-- 12. دليل الوثائق الطلابية الرسمية (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل الوثائق الطلابية الرسمية (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل الوثائق الطلابية الرسمية (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-02-01', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'documents',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"documents"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يمكن للطالب طلب إفادة قيد وخطاب لمن يهمه الأمر وكشف درجات غير رسمي وتقرير درجات وإفادة توقع تخرج عبر بوابة الخدمات الرقمية.', N'الوثائق المتاحة'),
        (1, N'تُصدر الخطابات الرقمية فوراً، بينما تستغرق الوثائق التي تتطلب تدقيقاً يدوياً مثل كشف الدرجات المختوم حتى ثلاثة أيام عمل.', N'مدة الإنجاز'),
        (2, N'يحمل كل خطاب رمز استجابة سريعة ورمز تحقق، ويمكن لأي جهة التحقق من صحته دون تسجيل دخول مع بيان تاريخ الإصدار وحالة الوثيقة.', N'التحقق'),
        (3, N'تبقى الوثائق متاحة للتحميل ثلاثين يوماً ثم تُحذف نهائياً، ويمكن إصدار نسخة جديدة في أي وقت أثناء استمرار قيد الطالب.', N'مدة الاحتفاظ'),
        (4, N'تتوفر الخطابات بالعربية والإنجليزية، وتُصدر النسخة العربية بتنسيق من اليمين إلى اليسار بالاسم العربي الرسمي المسجل.', N'اللغة'),
        (5, N'يمنع الحجز المالي إصدار كشف الدرجات المختوم ووثائق التخرج، ولا يمنع إصدار إفادة القيد الأساسية.', N'الحجوزات المالية'),
        (6, N'يجب أن يتضمن الخطاب الموجه إلى سفارة أو جهة حكومية اسم الجهة المستقبِلة، وقد تُرفض الخطابات العامة.', N'وثائق السفارات'),
        (7, N'يمكن إصدار بدل فاقد للوثائق المختومة مقابل رسوم، وتبقى النسخة السابقة سارية ما لم يُبلَّغ عن فقدانها.', N'الوثائق المفقودة')
    ) AS v(idx, content, section);
END;
GO

-- 13. Library Services Guide (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Library Services Guide (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Library Services Guide (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'service_guide', N'1.0', '2026-02-15', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'library',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'LIB'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'LIB'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"library"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'Undergraduate students may borrow up to eight items at a time for fourteen days. Graduate students may borrow up to fifteen items for twenty-eight days.', N'Borrowing limits'),
        (1, N'An item may be renewed twice online if no other reader has placed a hold on it. A third renewal requires returning the item to the circulation desk.', N'Renewals'),
        (2, N'Overdue items generate a daily fine per item. A library hold is placed on the student record once fines exceed the published threshold, and the hold blocks registration.', N'Overdue items'),
        (3, N'The library catalogue search covers the physical collection, e-books and licensed databases, and shows availability such as available on shelf, on loan or online access.', N'Discovery search'),
        (4, N'Licensed databases are available off campus through the university single sign-on. Access is limited to current students and staff under the licence terms.', N'Off-campus access'),
        (5, N'Group study rooms are booked for up to three hours per day per student. A booking is released if the room is not occupied within fifteen minutes of the start time.', N'Study rooms'),
        (6, N'Items not held by the library can be requested through interlibrary loan, which typically takes seven to fourteen days depending on the supplying library.', N'Interlibrary loan'),
        (7, N'Librarians provide reference help for research questions, database selection and citation formatting in person, by email and through the assistant.', N'Reference help'),
        (8, N'The library supports APA, MLA, IEEE and Chicago styles, and the catalogue can export a formatted citation for any catalogue record.', N'Citation support'),
        (9, N'Rare and archival material is consulted in the reading room only and cannot be borrowed. Digitisation requests are reviewed by the collections team.', N'Special collections'),
        (10, N'The main library opens Monday to Thursday from 8 am to 10 pm and on Friday from 8 am to 12 pm. Hours are extended during examination periods.', N'Opening hours'),
        (11, N'All borrowed items must be returned and all fines cleared before graduation clearance is granted.', N'Library holds and graduation')
    ) AS v(idx, content, section);
END;
GO

-- 14. دليل خدمات المكتبة (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل خدمات المكتبة (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل خدمات المكتبة (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-02-15', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'library',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'LIB'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'LIB'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"library"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يمكن لطلبة البكالوريوس استعارة ثمانية أوعية لمدة أربعة عشر يوماً، ولطلبة الدراسات العليا استعارة خمسة عشر وعاءً لمدة ثمانية وعشرين يوماً.', N'حدود الاستعارة'),
        (1, N'يمكن تجديد الاستعارة مرتين إلكترونياً ما لم يحجزها قارئ آخر، ويتطلب التجديد الثالث إحضار الوعاء إلى مكتب الإعارة.', N'التجديد'),
        (2, N'تُحتسب غرامة يومية عن كل وعاء متأخر، ويُوضع حجز مكتبي على سجل الطالب عند تجاوز الحد المعلن مما يمنع التسجيل.', N'التأخير'),
        (3, N'يشمل البحث في فهرس المكتبة المجموعة الورقية والكتب الإلكترونية وقواعد البيانات المرخصة، ويوضح حالة التوفر مثل متاح على الرف أو معار أو متاح إلكترونياً.', N'البحث في الفهرس'),
        (4, N'تتاح قواعد البيانات المرخصة من خارج الحرم عبر الدخول الموحد، ويقتصر الوصول على الطلبة والموظفين الحاليين وفق شروط الترخيص.', N'الوصول من خارج الحرم'),
        (5, N'تُحجز قاعات الدراسة الجماعية لمدة ثلاث ساعات يومياً لكل طالب، ويُلغى الحجز إذا لم تُشغل القاعة خلال خمس عشرة دقيقة.', N'قاعات الدراسة'),
        (6, N'يمكن طلب الأوعية غير المتوفرة عبر الإعارة بين المكتبات، وتستغرق عادة من سبعة إلى أربعة عشر يوماً.', N'الإعارة بين المكتبات'),
        (7, N'يقدم أمناء المكتبة دعماً مرجعياً في أسئلة البحث واختيار قواعد البيانات وتنسيق الاستشهادات حضورياً وعبر البريد والمساعد الذكي.', N'الدعم المرجعي')
    ) AS v(idx, content, section);
END;
GO

-- 15. Career Counselling Service Guide (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Career Counselling Service Guide (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Career Counselling Service Guide (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'service_guide', N'1.0', '2026-02-05', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'career',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"career"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'Career and Internship Services offers CV review, interview preparation, career counselling appointments, skill gap analysis and employer connection events.', N'Service scope'),
        (1, N'An uploaded CV is analysed for structure, keyword coverage, measurable achievements and formatting compatibility with applicant tracking systems. The resulting score is advisory.', N'CV review'),
        (2, N'The applicant tracking score is deterministic and evidence based: it reports which sections, skills and keywords were found in the document rather than an opaque overall judgement.', N'ATS scoring'),
        (3, N'Skill gaps compare the skills evidenced in the student record and CV with the skills requested by target roles, and suggest courses, certificates or projects to close each gap.', N'Skill gap analysis'),
        (4, N'When no CV is uploaded, role matching uses the academic record only: programme, completed courses, projects and declared interests.', N'Academic mode matching'),
        (5, N'Counselling appointments are booked through the digital services portal. Each appointment lasts thirty minutes and can be rescheduled up to four hours before the start time.', N'Appointment booking'),
        (6, N'Career fairs and employer sessions are announced each semester. Registration closes when the venue capacity is reached.', N'Employer events'),
        (7, N'Uploaded CVs are scanned before processing. Files that fail the safety scan are rejected and are not stored.', N'Document safety'),
        (8, N'CV content is used only for the student''s own matching and counselling. It is never shared with an employer without the student''s explicit consent.', N'Privacy of CV data'),
        (9, N'A student may delete an uploaded CV at any time. Deletion removes the stored file permanently and clears derived matching results.', N'Deleting a CV')
    ) AS v(idx, content, section);
END;
GO

-- 16. دليل الإرشاد المهني (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل الإرشاد المهني (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل الإرشاد المهني (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-02-05', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'career',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'CAREER'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"career"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'تقدم خدمات المهن والتدريب مراجعة السيرة الذاتية والتحضير للمقابلات ومواعيد الإرشاد المهني وتحليل فجوات المهارات وفعاليات التواصل مع أصحاب العمل.', N'نطاق الخدمة'),
        (1, N'تُحلل السيرة الذاتية من حيث البنية وتغطية الكلمات المفتاحية والإنجازات القابلة للقياس والتوافق مع أنظمة تتبع المتقدمين، وتبقى النتيجة استرشادية.', N'مراجعة السيرة الذاتية'),
        (2, N'يُحتسب تقييم أنظمة التتبع بطريقة محددة ومبنية على الأدلة، ويوضح الأقسام والمهارات والكلمات المفتاحية التي عُثر عليها في الملف.', N'تقييم التوافق'),
        (3, N'يقارن التحليل المهارات الموثقة في السجل الأكاديمي والسيرة الذاتية بمتطلبات الوظائف المستهدفة ويقترح مقررات أو شهادات أو مشاريع لسد كل فجوة.', N'تحليل فجوات المهارات'),
        (4, N'عند عدم رفع سيرة ذاتية تعتمد المطابقة على السجل الأكاديمي فقط من برنامج ومقررات منجزة ومشاريع واهتمامات معلنة.', N'المطابقة الأكاديمية'),
        (5, N'تُحجز مواعيد الإرشاد عبر بوابة الخدمات الرقمية، ومدة الموعد ثلاثون دقيقة ويمكن تعديله قبل أربع ساعات من موعده.', N'حجز الموعد'),
        (6, N'تُستخدم بيانات السيرة الذاتية لمصلحة الطالب فقط، ولا تُشارك مع جهة توظيف دون موافقته الصريحة.', N'خصوصية البيانات'),
        (7, N'يمكن للطالب حذف سيرته الذاتية في أي وقت، ويؤدي الحذف إلى إزالة الملف نهائياً ومسح نتائج المطابقة المشتقة منه.', N'حذف السيرة الذاتية')
    ) AS v(idx, content, section);
END;
GO

-- 17. Student Complaints and Suggestions Procedure (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Student Complaints and Suggestions Procedure (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Student Complaints and Suggestions Procedure (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'procedure', N'1.0', '2026-03-01', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'complaints',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'COMP'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'COMP'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"complaints"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'The procedure covers complaints about services, facilities, administrative decisions and staff conduct, and suggestions for improving university services.', N'Scope'),
        (1, N'Students are encouraged to raise the issue with the responsible unit first. Many service issues are resolved informally within two working days.', N'Informal resolution'),
        (2, N'A formal complaint is recorded with a reference number, a responsible unit and a service level target. The student can track progress at any time.', N'Formal complaint'),
        (3, N'The first response target is two working days for standard complaints and four working hours for urgent complaints affecting safety, examinations or residence.', N'Service levels'),
        (4, N'A complaint that breaches its resolution target is escalated automatically to the unit manager, and a second breach is escalated to the service oversight level.', N'Escalation'),
        (5, N'A complaint may be submitted anonymously, but an anonymous case cannot receive a personal outcome notification and may be harder to investigate.', N'Anonymous reporting'),
        (6, N'Complaint details are visible only to the student, the assigned handlers in the responsible unit and oversight roles. Case content is never shared with unrelated units.', N'Confidentiality'),
        (7, N'A suggestion moves from submitted to under review, then to accepted, implemented or declined with a stated reason. The student is notified at each transition.', N'Suggestions lifecycle'),
        (8, N'A student who is not satisfied with the outcome may request a review within ten working days of the closure notification.', N'Appeals'),
        (9, N'Grade grievances follow the academic appeal route through the college and are not handled as service complaints.', N'Grievances about grades')
    ) AS v(idx, content, section);
END;
GO

-- 18. دليل الشكاوى والاقتراحات الطلابية (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل الشكاوى والاقتراحات الطلابية (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل الشكاوى والاقتراحات الطلابية (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-03-01', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'complaints',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'COMP'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'COMP'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"complaints"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'يشمل الإجراء الشكاوى المتعلقة بالخدمات والمرافق والقرارات الإدارية وسلوك الموظفين، والاقتراحات الرامية إلى تحسين الخدمات الجامعية.', N'النطاق'),
        (1, N'يُنصح الطالب بعرض المشكلة على الجهة المعنية أولاً، إذ تُحل كثير من الملاحظات الخدمية ودياً خلال يومي عمل.', N'الحل الودي'),
        (2, N'تُسجل الشكوى الرسمية برقم مرجعي وجهة مسؤولة ومدة استجابة محددة، ويمكن للطالب متابعة حالتها في أي وقت.', N'الشكوى الرسمية'),
        (3, N'مدة الاستجابة الأولى يوما عمل للشكاوى الاعتيادية وأربع ساعات عمل للشكاوى العاجلة المتعلقة بالسلامة أو الامتحانات أو السكن.', N'مستويات الخدمة'),
        (4, N'تُصعَّد الشكوى تلقائياً إلى مدير الوحدة عند تجاوز مدة الحل، ويؤدي التجاوز الثاني إلى التصعيد لمستوى الإشراف على الخدمة.', N'التصعيد'),
        (5, N'يمكن تقديم الشكوى دون ذكر الهوية، إلا أن ذلك يحول دون إشعار الطالب بالنتيجة وقد يصعّب التحقيق.', N'الإبلاغ دون هوية'),
        (6, N'تظهر تفاصيل الشكوى للطالب وللمعالجين المكلفين في الجهة المسؤولة ولأدوار الإشراف فقط، ولا تُشارك مع جهات غير معنية.', N'السرية'),
        (7, N'ينتقل الاقتراح من مُقدَّم إلى قيد الدراسة ثم إلى مقبول أو مُنفَّذ أو مرفوض مع بيان السبب، ويُشعر الطالب عند كل انتقال.', N'دورة حياة الاقتراح')
    ) AS v(idx, content, section);
END;
GO

-- 19. General Student Services Guide (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'General Student Services Guide (Demo Corpus)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'General Student Services Guide (Demo Corpus)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'service_guide', N'1.0', '2026-01-12', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'general',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"general"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'The student card is issued at Student Academic Services and is used for library borrowing, building access, campus buses and examination identification.', N'Student card'),
        (1, N'A financial hold is placed when an outstanding balance passes the published threshold. It blocks registration, sealed transcripts and graduation clearance until settled or a payment plan is approved.', N'Financial holds'),
        (2, N'Student Accounts may approve an instalment plan for an outstanding balance. An approved plan lifts the registration hold while instalments are paid on schedule.', N'Payment plans'),
        (3, N'Each student is assigned an academic advisor who approves the study plan each semester and supports course selection, overload requests and academic recovery plans.', N'Academic advising'),
        (4, N'A cumulative GPA below 2.00 places a student on probation. Probation requires an advising meeting, a reduced credit load and a documented recovery plan.', N'Academic probation'),
        (5, N'Graduation requires completion of the published degree plan credit hours, a cumulative GPA of at least 2.00, completion of the internship requirement where applicable and full clearance from all units.', N'Graduation requirements'),
        (6, N'Campus security operates twenty-four hours. Medical emergencies on campus are directed to the campus clinic, and off-campus emergencies to the national emergency number.', N'Emergency contacts'),
        (7, N'Students with a documented disability register with Accessibility Support Services to arrange examination accommodations, accessible housing and assistive technology.', N'Accessibility support'),
        (8, N'Password resets, university email problems, wireless access and portal errors are handled by Information Technology Support, with a first response target of one working day.', N'IT support'),
        (9, N'Campus and city bus routes serve residence halls, academic buildings and selected city stops. Route changes are announced at least three days in advance.', N'Transport'),
        (10, N'Confidential personal counselling is available by appointment. Counselling records are kept separate from the academic record.', N'Counselling and wellbeing'),
        (11, N'Students can rate any completed service interaction. Ratings feed the service quality dashboards reviewed by unit managers each month.', N'Feedback')
    ) AS v(idx, content, section);
END;
GO

-- 20. دليل الخدمات الطلابية العامة (ar)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'دليل الخدمات الطلابية العامة (محتوى تجريبي)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'دليل الخدمات الطلابية العامة (محتوى تجريبي)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'ar', N'guide', N'1.0', '2026-01-12', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'general',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"general"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'تُصدر البطاقة الجامعية من خدمات الطلبة الأكاديمية وتُستخدم للاستعارة من المكتبة ودخول المباني وحافلات الحرم والتعريف في الامتحانات.', N'البطاقة الجامعية'),
        (1, N'يُوضع الحجز المالي عند تجاوز الرصيد المستحق الحد المعلن، ويمنع التسجيل وإصدار كشف الدرجات المختوم وإخلاء التخرج حتى السداد أو اعتماد خطة تقسيط.', N'الحجوزات المالية'),
        (2, N'قد تعتمد إدارة حسابات الطلبة خطة تقسيط للرصيد المستحق، ويُرفع حجز التسجيل ما دام الطالب ملتزماً بمواعيد الأقساط.', N'خطط السداد'),
        (3, N'يُخصص لكل طالب مرشد أكاديمي يعتمد خطته الدراسية كل فصل ويدعمه في اختيار المقررات وطلبات العبء الإضافي وخطط التحسين الأكاديمي.', N'الإرشاد الأكاديمي'),
        (4, N'ينذر الطالب أكاديمياً عند انخفاض معدله التراكمي دون 2.00، ويستلزم ذلك لقاءً إرشادياً وتخفيض العبء الدراسي وخطة تحسين موثقة.', N'الإنذار الأكاديمي'),
        (5, N'يتطلب التخرج إنجاز ساعات الخطة الدراسية المعلنة ومعدل تراكمي لا يقل عن 2.00 واستيفاء متطلب التدريب العملي عند وجوده وإتمام الإخلاء من جميع الجهات.', N'متطلبات التخرج'),
        (6, N'يعمل أمن الحرم الجامعي على مدار الساعة، وتُوجَّه الحالات الطبية داخل الحرم إلى العيادة الجامعية والحالات خارجه إلى رقم الطوارئ الوطني.', N'الطوارئ'),
        (7, N'تتولى إدارة الدعم التقني إعادة تعيين كلمات المرور ومشكلات البريد الجامعي والشبكة اللاسلكية وأعطال البوابة، بمدة استجابة أولى يوم عمل واحد.', N'الدعم التقني')
    ) AS v(idx, content, section);
END;
GO

-- 21. College Withdrawal Practice Note (Demo Corpus - Conflict Test) (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'College Withdrawal Practice Note (Demo Corpus — Conflict Test)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'College Withdrawal Practice Note (Demo Corpus — Conflict Test)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'procedure', N'1.0', '2026-02-20', NULL,
        0, N'public', N'student_authenticated', 1, N'approved',
        1, N'official', N'students', N'withdrawal',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'SAS'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"withdrawal"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'Students may withdraw from a course up to the end of week twelve of a regular semester without exceptional circumstances documentation. A grade of W is recorded.', N'Late withdrawal deadline'),
        (1, N'Withdrawal requests submitted after week twelve are reviewed by the college committee within five working days.', N'Committee review')
    ) AS v(idx, content, section);
END;
GO

-- 22. Superseded Registration Load Policy 2019 (Demo Corpus - Expired Test) (en)
DECLARE @ids TABLE (id UNIQUEIDENTIFIER);
DECLARE @doc_id UNIQUEIDENTIFIER;
IF NOT EXISTS (SELECT 1 FROM dbo.knowledge_documents WHERE title = N'Superseded Registration Load Policy 2019 (Demo Corpus — Expired Test)')
BEGIN
    INSERT INTO dbo.knowledge_documents
        (title, description, language, document_type, version, effective_date, expiry_date,
         is_official, confidentiality, confidentiality_level, is_active, approval_status,
         is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
         notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
    OUTPUT INSERTED.id INTO @ids
    VALUES
    (
        N'Superseded Registration Load Policy 2019 (Demo Corpus — Expired Test)',
        N'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
        N'en', N'policy', N'1.0', '2019-09-01', '2025-08-31',
        0, N'public', N'student_authenticated', 1, N'approved',
        0, N'official', N'students', N'registration',
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        (SELECT TOP 1 id FROM dbo.service_units WHERE code = N'REG'),
        N'rag_demo_v1', N'completed', N'completed', N'completed', N'completed', N'indexed', N'passed'
    );
    SET @doc_id = (SELECT TOP 1 id FROM @ids);
    INSERT INTO dbo.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
    SELECT @doc_id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), N'Section ' + v.section,
           N'{"corpus":"rag_demo_v1","demo":true,"domain":"registration"}',
           IIF(LEN(v.content) / 4 > 20, LEN(v.content) / 4, 20), 1
    FROM (VALUES
        (0, N'The maximum registration load in a regular semester is 15 credit hours for all undergraduate students regardless of academic standing.', N'Credit load limits'),
        (1, N'No overload above 15 credit hours is permitted under any circumstance.', N'Overload')
    ) AS v(idx, content, section);
END;
GO

/* =====================================================================
   End of VivekTodaydate.sql
   ===================================================================== */
