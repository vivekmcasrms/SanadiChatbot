/**
 * Student Hold Resolution Agent. Server only.
 *
 * Responsibility: go beyond "you have a hold". For every active hold on the
 * signed-in student's record this agent identifies the hold type, explains the
 * reason, resolves the responsible unit (and its contact), states exactly what
 * the student must do, reports the status of any resolution case already
 * running, and can open a real tracked case with the owning unit — routed,
 * assigned, SLA'd and notified through the normal intake pipeline.
 *
 * Every fact here comes from the verified record. The model may explain the
 * result; it never invents a hold, a unit, or a resolution step, and resolution
 * is never simulated in prose — it always creates a real case.
 *
 * Data: student_holds (+ issuing service unit), service_units, cases —
 * all read under the caller's own RLS scope.
 */
import type { Citation, Lang } from "../agent-types";
import { formatDate } from "../format-date";
import { loadStudentSnapshot, type StudentSnapshot } from "../student-context.server";
import type { Db } from "./tools.server";

/** Fallback owner when a hold carries no issuing unit. */
export const HOLD_FALLBACK_UNIT_CODE = "REG";

/** Marker written into a hold-resolution case so follow-ups find it again. */
export const holdCaseMarker = (holdId: string) => `[HOLD-REF:${holdId}]`;

export type HoldCategory =
  | "financial"
  | "academic"
  | "library"
  | "housing"
  | "disciplinary"
  | "medical"
  | "documents"
  | "advising"
  | "other";

type CategoryDef = {
  category: HoldCategory;
  re: RegExp;
  unitCode: string;
  labelEn: string;
  labelAr: string;
};

/**
 * Hold type → responsible unit. Matched on the stored hold_type first and the
 * hold title second. An unrecognised hold stays "other": it is still explained
 * and still routed (to its issuing unit, or to Admission & Registration for
 * triage) — never guessed at.
 */
const CATEGORIES: CategoryDef[] = [
  {
    category: "financial",
    re: /financ|fee|payment|tuition|debt|invoice|bursar|مالي|رسوم|دفع|سداد|مديونية/i,
    unitCode: "FEES",
    labelEn: "Financial hold",
    labelAr: "قيد مالي",
  },
  {
    category: "library",
    re: /librar|book|overdue|مكتب(ة|ي)|كتاب|متأخر/i,
    unitCode: "LIB",
    labelEn: "Library hold",
    labelAr: "قيد المكتبة",
  },
  {
    category: "housing",
    re: /housing|hostel|dorm|accommodat|سكن|إسكان/i,
    unitCode: "HOUS",
    labelEn: "Housing hold",
    labelAr: "قيد السكن",
  },
  {
    category: "disciplinary",
    re: /disciplin|conduct|violation|misconduct|تأديب|سلوك|مخالفة/i,
    unitCode: "REG",
    labelEn: "Disciplinary hold",
    labelAr: "قيد تأديبي",
  },
  {
    category: "medical",
    re: /medical|health|immun|vaccin|clinic|صحي|طبي|تطعيم/i,
    unitCode: "REG",
    labelEn: "Health hold",
    labelAr: "قيد صحي",
  },
  {
    category: "documents",
    re: /document|certificat|transcript|passport|visa|id card|missing paper|وثيق|مستند|شهادة|جواز|تأشير/i,
    unitCode: "REG",
    labelEn: "Missing documents hold",
    labelAr: "قيد وثائق ناقصة",
  },
  {
    category: "advising",
    re: /advis|advisor|counsel|إرشاد|مرشد/i,
    unitCode: "ADV",
    labelEn: "Advising hold",
    labelAr: "قيد الإرشاد الأكاديمي",
  },
  {
    category: "academic",
    re: /academic|probation|gpa|standing|أكاديمي|إنذار|معدل/i,
    unitCode: "SAS",
    labelEn: "Academic hold",
    labelAr: "قيد أكاديمي",
  },
];

export function classifyHold(holdType: string | null, titleEn: string, titleAr: string): CategoryDef {
  const hay = `${holdType ?? ""} ${titleEn} ${titleAr}`;
  for (const c of CATEGORIES) if (c.re.test(hay)) return c;
  return {
    category: "other",
    re: /$^/,
    unitCode: HOLD_FALLBACK_UNIT_CODE,
    labelEn: "Hold on your record",
    labelAr: "قيد على سجلك",
  };
}

