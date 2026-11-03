# Sanadi Agentic Latency Deep Optimization

## Goal
Reduce normal agentic latency without changing eligibility, routing, transaction, confirmation, citation, audit, or bilingual outcomes. The release gate is measured P95 below 8 seconds; otherwise the final result will explicitly fail.

## Implementation

### 1. Make every model call explainable
- Add a protected `agent_model_invocations` telemetry table and indexes, with one row per attempted model call.
- Record trace ID, sequence, purpose, necessity reason, model, token counts, lane queue time, provider first-token time, generation/total time, result used/discarded, status, and error category.
- Extend provider/lane timing so queue latency and provider first-token latency are measured independently rather than inferred from whole-turn time.
- Persist prompt contribution totals per call: system, playbook, tools, verified context, knowledge, history, workflow state, message, and output schema.

### 2. Add auditable deterministic workflow plans
- Introduce versioned code/config plans for known service journeys: internship eligibility/matching, housing allocation, transfer analysis, appointment availability/booking, complaint intake, career analysis, and multi-step requests.
- Each plan declares required prefetched reads, allowed tools, sequencing, required parameters, confirmation boundary, and whether a deterministic result can be returned directly.
- Keep existing backend rule engines and transactional actions authoritative; plans only remove LLM rediscovery of known sequencing.
- Persist compact workflow state in the existing conversation state record: plan/version, current step, selected resource, pending action, confirmation state, and acknowledgements.

### 3. Collapse routine workflows to one or zero model calls
- Run independent plan reads concurrently before generation.
- For known workflows, pass verified structured results into one final wording call instead of allowing repeated model-selected read-tool loops.
- Retain LLM tool selection only for ambiguity, missing parameters, cross-domain requests, or genuinely open-ended reasoning.
- Return existing human-readable receipts directly for confirmed bookings/submissions/documents; do not invoke an LLM just to restate a deterministic success.
- Preserve supervisor invocation rules and all safety/human-review boundaries.

### 4. Reduce prompt and tool overhead
- Expose only the selected workflow's tools plus the minimum universal safety/handoff tools; do not send unrelated domain capabilities.
- Replace repeated service prose with concise plan identifiers and outcome constraints already enforced in code.
- Compact prefetched/tool outputs with per-tool serializers that retain only decision evidence, references, alternatives, and confirmation inputs; never send raw records.
- Use structured workflow state instead of replaying conversation text when a known plan is active; retain bounded relevant history for ambiguous/general turns.
- Keep authoritative knowledge passages intact and preserve citation behavior.

### 5. Complete end-to-end timing and execution classification
- Emit immediate SSE lifecycle events for accepted request and genuine workflow progress, then real model tokens; measure request start, first SSE byte, tool completion, model request, first model token, and browser render.
- Persist browser first-render timing through a lightweight authenticated acknowledgement, correlated by trace ID.
- Replace legacy execution labels with the required closed set: `FAST_DATA`, `RULE_ENGINE`, `RAG`, `AGENTIC`, `ASYNC_JOB`, `ERROR`; migration backfills legacy/unknown rows deterministically.
- Count orchestrator DB operations through a request-scoped instrumented DB wrapper/explicit tracker, including initial context, persistence, and bookkeeping, while retaining operation-level slowest-query timing.

### 6. Benchmark and regression gate
- Capture a pre-change production baseline from current telemetry.
- Add repeatable bilingual benchmark fixtures for internship eligibility/matching, housing, transfer, appointment, complaint, career counselling, and a multi-step request.
- Run at least 10 repetitions per practical scenario, recording P50/P95, first useful visible content, tokens, model calls, errors, and model-call purposes.
- Compare the current fast model with a supported faster candidate only for routine final wording; keep the current model where quality or risk regressions appear.
- Verify identical eligibility/action selection, capacity and transaction checks, confirmations, citations, audit rows, and Arabic outcomes.

## Technical details
- Keep model/provider code server-only and preserve bounded retry semantics: only 429/5xx retry with backoff; terminal gateway errors surface without replay.
- Keep true streaming and existing deterministic fallbacks. No UI redesign; only invisible timing/progress plumbing is added.
- New public-schema telemetry tables receive explicit grants, RLS, and service-role access in the same migration; students cannot read operational traces.
- Avoid duplicating business rules in workflow plans: plans call the same existing service functions/tools that currently decide outcomes.

## Final report
Report before vs after P50/P95, first visible/useful content, input/output tokens, model calls per turn, eliminated calls with reasons, remaining latency contributors, scenario quality results, measured error rate, and either **AGENTIC LATENCY GATE PASSED** or **AGENTIC LATENCY GATE FAILED**. Success is claimed only if measured agentic P95 is below 8 seconds.
