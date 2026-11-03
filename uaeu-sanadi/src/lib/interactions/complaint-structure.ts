/**
 * Deterministic complaint structuring.
 *
 * A complaint must arrive at the responsible officer as something they can act
 * on: what happened, where, when, how often, what it cost the student and what
 * the student is asking for. Everything here is derived from the student's own
 * words — nothing is invented, and a field that cannot be derived stays null so
 * the officer (or one focused question) fills it in.
 */

export type StructuredComplaint = {
  complaintType: string;
  categoryPath: string;
  categoryPathAr: string;
  issueEn: string;
  issueAr: string;
  /** The single incident the student described, when they described one. */
  incident: string | null;
  impact: string | null;
  requestedAction: string;
  requestedActionAr: string;
  route: string | null;
  location: string | null;
  destination: string | null;
  occurredAt: string | null;
  frequency: "recurring" | "one_off" | null;
  urgency: "low" | "medium" | "high" | "critical";
  /** The one operational detail worth asking for, if any. */
  missingQuestionEn: string | null;
  missingQuestionAr: string | null;
};

type Input = {
  title: string;
  description: string;
  priority?: "low" | "medium" | "high" | "critical" | null;
  incidentDate?: string | null;
  desiredResolution?: string | null;
  location?: string | null;
  /** Reference date for "today"/"yesterday", ISO string. Defaults to now. */
  now?: Date;
};

type Topic = {
  key: string;
  match: RegExp;
  pathEn: string;
  pathAr: string;
  issueEn: string;
  issueAr: string;
  actionEn: string;
  actionAr: string;
  askEn?: string;
  askAr?: string;
  /** The complaint is only actionable once one of these appears in the text. */
  needs?: RegExp;
};

const TOPICS: Topic[] = [
  {
    key: "transport_bus_delay",
    match: /(bus|shuttle|حافلة|باص)/i,
    pathEn: "Transportation > Bus Delay",
    pathAr: "المواصلات > تأخر الحافلات",
    issueEn: "Campus buses are not running to the published schedule.",
    issueAr: "الحافلات الجامعية لا تلتزم بالجدول المعلن.",
    actionEn: "Please review the affected bus schedule and route and investigate the recurring delays.",
    actionAr: "يرجى مراجعة جدول ومسار الحافلة المتأثرة والتحقق من التأخيرات المتكررة.",
    askEn: "Which bus route or pickup point was affected?",
    askAr: "ما هو خط الحافلة أو نقطة الانطلاق المتأثرة؟",
    needs: /(route|line|stop|gate|from |to |hostel|campus|خط|محطة|بوابة|من |إلى |السكن)/i,
  },
  {
    key: "transport_other",
    match: /(transport|parking|taxi|نقل|مواصلات|موقف|مواقف)/i,
    pathEn: "Transportation > Service Issue",
    pathAr: "المواصلات > مشكلة في الخدمة",
    issueEn: "A campus transportation service is not working as expected.",
    issueAr: "إحدى خدمات النقل الجامعي لا تعمل كما هو متوقع.",
    actionEn: "Please investigate the reported transportation issue and confirm the corrective action.",
    actionAr: "يرجى التحقق من مشكلة النقل المبلّغ عنها وتأكيد الإجراء التصحيحي.",
  },
  {
    key: "housing",
    match: /(hostel|housing|dorm|room|سكن|غرفة)/i,
    pathEn: "Student Housing > Facility Issue",
    pathAr: "السكن الطلابي > مشكلة في المرفق",
    issueEn: "A problem was reported in student housing.",
    issueAr: "تم الإبلاغ عن مشكلة في السكن الطلابي.",
    actionEn: "Please inspect the reported housing issue and schedule the required work.",
    actionAr: "يرجى معاينة مشكلة السكن المبلّغ عنها وجدولة الأعمال المطلوبة.",
    askEn: "Which building and room number is affected?",
    askAr: "ما هو المبنى ورقم الغرفة المتأثرة؟",
    needs: /(building|block|room|floor|مبنى|غرفة|طابق)/i,
  },
  {
    key: "registration",
    match: /(registration|register|section|course|تسجيل|مقرر|شعبة)/i,
    pathEn: "Registration > Course Issue",
    pathAr: "التسجيل > مشكلة في المقررات",
    issueEn: "A registration or course problem is blocking the student.",
    issueAr: "مشكلة في التسجيل أو المقررات تعيق الطالب.",
    actionEn: "Please review the student's registration record and confirm the correction.",
    actionAr: "يرجى مراجعة سجل تسجيل الطالب وتأكيد التصحيح.",
    askEn: "Which course code and term does this concern?",
    askAr: "ما رمز المقرر والفصل الدراسي المعني؟",
    needs: /[A-Z]{2,4}\s?\d{3}/,
  },
  {
    key: "fees",
    match: /(fee|payment|invoice|refund|رسوم|دفع|فاتورة|استرداد)/i,
    pathEn: "Student Finance > Payment Issue",
    pathAr: "الشؤون المالية > مشكلة في الدفع",
    issueEn: "A fees or payment problem was reported.",
    issueAr: "تم الإبلاغ عن مشكلة في الرسوم أو الدفع.",
    actionEn: "Please review the student's account and confirm the correct amount or refund.",
    actionAr: "يرجى مراجعة حساب الطالب وتأكيد المبلغ الصحيح أو الاسترداد.",
    askEn: "Which amount and payment date does this concern?",
    askAr: "ما المبلغ وتاريخ الدفع المعني؟",
    needs: /(\d[\d,.]*\s?(aed|درهم)|\d{4}-\d{2}-\d{2})/i,
  },
  {
    key: "facility",
    match: /(air ?condition|ac |water|lift|elevator|toilet|clean|light|تكييف|ماء|مصعد|نظافة|إنارة)/i,
    pathEn: "Facilities > Maintenance Issue",
    pathAr: "المرافق > مشكلة صيانة",
    issueEn: "A campus facility is not working properly.",
    issueAr: "أحد مرافق الحرم الجامعي لا يعمل بشكل صحيح.",
    actionEn: "Please inspect the reported facility and complete the required maintenance.",
    actionAr: "يرجى معاينة المرفق المبلّغ عنه وإتمام الصيانة المطلوبة.",
    askEn: "Which building or location is affected?",
    askAr: "ما المبنى أو الموقع المتأثر؟",
    needs: /(building|room|floor|library|hostel|مبنى|غرفة|طابق|مكتبة|سكن)/i,
  },
];

