import logo from "@/assets/uaeu-logo.png";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Official United Arab Emirates University institutional logo.
 * Single source of truth — every screen and surface renders this component so a
 * future branding update only needs the asset pointer swapped.
 *
 * The asset is a wide lock-up (UAEU block + bilingual wordmark + UAE emblem).
 * Size it by HEIGHT only (`h-*`); width stays automatic so the official
 * proportions are never distorted.
 */
export function UaeuLogo({ className }: { className?: string }) {
  const { lang } = useI18n();

  return (
    <img
      src={logo}
      alt={lang === "ar" ? "جامعة الإمارات العربية المتحدة" : "United Arab Emirates University"}
      width={4730}
      height={830}
      className={cn("h-8 w-auto max-w-full shrink-0 object-contain object-center", className)}
      loading="eager"
      decoding="async"
    />
  );
}
