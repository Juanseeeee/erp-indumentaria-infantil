-- Aprobación de órdenes de pago por monto y gastos recurrentes desde plantilla.

-- ─── Órdenes de pago: pendiente de aprobación y rechazada ───
-- El estado deja de compartir el enum de los recibos: tiene dos estados propios.
ALTER TABLE "supplier_payments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "supplier_payments" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
ALTER TABLE "supplier_payments" ALTER COLUMN "status" SET DEFAULT 'POSTED';
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_status"
  CHECK ("status" IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'VOIDED'));
ALTER TABLE "supplier_payments" ADD COLUMN "approved_by" UUID;
ALTER TABLE "supplier_payments" ADD COLUMN "approved_at" TIMESTAMPTZ;
ALTER TABLE "supplier_payments" ADD COLUMN "rejection_reason" TEXT;
-- Imputaciones pedidas al cargarla; se aplican al aprobarla.
ALTER TABLE "supplier_payments" ADD COLUMN "pending_allocations" JSONB;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_approval_consistent"
  CHECK (("status" = 'PENDING_APPROVAL') = ("pending_allocations" IS NOT NULL));
-- Fecha de pago de un cheque propio que se emite al aprobar.
ALTER TABLE "supplier_payment_lines" ADD COLUMN "payment_date" DATE;

-- ─── Gastos recurrentes ───
CREATE TABLE "expense_templates" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "category_id" UUID NOT NULL,
  "cost_center_id" UUID NOT NULL,
  "cash_account_id" UUID NOT NULL,
  "supplier_id" UUID,
  -- Importe habitual: se puede corregir al registrar (las facturas de servicios varían).
  "amount" DECIMAL(18,2) NOT NULL,
  "day_of_month" INTEGER NOT NULL,
  "starts_on" DATE NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "expense_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expense_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expense_templates_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expense_templates_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expense_templates_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "expense_templates_day" CHECK ("day_of_month" BETWEEN 1 AND 28)
);
CREATE UNIQUE INDEX "expense_templates_company_id_name_key" ON "expense_templates"("company_id", "name");

ALTER TABLE "expenses" ADD COLUMN "template_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "period" TEXT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "expense_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_period_format" CHECK ("period" IS NULL OR "period" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_template_has_period" CHECK (("template_id" IS NULL) = ("period" IS NULL));
-- Una plantilla se registra una vez por mes (si se anula, se puede volver a registrar).
CREATE UNIQUE INDEX "expenses_template_id_period_key" ON "expenses"("template_id", "period") WHERE "status" = 'POSTED';

ALTER TABLE "expense_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_templates"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());
