import { z } from "zod";

const dateFormatMessage = "请输入有效的预入职日期，格式：YYYY-MM-DD，例如：2026-11-01。";

export const offerPreboardingDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000-")) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, dateFormatMessage);
