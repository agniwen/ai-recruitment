CREATE TABLE "telegram_requester_binding" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "username" text NOT NULL,
  "chat_id" text NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("organization_id", "username")
);
