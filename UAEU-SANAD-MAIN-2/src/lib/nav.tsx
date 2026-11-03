import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Mail,
  ArrowLeftRight,
  Bell,
  BedDouble,
  BookOpen,
  Bot,
  Braces,
  Briefcase,
  Compass,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  LayoutDashboard,
  Library,
  LineChart,
  MessagesSquare,
  Plug,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserCheck,
  Users,
  Workflow,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";

export type NavLink = {
  code: string;
  labelEn: string;
  labelAr: string;
  to: string;
  search?: Record<string, string>;
  params?: Record<string, string>;
  descriptionEn?: string;
  descriptionAr?: string;
  icon?: LucideIcon;
  /** Roles allowed to see this entry. Empty = every authenticated user. */
  roles: AppRole[];
  badge?: BadgeKey;
};

export type NavGroup = {
  code: string;
  labelEn: string;
  labelAr: string;
  icon: LucideIcon;
  roles: AppRole[];
  items: NavLink[];
  badge?: BadgeKey;
};

export type BadgeKey = "operations" | "approvals" | "knowledge" | "integrations";

const STAFF: AppRole[] = [
  "service_officer",
  "service_owner",
  "service_manager",
  "knowledge_manager",
  "knowledge_approver",
  "integration_admin",
  "system_admin",
  "auditor",
  "leadership_viewer",
];
const MANAGERS: AppRole[] = ["service_manager", "system_admin"];
const OPS: AppRole[] = ["service_officer", "service_owner", "service_manager", "system_admin"];
/** Unit-bound owners: a concise, action-oriented workspace, no cross-unit tooling. */
const OWNER: AppRole[] = ["service_owner", "service_manager", "system_admin"];
/** Officer/manager queues that span units. */
const OFFICER: AppRole[] = ["service_officer", "service_manager", "system_admin"];
const KNOWLEDGE: AppRole[] = ["knowledge_manager", "knowledge_approver", "system_admin"];
const INTEGRATIONS: AppRole[] = ["integration_admin", "system_admin"];
const INSIGHTS: AppRole[] = ["service_manager", "leadership_viewer", "system_admin", "auditor"];
const ADMIN: AppRole[] = ["system_admin"];
const AUDIT: AppRole[] = ["auditor", "system_admin"];
/** Case monitoring is an administrative oversight surface, never a Service Owner one. */
const MONITOR: AppRole[] = ["system_admin", "service_manager", "leadership_viewer"];

/**
 * Roles that turn a Service Owner into a wider administrative user.
 * `service_officer` is deliberately absent: owners are routinely also
 * officers of their own unit, and that pairing is still a lean owner.
 */
const NON_OWNER_ROLES: AppRole[] = [
  "system_admin",
  "service_manager",
  "knowledge_manager",
  "knowledge_approver",
  "integration_admin",
  "auditor",
  "leadership_viewer",
];

/**
 * True for a user whose only role is Service Owner. They get the lean,
 * action-first workspace instead of the administrative navigation.
 */
export function isServiceOwnerOnly(roles: AppRole[]): boolean {
  return roles.includes("service_owner") && !roles.some((r) => NON_OWNER_ROLES.includes(r));
}

/**
 * Lean Service Owner navigation: four operational destinations, nothing
 * administrative. AI-managed routine work stays invisible until a human
 * decision is genuinely required.
 */
export const OWNER_NAV: NavGroup[] = [
  {
    code: "owner_dashboard",
    labelEn: "Dashboard",
    labelAr: "لوحة المعلومات",
    icon: LayoutDashboard,
    roles: ["service_owner"],
    items: [],
  },
  {
    code: "owner_attention",
    labelEn: "Needs Your Attention",
    labelAr: "يحتاج انتباهك",
    icon: ShieldAlert,
    roles: ["service_owner"],
    badge: "operations",
    items: [],
  },
  {
    code: "owner_requests",
    labelEn: "My Assigned Requests",
    labelAr: "الطلبات المسندة إليّ",
    icon: ClipboardList,
    roles: ["service_owner"],
    items: [],
  },
  // No standalone Messages destination: every conversation with a student
  // lives inside the request it belongs to.
  {
    code: "owner_completed",
    labelEn: "Completed",
    labelAr: "المكتملة",
    icon: CheckCircle2,
    roles: ["service_owner"],
    items: [],
  },
  {
    code: "account",
    labelEn: "Settings",
    labelAr: "الإعدادات",
    icon: Settings,
    roles: ["service_owner"],
    items: [],
  },
];

