---
name: Lean Launch service deactivation
description: Internship, Student Housing and Inter-College Transfer are temporarily deactivated (hidden, not deleted) via src/lib/services/lean-launch.ts
type: feature
---
The later Hostel Booking and Programme/College Transfer requirements supersede their earlier deactivation. Internship remains postponed. Historical notes below describe the earlier Lean Launch only, not current hostel or transfer requirements.

- Single source of truth: `src/lib/services/lean-launch.ts` (`INACTIVE_SERVICE_KEYS`). Removing a key restores the service everywhere.
- Effects: student nav/catalogue/landing entries filtered out; the three routes render `ServiceUnavailableNotice`; their agent tools are dropped from `TOOL_REGISTRY` and domain detection; server engines throw via `assertServiceActive`; owner-console tabs hidden.
- Assistant answers these topics with "This service is not currently available through Sanadi" (no agentic workflow, no escalation).
- Nothing is deleted: tables, rows, rules, workflows and knowledge documents are preserved; `university_services.is_active = false` for the three service codes so Admin still sees them as inactive.
