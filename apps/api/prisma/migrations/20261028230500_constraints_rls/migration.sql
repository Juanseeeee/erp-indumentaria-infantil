-- ═══════════════════════════════════════════════════════════════════
-- Restricciones de integridad, RLS multiempresa y tablas append-only.
-- ═══════════════════════════════════════════════════════════════════

-- Rol de aplicación sin privilegios de superusuario (RLS no aplica a superusuarios).
-- El LOGIN/contraseña se configura por entorno (ver infra/postgres/*.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;

-- Empresa activa de la transacción.
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

-- RLS en todas las tablas de negocio con company_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','roles','role_permissions','user_roles','user_scopes','audit_log','idempotency_keys',
    'document_sequences','approval_rules','settings',
    'parties','party_roles','party_addresses','party_contacts','payment_terms','zones',
    'customer_profiles','supplier_profiles',
    'uoms','uom_conversions','categories','seasons','collections','size_scales','sizes','colors',
    'products','items','product_variants','materials',
    'warehouses','locations','lots','stock_movements','stock_balances','stock_reservations',
    'stock_documents','stock_document_lines','inventory_counts','inventory_count_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())',
      t);
  END LOOP;
END $$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies USING (id = app_company_id()) WITH CHECK (id = app_company_id());

-- ─── Tablas append-only ───
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: use un movimiento de reversa', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- ─── Stock ───
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_qty_nonzero CHECK (qty <> 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_unit_cost_nonneg CHECK (unit_cost >= 0);

CREATE UNIQUE INDEX stock_balances_key ON stock_balances (company_id, item_id, warehouse_id, location_id, lot_id)
  NULLS NOT DISTINCT;
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_reserved_nonneg CHECK (reserved >= 0);

-- Stock negativo solo si el artículo lo permite (defensa en profundidad; el dominio ya lo valida).
CREATE OR REPLACE FUNCTION check_balance_non_negative() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_hand < 0 AND NOT (SELECT allow_negative FROM items WHERE id = NEW.item_id) THEN
    RAISE EXCEPTION 'Stock negativo no permitido para el artículo %', NEW.item_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_balances_non_negative BEFORE INSERT OR UPDATE ON stock_balances
  FOR EACH ROW EXECUTE FUNCTION check_balance_non_negative();

ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_qty_pos CHECK (qty > 0);
ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_consumed_range
  CHECK (consumed_qty >= 0 AND consumed_qty <= qty);
CREATE INDEX stock_reservations_active ON stock_reservations (company_id, item_id, warehouse_id) WHERE status = 'ACTIVE';

ALTER TABLE stock_document_lines ADD CONSTRAINT stock_document_lines_qty_nonzero CHECK (qty <> 0);
ALTER TABLE uom_conversions ADD CONSTRAINT uom_conversions_factor_pos CHECK (factor > 0);
ALTER TABLE customer_profiles ADD CONSTRAINT customer_profiles_discount_range CHECK (discount_pct >= 0 AND discount_pct <= 100);
ALTER TABLE customer_profiles ADD CONSTRAINT customer_profiles_credit_nonneg CHECK (credit_limit IS NULL OR credit_limit >= 0);
ALTER TABLE document_sequences ADD CONSTRAINT document_sequences_next_pos CHECK (next_number > 0);

-- Búsqueda global (trigramas).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX parties_search_trgm ON parties USING gin ((legal_name || ' ' || coalesce(trade_name, '') || ' ' || tax_id || ' ' || code) gin_trgm_ops);
CREATE INDEX items_search_trgm ON items USING gin ((sku || ' ' || name || ' ' || coalesce(barcode, '')) gin_trgm_ops);
CREATE INDEX products_search_trgm ON products USING gin ((code || ' ' || name) gin_trgm_ops);
