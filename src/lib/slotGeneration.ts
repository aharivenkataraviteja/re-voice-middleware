const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// No moment/date-fns-tz dependency needed — Intl.DateTimeFormat with a
// timeZone option gives correct wall-clock hour/weekday for an instant in
// any IANA zone using only what Node already ships.
function hourInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value;
  return hour ? parseInt(hour, 10) % 24 : date.getUTCHours();
}

function weekdayInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  return wd && wd in WEEKDAY_INDEX ? WEEKDAY_INDEX[wd] : date.getUTCDay();
}

export interface BusyPeriod {
  start: string;
  end: string;
}

export interface SlotGenerationOptions {
  timeMin: Date;
  timeMax: Date;
  timeZone: string;
  businessHours: { start: string; end: string; days: number[] };
  busy: BusyPeriod[];
  durationMinutes?: number;
  maxSlots?: number;
}

// Walks hour-by-hour from timeMin to timeMax, keeps only slots inside the
// tenant's configured business hours (evaluated in the given IANA timezone,
// not server-local time) that don't overlap any real busy period from
// Google's freebusy response. Never returns more than maxSlots — Alex is
// only ever allowed to offer two options, and only ones Google has actually
// confirmed are free.
export function generateAvailableSlots(options: SlotGenerationOptions): Date[] {
  const { timeMin, timeMax, timeZone, businessHours, busy, durationMinutes = 60, maxSlots = 2 } = options;
  const startHour = parseInt(businessHours.start.split(":")[0], 10);
  const endHour = parseInt(businessHours.end.split(":")[0], 10);
  const busyRanges = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));

  const slots: Date[] = [];
  const stepMs = 60 * 60 * 1000;
  let cursor = new Date(Math.ceil(timeMin.getTime() / stepMs) * stepMs);

  while (cursor < timeMax && slots.length < maxSlots) {
    const hour = hourInTimezone(cursor, timeZone);
    const weekday = weekdayInTimezone(cursor, timeZone);

    if (businessHours.days.includes(weekday) && hour >= startHour && hour < endHour) {
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
