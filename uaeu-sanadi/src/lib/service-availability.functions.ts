import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Live availability for a single service code. */
export const getServiceAvailabilityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: z.string().min(2) }).parse(input))
  .handler(async ({ data, context }) => {
    const { getServiceAvailability } = await import("./services/availability.server");
    return getServiceAvailability(context.supabase as never, data.code);
  });

/** Live availability for every catalogue service (used by Help, menus, admin). */
export const getServiceAvailabilityBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { serviceAvailabilityOverview } = await import("./services/availability-admin.server");
    return serviceAvailabilityOverview(context.supabase as never);
  });

export const getMyServiceReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listMyServiceReminders } = await import("./services/availability.server");
    return listMyServiceReminders(context.supabase as never, context.userId);
  });

export const requestServiceReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: z.string().min(2),
        reminderType: z.enum(["service_open", "day_before_open"]).default("service_open"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { createServiceReminder } = await import("./services/availability.server");
    return createServiceReminder(context.supabase as never, context.userId, data.code, data.reminderType);
  });

export const cancelServiceReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ reminderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { cancelServiceReminder: cancel } = await import("./services/availability.server");
    return cancel(context.supabase as never, context.userId, data.reminderId);
  });

const WindowInput = z.object({
  id: z.string().uuid().nullish(),
  serviceId: z.string().uuid(),
  availabilityType: z.enum([
    "always_available",
    "date_range",
    "term_based",
    "multiple_windows",
    "temporarily_closed",
    "admin_disabled",
  ]),
  opensAt: z.string().nullish(),
  closesAt: z.string().nullish(),
  academicTermId: z.string().uuid().nullish(),
  label: z.string().nullish(),
  reasonEn: z.string().nullish(),
  reasonAr: z.string().nullish(),
  studentMessageEn: z.string().nullish(),
  studentMessageAr: z.string().nullish(),
  remindersEnabled: z.boolean().optional(),
  preliminaryCheckAllowed: z.boolean().optional(),
  studentVisible: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const saveServiceAvailabilityWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WindowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { saveAvailabilityWindow } = await import("./services/availability-admin.server");
    return saveAvailabilityWindow(context.supabase as never, context.userId, data);
  });

export const deleteServiceAvailabilityWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { deleteAvailabilityWindow } = await import("./services/availability-admin.server");
    return deleteAvailabilityWindow(context.supabase as never, context.userId, data.id);
  });

export const getServiceAvailabilityAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ serviceId: z.string().uuid().nullish() }).parse(input))
  .handler(async ({ data, context }) => {
    const { availabilityAuditTrail } = await import("./services/availability-admin.server");
    return availabilityAuditTrail(context.supabase as never, data.serviceId ?? null);
  });
