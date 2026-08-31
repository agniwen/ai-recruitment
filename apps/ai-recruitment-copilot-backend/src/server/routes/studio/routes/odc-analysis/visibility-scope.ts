import { and, eq } from "drizzle-orm";
import { resolveRecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  EMPTY_HIRING_UNIT_SCOPE,
  resolveHiringUnitAccessScope,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import type { HiringUnitAccessScope } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import { member, organizationRole } from "@arc/db-schema/schema";
import { odcRoleCondition } from "./utils/role-filter";
import {
  mergeHiringUnitAccessScopes,
  mergeRecruitingVisibilityScopes,
} from "./visibility-scope-merge";

export interface OdcAnalysisVisibilityScope {
  hiringUnits: HiringUnitAccessScope;
  recruiting: RecruitingVisibilityScope;
}

export async function resolveOdcAnalysisVisibilityScope(
  organizationId: string,
): Promise<OdcAnalysisVisibilityScope> {
  const odcRoles = await db
    .select({ role: organizationRole.role })
    .from(organizationRole)
    .where(
      and(eq(organizationRole.organizationId, organizationId), eq(organizationRole.isOdc, true)),
    );
  const roleNames = odcRoles.map(({ role }) => role);
  if (roleNames.length === 0) {
    return { hiringUnits: EMPTY_HIRING_UNIT_SCOPE, recruiting: { kind: "none" } };
  }

  const odcMembers = await db
    .select({ role: member.role, userId: member.userId })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), odcRoleCondition(member.role, roleNames)),
    );
  const memberScopes = await Promise.all(
    odcMembers.map(async ({ role, userId }) => {
      const [recruiting, hiringUnits] = await Promise.all([
        resolveRecruitingVisibilityScope({ currentRole: role, organizationId, userId }),
        resolveHiringUnitAccessScope({ actorUserId: userId, organizationId }),
      ]);
      return { hiringUnits, recruiting };
    }),
  );

  return {
    hiringUnits: mergeHiringUnitAccessScopes(memberScopes.map(({ hiringUnits }) => hiringUnits)),
    recruiting: mergeRecruitingVisibilityScopes(memberScopes.map(({ recruiting }) => recruiting)),
  };
}