/**
 * Administrator navigation: monitor → govern → configure → analyse → report.
 *
 * Seven destinations, each answering a different question. Anything that only
 * repeats a number shown elsewhere is deliberately absent — the admin should
 * see the whole university without being shown the whole system.
 */
export const GOVERNANCE_NAV: NavGroup[] = [
  {
    code: "dashboard",
    labelEn: "Dashboard",
    labelAr: "لوحة المعلومات",
    icon: LayoutDashboard,
    roles: ADMIN,
    items: [],
  },
  {
    code: "gov_units",
    labelEn: "Units & Performance",
    labelAr: "الوحدات والأداء",
    icon: Building2,
    roles: ADMIN,
    items: [],
  },
  {
    code: "gov_cases",
    labelEn: "Requests & Cases",
    labelAr: "الطلبات والحالات",
    icon: ClipboardList,
    roles: ADMIN,
    badge: "operations",
    items: [],
  },
  {
    code: "gov_services",
    labelEn: "Services & Availability",
    labelAr: "الخدمات والتوفر",
    icon: Workflow,
    roles: ADMIN,
    items: [],
  },
  {
    code: "gov_appointments",
    labelEn: "Appointment Availability",
    labelAr: "أوقات المواعيد",
    icon: CalendarClock,
    roles: ADMIN,
    items: [],
  },
  {
    code: "gov_knowledge",
    labelEn: "Knowledge Center",
    labelAr: "مركز المعرفة",
    icon: BookOpen,
    roles: ADMIN,
    badge: "knowledge",
    items: [],
  },
  {
    code: "gov_reports",
    labelEn: "Reports",
    labelAr: "التقارير",
    icon: LineChart,
    roles: ADMIN,
    items: [],
  },
  {
    code: "gov_admin",
    labelEn: "Administration",
    labelAr: "الإدارة",
    icon: ShieldCheck,
    roles: ADMIN,
    items: [
      { code: "users", labelEn: "Users & Access", labelAr: "المستخدمون والصلاحيات", to: "/admin", icon: Users, roles: ADMIN },
      {
        code: "learning_center",
        labelEn: "Learning Center",
        labelAr: "مركز التعلّم",
        to: "/learning",
        icon: Bot,
        roles: ADMIN,
      },
      {
        code: "permissions",
        labelEn: "Permissions & Access Control",
        labelAr: "الصلاحيات والتحكم بالوصول",
        to: "/permissions",
        icon: ShieldCheck,
        roles: ADMIN,
      },
      {
        code: "acceptance",
        labelEn: "Acceptance Verification",
        labelAr: "التحقق من القبول",
        to: "/acceptance",
        icon: CheckCircle2,
        roles: ADMIN,
      },
      {
        code: "evaluation",
        labelEn: "Testing & Measurement",
        labelAr: "الاختبار والقياس",
        to: "/evaluation",
        icon: LineChart,
        roles: ADMIN,
      },
      {
        code: "directory",
        labelEn: "Account Directory",
        labelAr: "دليل الحسابات",
        to: "/demo-accounts",
        icon: Users,
        roles: ADMIN,
      },
      {
        code: "notification_ops",
        labelEn: "Notifications & Email",
        labelAr: "الإشعارات والبريد",
        to: "/notifications",
        icon: Mail,
        roles: ADMIN,
      },
      {
        code: "ai_config",
        labelEn: "System Configuration",
        labelAr: "إعدادات النظام",
        to: "/ai-ops",
        search: { tab: "settings" },
        icon: Bot,
        roles: ADMIN,
      },
    ],
  },
  {
    code: "account",
    labelEn: "Settings",
    labelAr: "الإعدادات",
    icon: Settings,
    roles: ADMIN,
    items: [],
  },
];


