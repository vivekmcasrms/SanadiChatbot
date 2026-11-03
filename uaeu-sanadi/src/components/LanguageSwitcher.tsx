import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const next = lang === "en" ? "ar" : "en";

  return (
    <Button
      variant="outline"
      size={compact ? "sm" : "default"}
      onClick={() => setLang(next)}
      aria-label={t("language")}
      className="gap-2"
    >
      <Globe className="size-4" aria-hidden />
      <span>{next === "ar" ? "العربية" : "English"}</span>
    </Button>
  );
}