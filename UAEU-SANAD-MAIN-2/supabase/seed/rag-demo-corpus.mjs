// Generates SQL for the Sanadi RAG demo/test corpus (clearly labelled demo content).
const D = (domain, unit, type, title, titleAr, lang, effective, sections, extra = {}) => ({
  domain, unit, type, title, titleAr, lang, effective, sections, ...extra,
});

const docs = [
  // ---------------------------------------------------------------- registration
  D("registration", "REG", "policy", "Undergraduate Course Registration Policy (Demo Corpus)", null, "en", "2026-01-05", [
    ["Registration periods", "Registration for each semester opens in three waves: priority registration for graduating students, then by completed credit hours in descending order, then open registration for all undergraduates. Each wave lasts three working days."],
    ["Credit load limits", "A student in good academic standing may register for a maximum of 18 credit hours in a regular semester. Students on academic probation are limited to 12 credit hours until their cumulative GPA returns to 2.00 or above."],
    ["Overload approval", "A load above 18 credit hours, up to 21, requires written approval from the academic advisor and the college dean. Overload is granted only to students with a cumulative GPA of 3.30 or higher who are within two semesters of graduation."],
    ["Minimum load", "Full-time undergraduate status requires at least 12 registered credit hours. Dropping below 12 credit hours affects scholarship eligibility, campus housing eligibility and student visa status where applicable."],
    ["Add and drop period", "Students may add or drop courses without academic or financial penalty during the first week of classes. Courses dropped in this period do not appear on the academic transcript."],
    ["Prerequisites", "The registration system blocks any course whose prerequisites are not completed with the minimum required grade. Prerequisite waivers are issued only by the course-owning department and must be recorded before the add and drop period closes."],
    ["Registration holds", "Financial, library, disciplinary and advising holds block registration. Holds must be cleared by the unit that placed them; the Registration Department cannot remove a hold placed by another unit."],
    ["Time conflicts", "Two courses whose scheduled meeting times overlap by any amount cannot be registered together. Laboratory and lecture sections of the same course are treated as a single registration unit."],
    ["Repeating a course", "A course in which a grade of D+ or lower was earned may be repeated twice. The highest grade is counted in the cumulative GPA, while all attempts remain visible on the transcript."],
    ["Summer registration", "The summer session allows a maximum of 9 credit hours. Courses with laboratory components may be excluded from the summer offering when contact hours cannot be met."],
    ["Late registration", "Late registration is permitted during the second week of classes with a late fee and advisor approval. No registration is accepted after the second week under any circumstance."],
    ["Section changes", "A change of section within the same course is treated as an add and drop transaction and is subject to the same deadlines and seat availability rules."],
  ]),
  D("registration", "REG", "guide", "دليل التسجيل للطلبة الجامعيين (محتوى تجريبي)", null, "ar", "2026-01-05", [
    ["فترات التسجيل", "يفتح التسجيل على ثلاث مراحل: أولوية لطلبة التخرج، ثم حسب الساعات المكتسبة تنازلياً، ثم تسجيل مفتوح لجميع الطلبة. تستمر كل مرحلة ثلاثة أيام عمل."],
    ["الحد الأعلى للساعات", "يحق للطالب المنتظم التسجيل بحد أقصى 18 ساعة معتمدة في الفصل الاعتيادي، بينما يقتصر الطالب المُنذَر أكاديمياً على 12 ساعة معتمدة حتى يرتفع معدله التراكمي إلى 2.00."],
    ["التسجيل الإضافي", "يتطلب تجاوز 18 ساعة وحتى 21 ساعة موافقة المرشد الأكاديمي وعميد الكلية، ويُمنح للطلبة الحاصلين على معدل تراكمي 3.30 فأعلى والمتوقع تخرجهم خلال فصلين."],
    ["الحد الأدنى للتسجيل", "يشترط تسجيل 12 ساعة معتمدة على الأقل لاعتبار الطالب منتظماً، ويؤثر النزول عن هذا الحد على المنح الدراسية والسكن الجامعي وحالة الإقامة الدراسية."],
    ["فترة الحذف والإضافة", "يمكن حذف أو إضافة المقررات دون أثر أكاديمي أو مالي خلال الأسبوع الأول من الدراسة، ولا تظهر المقررات المحذوفة في هذه الفترة على كشف الدرجات."],
    ["المتطلبات السابقة", "يمنع النظام تسجيل أي مقرر لم تُستوفَ متطلباته السابقة بالدرجة الدنيا المطلوبة، ولا يُقبل الاستثناء إلا من القسم صاحب المقرر قبل انتهاء فترة الحذف والإضافة."],
    ["حجب التسجيل", "تمنع الحجوزات المالية وحجوزات المكتبة والحجوزات التأديبية والإرشادية إتمام التسجيل، ويجب رفعها من الجهة التي وضعتها وليس من قسم التسجيل."],
    ["تعارض الأوقات", "لا يمكن الجمع بين مقررين يتعارض وقتهما ولو جزئياً، وتُعامل المحاضرة والمختبر لنفس المقرر كوحدة تسجيل واحدة."],
    ["إعادة المقرر", "يجوز إعادة المقرر الذي حصل فيه الطالب على تقدير D+ أو أقل مرتين كحد أقصى، ويُحتسب أعلى تقدير في المعدل التراكمي مع بقاء جميع المحاولات في السجل."],
    ["التسجيل الصيفي", "الحد الأعلى للفصل الصيفي 9 ساعات معتمدة، وقد تُستثنى المقررات ذات المختبرات عند تعذر استيفاء ساعات التواصل."],
  ]),

  // ---------------------------------------------------------------- withdrawal
  D("withdrawal", "REG", "policy", "Course Withdrawal Policy (Demo Corpus)", null, "en", "2026-01-10", [
    ["Standard withdrawal window", "A student may withdraw from an individual course from the second week of classes until the end of week ten of a regular semester. A grade of W is recorded and does not affect the cumulative GPA."],
    ["Late withdrawal", "Withdrawal after week ten is considered a late withdrawal and requires documented exceptional circumstances such as prolonged illness, bereavement or an approved medical leave. Late withdrawal requests are reviewed by a college committee, not by the assistant."],
    ["Evidence for late withdrawal", "A late withdrawal request must include a medical report from a licensed clinic, an official letter, or comparable documentary evidence covering the period in which attendance or assessment was affected."],
    ["Withdrawal limits", "A student may accumulate no more than four course withdrawals across the whole undergraduate degree. A fifth withdrawal is refused unless a college committee grants an exception."],
    ["Complete semester withdrawal", "Withdrawal from all registered courses in one semester is a semester withdrawal. It requires advisor clearance, financial clearance and, for residents, notification to Student Housing Services."],
    ["Financial effect", "Withdrawals during the first two weeks are eligible for a tuition refund according to the published refund schedule. Withdrawals after week two carry no refund entitlement."],
    ["Effect on academic standing", "Withdrawn credit hours count as attempted hours for academic progress monitoring and may affect scholarship conditions that require a minimum number of earned credit hours per year."],
    ["Effect on international students", "Students holding a study residence permit must maintain full-time status. A withdrawal that reduces the registered load below 12 credit hours requires prior clearance from Student Academic Services."],
    ["Withdrawal from an internship course", "An internship course may not be withdrawn after the placement has started without written agreement from Career and Internship Services and the host organisation."],
    ["Reversal of a withdrawal", "A processed withdrawal may only be reversed during the same withdrawal window and only when the seat is still available in the same section."],
  ]),
  D("withdrawal", "SAS", "guide", "دليل الانسحاب من المقررات (محتوى تجريبي)", null, "ar", "2026-01-10", [
    ["فترة الانسحاب المعتادة", "يجوز للطالب الانسحاب من مقرر منفرد اعتباراً من الأسبوع الثاني وحتى نهاية الأسبوع العاشر من الفصل الاعتيادي، ويُرصد تقدير W دون التأثير على المعدل التراكمي."],
    ["الانسحاب المتأخر", "يُعد الانسحاب بعد الأسبوع العاشر انسحاباً متأخراً ويستلزم ظروفاً استثنائية موثقة، وتتولى لجنة الكلية دراسته ولا يبتّ فيه المساعد الذكي."],
    ["المستندات المطلوبة", "يجب أن يرفق طلب الانسحاب المتأخر تقريراً طبياً من جهة مرخصة أو خطاباً رسمياً يغطي الفترة التي تأثر فيها الحضور أو التقييم."],
    ["حدود الانسحاب", "لا يزيد مجموع حالات الانسحاب عن أربعة مقررات طوال مرحلة البكالوريوس، ويُرفض الطلب الخامس ما لم توافق لجنة الكلية استثناءً."],
    ["الانسحاب من الفصل بالكامل", "يتطلب الانسحاب من جميع المقررات موافقة المرشد الأكاديمي والإخلاء المالي، وإشعار خدمات السكن الطلابي لقاطني السكن."],
    ["الأثر المالي", "يستحق الطالب استرداد الرسوم وفق الجدول المعلن عند الانسحاب خلال الأسبوعين الأولين، ولا يوجد استرداد بعد الأسبوع الثاني."],
    ["الأثر على الوضع الأكاديمي", "تُحتسب الساعات المنسحب منها ضمن الساعات المحاولة في متابعة التقدم الأكاديمي، وقد تؤثر على شروط المنح التي تشترط حداً أدنى من الساعات المكتسبة سنوياً."],
    ["طلبة الإقامة الدراسية", "يجب على حاملي الإقامة الدراسية الحفاظ على وضع الانتظام، ويستلزم الانسحاب الذي يخفض العبء دون 12 ساعة موافقة مسبقة من خدمات الطلبة الأكاديمية."],
  ]),

  // ---------------------------------------------------------------- internship
  D("internship", "CAREER", "policy", "Internship Eligibility and Placement Policy (Demo Corpus)", null, "en", "2026-01-20", [
    ["Credit hour threshold", "A student becomes eligible to register for the internship course after completing 80 credit hours of the degree plan. Registered but incomplete hours do not count towards the threshold."],
    ["GPA requirement", "A minimum cumulative GPA of 2.00 is required to start an internship. Students below 2.00 are advised to raise their standing before applying, as host organisations may set higher requirements."],
    ["Duration", "The standard internship is 240 contact hours completed over eight to twelve weeks. Part-time placements are accepted when the total contact hours are met within one semester."],
    ["Holds and clearances", "An active financial hold or an unresolved disciplinary case blocks internship placement. Government administration clearance is required before placement in a public-sector host organisation."],
    ["Placement matching", "Placements are matched using the student's programme, completed courses, declared skills and preferred emirate. Matching results are advisory; the final placement decision rests with the host organisation."],
    ["Application documents", "An internship application requires an up-to-date CV, a current academic transcript, a signed training agreement and, for some hosts, a passport or Emirates ID copy."],
    ["Supervision", "Every placement has an academic supervisor from the college and a workplace supervisor from the host organisation. Both submit an evaluation at the end of the placement."],
    ["Attendance and absence", "More than three unexcused absence days during a placement may result in a failing internship grade. Absence for medical reasons must be reported to both supervisors within 48 hours."],
    ["Evaluation and grade", "The internship grade combines the workplace supervisor evaluation, the academic supervisor report and the final student reflective report, and is recorded as pass or fail."],
    ["Changing a placement", "A placement may be changed only within the first two weeks and only when the host organisation confirms the release in writing."],
    ["Summer internships", "Summer placements follow the same eligibility rules but must complete the full contact hours before the start of the following semester."],
    ["Insurance and safety", "Students on placement are covered by the university student insurance. Any workplace incident must be reported to Career and Internship Services on the same working day."],
  ]),
  D("internship", "CAREER", "guide", "دليل التدريب العملي (محتوى تجريبي)", null, "ar", "2026-01-20", [
    ["شرط الساعات المعتمدة", "يصبح الطالب مؤهلاً لتسجيل مقرر التدريب العملي بعد إتمام 80 ساعة معتمدة من الخطة الدراسية، ولا تُحتسب الساعات المسجلة غير المكتملة ضمن هذا الشرط."],
    ["شرط المعدل التراكمي", "يشترط معدل تراكمي لا يقل عن 2.00 لبدء التدريب، وقد تشترط بعض جهات التدريب معدلاً أعلى."],
    ["مدة التدريب", "المدة المعيارية 240 ساعة تدريبية تُنجز خلال ثمانية إلى اثني عشر أسبوعاً، ويُقبل التدريب الجزئي إذا اكتملت الساعات خلال الفصل نفسه."],
    ["الحجوزات والتصاريح", "يمنع الحجز المالي أو القضية التأديبية غير المنتهية إتمام التدريب، ويُشترط تصريح الإدارة الحكومية للتدريب في الجهات الحكومية."],
    ["مطابقة الفرص", "تُقترح فرص التدريب بناءً على البرنامج الأكاديمي والمقررات المنجزة والمهارات والإمارة المفضلة، ويبقى القرار النهائي لجهة التدريب."],
    ["مستندات الطلب", "يتطلب الطلب سيرة ذاتية محدثة وكشف درجات حديثاً واتفاقية تدريب موقعة، وقد تطلب بعض الجهات نسخة من الهوية الإماراتية أو جواز السفر."],
    ["الإشراف", "لكل تدريب مشرف أكاديمي من الكلية ومشرف ميداني من جهة التدريب، ويقدم كلاهما تقييماً في نهاية المدة."],
    ["الحضور والغياب", "قد يؤدي تجاوز ثلاثة أيام غياب دون عذر إلى رسوب الطالب في التدريب، ويجب إبلاغ المشرفين خلال 48 ساعة في حالات الغياب المرضي."],
    ["التقييم والدرجة", "تُحتسب درجة التدريب من تقييم المشرف الميداني وتقرير المشرف الأكاديمي والتقرير الختامي للطالب، وتُرصد نجاحاً أو رسوباً."],
    ["التأمين والسلامة", "يشمل تأمين الطلبة المتدربين أثناء فترة التدريب، ويجب إبلاغ خدمات المهن والتدريب بأي حادث في نفس يوم العمل."],
  ]),

  // ---------------------------------------------------------------- housing
  D("housing", "HOUS", "policy", "Student Housing Allocation Policy (Demo Corpus)", null, "en", "2026-02-10", [
    ["Eligibility", "On-campus housing is offered to full-time undergraduate students registered for at least 12 credit hours whose permanent address is outside Al Ain. Priority is given to first-year and final-year students."],
    ["Application window", "Housing applications open eight weeks before the start of each semester and close two weeks before classes begin. Late applications are placed on the waiting list only."],
    ["Room allocation", "Rooms are allocated by application date, academic level and documented accessibility or medical needs. Roommate preferences are honoured when both students request each other before the closing date."],
    ["Bed reservation", "A bed reservation is confirmed only after the housing fee deposit is recorded. Unconfirmed reservations expire after 72 hours and the bed returns to the available pool."],
    ["Fees and refunds", "Housing fees are charged per semester. A resident who checks out before the end of week four receives a fifty per cent refund; no refund is issued after week four."],
    ["Check-in and check-out", "Check-in requires an Emirates ID, a residence permit copy where applicable and a signed room condition report. Check-out requires a room inspection and the return of keys and access cards."],
    ["Maintenance requests", "Routine maintenance requests are resolved within three working days. Requests affecting safety, water supply, electricity or air conditioning are treated as urgent and resolved within 24 hours."],
    ["Visitors and quiet hours", "Visitors are permitted only in designated common areas during published visiting hours. Quiet hours are observed from 11 pm to 7 am daily and are extended during examination weeks."],
    ["Conduct in residence", "Cooking appliances, smoking and unauthorised room changes are prohibited. Repeated conduct violations may lead to the withdrawal of housing eligibility for the following semester."],
    ["Vacation periods", "Residence halls close during the winter and summer breaks except for approved stay-over requests submitted at least ten days in advance."],
    ["Transport link", "Residents are eligible for the campus bus service. Bus schedules and any changes are published by Transportation Services in both Arabic and English."],
    ["Accessibility accommodation", "Accessible rooms are reserved for students registered with Accessibility Support Services and are allocated before general room assignment."],
  ]),
  D("housing", "HOUS", "guide", "دليل السكن الطلابي (محتوى تجريبي)", null, "ar", "2026-02-10", [
    ["شروط الأهلية", "يُتاح السكن الجامعي للطلبة المنتظمين المسجلين 12 ساعة معتمدة على الأقل ممن تقع إقامتهم الدائمة خارج مدينة العين، مع أولوية لطلبة السنة الأولى وسنة التخرج."],
    ["فترة التقديم", "يفتح باب التقديم قبل ثمانية أسابيع من بداية الفصل ويغلق قبل أسبوعين من انطلاق الدراسة، وتوضع الطلبات المتأخرة على قائمة الانتظار."],
    ["توزيع الغرف", "تُوزع الغرف حسب تاريخ التقديم والمستوى الدراسي والاحتياجات الطبية الموثقة، وتُراعى رغبات الشريك في السكن عند تقديم الطرفين للطلب قبل موعد الإغلاق."],
    ["حجز السرير", "لا يُعتمد حجز السرير إلا بعد تسجيل دفعة رسوم السكن، وتنتهي صلاحية الحجز غير المؤكد خلال 72 ساعة ليعود السرير إلى الأسرّة المتاحة."],
    ["الرسوم والاسترداد", "تُحتسب رسوم السكن لكل فصل دراسي، ويستحق المغادر قبل نهاية الأسبوع الرابع استرداد خمسين بالمئة، ولا استرداد بعد ذلك."],
    ["الاستلام والإخلاء", "يتطلب الاستلام الهوية الإماراتية وتقرير حالة الغرفة موقعاً، ويتطلب الإخلاء معاينة الغرفة وتسليم المفاتيح وبطاقات الدخول."],
    ["طلبات الصيانة", "تُنجز طلبات الصيانة الاعتيادية خلال ثلاثة أيام عمل، وتُعامل الأعطال المتعلقة بالسلامة أو الكهرباء أو التكييف كطلبات عاجلة تُنجز خلال 24 ساعة."],
    ["الزوار وساعات الهدوء", "يُسمح باستقبال الزوار في الأماكن المخصصة ضمن الأوقات المعلنة، وتُطبق ساعات الهدوء من الحادية عشرة مساءً حتى السابعة صباحاً وتُمدد في فترة الامتحانات."],
  ]),

  // ---------------------------------------------------------------- transfer
  D("transfer", "REG", "policy", "Inter-College Transfer Policy (Demo Corpus)", null, "en", "2026-01-18", [
    ["Credit window", "An inter-college transfer request is accepted from students who have completed between 12 and 38 credit hours. Requests outside this window are refused because the receiving college cannot map the remaining plan."],
    ["GPA requirement", "A cumulative GPA of 2.50 or above is required. Some colleges publish a higher programme-specific threshold, which overrides the university minimum."],
    ["Application timing", "Transfer applications are accepted during the two weeks following the publication of final grades and before the start of the next registration wave."],
    ["Seat availability", "Every transfer is subject to a confirmed seat in the receiving programme. Seats are allocated in order of application once eligibility is verified, and a reserved seat expires if the student does not confirm within five working days."],
    ["Course mapping", "The receiving college maps completed courses to the new degree plan. Courses that do not map become free elective credit or are excluded, which may extend the expected graduation date."],
    ["Graduation delay analysis", "Before confirmation, the student receives an impact analysis showing mapped credit hours, lost credit hours and the revised expected graduation semester."],
    ["One transfer rule", "A student may complete only one inter-college transfer during the undergraduate degree. A second transfer requires an exception approved by the college dean."],
    ["Effect on scholarships", "A transfer may change scholarship conditions where the award is tied to a specific programme. Student Accounts confirms the financial effect before the transfer is finalised."],
    ["Withdrawn courses on transfer", "Course withdrawals recorded before the transfer remain on the transcript and continue to count towards the four-withdrawal limit."],
    ["Effect on housing and internship", "An approved transfer does not cancel a housing allocation, but it may change internship eligibility because the credit hour count is recalculated against the new degree plan."],
  ]),
  D("transfer", "REG", "guide", "دليل التحويل بين الكليات (محتوى تجريبي)", null, "ar", "2026-01-18", [
    ["نطاق الساعات", "يُقبل طلب التحويل بين الكليات من الطلبة الذين أنجزوا بين 12 و38 ساعة معتمدة، ويُرفض الطلب خارج هذا النطاق لتعذر مطابقة الخطة المتبقية."],
    ["شرط المعدل", "يشترط معدل تراكمي 2.50 فأعلى، وقد تعلن بعض الكليات حداً أعلى خاصاً بالبرنامج يُعمل به بدلاً من الحد الجامعي."],
    ["موعد التقديم", "تُقبل طلبات التحويل خلال أسبوعين من إعلان النتائج النهائية وقبل بدء مرحلة التسجيل التالية."],
    ["توفر المقاعد", "يخضع كل تحويل لتوفر مقعد مؤكد في البرنامج المستقبِل، ويُحجز المقعد بترتيب الطلبات وينتهي الحجز إذا لم يؤكد الطالب خلال خمسة أيام عمل."],
    ["معادلة المقررات", "تتولى الكلية المستقبِلة معادلة المقررات المنجزة مع الخطة الجديدة، وقد تتحول المقررات غير المطابقة إلى مواد اختيارية حرة أو تُستبعد مما قد يؤخر التخرج."],
    ["تحليل أثر التخرج", "يحصل الطالب قبل التأكيد على تحليل يوضح الساعات المعادَلة والساعات المفقودة وفصل التخرج المتوقع بعد التحويل."],
    ["مرة واحدة", "يُسمح بتحويل واحد بين الكليات خلال مرحلة البكالوريوس، ويتطلب التحويل الثاني استثناءً من عميد الكلية."],
    ["الأثر على المنح والسكن", "قد يغير التحويل شروط المنحة المرتبطة ببرنامج محدد، ولا يلغي تخصيص السكن، وقد يعيد احتساب أهلية التدريب العملي وفق الخطة الجديدة."],
  ]),

  // ---------------------------------------------------------------- documents
  D("documents", "SAS", "procedure", "Official Student Documents Procedure (Demo Corpus)", null, "en", "2026-02-01", [
    ["Available documents", "Students may request an enrolment letter, a to whom it may concern letter, an unofficial transcript, a grade report and a graduation expectation letter through the digital services portal."],
    ["Processing time", "Digitally generated letters are issued immediately. Documents requiring manual verification, such as sealed transcripts, take up to three working days."],
    ["Verification", "Every generated letter carries a QR code and a verification token. Any recipient can verify a letter without signing in, and verification shows the issue date and document status."],
    ["Retention", "Generated documents remain downloadable for thirty days, after which the file is permanently deleted. A new copy can be generated at any time while the student is active."],
    ["Language", "Letters are available in Arabic and English. The Arabic version is generated right to left with the official Arabic name recorded in the student record."],
    ["Accuracy of personal data", "Names printed on official documents follow the passport or Emirates ID record. Corrections must be made in the student record before the document is generated."],
    ["Documents for embassies", "Letters addressed to an embassy or a government entity must name the recipient entity. A generic letter may be refused by the receiving authority."],
    ["Documents with financial holds", "An active financial hold blocks sealed transcripts and graduation documents, but does not block a basic enrolment letter."],
    ["Graduation documents", "Degree certificates and final sealed transcripts are issued by Student Academic Services after graduation clearance is complete and are collected in person or by an authorised representative."],
    ["Lost documents", "A replacement of a sealed document is issued on request with a replacement fee, and the earlier copy remains valid unless it was reported as compromised."],
  ]),
  D("documents", "SAS", "guide", "دليل الوثائق الطلابية الرسمية (محتوى تجريبي)", null, "ar", "2026-02-01", [
    ["الوثائق المتاحة", "يمكن للطالب طلب إفادة قيد وخطاب لمن يهمه الأمر وكشف درجات غير رسمي وتقرير درجات وإفادة توقع تخرج عبر بوابة الخدمات الرقمية."],
    ["مدة الإنجاز", "تُصدر الخطابات الرقمية فوراً، بينما تستغرق الوثائق التي تتطلب تدقيقاً يدوياً مثل كشف الدرجات المختوم حتى ثلاثة أيام عمل."],
    ["التحقق", "يحمل كل خطاب رمز استجابة سريعة ورمز تحقق، ويمكن لأي جهة التحقق من صحته دون تسجيل دخول مع بيان تاريخ الإصدار وحالة الوثيقة."],
    ["مدة الاحتفاظ", "تبقى الوثائق متاحة للتحميل ثلاثين يوماً ثم تُحذف نهائياً، ويمكن إصدار نسخة جديدة في أي وقت أثناء استمرار قيد الطالب."],
    ["اللغة", "تتوفر الخطابات بالعربية والإنجليزية، وتُصدر النسخة العربية بتنسيق من اليمين إلى اليسار بالاسم العربي الرسمي المسجل."],
    ["الحجوزات المالية", "يمنع الحجز المالي إصدار كشف الدرجات المختوم ووثائق التخرج، ولا يمنع إصدار إفادة القيد الأساسية."],
    ["وثائق السفارات", "يجب أن يتضمن الخطاب الموجه إلى سفارة أو جهة حكومية اسم الجهة المستقبِلة، وقد تُرفض الخطابات العامة."],
    ["الوثائق المفقودة", "يمكن إصدار بدل فاقد للوثائق المختومة مقابل رسوم، وتبقى النسخة السابقة سارية ما لم يُبلَّغ عن فقدانها."],
  ]),

  // ---------------------------------------------------------------- library
  D("library", "LIB", "service_guide", "Library Services Guide (Demo Corpus)", null, "en", "2026-02-15", [
    ["Borrowing limits", "Undergraduate students may borrow up to eight items at a time for fourteen days. Graduate students may borrow up to fifteen items for twenty-eight days."],
    ["Renewals", "An item may be renewed twice online if no other reader has placed a hold on it. A third renewal requires returning the item to the circulation desk."],
    ["Overdue items", "Overdue items generate a daily fine per item. A library hold is placed on the student record once fines exceed the published threshold, and the hold blocks registration."],
    ["Discovery search", "The library catalogue search covers the physical collection, e-books and licensed databases, and shows availability such as available on shelf, on loan or online access."],
    ["Off-campus access", "Licensed databases are available off campus through the university single sign-on. Access is limited to current students and staff under the licence terms."],
    ["Study rooms", "Group study rooms are booked for up to three hours per day per student. A booking is released if the room is not occupied within fifteen minutes of the start time."],
    ["Interlibrary loan", "Items not held by the library can be requested through interlibrary loan, which typically takes seven to fourteen days depending on the supplying library."],
    ["Reference help", "Librarians provide reference help for research questions, database selection and citation formatting in person, by email and through the assistant."],
    ["Citation support", "The library supports APA, MLA, IEEE and Chicago styles, and the catalogue can export a formatted citation for any catalogue record."],
    ["Special collections", "Rare and archival material is consulted in the reading room only and cannot be borrowed. Digitisation requests are reviewed by the collections team."],
    ["Opening hours", "The main library opens Monday to Thursday from 8 am to 10 pm and on Friday from 8 am to 12 pm. Hours are extended during examination periods."],
    ["Library holds and graduation", "All borrowed items must be returned and all fines cleared before graduation clearance is granted."],
  ]),
  D("library", "LIB", "guide", "دليل خدمات المكتبة (محتوى تجريبي)", null, "ar", "2026-02-15", [
    ["حدود الاستعارة", "يمكن لطلبة البكالوريوس استعارة ثمانية أوعية لمدة أربعة عشر يوماً، ولطلبة الدراسات العليا استعارة خمسة عشر وعاءً لمدة ثمانية وعشرين يوماً."],
    ["التجديد", "يمكن تجديد الاستعارة مرتين إلكترونياً ما لم يحجزها قارئ آخر، ويتطلب التجديد الثالث إحضار الوعاء إلى مكتب الإعارة."],
    ["التأخير", "تُحتسب غرامة يومية عن كل وعاء متأخر، ويُوضع حجز مكتبي على سجل الطالب عند تجاوز الحد المعلن مما يمنع التسجيل."],
    ["البحث في الفهرس", "يشمل البحث في فهرس المكتبة المجموعة الورقية والكتب الإلكترونية وقواعد البيانات المرخصة، ويوضح حالة التوفر مثل متاح على الرف أو معار أو متاح إلكترونياً."],
    ["الوصول من خارج الحرم", "تتاح قواعد البيانات المرخصة من خارج الحرم عبر الدخول الموحد، ويقتصر الوصول على الطلبة والموظفين الحاليين وفق شروط الترخيص."],
    ["قاعات الدراسة", "تُحجز قاعات الدراسة الجماعية لمدة ثلاث ساعات يومياً لكل طالب، ويُلغى الحجز إذا لم تُشغل القاعة خلال خمس عشرة دقيقة."],
    ["الإعارة بين المكتبات", "يمكن طلب الأوعية غير المتوفرة عبر الإعارة بين المكتبات، وتستغرق عادة من سبعة إلى أربعة عشر يوماً."],
    ["الدعم المرجعي", "يقدم أمناء المكتبة دعماً مرجعياً في أسئلة البحث واختيار قواعد البيانات وتنسيق الاستشهادات حضورياً وعبر البريد والمساعد الذكي."],
  ]),

  // ---------------------------------------------------------------- career
  D("career", "CAREER", "service_guide", "Career Counselling Service Guide (Demo Corpus)", null, "en", "2026-02-05", [
    ["Service scope", "Career and Internship Services offers CV review, interview preparation, career counselling appointments, skill gap analysis and employer connection events."],
    ["CV review", "An uploaded CV is analysed for structure, keyword coverage, measurable achievements and formatting compatibility with applicant tracking systems. The resulting score is advisory."],
    ["ATS scoring", "The applicant tracking score is deterministic and evidence based: it reports which sections, skills and keywords were found in the document rather than an opaque overall judgement."],
    ["Skill gap analysis", "Skill gaps compare the skills evidenced in the student record and CV with the skills requested by target roles, and suggest courses, certificates or projects to close each gap."],
    ["Academic mode matching", "When no CV is uploaded, role matching uses the academic record only: programme, completed courses, projects and declared interests."],
    ["Appointment booking", "Counselling appointments are booked through the digital services portal. Each appointment lasts thirty minutes and can be rescheduled up to four hours before the start time."],
    ["Employer events", "Career fairs and employer sessions are announced each semester. Registration closes when the venue capacity is reached."],
    ["Document safety", "Uploaded CVs are scanned before processing. Files that fail the safety scan are rejected and are not stored."],
    ["Privacy of CV data", "CV content is used only for the student's own matching and counselling. It is never shared with an employer without the student's explicit consent."],
    ["Deleting a CV", "A student may delete an uploaded CV at any time. Deletion removes the stored file permanently and clears derived matching results."],
  ]),
  D("career", "CAREER", "guide", "دليل الإرشاد المهني (محتوى تجريبي)", null, "ar", "2026-02-05", [
    ["نطاق الخدمة", "تقدم خدمات المهن والتدريب مراجعة السيرة الذاتية والتحضير للمقابلات ومواعيد الإرشاد المهني وتحليل فجوات المهارات وفعاليات التواصل مع أصحاب العمل."],
    ["مراجعة السيرة الذاتية", "تُحلل السيرة الذاتية من حيث البنية وتغطية الكلمات المفتاحية والإنجازات القابلة للقياس والتوافق مع أنظمة تتبع المتقدمين، وتبقى النتيجة استرشادية."],
    ["تقييم التوافق", "يُحتسب تقييم أنظمة التتبع بطريقة محددة ومبنية على الأدلة، ويوضح الأقسام والمهارات والكلمات المفتاحية التي عُثر عليها في الملف."],
    ["تحليل فجوات المهارات", "يقارن التحليل المهارات الموثقة في السجل الأكاديمي والسيرة الذاتية بمتطلبات الوظائف المستهدفة ويقترح مقررات أو شهادات أو مشاريع لسد كل فجوة."],
    ["المطابقة الأكاديمية", "عند عدم رفع سيرة ذاتية تعتمد المطابقة على السجل الأكاديمي فقط من برنامج ومقررات منجزة ومشاريع واهتمامات معلنة."],
    ["حجز الموعد", "تُحجز مواعيد الإرشاد عبر بوابة الخدمات الرقمية، ومدة الموعد ثلاثون دقيقة ويمكن تعديله قبل أربع ساعات من موعده."],
    ["خصوصية البيانات", "تُستخدم بيانات السيرة الذاتية لمصلحة الطالب فقط، ولا تُشارك مع جهة توظيف دون موافقته الصريحة."],
    ["حذف السيرة الذاتية", "يمكن للطالب حذف سيرته الذاتية في أي وقت، ويؤدي الحذف إلى إزالة الملف نهائياً ومسح نتائج المطابقة المشتقة منه."],
  ]),

  // ---------------------------------------------------------------- complaints
  D("complaints", "COMP", "procedure", "Student Complaints and Suggestions Procedure (Demo Corpus)", null, "en", "2026-03-01", [
    ["Scope", "The procedure covers complaints about services, facilities, administrative decisions and staff conduct, and suggestions for improving university services."],
    ["Informal resolution", "Students are encouraged to raise the issue with the responsible unit first. Many service issues are resolved informally within two working days."],
    ["Formal complaint", "A formal complaint is recorded with a reference number, a responsible unit and a service level target. The student can track progress at any time."],
    ["Service levels", "The first response target is two working days for standard complaints and four working hours for urgent complaints affecting safety, examinations or residence."],
    ["Escalation", "A complaint that breaches its resolution target is escalated automatically to the unit manager, and a second breach is escalated to the service oversight level."],
    ["Anonymous reporting", "A complaint may be submitted anonymously, but an anonymous case cannot receive a personal outcome notification and may be harder to investigate."],
    ["Confidentiality", "Complaint details are visible only to the student, the assigned handlers in the responsible unit and oversight roles. Case content is never shared with unrelated units."],
    ["Suggestions lifecycle", "A suggestion moves from submitted to under review, then to accepted, implemented or declined with a stated reason. The student is notified at each transition."],
    ["Appeals", "A student who is not satisfied with the outcome may request a review within ten working days of the closure notification."],
    ["Grievances about grades", "Grade grievances follow the academic appeal route through the college and are not handled as service complaints."],
  ]),
  D("complaints", "COMP", "guide", "دليل الشكاوى والاقتراحات الطلابية (محتوى تجريبي)", null, "ar", "2026-03-01", [
    ["النطاق", "يشمل الإجراء الشكاوى المتعلقة بالخدمات والمرافق والقرارات الإدارية وسلوك الموظفين، والاقتراحات الرامية إلى تحسين الخدمات الجامعية."],
    ["الحل الودي", "يُنصح الطالب بعرض المشكلة على الجهة المعنية أولاً، إذ تُحل كثير من الملاحظات الخدمية ودياً خلال يومي عمل."],
    ["الشكوى الرسمية", "تُسجل الشكوى الرسمية برقم مرجعي وجهة مسؤولة ومدة استجابة محددة، ويمكن للطالب متابعة حالتها في أي وقت."],
    ["مستويات الخدمة", "مدة الاستجابة الأولى يوما عمل للشكاوى الاعتيادية وأربع ساعات عمل للشكاوى العاجلة المتعلقة بالسلامة أو الامتحانات أو السكن."],
    ["التصعيد", "تُصعَّد الشكوى تلقائياً إلى مدير الوحدة عند تجاوز مدة الحل، ويؤدي التجاوز الثاني إلى التصعيد لمستوى الإشراف على الخدمة."],
    ["الإبلاغ دون هوية", "يمكن تقديم الشكوى دون ذكر الهوية، إلا أن ذلك يحول دون إشعار الطالب بالنتيجة وقد يصعّب التحقيق."],
    ["السرية", "تظهر تفاصيل الشكوى للطالب وللمعالجين المكلفين في الجهة المسؤولة ولأدوار الإشراف فقط، ولا تُشارك مع جهات غير معنية."],
    ["دورة حياة الاقتراح", "ينتقل الاقتراح من مُقدَّم إلى قيد الدراسة ثم إلى مقبول أو مُنفَّذ أو مرفوض مع بيان السبب، ويُشعر الطالب عند كل انتقال."],
  ]),

  // ---------------------------------------------------------------- general
  D("general", "SAS", "service_guide", "General Student Services Guide (Demo Corpus)", null, "en", "2026-01-12", [
    ["Student card", "The student card is issued at Student Academic Services and is used for library borrowing, building access, campus buses and examination identification."],
    ["Financial holds", "A financial hold is placed when an outstanding balance passes the published threshold. It blocks registration, sealed transcripts and graduation clearance until settled or a payment plan is approved."],
    ["Payment plans", "Student Accounts may approve an instalment plan for an outstanding balance. An approved plan lifts the registration hold while instalments are paid on schedule."],
    ["Academic advising", "Each student is assigned an academic advisor who approves the study plan each semester and supports course selection, overload requests and academic recovery plans."],
    ["Academic probation", "A cumulative GPA below 2.00 places a student on probation. Probation requires an advising meeting, a reduced credit load and a documented recovery plan."],
    ["Graduation requirements", "Graduation requires completion of the published degree plan credit hours, a cumulative GPA of at least 2.00, completion of the internship requirement where applicable and full clearance from all units."],
    ["Emergency contacts", "Campus security operates twenty-four hours. Medical emergencies on campus are directed to the campus clinic, and off-campus emergencies to the national emergency number."],
    ["Accessibility support", "Students with a documented disability register with Accessibility Support Services to arrange examination accommodations, accessible housing and assistive technology."],
    ["IT support", "Password resets, university email problems, wireless access and portal errors are handled by Information Technology Support, with a first response target of one working day."],
    ["Transport", "Campus and city bus routes serve residence halls, academic buildings and selected city stops. Route changes are announced at least three days in advance."],
    ["Counselling and wellbeing", "Confidential personal counselling is available by appointment. Counselling records are kept separate from the academic record."],
    ["Feedback", "Students can rate any completed service interaction. Ratings feed the service quality dashboards reviewed by unit managers each month."],
  ]),
  D("general", "SAS", "guide", "دليل الخدمات الطلابية العامة (محتوى تجريبي)", null, "ar", "2026-01-12", [
    ["البطاقة الجامعية", "تُصدر البطاقة الجامعية من خدمات الطلبة الأكاديمية وتُستخدم للاستعارة من المكتبة ودخول المباني وحافلات الحرم والتعريف في الامتحانات."],
    ["الحجوزات المالية", "يُوضع الحجز المالي عند تجاوز الرصيد المستحق الحد المعلن، ويمنع التسجيل وإصدار كشف الدرجات المختوم وإخلاء التخرج حتى السداد أو اعتماد خطة تقسيط."],
    ["خطط السداد", "قد تعتمد إدارة حسابات الطلبة خطة تقسيط للرصيد المستحق، ويُرفع حجز التسجيل ما دام الطالب ملتزماً بمواعيد الأقساط."],
    ["الإرشاد الأكاديمي", "يُخصص لكل طالب مرشد أكاديمي يعتمد خطته الدراسية كل فصل ويدعمه في اختيار المقررات وطلبات العبء الإضافي وخطط التحسين الأكاديمي."],
    ["الإنذار الأكاديمي", "ينذر الطالب أكاديمياً عند انخفاض معدله التراكمي دون 2.00، ويستلزم ذلك لقاءً إرشادياً وتخفيض العبء الدراسي وخطة تحسين موثقة."],
    ["متطلبات التخرج", "يتطلب التخرج إنجاز ساعات الخطة الدراسية المعلنة ومعدل تراكمي لا يقل عن 2.00 واستيفاء متطلب التدريب العملي عند وجوده وإتمام الإخلاء من جميع الجهات."],
    ["الطوارئ", "يعمل أمن الحرم الجامعي على مدار الساعة، وتُوجَّه الحالات الطبية داخل الحرم إلى العيادة الجامعية والحالات خارجه إلى رقم الطوارئ الوطني."],
    ["الدعم التقني", "تتولى إدارة الدعم التقني إعادة تعيين كلمات المرور ومشكلات البريد الجامعي والشبكة اللاسلكية وأعطال البوابة، بمدة استجابة أولى يوم عمل واحد."],
  ]),
];

