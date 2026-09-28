CREATE TABLE IF NOT EXISTS order_email_threads (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  thread_type TEXT NOT NULL,
  participant_email TEXT,
  subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, gmail_thread_id)
);

CREATE INDEX IF NOT EXISTS order_email_threads_order_id_idx
  ON order_email_threads(order_id);
