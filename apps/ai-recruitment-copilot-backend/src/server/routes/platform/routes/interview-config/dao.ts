import { eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { platformInterviewConfig } from "@arc/db-schema/schema";
import { DEFAULT_HUMAN_INTERVIEW_LOCK_HOURS } from "@arc/shared/platform-interview-config";
import type { PlatformInterviewConfig } from "@arc/shared/platform-interview-config";

export async function loadPlatformInterviewConfig(
  executor: Pick<typeof db, "select"> = db,
): Promise<PlatformInterviewConfig> {
  const [config] = await executor
    .select({ humanInterviewLockHours: platformInterviewConfig.humanInterviewLockHours })
    .from(platformInterviewConfig)
    .where(eq(platformInterviewConfig.id, "singleton"))
    .limit(1);
  return config ?? { humanInterviewLockHours: DEFAULT_HUMAN_INTERVIEW_LOCK_HOURS };
}

export async function savePlatformInterviewConfig(input: PlatformInterviewConfig) {
  const [config] = await db
    .insert(platformInterviewConfig)
    .values({ ...input, id: "singleton" })
    .onConflictDoUpdate({
      set: { ...input, updatedAt: new Date() },
      target: platformInterviewConfig.id,
    })
    .returning({ humanInterviewLockHours: platformInterviewConfig.humanInterviewLockHours });
  return config;
}
