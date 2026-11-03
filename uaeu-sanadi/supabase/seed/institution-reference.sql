-- Institutional reference data for the Sanadi demo/pilot environment.
-- Idempotent: safe to re-run. Provides the university, colleges, departments,
-- service units, services, programmes, terms, sections and appointment
-- capacity that the demo environment seeding and the agent tools depend on.

-- ---------- university & campuses ----------
INSERT INTO public.universities (name_en, name_ar, short_name, country, timezone)
SELECT 'United Arab Emirates University', 'جامعة الإمارات العربية المتحدة', 'UAEU', 'AE', 'Asia/Dubai'
WHERE NOT EXISTS (SELECT 1 FROM public.universities WHERE short_name = 'UAEU');

INSERT INTO public.campuses (university_id, name_en, name_ar, location_en, location_ar)
SELECT u.id, v.en, v.ar, v.len, v.lar
FROM public.universities u
CROSS JOIN (VALUES
  ('Al Maqam Campus', 'حرم المقام', 'Al Ain, Abu Dhabi', 'العين، أبوظبي'),
  ('Al Jimi Campus', 'حرم الجيمي', 'Al Ain, Abu Dhabi', 'العين، أبوظبي')
) AS v(en, ar, len, lar)
WHERE u.short_name = 'UAEU'
  AND NOT EXISTS (SELECT 1 FROM public.campuses c WHERE c.name_en = v.en);

-- ---------- colleges ----------
INSERT INTO public.colleges (university_id, campus_id, code, name_en, name_ar, contact_email)
SELECT u.id,
       (SELECT id FROM public.campuses WHERE name_en = 'Al Maqam Campus' LIMIT 1),
       v.code, v.en, v.ar, v.email
FROM public.universities u
CROSS JOIN (VALUES
  ('CIT',  'College of Information Technology', 'كلية تقنية المعلومات', 'cit@uaeu.ac.ae'),
  ('ENG',  'College of Engineering', 'كلية الهندسة', 'eng@uaeu.ac.ae'),
  ('BUS',  'College of Business and Economics', 'كلية الأعمال والاقتصاد', 'cbe@uaeu.ac.ae'),
  ('SCI',  'College of Science', 'كلية العلوم', 'sci@uaeu.ac.ae'),
  ('EDU',  'College of Education', 'كلية التربية', 'edu@uaeu.ac.ae'),
  ('HSS',  'College of Humanities and Social Sciences', 'كلية العلوم الإنسانية والاجتماعية', 'hss@uaeu.ac.ae'),
  ('LAW',  'College of Law', 'كلية القانون', 'law@uaeu.ac.ae'),
  ('MED',  'College of Medicine and Health Sciences', 'كلية الطب والعلوم الصحية', 'cmhs@uaeu.ac.ae'),
  ('AGRI', 'College of Agriculture and Veterinary Medicine', 'كلية الزراعة والطب البيطري', 'cavm@uaeu.ac.ae'),
  ('GRAD', 'College of Graduate Studies', 'كلية الدراسات العليا', 'cgs@uaeu.ac.ae')
) AS v(code, en, ar, email)
WHERE u.short_name = 'UAEU'
  AND NOT EXISTS (SELECT 1 FROM public.colleges c WHERE c.code = v.code);

-- Public-facing college facts used by the knowledge/facts tool.
INSERT INTO public.university_colleges (code, name_en, name_ar, source_url, verified_at)
SELECT c.code, c.name_en, c.name_ar, 'https://www.uaeu.ac.ae/en/colleges.shtml', now()
FROM public.colleges c
WHERE NOT EXISTS (SELECT 1 FROM public.university_colleges uc WHERE uc.code = c.code);

-- ---------- departments ----------
INSERT INTO public.departments (code, name_en, name_ar, college_id)
SELECT v.code, v.en, v.ar, (SELECT id FROM public.colleges WHERE code = v.college)
FROM (VALUES
  ('CS',   'Computer Science', 'علوم الحاسوب', 'CIT'),
  ('IS',   'Information Systems and Security', 'نظم المعلومات والأمن', 'CIT'),
  ('DSAI', 'Data Science and Artificial Intelligence', 'علم البيانات والذكاء الاصطناعي', 'CIT'),
  ('EE',   'Electrical Engineering', 'الهندسة الكهربائية', 'ENG'),
  ('ME',   'Mechanical Engineering', 'الهندسة الميكانيكية', 'ENG'),
  ('BUSA', 'Business Administration', 'إدارة الأعمال', 'BUS'),
  ('MATH', 'Mathematical Sciences', 'العلوم الرياضية', 'SCI'),
  ('BIO',  'Biology', 'علم الأحياء', 'SCI'),
  ('EDUC', 'Curriculum and Instruction', 'المناهج وطرق التدريس', 'EDU')
) AS v(code, en, ar, college)
WHERE NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.code = v.code);

