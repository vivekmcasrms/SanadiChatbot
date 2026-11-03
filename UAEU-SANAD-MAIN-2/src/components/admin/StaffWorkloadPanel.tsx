/** Admin view of live staff workload inside one service unit. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listUnitStaffWorkloadFn } from "@/lib/assignment.functions";
import { useI18n } from "@/lib/i18n";

type UnitOption = { unitId: string; label: string };

export function StaffWorkloadPanel({ units }: { units: UnitOption[] }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [unitId, setUnitId] = useState<string>(units[0]?.unitId ?? "");
  const q = useQuery({
    queryKey: ["unit-staff-workload", unitId],
    queryFn: () => listUnitStaffWorkloadFn({ data: { unitId } }),
    enabled: Boolean(unitId),
    retry: false,
  });

  const availability = (v: string) =>
    v === "on_leave"
      ? ar
        ? "في إجازة"
        : "On leave"
      : v === "unavailable"
        ? ar
          ? "غير متاح"
          : "Unavailable"
        : ar
          ? "متاح"
          : "Available";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">{ar ? "عبء العمل لكل موظف" : "Staff workload"}</CardTitle>
        <select
          aria-label={ar ? "الوحدة" : "Unit"}
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
        >
          {units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {u.label}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 sm:p-0">
        {q.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : (q.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {ar ? "لا يوجد موظفون مسجلون في هذه الوحدة." : "No staff are registered in this unit."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-start">{ar ? "الموظف" : "Staff member"}</th>
                <th className="p-3 text-start">{ar ? "البريد" : "Email"}</th>
                <th className="p-3 text-start">{ar ? "الحالات النشطة" : "Active cases"}</th>
                <th className="p-3 text-start">{ar ? "العبء المرجّح" : "Weighted load"}</th>
                <th className="p-3 text-start">{ar ? "التوافر" : "Availability"}</th>
                <th className="p-3 text-start">{ar ? "آخر إسناد" : "Last assigned"}</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((s) => (
                <tr key={s.staffId} className="border-t">
                  <td className="p-3 font-medium">{s.fullName ?? "—"}</td>
                  <td className="p-3 text-xs break-all">{s.email ?? "—"}</td>
                  <td className="p-3 tabular-nums">{s.activeCases}</td>
                  <td className="p-3 tabular-nums">{s.workload}</td>
                  <td className="p-3 text-xs">
                    {s.isActive ? availability(s.availability) : ar ? "معطّل" : "Inactive"}
                  </td>
                  <td className="p-3 text-xs">
                    {s.lastAssignedAt ? new Date(s.lastAssignedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
