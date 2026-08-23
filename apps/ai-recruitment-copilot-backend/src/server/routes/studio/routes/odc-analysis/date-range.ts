export interface InstantRange {
  end: Date | null;
  start: Date | null;
}

export function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function beijingDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}

export function resolveOdcAnalysisRange(filters: { from?: string; to?: string }): InstantRange {
  return {
    end: filters.to ? beijingDayStart(addCalendarDays(filters.to, 1)) : null,
    start: filters.from ? beijingDayStart(filters.from) : null,
  };
}
