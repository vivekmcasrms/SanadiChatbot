<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Hostel workflow
- Keep hostel eligibility in the pure rules module and revalidate independently inside transactional database functions; model arguments must never supply student eligibility facts.
- Store verified home city in a restricted university-provenance record rather than a student-editable profile; missing authoritative city must block booking.
- Extend the existing case lifecycle, routing, confirmation and notification surfaces with hostel detail records; do not create a separate housing admin system.
- Preserve Housing ownership for hostel cases and do not reroute existing submissions; this prevents generic routing rules from changing the service responsible for allocation.
- Use the standalone Vitest configuration for unit tests; the live voice preview Vite plugin requires an HTTP server unavailable in unit runs.

## Programme transfer
- Keep official catalogue snapshots and source references separate from transfer admission rules and equivalency decisions; elective alternatives must never become universally compulsory courses.
- Assess and submit transfers through authenticated transactional RPCs using university-provenance admission/history records and versioned target rules; this prevents model arguments or browser writes from supplying eligibility facts.
- Attach transfer evidence to the existing case workflow and reserve capacity only on authorised approval; submission is not an executed programme change.
- Unverified mappings and uncovered course credits remain unknown, not rejected or retained; this avoids invented equivalencies and graduation estimates.
- Transfer decisions require case-scoped Registration approval authority, and completion requires the university academic record already to confirm the target programme; this prevents administrative status changes from claiming an unexecuted transfer.

## Arabic language layer
- Arabic style rules, Emirati phrase glossing and dialect reading live only in `src/lib/arabic/emirati.ts`, selected by the admin `ai_settings` Arabic style columns; never hardcode dialect instructions in individual prompts, so the style can change in one place.
- Intent matchers accept Emirati and code-switched phrasing through the shared gloss rather than requiring formal Arabic; official action confirmations stay in professional Arabic regardless of style.

## Scheduled jobs
- Run each background job as its own managed HTTP schedule instead of one combined "run everything" call: the scheduler's HTTP delivery gives up after about five seconds, so a combined run can never finish, and managed schedules are the only ones that carry the credential the job endpoint requires.

## Demo data isolation
- Gate every demo capability (demo sign-in, persona opening, account directory, seeding) through `src/lib/demo-environment.ts` (`evaluateDemoAccess`): non-production host, demo flag, configured access code, and system admin for seeding; preview and production share configuration, so the flag alone cannot keep demo tools off the live site. Demo personas sign in with one-time server-minted tokens and get random unreturned passwords, so no shared demo password exists.
- Background jobs, leadership reports and evaluation metrics must filter out demo records explicitly, and a database trigger blocks assigning real cases to demo staff; never mark a real student as demo to expose sample inventory.

## Authorization
- Decide access only through `getActiveRoles`/`requireAnyRole` (`src/lib/authz/roles.server.ts`, backed by the `active_roles` DB function) or `has_role` in SQL; never read `user_roles` directly for a decision, because only these honour revoked, disabled and deleted accounts.

## Intent routing
- Every turn is routed by one contract (`src/lib/routing/intent.ts` `resolveRoute`, fed by the semantic classifier in `classifier.server.ts`); regex there is only for case references, emergencies and explicit identifiers, and sticky context expires by TTL, so new service gates must read `route.intent` instead of adding keyword fast paths. Eligibility stays in the service rule modules, never in the classifier. Decisions are logged to `intent_routing_logs` (admin/auditor read only).

## Conversation state
- Write `conversation_state` only through `saveConversationState` (`src/lib/routing/state-store.server.ts`): it compare-and-swaps on `state_version` and merges a losing concurrent turn, so two tabs or devices never overwrite each other. Saved context keys carry TTL stamps (`src/lib/routing/state.ts`); add a TTL entry for any new context key, and store structured state only, never raw prompts.

## Failure handling
- Service lookups return the shared result model in `src/lib/result.ts` (`must()` throws on a failed query; `guardService`/`reportFailure`/`checked`/`auditInsert` in `src/lib/exceptions/handle.server.ts` log component, type, trace and recovery): a backend failure must never be reported as "nothing found" or let the assistant drift into another workflow.

## Staff workspace
- All staff roles (owner, officer, manager) work cases in the single `/cases` workspace and the shared case page; `/staff` and `/owner-console` only redirect there. Role differences come from `staffCapabilities` in `src/lib/ops/staff-workspace.ts`, and every case action checks `assertCaseAccess` (`can_access_case`), so views stay consistent and unit scoping is enforced on the server.
- After any staff mutation call `refreshCaseViews` (`src/lib/case-refresh.ts`) on success and failure, so stale-view rejections immediately show the latest version.

## Student notifications
- Students have one Notifications page (`/my-notifications`, tabs incl. University Alerts and Preferences) fed by `listMyNotificationsFn`, which merges `notification_events` and `student_alerts`; the bell uses the same function and `/alerts` only redirects, so there is a single source for unread counts and read state.

## Document retention
- Issued-letter cleanup runs claim → remove file → verify gone → record outcome (`src/lib/documents/cleanup.ts`, DB `claim_/complete_document_file_cleanup`); rows are purged only after the file is confirmed removed and verification has ended, so storage failures never orphan a file. File availability (retention) and verification validity (`expires_at`) are separate; expired-file letters stay in student history read-only.

## Job batching
- Scheduled jobs page through rows with keyset pagination (`pagedRows` in `src/lib/ops/job-batching.server.ts`), load related rows in grouped `in (...)` lookups, filter time windows in the query, and stop at a run time budget recording `truncated`/`skipped`/`duration_ms`; a fixed `.limit()` with in-memory filtering starves later rows.

## Turn latency
- Knowledge retrieval runs at most once per turn: when passages were prefetched, `search_knowledge_base` is not offered to the model, and personal-record questions skip policy retrieval; this removes extra model round-trips without changing which rules decide answers.

## Admin structure
- System admins get seven menu sections (`GOVERNANCE_NAV`); every configuration page is reached through the tabbed `/system-settings` hub defined in `src/lib/admin/settings-map.ts`, and FAQ management is a Knowledge Center tab (`/knowledge` only redirects). Add new admin configuration pages to the settings map rather than the menu, so the menu stays focused and no capability becomes unreachable.

## Agent terminology
- In UI and evaluator material only the Sanadi Orchestrator is called an AI agent; other components are labelled Specialist Service, Rule Engine, Workflow, Retrieval Service or Skill (`STAGE_LABELS` kind in `src/lib/agent-activity.ts`). Internal code names like `agent/` stay unchanged to avoid risky renames.
