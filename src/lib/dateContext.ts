// Deterministic current-time context for the voice agent. VAPI's own
// built-in {{now}}/{{date}}/{{time}} variables are UTC-only and give no
// weekday/office-hours/DST-correct local reading, so the model is left to
// compute brokerage-local time and relative dates ("this Thursday") itself —
// which it cannot do reliably. This computes everything server-side, once
// per call (returned from lookup_caller_history, which every call already
// invokes before the greeting), so Alex never has to invent a calendar date.
//
// Intl.DateTimeFormat with a timeZone option (not a fixed UTC offset) is
// what makes this DST-correct across an IANA zone — same technique already
// used by slotGeneration.ts for business-hours checks.

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function localDateString(date: Date, timeZone: string): string {
  // en-CA formats as yyyy-mm-dd, which is exactly ISO calendar-date shape.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date
  );
}

function localTimeString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    date
  );
}

function localWeekdayIndex(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
  return WEEKDAY_NAMES.indexOf(name);
}

// Pure calendar-date arithmetic on a UTC-midnight-anchored Date — once we
// have the correct local Y-M-D (from Intl above), shifting by whole days is
// timezone-agnostic, so this can't be knocked off by DST the way naive
// millisecond arithmetic on a real instant could be.
function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface WeekdayResolution {
  name: string;
  thisWeekDate: string;
  thisWeekPassed: boolean;
  nextWeekDate: string;
}

export interface DateContext {
  nowUtc: string;
  timezone: string;
  localDate: string;
  localTime: string;
  localWeekday: string;
  officeHoursOpen: boolean;
  today: string;
  tomorrow: string;
  weekdays: WeekdayResolution[];
}

export interface BusinessHours {
  start: string; // "09:00"
  end: string; // "18:00"
  days: number[]; // 0=Sun..6=Sat
}

export function computeDateContext(now: Date, timezone: string, businessHours: BusinessHours): DateContext {
  const localDate = localDateString(now, timezone);
  const localTime = localTimeString(now, timezone);
  const todayIdx = localWeekdayIndex(now, timezone);
  const localWeekday = WEEKDAY_NAMES[todayIdx];

  const startHour = parseInt(businessHours.start.split(":")[0], 10);
  const endHour = parseInt(businessHours.end.split(":")[0], 10);
  const localHour = parseInt(localTime.split(":")[0], 10);
  const officeHoursOpen = businessHours.days.includes(todayIdx) && localHour >= startHour && localHour < endHour;

  const weekdays: WeekdayResolution[] = WEEKDAY_NAMES.map((name, idx) => {
    const diff = idx - todayIdx;
    const thisWeekDate = shiftDate(localDate, diff);
    return {
      name,
      thisWeekDate,
      thisWeekPassed: diff < 0,
      nextWeekDate: shiftDate(thisWeekDate, 7),
    };
  });

  return {
    nowUtc: now.toISOString(),
    timezone,
    localDate,
    localTime,
    localWeekday,
    officeHoursOpen,
    today: localDate,
    tomorrow: shiftDate(localDate, 1),
    weekdays,
  };
}
