/**
 * The single, explicit permissions model for Sanadi.
 *
 * Three audiences — Student, Service Owner / Staff, Admin — and for every
 * major capability the same seven rights. This file is documentation *and*
 * the source the Admin matrix screen renders; the actual enforcement lives
 * server-side (RLS policies, `is_staff` / `is_manager` / `has_role`, and the
 * role checks inside every server function). Nothing here grants access.
 */

export type Audience = "student" | "staff" | "admin";

export type Right =
  | "view"
  | "create"
  | "act"
  | "approve"
  | "reassign"
  | "close"
  | "configure"
  | "report";

export const RIGHTS: Right[] = [
  "view",
  "create",
  "act",
  "approve",
  "reassign",
  "close",
  "configure",
  "report",
];

export const RIGHT_LABEL: Record<Right, { en: string; ar: string }> = {
  view: { en: "View", ar: "الاطلاع" },
  create: { en: "Create", ar: "الإنشاء" },
  act: { en: "Act", ar: "التنفيذ" },
  approve: { en: "Approve", ar: "الاعتماد" },
  reassign: { en: "Reassign", ar: "إعادة الإسناد" },
  close: { en: "Close", ar: "الإغلاق" },
  configure: { en: "Configure", ar: "الإعداد" },
  report: { en: "Report", ar: "التقارير" },
};

export const AUDIENCE_LABEL: Record<Audience, { en: string; ar: string }> = {
  student: { en: "Student", ar: "الطالب" },
  staff: { en: "Service Owner / Staff", ar: "مسؤول الخدمة / الموظف" },
  admin: { en: "Admin", ar: "المسؤول" },
};

/** `"own"`, `"unit"` and `"all"` are allowed but scoped; `false` is a hard no. */
export type Grant = true | false | "own" | "unit" | "all";

export const GRANT_LABEL: Record<string, { en: string; ar: string }> = {
  true: { en: "Yes", ar: "نعم" },
  false: { en: "No", ar: "لا" },
  own: { en: "Own records only", ar: "سجلاته فقط" },
  unit: { en: "Authorised unit only", ar: "وحدته المصرح بها فقط" },
  all: { en: "All units", ar: "جميع الوحدات" },
};

export type Capability = {
  code: string;
  en: string;
  ar: string;
  /** Where the rule is actually enforced — shown to the admin for assurance. */
  enforcedBy: string;
  rights: Record<Audience, Partial<Record<Right, Grant>>>;
};

const none: Partial<Record<Right, Grant>> = {};

export const PERMISSION_MATRIX: Capability[] = [
  {
    code: "profile",
    en: "Profile & personal data",
    ar: "الملف الشخصي والبيانات الشخصية",
    enforcedBy: "profiles RLS — owner-only writes",
    rights: {
      student: { view: "own", act: "own" },
      staff: { view: "unit" },
      admin: { view: "all", act: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "chats",
    en: "Assistant chats",
    ar: "محادثات المساعد",
    enforcedBy: "conversations / messages RLS — student owns the thread",
    rights: {
      student: { view: "own", create: "own", act: "own" },
      staff: { view: "unit" },
      admin: { view: "all", report: "all" },
    },
  },
  {
    code: "requests",
    en: "Requests, complaints, suggestions & alerts",
    ar: "الطلبات والشكاوى والمقترحات والتنبيهات",
    enforcedBy: "cases RLS + can_access_case()",
    rights: {
      student: { view: "own", create: "own", act: "own", approve: "own" },
      staff: {
        view: "unit",
        create: "unit",
        act: "unit",
        approve: "unit",
        reassign: "unit",
        close: "unit",
        report: "unit",
      },
      admin: {
        view: "all",
        create: "all",
        act: "all",
        approve: "all",
        reassign: "all",
        close: "all",
        configure: "all",
        report: "all",
      },
    },
  },
  {
    code: "student_context",
    en: "Student academic context",
    ar: "السياق الأكاديمي للطالب",
    enforcedBy: "case-scoped server functions only — required context, nothing more",
    rights: {
      student: { view: "own" },
      staff: { view: "unit" },
      admin: { view: "all", report: "all" },
    },
  },
  {
    code: "documents",
    en: "Official documents & letters",
    ar: "الوثائق والخطابات الرسمية",
    enforcedBy: "issued_documents RLS + signed storage URLs",
    rights: {
      student: { view: "own", create: "own", act: "own", approve: "own" },
      staff: { view: "unit", create: "unit" },
      admin: { view: "all", create: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "assignment",
    en: "Case assignment & workload",
    ar: "إسناد الحالات وحجم العمل",
    enforcedBy: "service_staff.can_assign_cases + system_admin",
    rights: {
      student: none,
      staff: { view: "unit", reassign: "unit", report: "unit" },
      admin: { view: "all", reassign: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "sla",
    en: "SLA monitoring & escalations",
    ar: "مراقبة المدد والتصعيدات",
    enforcedBy: "admin_* governance RPCs (manager / admin only)",
    rights: {
      student: { view: "own" },
      staff: { view: "unit", report: "unit" },
      admin: { view: "all", act: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "services",
    en: "Services, availability & ownership",
    ar: "الخدمات والتوفر والملكية",
    enforcedBy: "system_admin role checks",
    rights: {
      student: { view: true },
      staff: { view: "unit", act: "unit" },
      admin: { view: "all", create: "all", act: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "knowledge",
    en: "Knowledge Center sources",
    ar: "مصادر مركز المعرفة",
    enforcedBy: "can_manage_knowledge() / can_approve_knowledge()",
    rights: {
      student: none,
      staff: { view: "unit", create: "unit" },
      admin: { view: "all", create: "all", act: "all", approve: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "reports",
    en: "Reports & university-wide analytics",
    ar: "التقارير والتحليلات على مستوى الجامعة",
    enforcedBy: "can_monitor_all_units()",
    rights: {
      student: none,
      staff: { view: "unit", report: "unit" },
      admin: { view: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "users",
    en: "Users, roles & access withdrawal",
    ar: "المستخدمون والأدوار وسحب الصلاحيات",
    enforcedBy: "system_admin only (user_roles + profiles.access_revoked_at)",
    rights: {
      student: none,
      staff: none,
      admin: { view: "all", create: "all", act: "all", approve: "all", configure: "all", report: "all" },
    },
  },
  {
    code: "audit",
    en: "Technical audit trail",
    ar: "سجل التدقيق الفني",
    enforcedBy: "audit_logs RLS — staff read, system writes",
    rights: {
      student: { view: "own" },
      staff: { view: "unit" },
      admin: { view: "all", report: "all" },
    },
  },
];

export function grantFor(cap: Capability, audience: Audience, right: Right): Grant {
  return cap.rights[audience][right] ?? false;
}
