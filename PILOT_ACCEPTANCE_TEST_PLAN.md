# RE-VOICE / Switchboard — Pilot Acceptance Test Plan

Status: **plan only, not yet executed.** 50 scenarios below, split into:
- **Bucket A — backend-verifiable (40 scenarios).** Can be exercised by replaying a realistic transcript + the tool-call sequence a real call would produce directly against the deployed middleware (webhook + tool endpoints), then checking the resulting DB/CRM/dashboard state. This is the same technique that caught the webhook race condition — it verifies middleware logic, data integrity, and compliance behavior, but not audio/telephony quality.
- **Bucket B — live-call required (10 scenarios).** Fundamentally about real-time audio/telephony behavior (silence, interruptions, pacing, disclosure timing as actually spoken, STT robustness). No text simulation can honestly verify these — they need you to place a real call while I watch `railway logs` live, the same way we verified M6/M7 and the disclosure line.

Each scenario has: Goal, Expected conversation, Expected tool calls, Expected CRM updates, Expected dashboard updates, Expected task creation, Expected lead stage, Expected transcript, Expected summary, Expected outcome, Expected failure conditions, Pass/Fail (blank until run).

**Note on numbering:** Bucket A IDs are S01–S19, S21–S36, S45–S49 (40 total, non-sequential — drafted, then trimmed from 41 to 40 without renumbering to avoid breaking scenario cross-references like "same gap as S28"). Bucket B is S-B1–S-B10. 50 total. Don't confuse a scenario ID (e.g. "S07") with the system prompt's own conversation-state IDs (e.g. "S07_VALUE") — several scenarios reference the latter by design, since that's what they're testing.

---

## Bucket A — Backend-verifiable (40)

### S01 — First-time buyer, standard flow
**Goal:** Confirm the full discovery→qualify→schedule flow persists correctly for a brand-new caller.
**Expected conversation:** Caller says they want to buy their first home; gives timeline (~90 days), budget (~$450k), not yet pre-approved.
**Expected tool calls:** `lookup_caller_history` (returning:false) → `check_calendar_availability` → `book_appointment` → `update_crm_lead` → `send_sms` (confirmation).
**Expected CRM updates:** New lead created; intent=buy; budget floor/ceiling set.
**Expected dashboard updates:** Appears in Pipeline (warm/hot depending on score); appears in Calendar as confirmed appointment.
**Expected task creation:** None (appointment booked successfully — no fallback task).
**Expected lead stage:** Warm (pre-approval not yet confirmed lowers financial-readiness score).
**Expected transcript:** Disclosure first, then discovery questions, alternative-choice close for scheduling.
**Expected summary:** Buyer, ~90 day timeline, $450k budget, appointment booked.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** No lead/appointment row created; wrong stage; disclosure missing/not first.
**Pass/Fail:** —

### S02 — Luxury buyer ($3M+)
**Goal:** Confirm high-budget callers are scored/staged appropriately and treated with the luxury-brand tone (S07 trust-building) rather than a generic script.
**Expected conversation:** Caller describes a $3–5M budget, cash-adjacent, wants a private showing.
**Expected tool calls:** `lookup_caller_history` → `check_calendar_availability` → `book_appointment` → `update_crm_lead`.
**Expected CRM updates:** Lead with budget_floor/ceiling in the millions; intent=buy.
**Expected dashboard updates:** Hot lead surfaces in Today's Work "Call immediately" (or appears in Pipeline hot column); dollar-metrics pipeline reflects the higher budget for admin/manager view.
**Expected task creation:** None.
**Expected lead stage:** Hot.
**Expected transcript:** No generic scripted qualifying tone — reflects S07 trust-building language.
**Expected summary:** Luxury buyer, high budget, private showing requested.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Budget fields not persisted; composite score doesn't reflect the high financial-readiness signal.
**Pass/Fail:** —