const GENERIC: Topic = {
  key: "general",
  match: /.*/,
  pathEn: "Student Services > General Complaint",
  pathAr: "خدمات الطلبة > شكوى عامة",
  issueEn: "The student reported a problem with a university service.",
  issueAr: "أبلغ الطالب عن مشكلة في إحدى الخدمات الجامعية.",
  actionEn: "Please review the reported problem and confirm the action taken.",
  actionAr: "يرجى مراجعة المشكلة المبلّغ عنها وتأكيد الإجراء المتخذ.",
};

const RECURRING = /(always|often|every day|daily|repeatedly|again|frequently|constantly|keeps|دائم|دائماً|كل يوم|يومي|متكرر|باستمرار)/i;
const ONE_OFF = /(today|yesterday|this morning|last night|on \w+day|اليوم|أمس|هذا الصباح|الليلة الماضية)/i;

/** Free-text impact: the consequence the student actually described. */
const IMPACT_PATTERNS: { match: RegExp; en: string; ar: string }[] = [
  {
    match: /(walk|walked|on foot|مشي|مشيت|سيرا)/i,
    en: "The student had to walk instead of using the scheduled service.",
    ar: "اضطر الطالب إلى المشي بدلاً من استخدام الخدمة المجدولة.",
  },
  {
    match: /(missed|late (for|to)|couldn't attend|فاتني|تأخرت عن|لم أستطع الحضور)/i,
    en: "The student missed or was late for a scheduled commitment.",
    ar: "فوّت الطالب التزاماً مجدولاً أو تأخر عنه.",
  },
  {
    match: /(waited|stranded|stuck|انتظرت|عالق|تقطعت)/i,
    en: "The student was left waiting without a usable alternative.",
    ar: "بقي الطالب منتظراً دون بديل عملي.",
  },
  {
    match: /(exam|test|امتحان)/i,
    en: "The problem affected the student's exam commitments.",
    ar: "أثرت المشكلة على التزامات الطالب الامتحانية.",
  },
];

function firstSentenceWith(text: string, re: RegExp): string | null {
  const parts = text.split(/(?<=[.!?؟\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const hit = parts.find((s) => re.test(s));
  return hit ? hit.slice(0, 400) : null;
}

function detectRoute(text: string): string | null {
  const route =
    /(?:route|line|bus)\s*(?:no\.?|number|#)?\s*([A-Z]?\d{1,3}[A-Z]?)\b/i.exec(text) ??
    /(?:خط|باص|حافلة)\s*(?:رقم)?\s*(\d{1,3})/.exec(text);
  return route?.[1] ? String(route[1]).toUpperCase() : null;
}

function detectPlace(text: string, re: RegExp): string | null {
  const hit = re.exec(text);
  return hit?.[0] ? hit[0].trim().slice(0, 120) : null;
}

function detectDate(text: string, now: Date): string | null {
  const iso = /\d{4}-\d{2}-\d{2}/.exec(text);
  if (iso) return iso[0];
  if (/(today|this morning|this afternoon|tonight|اليوم|هذا الصباح)/i.test(text)) {
    return now.toISOString().slice(0, 10);
  }
  if (/(yesterday|last night|أمس|الليلة الماضية)/i.test(text)) {
    const d = new Date(now.getTime() - 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function detectTime(text: string): string | null {
  const t = /\b(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?\b/i.exec(text) ?? /\b(\d{1,2})\s*(am|pm)\b/i.exec(text);
  return t ? t[0].replace(/\s+/g, " ").trim() : null;
}

/** Turn a free-text complaint into fields an officer can act on. */
export function structureComplaint(input: Input): StructuredComplaint {
  const now = input.now ?? new Date();
  const text = `${input.title}\n${input.description}`;
  const topic = TOPICS.find((t) => t.match.test(text)) ?? GENERIC;

  const route = detectRoute(text);
  const location =
    input.location?.trim() ||
    detectPlace(text, /(from|at|near|من|عند)\s+[\w\u0600-\u06FF' -]{3,40}/i) ||
    null;
  const destination = detectPlace(text, /(back\s+to|to)\s+(my\s+)?(hostel|housing|campus|home|dorm|السكن|الحرم)/i);
  const date = input.incidentDate || detectDate(text, now);
  const time = detectTime(text);
  const occurredAt = date && time ? `${date} ${time}` : date || time || null;

  const frequency = RECURRING.test(text) ? "recurring" : ONE_OFF.test(text) ? "one_off" : null;
  const impactRule = IMPACT_PATTERNS.find((p) => p.match.test(text));
  const incident = firstSentenceWith(input.description, ONE_OFF) ?? firstSentenceWith(input.description, /(today|أمس|اليوم)/i);

  // Only ask when the one operationally essential detail is genuinely absent.
  const needsAsk = topic.needs ? !topic.needs.test(text) && !route : false;

  const priority = input.priority ?? "medium";

  return {
    complaintType: topic.key,
    categoryPath: topic.pathEn,
    categoryPathAr: topic.pathAr,
    issueEn: topic.issueEn,
    issueAr: topic.issueAr,
    incident: incident ? incident.slice(0, 400) : null,
    impact: impactRule?.en ?? null,
    requestedAction: input.desiredResolution?.trim() || topic.actionEn,
    requestedActionAr: input.desiredResolution?.trim() || topic.actionAr,
    route,
    location,
    destination,
    occurredAt,
    frequency,
    urgency: priority,
    missingQuestionEn: needsAsk ? topic.askEn ?? null : null,
    missingQuestionAr: needsAsk ? topic.askAr ?? null : null,
  };
}

/** One compact paragraph for the officer's case header. */
export function complaintBrief(s: StructuredComplaint, lang: "en" | "ar" = "en"): string {
  const ar = lang === "ar";
  const lines: string[] = [];
  lines.push(`${ar ? "التصنيف" : "Category"}: ${ar ? s.categoryPathAr : s.categoryPath}`);
  lines.push(`${ar ? "المشكلة" : "Issue"}: ${ar ? s.issueAr : s.issueEn}`);
  if (s.incident) lines.push(`${ar ? "الواقعة" : "Specific incident"}: ${s.incident}`);
  if (s.route) lines.push(`${ar ? "الخط" : "Route"}: ${s.route}`);
  if (s.location) lines.push(`${ar ? "الموقع" : "Location"}: ${s.location}`);
  if (s.occurredAt) lines.push(`${ar ? "التوقيت" : "When"}: ${s.occurredAt}`);
  if (s.frequency) {
    lines.push(
      `${ar ? "التكرار" : "Frequency"}: ${
        s.frequency === "recurring" ? (ar ? "متكرر" : "Recurring") : ar ? "حادثة منفردة" : "One-off"
      }`,
    );
  }
  if (s.impact) lines.push(`${ar ? "الأثر" : "Impact"}: ${s.impact}`);
  lines.push(`${ar ? "الإجراء المطلوب" : "Requested action"}: ${ar ? s.requestedActionAr : s.requestedAction}`);
  return lines.join("\n");
}
