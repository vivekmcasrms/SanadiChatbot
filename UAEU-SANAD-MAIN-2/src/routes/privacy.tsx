import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SanadiLogo } from "@/components/SanadiLogo";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Sanadi | UAEU" },
      {
        name: "description",
        content: "How Sanadi handles personal information for UAEU student services.",
      },
    ],
  }),
  component: PrivacyPage,
});

const ENGLISH_SECTIONS = [
  {
    title: "Information Sanadi uses",
    body: "Sanadi uses the minimum university account, academic, service-request and role information needed to provide authorized services. Information may also include messages you submit and documents you choose to upload, such as a CV.",
  },
  {
    title: "How information is used",
    body: "Information is used to authenticate you, personalize eligible university services, answer questions, process and track requests, create requested documents, route matters to responsible staff, send service notifications and maintain security and audit records.",
  },
  {
    title: "Access and sharing",
    body: "Access is limited by your current UAEU role and service responsibility. Student, staff and administrator access is enforced by the application and its SQL authorization rules. Information is shared only with authorized university units and approved service providers where required to deliver or secure the service.",
  },
  {
    title: "AI, chat and voice",
    body: "Chat content may be processed by approved AI services to produce a response or complete an authorized action. Voice input is converted to text for the requested interaction; Sanadi retains the resulting transcript according to the applicable service record rather than keeping the audio recording.",
  },
  {
    title: "Retention and security",
    body: "Records are retained according to UAEU requirements and the applicable service policy. Sanadi uses role-based access, encrypted transport, authentication controls, audit trails and other technical and organizational safeguards to protect information.",
  },
  {
    title: "Your choices and questions",
    body: "You may ask the responsible UAEU service unit to review or correct information where applicable. For privacy questions or requests, use the official UAEU support and privacy channels and identify the Sanadi service involved.",
  },
];

const ARABIC_SECTIONS = [
  {
    title: "المعلومات التي يستخدمها سندي",
    body: "يستخدم سندي الحد الأدنى من معلومات حسابك الجامعي وبياناتك الأكاديمية وطلبات الخدمة والدور الوظيفي اللازمة لتقديم الخدمات المصرح بها. وقد تشمل المعلومات أيضاً الرسائل التي ترسلها والمستندات التي تختار رفعها، مثل السيرة الذاتية.",
  },
  {
    title: "كيفية استخدام المعلومات",
    body: "تُستخدم المعلومات للتحقق من هويتك، وتخصيص الخدمات الجامعية المؤهلة، والإجابة عن الأسئلة، ومعالجة الطلبات ومتابعتها، وإنشاء المستندات المطلوبة، وتوجيه الحالات إلى الموظفين المسؤولين، وإرسال إشعارات الخدمة، وحفظ سجلات الأمن والتدقيق.",
  },
  {
    title: "الوصول والمشاركة",
    body: "يقتصر الوصول على دورك الحالي في جامعة الإمارات ومسؤوليات الخدمة. ويُطبق وصول الطلبة والموظفين والمسؤولين من خلال التطبيق وقواعد الصلاحيات في قاعدة البيانات. ولا تُشارك المعلومات إلا مع الوحدات الجامعية المخولة ومزودي الخدمات المعتمدين عند الحاجة لتقديم الخدمة أو حمايتها.",
  },
  {
    title: "الذكاء الاصطناعي والمحادثة والصوت",
    body: "قد تتم معالجة محتوى المحادثة بواسطة خدمات ذكاء اصطناعي معتمدة لإنتاج الرد أو تنفيذ إجراء مصرح به. ويُحوّل الإدخال الصوتي إلى نص للتفاعل المطلوب، ويحتفظ سندي بالنص الناتج وفق سجل الخدمة المعمول به بدلاً من الاحتفاظ بالتسجيل الصوتي.",
  },
  {
    title: "الاحتفاظ والأمن",
    body: "يتم الاحتفاظ بالسجلات وفق متطلبات جامعة الإمارات وسياسة الخدمة المعمول بها. ويستخدم سندي صلاحيات حسب الدور، ونقلاً مشفراً، وضوابط للمصادقة، وسجلات تدقيق، وضمانات تقنية وتنظيمية أخرى لحماية المعلومات.",
  },
  {
    title: "خياراتك واستفساراتك",
    body: "يمكنك أن تطلب من الوحدة المسؤولة في جامعة الإمارات مراجعة المعلومات أو تصحيحها حيثما ينطبق. وللاستفسارات أو الطلبات المتعلقة بالخصوصية، استخدم قنوات الدعم والخصوصية الرسمية في الجامعة وحدد خدمة سندي المعنية.",
  },
];

function PrivacyPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const sections = ar ? ARABIC_SECTIONS : ENGLISH_SECTIONS;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background pt-3">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link
            to="/"
            aria-label={ar ? "الانتقال إلى صفحة سندي الرئيسية" : "Go to Sanadi home"}
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SanadiLogo />
          </Link>
          <LanguageSwitcher compact />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {ar ? "العودة إلى الرئيسية" : "Back to home"}
        </Link>

        <div className="mt-8 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {ar ? "سياسة الخصوصية" : "Privacy Policy"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {ar ? "آخر تحديث: 23 سبتمبر 2026" : "Last updated: 23 September 2026"}
            </p>
          </div>
        </div>

        <p className="mt-8 max-w-3xl text-sm leading-7 text-muted-foreground">
          {ar
            ? "سندي هو منصة خدمات طلابية تابعة لجامعة الإمارات العربية المتحدة. توضح هذه السياسة كيفية التعامل مع المعلومات الشخصية عند استخدام سندي، مع استمرار تطبيق سياسات الجامعة والمتطلبات القانونية ذات الصلة."
            : "Sanadi is a United Arab Emirates University student-service platform. This policy explains how personal information is handled when you use Sanadi. Applicable UAEU policies and legal requirements continue to apply."}
        </p>

        <div className="mt-10 space-y-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-xl border bg-card p-5 sm:p-6">
              <h2 className="text-base font-semibold">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
