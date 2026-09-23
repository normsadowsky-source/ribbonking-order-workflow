ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS follow_up_owner TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_stage TEXT;