const HOLD_RE =
  /\bholds?\b|\bblocked?\b|\bblock(ing)?\b|\brestriction|\bflag on my (record|account)|why (can'?t|cant|couldn'?t) i (register|enrol|enroll|graduate|get my)|(clear|remove|resolve|lift).{0,20}\b(hold|block|restriction)\b|قيد|قيود|إيقاف|حظر|لماذا لا (أستطيع|يمكنني)|كيف (أزيل|أرفع|أنهي).{0,15}(القيد|الحظر|الإيقاف)/i;

/** Deterministic bilingual intent detection — no model call. */
export function detectHoldResolutionIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return HOLD_RE.test(text);
}

export type HoldCaseLink = {
  caseId: string;
  reference: string;
  status: string;
  createdAt: string;
  open: boolean;
  trackingUrl: string;
};

export type HoldDossier = {
  holdId: string;
  category: HoldCategory;
  typeEn: string;
  typeAr: string;
  rawType: string | null;
  titleEn: string;
  titleAr: string;
  reasonEn: string | null;
  reasonAr: string | null;
  actionEn: string | null;
  actionAr: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitNameEn: string | null;
  unitNameAr: string | null;
  unitEmail: string | null;
  unitPhone: string | null;
  /** True when no owning unit could be verified for this hold. */
  unitUnknown: boolean;
  blocksRegistration: boolean;
  blocksGraduation: boolean;
  status: string;
  issuedAt: string | null;
  expiresAt: string | null;
  existingCase: HoldCaseLink | null;
};

export type HoldResolutionReport = {
  holds: HoldDossier[];
  resolvedHolds: HoldDossier[];
  answer: string;
  citations: Citation[];
  verified: boolean;
  proposals: { toolName: string; args: Record<string, unknown> }[];
  snapshot: StudentSnapshot;
};

const OPEN_STATUSES = new Set(["resolved", "closed", "withdrawn", "duplicate", "rejected"]);

async function unitById(db: Db, ids: string[]) {
  const map = new Map<
    string,
    { code: string; name_en: string; name_ar: string; contact_email: string | null; email: string | null; phone_extension: string | null }
  >();
  if (!ids.length) return map;
  const { data } = await db
    .from("service_units")
    .select("id, code, name_en, name_ar, contact_email, email, phone_extension")
    .in("id", ids);
  for (const u of data ?? []) map.set(u.id, u);
  return map;
}

async function unitByCodes(db: Db, codes: string[]) {
  const map = new Map<
    string,
    { id: string; code: string; name_en: string; name_ar: string; contact_email: string | null; email: string | null; phone_extension: string | null }
  >();
  if (!codes.length) return map;
  const { data } = await db
    .from("service_units")
    .select("id, code, name_en, name_ar, contact_email, email, phone_extension")
    .in("code", codes)
    .eq("is_active", true);
  for (const u of data ?? []) map.set(u.code, u);
  return map;
}

/**
 * Full dossier for every hold on the record — active first, then holds already
 * cleared (so a student who asks "is my hold gone?" gets a verified answer).
 */
