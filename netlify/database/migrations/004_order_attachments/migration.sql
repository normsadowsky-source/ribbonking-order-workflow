CREATE TABLE IF NOT EXISTS order_attachments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  blob_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  uploaded_by TEXT NOT NULL DEFAULT 'Egnali',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_attachments_order_id_idx
  ON order_attachments(order_id, created_at DESC);
