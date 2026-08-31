import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { HiringUnitAccessScope } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";

export function mergeRecruitingVisibilityScopes(
  scopes: readonly RecruitingVisibilityScope[],
): RecruitingVisibilityScope {
  if (scopes.some((scope) => scope.kind === "all")) {
    return { kind: "all" };
  }

  const userIds = [
    ...new Set(scopes.flatMap((scope) => (scope.kind === "restricted" ? scope.userIds : []))),
  ];
  return userIds.length > 0 ? { kind: "restricted", userIds } : { kind: "none" };
}

export function mergeHiringUnitAccessScopes(
  scopes: readonly HiringUnitAccessScope[],
): HiringUnitAccessScope {
  if (scopes.some((scope) => scope.canAccessAll)) {
    return { canAccessAll: true, canAccessPublic: true, hiringUnitIds: [] };
  }
  if (scopes.length === 0) {
    return { canAccessAll: false, canAccessPublic: false, hiringUnitIds: [] };
  }
  return {
    canAccessAll: false,
    canAccessPublic: scopes.some((scope) => scope.canAccessPublic),
    hiringUnitIds: [...new Set(scopes.flatMap((scope) => scope.hiringUnitIds))],
  };
}
