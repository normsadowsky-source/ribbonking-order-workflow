CREATE TABLE IF NOT EXISTS order_email_messages (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_email TEXT,
  subject TEXT,
  message_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS order_email_messages_order_id_idx
  ON order_email_messages(order_id);
