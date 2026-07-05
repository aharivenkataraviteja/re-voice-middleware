# RE-VOICE / Switchboard — Final Production Smoke Test Plan

Status: **NOT approved for execution.** This is the checklist only, per instruction. Do not run any deploy or destructive command until explicit go-ahead is given for each phase.

## Changelog since last version

All three previously-identified blockers are now fixed and verified **locally** (not yet deployed):

1. **Frontend static serving** — `src/index.ts` now serves `web/dist` and falls back to `index.html` for client-side routes, mounted after every `/api`, `/tools`, `/vapi`, `/health` route so none of those are shadowed. `package.json`'s `build` script now also builds the frontend (`build:web`). Verified locally: built with `npm run build` (backend + frontend in one command), ran with `npm start` on port 8089 (no Vite dev server involved), and confirmed in a real browser — `/today` direct-loads the SPA, login works, client-side nav between Today's Work/Pipeline/Calendar/Insights works via history API (no reload), `/health` and `/api/v1/*` still return JSON correctly, unknown `/api/*` paths still 404 as JSON, static assets serve with correct content-type, no console errors.
2. **Recording disclosure** — `vapi_system_prompt.md` and `agent_config.json` (kept in sync) now make disclosure **unconditional**: the mandatory first sentence of every call, with no dependency on a "middleware will flag this" mechanism that never existed in code. Old conditional bullet in S01_GREET removed; IDENTITY & DISCLOSURE section now states the exact required opening line. This aligns with the project's own original `compliance_rules.json` design philosophy (`default_if_unknown: "disclose"` — when in doubt, disclose to everyone, which is always legally safe even in one-party-consent states).
3. **SMS mock labeling** — `MOCK_MODE` stays `true` (confirmed, no change to Railway env). `src/routes/tools/sms.ts` log line now reads `MOCK — no real SMS sent (<reason>)` instead of the old ambiguous `logged (mock/no Twilio)`. Added a boot-time log line in `src/index.ts` stating plainly whether SMS sends are real or mock and why. The API response already had accurate `sent`/`mock` fields — unchanged. There is currently no SMS status surfaced anywhere in the dashboard UI, so there was nothing there to mislabel; noting that explicitly rather than silently.

**Known open item, not yet fixed (flagging, not deciding for you):** the live VAPI prompt text in S13_ESCALATE/S14_DISTRESS has Alex tell real callers "I'm sending you a text right now to confirm." With `MOCK_MODE=true` and no Twilio credentials configured, no real text goes out — meaning a real caller may currently be told something that doesn't happen. This wasn't in the original three blockers, but it's the same root issue as blocker 3 and worth a decision before go-live.

**Still outstanding, not addressed by these fixes:** there is no VAPI API key in this environment (`.env` only has `VAPI_TOOL_SECRET`/`VAPI_WEBHOOK_SECRET`), so I cannot pull the actually-deployed VAPI assistant prompt to confirm the live assistant matches the updated `vapi_system_prompt.md`/`agent_config.json`. That requires either you pasting the updated prompt into the VAPI dashboard yourself, or giving me a VAPI API key to verify via their REST API. §13 below reflects this.

All test data created during local verification (temp lead/call/sms_log rows) has been cleaned up — tenant is back to 0 leads/calls/appointments/tasks/sms_log/coach_notes, 1 real admin user.

---

## 1. Exact commands to push and deploy

Nothing outstanding to build first — both fixes are already in the working tree, verified locally, not yet committed/pushed.

```bash
cd "middleware"
git status                            # review: package.json, src/index.ts, src/routes/tools/sms.ts modified;
                                       # PRODUCTION_SMOKE_TEST_PLAN.md new
git diff -- package.json src/index.ts src/routes/tools/sms.ts | grep -iE "password|secret|token|api[_-]?key|BEGIN (RSA|PRIVATE)"
                                       # must return nothing before committing
git add package.json src/index.ts src/routes/tools/sms.ts PRODUCTION_SMOKE_TEST_PLAN.md
git commit -m "M8: serve frontend from Express, unconditional recording disclosure, clearer SMS mock labeling"
git log origin/main..HEAD --oneline   # will be 3 commits ahead after this: M6, M7, this one
git push origin main

railway status                        # confirm linked to project re-voice-middleware / environment production
railway up                            # builds via Nixpacks: npm run build now builds backend + frontend together
railway deployment list --json        # capture the new deployment ID for the rollback plan below
railway logs --deployment             # tail build logs until healthcheck passes
```

