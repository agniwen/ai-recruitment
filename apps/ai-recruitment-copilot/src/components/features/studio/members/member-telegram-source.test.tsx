// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomColumnOptions } from "@/components/data-grid/columns/custom-column";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { EditMemberProfileDialog } from "./edit-member-profile-dialog";
import { useWorkspaceMemberProfileControl } from "./member-profile-control";
import type { MemberRow } from "./members-page-model";

const mocks = vi.hoisted(() => ({
  cell: null as CustomColumnOptions<MemberRow>["cell"] | null,
  close: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  updated: vi.fn(),
}));
vi.mock("@/components/data-grid", () => ({
  customColumn: (options: CustomColumnOptions<MemberRow>) => {
    mocks.cell = options.cell;
    return options;
  },
}));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "alpha" }));
vi.mock("@/lib/client/api", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            workspace: {
              members: {
                ":userId": { profile: { $patch: mocks.patch } },
                profiles: { $get: mocks.get },
              },
            },
          },
        },
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
enableReactActEnvironment();

const member: MemberRow = {
  createdAt: "2026-10-22T00:00:00.000Z",
  email: "ssc@example.com",
  id: "member-a",
  image: null,
  isInterviewer: false,
  lastActiveAt: null,
  name: "SSC同事",
  role: "SSC角色",
  telegram: "@ledger_ssc",
  userId: "user-a",
};
const ledgerMember = { ...member, profileTelegram: null, telegramSource: "ssc" as const };
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cell = null;
  mocks.get.mockResolvedValue({
    records: [
      {
        profileTelegram: null,
        telegram: member.telegram,
        telegramSource: "ssc",
        userId: member.userId,
      },
    ],
  });
  mocks.patch.mockResolvedValue({ name: "修改后的名称", telegram: null });
  mocks.updated.mockResolvedValue(null);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  client.clear();
  document.body.replaceChildren();
});

async function render(content: ReactNode) {
  rendered = await renderInAct(
    <QueryClientProvider client={client}>{content}</QueryClientProvider>,
  );
}
function input(id: string) {
  const field = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!field) {
    throw new Error(`Missing member field ${id}`);
  }
  return field;
}
async function change(id: string, value: string) {
  await act(() => {
    const field = input(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function save() {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "保存",
  );
  if (!button) {
    throw new Error("Missing member save button");
  }
  return button;
}
function ProfileCell({ row = ledgerMember }: { row?: MemberRow }) {
  const control = useWorkspaceMemberProfileControl(true);
  const profile = control.profileByUserId.get(row.userId);
  return control.telegramColumn && profile ? (
    <div data-testid="telegram-cell">{mocks.cell?.({ ...row, ...profile })}</div>
  ) : null;
}

function editor(row: MemberRow) {
  return (
    <EditMemberProfileDialog member={row} onOpenChange={mocks.close} onUpdated={mocks.updated} />
  );
}

describe("workspace member SSC Telegram fallback", () => {
  it("shows the effective SSC handle with its source without inventing a personal profile", async () => {
    await render(<ProfileCell />);
    await waitForUi(() => expect(document.body.textContent).toContain("@ledger_ssc"));
    expect(document.querySelector('[title="来自 SSC 负责组织"]')).not.toBeNull();
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith({ param: { slug: "alpha" } });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("keeps a personal Telegram handle free of the SSC source hint", async () => {
    mocks.get.mockResolvedValue({
      records: [
        {
          profileTelegram: "@personal_ssc",
          telegram: "@personal_ssc",
          telegramSource: "profile",
          userId: member.userId,
        },
      ],
    });
    await render(<ProfileCell />);
    await waitForUi(() => expect(document.body.textContent).toContain("@personal_ssc"));
    expect(document.querySelector('[title="来自 SSC 负责组织"]')).toBeNull();
  });

  it("edits an empty personal Telegram field and explains the independently registered SSC handle", async () => {
    await render(editor(ledgerMember));
    expect(input("member-telegram").value).toBe("");
    expect(document.body.textContent).toContain("@ledger_ssc");
    expect(document.body.textContent).toContain("SSC 负责组织");
    expect(save().disabled).toBe(true);
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("does not promote an SSC ledger handle into the personal profile when only renaming", async () => {
    await render(editor(ledgerMember));
    await change("member-name", "修改后的名称");
    expect(save().disabled).toBe(false);
    await act(() => save().click());
    await waitForUi(() => expect(mocks.patch).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledWith({
      json: { name: "修改后的名称", telegram: null },
      param: { slug: "alpha", userId: "user-a" },
    });
    expect(mocks.updated).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledWith(false);
  });

  it("saves a personal Telegram only when it is explicitly entered", async () => {
    await render(editor(ledgerMember));
    await change("member-telegram", "  @my_personal_tg  ");
    await act(() => save().click());
    await waitForUi(() => expect(mocks.patch).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledWith({
      json: { name: "SSC同事", telegram: "@my_personal_tg" },
      param: { slug: "alpha", userId: "user-a" },
    });
  });

  it("preserves personal values from older profile responses without source metadata", async () => {
    await render(editor(member));
    expect(input("member-telegram").value).toBe("@ledger_ssc");
    await change("member-name", "修改后的名称");
    await act(() => save().click());
    await waitForUi(() => expect(mocks.patch).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledWith({
      json: { name: "修改后的名称", telegram: "@ledger_ssc" },
      param: { slug: "alpha", userId: "user-a" },
    });
  });
});
