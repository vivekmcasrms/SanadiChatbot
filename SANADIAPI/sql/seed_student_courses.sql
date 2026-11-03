-- Catalogue courses, current-term sections, registrations and completed
-- history so academic/career features have real records.
-- Idempotent: safe to re-run. Does not change application code.

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRAN;

DECLARE @term uniqueidentifier = (SELECT TOP 1 id FROM dbo.academic_terms WHERE is_current = 1);
IF @term IS NULL THROW 50001, N'A current academic term is required.', 1;

DECLARE @GENED uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'GENED');
DECLARE @CS    uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'CS');
DECLARE @DSAI  uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'DSAI');
DECLARE @IS    uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'IS');
DECLARE @EE    uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'EE');
DECLARE @ME    uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'ME');
DECLARE @MATH  uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'MATH');
DECLARE @BIO   uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'BIO');
DECLARE @EDUC  uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'EDUC');
DECLARE @BUSA  uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'BUSA');
DECLARE @FIN   uniqueidentifier = (SELECT id FROM dbo.departments WHERE code = N'FIN');

;MERGE dbo.courses AS t
USING (VALUES
  -- Specified GE registrations for 202102
  (N'ENGL310', N'Technical Writing',                    N'الكتابة التقنية',                         @GENED, 3, 300),
  (N'ETHC201', N'Professional Ethics',                   N'الأخلاقيات المهنية',                     @GENED, 3, 200),
  (N'HIST120', N'UAE Society and History',               N'المجتمع والتاريخ في دولة الإمارات',     @GENED, 3, 100),
  (N'PHYS101', N'Conceptual Physics',                    N'الفيزياء المفاهيمية',                    @GENED, 3, 100),
  -- Additional GE
  (N'ENGL101', N'Academic English',                      N'اللغة الإنجليزية الأكاديمية',           @GENED, 3, 100),
  (N'ARAB101', N'Arabic Language',                       N'اللغة العربية',                          @GENED, 3, 100),
  (N'ISLM101', N'Islamic Culture',                       N'الثقافة الإسلامية',                      @GENED, 3, 100),
  (N'MATH105', N'Calculus I',                            N'التفاضل والتكامل 1',                     @MATH,  3, 100),
  -- Computing / data
  (N'CS101',   N'Introduction to Programming',           N'مقدمة في البرمجة',                       @CS,    3, 100),
  (N'CS201',   N'Data Structures',                       N'هياكل البيانات',                         @CS,    3, 200),
  (N'CS301',   N'Software Engineering',                  N'هندسة البرمجيات',                        @CS,    3, 300),
  (N'CS220',   N'Machine Learning',                      N'تعلم الآلة',                             @CS,    3, 200),
  (N'DSAI210', N'Databases',                             N'قواعد البيانات',                         @DSAI,  3, 200),
  (N'DSAI301', N'Data Analysis',                         N'تحليل البيانات',                         @DSAI,  3, 300),
  (N'STAT201', N'Statistics',                            N'الإحصاء',                                @MATH,  3, 200),
  (N'MATH201', N'Linear Algebra',                        N'الجبر الخطي',                            @MATH,  3, 200),
  -- Information systems / security
  (N'IS201',   N'Information Security',                  N'أمن المعلومات',                          @IS,    3, 200),
  (N'IS210',   N'Computer Networks',                     N'شبكات الحاسوب',                          @IS,    3, 200),
  -- Engineering
  (N'EE101',   N'Circuit Design',                        N'تصميم الدوائر',                          @EE,    3, 100),
  (N'EE201',   N'Control Systems',                        N'أنظمة التحكم',                           @EE,    3, 200),
  (N'ME101',   N'Mechanics',                             N'الميكانيكا',                             @ME,    3, 100),
  (N'ME201',   N'Thermodynamics',                         N'الديناميكا الحرارية',                    @ME,    3, 200),
  -- Science / education / business
  (N'BIO101',  N'General Biology',                       N'علم الأحياء العام',                      @BIO,   3, 100),
  (N'BIO201',  N'General Chemistry',                     N'الكيمياء العامة',                        @BIO,   3, 200),
  (N'EDUC101', N'Teaching Methods',                      N'طرائق التدريس',                          @EDUC,  3, 100),
  (N'EDUC201', N'Educational Psychology',                N'علم النفس التربوي',                      @EDUC,  3, 200),
  (N'BUS101',  N'Principles of Management',              N'مبادئ الإدارة',                          @BUSA,  3, 100),
  (N'BUS201',  N'Marketing',                             N'التسويق',                                @BUSA,  3, 200),
  (N'ACCT101', N'Accounting',                            N'المحاسبة',                               @BUSA,  3, 100),
  (N'FIN201',  N'Finance',                               N'التمويل',                                @FIN,   3, 200)
) AS s(code, title_en, title_ar, department_id, credit_hours, course_level)
ON t.code = s.code
WHEN MATCHED THEN
  UPDATE SET
    title_en = s.title_en,
    title_ar = s.title_ar,
    department_id = s.department_id,
    credit_hours = s.credit_hours,
    course_level = s.course_level,
    is_active = 1,
    updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (department_id, code, title_en, title_ar, credit_hours, course_level, is_active)
  VALUES (s.department_id, s.code, s.title_en, s.title_ar, s.credit_hours, s.course_level, 1);

