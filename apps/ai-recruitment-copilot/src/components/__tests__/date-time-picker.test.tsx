// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDatePickerValue } from "@/lib/client/date-picker-value";
import { DatePicker, DateTimePicker } from "../date-time-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function getButton(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

describe("date and time pickers", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("renders a local date in Chinese without a native date input", () => {
    act(() => {
      root.render(<DatePicker onValueChange={vi.fn()} value="2026-07-24" />);
    });

    const trigger = container.querySelector("button");
    expect(trigger?.textContent).toContain("2026年7月24日");
    expect(trigger?.getAttribute("type")).toBe("button");
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("disables dates outside the configured date-only bounds", async () => {
    act(() => {
      root.render(
        <DatePicker max="2026-07-25" min="2026-07-23" onValueChange={vi.fn()} value="2026-07-24" />,
      );
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      document.querySelector<HTMLButtonElement>(
        `button[data-day="${new Date(2026, 6, 22).toLocaleDateString()}"]`,
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        `button[data-day="${new Date(2026, 6, 24).toLocaleDateString()}"]`,
      )?.disabled,
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>(
        `button[data-day="${new Date(2026, 6, 26).toLocaleDateString()}"]`,
      )?.disabled,
    ).toBe(true);
  });

  it("renders local hours and minutes without a native datetime input", () => {
    act(() => {
      root.render(<DateTimePicker onValueChange={vi.fn()} value="2026-07-24T09:05" />);
    });

    expect(container.textContent).toContain("2026年7月24日 09:05");
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it("opens the calendar when the trigger is clicked", async () => {
    act(() => {
      root.render(<DateTimePicker onValueChange={vi.fn()} value="" />);
    });

    const trigger = container.querySelector("button");
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.querySelector('[data-slot="calendar"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="popover-content"]')?.className).toContain(
      "bg-background",
    );
  });

  it("applies a date only after confirmation", async () => {
    const onValueChange = vi.fn();
    const today = new Date();

    act(() => {
      root.render(<DatePicker onValueChange={onValueChange} value="" />);
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const todayButton = document.querySelector<HTMLButtonElement>(
      `button[data-day="${today.toLocaleDateString()}"]`,
    );
    expect(todayButton).not.toBeNull();

    act(() => {
      todayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onValueChange).not.toHaveBeenCalled();

    act(() => {
      getButton("确定")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith(formatDatePickerValue(today));
  });

  it("defaults an empty picker to the current China time and applies it after confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T07:23:45.000Z"));
    const onValueChange = vi.fn();

    act(() => {
      root.render(<DateTimePicker onValueChange={onValueChange} value="" />);
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const timeControls = [...document.querySelectorAll<HTMLButtonElement>('[role="combobox"]')];
    expect(
      timeControls.map((control) =>
        control.querySelector('[data-slot="select-value"]')?.textContent?.trim(),
      ),
    ).toEqual(["15", "23"]);
    expect(timeControls.every((control) => !control.disabled)).toBe(true);
    expect(container.querySelector("button")?.textContent).toContain("选择日期和时间");
    expect(onValueChange).not.toHaveBeenCalled();

    act(() => {
      getButton("确定")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith("2026-10-19T15:23");
  });

  it("leaves an empty field unchanged on cancel and uses fresh current time when reopened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T07:23:00.000Z"));
    const onValueChange = vi.fn();
    act(() => root.render(<DateTimePicker onValueChange={onValueChange} value="" />));
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    act(() => getButton("取消")?.click());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(container.querySelector("button")?.textContent).toContain("选择日期和时间");
    vi.setSystemTime(new Date("2026-10-19T07:26:00.000Z"));
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    act(() => getButton("确定")?.click());
    expect(onValueChange).toHaveBeenCalledWith("2026-10-19T15:26");
  });

  it("selects the latest current time with 此刻 while keeping changes cancellable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T07:23:45.000Z"));
    const onValueChange = vi.fn();
    act(() =>
      root.render(<DateTimePicker onValueChange={onValueChange} value="2026-07-24T09:05" />),
    );
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-slot="calendar"]')?.textContent).toContain("2026年7月");
    vi.setSystemTime(new Date("2026-10-19T07:25:00.000Z"));
    act(() => getButton("此刻")?.click());
    expect(document.querySelector('[data-slot="calendar"]')?.textContent).toContain("2026年10月");
    expect(onValueChange).not.toHaveBeenCalled();
    act(() => getButton("确定")?.click());
    expect(onValueChange).toHaveBeenCalledWith("2026-10-19T15:25");
  });

  it("preserves an existing time when reopened and confirmed", async () => {
    const onValueChange = vi.fn();
    act(() =>
      root.render(<DateTimePicker onValueChange={onValueChange} value="2026-07-24T09:05" />),
    );
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    act(() => getButton("确定")?.click());
    expect(onValueChange).toHaveBeenCalledWith("2026-07-24T09:05");
  });

  it("discards date-time edits when cancelled", async () => {
    const onValueChange = vi.fn();

    act(() => {
      root.render(<DateTimePicker onValueChange={onValueChange} value="2026-07-24T09:05" />);
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    act(() => {
      getButton("清除")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      getButton("取消")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2026年7月24日 09:05");
  });

  it("forwards disabled and invalid states to the trigger", () => {
    act(() => {
      root.render(
        <DateTimePicker aria-invalid disabled onValueChange={vi.fn()} value="2026-07-24T09:05" />,
      );
    });

    const trigger = container.querySelector("button");
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.getAttribute("aria-invalid")).toBe("true");
  });
});