// Conflict test pair: two current approved documents disagreeing on the late
// withdrawal deadline, used to validate POLICY_CONFLICT detection.
docs.push(
  D("withdrawal", "SAS", "procedure", "College Withdrawal Practice Note (Demo Corpus — Conflict Test)", null, "en", "2026-02-20", [
    ["Late withdrawal deadline", "Students may withdraw from a course up to the end of week twelve of a regular semester without exceptional circumstances documentation. A grade of W is recorded."],
    ["Committee review", "Withdrawal requests submitted after week twelve are reviewed by the college committee within five working days."],
  ]),
);

// Expired policy: must never outrank the current registration policy.
docs.push(
  D("registration", "REG", "policy", "Superseded Registration Load Policy 2019 (Demo Corpus — Expired Test)", null, "en", "2019-09-01", [
    ["Credit load limits", "The maximum registration load in a regular semester is 15 credit hours for all undergraduate students regardless of academic standing."],
    ["Overload", "No overload above 15 credit hours is permitted under any circumstance."],
  ], { expiry: "2025-08-31" }),
);

const esc = (s) => s.replace(/'/g, "''");
let sql = [
  "-- Sanadi RAG demo/test corpus. All content is clearly labelled demo material",
  "-- prepared for retrieval-quality validation, not official UAEU policy text.",

];

for (const d of docs) {
  const id = `gen_random_uuid()`;
  sql.push(`
WITH ins AS (
  INSERT INTO public.knowledge_documents
    (title, description, language, document_type, version, effective_date, expiry_date,
     is_official, confidentiality, confidentiality_level, is_active, approval_status,
     is_current, official_status, intended_audience, knowledge_domain, service_unit_id, owner_unit_id,
     notes, chunking_status, embedding_status, indexing_status, extraction_status, processing_status, quality_status)
  SELECT
    '${esc(d.title)}',
    'Demo/test knowledge content prepared for Sanadi retrieval validation. Not an official university policy.',
    '${d.lang}', '${d.type}', '1.0', DATE '${d.effective}', ${d.expiry ? `DATE '${d.expiry}'` : "NULL"},
    false, 'public', 'student_authenticated', true, 'approved',
    ${d.expiry ? "false" : "true"}, 'official', 'students', '${d.domain}',
    (SELECT id FROM public.service_units WHERE code = '${d.unit}' LIMIT 1),
    (SELECT id FROM public.service_units WHERE code = '${d.unit}' LIMIT 1),
    'rag_demo_v1', 'completed', 'completed', 'completed', 'completed', 'indexed', 'passed'
  WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_documents kd WHERE kd.title = '${esc(d.title)}')
  RETURNING id
)
INSERT INTO public.document_chunks (document_id, chunk_index, content, section_title, section_path, page_number, source_locator, metadata, token_count, is_active)
SELECT ins.id, v.idx, v.content, v.section, v.section, 1 + (v.idx / 4), 'Section ' || v.section,
       jsonb_build_object('corpus','rag_demo_v1','demo',true,'domain','${d.domain}'),
       greatest(20, length(v.content) / 4), true
FROM ins, (VALUES
${d.sections.map(([t, c], i) => `  (${i}, '${esc(c)}'::text, '${esc(t)}'::text)`).join(",\n")}
) AS v(idx, content, section);`);
}

console.log(sql.join("\n"));
console.error(`docs=${docs.length} chunks=${docs.reduce((a, d) => a + d.sections.length, 0)}`);
