import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("candidate-timeline.tsx", import.meta.url), "utf-8");

describe("CandidateTimeline visual density", () => {
  it("renders compact actor activity records with preview details", () => {
    expect(source).toContain("function ActivityRecordShell");
    expect(source).toContain("function ActivityPreview");
    expect(source).toContain("<PreviewCardTrigger");
    expect(source).toContain("formatRelativeTime(event.occurredAt)");
    expect(source).toContain("ACTIVITY_FORMATTERS");
    expect(source).not.toContain("absolute w-px bg-border");
  });

  it("renders available time slots as a small TimeDisplay list", () => {
    expect(source).toContain("event.availableTimeSlots");
    expect(source).toContain('<ul className="space-y-1.5 text-xs">');
    expect(source).toContain("value={slot.startAt}");
    expect(source).toContain("value={slot.endAt}");
  });

  it("renders timeline actors with avatar and nickname", () => {
    expect(source).toContain("event.actorName");
    expect(source).toContain("event.actorImage");
    expect(source).toContain("<AvatarImage");
    expect(source).toContain("<AvatarFallback>");
    expect(source).toContain("getActivityActor");
  });

  it("uses matching compact activity skeleton rows", () => {
    expect(source).toContain("<ActivityRecordShell");
    expect(source).toContain('avatar={<Skeleton className="size-5 rounded-full" />}');
    expect(source).toContain("h-4 min-w-24 flex-1 rounded-full");
  });
});
