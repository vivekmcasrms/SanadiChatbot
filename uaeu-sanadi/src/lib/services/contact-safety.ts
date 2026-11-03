/** Never publish placeholder/demo/test contact addresses. Pure. */
const BAD_DOMAIN = /(\.local|\.test|\.invalid|\.example|example\.(com|org|net)|localhost)$/i;
const BAD_PART = /(^|[.@])(demo|test|sample|placeholder|dummy|fake)([.@-]|$)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPublishableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  if (!EMAIL.test(e)) return false;
  const domain = e.split("@")[1] ?? "";
  return !BAD_DOMAIN.test(domain) && !BAD_PART.test(e);
}

export function publishableEmail(...candidates: (string | null | undefined)[]): string | null {
  return candidates.find((c) => isPublishableEmail(c))?.trim() ?? null;
}