/** Student navigation stays intentionally small and free of administrative tooling. */
export const STUDENT_PRIMARY_NAV: NavLink[] = [
  { code: "assistant", labelEn: "Assistant", labelAr: "المساعد", to: "/assistant", icon: Bot, roles: [] },
  { code: "requests", labelEn: "My Requests", labelAr: "طلباتي", to: "/requests", icon: ClipboardList, roles: [] },
  
];

/** Secondary student services, grouped behind one "Services" dropdown. */
const ALL_STUDENT_SERVICES_NAV: NavLink[] = [
  {
    code: "career",
    labelEn: "Career Counselling",
    labelAr: "الإرشاد المهني",
    to: "/career",
    icon: Compass,
    roles: [],
    descriptionEn: "CV analysis, career fit and your action plan",
    descriptionAr: "تحليل السيرة الذاتية والتوافق المهني وخطة العمل",
  },
  {
    code: "library",
    labelEn: "Ask the Librarian",
    labelAr: "اسأل أمين المكتبة",
    to: "/library",
    icon: Library,
    roles: [],
    descriptionEn: "Catalogue search, live hours and librarian support",
    descriptionAr: "البحث في الفهرس وساعات العمل ودعم أمين المكتبة",
  },
  {
    code: "campus-services",
    labelEn: "Campus Services",
    labelAr: "خدمات الحرم الجامعي",
    to: "/campus-services",
    icon: Building2,
    roles: [],
    descriptionEn: "Every unit, its contact details and open appointments",
    descriptionAr: "كل وحدة وبيانات التواصل والمواعيد المتاحة",
  },

  {
    code: "documents",
    labelEn: "My Documents",
    labelAr: "وثائقي",
    to: "/documents",
    icon: FileText,
    roles: [],
    descriptionEn: "Official letters, issued instantly and verifiable",
    descriptionAr: "شهادات رسمية تصدر فوراً وقابلة للتحقق",
  },
];


export const STUDENT_SERVICES_NAV: NavLink[] = ALL_STUDENT_SERVICES_NAV;

/** Combined list, kept for breadcrumbs, search and mobile fallbacks. */
export const STUDENT_NAV: NavLink[] = [...STUDENT_PRIMARY_NAV, ...STUDENT_SERVICES_NAV];

/**
 * Role-aware administrative navigation.
 *
 * Service Owners get an operational command centre for their own service.
 * Knowledge, AI, integration, university-setup and administration modules are
 * only rendered for the roles that actually own them; a user holding several
 * roles sees the union, kept in clearly separated sections.
 */
