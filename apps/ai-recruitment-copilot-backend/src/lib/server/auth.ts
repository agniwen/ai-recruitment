import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, genericOAuth } from "better-auth/plugins";
import type { GenericOAuthConfig } from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { and, eq } from "drizzle-orm";
import { uniq } from "lodash-es";
import { getAuthRequestHeaders } from "@arc/ai-recruitment-copilot-backend/lib/server/auth-request-context";
import { AUTH_RATE_LIMIT } from "@arc/ai-recruitment-copilot-backend/lib/server/auth-rate-limit";
import { getAuthTransportOptions } from "@arc/ai-recruitment-copilot-backend/lib/server/auth-transport";
import {
  attemptsDynamicRoleIdentifierUpdate,
  hasConflictingRoleClassifications,
} from "@arc/ai-recruitment-copilot-backend/lib/server/auth-role-policy";
import { provisionSscUserOnSignIn } from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import { getRequiredEnv } from "@arc/ai-recruitment-copilot-backend/lib/server/env";
import { getFeishuTenantAccessToken } from "@arc/ai-recruitment-copilot-backend/lib/server/feishu-access-token";
import {
  canAssignWorkspaceRole,
  dynamicWorkspaceRoleExists,
  isNoAccessWorkspaceRole,
} from "@arc/ai-recruitment-copilot-backend/server/access/workspace-roles";
import {
  addMemberToDefaultRecruitingGroup,
  ensureDefaultRecruitingGroupForWorkspace,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/workspace/dao";
import { provisionPreRegisteredUser } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/pre-registrations/provisioning";
import { ac, isWorkspaceAdministratorRole, roles } from "@arc/shared/permissions";
import { optionalUserTelegramSchema } from "@arc/shared/user-profile";
import { db } from "./db";
import * as schema from "@arc/db-schema/schema";
import { encryptIp, sessionIpContext } from "./ip-encryption";
import { requireRecentMfa, SecurityError } from "../../server/routes/security/mfa/service";

const baseURL = getRequiredEnv("BETTER_AUTH_URL");
const trustedOrigins = uniq([baseURL, "http://localhost:3000"]);

function pickFirstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => typeof v === "string" && v.length > 0);
}

function isBuiltInAdminAssignableRole(role: string): boolean {
  return role === "member" || isNoAccessWorkspaceRole(role);
}

function isBuiltInOwnerAssignableRole(role: string): boolean {
  return role === "admin" || isBuiltInAdminAssignableRole(role);
}

async function canOwnerSetRole(organizationId: string, role: string): Promise<boolean> {
  return (
    isBuiltInOwnerAssignableRole(role) || (await dynamicWorkspaceRoleExists(organizationId, role))
  );
}