export async function loadHoldDossiers(
  db: Db,
  userId: string,
): Promise<{ active: HoldDossier[]; resolved: HoldDossier[] }> {
  const [{ data: holds }, { data: caseRows }] = await Promise.all([
    db
      .from("student_holds")
      .select(
        "id, hold_type, title_en, title_ar, description_en, description_ar, resolution_action_en, resolution_action_ar, issuing_unit_id, issued_at, expires_at, prevents_registration, prevents_graduation, status",
      )
      .eq("student_id", userId)
      .order("issued_at", { ascending: false }),
    db
      .from("cases")
      .select("id, case_number, status, created_at, description")
      .eq("student_id", userId)
      .ilike("description", "%[HOLD-REF:%")
      .order("created_at", { ascending: false }),
  ]);

  const rows = holds ?? [];
  const issuing = await unitById(
    db,
    [...new Set(rows.map((h) => h.issuing_unit_id).filter((x): x is string => Boolean(x)))],
  );
  const fallbackCodes = [
    ...new Set(
      rows
        .filter((h) => !h.issuing_unit_id)
        .map((h) => classifyHold(h.hold_type, h.title_en, h.title_ar).unitCode),
    ),
  ];
  const fallback = await unitByCodes(db, [...fallbackCodes, HOLD_FALLBACK_UNIT_CODE]);

  const dossiers = rows.map((h): HoldDossier => {
    const cat = classifyHold(h.hold_type, h.title_en, h.title_ar);
    const owned = h.issuing_unit_id ? issuing.get(h.issuing_unit_id) : undefined;
    const guess = owned ? undefined : (fallback.get(cat.unitCode) ?? fallback.get(HOLD_FALLBACK_UNIT_CODE));
    const unit = owned ?? guess ?? null;
    const marker = holdCaseMarker(h.id);
    const linked = (caseRows ?? []).find((c) => (c.description ?? "").includes(marker));
    return {
      holdId: h.id,
      category: cat.category,
      typeEn: cat.labelEn,
      typeAr: cat.labelAr,
      rawType: h.hold_type,
      titleEn: h.title_en,
      titleAr: h.title_ar,
      reasonEn: h.description_en,
      reasonAr: h.description_ar,
      actionEn: h.resolution_action_en,
      actionAr: h.resolution_action_ar,
      unitId: owned ? h.issuing_unit_id : (guess?.id ?? null),
      unitCode: unit?.code ?? null,
      unitNameEn: unit?.name_en ?? null,
      unitNameAr: unit?.name_ar ?? null,
      unitEmail: unit?.contact_email ?? unit?.email ?? null,
      unitPhone: unit?.phone_extension ?? null,
      unitUnknown: !owned,
      blocksRegistration: h.prevents_registration,
      blocksGraduation: h.prevents_graduation,
      status: h.status,
      issuedAt: h.issued_at,
      expiresAt: h.expires_at,
      existingCase: linked
        ? {
            caseId: linked.id,
            reference: linked.case_number,
            status: linked.status,
            createdAt: linked.created_at,
            open: !OPEN_STATUSES.has(linked.status),
            trackingUrl: `/requests/${linked.id}`,
          }
        : null,
    };
  });

  return {
    active: dossiers.filter((d) => d.status === "active"),
    resolved: dossiers.filter((d) => d.status !== "active"),
  };
}

function citation(lang: Lang): Citation {
  return {
    documentId: null,
    sourceTitle: lang === "ar" ? "سجل القيود الطلابية في النظام" : "Student holds register",
    owningUnit: lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
    documentVersion: null,
    effectiveDate: null,
    citationUrl: null,
    confidence: "high",
  };
}

const statusLabel = (status: string, ar: boolean) => {
  const map: Record<string, [string, string]> = {
    submitted: ["Submitted", "تم الإرسال"],
    acknowledged: ["Acknowledged", "تم الاستلام"],
    assigned: ["Assigned to staff", "تم الإسناد لموظف"],
    in_review: ["Under review", "قيد المراجعة"],
    in_progress: ["In progress", "قيد المعالجة"],
    awaiting_student: ["Waiting for you", "بانتظار ردك"],
    resolved: ["Resolved", "تم الحل"],
    closed: ["Closed", "مغلقة"],
  };
  const hit = map[status];
  return hit ? (ar ? hit[1] : hit[0]) : status.replace(/_/g, " ");
};

