CREATE TABLE "supplier_payments" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "supplier_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "total" DECIMAL(18,2) NOT NULL,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payments_total_positive" CHECK ("total" > 0)
);
CREATE UNIQUE INDEX "supplier_payments_company_id_number_key" ON "supplier_payments"("company_id", "number");
CREATE INDEX "supplier_payments_company_id_supplier_id_idx" ON "supplier_payments"("company_id", "supplier_id");

CREATE TABLE "supplier_payment_lines" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "method" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "reference" TEXT,
  "cash_account_id" UUID,
  "cheque_id" UUID,
  CONSTRAINT "supplier_payment_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payment_lines_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "supplier_payment_lines_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplier_payment_lines_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_payment_lines_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_payments"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "supplier_payment_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payment_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_payment_lines"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());
