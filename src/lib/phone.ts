// Single source of truth for phone normalization/matching — used both when
// persisting a caller's number (leadService, calendar/callerMemory routes)
// and when looking one up (callerMemoryService), so a lead created from one
// call flow and matched from another never diverges on formatting.

// US/single-tenant pilot: E.164 with a default +1 country code. Not a general
// international normalizer — matches the scope of the rest of the app
// (America/New_York brokerage, Twilio/VAPI numbers are all US).
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

// Matching key: last 10 digits. Deliberately more lenient than toE164 (which
// can return null on malformed input) — two numbers that only differ in
// formatting (spaces, dashes, missing '+1') must still match so a returning
// caller is never silently treated as new, or a new lead silently duplicated.
export function phoneMatchKey(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}
