# Definiciones de indicadores

Cada número del sistema tiene una única definición. Las del tablero de Dirección viven en el código en `packages/contracts/src/metrics.ts`: son el texto del ⓘ de cada indicador y este documento las repite. Si cambia un cálculo, se cambia en los dos lugares y en `apps/api/src/reports/executive.service.ts`.

Convenciones generales:

- **Fechas**: día calendario de Buenos Aires. "Hoy" es el día de negocio, no el del servidor.
- **Importes**: en pesos, redondeados a 2 decimales. Las ventas se miden **netas de IVA**; lo cobrado y lo adeudado, **con IVA** (es lo que se mueve en caja y en cuentas corrientes).
- **Comprobantes vigentes**: se excluyen los anulados, los rechazados por ARCA y los pendientes de autorización.
- **Comparaciones**: "mismo tramo del mes anterior" es del 1 al mismo día del mes anterior (o hasta su último día si es más corto). Si el período anterior es cero, no se muestra variación porcentual sino el valor anterior.

## Tablero de Dirección (Inicio)

Lo ven Dirección, Administración y Auditoría (permiso `executive.view`).

| Indicador | Definición | Fórmula | Compara contra | Al hacer clic |
|---|---|---|---|---|
| Vendido en el mes | Facturación neta de IVA del mes en curso | Σ neto (facturas + notas de débito − notas de crédito) con emisión del 1 del mes a hoy | Mismo tramo del mes anterior | Comprobantes de venta |
| Cobrado en el mes | Total de recibos vigentes del mes, con todos sus medios (incluye retenciones sufridas) | Σ total de recibos con fecha del 1 del mes a hoy | Mismo tramo del mes anterior | Cobros |
| Disponible real | Dinero disponible hoy en cajas, bancos y billeteras a fecha de valor; sin cheques en cartera ni tarjetas a acreditar | Σ ingresos − egresos con fecha de valor ≤ hoy en cajas, bancos y billeteras activas | Disponible a la misma fecha del mes anterior | Tesorería |
| Cheques en cartera a 30 días | Cheques de terceros en cartera con fecha de pago de hoy a 30 días, incluidos los vencidos sin depositar | Σ importe con fecha de pago ≤ hoy + 30 | — (se informa la cantidad) | Tesorería |
| Deuda de clientes vencida | Saldo pendiente de facturas y débitos a clientes ya vencidos | Σ saldo abierto de débitos con vencimiento < hoy | — (se informa la cantidad) | Cuentas a cobrar |
| Deuda con proveedores a 30 días | Saldo pendiente con proveedores y talleres que vence en 30 días, incluido lo vencido | Σ saldo abierto de facturas con vencimiento ≤ hoy + 30 (o sin vencimiento) | — (se informa la cantidad) | Cuentas a pagar |

Los tres últimos no tienen comparación: reconstruir la cartera o los saldos abiertos de una fecha pasada exige recorrer historiales de eventos e imputaciones. Se puede sumar si los dueños lo necesitan.

### Debajo de los indicadores

- **Flujo proyectado a 8 semanas**: la misma proyección de Finanzas → Flujo de fondos (ver FASE4.md), con lo vencido en la primera semana.
- **Atención**:
  - cheques rechazados en los últimos 30 días;
  - órdenes de producción liberadas o en proceso con fecha comprometida vencida;
  - requerimientos de materiales de OP en curso sin stock suficiente en el depósito de materiales;
  - clientes cuyo saldo en cuenta corriente supera su límite de crédito.
- **Top 10 modelos**: neto facturado (facturas y débitos menos créditos) de los últimos 30 días, agrupado por modelo.
- **Sin ventas en 90 días**: modelos con stock que no tuvieron ninguna entrega a clientes (remito) en 90 días. Son candidatos a liquidar.
- **Producción en curso**: para cada etapa, unidades terminadas sobre unidades planificadas, en las OP liberadas o en proceso.

## Rentabilidad (Análisis → Rentabilidad)

Siempre se rotula **margen bruto estimado**, nunca como resultado contable (RF-COS-03). Definiciones en `PROFITABILITY_METRICS` (`packages/contracts/src/metrics.ts`) y cálculo en `apps/api/src/reports/profitability.service.ts`. La ven quienes tienen `sales.view` y `costs.view`.

| Indicador | Definición | Fórmula |
|---|---|---|
| Vendido neto | Facturación neta de IVA del período, comprobantes vigentes | Σ neto (F + ND − NC) con emisión en el período |
| Costo de lo vendido | Costo de salida guardado en el remito facturado (promedio ponderado del depósito al entregar; las prendas producidas entran al costo estimado de la ficha) | Σ cantidad facturada × costo de salida − devoluciones al mismo costo |
| Margen bruto estimado | Vendido neto − costo de lo vendido. No descuenta gastos, comisiones, fletes ni impuestos | % = margen ÷ vendido neto |

Reglas:

- **Notas de crédito con devolución**: restan unidades, venta y costo (al costo de la entrega original).
- **Notas de crédito sin devolución** (por cantidades o bonificación) y **notas de débito**: solo cambian la venta; las unidades y el costo quedan.
- **Conceptos sin artículo** (fletes, bonificaciones sueltas): se agrupan como "Otros conceptos" por modelo y categoría, y "Sin pedido" por pedido.
- **Unidades sin costo**: si el costo de salida es cero, se avisa; su margen figura al 100 % y el total queda sobreestimado.
- **Agrupaciones**: modelo, categoría, cliente, pedido (por el remito facturado) y vendedor (el de la factura). Todas suman el mismo total.

## Centro de reportes (Análisis → Reportes)

Cada reporte trae su nota de cálculo en pantalla y en los archivos. Criterios comunes:

| Reporte | Criterio |
|---|---|
| Ventas por período, Ranking | Neto de IVA de comprobantes vigentes (F + ND − NC). Las NC restan unidades solo si hubo devolución. Ranking ABC: A hasta el 80 % acumulado, B hasta el 95 %, C el resto, según dónde empieza cada modelo |
| Baja rotación | Modelos con stock en depósitos propios sin remitos a clientes en los últimos N días (90 por defecto) |
| Pedidos pendientes | Pedido − entregado − cancelado; neto a precio del pedido con descuento, sin IVA; atraso contra la fecha prometida |
| Stock valorizado | Costo promedio ponderado por depósito (ADR-007), todas las existencias incluidas talleres |
| Stock crítico | Stock en depósitos propios < mínimo; reposición sugerida = mayor entre faltante y cantidad de reposición |
| Kardex | Saldo inicial = suma de movimientos anteriores al período; fecha del movimiento en hora de Buenos Aires |
| OP abiertas | Liberadas, en proceso o terminadas sin cerrar; avance = buenas ingresadas ÷ planificadas |
| Antigüedad | Días de vencido a hoy por fecha de vencimiento (o de emisión); tramos a vencer, 1–30, 31–60, 61–90, +90; pagos sin imputar aparte |
| Caja y bancos | Por fecha de operación (la del arqueo y el extracto), sin la cartera de cheques |
| Flujo a 90 días | La proyección de Flujo de fondos a 13 semanas, con lo vencido en la primera |
| Gastos | Gastos pagados vigentes por categoría o centro de costo |

## Otros indicadores ya definidos

- **Flujo de fondos, conciliación, arqueo y cierre de período**: FASE4.md.
- **Comisiones**: FASE3.md. Se devengan al cobrar, proporcionales a lo cobrado de cada factura.
- **Costo estimado y real de producción**: FASE2.md.

