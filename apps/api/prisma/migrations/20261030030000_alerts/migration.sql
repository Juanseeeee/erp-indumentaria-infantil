-- Alertas (RF §13): reglas configurables por empresa, alertas con estado y cola de correos salientes.

-- Configuración de cada regla. Sin fila, la regla usa los valores por defecto del catálogo (contracts/alerts.ts).
CREATE TABLE "alert_rules" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" TEXT NOT NULL,
  "roles" TEXT[] NOT NULL DEFAULT '{}',
  "user_ids" UUID[] NOT NULL DEFAULT '{}',
  "send_email" BOOLEAN NOT NULL DEFAULT true,
  "days" INTEGER,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "alert_rules_priority" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT "alert_rules_days" CHECK ("days" IS NULL OR "days" BETWEEN 0 AND 365)
);
CREATE UNIQUE INDEX "alert_rules_company_id_code_key" ON "alert_rules"("company_id", "code");

-- Una alerta por condición detectada (dedup_key: la operación afectada).
-- cleared_at: la condición desapareció. Mientras sea NULL no se vuelve a crear otra alerta igual,
-- aunque alguien la haya resuelto a mano (así no reaparece cada 15 minutos).
CREATE TABLE "alerts" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "link" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seen_at" TIMESTAMPTZ,
  "seen_by" UUID,
  "resolved_at" TIMESTAMPTZ,
  "resolved_by" UUID,
  "resolution_note" TEXT,
  "cleared_at" TIMESTAMPTZ,
  CONSTRAINT "alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "alerts_priority" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT "alerts_status" CHECK ("status" IN ('NEW', 'SEEN', 'RESOLVED')),
  CONSTRAINT "alerts_resolved_consistent" CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL)),
  CONSTRAINT "alerts_cleared_is_resolved" CHECK ("cleared_at" IS NULL OR "status" = 'RESOLVED')
);
CREATE UNIQUE INDEX "alerts_active_key" ON "alerts"("company_id", "code", "dedup_key") WHERE "cleared_at" IS NULL;
CREATE INDEX "alerts_company_id_status_created_at_idx" ON "alerts"("company_id", "status", "created_at");

-- Cola de correos (outbox): se encola en la misma transacción que la alerta y un despachador los envía.
CREATE TABLE "email_outbox" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "to_email" TEXT NOT NULL,
  "to_name" TEXT,
  "subject" TEXT NOT NULL,
  "text_body" TEXT NOT NULL,
  "html_body" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMPTZ,
  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_outbox_status" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
  CONSTRAINT "email_outbox_sent_consistent" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL))
);
CREATE INDEX "email_outbox_company_id_status_created_at_idx" ON "email_outbox"("company_id", "status", "created_at");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_rules', 'alerts', 'email_outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;
