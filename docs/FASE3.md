# Fase 3: comercial (precios, pedidos, remitos, facturación, cobros y comisiones)

Estado al 29/10/2026: **implementada y probada en entorno local**. La facturación electrónica funciona en **modo simulado**: falta el certificado de ARCA para homologar.

## Reglas del cliente incorporadas

| Regla | Cómo quedó en el sistema |
|---|---|
| **Comisión del vendedor sobre lo cobrado** (confirmado 29/10/2026) | La comisión se devenga cada vez que un cobro se imputa a una factura del vendedor: `cobrado × (neto / total de la factura) × %`. Si la imputación se revierte o el recibo se anula, se genera la comisión negativa. La base sin IVA es configurable (`sales.commissionBase`: `NET` o `TOTAL`). El % se toma del vendedor al facturar. |
| **Facturar por remito o agrupando remitos** (sin definir: "ambos") | Una factura incluye uno o varios remitos del mismo cliente; un remito se factura completo y una sola vez. |

## Qué incluye

| Área | Funcionalidad |
|---|---|
| Listas de precios | Precio por modelo con excepción por variante · con o sin IVA · **listas derivadas** (base ± %) · **historial completo** (cada cambio es una fila nueva, con vigencia futura opcional) · actualización masiva por % con redondeo a múltiplos |
| Clientes | Lista de precios y vendedor asignados en la ficha · descuento general · límite de crédito |
| Pedidos | Carga en **grilla talle × color** con el disponible por celda, curva rápida y pegado desde Excel · precio de la lista del cliente y su descuento (el vendedor no puede cambiar precios ni superar el descuento máximo, `sales.maxDiscountPct`, 15 %) · **control de crédito** (saldo + pedidos abiertos + remitos sin facturar) que exige autorización con motivo · al confirmar **reserva** lo disponible y deja el resto pendiente · "reservar pendientes" cuando entra mercadería · cancelación de pedido o de pendientes |
| Remitos | Emitidos desde el pedido, parciales · **única salida de stock por venta**, consumen la reserva y registran el costo de salida · imprimibles · anulación por reversa (con lote y costo) mientras no estén facturados |
| Comprobantes | Factura A/B/C según condición fiscal · desde uno o varios remitos · **nota de crédito** por cantidades (con devolución al depósito al costo de salida) o por bonificación · **nota de débito** · se aplican automáticamente a la factura · imprimibles con CAE |
| ARCA | Pedido de CAE armado según WSFEv1 (tipos, alícuotas, condición IVA del receptor RG 5616, comprobante asociado) y validado antes de enviar · numeración correlativa serializada por punto de venta y tipo · **rechazo**: el comprobante queda sin número ni efectos y libera los remitos · **error de conexión**: queda "esperando CAE" y se reintenta sin duplicar |
| Cobros | Recibo con varios medios (efectivo, transferencia, cheque, e-cheq, tarjeta, Mercado Pago, retención) · imputación sugerida por vencimiento y editable · lo no imputado queda como saldo a favor · control de cheque duplicado · anulación que revierte imputaciones y comisiones |
| Cuentas a cobrar | Saldos con vencido y +60 días · **estado de cuenta** imprimible con antigüedad (a vencer, 1–30, 31–60, 61–90, +90) · imputación de saldos a favor · reversa de imputaciones con motivo |
| Comisiones | Vendedores y su % · detalle por cobro · liquidación por vendedor hasta una fecha · cada vendedor ve solo las suyas |
| Roles | Ventas carga y confirma pedidos; Depósito emite remitos; Administración factura, cobra, autoriza crédito y liquida comisiones; Tesorería cobra |

## Decisiones técnicas

- **Imputaciones append-only** (`account_allocations`): la reversa es otra fila; nunca se edita la original. Se verifica que el saldo abierto de cada movimiento sea igual al importe menos sus imputaciones vigentes.
- **Comprobante en dos pasos**: se registra "esperando CAE" (reserva los remitos) y luego se autoriza bajo un *advisory lock* por punto de venta y tipo. Así un error de red no pierde ni duplica números.
- **Número de venta único** por tipo y punto de venta (índice parcial); una línea de remito se factura una sola vez (índice único).
- **Fechas**: las columnas de fecha se muestran en UTC (son días calendario). Antes, en Argentina, se veían un día antes; afectaba a todas las pantallas y quedó corregido.

## Pruebas automatizadas (todas en verde)

- **49 unitarias** de dominio, 18 nuevas: letra del comprobante, precios con y sin IVA, listas derivadas y redondeo, totales con descuento, crédito, imputación FIFO, comisión sobre lo cobrado (y su reversa), estado del pedido y armado del pedido de CAE.
- **69 de integración** contra PostgreSQL, 18 nuevas:
  - **Flujo B completo**: pedido → reserva con faltante → crédito excedido con autorización → remito parcial → reserva de pendientes → segundo remito → factura de dos remitos → cobro parcial con comisión → NC con devolución al costo → cobro final → reversa con comisión negativa → liquidación → anulación de recibo → nota de débito.
  - Rechazo de ARCA sin consumir número, dos facturas simultáneas del mismo remito (una sola prospera), facturas concurrentes con números correlativos, anulación de remito, listas de precios y permisos por rol.
  - Al final se verifican la invariante de stock y la de cuenta corriente.
- **22 E2E** con Playwright (escritorio y celular), 5 nuevos: el flujo B completo en pantalla, la vendedora (no factura, ve sus comisiones, carga desde el celular sin scroll horizontal), el estado de cuenta y las listas de precios.

## Cómo demostrarla

1. Ingresar como `ventas@ositos.demo` → **Pedidos → Nuevo pedido** → elegir cliente y modelo, cargar la grilla → "Guardar y confirmar".
2. Ingresar como `deposito@ositos.demo` → abrir el pedido → **Preparar remito** → emitir.
3. Ingresar como `administracion@ositos.demo` → **Comprobantes → Facturar remitos** → emitir. Probar una nota de crédito con devolución.
4. **Cobros → Nuevo cobro** → imputar por vencimiento. Ver **Cuentas a cobrar** y **Comisiones**.
5. Datos demo ya cargados: 5 pedidos en distintos estados, 3 facturas, 1 NC, 2 cobros (uno con cheque) y la comisión de Paula Ventas.

## Limitaciones conocidas

- **ARCA en modo simulado**: el CAE es ficticio y los comprobantes muestran "SIN VALIDEZ FISCAL". Para homologar hace falta que la empresa genere el certificado con su clave fiscal y habilite un punto de venta electrónico. Hasta entonces los modos `HOMOLOGATION` y `PRODUCTION` están bloqueados a propósito, con un mensaje claro: el cliente WSAA/WSFE no se escribió sin poder probarlo.
- ~~Cobros sin tesorería~~: resuelto en la Fase 4 (ver [FASE4.md](FASE4.md)). El rechazo de un cheque genera un débito automático al cliente.
- **Sin percepciones de IIBB ni IVA en ventas** (hay que definir en qué jurisdicciones es agente).
- **Remitos internos (letra X)**: no se gestionan CAI ni COT de ARBA.
- **Sin presupuestos, promociones ni descuentos por volumen** (Fase 5).
- **Comisión con un % por vendedor**: si el cliente indica que varía por producto o cliente, se agrega.
- La API de desarrollo limita los ingresos por IP; para correr toda la suite E2E se levanta con `LOGIN_RATE_LIMIT=200`.
