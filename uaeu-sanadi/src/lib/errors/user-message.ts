/**
 * Maps technical failures (auth, network, database, provider errors) onto
 * short bilingual messages that are safe to show a student or staff member.
 * The technical cause is kept in the browser console / server logs only.
 */
export type Lang = "en" | "ar";

type Safe = { en: string; ar: string };

const GENERIC: Safe = {
  en: "Something went wrong. Please try again.",
  ar: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
};

const RULES: { test: RegExp; message: Safe }[] = [
  {
    test: /invalid login credentials|invalid_credentials|invalid email or password/i,
    message: {
      en: "Incorrect email or password. Please check your details and try again.",
      ar: "البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق والمحاولة مرة أخرى.",
    },
  },
  {
    test: /email not confirmed|email_not_confirmed/i,
    message: {
      en: "Please confirm your email address before signing in.",
      ar: "يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.",
    },
  },
  {
    test: /unauthor|authorization header|invalid jwt|jwt expired|not authenticated|401/i,
    message: {
      en: "Your session has expired. Please sign in again.",
      ar: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
    },
  },
  {
    test: /forbidden|permission denied|row-level security|rls|not allowed|403/i,
    message: {
      en: "You do not have access to this item.",
      ar: "ليس لديك صلاحية الوصول إلى هذا العنصر.",
    },
  },
  {
    test: /not found|no rows|404/i,
    message: {
      en: "We could not find that item. It may have been removed.",
      ar: "تعذر العثور على هذا العنصر. ربما تمت إزالته.",
    },
  },
  {
    test: /rate limit|too many requests|429/i,
    message: {
      en: "Too many requests right now. Please wait a moment and try again.",
      ar: "هناك طلبات كثيرة الآن. يرجى الانتظار قليلاً ثم المحاولة مجدداً.",
    },
  },
  {
    test: /timeout|timed out|aborted|network|fetch failed|failed to fetch|offline/i,
    message: {
      en: "The connection was interrupted. Please check your network and try again.",
      ar: "انقطع الاتصال. يرجى التحقق من الشبكة والمحاولة مرة أخرى.",
    },
  },
  {
    test: /duplicate key|already exists|conflict|23505/i,
    message: {
      en: "This has already been submitted.",
      ar: "تم إرسال هذا الطلب من قبل.",
    },
  },
  {
    test: /file too large|payload too large|size limit|413/i,
    message: {
      en: "The file is too large. Please upload a smaller file.",
      ar: "الملف كبير جداً. يرجى رفع ملف أصغر.",
    },
  },
  {
    test: /storage|bucket|upload/i,
    message: {
      en: "The file could not be uploaded. Please try again.",
      ar: "تعذر رفع الملف. يرجى المحاولة مرة أخرى.",
    },
  },
  {
    test: /rpc|supabase|postgres|pgrst|sql|relation .* does not exist|500|502|503/i,
    message: {
      en: "The service is temporarily unavailable. Please try again shortly.",
      ar: "الخدمة غير متاحة مؤقتاً. يرجى المحاولة بعد قليل.",
    },
  },
];

/** True when a raw string looks technical and must not reach the interface. */
function looksTechnical(raw: string): boolean {
  return (
    raw.length > 160 ||
    /undefined|null|\bat \w+ \(|stack|jwt|supabase|postgres|pgrst|rpc|sql|typeerror|referenceerror|\{"|http[s]?:\/\//i.test(
      raw,
    )
  );
}

export function rawErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const maybe = error as { message?: unknown; error?: unknown };
  if (typeof maybe.message === "string") return maybe.message;
  if (typeof maybe.error === "string") return maybe.error;
  return "";
}

/** Bilingual, user-safe text for any thrown value. */
export function userErrorMessage(error: unknown, lang: Lang = "en"): string {
  const raw = rawErrorText(error);
  for (const rule of RULES) {
    if (rule.test.test(raw)) return rule.message[lang];
  }
  // A short, human-authored message from our own code is safe to pass through.
  if (raw && !looksTechnical(raw)) return raw;
  return GENERIC[lang];
}
