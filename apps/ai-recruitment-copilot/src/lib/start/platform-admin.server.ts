import { getRequestHeaders, setResponseHeader } from "@tanstack/react-start/server";
import { auth } from "@arc/ai-recruitment-copilot-backend/lib/server/auth";
import {
  requireRecentMfa,
  SecurityError,
} from "@arc/ai-recruitment-copilot-backend/server/routes/security/mfa/service";

export type PlatformAdminState =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "mfa-required" }
  | { status: "ready"; expiresAt: string };

export async function getPlatformAdminStateFromRequest(): Promise<PlatformAdminState> {
  setResponseHeader("Cache-Control", "no-store");
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session?.user) {
    return { status: "unauthenticated" };
  }
  if (session.user.role !== "admin") {
    return { status: "forbidden" };
  }
  try {
    const expiresAt = await requireRecentMfa(
      { sessionId: session.session.id, userId: session.user.id },
      getRequestHeaders(),
    );
    return { expiresAt, status: "ready" };
  } catch (error) {
    if (error instanceof SecurityError && error.code === "FORBIDDEN") {
      return { status: "forbidden" };
    }
    return { status: "mfa-required" };
  }
}
