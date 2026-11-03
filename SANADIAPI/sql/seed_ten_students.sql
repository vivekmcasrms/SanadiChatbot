-- Ten complete student records so enrolment letters can be issued.
-- Idempotent: safe to re-run. Does not change application code.

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRAN;

DECLARE @uni uniqueidentifier = (SELECT TOP 1 id FROM dbo.universities);
DECLARE @term uniqueidentifier = (SELECT TOP 1 id FROM dbo.academic_terms WHERE is_current = 1);
DECLARE @hash nvarchar(4000) = (SELECT encrypted_password FROM auth.users WHERE email = N'202102@uaeu.ac.ae');

IF @uni IS NULL THROW 50001, N'universities row is required', 1;
IF @term IS NULL THROW 50002, N'current academic_terms row is required', 1;
IF @hash IS NULL OR LTRIM(RTRIM(@hash)) = N'' THROW 50003, N'source password hash is missing', 1;

DECLARE @CIT uniqueidentifier = (SELECT id FROM dbo.colleges WHERE code = N'CIT');
DECLARE @ENG uniqueidentifier = (SELECT id FROM dbo.colleges WHERE code = N'ENG');
DECLARE @BUS uniqueidentifier = (SELECT id FROM dbo.colleges WHERE code = N'BUS');
DECLARE @SCI uniqueidentifier = (SELECT id FROM dbo.colleges WHERE code = N'SCI');
DECLARE @EDU uniqueidentifier = (SELECT id FROM dbo.colleges WHERE code = N'EDU');

DECLARE @CS uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'CS');
DECLARE @DSAI uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'DSAI');
DECLARE @IS uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'IS');
DECLARE @EE uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'EE');
DECLARE @ME uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'ME');
DECLARE @BUSA uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'BUSA');
DECLARE @MATH uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'MATH');
DECLARE @BIO uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'BIO');
DECLARE @EDUC uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'EDUC');

;MERGE dbo.academic_programs AS t
USING (VALUES
  (N'BSCS',   @CIT, @CS,   N'BSc Computer Science',                         N'بكالوريوس علوم الحاسوب',                         120),
  (N'BSDSAI', @CIT, @DSAI, N'BSc Data Science and Artificial Intelligence', N'بكالوريوس علوم البيانات والذكاء الاصطناعي',     126),
  (N'BSIS',   @CIT, @IS,   N'BSc Information Systems and Security',         N'بكالوريوس نظم المعلومات والأمن',                 120),
  (N'BSEE',   @ENG, @EE,   N'BSc Electrical Engineering',                   N'بكالوريوس الهندسة الكهربائية',                   132),
  (N'BBA',    @BUS, @BUSA, N'Bachelor of Business Administration',          N'بكالوريوس إدارة الأعمال',                        120),
  (N'BSMATH', @SCI, @MATH, N'BSc Mathematics',                              N'بكالوريوس الرياضيات',                            120),
  (N'BSBIO',  @SCI, @BIO,  N'BSc Biology',                                  N'بكالوريوس الأحياء',                              120),
  (N'BED',    @EDU, @EDUC, N'Bachelor of Education',                        N'بكالوريوس التربية',                              126),
  (N'BSME',   @ENG, @ME,   N'BSc Mechanical Engineering',                   N'بكالوريوس الهندسة الميكانيكية',                  132)
) AS s(code, college_id, department_id, name_en, name_ar, credits)
ON t.code = s.code
WHEN MATCHED THEN
  UPDATE SET
    college_id = s.college_id,
    department_id = s.department_id,
    name_en = s.name_en,
    name_ar = s.name_ar,
    degree_level = N'bachelor',
    total_credit_hours = s.credits,
    is_active = 1,
    updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (college_id, department_id, code, name_en, name_ar, degree_level, total_credit_hours, is_active)
  VALUES (s.college_id, s.department_id, s.code, s.name_en, s.name_ar, N'bachelor', s.credits, 1);

DECLARE @students TABLE (
  student_number nvarchar(20) NOT NULL,
  email nvarchar(320) NOT NULL,
  user_id uniqueidentifier NOT NULL,
  name_en nvarchar(200) NOT NULL,
  name_ar nvarchar(200) NOT NULL,
  program_code nvarchar(20) NOT NULL,
  level nvarchar(40) NOT NULL,
  year_of_study int NOT NULL,
  completed int NOT NULL,
  registered int NOT NULL,
  gpa numeric(3,2) NOT NULL,
  lang nvarchar(8) NOT NULL,
  standing nvarchar(40) NOT NULL,
  grad date NOT NULL
);

