// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { PlatformSidebarSlots, resolvePlatformSidebarNavItem } from "../platform-sidebar-slots";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/platform/organizations",
}));
vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    Link: ({
      children,
      to,
      ...props
    }: { children: React.ReactNode; to: string } & React.HTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { ...props, href: to }, children),
    useNavigate: () => routerMocks.navigate,
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { pathname: string } }) => string;
    }) => select({ location: { pathname: routerMocks.pathname } }),
  };
});

vi.mock("@/components/layout/app-sidebar/portals", async () => {
  const React = await import("react");
  const PortalContent = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    SidebarBodyPortalContent: PortalContent,
    SidebarFooterPortalContent: PortalContent,
    SidebarHeaderPortalContent: PortalContent,
  };
});

vi.mock("@/components/layout/sidebar-user-section", async () => {
  const React = await import("react");
  return {
    SidebarUserSection: () => React.createElement("div", { "data-testid": "sidebar-user" }),
  };
});

vi.mock("@/components/ui/sidebar", async () => {
  const React = await import("react");
  const Element = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);

  return {
    SidebarGroup: Element,
    SidebarGroupContent: Element,
    SidebarGroupLabel: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
    SidebarMenu: Element,
    SidebarMenuButton: ({
      children,
      isActive,
      render,
      tooltip,
      ...props
    }: {
      children?: React.ReactNode;
      isActive: boolean;
      render?: React.ReactElement;
      tooltip: string;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.cloneElement(render ?? React.createElement("button", props, children), {
        "aria-label": props["aria-label"] ?? tooltip,
        "data-active": String(isActive),
      } as React.HTMLAttributes<HTMLElement>),
    SidebarMenuItem: Element,
    useSidebar: () => ({ state: "expanded" }),
  };
});

enableReactActEnvironment();

const roots: Awaited<ReturnType<typeof renderInAct>>["root"][] = [];

afterEach(async () => {
  for (const root of roots) {
    await unmountInAct(root);
  }
  roots.length = 0;
  routerMocks.navigate.mockReset();
  routerMocks.pathname = "/platform/organizations";
  document.body.innerHTML = "";
});

describe("PlatformSidebarSlots", () => {
  it("resolves active menu items from nested paths", () => {
    expect(resolvePlatformSidebarNavItem("/platform/users/member-1")?.title).toBe("所有用户");
    expect(resolvePlatformSidebarNavItem("/platform/pre-registrations")).toBeUndefined();
    expect(
      resolvePlatformSidebarNavItem("/platform/mastra-studio/agents/demo")?.icon,
    ).toBeUndefined();
  });

  it("keeps management navigation without a debugging entry", async () => {
    const { root } = await renderInAct(<PlatformSidebarSlots />);
    roots.push(root);

    expect(document.body.textContent).toContain("所有工作区");
    expect(document.body.textContent).not.toContain("预录入信息");
    expect(document.body.textContent).toContain("队列任务");
    expect(document.body.textContent).toContain("解析缓存");
    expect(document.body.textContent).toContain("历史简历解析");
    expect(document.body.textContent).toContain("LiveKit");
    expect(document.body.textContent).toContain("服务概览");
    expect(document.body.textContent).toContain("实时房间");
    expect(document.body.textContent).toContain("运行指标");
    expect(document.body.textContent).not.toContain("Agents");
    expect(document.body.textContent).not.toContain("调试");
    expect(document.querySelector("a[href*='mastra']")).toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>("a[href='/platform/organizations']")?.dataset
        .active,
    ).toBe("true");
  });
});