Confirm the new deployment is live and healthy:
```bash
curl -sS https://re-voice-middleware-production.up.railway.app/health
# expect: {"status":"ok","mode":"mock","time":"..."}  <-- "mode":"mock" is now the CONFIRMED intended state (§2), not a gap

curl -sS -o /dev/null -w "HTTP %{http_code}  content-type: %{content_type}\n" \
  https://re-voice-middleware-production.up.railway.app/today
# expect: HTTP 200, content-type: text/html — confirms static+SPA fallback works in prod, not just locally

curl -sS -o /dev/null -w "HTTP %{http_code}  content-type: %{content_type}\n" \
  https://re-voice-middleware-production.up.railway.app/api/v1/auth/me
# expect: HTTP 401, content-type: application/json — confirms API routes aren't shadowed by the SPA fallback in prod
```

---

## 2. Environment variables to verify

Run `railway variables --json` and confirm presence (not values) of:

| Variable | Currently set? | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | superuser — migrations only |
| `APP_DATABASE_URL` | ✅ | `app_runtime` non-superuser role — RLS depends on this being used for all app queries |
| `JWT_PRIVATE_KEY_B64` / `JWT_PUBLIC_KEY_B64` | ✅ | RS256 keypair |
| `VAPI_TOOL_SECRET` | ✅ | checked via `x-vapi-secret` header |
| `VAPI_WEBHOOK_SECRET` | ✅ | same mechanism, webhook route |
| `TENANT_ID` | ✅ | single-tenant v1; must match the seeded Luxury Partners Realty tenant row |
| `NODE_ENV` | ✅ = `production` | gates CORS (`origin: false` in prod) |
| `MOCK_MODE` | ✅ = `true` — **decision confirmed, this is intentional for the demo release**, not a gap to close | Affects SMS send gating and the calendar tool's mock branch. Boot log and per-request log now both say so explicitly (§12). |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | ❌ not set, **intentionally** | SMS will not actually send. This is expected and now clearly logged both at boot and per-send — see §12. |

No secret values should be printed to terminal or logs during this check — variable **names** only.

---

## 3. Auth test

```bash
# Login
curl -sS -X POST https://<prod-domain>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<admin-password>"}' -w "\n%{http_code}\n"
# expect 200 + {accessToken, role: "admin"} + Set-Cookie for refresh token (httpOnly, Secure, SameSite=Strict, path=/api/v1/auth)

# /me with the access token
curl -sS https://<prod-domain>/api/v1/auth/me -H "Authorization: Bearer <token>" -w "\n%{http_code}\n"
# expect 200 + {userId, tenantId, role, fullName}

# Wrong password
curl -sS -X POST https://<prod-domain>/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"wrong"}' -w "\n%{http_code}\n"
# expect 401

# Refresh (using the cookie jar from login)
curl -sS -X POST https://<prod-domain>/api/v1/auth/refresh -b cookies.txt -w "\n%{http_code}\n"
# expect 200 + new accessToken

# Logout, then confirm refresh now fails
curl -sS -X POST https://<prod-domain>/api/v1/auth/logout -b cookies.txt
curl -sS -X POST https://<prod-domain>/api/v1/auth/refresh -b cookies.txt -w "\n%{http_code}\n"
# expect 401
```

---

## 4. VAPI webhook test

```bash
# Missing secret → rejected
curl -sS -X POST https://<prod-domain>/vapi/webhook -H "Content-Type: application/json" \
  -d '{"type":"call.started"}' -w "\n%{http_code}\n"
# expect 401 {"error":"missing signature or secret"}

# Wrong secret → rejected
curl -sS -X POST https://<prod-domain>/vapi/webhook -H "x-vapi-secret: wrong" \
  -H "Content-Type: application/json" -d '{"type":"call.started"}' -w "\n%{http_code}\n"
# expect 401 {"error":"invalid secret"}

# Correct secret → accepted
curl -sS -X POST https://<prod-domain>/vapi/webhook -H "x-vapi-secret: $VAPI_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" -d '{"type":"call.started","call":{"id":"smoke-test-call"}}' -w "\n%{http_code}\n"
# expect 200
```
Then, separately, place one real test call to the live VAPI number and confirm via `railway logs` that `[webhook] event=... call_id=...` lines appear for the real call, and that a row lands in `calls` for it.

---

## 5. Tool endpoint HMAC/secret test

Applies to all of: `/tools/property/lookup`, `/tools/market/snapshot`, `/tools/sms/send`, `/tools/crm/update`, `/tools/calendar/*`, `/tools/call/transfer`.

