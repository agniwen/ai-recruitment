import { describe, expect, it, vi } from "vitest";
import { buildMemberActionMenu } from "./member-actions";

describe("buildMemberActionMenu", () => {
  it("shows profile editing only with member update permission", () => {
    const [editProfile, remove] = buildMemberActionMenu({
      canDelete: false,
      canUpdate: true,
      onEditProfile: vi.fn(),
      onRemove: vi.fn(),
    });

    expect(editProfile?.label).toBe("编辑成员资料");
    expect(editProfile?.show?.({} as never)).toBe(true);
    expect(remove?.show?.({} as never)).toBe(false);
  });
});
