// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import { OfferRecruiterContact, OfferRecruiterContactForUploader } from "./offer-recruiter-contact";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ current: vi.fn(), get: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({
  getCurrentOfferRecruiterContact: mocks.current,
  getOfferRecruiterContact: mocks.get,
  submitOfferRecruiterContact: mocks.submit,
}));

const roots: ReturnType<typeof createRoot>[] = [];
const clients: QueryClient[] = [];

function context(overrides: Partial<OfferRecruiterContactState> = {}): OfferRecruiterContactState {
  return {
    canConfirm: true,
    candidateDetailUrl: "https://ats.example.test/w/demo/studio/resumes/candidate-1",
    candidateName: "候选人甲",
    candidatePrivateTelegram: "@candidate_123",
    draftId: "offer-1",
    interviewRecordId: "candidate-1",
    notificationIssue: "招聘人员尚未绑定机器人，请在系统中补充，或先私聊机器人发送 /start。",
    organizationId: "org-1",
    position: "工程师",
    recruiterName: "招聘人员甲",
    revision: 2,
    status: "pending" as const,
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(context());
  mocks.current.mockResolvedValue(null);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  for (const client of clients.splice(0)) {
    client.clear();
  }
  document.body.innerHTML = "";
});

async function renderContact(overrides: Partial<OfferDraftRecord> = {}, disabled = false) {
  const draft: OfferDraftRecord = {
    approvalAttachment: null,
    baseSalary: 30_000,
    bonus: null,
    candidateCounter: null,
    createdAt: "2026-10-22T00:00:00.000Z",
    currency: "CNY",
    equity: null,
    expiresAt: null,
    id: "offer-1",
    interviewRecordId: "candidate-1",
    joiningDate: null,
    notes: null,
    organizationId: "org-1",
    position: "工程师",
    recruiterConfirmationStatus: "pending",
    responseAt: null,
    sentAt: null,
    sscConfirmationStatus: "pending",
    sscRevision: 2,
    status: "draft",
    updatedAt: "2026-10-22T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const onSaved = vi.fn();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <OfferRecruiterContact
          candidateId="candidate-1"
          disabled={disabled}
          draft={draft}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(async () => {
    await act(() => Promise.resolve());
    expect(host.textContent).not.toContain("正在核对招聘人员信息");
  });
  return { client, host, onSaved };
}

function fillInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitButton(host: HTMLElement) {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "确认并提交 SSC",
  );
}

function contactInput(host: HTMLElement) {
  const input = host.querySelector("input");
  if (!input) {
    throw new Error("Missing candidate private TG input");
  }
  return input;
}

describe("Offer recruiter private TG confirmation", () => {
  it("prefills the saved private TG while explaining an unavailable recruiter notification", async () => {
    const { host } = await renderContact();
    expect(host.textContent).toContain("待招聘人员确认私人 TG");
    expect(host.textContent).toContain("招聘人员甲");
    expect(host.textContent).toContain("尚未绑定机器人");
    expect(host.querySelector("input")?.value).toBe("@candidate_123");
    expect(submitButton(host)?.disabled).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("requires a valid private TG before submitting to SSC", async () => {
    const { host } = await renderContact();
    fillInput(contactInput(host), "https://example.com/candidate");
    await act(() => submitButton(host)?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("TG");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("normalizes a Telegram link and submits the current revision only after confirmation", async () => {
    const pending = Promise.withResolvers<OfferRecruiterContactState>();
    mocks.submit.mockReturnValue(pending.promise);
    const { host, onSaved } = await renderContact();
    fillInput(contactInput(host), "https://t.me/candidate_new");
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(() => submitButton(host)?.click());
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("demo", "candidate-1", "offer-1", {
      candidatePrivateTelegram: "@candidate_new",
      revision: 2,
    });
    expect([...host.querySelectorAll("button")].some((button) => button.disabled)).toBe(true);
    await act(async () => {
      pending.resolve(context({ candidatePrivateTelegram: "@candidate_new", status: "completed" }));
      await Promise.resolve();
    });
    await vi.waitFor(async () => {
      await act(() => Promise.resolve());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(host.textContent).toContain("@candidate_new");
      expect(submitButton(host)).toBeUndefined();
    });
  });

  it("keeps the entered TG visible when the server rejects a stale revision", async () => {
    mocks.submit.mockRejectedValue(new Error("Offer 内容已变更，请刷新后重新确认。"));
    const { host, onSaved } = await renderContact();
    fillInput(contactInput(host), "@candidate_new");
    await act(() => submitButton(host)?.click());
    await vi.waitFor(async () => {
      await act(() => Promise.resolve());
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("Offer 内容已变更");
    });
    expect(host.querySelector("input")?.value).toBe("@candidate_new");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not expose a form to a viewer who cannot confirm this candidate's contact", async () => {
    mocks.get.mockResolvedValue(context({ canConfirm: false }));
    const { host } = await renderContact();
    expect(host.textContent).toContain("招聘人员甲");
    expect(host.querySelector("input")).toBeNull();
    expect(submitButton(host)).toBeUndefined();
  });

  it("leaves historical Offers outside the new contact workflow", async () => {
    const { host } = await renderContact({ recruiterConfirmationStatus: null });
    expect(host.textContent).toBe("");
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

async function renderUploaderContact() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <OfferRecruiterContactForUploader candidateId="candidate-1" />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(async () => {
    await act(() => Promise.resolve());
    expect(
      client.getQueryState(["offer-recruiter-contact-current", "demo", "candidate-1"])?.fetchStatus,
    ).toBe("idle");
  });
  return host;
}

describe("Uploader contact entry without Offer read permission", () => {
  it("shows the uploader's dedicated form from safe contact metadata only", async () => {
    mocks.current.mockResolvedValue(context());
    const host = await renderUploaderContact();
    await vi.waitFor(async () => {
      await act(() => Promise.resolve());
      expect(host.querySelector("input")?.value).toBe("@candidate_123");
    });
    expect(mocks.current).toHaveBeenCalledWith("demo", "candidate-1");
    expect(host.textContent).toContain("待招聘人员确认私人 TG");
    expect(host.querySelector("input")?.value).toBe("@candidate_123");
    expect(submitButton(host)?.disabled).toBe(false);
    expect(host.textContent).not.toContain("30,000");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each([null, context({ canConfirm: false })])(
    "does not expose an irrelevant contact form: %j",
    async (value) => {
      mocks.current.mockResolvedValue(value);
      const host = await renderUploaderContact();
      expect(host.textContent).toBe("");
      expect(host.querySelector("input")).toBeNull();
    },
  );

  it("quietly hides a forbidden current contact entry", async () => {
    mocks.current.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const host = await renderUploaderContact();
    expect(host.textContent).toBe("");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
