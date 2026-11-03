/** Student notification preferences, shown as a tab of the Notifications page. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toastError } from "@/lib/errors/toast";

export function NotificationPreferences() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: ["notification-prefs", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("in_app, email, quiet_hours_start, quiet_hours_end")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function updatePref(patch: Record<string, unknown>) {
    if (!user) return;
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
    if (error) {
      toastError(error, lang);
      return;
    }
    toast.success(t("saved"));
    void qc.invalidateQueries({ queryKey: ["notification-prefs", user.id] });
  }

  const prefs = prefsQuery.data;
  if (prefsQuery.isLoading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  return (
    <Card>
      <CardContent className="space-y-4 py-5 text-sm">
        <Row id="pref-in-app" label={t("channel_in_app")} checked={prefs?.in_app ?? true} onChange={(v) => updatePref({ in_app: v })} />
        <Row id="pref-email" label={t("channel_email")} checked={prefs?.email ?? true} onChange={(v) => updatePref({ email: v })} />
        <div className="space-y-2 pt-2">
          <Label className="text-xs">{t("quiet_hours")}</Label>
          <div className="flex items-center gap-2">
            <Input type="time" defaultValue={prefs?.quiet_hours_start ?? ""} aria-label={t("from")}
              onBlur={(e) => updatePref({ quiet_hours_start: e.target.value || null })} />
            <Input type="time" defaultValue={prefs?.quiet_hours_end ?? ""} aria-label={t("to")}
              onBlur={(e) => updatePref({ quiet_hours_end: e.target.value || null })} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
