import { useEffect, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { apiSignOut } from "@/lib/api-auth";
import { apiFetch } from "@/lib/auth-token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { CATEGORY_LABELS, OPTIONAL_EMAIL_CATEGORIES } from "@/lib/notifications/constants";
import { useVoiceSettings } from "@/lib/voice-settings";

type NotificationPreferences = {
  in_app: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  optional_email_categories: string[];
  digest_enabled: boolean;
};

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Sanadi | UAEU" },
      {
        name: "description",
        content: "Update your profile, interface language and notification preferences for the Sanadi | UAEU.",
      },
      { property: "og:title", content: "Settings — Sanadi | UAEU" },
      { property: "og:description", content: "Profile, language and notification preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const ar = lang === "ar";
  const { user, profile, roles, refresh } = useAuth();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferred, setPreferred] = useState<"en" | "ar">("en");
  const [savingProfile, setSavingProfile] = useState(false);
  const { settings: voice, update: updateVoice } = useVoiceSettings();

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
    setPreferred(profile?.preferred_language ?? "en");
  }, [profile]);

  const prefsQuery = useQuery({
    queryKey: ["notification-prefs", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const rows = await apiFetch<NotificationPreferences[]>(
        `/api/v1/data/notification_preferences?user_id=eq.${encodeURIComponent(user!.id)}&select=in_app,email,sms,push,quiet_hours_start,quiet_hours_end,optional_email_categories,digest_enabled`,
      );
      return rows[0] ?? null;
    },
  });
  const prefs = prefsQuery.data;

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true);
    try {
      await apiFetch(`/api/v1/data/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ full_name: fullName.trim(), phone: phone.trim() || null, preferred_language: preferred }),
      });
    } catch (error) {
      setSavingProfile(false);
      toastError(error, lang);
      return;
    }
    setSavingProfile(false);
    setLang(preferred);
    await refresh();
    toast.success(t("saved"));
  }

  async function savePref(patch: Partial<{ in_app: boolean; email: boolean; sms: boolean; push: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null; optional_email_categories: string[]; digest_enabled: boolean }>) {
    if (!user) return;
    try {
      await apiFetch("/api/v1/data/notification_preferences", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: user.id, ...patch }),
      });
    } catch (error) {
      toastError(error, lang);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    toast.success(t("saved"));
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await apiSignOut(true);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("settings")}</h1>

      <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{ar ? "الملف الشخصي" : "Profile"}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullName">{t("full_name")}</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{ar ? "رقم الهاتف" : "Phone"}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" value={profile?.email ?? user?.email ?? ""} readOnly disabled />
          </div>
          <div className="space-y-2">
            <Label>{t("preferred_language")}</Label>
            <Select value={preferred} onValueChange={(v) => setPreferred(v as "en" | "ar")}>
              <SelectTrigger aria-label={t("preferred_language")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={saveProfile} disabled={savingProfile}>
          {savingProfile ? t("loading") : t("save")}
        </Button>
      </section>

      <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{t("notification_prefs")}</h2>
        {prefsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <>
            <div className="space-y-3">
              {(
                [
                  ["in_app", ar ? "داخل التطبيق" : "In-app"],
                  ["email", ar ? "البريد الإلكتروني" : "Email"],
                  ["sms", ar ? "رسائل نصية" : "SMS"],
                  ["push", ar ? "إشعارات فورية" : "Push"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`pref-${key}`}>{label}</Label>
                  <Switch
                    id={`pref-${key}`}
                    checked={Boolean(prefs?.[key])}
                    onCheckedChange={(checked) => savePref({ [key]: checked })}
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quietStart">{ar ? "بداية ساعات الهدوء" : "Quiet hours start"}</Label>
                <Input
                  id="quietStart"
                  type="time"
                  defaultValue={prefs?.quiet_hours_start?.slice(0, 5) ?? ""}
                  onBlur={(e) => savePref({ quiet_hours_start: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quietEnd">{ar ? "نهاية ساعات الهدوء" : "Quiet hours end"}</Label>
                <Input
                  id="quietEnd"
                  type="time"
                  defaultValue={prefs?.quiet_hours_end?.slice(0, 5) ?? ""}
                  onBlur={(e) => savePref({ quiet_hours_end: e.target.value || null })}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">
                {ar ? "رسائل البريد الاختيارية" : "Optional email notifications"}
              </p>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "الرسائل الحرجة والطارئة والمتعلقة بالمواعيد النهائية للخدمة تُرسل دائماً ولا يمكن إيقافها."
                  : "Critical, emergency and service-deadline emails are always sent and cannot be switched off."}
              </p>
              <div className="space-y-2">
                {OPTIONAL_EMAIL_CATEGORIES.map((category) => {
                  const selected = (prefs?.optional_email_categories ?? []).includes(category);
                  return (
                    <div key={category} className="flex items-center justify-between gap-4">
                      <Label htmlFor={`cat-${category}`}>
                        {CATEGORY_LABELS[category]?.[ar ? "ar" : "en"] ?? category}
                      </Label>
                      <Switch
                        id={`cat-${category}`}
                        checked={selected}
                        onCheckedChange={(checked) => {
                          const current = new Set(prefs?.optional_email_categories ?? []);
                          if (checked) current.add(category);
                          else current.delete(category);
                          void savePref({ optional_email_categories: Array.from(current) as string[] });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-4 border-t pt-3">
                <Label htmlFor="digest-enabled">
                  {ar ? "ملخص يومي بدلاً من رسائل متفرقة" : "Daily summary instead of separate emails"}
                </Label>
                <Switch
                  id="digest-enabled"
                  checked={prefs?.digest_enabled ?? true}
                  onCheckedChange={(checked) => savePref({ digest_enabled: checked })}
                />
              </div>
            </div>
          </>
        )}
      </section>


      <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{t("voice_settings")}</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="voice-enabled">{t("voice_enabled")}</Label>
          <Switch
            id="voice-enabled"
            checked={voice.enabled}
            onCheckedChange={(checked) => updateVoice({ enabled: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="voice-autosend">{t("voice_autosend")}</Label>
          <Switch
            id="voice-autosend"
            checked={voice.autoSend}
            onCheckedChange={(checked) => updateVoice({ autoSend: checked })}
          />
        </div>
        {voice.autoSend ? (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="voice-autospeak">{t("voice_autospeak")}</Label>
            <Switch
              id="voice-autospeak"
              checked={voice.autoSpeak}
              onCheckedChange={(checked) => updateVoice({ autoSpeak: checked })}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("voice_privacy_note")}</p>
      </section>

      <section className="card-shadow space-y-3 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{ar ? "الحساب" : "Account"}</h2>
        <p className="text-sm text-muted-foreground">
          {ar ? "الأدوار" : "Roles"}: {roles.length ? roles.map((r) => r.replace(/_/g, " ")).join(", ") : ar ? "طالب" : "student"}
        </p>
        <Button size="sm" variant="outline" onClick={signOut}>
          <LogOut className="size-4" aria-hidden />
          {t("sign_out")}
        </Button>
      </section>
    </div>
  );
}
