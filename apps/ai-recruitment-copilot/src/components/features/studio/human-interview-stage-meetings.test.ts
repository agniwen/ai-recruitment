import { describe, expect, it } from "vitest";
import type { HumanInterviewMeetingLinkBundle } from "@arc/shared/studio-pipeline-stages";
import {
  buildCandidateLinkCopy,
  buildInterviewerLinkCopy,
  formatMeetingNames,
} from "./human-interview-stage-meetings";

describe("真人面试链接发送文案", () => {
  it("includes candidate details and the confirmation link", () => {
    expect(
      buildCandidateLinkCopy({
        candidateName: "张三",
        companyName: "示例科技",
        jobDescriptionName: "前端工程师",
        roundLabel: "业务一面",
        scheduledAt: new Date(2026, 7, 5, 17, 30).toISOString(),
        url: "https://example.test/human-interview/candidate-token",
      }),
    ).toBe(
      "张三，您好：\n这是您的真人面试确认链接。\n公司：示例科技\n应聘岗位：前端工程师\n面试轮次：业务一面\n面试时间：2026-08-05 17:30\n请打开链接确认是否参加，本链接仅供本人使用，请勿转发。\nhttps://example.test/human-interview/candidate-token",
    );

    expect(
      buildCandidateLinkCopy({
        candidateName: "张三",
        companyName: null,
        jobDescriptionName: "前端工程师",
        roundLabel: "业务一面",
        scheduledAt: null,
        url: "https://example.test/human-interview/candidate-token",
      }),
    ).not.toContain("公司：");
  });

  it("includes interviewer details and handles missing schedule", () => {
    expect(
      buildInterviewerLinkCopy({
        departmentNames: "技术研发部",
        external: false,
        hiringUnitNames: "华东事业部",
        interviewerName: "李四",
        jobDescriptionName: "前端工程师",
        meetingTitle: "张三 - 业务一面",
        roleLabel: "面试官",
        scheduledAt: null,
        url: "https://example.test/human-interview/interviewer-token",
      }),
    ).toBe(
      "李四，您好：\n这是「张三 - 业务一面」真人面试的面试官会议链接。\n岗位：前端工程师\n用人组织：华东事业部\n部门：技术研发部\n您本次的会议身份为面试官，请使用本人账号打开，本链接请勿转发。\nhttps://example.test/human-interview/interviewer-token",
    );

    expect(
      buildInterviewerLinkCopy({
        departmentNames: null,
        external: true,
        hiringUnitNames: null,
        interviewerName: "王五",
        jobDescriptionName: "前端工程师",
        meetingTitle: "张三 - 业务一面",
        roleLabel: "面试官",
        scheduledAt: null,
        url: "https://example.test/human-interview/external-token",
      }),
    ).toContain("您本次的会议身份为面试官，无需登录即可打开");
  });

  it("deduplicates department and organization names for shared meetings", () => {
    const links: HumanInterviewMeetingLinkBundle = {
      candidateLinks: [
        {
          candidateName: "张三",
          companyName: null,
          departmentName: "技术研发部",
          expiresAt: "2026-08-06T09:30:00.000Z",
          hiringUnitName: "华东事业部",
          interviewRecordId: "candidate-1",
          jobDescriptionName: "前端工程师",
          roundId: "round-1",
          roundLabel: "业务一面",
          url: "/human-interview/candidate-1",
        },
        {
          candidateName: "王五",
          companyName: null,
          departmentName: "技术研发部",
          expiresAt: "2026-08-06T09:30:00.000Z",
          hiringUnitName: "华东事业部",
          interviewRecordId: "candidate-2",
          jobDescriptionName: "前端工程师",
          roundId: "round-2",
          roundLabel: "业务一面",
          url: "/human-interview/candidate-2",
        },
      ],
      interviewerLinks: [],
      meetingId: "meeting-1",
      title: "真人面试",
    };

    expect(formatMeetingNames(links, "departmentName")).toBe("技术研发部");
    expect(formatMeetingNames(links, "hiringUnitName")).toBe("华东事业部");
  });
});
