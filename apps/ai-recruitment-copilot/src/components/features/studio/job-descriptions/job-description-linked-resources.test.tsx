// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import {
  LinkedFormsList,
  LinkedInterviewQuestionTemplatesList,
} from "./job-description-linked-resources";
const mocks = vi.hoisted(() => ({ canRead: false }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@/hooks/use-has-permission", () => ({ useHasPermission: () => mocks.canRead }));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>>;
beforeEach(() => {
  mocks.canRead = false;
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
});
describe.each([LinkedFormsList, LinkedInterviewQuestionTemplatesList])(
  "job-linked template summaries",
  (Component) => {
    const templates = [
      { description: "描述", id: "template", questionCount: 2, title: "岗位题目" },
    ];
    it("shows summaries without linking to a forbidden management page", async () => {
      rendered = await renderInAct(
        <Component jobDescriptionId="job" isLoading={false} templates={templates} />,
      );
      expect(rendered.container.textContent).toContain("岗位题目");
      expect(rendered.container.textContent).toContain("2 题");
      expect(rendered.container.querySelector("a")).toBeNull();
      expect(rendered.container.querySelector("button")).toBeNull();
    });
    it("keeps management links for users who can open the corresponding page", async () => {
      mocks.canRead = true;
      rendered = await renderInAct(
        <Component jobDescriptionId="job" isLoading={false} templates={templates} />,
      );
      expect(rendered.container.querySelectorAll("a")).toHaveLength(2);
    });
    it("does not misrepresent a failed linked query as no associated templates", async () => {
      rendered = await renderInAct(
        <Component
          jobDescriptionId="job"
          isLoading={false}
          templates={[]}
          error={new Error("加载岗位关联题目失败")}
        />,
      );
      expect(rendered.container.textContent).toContain("加载岗位关联题目失败");
      expect(rendered.container.textContent).not.toContain("暂无该岗位");
    });
  },
);
