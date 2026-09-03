import { z } from "zod";

export const memberDirectManagerInputSchema = z.object({
  directManagerUserId: z.string().min(1).nullable(),
});
