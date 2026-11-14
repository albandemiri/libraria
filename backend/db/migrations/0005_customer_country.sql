-- Buyer country (ISO 3166-1 alpha-2) on each sale, for the publisher portal's
-- sales-by-country reporting. Null when the provider did not report it.
ALTER TABLE transactions
  ADD COLUMN customer_country CHAR(2)
  CONSTRAINT transactions_customer_country_format CHECK (customer_country ~ '^[A-Z]{2}$');
