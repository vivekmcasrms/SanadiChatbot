# Sanadi — external dependencies and what works locally

Classification key:
**LOCAL** works entirely on your machine · **NET** needs internet ·
**CRED** needs credentials you must supply · **INTERNAL** implemented inside
Sanadi, nothing external · **N/A-LOCAL** cannot be reproduced outside the
hosted environment.

| Dependency | Class | Used by | Local behaviour |
| --- | --- | --- | --- |
| PostgreSQL 17 + pgvector | LOCAL | everything | Supabase CLI or `pgvector/pgvector:pg17`. Identical engine. |
| Supabase Auth (GoTrue) | LOCAL | sign-in, roles, RLS `auth.uid()` | Runs in the CLI stack; email auto-confirm, no SMTP needed. |
| Supabase Storage | LOCAL | CVs, letters, knowledge files, case evidence | Runs in the CLI stack; buckets recreated from `supabase/bootstrap/00_storage_buckets.sql`. |
| PostgREST (Data API) | LOCAL | all reads/writes, RPCs | Runs in the CLI stack. |
| LLM — Lovable AI Gateway (`ai.gateway.lovable.dev`) | NET + CRED | Assistant, all agents, classification, CV parsing, voice transcription | Needs `LOVABLE_API_KEY`, or switch the `ai_settings` row to OpenAI / Azure OpenAI / a custom OpenAI-compatible base URL. **No AI key = no Assistant answers.** |
| Embeddings (`text-embedding-3-small` via the same gateway) | NET + CRED | Knowledge Center ingestion, RAG retrieval | Existing embeddings restore from the dump and keep working for retrieval; new ingestion and semantic query embedding need the key. Lexical (`pg_trgm`) retrieval still works without it. |
| Email delivery (`@lovable.dev/email-js`) | N/A-LOCAL | notifications, case updates, appointment mail | Managed Lovable API; unavailable locally. Deliveries are recorded as `skipped`, not lost. Replace the single call site `src/lib/notifications/provider.server.ts` with your SMTP/ESP client. Email is currently **not configured in production either**. |
| Library discovery API (OCLC-style) | NET + CRED | Library Agent catalogue search | Needs `LIBRARY_API_KEY`, `LIBRARY_API_CLIENT_ID`, `LIBRARY_API_CLIENT_SECRET`. Without them the Library Agent reports honestly that catalogue search is unavailable. |
| Web knowledge crawling | NET | Knowledge Center web sources | Plain outbound HTTPS from `src/lib/knowledge/crawl.server.ts`; works with internet access. |
| Blackboard | INTERNAL | Course Textbook Agent | No live API integration. Sanadi gives verified guidance text only — identical locally. |
| SIS / student records | INTERNAL | academic progress, registration readiness, Ask Once | Data lives in Sanadi's own tables (`student_profiles`, `student_course_history`, `program_*`). No live SIS call. |
| Institutional SSO | N/A | sign-in | Not used. Authentication is Supabase email/password (plus Google OAuth via the Lovable broker, which does not work outside Lovable — use email/password locally). |
| Document generation (PDF) | LOCAL | letters, certificates, QR verification | `pdf-lib` in-process; no external service. Verification URLs use `PUBLIC_APP_URL`. |
| Speech-to-text | NET + CRED | Assistant voice input | Same AI gateway key. |
| Scheduled jobs | LOCAL | SLA, escalations, notification dispatch/digest, retention | HTTP hooks under `/api/public/hooks/*`, driven by OS cron with `LOVABLE_CRON_SECRET`. |
| Google OAuth (Lovable broker) | N/A-LOCAL | optional sign-in | Broker is Lovable-hosted. Locally, configure a Supabase OAuth provider yourself or use email/password. |

## Honest summary

A local Sanadi is **functionally identical for everything that runs on
PostgreSQL, Auth, Storage and in-process logic** — agents, tools, routing,
RLS/roles, documents, Knowledge Center, My Requests, staff workspaces.

Three things are **not** identical without external services:

1. **AI answers** require an AI provider key (gateway, OpenAI, Azure or custom).
2. **Email delivery** cannot be replicated as-is; it needs your own SMTP/ESP.
3. **Library catalogue search** requires library API credentials.
