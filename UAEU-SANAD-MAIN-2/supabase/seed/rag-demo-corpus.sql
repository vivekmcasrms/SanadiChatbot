-- Sanadi RAG demo/test corpus. All content is clearly labelled demo material
-- prepared for retrieval-quality validation, not official UAEU policy text.

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Undergraduate Course Registration Policy (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'policy', '1.0', DATE '2026-01-05', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'registration',
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Undergraduate Course Registration Policy (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','registration'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'Registration for each semester opens in three waves: priority registration for graduating students, then by completed credit hours in descending order, then open registration for all undergraduates. Each wave lasts three working days.'::text, 'Registration periods'::text),
  (1, 'A student in good academic standing may register for a maximum of 18 credit hours in a regular semester. Students on academic probation are limited to 12 credit hours until their cumulative GPA returns to 2.00 or above.'::text, 'Credit load limits'::text),
  (2, 'A load above 18 credit hours, up to 21, requires written approval from the academic advisor and the college dean. Overload is granted only to students with a cumulative GPA of 3.30 or higher who are within two semesters of graduation.'::text, 'Overload approval'::text),
  (3, 'Full-time undergraduate status requires at least 12 registered credit hours. Dropping below 12 credit hours affects scholarship eligibility, campus housing eligibility and student visa status where applicable.'::text, 'Minimum load'::text),
  (4, 'Students may add or drop courses without academic or financial penalty during the first week of classes. Courses dropped in this period do not appear on the academic transcript.'::text, 'Add and drop period'::text),
  (5, 'The registration system blocks any course whose prerequisites are not completed with the minimum required grade. Prerequisite waivers are issued only by the course-owning department and must be recorded before the add and drop period closes.'::text, 'Prerequisites'::text),
  (6, 'Financial, library, disciplinary and advising holds block registration. Holds must be cleared by the unit that placed them; the Registration Department cannot remove a hold placed by another unit.'::text, 'Registration holds'::text),
  (7, 'Two courses whose scheduled meeting times overlap by any amount cannot be registered together. Laboratory and lecture sections of the same course are treated as a single registration unit.'::text, 'Time conflicts'::text),
  (8, 'A course in which a grade of D+ or lower was earned may be repeated twice. The highest grade is counted in the cumulative GPA, while all attempts remain visible on the transcript.'::text, 'Repeating a course'::text),
  (9, 'The summer session allows a maximum of 9 credit hours. Courses with laboratory components may be excluded from the summer offering when contact hours cannot be met.'::text, 'Summer registration'::text),
  (10, 'Late registration is permitted during the second week of classes with a late fee and advisor approval. No registration is accepted after the second week under any circumstance.'::text, 'Late registration'::text),
  (11, 'A change of section within the same course is treated as an add and drop transaction and is subject to the same deadlines and seat availability rules.'::text, 'Section changes'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل التسجيل للطلبة الجامعيين (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-01-05', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'registration',
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل التسجيل للطلبة الجامعيين (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','registration'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يفتح التسجيل على ثلاث مراحل: أولوية لطلبة التخرج، ثم حسب الساعات المكتسبة تنازلياً، ثم تسجيل مفتوح لجميع الطلبة. تستمر كل مرحلة ثلاثة أيام عمل.'::text, 'فترات التسجيل'::text),
  (1, 'يحق للطالب المنتظم التسجيل بحد أقصى 18 ساعة معتمدة في الفصل الاعتيادي، بينما يقتصر الطالب المُنذَر أكاديمياً على 12 ساعة معتمدة حتى يرتفع معدله التراكمي إلى 2.00.'::text, 'الحد الأعلى للساعات'::text),
  (2, 'يتطلب تجاوز 18 ساعة وحتى 21 ساعة موافقة المرشد الأكاديمي وعميد الكلية، ويُمنح للطلبة الحاصلين على معدل تراكمي 3.30 فأعلى والمتوقع تخرجهم خلال فصلين.'::text, 'التسجيل الإضافي'::text),
  (3, 'يشترط تسجيل 12 ساعة معتمدة على الأقل لاعتبار الطالب منتظماً، ويؤثر النزول عن هذا الحد على المنح الدراسية والسكن الجامعي وحالة الإقامة الدراسية.'::text, 'الحد الأدنى للتسجيل'::text),
  (4, 'يمكن حذف أو إضافة المقررات دون أثر أكاديمي أو مالي خلال الأسبوع الأول من الدراسة، ولا تظهر المقررات المحذوفة في هذه الفترة على كشف الدرجات.'::text, 'فترة الحذف والإضافة'::text),
  (5, 'يمنع النظام تسجيل أي مقرر لم تُستوفَ متطلباته السابقة بالدرجة الدنيا المطلوبة، ولا يُقبل الاستثناء إلا من القسم صاحب المقرر قبل انتهاء فترة الحذف والإضافة.'::text, 'المتطلبات السابقة'::text),
  (6, 'تمنع الحجوزات المالية وحجوزات المكتبة والحجوزات التأديبية والإرشادية إتمام التسجيل، ويجب رفعها من الجهة التي وضعتها وليس من قسم التسجيل.'::text, 'حجب التسجيل'::text),
  (7, 'لا يمكن الجمع بين مقررين يتعارض وقتهما ولو جزئياً، وتُعامل المحاضرة والمختبر لنفس المقرر كوحدة تسجيل واحدة.'::text, 'تعارض الأوقات'::text),
  (8, 'يجوز إعادة المقرر الذي حصل فيه الطالب على تقدير D+ أو أقل مرتين كحد أقصى، ويُحتسب أعلى تقدير في المعدل التراكمي مع بقاء جميع المحاولات في السجل.'::text, 'إعادة المقرر'::text),
  (9, 'الحد الأعلى للفصل الصيفي 9 ساعات معتمدة، وقد تُستثنى المقررات ذات المختبرات عند تعذر استيفاء ساعات التواصل.'::text, 'التسجيل الصيفي'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Course Withdrawal Policy (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'policy', '1.0', DATE '2026-01-10', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'withdrawal',
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Course Withdrawal Policy (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','withdrawal'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'A student may withdraw from an individual course from the second week of classes until the end of week ten of a regular semester. A grade of W is recorded and does not affect the cumulative GPA.'::text, 'Standard withdrawal window'::text),
  (1, 'Withdrawal after week ten is considered a late withdrawal and requires documented exceptional circumstances such as prolonged illness, bereavement or an approved medical leave. Late withdrawal requests are reviewed by a college committee, not by the assistant.'::text, 'Late withdrawal'::text),
  (2, 'A late withdrawal request must include a medical report from a licensed clinic, an official letter, or comparable documentary evidence covering the period in which attendance or assessment was affected.'::text, 'Evidence for late withdrawal'::text),
  (3, 'A student may accumulate no more than four course withdrawals across the whole undergraduate degree. A fifth withdrawal is refused unless a college committee grants an exception.'::text, 'Withdrawal limits'::text),
  (4, 'Withdrawal from all registered courses in one semester is a semester withdrawal. It requires advisor clearance, financial clearance and, for residents, notification to Student Housing Services.'::text, 'Complete semester withdrawal'::text),
  (5, 'Withdrawals during the first two weeks are eligible for a tuition refund according to the published refund schedule. Withdrawals after week two carry no refund entitlement.'::text, 'Financial effect'::text),
  (6, 'Withdrawn credit hours count as attempted hours for academic progress monitoring and may affect scholarship conditions that require a minimum number of earned credit hours per year.'::text, 'Effect on academic standing'::text),
  (7, 'Students holding a study residence permit must maintain full-time status. A withdrawal that reduces the registered load below 12 credit hours requires prior clearance from Student Academic Services.'::text, 'Effect on international students'::text),
  (8, 'An internship course may not be withdrawn after the placement has started without written agreement from Career and Internship Services and the host organisation.'::text, 'Withdrawal from an internship course'::text),
  (9, 'A processed withdrawal may only be reversed during the same withdrawal window and only when the seat is still available in the same section.'::text, 'Reversal of a withdrawal'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل الانسحاب من المقررات (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-01-10', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'withdrawal',
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل الانسحاب من المقررات (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','withdrawal'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يجوز للطالب الانسحاب من مقرر منفرد اعتباراً من الأسبوع الثاني وحتى نهاية الأسبوع العاشر من الفصل الاعتيادي، ويُرصد تقدير W دون التأثير على المعدل التراكمي.'::text, 'فترة الانسحاب المعتادة'::text),
  (1, 'يُعد الانسحاب بعد الأسبوع العاشر انسحاباً متأخراً ويستلزم ظروفاً استثنائية موثقة، وتتولى لجنة الكلية دراسته ولا يبتّ فيه المساعد الذكي.'::text, 'الانسحاب المتأخر'::text),
  (2, 'يجب أن يرفق طلب الانسحاب المتأخر تقريراً طبياً من جهة مرخصة أو خطاباً رسمياً يغطي الفترة التي تأثر فيها الحضور أو التقييم.'::text, 'المستندات المطلوبة'::text),
  (3, 'لا يزيد مجموع حالات الانسحاب عن أربعة مقررات طوال مرحلة البكالوريوس، ويُرفض الطلب الخامس ما لم توافق لجنة الكلية استثناءً.'::text, 'حدود الانسحاب'::text),
  (4, 'يتطلب الانسحاب من جميع المقررات موافقة المرشد الأكاديمي والإخلاء المالي، وإشعار خدمات السكن الطلابي لقاطني السكن.'::text, 'الانسحاب من الفصل بالكامل'::text),
  (5, 'يستحق الطالب استرداد الرسوم وفق الجدول المعلن عند الانسحاب خلال الأسبوعين الأولين، ولا يوجد استرداد بعد الأسبوع الثاني.'::text, 'الأثر المالي'::text),
  (6, 'تُحتسب الساعات المنسحب منها ضمن الساعات المحاولة في متابعة التقدم الأكاديمي، وقد تؤثر على شروط المنح التي تشترط حداً أدنى من الساعات المكتسبة سنوياً.'::text, 'الأثر على الوضع الأكاديمي'::text),
  (7, 'يجب على حاملي الإقامة الدراسية الحفاظ على وضع الانتظام، ويستلزم الانسحاب الذي يخفض العبء دون 12 ساعة موافقة مسبقة من خدمات الطلبة الأكاديمية.'::text, 'طلبة الإقامة الدراسية'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Internship Eligibility and Placement Policy (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'policy', '1.0', DATE '2026-01-20', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'internship',
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Internship Eligibility and Placement Policy (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','internship'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'A student becomes eligible to register for the internship course after completing 80 credit hours of the degree plan. Registered but incomplete hours do not count towards the threshold.'::text, 'Credit hour threshold'::text),
  (1, 'A minimum cumulative GPA of 2.00 is required to start an internship. Students below 2.00 are advised to raise their standing before applying, as host organisations may set higher requirements.'::text, 'GPA requirement'::text),
  (2, 'The standard internship is 240 contact hours completed over eight to twelve weeks. Part-time placements are accepted when the total contact hours are met within one semester.'::text, 'Duration'::text),
  (3, 'An active financial hold or an unresolved disciplinary case blocks internship placement. Government administration clearance is required before placement in a public-sector host organisation.'::text, 'Holds and clearances'::text),
  (4, 'Placements are matched using the student''s programme, completed courses, declared skills and preferred emirate. Matching results are advisory; the final placement decision rests with the host organisation.'::text, 'Placement matching'::text),
  (5, 'An internship application requires an up-to-date CV, a current academic transcript, a signed training agreement and, for some hosts, a passport or Emirates ID copy.'::text, 'Application documents'::text),
  (6, 'Every placement has an academic supervisor from the college and a workplace supervisor from the host organisation. Both submit an evaluation at the end of the placement.'::text, 'Supervision'::text),
  (7, 'More than three unexcused absence days during a placement may result in a failing internship grade. Absence for medical reasons must be reported to both supervisors within 48 hours.'::text, 'Attendance and absence'::text),
  (8, 'The internship grade combines the workplace supervisor evaluation, the academic supervisor report and the final student reflective report, and is recorded as pass or fail.'::text, 'Evaluation and grade'::text),
  (9, 'A placement may be changed only within the first two weeks and only when the host organisation confirms the release in writing.'::text, 'Changing a placement'::text),
  (10, 'Summer placements follow the same eligibility rules but must complete the full contact hours before the start of the following semester.'::text, 'Summer internships'::text),
  (11, 'Students on placement are covered by the university student insurance. Any workplace incident must be reported to Career and Internship Services on the same working day.'::text, 'Insurance and safety'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل التدريب العملي (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-01-20', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'internship',
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل التدريب العملي (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','internship'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يصبح الطالب مؤهلاً لتسجيل مقرر التدريب العملي بعد إتمام 80 ساعة معتمدة من الخطة الدراسية، ولا تُحتسب الساعات المسجلة غير المكتملة ضمن هذا الشرط.'::text, 'شرط الساعات المعتمدة'::text),
  (1, 'يشترط معدل تراكمي لا يقل عن 2.00 لبدء التدريب، وقد تشترط بعض جهات التدريب معدلاً أعلى.'::text, 'شرط المعدل التراكمي'::text),
  (2, 'المدة المعيارية 240 ساعة تدريبية تُنجز خلال ثمانية إلى اثني عشر أسبوعاً، ويُقبل التدريب الجزئي إذا اكتملت الساعات خلال الفصل نفسه.'::text, 'مدة التدريب'::text),
  (3, 'يمنع الحجز المالي أو القضية التأديبية غير المنتهية إتمام التدريب، ويُشترط تصريح الإدارة الحكومية للتدريب في الجهات الحكومية.'::text, 'الحجوزات والتصاريح'::text),
  (4, 'تُقترح فرص التدريب بناءً على البرنامج الأكاديمي والمقررات المنجزة والمهارات والإمارة المفضلة، ويبقى القرار النهائي لجهة التدريب.'::text, 'مطابقة الفرص'::text),
  (5, 'يتطلب الطلب سيرة ذاتية محدثة وكشف درجات حديثاً واتفاقية تدريب موقعة، وقد تطلب بعض الجهات نسخة من الهوية الإماراتية أو جواز السفر.'::text, 'مستندات الطلب'::text),
  (6, 'لكل تدريب مشرف أكاديمي من الكلية ومشرف ميداني من جهة التدريب، ويقدم كلاهما تقييماً في نهاية المدة.'::text, 'الإشراف'::text),
  (7, 'قد يؤدي تجاوز ثلاثة أيام غياب دون عذر إلى رسوب الطالب في التدريب، ويجب إبلاغ المشرفين خلال 48 ساعة في حالات الغياب المرضي.'::text, 'الحضور والغياب'::text),
  (8, 'تُحتسب درجة التدريب من تقييم المشرف الميداني وتقرير المشرف الأكاديمي والتقرير الختامي للطالب، وتُرصد نجاحاً أو رسوباً.'::text, 'التقييم والدرجة'::text),
  (9, 'يشمل تأمين الطلبة المتدربين أثناء فترة التدريب، ويجب إبلاغ خدمات المهن والتدريب بأي حادث في نفس يوم العمل.'::text, 'التأمين والسلامة'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Student Housing Allocation Policy (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'policy', '1.0', DATE '2026-02-10', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'housing',
    (SELECT id FROM public.service_units WHERE code = 'HOUS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'HOUS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Student Housing Allocation Policy (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','housing'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'On-campus housing is offered to full-time undergraduate students registered for at least 12 credit hours whose permanent address is outside Al Ain. Priority is given to first-year and final-year students.'::text, 'Eligibility'::text),
  (1, 'Housing applications open eight weeks before the start of each semester and close two weeks before classes begin. Late applications are placed on the waiting list only.'::text, 'Application window'::text),
  (2, 'Rooms are allocated by application date, academic level and documented accessibility or medical needs. Roommate preferences are honoured when both students request each other before the closing date.'::text, 'Room allocation'::text),
  (3, 'A bed reservation is confirmed only after the housing fee deposit is recorded. Unconfirmed reservations expire after 72 hours and the bed returns to the available pool.'::text, 'Bed reservation'::text),
  (4, 'Housing fees are charged per semester. A resident who checks out before the end of week four receives a fifty per cent refund; no refund is issued after week four.'::text, 'Fees and refunds'::text),
  (5, 'Check-in requires an Emirates ID, a residence permit copy where applicable and a signed room condition report. Check-out requires a room inspection and the return of keys and access cards.'::text, 'Check-in and check-out'::text),
  (6, 'Routine maintenance requests are resolved within three working days. Requests affecting safety, water supply, electricity or air conditioning are treated as urgent and resolved within 24 hours.'::text, 'Maintenance requests'::text),
  (7, 'Visitors are permitted only in designated common areas during published visiting hours. Quiet hours are observed from 11 pm to 7 am daily and are extended during examination weeks.'::text, 'Visitors and quiet hours'::text),
  (8, 'Cooking appliances, smoking and unauthorised room changes are prohibited. Repeated conduct violations may lead to the withdrawal of housing eligibility for the following semester.'::text, 'Conduct in residence'::text),
  (9, 'Residence halls close during the winter and summer breaks except for approved stay-over requests submitted at least ten days in advance.'::text, 'Vacation periods'::text),
  (10, 'Residents are eligible for the campus bus service. Bus schedules and any changes are published by Transportation Services in both Arabic and English.'::text, 'Transport link'::text),
  (11, 'Accessible rooms are reserved for students registered with Accessibility Support Services and are allocated before general room assignment.'::text, 'Accessibility accommodation'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل السكن الطلابي (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-02-10', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'housing',
    (SELECT id FROM public.service_units WHERE code = 'HOUS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'HOUS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل السكن الطلابي (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','housing'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يُتاح السكن الجامعي للطلبة المنتظمين المسجلين 12 ساعة معتمدة على الأقل ممن تقع إقامتهم الدائمة خارج مدينة العين، مع أولوية لطلبة السنة الأولى وسنة التخرج.'::text, 'شروط الأهلية'::text),
  (1, 'يفتح باب التقديم قبل ثمانية أسابيع من بداية الفصل ويغلق قبل أسبوعين من انطلاق الدراسة، وتوضع الطلبات المتأخرة على قائمة الانتظار.'::text, 'فترة التقديم'::text),
  (2, 'تُوزع الغرف حسب تاريخ التقديم والمستوى الدراسي والاحتياجات الطبية الموثقة، وتُراعى رغبات الشريك في السكن عند تقديم الطرفين للطلب قبل موعد الإغلاق.'::text, 'توزيع الغرف'::text),
  (3, 'لا يُعتمد حجز السرير إلا بعد تسجيل دفعة رسوم السكن، وتنتهي صلاحية الحجز غير المؤكد خلال 72 ساعة ليعود السرير إلى الأسرّة المتاحة.'::text, 'حجز السرير'::text),
  (4, 'تُحتسب رسوم السكن لكل فصل دراسي، ويستحق المغادر قبل نهاية الأسبوع الرابع استرداد خمسين بالمئة، ولا استرداد بعد ذلك.'::text, 'الرسوم والاسترداد'::text),
  (5, 'يتطلب الاستلام الهوية الإماراتية وتقرير حالة الغرفة موقعاً، ويتطلب الإخلاء معاينة الغرفة وتسليم المفاتيح وبطاقات الدخول.'::text, 'الاستلام والإخلاء'::text),
  (6, 'تُنجز طلبات الصيانة الاعتيادية خلال ثلاثة أيام عمل، وتُعامل الأعطال المتعلقة بالسلامة أو الكهرباء أو التكييف كطلبات عاجلة تُنجز خلال 24 ساعة.'::text, 'طلبات الصيانة'::text),
  (7, 'يُسمح باستقبال الزوار في الأماكن المخصصة ضمن الأوقات المعلنة، وتُطبق ساعات الهدوء من الحادية عشرة مساءً حتى السابعة صباحاً وتُمدد في فترة الامتحانات.'::text, 'الزوار وساعات الهدوء'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Inter-College Transfer Policy (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'policy', '1.0', DATE '2026-01-18', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'transfer',
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Inter-College Transfer Policy (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','transfer'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'An inter-college transfer request is accepted from students who have completed between 12 and 38 credit hours. Requests outside this window are refused because the receiving college cannot map the remaining plan.'::text, 'Credit window'::text),
  (1, 'A cumulative GPA of 2.50 or above is required. Some colleges publish a higher programme-specific threshold, which overrides the university minimum.'::text, 'GPA requirement'::text),
  (2, 'Transfer applications are accepted during the two weeks following the publication of final grades and before the start of the next registration wave.'::text, 'Application timing'::text),
  (3, 'Every transfer is subject to a confirmed seat in the receiving programme. Seats are allocated in order of application once eligibility is verified, and a reserved seat expires if the student does not confirm within five working days.'::text, 'Seat availability'::text),
  (4, 'The receiving college maps completed courses to the new degree plan. Courses that do not map become free elective credit or are excluded, which may extend the expected graduation date.'::text, 'Course mapping'::text),
  (5, 'Before confirmation, the student receives an impact analysis showing mapped credit hours, lost credit hours and the revised expected graduation semester.'::text, 'Graduation delay analysis'::text),
  (6, 'A student may complete only one inter-college transfer during the undergraduate degree. A second transfer requires an exception approved by the college dean.'::text, 'One transfer rule'::text),
  (7, 'A transfer may change scholarship conditions where the award is tied to a specific programme. Student Accounts confirms the financial effect before the transfer is finalised.'::text, 'Effect on scholarships'::text),
  (8, 'Course withdrawals recorded before the transfer remain on the transcript and continue to count towards the four-withdrawal limit.'::text, 'Withdrawn courses on transfer'::text),
  (9, 'An approved transfer does not cancel a housing allocation, but it may change internship eligibility because the credit hour count is recalculated against the new degree plan.'::text, 'Effect on housing and internship'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل التحويل بين الكليات (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-01-18', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'transfer',
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل التحويل بين الكليات (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','transfer'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يُقبل طلب التحويل بين الكليات من الطلبة الذين أنجزوا بين 12 و38 ساعة معتمدة، ويُرفض الطلب خارج هذا النطاق لتعذر مطابقة الخطة المتبقية.'::text, 'نطاق الساعات'::text),
  (1, 'يشترط معدل تراكمي 2.50 فأعلى، وقد تعلن بعض الكليات حداً أعلى خاصاً بالبرنامج يُعمل به بدلاً من الحد الجامعي.'::text, 'شرط المعدل'::text),
  (2, 'تُقبل طلبات التحويل خلال أسبوعين من إعلان النتائج النهائية وقبل بدء مرحلة التسجيل التالية.'::text, 'موعد التقديم'::text),
  (3, 'يخضع كل تحويل لتوفر مقعد مؤكد في البرنامج المستقبِل، ويُحجز المقعد بترتيب الطلبات وينتهي الحجز إذا لم يؤكد الطالب خلال خمسة أيام عمل.'::text, 'توفر المقاعد'::text),
  (4, 'تتولى الكلية المستقبِلة معادلة المقررات المنجزة مع الخطة الجديدة، وقد تتحول المقررات غير المطابقة إلى مواد اختيارية حرة أو تُستبعد مما قد يؤخر التخرج.'::text, 'معادلة المقررات'::text),
  (5, 'يحصل الطالب قبل التأكيد على تحليل يوضح الساعات المعادَلة والساعات المفقودة وفصل التخرج المتوقع بعد التحويل.'::text, 'تحليل أثر التخرج'::text),
  (6, 'يُسمح بتحويل واحد بين الكليات خلال مرحلة البكالوريوس، ويتطلب التحويل الثاني استثناءً من عميد الكلية.'::text, 'مرة واحدة'::text),
  (7, 'قد يغير التحويل شروط المنحة المرتبطة ببرنامج محدد، ولا يلغي تخصيص السكن، وقد يعيد احتساب أهلية التدريب العملي وفق الخطة الجديدة.'::text, 'الأثر على المنح والسكن'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Official Student Documents Procedure (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'procedure', '1.0', DATE '2026-02-01', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'documents',
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Official Student Documents Procedure (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','documents'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'Students may request an enrolment letter, a to whom it may concern letter, an unofficial transcript, a grade report and a graduation expectation letter through the digital services portal.'::text, 'Available documents'::text),
  (1, 'Digitally generated letters are issued immediately. Documents requiring manual verification, such as sealed transcripts, take up to three working days.'::text, 'Processing time'::text),
  (2, 'Every generated letter carries a QR code and a verification token. Any recipient can verify a letter without signing in, and verification shows the issue date and document status.'::text, 'Verification'::text),
  (3, 'Generated documents remain downloadable for thirty days, after which the file is permanently deleted. A new copy can be generated at any time while the student is active.'::text, 'Retention'::text),
  (4, 'Letters are available in Arabic and English. The Arabic version is generated right to left with the official Arabic name recorded in the student record.'::text, 'Language'::text),
  (5, 'Names printed on official documents follow the passport or Emirates ID record. Corrections must be made in the student record before the document is generated.'::text, 'Accuracy of personal data'::text),
  (6, 'Letters addressed to an embassy or a government entity must name the recipient entity. A generic letter may be refused by the receiving authority.'::text, 'Documents for embassies'::text),
  (7, 'An active financial hold blocks sealed transcripts and graduation documents, but does not block a basic enrolment letter.'::text, 'Documents with financial holds'::text),
  (8, 'Degree certificates and final sealed transcripts are issued by Student Academic Services after graduation clearance is complete and are collected in person or by an authorised representative.'::text, 'Graduation documents'::text),
  (9, 'A replacement of a sealed document is issued on request with a replacement fee, and the earlier copy remains valid unless it was reported as compromised.'::text, 'Lost documents'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل الوثائق الطلابية الرسمية (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-02-01', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'documents',
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل الوثائق الطلابية الرسمية (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','documents'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يمكن للطالب طلب إفادة قيد وخطاب لمن يهمه الأمر وكشف درجات غير رسمي وتقرير درجات وإفادة توقع تخرج عبر بوابة الخدمات الرقمية.'::text, 'الوثائق المتاحة'::text),
  (1, 'تُصدر الخطابات الرقمية فوراً، بينما تستغرق الوثائق التي تتطلب تدقيقاً يدوياً مثل كشف الدرجات المختوم حتى ثلاثة أيام عمل.'::text, 'مدة الإنجاز'::text),
  (2, 'يحمل كل خطاب رمز استجابة سريعة ورمز تحقق، ويمكن لأي جهة التحقق من صحته دون تسجيل دخول مع بيان تاريخ الإصدار وحالة الوثيقة.'::text, 'التحقق'::text),
  (3, 'تبقى الوثائق متاحة للتحميل ثلاثين يوماً ثم تُحذف نهائياً، ويمكن إصدار نسخة جديدة في أي وقت أثناء استمرار قيد الطالب.'::text, 'مدة الاحتفاظ'::text),
  (4, 'تتوفر الخطابات بالعربية والإنجليزية، وتُصدر النسخة العربية بتنسيق من اليمين إلى اليسار بالاسم العربي الرسمي المسجل.'::text, 'اللغة'::text),
  (5, 'يمنع الحجز المالي إصدار كشف الدرجات المختوم ووثائق التخرج، ولا يمنع إصدار إفادة القيد الأساسية.'::text, 'الحجوزات المالية'::text),
  (6, 'يجب أن يتضمن الخطاب الموجه إلى سفارة أو جهة حكومية اسم الجهة المستقبِلة، وقد تُرفض الخطابات العامة.'::text, 'وثائق السفارات'::text),
  (7, 'يمكن إصدار بدل فاقد للوثائق المختومة مقابل رسوم، وتبقى النسخة السابقة سارية ما لم يُبلَّغ عن فقدانها.'::text, 'الوثائق المفقودة'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Library Services Guide (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'service_guide', '1.0', DATE '2026-02-15', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'library',
    (SELECT id FROM public.service_units WHERE code = 'LIB' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'LIB' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Library Services Guide (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','library'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'Undergraduate students may borrow up to eight items at a time for fourteen days. Graduate students may borrow up to fifteen items for twenty-eight days.'::text, 'Borrowing limits'::text),
  (1, 'An item may be renewed twice online if no other reader has placed a hold on it. A third renewal requires returning the item to the circulation desk.'::text, 'Renewals'::text),
  (2, 'Overdue items generate a daily fine per item. A library hold is placed on the student record once fines exceed the published threshold, and the hold blocks registration.'::text, 'Overdue items'::text),
  (3, 'The library catalogue search covers the physical collection, e-books and licensed databases, and shows availability such as available on shelf, on loan or online access.'::text, 'Discovery search'::text),
  (4, 'Licensed databases are available off campus through the university single sign-on. Access is limited to current students and staff under the licence terms.'::text, 'Off-campus access'::text),
  (5, 'Group study rooms are booked for up to three hours per day per student. A booking is released if the room is not occupied within fifteen minutes of the start time.'::text, 'Study rooms'::text),
  (6, 'Items not held by the library can be requested through interlibrary loan, which typically takes seven to fourteen days depending on the supplying library.'::text, 'Interlibrary loan'::text),
  (7, 'Librarians provide reference help for research questions, database selection and citation formatting in person, by email and through the assistant.'::text, 'Reference help'::text),
  (8, 'The library supports APA, MLA, IEEE and Chicago styles, and the catalogue can export a formatted citation for any catalogue record.'::text, 'Citation support'::text),
  (9, 'Rare and archival material is consulted in the reading room only and cannot be borrowed. Digitisation requests are reviewed by the collections team.'::text, 'Special collections'::text),
  (10, 'The main library opens Monday to Thursday from 8 am to 10 pm and on Friday from 8 am to 12 pm. Hours are extended during examination periods.'::text, 'Opening hours'::text),
  (11, 'All borrowed items must be returned and all fines cleared before graduation clearance is granted.'::text, 'Library holds and graduation'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل خدمات المكتبة (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-02-15', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'library',
    (SELECT id FROM public.service_units WHERE code = 'LIB' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'LIB' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل خدمات المكتبة (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','library'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يمكن لطلبة البكالوريوس استعارة ثمانية أوعية لمدة أربعة عشر يوماً، ولطلبة الدراسات العليا استعارة خمسة عشر وعاءً لمدة ثمانية وعشرين يوماً.'::text, 'حدود الاستعارة'::text),
  (1, 'يمكن تجديد الاستعارة مرتين إلكترونياً ما لم يحجزها قارئ آخر، ويتطلب التجديد الثالث إحضار الوعاء إلى مكتب الإعارة.'::text, 'التجديد'::text),
  (2, 'تُحتسب غرامة يومية عن كل وعاء متأخر، ويُوضع حجز مكتبي على سجل الطالب عند تجاوز الحد المعلن مما يمنع التسجيل.'::text, 'التأخير'::text),
  (3, 'يشمل البحث في فهرس المكتبة المجموعة الورقية والكتب الإلكترونية وقواعد البيانات المرخصة، ويوضح حالة التوفر مثل متاح على الرف أو معار أو متاح إلكترونياً.'::text, 'البحث في الفهرس'::text),
  (4, 'تتاح قواعد البيانات المرخصة من خارج الحرم عبر الدخول الموحد، ويقتصر الوصول على الطلبة والموظفين الحاليين وفق شروط الترخيص.'::text, 'الوصول من خارج الحرم'::text),
  (5, 'تُحجز قاعات الدراسة الجماعية لمدة ثلاث ساعات يومياً لكل طالب، ويُلغى الحجز إذا لم تُشغل القاعة خلال خمس عشرة دقيقة.'::text, 'قاعات الدراسة'::text),
  (6, 'يمكن طلب الأوعية غير المتوفرة عبر الإعارة بين المكتبات، وتستغرق عادة من سبعة إلى أربعة عشر يوماً.'::text, 'الإعارة بين المكتبات'::text),
  (7, 'يقدم أمناء المكتبة دعماً مرجعياً في أسئلة البحث واختيار قواعد البيانات وتنسيق الاستشهادات حضورياً وعبر البريد والمساعد الذكي.'::text, 'الدعم المرجعي'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Career Counselling Service Guide (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'service_guide', '1.0', DATE '2026-02-05', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'career',
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Career Counselling Service Guide (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','career'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'Career and Internship Services offers CV review, interview preparation, career counselling appointments, skill gap analysis and employer connection events.'::text, 'Service scope'::text),
  (1, 'An uploaded CV is analysed for structure, keyword coverage, measurable achievements and formatting compatibility with applicant tracking systems. The resulting score is advisory.'::text, 'CV review'::text),
  (2, 'The applicant tracking score is deterministic and evidence based: it reports which sections, skills and keywords were found in the document rather than an opaque overall judgement.'::text, 'ATS scoring'::text),
  (3, 'Skill gaps compare the skills evidenced in the student record and CV with the skills requested by target roles, and suggest courses, certificates or projects to close each gap.'::text, 'Skill gap analysis'::text),
  (4, 'When no CV is uploaded, role matching uses the academic record only: programme, completed courses, projects and declared interests.'::text, 'Academic mode matching'::text),
  (5, 'Counselling appointments are booked through the digital services portal. Each appointment lasts thirty minutes and can be rescheduled up to four hours before the start time.'::text, 'Appointment booking'::text),
  (6, 'Career fairs and employer sessions are announced each semester. Registration closes when the venue capacity is reached.'::text, 'Employer events'::text),
  (7, 'Uploaded CVs are scanned before processing. Files that fail the safety scan are rejected and are not stored.'::text, 'Document safety'::text),
  (8, 'CV content is used only for the student''s own matching and counselling. It is never shared with an employer without the student''s explicit consent.'::text, 'Privacy of CV data'::text),
  (9, 'A student may delete an uploaded CV at any time. Deletion removes the stored file permanently and clears derived matching results.'::text, 'Deleting a CV'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل الإرشاد المهني (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-02-05', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'career',
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'CAREER' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل الإرشاد المهني (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','career'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'تقدم خدمات المهن والتدريب مراجعة السيرة الذاتية والتحضير للمقابلات ومواعيد الإرشاد المهني وتحليل فجوات المهارات وفعاليات التواصل مع أصحاب العمل.'::text, 'نطاق الخدمة'::text),
  (1, 'تُحلل السيرة الذاتية من حيث البنية وتغطية الكلمات المفتاحية والإنجازات القابلة للقياس والتوافق مع أنظمة تتبع المتقدمين، وتبقى النتيجة استرشادية.'::text, 'مراجعة السيرة الذاتية'::text),
  (2, 'يُحتسب تقييم أنظمة التتبع بطريقة محددة ومبنية على الأدلة، ويوضح الأقسام والمهارات والكلمات المفتاحية التي عُثر عليها في الملف.'::text, 'تقييم التوافق'::text),
  (3, 'يقارن التحليل المهارات الموثقة في السجل الأكاديمي والسيرة الذاتية بمتطلبات الوظائف المستهدفة ويقترح مقررات أو شهادات أو مشاريع لسد كل فجوة.'::text, 'تحليل فجوات المهارات'::text),
  (4, 'عند عدم رفع سيرة ذاتية تعتمد المطابقة على السجل الأكاديمي فقط من برنامج ومقررات منجزة ومشاريع واهتمامات معلنة.'::text, 'المطابقة الأكاديمية'::text),
  (5, 'تُحجز مواعيد الإرشاد عبر بوابة الخدمات الرقمية، ومدة الموعد ثلاثون دقيقة ويمكن تعديله قبل أربع ساعات من موعده.'::text, 'حجز الموعد'::text),
  (6, 'تُستخدم بيانات السيرة الذاتية لمصلحة الطالب فقط، ولا تُشارك مع جهة توظيف دون موافقته الصريحة.'::text, 'خصوصية البيانات'::text),
  (7, 'يمكن للطالب حذف سيرته الذاتية في أي وقت، ويؤدي الحذف إلى إزالة الملف نهائياً ومسح نتائج المطابقة المشتقة منه.'::text, 'حذف السيرة الذاتية'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Student Complaints and Suggestions Procedure (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'procedure', '1.0', DATE '2026-03-01', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'complaints',
    (SELECT id FROM public.service_units WHERE code = 'COMP' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'COMP' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Student Complaints and Suggestions Procedure (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','complaints'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'The procedure covers complaints about services, facilities, administrative decisions and staff conduct, and suggestions for improving university services.'::text, 'Scope'::text),
  (1, 'Students are encouraged to raise the issue with the responsible unit first. Many service issues are resolved informally within two working days.'::text, 'Informal resolution'::text),
  (2, 'A formal complaint is recorded with a reference number, a responsible unit and a service level target. The student can track progress at any time.'::text, 'Formal complaint'::text),
  (3, 'The first response target is two working days for standard complaints and four working hours for urgent complaints affecting safety, examinations or residence.'::text, 'Service levels'::text),
  (4, 'A complaint that breaches its resolution target is escalated automatically to the unit manager, and a second breach is escalated to the service oversight level.'::text, 'Escalation'::text),
  (5, 'A complaint may be submitted anonymously, but an anonymous case cannot receive a personal outcome notification and may be harder to investigate.'::text, 'Anonymous reporting'::text),
  (6, 'Complaint details are visible only to the student, the assigned handlers in the responsible unit and oversight roles. Case content is never shared with unrelated units.'::text, 'Confidentiality'::text),
  (7, 'A suggestion moves from submitted to under review, then to accepted, implemented or declined with a stated reason. The student is notified at each transition.'::text, 'Suggestions lifecycle'::text),
  (8, 'A student who is not satisfied with the outcome may request a review within ten working days of the closure notification.'::text, 'Appeals'::text),
  (9, 'Grade grievances follow the academic appeal route through the college and are not handled as service complaints.'::text, 'Grievances about grades'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل الشكاوى والاقتراحات الطلابية (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-03-01', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'complaints',
    (SELECT id FROM public.service_units WHERE code = 'COMP' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'COMP' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل الشكاوى والاقتراحات الطلابية (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','complaints'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'يشمل الإجراء الشكاوى المتعلقة بالخدمات والمرافق والقرارات الإدارية وسلوك الموظفين، والاقتراحات الرامية إلى تحسين الخدمات الجامعية.'::text, 'النطاق'::text),
  (1, 'يُنصح الطالب بعرض المشكلة على الجهة المعنية أولاً، إذ تُحل كثير من الملاحظات الخدمية ودياً خلال يومي عمل.'::text, 'الحل الودي'::text),
  (2, 'تُسجل الشكوى الرسمية برقم مرجعي وجهة مسؤولة ومدة استجابة محددة، ويمكن للطالب متابعة حالتها في أي وقت.'::text, 'الشكوى الرسمية'::text),
  (3, 'مدة الاستجابة الأولى يوما عمل للشكاوى الاعتيادية وأربع ساعات عمل للشكاوى العاجلة المتعلقة بالسلامة أو الامتحانات أو السكن.'::text, 'مستويات الخدمة'::text),
  (4, 'تُصعَّد الشكوى تلقائياً إلى مدير الوحدة عند تجاوز مدة الحل، ويؤدي التجاوز الثاني إلى التصعيد لمستوى الإشراف على الخدمة.'::text, 'التصعيد'::text),
  (5, 'يمكن تقديم الشكوى دون ذكر الهوية، إلا أن ذلك يحول دون إشعار الطالب بالنتيجة وقد يصعّب التحقيق.'::text, 'الإبلاغ دون هوية'::text),
  (6, 'تظهر تفاصيل الشكوى للطالب وللمعالجين المكلفين في الجهة المسؤولة ولأدوار الإشراف فقط، ولا تُشارك مع جهات غير معنية.'::text, 'السرية'::text),
  (7, 'ينتقل الاقتراح من مُقدَّم إلى قيد الدراسة ثم إلى مقبول أو مُنفَّذ أو مرفوض مع بيان السبب، ويُشعر الطالب عند كل انتقال.'::text, 'دورة حياة الاقتراح'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'General Student Services Guide (Demo Corpus)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'service_guide', '1.0', DATE '2026-01-12', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'general',
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'General Student Services Guide (Demo Corpus)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','general'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'The student card is issued at Student Academic Services and is used for library borrowing, building access, campus buses and examination identification.'::text, 'Student card'::text),
  (1, 'A financial hold is placed when an outstanding balance passes the published threshold. It blocks registration, sealed transcripts and graduation clearance until settled or a payment plan is approved.'::text, 'Financial holds'::text),
  (2, 'Student Accounts may approve an instalment plan for an outstanding balance. An approved plan lifts the registration hold while instalments are paid on schedule.'::text, 'Payment plans'::text),
  (3, 'Each student is assigned an academic advisor who approves the study plan each semester and supports course selection, overload requests and academic recovery plans.'::text, 'Academic advising'::text),
  (4, 'A cumulative GPA below 2.00 places a student on probation. Probation requires an advising meeting, a reduced credit load and a documented recovery plan.'::text, 'Academic probation'::text),
  (5, 'Graduation requires completion of the published degree plan credit hours, a cumulative GPA of at least 2.00, completion of the internship requirement where applicable and full clearance from all units.'::text, 'Graduation requirements'::text),
  (6, 'Campus security operates twenty-four hours. Medical emergencies on campus are directed to the campus clinic, and off-campus emergencies to the national emergency number.'::text, 'Emergency contacts'::text),
  (7, 'Students with a documented disability register with Accessibility Support Services to arrange examination accommodations, accessible housing and assistive technology.'::text, 'Accessibility support'::text),
  (8, 'Password resets, university email problems, wireless access and portal errors are handled by Information Technology Support, with a first response target of one working day.'::text, 'IT support'::text),
  (9, 'Campus and city bus routes serve residence halls, academic buildings and selected city stops. Route changes are announced at least three days in advance.'::text, 'Transport'::text),
  (10, 'Confidential personal counselling is available by appointment. Counselling records are kept separate from the academic record.'::text, 'Counselling and wellbeing'::text),
  (11, 'Students can rate any completed service interaction. Ratings feed the service quality dashboards reviewed by unit managers each month.'::text, 'Feedback'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'دليل الخدمات الطلابية العامة (محتوى تجريبي)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'ar', 'guide', '1.0', DATE '2026-01-12', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'general',
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'دليل الخدمات الطلابية العامة (محتوى تجريبي)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','general'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'تُصدر البطاقة الجامعية من خدمات الطلبة الأكاديمية وتُستخدم للاستعارة من المكتبة ودخول المباني وحافلات الحرم والتعريف في الامتحانات.'::text, 'البطاقة الجامعية'::text),
  (1, 'يُوضع الحجز المالي عند تجاوز الرصيد المستحق الحد المعلن، ويمنع التسجيل وإصدار كشف الدرجات المختوم وإخلاء التخرج حتى السداد أو اعتماد خطة تقسيط.'::text, 'الحجوزات المالية'::text),
  (2, 'قد تعتمد إدارة حسابات الطلبة خطة تقسيط للرصيد المستحق، ويُرفع حجز التسجيل ما دام الطالب ملتزماً بمواعيد الأقساط.'::text, 'خطط السداد'::text),
  (3, 'يُخصص لكل طالب مرشد أكاديمي يعتمد خطته الدراسية كل فصل ويدعمه في اختيار المقررات وطلبات العبء الإضافي وخطط التحسين الأكاديمي.'::text, 'الإرشاد الأكاديمي'::text),
  (4, 'ينذر الطالب أكاديمياً عند انخفاض معدله التراكمي دون 2.00، ويستلزم ذلك لقاءً إرشادياً وتخفيض العبء الدراسي وخطة تحسين موثقة.'::text, 'الإنذار الأكاديمي'::text),
  (5, 'يتطلب التخرج إنجاز ساعات الخطة الدراسية المعلنة ومعدل تراكمي لا يقل عن 2.00 واستيفاء متطلب التدريب العملي عند وجوده وإتمام الإخلاء من جميع الجهات.'::text, 'متطلبات التخرج'::text),
  (6, 'يعمل أمن الحرم الجامعي على مدار الساعة، وتُوجَّه الحالات الطبية داخل الحرم إلى العيادة الجامعية والحالات خارجه إلى رقم الطوارئ الوطني.'::text, 'الطوارئ'::text),
  (7, 'تتولى إدارة الدعم التقني إعادة تعيين كلمات المرور ومشكلات البريد الجامعي والشبكة اللاسلكية وأعطال البوابة، بمدة استجابة أولى يوم عمل واحد.'::text, 'الدعم التقني'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'College Withdrawal Practice Note (Demo Corpus — Conflict Test)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'procedure', '1.0', DATE '2026-02-20', NULL,
    false, 'public', 'student_authenticated', true, 'approved',
    true, 'official', 'students', 'withdrawal',
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'SAS' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'College Withdrawal Practice Note (Demo Corpus — Conflict Test)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','withdrawal'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'Students may withdraw from a course up to the end of week twelve of a regular semester without exceptional circumstances documentation. A grade of W is recorded.'::text, 'Late withdrawal deadline'::text),
  (1, 'Withdrawal requests submitted after week twelve are reviewed by the college committee within five working days.'::text, 'Committee review'::text)
) AS v(idx, content, section);

WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    'Superseded Registration Load Policy 2019 (Demo Corpus — Expired Test)',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    'en', 'policy', '1.0', DATE '2019-09-01', DATE '2025-08-31',
    false, 'public', 'student_authenticated', true, 'approved',
    false, 'official', 'students', 'registration',
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = 'REG' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = 'Superseded Registration Load Policy 2019 (Demo Corpus — Expired Test)')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','registration'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
  (0, 'The maximum registration load in a regular semester is 15 credit hours for all undergraduate students regardless of academic standing.'::text, 'Credit load limits'::text),
  (1, 'No overload above 15 credit hours is permitted under any circumstance.'::text, 'Overload'::text)
) AS v(idx, content, section);
