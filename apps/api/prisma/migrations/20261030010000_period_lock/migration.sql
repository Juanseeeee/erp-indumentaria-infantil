-- Cierre de período: ninguna operación con fecha igual o anterior al último día cerrado.
-- Se controla en la base, sobre las tablas donde terminan todos los documentos con fecha
-- (tesorería, cuentas corrientes, stock, cheques y arqueos), así ningún camino lo saltea.

ALTER TABLE "companies" ADD COLUMN "locked_until" DATE;

-- Historial de cierres y reaperturas (append-only).
CREATE TABLE "period_locks" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "previous_until" DATE,
  "locked_until" DATE,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "period_locks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "period_locks_action" CHECK ("action" IN ('CLOSE', 'REOPEN')),
  CONSTRAINT "period_locks_close_moves_forward" CHECK ("action" <> 'CLOSE' OR ("locked_until" IS NOT NULL AND ("previous_until" IS NULL OR "locked_until" > "previous_until"))),
  CONSTRAINT "period_locks_reopen_has_reason" CHECK ("action" <> 'REOPEN' OR length(coalesce("notes", '')) >= 10)
);
CREATE INDEX "period_locks_company_id_created_at_idx" ON "period_locks"("company_id", "created_at");
CREATE TRIGGER period_locks_append_only BEFORE UPDATE OR DELETE ON "period_locks"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE "period_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period_locks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "period_locks"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

-- TG_ARGV[0]: columna con la fecha del documento. Las marcas de tiempo se llevan al día de negocio.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked DATE;
  doc_date DATE;
BEGIN
  SELECT locked_until INTO locked FROM companies WHERE id = NEW.company_id;
  IF locked IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_ARGV[0] = 'occurred_at' THEN
    doc_date := (NEW.occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  ELSE
    EXECUTE format('SELECT ($1).%I::date', TG_ARGV[0]) INTO doc_date USING NEW;
  END IF;
  IF doc_date <= locked THEN
    RAISE EXCEPTION 'PERIODO_CERRADO:% (%: %)', locked, TG_TABLE_NAME, doc_date USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_movements_period_open BEFORE INSERT ON "treasury_movements"
  FOR EACH ROW EXECUTE FUNCTION assert_period_open('operation_date');
CREATE TRIGGER account_entries_period_open BEFORE INSERT ON "account_entries"
  FOR EACH ROW EXECUTE FUNCTION assert_period_open('date');
CREATE TRIGGER stock_movements_period_open BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION assert_period_open('occurred_at');
CREATE TRIGGER cheque_events_period_open BEFORE INSERT ON "cheque_events"
  FOR EACH ROW EXECUTE FUNCTION assert_period_open('date');
CREATE TRIGGER cash_closings_period_open BEFORE INSERT ON "cash_closings"
  FOR EACH ROW EXECUTE FUNCTION assert_period_open('closing_date');