UPDATE public.departments SET college_id = (SELECT id FROM public.colleges WHERE code = 'HSS')
WHERE code = 'GENED' AND college_id IS NULL;

-- ---------- service units ----------
INSERT INTO public.service_units (code, name_en, name_ar, description_en, description_ar, contact_email, email, university_id, service_hours_en, service_hours_ar)
SELECT v.code, v.en, v.ar, v.den, v.dar, v.email, v.email,
       (SELECT id FROM public.universities WHERE short_name = 'UAEU'),
       'Sunday to Thursday, 08:00-16:00', 'الأحد إلى الخميس، 08:00-16:00'
FROM (VALUES
  ('SAS',    'Student Academic Services', 'خدمات الطلبة الأكاديمية', 'Records, enrolment verification and official letters.', 'السجلات وإفادات القيد والرسائل الرسمية.', 'sas@uaeu.ac.ae'),
  ('ADV',    'Academic Advising', 'الإرشاد الأكاديمي', 'Study plans, graduation progress and advising appointments.', 'الخطط الدراسية ومتابعة التخرج ومواعيد الإرشاد.', 'advising@uaeu.ac.ae'),
  ('CAREER', 'Career and Internship Services', 'خدمات المهن والتدريب', 'Internship placement, CV review and career counselling.', 'التدريب العملي ومراجعة السيرة الذاتية والإرشاد المهني.', 'careers@uaeu.ac.ae'),
  ('ITS',    'IT Support', 'الدعم التقني', 'Accounts, network access and campus systems support.', 'الحسابات والوصول للشبكة ودعم أنظمة الحرم الجامعي.', 'ithelp@uaeu.ac.ae'),
  ('LIB',    'Library Services', 'خدمات المكتبة', 'Borrowing, study spaces and research support.', 'الإعارة وقاعات الدراسة ودعم البحث.', 'library@uaeu.ac.ae'),
  ('TRANS',  'Transportation Services', 'خدمات النقل', 'Campus bus routes, schedules and transport requests.', 'خطوط الحافلات والجداول وطلبات النقل.', 'transport@uaeu.ac.ae'),
  ('COMP',   'Student Complaints Office', 'مكتب شكاوى الطلبة', 'General, escalated and sensitive student complaints.', 'الشكاوى العامة والمصعّدة والحساسة.', 'complaints@uaeu.ac.ae'),
  ('ACCESS', 'Accessibility Support', 'الدعم لذوي الهمم', 'Accommodations and accessibility services for students.', 'التسهيلات وخدمات إمكانية الوصول للطلبة.', 'accessibility@uaeu.ac.ae'),
  ('HAPPY',  'Student Happiness and Engagement', 'سعادة الطلبة والمشاركة', 'Student experience, events and engagement programmes.', 'تجربة الطالب والفعاليات وبرامج المشاركة.', 'happiness@uaeu.ac.ae')
) AS v(code, en, ar, den, dar, email)
WHERE NOT EXISTS (SELECT 1 FROM public.service_units su WHERE su.code = v.code);

UPDATE public.service_units su
SET escalation_unit_id = (SELECT id FROM public.service_units WHERE code = 'COMP')
WHERE su.escalation_unit_id IS NULL AND su.code <> 'COMP';

UPDATE public.service_units su
SET university_id = COALESCE(su.university_id, (SELECT id FROM public.universities WHERE short_name = 'UAEU'));

-- ---------- university services ----------
INSERT INTO public.university_services
  (service_unit_id, code, name_en, name_ar, description_en, description_ar, category, target_audience,
   authentication_required, estimated_processing_days, service_level_hours, allows_online_submission,
   allows_agent_submission, requires_human_approval)
SELECT (SELECT id FROM public.service_units WHERE code = v.unit), v.code, v.en, v.ar, v.den, v.dar,
       v.category, 'students', true, v.days, v.sla, true, v.agent, v.approval
