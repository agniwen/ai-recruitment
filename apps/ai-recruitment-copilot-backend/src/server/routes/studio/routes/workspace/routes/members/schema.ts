import { z } from "zod";

export const memberDirectManagerInputSchema = z.object({
  directManagerUserId: z.string().min(1).nullable(),
});

export const memberBatchDirectManagerInputSchema = z.object({
  directManagerUserId: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1).max(5000),
});