;MERGE dbo.course_sections AS t
USING (
  SELECT c.id AS course_id, @term AS academic_term_id, N'01' AS section_number
  FROM dbo.courses c
  WHERE c.code IN (
    N'ENGL310', N'ETHC201', N'HIST120', N'PHYS101', N'ENGL101', N'ARAB101', N'ISLM101', N'MATH105',
    N'CS101', N'CS201', N'CS301', N'CS220', N'DSAI210', N'DSAI301', N'STAT201', N'MATH201',
    N'IS201', N'IS210', N'EE101', N'EE201', N'ME101', N'ME201',
    N'BIO101', N'BIO201', N'EDUC101', N'EDUC201', N'BUS101', N'BUS201', N'ACCT101', N'FIN201'
  )
) AS s
ON t.course_id = s.course_id AND t.academic_term_id = s.academic_term_id AND t.section_number = s.section_number
WHEN MATCHED THEN
  UPDATE SET status = N'open', updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (course_id, academic_term_id, section_number, instructor_name, capacity, enrolled_count, meeting_schedule, room, status)
  VALUES (s.course_id, s.academic_term_id, s.section_number, N'Sanadi Faculty', 40, 0, N'Sun/Tue 10:00-11:15', N'C1-101', N'open');

DECLARE @prog TABLE (program_code nvarchar(20) NOT NULL, course_code nvarchar(20) NOT NULL, req nvarchar(40) NOT NULL);
INSERT INTO @prog VALUES
  (N'BSDSAI', N'ENGL310', N'university_requirement'),
  (N'BSDSAI', N'ETHC201', N'university_requirement'),
  (N'BSDSAI', N'HIST120', N'university_requirement'),
  (N'BSDSAI', N'PHYS101', N'university_requirement'),
  (N'BSDSAI', N'CS101',   N'major_required'),
  (N'BSDSAI', N'STAT201', N'major_required'),
  (N'BSDSAI', N'MATH201', N'major_required'),
  (N'BSDSAI', N'DSAI210', N'major_required'),
  (N'BSDSAI', N'DSAI301', N'major_required'),
  (N'BSDSAI', N'CS220',   N'major_required'),
  (N'BSCS',   N'ENGL310', N'university_requirement'),
  (N'BSCS',   N'ETHC201', N'university_requirement'),
  (N'BSCS',   N'CS101',   N'major_required'),
  (N'BSCS',   N'CS201',   N'major_required'),
  (N'BSCS',   N'CS301',   N'major_required'),
  (N'BSCS',   N'DSAI210', N'major_required'),
  (N'BSIS',   N'ENGL310', N'university_requirement'),
  (N'BSIS',   N'ETHC201', N'university_requirement'),
  (N'BSIS',   N'CS101',   N'major_required'),
  (N'BSIS',   N'IS201',   N'major_required'),
  (N'BSIS',   N'IS210',   N'major_required'),
  (N'BSIS',   N'DSAI210', N'major_required'),
  (N'BSEE',   N'ENGL310', N'university_requirement'),
  (N'BSEE',   N'PHYS101', N'university_requirement'),
  (N'BSEE',   N'EE101',   N'major_required'),
  (N'BSEE',   N'EE201',   N'major_required'),
  (N'BSEE',   N'MATH105', N'major_required'),
  (N'BSME',   N'ENGL310', N'university_requirement'),
  (N'BSME',   N'ETHC201', N'university_requirement'),
  (N'BSME',   N'ME101',   N'major_required'),
  (N'BSME',   N'ME201',   N'major_required'),
  (N'BSME',   N'PHYS101', N'major_required'),
  (N'BBA',    N'ENGL310', N'university_requirement'),
  (N'BBA',    N'ETHC201', N'university_requirement'),
  (N'BBA',    N'HIST120', N'university_requirement'),
  (N'BBA',    N'BUS101',  N'major_required'),
  (N'BBA',    N'BUS201',  N'major_required'),
  (N'BBA',    N'ACCT101', N'major_required'),
  (N'BBA',    N'FIN201',  N'major_required'),
  (N'BSMATH', N'ENGL310', N'university_requirement'),
  (N'BSMATH', N'MATH105', N'major_required'),
  (N'BSMATH', N'MATH201', N'major_required'),
  (N'BSMATH', N'STAT201', N'major_required'),
  (N'BSBIO',  N'ENGL310', N'university_requirement'),
  (N'BSBIO',  N'ETHC201', N'university_requirement'),
  (N'BSBIO',  N'HIST120', N'university_requirement'),
  (N'BSBIO',  N'BIO101',  N'major_required'),
  (N'BSBIO',  N'BIO201',  N'major_required'),
  (N'BED',    N'ENGL310', N'university_requirement'),
  (N'BED',    N'ETHC201', N'university_requirement'),
  (N'BED',    N'EDUC101', N'major_required'),
  (N'BED',    N'EDUC201', N'major_required'),
  (N'BED',    N'HIST120', N'university_requirement');

