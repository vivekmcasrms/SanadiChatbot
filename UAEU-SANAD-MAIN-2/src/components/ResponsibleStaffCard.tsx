/** Shows the student who is personally following their request up. */
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { apiFetch } from "@/lib/auth-token";
import { useI18n } from "@/lib/i18n";

type ResponsibleStaff = {
  caseNumber: string;
  status: string;
  assigned: boolean;
  staffName: string | null;
  staffEmail: string | null;
  staffPhone: string | null;
  staffRoleEn: string | null;
  staffRoleAr: string | null;
  unitNameEn: string | null;
  unitNameAr: string | null;
  unitEmail: string | null;
  serviceDesk: boolean;
  escalated: boolean;
};

export function ResponsibleStaffCard({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { data } = useQuery({
    queryKey: ["case-responsible", caseId],
    queryFn: () => apiFetch<ResponsibleStaff | null>(`/api/cases/${caseId}/responsible`),
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (!data) return null;
  const unit = (ar ? data.unitNameAr : data.unitNameEn) ?? data.unitNameEn;
  // Keep the fields visible while routing/assignment is pending. Only display
  // a person's details when the backend returns an actual assignment.

  return (
    <section className="rounded-2xl border bg-card p-5 card-shadow">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4 text-primary" aria-hidden />
        {ar ? "الشخص المسؤول عن متابعة طلبك" : "Who is following up your request"}
      </h2>
      <>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{ar ? "الموظف المسؤول" : "Responsible staff member"}</dt>
              <dd className="font-medium">{data.staffName || (ar ? "بانتظار الإسناد" : "Awaiting assignment")}</dd>
            </div>
              <div>
                <dt className="text-muted-foreground">{ar ? "المسمى الوظيفي" : "Role"}</dt>
                <dd className="font-medium">{(ar ? data.staffRoleAr ?? data.staffRoleEn : data.staffRoleEn) ?? "—"}</dd>
              </div>
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
      {!data.staffName ? (
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{ar ? "الحالة" : "Status"}</dt>
            <dd className="font-medium">
              {data.escalated
                ? (ar
                  ? "تم تصعيد طلبك إلى إدارة الخدمات الطلابية لتعيين مسؤول عنه، وسنبلغك باسم الموظف فور تحديده."
                  : "Your request has been escalated to student services management to name a responsible officer, and you will be told who is handling it as soon as that is confirmed.")
                : !unit
                  ? (ar ? "طلبك بانتظار التوجيه وتعيين الموظف المسؤول." : "Your request is awaiting routing and staff assignment.")
                  : (ar
                  ? "طلبك لدى الوحدة المسؤولة وبانتظار تعيين الموظف الذي سيتابع طلبك."
                  : "Your request is with the responsible unit and is awaiting assignment to a staff member.")}
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
      ) : null}
    </section>
  );
}
