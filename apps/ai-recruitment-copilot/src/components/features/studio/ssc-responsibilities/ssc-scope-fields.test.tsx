// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  installNoopResizeObserver,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { SscScopeFields } from "./ssc-scope-fields";
import type { SscResponsibilityScopeOptions } from "./ssc-scope-fields";

enableReactActEnvironment();
let mounted: Awaited<ReturnType<typeof renderInAct>> | undefined;
afterEach(async () => {
  if (mounted) {
    await unmountInAct(mounted.root);
  }
  mounted = undefined;
  document.body.replaceChildren();
});

async function openDepartments(departments: SscResponsibilityScopeOptions["departments"]) {
  installNoopResizeObserver();
  const onChange = vi.fn();
  mounted = await renderInAct(
    <SscScopeFields
      disabled={false}
      onChange={onChange}
      options={{ departments, serviceUnits: [] }}
      value={{ departmentId: null, serviceUnit: null }}
    />,
  );
  const input = document.querySelector<HTMLInputElement>("#ssc-departmentId");
  await act(() => {
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  await waitForUi(() =>
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(departments.length),
  );
  return onChange;
}

describe("SSC scope department identity", () => {
  it("distinguishes duplicate names within the same organization and selects the exact department ID", async () => {
    const onChange = await openDepartments([
      { hiringUnitName: "万帧公司", id: "12345678-1111-4111-8111-111111111111", name: "制作组" },
      { hiringUnitName: "万帧公司", id: "87654321-2222-4222-8222-222222222222", name: "制作组" },
    ]);
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      "制作组万帧公司 · 部门ID：12345678",
      "制作组万帧公司 · 部门ID：87654321",
    ]);
    await act(() => options[1]?.click());
    expect(onChange).toHaveBeenCalledWith({
      departmentId: "87654321-2222-4222-8222-222222222222",
      serviceUnit: null,
    });
  });

  it("shows full IDs when the short department identifiers collide", async () => {
    await openDepartments([
      { hiringUnitName: "墨链公司", id: "12345678-1111-4111-8111-111111111111", name: "产品组" },
      { hiringUnitName: "墨链公司", id: "12345678-2222-4222-8222-222222222222", name: "产品组" },
    ]);
    expect(
      [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
    ).toEqual([
      "产品组墨链公司 · 部门ID：12345678-1111-4111-8111-111111111111",
      "产品组墨链公司 · 部门ID：12345678-2222-4222-8222-222222222222",
    ]);
  });

  it("keeps the organization description for unambiguous department options", async () => {
    await openDepartments([
      { hiringUnitName: "万帧公司", id: "department-a", name: "制作组" },
      { hiringUnitName: "墨链公司", id: "department-b", name: "制作组" },
    ]);
    expect(
      [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
    ).toEqual(["制作组万帧公司", "制作组墨链公司"]);
  });
});
