// Regression test for the webhook race condition fixed in src/routes/webhook.ts.
//
// VAPI fires dozens of webhook events per call in quick succession. Before
// the fix, webhook.ts used a SELECT-then-INSERT pattern to ensure a `calls`
// row existed: two concurrent requests could both see "no row yet" and both
// try to INSERT, and the loser threw a unique-constraint error on
// vapi_call_id — which is exactly what happened on a real production call
// (three DrizzleQueryErrors logged for one call). This script fires a batch
// of realistic, concurrent webhook events for a single synthetic call_id
// against a running server and asserts:
//   1. Every request gets HTTP 200 (no unhandled errors reach the caller).
//   2. Exactly one `calls` row exists afterward (no duplicates from a race).
//   3. The end-of-call-report fields (duration, summary, transcript,
//      recording URLs, ended_at, ended_reason) all persisted correctly even
//      though that event was sent concurrently with everything else.
//
// Usage: npm run test:webhook-concurrency
// Env:   WEBHOOK_TEST_BASE_URL (default http://localhost:8089)

import postgres from "postgres";
import { config } from "../src/config";

const BASE_URL = process.env.WEBHOOK_TEST_BASE_URL || "http://localhost:8089";
const CONCURRENT_EVENTS = 40;

function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function postWebhook(body: unknown) {
  const res = await fetch(`${BASE_URL}/vapi/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vapi-secret": config.vapiWebhookSecret,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const callId = randomId("concurrency-test-call");
  console.log(`Testing webhook concurrency for synthetic call_id=${callId} against ${BASE_URL}`);

  const events: unknown[] = [];
  events.push({ message: { type: "assistant.started", call: { id: callId } } });
  for (let i = 0; i < CONCURRENT_EVENTS - 6; i++) {
    events.push({
      message: {
        type: i % 3 === 0 ? "conversation-update" : "speech-update",
        call: { id: callId },
      },
    });
  }
  events.push({ message: { type: "status-update", call: { id: callId } } });
  events.push({ message: { type: "status-update", call: { id: callId } } });
  events.push({ message: { type: "user-interrupted", call: { id: callId } } });
  events.push({ message: { type: "user-interrupted", call: { id: callId } } });
  events.push({ message: { type: "user-interrupted", call: { id: callId } } });
  events.push({
    message: {
      type: "end-of-call-report",
      call: { id: callId },
      durationSeconds: 187,
      endedReason: "customer-ended-call",
      recordingUrl: "https://example.com/recordings/concurrency-test.mp3",
      stereoRecordingUrl: "https://example.com/recordings/concurrency-test-stereo.mp3",
      summary: "Concurrency test call — synthetic data, safe to delete.",
      analysis: { structuredData: { primary_intent: "BUY" } },
      artifact: {
        messages: [
          { role: "assistant", message: "Hi, this is Alex." },
          { role: "user", message: "I want to book a showing." },
        ],
      },
    },
  });

  console.log(`Firing ${events.length} webhook events concurrently (not sequentially)...`);
  const results = await Promise.all(events.map((e) => postWebhook(e)));

  const nonOk = results.filter((r) => r.status !== 200);
  if (nonOk.length > 0) {
    console.error(`FAIL: ${nonOk.length}/${results.length} requests did not return 200`);
    console.error(nonOk.slice(0, 5));
    process.exitCode = 1;
  } else {
    console.log(`PASS: all ${results.length} concurrent requests returned 200`);
  }

  const sql = postgres(config.databaseUrl, { max: 1 });
  try {
    const rows = await sql`select * from calls where vapi_call_id = ${callId}`;

    if (rows.length !== 1) {
      console.error(`FAIL: expected exactly 1 calls row for ${callId}, found ${rows.length}`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: exactly 1 calls row exists (no duplicate from the race)`);
    }

    if (rows.length === 1) {
      const row = rows[0];
      const checks: [string, unknown][] = [
        ["duration_seconds", row.duration_seconds],
        ["summary_text", row.summary_text],
        ["transcript_text", row.transcript_text],
        ["recording_url", row.recording_url],
        ["stereo_recording_url", row.stereo_recording_url],
        ["ended_at", row.ended_at],
        ["ended_reason", row.ended_reason],
      ];
      const missing = checks.filter(([, v]) => v === null || v === undefined);
      if (missing.length > 0) {
        console.error(`FAIL: end-of-call-report fields not persisted: ${missing.map(([k]) => k).join(", ")}`);
        process.exitCode = 1;
      } else {
        console.log("PASS: all end-of-call-report fields persisted correctly under concurrency");
        console.log(`  duration_seconds=${row.duration_seconds} ended_reason=${row.ended_reason}`);
      }
    }

    await sql`delete from calls where vapi_call_id = ${callId}`;
    console.log(`Cleaned up test row for ${callId}`);
  } finally {
    await sql.end();
  }

  if (process.exitCode === 1) {
    console.error("\nCONCURRENCY TEST FAILED");
  } else {
    console.log("\nCONCURRENCY TEST PASSED");
  }
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
