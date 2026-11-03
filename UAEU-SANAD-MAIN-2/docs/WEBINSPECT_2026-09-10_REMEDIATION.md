# WebInspect report remediation — 10 September 2026

Source report: `sanadit.pdf` (138 pages), supplied on 23 September 2026.

The scan was performed against an older IIS deployment of the TanStack UI. The
table below records every finding instance in the report. Duplicate instances
are retained so the inventory can be reconciled one-for-one during the rescan.

| Report ID | Severity | Reported point / path | Resolution |
| --- | --- | --- | --- |
| 334 | Critical | Unprotected file `/perl/io` | IIS rejects legacy `/perl` and `/cgi-bin` probes before SPA fallback. |
| 11294 | Medium | Cross-frame scripting `/auth/` | CSP `frame-ancestors 'none'` and `X-Frame-Options: DENY` are applied to UI and static responses. |
| 839 | Low | Information leak `/robots.txt` | The revealing file was removed and IIS returns 404 instead of the SPA fallback. |
| 10210 | Low | Unprotected directory `/admin/` | Directory browsing is disabled; route-like trailing slashes permanently redirect to their canonical SPA route. Application and SQL role checks remain authoritative. |
| 10218 | Low | Unprotected directories `/documents/`, `/library/` | Same canonical-route and access-control resolution as 10210. |
| 10219 | Low | Unprotected directory `/demo/` | Same canonical-route resolution; existing demo access checks remain unchanged. |
| 10223 | Low | Unprotected directories `/Reports/`, `/services/` | Same canonical-route and access-control resolution as 10210. |
| 10229 | Low | Unprotected directory `/alerts/` | Same canonical-route and access-control resolution as 10210. |
| 10231 | Low | Unprotected directory `/assets/` | The report already received HTTP 403. Directory browsing remains disabled; fingerprinted files remain directly servable. |
| 10233 | Low | Unprotected directories `/auth/`, `/dashboard/`, `/staff/` | Trailing-slash requests canonicalize. `/auth` remains intentionally public; protected routes retain application/API role enforcement. |
| 10235 | Low | Unprotected directory `/help/` | Same canonical-route and access-control resolution as 10210. |
| 10810 | Low | Unprotected directory `/admin/` (duplicate rule) | Resolved by the controls for 10210. |
| 11276 | Low | Password autocomplete `/auth/` | `/auth` is SSO-only (no password field). Demo and other sensitive inputs use `autocomplete="off"`. |
| 11306 | Low | Insecure cache policy `/` | HTML responses use `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`; fingerprinted assets keep their existing cache behavior. |
| 11309 | Low | Insecure content-type setting `/` | `X-Content-Type-Options: nosniff` is applied to all UI responses. |
| 11365 | Low | HSTS missing on static asset | HTTPS responses use one-year HSTS with subdomains; the IIS site must continue redirecting HTTP to HTTPS. |
| 11603 | Low | XSS protection header missing `/` | `X-XSS-Protection: 1; mode=block` is applied for the legacy-client check; CSP is the primary modern protection. |
| 11606 | Low | Content Security Policy missing `/` | A CSP is applied at IIS and application runtime layers, including framing, object, base, form, script, style, font, image, media, worker and connection restrictions. |
| 11638 | Low | `uaeu` cookie missing SameSite | Application cookies already use `SameSite=Lax`; IIS appends it to origin cookies that omit it. The load balancer must also append `SameSite=Lax` if it creates the `uaeu` persistence/WAF cookie after the IIS response. |
| 10282 | Informational | OPTIONS and TRACE advertised `/` | TRACE and OPTIONS are disabled on the static UI site. API-host CORS preflight is intentionally unaffected. |
| 10302 | Informational | Cache headers on traversal probe | HTML no-store policy applies and IIS request filtering rejects double-escaped/probe paths. |
| 11676 | Informational | React library detected | Current resolved React/ReactDOM is 19.3.0 and `npm audit --omit=dev` reports zero vulnerabilities. Library identification alone is not a vulnerability. |
| 11766 | Informational | Cross-frame scripting `/auth/` (duplicate rule) | Resolved by the controls for 11294. |
| 11770 | Informational | Missing PQC-resilient TLS key exchange | This is a TLS-edge capability, not application code. Enable a UAEU-approved hybrid post-quantum key exchange on the load balancer/TLS terminator when supported, then validate it at the public hostname. |
| 5546 | Best practice | Missing privacy policy `/` | Added bilingual `/privacy` policy and a discoverable home-page footer link. |
| 5597 | Best practice | Email autocomplete `/auth/` | `/auth` is SSO-only (no email field). Remaining email inputs (e.g. demo/notification test redirect) use `autocomplete="off"`. |
| 10344 | Best practice | Weak hash signature in `exceljs.min` | The current dependency graph and source no longer contain or serve ExcelJS. The reported cryptographic constants were in the obsolete third-party bundle; no password or application hashing used them. |

## Deployment controls outside this repository

Two findings terminate outside the application and must be completed by the
team that owns the public TLS/load-balancer configuration:

1. If the `uaeu` cookie is injected after IIS, configure that cookie profile to
   emit `Secure; HttpOnly; SameSite=Lax`. The application and IIS controls
   cannot modify a header added later by the edge device.
2. Enable the UAEU-approved hybrid post-quantum TLS key exchange at the public
   TLS terminator when the installed platform/version supports it. This cannot
   be implemented by React, C#, IIS response headers or SQL.

After deploying the UI build, verify these controls against the public hostname
and rerun the same WebInspect policy. Do not copy a generated `web.config` over
`public/web.config`; the file is part of the security boundary.
