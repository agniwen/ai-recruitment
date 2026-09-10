// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clonePermissionStatements,
  normalizePermissionStatements,
} from "@arc/shared/permission-statements";
import type { WorkspacePermissionStatements } from "@arc/shared/permission-statements";
import { statement } from "@arc/shared/permissions";
import { STUDIO_PAGE_PATHS } from "@/lib/start/studio-page-paths";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { StudioSidebarSlots } from "./studio-sidebar-slots";

const mocks = vi.hoisted(() => ({ permissions: {} as WorkspacePermissionStatements }));
vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceMemberRole: () => "04-odc",
  useWorkspacePermissions: () => mocks.permissions,
  useWorkspaceSlug: () => "work",
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouterState: () => "/w/work/studio/me",
}));
vi.mock("@/components/layout/app-sidebar/portals", () => ({
  SidebarBodyPortalContent: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/layout/app-sidebar/sidebar-slot-transition", () => ({
  SidebarSlotTransition: ({ children }: { children: ReactNode }) => children,
}));
function Container({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: Container,
  SidebarGroupContent: Container,
  SidebarGroupLabel: Container,
  SidebarMenu: Container,
  SidebarMenuButton: ({ render }: { render: ReactNode }) => render,
  SidebarMenuItem: Container,
}));

enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>>;
beforeEach(() => {
  mocks.permissions = clonePermissionStatements(normalizePermissionStatements(statement));
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
});
async function links() {
  rendered = await renderInAct(<StudioSidebarSlots active direction={1} />);
  return [...rendered.container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
}

describe("Studio sidebar page visibility", () => {
  it.each(STUDIO_PAGE_PATHS)(
    "hides $path without its page permission",
    async ({ action, path }) => {
      mocks.permissions = {
        ...mocks.permissions,
        page: mocks.permissions.page?.filter((value) => value !== action),
      };
      expect(await links()).not.toContain(`/w/work/studio${path}`);
    },
  );
  it.each([
    ["resumes", "resumeLibrary"],
    ["resume-pool", "resumePool"],
    ["ai-review", "aiReview"],
    ["interviews", "interview"],
    ["hiring-units", "hiringUnit"],
    ["resume-sources", "hiringUnit"],
    ["departments", "department"],
    ["interviewers", "interviewer"],
    ["job-descriptions", "jd"],
    ["forms", "candidateForm"],
    ["interview-questions", "questionTemplate"],
    ["global-config", "globalConfig"],
  ] as const)(
    "hides %s without %s read permission even with page permission",
    async (path, resource) => {
      mocks.permissions = { ...mocks.permissions, [resource]: [] };
      expect(await links()).not.toContain(`/w/work/studio/${path}`);
    },
  );
  it("requires mailbox management permission for the managed mailbox page", async () => {
    mocks.permissions = { ...mocks.permissions, mailIngestAccount: ["read"] };
    expect(await links()).not.toContain("/w/work/studio/mail-ingest-accounts");
  });
  it("shows only accessible menus for the work ODC permission snapshot", async () => {
    mocks.permissions = {
      department: ["read"],
      interviewer: ["read"],
      jd: ["read", "create", "update", "delete"],
      page: [
        "hiringUnits",
        "me",
        "jobDescriptions",
        "departments",
        "calendar",
        "aiReview",
        "resumes",
      ],
    };
    expect(await links()).toEqual([
      "/w/work/studio/calendar",
      "/w/work/studio/departments",
      "/w/work/studio/job-descriptions",
      "/w/work/studio/me",
    ]);
  });
  it("shows every menu when its page and operation permissions are granted", async () => {
    expect(await links()).toEqual(
      expect.arrayContaining(STUDIO_PAGE_PATHS.map(({ path }) => `/w/work/studio${path}`)),
    );
  });
  it("updates visible menus when the workspace permission snapshot changes", async () => {
    await links();
    mocks.permissions = { page: ["me", "calendar"] };
    const { act } = await import("react");
    act(() => rendered.root.render(<StudioSidebarSlots active direction={1} />));
    expect([...rendered.container.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "面试日程",
      "个人中心",
    ]);
  });
});