INSERT INTO dbo.program_courses (program_id, course_id, requirement_type, is_required)
SELECT ap.id, c.id, p.req, 1
FROM @prog p
JOIN dbo.academic_programs ap ON ap.code = p.program_code
JOIN dbo.courses c ON c.code = p.course_code
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.program_courses pc
  WHERE pc.program_id = ap.id AND pc.course_id = c.id
);

DECLARE @reg TABLE (email nvarchar(320) NOT NULL, course_code nvarchar(20) NOT NULL);
INSERT INTO @reg VALUES
  -- 202102: the four requested current registrations (12 credits)
  (N'202102@uaeu.ac.ae', N'ENGL310'),
  (N'202102@uaeu.ac.ae', N'ETHC201'),
  (N'202102@uaeu.ac.ae', N'HIST120'),
  (N'202102@uaeu.ac.ae', N'PHYS101'),
  -- Other students: current registrations matching their registered hours
  (N'202101@uaeu.ac.ae', N'ENGL310'),
  (N'202101@uaeu.ac.ae', N'CS201'),
  (N'202101@uaeu.ac.ae', N'CS301'),
  (N'202103@uaeu.ac.ae', N'ENGL310'),
  (N'202103@uaeu.ac.ae', N'ETHC201'),
  (N'202103@uaeu.ac.ae', N'IS201'),
  (N'202103@uaeu.ac.ae', N'IS210'),
  (N'202105@uaeu.ac.ae', N'ENGL310'),
  (N'202105@uaeu.ac.ae', N'ETHC201'),
  (N'202105@uaeu.ac.ae', N'HIST120'),
  (N'202105@uaeu.ac.ae', N'BUS201'),
  (N'202105@uaeu.ac.ae', N'ACCT101'),
  (N'202106@uaeu.ac.ae', N'ENGL310'),
  (N'202106@uaeu.ac.ae', N'MATH201'),
  (N'202106@uaeu.ac.ae', N'STAT201'),
  (N'202107@uaeu.ac.ae', N'ENGL310'),
  (N'202107@uaeu.ac.ae', N'ETHC201'),
  (N'202107@uaeu.ac.ae', N'HIST120'),
  (N'202107@uaeu.ac.ae', N'BIO101'),
  (N'202107@uaeu.ac.ae', N'BIO201'),
  (N'202108@uaeu.ac.ae', N'ENGL310'),
  (N'202108@uaeu.ac.ae', N'ETHC201'),
  (N'202108@uaeu.ac.ae', N'EDUC101'),
  (N'202108@uaeu.ac.ae', N'EDUC201'),
  (N'202109@uaeu.ac.ae', N'ENGL310'),
  (N'202109@uaeu.ac.ae', N'ETHC201'),
  (N'202109@uaeu.ac.ae', N'CS101'),
  (N'202109@uaeu.ac.ae', N'CS201'),
  (N'202110@uaeu.ac.ae', N'ENGL310'),
  (N'202110@uaeu.ac.ae', N'ETHC201'),
  (N'202110@uaeu.ac.ae', N'ME101'),
  (N'202110@uaeu.ac.ae', N'ME201');

