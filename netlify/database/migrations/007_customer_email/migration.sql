ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

CREATE INDEX IF NOT EXISTS orders_customer_email_idx
  ON orders (LOWER(BTRIM(customer_email)));
