import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withFileParseLock } from "./with-file-parse-lock";
const mocks = vi.hoisted(() => ({
  defineCommand: vi.fn(),
  eval: vi.fn(),
  runCommand: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  getResumeParseQueue: () => ({
    client: Promise.resolve(mocks),
    toKey: (key: string) => `test:${key}`,
  }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.set.mockResolvedValue("OK");
  mocks.eval.mockResolvedValue(1);
  mocks.runCommand.mockImplementation((name, args) =>
    name === "arcAcquireFileParse" ? mocks.set(...args) : mocks.eval(name, args),
  );
});
afterEach(() => vi.useRealTimers());
it("releases the file lease when processing fails", async () => {
  await expect(
    withFileParseLock("batch", "file", () => Promise.reject(new Error("parse failed"))),
  ).rejects.toThrow("parse failed");
  expect(mocks.eval).toHaveBeenCalledWith("arcReleaseFileParse", [
    expect.any(String),
    expect.any(String),
  ]);
});
it("renews the lease and prevents persistence after ownership is lost", async () => {
  mocks.eval.mockResolvedValue(0);
  await expect(
    withFileParseLock("batch", "file", async (assertOwned) => {
      await vi.advanceTimersByTimeAsync(20_000);
      assertOwned();
    }),
  ).rejects.toThrow("解析锁已失效");
  expect(mocks.eval).toHaveBeenCalledWith("arcRenewFileParse", [
    expect.any(String),
    expect.any(String),
    60_000,
  ]);
});

it("waits for the current file owner before processing another destination", async () => {
  vi.useRealTimers();
  mocks.set.mockResolvedValueOnce(null);
  const run = vi.fn(() => Promise.resolve("parsed"));
  expect(await withFileParseLock("batch", "file", run)).toBe("parsed");
  expect(mocks.set).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(1);
});