interface FeishuTokenResponse {
  code?: number;
  msg?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface FeishuUserInfoResponse {
  code: number;
  msg: string;
  data?: {
    open_id: string;
    union_id?: string;
    user_id?: string;
    tenant_key?: string;
    name?: string;
    en_name?: string;
    email?: string;
    enterprise_email?: string;
    mobile?: string;
    avatar_url?: string;
  };
}

interface FeishuTenantQueryResponse {
  code: number;
  msg: string;
  data?: {
    tenant?: {
      name?: string;
      display_id?: string;
      tenant_tag?: number;
      tenant_key?: string;
      avatar?: Record<string, string>;
    };
  };
}

async function fetchFeishuOrganizationName(
  appId: string,
  appSecret: string,
): Promise<string | null> {
  try {
    const token = await getFeishuTenantAccessToken(appId, appSecret);
    const res = await fetch("https://open.feishu.cn/open-apis/tenant/v2/tenant/query", {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as FeishuTenantQueryResponse;
    if (json.code !== 0) {
      return null;
    }
    return json.data?.tenant?.name ?? null;
  } catch {
    // Org name is best-effort; don't block login on failure.
    return null;
  }
}

interface FeishuOAuthProviderOptions {
  providerId: string;
  appId: string;
  appSecret: string;
}

function buildFeishuOAuthProvider(opts: FeishuOAuthProviderOptions): GenericOAuthConfig {
  const { appId, appSecret, providerId } = opts;
  // oxlint-disable-next-line sort-keys -- OAuth config keeps related fields grouped (id/secret, token/endpoints), not alphabetical.
  return {
    providerId,
    clientId: appId,
    clientSecret: appSecret,
    authorizationUrl: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
    // Required by the plugin's config validation, but not actually called —
    // `getToken` below handles the JSON-only v2 token exchange.
    tokenUrl: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
    scopes: ["contact:user.base:readonly", "contact:user.email:readonly"],
    async getToken({ code, redirectURI }) {
      const res = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
        body: JSON.stringify({
          client_id: appId,
          client_secret: appSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectURI,
        }),
        headers: { "content-type": "application/json; charset=utf-8" },
        method: "POST",
      });
      const json = (await res.json()) as FeishuTokenResponse;
      if (!res.ok || !json.access_token) {
        throw new Error(
          `Feishu token exchange failed: ${json.code ?? res.status} ${json.msg ?? ""}`,
        );
      }
      return {
        accessToken: json.access_token,
        accessTokenExpiresAt: json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000)
          : undefined,
        raw: json as unknown as Record<string, unknown>,
        refreshToken: json.refresh_token,
        refreshTokenExpiresAt: json.refresh_token_expires_in
          ? new Date(Date.now() + json.refresh_token_expires_in * 1000)
          : undefined,
        scopes: json.scope?.split(" ").filter(Boolean),
        tokenType: json.token_type ?? "Bearer",
      };
    },
    async getUserInfo(tokens) {
      const [userInfoRes, organizationName] = await Promise.all([
        fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        }),
        fetchFeishuOrganizationName(appId, appSecret),
      ]);
      const json = (await userInfoRes.json()) as FeishuUserInfoResponse;
      if (json.code !== 0 || !json.data) {
        return null;
      }
      const { data } = json;
      const email =
        pickFirstNonEmpty(data.enterprise_email, data.email) ?? `${data.open_id}@feishu.local`;
      const name = pickFirstNonEmpty(data.name, data.en_name) ?? data.open_id;
      return {
        email,
        emailVerified: false,
        feishuTenantKey: pickFirstNonEmpty(data.tenant_key),
        feishuTenantName: organizationName ?? undefined,
        id: data.open_id,
        image: pickFirstNonEmpty(data.avatar_url),
        name,
      };
    },
  };
}

// HTTPS production retains proxy-aware Secure cookies. Only an explicitly
// enabled deployment with a literal private HTTP IP can use HTTP cookies.
const advanced = getAuthTransportOptions({
  baseURL,
  localHttpAuthEnabled: process.env.LOCAL_HTTP_AUTH_ENABLED,
  nodeEnv: process.env.NODE_ENV,
});

type RolePolicyGetSession = (headers: Headers) => Promise<{
  user: { id: string };
} | null>;

const ROLE_POLICY_ACTIONS: Record<string, "create" | "update" | "delete" | undefined> = {
  "/organization/create-role": "create",
  "/organization/delete-role": "delete",
  "/organization/update-role": "update",
};

function isRoleClassificationPatch(patch: unknown): boolean {
  return Boolean(patch && typeof patch === "object" && ("isOdc" in patch || "isSsc" in patch));
}

function readDynamicRolePolicyRequest(path: string, body: unknown) {
  const action = ROLE_POLICY_ACTIONS[path];
  if (!action || !body || typeof body !== "object") {
    return null;
  }
  const fields = body as Record<string, unknown>;
  if (action === "update" && !isRoleClassificationPatch(fields.data)) {
    return null;
  }
  return { action, fields };
}

