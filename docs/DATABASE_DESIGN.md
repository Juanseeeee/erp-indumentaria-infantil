# Diseño de base de datos (modelo inicial)

> PostgreSQL 16. Las tablas están en inglés y en `snake_case`; la UI está en español. Este es el modelo lógico: el `schema.prisma` se escribe en la Fase 1 a partir de este documento.

## 0. Convenciones comunes

Toda tabla de negocio tiene:

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` (v7, ordenable) | PK |
| `company_id` | `uuid` FK → `companies` | RLS. Va en todos los índices únicos de negocio |
| `created_at`, `created_by` | `timestamptz`, FK `users` | |
| `updated_at`, `updated_by` | | Solo en datos maestros editables |
| `version` | `int` | Bloqueo optimista |

- Importes en `numeric(18,2)`, cantidades en `numeric(18,4)` y costos unitarios o tipos de cambio en `numeric(18,6)`. Cada importe lleva `currency_code` cuando puede no estar en ARS.
- Los **documentos** (OC, pedido, remito, factura, recibo, OP…) tienen `status`, `number` (único por `company_id`, tipo y punto de venta), `date`, `issued_at`, `voided_at`, `voided_by` y `void_reason`. **No se borran.**
- Los **datos maestros** usan `is_active` en lugar de borrarse.
- Los **movimientos** (stock, cuenta corriente, tesorería, eventos de cheque) son *append-only*: no admiten `UPDATE` ni `DELETE`, lo que se refuerza con un trigger y con `REVOKE`.

## 1. Plataforma

```
companies(id, legal_name, trade_name, cuit, tax_condition, address, logo_file_id, settings jsonb)
branches(id, company_id, name, address, arca_point_of_sale)          -- sucursal / punto de venta
users(id, email UNIQUE, name, password_hash, totp_secret_enc, is_active, last_login_at)
company_users(company_id, user_id, PK(company_id,user_id), default_branch_id, seller_party_id NULL)
roles(id, company_id NULL=sistema, name, is_system)
permissions(code PK)                       -- 'sales.order.create', 'costs.view', ...
role_permissions(role_id, permission_code)
user_roles(company_id, user_id, role_id)
user_scopes(user_id, scope_type, scope_id) -- p.ej. warehouse, seller, workshop
sessions(id, user_id, token_hash, ip, user_agent, expires_at, revoked_at)
audit_log(id, company_id, user_id, at, ip, entity, entity_id, action, diff jsonb, reason)   -- particionada por mes
idempotency_keys(company_id, key, user_id, request_hash, response jsonb, created_at, PK(company_id,key))
document_sequences(company_id, doc_type, branch_id, prefix, next_number, gapless bool)
approval_rules(id, company_id, action_code, condition jsonb, required_permission)
approval_requests(id, company_id, action_code, entity, entity_id, status, requested_by, decided_by, decided_at, comment)
attachments(id, company_id, storage_key, file_name, mime, size, sha256, uploaded_by)
attachment_links(attachment_id, entity, entity_id)
notifications(id, company_id, type, priority, title, body, entity, entity_id, created_at)
notification_recipients(notification_id, user_id, status[unread|read|done], read_at)
outbox_events(id, company_id, type, payload jsonb, created_at, processed_at)
settings(company_id, key, value jsonb)     -- parámetros de negocio
```

## 2. Terceros (clientes, proveedores, talleres)

Una sola entidad **`parties`** con roles, porque un proveedor puede ser también taller y un cliente puede ser también proveedor:

```
parties(id, company_id, code, legal_name, trade_name, tax_id_type[CUIT|DNI|CUIL], tax_id, tax_condition[RI|MONO|EXENTO|CF],
        email, phone, notes, is_active,  UNIQUE(company_id, tax_id_type, tax_id))
