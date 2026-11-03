/**
 * Server functions for the notification operations console.
 * Thin wrappers only — all logic lives in ./admin.server and ./dispatch.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getNotificationAccessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOpsAccess } = await import("./admin.server");
    return resolveOpsAccess(context.supabase as never, context.userId);
  });

export const getNotificationOverviewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOpsAccess, getOpsOverview } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canView) throw new Error("Forbidden");
    return getOpsOverview();
  });

export const listNotificationDeliveriesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        q: z.string().max(120).default(""),
        status: z.string().max(30).default("all"),
        severity: z.string().max(30).default("all"),
        page: z.number().int().min(1).max(500).default(1),
        pageSize: z.number().int().min(5).max(50).default(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveOpsAccess, listDeliveries } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canView) throw new Error("Forbidden");
    return listDeliveries(data);
  });

export const updateNotificationSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        emails_enabled: z.boolean().optional(),
        demo_email_mode: z.boolean().optional(),
        demo_redirect_email: z.string().email().max(200).nullable().optional(),
        digest_enabled: z.boolean().optional(),
        public_app_url: z.string().url().max(200).optional(),
        batch_size: z.number().int().min(5).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveOpsAccess, updateSettings } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canManage) throw new Error("Forbidden");
    await updateSettings(data);
    return { ok: true };
  });

export const setDispatchPausedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paused: z.boolean(), reason: z.string().max(200).nullable().default(null) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveOpsAccess, setDispatchPaused } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canManage) throw new Error("Forbidden");
    await setDispatchPaused(data.paused, data.reason);
    return { ok: true };
  });

export const runDispatchNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOpsAccess } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canManage) throw new Error("Forbidden");
    const { dispatchQueuedEmails } = await import("./dispatch.server");
    return dispatchQueuedEmails();
  });

export const listEmergencyBroadcastsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOpsAccess } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canView) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("emergency_broadcasts")
      .select("id, title_en, title_ar, status, audience, recipient_count, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createEmergencyBroadcastFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title_en: z.string().min(3).max(160),
        title_ar: z.string().min(3).max(160),
        message_en: z.string().min(10).max(4000),
        message_ar: z.string().min(10).max(4000),
        audience: z.enum(["all_students", "unit_students", "group"]),
        unit_id: z.string().uuid().nullable().default(null),
        group_code: z.string().max(60).nullable().default(null),
        action_url: z.string().max(300).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveOpsAccess } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canManage) throw new Error("Forbidden");
    const { data: row, error } = await context.supabase
      .from("emergency_broadcasts")
      .insert({
        title_en: data.title_en,
        title_ar: data.title_ar,
        message_en: data.message_en,
        message_ar: data.message_ar,
        audience: data.audience,
        audience_config: { unit_id: data.unit_id, group_code: data.group_code },
        action_url: data.action_url,
        created_by: context.userId,
        status: "pending_approval",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const approveEmergencyBroadcastFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { resolveOpsAccess, sendEmergencyBroadcast } = await import("./admin.server");
    const access = await resolveOpsAccess(context.supabase as never, context.userId);
    if (!access.canManage) throw new Error("Forbidden");
    return sendEmergencyBroadcast(data.id, context.userId);
  });
