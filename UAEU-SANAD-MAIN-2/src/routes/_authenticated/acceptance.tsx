/**
 * Acceptance Verification — a reviewer's page that proves each delivered area
 * works: live evidence read from real data, plus a short hands-on walkthrough
 * for every area. Administrators only.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { runAcceptanceChecksFn, type AcceptanceCheck } from "@/lib/admin/acceptance.functions";
import { ExceptionEvidencePanel } from "@/components/admin/ExceptionEvidencePanel";

export const Route = createFileRoute("/_authenticated/acceptance")({
  head: () => ({
    meta: [
      { title: "Acceptance Verification — Sanadi | UAEU" },
      {
        name: "description",
        content: "Run live checks and guided walkthroughs that show each Sanadi capability working on real data.",
      },
      { property: "og:title", content: "Acceptance Verification — Sanadi | UAEU" },
      { property: "og:description", content: "Live evidence and hands-on tests for every delivered Sanadi area." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AcceptancePage,
});

type Walkthrough = {
  area: string;
  title: { en: string; ar: string };
  as: { en: string; ar: string };
  steps: { en: string; ar: string }[];
  expect: { en: string; ar: string };
  link: string;
};

const WALKTHROUGHS: Walkthrough[] = [
  {
    area: "governance",
    title: { en: "Governance & Permissions", ar: "الحوكمة والصلاحيات" },
    as: { en: "Sign in as an administrator", ar: "سجّل الدخول كمسؤول" },
    steps: [
      { en: "Open Roles & Permissions and read the three matrices — Student, Service Owner/Staff, Admin.", ar: "افتح «الأدوار والصلاحيات» واقرأ المصفوفات الثلاث." },
      { en: "Check that each right shows its scope (own records, authorised unit, all units).", ar: "تأكد أن كل صلاحية تعرض نطاقها." },
      { en: "In the access panel, withdraw access for a test staff account with a reason.", ar: "من لوحة الوصول، اسحب وصول حساب موظف تجريبي مع ذكر السبب." },
      { en: "Confirm their open cases were reassigned and the change appears in Permission change history.", ar: "تأكد من إعادة إسناد حالاتهم وظهور التغيير في سجل التغييرات." },
      { en: "Restore access again to leave the environment as you found it.", ar: "أعد الوصول لإرجاع البيئة كما كانت." },
    ],
    expect: { en: "Access ends immediately everywhere, nothing in the history is deleted, and every change is logged with who, when and why.", ar: "ينتهي الوصول فوراً، ولا يُحذف أي سجل، ويُوثَّق كل تغيير." },
    link: "/permissions",
  },
  {
    area: "experience",
    title: { en: "Customer Experience (the full journey)", ar: "تجربة المستخدم (الرحلة الكاملة)" },
    as: { en: "Sign in as a student (e.g. 202113)", ar: "سجّل الدخول كطالب (مثلاً 202113)" },
    steps: [
      { en: 'Ask the assistant something operational, e.g. "I have a problem with my bus schedule".', ar: "اسأل المساعد عن مشكلة تشغيلية، مثل مشكلة في جدول الحافلات." },
      { en: "Follow the clarification question, then let Sanadi raise the request.", ar: "أجب عن سؤال التوضيح ثم دع سندي ينشئ الطلب." },
      { en: "Open My Requests and find the new request with its reference number, unit and status.", ar: "افتح «طلباتي» وابحث عن الطلب الجديد برقمه ووحدته وحالته." },
      { en: "Sign in as the assigned staff member and resolve it with an outcome.", ar: "سجّل الدخول كالموظف المسند إليه وقم بحلها مع ذكر النتيجة." },
    ],
    expect: { en: "Ask → understand → verify → route → track → resolve completes without the student repeating anything.", ar: "تكتمل الرحلة دون أن يكرر الطالب أي معلومة." },
    link: "/assistant",
  },
  {
    area: "transparency",
    title: { en: "Transparency & Trust", ar: "الشفافية والثقة" },
    as: { en: "Sign in as the student who owns a request", ar: "سجّل الدخول كصاحب الطلب" },
    steps: [
      { en: "Open any request from My Requests.", ar: "افتح أي طلب من «طلباتي»." },
      { en: 'Read the "What Sanadi Did" section.', ar: "اقرأ قسم «ما قام به سندي»." },
      { en: "Switch the language to Arabic and read it again.", ar: "بدّل اللغة إلى العربية واقرأه مجدداً." },
      { en: "Sign out, sign back in and reopen the same request.", ar: "سجّل الخروج ثم الدخول وافتح الطلب نفسه." },
    ],
    expect: { en: "Plain steps with dates, unit, person and result — no technical wording — and the same history after signing back in.", ar: "خطوات واضحة بالتواريخ والجهة والشخص والنتيجة، وتبقى بعد إعادة الدخول." },
    link: "/requests",
  },
  {
    area: "approvals",
    title: { en: "Approvals", ar: "الموافقات" },
    as: { en: "Sign in as a student", ar: "سجّل الدخول كطالب" },
    steps: [
      { en: 'Ask the assistant to do something that changes data, e.g. "book an appointment with the registrar".', ar: "اطلب من المساعد إجراءً يغيّر بيانات، مثل حجز موعد." },
      { en: "Read the approval card: action, data used, responsible unit, expected result, cost, reversible, risk.", ar: "اقرأ بطاقة الموافقة: الإجراء والبيانات والجهة والنتيجة والتكلفة وإمكانية التراجع." },
      { en: "Cancel once, then repeat and approve.", ar: "ألغِ مرة، ثم كرّر ووافق." },
      { en: "Ask a read-only question (e.g. your GPA) and confirm no approval is requested.", ar: "اسأل سؤالاً للاطلاع فقط وتأكد من عدم طلب موافقة." },
    ],
    expect: { en: "The heading names the exact action, never a generic \u201cConfirm?\u201d, and both the approval and the refusal are stored as auditable records.", ar: "يذكر العنوان الإجراء بدقة، وتُحفظ الموافقة والرفض كسجلات قابلة للتدقيق." },
    link: "/assistant",
  },
  {
    area: "voice",
    title: { en: "Voice Interaction", ar: "التفاعل الصوتي" },
    as: { en: "Sign in as a student with microphone access", ar: "سجّل الدخول كطالب مع إذن الميكروفون" },
    steps: [
      { en: 'Tap the mic, say “I want to complain about the evening bus service,” review the transcript, then Send.', ar: "اضغط الميكروفون وقل «أريد أن أقدم شكوى بخصوص الحافلة المسائية»، راجع النص ثم أرسل." },
      { en: 'In Arabic, say “أقترح أن تتعاون الجامعة مع شركات تقنية أكثر,” review, then Send — expect Suggestion, not Career.', ar: "بالعربي قل اقتراحاً عن شركات تقنية — يُصنَّف اقتراحاً لا إرشاداً مهنياً." },
      { en: 'Ask “Is my UAEU-2026-01063 meeting confirmed?” — expect existing-case follow-up, not a new appointment.', ar: "اسأل عن تأكيد موعد لرقم طلب موجود — متابعة حالة لا حجز جديد." },
      { en: 'Ask “Can I register for CSBP220?” — Registration Readiness uses verified student data.', ar: "اسأل عن إمكانية التسجيل في CSBP220 — جاهزية التسجيل من بيانات موثّقة." },
      { en: "Start a request by voice, continue by typing, then continue by voice in the same conversation.", ar: "ابدأ بالصوت، أكمل بالكتابة، ثم بالصوت في المحادثة نفسها." },
    ],
    expect: {
      en: "Transcripts become normal chat messages on the same assistant path; consequential actions still require the usual approval card; language follows the student.",
      ar: "يصبح النص محادثة عادية عبر مسار المساعد نفسه، وتبقى الموافقة على الإجراءات الحساسة كما هي.",
    },
    link: "/assistant",
  },
  {
    area: "continuity",
    title: { en: "Continuity & Channels", ar: "الاستمرارية والقنوات" },
    as: { en: "Sign in as a student", ar: "سجّل الدخول كطالب" },
    steps: [
      { en: 'Ask the assistant to create an enrolment letter and complete it.', ar: "اطلب إصدار إفادة قيد وأكمل الإجراء." },
      { en: "Refresh the page — the conversation, the letter card and its reference number stay.", ar: "حدّث الصفحة — تبقى المحادثة وبطاقة الإفادة ورقمها." },
      { en: "Sign out, sign in again, open the assistant without any link.", ar: "سجّل الخروج والدخول ثم افتح المساعد دون رابط." },
      { en: "Open the same account on another device or browser.", ar: "افتح الحساب نفسه على جهاز أو متصفح آخر." },
      { en: 'Ask a follow-up such as "who is handling it?" without repeating details.', ar: "اسأل سؤالاً متابعاً دون تكرار التفاصيل." },
    ],
    expect: { en: "The last conversation reopens with all messages and documents, and a short \u201ccontinuing where you left off\u201d line shows the topic, linked request, status and handler.", ar: "تُستأنف المحادثة الأخيرة بكل رسائلها ووثائقها مع سطر «أكملنا من حيث توقفت»." },
    link: "/assistant",
  },
  {
    area: "exceptions",
    title: { en: "Exceptions & Recovery", ar: "الاستثناءات والتعافي" },
    as: { en: "Sign in as a student, then as staff", ar: "سجّل الدخول كطالب ثم كموظف" },
    steps: [
      { en: "Ask something Sanadi has no approved answer for, or ask for a very ambiguous action.", ar: "اسأل عن أمر لا توجد له إجابة معتمدة أو طلباً غامضاً." },
      { en: "Try to confirm an appointment slot that another student has just taken.", ar: "حاول تأكيد موعد حجزه طالب آخر للتو." },
      { en: "As staff, open Monitoring and read \u201cRecovery log (last 14 days)\u201d.", ar: "كموظف، افتح «المراقبة» واقرأ سجل التعافي." },
    ],
    expect: { en: "The student sees one short, non-technical message and an alternative; the technical detail sits internally with a trace reference.", ar: "يرى الطالب رسالة قصيرة غير تقنية وبديلاً، بينما تبقى التفاصيل داخلياً مع مرجع تتبع." },
    link: "/monitoring",
  },
  {
    area: "outcome",
    title: { en: "Outcome & Objection", ar: "النتيجة والاعتراض" },
    as: { en: "Sign in as the student of a resolved request", ar: "سجّل الدخول كطالب لديه طلب محلول" },
    steps: [
      { en: "Open a resolved request and read the outcome card: outcome, explanation, unit, staff member, date, next step.", ar: "افتح طلباً محلولاً واقرأ بطاقة النتيجة." },
      { en: 'Use "Ask about this result" and confirm the reply stays in the same request.', ar: "استخدم «استفسار عن النتيجة» وتأكد من بقائها في الطلب نفسه." },
      { en: 'Use "Raise an objection" with a reason.', ar: "استخدم «تقديم اعتراض» مع ذكر السبب." },
      { en: "As the responsible staff member, confirm the request is now in review and the objection is visible.", ar: "كموظف مسؤول، تأكد من أن الطلب قيد المراجعة والاعتراض ظاهر." },
    ],
    expect: { en: "The original outcome is preserved beside the objection, the status moves to review, the reviewer is notified, and nothing forces a new unrelated request.", ar: "تُحفظ النتيجة الأصلية بجانب الاعتراض وتنتقل الحالة للمراجعة دون إنشاء طلب جديد." },
    link: "/requests",
  },
];

function statusBadge(status: AcceptanceCheck["status"], ar: boolean) {
  const pass = status === "pass";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        pass ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
      }`}
    >
      {pass ? (ar ? "يعمل" : "Working") : ar ? "بحاجة لبيانات" : "Needs data"}
    </span>
  );
}

function AcceptancePage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles, loading } = useAuth();
  const checks = useMutation({ mutationFn: runAcceptanceChecksFn });

  if (loading) return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  if (!roles.includes("system_admin"))
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {ar ? "هذه المنطقة مخصصة لمسؤولي النظام." : "This area is for system administrators."}
      </p>
    );

  const byArea = new Map<string, AcceptanceCheck[]>();
  for (const c of checks.data?.checks ?? []) {
    byArea.set(c.area, [...(byArea.get(c.area) ?? []), c]);
  }

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      <header>
        <h1 className="text-xl font-semibold">{ar ? "التحقق من القبول" : "Acceptance Verification"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "تحقق مباشر من البيانات الحقيقية لكل مجال، مع خطوات تجربة عملية. (الدفع والاختبار مع مستخدمين حقيقيين خارج النطاق.)"
            : "Live evidence from real data for every delivered area, plus a short hands-on test for each. (Payments and real-user testing are out of scope here.)"}
        </p>
        <div className="mt-3">
          <Button onClick={() => checks.mutate()} disabled={checks.isPending}>
            {checks.isPending ? (ar ? "جارٍ الفحص…" : "Checking…") : ar ? "تشغيل الفحص المباشر" : "Run live checks"}
          </Button>
          {checks.data ? (
            <span className="ms-3 text-xs text-muted-foreground">
              {ar ? "آخر فحص: " : "Last run: "}
              {new Date(checks.data.ranAt).toLocaleString(ar ? "ar-AE" : "en-GB")}
            </span>
          ) : null}
        </div>
        {checks.isError ? (
          <p className="mt-2 text-xs text-destructive">
            {ar ? "تعذّر تشغيل الفحص." : "The checks could not be run."}
          </p>
        ) : null}
      </header>

      {WALKTHROUGHS.map((w) => (
        <section key={w.area} className="card-shadow rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{w.title[ar ? "ar" : "en"]}</h2>
            <Link to={w.link} className="text-xs text-primary underline">
              {ar ? "افتح الصفحة" : "Open the page"}
            </Link>
          </div>

          {(byArea.get(w.area) ?? []).map((c) => (
            <div key={c.id} className="mt-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">{c.title[ar ? "ar" : "en"]}</span>
                {statusBadge(c.status, ar)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.evidence[ar ? "ar" : "en"]}</p>
              {c.link ? (
                <Link to={c.link} className="mt-1 inline-block text-xs text-primary underline">
                  {ar ? "افتح مثالاً حقيقياً" : "Open a real example"}
                </Link>
              ) : null}
            </div>
          ))}

          <p className="mt-3 text-xs font-medium">{w.as[ar ? "ar" : "en"]}</p>
          <ol className="mt-1 list-decimal space-y-1 text-xs text-muted-foreground ps-5">
            {w.steps.map((s, i) => (
              <li key={i}>{s[ar ? "ar" : "en"]}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs">
            <span className="font-medium">{ar ? "المتوقع: " : "Expected: "}</span>
            <span className="text-muted-foreground">{w.expect[ar ? "ar" : "en"]}</span>
          </p>

          {w.area === "exceptions" ? <ExceptionEvidencePanel /> : null}
        </section>
      ))}
    </div>
  );
}