party_roles(party_id, role[CUSTOMER|SUPPLIER|WORKSHOP|SELLER?])
party_addresses(id, party_id, type[fiscal|delivery], street, city, province, zip, is_default)
party_contacts(id, party_id, name, role, phone, email)
party_bank_accounts(id, party_id, bank, cbu_enc, alias, holder)              -- cifrado
customer_profiles(party_id PK, price_list_id, seller_id, zone_id, payment_term_id, credit_limit, discount_pct)
supplier_profiles(party_id PK, payment_term_id, default_currency)
workshop_profiles(party_id PK, warehouse_id UNIQUE, default_rate_list_id)    -- cada taller = un depósito virtual
payment_terms(id, company_id, name, installments jsonb)                       -- 30/60/90...
zones(id, company_id, name)
```

## 3. Catálogo, materiales y unidades

**Decisión clave:** todo lo que tiene stock es un **`item`**. Una variante de producto (SKU) y una materia prima son *items* de distinto tipo. Así hay un solo motor de stock, de reservas, de valuación y de kardex.

```
uoms(id, company_id, code, name, dimension[UNIT|LENGTH|MASS|AREA])               -- un, m, kg, rollo...
uom_conversions(company_id, from_uom, to_uom, factor numeric(18,6), item_id NULL)  -- NULL = universal (m↔cm); con item = específica (rollo→m de esta tela)

categories(id, company_id, parent_id, name, kind[PRODUCT|MATERIAL|EXPENSE])
seasons(id, company_id, name, year)          -- "Otoño-Invierno 2027"
collections(id, company_id, season_id, name)
size_scales(id, company_id, name)            -- "Bebé": RN, 0-3, 3-6, 6-9, 9-12
sizes(id, size_scale_id, code, sort_order)
colors(id, company_id, code, name, hex)

products(id, company_id, code, name, description, category_id, collection_id, size_scale_id,
         status[DRAFT|ACTIVE|DISCONTINUED], main_material_text, is_active)            -- el "modelo"
product_colors(product_id, color_id)        -- colores habilitados por modelo
product_images(product_id, color_id NULL, attachment_id, sort_order)

items(id, company_id, kind[VARIANT|MATERIAL|SERVICE], sku, barcode NULL, name, base_uom_id,
      track_lots bool, allow_negative bool, min_stock numeric, reorder_qty numeric, is_active,
      UNIQUE(company_id, sku), UNIQUE(company_id, barcode))
product_variants(item_id PK FK items, product_id, size_id, color_id, UNIQUE(product_id,size_id,color_id))
materials(item_id PK FK items, category_id, default_supplier_id, purchase_uom_id,
          -- telas (opcional):
          fabric_width_cm, composition, weight_gsm, color_id NULL)
supplier_items(supplier_id, item_id, supplier_code, last_price, currency, lead_time_days)
```

## 4. Depósitos, stock y reservas

```
warehouses(id, company_id, branch_id, code, name, type[OWN|WORKSHOP|TRANSIT|QUARANTINE|VIRTUAL_SCRAP], party_id NULL, is_active)
locations(id, warehouse_id, code, name)                               -- estante / zona (opcional)
lots(id, company_id, item_id, code, supplier_lot, received_at, attributes jsonb)  -- lote/rollo de tela, partida de tintura

stock_movements (APPEND-ONLY)
  id, company_id, item_id, warehouse_id, location_id NULL, lot_id NULL,
  qty numeric(18,4)  -- con signo, en UoM base
  unit_cost numeric(18,6), total_cost numeric(18,2),
  movement_type[PURCHASE_RECEIPT|PURCHASE_RETURN|SALE_DELIVERY|SALE_RETURN|PROD_ISSUE|PROD_OUTPUT|PROD_SCRAP|
                TRANSFER_OUT|TRANSFER_IN|WORKSHOP_SEND|WORKSHOP_RETURN|ADJUSTMENT|COUNT_ADJUSTMENT|OPENING],
  source_doc_type, source_doc_id, source_line_id,     -- trazabilidad al documento
  transfer_group_id NULL,                               -- empareja salida/entrada
  occurred_at, created_by, reason
  INDEX(company_id,item_id,warehouse_id,occurred_at), INDEX(source_doc_type,source_doc_id)

stock_balances (PROYECCIÓN, actualizada en la misma transacción)
  PK(company_id,item_id,warehouse_id,location_id,lot_id),
  on_hand numeric, reserved numeric, avg_cost numeric(18,6),
  CHECK (reserved >= 0), CHECK (on_hand >= 0 OR allow_negative_snapshot)
  -- disponible = on_hand - reserved (columna generada)