export const ADMIN_NAV: NavGroup[] = [
  {
    code: "dashboard",
    labelEn: "Dashboard",
    labelAr: "لوحة المعلومات",
    icon: LayoutDashboard,
    roles: STAFF,
    items: [],
  },
  {
    code: "my_service",
    labelEn: "My Service",
    labelAr: "خدمتي",
    icon: Workflow,
    roles: OPS,
    badge: "operations",
    items: [
      {
        code: "overview",
        labelEn: "Overview",
        labelAr: "نظرة عامة",
        to: "/owner-console",
        search: { tab: "overview" },
        icon: LayoutDashboard,
        roles: OWNER,
      },
      {
        code: "attention",
        labelEn: "Needs Your Attention",
        labelAr: "يحتاج انتباهك",
        to: "/owner-console",
        search: { tab: "attention" },
        icon: ShieldAlert,
        roles: OPS,
      },
      {
        code: "unit_cases",
        labelEn: "Cases",
        labelAr: "الحالات",
        to: "/owner-console",
        search: { tab: "cases" },
        icon: ClipboardList,
        roles: OWNER,
        badge: "operations",
      },
      {
        code: "unit_chats",
        labelEn: "Chats",
        labelAr: "المحادثات",
        to: "/owner-console",
        search: { tab: "chats" },
        icon: MessagesSquare,
        roles: OWNER,
      },
      {
        code: "cases",
        labelEn: "Case Queue (all units)",
        labelAr: "قائمة الحالات (كل الوحدات)",
        to: "/staff",
        search: { view: "queue" },
        icon: ClipboardList,
        roles: OFFICER,
        badge: "operations",
      },
      {
        code: "suggestions",
        labelEn: "Suggestions",
        labelAr: "المقترحات",
        to: "/staff",
        search: { view: "suggestions" },
        roles: OFFICER,
      },
    ],
  },
  {
    code: "follow_up",
    labelEn: "Follow-Up",
    labelAr: "المتابعة",
    icon: Timer,
    roles: OPS,
    items: [],
  },
  {
    code: "sla",
    labelEn: "SLA & Escalations",
    labelAr: "المدد والتصعيدات",
    icon: Gauge,
    roles: OPS,
    items: [],
  },
  {
    code: "approvals_group",
    labelEn: "Approvals",
    labelAr: "الموافقات",
    icon: UserCheck,
    roles: OFFICER,
    badge: "approvals",
    items: [],
  },
  {
    code: "service_insights",
    labelEn: "Insights",
    labelAr: "تحليلات خدمتي",
    icon: LineChart,
    roles: ["service_officer", "service_owner", "service_manager"],
    items: [],
  },
  {
    code: "knowledge_ai",
    labelEn: "Knowledge & AI",
    labelAr: "المعرفة والذكاء الاصطناعي",
    icon: BookOpen,
    roles: [...KNOWLEDGE, ...ADMIN],
    badge: "knowledge",
    items: [
      {
        code: "knowledge_center",
        labelEn: "Knowledge Center",
        labelAr: "مركز المعرفة",
        to: "/knowledge-center",
        search: { tab: "documents" },
        roles: KNOWLEDGE,
        badge: "knowledge",
      },
      {
        code: "knowledge_search",
        labelEn: "Knowledge Search",
        labelAr: "بحث المعرفة",
        to: "/knowledge",
        roles: KNOWLEDGE,
      },
      {
        code: "ai_config",
        labelEn: "AI Configuration",
        labelAr: "إعدادات الذكاء الاصطناعي",
        to: "/ai-ops",
        search: { tab: "settings" },
        roles: ADMIN,
      },
      {
        code: "quality",
        labelEn: "Quality & Evaluation",
        labelAr: "الجودة والتقييم",
        to: "/ai-ops",
        search: { tab: "quality" },
        roles: ADMIN,
      },
    ],
  },
  {
    code: "integrations",
    labelEn: "Integrations",
    labelAr: "التكاملات",
    icon: Plug,
    roles: INTEGRATIONS,
    badge: "integrations",
    items: [
      {
        code: "connections",
        labelEn: "Data Connections",
        labelAr: "اتصالات البيانات",
        to: "/knowledge-center",
        search: { tab: "connections" },
        icon: Braces,
        roles: INTEGRATIONS,
        badge: "integrations",
      },
    ],
  },
  {
    code: "university",
    labelEn: "University Setup",
    labelAr: "إعداد الجامعة",
    icon: Building2,
    roles: ADMIN,
    items: [
      {
        code: "organization",
        labelEn: "Organization & Services",
        labelAr: "الهيكل والخدمات",
        to: "/admin",
        roles: ADMIN,
      },
    ],
  },
  {
    code: "automation",
    labelEn: "Automation",
    labelAr: "الأتمتة",
    icon: Timer,
    roles: MANAGERS,
    items: [
      { code: "jobs", labelEn: "Scheduled Jobs", labelAr: "المهام المجدولة", to: "/job-runs", roles: MANAGERS },
      {
        code: "manager_escalations",
        labelEn: "Escalations (all units)",
        labelAr: "التصعيدات (كل الوحدات)",
        to: "/staff",
        search: { view: "escalations" },
        roles: MANAGERS,
      },
    ],
  },
  {
    code: "insights",
    labelEn: "Insights",
    labelAr: "التحليلات",
    icon: LineChart,
    roles: INSIGHTS,
    items: [
      {
        code: "leadership",
        labelEn: "Leadership Impact",
        labelAr: "أثر سندي للقيادة",
        to: "/leadership",
        icon: LineChart,
        roles: INSIGHTS,
      },
    ],
  },
  {
    code: "administration",
    labelEn: "Administration",
    labelAr: "الإدارة",
    icon: ShieldCheck,
    roles: [...ADMIN, ...AUDIT, ...MONITOR],
    items: [
      {
        code: "case_monitoring",
        labelEn: "Case Monitoring & SLA",
        labelAr: "مراقبة الحالات ومستويات الخدمة",
        to: "/monitoring",
        icon: Gauge,
        roles: MONITOR,
      },
      {
        code: "notification_ops",
        labelEn: "Notifications & Email",
        labelAr: "الإشعارات والبريد",
        to: "/notifications",
        icon: Mail,
        roles: ADMIN,
      },
      { code: "users", labelEn: "Users & Access", labelAr: "المستخدمون والصلاحيات", to: "/admin", icon: Users, roles: ADMIN },
      {
        code: "learning_center",
        labelEn: "Learning Center",
        labelAr: "مركز التعلّم",
        to: "/learning",
        icon: Bot,
        roles: ADMIN,
      },

      {
        code: "demo_accounts",
        labelEn: "Account Directory",
        labelAr: "الحسابات التجريبية",
        to: "/demo-accounts",
        icon: Users,
        roles: ADMIN,
      },
      {
        code: "audit",
        labelEn: "Audit Logs",
        labelAr: "سجلات التدقيق",
        to: "/dashboard",
        search: { view: "audit" },
        icon: ScrollText,
        roles: AUDIT,
      },
    ],
  },
  {
    code: "account",
    labelEn: "Settings",
    labelAr: "الإعدادات",
    icon: Settings,
    roles: STAFF,
    items: [],
  },
];

