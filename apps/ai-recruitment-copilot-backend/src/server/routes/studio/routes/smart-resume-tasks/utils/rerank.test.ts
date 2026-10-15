import { afterEach, describe, expect, it, vi } from "vitest";
import { rerankJobDocuments } from "./rerank";

afterEach(() => vi.unstubAllEnvs());

describe("job reranker adapter", () => {
  it("requests recruitment suitability and records provider usage", async () => {
    vi.stubEnv("RESUME_RERANK_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output: { results: [{ index: 0, relevance_score: 0.8 }] },
        usage: { total_tokens: 150 },
      }),
    );
    const result = await rerankJobDocuments("resume facts", ["authorized job"], fetchMock);
    expect(result.tokens).toBe(150);
    const options = fetchMock.mock.calls[0]?.[1];
    const request = JSON.parse(String(options?.body));
    expect(request.parameters.instruct).toContain("suitability for the candidate");
    expect(request.input.documents).toEqual(["authorized job"]);
  });
  it("fails visibly for provider errors and invalid document indices", async () => {
    vi.stubEnv("RESUME_RERANK_API_KEY", "test-key");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream failure", { status: 503 }));
    await expect(rerankJobDocuments("resume", ["job"], fetchMock)).rejects.toThrow("503");
    fetchMock.mockResolvedValue(
      Response.json({ output: { results: [{ index: 1, relevance_score: 0.8 }] } }),
    );
    await expect(rerankJobDocuments("resume", ["job"], fetchMock)).rejects.toThrow("结果无效");
  });
  it("makes no paid request when the authorized job set is empty", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await rerankJobDocuments("resume", [], fetchMock);
    expect(result.results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
