import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  BedDouble,
  Briefcase,
  BookOpen,
  Compass,
  FileText,
  GraduationCap,
  Lightbulb,
  LifeBuoy,
  MessageSquare,
  MessagesSquare,
  Phone,
  Search,
  ShieldAlert,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { SERVICE_CODES } from "@/lib/services/availability-types";
import { getServiceAvailabilityBoard } from "@/lib/service-availability.functions";
import { ServiceAvailabilityChip } from "@/components/ServiceAvailabilityNotice";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({
    meta: [
      { title: "Help & Services — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Discover how to ask, suggest, report a problem or check alerts with Sanadi, and browse every UAEU student service it can complete for you.",
      },
      { property: "og:title", content: "Help & Services — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Ask, suggest, report or act — Sanadi handles it or connects it to the right university service.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HelpPage,
});

type EmergencyContact = {
  id: string;
  code: string;
  label_en: string;
  label_ar: string;
  description_en: string | null;
  description_ar: string | null;
  phone: string | null;
  url: string | null;
  kind: string;
};

type Interaction = {
  code: string;
  icon: LucideIcon;
  titleEn: string;
  titleAr: string;
  lineEn: string;
  lineAr: string;
  detailEn: string;
  detailAr: string;
  examplesEn: string[];
  examplesAr: string[];
  actionEn: string;
  actionAr: string;
};

const INTERACTIONS: Interaction[] = [
  {
    code: "query",
    icon: MessagesSquare,
    titleEn: "Ask a Question",
    titleAr: "اسأل سؤالاً",
    lineEn: "Answers about your studies, services and records.",
    lineAr: "إجابات عن دراستك وخدماتك وسجلاتك.",
    detailEn:
      "Ask about university services, academic progress, registration, documents, library support, career counselling and any other student matter.",
    detailAr:
      "اسأل عن الخدمات الجامعية والتقدم الأكاديمي والتسجيل والوثائق وخدمات المكتبة والإرشاد المهني وأي شأن طلابي آخر.",
    examplesEn: [
      "Am I eligible to register next term?",
      "Why can't I register for this course?",
      "How many credits do I have left?",
      "I need a To Whom It May Concern letter.",
    ],
    examplesAr: [
      "هل أستطيع التسجيل في الفصل القادم؟",
      "لماذا لا أستطيع التسجيل في هذا المقرر؟",
      "كم ساعة معتمدة تبقّت لي؟",
      "أحتاج شهادة إلى من يهمه الأمر.",
    ],
    actionEn: "Ask Sanadi",
    actionAr: "اسأل سندي",
  },
  {
    code: "suggestion",
    icon: Lightbulb,
    titleEn: "Submit a Suggestion",
    titleAr: "تقديم اقتراح",
    lineEn: "Propose an improvement to any university service.",
    lineAr: "اقترح تحسيناً لأي خدمة جامعية.",
    detailEn:
      "Suggest improvements to services, facilities, transportation, systems or campus life. Sanadi understands and classifies your suggestion, finds the responsible unit, checks for similar suggestions, submits it and lets you track progress.",
    detailAr:
      "اقترح تحسينات للخدمات أو المرافق أو النقل أو الأنظمة أو الحياة الجامعية. يفهم سندي اقتراحك ويصنّفه ويحدد الوحدة المسؤولة ويبحث عن اقتراحات مشابهة ثم يقدّمه ويتيح لك متابعته.",
    examplesEn: ["The bus tracking service should show real-time arrival times."],
    examplesAr: ["يجب أن تعرض خدمة تتبع الحافلات أوقات الوصول الفعلية."],
    actionEn: "Submit a Suggestion",
    actionAr: "تقديم اقتراح",
  },
  {
    code: "complaint",
    icon: MessageSquare,
    titleEn: "Report a Problem",
    titleAr: "الإبلاغ عن مشكلة",
    lineEn: "Report an issue and Sanadi resolves or escalates it.",
    lineAr: "أبلغ عن مشكلة ليحلّها سندي أو يحوّلها للمسؤول.",
    detailEn:
      "Report registration issues, transportation problems, IT faults or service-quality concerns. Sanadi tries to solve it immediately, creates a case where needed, routes it to the right service owner, tracks the service level and keeps you updated.",
    detailAr:
      "أبلغ عن مشكلات التسجيل أو النقل أو تقنية المعلومات أو جودة الخدمة. يحاول سندي حلها فوراً، وينشئ حالة عند الحاجة، ويوجّهها إلى مالك الخدمة المختص، ويتابع المدة المحددة ويبقيك على اطلاع.",
    examplesEn: ["The campus bus has been late every morning this week."],
    examplesAr: ["تأخرت حافلة الحرم الجامعي كل صباح هذا الأسبوع."],
    actionEn: "Report a Problem",
    actionAr: "الإبلاغ عن مشكلة",
  },
  {
    code: "alerts",
    icon: Bell,
    titleEn: "Alerts & Emergency",
    titleAr: "التنبيهات والطوارئ",
    lineEn: "Personal deadlines, holds and urgent updates.",
    lineAr: "المواعيد النهائية والقيود والتحديثات العاجلة الخاصة بك.",
    detailEn:
      "Sanadi shows registration deadlines, academic holds, document updates, overdue actions, appointment reminders and urgent service announcements. Real emergencies use official channels, not Sanadi.",
    detailAr:
      "يعرض سندي مواعيد التسجيل والقيود الأكاديمية وتحديثات الوثائق والإجراءات المتأخرة وتذكيرات المواعيد والإعلانات العاجلة. أما الطوارئ الحقيقية فتُبلَّغ عبر القنوات الرسمية وليس عبر سندي.",
    examplesEn: ["Do I have any urgent alerts?"],
    examplesAr: ["هل لديّ تنبيهات عاجلة؟"],
    actionEn: "View My Alerts",
    actionAr: "عرض تنبيهاتي",
  },
];

type ServiceItem = {
  code: string;
  labelEn: string;
  labelAr: string;
  to?: string;
  params?: Record<string, string>;
  ask?: { en: string; ar: string };
  /** Catalogue code used to show the live availability period. */
  serviceCode?: string;
};

type ServiceGroup = {
  code: string;
  icon: LucideIcon;
  labelEn: string;
  labelAr: string;
  items: ServiceItem[];
};

const SERVICE_GROUPS: ServiceGroup[] = [
  {
    code: "academic",
    icon: GraduationCap,
    labelEn: "Academic & Registration",
    labelAr: "الأكاديمي والتسجيل",
    items: [
      { code: "academic_query", labelEn: "Academic queries", labelAr: "استفسارات أكاديمية", ask: { en: "How is my academic progress?", ar: "كيف يسير تقدمي الأكاديمي؟" } },
      { code: "prereq", labelEn: "Course & prerequisite support", labelAr: "المقررات والمتطلبات السابقة", ask: { en: "Which prerequisites am I missing for my next courses?", ar: "ما المتطلبات السابقة الناقصة لمقرراتي القادمة؟" } },
      { code: "registration", labelEn: "Registration", labelAr: "التسجيل", ask: { en: "Why can't I register for courses?", ar: "لماذا لا أستطيع التسجيل في المقررات؟" } },
      { code: "graduation", labelEn: "Graduation readiness", labelAr: "جاهزية التخرج", ask: { en: "Am I on track to graduate?", ar: "هل أنا على المسار الصحيح للتخرج؟" } },
    ],
  },
  {
    code: "career",
    icon: Briefcase,
    labelEn: "Career Counselling",
    labelAr: "الإرشاد المهني",
    items: [
      { code: "career", labelEn: "Career Counselling", labelAr: "الإرشاد المهني", to: "/career", serviceCode: SERVICE_CODES.career },
      { code: "ats", labelEn: "CV & ATS analysis", labelAr: "تحليل السيرة الذاتية و ATS", to: "/career" },
    ],
  },
  {
    code: "documents",
    icon: FileText,
    labelEn: "Documents",
    labelAr: "الوثائق",
    items: [
      { code: "twimc", labelEn: "To Whom It May Concern letter", labelAr: "شهادة إلى من يهمه الأمر", to: "/documents", serviceCode: SERVICE_CODES.letter },
      { code: "my_docs", labelEn: "My issued documents", labelAr: "وثائقي الصادرة", to: "/documents" },
    ],
  },
  {
    code: "campus",
    icon: BedDouble,
    labelEn: "Campus Services",
    labelAr: "خدمات الحرم الجامعي",
    items: [
      { code: "transport", labelEn: "Transportation", labelAr: "النقل", ask: { en: "I have a question about the campus buses.", ar: "لديّ استفسار عن حافلات الحرم الجامعي." } },
      { code: "campus_entry", labelEn: "Campus entry & parking (proactive — no request needed)", labelAr: "دخول الحرم والمواقف (خدمة استباقية — لا حاجة لطلب)", ask: { en: "Do I need an entry permit to campus?", ar: "كيف أطلب تصريح دخول للجامعة؟" } },
      { code: "appointments", labelEn: "Appointments", labelAr: "المواعيد", ask: { en: "I would like to book an appointment.", ar: "أرغب في حجز موعد." } },

    ],
  },
  {
    code: "financial",
    icon: Wallet,
    labelEn: "Financial Services",
    labelAr: "الخدمات المالية",
    items: [
      { code: "holds", labelEn: "Financial holds & clearance", labelAr: "القيود المالية والإخلاء", ask: { en: "Do I have a financial hold on my account?", ar: "هل يوجد قيد مالي على حسابي؟" } },
      { code: "gov", labelEn: "Government clearance updates", labelAr: "تحديثات التصاريح الحكومية", ask: { en: "What is the status of my government clearance?", ar: "ما حالة التصريح الحكومي الخاص بي؟" } },
    ],
  },
  {
    code: "tech",
    icon: BookOpen,
    labelEn: "Technology & Library",
    labelAr: "التقنية والمكتبة",
    items: [
      { code: "it", labelEn: "IT access & accounts", labelAr: "الدخول والحسابات التقنية", ask: { en: "I have an IT problem with my university account.", ar: "لديّ مشكلة تقنية في حسابي الجامعي." } },
      { code: "library", labelEn: "Library services", labelAr: "خدمات المكتبة", ask: { en: "I have a question about the library services.", ar: "لديّ استفسار عن خدمات المكتبة." } },
    ],
  },
  {
    code: "support",
    icon: LifeBuoy,
    labelEn: "Student Support",
    labelAr: "دعم الطلبة",
    items: [
      { code: "complaints", labelEn: "Complaints", labelAr: "الشكاوى", to: "/submit/$type", params: { type: "complaint" } },
      { code: "suggestions", labelEn: "Suggestions", labelAr: "المقترحات", to: "/submit/$type", params: { type: "suggestion" } },
      { code: "requests", labelEn: "Track my requests", labelAr: "متابعة طلباتي", to: "/requests" },
      { code: "alerts", labelEn: "My alerts", labelAr: "تنبيهاتي", to: "/my-notifications" },
    ],
  },
];

const ICONS: Record<string, LucideIcon> = {
  career: Compass,
  ats: Sparkles,
};

function HelpPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [query, setQuery] = useState("");
  const [openInteraction, setOpenInteraction] = useState<string | null>(null);

  const availabilityBoard = useQuery({
    queryKey: ["help-services"],
    queryFn: () => getServiceAvailabilityBoard(),
    staleTime: 60_000,
  });
  const availabilityByCode = useMemo(
    () => new Map((availabilityBoard.data ?? []).map((r) => [r.service.code, r.availability])),
    [availabilityBoard.data],
  );

  const emergency = useQuery({
    queryKey: ["emergency-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select("id, code, label_en, label_ar, description_en, description_ar, phone, url, kind")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmergencyContact[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SERVICE_GROUPS;
    return SERVICE_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        `${i.labelEn} ${i.labelAr} ${g.labelEn} ${g.labelAr}`.toLowerCase().includes(q),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  function interactionTarget(code: string) {
    if (code === "alerts") return { to: "/my-notifications" as const, search: { tab: "alerts" } as Record<string, string> };
    if (code === "suggestion")
      return {
        to: "/assistant" as const,
        search: { draft: ar ? "لديّ اقتراح لتحسين خدمة جامعية: " : "I have a suggestion to improve a university service: " },
      };
    if (code === "complaint")
      return {
        to: "/assistant" as const,
        search: { draft: ar ? "أريد الإبلاغ عن مشكلة: " : "I want to report a problem: " },
      };
    return { to: "/assistant" as const, search: {} as Record<string, string> };
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">{ar ? "المساعدة والخدمات" : "Help & Services"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "مهما كان ما تحتاجه — اسأل، اقترح، أبلغ، أو نفّذ — سيتولى سندي الأمر أو يوصله إلى الخدمة الجامعية المختصة."
            : "Whatever you need — ask, suggest, report or act — Sanadi will either handle it or connect it to the right university service."}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{ar ? "كيف يمكن لسندي مساعدتك؟" : "How can Sanadi help you?"}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INTERACTIONS.map((item) => {
            const Icon = item.icon;
            const open = openInteraction === item.code;
            const target = interactionTarget(item.code);
            return (
              <div key={item.code} className="flex flex-col rounded-xl border bg-card p-4 card-shadow">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <h3 className="text-sm font-semibold leading-tight">{ar ? item.titleAr : item.titleEn}</h3>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{ar ? item.lineAr : item.lineEn}</p>

                {open ? (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">{ar ? item.detailAr : item.detailEn}</p>
                    <ul className="space-y-1">
                      {(ar ? item.examplesAr : item.examplesEn).map((ex) => (
                        <li key={ex} className="text-xs italic text-muted-foreground">
                          “{ex}”
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button asChild size="sm">
                    <Link to={target.to} search={target.search}>
                      {ar ? item.actionAr : item.actionEn}
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2 text-xs"
                    onClick={() => setOpenInteraction(open ? null : item.code)}
                  >
                    {open ? (ar ? "إخفاء" : "Less") : ar ? "التفاصيل" : "Details"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-4 card-shadow">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">{ar ? "تنبيهات سندي" : "Sanadi Alerts"}</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {ar
                ? "تنبيهات جامعية شخصية وإشعارات خدمات عاجلة: مواعيد التسجيل، القيود، الوثائق، والإجراءات المتأخرة."
                : "Personalised university alerts and urgent service notifications: registration deadlines, holds, documents and overdue actions."}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link to="/my-notifications" search={{ tab: "alerts" }}>{ar ? "عرض تنبيهاتي" : "View My Alerts"}</Link>
            </Button>
          </div>

          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-destructive" aria-hidden />
              <h3 className="text-sm font-semibold text-destructive">{ar ? "الطوارئ" : "Emergency"}</h3>
            </div>
            <p className="mt-2 text-xs text-foreground">
              {ar
                ? "سندي ليس بديلاً عن خدمات الطوارئ. في حالات الخطر الصحي أو الأمني أو المهدد للحياة، استخدم قنوات الطوارئ والأمن المعتمدة في الجامعة أو أرقام الطوارئ الوطنية فوراً. تقديم شكوى عبر سندي لا يُعد بلاغ طوارئ."
                : "Sanadi is not a replacement for emergency services. For immediate health, safety, security or life-threatening emergencies, use the university's approved emergency/security channels or national emergency services right away. Submitting a normal Sanadi complaint is not an emergency report."}
            </p>
            <div className="mt-3 space-y-2">
              {emergency.isLoading ? (
                <p className="text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
              ) : (emergency.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {ar
                    ? "لم تُضف بعد جهات اتصال الطوارئ المعتمدة. يرجى استخدام قنوات الطوارئ الرسمية في الجامعة."
                    : "Approved emergency contacts have not been configured yet. Please use the university's official emergency channels."}
                </p>
              ) : (
                (emergency.data ?? []).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Phone className="size-3.5 text-destructive" aria-hidden />
                    <span className="font-medium">{ar ? c.label_ar : c.label_en}</span>
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="font-semibold text-destructive underline">
                        {c.phone}
                      </a>
                    ) : null}
                    <span className="text-muted-foreground">{ar ? c.description_ar : c.description_en}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{ar ? "الخدمات" : "Services"}</h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ar ? "ابحث في المساعدة والخدمات" : "Search help & services"}
              aria-label={ar ? "ابحث في المساعدة والخدمات" : "Search help & services"}
              className="ps-9"
            />
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {ar ? "لا توجد نتائج. جرّب سؤال سندي مباشرة." : "No matches. Try asking Sanadi directly."}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const GroupIcon = group.icon;
              return (
                <div key={group.code} className="rounded-xl border bg-card p-4 card-shadow">
                  <div className="flex items-center gap-2">
                    <GroupIcon className="size-4 text-primary" aria-hidden />
                    <h3 className="text-sm font-semibold">{ar ? group.labelAr : group.labelEn}</h3>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {group.items.map((item) => {
                      const ItemIcon = ICONS[item.code];
                      const label = ar ? item.labelAr : item.labelEn;
                      const availability = item.serviceCode ? availabilityByCode.get(item.serviceCode) : undefined;
                      const content = (
                        <span className="flex flex-wrap items-center gap-2">
                          {ItemIcon ? <ItemIcon className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                          {label}
                          {availability ? <ServiceAvailabilityChip availability={availability} /> : null}
                        </span>
                      );
                      return (
                        <li key={item.code}>
                          {item.to ? (
                            <Link
                              to={item.to}
                              params={item.params ?? {}}
                              className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                            >
                              {content}
                            </Link>
                          ) : (
                            <Link
                              to="/assistant"
                              search={{ ask: ar ? item.ask?.ar : item.ask?.en }}
                              className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                            >
                              {content}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-secondary/40 p-5">
        <h2 className="text-sm font-semibold">{ar ? "لست متأكداً مما تحتاجه؟" : "Not sure what you need?"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "لا حاجة لاختيار تصنيف. تحدث بلغتك الطبيعية وسيحدد سندي نوع الطلب تلقائياً — مثل: «لديّ مشكلة في حافلات الحرم الجامعي» أو «أريد اقتراح شيء عن المكتبة»."
            : "You never have to pick a category first. Just speak naturally and Sanadi classifies it — for example “I have a problem with the campus buses” or “I want to suggest something about the library”."}
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/assistant" search={{ ask: ar ? "أخبرني بما عليّ فعله الآن." : "Tell me what I need to do." }}>
            {ar ? "اسأل سندي" : "Just ask Sanadi"}
          </Link>
        </Button>
      </section>
    </div>
  );
}
