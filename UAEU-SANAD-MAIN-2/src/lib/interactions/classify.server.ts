/**
 * Unified interaction classifier.
 *
 * One implementation for every entry point: normal Sanadi chat and the direct
 * shortcuts (Ask a Question / Submit a Suggestion / Report a Problem /
 * Alert-Emergency). A shortcut only *hints* the type — the classifier still
 * decides, so "what time does the library close?" submitted through the
 * complaint shortcut is handled as a Query.
 *
 * Everything is deterministic so the same wording always produces the same
 * routing explanation for the Service Owner.
 */
import { ALERT_SERVICE_CODE, classifyForRouting, serviceLabel } from "@/lib/ops/classify.server";
import type {
  AutomationLevel,
  InteractionClassification,
  InteractionSeverity,
  InteractionType,
} from "./types";

/* ---------------- intent signals ---------------- */

const SUGGESTION_HINTS =
  /\b(suggest|propose|recommend|it would be better|would be nice|please add|should (be )?(add|open|extend|increase|provide)|increase the number|more buses|stay open later)\b|أقترح|اقتراح|يُفضل|من الأفضل|يرجى إضافة|زيادة عدد|يجب أن (يتم )?(إضافة|فتح|تمديد)/i;

const COMPLAINT_HINTS =
  /\b(complain|complaint|unacceptable|unfair|disappointed|repeatedly|again and again|nobody (replied|answered)|did ?n[o']t (arrive|come|work|respond)|still (pending|waiting)|no one|too (slow|late)|always (late|delayed|dirty|closed|broken)|wrong|has been waiting|two weeks)\b|شكوى|أشتكي|غير مقبول|غير عادل|مستاء|مراراً|لم (تصل|يصل|يرد|يعمل)|ما زال|تأخر|خطأ في/i;

const QUERY_HINTS =
  /\b(what|when|where|how|which|who|can i|am i|do i|is there|eligible|policy|deadline|status|opening hours|closes?)\b\s|\?|كيف|ما هي|ما هو|أين|متى|هل|الأهلية|سياسة|موعد|حالة|يغلق|يفتح/i;

/* ---------------- emergency / alert signals ---------------- */

type AlertRule = {
  type: string;
  severity: InteractionSeverity;
  match: RegExp;
  en: string;
  ar: string;
};

/**
 * Approved emergency categories. The model never invents an emergency
 * procedure: it can only match one of these institutionally configured types,
 * and the response text always comes from `emergency_contacts`.
 */
const ALERT_RULES: AlertRule[] = [
  {
    type: "life_safety",
    severity: "critical",
    match:
      /\b(fire|smoke|explosion|gas leak|electrocut|bleeding|unconscious|collapsed|not breathing|heart attack|seizure|assault|attack|weapon|trapped|stuck in (the )?(lift|elevator)|drowning)\b|حريق|دخان|انفجار|تسرب غاز|صعقة|نزيف|فاقد الوعي|إغماء|لا يتنفس|نوبة|اعتداء|سلاح|محتجز|عالق في المصعد/i,
    en: "the message reports an immediate life-safety emergency",
    ar: "الرسالة تُبلغ عن حالة طوارئ تهدد السلامة فوراً",
  },
  {
    type: "security",
    severity: "critical",
    match: /\b(threat|threatened|harass|stalking|intruder|theft in progress|violence|unsafe|danger)\b|تهديد|تحرش|ملاحقة|دخيل|عنف|خطر|غير آمن/i,
    en: "the message reports a security or personal-safety concern",
    ar: "الرسالة تُبلغ عن مسألة أمنية أو تتعلق بالسلامة الشخصية",
  },
  {
    type: "facility_disruption",
    severity: "high",
    match:
      /\b(flood|flooding|water leak(ing)?|burst pipe|no (water|power|electricity)|power (cut|outage)|ceiling (fell|collapsed)|sewage|broken down on the (highway|road)|stranded|students are stuck)\b|فيضان|تسرب مياه|انفجار ماسورة|انقطاع (الماء|الكهرباء)|سقوط السقف|صرف صحي|تعطلت (الحافلة|الباص)|عالقون/i,
    en: "the message reports a serious, immediate service or facility disruption",
    ar: "الرسالة تُبلغ عن انقطاع خطير وفوري في الخدمة أو المرفق",
  },
  {
    type: "health",
    severity: "high",
    match: /\b(injur|ambulance|medical emergency|food poisoning|allergic reaction|fever outbreak)\b|إصابة|إسعاف|طوارئ طبية|تسمم غذائي|حساسية شديدة/i,
    en: "the message reports a health incident needing an urgent response",
    ar: "الرسالة تُبلغ عن حادث صحي يتطلب استجابة عاجلة",
  },
];

/** Wording that turns a real incident into a past-tense complaint, not an alert. */
const PAST_INCIDENT =
  /\b(yesterday|last (week|night|month)|was (\d+ )?(minutes? )?late|used to|previously|earlier this (week|month))\b|أمس|الأسبوع الماضي|الليلة الماضية|تأخر(ت)? \d+/i;

const SENSITIVE_PATTERNS =
  /(harass|discriminat|assault|abuse|threat|misconduct|bully|تحرش|تمييز|اعتداء|تهديد|إساءة|تنمر)/i;

const SCALE_HINTS =
  /\b(all students|many students|everyone|entire (building|campus|floor)|hundreds)\b|جميع الطلبة|كل الطلاب|المبنى بالكامل|الحرم بالكامل/i;

const URGENT_HINTS =
  /\b(urgent|immediately|right now|emergency|today|deadline|tomorrow)\b|عاجل|فوراً|الآن|طوارئ|اليوم|غداً|الموعد النهائي/i;

/* ---------------- classification ---------------- */

function detectAlert(text: string): AlertRule | null {
  for (const rule of ALERT_RULES) {
    if (!rule.match.test(text)) continue;
    // A past-tense retelling of an incident is a complaint, not a live alert —
    // unless it is a life-safety category, where we never downgrade.
    if (rule.type !== "life_safety" && PAST_INCIDENT.test(text)) continue;
    return rule;
  }
  return null;
}

function detectType(text: string, alert: AlertRule | null): { type: InteractionType; confidence: number } {
  if (alert) return { type: "alert", confidence: 0.92 };
  const suggestion = SUGGESTION_HINTS.test(text);
  const complaint = COMPLAINT_HINTS.test(text);
  const query = QUERY_HINTS.test(text);
  if (suggestion && !complaint) return { type: "suggestion", confidence: 0.88 };
  if (complaint && !suggestion) return { type: "complaint", confidence: query ? 0.72 : 0.87 };
  if (suggestion && complaint) return { type: "complaint", confidence: 0.62 };
  if (query) return { type: "query", confidence: 0.82 };
  return { type: "query", confidence: 0.5 };
}

function severityFor(type: InteractionType, alert: AlertRule | null, text: string): InteractionSeverity {
  if (alert) {
    if (alert.severity === "high" && SCALE_HINTS.test(text)) return "critical";
    return alert.severity;
  }
  if (type === "suggestion") return "low";
  if (type === "complaint") return SCALE_HINTS.test(text) || URGENT_HINTS.test(text) ? "high" : "normal";
  return URGENT_HINTS.test(text) ? "normal" : "low";
}

const PRIORITY_BY_SEVERITY: Record<InteractionSeverity, "low" | "medium" | "high" | "critical"> = {
  low: "low",
  normal: "medium",
  high: "high",
  critical: "critical",
};

function automationFor(
  type: InteractionType,
  severity: InteractionSeverity,
  confidence: number,
  sensitive: boolean,
): AutomationLevel {
  if (sensitive) return "human_review";
  if (type === "alert") return severity === "critical" ? "human_review" : "assisted";
  if (confidence < 0.6) return "assisted";
  if (type === "query") return "auto_resolve";
  return "auto_manage";
}

export type ClassifyInput = {
  title?: string | null;
  description?: string | null;
  /** Type suggested by the shortcut the student used. Never blindly trusted. */
  shortcutHint?: InteractionType | null;
  /** Urgency the student explicitly selected in a form, if any. */
  urgencyHint?: "low" | "medium" | "high" | "critical" | null;
  sensitiveHint?: boolean | null;
};

/**
 * The single classification entry point for chat and shortcuts.
 * Produces the full structured result used for routing, SLA and automation.
 */
export function classifyInteraction(input: ClassifyInput): InteractionClassification {
  const text = `${input.title ?? ""}\n${input.description ?? ""}`.trim();

  const alert = detectAlert(text);
  const detected = detectType(text, alert);
  const routing = classifyForRouting({ title: input.title ?? "", description: input.description ?? "" });

  const hint = input.shortcutHint ?? null;
  // The shortcut only wins when the text carries no clear signal of its own.
  const weakSignal = detected.confidence < 0.7;
  const interactionType: InteractionType = alert ? "alert" : weakSignal && hint ? hint : detected.type;
  const overriddenHint = hint && hint !== interactionType ? hint : null;

  const sensitive = Boolean(input.sensitiveHint) || SENSITIVE_PATTERNS.test(text);
  let severity = severityFor(interactionType, alert, text);
  if (input.urgencyHint === "critical") severity = "critical";
  else if (input.urgencyHint === "high" && severity !== "critical") severity = "high";

  // Overall confidence blends "what is this" with "who owns it".
  const confidence = Math.round(Math.min(detected.confidence, routing.confidence) * 100) / 100;

  const lowConfidence = confidence < 0.6;
  const humanAttentionRequired =
    sensitive || (interactionType === "alert" && severity === "critical") || lowConfidence;
  const attentionReason = sensitive
    ? "sensitive"
    : interactionType === "alert" && severity === "critical"
      ? "sla_critical"
      : lowConfidence
        ? "low_confidence"
        : null;

  const secondarySuggestion =
    interactionType !== "suggestion" && SUGGESTION_HINTS.test(text) && text.length > 60;

  // A verified alert is owned by the emergency/security/facilities family for
  // its category — wording rules must never send a life-safety report to an
  // academic or general queue.
  const alertService = alert ? (ALERT_SERVICE_CODE[alert.type] ?? null) : null;
  const serviceCode = alertService ?? routing.serviceCode;
  const topic = alertService && alertService !== routing.serviceCode ? alert!.type : routing.topic;

  const label = serviceLabel(serviceCode);
  const whyEn = alert ? `${alert.en}; ` : "";
  const whyAr = alert ? `${alert.ar}؛ ` : "";

  return {
    interactionType,
    serviceCode,
    serviceLabel: label,
    topic,
    rootCauseCode: routing.rootCauseCode,
    priority: input.urgencyHint && !alert ? input.urgencyHint : PRIORITY_BY_SEVERITY[severity],
    severity,
    automationLevel: automationFor(interactionType, severity, confidence, sensitive),
    confidence,
    humanAttentionRequired,
    attentionReason,
    isEmergency: Boolean(alert),
    alertType: alert?.type ?? null,
    isSensitive: sensitive,
    secondarySuggestion,
    overriddenHint,
    reasonEn: alertService
      ? `${whyEn}routed to ${label.en} as the responsible unit for this alert category.`
      : `${whyEn}${routing.reasonEn}`,
    reasonAr: alertService
      ? `${whyAr}تم التوجيه إلى ${label.ar} بصفتها الجهة المسؤولة عن هذا النوع من البلاغات.`
      : `${whyAr}${routing.reasonAr}`,
  };
}