INSERT INTO @students VALUES
  (N'202101', N'202101@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020101', N'Hessa Al Falasi',     N'حصة الفلاسي',     N'BSCS',   N'senior',     4, 113,  9, 3.46, N'en', N'good_standing',    '2027-06-15'),
  (N'202102', N'202102@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020102', N'Rashid Al Nuaimi',    N'راشد النعيمي',    N'BSDSAI', N'junior',     3,  83, 12, 3.11, N'ar', N'good_standing',    '2028-06-15'),
  (N'202103', N'202103@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020103', N'Maitha Al Ketbi',     N'ميثاء الكتبي',    N'BSIS',   N'junior',     3,  71, 12, 2.94, N'en', N'good_standing',    '2028-06-15'),
  (N'202104', N'202104@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020104', N'Saif Al Shamsi',      N'سيف الشامسي',     N'BSEE',   N'sophomore',  2,  48,  0, 2.71, N'ar', N'good_standing',    '2029-06-15'),
  (N'202105', N'202105@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020105', N'Noor Al Suwaidi',     N'نور السويدي',     N'BBA',    N'sophomore',  2,  54, 15, 3.22, N'en', N'good_standing',    '2029-06-15'),
  (N'202106', N'202106@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020106', N'Alia Al Mazrouei',    N'عالية المزروعي',  N'BSMATH', N'sophomore',  2,  42,  9, 1.84, N'ar', N'academic_warning', '2029-06-15'),
  (N'202107', N'202107@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020107', N'Omar Al Hammadi',     N'عمر الحمادي',     N'BSBIO',  N'freshman',   1,  27, 15, 2.88, N'en', N'good_standing',    '2030-06-15'),
  (N'202108', N'202108@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020108', N'Salama Al Ali',       N'سلامة العلي',     N'BED',    N'junior',     3,  66, 12, 3.05, N'ar', N'good_standing',    '2028-06-15'),
  (N'202109', N'202109@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020109', N'Yousef Al Marzooqi',  N'يوسف المرزوقي',   N'BSCS',   N'junior',     3,  78, 12, 3.38, N'en', N'good_standing',    '2028-06-15'),
  (N'202110', N'202110@uaeu.ac.ae', 'A1B2C3D4-E5F6-7890-ABCD-000000020110', N'Khalifa Al Blooshi',  N'خليفة البلوشي',   N'BSME',   N'junior',     3,  69, 13, 2.65, N'ar', N'good_standing',    '2028-06-15');

;MERGE auth.users AS t
USING @students AS s
ON t.email = s.email
WHEN MATCHED THEN
  UPDATE SET
    email = s.email,
    encrypted_password = COALESCE(t.encrypted_password, @hash),
    updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (id, email, encrypted_password)
  VALUES (s.user_id, s.email, @hash);

-- Align student_profiles.user_id to the auth user actually stored for that email.
UPDATE s
SET user_id = u.id
FROM @students s
JOIN auth.users u ON u.email = s.email;

;MERGE dbo.profiles AS t
USING @students AS s
ON t.id = s.user_id
WHEN MATCHED THEN
  UPDATE SET
    full_name = s.name_en,
    email = s.email,
    preferred_language = s.lang,
    is_demo_account = 1,
    updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (id, full_name, email, preferred_language, is_demo_account)
  VALUES (s.user_id, s.name_en, s.email, s.lang, 1);

INSERT INTO dbo.user_roles (user_id, role)
SELECT s.user_id, N'student'
FROM @students s
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.user_roles r WHERE r.user_id = s.user_id AND r.role = N'student'
);

;MERGE dbo.student_profiles AS t
USING (
  SELECT
    s.user_id,
    s.student_number,
    s.name_ar,
    ap.id AS program_id,
    ap.college_id,
    ap.department_id,
    s.level,
    s.year_of_study,
    s.completed,
    s.registered,
    s.gpa,
    s.lang,
    s.standing,
    s.grad,
    ap.name_en AS program_name,
    c.name_en AS college_name
  FROM @students s
  JOIN dbo.academic_programs ap ON ap.code = s.program_code
  JOIN dbo.colleges c ON c.id = ap.college_id
) AS src
ON t.student_number = src.student_number
WHEN MATCHED THEN
  UPDATE SET
    student_number = src.student_number,
    preferred_name = src.name_ar,
    program_id = src.program_id,
    college_id = src.college_id,
    department_id = src.department_id,
    current_academic_term_id = @term,
    academic_level = src.level,
    year_of_study = src.year_of_study,
    completed_credit_hours = src.completed,
    registered_credit_hours = src.registered,
    cumulative_gpa = src.gpa,
    academic_standing = src.standing,
    expected_graduation_date = src.grad,
    preferred_language = src.lang,
    account_status = N'active',
    program = src.program_name,
    college = src.college_name,
    is_demo_record = 1,
    updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (
    user_id, student_number, preferred_name, program_id, college_id, department_id,
    current_academic_term_id, academic_level, year_of_study, completed_credit_hours,
    registered_credit_hours, cumulative_gpa, academic_standing, expected_graduation_date,
    preferred_language, account_status, program, college, is_demo_record
  )
  VALUES (
    src.user_id, src.student_number, src.name_ar, src.program_id, src.college_id, src.department_id,
    @term, src.level, src.year_of_study, src.completed,
    src.registered, src.gpa, src.standing, src.grad,
    src.lang, N'active', src.program_name, src.college_name, 1
  );

COMMIT;

SELECT
  p.email,
  sp.student_number,
  ap.code AS program_code,
  c.code AS college_code,
  t.code AS term_code,
  sp.account_status,
  CASE WHEN sp.program_id IS NULL THEN 'missing_program' ELSE 'ok' END AS program_link
FROM dbo.student_profiles sp
JOIN dbo.profiles p ON p.id = sp.user_id
JOIN dbo.academic_programs ap ON ap.id = sp.program_id
JOIN dbo.colleges c ON c.id = sp.college_id
JOIN dbo.academic_terms t ON t.id = sp.current_academic_term_id
WHERE sp.student_number BETWEEN N'202101' AND N'202110'
ORDER BY sp.student_number;
