-- CreateEnum
CREATE TYPE "TaxIdType" AS ENUM ('CUIT', 'CUIL', 'DNI', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxCondition" AS ENUM ('RI', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_ALCANZADO');

-- CreateEnum
CREATE TYPE "PartyRoleType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'WORKSHOP');

-- CreateEnum
CREATE TYPE "UomDimension" AS ENUM ('UNIT', 'LENGTH', 'MASS', 'AREA');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('PRODUCT', 'MATERIAL', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('VARIANT', 'MATERIAL');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('OWN', 'WORKSHOP', 'TRANSIT', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'SALE_DELIVERY', 'SALE_RETURN', 'PROD_ISSUE', 'PROD_OUTPUT', 'PROD_SCRAP', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'COUNT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "StockDocType" AS ENUM ('OPENING', 'ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "StockDocStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'REVIEW', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "cuit" TEXT NOT NULL,
    "tax_condition" TEXT NOT NULL,
    "address" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "arca_point_of_sale" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_users" (
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "default_branch_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "company_users_pkey" PRIMARY KEY ("company_id","user_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("company_id","user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_scopes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID NOT NULL,

    CONSTRAINT "user_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "reason" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("company_id","key")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "company_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "series_key" TEXT NOT NULL DEFAULT '',
    "prefix" TEXT NOT NULL DEFAULT '',
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 8,
    "gapless" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("company_id","doc_type","series_key")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "action_code" TEXT NOT NULL,
    "threshold" DECIMAL(18,2) NOT NULL,
    "required_permission" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("company_id","key")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "tax_id_type" "TaxIdType" NOT NULL,
    "tax_id" TEXT NOT NULL,
    "tax_condition" "TaxCondition" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_roles" (
    "party_id" UUID NOT NULL,
    "role" "PartyRoleType" NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "party_roles_pkey" PRIMARY KEY ("party_id","role")
);

-- CreateTable
CREATE TABLE "party_addresses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FISCAL',
    "street" TEXT NOT NULL,
    "city" TEXT,
    "province" TEXT,
    "zip" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "party_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "party_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "party_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "zone_id" UUID,
    "seller_user_id" UUID,
    "payment_term_id" UUID,
    "credit_limit" DECIMAL(18,2),
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("party_id")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "party_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_term_id" UUID,
    "currency" TEXT NOT NULL DEFAULT 'ARS',

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("party_id")
);

-- CreateTable
CREATE TABLE "uoms" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" "UomDimension" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "uoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uom_conversions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "from_uom_id" UUID NOT NULL,
    "to_uom_id" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "item_id" UUID,

    CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "CategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_scales" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "size_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sizes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "size_scale_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colors" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "collection_id" UUID,
    "size_scale_id" UUID NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "material_text" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "base_uom_id" UUID NOT NULL,
    "track_lots" BOOLEAN NOT NULL DEFAULT false,
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "min_stock" DECIMAL(18,4),
    "reorder_qty" DECIMAL(18,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "item_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "size_id" UUID NOT NULL,
    "color_id" UUID NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "materials" (
    "item_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category_id" UUID,
    "default_supplier_id" UUID,
    "purchase_uom_id" UUID,
    "fabric_width_cm" DECIMAL(8,2),
    "composition" TEXT,
    "weight_gsm" DECIMAL(8,2),
    "color_id" UUID,
    "last_cost" DECIMAL(18,6),

    CONSTRAINT "materials_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'OWN',
    "party_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "supplier_lot" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "lot_id" UUID,
    "type" "StockMovementType" NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "total_cost" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,4) NOT NULL,
    "source_doc_type" TEXT NOT NULL,
    "source_doc_id" UUID NOT NULL,
    "source_line_id" UUID,
    "transfer_group_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "lot_id" UUID,
    "on_hand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "consumed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_doc_type" TEXT NOT NULL,
    "source_doc_id" UUID NOT NULL,
    "source_line_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "StockDocType" NOT NULL,
    "number" TEXT NOT NULL,
    "status" "StockDocStatus" NOT NULL DEFAULT 'DRAFT',
    "warehouse_id" UUID NOT NULL,
    "target_warehouse_id" UUID,
    "reason" TEXT,
    "notes" TEXT,
    "total_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ,
    "posted_by" UUID,
    "approved_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_document_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,6),

    CONSTRAINT "stock_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "expected_qty" DECIMAL(18,4) NOT NULL,
    "counted_qty" DECIMAL(18,4),
    "counted_by" UUID,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_cuit_key" ON "companies"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "branches_company_id_name_key" ON "branches"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_code_key" ON "roles"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_scopes_company_id_user_id_scope_type_scope_id_key" ON "user_scopes"("company_id", "user_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_company_id_entity_entity_id_idx" ON "audit_log"("company_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_company_id_user_id_at_idx" ON "audit_log"("company_id", "user_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_rules_company_id_action_code_key" ON "approval_rules"("company_id", "action_code");

-- CreateIndex
CREATE UNIQUE INDEX "parties_company_id_code_key" ON "parties"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "parties_company_id_tax_id_type_tax_id_key" ON "parties"("company_id", "tax_id_type", "tax_id");

-- CreateIndex
CREATE INDEX "party_roles_company_id_role_idx" ON "party_roles"("company_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_company_id_name_key" ON "payment_terms"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "zones_company_id_name_key" ON "zones"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "uoms_company_id_code_key" ON "uoms"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_company_id_kind_name_key" ON "categories"("company_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_company_id_name_key" ON "seasons"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "collections_company_id_name_key" ON "collections"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "size_scales_company_id_name_key" ON "size_scales"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sizes_size_scale_id_code_key" ON "sizes"("size_scale_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "colors_company_id_code_key" ON "colors"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_code_key" ON "products"("company_id", "code");

-- CreateIndex
CREATE INDEX "items_company_id_kind_idx" ON "items"("company_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_id_sku_key" ON "items"("company_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_id_barcode_key" ON "items"("company_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_size_id_color_id_key" ON "product_variants"("product_id", "size_id", "color_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_party_id_key" ON "warehouses"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "warehouses"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_warehouse_id_code_key" ON "locations"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lots_company_id_item_id_code_key" ON "lots"("company_id", "item_id", "code");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_item_id_warehouse_id_occurred_at_idx" ON "stock_movements"("company_id", "item_id", "warehouse_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_source_doc_type_source_doc_id_idx" ON "stock_movements"("company_id", "source_doc_type", "source_doc_id");

-- CreateIndex
CREATE INDEX "stock_balances_company_id_item_id_idx" ON "stock_balances"("company_id", "item_id");

-- CreateIndex
CREATE INDEX "stock_balances_company_id_warehouse_id_idx" ON "stock_balances"("company_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_reservations_company_id_item_id_warehouse_id_status_idx" ON "stock_reservations"("company_id", "item_id", "warehouse_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_company_id_source_doc_type_source_doc_id_idx" ON "stock_reservations"("company_id", "source_doc_type", "source_doc_id");

-- CreateIndex
CREATE INDEX "stock_documents_company_id_status_idx" ON "stock_documents"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_company_id_type_number_key" ON "stock_documents"("company_id", "type", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_company_id_number_key" ON "inventory_counts"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_lines_count_id_item_id_key" ON "inventory_count_lines"("count_id", "item_id");

-- AddForeignKey
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_user_id_fkey" FOREIGN KEY ("company_id", "user_id") REFERENCES "company_users"("company_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_contacts" ADD CONSTRAINT "party_contacts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sizes" ADD CONSTRAINT "sizes_size_scale_id_fkey" FOREIGN KEY ("size_scale_id") REFERENCES "size_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
