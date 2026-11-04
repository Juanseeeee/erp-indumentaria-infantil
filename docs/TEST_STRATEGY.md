# Estrategia de testing

## 1. Pirámide

| Nivel | Herramienta | Qué cubre | Dónde corre |
|---|---|---|---|
| Unitario | Vitest | `packages/domain-*`: Money, Quantity, conversiones, explosión de fichas, máquinas de estado (cheques, OP, pedidos), algoritmos de imputación, costo promedio, cálculo de impuestos | Cada commit; tiene que tardar menos de 30 s |
| Integración | Vitest + Testcontainers (PostgreSQL real) | Casos de uso del API contra la base: transacciones, bloqueos, RLS, triggers *append-only*, idempotencia, permisos | Cada PR |
| Contrato | Zod + OpenAPI | Que el front y el back compartan esquemas; snapshot del OpenAPI | Cada PR |
| E2E | Playwright | Flujos A–E completos y recorridos por rol sobre la app levantada con el seed demo | Cada PR (subset *smoke*) y nightly (completo) |
| Concurrencia | Vitest + `Promise.all` sobre conexiones separadas | Carreras de reservas, imputaciones, numeración y estados de cheque | Cada PR |
| Reconciliación | Job + test | Saldos proyectados = Σ movimientos (stock, CC, tesorería) después de cada suite | Al final de la suite de integración |
| Accesibilidad | axe-core en Playwright | Pantallas principales sin violaciones AA | Nightly |
| Rendimiento | k6 (Fase 4) | Listados con 100.000 filas, carga de pedido, explosión de 50 OP | Antes de cada puesta en marcha |

**Cobertura objetivo:** 90 % en `domain-*` y 80 % en servicios de API. La cobertura de líneas no es la meta; la meta son **los invariantes probados**.

## 2. Invariantes que se verifican siempre

1. `stock_balances.on_hand = Σ stock_movements.qty` y `reserved = Σ reservas activas`.
2. `disponible ≥ 0` salvo en un depósito o item que permita negativos.
3. Saldo de cada tercero = `Σ account_entries.amount`; `open_amount` entre 0 y |amount|; Σ imputaciones de un comprobante ≤ su total.
4. Saldo de cada cuenta de tesorería = Σ `treasury_movements`.
5. Cada cheque está en un solo estado, y cada transición está en la tabla permitida.
6. Toda fila de movimiento tiene un documento origen y un usuario.
7. Ningún `UPDATE` ni `DELETE` sobre las tablas *append-only* (se espera la excepción).
8. Ninguna consulta devuelve datos de otra `company_id`.

## 3. Casos obligatorios (del pedido original y más)

| ID | Escenario | Resultado esperado |
|---|---|---|
| T-CON-01 | Dos vendedores reservan en paralelo la última unidad de BODY-ML-ROSA-3/6 | Uno reserva; el otro recibe `STOCK_INSUFICIENTE` (409); reservado = 1 |
| T-CON-02 | 20 reservas concurrentes sobre 10 unidades | Exactamente 10 reservadas, sin interbloqueos sin resolver |
| T-IDE-01 | Recepción reenviada con la misma `Idempotency-Key` (reintento de red) | Un solo `goods_receipt` y un solo movimiento; la segunda respuesta es idéntica |
| T-IDE-02 | Factura de proveedor con el mismo número cargada dos veces | Error de duplicado con enlace al existente |
| T-CC-01 | Factura de $100.000 con un cobro de $40.000 y otro de $60.000 | Saldo 0, dos imputaciones, factura cancelada |
| T-CC-02 | Un cobro de $150.000 imputado a tres facturas, con $10.000 sobrantes | Tres imputaciones y un anticipo de $10.000 |
| T-CC-03 | Reversa de imputación | Imputación inversa; `open_amount` restaurado; historial visible |
| T-CC-04 | Dos usuarios imputan el mismo saldo a la vez | Uno falla y se reintenta o se informa; nunca sobreimputa |
| T-DEV-01 | Devolución después de facturada | NC vinculada, reingreso de stock (si se elige) y CC ajustada |
| T-CHQ-01 | Cheque de tercero recibido, endosado a proveedor y luego rechazado | ND al cliente; deuda reabierta con el proveedor; el cheque queda `RECHAZADO` con la historia completa; no se duplican fondos |
| T-CHQ-02 | Intento de endosar un cheque ya depositado | `TRANSICION_INVALIDA` |
| T-CHQ-03 | Mismo cheque cargado dos veces (banco, número y CUIT) | Error de duplicado |
| T-CHQ-04 | Cheque diferido en cartera | No suma al "disponible" del tablero ni de tesorería |
| T-PRO-01 | OP con consumo real mayor al teórico | Se permite con motivo; el reporte de desvío lo muestra; el costo real lo refleja |
| T-PRO-02 | OP cancelada con materiales entregados al taller | No cierra hasta registrar devolución, consumo o pérdida; el stock del taller queda en 0 |
| T-PRO-03 | Cambio de ficha técnica después de liberar una OP | La OP conserva su versión; los costos históricos no cambian |
| T-PRO-04 | QC rechaza 5 de 100 | Ingresan 95 a PT; 5 van a reproceso o descarte según la decisión |
| T-TRX-01 | Falla simulada a mitad de la emisión de un remito (excepción después del primer movimiento) | Rollback total: sin movimientos, sin cambio de estado, reserva intacta |
| T-TRX-02 | ARCA no responde al autorizar una factura | La factura queda `PENDIENTE_AUTH`, sin CC; el reintento idempotente no duplica |
| T-MON-01 | Suma de 0,1 + 0,2 en importes, prorrateo de $100 en 3 líneas, IVA 10,5 % sobre $33,33 | Resultados exactos con reglas de redondeo documentadas (half-even o half-up según ARCA) y residuo asignado a la última línea |
| T-UOM-01 | Compra de un rollo de 50 m y consumo en metros | Stock en metros correcto; conversión incompatible (kg ↔ m sin factor) rechazada |
| T-PER-* | Matriz de permisos: cada endpoint × cada rol | 403 cuando corresponde, aunque la UI oculte el botón; el vendedor no ve costos; el operario no ve rentabilidad |
| T-TEN-01 | Usuario de la empresa A pide un ID de la empresa B | 404, sin filtrar existencia |

## 4. Datos de prueba

- **Factories** tipadas para unidades e integración.
- **Seed demo** determinista para E2E: "Ositos Algodón SRL" (ficticia), con 12 modelos, más de 200 SKU, 40 materiales, 8 proveedores, 3 talleres, 25 clientes mayoristas, OP en distintos estados, pedidos, facturas, cheques en cartera, endosados y rechazados, y gastos de 3 meses.
- Usuarios demo, uno por rol, con contraseña de demo solo en entornos no productivos.

## 5. Definición de "terminado" (aplica a cada historia)

1. La UI funciona.
2. El backend valida.
3. Los permisos se respetan en el backend.
4. Los datos persisten.
5. Los efectos relacionados son consistentes (los invariantes pasan).
6. Los errores se muestran en español claro.
7. Hay tests unitarios, de integración y E2E si es un flujo.
8. Está documentada (requisito y manual).
9. Se puede demostrar con el seed demo.
