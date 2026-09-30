CREATE TABLE "telegram_recipient_binding" (
  "chat_id" text PRIMARY KEY,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "username" text UNIQUE
);

COMMENT ON TABLE "telegram_recipient_binding" IS 'Telegram 通知接收登记，无需系统账号或用户名';
