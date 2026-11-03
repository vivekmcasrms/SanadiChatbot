import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, BookOpen, ListChecks, CircleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { getMyAcademicRecord } from "@/lib/academic.functions";
import { CardListSkeleton } from "@/components/ListSkeleton";
import type { CourseEntry } from "@/lib/academic-record.server";

export const Route = createFileRoute("/_authenticated/academic")({
  head: () => ({
    meta: [
      { title: "My Academic Record — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Your verified UAEU profile, degree progress, completed courses, current registration and remaining study-plan courses.",
      },
      { property: "og:title", content: "My Academic Record — Sanadi | UAEU" },
      {
        property: "og:description",
        content:
          "Verified profile, degree progress, completed and remaining courses for your UAEU programme.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AcademicPage,
});

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card-shadow scroll-mt-24 space-y-3 rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function CourseList({ items, empty }: { items: CourseEntry[]; empty: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y text-sm">
      {items.map((c) => (
        <li key={`${c.code}-${c.termEn ?? ""}`} className="flex flex-wrap justify-between gap-2 py-2">
          <span>
            <span className="font-medium">{c.code}</span> — {ar ? c.titleAr : c.titleEn}
          </span>
          <span className="text-xs text-muted-foreground">
            {c.creditHours} {ar ? "س.م" : "cr"}
            {c.grade ? ` · ${ar ? "التقدير" : "Grade"} ${c.grade}` : ""}
            {(ar ? c.termAr : c.termEn) ? ` · ${ar ? c.termAr : c.termEn}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AcademicPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const query = useQuery({ queryKey: ["my-academic-record"], queryFn: getMyAcademicRecord });

  if (query.isLoading) return <CardListSkeleton />;
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-muted-foreground">
        {ar ? "تعذّر تحميل سجلك الأكاديمي." : "Your academic record could not be loaded."}
      </p>
    );
  }

  const { snapshot: s, courses } = query.data;
  if (!s.hasProfile) {
    return (
      <div className="card-shadow flex items-start gap-3 rounded-xl border bg-card p-5 text-sm">
        <CircleAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
        <p>
          {ar
            ? "لا يوجد سجل أكاديمي مرتبط بحسابك."
            : "There is no academic record linked to your account."}
        </p>
      </div>
    );
  }

  const total = s.totalCredits ?? 120;
  const percent = Math.min(100, Math.round((s.completedCredits / total) * 100));
  const facts: [string, string][] = [
    [ar ? "الاسم" : "Full name", s.fullName ?? "—"],
    [ar ? "الرقم الجامعي" : "Student ID", s.studentNumber ?? "—"],
    [ar ? "الكلية" : "College", (ar ? s.collegeNameAr : s.collegeNameEn) ?? "—"],
    [ar ? "البرنامج" : "Programme", (ar ? s.programNameAr : s.programNameEn) ?? "—"],
    [ar ? "المستوى الأكاديمي" : "Academic level", s.level ?? "—"],
    [ar ? "حالة القيد" : "Enrollment status", s.enrollmentStatus ?? "—"],
    [ar ? "الفصل الحالي" : "Current semester", (ar ? s.currentTermAr : s.currentTermEn) ?? "—"],
    [ar ? "المعدل التراكمي" : "Cumulative GPA", s.gpa !== null ? String(s.gpa) : "—"],
    [ar ? "الساعات المكتملة" : "Completed credit hours", String(s.completedCredits)],
    [ar ? "الساعات المسجلة" : "Registered credit hours", String(s.registeredCredits)],
    [
      ar ? "التخرج المتوقع" : "Expected graduation",
      s.expectedGraduation ? formatDate(s.expectedGraduation, ar ? "ar" : "en") : "—",
    ],
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">{ar ? "سجلي الأكاديمي" : "My Academic Record"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "بيانات موثقة من سجلك الرسمي في الجامعة."
            : "Verified directly from your official university record."}
        </p>
      </header>

      <Section id="profile" title={ar ? "ملفي الشخصي" : "My profile"} icon={GraduationCap}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="progress" title={ar ? "تقدم التخرج" : "Degree progress"} icon={ListChecks}>
        <p className="text-sm">
          {ar
            ? `${s.completedCredits} من ${total} ساعة معتمدة (${percent}%).`
            : `${s.completedCredits} of ${total} credit hours (${percent}%).`}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </Section>

      <Section id="standing" title={ar ? "الحالة الأكاديمية" : "Academic standing"} icon={ListChecks}>
        <p className="text-sm">{s.standing ?? (ar ? "غير محددة" : "Not set")}</p>
        {s.holds.length > 0 && (
          <ul className="text-sm text-muted-foreground">
            {s.holds.map((h) => (
              <li key={h.titleEn}>• {ar ? h.titleAr : h.titleEn}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="current" title={ar ? "مواد الفصل الحالي" : "Current courses"} icon={BookOpen}>
        <CourseList
          items={courses.current}
          empty={ar ? "لا توجد مواد مسجلة هذا الفصل." : "No courses registered this semester."}
        />
      </Section>

      <Section id="completed" title={ar ? "المواد المكتملة" : "Completed courses"} icon={BookOpen}>
        <CourseList
          items={courses.completed}
          empty={ar ? "لا توجد مواد مكتملة بعد." : "No completed courses yet."}
        />
      </Section>

      <Section id="remaining" title={ar ? "المواد المتبقية" : "Remaining courses"} icon={ListChecks}>
        <p className="mb-2 text-xs text-muted-foreground">
          {ar
            ? "المواد الإجبارية المتبقية بعد استبعاد المواد المكتملة والمسجلة."
            : "Required courses still outstanding, after completed and registered courses."}
        </p>
        <CourseList
          items={courses.remaining}
          empty={
            courses.programCourseCount
              ? ar
                ? "أكملت أو سجلت جميع المواد الإجبارية."
                : "Every required course is completed or registered."
              : ar
                ? "خطة البرنامج غير مسجلة في النظام."
                : "Your programme study plan is not registered in the system."
          }
        />
      </Section>

      <Section
        id="electives"
        title={ar ? "المتطلبات الاختيارية" : "Elective requirements"}
        icon={ListChecks}
      >
        <p className="mb-2 text-xs text-muted-foreground">
          {ar
            ? "تختار عدداً من المواد المعتمدة في كل مجموعة — ولا يُطلب إكمال كل موادها."
            : "You choose a number of approved courses in each group — you do not take every course in it."}
        </p>
        {courses.baskets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {ar ? "لا توجد مجموعات اختيارية مسجلة." : "No elective groups are registered."}
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {courses.baskets.map((b) => (
              <li key={b.basketId} className="space-y-1 py-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{ar ? b.nameAr : b.nameEn}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.satisfied
                      ? ar
                        ? "مكتمل"
                        : "Complete"
                      : ar
                        ? `يتبقى ${b.remainingCreditHours} س.م · ${b.remainingCourseCount} مادة`
                        : `${b.remainingCreditHours} cr · ${b.remainingCourseCount} course(s) remaining`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ar
                    ? `المطلوب ${b.requiredCreditHours} س.م من ${b.eligibleCourses.length} خيار معتمد · مكتمل ${b.completedCreditHours} س.م · مسجل ${b.selectedCreditHours} س.م`
                    : `Requires ${b.requiredCreditHours} cr from ${b.eligibleCourses.length} approved options · ${b.completedCreditHours} cr completed · ${b.selectedCreditHours} cr registered`}
                </p>
                {(ar ? b.noteAr : b.noteEn) && (
                  <p className="text-xs text-muted-foreground">{ar ? b.noteAr : b.noteEn}</p>
                )}
                {!b.courseListVerified && (
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? "قائمة المواد المعتمدة لهذه المجموعة غير مؤكدة رسمياً."
                      : "The approved course list for this group is not officially confirmed."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

    </div>
  );
}
