import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/MetricCard";
import { StatusChip } from "@/components/StatusChip";
import { apiFetch } from "@/lib/auth-token";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

const OPEN_STATUSES = ["submitted", "acknowledged", "assigned", "in_review", "awaiting_student", "resolution_proposed", "escalated"];

/**
 * "My unit" view for a Service Owner: who owns the unit, who backs them up,
 * and how the unit's live workload is performing. All reads go through RLS.
 */
export function UnitOwnerPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["unit-owner-panel", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const meRows = await apiFetch<{ service_unit_id: string | null; job_title_en: string | null; job_title_ar: string | null }[]>(`/api/v1/data/staff_profiles?select=service_unit_id,job_title_en,job_title_ar&user_id=eq.${user!.id}&limit=1`);
      const me = meRows[0] ?? null;
      const unitId = me?.service_unit_id ?? null;
      if (!unitId) return null;

      const [unitRows, team, cases] = await Promise.all([
        apiFetch<{ id: string; code: string; name_en: string; name_ar: string; primary_service_owner_id: string | null }[]>(`/api/v1/data/service_units?select=id,code,name_en,name_ar,primary_service_owner_id&id=eq.${unitId}&limit=1`),
        apiFetch<{ staff_profile_id: string; role_type: string; is_service_owner: boolean; can_approve_actions: boolean; can_view_sensitive_cases: boolean }[]>(`/api/v1/data/service_staff?select=staff_profile_id,role_type,is_service_owner,can_approve_actions,can_view_sensitive_cases&service_unit_id=eq.${unitId}`),
        apiFetch<{ id: string; status: string; resolution_due_at: string | null; resolved_at: string | null; created_at: string }[]>(`/api/v1/data/cases?select=id,status,resolution_due_at,resolved_at,created_at&service_unit_id=eq.${unitId}&limit=500`),
      ]);
      const unit = unitRows[0] ?? null;

      const ids = team.map((m) => m.staff_profile_id);
      const people = ids.length
        ? await apiFetch<{ id: string; full_name: string | null; email: string | null }[]>(`/api/v1/data/profiles?select=id,full_name,email&id=in.(${ids.join(",")})`)
        : [];
      const nameOf = (id: string) =>
        people?.find((p) => p.id === id)?.full_name ?? people?.find((p) => p.id === id)?.email ?? id.slice(0, 8);

      const rows = cases ?? [];
      const open = rows.filter((c) => OPEN_STATUSES.includes(c.status));
      const now = Date.now();
      const overdue = open.filter((c) => c.resolution_due_at && new Date(c.resolution_due_at).getTime() < now);
      const byStatus = Object.entries(
        open.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {}),
      ).map(([status, count]) => ({ status, count }));
      const oldest = open
        .map((c) => new Date(c.created_at).getTime())
        .sort((a, b) => a - b)[0];

      return {
        unit,
        ownerName: unit?.primary_service_owner_id ? nameOf(unit.primary_service_owner_id) : null,
        isOwner: unit?.primary_service_owner_id === user!.id,
        team: team.map((m) => ({ ...m, name: nameOf(m.staff_profile_id) })),
        total: rows.length,
        open: open.length,
        overdue: overdue.length,
        resolved: rows.filter((c) => c.resolved_at).length,
        byStatus,
        oldestDays: oldest ? Math.floor((now - oldest) / 86400000) : null,
      };
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (!data?.unit)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {ar ? "لا توجد وحدة خدمة مرتبطة بحسابك." : "Your account is not linked to a service unit yet."}
      </p>
    );

  return (
    <section className="space-y-4">
      <div className="card-shadow rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">{ar ? data.unit.name_ar : data.unit.name_en}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar ? "مالك الخدمة" : "Service Owner"}: <span className="font-medium text-foreground">{data.ownerName ?? "—"}</span>
          {data.isOwner ? (ar ? " (أنت)" : " (you)") : null}
        </p>
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          {data.team.map((m) => (
            <li key={m.staff_profile_id}>
              {m.name} — {m.is_service_owner ? (ar ? "مالك الخدمة" : "service owner") : m.role_type.replace(/_/g, " ")}
              {m.can_approve_actions ? (ar ? " · يعتمد الإجراءات" : " · approves actions") : ""}
              {m.can_view_sensitive_cases ? (ar ? " · حالات حساسة" : " · sensitive cases") : ""}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "حالات مفتوحة" : "Open cases"} value={data.open} hint={`${data.total} ${ar ? "إجمالي" : "total"}`} />
        <MetricCard
          label={ar ? "متأخرة عن الموعد" : "Past SLA"}
          value={data.overdue}
          tone={data.overdue > 0 ? "danger" : "success"}
        />
        <MetricCard label={ar ? "تم حلها" : "Resolved"} value={data.resolved} tone="success" />
        <MetricCard
          label={ar ? "أقدم حالة مفتوحة" : "Oldest open case"}
          value={data.oldestDays != null ? `${data.oldestDays} ${ar ? "يوم" : "days"}` : "—"}
        />
      </div>

      {data.byStatus.length ? (
        <div className="flex flex-wrap gap-2">
          {data.byStatus.map((s) => (
            <span key={s.status} className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs">
              <StatusChip status={s.status} />
              <span className="tabular-nums font-semibold">{s.count}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
