import { Request, Response } from "express";

// Vapi sends the full webhook envelope to each tool's own server.url — the
// actual function arguments live at message.toolCalls[0].function.arguments,
// not at the top level of the request body. That same envelope also carries
// message.call.id and message.customer.number — Vapi's own authoritative
// values for "which call is this" and "who is calling", present on every
// tool-call request regardless of what the LLM decided to put in its
// function arguments. See resolveCallId() below for why these matter.
export function extractToolCall(req: Request): {
  toolCallId: string;
  args: Record<string, any>;
  realCallId: string | undefined;
  callerNumber: string | undefined;
} {
  const message = req.body?.message;
  const call = message?.toolCalls?.[0];
  return {
    toolCallId: call?.id,
    args: call?.function?.arguments || {},
    realCallId: message?.call?.id,
    callerNumber: message?.customer?.number,
  };
}

const PLACEHOLDER_SESSION_IDS = new Set(["session_id_placeholder", "placeholder", "unknown", "test_session_001", ""]);

// The LLM-supplied `session_id` tool argument is unreliable — nothing tells
// the model what value to use, so it fabricates one (observed in production:
// the literal string "session_id_placeholder" on every call), which silently
// scattered every caller's tool activity onto one stale calls/lead row.
// Vapi's webhook envelope always carries the real call ID independently of
// the LLM (see extractToolCall above) — that is the only value ever used to
// link a lead/call/appointment. The LLM's session_id is never trusted for
// linking; a mismatch (placeholder or otherwise) is only logged, so a broken
// value stays visible instead of silently corrupting records.
export function resolveCallId(
  realCallId: string | undefined,
  llmSessionId: string | undefined,
  toolName: string
): string {
  if (realCallId) {
    if (llmSessionId && PLACEHOLDER_SESSION_IDS.has(llmSessionId.toLowerCase())) {
      console.warn(`[vapiTool] ${toolName}: LLM sent placeholder session_id "${llmSessionId}" — using real call ID ${realCallId} instead`);
    } else if (llmSessionId && llmSessionId !== realCallId) {
      console.warn(`[vapiTool] ${toolName}: LLM session_id (${llmSessionId}) != real call ID (${realCallId}) — using real call ID`);
    }
    return realCallId;
  }
  // No message.call.id on the webhook envelope — shouldn't happen for a real
  // inbound phone call, but never silently corrupt a record by falling back
  // to a value we can't verify without at least logging it loudly.
  console.error(`[vapiTool] ${toolName}: no message.call.id on webhook envelope; falling back to LLM session_id=${llmSessionId}`);
  return llmSessionId || "unknown";
}

// Vapi requires every tool response to be HTTP 200 with a results array
// keyed by toolCallId — a bare JSON object (even with a 200 status) is not
// parsed, and the assistant's "request-failed" message fires instead.
// Failures are reported via the `error` field on the same 200 response, per
// Vapi's documented contract, not via a non-2xx status.
export function sendToolResult(res: Response, toolCallId: string, result: unknown): void {
  res.status(200).json({ results: [{ toolCallId, result }] });
}

export function sendToolError(res: Response, toolCallId: string, error: string): void {
  res.status(200).json({ results: [{ toolCallId, error }] });
}