```bash
# No auth header → 401
curl -sS -X POST https://<prod-domain>/tools/property/lookup -H "Content-Type: application/json" -d '{}' -w "\n%{http_code}\n"

# Correct x-vapi-secret → 200 (primary path VAPI actually uses)
curl -sS -X POST https://<prod-domain>/tools/property/lookup \
  -H "x-vapi-secret: $VAPI_TOOL_SECRET" -H "Content-Type: application/json" -d '{}' -w "\n%{http_code}\n"

# HMAC signature fallback path — only if a call path is known to use x-vapi-signature instead
BODY='{}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$VAPI_TOOL_SECRET" | sed 's/^.* //')
curl -sS -X POST https://<prod-domain>/tools/property/lookup \
  -H "x-vapi-signature: sha256=$SIG" -H "Content-Type: application/json" -d "$BODY" -w "\n%{http_code}\n"
```
Confirm no secret value is echoed back in any response body or logged by `requestLogger` (redaction pattern in `src/lib/redact.ts` covers `secret|token|password|authorization|signature`).

---

## 6. Dashboard login test

Blocker fixed and locally verified — this is now runnable against production as originally intended.

- Navigate to `https://<prod-domain>/login` in a real browser.
- Log in as the real admin account.
- Confirm redirect to `/today`, correct name/role shown in the sidebar footer.
- Reload the page — confirm silent refresh keeps the session (access token is memory-only; refresh cookie should re-authenticate without a re-login prompt).
- Log out — confirm redirect to `/login` and that a subsequent direct navigation to `/today` bounces back to `/login`.
- Also confirm a **direct load** of `/pipeline`, `/calendar`, and `/insights` (paste URL directly, not click-through) each render correctly rather than 404ing — this specifically exercises the new SPA fallback route in production, not just client-side nav.

---

## 7. Today's Work test

- As admin: confirm dollar metrics row renders (marked "estimate"), hot leads ("Call immediately") section, today's appointments, overdue follow-ups.
- Mark a task "done" and "snoozed" — confirm optimistic UI removal from the overdue list and that it persists after a refresh.
- As a non-privileged (agent) account: confirm the dollar-metrics row does **not** render.

---

## 8. Pipeline test

- Confirm all 4 stage columns render (Hot/Warm/Cold/Past Clients) with correct counts.
- Click a lead card — confirm the detail panel opens with timeline, calls, appointments.
- As agent: confirm only leads assigned to them are actionable/visible per existing role rules; as admin: confirm all tenant leads appear.

---

## 9. Calendar test

