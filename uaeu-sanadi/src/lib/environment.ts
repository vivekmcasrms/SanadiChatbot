/**
 * Sanadi environment identity (browser-safe).
 *
 * `SANADI_ENV` is unset in production, so every helper here defaults to
 * PRODUCTION and nothing about the live application changes. The duplicated
 * project sets `SANADI_ENV=TEST` / `VITE_SANADI_ENV=TEST`.
 */
export type SanadiEnv = "PRODUCTION" | "TEST";

function normalise(value: string | undefined | null): SanadiEnv {
  return (value ?? "").trim().toUpperCase() === "TEST" ? "TEST" : "PRODUCTION";
}

/** Environment as seen by browser code. */
export function sanadiEnv(): SanadiEnv {
  return normalise(import.meta.env['VITE_SANADI_ENV'] as string | undefined);
}

export function isTestEnvironment(): boolean {
  return sanadiEnv() === "TEST";
}

export const TEST_ENV_LABEL = {
  en: "Sanadi Test Environment",
  ar: "بيئة اختبار سندي",
} as const;

export const TEST_ENV_NOTE = {
  en: "Non-production copy. Data, documents and notifications here never reach production systems.",
  ar: "نسخة غير إنتاجية. البيانات والمستندات والإشعارات هنا لا تصل إلى الأنظمة الإنتاجية.",
} as const;

export { normalise as normaliseSanadiEnv };
