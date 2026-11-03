import logo from "@/assets/uaeu-logo.png";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Brand mark shown in headers/sidebars. Uses the official UAEU lock-up.
 * Size by HEIGHT only (`h-*`) so proportions are never distorted.
 */
export function SanadiLogo({
  className,
  withName: _withName = true,
  compactOnly = false,
  fillMobile = false,
}: {
  className?: string;
  /** Kept for call-site compatibility; the lock-up already includes the wordmark. */
  withName?: boolean;
  /** Kept for call-site compatibility; same asset is used in tight layouts. */
  compactOnly?: boolean;
  /** Fill the public mobile header row while retaining the desktop lock-up size. */
  fillMobile?: boolean;
}) {
  const { lang } = useI18n();

  return (
    <span className={cn("flex min-w-0 items-center", className)}>
      <img
        src={logo}
        alt={lang === "ar" ? "جامعة الإمارات العربية المتحدة" : "United Arab Emirates University"}
        width={4730}
        height={830}
        className={cn(
          "shrink-0 object-contain object-start",
          fillMobile
            ? "h-auto max-h-24 w-full max-w-full lg:h-12 lg:w-auto lg:max-w-[26rem]"
            : compactOnly
              ? "h-6 w-auto max-w-[9rem] min-[360px]:h-8 min-[360px]:max-w-[12rem] sm:h-12 sm:max-w-[22rem] md:max-w-[26rem]"
              : "h-11 w-auto max-w-[18rem] sm:h-12 sm:max-w-[22rem] md:max-w-[26rem]",
        )}
        loading="eager"
        decoding="async"
      />
    </span>
  );
}
