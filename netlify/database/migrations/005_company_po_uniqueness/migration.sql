ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_po_number_key;

DROP INDEX IF EXISTS orders_company_po_unique_idx;

CREATE UNIQUE INDEX orders_company_po_unique_idx
  ON orders (LOWER(BTRIM(company_name)), BTRIM(po_number));
