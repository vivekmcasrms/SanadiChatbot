# Career Counselling inside the Sanadi Assistant

Students will be able to handle their whole career journey by simply asking in chat — job options, CV review, ATS score, missing skills, interview practice, and asking for a human counsellor — with Sanadi reusing the existing Career Counselling engine and their saved CV behind the scenes.

## What exists already

The career engine is complete and deterministic: one analysis run produces role matches, ATS score, skill gaps and an action plan from the student's verified record plus their current CV. The Assistant already has four read tools wired to it and a "career" topic detector. The Career page uses the same engine.

What's missing is chat coverage: no CV review, no interview practice, no way to request a counsellor from chat, a narrow topic detector that misses phrases like "what jobs can I apply for", no career guidance rules for the Assistant, and no visual result card in chat.

## What will be built

**1. Wider intent detection**
Extend the career detector so natural phrasing is caught: jobs after graduation, roles matching my degree, strongest options, missing skills, improve/review my CV, ATS score and why it is low, what to learn next, interview preparation and role-specific questions, "am I ready to apply", "speak to a counsellor". English and Arabic.

**2. New career capabilities, same engine**
Three additions to the Assistant's career toolkit, all calling the existing analysis:
- **CV review** — strengths, weaknesses, ATS issues, missing information and next actions, from the saved CV only.
- **Interview preparation** — role-relevant questions built from the target role's required skills and the student's own evidence, then conversational feedback on their answers.
- **Request a counsellor** — creates the real Career Counselling case through the existing intake (routing, owner notification, SLA, Needs Your Attention, My Requests), with no extra "are you sure" step and no duplicate if one is already open.

**3. Instant, deterministic answers where possible**
Straight questions — ATS score, which roles match, missing skills, job options — are answered directly from the engine with no model guesswork, so numbers can never be invented. Interview practice and open-ended guidance still go through the Assistant, which receives the same verified figures.

**4. CV awareness**
If a current CV exists it is used automatically and never requested again. If none exists, Sanadi still gives guidance from the academic record, says plainly that CV-based analysis needs a CV, and shows an **Upload CV** action. Replacing or deleting a CV already invalidates old results; chat picks up the new ones on the next question.

**5. Career card in chat**
A compact card under the reply showing CV status, ATS score, top role matches with reasons, key skill gaps, and quick actions (Upload/Replace CV, Full analysis, Request a Counsellor). The card is saved with the message, so reopening an old chat restores it.

**6. Guidance rules**
A career playbook is added to the Assistant's instructions: never invent a score, keep recommendations realistic for the student's level, base CV claims on parsed evidence, offer a counsellor when guidance runs out, and never send the student to a form.

## Technical notes

- New `src/lib/career/chat.server.ts`: intent detection + deterministic answer/card builder over `analyseCareer` (persisted), reused by both the fast path and tools.
- New tools in `src/lib/agent/tools.server.ts`: `review_my_cv`, `get_interview_preparation` (read-only), `request_career_counsellor` (`readOnly: false`, `confirmationRequired: false` so it executes instantly like the letter tool, returning a routed case reference).
- `src/lib/agent/context.server.ts`: broaden `DOMAIN_PATTERNS.career`, extend `DOMAIN_TOOLS.career`, keep `get_career_cv_status` prefetch.
- `src/lib/agent/prompts.server.ts`: add a `career` entry to `SERVICE_PLAYBOOKS`.
- `src/lib/agent/orchestrator.server.ts`: career branch in `tryFastPath`; carry `careerInsight` through the response and into message metadata.
- `src/lib/agent-types.ts`: add `CareerInsightCard` type and `careerInsight` on `AgentResponse`.
- `src/components/CareerInsightCard.tsx` rendered in `assistant.tsx`; `chat-history.functions.ts` restores it from stored metadata.
- No change to `career.functions.ts`, the Career page, or the analysis engine — one analysis system only.

## Verification

Run the eight acceptance questions through the live Assistant as a signed-in student, checking intent, CV reuse, deterministic ATS value, card contents, persistence after reopening the chat, and that the counsellor request appears in the owner's Needs Your Attention. Live sign-in has been unavailable in recent turns; if it still is, this will be reported rather than claimed.
