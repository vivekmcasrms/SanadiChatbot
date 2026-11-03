/** One-step withdrawal (and restoration) of staff / Service Owner access. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastError } from "@/lib/errors/toast";
import { useI18n } from "@/lib/i18n";
import {
  listAccessAuditFn,
  listStaffAccessFn,
  restoreStaffAccessFn,
  revokeStaffAccessFn,
  type StaffAccessRow,
} from "@/lib/admin/access.functions";

export function StaffAccessPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const list = useServerFn(listStaffAccessFn);
  const revoke = useServerFn(revokeStaffAccessFn);
  const restore = useServerFn(restoreStaffAccessFn);
  const [target, setTarget] = useState<StaffAccessRow | null>(null);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");

  const query = useQuery({ queryKey: ["staff-access"], queryFn: () => list({ data: undefined }) });

  const revokeMutation = useMutation({
    mutationFn: (row: StaffAccessRow) =>
      revoke({ data: { userId: row.userId, reason: reason.trim(), reassignOpenCases: true } }),
    onSuccess: (res) => {
      toast.success(
        ar
          ? `تم سحب الصلاحيات فوراً. أُعيد إسناد ${res.reassigned} حالة.`
          : `Access withdrawn immediately. ${res.reassigned} case(s) reassigned.`,
      );
      setTarget(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["staff-access"] });
    },
    onError: (e) => toastError(e, lang),
  });

  const restoreMutation = useMutation({
    mutationFn: (row: StaffAccessRow) => restore({ data: { userId: row.userId } }),
    onSuccess: () => {
      toast.success(ar ? "تمت إعادة الصلاحيات" : "Access restored");
      void qc.invalidateQueries({ queryKey: ["staff-access"] });
    },
    onError: (e) => toastError(e, lang),
  });

  const rows = (query.data ?? []).filter((r) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return `${r.fullName ?? ""} ${r.email ?? ""} ${r.roles.join(" ")}`.toLowerCase().includes(q);
  });

  return (
    <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">{ar ? "سحب الصلاحيات بخطوة واحدة" : "One-step access withdrawal"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {ar
            ? "يمنع إسناد أي حالات جديدة، ويوقف الوصول فوراً، ويحتفظ بكامل السجل، ويعيد إسناد الحالات المفتوحة."
            : "Stops new assignments, blocks access immediately, keeps the full history, and hands open cases to available colleagues."}
        </p>
      </div>

      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={ar ? "ابحث بالاسم أو البريد أو الدور" : "Search by name, email or role"}
        className="max-w-sm"
      />

      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {r.fullName ?? r.email}
                  {r.revokedAt ? (
                    <span className="ms-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                      {ar ? "موقوف" : "Access withdrawn"}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.email} · {r.roles.map((x) => x.replace(/_/g, " ")).join(", ")} ·{" "}
                  {ar ? `حالات مفتوحة: ${r.openCases}` : `${r.openCases} open case(s)`}
                  {r.revokedReason ? ` · ${r.revokedReason}` : ""}
                </p>
              </div>
              {r.revokedAt ? (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => restoreMutation.mutate(r)}>
                  <ShieldCheck className="size-4" aria-hidden />
                  {ar ? "إعادة الصلاحيات" : "Restore access"}
                </Button>
              ) : (
                <Button size="sm" variant="destructive" className="gap-2" onClick={() => setTarget(r)}>
                  <ShieldOff className="size-4" aria-hidden />
                  {ar ? "سحب الصلاحيات" : "Withdraw access"}
                </Button>
              )}
            </li>
          ))}
          {!rows.length ? <li className="text-xs text-muted-foreground">{ar ? "لا نتائج" : "No matching people"}</li> : null}
        </ul>
      )}

      <Dialog open={!!target} onOpenChange={(open) => (open ? null : setTarget(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? "سحب صلاحيات الموظف" : "Withdraw staff access"}</DialogTitle>
            <DialogDescription>
              {ar
                ? `سيتم إيقاف وصول ${target?.fullName ?? ""} فوراً، ومنع إسناد حالات جديدة، وإعادة إسناد ${target?.openCases ?? 0} حالة مفتوحة. يبقى السجل كاملاً.`
                : `${target?.fullName ?? ""} loses access immediately, receives no new cases, and their ${target?.openCases ?? 0} open case(s) go to available colleagues. All history is preserved.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">{ar ? "السبب" : "Reason"}</Label>
            <Input
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={ar ? "مثال: انتهاء التكليف" : "e.g. left the department"}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTarget(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || revokeMutation.isPending}
              onClick={() => target && revokeMutation.mutate(target)}
            >
              {ar ? "سحب الصلاحيات الآن" : "Withdraw access now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccessAuditList />
    </section>
  );
}

const ACTION_LABEL: Record<string, { en: string; ar: string }> = {
  staff_access_revoked: { en: "Access withdrawn", ar: "سحب الصلاحيات" },
  staff_access_restored: { en: "Access restored", ar: "إعادة الصلاحيات" },
  role_granted: { en: "Role granted", ar: "منح دور" },
  role_revoked: { en: "Role removed", ar: "إزالة دور" },
};

function AccessAuditList() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const listAudit = useServerFn(listAccessAuditFn);
  const audit = useQuery({ queryKey: ["staff-access-audit"], queryFn: () => listAudit({ data: undefined }) });

  return (
    <div className="border-t pt-4">
      <h3 className="text-sm font-semibold">{ar ? "سجل تغييرات الصلاحيات" : "Permission change history"}</h3>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
        {(audit.data ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap gap-x-2 border-b py-1 last:border-b-0">
            <span className="font-medium">{ACTION_LABEL[r.action]?.[ar ? "ar" : "en"] ?? r.action}</span>
            <span className="text-muted-foreground">
              {r.subjectName ?? "—"}
              {r.actorName ? ` · ${ar ? "بواسطة" : "by"} ${r.actorName}` : ""} ·{" "}
              {new Date(r.at).toLocaleString(ar ? "ar-AE" : "en-GB")}
              {r.reason ? ` · ${r.reason}` : ""}
              {r.reassigned != null
                ? ` · ${ar ? `أُعيد إسناد ${r.reassigned} حالة` : `${r.reassigned} case(s) reassigned`}`
                : ""}
            </span>
          </li>
        ))}
        {!audit.isLoading && !(audit.data ?? []).length ? (
          <li className="text-muted-foreground">{ar ? "لا توجد تغييرات مسجلة بعد." : "No recorded changes yet."}</li>
        ) : null}
      </ul>
    </div>
  );
}