INSERT INTO dbo.student_current_enrollments (student_id, course_section_id, enrollment_status, registration_date)
SELECT u.id, sec.id, N'registered', SYSDATETIMEOFFSET()
FROM @reg r
JOIN auth.users u ON u.email = r.email
JOIN dbo.courses c ON c.code = r.course_code
JOIN dbo.course_sections sec ON sec.course_id = c.id AND sec.academic_term_id = @term AND sec.section_number = N'01'
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.student_current_enrollments e
  WHERE e.student_id = u.id AND e.course_section_id = sec.id
);

UPDATE sec
SET enrolled_count = x.n, updated_at = SYSDATETIMEOFFSET()
FROM dbo.course_sections sec
JOIN (
  SELECT course_section_id, COUNT(*) AS n
  FROM dbo.student_current_enrollments
  WHERE enrollment_status = N'registered'
  GROUP BY course_section_id
) x ON x.course_section_id = sec.id;

-- Completed history (not the currently registered set) so career/academic
-- completed-course logic has evidence. Grades follow each student's GPA band.
DECLARE @hist TABLE (email nvarchar(320) NOT NULL, course_code nvarchar(20) NOT NULL);
INSERT INTO @hist VALUES
  (N'202102@uaeu.ac.ae', N'CS101'),
  (N'202102@uaeu.ac.ae', N'STAT201'),
  (N'202102@uaeu.ac.ae', N'MATH201'),
  (N'202102@uaeu.ac.ae', N'DSAI210'),
  (N'202102@uaeu.ac.ae', N'DSAI301'),
  (N'202102@uaeu.ac.ae', N'ENGL101'),
  (N'202102@uaeu.ac.ae', N'MATH105'),
  (N'202101@uaeu.ac.ae', N'CS101'),
  (N'202101@uaeu.ac.ae', N'DSAI210'),
  (N'202101@uaeu.ac.ae', N'STAT201'),
  (N'202101@uaeu.ac.ae', N'ENGL101'),
  (N'202101@uaeu.ac.ae', N'ETHC201'),
  (N'202103@uaeu.ac.ae', N'CS101'),
  (N'202103@uaeu.ac.ae', N'DSAI210'),
  (N'202103@uaeu.ac.ae', N'STAT201'),
  (N'202103@uaeu.ac.ae', N'ENGL101'),
  (N'202104@uaeu.ac.ae', N'EE101'),
  (N'202104@uaeu.ac.ae', N'MATH105'),
  (N'202104@uaeu.ac.ae', N'PHYS101'),
  (N'202104@uaeu.ac.ae', N'ENGL101'),
  (N'202105@uaeu.ac.ae', N'BUS101'),
  (N'202105@uaeu.ac.ae', N'FIN201'),
  (N'202105@uaeu.ac.ae', N'ENGL101'),
  (N'202105@uaeu.ac.ae', N'STAT201'),
  (N'202106@uaeu.ac.ae', N'MATH105'),
  (N'202106@uaeu.ac.ae', N'ENGL101'),
  (N'202106@uaeu.ac.ae', N'PHYS101'),
  (N'202107@uaeu.ac.ae', N'ENGL101'),
  (N'202107@uaeu.ac.ae', N'MATH105'),
  (N'202107@uaeu.ac.ae', N'PHYS101'),
  (N'202108@uaeu.ac.ae', N'ENGL101'),
  (N'202108@uaeu.ac.ae', N'HIST120'),
  (N'202108@uaeu.ac.ae', N'ARAB101'),
  (N'202109@uaeu.ac.ae', N'DSAI210'),
  (N'202109@uaeu.ac.ae', N'STAT201'),
  (N'202109@uaeu.ac.ae', N'CS301'),
  (N'202109@uaeu.ac.ae', N'ENGL101'),
  (N'202110@uaeu.ac.ae', N'PHYS101'),
  (N'202110@uaeu.ac.ae', N'MATH105'),
  (N'202110@uaeu.ac.ae', N'ENGL101');