stock_reservations
  id, company_id, item_id, warehouse_id, qty, consumed_qty, status[ACTIVE|CONSUMED|RELEASED|EXPIRED],
  source_doc_type[SALES_ORDER|PRODUCTION_ORDER], source_doc_id, source_line_id, expires_at NULL

inventory_counts(id, company_id, warehouse_id, status[OPEN|COUNTING|REVIEW|POSTED], scope jsonb, snapshot_at)
inventory_count_lines(id, count_id, item_id, location_id, lot_id, expected_qty, counted_qty, counted_by)
```

**Invariantes:**

- `stock_balances.on_hand = Σ stock_movements.qty` por clave. Lo verifica un job de reconciliación.
- `Σ reservas activas = stock_balances.reserved`.
- Una transferencia genera dos movimientos con el mismo `transfer_group_id` y suma cero.
- Un ajuste requiere un `reason` de una lista configurable y el permiso `inventory.adjust`, y puede pasar por aprobación según el umbral.

## 5. Compras

```
purchase_requests(id, number, status[DRAFT|SUBMITTED|APPROVED|REJECTED|ORDERED|CLOSED], requested_by, needed_by, origin[MANUAL|MRP|MIN_STOCK])
purchase_request_lines(id, request_id, item_id, qty, uom_id, notes, production_order_id NULL)
supplier_quotes(id, supplier_id, request_id NULL, valid_until, currency, attachment)   -- opcional
supplier_quote_lines(id, quote_id, item_id, qty, unit_price)
purchase_orders(id, number, supplier_id, status[DRAFT|APPROVED|SENT|PARTIALLY_RECEIVED|RECEIVED|CLOSED|CANCELLED],
                date, expected_at, currency, exchange_rate, payment_term_id, notes)
purchase_order_lines(id, po_id, item_id, qty, uom_id, unit_price, discount_pct, tax_rate_id, received_qty, invoiced_qty)
goods_receipts(id, number, supplier_id, warehouse_id, po_id NULL, supplier_delivery_note, received_at, status[DRAFT|POSTED|VOIDED])
goods_receipt_lines(id, receipt_id, po_line_id NULL, item_id, qty, uom_id, qty_base, lot_id NULL, unit_cost_estimated)
```

Las facturas de proveedor viven en "Comprobantes" (sección 8). Se emparejan con la OC y la recepción en un **three-way match**, con tolerancias configurables de precio y cantidad.

## 6. Producción

```
-- Ficha técnica (BOM) versionada
tech_sheets(id, company_id, product_id, current_version_id)
tech_sheet_versions(id, tech_sheet_id, version_no, status[DRAFT|ACTIVE|ARCHIVED], valid_from, notes, approved_by)
tech_sheet_materials(id, version_id, item_id, uom_id, qty_per_unit, size_id NULL, color_id NULL,
                     waste_pct, applies_to_color_from_variant bool)
   -- size_id NULL = aplica a todos los talles; si existe, pisa el consumo para ese talle.
   -- applies_to_color_from_variant: "tela del color de la prenda" → se resuelve por regla color→material
tech_sheet_material_color_map(id, line_id, variant_color_id, material_item_id)
tech_sheet_operations(id, version_id, stage_id, name, std_minutes, workshop_rate NULL, sort_order)

production_stages(id, company_id, name, sort_order, requires_qc bool, is_external_capable bool)  -- configurables
routings(id, company_id, name) ; routing_stages(routing_id, stage_id, sort_order)               -- recorrido por tipo de prenda

production_orders(id, number, status[DRAFT|PLANNED|RELEASED|IN_PROGRESS|COMPLETED|CLOSED|CANCELLED],
                  product_id, tech_sheet_version_id,  -- CONGELADA al liberar
                  routing_id, priority, planned_start, due_date, responsible_user_id,
                  sales_order_id NULL, notes)
production_order_lines(id, po_id, variant_item_id, planned_qty, started_qty, good_qty, defective_qty, scrap_qty)
production_order_requirements(id, po_id, item_id, required_qty, reserved_qty, issued_qty, returned_qty)  -- explosión de la ficha
production_order_stages(id, po_id, stage_id, status, assigned_party_id NULL, sent_qty, received_qty, started_at, finished_at)