/** One student-facing block per hold: type, reason, unit, action, contact, status. */
export function formatHoldBlock(h: HoldDossier, lang: Lang, index: number): string {
  const ar = lang === "ar";
  const unit = ar ? h.unitNameAr : h.unitNameEn;
  const lines: string[] = [];
  lines.push(`**${index}. ${ar ? h.titleAr : h.titleEn}**`);
  lines.push(`- ${ar ? "النوع" : "Hold type"}: ${ar ? h.typeAr : h.typeEn}`);
  const reason = (ar ? h.reasonAr : h.reasonEn) ?? (ar ? "لم يسجل سبب تفصيلي." : "No detailed reason was recorded.");
  lines.push(`- ${ar ? "السبب" : "Reason"}: ${reason}`);
  lines.push(
    `- ${ar ? "الجهة المسؤولة" : "Responsible unit"}: ${
      unit
        ? `${unit}${h.unitUnknown ? (ar ? " (الجهة المرجحة — لم تُسجَّل جهة مُصدِرة للقيد)" : " (likely owner — no issuing unit is recorded on the hold)") : ""}`
        : ar
          ? "غير محددة في السجل — سيتم توجيه طلبك للقبول والتسجيل لتحديدها"
          : "not recorded — your request will go to Admission & Registration to identify it"
    }`,
  );
  const action =
    (ar ? h.actionAr : h.actionEn) ??
    (ar
      ? "لم تُسجَّل خطوة محددة. يمكنني فتح طلب لدى الجهة المسؤولة للحصول على المتطلبات الدقيقة."
      : "No specific step is recorded. I can open a request with the responsible unit to get the exact requirements.");
  lines.push(`- ${ar ? "المطلوب منك" : "What you need to do"}: ${action}`);
  if (h.unitEmail || h.unitPhone) {
    const contact = [h.unitEmail, h.unitPhone ? `${ar ? "تحويلة" : "ext."} ${h.unitPhone}` : null]
      .filter(Boolean)
      .join(" · ");
    lines.push(`- ${ar ? "التواصل" : "Contact"}: ${contact}`);
  }
  const blocks = [
    h.blocksRegistration ? (ar ? "يمنع التسجيل" : "blocks registration") : null,
    h.blocksGraduation ? (ar ? "يمنع التخرج" : "blocks graduation") : null,
  ].filter(Boolean);
  lines.push(
    `- ${ar ? "الحالة" : "Status"}: ${
      h.status === "active" ? (ar ? "نشط" : "Active") : ar ? "غير نشط" : "Inactive"
    }${blocks.length ? ` (${blocks.join(ar ? " و" : " and ")})` : ""}${
      h.issuedAt ? ` · ${ar ? "منذ" : "since"} ${formatDate(h.issuedAt, lang)}` : ""
    }`,
  );
  if (h.existingCase) {
    lines.push(
      `- ${ar ? "طلب الحل" : "Resolution case"}: ${h.existingCase.reference} — ${statusLabel(h.existingCase.status, ar)} · ${h.existingCase.trackingUrl}`,
    );
  }
  return lines.join("\n");
}

/**
 * The full hold answer: identify → explain → own → act. Returns proposals for
 * real backend actions; nothing is "resolved" in prose alone.
 */
export async function buildHoldResolutionReport(
  db: Db,
  userId: string,
  lang: Lang,
): Promise<HoldResolutionReport | null> {
  const snapshot = await loadStudentSnapshot(db, userId);
  if (!snapshot.hasProfile) return null;
  const ar = lang === "ar";
  const { active, resolved } = await loadHoldDossiers(db, userId);
  const proposals: { toolName: string; args: Record<string, unknown> }[] = [];

  if (!active.length) {
    const recentlyCleared = resolved[0];
    const answer = recentlyCleared
      ? ar
        ? `لا توجد قيود نشطة على سجلك الآن. آخر قيد مسجل «${recentlyCleared.titleAr}» لم يعد نشطاً، ولا يمنع تسجيلك أو تخرجك.`
        : `You have no active holds on your record. Your most recent hold — "${recentlyCleared.titleEn}" — is no longer active and is not blocking your registration or graduation.`
      : ar
        ? "لا توجد قيود نشطة على سجلك، ولا شيء يمنع تسجيلك من ناحية القيود."
        : "There are no active holds on your record, so nothing on the holds side is blocking your registration.";
    return { holds: [], resolvedHolds: resolved, answer, citations: [citation(lang)], verified: true, proposals, snapshot };
  }

  const head = ar
    ? active.length === 1
      ? "يوجد قيد واحد نشط على سجلك. إليك تفاصيله والجهة المسؤولة عنه:"
      : `يوجد ${active.length} قيود نشطة على سجلك. إليك تفاصيل كل قيد والجهة المسؤولة عنه:`
    : active.length === 1
      ? "You have 1 active hold on your record. Here is what it is and who owns it:"
      : `You have ${active.length} active holds on your record. Here is what each one is and who owns it:`;

  const body = active.map((h, i) => formatHoldBlock(h, lang, i + 1)).join("\n\n");

  const pending = active.filter((h) => !h.existingCase?.open);
  const tracked = active.filter((h) => h.existingCase?.open);
  const tail: string[] = [];
  if (tracked.length) {
    tail.push(
      ar
        ? `يوجد بالفعل ${tracked.length === 1 ? "طلب" : `${tracked.length} طلبات`} حل قيد المتابعة، وسأحدّثك عند تغيّر الحالة.`
        : `${tracked.length === 1 ? "A resolution case is" : `${tracked.length} resolution cases are`} already running and I will update you as the status changes.`,
    );
  }
  for (const h of pending) {
    proposals.push({
      toolName: "open_hold_resolution_case",
      args: { holdId: h.holdId },
    });
  }
  if (pending.length) {
    tail.push(
      ar
        ? "يمكنني فتح طلب رسمي لدى الجهة المسؤولة الآن مع إرفاق بيانات القيد وبياناتك الأكاديمية الموثقة — لن تحتاج لإعادة إدخال أي معلومة."
        : "I can open a formal request with the responsible unit now, with your hold details and verified student data attached — you will not need to re-enter anything.",
    );
  }

  return {
    holds: active,
    resolvedHolds: resolved,
    answer: [head, body, tail.join(" ")].filter(Boolean).join("\n\n"),
    citations: [citation(lang)],
    verified: true,
    proposals,
    snapshot,
  };
}

