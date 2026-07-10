import { Request, Response } from "express";

// Vapi sends the full webhook envelope to each tool's own server.url — the
// actual function arguments live at message.toolCalls[0].function.arguments,
// not at the top level of the request body.
export function extractToolCall(req: Request): { toolCallId: string; args: Record<string, any> } {
  const call = req.body?.message?.toolCalls?.[0];
  return {
    toolCallId: call?.id,
    args: call?.function?.arguments || {},
  };
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