production_reports (APPEND-ONLY) -- informes de avance de operarios / recepción de talleres
  id, po_id, stage_id, variant_item_id, qty_good, qty_defect, qty_scrap, defect_reason_id, reported_by, reported_at, workshop_dispatch_id NULL

workshop_dispatches(id, number, workshop_party_id, po_id, status[DRAFT|SENT|PARTIALLY_RETURNED|CLOSED], sent_at, expected_back_at)
workshop_dispatch_lines(id, dispatch_id, item_id, qty_sent, qty_returned, kind[MATERIAL|CUT_PIECES])
workshop_receipts(id, number, dispatch_id, received_at, status)
workshop_receipt_lines(id, receipt_id, variant_item_id, qty_received, qty_approved, qty_rejected, qty_missing)
workshop_settlements(id, number, workshop_party_id, period, status[DRAFT|APPROVED|INVOICED], total)  -- liquidación → genera comprobante de proveedor
workshop_settlement_lines(id, settlement_id, workshop_receipt_line_id, qty, unit_rate, deductions, amount)

quality_inspections(id, po_id, stage_id, inspected_qty, approved_qty, rejected_qty, rework_qty, inspector_id, at)
quality_defects(id, inspection_id, defect_reason_id, qty, notes, photo_attachment_id)
defect_reasons(id, company_id, name)

production_cost_snapshots(id, po_id, kind[ESTIMATED|ACTUAL], materials, labor, workshop, overhead, scrap, packaging, total, unit_cost, computed_at)
```

El taller es un **depósito virtual** (`warehouses.type = WORKSHOP`). Enviar materiales es una transferencia del depósito propio al depósito del taller. De esa forma, el "stock en poder de terceros" es un saldo más, auditable igual que cualquier otro.

## 7. Ventas y precios

```
price_lists(id, company_id, name, currency, includes_vat bool, kind[RETAIL|WHOLESALE|SPECIAL], base_list_id NULL, markup_pct NULL)
price_list_items(price_list_id, item_id|product_id, price, valid_from, valid_to)   -- precio por modelo o por variante
price_change_log(id, price_list_id, item_id, old_price, new_price, changed_by, at, batch_id)
discount_rules(id, company_id, name, type[VOLUME|CUSTOMER|PROMO], conditions jsonb, discount_pct, priority, valid_from, valid_to)

quotes(id, number, customer_id, status, valid_until, price_list_id, ...)  + quote_lines
sales_orders(id, number, customer_id, seller_id, status[DRAFT|CONFIRMED|PARTIALLY_RESERVED|RESERVED|PICKING|PARTIALLY_DELIVERED|DELIVERED|INVOICED|CLOSED|CANCELLED],
             date, promised_at, price_list_id, warehouse_id, delivery_address_id, payment_term_id, notes)
sales_order_lines(id, order_id, item_id, qty, unit_price, discount_pct, tax_rate_id, reserved_qty, delivered_qty, invoiced_qty, backorder bool)
delivery_notes(id, number, customer_id, order_id NULL, warehouse_id, status[DRAFT|ISSUED|VOIDED], issued_at, carrier, packages)  -- remito
delivery_note_lines(id, delivery_id, order_line_id NULL, item_id, qty, lot_id NULL)
sales_returns(id, number, customer_id, invoice_id NULL, delivery_id NULL, reason, restock bool)   -- genera movimiento + NC
commissions(id, seller_id, source_doc, base_amount, pct, amount, status[ACCRUED|PAYABLE|PAID])
```

## 8. Comprobantes (facturas, notas de crédito y débito, tanto de venta como de compra)

Una sola tabla de **comprobantes**, porque en Argentina ventas y compras comparten la estructura:

```
fiscal_documents(id, company_id, direction[SALE|PURCHASE], party_id, doc_type[FA|FB|FC|NCA|NCB|NCC|NDA|...|INTERNAL],
                 point_of_sale, number, issue_date, due_date, currency, exchange_rate,
                 net_taxed, net_untaxed, exempt, vat_total, perceptions_total, other_taxes, total,
                 status[DRAFT|PENDING_AUTH|AUTHORIZED|REJECTED|POSTED|VOIDED],
                 cae, cae_due_date, arca_result jsonb,      -- solo ventas electrónicas
                 related_document_id NULL,                  -- NC → factura
                 UNIQUE(company_id, direction, party_id, doc_type, point_of_sale, number))
