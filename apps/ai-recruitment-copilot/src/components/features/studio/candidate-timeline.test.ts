import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("candidate-timeline.tsx", import.meta.url), "utf-8");

describe("CandidateTimeline visual density", () => {
  it("uses a vertical divide instead of bordered timeline cards", () => {
    expect(source).toContain("xl:border-l");
    expect(source).toContain("xl:border-border/50");
    expect(source).toContain("xl:pl-6");
    expect(source).toContain("absolute w-px bg-border");
    expect(source).toContain("rounded-xl border border-muted/60 bg-muted/30");
    expect(source).toContain("rounded-md bg-muted/40");
    expect(source).not.toContain("rounded-2xl border border-border bg-background p-4");
    expect(source).not.toContain("rounded-xl border border-border bg-background");
    expect(source).not.toContain("border border-border/70 bg-muted/30");
  });

  it("renders available time slots as a small TimeDisplay list", () => {
    expect(source).toContain("function TimelineAvailableTimeSlots");
    expect(source).toContain("event.availableTimeSlots");
    expect(source).toContain('<ul className="space-y-1 text-xs">');
    expect(source).toContain("value={slot.startAt}");
    expect(source).toContain("value={slot.endAt}");
    expect(source).toContain("<TimelineAvailableTimeSlots event={event} />");
  });

  it("renders timeline actors with avatar and nickname", () => {
    expect(source).toContain("event.actorImage");
    expect(source).toContain("<AvatarImage");
    expect(source).toContain("<AvatarFallback>");
    expect(source).toContain("getActorInitial");
  });
});
