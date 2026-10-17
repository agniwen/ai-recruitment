ALTER TABLE studio_offer_draft
  ADD COLUMN ssc_completion_attachment jsonb;

CREATE TABLE ssc_telegram_identity (
  chat_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  username text NOT NULL,
  CONSTRAINT ssc_telegram_identity_chat_id_uq UNIQUE (chat_id)
);
