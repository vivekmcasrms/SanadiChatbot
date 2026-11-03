/** Inline text in the active UI language, for shared primitives. */
import { useIsArabic } from "@/lib/i18n";
export function LocalText({ en, ar }: { en: string; ar: string }) {
  return <>{useIsArabic() ? ar : en}</>;
}
