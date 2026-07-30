import { describe, expect, it } from "vitest";
import { buildInterviewEvaluationQuestionsFromContext } from "../interview-report-questions";

describe("buildInterviewEvaluationQuestionsFromContext", () => {
  it("uses the dispatch IDs for personalized questions before template questions", () => {
    const questions = buildInterviewEvaluationQuestionsFromContext({
      personalizedQuestions: [
        {
          difficulty: "hard",
          evaluationFocus: "判断候选人的实际技术深度",
          followUpDirections: "追问候选人的个人贡献",
          order: 1,
          question: "请结合你的项目介绍最困难的技术决策。",
        },
      ],
      questionTemplates: [
        {
          bindingId: "binding-1",
          disabledByUser: false,
          scope: "job_description",
          snapshot: {
            description: null,
            jobDescriptionIds: ["job-1"],
            questions: [
              {
                content: "请介绍一次故障排查经历。",
                difficulty: "medium",
                id: "template-question-1",
                sortOrder: 0,
              },
            ],
            scope: "job_description",
            templateId: "template-1",
            title: "后端面试题",
          },
          sortOrder: 0,
          templateId: "template-1",
          version: 1,
          versionId: "version-1",
        },
      ],
    });

    expect(questions).toEqual([
      expect.objectContaining({
        order: 1,
        question: "请结合你的项目介绍最困难的技术决策。",
        questionId: "personalized-1",
      }),
      expect.objectContaining({
        order: 2,
        question: "请介绍一次故障排查经历。",
        questionId: "template-question-1",
      }),
    ]);
  });
});
