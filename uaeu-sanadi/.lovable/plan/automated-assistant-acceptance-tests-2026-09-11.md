# Automated Assistant acceptance tests

## Goal
Add a repeatable authenticated browser suite for the recently corrected Assistant flows, so routing and persistence regressions are caught through the real interface.

## Scope
- Add Playwright as a development test dependency and expose a dedicated acceptance-test command.
- Add shared authentication setup that restores the managed test session without storing credentials.
- Cover the highest-risk corrected journeys:
  - library search followed by “Is the first one available online?” stays in Library;
  - appointment options are numbered sequentially and an ambiguous counselling selection asks for clarification before booking;
  - Career ATS requests stay in chat and show either a deterministic result or an Upload CV action;
  - course-textbook requests show Blackboard guidance, current courses, catalogue results, and Library Services routing;
  - lost-property reports offer the confirmation-gated FMD notification action;
  - career-hours suggestions offer suggestion submission rather than career recommendations.
- Keep destructive or external actions at the confirmation step; tests will not book, submit, or notify.
- Save screenshots and traces only on failure.

## Verification
- Run the new suite against the local live app with an authenticated managed session.
- Run the existing focused unit tests for the covered routing modules.
- Confirm the app build remains healthy and report passing scenarios plus any environment-dependent skips.

## Technical details
Tests will use stable accessible selectors and visible outcomes rather than internal implementation details. Multi-turn scenarios will use fresh chats, wait for completed Assistant responses, and assert both the expected domain result and absence of known wrong-agent responses.