fiscal_document_lines(id, document_id, item_id NULL, description, qty, unit_price, discount_pct, tax_rate_id, net, vat)
fiscal_document_taxes(id, document_id, tax_code[IVA21|IVA105|PERC_IIBB|PERC_IVA|...], base, rate, amount)
document_links(from_type, from_id, to_type, to_id)   -- factura ↔ remitos ↔ pedido ↔ OC ↔ recepción
tax_rates(id, company_id, code, rate, arca_code)
```

## 9. Cuentas corrientes e imputaciones

```
account_entries (APPEND-ONLY, libro de cuenta corriente)
  id, company_id, party_id, account_type[RECEIVABLE|PAYABLE|WORKSHOP?], currency,
  entry_type[INVOICE|DEBIT_NOTE|CREDIT_NOTE|RECEIPT|PAYMENT|ADVANCE|OPENING|ADJUSTMENT|CHEQUE_REJECTION|REVERSAL],
  source_doc_type, source_doc_id, date, due_date,
  amount numeric(18,2)   -- con signo: + aumenta deuda del tercero (cliente) / de la empresa (proveedor)
  open_amount numeric(18,2)  -- materializado, actualizado por imputaciones (CHECK entre 0 y |amount|)

allocations   -- imputaciones N:M
  id, company_id, debit_entry_id, credit_entry_id, amount, allocated_at, allocated_by,
  reversed_by_allocation_id NULL, reversal_reason
  CHECK(amount > 0)
```

- El saldo de un tercero es `Σ amount`. La antigüedad de saldos se calcula sobre `open_amount` por `due_date`.
- Imputar bloquea ambos `account_entries` (`FOR UPDATE`), valida que no se excedan los `open_amount` y descuenta.
- Revertir una imputación crea un registro inverso. Nunca se edita el original.

## 10. Tesorería y cheques

```
cash_accounts(id, company_id, type[CASH_BOX|BANK|WALLET|CARD_CLEARING|CHEQUE_PORTFOLIO], name, bank, account_number_enc, cbu_enc, currency, branch_id)
payment_methods(id, company_id, name, kind[CASH|TRANSFER|CHEQUE_THIRD|CHEQUE_OWN|ECHEQ_THIRD|ECHEQ_OWN|CARD|MP|WITHHOLDING], settles_in_days)

receipts(id, number, customer_id, date, total, status[DRAFT|POSTED|VOIDED])          -- recibo de cobro
payments(id, number, supplier_id, date, total, status[DRAFT|PENDING_APPROVAL|POSTED|VOIDED]) -- orden de pago
settlement_items(id, parent_type[RECEIPT|PAYMENT], parent_id, payment_method_id, amount, cash_account_id NULL, cheque_id NULL, withholding_cert NULL)

treasury_movements (APPEND-ONLY)
  id, company_id, cash_account_id, direction[IN|OUT], amount, currency,
  operation_date, value_date,          -- fecha de operación vs fecha de valor
  concept, payment_method_id, source_doc_type, source_doc_id, transfer_group_id NULL,
  reconciled_statement_line_id NULL, created_by
cash_account_balances(cash_account_id PK, balance, updated_at)  -- proyección
cash_closings(id, cash_account_id, closed_at, expected, counted, difference, closed_by, notes)   -- arqueo/cierre

bank_statements(id, cash_account_id, period_from, period_to, source_file_id, imported_by)
bank_statement_lines(id, statement_id, date, description, amount, reference, hash UNIQUE, matched_status)

cheques
  id, company_id, ownership[OWN|THIRD_PARTY], format[PHYSICAL|ECHEQ], bank_code, branch, number,
  echeq_id NULL, drawer_name, drawer_cuit, issue_date, payment_date, amount, currency,
  own_cash_account_id NULL (propios), received_from_party_id NULL (terceros),
  current_status, current_holder_party_id NULL, current_location_cash_account_id NULL,
  UNIQUE(company_id, ownership, bank_code, number, drawer_cuit) / UNIQUE(company_id, echeq_id)
