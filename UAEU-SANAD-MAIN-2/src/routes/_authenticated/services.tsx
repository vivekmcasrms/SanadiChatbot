/**
 * Services & Availability — the single place where an administrator decides
 * which services are active, when they open and close, and what students are
 * told while a service is unavailable. The Assistant reads the very same
 * availability records, so there is no second source of truth.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { ServiceAvailabilitySettings } from "@/components/ServiceAvailabilitySettings";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/services")({
  head: () => ({
    meta: [
      { title: "Services & Availability — Sanadi | UAEU" },
      {
        name: "description",
        content: "Activate services, set opening and closing windows, and publish the message students see when a service is closed.",
      },
      { property: "og:title", content: "Services & Availability — Sanadi | UAEU" },
      { property: "og:description", content: "Manage UAEU student service availability windows in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ServicesPage,
});

function ServicesPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const canManage = roles.some((r) => ["system_admin", "service_manager"].includes(r));

  if (!canManage)
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {ar ? "إدارة توفر الخدمات متاحة للإدارة فقط." : "Service availability management is available to administrators only."}
          </p>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{ar ? "الخدمات والتوفر" : "Services & availability"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "فعّل الخدمات وحدد أوقات الفتح والإغلاق والرسالة التي يراها الطالب. المساعد يستخدم الإعدادات نفسها."
            : "Activate services, define opening and closing windows and the message students see. The Assistant uses these same settings."}
        </p>
      </header>
      <ServiceAvailabilitySettings />
    </div>
  );
}