/**
 * The verified context attached to a hold-resolution case, so the student is
 * never asked again for their id, name, programme or the hold details.
 */
export function buildHoldCaseDescription(h: HoldDossier, s: StudentSnapshot, lang: Lang): string {
  const ar = lang === "ar";
  const L = (en: string, arr: string) => (ar ? arr : en);
  const lines = [
    L(
      `Request to clear a hold, raised through Sanadi with verified record data attached.`,
      `طلب رفع قيد، تم إنشاؤه عبر سندي مع إرفاق بيانات السجل الموثقة.`,
    ),
    "",
    `${L("Hold", "القيد")}: ${ar ? h.titleAr : h.titleEn} (${ar ? h.typeAr : h.typeEn})`,
    `${L("Reason on record", "السبب المسجل")}: ${(ar ? h.reasonAr : h.reasonEn) ?? L("not recorded", "غير مسجل")}`,
    `${L("Recorded resolution step", "خطوة الحل المسجلة")}: ${(ar ? h.actionAr : h.actionEn) ?? L("not recorded", "غير مسجلة")}`,
    `${L("Blocks", "يمنع")}: ${[
      h.blocksRegistration ? L("registration", "التسجيل") : null,
      h.blocksGraduation ? L("graduation", "التخرج") : null,
    ]
      .filter(Boolean)
      .join(", ") || L("nothing recorded", "لا شيء مسجل")}`,
    `${L("Issued", "تاريخ الإصدار")}: ${h.issuedAt ? formatDate(h.issuedAt, lang) : L("not recorded", "غير مسجل")}`,
    h.unitUnknown
      ? L(
          "Issuing unit is not recorded on the hold; please confirm ownership or reassign.",
          "الجهة المُصدِرة غير مسجلة على القيد؛ يرجى تأكيد الملكية أو إعادة الإسناد.",
        )
      : `${L("Issuing unit", "الجهة المُصدِرة")}: ${(ar ? h.unitNameAr : h.unitNameEn) ?? "—"}`,
    "",
    `${L("Student", "الطالب")}: ${s.fullName ?? "—"} · ${s.studentNumber ?? "—"}`,
    `${L("Programme", "البرنامج")}: ${(ar ? s.programNameAr : s.programNameEn) ?? "—"}`,
    `${L("College", "الكلية")}: ${(ar ? s.collegeNameAr : s.collegeNameEn) ?? "—"}`,
    `${L("Academic standing", "الوضع الأكاديمي")}: ${s.standing ?? "—"} · ${L("GPA", "المعدل")}: ${s.gpa ?? "—"}`,
    `${L("Credits completed", "الساعات المكتملة")}: ${s.completedCredits}/${s.totalCredits}`,
    "",
    holdCaseMarker(h.holdId),
  ];
  return lines.join("\n");
}
