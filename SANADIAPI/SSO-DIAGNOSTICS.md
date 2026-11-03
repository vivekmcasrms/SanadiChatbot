# SSO diagnostics

Deploy the updated API and the complete UI `dist/client` directory together.
Apply `sql/2026-09-28-sso-session-tickets.sql` before deploying the new API.
The static UI includes `auth/index.html`, `auth/callback/index.html` and a
callback-specific `web.config`; deploy all of them. No local password form is used.

The flow is UI -> API `/api/v1/auth/sso/authorize` -> provider -> configured
`SsoRedirectUri` -> configured `SsoUiOrigin` + `/auth/callback?ssoTicket=...` ->
POST `/api/v1/auth/sso/session` -> role-based application content. The API creates
the authorization URL. The UI installs the redeemed access/refresh tokens into
its existing session storage and uses the returned SQL roles. No student
provisioning or domain restriction is added. Existing SQL account checks remain.

The new authorize flow binds each session ticket to a random verifier retained
in the initiating UI tab. Use the same UI origin before and after SSO: a verifier
stored on localhost is not available on the hosted UI. The UI's API base must
point to the same logical API and SQL state store that handle the callback.
Provider URLs and credentials continue to come from ApplicationSettings.
If the provider omits email from both the validated ID token and the matching
user-info response, Sanadi maps the explicit `username` claim to
`username@HeaderDomain` using the configured university domain. This fallback
requires a valid username and domain, rejects conflicting usernames and
user-info subject mismatches, and still uses the existing SQL registration,
active-profile and role checks. Display names and `sub` are never used as
email substitutes. A valid email claim continues to take precedence.
The API reads provider and return-URL settings through `usp_Sso_GetSettings`,
selecting its SQL settings row with `SsoRouting:IsProductionEntry` (environment
variable `SsoRouting__IsProductionEntry`, default `true`). For this production
deployment, that row must contain API callback
`https://sanadiapi.uaeu.ac.ae/api/v1/auth/sso/callback` and UI origin
`https://sanadi-beta.uaeu.ac.ae`. UI `.env` settings do not replace these API SQL
settings. Browser-supplied return URLs and Host headers cannot override them.

Run the local API with `dotnet run --project Sanadi.Api --launch-profile http`.
That profile selects Development and port 5281. Open the UI as
`http://localhost:8080` (not 127.0.0.1, which has separate browser storage).
`npm run dev` uses the local `.env`; `npm run build` uses `.env.production`
with the hosted API. Remove any stale shell `VITE_API_BASE_URL` override before
building, because Vite gives shell variables precedence over env files.
On IIS use Production and deploy the entire `dist/client` folder, including
`auth/callback/index.html` and its `web.config`; otherwise IIS still returns 404.
The identity provider must register both exact API callback URLs.
Existing direct `/initiatesso` clients remain supported without a browser verifier.

Tickets expire after two minutes and are consumed atomically in SQL; only hashes
and authenticated-encrypted session payloads are stored. The UI strips the ticket
from its address bar immediately and redeems via POST. Callback pages disable
referrer transmission and caching. Do not capture query strings or POST bodies
for SSO endpoints in infrastructure/request logs; this includes provider codes
and the short-lived session ticket. Sanitized authentication events omit these values.

The API also writes SSO diagnostics to server-local text files at
The API no longer writes dedicated SSO text files. Request diagnostics are sent
through the normal ASP.NET Core `ILogger` pipeline.
Each line is a JSON event with a UTC timestamp. This logger is independent of the
standard ASP.NET Core `ILogger<T>` Error-level setting. Production enables it with:

```json
"SsoDiagnostics": {
  "Enabled": true,
  "RetentionDays": 7,
  "MaxFileSizeMb": 5,
  "MaxFilesPerDay": 4
}
```

Publish the updated API to enable server text logs; a UI-only deployment cannot
create server files. Grant the API's IIS application-pool identity Modify access
to the configured application logging sink. Do not
enable public download access. The current production UI build targets
`https://sanadiapi.uaeu.ac.ae` from `https://sanadi-beta.uaeu.ac.ae`.
No SQL script is required specifically for this diagnostic change.

The trace covers the sign-in button, browser proof, authorize request, SQL settings,
state storage, provider redirect, callback, provider token exchange and validation,
SQL account/roles, JWT issuance, session ticket creation/redemption, session cookies,
refresh, profile retrieval and application redirect. Browser milestones are marked
`source: "browser"` because they are unauthenticated diagnostic reports. Use server
events to confirm actual authentication outcomes. No authorization decision uses
these diagnostics.

To investigate a failed attempt, locate `AUTH_SUBMIT` by its UTC time and follow
its `flowId`. API requests have a `requestId`; callback requests are linked through
the SHA-256 `reference` of the random SSO state, and ticket redemption through the
SHA-256 ticket reference. These references cannot be used as sign-in credentials.
Look for the first server event with `outcome: "error"`, then inspect its `step`,
`operation`, `code`, and `errors`. SQL diagnostics include server/database names,
error number, procedure, state and line, but never the connection string or login.

| Diagnostic code | Check on production |
| --- | --- |
| `sql_login_failed` (18456) | Effective API SQL credentials and SQL server login failure details |
| `sql_database_unavailable` (4060) | Target database and the API login's access |
| `sql_permission_denied` (229) | API database user's execute/read permissions on the reported object |
| `sql_procedure_missing` (2812), `sql_object_missing` (208) | Reported server/database, schema and missing object |
| `sql_column_missing` (207), `sql_parameter_missing` (201), `sql_parameter_mismatch` (8144) | Schema/procedure signature compatibility with the deployed API |
| `sql_connection_string_missing`, `sql_connection_string_invalid` | Effective API connection-string configuration and environment overrides |
| `jwt_signing_key_invalid` | Effective API `Jwt:SigningKey` configuration; do not paste its value into logs |
| `upstream_http_failed`, `tls_authentication_failed` | Provider connectivity, HTTP status and safe network error metadata |

A `/auth/user` 401 before sign-in is expected. A 500 from authorize or refresh
requires the corresponding server exception event; the browser's generic message
alone cannot identify the root cause. Authorization URL creation happens before
the browser is redirected to the identity provider.

Tokens, authorization codes, verifier values, cookies, passwords, client secrets,
request bodies, URL query strings, personal claims and raw exception messages are
excluded. Browser diagnostic fetches omit credentials and referrers. Disk writes
run in the background with a bounded queue; logging failures do not change login
results. Files rotate up to the configured daily limit per API process and expire
after the retention period. Queue overflow is counted as `SSO_LOG_DROPPED` when the
writer catches up. A full disk, missing folder permissions, daily limit, unavailable
API, blocked browser request or abrupt shutdown can leave gaps; check the existing
API Error-level logs if no `SSO_LOG_READY` entry appears. Set
`SsoDiagnostics__Enabled=false` to disable collection after diagnosis.

For local testing, restart the UI after changing `.env` and ensure the running
Vite process uses `VITE_API_BASE_URL=http://localhost:5281`. An environment
variable inherited by Vite overrides `.env`; a stale hosted API value can send
the new `/sso/authorize` request to an older deployment and return 404.

The ticket flow does not depend on cookies being available across hosts.
If a successful callback is not followed by session redemption, inspect the callback
page's network request and the session endpoint's response code. Check that the original
UI tab/origin is used and all API instances share the state store and signing key.
If subsequent authentication fails, verify signing key,
issuer, audience and clock consistency across API instances. A 401 before login
is expected; a 401 immediately after successful SSO requires those checks.

The application never grants a session merely because the provider displayed a
successful login. The callback must validate identity and SQL authorization.