FROM (VALUES
  ('REG',    'SVC-ENROL-VERIFY',   'Enrolment verification letter', 'إفادة قيد', 'Official proof of current enrolment.', 'إثبات رسمي للقيد الحالي.', 'documents', 1, 24, true, false),
  ('SAS',    'SVC-TRANSCRIPT',     'Official transcript request', 'طلب كشف درجات رسمي', 'Request a sealed official transcript.', 'طلب كشف درجات رسمي مختوم.', 'documents', 3, 72, true, false),
  ('ADV',    'SVC-ADVISING-APPT',  'Academic advising appointment', 'موعد إرشاد أكاديمي', 'Book a session with an academic advisor.', 'حجز جلسة مع مرشد أكاديمي.', 'appointments', 1, 48, true, false),
  ('ADV',    'SVC-TRANSFER-ICT',   'Inter-college programme transfer', 'التحويل بين الكليات', 'Apply to transfer to another college programme.', 'التقديم للتحويل إلى برنامج في كلية أخرى.', 'academic', 10, 240, true, true),
  ('CAREER', 'SVC-INTERNSHIP',     'Internship placement request', 'طلب تدريب عملي', 'Apply for an internship placement.', 'التقديم على فرصة تدريب عملي.', 'career', 7, 168, true, true),
  ('ITS',    'SVC-IT-SUPPORT',     'IT support request', 'طلب دعم تقني', 'Report an account, network or system issue.', 'الإبلاغ عن مشكلة في الحساب أو الشبكة أو النظام.', 'support', 2, 24, true, false),
  ('LIB',    'SVC-LIB-SUPPORT',    'Library support request', 'طلب دعم المكتبة', 'Borrowing, study room and research help.', 'الإعارة وقاعات الدراسة ودعم البحث.', 'support', 2, 48, true, false),
  ('TRANS',  'SVC-TRANSPORT',      'Transportation request', 'طلب خدمة النقل', 'Bus route, schedule and transport enquiries.', 'استفسارات خطوط الحافلات والجداول والنقل.', 'support', 3, 72, true, false),
  ('FEES',   'SVC-FEES',           'Fees and payment support', 'دعم الرسوم والدفع', 'Payment plans, holds and invoice questions.', 'خطط السداد والإيقافات واستفسارات الفواتير.', 'finance', 3, 72, true, true),
  ('ACCESS', 'SVC-ACCESSIBILITY',  'Accessibility support request', 'طلب دعم إمكانية الوصول', 'Request accommodations and accessibility services.', 'طلب التسهيلات وخدمات إمكانية الوصول.', 'support', 5, 120, true, true),
  ('COMP',   'SVC-COMPLAINT',      'Student complaint', 'شكوى طالب', 'Submit a formal complaint for review.', 'تقديم شكوى رسمية للمراجعة.', 'complaints', 5, 120, true, true)
) AS v(unit, code, en, ar, den, dar, category, days, sla, agent, approval)
WHERE NOT EXISTS (SELECT 1 FROM public.university_services s WHERE s.code = v.code);

UPDATE public.university_services s
SET service_unit_id = COALESCE(s.service_unit_id, (SELECT id FROM public.service_units WHERE code = 'SAS'));

-- ---------- academic terms ----------
INSERT INTO public.academic_terms
  (university_id, code, name_en, name_ar, start_date, end_date, registration_start, registration_end,
   add_drop_deadline, withdrawal_deadline, exam_start, exam_end, is_current)
SELECT (SELECT id FROM public.universities WHERE short_name = 'UAEU'),
       v.code, v.en, v.ar, v.sd::date, v.ed::date, v.rs::date, v.re::date, v.ad::date, v.wd::date, v.xs::date, v.xe::date, v.cur
FROM (VALUES
  ('2025FA', 'Fall 2025', 'خريف 2025', '2025-08-24', '2025-12-18', '2025-07-06', '2025-08-28', '2025-09-04', '2025-11-06', '2025-12-08', '2025-12-18', false),
  ('2026SP', 'Spring 2026', 'ربيع 2026', '2026-01-11', '2026-05-14', '2025-11-30', '2026-01-15', '2026-01-22', '2026-04-02', '2026-05-04', '2026-05-14', false),
  ('2026SU', 'Summer 2026', 'صيف 2026', '2026-06-07', '2026-08-06', '2026-05-17', '2026-06-11', '2026-06-14', '2026-07-09', '2026-07-30', '2026-08-06', true),
  ('2026FA', 'Fall 2026', 'خريف 2026', '2026-08-23', '2026-12-17', '2026-07-05', '2026-08-27', '2026-09-03', '2026-11-05', '2026-12-07', '2026-12-17', false)
) AS v(code, en, ar, sd, ed, rs, re, ad, wd, xs, xe, cur)
WHERE NOT EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.code = v.code);

-- ---------- academic programmes ----------
INSERT INTO public.academic_programs
  (college_id, department_id, code, name_en, name_ar, degree_level, total_credit_hours,
   minimum_gpa, internship_required, internship_minimum_credits, maximum_study_years)
SELECT (SELECT id FROM public.colleges WHERE code = v.college),
       (SELECT id FROM public.departments WHERE code = v.dept),
       v.code, v.en, v.ar, 'bachelor', v.credits, 2.00, v.intern, v.intern_min, 7
