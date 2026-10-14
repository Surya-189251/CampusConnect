BEGIN;
CREATE TABLE IF NOT EXISTS fee_invoices (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 college_id INTEGER NOT NULL REFERENCES colleges(id), student_id INTEGER NOT NULL REFERENCES users(id),
 title VARCHAR(120) NOT NULL, academic_year VARCHAR(9) NOT NULL, due_date DATE NOT NULL,
 amount_paise INTEGER NOT NULL CHECK(amount_paise BETWEEN 100 AND 100000000),
 status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
 mode VARCHAR(4) NOT NULL DEFAULT 'test' CHECK(mode='test'), version INTEGER NOT NULL DEFAULT 1,
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(id,college_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fee_student_title_year_unique ON fee_invoices(college_id,student_id,LOWER(title),academic_year) WHERE status='active';
CREATE TABLE IF NOT EXISTS fee_orders (
 id UUID PRIMARY KEY, invoice_id INTEGER NOT NULL, college_id INTEGER NOT NULL,
 gateway_order_id TEXT NOT NULL UNIQUE, key_id TEXT NOT NULL,
 amount_paise INTEGER NOT NULL CHECK(amount_paise>0), currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 state VARCHAR(10) NOT NULL DEFAULT 'open' CHECK(state IN ('open','paid')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(invoice_id,college_id) REFERENCES fee_invoices(id,college_id), UNIQUE(id,invoice_id,college_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fee_one_open_order ON fee_orders(invoice_id) WHERE state='open';
CREATE TABLE IF NOT EXISTS fee_payments (
 id UUID PRIMARY KEY, receipt_number TEXT NOT NULL UNIQUE,
 invoice_id INTEGER NOT NULL,college_id INTEGER NOT NULL,
 order_id UUID UNIQUE, gateway_payment_id TEXT UNIQUE,
 kind VARCHAR(10) NOT NULL CHECK(kind IN ('online','offline')),
 amount_paise INTEGER NOT NULL CHECK(amount_paise>0),
 refunded_paise INTEGER NOT NULL DEFAULT 0 CHECK(refunded_paise>=0 AND refunded_paise<=amount_paise),
 method VARCHAR(30) NOT NULL, reference VARCHAR(100),
 idempotency_key UUID, recorded_by INTEGER REFERENCES users(id),
 paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(invoice_id,college_id) REFERENCES fee_invoices(id,college_id),
 FOREIGN KEY(order_id,invoice_id,college_id) REFERENCES fee_orders(id,invoice_id,college_id),
 CHECK((kind='online' AND order_id IS NOT NULL AND gateway_payment_id IS NOT NULL) OR (kind='offline' AND order_id IS NULL AND gateway_payment_id IS NULL)),
 UNIQUE(college_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS fee_offline_reference_unique ON fee_payments(college_id,LOWER(reference)) WHERE kind='offline';
CREATE INDEX IF NOT EXISTS fee_invoice_student ON fee_invoices(college_id,student_id);
CREATE INDEX IF NOT EXISTS fee_payment_invoice ON fee_payments(invoice_id);
INSERT INTO permissions(code,description) VALUES
 ('fees.manage','Create and manage student fee amounts'),
 ('payments.view','View student payment records and receipts'),
 ('payments.record_offline','Record verified offline payments') ON CONFLICT DO NOTHING;
COMMIT;
