import { z } from "zod";

export const USER_TELEGRAM_MAX_LENGTH = 120;

export const optionalUserTelegramSchema = z
  .string()
  .trim()
  .max(USER_TELEGRAM_MAX_LENGTH, `TG 号不能超过 ${USER_TELEGRAM_MAX_LENGTH} 个字符。`)
  .nullable()
  .transform((value) => value || null);
