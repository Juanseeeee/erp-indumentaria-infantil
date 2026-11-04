-- CreateEnum
CREATE TYPE "PriceListKind" AS ENUM ('WHOLESALE', 'RETAIL', 'SPECIAL');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('ISSUED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('POSTED', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FiscalDocStatus" ADD VALUE 'PENDING_AUTH';
ALTER TYPE "FiscalDocStatus" ADD VALUE 'REJECTED';


-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "price_list_id" UUID;

-- AlterTable
ALTER TABLE "fiscal_document_lines" ADD COLUMN     "delivery_line_id" UUID,
ADD COLUMN     "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "related_line_id" UUID;

-- AlterTable
ALTER TABLE "fiscal_documents" ADD COLUMN     "arca_mode" TEXT,
ADD COLUMN     "arca_result" JSONB,
ADD COLUMN     "cae" TEXT,
ADD COLUMN     "cae_due_date" DATE,
ADD COLUMN     "commission_pct" DECIMAL(5,2),
ADD COLUMN     "related_document_id" UUID,
ADD COLUMN     "return_warehouse_id" UUID,
ADD COLUMN     "seller_user_id" UUID,
ALTER COLUMN "number" DROP NOT NULL;

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PriceListKind" NOT NULL DEFAULT 'WHOLESALE',
    "includes_vat" BOOLEAN NOT NULL DEFAULT false,
    "base_list_id" UUID,
    "markup_pct" DECIMAL(7,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_prices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "product_id" UUID,
    "item_id" UUID,
    "price" DECIMAL(18,2) NOT NULL,
    "valid_from" DATE NOT NULL,
    "batch_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "price_list_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_reps" (
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_reps_pkey" PRIMARY KEY ("company_id","user_id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "seller_user_id" UUID,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "promised_at" DATE,
    "price_list_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "payment_term_id" UUID,
    "delivery_address" TEXT,
    "notes" TEXT,
    "net_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_approved_by" UUID,
    "credit_note" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "delivered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelled_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservation_id" UUID,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "issue_date" DATE NOT NULL,
    "carrier" TEXT,
    "packages" INTEGER,
    "notes" TEXT,
    "invoice_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_note_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "order_line_id" UUID,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "unit_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "bank" TEXT,
    "due_date" DATE,

    CONSTRAINT "receipt_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_allocations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "debit_entry_id" UUID NOT NULL,
    "credit_entry_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reversal_of_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "account_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_commissions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "seller_user_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "collected_at" DATE NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "settlement_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_settlements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "seller_user_id" UUID NOT NULL,
    "period_to" DATE NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "commission_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_company_id_name_key" ON "price_lists"("company_id", "name");

-- CreateIndex
CREATE INDEX "price_list_prices_price_list_id_product_id_valid_from_idx" ON "price_list_prices"("price_list_id", "product_id", "valid_from");

-- CreateIndex
CREATE INDEX "price_list_prices_price_list_id_item_id_valid_from_idx" ON "price_list_prices"("price_list_id", "item_id", "valid_from");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_customer_id_idx" ON "sales_orders"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_status_idx" ON "sales_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_number_key" ON "sales_orders"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_order_id_item_id_key" ON "sales_order_lines"("order_id", "item_id");

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_customer_id_invoice_id_idx" ON "delivery_notes"("company_id", "customer_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_company_id_number_key" ON "delivery_notes"("company_id", "number");

-- CreateIndex
CREATE INDEX "customer_receipts_company_id_customer_id_idx" ON "customer_receipts"("company_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receipts_company_id_number_key" ON "customer_receipts"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "account_allocations_reversal_of_id_key" ON "account_allocations"("reversal_of_id");

-- CreateIndex
CREATE INDEX "account_allocations_company_id_debit_entry_id_idx" ON "account_allocations"("company_id", "debit_entry_id");

-- CreateIndex
CREATE INDEX "account_allocations_company_id_credit_entry_id_idx" ON "account_allocations"("company_id", "credit_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_commissions_allocation_id_key" ON "sales_commissions"("allocation_id");

-- CreateIndex
CREATE INDEX "sales_commissions_company_id_seller_user_id_settlement_id_idx" ON "sales_commissions"("company_id", "seller_user_id", "settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_settlements_company_id_number_key" ON "commission_settlements"("company_id", "number");

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_payments" ADD CONSTRAINT "receipt_payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══ RLS, integridad y append-only para las tablas de la Fase 3 ═══
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'price_lists','price_list_prices','sales_reps','sales_orders','sales_order_lines','delivery_notes',
    'delivery_note_lines','customer_receipts','receipt_payments','account_allocations','sales_commissions',
    'commission_settlements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;

-- Historial de precios e imputaciones: solo inserción.
CREATE TRIGGER price_list_prices_append_only BEFORE UPDATE OR DELETE ON price_list_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER account_allocations_append_only BEFORE UPDATE OR DELETE ON account_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Una venta electrónica tiene número salvo mientras espera CAE o si fue rechazada.
ALTER TABLE fiscal_documents DROP CONSTRAINT fd_number_pos;
ALTER TABLE fiscal_documents ADD CONSTRAINT fd_number_pos
  CHECK (point_of_sale >= 0 AND (number > 0 OR (number IS NULL AND status::text IN ('PENDING_AUTH', 'REJECTED'))));

ALTER TABLE price_list_prices ADD CONSTRAINT plp_target CHECK ((product_id IS NULL) <> (item_id IS NULL) AND price >= 0);
ALTER TABLE price_lists ADD CONSTRAINT pl_derived CHECK ((base_list_id IS NULL) = (markup_pct IS NULL) AND base_list_id IS DISTINCT FROM id);
ALTER TABLE sales_reps ADD CONSTRAINT sr_pct CHECK (commission_pct >= 0 AND commission_pct < 100);
ALTER TABLE sales_order_lines ADD CONSTRAINT sol_qty CHECK (
  qty > 0 AND unit_price >= 0 AND discount_pct >= 0 AND discount_pct < 100
  AND delivered_qty >= 0 AND cancelled_qty >= 0 AND delivered_qty + cancelled_qty <= qty);
ALTER TABLE delivery_note_lines ADD CONSTRAINT dnl_qty CHECK (qty > 0 AND unit_price >= 0 AND unit_cost >= 0);
ALTER TABLE customer_receipts ADD CONSTRAINT cr_total CHECK (total > 0);
ALTER TABLE receipt_payments ADD CONSTRAINT rp_amount CHECK (amount > 0);
ALTER TABLE account_allocations ADD CONSTRAINT aa_amount CHECK (amount > 0 AND debit_entry_id <> credit_entry_id);
ALTER TABLE fiscal_document_lines ADD CONSTRAINT fdl_discount CHECK (discount_pct >= 0 AND discount_pct < 100);

-- Una línea de remito se factura una sola vez (las notas de crédito apuntan a la línea de factura, no al remito).
CREATE UNIQUE INDEX fdl_delivery_line_once ON fiscal_document_lines (delivery_line_id) WHERE delivery_line_id IS NOT NULL;
-- Número de venta electrónica único por tipo y punto de venta (independiente del cliente).
CREATE UNIQUE INDEX fd_sale_number ON fiscal_documents (company_id, doc_type, point_of_sale, number)
  WHERE direction = 'SALE' AND number IS NOT NULL;
CREATE INDEX account_entries_source ON account_entries (company_id, source_doc_type, source_doc_id);
