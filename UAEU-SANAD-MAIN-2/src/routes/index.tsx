import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessageCircleQuestion,
  Lightbulb,
  AlertTriangle,
  BellRing,
  Wand2,
  ArrowRight,
  Briefcase,
  Home as HomeIcon,
  Repeat,
  Compass,
  FileText,
  GraduationCap,
  MessagesSquare,
  ShieldCheck,
  UserCheck,
  Gauge,
  Sparkles,
  CheckCircle2,
  Brain,
  ClipboardCheck,
  Zap,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { SanadiAvatar } from "@/components/SanadiAvatar";
import { SanadiLogo } from "@/components/SanadiLogo";
import { startSsoLogin } from "@/lib/sso";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sanadi | UAEU — Ask Sanadi. Get things done." },
      {
        name: "description",
        content:
          "Sanadi is an intelligent student service platform for UAEU: ask questions, complete eligible services, generate verifiable documents, submit suggestions or complaints, and get followed up automatically.",
      },
      { property: "og:title", content: "Ask Sanadi. Get things done. | UAEU" },
      {
        property: "og:description",
        content:
          "One conversational gateway to university services — answer, act, generate, route and follow up, in Arabic or English.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Bi = { en: string; ar: string };
const bi = (en: string, ar: string): Bi => ({ en, ar });

const INTERACTIONS = [
  {
    icon: MessageCircleQuestion,
    title: bi("Ask", "اسأل"),
    body: bi(
      "Personalized answers based on your university record and approved information.",
      "إجابات مخصّصة بناءً على سجلك الجامعي والمعلومات المعتمدة.",
    ),
  },
  {
    icon: Wand2,
    title: bi("Request", "اطلب"),
    body: bi(
      "Ask Sanadi to complete available student services for you.",
      "اطلب من سندي إتمام الخدمات الطلابية المتاحة نيابةً عنك.",
    ),
  },
  {
    icon: Lightbulb,
    title: bi("Suggest", "اقترح"),
    body: bi(
      "Send ideas and improvements directly to the responsible unit.",
      "أرسل الأفكار والتحسينات مباشرة إلى الجهة المسؤولة.",
    ),
  },
  {
    icon: AlertTriangle,
    title: bi("Report", "أبلغ"),
    body: bi(
      "Raise a complaint or problem and Sanadi follows up until resolution.",
      "أبلغ عن شكوى أو مشكلة ويتابعها سندي حتى الحل.",
    ),
  },
  {
    icon: BellRing,
    title: bi("Alerts", "التنبيهات"),
    body: bi(
      "Important personalized updates, deadlines and service notifications.",
      "تحديثات ومواعيد وإشعارات خدمية مخصّصة لك.",
    ),
  },
];

const FLOW = [
  { icon: MessageCircleQuestion, label: bi("Ask", "اسأل") },
  { icon: Brain, label: bi("Sanadi understands", "سندي يفهم") },
  { icon: ClipboardCheck, label: bi("Checks your records", "يتحقق من سجلاتك") },
  { icon: Zap, label: bi("Completes the service", "ينجز الخدمة") },
  { icon: Bell, label: bi("Keeps you updated", "يبقيك على اطلاع") },
];

const FLOW_EXAMPLES: Bi[] = [
  bi("Generates verifiable student letters", "يصدر خطابات طلابية قابلة للتحقق"),
  bi("Answers policy questions from official sources", "يجيب عن أسئلة السياسات من مصادر رسمية"),
  bi("Searches the library catalogue and services", "يبحث في فهرس المكتبة وخدماتها"),
  bi("Tracks requests, complaints and suggestions", "يتابع الطلبات والشكاوى والمقترحات"),
  bi("Reviews CVs and provides career guidance", "يراجع السيرة الذاتية ويقدّم إرشاداً مهنياً"),
];

const SERVICES = [
  {
    icon: Compass,
    title: bi("Career Counselling", "الإرشاد المهني"),
    body: bi(
      "Upload your CV for best-fit career paths, ATS analysis, skill gaps and preparation advice.",
      "ارفع سيرتك الذاتية للحصول على أفضل المسارات المهنية وتحليل ATS وفجوات المهارات ونصائح الإعداد.",
    ),
  },
  {
    icon: FileText,
    title: bi("Student Documents", "وثائق الطالب"),
    body: bi(
      "Generate a verifiable English or Arabic “To Whom It May Concern” enrollment letter.",
      "أصدر شهادة «إلى من يهمه الأمر» بالعربية أو الإنجليزية قابلة للتحقق.",
    ),
  },
  {
    icon: GraduationCap,
    title: bi("Academic & Registration", "الأكاديمي والتسجيل"),
    body: bi(
      "Academic progress, registration, prerequisites and graduation readiness.",
      "التقدم الأكاديمي والتسجيل والمتطلبات السابقة وجاهزية التخرج.",
    ),
  },
  {
    icon: MessagesSquare,
    title: bi("Complaints & Suggestions", "الشكاوى والمقترحات"),
    body: bi(
      "Report an issue or propose an improvement — Sanadi routes it and follows up.",
      "أبلغ عن مشكلة أو اقترح تحسيناً — يوجّهها سندي ويتابعها.",
    ),
  },
  {
    icon: BellRing,
    title: bi("Proactive Alerts", "التنبيهات الاستباقية"),
    body: bi(
      "Deadlines, holds and service updates surfaced before they become problems.",
      "المواعيد والقيود وتحديثات الخدمات قبل أن تتحول إلى مشكلات.",
    ),
  },
];

const MAGIC = [
  {
    ask: bi("“What career suits my degree?”", "«ما المسار المهني المناسب لتخصصي؟»"),
    body: bi(
      "Sanadi reads your CV and academic profile, then recommends best-fit paths, skill gaps and next steps.",
      "يقرأ سندي سيرتك الذاتية وملفك الأكاديمي، ثم يوصي بالمسارات الأنسب وفجوات المهارات والخطوات التالية.",
    ),
  },
  {
    ask: bi("“I need proof that I study at UAEU.”", "«أحتاج إثباتاً بأنني أدرس في الجامعة.»"),
    body: bi(
      "Sanadi verifies your student record and creates a downloadable, verifiable letter in English or Arabic.",
      "يتحقق سندي من سجلك ويصدر خطاباً قابلاً للتنزيل والتحقق بالعربية أو الإنجليزية.",
    ),
  },
  {
    ask: bi("“Find me a book for my research project.”", "«ابحث لي عن كتاب لمشروع بحثي.»"),
    body: bi(
      "Sanadi searches the library catalogue, shows availability and gives you a ready-to-use citation.",
      "يبحث سندي في فهرس المكتبة ويعرض التوافر ويمنحك اقتباساً جاهزاً للاستخدام.",
    ),
  },
  {
    ask: bi("“What career suits me?”", "«ما المسار المهني المناسب لي؟»"),
    body: bi(
      "Upload your CV and Sanadi combines it with your academic profile to recommend paths and skill gaps.",
      "ارفع سيرتك الذاتية ليجمعها سندي مع ملفك الأكاديمي ويقترح المسارات وفجوات المهارات.",
    ),
  },
];

const PERSONAL: Bi[] = [
  bi("Programme", "البرنامج"),
  bi("Academic progress", "التقدم الأكاديمي"),
  bi("GPA", "المعدل التراكمي"),
  bi("Completed credits", "الساعات المنجزة"),
  bi("Open requests", "الطلبات المفتوحة"),
  bi("Alerts", "التنبيهات"),
  bi("Issued documents", "الوثائق الصادرة"),
  bi("Appointments", "المواعيد"),
];

const STAFF_VALUE: Bi[] = [
  bi("Routine requests handled automatically", "الطلبات الروتينية تُنجز آلياً"),
  bi("SLA and follow-up managed continuously", "متابعة مستمرة لاتفاقيات مستوى الخدمة"),
  bi("Exceptions clearly highlighted", "إبراز واضح للاستثناءات"),
  bi("Complaints and suggestions routed accurately", "توجيه دقيق للشكاوى والمقترحات"),
  bi("Full action and audit history", "سجل كامل للإجراءات والتدقيق"),
  bi("Service performance visibility", "وضوح في أداء الخدمات"),
  bi("Zero Bureaucracy impact tracking", "قياس أثر «صفر بيروقراطية»"),
];

const TRUST: Bi[] = [
  bi("Verified university data where connected", "بيانات جامعية موثقة عند توفر الربط"),
  bi("Role-based access", "صلاحيات حسب الدور"),
  bi("Secure student-specific services", "خدمات آمنة خاصة بكل طالب"),
  bi("Traceable AI actions", "إجراءات ذكاء اصطناعي قابلة للتتبع"),
  bi("Verifiable generated documents", "وثائق صادرة قابلة للتحقق"),
  bi("Human review for approvals and exceptions", "مراجعة بشرية للموافقات والاستثناءات"),
];

function Section({
  id,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
        ) : null}
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-3 text-sm text-muted-foreground sm:text-base">{subtitle}</p> : null}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Index() {
  const { lang } = useI18n();
  const { session } = useAuth();
  const ar = lang === "ar";
  const T = (v: Bi) => (ar ? v.ar : v.en);
  const handleSsoStart = () => {
    void startSsoLogin().catch(() => toast.error(ar
      ? "تعذر بدء تسجيل الدخول الجامعي. يرجى المحاولة مرة أخرى."
      : "University sign-in could not be started. Please try again."));
  };
  const startLabel = ar ? "ابدأ مع سندي" : "Start with Sanadi";

  const navLinks = [
    { href: "#top", label: bi("Home", "الرئيسية") },
    { href: "#services", label: bi("Services", "الخدمات") },
    { href: "#how", label: bi("How it works", "كيف يعمل") },
  ];

  return (
    <div id="top" className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/85 pt-3 backdrop-blur">
        <div className="mx-auto flex min-w-0 max-w-6xl flex-wrap items-center gap-2 px-4 py-2 lg:h-16 lg:flex-nowrap lg:gap-3 lg:py-0">
          <Link
            to="/"
            aria-label={ar ? "الانتقال إلى صفحة سندي الرئيسية" : "Go to Sanadi home"}
            className="inline-flex w-full min-w-0 rounded-md text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-auto lg:shrink-0"
          >
            <SanadiLogo fillMobile className="w-full lg:w-auto" />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="transition-colors hover:text-foreground">
                {T(l.label)}
              </a>
            ))}
          </nav>
          <div className="grid w-full min-w-0 grid-cols-2 gap-2 lg:ms-auto lg:flex lg:w-auto lg:items-center">
            <div className="min-w-0 [&>button]:w-full"><LanguageSwitcher compact /></div>
            <Button type="button" size="sm" onClick={handleSsoStart} className="w-full lg:w-auto">
              {startLabel}
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,var(--color-accent),transparent)] opacity-70" />
          <div className="relative mx-auto grid w-full min-w-0 max-w-6xl items-center gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr]">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                {ar ? "خدمة طلابية ذكية" : "Intelligent student service"}
              </span>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                {ar ? "اسأل سندي. وتنجز الأمور." : "Ask Sanadi. Get things done."}
              </h1>
              <p className="mt-3 text-lg font-medium text-primary">
                {ar ? "بوابتك الذكية لخدمات الجامعة" : "Your intelligent gateway to university services"}
              </p>
              <p className="mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
                {ar
                  ? "اسأل سؤالاً، اطلب خدمة، قدّم شكوى أو اقتراحاً، أصدر وثيقة، أو دع سندي ينجز الإجراءات الجامعية المؤهلة نيابةً عنك — كل ذلك عبر محادثة واحدة بسيطة."
                  : "Ask a question, request a service, submit a complaint or suggestion, generate documents, or let Sanadi handle eligible university processes for you — all through one simple conversation."}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button type="button" size="lg" onClick={handleSsoStart}>
                    {startLabel}
                    <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#services">{ar ? "استعرض الخدمات" : "Explore services"}</a>
                </Button>
              </div>
            </div>

            {/* Conversation preview */}
            <div className="card-shadow relative min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-3 border-b pb-3">
                <SanadiAvatar className="size-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{ar ? "سندي" : "Sanadi"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ar ? "مثال توضيحي — بيانات غير حقيقية" : "Illustrative example — not real data"}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
                    {ar ? "أحتاج إفادة قيد باللغة الإنجليزية." : "I need an enrolment letter in English."}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <SanadiAvatar className="mt-0.5 size-7" />
                  <p className="max-w-[85%] rounded-2xl bg-muted px-4 py-2">
                    {ar
                      ? "تحققت من سجلك الأكاديمي: قيدك فعّال هذا الفصل ولا توجد قيود."
                      : "I checked your record: your enrolment is active this term and there are no holds."}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <SanadiAvatar className="mt-0.5 size-7" />
                  <p className="max-w-[85%] rounded-2xl bg-muted px-4 py-2">
                    {ar ? "هل أُصدر الخطاب الرسمي الآن؟" : "Shall I issue the official letter now?"}
                  </p>
                </div>
              </div>
              <Button type="button" className="mt-5 w-full" onClick={handleSsoStart}>
                {startLabel}
              </Button>
            </div>
          </div>
        </section>

        {/* INTERACTIONS */}
        <Section
          eyebrow={ar ? "طرق التفاعل" : "Ways to interact"}
          title={ar ? "خمس طرق للتعامل مع سندي" : "Five ways to work with Sanadi"}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {INTERACTIONS.map((c) => (
              <div
                key={c.title.en}
                className="card-shadow rounded-xl border bg-card p-5 transition-transform hover:-translate-y-0.5"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <c.icon className="size-4" aria-hidden />
                </span>
                <p className="mt-3 text-sm font-semibold">{T(c.title)}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{T(c.body)}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* AGENTIC FLOW */}
        <div className="border-y bg-surface">
          <Section
            id="how"
            eyebrow={ar ? "وكيل ذكي" : "Agentic"}
            title={ar ? "أكثر من مجرد إجابات. سندي ينفّذ." : "More than answers. Sanadi takes action."}
          >
            <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {FLOW.map((s, i) => (
                <li key={s.label.en} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 text-primary">
                    <s.icon className="size-4" aria-hidden />
                    <span className="text-xs font-semibold text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{T(s.label)}</p>
                </li>
              ))}
            </ol>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {FLOW_EXAMPLES.map((e) => (
                <li key={e.en} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {T(e)}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* SERVICES */}
        <Section
          id="services"
          eyebrow={ar ? "الخدمات" : "Services"}
          title={ar ? "ماذا يستطيع سندي أن يفعل" : "What Sanadi can do"}
          subtitle={
            ar
              ? "خدمات طلابية شاملة يمكن إنجازها عبر المحادثة."
              : "End-to-end student services you can complete through conversation."
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((s) => (
              <div
                key={s.title.en}
                className="card-shadow group rounded-xl border bg-card p-5 transition-transform hover:-translate-y-0.5"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-3 text-sm font-semibold">{T(s.title)}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{T(s.body)}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Button asChild variant="outline">
              <Link to={session ? "/help" : "/auth"}>
                {ar ? "عرض جميع الخدمات" : "View all services"}
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            </Button>
          </div>
        </Section>

        {/* MAGIC MOMENTS */}
        <div className="border-y bg-surface">
          <Section
            eyebrow={ar ? "أمثلة واقعية" : "Real usage"}
            title={ar ? "لحظات تُظهر الفرق" : "Moments that show the difference"}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {MAGIC.map((m) => (
                <div key={m.ask.en} className="card-shadow rounded-2xl border bg-card p-6">
                  <p className="text-base font-semibold text-primary">{T(m.ask)}</p>
                  <div className="mt-3 flex items-start gap-3">
                    <SanadiAvatar className="size-8" />
                    <p className="text-sm leading-relaxed text-muted-foreground">{T(m.body)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* PERSONALIZATION */}
        <Section
          eyebrow={ar ? "التخصيص" : "Personalization"}
          title={ar ? "مبني حولك أنت" : "Built around you"}
          subtitle={
            ar
              ? "حيثما كان مصرّحاً ومتصلاً، يستخدم سندي معلوماتك الجامعية الموثقة حتى لا تُضطر لإدخال ما تعرفه الجامعة أصلاً."
              : "Where authorized and connected, Sanadi uses your verified university information so you do not have to repeatedly enter information the university already knows."
          }
        >
          <div className="flex flex-wrap gap-2">
            {PERSONAL.map((p) => (
              <span key={p.en} className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium">
                {T(p)}
              </span>
            ))}
          </div>
        </Section>

        {/* ZERO BUREAUCRACY */}
        <div className="border-y bg-surface">
          <Section
            eyebrow={ar ? "صفر بيروقراطية" : "Zero bureaucracy"}
            title={ar ? "بيروقراطية أقل. إنجاز أكثر." : "Less bureaucracy. More action."}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border bg-card p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {ar ? "الطريقة التقليدية" : "Traditional service"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {(ar
                    ? ["البحث", "نموذج", "إدخال البيانات", "إرسال", "انتظار", "متابعة", "زيارة المكتب"]
                    : ["Search", "Form", "Enter information", "Submit", "Wait", "Follow up", "Visit office"]
                  ).map((s) => (
                    <span key={s} className="rounded-md border bg-muted px-2.5 py-1">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="card-shadow rounded-2xl border border-primary/30 bg-card p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  {ar ? "مع سندي" : "With Sanadi"}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {(ar ? ["اسأل", "أكّد", "تم"] : ["Ask", "Confirm", "Done"]).map((s, i) => (
                    <span key={s} className="flex items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-3 py-1.5 text-primary">{s}</span>
                      {i < 2 ? <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden /> : null}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {ar
                    ? "مطبّق على وثائق الطالب وخدمات المكتبة والإرشاد المهني."
                    : "Applied to student documents, library services and career counselling."}
                </p>
              </div>
            </div>
          </Section>
        </div>

        {/* HUMAN OVERSIGHT */}
        <Section
          eyebrow={ar ? "الإشراف البشري" : "Human oversight"}
          title={ar ? "الذكاء الاصطناعي للروتين، والبشر للاستثناءات." : "AI handles the routine. People handle the exceptions."}
          subtitle={
            ar
              ? "ينجز سندي الإجراءات الروتينية المؤهلة تلقائياً. وعندما يتطلب الأمر قراراً أو موافقة أو حالة حساسة أو استثناءً، تُحال الحالة إلى مالك الخدمة المختص."
              : "Sanadi completes eligible routine processes automatically. When a decision, approval, sensitive issue or exception requires human attention, the case is routed to the appropriate Service Owner."
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border bg-card p-6">
              <Zap className="size-5 text-primary" aria-hidden />
              <p className="mt-3 text-sm font-semibold">{ar ? "آلي" : "Automated"}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {ar
                  ? "التحقق من الأهلية، إصدار الوثائق، التسجيل، التوجيه والمتابعة."
                  : "Eligibility checks, document issuance, registration, routing and follow-up."}
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-6">
              <UserCheck className="size-5 text-primary" aria-hidden />
              <p className="mt-3 text-sm font-semibold">{ar ? "مراجعة بشرية" : "Human review"}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {ar
                  ? "الاستثناءات، الموافقات، الحالات الحساسة والقرارات غير القياسية."
                  : "Exceptions, approvals, sensitive cases and non-standard decisions."}
              </p>
            </div>
          </div>
        </Section>

        {/* STAFF VALUE */}
        <div className="border-y bg-surface">
          <Section
            eyebrow={ar ? "للجامعة" : "For the university"}
            title={ar ? "أفضل للطلبة. أكفأ لفرق الخدمة." : "Better for students. More efficient for service teams."}
          >
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {STAFF_VALUE.map((v) => (
                <li key={v.en} className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
                  <Gauge className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="text-muted-foreground">{T(v)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* TRUST */}
        <Section
          eyebrow={ar ? "الثقة" : "Trust"}
          title={ar ? "ثقة وقابلية للتحقق" : "Trust and verification"}
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map((v) => (
              <li key={v.en} className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="text-muted-foreground">{T(v)}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* FINAL CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="hero-gradient card-shadow rounded-3xl px-6 py-14 text-center text-primary-foreground sm:px-12">
            <SanadiAvatar className="mx-auto size-16" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              {ar ? "بماذا يمكن أن نساعدك اليوم؟" : "What do you need help with today?"}
            </h2>
            <p className="mt-3 text-sm opacity-90">
              {ar ? "فقط أخبر سندي بما تحتاج." : "Just tell Sanadi what you need."}
            </p>
            <Button type="button" size="lg" variant="secondary" className="mt-7" onClick={handleSsoStart}>
              {startLabel}
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-center text-xs text-muted-foreground sm:flex-row sm:text-start">
          <div className="flex items-center gap-2">
            <span>
              {ar
                ? "سندي — خدمة طلابية ذكية لجامعة الإمارات العربية المتحدة"
                : "Sanadi — an intelligent student service for United Arab Emirates University"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end">
            <Link
              to="/privacy"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {ar ? "سياسة الخصوصية" : "Privacy Policy"}
            </Link>
            <span>
              {ar
                ? "جامعة الإمارات العربية المتحدة — خدمات الطلبة."
                : "United Arab Emirates University — Student Services."}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
