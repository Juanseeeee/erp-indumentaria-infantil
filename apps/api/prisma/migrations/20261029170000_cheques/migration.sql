CREATE TYPE "ChequeOwnership" AS ENUM ('THIRD', 'OWN');
CREATE TYPE "ChequeStatus" AS ENUM ('IN_PORTFOLIO', 'DELIVERED', 'DEPOSITED', 'CREDITED', 'REJECTED', 'RETURNED', 'ISSUED', 'DEBITED', 'VOIDED');

CREATE TABLE "cheques" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "ownership" "ChequeOwnership" NOT NULL,
  "is_echeq" BOOLEAN NOT NULL DEFAULT false,
  "bank" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
  "issue_date" DATE,
  "payment_date" DATE NOT NULL,
  "drawer_name" TEXT,
  "drawer_tax_id" TEXT,
  "status" "ChequeStatus" NOT NULL,
  "received_from_id" UUID,
  "delivered_to_id" UUID,
  "cash_account_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "cheques_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cheques_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cheques_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "cheques_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "cheques_ownership_status" CHECK (
    ("ownership" = 'THIRD' AND "status" IN ('IN_PORTFOLIO', 'DELIVERED', 'DEPOSITED', 'CREDITED', 'REJECTED', 'RETURNED'))
    OR ("ownership" = 'OWN' AND "status" IN ('ISSUED', 'DEBITED', 'VOIDED'))
  )
);

CREATE INDEX "cheques_company_id_status_payment_date_idx" ON "cheques"("company_id", "status", "payment_date");
-- Un cheque vigente no se carga dos veces. Devuelto o anulado libera el número (puede volver a recibirse).
CREATE UNIQUE INDEX "cheques_active_unique" ON "cheques"("company_id", "ownership", lower("bank"), "number")
  WHERE "status" NOT IN ('RETURNED', 'VOIDED');

CREATE TABLE "cheque_events" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "cheque_id" UUID NOT NULL,
  "event" TEXT NOT NULL,
  "from_status" "ChequeStatus",
  "to_status" "ChequeStatus" NOT NULL,
  "date" DATE NOT NULL,
  "cash_account_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "cheque_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cheque_events_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "cheque_events_company_id_cheque_id_idx" ON "cheque_events"("company_id", "cheque_id");

ALTER TABLE "receipt_payments" ADD COLUMN "cash_account_id" UUID, ADD COLUMN "cheque_id" UUID;
ALTER TABLE "receipt_payments"
  ADD CONSTRAINT "receipt_payments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receipt_payments_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cheques" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cheques" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cheques"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "cheque_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cheque_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cheque_events"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());
CREATE TRIGGER cheque_events_append_only BEFORE UPDATE OR DELETE ON "cheque_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
