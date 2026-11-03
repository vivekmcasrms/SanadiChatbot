# Hostel Room Booking
- [x] Implement verified city/credit eligibility and bilingual assistant journey.
- [x] Implement one-time request creation, Housing routing and audit records.
- [x] Add authorised staff allocation and confirmation with persistent notifications.
- [x] Include actual assignment in case follow-up and student case views.
- [x] Test eligibility boundaries, missing records and duplicate prevention; verify demo submission, admin-authorised allocation and student readback.
- [ ] Enable real student bookings: awaiting authoritative home-city records and Housing staff verification of actual availability.

# Programme / College Transfer
- [x] Refresh existing Computer Science and Biology with official catalogue details, correct Computer Science college ownership, retain College of Science, and verify all three requested programme options; no invented transfer eligibility.
- [x] Restore deterministic transfer checks with configurable entry rules and verified current-term capacity.
- [x] Add verified course-equivalency analysis with explicit unknowns and no invented graduation delay.
- [x] Add informed, revalidated, idempotent confirmation and Registration ownership safeguards.
- [x] Show evidence and authorised decisions in existing case views; persist notifications and audit.
- [x] Run 20 boundary/intent tests and verify signed-in Admin settings and blocked assessment against existing records.
- [ ] Verify successful student submission, Registration approval/completion and student follow-up: blocked by missing verified entry/history records, official mappings and verified current-term capacity; no fabricated evidence will be created.
# Production readiness (review prompts 2–6)
- [x] Academic readiness: separate checks, Unknown for missing data, never "all clear" with credits remaining (tests).
- [x] One evidence status per answer; controls follow each answer's language (tests).
- [x] Hostel controls only on cases with a hostel booking.
- [x] Directory hides placeholder/demo emails (tests); "Ask Sanadi about this unit" carries the unit and shows it.
- [x] Expired documents no longer listed as Valid (tests).
- [x] Library search extracts the topic from natural requests (tests).
- [x] Forgot password + show/hide password; reset-password page.
- [x] Hourly jobs repaired: the old combined schedule carried no credential (rejected 401) and gave up after 5s when the app was slow to wake; replaced with one managed schedule per job, and the approved clean-up deleted 31 letters.
- [ ] Confirm every job completes inside its delivery window on the next hourly run; rework any that still time out.
- [ ] Multi-part academic questions, action-trace wording, unit context inside retrieval, cross-tab booking tests, staging release checklist.

## Demo / real data separation
- [x] Exclude demo records from hourly jobs, leadership and evaluation
- [x] Demo tools off on production addresses; demo menu entries removed; admin-only seeding
- [x] Data classification audit page (read-only)
- [x] Current students, hostels, rooms, transfer seats, cases reclassified as real (owner decision)
- [ ] Review 675 sample appointment slots and 9 sample impact baselines (manual decision)

## Strengthen agents (next)
- [ ] Turn named "agents" into real agents with own state, tools, decisions and handoff
