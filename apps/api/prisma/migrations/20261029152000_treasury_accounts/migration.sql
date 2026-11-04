CREATE TYPE "CashAccountType" AS ENUM ('CASH_BOX', 'BANK', 'WALLET', 'CARD_CLEARING', 'CHEQUE_PORTFOLIO');
CREATE TYPE "TreasuryDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "cash_accounts" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "type" "CashAccountType" NOT NULL,
  "name" TEXT NOT NULL,
  "bank" TEXT,
  "account_reference" TEXT,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_accounts_company_id_name_key" UNIQUE ("company_id", "name"),
  CONSTRAINT "cash_accounts_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "treasury_movements" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "cash_account_id" UUID NOT NULL,
  "direction" "TreasuryDirection" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "operation_date" DATE NOT NULL,
  "value_date" DATE NOT NULL,
  "concept" TEXT NOT NULL,
  "payment_method" TEXT,
  "source_doc_type" TEXT,
  "source_doc_id" UUID,
  "transfer_group_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "treasury_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_movements_cash_account_id_fkey"
    FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "treasury_movements_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "treasury_movements_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX "cash_accounts_company_id_type_idx" ON "cash_accounts"("company_id", "type");
CREATE INDEX "treasury_movements_company_id_cash_account_id_operation_date_idx"
  ON "treasury_movements"("company_id", "cash_account_id", "operation_date");
CREATE INDEX "treasury_movements_company_id_cash_account_id_value_date_idx"
  ON "treasury_movements"("company_id", "cash_account_id", "value_date");

ALTER TABLE "cash_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_accounts"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "treasury_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treasury_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "treasury_movements"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());
CREATE TRIGGER treasury_movements_append_only BEFORE UPDATE OR DELETE ON "treasury_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