FROM (VALUES
  ('BSCS',   'CIT', 'CS',   'BSc Computer Science', 'بكالوريوس علوم الحاسوب', 126, true, 90),
  ('BSDSAI', 'CIT', 'DSAI', 'BSc Data Science and Artificial Intelligence', 'بكالوريوس علم البيانات والذكاء الاصطناعي', 126, true, 90),
  ('BSIS',   'CIT', 'IS',   'BSc Information Systems and Security', 'بكالوريوس نظم المعلومات والأمن', 126, true, 90),
  ('BSEE',   'ENG', 'EE',   'BSc Electrical Engineering', 'بكالوريوس الهندسة الكهربائية', 137, true, 95),
  ('BSME',   'ENG', 'ME',   'BSc Mechanical Engineering', 'بكالوريوس الهندسة الميكانيكية', 137, true, 95),
  ('BBA',    'BUS', 'BUSA', 'Bachelor of Business Administration', 'بكالوريوس إدارة الأعمال', 120, true, 84),
  ('BSMATH', 'SCI', 'MATH', 'BSc Mathematical Sciences', 'بكالوريوس العلوم الرياضية', 120, false, 90),
  ('BSBIO',  'SCI', 'BIO',  'BSc Biology', 'بكالوريوس علم الأحياء', 120, false, 90),
  ('BED',    'EDU', 'EDUC', 'Bachelor of Education', 'بكالوريوس التربية', 126, true, 90)
) AS v(code, college, dept, en, ar, credits, intern, intern_min)
WHERE NOT EXISTS (SELECT 1 FROM public.academic_programs p WHERE p.code = v.code);

-- ---------- programme study plans (shared university requirements) ----------
INSERT INTO public.program_courses (program_id, course_id, requirement_type, recommended_year, recommended_semester, is_required)
SELECT p.id, c.id, 'university_requirement', 1, 1, true
FROM public.academic_programs p
CROSS JOIN public.courses c
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_courses pc WHERE pc.program_id = p.id AND pc.course_id = c.id
);

-- ---------- course sections for the current term ----------
INSERT INTO public.course_sections
  (course_id, academic_term_id, section_number, instructor_name, capacity, enrolled_count, meeting_schedule, room, status)
SELECT c.id, t.id, s.num, 'Demo Instructor', 30, 0,
       CASE s.num WHEN '01' THEN 'Sun/Tue 09:00-10:15' ELSE 'Mon/Wed 11:00-12:15' END,
       'Building F1 - ' || c.code, 'open'
FROM public.courses c
CROSS JOIN (SELECT id FROM public.academic_terms WHERE is_current LIMIT 1) t
CROSS JOIN (VALUES ('01'), ('02')) AS s(num)
WHERE NOT EXISTS (
  SELECT 1 FROM public.course_sections cs
  WHERE cs.course_id = c.id AND cs.academic_term_id = t.id AND cs.section_number = s.num
);

-- ---------- transfer capacity ----------
INSERT INTO public.programme_transfer_capacity
  (programme_id, academic_term_id, total_transfer_seats, reserved_transfer_seats, assigned_transfer_seats, is_active, is_demo_record)
SELECT p.id, (SELECT id FROM public.academic_terms WHERE is_current LIMIT 1), 20, 0, 0, true, true
FROM public.academic_programs p
WHERE NOT EXISTS (SELECT 1 FROM public.programme_transfer_capacity tc WHERE tc.programme_id = p.id);

-- ---------- appointments ----------
INSERT INTO public.appointment_types (service_unit_id, name_en, name_ar, duration_minutes, location_type, requires_approval)
SELECT (SELECT id FROM public.service_units WHERE code = v.unit), v.en, v.ar, v.mins, v.loc, false
FROM (VALUES
  ('ADV',    'Academic advising session', 'جلسة إرشاد أكاديمي', 30, 'in_person'),
  ('CAREER', 'Career counselling session', 'جلسة إرشاد مهني', 45, 'in_person'),
  ('ACCESS', 'Accessibility needs review', 'مراجعة احتياجات إمكانية الوصول', 45, 'in_person')
) AS v(unit, en, ar, mins, loc)
WHERE NOT EXISTS (SELECT 1 FROM public.appointment_types a WHERE a.name_en = v.en);

INSERT INTO public.appointment_slots (appointment_type_id, start_time, end_time, capacity, booked_count, status)
SELECT a.id,
       slot_start,
       slot_start + (a.duration_minutes || ' minutes')::interval,
       1, 0, 'open'
FROM public.appointment_types a
CROSS JOIN LATERAL (
  SELECT (date_trunc('day', now()) + (d || ' days')::interval + (h || ' hours')::interval) AS slot_start
  FROM generate_series(1, 10) AS d, generate_series(9, 13) AS h
) AS g
WHERE NOT EXISTS (
  SELECT 1 FROM public.appointment_slots s WHERE s.appointment_type_id = a.id AND s.start_time = g.slot_start
);
