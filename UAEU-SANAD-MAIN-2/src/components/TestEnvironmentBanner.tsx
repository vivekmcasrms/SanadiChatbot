import { FlaskConical } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { isTestEnvironment, TEST_ENV_LABEL, TEST_ENV_NOTE } from "@/lib/environment";

/**
 * Non-production marker for staff and admin users. Renders nothing unless
 * `VITE_SANADI_ENV=TEST`, so production UI is untouched.
 */
export function TestEnvironmentBanner() {
  const { lang } = useI18n();
  if (!isTestEnvironment()) return null;
  const ar = lang === "ar";
  return (
    <div
      role="status"
      data-testid="test-environment-banner"
      className="flex items-center justify-center gap-2 border-b border-amber-500/60 bg-amber-100 px-3 py-1.5 text-center text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>{ar ? TEST_ENV_LABEL.ar : TEST_ENV_LABEL.en}</span>
      <span className="hidden font-normal sm:inline">— {ar ? TEST_ENV_NOTE.ar : TEST_ENV_NOTE.en}</span>
    </div>
  );
}