async function requireRolePolicyOrganization(
  fields: Record<string, unknown>,
  getSession: RolePolicyGetSession,
): Promise<string> {
  const headers = getAuthRequestHeaders();
  if (!headers) {
    throw new APIError("UNAUTHORIZED", { message: "未登录。" });
  }
  const session = await getSession(headers);
  if (!session?.user) {
    throw new APIError("UNAUTHORIZED", { message: "未登录。" });
  }
  const { organizationId } = fields;
  if (typeof organizationId !== "string" || !organizationId) {
    throw new APIError("BAD_REQUEST", { message: "请选择工作区。" });
  }
  const [invoker] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, session.user.id),
        eq(schema.user.banned, false),
      ),
    )
    .limit(1);
  if (!isWorkspaceAdministratorRole(invoker?.role)) {
    throw new APIError("FORBIDDEN", { message: "只有工作区管理员可以管理角色。" });
  }
  return organizationId;
}

async function loadRolePolicyTarget(fields: Record<string, unknown>, organizationId: string) {
  const roleId = typeof fields.roleId === "string" ? fields.roleId : null;
  const roleName = typeof fields.roleName === "string" ? fields.roleName : null;
  if (!roleId && !roleName) {
    throw new APIError("BAD_REQUEST", { message: "请选择角色。" });
  }
  const [current] = await db
    .select({
      isOdc: schema.organizationRole.isOdc,
      isSsc: schema.organizationRole.isSsc,
      role: schema.organizationRole.role,
    })
    .from(schema.organizationRole)
    .where(
      and(
        eq(schema.organizationRole.organizationId, organizationId),
        roleId ? eq(schema.organizationRole.id, roleId) : undefined,
        roleName ? eq(schema.organizationRole.role, roleName) : undefined,
      ),
    )
    .limit(1);
  if (!current) {
    throw new APIError("BAD_REQUEST", { message: "角色不存在或不属于当前工作区。" });
  }
  return current;
}

async function assertRoleNotReferencedBySsc(organizationId: string, role: string) {
  const [reference] = await db
    .select({ id: schema.sscResponsibility.id })
    .from(schema.sscResponsibility)
    .where(
      and(
        eq(schema.sscResponsibility.organizationId, organizationId),
        eq(schema.sscResponsibility.workspaceRole, role),
      ),
    )
    .limit(1);
  if (reference) {
    throw new APIError("CONFLICT", { message: "该角色仍被 SSC 负责组织引用，请先调整对应关系。" });
  }
}

async function validateDynamicRoleClassification(
  path: string,
  body: unknown,
  getSession: RolePolicyGetSession,
): Promise<void> {
  const request = readDynamicRolePolicyRequest(path, body);
  if (!request) {
    return;
  }
  const { action, fields } = request;
  if (action === "create") {
    if (hasConflictingRoleClassifications(fields.additionalFields)) {
      throw new APIError("BAD_REQUEST", { message: "同一角色不能同时设为 ODC 和 SSC 审核。" });
    }
    return;
  }
  const organizationId = await requireRolePolicyOrganization(fields, getSession);
  const current = await loadRolePolicyTarget(fields, organizationId);
  if (action === "update" && hasConflictingRoleClassifications(fields.data, current)) {
    throw new APIError("BAD_REQUEST", { message: "同一角色不能同时设为 ODC 和 SSC 审核。" });
  }
  if (action === "delete") {
    await assertRoleNotReferencedBySsc(organizationId, current.role);
  }
}

