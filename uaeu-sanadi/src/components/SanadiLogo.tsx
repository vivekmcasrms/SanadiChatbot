import fullLogo from "@/assets/sanadi-logo.png.asset.json";
import compactLogo from "@/assets/sanadi-logo-compact.png.asset.json";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Official Sanadi brand logo.
 * Single source of truth — size by HEIGHT only (`h-*`) so the official
 * proportions are never distorted. The compact (square) mark is used on
 * narrow screens; the full lock-up appears from `sm` upwards.
 */
export function SanadiLogo({
  className,
  withName = true,
  compactOnly = false,
}: {
  className?: string;
  /** Show the Sanadi wordmark next to the mark where space allows. */
  withName?: boolean;
  /** Always render the square mark (collapsed sidebar, tight headers). */
  compactOnly?: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <img
        src={compactLogo.url}
        alt="Sanadi"
        width={603}
        height={603}
        className={cn("h-7 w-auto shrink-0 rounded-sm object-contain", !compactOnly && "sm:hidden")}
        loading="eager"
        decoding="async"
      />
      {compactOnly ? null : (
        <img
          src={fullLogo.url}
          alt="Sanadi"
          width={1920}
          height={337}
          className="hidden h-7 w-auto max-w-[9.5rem] shrink-0 object-contain object-start sm:block md:max-w-[12rem]"
          loading="eager"
          decoding="async"
        />
      )}
      {withName ? (
        <span className="truncate text-base font-semibold tracking-tight sm:text-lg">
          {ar ? "سندي" : "Sanadi"}
        </span>
      ) : null}
    </span>
  );
}
