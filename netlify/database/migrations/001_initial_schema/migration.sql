CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PO_REVIEW_REQUIRED',
  owner TEXT NOT NULL DEFAULT 'Egnali',
  next_action TEXT NOT NULL DEFAULT 'Review PO and artwork',
  follow_up_due DATE,
  waiting_since TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT 'Egnali',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events(order_id, created_at DESC);
