/**
 * Admin Settings structure: every configuration page an administrator can
 * reach, grouped into seven tabs. Pages are linked, never removed, so no
 * existing capability disappears when the menu is simplified.
 */
export type SettingsTabCode =
  | "organisation"
  | "access"
  | "services"
  | "ai"
  | "arabic"
  | "jobs"
  | "integrations";

export type SettingsLink = {
  code: string;
  to: string;
  search?: Record<string, string>;
  labelEn: string;
  labelAr: string;
  descriptionEn: string;
  descriptionAr: string;
};

export type SettingsTab = { code: SettingsTabCode; labelEn: string; labelAr: string; links: SettingsLink[] };

export const SETTINGS_TABS: SettingsTab[] = [
  {
    code: "organisation",
    labelEn: "Organisation",
    labelAr: "المؤسسة",
    links: [
      {
        code: "org_admin",
        to: "/admin",
        labelEn: "Service units & campus alerts",
        labelAr: "وحدات الخدمة والتنبيهات العامة",
        descriptionEn: "Service units, contact details and publishing campus-wide alerts.",
        descriptionAr: "وحدات الخدمة وبيانات التواصل ونشر التنبيهات على مستوى الجامعة.",
      },
      {
        code: "org_notifications",
        to: "/notifications",
        labelEn: "Notifications & email",
        labelAr: "الإشعارات والبريد",
        descriptionEn: "Notification templates, delivery and email settings.",
        descriptionAr: "قوالب الإشعارات والتسليم وإعدادات البريد.",
      },
    ],
  },
  {
    code: "access",
    labelEn: "Access & Roles",
    labelAr: "الوصول والأدوار",
    links: [
      {
        code: "access_users",
        to: "/admin",
        labelEn: "Role assignments",
        labelAr: "إسناد الأدوار",
        descriptionEn: "Give or remove staff roles for each person.",
        descriptionAr: "منح أدوار الموظفين أو سحبها.",
      },
      {
        code: "access_permissions",
        to: "/permissions",
        labelEn: "Roles & permissions",
        labelAr: "الأدوار والصلاحيات",
        descriptionEn: "What each role can see and do.",
        descriptionAr: "ما يمكن لكل دور رؤيته وفعله.",
      },
      {
        code: "access_data_audit",
        to: "/data-audit",
        labelEn: "Data classification audit",
        labelAr: "تدقيق تصنيف البيانات",
        descriptionEn: "Check that sample and real records stay separate.",
        descriptionAr: "التأكد من فصل السجلات التجريبية عن الحقيقية.",
      },
      {
        code: "access_demo",
        to: "/demo-accounts",
        labelEn: "Demo accounts",
        labelAr: "الحسابات التجريبية",
        descriptionEn: "Sample accounts, available only outside the live site.",
        descriptionAr: "حسابات تجريبية متاحة خارج الموقع الرسمي فقط.",
      },
    ],
  },
  {
    code: "services",
    labelEn: "Services",
    labelAr: "الخدمات",
    links: [
      {
        code: "svc_services",
        to: "/services",
        labelEn: "Services & availability",
        labelAr: "الخدمات والتوفر",
        descriptionEn: "Open or close services and set their windows.",
        descriptionAr: "فتح الخدمات أو إغلاقها وتحديد مواعيدها.",
      },
      {
        code: "svc_appointments",
        to: "/appointment-availability",
        labelEn: "Appointment availability",
        labelAr: "أوقات المواعيد",
        descriptionEn: "Appointment slots offered by each unit.",
        descriptionAr: "مواعيد كل وحدة المتاحة للحجز.",
      },
      {
        code: "svc_acceptance",
        to: "/acceptance",
        labelEn: "Acceptance verification",
        labelAr: "التحقق من القبول",
        descriptionEn: "End-to-end checks of each service workflow.",
        descriptionAr: "فحوصات شاملة لمسار كل خدمة.",
      },
    ],
  },
  {
    code: "ai",
    labelEn: "AI",
    labelAr: "الذكاء الاصطناعي",
    links: [
      {
        code: "ai_config",
        to: "/ai-ops",
        search: { tab: "settings" },
        labelEn: "AI configuration",
        labelAr: "إعدادات الذكاء الاصطناعي",
        descriptionEn: "Model, provider, prompts, tools and limits.",
        descriptionAr: "النموذج والمزوّد والتعليمات والأدوات والحدود.",
      },
      {
        code: "ai_quality",
        to: "/ai-ops",
        search: { tab: "quality" },
        labelEn: "Quality & performance",
        labelAr: "الجودة والأداء",
        descriptionEn: "Response quality, speed and orchestrator activity.",
        descriptionAr: "جودة الإجابات وسرعتها ونشاط المنسّق والخدمات.",
      },
      {
        code: "ai_learning",
        to: "/learning",
        labelEn: "Learning Center",
        labelAr: "مركز التعلّم",
        descriptionEn: "Review and approve proposed improvements.",
        descriptionAr: "مراجعة التحسينات المقترحة واعتمادها.",
      },
      {
        code: "ai_evaluation",
        to: "/evaluation",
        labelEn: "Testing & measurement",
        labelAr: "الاختبار والقياس",
        descriptionEn: "Evaluation runs, failure tests and system errors.",
        descriptionAr: "جولات التقييم واختبارات الأعطال وأخطاء النظام.",
      },
    ],
  },
  {
    code: "arabic",
    labelEn: "Arabic",
    labelAr: "العربية",
    links: [
      {
        code: "arabic_quality",
        to: "/arabic-quality",
        labelEn: "Arabic language quality",
        labelAr: "جودة اللغة العربية",
        descriptionEn: "Arabic style for text and voice, and phrase review.",
        descriptionAr: "أسلوب العربية للنص والصوت ومراجعة العبارات.",
      },
    ],
  },
  {
    code: "jobs",
    labelEn: "Jobs",
    labelAr: "المهام",
    links: [
      {
        code: "jobs_runs",
        to: "/job-runs",
        labelEn: "Scheduled jobs",
        labelAr: "المهام المجدولة",
        descriptionEn: "Every background job run, its duration and outcome.",
        descriptionAr: "كل تشغيل للمهام الخلفية ومدته ونتيجته.",
      },
    ],
  },
  {
    code: "integrations",
    labelEn: "Integrations",
    labelAr: "التكاملات",
    links: [
      {
        code: "int_connections",
        to: "/knowledge-center",
        search: { tab: "connections" },
        labelEn: "APIs & data connections",
        labelAr: "الواجهات البرمجية واتصالات البيانات",
        descriptionEn: "University systems Sanadi reads from.",
        descriptionAr: "أنظمة الجامعة التي يقرأ منها سندي.",
      },
    ],
  },
];

/** Every page reachable from Settings, for coverage checks. */
export const SETTINGS_DESTINATIONS = [...new Set(SETTINGS_TABS.flatMap((t) => t.links.map((l) => l.to)))];
