-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('OPEN', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestOrigin" AS ENUM ('MANUAL', 'PRODUCTION', 'MIN_STOCK');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocDirection" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "FiscalDocStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "TechSheetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED');


-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "origin" "PurchaseRequestOrigin" NOT NULL DEFAULT 'MANUAL',
    "production_order_id" UUID,
    "needed_by" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "supplier_id" UUID,
    "po_line_id" UUID,

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_at" DATE,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "net_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoiced_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "supplier_delivery_note" TEXT,
    "status" "StockDocStatus" NOT NULL DEFAULT 'POSTED',
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "po_line_id" UUID,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "lot_id" UUID,
    "invoiced_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "direction" "DocDirection" NOT NULL,
    "party_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "point_of_sale" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "net_total" DECIMAL(18,2) NOT NULL,
    "vat_total" DECIMAL(18,2) NOT NULL,
    "other_taxes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "status" "FiscalDocStatus" NOT NULL DEFAULT 'POSTED',
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "notes" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_document_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "item_id" UUID,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "vat" DECIMAL(18,2) NOT NULL,
    "receipt_line_id" UUID,

    CONSTRAINT "fiscal_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "entry_type" TEXT NOT NULL,
    "source_doc_type" TEXT NOT NULL,
    "source_doc_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "due_date" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "open_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "account_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_stages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "production_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_reasons" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "defect_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_sheets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "current_version_id" UUID,

    CONSTRAINT "tech_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_sheet_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tech_sheet_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "TechSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "stage_ids" UUID[],
    "instructions" TEXT,
    "activated_at" TIMESTAMPTZ,
    "activated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "tech_sheet_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_sheet_materials" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "material_item_id" UUID,
    "by_garment_color" BOOLEAN NOT NULL DEFAULT false,
    "color_map" JSONB NOT NULL DEFAULT '{}',
    "qty_per_unit" DECIMAL(18,4) NOT NULL,
    "size_qty" JSONB NOT NULL DEFAULT '{}',
    "waste_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tech_sheet_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "valid_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "workshop_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "product_id" UUID NOT NULL,
    "tech_sheet_version_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "planned_start" DATE,
    "due_date" DATE,
    "responsible_user_id" UUID,
    "materials_warehouse_id" UUID NOT NULL,
    "output_warehouse_id" UUID NOT NULL,
    "seconds_warehouse_id" UUID,
    "notes" TEXT,
    "estimated_unit_cost" DECIMAL(18,6),
    "released_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_item_id" UUID NOT NULL,
    "planned_qty" DECIMAL(18,4) NOT NULL,
    "good_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "second_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "production_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_requirements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "material_item_id" UUID NOT NULL,
    "required_qty" DECIMAL(18,4) NOT NULL,
    "issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "at_workshop_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "consumed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservation_id" UUID,

    CONSTRAINT "production_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_stages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "completed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defect_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "workshop_id" UUID,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "production_order_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_reports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "qty_good" DECIMAL(18,4) NOT NULL,
    "qty_defect" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defect_reason_id" UUID,
    "notes" TEXT,
    "reported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_by" UUID NOT NULL,

    CONSTRAINT "production_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_dispatches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_at" DATE,
    "notes" TEXT,
    "created_by" UUID NOT NULL,

    CONSTRAINT "workshop_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_dispatch_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "workshop_dispatch_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_outputs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "workshop_id" UUID,
    "dispatch_id" UUID,
    "settlement_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_output_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "output_id" UUID NOT NULL,
    "variant_item_id" UUID NOT NULL,
    "approved_qty" DECIMAL(18,4) NOT NULL,
    "second_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defect_reason_id" UUID,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "workshop_rate" DECIMAL(18,2),

    CONSTRAINT "production_output_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_settlements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "workshop_id" UUID NOT NULL,
    "status" "FiscalDocStatus" NOT NULL DEFAULT 'POSTED',
    "gross_total" DECIMAL(18,2) NOT NULL,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "deduction_detail" JSONB NOT NULL DEFAULT '[]',
    "fiscal_document_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "workshop_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_cost_snapshots" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "materials" DECIMAL(18,2) NOT NULL,
    "workshop" DECIMAL(18,2) NOT NULL,
    "overhead" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "good_units" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" UUID NOT NULL,

    CONSTRAINT "production_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_company_id_number_key" ON "purchase_requests"("company_id", "number");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_supplier_id_status_idx" ON "purchase_orders"("company_id", "supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "purchase_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "goods_receipts_company_id_supplier_id_idx" ON "goods_receipts"("company_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_company_id_number_key" ON "goods_receipts"("company_id", "number");

-- CreateIndex
CREATE INDEX "fiscal_documents_company_id_party_id_idx" ON "fiscal_documents"("company_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_company_id_direction_party_id_doc_type_poi_key" ON "fiscal_documents"("company_id", "direction", "party_id", "doc_type", "point_of_sale", "number");

-- CreateIndex
CREATE INDEX "account_entries_company_id_party_id_account_type_date_idx" ON "account_entries"("company_id", "party_id", "account_type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "production_stages_company_id_code_key" ON "production_stages"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "defect_reasons_company_id_name_key" ON "defect_reasons"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tech_sheets_product_id_key" ON "tech_sheets"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "tech_sheet_versions_tech_sheet_id_version_no_key" ON "tech_sheet_versions"("tech_sheet_id", "version_no");

-- CreateIndex
CREATE INDEX "workshop_rates_company_id_product_id_idx" ON "workshop_rates"("company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_rates_workshop_id_product_id_valid_from_key" ON "workshop_rates"("workshop_id", "product_id", "valid_from");

-- CreateIndex
CREATE INDEX "production_orders_company_id_status_idx" ON "production_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_company_id_number_key" ON "production_orders"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_lines_order_id_variant_item_id_key" ON "production_order_lines"("order_id", "variant_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_requirements_order_id_material_item_id_key" ON "production_requirements"("order_id", "material_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_stages_order_id_stage_id_key" ON "production_order_stages"("order_id", "stage_id");

-- CreateIndex
CREATE INDEX "production_reports_company_id_order_id_idx" ON "production_reports"("company_id", "order_id");

-- CreateIndex
CREATE INDEX "workshop_dispatches_company_id_workshop_id_status_idx" ON "workshop_dispatches"("company_id", "workshop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_dispatches_company_id_number_key" ON "workshop_dispatches"("company_id", "number");

-- CreateIndex
CREATE INDEX "production_outputs_company_id_workshop_id_settlement_id_idx" ON "production_outputs"("company_id", "workshop_id", "settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_outputs_company_id_number_key" ON "production_outputs"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_settlements_company_id_number_key" ON "workshop_settlements"("company_id", "number");

-- CreateIndex
CREATE INDEX "production_cost_snapshots_company_id_order_id_idx" ON "production_cost_snapshots"("company_id", "order_id");

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_document_lines" ADD CONSTRAINT "fiscal_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "fiscal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_sheet_versions" ADD CONSTRAINT "tech_sheet_versions_tech_sheet_id_fkey" FOREIGN KEY ("tech_sheet_id") REFERENCES "tech_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_sheet_materials" ADD CONSTRAINT "tech_sheet_materials_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "tech_sheet_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requirements" ADD CONSTRAINT "production_requirements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stages" ADD CONSTRAINT "production_order_stages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_dispatch_lines" ADD CONSTRAINT "workshop_dispatch_lines_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "workshop_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_output_lines" ADD CONSTRAINT "production_output_lines_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "production_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══ RLS, integridad y append-only para las tablas de la Fase 2 ═══
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_requests','purchase_request_lines','purchase_orders','purchase_order_lines',
    'goods_receipts','goods_receipt_lines','fiscal_documents','fiscal_document_lines','account_entries',
    'production_stages','defect_reasons','tech_sheets','tech_sheet_versions','tech_sheet_materials',
    'workshop_rates','production_orders','production_order_lines','production_requirements',
    'production_order_stages','production_reports','workshop_dispatches','workshop_dispatch_lines',
    'production_outputs','production_output_lines','workshop_settlements','production_cost_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;

CREATE TRIGGER production_reports_append_only BEFORE UPDATE OR DELETE ON production_reports
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Cuenta corriente: no se borra; solo puede cambiar open_amount (imputaciones).
CREATE OR REPLACE FUNCTION account_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La cuenta corriente es de solo inserción: use un comprobante de reversa' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.party_id <> OLD.party_id OR NEW.account_type <> OLD.account_type
     OR NEW.source_doc_id <> OLD.source_doc_id OR NEW.date <> OLD.date THEN
    RAISE EXCEPTION 'Solo se puede modificar el saldo abierto de un movimiento de cuenta corriente' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_entries_guard BEFORE UPDATE OR DELETE ON account_entries
  FOR EACH ROW EXECUTE FUNCTION account_entries_guard();

ALTER TABLE account_entries ADD CONSTRAINT account_entries_open_range
  CHECK ((amount >= 0 AND open_amount BETWEEN 0 AND amount) OR (amount < 0 AND open_amount BETWEEN amount AND 0));
ALTER TABLE purchase_order_lines ADD CONSTRAINT pol_qty_pos CHECK (qty > 0 AND unit_price >= 0 AND received_qty >= 0);
ALTER TABLE goods_receipt_lines ADD CONSTRAINT grl_qty_pos CHECK (qty > 0 AND unit_cost >= 0);
ALTER TABLE production_order_lines ADD CONSTRAINT pol_planned_pos CHECK (planned_qty > 0 AND good_qty >= 0 AND second_qty >= 0 AND scrap_qty >= 0);
ALTER TABLE production_requirements ADD CONSTRAINT preq_nonneg CHECK (required_qty >= 0 AND issued_qty >= 0 AND at_workshop_qty >= 0 AND consumed_qty >= 0 AND returned_qty >= 0);
ALTER TABLE production_output_lines ADD CONSTRAINT pout_nonneg CHECK (approved_qty >= 0 AND second_qty >= 0 AND scrap_qty >= 0 AND approved_qty + second_qty + scrap_qty > 0);
ALTER TABLE tech_sheet_materials ADD CONSTRAINT tsm_qty CHECK (qty_per_unit > 0 AND waste_pct >= 0 AND waste_pct < 100);
ALTER TABLE workshop_rates ADD CONSTRAINT wr_price CHECK (price >= 0);
ALTER TABLE fiscal_documents ADD CONSTRAINT fd_number_pos CHECK (number > 0 AND point_of_sale >= 0);
