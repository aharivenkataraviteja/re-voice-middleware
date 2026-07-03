export function redactPhone(phone: string | undefined | null): string {
  if (!phone) return "unknown";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

export function redactEmail(email: string | undefined | null): string {
  if (!email) return "unknown";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

const SECRET_KEY_PATTERN = /secret|token|password|authorization|signature/i;
const PHONE_KEY_PATTERN = /phone/i;
const EMAIL_KEY_PATTERN = /email/i;

const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Deliberately requires a leading "+" (E.164, matching our own tool schemas)
// rather than a bare digit-run backstop — an unanchored digit pattern was
// found to false-positive on ISO date/timestamp strings (e.g. slot_start)
// and corrupt them in logs. A phone number embedded in free text (e.g. a
// "notes" field) WITHOUT a "+" prefix will not be caught by this backstop;
// only key-based redaction (see PHONE_KEY_PATTERN below) is guaranteed.
const PHONE_REGEX = /\+\d{7,15}/g;
const HEX_SECRET_REGEX = /\b[a-f0-9]{32,}\b/gi;

function redactStringValue(value: string): string {
  return value
    .replace(EMAIL_REGEX, (m) => redactEmail(m))
    .replace(PHONE_REGEX, (m) => redactPhone(m))
    .replace(HEX_SECRET_REGEX, "[REDACTED_HEX]");
}

// Deep-redacts an arbitrary request/response body before it is logged.
// Key-based rules take priority (phone/email/secret-like field names);
// a regex pass over remaining strings acts as a defense-in-depth backstop.
export function redactBody(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactStringValue(input);
  if (Array.isArray(input)) return input.map(redactBody);
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else if (PHONE_KEY_PATTERN.test(k) && typeof v === "string") {
        out[k] = redactPhone(v);
      } else if (EMAIL_KEY_PATTERN.test(k) && typeof v === "string") {
        out[k] = redactEmail(v);
      } else {
        out[k] = redactBody(v);
      }
    }
    return out;
  }
  return input;
}