cheque_events (APPEND-ONLY)
  id, cheque_id, from_status, to_status, event[RECEIVED|ISSUED|DELIVERED|ENDORSED|DEPOSITED|CREDITED|DEBITED|REJECTED|RECOVERED|VOIDED|RETURNED],
  at, party_id NULL, cash_account_id NULL, source_doc_type, source_doc_id, rejection_reason NULL, user_id
```

**Máquina de estados de cheques de terceros** (las transiciones se configuran y se validan en `domain-finance`):

```
EN_CARTERA ──endosar──▶ ENTREGADO_A_TERCERO ──(rechazo informado)──▶ RECHAZADO
     │                                                              │
     ├──depositar──▶ DEPOSITADO ──acreditar──▶ ACREDITADO (final)   ├──recuperar──▶ RECUPERADO / EN_CARTERA (si se reemplaza)
     │                    └──rechazo──▶ RECHAZADO ──────────────────┘
     └──devolver al cliente / anular──▶ ANULADO
```

**Efectos atómicos:**

| Transición | Efecto |
|---|---|
| Recepción | Ingresa en la cuenta "Cartera de cheques" y genera un crédito en la cuenta corriente del cliente |
| Endoso | Sale de cartera y genera el pago al proveedor |
| Depósito | Pasa a "valores a acreditar" |
| Acreditación | Ingresa al banco con fecha de valor |
| Rechazo | Genera una nota de débito interna al cliente, más un débito con el proveedor si había sido endosado |

**Un cheque no puede tener dos eventos activos incompatibles.** Lo garantiza la combinación de `current_status`, un bloqueo `FOR UPDATE` y la validación de la transición.

## 11. Gastos y costos

```
cost_centers(id, company_id, code, name, parent_id)
expenses(id, number, company_id, category_id, cost_center_id, party_id NULL, date, period, amount, tax, fiscal_document_id NULL, status, recurring_template_id NULL)
expense_templates(id, ..., frequency)   -- alquiler, servicios recurrentes
overhead_rates(id, company_id, period, basis[MINUTES|UNITS|DIRECT_COST], rate)  -- prorrateo de indirectos
```

## 12. Importación y migración

```
import_jobs(id, company_id, kind[CUSTOMERS|SUPPLIERS|PRODUCTS|VARIANTS|STOCK|OPENING_BALANCES|CHEQUES|OPEN_ORDERS],
            file_id, status[UPLOADED|VALIDATING|VALIDATED|FAILED|COMMITTED|ROLLED_BACK], totals jsonb, created_by)
import_rows(id, job_id, row_no, raw jsonb, normalized jsonb, errors jsonb, action[CREATE|UPDATE|SKIP|DUPLICATE], target_id NULL)
```

## 13. Índices y restricciones destacadas

- Unicidad de negocio siempre incluye `company_id`.
- `stock_movements`: índices por `(company_id, item_id, warehouse_id, occurred_at)` para el kardex y por `(source_doc_type, source_doc_id)`.
- `account_entries`: índices por `(company_id, party_id, account_type, date)` y un índice parcial `WHERE open_amount <> 0`.
- `cheques`: índice por `(company_id, current_status, payment_date)` para el calendario.
- `audit_log` y `stock_movements` particionados por mes cuando superen ~10 M de filas.
- Búsqueda global con `pg_trgm` (GIN) sobre nombre, código, SKU, CUIT y número de documento.
- Triggers `BEFORE UPDATE OR DELETE` que lanzan error en las tablas *append-only*.

## 14. Diagrama resumido

```
parties ─┬─< sales_orders ─< sales_order_lines >─ items >─ product_variants >─ products ─ tech_sheets ─< versions
         │        │                                  │                                          │
         │        └─< delivery_notes ── stock_movements ─┤                           production_orders ─< lines
         │                                           │                                   │        └─< requirements
         ├─< fiscal_documents ─< account_entries ─< allocations >─ account_entries ─ receipts/payments
         │                                                                                  │
         ├─< purchase_orders ─< goods_receipts ── stock_movements                    settlement_items ─ cheques ─< cheque_events
         └─ workshop_profiles ── warehouses(WORKSHOP) ─< workshop_dispatches              │
                                                                                  treasury_movements ─ cash_accounts
```
