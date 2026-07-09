# Google Calendar Integration — Setup Guide

Status: **setup steps only — no code written yet**, per your instruction to get Google Cloud configured before implementation starts.

**Decision confirmed:** personal Gmail accounts for the pilot, External OAuth consent screen, each agent connects their own calendar individually via OAuth (no domain-wide/service-account delegation). This covers exactly what you need to do in Google Cloud Console, and exactly what you hand back to me.

**On "keep the schema flexible for Workspace later":** no schema changes will be needed when Workspace agents join. The connection model (one row per agent, holding their own encrypted refresh token) is identical whether the underlying Google account is personal Gmail or a Workspace account — a Workspace user can authorize an External-consent-screen app through the exact same individual OAuth flow. The only thing that would change later is the *consent screen* setting (External → Internal, if you ever want an all-Workspace roster and a smoother agent experience with no "unverified app" click-through) — that's a Cloud Console setting, not a data model change, so nothing in the `google_calendar_connections` table or the code needs to be rebuilt. The one thing explicitly out of scope here (since you asked for individual per-agent OAuth, not org-wide) is domain-wide delegation via a service account, which is a materially different architecture (an admin pre-authorizes access to every user's calendar without each agent clicking "Connect") — worth knowing that's a separate, larger decision if a future Workspace customer ever wants it, not something this pilot design assumes or blocks.

---

## 1. Project creation

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project — e.g. `re-voice-switchboard` (or reuse an existing project if you already have one for this business; a dedicated project is cleaner for billing/quota isolation and is what I'd recommend).
3. Note the **Project ID** shown after creation. You don't hand this to me directly — it's just how you'll find the project again in the console.

---

## 2. APIs to enable

In the new project: **APIs & Services → Library**, enable exactly one API:

- **Google Calendar API**

That's the only one required — it covers both `freebusy.query` (availability) and `events.insert`/`events.patch` (booking/reschedule/cancel). No Admin SDK, no People API needed for what's in scope.

---

## 3. OAuth consent screen

**APIs & Services → OAuth consent screen**:

1. **User type**: **External**
2. **Publishing status**: leave as **Testing** (do not click "Publish app"). Testing mode:
   - Works immediately, no Google review.
   - Supports up to 100 explicitly-listed test users — plenty for a pilot brokerage's agent roster.
   - Each agent sees a one-time interstitial the first time they connect: *"Google hasn't verified this app"* → they click **Advanced** → **Go to re-voice-switchboard (unsafe)**. This is normal and expected for an internal pilot tool, not a red flag — but worth telling agents in advance so it doesn't alarm them.
3. **App name**: something recognizable to agents, e.g. "Luxury Partners Realty — Switchboard".
4. **User support email**: your email.
5. **Developer contact email**: your email.
6. **Scopes** — click "Add or Remove Scopes" and add exactly these four (least-privilege — no broader `calendar` or `calendar.readonly` scope needed):
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/calendar.freebusy` — required for the availability check (`freebusy.query`)
   - `.../auth/calendar.events` — required for creating/updating/canceling appointment events
7. **Test users**: add the actual Google account email of every agent who will connect their calendar during the pilot. You can add more later as you onboard agents — each addition is instant, no re-review.

---

## 4. OAuth client type

**APIs & Services → Credentials → Create Credentials → OAuth client ID**:

1. **Application type**: **Web application** — not Desktop, not Other. The flow is: agent clicks "Connect Google Calendar" in Switchboard → redirected to Google → redirected back to our server with an auth code. That round-trip requires a Web application client.
2. **Name**: e.g. "Switchboard production".
3. **Authorized redirect URIs** — add both of these now (one for production, one for local testing):
   - `https://re-voice-middleware-production.up.railway.app/api/v1/integrations/google-calendar/oauth/callback`
   - `http://localhost:8089/api/v1/integrations/google-calendar/oauth/callback`
4. Click **Create**. Google shows a **Client ID** and **Client Secret** — this is the one piece of real credential material from this whole setup.

---

## 5. Environment variables needed

Four new variables, going into both `middleware/.env` and Railway (same pattern as every other credential this session):

| Variable | Where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` | From step 4, Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From step 4, Google Cloud Console |
| `GOOGLE_OAUTH_REDIRECT_URI` | The exact production URI you registered in step 4: `https://re-voice-middleware-production.up.railway.app/api/v1/integrations/google-calendar/oauth/callback` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | **I generate this one, not Google** — a random 32-byte key (base64) used to encrypt refresh tokens at rest in Postgres before storing them, per your requirement #3. I'll generate and set this myself when I implement, no action needed from you. |

---

## 6. What you hand back to me

Only two real values, and **please don't paste them into this chat** — same rule as every other secret this session. Instead, either:
- Add them directly to `middleware/.env` and Railway yourself (I can give you the exact `railway variable set --stdin` commands to run), or
- Tell me you've added them and I'll verify they're present (by name, never by value) before wiring the code to use them.

The two values:
1. **`GOOGLE_CLIENT_ID`**
2. **`GOOGLE_CLIENT_SECRET`**

Plus one non-secret thing I do need in chat: **the list of agent Google account emails** to add as test users (step 3) — or confirmation that you've already added them yourself in the console.

---

## What happens after this is done

Once `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set and at least one agent email is a test user, I'll build (not yet started):
- `google_calendar_connections` table: `agent_id`, `provider='google'`, `calendar_id`, `refresh_token` (encrypted with `GOOGLE_TOKEN_ENCRYPTION_KEY`), `connected_at`, `status`.
- `GET /api/v1/integrations/google-calendar/connect` → redirects agent to Google's consent screen.
- `GET /api/v1/integrations/google-calendar/oauth/callback` → exchanges the code for tokens, encrypts + stores the refresh token.
- "Connect Google Calendar" button + connection status in the dashboard (Settings or agent profile — will confirm placement with you).
- `check_calendar_availability` and `book_appointment` tool handlers rewritten to call the real Google Calendar API (`freebusy.query`, `events.insert`) per-agent, using their stored refresh token to mint a fresh access token — with the existing `log_callback_request` fallback kept as the safety net exactly as you specified, firing whenever Google's API errors, times out, or a token has expired/been revoked.
- The full test list you asked for (OAuth connection, availability lookup, booking, unavailable calendar, expired token, API failure fallback, multiple agents) run against this real integration once it's wired up.

I have not written any of that yet — waiting on the two credentials above before starting.