- Confirm the 7-day agenda renders starting today, with "— Today" label on day one.
- Confirm appointment rows show time, type, format, lead name; admin/manager additionally see the assigned agent name.
- Click "Completed" / "No-show" / "Cancel" on a confirmed appointment — confirm the status chip updates and the action row disappears.
- As agent: confirm only their own appointments appear (not other agents').

---

## 10. Insights test

- As admin/manager: confirm stat tiles (total calls, appointments booked, avg call duration), pipeline breakdown, objections breakdown, and leaderboard all render with real numbers.
- Confirm AI Coach note section: generate (if none exists for the week), approve, regenerate — confirm the "Pending approval" / "Approved" chip updates correctly.
- Confirm "Recent calls & recordings" list renders with duration, sentiment, summary, and a working "Recording" link where `recordingUrl` is present.
- As agent: confirm the brokerage-wide analytics/leaderboard/coach-note sections are replaced with the "visible to managers and admins" message, and that the calls list is scoped to only their own leads.

---

## 11. Role-scope test

Run as all three roles (admin, manager, agent) against production, confirming 200/403 as expected:

| Endpoint | admin | manager | agent |
|---|---|---|---|
| `GET /api/v1/analytics/summary` | 200 | 200 | 403 |
| `GET /api/v1/analytics/leaderboard` | 200 | 200 | 403 |
| `GET /api/v1/analytics/coach-note` | 200 | 200 | 403 |
| `POST /api/v1/analytics/coach-note/generate` | 200 | 403 | 403 |
| `PATCH /api/v1/analytics/coach-note/:id/approve` | 200 | 403 | 403 |
| `GET /api/v1/calls` | all tenant calls | all tenant calls | own-lead calls only |
| `GET /api/v1/leads` | all | all | own-assigned only (existing rule) |
| `GET /api/v1/users` | 200 | 200 | 200 (regression check for the earlier cross-router bug — must NOT 403) |

Also re-confirm the specific bug class fixed earlier this build: a blanket, path-less `router.use(requireRole(...))` must never intercept a different router's route. Spot check by hitting `/api/v1/users` as an agent and confirming it is NOT rejected by `analyticsRouter`.

---

## 12. SMS cap test

```bash
SESSION=smoke-test-session-1
for i in 1 2 3; do
  curl -sS -X POST https://<prod-domain>/tools/sms/send \
    -H "x-vapi-secret: $VAPI_TOOL_SECRET" -H "Content-Type: application/json" \
    -d "{\"to\":\"+15550001111\",\"template_id\":\"test_template\",\"session_id\":\"$SESSION\"}"
  echo
done
```
Expected: call 1 and 2 return `{"queued":true,"sent":false,"mock":true,...}`; call 3 returns `{"queued":false,"capped":true,"mock":true}` (cap is `MAX_SMS_PER_CALL = 2`, enforced per `session_id` in `sms_log`).

Also confirm, via `railway logs`:
- At boot: `[sms] SMS sends are MOCK — no real message will be delivered (Twilio configured: false, MOCK_MODE: true).`
- Per send: `[sms.send] MOCK — no real SMS sent (no Twilio credentials configured) to=***-***-1111 template=test_template`

This is the fix from §"Changelog" — confirm no log line or response field could be misread as a real send having occurred.

Clean up the test session's `sms_log` row, plus the `leads`/`calls` rows `findOrCreateLeadForSession` creates for a new `session_id`, afterward — deleting `calls` before `leads` (FK order), as done during local verification.

---

## 13. Recording disclosure prompt check

`vapi_system_prompt.md` and `agent_config.json` now both read (IDENTITY & DISCLOSURE section):

> "Always open with exactly this as your first sentence: 'Hi, this is Alex, a virtual assistant with Luxury Partners Realty — this call may be recorded for quality and training purposes.'"

This is now unconditional — no "middleware will flag this" dependency remains in either file.

**This still requires a manual step before it's actually live**: there is no VAPI API key in this environment, so I could not push this prompt update to the live VAPI assistant or confirm the live one matches. Before this test can pass:
1. You (or someone with VAPI dashboard access) must paste the updated prompt from `vapi_system_prompt.md` into VAPI → Assistant `e97cb966-9cba-4449-908d-a6d9bbbcf5ef` → Model → System Prompt, replacing the old version.
2. Then place one real test call and confirm Alex's literal first sentence is the disclosure line above, verbatim, before any greeting or question — on every call, not conditionally.
3. If you'd rather I verify this programmatically, provide a VAPI API key and I'll fetch the live assistant config directly to diff against the local file instead of relying on a manual paste + listen.

---

## 14. Distressed fallback prompt check

Live-call check against `vapi_system_prompt.md` S14_DISTRESS. Place a real test call using distress language (e.g. "I'm behind on payments and might lose the house") and confirm:
- Disclosure (§13) still fires first, unconditionally, even in this emotionally charged path — no state should ever skip it.
- Alex validates emotion before asking any process question.
- Alex does not give legal/financial advice or promise outcomes.
- `transfer_call` tool fires (confirm via `railway logs` — look for `[call.transfer] target=... reason=...`).
- Since no live human-agent routing exists yet (`transfer.ts` always creates a callback task, never a real transfer), confirm Alex delivers the "no specialist available" fallback line in spirit: *"I'm going to flag your situation personally for our specialist... They will call you within two hours..."* and confirm a corresponding row appears in `tasks` (title starting `Call back — escalated to...`) and `timeline_events` for the resulting lead.
- Escalation happens by turn 8 maximum per the prompt's own rule — flag if it doesn't.
- **Open item from the Changelog above**: this line promises "I'm sending you a text right now to confirm." With `MOCK_MODE=true` and no Twilio configured, no real text will go out. Decide before this call whether that line should be softened for the demo (e.g. "I'm noting this for our team to follow up" instead of promising a text), or whether it's acceptable as-is for now since no live callers besides test calls are expected yet.

---

## 15. Rollback plan

Current known-good production deployment ID (pre-M7/M8): `e7875aba-1e8c-4938-a089-7fcac2a7bf6e` (status SUCCESS at last check — capture the new one's ID after this deploy for reference).

Primary rollback (deterministic, CLI-drivable):
```bash
cd middleware
git log --oneline -6              # confirm fcfde4e (M6) is the last known-good commit before M7/M8
git revert <new-commit-sha>..HEAD --no-edit   # or: git checkout fcfde4e -- . && git commit
git push origin main
railway up                        # redeploy from the reverted state
curl -sS https://<prod-domain>/health   # confirm healthy again
```

Secondary/faster rollback (if the Railway dashboard shows the prior deployment artifact is still redeployable):
- Railway dashboard → Deployments → select the prior SUCCESS deployment → "Redeploy". Note: `railway deployment list` shows most deployments prior to current as `REMOVED`; verify in the dashboard whether that specific build artifact is still available before relying on this path — if not, fall back to the git-revert method above.

Database: no destructive migrations are part of this deploy (frontend serving + prompt text + logging changes only), so no DB rollback step is expected. If a future deploy does include a migration, add a corresponding down-migration step here before running it.

Post-rollback verification: re-run §1's `/health` check and §3's auth test to confirm the rolled-back service is fully functional, then notify before considering the incident closed.
