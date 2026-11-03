/**
 * Bilingual routing regression set (English, Arabic, Emirati Arabic, mixed).
 * `sticky` simulates saved conversation context for follow-up phrases.
 * `hard` marks the difficult examples named in the routing brief.
 */
import type { Intent, StickyKind } from "./intent";

export type RoutingCase = {
  text: string;
  expected: Intent;
  lang: "en" | "ar" | "ae" | "mix";
  sticky?: StickyKind;
  hard?: boolean;
};

const c = (expected: Intent, lang: RoutingCase["lang"], texts: string[], extra: Partial<RoutingCase> = {}): RoutingCase[] =>
  texts.map((text) => ({ text, expected, lang, ...extra }));

export const ROUTING_REGRESSION_SET: RoutingCase[] = [
  // ---- difficult examples from the brief
  { text: "I think the university should partner with more technology companies.", expected: "suggestion", lang: "en", hard: true },
  { text: "What jobs suit me?", expected: "career_counselling", lang: "en", hard: true },
  { text: "I have a problem with the evening bus.", expected: "complaint", lang: "en", hard: true },
  { text: "Who will teach machine learning in 2030?", expected: "university_fact_query", lang: "en", hard: true },
  { text: "Is UAEU-2026-01063 confirmed?", expected: "existing_case_followup", lang: "en", hard: true },
  { text: "أبغي أحول تخصصي", expected: "program_transfer", lang: "ae", hard: true },
  { text: "شو status مال طلبي؟", expected: "existing_case_followup", lang: "mix", sticky: "activeCase", hard: true },

  // ---- suggestion (topic words must not hijack)
  ...c("suggestion", "en", [
    "The university should offer more internships with local companies.",
    "It would be great if the library stayed open until midnight during exams.",
    "I suggest adding more evening buses to the women's campus.",
    "The career centre should add more workshops on interviews.",
    "It would be helpful if hostel rooms had better Wi-Fi.",
    "My suggestion is to make transfer between colleges easier.",
    "Why not add a prayer room in the engineering building?",
    "Please consider adding vegetarian options in the cafeteria.",
    "The university should introduce a mentoring programme with alumni.",
    "It would help if registration opened a week earlier.",
  ]),
  ...c("suggestion", "ar", [
    "أقترح أن توفر الجامعة فرص تدريب أكثر مع الشركات.",
    "اقتراحي زيادة ساعات عمل المكتبة أيام الامتحانات.",
    "أقترح إضافة حافلات مسائية إضافية.",
  ]),
  ...c("suggestion", "ae", [
    "ياليت الجامعة تسوي شراكات مع شركات التكنولوجيا.",
    "المفروض الجامعة تزيد الباصات بالليل.",
    "ودي لو المكتبة تفتح يوم السبت.",
    "يا ليت يزيدون ورش السيرة الذاتية.",
  ]),
  ...c("suggestion", "mix", ["أقترح الجامعة تضيف more internships مع الشركات", "ياليت يسوون career fair كل سمستر"]),

  // ---- complaint
  ...c("complaint", "en", [
    "The bus was late again this morning and I missed my exam.",
    "The staff at the registration office were rude to me.",
    "The Wi-Fi in my hostel room is not working for three days.",
    "I'm frustrated, nobody answers the phone at student affairs.",
    "The air conditioning in the library is broken.",
    "My grade appeal was handled unfairly.",
    "The portal keeps crashing when I try to pay fees.",
    "I want to complain about the cafeteria hygiene.",
    "The printer in the library is broken again.",
    "The shuttle driver was driving dangerously fast and it's unacceptable.",
  ]),
  ...c("complaint", "ar", ["أريد تقديم شكوى على خدمة النقل.", "عندي مشكلة مع الموظف في القبول والتسجيل.", "المكيف في القاعة خربان من أسبوع."]),
  ...c("complaint", "ae", [
    "الباص متأخر كل يوم والله متضايق.",
    "عندي مشكلة في السكن، الماي ما يشتغل.",
    "الموظف كان سيء وايد معاي.",
    "الواي فاي ما يشتغل في غرفتي.",
  ]),
  ...c("complaint", "mix", ["عندي problem مع الـ bus المسائي", "الـ portal ما يشتغل وهذي مشكلة"]),

  // ---- career
  ...c("career_counselling", "en", [
    "What careers fit my skills?",
    "Can you review my CV?",
    "Help me prepare for a job interview.",
    "What skills am I missing for a data analyst role?",
    "What can I do for work after I graduate?",
    "Which roles match my degree?",
    "Give me career advice for data science.",
    "What jobs suit a computer science student like me?",
    "How do I improve my resume?",
  ]),
  ...c("career_counselling", "ar", ["ما الوظيفة التي تناسبني؟", "أريد مراجعة سيرتي الذاتية.", "ساعدني في التحضير لمقابلة عمل."]),
  ...c("career_counselling", "ae", ["شو الوظايف اللي تناسبني؟", "شو أشتغل بعد التخرج؟", "أبغي أحد يشوف السيرة الذاتية مالي."]),
  ...c("career_counselling", "mix", ["شو الـ jobs اللي suit me؟", "أبغي review للـ CV مالي"]),

  // ---- library
  ...c("library_query", "en", [
    "Find me books about machine learning.",
    "Can I renew my book loan?",
    "What are the library opening hours on Friday?",
    "I need a textbook for STAT210.",
    "Do you have e-books on statistics?",
    "How do I borrow a book from the main library?",
    "I'm looking for books on Emirati history.",
    "Can I book a study room in the library?",
    "Find a journal article on renewable energy.",
  ]),
  ...c("library_query", "ar", ["أبحث عن كتب عن الذكاء الاصطناعي.", "كيف أجدد استعارة كتاب؟", "متى تفتح المكتبة يوم الجمعة؟"]),
  ...c("library_query", "ae", ["أبغي كتاب عن البرمجة من المكتبة.", "المكتبة تفتح متى اليوم؟"]),
  ...c("library_query", "mix", ["أبغي books عن machine learning", "المكتبة opening hours شو؟"]),

  // ---- hostel
  ...c("hostel_booking", "en", [
    "Can I book a room?",
    "I want to book a hostel room.",
    "Book me a room in Hostel A.",
    "I need student accommodation for next semester.",
    "Book room A-105 for me.",
    "Am I eligible for a hostel room?",
    "I completed 60 credits, can I move to a single room?",
    "How do I apply for a dorm?",
  ]),
  ...c("hostel_booking", "ar", ["أريد حجز غرفة في السكن الجامعي.", "هل أستحق السكن الجامعي؟", "أريد غرفة فردية في السكن."]),
  ...c("hostel_booking", "ae", ["أبغي أحجز غرفة.", "أبي سكن الجامعة.", "ابغي احجز سكن", "ودي أحجز غرفة في السكن."]),
  ...c("hostel_booking", "mix", ["أبغي أحجز room في الـ hostel", "can I book غرفة in Hostel B?"]),

  // ---- programme transfer
  ...c("program_transfer", "en", [
    "I want to transfer to Computer Science.",
    "Can I switch my major to Biology?",
    "How do I change my programme to a different college?",
    "Am I eligible for a programme transfer?",
    "I want to move to the College of Science.",
    "Can I change major from Data Science to Computer Science?",
    "What is the college transfer process?",
    "I'd like to transfer my programme.",
  ]),
  ...c("program_transfer", "ar", ["أريد التحويل إلى كلية العلوم.", "كيف أغير تخصصي إلى الأحياء؟", "هل يمكنني التحويل إلى برنامج علوم الحاسوب؟"]),
  ...c("program_transfer", "ae", ["أبغي أغير تخصصي.", "ابغي احول لكلية العلوم.", "ودي أنتقل لتخصص ثاني."]),
  ...c("program_transfer", "mix", ["أبغي transfer لـ Computer Science", "ابغي أحول major لـ Biology"]),

  // ---- appointment
  ...c("appointment", "en", [
    "I want to book an appointment with my academic advisor.",
    "Can I schedule a meeting with the career counsellor?",
    "Cancel my appointment tomorrow.",
    "Reschedule my meeting with student affairs.",
    "Book a session with a counsellor next week.",
    "I need to see my advisor.",
  ]),
  ...c("appointment", "ar", ["أريد حجز موعد مع المرشد الأكاديمي.", "ألغِ موعدي غداً."]),
  ...c("appointment", "ae", ["أبغي موعد مع المرشد.", "أبي أقابل المرشد الأكاديمي باجر."]),
  ...c("appointment", "mix", ["أبغي appointment مع الـ advisor"]),

  // ---- academic
  ...c("academic_query", "en", [
    "What is my GPA?",
    "How many credits do I have left to graduate?",
    "Which courses are remaining in my study plan?",
    "Do I have a hold on my registration?",
    "What are the prerequisites for STAT310?",
    "Can I drop a course after the deadline?",
    "Am I ready to register next semester?",
    "Show my transcript.",
  ]),
  ...c("academic_query", "ar", ["كم معدلي التراكمي؟", "كم ساعة باقية على تخرجي؟", "ما هي المتطلبات السابقة لهذا المقرر؟"]),
  ...c("academic_query", "ae", ["كم ساعاتي الحين؟", "متى تخرجي إذا كملت كذا؟"]),
  ...c("academic_query", "mix", ["كم الـ GPA مالي؟", "كم credits باقي لي؟"]),

  // ---- service request (documents)
  ...c("service_request", "en", [
    "I need an enrolment letter for the embassy.",
    "Can I get a to whom it may concern letter?",
    "Issue me a proof of study certificate.",
    "I need an official letter for my sponsor.",
    "Request a certificate of enrolment.",
  ]),
  ...c("service_request", "ar", ["أحتاج شهادة لمن يهمه الأمر.", "أريد إفادة قيد للسفارة."]),
  ...c("service_request", "ae", ["أبغي شهادة إلى من يهمه الأمر.", "أبي خطاب للبنك."]),
  ...c("service_request", "mix", ["أبغي enrolment letter للسفارة"]),

  // ---- existing case follow-up
  ...c("existing_case_followup", "en", [
    "What is the status of UAEU-2026-01080?",
    "Any update on UAEU-2026-00412?",
    "Has UAEU-2026-01011 been assigned?",
    "Is my request UAEU-2025-00991 closed?",
  ]),
  ...c("existing_case_followup", "en", ["What's the status of my request?", "Any update on my complaint?", "What happened with my case?"], { sticky: "activeCase" }),
  ...c("existing_case_followup", "ar", ["ما حالة الطلب UAEU-2026-01080؟", "ما حالة طلبي؟"], { sticky: "activeCase" }),
  ...c("existing_case_followup", "ae", ["وين وصل طلبي؟", "متى يخلص طلبي؟"], { sticky: "activeCase" }),

  // ---- objection / correction
  ...c("objection_correction", "en", [
    "That's wrong, I already completed 40 credits.",
    "No, I meant the Computer Science programme.",
    "You misunderstood my question.",
    "That's not what I asked.",
    "My record is wrong, my GPA is higher.",
  ]),
  ...c("objection_correction", "ar", ["هذا غير صحيح، فهمتني غلط.", "سجلي غلط، معدلي أعلى."]),
  ...c("objection_correction", "ae", ["مب صحيح، ما قصدت جذي.", "لا، قصدي علوم الحاسوب."]),

  // ---- human assistance
  ...c("human_assistance", "en", [
    "I want to talk to a human.",
    "Can I speak with a staff member?",
    "Let me talk to a real person please.",
    "Connect me with an officer.",
  ]),
  ...c("human_assistance", "ae", ["أبغي أكلم موظف.", "كلمني موظف حقيقي لو سمحت."]),
  ...c("human_assistance", "mix", ["أبغي أكلم موظف, not a bot"]),

  // ---- alert / emergency
  ...c("alert", "en", [
    "There is a fire in building F1!",
    "Someone collapsed near the library, call an ambulance.",
    "I lost my wallet near the cafeteria.",
    "My laptop was stolen from the study hall.",
    "There's smoke coming from the lab.",
    "Someone is following me on campus.",
  ]),
  ...c("alert", "ar", ["يوجد حريق في المبنى.", "فقدت هويتي في الحرم الجامعي."]),
  ...c("alert", "ae", ["ضاع تلفوني في المواقف.", "في دخان في المختبر!"]),

  // ---- university fact query
  ...c("university_fact_query", "en", [
    "Who teaches STAT210 next semester?",
    "When does the spring semester start?",
    "Where is the College of Science building?",
    "How many colleges does UAEU have?",
    "Who will be the dean of computing next year?",
    "When will the 2031 academic calendar be published?",
  ]),
  ...c("university_fact_query", "ar", ["متى يبدأ الفصل الدراسي الثاني؟", "أين تقع كلية العلوم؟"]),
  ...c("university_fact_query", "ae", ["منو يدرس تعلم الآلة السنة الجاية؟", "وين مبنى كلية العلوم؟"]),

  // ---- general query
  ...c("general_query", "en", ["Hello, what can you help me with?", "What services does Sanadi offer?", "How do you work?"]),
  ...c("general_query", "ar", ["ماذا يمكنك أن تفعل؟"]),

  // ---- sticky follow-ups
  { text: "And what happens to my credits?", expected: "program_transfer", lang: "en", sticky: "transferTarget" },
  { text: "زين", expected: "program_transfer", lang: "ae", sticky: "transferTarget" },
  { text: "the first one", expected: "appointment", lang: "en", sticky: "pendingAppointment" },
  { text: "تمام", expected: "hostel_booking", lang: "ae", sticky: "hostelFlow" },
  { text: "and the gaps?", expected: "career_counselling", lang: "en", sticky: "careerDomain" },

  // ---- topic change overrides sticky
  { text: "Actually, I want to book a hostel room.", expected: "hostel_booking", lang: "en", sticky: "transferTarget" },
  { text: "Forget the appointment, what jobs suit me?", expected: "career_counselling", lang: "en", sticky: "pendingAppointment" },
  { text: "I have a problem with the evening bus.", expected: "complaint", lang: "en", sticky: "hostelFlow" },
  { text: "أبغي أحول تخصصي", expected: "program_transfer", lang: "ae", sticky: "careerDomain" },
];
