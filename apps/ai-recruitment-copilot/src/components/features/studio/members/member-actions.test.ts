import { describe, expect, it, vi } from "vitest";
import { buildMemberActionMenu } from "./member-actions";

describe("buildMemberActionMenu", () => {
  it("shows rename only with member update permission", () => {
    const [rename, remove] = buildMemberActionMenu({
      canDelete: false,
      canUpdate: true,
      onEditName: vi.fn(),
      onRemove: vi.fn(),
    });

    expect(rename?.label).toBe("修改用户名称");
    expect(rename?.show?.({} as never)).toBe(true);
    expect(remove?.show?.({} as never)).toBe(false);
  });
});
