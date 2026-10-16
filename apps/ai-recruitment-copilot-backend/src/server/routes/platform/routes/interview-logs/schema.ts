import { z } from "zod";
import { isIP } from "node:net";

export const logQuerySchema = z
  .object({
    attemptId: z.uuid().optional(),
    fingerprint: z.string().max(64).optional(),
    identity: z.string().max(200).optional(),
    ip: z
      .string()
      .max(45)
      .refine((value) => isIP(value) !== 0, "IP 地址无效")
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().max(200).optional(),
    since: z.iso.datetime().optional(),
    source: z.enum(["client", "server", "livekit"]).optional(),
    type: z.string().max(100).optional(),
    until: z.iso.datetime().optional(),
    view: z.enum(["key", "all"]).optional(),
    visitId: z.uuid().optional(),
  })
  .refine((q) => !q.since || !q.until || q.since <= q.until, "时间范围无效");
export type LogQuery = z.infer<typeof logQuerySchema>;
export const logUrlQuerySchema = logQuerySchema.refine(
  (query) => !query.ip,
  "IP 查询请使用 POST 请求",
);