/** Direct destinations for groups that are a single page (no children). */
export const GROUP_TARGET: Record<string, { to: string; search?: Record<string, string> }> = {
  dashboard: { to: "/dashboard" },
  insights: { to: "/leadership" },
  follow_up: { to: "/owner-console", search: { tab: "followup" } },
  sla: { to: "/owner-console", search: { tab: "sla" } },
  approvals_group: { to: "/staff", search: { view: "approvals" } },
  service_insights: { to: "/owner-console", search: { tab: "insights" } },
  account: { to: "/settings" },
  owner_dashboard: { to: "/owner-console", search: { tab: "dashboard" } },
  owner_attention: { to: "/owner-console", search: { tab: "attention" } },
  owner_requests: { to: "/owner-console", search: { tab: "assigned" } },
  owner_completed: { to: "/owner-console", search: { tab: "completed" } },
  gov_units: { to: "/units" },
  gov_cases: { to: "/monitoring" },
  gov_services: { to: "/services" },
  gov_appointments: { to: "/appointment-availability" },
  gov_knowledge: { to: "/knowledge-center", search: { tab: "documents" } },
  gov_reports: { to: "/reports" },

};

export function allowed(roles: AppRole[], required: AppRole[]): boolean {
  if (required.length === 0) return true;
  return roles.some((r) => required.includes(r));
}

/** True for a governance user: the concise, university-wide admin experience. */
export function isGovernanceAdmin(roles: AppRole[]): boolean {
  return roles.includes("system_admin");
}

export function visibleNav(roles: AppRole[]): NavGroup[] {
  if (isServiceOwnerOnly(roles)) return OWNER_NAV;
  if (isGovernanceAdmin(roles)) return GOVERNANCE_NAV;
  return ADMIN_NAV.filter((g) => allowed(roles, g.roles)).map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed(roles, i.roles)),
  }));
}



/** Role-specific landing page after sign-in. First matching role wins. */
const LANDING: { role: AppRole; to: string; search?: Record<string, string> }[] = [
  { role: "system_admin", to: "/dashboard" },
  { role: "service_manager", to: "/dashboard" },
  { role: "auditor", to: "/dashboard", search: { view: "audit" } },
  { role: "integration_admin", to: "/knowledge-center", search: { tab: "connections" } },
  { role: "knowledge_approver", to: "/knowledge-center", search: { tab: "documents" } },
  { role: "knowledge_manager", to: "/knowledge-center", search: { tab: "documents" } },
  { role: "service_owner", to: "/owner-console", search: { tab: "dashboard" } },
  { role: "service_officer", to: "/staff", search: { view: "queue" } },
  { role: "auditor", to: "/dashboard", search: { view: "audit" } },
  { role: "leadership_viewer", to: "/leadership" },
];