INSERT INTO dbo.student_course_history (
  student_id, course_id, academic_term_id, grade, grade_points,
  credits_attempted, credits_earned, completion_status
)
SELECT
  u.id,
  c.id,
  @term,
  CASE
    WHEN sp.cumulative_gpa >= 3.4 THEN N'A-'
    WHEN sp.cumulative_gpa >= 3.0 THEN N'B'
    WHEN sp.cumulative_gpa >= 2.5 THEN N'C+'
    ELSE N'C'
  END,
  CASE
    WHEN sp.cumulative_gpa >= 3.4 THEN 3.70
    WHEN sp.cumulative_gpa >= 3.0 THEN 3.00
    WHEN sp.cumulative_gpa >= 2.5 THEN 2.30
    ELSE 2.00
  END,
  c.credit_hours,
  c.credit_hours,
  N'completed'
FROM @hist h
JOIN auth.users u ON u.email = h.email
JOIN dbo.student_profiles sp ON sp.user_id = u.id
JOIN dbo.courses c ON c.code = h.course_code
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.student_course_history x
  WHERE x.student_id = u.id AND x.course_id = c.id
)
AND NOT EXISTS (
  SELECT 1
  FROM dbo.student_current_enrollments e
  JOIN dbo.course_sections sec ON sec.id = e.course_section_id
  WHERE e.student_id = u.id AND sec.course_id = c.id AND e.enrollment_status = N'registered'
);

COMMIT;

SELECT
  (SELECT COUNT(*) FROM dbo.courses) AS courses,
  (SELECT COUNT(*) FROM dbo.course_sections) AS sections,
  (SELECT COUNT(*) FROM dbo.student_current_enrollments) AS enrollments,
  (SELECT COUNT(*) FROM dbo.student_course_history) AS history;

SELECT u.email, c.code, c.title_en
FROM dbo.student_current_enrollments e
JOIN auth.users u ON u.id = e.student_id
JOIN dbo.course_sections sec ON sec.id = e.course_section_id
JOIN dbo.courses c ON c.id = sec.course_id
WHERE u.email = N'202102@uaeu.ac.ae'
ORDER BY c.code;
