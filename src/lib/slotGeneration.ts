const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// No moment/date-fns-tz dependency needed — Intl.DateTimeFormat with a
// timeZone option gives correct wall-clock hour/weekday for an instant in
// any IANA zone using only what Node already ships.
//
// Minutes-since-midnight, not just the hour — a real close time like
// "17:30" truncated to hour 17 would incorrectly treat the entire 17:00
// slot as open (its 60-minute end at 18:00 actually runs an hour past
// close). Comparing full minutes on both the slot's start and end catches
// this; comparing only integer hours can't.
function minutesInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (Number.isNaN(hour)) return date.getUTCHours() * 60 + date.getUTCMinutes();
  return (hour % 24) * 60 + minute;
}

export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

export const TIME_HHMM_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function weekdayInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  return wd && wd in WEEKDAY_INDEX ? WEEKDAY_INDEX[wd] : date.getUTCDay();
}

export interface BusyPeriod {
  start: string;
  end: string;
}

// Real-world ranges, intersected with actual business hours below — not
// promises that slots exist in these windows. A brokerage closing at 17:30
// genuinely has almost no "evening" inventory; that's a fact about its
// hours, not a bug in this range definition, and callers must be told that
// honestly (see the noMatchInTimeOfDay flag) rather than silently handed
// morning slots instead.
const TIME_OF_DAY_RANGES: Record<string, { startMinutes: number; endMinutes: number }> = {
  morning: { startMinutes: 0, endMinutes: 12 * 60 },
  afternoon: { startMinutes: 12 * 60, endMinutes: 17 * 60 },
  evening: { startMinutes: 17 * 60, endMinutes: 24 * 60 },
};

export type TimeOfDay = keyof typeof TIME_OF_DAY_RANGES;

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === "string" && value in TIME_OF_DAY_RANGES;
}

export function timeOfDayRangeFor(timeOfDay: TimeOfDay): { startMinutes: number; endMinutes: number } {
  return TIME_OF_DAY_RANGES[timeOfDay];
}

// Which bucket a clock time falls in — used to build an honest "nearby"
// fallback range when an exact requested_time isn't available, instead of
// falling all the way back to the earliest slot in the entire day (observed
// in a real call: caller asked for 2 PM, got told "our latest options are
// 9 AM or 10 AM" — technically true only because nothing later had been
// checked, not because those really were the day's latest slots).
export function timeOfDayBucketFor(minutes: number): TimeOfDay {
  if (minutes < TIME_OF_DAY_RANGES.afternoon.startMinutes) return "morning";
  if (minutes < TIME_OF_DAY_RANGES.evening.startMinutes) return "afternoon";
  return "evening";
}

export interface PreferredRange {
  startMinutes: number;
  endMinutes: number;
}

export interface SlotGenerationOptions {
  timeMin: Date;
  timeMax: Date;
  timeZone: string;
  businessHours: { start: string; end: string; days: number[] };
  busy: BusyPeriod[];
  durationMinutes?: number;
  maxSlots?: number;
  preferredRange?: PreferredRange;
}

// Walks hour-by-hour from timeMin to timeMax, keeps only slots inside the
// tenant's configured business hours (evaluated in the given IANA timezone,
// not server-local time) that don't overlap any real busy period from
// Google's freebusy response. Never returns more than maxSlots — Alex is
// only ever allowed to offer two options, and only ones Google has actually
// confirmed are free. When preferredRange is given, only slots whose start
// falls within that window are considered at all — a caller who asked for
// "evening" (or an exact time) must never be handed a 9 AM slot with no
// comment; see calendar.ts for how a vague time-of-day word or an exact
// clock time both become a range here.
export function generateAvailableSlots(options: SlotGenerationOptions): Date[] {
  const { timeMin, timeMax, timeZone, businessHours, busy, durationMinutes = 60, maxSlots = 2, preferredRange } = options;
  const startMinutes = parseTimeToMinutes(businessHours.start);
  const endMinutes = parseTimeToMinutes(businessHours.end);
  const busyRanges = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));

  const slots: Date[] = [];
  const stepMs = 60 * 60 * 1000;
  let cursor = new Date(Math.ceil(timeMin.getTime() / stepMs) * stepMs);

  while (cursor < timeMax && slots.length < maxSlots) {
    const weekday = weekdayInTimezone(cursor, timeZone);
    const slotStartMinutes = minutesInTimezone(cursor, timeZone);
    const slotEndMinutes = slotStartMinutes + durationMinutes;

    const withinBusinessHours =
      businessHours.days.includes(weekday) && slotStartMinutes >= startMinutes && slotEndMinutes <= endMinutes;
    const withinPreference =
      !preferredRange || (slotStartMinutes >= preferredRange.startMinutes && slotStartMinutes < preferredRange.endMinutes);

    if (withinBusinessHours && withinPreference) {
      const slotEnd = new Date(cursor.getTime() + durationMinutes * 60 * 1000);
      const overlapsBusy = busyRanges.some((b) => cursor.getTime() < b.end && slotEnd.getTime() > b.start);
      if (!overlapsBusy) {
        slots.push(new Date(cursor));
      }
    }

    cursor = new Date(cursor.getTime() + stepMs);
  }

  return slots;
}
