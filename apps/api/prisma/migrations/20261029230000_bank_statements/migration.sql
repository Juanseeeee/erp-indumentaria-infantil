-- Extractos bancarios y conciliación. Los movimientos de tesorería siguen siendo append-only: el
-- vínculo vive en la línea del extracto, y un índice único impide conciliar dos veces un movimiento.

CREATE TABLE "bank_statements" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "cash_account_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "line_count" INTEGER NOT NULL,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_statements_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_statements_period" CHECK ("period_from" <= "period_to")
);
CREATE INDEX "bank_statements_company_id_cash_account_id_idx" ON "bank_statements"("company_id", "cash_account_id");

CREATE TABLE "bank_statement_lines" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "statement_id" UUID NOT NULL,
  "cash_account_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "date" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  -- Con signo, como lo muestra el banco: crédito +, débito −.
  "amount" DECIMAL(18,2) NOT NULL,
  "line_key" TEXT NOT NULL,
  -- PENDING: sin conciliar · MATCHED: con un movimiento existente · CREATED: generó su movimiento · IGNORED
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "movement_id" UUID,
  "notes" TEXT,
  "resolved_at" TIMESTAMPTZ,
  "resolved_by" UUID,
  CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_statement_lines_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_statement_lines_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "treasury_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_statement_lines_amount_non_zero" CHECK ("amount" <> 0),
  CONSTRAINT "bank_statement_lines_status" CHECK ("status" IN ('PENDING', 'MATCHED', 'CREATED', 'IGNORED')),
  CONSTRAINT "bank_statement_lines_movement_by_status" CHECK (("movement_id" IS NOT NULL) = ("status" IN ('MATCHED', 'CREATED')))
);
-- La misma línea no se importa dos veces en la misma cuenta, aunque venga en otro archivo.
CREATE UNIQUE INDEX "bank_statement_lines_company_id_cash_account_id_line_key_key" ON "bank_statement_lines"("company_id", "cash_account_id", "line_key");
CREATE UNIQUE INDEX "bank_statement_lines_movement_id_key" ON "bank_statement_lines"("movement_id");
CREATE INDEX "bank_statement_lines_company_id_statement_id_idx" ON "bank_statement_lines"("company_id", "statement_id");

ALTER TABLE "bank_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_statements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_statements"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());

ALTER TABLE "bank_statement_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_statement_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_statement_lines"
  USING ("company_id" = app_company_id()) WITH CHECK ("company_id" = app_company_id());
