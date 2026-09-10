// @vitest-environment jsdom
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { ResumeSourceManagementPage } from "./resume-source-management-page";
const mocks = vi.hoisted(() => ({ get: vi.fn(), permissions: new Set<string>() }));
vi.mock("@/hooks/use-has-permission", () => ({
  useHasPermission: (resource: string, action: string) =>
    mocks.permissions.has(`${resource}:${action}`),
}));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: { api: { w: { ":slug": { studio: { "resume-sources": { $get: mocks.get } } } } } },
}));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("./resume-source-children-modal", () => ({ ResumeSourceChildrenModal: () => null }));
vi.mock("./resume-source-form-dialog", () => ({ ResumeSourceFormDialog: () => null }));
vi.mock("../odc-assignment-dialog", () => ({ OdcAssignmentDialog: () => null }));
vi.mock("../odc-management-modal", () => ({ OdcManagementModal: () => null }));
vi.mock("../entity-delete-dialog", () => ({ EntityDeleteDialog: () => null }));
vi.mock("@/components/data-grid", () => ({
  DataGrid: ({ data }: { data: { name: string }[] }) => (
    <div>{data.map((row) => row.name).join(",")}</div>
  ),
  actionsColumn: vi.fn(),
  customColumn: vi.fn(),
  dateColumn: vi.fn(),
  textColumn: vi.fn(),
}));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>>;
let client: QueryClient;
beforeEach(() => {
  mocks.permissions = new Set(["page:hiringUnits"]);
  mocks.get.mockReset().mockResolvedValue({ records: [{ id: "source", name: "受限来源数据" }] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  client.clear();
});
function page() {
  return (
    <QueryClientProvider client={client}>
      <ResumeSourceManagementPage />
    </QueryClientProvider>
  );
}
it("does not request sources or expose cached rows without read access", async () => {
  client.setQueryData(["resume-sources", "work"], {
    records: [{ id: "source", name: "受限来源数据" }],
  });
  rendered = await renderInAct(page());
  expect(rendered.container.textContent).toContain("暂无查看权限");
  expect(rendered.container.textContent).not.toContain("受限来源数据");
  expect(mocks.get).not.toHaveBeenCalled();
});
it("loads with read access and hides data after permission is revoked", async () => {
  mocks.permissions.add("hiringUnit:read");
  rendered = await renderInAct(page());
  expect(mocks.get).toHaveBeenCalledOnce();
  mocks.permissions.delete("hiringUnit:read");
  act(() => rendered.root.render(page()));
  expect(rendered.container.textContent).toContain("暂无查看权限");
  expect(rendered.container.textContent).not.toContain("受限来源数据");
});
