/**
 * Governance & Permissions — the explicit permissions matrix plus one-step
 * access withdrawal. Administrators only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { StaffAccessPanel } from "@/components/admin/StaffAccessPanel";
import {
  AUDIENCE_LABEL,
  GRANT_LABEL,
  PERMISSION_MATRIX,
  RIGHTS,
  RIGHT_LABEL,
  grantFor,
  type Audience,
} from "@/lib/permissions/matrix";

export const Route = createFileRoute("/_authenticated/permissions")({
  head: () => ({
    meta: [
      { title: "Governance & Permissions — Sanadi | UAEU" },
      {
        name: "description",
        content: "Who can view, act, approve, reassign, close and configure in Sanadi, and how staff access is withdrawn.",
      },
      { property: "og:title", content: "Governance & Permissions — Sanadi | UAEU" },
      { property: "og:description", content: "The Sanadi permissions matrix and one-step access withdrawal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PermissionsPage,
});

const AUDIENCES: Audience[] = ["student", "staff", "admin"];

function cellClass(value: string) {
  if (value === "false") return "text-muted-foreground";
  if (value === "true" || value === "all") return "font-medium text-success";
  return "text-foreground";
}

function PermissionsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles, loading } = useAuth();

  if (loading) return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  if (!roles.includes("system_admin"))
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {ar ? "هذه المنطقة مخصصة لمسؤولي النظام." : "This area is for system administrators."}
      </p>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{ar ? "الأدوار والصلاحيات" : "Roles & Permissions"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "من يستطيع الاطلاع والإنشاء والتنفيذ والاعتماد وإعادة الإسناد والإغلاق والإعداد والاطلاع على التقارير."
            : "Who can view, create, act, approve, reassign, close, configure and report."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {ar
            ? "كل خلية تُطبَّق على الخادم عبر سياسات قاعدة البيانات، وليس بإخفاء العناصر في الواجهة فقط."
            : "Every cell is enforced on the server by database policies — not by hiding things in the interface."}
        </p>
      </header>

      {AUDIENCES.map((audience) => (
        <section key={audience} className="card-shadow overflow-x-auto rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold">{AUDIENCE_LABEL[audience][ar ? "ar" : "en"]}</h2>
          <table className="mt-3 w-full min-w-[46rem] text-xs">
            <thead>
              <tr className="text-start text-muted-foreground">
                <th className="py-2 text-start font-medium">{ar ? "القدرة" : "Capability"}</th>
                {RIGHTS.map((r) => (
                  <th key={r} className="py-2 text-start font-medium">
                    {RIGHT_LABEL[r][ar ? "ar" : "en"]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX.map((cap) => (
                <tr key={cap.code} className="border-t align-top">
                  <td className="py-2 pe-3">
                    <p className="font-medium">{ar ? cap.ar : cap.en}</p>
                    <p className="text-[11px] text-muted-foreground">{cap.enforcedBy}</p>
                  </td>
                  {RIGHTS.map((right) => {
                    const value = String(grantFor(cap, audience, right));
                    return (
                      <td key={right} className={`py-2 pe-3 ${cellClass(value)}`}>
                        {GRANT_LABEL[value]?.[ar ? "ar" : "en"] ?? value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <StaffAccessPanel />
    </div>
  );
}
