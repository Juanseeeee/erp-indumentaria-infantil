-- Promociones (RF-VEN-08): descuentos con vigencia, por volumen, por alcance (modelos, categorías o
-- colecciones) y opcionalmente por cliente o lista de precios. La línea del pedido guarda la que se aplicó.

CREATE TABLE "promotions" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "discount_pct" DECIMAL(5,2) NOT NULL,
  "min_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "scope" TEXT NOT NULL,
  "target_ids" UUID[] NOT NULL DEFAULT '{}',
  "customer_ids" UUID[] NOT NULL DEFAULT '{}',
  "price_list_ids" UUID[] NOT NULL DEFAULT '{}',
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotions_discount" CHECK ("discount_pct" > 0 AND "discount_pct" <= 100),
  CONSTRAINT "promotions_min_qty" CHECK ("min_qty" >= 0),
  CONSTRAINT "promotions_scope" CHECK ("scope" IN ('ALL', 'PRODUCTS', 'CATEGORIES', 'COLLECTIONS')),
  CONSTRAINT "promotions_targets" CHECK (("scope" = 'ALL') = (cardinality("target_ids") = 0)),
  CONSTRAINT "promotions_dates" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from")
);
CREATE UNIQUE INDEX "promotions_company_id_name_key" ON "promotions"("company_id", "name");
CREATE INDEX "promotions_company_id_valid_from_idx" ON "promotions"("company_id", "valid_from");

ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "promotions"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "sales_order_lines" ADD COLUMN "promotion_id" UUID;
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "sales_order_lines_promotion_id_idx" ON "sales_order_lines"("promotion_id");
