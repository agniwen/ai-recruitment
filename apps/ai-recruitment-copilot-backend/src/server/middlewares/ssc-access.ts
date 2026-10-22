import { factory } from "../factory";
import type { Context } from "hono";
import type { Env } from "../type";
import {
  findSscPublicCandidate,
  isSscCandidateVisible,
  resolveSscAccessActor,
} from "../access/ssc-access";
import type { SscAccessActor } from "../access/ssc-access";

// Cache only inside the same Hono request, never across users or requests.
const actors = new WeakMap<Context<Env>, Promise<SscAccessActor | null>>();

function requestActor(c: Context<Env>) {
  const { activeOrg, member, user } = c.var;
  if (!activeOrg || !user) {
    return Promise.resolve(null);
  }
  let actor = actors.get(c);
  if (!actor) {
    actor = resolveSscAccessActor({
      currentRole: member?.role,
      organizationId: activeOrg.id,
      userId: user.id,
    });
    actors.set(c, actor);
  }
  return actor;
}

function decodeSegment(value: string | undefined) {
  if (!value) {
    return;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed path segment cannot identify an authorized candidate.
  }
}

function offerDraftId(path: string) {
  const value = /\/offer-drafts\/([^/]+)(?:\/|$)/u.exec(path)?.[1];
  return value === "ssc" || value === "with-attachment" || value === "creation-context"
    ? undefined
    : decodeSegment(value);
}

export function requireSscCandidateAccess() {
  return factory.createMiddleware(async (c, next) => {
    const actor = await requestActor(c);
    if (!actor) {
      return next();
    }
    const candidateId = c.req.param("id");
    if (
      !candidateId ||
      !(await isSscCandidateVisible({ actor, candidateId, draftId: offerDraftId(c.req.path) }))
    ) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    return next();
  });
}

export function guardSscWorkspaceSurface() {
  return factory.createMiddleware(async (c, next) => {
    const actor = await requestActor(c);
    if (!actor) {
      return next();
    }
    const { path } = c.req;
    const preOfferSurface =
      /\/studio\/(?:ai-review|resume-pool|resume-upload-batches|smart-resume-tasks|odc-analysis)(?:\/|$)/u.test(
        path,
      ) ||
      /\/w\/[^/]+\/(?:chat|resume\/chat|interview)(?:\/|$)/u.test(path) ||
      /\/studio\/job-descriptions\/[^/]+\/recommendations(?:\/|$)/u.test(path) ||
      /\/studio\/resumes\/(?:skill-suggestions|dedup-check)(?:\/|$)/u.test(path) ||
      /\/studio\/resumes\/[^/]+\/duplicate-matches(?:\/|$)/u.test(path);
    if (preOfferSurface) {
      return c.json({ error: "SSC 仅可访问进入 Offer 确认流程的负责候选人。" }, 403);
    }
    if (/\/studio\/interviews(?:\/|$)/u.test(path)) {
      const candidatePath =
        /\/studio\/interviews\/([^/]+)\/(?:offer-drafts|human-interview-rounds|candidate-expectations|transition)(?:\/|$)/u.exec(
          path,
        );
      const candidateId = decodeSegment(candidatePath?.[1]);
      if (!candidateId) {
        return c.json({ error: "SSC 仅可通过候选人页面访问 Offer 确认流程。" }, 403);
      }
      if (!(await isSscCandidateVisible({ actor, candidateId, draftId: offerDraftId(path) }))) {
        return c.json({ error: "候选人记录不存在。" }, 404);
      }
    }
    return next();
  });
}

/** Existing anonymous sharing remains unchanged; authenticated SSCs keep their scope. */
export function guardSscPublicSurface() {
  return factory.createMiddleware(async (c, next) => {
    if (!c.var.user) {
      return next();
    }
    const { path } = c.req;
    const resume = /\/public\/resumes\/([^/]+)(?:\/|$)/u.exec(path);
    const round = /\/public\/interview-rounds\/([^/]+)(?:\/|$)/u.exec(path);
    const candidateInterview = /\/api\/interview\/([^/]+)(?:\/|$)/u.exec(path);
    const segment =
      round?.[1] === "resolve"
        ? c.req.query("id")
        : (resume?.[1] ?? round?.[1] ?? candidateInterview?.[1]);
    const id = decodeSegment(segment);
    if (!id) {
      return next();
    }
    const target = await findSscPublicCandidate({ id, round: Boolean(round) });
    if (!target) {
      return next();
    }
    const actor = await resolveSscAccessActor({
      organizationId: target.organizationId,
      userId: c.var.user.id,
    });
    if (actor && !(await isSscCandidateVisible({ actor, candidateId: target.candidateId }))) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    return next();
  });
}
