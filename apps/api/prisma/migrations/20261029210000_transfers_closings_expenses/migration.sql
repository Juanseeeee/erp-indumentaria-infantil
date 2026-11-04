-- Transferencias entre cuentas, arqueos de caja, centros de costo y gastos.

CREATE TABLE "treasury_transfers" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "value_date" DATE NOT NULL,
  "from_account_id" UUID NOT NULL,
  "to_account_id" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "concept" TEXT,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "treasury_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "treasury_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "treasury_transfers_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "treasury_transfers_fee_range" CHECK ("fee" >= 0 AND "fee" < "amount"),
  CONSTRAINT "treasury_transfers_distinct_accounts" CHECK ("from_account_id" <> "to_account_id")
);
CREATE UNIQUE INDEX "treasury_transfers_company_id_number_key" ON "treasury_transfers"("company_id", "number");
CREATE INDEX "treasury_transfers_company_id_date_idx" ON "treasury_transfers"("company_id", "date");

-- Append-only: un arqueo no se edita; un error se corrige con otro arqueo.
CREATE TABLE "cash_closings" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "cash_account_id" UUID NOT NULL,
  "closing_date" DATE NOT NULL,
  "expected" DECIMAL(18,2) NOT NULL,
  "counted" DECIMAL(18,2) NOT NULL,
  "difference" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "adjustment_movement_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_closings_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cash_closings_adjustment_movement_id_fkey" FOREIGN KEY ("adjustment_movement_id") REFERENCES "treasury_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cash_closings_counted_non_negative" CHECK ("counted" >= 0),
  CONSTRAINT "cash_closings_difference_consistent" CHECK ("difference" = "counted" - "expected"),
  CONSTRAINT "cash_closings_adjustment_when_difference" CHECK (("difference" = 0) = ("adjustment_movement_id" IS NULL))
);
CREATE INDEX "cash_closings_company_id_cash_account_id_closing_date_idx" ON "cash_closings"("company_id", "cash_account_id", "closing_date");
CREATE TRIGGER cash_closings_append_only BEFORE UPDATE OR DELETE ON "cash_closings"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TABLE "cost_centers" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cost_centers_company_id_code_key" ON "cost_centers"("company_id", "code");

CREATE TABLE "expenses" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "category_id" UUID NOT NULL,
  "cost_center_id" UUID NOT NULL,
  "supplier_id" UUID,
  "description" TEXT NOT NULL,
  "document_reference" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "cash_account_id" UUID NOT NULL,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expenses_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expenses_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "expenses_company_id_number_key" ON "expenses"("company_id", "number");
CREATE INDEX "expenses_company_id_date_idx" ON "expenses"("company_id", "date");
CREATE INDEX "expenses_company_id_cost_center_id_date_idx" ON "expenses"("company_id", "cost_center_id", "date");

ALTER TABLE "treasury_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treasury_transfers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "treasury_transfers"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "cash_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_closings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_closings"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_centers"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expenses"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());
