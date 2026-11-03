/** Shows the student who is personally following their request up. */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserRound } from "lucide-react";
import { getCaseResponsibleFn } from "@/lib/assignment.functions";
import { useI18n } from "@/lib/i18n";

export function ResponsibleStaffCard({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const fetchResponsible = useServerFn(getCaseResponsibleFn);
  const { data } = useQuery({
    queryKey: ["case-responsible", caseId],
    queryFn: () => fetchResponsible({ data: { caseId } }),
  });

  if (!data) return null;
  const unit = (ar ? data.unitNameAr : data.unitNameEn) ?? data.unitNameEn;
  // Nothing is shown until the case at least belongs to a unit, and no
  // placeholder person is ever invented before a real assignment exists.
  if (!data.staffName && !unit) return null;

  return (
    <section className="rounded-2xl border bg-card p-5 card-shadow">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4 text-primary" aria-hidden />
        {ar ? "الشخص المسؤول عن متابعة طلبك" : "Who is following up your request"}
      </h2>
      {data.staffName ? (
        <>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{ar ? "الموظف المسؤول" : "Responsible staff member"}</dt>
              <dd className="font-medium">{data.staffName}</dd>
            </div>
            {(ar ? data.staffRoleAr : data.staffRoleEn) ? (
              <div>
                <dt className="text-muted-foreground">{ar ? "المسمى الوظيفي" : "Role"}</dt>
                <dd className="font-medium">{(ar ? data.staffRoleAr : data.staffRoleEn) ?? ""}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{ar ? "الوحدة" : "Unit"}</dt>
              <dd className="font-medium">{unit ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "البريد الجامعي" : "University email"}</dt>
              <dd className="font-medium break-all">
                {data.staffEmail ? <a href={`mailto:${data.staffEmail}`}>{data.staffEmail}</a> : "—"}
              </dd>
            </div>
            {/* Phone only appears when a real number is configured. */}
            {data.staffPhone ? (
              <div>
                <dt className="text-muted-foreground">{ar ? "الهاتف" : "Phone"}</dt>
                <dd className="font-medium">
                  <a href={`tel:${data.staffPhone}`}>{data.staffPhone}</a>
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{ar ? "رقم الطلب" : "Reference"}</dt>
              <dd className="font-medium">{data.caseNumber}</dd>
            </div>
          </dl>
          {data.serviceDesk ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {ar
                ? "تمت إحالة هذا الطلب إلى مكتب خدمة الطلبة للمتابعة الفورية لعدم إمكانية إسناده تلقائياً إلى وحدة مختصة، وسيتولى المكتب المسؤولية والتنسيق مع الجهة المعنية."
                : "This request has been sent to the Service Desk for immediate follow-up because a suitable specialist unit could not be assigned automatically. The Service Desk owns it and is coordinating with the relevant unit."}
            </p>
          ) : null}
        </>
      ) : (
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{ar ? "الجهة المسؤولة" : "Responsible unit"}</dt>
            <dd className="font-medium">{unit}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{ar ? "الحالة" : "Status"}</dt>
            <dd className="font-medium">
              {ar
                ? "تم تصعيد طلبك إلى إدارة الخدمات الطلابية لتعيين مسؤول عنه، وسنبلغك باسم الموظف فور تحديده."
                : "Your request has been escalated to student services management to name a responsible officer, and you will be told who is handling it as soon as that is confirmed."}
            </dd>
          </div>
          {data.unitEmail ? (
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground">{ar ? "بريد الوحدة" : "Unit email"}</dt>
              <dd className="font-medium break-all">
                <a href={`mailto:${data.unitEmail}`}>{data.unitEmail}</a>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}
