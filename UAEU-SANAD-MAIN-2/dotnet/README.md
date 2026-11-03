# Sanadi — ASP.NET Core solution

A parallel ASP.NET Core 8 implementation of the Sanadi student services assistant
(UAEU). It is a standalone solution: the existing React/TypeScript application is
untouched and keeps running as it is.

## Projects

| Project | Purpose |
| --- | --- |
| `Sanadi.Domain` | Entities and authored business rules (case status vocabulary, roles, deterministic inter-college transfer eligibility). |
| `Sanadi.Application` | Use cases and ports: agent orchestrator, tool registry, prompts, output safety, student context, cases, documents, Knowledge Center, chunker. |
| `Sanadi.Infrastructure` | EF Core / PostgreSQL, hybrid knowledge retrieval, AI gateway client (chat + embeddings), PDF letters with QR verification, PDF/web text extraction, file storage, SMTP, sign-in against the existing auth server. |
| `Sanadi.Web` | ASP.NET Core MVC UI (student, service owner, admin), REST API and Swagger. |

## Preserved behaviour

- **Instant To Whom It May Concern letter** — issued immediately as a verifiable PDF
  with a QR code. No case, no approval, no waiting days. It is classified as a
  document request, never as a complaint.
- **Deterministic eligibility** — inter-college transfer requires 12–36 completed
  credits, GPA ≥ 2.50, no previous transfer, available capacity and an open
  service. The model explains the verdict and can never override it.
- **Grounding discipline** — greetings, thanks and farewells get a natural reply with
  no "could not be verified" notice; institutional questions must be grounded in an
  approved source or the student's verified record.
- **One source of truth for case status** — "open" always means New + In Progress +
  Waiting for Student, and owner counts and lists come from the same query builder.
- **Clean answers** — stray markup (`svg`, HTML tags) and internal tool output are
  stripped before anything reaches the student.
- **SLA percentages** are multiplied by 100 exactly once and are only computed over
  completed cases.
- **Knowledge Center lifecycle** — a source becomes Active only after extraction and
  indexing actually succeeded; multiple documents, URLs and API connections can be
  added in one submission; secrets are referenced by name and never displayed.
- **Section-aware hybrid retrieval** — keyword + fuzzy + heading/section + semantic
  scoring, with concept groups (objective / purpose / aim / goal) and a relevance
  floor so unrelated passages are never sent to the model.

## Running it

1. Install the [.NET 8 SDK](https://dotnet.microsoft.com/download) and PostgreSQL 15+.
2. Edit `src/Sanadi.Web/appsettings.json`:
   - `ConnectionStrings:Postgres` — your database.
   - `Auth:Url` / `Auth:AnonKey` / `Auth:JwtSecret` — the existing auth server, so all
     current student, owner and admin accounts keep working.
   - `Ai:ApiKey` — AI gateway key (any OpenAI-compatible endpoint works).
   - `Smtp:*` — set `Enabled` to true to send notification email.
3. Restore and run:

```bash
cd dotnet
dotnet restore
dotnet run --project src/Sanadi.Web
```

The schema is created on first start. To manage it with migrations instead:

```bash
dotnet tool install --global dotnet-ef
dotnet ef migrations add Initial -p src/Sanadi.Infrastructure -s src/Sanadi.Web
dotnet ef database update -p src/Sanadi.Infrastructure -s src/Sanadi.Web
```

Open <https://localhost:5001>. Swagger is available at `/swagger` in development.

## Screens

| Route | Role |
| --- | --- |
| `/` | Student overview: programme, GPA, credits, holds, recent requests |
| `/assistant` | Chat with Sanadi (grounded answers, confirmed actions) |
| `/requests`, `/documents` | Student requests and instant letters |
| `/verify/{token}` | Public document verification |
| `/owner` | Needs your attention / assigned / completed queues |
| `/admin`, `/admin/performance`, `/admin/knowledge`, `/admin/knowledge/test` | University-wide governance and the Knowledge Center |

## API

`POST /api/assistant/ask` and `POST /api/assistant/execute` accept either the sign-in
cookie or a bearer token from the auth server.

## Migrating your data

The entity model maps onto the same table names used today (`profiles`, `cases`,
`knowledge_sources`, …), so an existing PostgreSQL dump can be restored into the
target database before first start. Review column names against your dump and add
EF Core migrations for any local differences.
