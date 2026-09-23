ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ship_date_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plate_status TEXT NOT NULL DEFAULT 'UNDECIDED';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_plate_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_plate_status_check
  CHECK (plate_status IN ('UNDECIDED', 'NOT_REQUIRED', 'REQUIRED', 'ORDERED'));
