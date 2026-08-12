import { z } from "zod";
import { decodeUploadTaskInboxCursor } from "./cursor";

export const uploadTaskInboxQuerySchema = z.object({
  cursor: z
    .string()
    .max(1000)
    .refine((value) => decodeUploadTaskInboxCursor(value) !== null, "分页游标无效")
    .optional(),
});

export const historicalResumeImportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});
