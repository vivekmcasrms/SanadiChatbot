import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_TABS, type SettingsTabCode } from "@/lib/admin/settings-map";

export const Route = createFileRoute("/_authenticated/system-settings")({
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTabCode } => {
    const t = search["tab"];
    return { tab: SETTINGS_TABS.some((x) => x.code === t) ? (t as SettingsTabCode) : "organisation" };
  },
  head: () => ({
    meta: [
      { title: "System Settings — Sanadi | UAEU" },
      {
        name: "description",
        content: "Organisation, access, services, AI, Arabic, scheduled jobs and integrations settings for Sanadi administrators.",
      },
      { property: "og:title", content: "System Settings — Sanadi | UAEU" },
      { property: "og:description", content: "Every Sanadi configuration area, grouped in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SystemSettingsPage,
});

function SystemSettingsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles, loading } = useAuth();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/system-settings" });

  if (loading) return <p className="p-6 text-sm text-muted-foreground">…</p>;
  if (!roles.includes("system_admin")) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {ar ? "هذه الصفحة متاحة لمسؤولي النظام فقط." : "This page is available to system administrators only."}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{ar ? "الإعدادات" : "Settings"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "كل إعدادات النظام في مكان واحد. "
            : "Every system setting in one place. "}
          <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
            {ar ? "إعدادات حسابي الشخصي" : "My personal account settings"}
          </Link>
        </p>
      </header>
      <Tabs value={tab} onValueChange={(v) => void navigate({ search: { tab: v as SettingsTabCode } })}>
        <TabsList className="h-auto flex-wrap justify-start">
          {SETTINGS_TABS.map((t) => (
            <TabsTrigger key={t.code} value={t.code}>
              {ar ? t.labelAr : t.labelEn}
            </TabsTrigger>
          ))}
        </TabsList>
        {SETTINGS_TABS.map((t) => (
          <TabsContent key={t.code} value={t.code} className="pt-4">
            <div className="grid gap-3 md:grid-cols-2">
              {t.links.map((l) => (
                <Link
                  key={l.code}
                  to={l.to}
                  search={l.search ?? {}}
                  className="card-shadow group flex items-start justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/40"
                >
                  <span>
                    <span className="block font-medium">{ar ? l.labelAr : l.labelEn}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {ar ? l.descriptionAr : l.descriptionEn}
                    </span>
                  </span>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                </Link>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
