import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAnyRole } from "@/lib/authz/roles.server";
import {
  countLevel,
  failureLevel,
  jobsLevel,
  latencyLevel,
  overallLevel,
  percentile,
  ragLevel,
  type HealthItem,
  type SystemHealth,
} from "./system-health";

/** One read-only snapshot of platform health for system administrators. */
export const getSystemHealthFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemHealth> => {
    await requireAnyRole(context.supabase, context.userId, ["system_admin"]);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();

    const [jobs, perf, rag, email, voice, demoCases, cleanup, errors] = await Promise.all([
      db.from("scheduled_job_runs").select("status").gte("started_at", since).limit(2000),
      db.from("response_performance_logs").select("total_duration_ms, success").gte("created_at", since).limit(2000),
      db.from("knowledge_retrieval_logs").select("grounding_status").gte("retrieved_at", since).limit(5000),
      db.from("notification_delivery_logs").select("status").eq("channel", "email").gte("attempted_at", since).limit(2000),
      db
        .from("exception_events")
        .select("id", { count: "exact", head: true })
        .eq("is_test", false)
        .ilike("component", "%voice%")
        .gte("created_at", since),
      db.from("cases").select("id", { count: "exact", head: true }).eq("is_demo", true),
      db.from("issued_documents").select("id", { count: "exact", head: true }).eq("file_cleanup_status", "failed"),
      db
        .from("exception_events")
        .select("id", { count: "exact", head: true })
        .eq("is_test", false)
        .eq("recovered", false)
        .is("resolved_at", null),
    ]);

    const items: HealthItem[] = [];

    if (jobs.error) items.push({ key: "jobs", level: "unknown", valueEn: "Couldn't check", valueAr: "تعذّر التحقق" });
    else {
      const runs = jobs.data.length;
      const failed = jobs.data.filter((r) => r.status === "failed").length;
      items.push({
        key: "jobs",
        level: jobsLevel(runs, failed),
        valueEn: runs ? `${runs - failed}/${runs} runs OK (24h)` : "No runs in 24h",
        valueAr: runs ? `${runs - failed}/${runs} تشغيل ناجح (24 ساعة)` : "لا توجد عمليات تشغيل خلال 24 ساعة",
      });
    }

    if (perf.error) items.push({ key: "ai", level: "unknown", valueEn: "Couldn't check", valueAr: "تعذّر التحقق" });
    else {
      const ms = perf.data.map((r) => r.total_duration_ms).filter((n): n is number => typeof n === "number");
      const p50 = percentile(ms, 50);
      const p95 = percentile(ms, 95);
      const s = (n: number | null) => (n == null ? "—" : `${(n / 1000).toFixed(1)}s`);
      items.push({
        key: "ai",
        level: latencyLevel(p95),
        valueEn: ms.length ? `P50 ${s(p50)} · P95 ${s(p95)} (target < 8s)` : "No answers in 24h",
        valueAr: ms.length ? `الوسيط ${s(p50)} · P95 ${s(p95)} (الهدف أقل من 8 ث)` : "لا توجد إجابات خلال 24 ساعة",
      });
    }

    if (rag.error) items.push({ key: "rag", level: "unknown", valueEn: "Couldn't check", valueAr: "تعذّر التحقق" });
    else {
      const total = rag.data.length;
      const none = rag.data.filter((r) => r.grounding_status === "no_evidence").length;
      items.push({
        key: "rag",
        level: ragLevel(total, none),
        valueEn: total ? `${total - none}/${total} searches found sources` : "No searches in 24h",
        valueAr: total ? `${total - none}/${total} عملية بحث وجدت مصادر` : "لا توجد عمليات بحث خلال 24 ساعة",
      });
    }

    if (email.error) items.push({ key: "email", level: "unknown", valueEn: "Couldn't check", valueAr: "تعذّر التحقق" });
    else {
      const total = email.data.length;
      const failed = email.data.filter((r) => ["failed", "bounced", "error"].includes(r.status)).length;
      items.push({
        key: "email",
        level: failureLevel(total, failed),
        valueEn: total ? `${failed} failed of ${total} (24h)` : "No emails sent in 24h",
        valueAr: total ? `${failed} فشل من ${total} (24 ساعة)` : "لم تُرسل رسائل خلال 24 ساعة",
      });
    }

    const n = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count ?? 0);
    const countItem = (
      key: HealthItem["key"],
      v: number | null,
      en: (x: number) => string,
      arT: (x: number) => string,
      warnAt?: number,
      criticalAt?: number,
    ): HealthItem =>
      v == null
        ? { key, level: "unknown", valueEn: "Couldn't check", valueAr: "تعذّر التحقق" }
        : { key, level: countLevel(v, warnAt, criticalAt), valueEn: en(v), valueAr: arT(v) };

    items.push(
      countItem("voice", n(voice), (x) => `${x} voice errors (24h)`, (x) => `${x} أخطاء صوتية (24 ساعة)`, 1, 5),
    );
    const demo = n(demoCases);
    items.push(
      demo == null
        ? { key: "demo", level: "unknown", valueEn: "Couldn't check", valueAr: "تعذّر التحقق" }
        : {
            key: "demo",
            level: "ok",
            valueEn: `${demo} sample requests, kept separate`,
            valueAr: `${demo} طلبات تجريبية، معزولة`,
          },
    );
    items.push(
      countItem("cleanup", n(cleanup), (x) => `${x} failed file cleanups`, (x) => `${x} عمليات حذف ملفات فاشلة`, 1, 10),
    );
    items.push(
      countItem("errors", n(errors), (x) => `${x} unresolved`, (x) => `${x} غير محلولة`, 1, 20),
    );

    return { checkedAt: new Date().toISOString(), overall: overallLevel(items), items };
  });
