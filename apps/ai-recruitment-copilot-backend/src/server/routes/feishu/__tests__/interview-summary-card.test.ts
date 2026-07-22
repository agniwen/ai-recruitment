import { cardToFeishuPayload } from "@arc/adapter-feishu";
import { toCardElement } from "chat";
import { describe, expect, it } from "vitest";
import { InterviewSummaryCard } from "../utils/interview-summary-card";

describe("InterviewSummaryCard", () => {
  it("links the notification to the Feishu evaluation document", () => {
    const card = toCardElement(
      InterviewSummaryCard({
        assessment: "整体匹配度较高。",
        candidateName: "张三",
        detailUrl: "https://feishu.cn/docx/docx-1",
        overallScore: "86/100",
        recommendation: "推荐进入下一轮",
        summary: "候选人对项目经历说明完整。",
        targetRole: "前端工程师",
      }),
    );
    expect(card).not.toBeNull();
    if (!card) {
      throw new Error("Expected InterviewSummaryCard to resolve to a Chat SDK card");
    }
    const payload = cardToFeishuPayload(card, { headerTemplate: "green" });

    expect(payload.header?.template).toBe("green");
    expect(JSON.stringify(payload)).toContain("查看飞书评价表");
    expect(JSON.stringify(payload)).toContain("https://feishu.cn/docx/docx-1");
  });
});