export function landingFor(roles: AppRole[]): { to: string; search?: Record<string, string> } {
  for (const entry of LANDING) {
    if (roles.includes(entry.role)) {
      return entry.search ? { to: entry.to, search: entry.search } : { to: entry.to };
    }
  }
  return { to: "/assistant" };
}

export type Crumb = { labelEn: string; labelAr: string };

/** Breadcrumb trail for the current pathname + search. */
export function crumbsFor(pathname: string, search: Record<string, unknown>): Crumb[] {
  // Lean owner destinations first: they are the most specific match for
  // /owner-console tabs.
  for (const group of [...OWNER_NAV, ...GOVERNANCE_NAV]) {
    const target = GROUP_TARGET[group.code];
    if (!target || target.to !== pathname) continue;
    const keys = Object.keys(target.search ?? {});
    if (keys.every((k) => String(search[k] ?? "") === target.search![k])) {
      return [{ labelEn: group.labelEn, labelAr: group.labelAr }];
    }
  }

  for (const group of ADMIN_NAV) {

    for (const item of group.items) {
      if (item.to !== pathname) continue;
      const keys = Object.keys(item.search ?? {});
      const matches = keys.every((k) => String(search[k] ?? "") === item.search![k]);
      if (keys.length === 0 || matches) {
        return [
          { labelEn: group.labelEn, labelAr: group.labelAr },
          { labelEn: item.labelEn, labelAr: item.labelAr },
        ];
      }
    }
  }
  for (const group of ADMIN_NAV) {
    const target = GROUP_TARGET[group.code];
    if (target && target.to === pathname) {
      const keys = Object.keys(target.search ?? {});
      if (keys.every((k) => String(search[k] ?? "") === target.search![k])) {
        return [{ labelEn: group.labelEn, labelAr: group.labelAr }];
      }
    }
    for (const item of group.items) {
      if (item.to === pathname) {
        return [
          { labelEn: group.labelEn, labelAr: group.labelAr },
          { labelEn: item.labelEn, labelAr: item.labelAr },
        ];
      }
    }
  }
  const fallback: Record<string, Crumb> = {
    "/assistant": { labelEn: "Assistant", labelAr: "المساعد" },
    "/requests": { labelEn: "My Requests", labelAr: "طلباتي" },
    "/documents": { labelEn: "My Documents", labelAr: "وثائقي" },
    "/career": { labelEn: "Career Counselling", labelAr: "الإرشاد المهني" },
    "/alerts": { labelEn: "Alerts", labelAr: "التنبيهات" },
    "/settings": { labelEn: "Settings", labelAr: "الإعدادات" },
  };
  const hit = fallback[pathname];
  return hit ? [hit] : [];
}

export const QUICK_ACTIONS: NavLink[] = [
  {
    code: "qa_upload_knowledge",
    labelEn: "Upload Knowledge",
    labelAr: "رفع محتوى معرفي",
    to: "/knowledge-center",
    search: { tab: "documents" },
    icon: BookOpen,
    roles: KNOWLEDGE,
  },
  {
    code: "qa_connector",
    labelEn: "Add API Connection",
    labelAr: "إضافة اتصال واجهة برمجية",
    to: "/knowledge-center",
    search: { tab: "connections" },
    icon: Plug,
    roles: INTEGRATIONS,
  },
  {
    code: "qa_alert_rule",
    labelEn: "Create Alert Rule",
    labelAr: "إنشاء قاعدة تنبيه",
    to: "/admin",
    icon: Bell,
    roles: ADMIN,
  },
  {
    code: "qa_approvals",
    labelEn: "Review Pending Approvals",
    labelAr: "مراجعة الموافقات المعلقة",
    to: "/staff",
    search: { view: "approvals" },
    icon: ShieldCheck,
    roles: MANAGERS,
  },
  {
    code: "qa_overdue",
    labelEn: "View Overdue Cases",
    labelAr: "الحالات المتأخرة",
    to: "/staff",
    search: { view: "escalations" },
    icon: Gauge,
    roles: OFFICER,
  },
  {
    code: "qa_assistant",
    labelEn: "Test Student Assistant",
    labelAr: "اختبار مساعد الطالب",
    to: "/assistant",
    icon: Bot,
    roles: STAFF,
  },
];
