/** Bilingual, brand-consistent email rendering for Sanadi. */

const MAROON = "#7B1E3B";
const SAND = "#F6F1E7";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/** Minimal, safe markup: paragraphs, line breaks and **bold**. All values escaped. */
function bodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => {
      const safe = escapeHtml(block).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />");
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#2b2b2b;">${safe}</p>`;
    })
    .join("");
}

function bodyToText(body: string): string {
  return body.replace(/\*\*(.+?)\*\*/g, "$1");
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderEmail(params: {
  language: "en" | "ar";
  subject: string;
  body: string;
  ctaLabel?: string | null;
  actionUrl?: string | null;
  severity: string;
  appUrl: string;
  bilingualBody?: { subject: string; body: string; ctaLabel?: string | null } | null;
}): RenderedEmail {
  const rtl = params.language === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const font = rtl
    ? "'Cairo','Segoe UI',Tahoma,sans-serif"
    : "'Outfit','Segoe UI',Helvetica,Arial,sans-serif";

  const urgent = params.severity === "critical" || params.severity === "emergency";
  const badge = urgent
    ? `<div style="display:inline-block;background:${MAROON};color:#ffffff;border-radius:999px;padding:4px 12px;font-size:12px;letter-spacing:.4px;margin-bottom:14px;">${
        params.severity === "emergency" ? (rtl ? "تنبيه طارئ" : "EMERGENCY") : rtl ? "عاجل" : "URGENT"
      }</div>`
    : "";

  const cta =
    params.actionUrl && params.ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="background:${MAROON};border-radius:10px;">
          <a href="${params.actionUrl}" style="display:inline-block;padding:12px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">${escapeHtml(
            params.ctaLabel,
          )}</a></td></tr></table>`
      : "";

  const secondary = params.bilingualBody
    ? `<hr style="border:none;border-top:1px solid #e7e0d4;margin:26px 0;" />
       <div dir="${rtl ? "ltr" : "rtl"}" style="text-align:${rtl ? "left" : "right"};font-family:${
         rtl ? "'Outfit',Helvetica,Arial,sans-serif" : "'Cairo',Tahoma,sans-serif"
       };">
         <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${MAROON};">${escapeHtml(
           params.bilingualBody.subject,
         )}</p>
         ${bodyToHtml(params.bilingualBody.body)}
       </div>`
    : "";

  const html = `<!doctype html><html lang="${params.language}" dir="${dir}"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(params.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:${font};" dir="${dir}">
    <div style="background:${MAROON};border-radius:14px 14px 0 0;padding:20px 24px;">
      <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">Sanadi | سندي</div>
      <div style="color:${SAND};font-size:12px;margin-top:4px;">United Arab Emirates University · جامعة الإمارات العربية المتحدة</div>
    </div>
    <div style="border:1px solid #e7e0d4;border-top:none;border-radius:0 0 14px 14px;padding:26px 24px;background:#ffffff;">
      ${badge}
      <h1 style="margin:0 0 16px;font-size:19px;line-height:1.4;color:${MAROON};">${escapeHtml(params.subject)}</h1>
      ${bodyToHtml(params.body)}
      ${cta}
      ${secondary}
      <p style="margin:26px 0 0;font-size:12px;color:#8a8378;line-height:1.6;">
        ${
          rtl
            ? `هذه رسالة آلية من سندي. لإدارة تفضيلات الإشعارات، افتح <a href="${params.appUrl}/settings" style="color:${MAROON};">إعدادات سندي</a>.`
            : `This is an automated message from Sanadi. Manage your notification preferences in <a href="${params.appUrl}/settings" style="color:${MAROON};">Sanadi settings</a>.`
        }
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    params.subject,
    "",
    bodyToText(params.body),
    params.actionUrl ? `\n${params.ctaLabel ?? "Open Sanadi"}: ${params.actionUrl}` : "",
    params.bilingualBody ? `\n\n---\n${params.bilingualBody.subject}\n\n${bodyToText(params.bilingualBody.body)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject: params.subject, html, text };
}