export const auth = betterAuth({
  advanced,
  appName: "招聘 AI 协同工作台",
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  // 登录时只更新时间偏好；工作区权限上下文永远由具体请求 URL 决定。
  // Login only updates durable activity metadata. Workspace authorization is
  // always derived from the current request URL.
  databaseHooks: {
    session: {
      create: {
        // oxlint-disable-next-line require-await -- hook contract requires async
        async after(newSession) {
          // user.lastActiveAt survives logout / session expiry and is only
          // operational metadata, never an authorization input.
          try {
            await db
              .update(schema.user)
              .set({ lastActiveAt: newSession.createdAt ?? new Date() })
              .where(eq(schema.user.id, newSession.userId));
          } catch (error) {
            console.warn("[auth] failed to stamp user.lastActiveAt", error);
          }
          try {
            const [sessionUser] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, newSession.userId))
              .limit(1);
            if (sessionUser) {
              try {
                await provisionSscUserOnSignIn({
                  email: sessionUser.email,
                  userId: newSession.userId,
                });
              } catch (error) {
                console.warn("[auth] failed to apply SSC pre-entry", error);
              }
              await provisionPreRegisteredUser({
                email: sessionUser.email,
                userId: newSession.userId,
              });
            }
          } catch (error) {
            console.warn("[auth] failed to apply workspace pre-registration", error);
          }
        },
        async before(newSession) {
          return {
            data: {
              ...newSession,
              ipAddress: null,
              ipCiphertext: await encryptIp(
                newSession.ipAddress,
                sessionIpContext(newSession.userId, newSession.token),
              ),
            },
          };
        },
      },
      update: {
        // oxlint-disable-next-line require-await -- Better Auth requires an async database hook.
        async before(updatedSession) {
          // Better Auth refreshes expiry, not network evidence. Never reintroduce raw IPs.
          return "ipAddress" in updatedSession
            ? { data: { ...updatedSession, ipAddress: null } }
            : undefined;
        },
      },
    },
    user: {
      update: {
        async after(updatedUser) {
          if (updatedUser.role !== "admin" || updatedUser.banned) {
            await db
              .delete(schema.platformMfaGrant)
              .where(eq(schema.platformMfaGrant.userId, updatedUser.id));
          }
        },
        // oxlint-disable-next-line require-await -- hook contract requires async
        async before(updatedUser) {
          if (!("telegram" in updatedUser)) {
            return;
          }
          const result = optionalUserTelegramSchema.safeParse(updatedUser.telegram);
          if (!result.success) {
            throw new APIError("BAD_REQUEST", {
              message: result.error.issues[0]?.message ?? "TG 号格式无效。",
            });
          }
          return { data: { ...updatedUser, telegram: result.data } };
        },
      },
    },
  },
  // 开启邮箱+密码登录。注册入口关闭——账号只能通过飞书 OAuth 自动创建，
  // 或由 admin 在「用户管理」里调 setUserPassword 设定登录密码。
  // Email+password sign-in. Public sign-up is disabled — accounts are only
  // created via Feishu OAuth or by admin's setUserPassword from the user-mgmt page.
  emailAndPassword: {
    autoSignIn: true,
    disableSignUp: true,
    enabled: true,
    minPasswordLength: 8,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Better Auth admin endpoints run outside the Hono platform router.
      if (ctx.path.startsWith("/admin/")) {
        const current = await getSessionFromCtx(ctx);
        if (!current || current.user.role !== "admin") {
          throw new APIError("FORBIDDEN", { message: "无权访问平台后台。" });
        }
        try {
          await requireRecentMfa(
            { sessionId: current.session.id, userId: current.user.id },
            ctx.headers ?? new Headers(),
          );
        } catch (error) {
          throw new APIError("FORBIDDEN", {
            code: error instanceof SecurityError ? error.code : "SECURITY_UNAVAILABLE",
            message: "请先在平台后台完成两步验证。",
          });
        }
      }
      if (attemptsDynamicRoleIdentifierUpdate(ctx.path, ctx.body)) {
        throw new APIError("BAD_REQUEST", {
          message: "角色标识创建后不可更改。",
        });
      }
      await validateDynamicRoleClassification(ctx.path, ctx.body, (headers) =>
        auth.api.getSession({ headers }),
      );
    }),
  },
  // 被封禁用户走 OAuth 回调时 better-auth 会重定向到 `${errorURL}?error=banned&...`。
  // 指向 /login —— 那边的 LoginErrorToast 会把 error_description 弹成 toast，
  // 顺手清掉 URL 参数防止刷新重复弹。
  // For OAuth callbacks of banned accounts better-auth redirects to
  // `${errorURL}?error=banned&...`. Point at /login — its LoginErrorToast
  // surfaces the message via toast and strips the params from the URL.
  onAPIError: {
    errorURL: "/login",
  },
  plugins: [
    admin({
      // Better Auth currently interpolates this value into the OAuth redirect
      // Location header without URL encoding. Keep it ASCII-safe and translate
      // the marker on the frontend.
      bannedUserMessage: "banned",
    }),
    genericOAuth({
      config: [
        buildFeishuOAuthProvider({
          appId: getRequiredEnv("FEISHU_APP_ID"),
          appSecret: getRequiredEnv("FEISHU_APP_SECRET"),
          providerId: "feishu",
        }),
        buildFeishuOAuthProvider({
          appId: getRequiredEnv("FEISHU_APP_ID2"),
          appSecret: getRequiredEnv("FEISHU_APP_SECRET2"),
          providerId: "feishu-jiguang-hr",
        }),
      ],
    }),
    organization({
      ac,
      dynamicAccessControl: {
        enabled: true,
      },
      // Workspace administrators and owners share member-management capabilities.
      organizationHooks: {
        afterAcceptInvitation: async ({ invitation, member: acceptedMember, user }) => {
          if (isNoAccessWorkspaceRole(acceptedMember.role) || acceptedMember.role !== "member") {
            return;
          }
          await addMemberToDefaultRecruitingGroup({
            createdBy: invitation.inviterId,
            organizationId: acceptedMember.organizationId,
            userId: user.id,
          });
        },
        afterCreateOrganization: async ({ organization: org, user }) => {
          await ensureDefaultRecruitingGroupForWorkspace({
            creatorUserId: user.id,
            organizationId: org.id,
          });
        },
        // Clear only the durable landing preference. The member row remains
        // the authorization source, so no session-wide tenant mutation is needed.
        afterRemoveMember: async ({ member: removed, organization: org }) => {
          try {
            await db
              .update(schema.user)
              .set({ lastActiveOrganizationId: null })
              .where(
                and(
                  eq(schema.user.id, removed.userId),
                  eq(schema.user.lastActiveOrganizationId, org.id),
                ),
              );
          } catch (error) {
            console.warn("[auth] failed to clear stale workspace preference", error);
          }
        },
        beforeCreateInvitation: async ({ invitation, inviter, organization: org }) => {
          const [invoker] = await db
            .select({ role: schema.member.role })
            .from(schema.member)
            .where(
              and(eq(schema.member.userId, inviter.id), eq(schema.member.organizationId, org.id)),
            )
            .limit(1);

          if (!invoker) {
            throw new APIError("FORBIDDEN", { message: "你不在这个工作区中。" });
          }

          const requestedRoles = invitation.role
            .split(",")
            .map((role) => role.trim())
            .filter(Boolean);
          const allowed = await Promise.all(
            requestedRoles.map((role) =>
              canAssignWorkspaceRole({
                invokerRole: invoker.role,
                organizationId: org.id,
                targetRole: role,
              }),
            ),
          );
          if (requestedRoles.length === 0 || allowed.some((ok) => !ok)) {
            throw new APIError("FORBIDDEN", {
              message: "无权邀请为所选工作区角色。",
            });
          }
        },
        beforeUpdateMemberRole: async ({ newRole, organization: org }) => {
          // ⚠️ 注意：better-auth 这里的 `user` 参数实际是 **目标用户**（被改的人），
          // 不是触发请求的人——文档跟实现不一致，源码里写的是
          // `user: userBeingUpdated`（见 better-auth crud-members.mjs:283）。
          // 所以这里完全不用 `user`，而是从当前 auth 请求上下文拿 headers，再用
          // auth.api.getSession 拿到真正的 invoker。
          //
          // CAUTION: better-auth's `user` arg here is the TARGET user, not the
          // caller (the docs are wrong; source assigns `user: userBeingUpdated`).
          // Skip it entirely and pull the real invoker from the session.
          const authRequestHeaders = getAuthRequestHeaders();
          if (!authRequestHeaders) {
            throw new APIError("UNAUTHORIZED", { message: "未登录。" });
          }
          const session = await auth.api.getSession({ headers: authRequestHeaders });
          const invokerUserId = session?.user?.id;
          if (!invokerUserId) {
            throw new APIError("UNAUTHORIZED", { message: "未登录。" });
          }
          const [invoker] = await db
            .select({ role: schema.member.role, userId: schema.member.userId })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.userId, invokerUserId),
                eq(schema.member.organizationId, org.id),
              ),
            )
            .limit(1);

          if (!invoker) {
            throw new APIError("FORBIDDEN", { message: "你不在这个工作区中。" });
          }

          if (!(invoker.role === "owner" || invoker.role === "admin")) {
            throw new APIError("FORBIDDEN", { message: "只有管理员可以调整工作区角色。" });
          }

          const nextRole = Array.isArray(newRole) ? newRole[0] : newRole;
          if (!nextRole) {
            throw new APIError("FORBIDDEN", {
              message: "请选择有效的工作区角色。",
            });
          }

          if (!(await canOwnerSetRole(org.id, nextRole))) {
            throw new APIError("FORBIDDEN", {
              message: "只能设置为管理员、普通成员、空权限用户或自定义角色。",
            });
          }
        },
      },
      roles,
      schema: {
        organizationRole: {
          additionalFields: {
            isOdc: {
              defaultValue: false,
              required: false,
              type: "boolean",
            },
            isSsc: {
              defaultValue: false,
              required: false,
              type: "boolean",
            },
            name: {
              required: true,
              type: "string",
            },
          },
        },
      },
      // 第一期还没有发邀请邮件的通道；先 stub 成 console.log + 让 inviter 自己复制
      // 链接。P2 接邮件后替换。
      // No invitation email channel yet; stub to console.log so inviter can copy the
      // link manually. Wire a real channel in P2.
      sendInvitationEmail({ email, invitation, organization: org }) {
        console.log(
          `[invitation stub] org=${org.name} email=${email} invitationId=${invitation.id}`,
        );
        return Promise.resolve();
      },
    }),
  ],
  rateLimit: AUTH_RATE_LIMIT,
  // 显式声明 session 寿命 & 刷新间隔。默认 expiresIn=7d / updateAge=1d，
  // 但 1 天的 updateAge 意味着 session.updatedAt 一天内顶多动一次——会让
  // 「最近活跃」列分辨率降到 1 天。这里调到 5 分钟，DB 写频可控、用户体感
  // 接近实时；expiresIn 维持 7 天。
  // Explicit session lifetimes. Default updateAge=1d makes session.updatedAt
  // bump at most once per day, which caps the "last active" column resolution
  // at 1 day. 5 minutes is a balanced trade between DB write frequency and
  // perceived freshness; expiresIn stays at 7 days.
  session: {
    additionalFields: {
      ipCiphertext: { input: false, required: false, returned: false, type: "string" },
    },
    // 7 天 = 60 * 60 * 24 * 7
    expiresIn: 60 * 60 * 24 * 7,
    // 5 分钟 = 60 * 5；让"最近活跃"列足够新鲜
    updateAge: 60 * 5,
  },
  socialProviders: {
    google: {
      clientId: getRequiredEnv("GOOGLE_CLIENT_ID"),
      clientSecret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
    },
  },
  trustedOrigins,
  user: {
    additionalFields: {
      feishuTenantKey: {
        input: false,
        required: false,
        type: "string",
      },
      feishuTenantName: {
        input: false,
        required: false,
        type: "string",
      },
      telegram: {
        required: false,
        type: "string",
      },
    },
  },
});
