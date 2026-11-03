# Sanadi — local deployment validation report

Date: 2026-09-12

Two classes of check are reported separately, because they carry different
evidence:

- **Verified now** — executed in this environment against the actual codebase
  and the actual database.
- **Requires your machine** — can only be executed once you have restored the
  export and started the local stack. Commands are given so you can produce the
  evidence yourself; nothing here is claimed as passing without evidence.

## A. Verified now

| Check | Result | Evidence |
| --- | --- | --- |
| Database engine identified (no engine conversion) | PASS | PostgreSQL 17.6 + pgvector 0.8.2 |
| All 166 referenced tables/views exist | PASS | `scripts/verify-local-deployment.mjs` |
| All 27 referenced RPCs exist | PASS | same |
| All 9 enums, 2 views, 4 extensions exist | PASS | same |
| RLS policies present (427) | PASS | same |
| Triggers present (98) | PASS | same |
| All 4 storage buckets exist and are private | PASS | same |
| Master data present (84 profiles/roles, 55 units, 36 knowledge documents, 779 chunks, 201 academic rows, 675 slots) | PASS | catalogue query |
| Embeddings portable (plain `vector` columns, dump-safe) | PASS | column inspection |
| Application builds | PASS | build log `build OK` |

## B. Requires your machine (run after restore)

| Check | How to validate locally |
| --- | --- |
| Student login | Sign in at `http://localhost:8080/auth` as `202113@uaeu.ac.ae` |
| Staff login | Sign in with a roster staff account |
| Admin login | `nzaki@uaeu.ac.ae`, or create one with `scripts/create-admin.mjs` |
| Assistant chat | Ask "What are the library opening hours?" — needs an AI key |
| Academic progress | Ask "What is my degree progress?" as a student |
| Registration checks | Ask "Am I ready to register?" |
| Career Counselling | Upload a CV → ATS score and role matches |
| Library search | Only with `LIBRARY_API_*` credentials; otherwise reports unavailable |
| Complaints / suggestions / alerts | Submit one of each from the Assistant |
| Emergency routing | Report "I can see smoke coming from a classroom" → unit + assigned staff |
| Staff assignment | Confirm the case appears in the assignee's `/staff` workspace |
| My Requests | `/requests` lists the submitted items with filters |
| Document generation | Request a "To whom it may concern" letter → PDF + `/verify/<token>` |
| Knowledge Center / RAG | Admin → Knowledge Center: sources load; upload a PDF to `completed` |
| Role access | A student must not reach `/admin` or `/owner-console` |
| Audit records | Rows appear in `knowledge_audit_log`, `case_status_history`, `routing_decisions` |

## C. Explicitly not reproducible locally

| Item | Status |
| --- | --- |
| Email delivery | FAIL/NOT AVAILABLE — managed Lovable email API; also unconfigured in production. Deliveries record `skipped`. |
| Google OAuth via the Lovable broker | NOT AVAILABLE — use email/password locally. |
| AI answers without a provider key | NOT AVAILABLE — the Assistant needs `LOVABLE_API_KEY` or an OpenAI/Azure/custom key. |
| Library catalogue search without credentials | NOT AVAILABLE. |
| Agentic latency target (P95 < 8s) | NOT CLAIMED — last measured agentic P95 was 9.4s on hosted infrastructure. |