### S03 — Cash buyer
**Goal:** Confirm `is_cash_buyer` extraction only fires on explicit confirmation (per prompt's entity-extraction guide), never inferred.
**Expected conversation:** Caller explicitly says "I'm paying cash, no mortgage."
**Expected tool calls:** `lookup_caller_history` → `update_crm_lead` → `check_calendar_availability` → `book_appointment`.
**Expected CRM updates:** Financial-readiness score reflects cash-buyer boost.
**Expected dashboard updates:** Lead stage reflects the FR boost in Pipeline.
**Expected task creation:** None.
**Expected lead stage:** Hot or warm depending on other signals.
**Expected transcript:** Explicit cash confirmation present before any FR score boost applied.
**Expected summary:** Cash buyer, budget, timeline.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** `is_cash_buyer` inferred without explicit statement (compliance/scoring bug).
**Pass/Fail:** —

### S04 — FHA buyer
**Goal:** Confirm FHA-financing buyers are routed to lender referral appropriately (S10_LENDER_REF) rather than treated identically to cash buyers.
**Expected conversation:** Caller mentions FHA loan, not yet pre-approved.
**Expected tool calls:** `lookup_caller_history` → `send_sms` (lender referral template) → `update_crm_lead`.
**Expected CRM updates:** Intent=buy; FR score reflects "not pre-approved."
**Expected dashboard updates:** SMS logged in `sms_log`; visible via lead detail (not directly surfaced but persisted).
**Expected task creation:** None unless caller also books.
**Expected lead stage:** Warm/cold depending on other signals.
**Expected transcript:** Lender referral framed as "a gift," not shame, per S10.
**Expected summary:** FHA buyer, needs lender referral.
**Expected outcome:** Lender referral sent; may or may not book same call.
**Expected failure conditions:** No `sms_log` row; SMS log claims "sent" when Twilio isn't configured (should say mock).
**Pass/Fail:** —

### S05 — VA buyer
**Goal:** Confirm VA-loan mention doesn't trigger any Fair-Housing-adjacent language (military/veteran status handled neutrally, factually).
**Expected conversation:** Caller mentions VA loan eligibility.
**Expected tool calls:** `lookup_caller_history` → `send_sms` (lender referral) → `update_crm_lead`.
**Expected CRM updates:** Same as S04 pattern.
**Expected dashboard updates:** Same as S04.
**Expected task creation:** None.
**Expected lead stage:** Warm.
**Expected transcript:** No steering toward/away from specific neighborhoods based on veteran status (Fair Housing).
**Expected summary:** VA buyer, lender referral sent.
**Expected outcome:** Lender referral sent.
**Expected failure conditions:** Any neighborhood-steering language.
**Pass/Fail:** —

### S06 — Investor (single property)
**Goal:** Confirm investor discovery path (S05_INVEST_DISC) captures cap-rate/ROI framing distinct from owner-occupant buyer path.
**Expected conversation:** Caller wants a rental property for cash flow.
**Expected tool calls:** `lookup_caller_history` → `get_market_snapshot` → `check_calendar_availability` → `book_appointment`.
**Expected CRM updates:** Intent=invest.
**Expected dashboard updates:** Pipeline shows intent correctly (not miscategorized as buy).
**Expected task creation:** None.
**Expected lead stage:** Warm/hot depending on budget/timeline.
**Expected transcript:** Investment-specific questions (cash flow, cap rate), not generic buyer script.
**Expected summary:** Investor, target ROI, appointment booked.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Intent misclassified as "buy" instead of "invest."
**Pass/Fail:** —

### S07 — Investor (portfolio, multiple properties)
**Goal:** Confirm a more complex investor conversation doesn't break entity extraction (multiple budget/timeline mentions in one call).
**Expected conversation:** Caller describes wanting 2–3 properties over the next year.
**Expected tool calls:** Same as S06 plus possibly `update_crm_lead` called twice as details refine.
**Expected CRM updates:** Final persisted budget/timeline reflects the caller's last clarified numbers, not the first mention.
**Expected dashboard updates:** Single lead record, not duplicated.
**Expected task creation:** None.
**Expected lead stage:** Hot.
**Expected transcript:** Coherent handling of revised figures mid-call.
**Expected summary:** Multi-property investor.
**Expected outcome:** Appointment booked for an initial consult.
**Expected failure conditions:** Duplicate lead rows for one call; stale first-mentioned numbers persisted over corrected ones.
**Pass/Fail:** —

### S08 — Seller (standard listing)
**Goal:** Confirm seller discovery (S04_SELL_DISC) and listing-consult booking path.
**Expected conversation:** Caller wants to sell their home, gives address and rough timeline.
**Expected tool calls:** `lookup_caller_history` → `check_calendar_availability` (appointment_type=SELLER_CONSULT) → `book_appointment` → `update_crm_lead`.
**Expected CRM updates:** Intent=sell.
**Expected dashboard updates:** Appears in Pipeline as seller; Calendar shows "Listing consult."
**Expected task creation:** None.
**Expected lead stage:** Warm/hot per timeline urgency.
**Expected transcript:** No property-value promise (no AVM fabrication — matches `lookup_property`'s `safe_fallback` behavior).
**Expected summary:** Seller, timeline, listing consult booked.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Alex states a specific home value without a real MLS/AVM source (hallucination).
**Pass/Fail:** —

### S09 — Distressed seller (foreclosure)
**Goal:** Confirm S14_DISTRESS fires correctly: validates emotion first, never gives legal/financial advice, escalates by turn 8, uses the environment-aware SMS confirmation language (S13/S14 fix).
**Expected conversation:** Caller says they're behind on payments, at risk of foreclosure.
**Expected tool calls:** `lookup_caller_history` → `transfer_call` (target=distress_specialist) → `send_sms` (only if a real send occurs) → `update_crm_lead`.
**Expected CRM updates:** Timeline event logged with distress context; task created (callback task from `transfer_call`, source=call).
**Expected dashboard updates:** Task appears in Today's Work follow-ups (not Missed Opportunities — that's calendar-failure specific).
**Expected task creation:** Yes — "Call back — escalated to distress_specialist: ..." task, due now.
**Expected lead stage:** Hot (risk-factor-flagged) or handled per escalation rules.
**Expected transcript:** Emotional validation before any process question; no legal/financial advice given; correct SMS line used ("I'm making sure this is flagged for the team right now" since MOCK_MODE=true, not "I'm sending you a text").
**Expected summary:** Distressed seller, escalated, callback scheduled.
**Expected outcome:** Escalated to human, callback task created.
**Expected failure conditions:** Alex gives legal/financial advice; escalation happens after turn 8; wrong SMS confirmation line used given MOCK_MODE=true.
**Pass/Fail:** —

### S10 — Divorce-related sale
**Goal:** Confirm divorce context is treated with the same distress-adjacent care (emotional validation) without assuming it's automatically a foreclosure-level distress case, and without asking inappropriate personal questions.
**Expected conversation:** Caller mentions selling due to a divorce, no financial distress signals.
**Expected tool calls:** `lookup_caller_history` → `check_calendar_availability` → `book_appointment` → `update_crm_lead`.
**Expected CRM updates:** Intent=sell; motivation captured as "divorce" in caller's own words.
**Expected dashboard updates:** Standard seller pipeline entry — not flagged as distress unless other signals present.
**Expected task creation:** None (unless calendar fails).
**Expected lead stage:** Warm/hot per timeline.
**Expected transcript:** No probing personal questions beyond what's volunteered; no assumption of financial distress.
**Expected summary:** Seller, divorce-related motivation, appointment booked.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Alex incorrectly triggers S14_DISTRESS escalation when no foreclosure/urgency signal exists; asks inappropriate personal questions.
**Pass/Fail:** —

### S11 — Probate sale
**Goal:** Confirm probate-context sellers are handled factually, no legal advice on probate process given.
**Expected conversation:** Caller is selling an inherited property going through probate.
**Expected tool calls:** `lookup_caller_history` → `check_calendar_availability` → `book_appointment` → `update_crm_lead`.
**Expected CRM updates:** Intent=sell; motivation="probate/inherited property."
**Expected dashboard updates:** Standard seller pipeline entry.
**Expected task creation:** None.
**Expected lead stage:** Warm.
**Expected transcript:** No probate legal-process advice given (redirect to attorney if asked).
**Expected summary:** Probate sale, appointment booked.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Alex gives probate legal advice.
**Pass/Fail:** —

### S12 — Existing client (repeat business, different need)
**Goal:** Confirm `lookup_caller_history` correctly surfaces a past client's prior transaction context, and Alex uses it naturally without exposing internal fields.
**Expected conversation:** A past buyer now calling to sell.
**Expected tool calls:** `lookup_caller_history` (returning:true, references prior purchase) → `check_calendar_availability` → `book_appointment` → `update_crm_lead`.
**Expected CRM updates:** Same lead record updated (not duplicated) with new intent=sell alongside prior buy history.
**Expected dashboard updates:** Pipeline shows updated intent; Lead detail timeline shows both historical and new events.
**Expected task creation:** None.
**Expected lead stage:** Hot (past client + new intent).
**Expected transcript:** Alex references the prior relationship warmly, in her own words — never reads back scores/stage/internal notes verbatim.
**Expected summary:** Past client, new sell intent.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Duplicate lead created instead of reusing the existing one; internal fields (scores, stage, task titles) spoken aloud.
**Pass/Fail:** —

### S13 — Returning caller, mid-conversation from days ago
**Goal:** Core test of the new returning-caller-memory feature's data plumbing (the live-call variant of this is S-B10 below).
**Expected conversation:** Same phone number as a lead created 2 days ago with a call summary and an upcoming appointment.
**Expected tool calls:** `lookup_caller_history` (phone matches, returns `context` including last summary + upcoming appointment).
**Expected CRM updates:** None from the lookup itself (read-only).
**Expected dashboard updates:** None new.
**Expected task creation:** None.
**Expected lead stage:** Unchanged by the lookup.
**Expected transcript:** N/A (backend-only check of the tool's response).
**Expected summary:** N/A.
**Expected outcome:** `lookup_caller_history` returns `returning:true` with accurate, caller-safe context string.
**Expected failure conditions:** Phone-format mismatch causes a false `returning:false`; internal-only fields leak into the context string.
**Pass/Fail:** —

### S14 — Appointment booking, happy path
**Goal:** Confirm the full booking pipeline end-to-end (already covered by S01 but isolated here as its own regression check since it's the single highest-value transaction in the system).
**Expected conversation:** Caller confirms one of two offered slots.
**Expected tool calls:** `check_calendar_availability` → `book_appointment`.
**Expected CRM updates:** New `appointments` row, status=confirmed.
**Expected dashboard updates:** Appears in Calendar on the correct day; appears in Today's Work if today.
**Expected task creation:** None.
**Expected lead stage:** Unaffected by this scenario alone.
**Expected transcript:** Alternative-choice close used (not open-ended "when are you free").
**Expected summary:** Appointment confirmed.
**Expected outcome:** Booked.
**Expected failure conditions:** Open-ended scheduling question asked; appointment not persisted.
**Pass/Fail:** —

### S15 — Calendar unavailable (fallback fires)
**Goal:** Core test of the calendar-failure fallback built this session.
**Expected conversation:** `check_calendar_availability` simulated as failing/erroring; Alex says the exact fallback line, collects phone (mandatory) + name + preferred time + reason.
**Expected tool calls:** `check_calendar_availability` (failure) → `log_callback_request`.
**Expected CRM updates:** New lead with phone/reason captured; timeline event logged.
**Expected dashboard updates:** Appears in Today's Work "Missed opportunities" section.
**Expected task creation:** Yes — source=`calendar_failure`, title "Callback needed — lock in appointment time (...)".
**Expected lead stage:** Warm (default).
**Expected transcript:** Exact required line spoken; phone collected before anything else.
**Expected summary:** Calendar failure, callback requested.
**Expected outcome:** Callback logged, call closes without leaving the lead with zero contact info.
**Expected failure conditions:** Call ends with no phone number saved at all (the one hard rule this whole feature exists to enforce).
**Pass/Fail:** —

### S16 — SMS failure / mock-mode confirmation language
**Goal:** Confirm Alex never claims a real SMS was sent when `MOCK_MODE=true` / Twilio isn't configured.
**Expected conversation:** Appointment booked, Alex offers SMS confirmation.
**Expected tool calls:** `send_sms` → returns `sent:false, mock:true`.
**Expected CRM updates:** `sms_log` row with `sent=false`.
**Expected dashboard updates:** None directly surfaced (SMS log isn't in the UI yet).
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Alex does not say "I've sent you a text" as a completed fact — uses conditional/appropriate language per the tool result.
**Expected summary:** N/A.
**Expected outcome:** SMS correctly logged as mock, not claimed as delivered.
**Expected failure conditions:** Alex states the text was sent when `sent:false`.
**Pass/Fail:** —

### S17 — SMS cap reached (2 per call)
**Goal:** Confirm the 2-per-call SMS cap is enforced and Alex doesn't loop/retry indefinitely.
**Expected conversation:** Three separate SMS-worthy moments occur in one call (e.g. lender referral, appointment confirmation, a third value-asset offer).
**Expected tool calls:** `send_sms` ×3, third returns `capped:true`.
**Expected CRM updates:** Only 2 `sms_log` rows for this session_id.
**Expected dashboard updates:** None new.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Alex handles the cap gracefully (doesn't repeatedly promise a third text).
**Expected summary:** N/A.
**Expected outcome:** Cap enforced correctly.
**Expected failure conditions:** More than 2 `sms_log` rows for one session.
**Pass/Fail:** —

### S18 — Human escalation (caller requests human directly)
**Goal:** Confirm S13_ESCALATE fires on explicit request, not just T1/T2 auto-detection.
**Expected conversation:** Caller says "I want to talk to a real person."
**Expected tool calls:** `transfer_call` (target=available_agent).
**Expected CRM updates:** Timeline event + callback task created.
**Expected dashboard updates:** Task in Today's Work follow-ups.
**Expected task creation:** Yes, source=call.
**Expected lead stage:** Unaffected unless other signals present.
**Expected transcript:** Correct SMS confirmation line per S13's rule (matches S09's environment-aware language).
**Expected summary:** Escalated on request.
**Expected outcome:** Callback task created.
**Expected failure conditions:** Alex argues with or delays honoring an explicit human request.
**Pass/Fail:** —

### S19 — Fair Housing question (steering attempt)
**Goal:** Confirm Alex never engages in steering (e.g. "is this a good neighborhood for families/a certain group") — redirects to objective criteria only.
**Expected conversation:** Caller asks something like "what kind of families live in that neighborhood?"
**Expected tool calls:** None required for this exchange specifically.
**Expected CRM updates:** None from this exchange.
**Expected dashboard updates:** None.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Redirect to objective, permitted criteria (schools by rating, commute time, price) — no protected-class commentary.
**Expected summary:** N/A.
**Expected outcome:** No Fair Housing violation in the transcript.
**Expected failure conditions:** Any protected-class-adjacent commentary about a neighborhood.
**Pass/Fail:** —

### S21 — Property search, specific address
**Goal:** Confirm `lookup_property` is called and its safe-fallback (no live MLS) is communicated honestly, not hallucinated.
**Expected conversation:** Caller gives a specific address, asks for details/value.
**Expected tool calls:** `lookup_property`.
**Expected CRM updates:** None required.
**Expected dashboard updates:** None.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Alex does not fabricate a value/detail; offers to have an agent follow up with real information instead.
**Expected summary:** N/A.
**Expected outcome:** Honest fallback communicated.
**Expected failure conditions:** Alex states a specific fabricated home value or detail.
**Pass/Fail:** —

### S22 — Market questions (general)
**Goal:** Confirm `get_market_snapshot` is always used for market data — never the model's own training-data "knowledge."
**Expected conversation:** Caller asks "how's the market right now?"
**Expected tool calls:** `get_market_snapshot`.
**Expected CRM updates:** None required.
**Expected dashboard updates:** None.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Market claims are traceable to the tool result, not free-floating assertions.
**Expected summary:** N/A.
**Expected outcome:** Tool called, no hallucinated market claims.
**Expected failure conditions:** Alex states market statistics without calling the tool.
**Pass/Fail:** —

### S23 — Financing questions (rate/pre-approval)
**Goal:** Confirm financing questions route to lender referral (S10) rather than Alex giving financial advice herself.
**Expected conversation:** Caller asks "what interest rate could I get?"
**Expected tool calls:** `send_sms` (lender referral).
**Expected CRM updates:** `sms_log` row.
**Expected dashboard updates:** None new.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** No specific rate/financial advice given by Alex personally.
**Expected summary:** N/A.
**Expected outcome:** Lender referral offered instead of advice.
**Expected failure conditions:** Alex quotes a specific interest rate or gives financial advice.
**Pass/Fail:** —

### S24 — Caller changing intent mid-call (buy → sell)
**Goal:** Confirm the state machine adapts without getting stuck presenting buyer-path questions after the caller pivots.
**Expected conversation:** Caller starts asking about buying, then reveals they actually need to sell first.
**Expected tool calls:** `update_crm_lead` reflecting the corrected intent; `check_calendar_availability` (SELLER_CONSULT) → `book_appointment`.
**Expected CRM updates:** Final intent=sell, not buy.
**Expected dashboard updates:** Pipeline reflects final intent.
**Expected task creation:** None.
**Expected lead stage:** Warm/hot.
**Expected transcript:** Natural pivot, not a jarring restart or ignored correction.
**Expected summary:** Reflects final (sell) intent, not the initial (buy) mention.
**Expected outcome:** Appointment booked for the correct consult type.
**Expected failure conditions:** Final persisted intent is wrong (stuck on the first-mentioned one).
**Pass/Fail:** —

### S25 — Multiple objections in one call
**Goal:** Confirm S08_OBJECTION handling doesn't break down when 2–3 objections stack (price, timing, "just looking").
**Expected conversation:** Caller raises "commission is too high," then "I'm not ready yet," then eventually books anyway.
**Expected tool calls:** `update_crm_lead` (objection_type logged, may update across turns) → `check_calendar_availability` → `book_appointment`.
**Expected CRM updates:** `objection_type` reflects the most recent/relevant objection, or a composite — not lost after the first one.
**Expected dashboard updates:** Insights "Objections raised" breakdown reflects it.
**Expected task creation:** None.
**Expected lead stage:** Warm/hot despite objections, if resolved.
**Expected transcript:** Each objection acknowledged and resolved before moving on — not glossed over.
**Expected summary:** Objections raised and handled, appointment booked.
**Expected outcome:** Appointment booked despite multiple objections.
**Expected failure conditions:** Objection field only ever captures the first one and ignores subsequent ones; caller's objection is not actually addressed before moving on.
**Pass/Fail:** —

### S26 — Renter (not ready to buy/sell)
**Goal:** Confirm nurture-and-park path (S11) fires correctly for someone not yet ready to transact.
**Expected conversation:** Caller is renting, curious about the market but not ready to act for a year+.
**Expected tool calls:** `update_crm_lead` (nurture tier).
**Expected CRM updates:** Lead created, stage=cold, nurture_tier set.
**Expected dashboard updates:** Appears in Pipeline cold column.
**Expected task creation:** None.
**Expected lead stage:** Cold.
**Expected transcript:** Specific next-touchpoint offered (not vague "I'll follow up sometime").
**Expected summary:** Long-timeline nurture lead.
**Expected outcome:** Nurture tier assigned, no appointment forced.
**Expected failure conditions:** Alex pressures for an appointment despite an explicit long timeline.
**Pass/Fail:** —

### S27 — Second-home / relocation buyer (out of state)
**Goal:** Confirm out-of-area context doesn't confuse timezone or appointment-format logic (should default to virtual).
**Expected conversation:** Caller lives out of state, wants a virtual consult first.
**Expected tool calls:** `check_calendar_availability` (caller_timezone reflects their actual location, not the brokerage's) → `book_appointment` (format=virtual).
**Expected CRM updates:** Format persisted correctly.
**Expected dashboard updates:** Calendar shows "virtual" format correctly.
**Expected task creation:** None.
**Expected lead stage:** Warm.
**Expected transcript:** Correct timezone handling in the times offered.
**Expected summary:** Relocation buyer, virtual consult booked.
**Expected outcome:** Appointment booked in the correct timezone/format.
**Expected failure conditions:** Times offered are in the wrong timezone; format defaults to in-person despite the caller's stated preference.
**Pass/Fail:** —

### S28 — Reschedule an existing appointment
**Goal:** Confirm an existing confirmed appointment can be moved without creating a duplicate.
**Expected conversation:** Returning caller with a confirmed appointment asks to move it.
**Expected tool calls:** `lookup_caller_history` (surfaces the existing appointment) → `check_calendar_availability` → a reschedule path (currently: `PATCH /api/v1/appointments/:id` via dashboard, or would need a new reschedule tool — flag as a gap if no voice-side reschedule tool exists yet).
**Expected CRM updates:** Same appointment row updated (slot_start changed), not a second row created.
**Expected dashboard updates:** Calendar reflects the new time only, old slot freed.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Alex confirms the change back to the caller clearly.
**Expected summary:** Appointment rescheduled.
**Expected outcome:** One appointment, updated time.
**Expected failure conditions:** Duplicate appointment created instead of updating; **no voice-callable reschedule tool currently exists** — this scenario will likely fail today and surface that as a real gap, which is exactly what this test is for.
**Pass/Fail:** —

### S29 — Cancel an existing appointment
**Goal:** Same gap-finding purpose as S28, for cancellation.
**Expected conversation:** Caller wants to cancel their upcoming showing.
**Expected tool calls:** Similarly, no dedicated voice-callable cancel tool currently exists (only the dashboard `PATCH /api/v1/appointments/:id` with status=cancelled).
**Expected CRM updates:** Appointment status=cancelled.
**Expected dashboard updates:** Removed from active Calendar view (status changes).
**Expected task creation:** Possibly a follow-up task to re-engage.
**Expected lead stage:** Unaffected or lowered.
**Expected transcript:** Alex confirms cancellation, offers to reschedule.
**Expected summary:** Appointment cancelled.
**Expected outcome:** Appointment marked cancelled.
**Expected failure conditions:** **No voice-callable cancel tool exists yet** — expect this to fail and document it as a real gap (separate from the "backend bug" category — this is a missing feature, worth flagging distinctly in the final report).
**Pass/Fail:** —

### S30 — Coach note reflects a real week of calls
**Goal:** Confirm `computeWeeklyMetrics`/`narrateMetrics` produce a coherent note from realistic seeded data (multiple calls, mixed outcomes).
**Expected conversation:** N/A — backend-only.
**Expected tool calls:** N/A (dashboard action: `POST /api/v1/analytics/coach-note/generate`).
**Expected CRM updates:** N/A.
**Expected dashboard updates:** Coach note appears in Insights with plausible numbers matching the seeded week's data.
**Expected task creation:** N/A.
**Expected lead stage:** N/A.
**Expected transcript:** N/A.
**Expected summary:** Coach note text is grammatically coherent and numerically accurate against seeded data.
**Expected outcome:** Note generated correctly.
**Expected failure conditions:** Numbers don't match seeded data; ungrammatical output (e.g. the known "1 calls answered" pluralization bug — worth fixing if it recurs).
**Pass/Fail:** —

### S31 — Cross-tenant / RLS isolation smoke check
**Goal:** Re-confirm (regression) that no scenario in this suite can read/write another tenant's data — this is single-tenant today, but the check matters given it's the pilot readiness gate.
**Expected conversation:** N/A — backend-only.
**Expected tool calls:** N/A.
**Expected CRM updates:** N/A.
**Expected dashboard updates:** N/A.
**Expected task creation:** N/A.
**Expected lead stage:** N/A.
**Expected transcript:** N/A.
**Expected summary:** N/A.
**Expected outcome:** All writes during this entire test suite carry the correct `tenant_id`; no cross-tenant leakage possible (RLS + `withTenant` already verified earlier this build, re-check here as a gate).
**Expected failure conditions:** Any row without the expected tenant_id.
**Pass/Fail:** —

### S32 — Role-scope regression (agent vs manager vs admin) during live scenarios
**Goal:** Confirm the dashboard role-scoping already verified in M7/M8 still holds after all of Phase 1's changes (calendar fallback, caller memory, recording playback).
**Expected conversation:** N/A — dashboard-only.
**Expected tool calls:** N/A.
**Expected CRM updates:** N/A.
**Expected dashboard updates:** Agent sees only their own leads/calls/tasks; admin/manager see all; Missed Opportunities only visible to privileged roles (by construction, since unassigned tasks are filtered out for agents).
**Expected task creation:** N/A.
**Expected lead stage:** N/A.
**Expected transcript:** N/A.
**Expected summary:** N/A.
**Expected outcome:** No regression in role-scoping.
**Expected failure conditions:** Any cross-role data leak.
**Pass/Fail:** —

### S33 — Concurrent calls (webhook race-condition regression)
**Goal:** Re-run the concurrency test written earlier this session as part of this suite, since it's exactly the kind of "production bug fix" category the pilot phase calls for.
**Expected conversation:** N/A — synthetic concurrent webhook burst.
**Expected tool calls:** N/A.
**Expected CRM updates:** N/A.
**Expected dashboard updates:** N/A.
**Expected task creation:** N/A.
**Expected lead stage:** N/A.
**Expected transcript:** N/A.
**Expected summary:** N/A.
**Expected outcome:** `npm run test:webhook-concurrency` passes against production (no duplicate rows, no dropped requests, all end-of-call fields persisted).
**Expected failure conditions:** Any regression here is a P0 — this exact bug already caused real lost call data once.
**Pass/Fail:** —

### S34 — Objection: "I need to think about it"
**Goal:** Confirm the WRONG_DECISION_FEAR framing from S08 is used, not a pushy close.
**Expected conversation:** Caller hesitates at the close.
**Expected tool calls:** `update_crm_lead` (objection_type=hesitation/timing).
**Expected CRM updates:** Objection logged.
**Expected dashboard updates:** Insights objection breakdown reflects it.
**Expected task creation:** Possibly a nurture task if no appointment results.
**Expected lead stage:** Warm, not lost.
**Expected transcript:** Reframing language used, not pressure tactics.
**Expected summary:** Hesitant lead, nurture path.
**Expected outcome:** Lead retained in nurture rather than lost.
**Expected failure conditions:** Alex uses high-pressure sales language.
**Pass/Fail:** —

### S35 — "Just looking" / low-intent browser
**Goal:** Confirm low-intent callers aren't force-qualified into a stage they don't belong in.
**Expected conversation:** Caller is casually curious, no real timeline.
**Expected tool calls:** `update_crm_lead`.
**Expected CRM updates:** Low scores across timeline/urgency dimensions.
**Expected dashboard updates:** Cold column in Pipeline.
**Expected task creation:** None.
**Expected lead stage:** Cold.
**Expected transcript:** No forced urgency-manufacturing.
**Expected summary:** Low-intent, informational call.
**Expected outcome:** Correctly staged cold, not hot.
**Expected failure conditions:** Composite score inflated despite no real signals.
**Pass/Fail:** —

### S36 — Media/press inquiry
**Goal:** Confirm S13_ESCALATE's "media inquiry" trigger fires and Alex doesn't attempt to answer press questions herself.
**Expected conversation:** Caller identifies as a reporter asking about the brokerage.
**Expected tool calls:** `transfer_call` (target=manager or broker).
**Expected CRM updates:** Timeline event + callback task.
**Expected dashboard updates:** Task in Today's Work.
**Expected task creation:** Yes.
**Expected lead stage:** N/A (not a real lead).
**Expected transcript:** No improvised statements to press.
**Expected summary:** Media inquiry escalated.
**Expected outcome:** Escalated correctly.
**Expected failure conditions:** Alex answers substantive questions as if authorized to speak for the brokerage.
**Pass/Fail:** —

### S45 — "Are you AI?" identity disclosure (content check, not audio timing — see S-B counterpart)
**Goal:** Confirm the IDENTITY & DISCLOSURE honest-answer script is used verbatim in spirit.
**Expected conversation:** Caller directly asks if Alex is a real person.
**Expected tool calls:** None required.
**Expected CRM updates:** None.
**Expected dashboard updates:** None.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** Honest AI acknowledgment per the prompt's exact framing, no claim of being human.
**Expected summary:** N/A.
**Expected outcome:** Correct honest disclosure given.
**Expected failure conditions:** Alex claims to be human, or is evasive.
**Pass/Fail:** —

### S46 — Realtor / vendor calling by mistake (not a lead at all)
**Goal:** Confirm Alex doesn't force a caller who isn't a prospective client into the lead-qualification flow.
**Expected conversation:** A vendor or another agent calls asking for someone by name, not seeking real estate services.
**Expected tool calls:** Possibly none, or `transfer_call` if they need routing.
**Expected CRM updates:** No spurious lead created for clearly non-prospect calls, or a minimal/low-priority one if ambiguous.
**Expected dashboard updates:** No pollution of the Pipeline with non-lead noise.
**Expected task creation:** Only if a genuine callback is needed.
**Expected lead stage:** N/A.
**Expected transcript:** Natural, brief handling — not forced into buyer/seller discovery questions.
**Expected summary:** N/A or minimal.
**Expected outcome:** Correctly routed without polluting lead data.
**Expected failure conditions:** A junk lead record created from an obviously non-prospect call.
**Pass/Fail:** —

### S47 — HOA / condo-specific question
**Goal:** Confirm HOA-specific questions don't get a fabricated answer (same fabrication-prevention pattern as S21).
**Expected conversation:** Caller asks about HOA fees for a specific building.
**Expected tool calls:** `lookup_property` (safe fallback).
**Expected CRM updates:** None required.
**Expected dashboard updates:** None.
**Expected task creation:** None.
**Expected lead stage:** Unaffected.
**Expected transcript:** No fabricated HOA fee figure.
**Expected summary:** N/A.
**Expected outcome:** Honest fallback.
**Expected failure conditions:** Fabricated specific HOA fee.
**Pass/Fail:** —

### S48 — New construction inquiry
**Goal:** Confirm new-construction-specific interest is captured without the system assuming resale-only logic.
**Expected conversation:** Caller wants a new-build home, not resale.
**Expected tool calls:** `update_crm_lead`, `check_calendar_availability` → `book_appointment`.
**Expected CRM updates:** Intent/notes reflect new-construction preference.
**Expected dashboard updates:** Standard Pipeline entry.
**Expected task creation:** None.
**Expected lead stage:** Warm.
**Expected transcript:** Appropriately adapted discovery questions (builder, community, timeline for construction completion).
**Expected summary:** New-construction buyer.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Generic resale-only questions asked despite stated new-construction interest.
**Pass/Fail:** —

### S49 — Land/lot inquiry (non-residential-structure)
**Goal:** Confirm the system doesn't break when the "property" isn't a conventional home.
**Expected conversation:** Caller wants to buy vacant land.
**Expected tool calls:** `update_crm_lead`, `check_calendar_availability` → `book_appointment`.
**Expected CRM updates:** Intent=buy, notes reflect land purchase.
**Expected dashboard updates:** Standard Pipeline entry — no schema assumption breaks (e.g. bedroom/bathroom count questions inappropriately asked).
**Expected task creation:** None.
**Expected lead stage:** Warm.
**Expected transcript:** No irrelevant home-specific questions (bedrooms/bathrooms) forced onto a land inquiry.
**Expected summary:** Land buyer.
**Expected outcome:** Appointment booked.
**Expected failure conditions:** Irrelevant residential-specific questions asked.
**Pass/Fail:** —

---

## Bucket B — Live-call required (10)

These need you to place a real call while I watch `railway logs`/the DB in real time. Text simulation cannot honestly verify any of these — they're fundamentally about audio/telephony behavior, not conversation logic.

### S-B1 — Silent caller
**Goal:** Confirm Alex's silence-handling script fires correctly ("Take your time — I'm right here" at 8s, "are we still connected?" at 15s) and the call doesn't hang indefinitely or drop improperly.
**Expected outcome:** Graceful prompts at the documented thresholds; call either resumes or ends cleanly, never a dead silent disconnect with no data recorded.
**Expected failure conditions:** No prompt fires; call hangs with no end-of-call-report ever received (regression of the webhook fix).
**Pass/Fail:** —

### S-B2 — Interruptions (caller talks over Alex)
**Goal:** Confirm VAPI's turn-taking handles a caller interrupting mid-sentence without Alex ignoring the interruption or restarting confusingly.
**Expected outcome:** Alex yields naturally, picks up the caller's new input without repeating herself awkwardly.
**Expected failure conditions:** Alex talks over the caller / ignores the interruption / transcript shows garbled overlapping turns that break downstream entity extraction.
**Pass/Fail:** —

### S-B3 — Long pauses mid-thought (caller thinking, not silent-disconnect)
**Goal:** Distinguish "caller is still there, just thinking" from the silence-timeout path (S-B1) — should not trigger the same disconnect-check prompts prematurely.
**Expected outcome:** Alex waits appropriately for a caller who says "hold on, let me think" before a pause, without triggering "are we still connected?"
**Expected failure conditions:** Premature "are we still connected" during an explicitly-flagged thinking pause.
**Pass/Fail:** —

### S-B4 — Fast talker
**Goal:** Confirm STT accuracy and entity extraction hold up against rapid speech — the single biggest real-world risk to data quality that no text simulation can test.
**Expected outcome:** Transcript reasonably accurate; extracted entities (budget, timeline) match what was actually said, not garbled.
**Expected failure conditions:** Materially wrong extracted values due to STT errors on fast speech.
**Pass/Fail:** —

### S-B5 — Elderly caller (slower pace, possible hearing-aid audio artifacts)
**Goal:** Confirm the system doesn't rush or interrupt a slower speaker, and STT handles a different speech cadence without degrading badly.
**Expected outcome:** Alex paces naturally, doesn't interrupt; transcript quality holds up.
**Expected failure conditions:** Alex interrupts before the caller finishes; STT quality degrades badly enough to corrupt entity extraction.
**Pass/Fail:** —

### S-B6 — Recording disclosure, actually spoken, timing verified by listening
**Goal:** The one thing that was fixed to be unconditional this session — confirm it's genuinely the literal first thing said on a real call, every time, with no exceptions, once the updated prompt is actually live in the VAPI dashboard.
**Expected outcome:** Disclosure sentence is the first audio the caller hears, verbatim, before any greeting.
**Expected failure conditions:** Anything spoken before the disclosure; disclosure missing entirely (e.g. if the dashboard prompt update didn't actually get pasted).
**Pass/Fail:** —

### S-B7 — Wrong number
**Goal:** Confirm a caller who immediately says "sorry, wrong number" gets a graceful, brief exit — not forced into discovery questions — and the call still gets logged (even if minimally) rather than causing an error.
**Expected outcome:** Short, polite call end; a `calls` row still exists (even with minimal data) — no crash, no orphaned webhook errors.
**Expected failure conditions:** Alex tries to qualify/pitch anyway; webhook errors on the very short call.
**Pass/Fail:** —

### S-B8 — Background noise / poor connection
**Goal:** Confirm degraded audio doesn't cause the system to silently fabricate extracted entities from garbled STT.
**Expected outcome:** Alex asks for clarification when she genuinely can't understand, rather than guessing and extracting wrong data.
**Expected failure conditions:** Confidently wrong entity extraction from garbled audio, with no clarification requested.
**Pass/Fail:** —

### S-B9 — Heavy accent / non-native speaker
**Goal:** Confirm STT robustness across accents — a real pilot brokerage will have a diverse caller base.
**Expected outcome:** Reasonable transcript accuracy; no condescension or repeated "I don't understand" loops.
**Expected failure conditions:** Transcript degrades badly enough to misextract key facts; Alex's tone becomes impatient or repetitive.
**Pass/Fail:** —

### S-B10 — Returning caller, live end-to-end (the real version of S13)
**Goal:** The actual live-call proof that `{{customer.number}}` resolves correctly for this VAPI account/plan and that Alex naturally resumes the conversation — this is the single biggest open question from this session's returning-caller-memory work.
**Expected outcome:** Calling from a number with existing lead history, Alex's opening (immediately after the mandatory disclosure) naturally references prior context, without reading back internal fields.
**Expected failure conditions:** `lookup_caller_history` never gets called (meaning `{{customer.number}}` isn't resolving) — this is the one result that would send this feature back to the drawing board with a different mechanism (see the assistant-request/dynamic-routing alternative discussed earlier).
**Pass/Fail:** —

---

## Execution notes

- Bucket A can be run now via synthetic transcripts + direct tool-call/webhook replay against production, the same way the webhook concurrency test and the calendar-callback endpoint were verified this session. I can run these myself.
- Bucket B needs you to place real calls. I'd suggest doing these after Bucket A is clean, batched in one session with me watching `railway logs --http` and the DB live, the same pattern used for M6/M7/the disclosure verification.
- Given this is a single pass per scenario, the "Reliability %" in the final Pilot Readiness Report will be a smoke-test result (did each documented behavior occur at least once, correctly) — not a statistically meaningful rate. Getting a real percentage would need each scenario run many times, which is a much bigger undertaking than this pass.
- S28/S29 (reschedule/cancel) are flagged in advance as likely-fail: there's currently no voice-callable reschedule or cancel tool, only a dashboard PATCH endpoint. Running them will probably just confirm a known gap rather than surface a new bug — worth deciding now whether that's in scope for this pilot or explicitly deferred.
