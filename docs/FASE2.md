# Fase 2: operación industrial (compras, producción y talleres)

Estado al 28/10/2026: **implementada y probada en entorno local**. Pendiente de revisión con los dueños.

## Reglas del cliente incorporadas

| Regla confirmada | Cómo quedó en el sistema |
|---|---|
| **El taller cotiza por prenda terminada, un precio por modelo** | Tarifas por taller × modelo con vigencia (historial: una tarifa nueva no pisa la anterior). Cada recepción guarda la tarifa vigente a su fecha. La liquidación paga prendas aprobadas y de segunda; el descarte no se paga; los descuentos (faltantes, fallas) se cargan a mano. |
| Vendedores: sueldo fijo + comisión | Se implementa en la Fase 3 (ventas). Falta definir si la comisión es sobre lo facturado o lo cobrado. |

## Supuestos configurables (todavía sin confirmar)

| Tema abierto | Cómo lo resolví sin cerrar la puerta |
|---|---|
| ¿Corte por tizada o por prenda? | La ficha define el consumo por prenda y por talle, más un % de merma, que es donde se refleja la tizada. El consumo real se registra al entregar el material y el desvío queda visible por orden. Si cortan por tizada con varias órdenes juntas, falta una pantalla de "tendido". |
| ¿El taller recibe tela o piezas cortadas? | Soporta los dos casos. **Corte propio:** "Entregar a planta" consume el material y el envío al taller lleva solo las prendas a confeccionar más los avíos. **Corte en el taller:** el envío transfiere tela y avíos al depósito virtual del taller. Al recibir prendas, el sistema consume ahí lo que indica la ficha (*backflush*). |
| Recorrido de etapas | Etapas configurables. Cada ficha define su recorrido y las etapas marcadas "la hace un taller" se asignan al taller del envío. |

## Qué incluye

| Área | Funcionalidad |
|---|---|
| Compras | Solicitudes (manuales o generadas desde los faltantes de una orden de producción) · órdenes de compra con aprobación por monto (sin autoaprobación) · recepciones parciales con tolerancia del 5 % y partida obligatoria en telas · **compra directa** sin orden de compra · **solo la recepción mueve stock** |
| Comprobantes | Facturas y notas de crédito o débito de proveedor vinculadas a recepciones, con control de duplicados (proveedor + tipo + punto de venta + número), IVA por alícuota con redondeo por línea, percepciones y advertencias de diferencia de precio o cantidad (tolerancia del 2 %) |
| Cuentas a pagar | Libro de cuenta corriente por proveedor y taller (los importes no se pueden editar ni borrar) · saldos, vencido y próximo vencimiento |
| Fichas técnicas | Versionadas (borrador → vigente → archivada) · material fijo o **según el color de la prenda** · consumo por talle · merma · recorrido · costo estimado por variante. **Una orden liberada conserva su versión.** |
| Órdenes de producción | Alta con grilla talle × color · **liberación**: congela la ficha, calcula los materiales (los que van por unidad se redondean hacia arriba), reserva lo disponible e informa faltantes · solicitud de compra de faltantes en un clic · entrega a planta y devoluciones (a costo de salida) · avances por etapa · cierre con **costo real** · cancelación controlada |
| Talleres | Envío (remito) con prendas y materiales transferidos al depósito del taller · materiales en poder de cada taller por orden · recepción con control de calidad · consumo automático según ficha · devolución de sobrantes y registro de faltantes · liquidación que genera el comprobante y la deuda |
| Calidad | Aprobadas → producto terminado · segunda selección → su depósito · descarte con motivo · **solo lo aprobado entra al stock de producto terminado** |
| Planta | "Mis tareas" para operarios, pensada para celular: botones grandes, informar avance en 3 toques, sin ver costos |
| Tablero | Órdenes por estado, atrasadas (según el calendario de Buenos Aires), faltantes de materiales, trabajo pendiente en talleres |
| Motor de stock | Ahora maneja reservas y disponible sumando partidas: una orden puede reservar tela aunque esté repartida en lotes, y las salidas sin lote indicado consumen la partida más antigua primero (FIFO) |

## Pruebas automatizadas (todas en verde)

- **33 unitarias** de dominio: las 22 de la Fase 1, más la explosión de la ficha por color, talle y merma, faltantes, costo estimado y real, transiciones de estado, totales de comprobantes y desvío de precio.
- **51 de integración** contra PostgreSQL. Las nuevas cubren:
  - **Flujo A completo:** falta tela → solicitud → OC → recepción parcial y total con partida → factura con percepción y diferencia de precio → duplicado rechazado → entrega con consumo mayor al previsto → avance → control de calidad → cierre con costo real.
  - **Flujo D completo:** reserva → envío al taller → no se puede recibir de más → recepción con aprobadas, segunda y descarte → consumo en el taller → cierre bloqueado con material en el taller → devolución → cierre → liquidación con descuento → doble liquidación rechazada.
  - Cancelación con materiales en el taller, cambio de ficha sin afectar órdenes liberadas, ficha incompleta, dos órdenes compitiendo por la misma tela, aprobación de órdenes de compra y sobre-recepción, permisos del operario, fecha de negocio.
  - Al final de cada suite se verifica la invariante **saldo = Σ movimientos** (incluidas las partidas).
- **17 E2E con Playwright:** 9 de la Fase 1 y 8 de la Fase 2. Cubren tablero, alta y liberación de orden, detalle con talleres y costos, operario en el celular, ficha técnica, OC → recepción con partida, y cuentas a pagar.

## Cómo demostrarla

1. Ingresar como `produccion@ositos.demo` → **Tablero**: el Enterito tiene faltante de interlock celeste y el taller Rosa tiene trabajo pendiente.
2. **Órdenes → OP-00004 (Enterito)** → "Pedir faltantes a Compras".
3. Ingresar como `compras@ositos.demo` → Solicitudes → generar la OC → recibirla con partida.
4. Volver a la OP → Talleres → nuevo envío al taller Ramírez (precarga lo pendiente) → Ingresos → recepción con aprobadas, segunda y descarte.
5. Devolver el sobrante y cerrar: aparece el costo real comparado con el estimado.
6. Ingresar como `administracion@ositos.demo` → Liquidación de talleres → liquidar con descuento → ver la cuenta a pagar del taller.
7. Ingresar como `operario@ositos.demo` desde el celular → Mis tareas → informar avance.

## Limitaciones conocidas (a propósito, a revisar)

- **El costo de las prendas ingresadas es el estimado.** El costo real se calcula al cerrar la orden y queda en el reporte de la orden, pero no se revalúa el stock ya ingresado (puede haberse vendido una parte). La diferencia se ve por orden; la revaluación queda para la Fase 5.
- **Una diferencia de precio en la factura no cambia el costo del stock.** El costo es el de la recepción (precio de la OC). La diferencia queda marcada como advertencia. Prorratear fletes y diferencias es Fase 5.
- **No hay anulación de recepciones, comprobantes ni envíos a taller.** Por ahora se corrigen con ajustes y notas de crédito. Anular por reversa, como ya existe para documentos de stock, es lo próximo.
- **Indirectos:** `production.overheadPerUnit` (por unidad buena) se configura por base. Falta la pantalla y el prorrateo por minutos.
- **Órdenes demo anteriores al redondeo por unidad:** las órdenes demo creadas antes de este ajuste conservan requerimientos de broches con decimales. Para regenerar todo limpio: `cd apps/api && npx prisma migrate reset` (borra la base de desarrollo) y luego `pnpm db:seed`.

## Decisiones tomadas en esta fase

- **Fecha de negocio:** "hoy" se define en `America/Argentina/Buenos_Aires` (`BUSINESS_TZ`), no en UTC ni en la zona del servidor.
- **Materiales contados por unidad:** se redondean hacia arriba al liberar y al consumir en el taller.
- **Nuevo rol "Operario de planta":** solo ve sus tareas y órdenes, sin costos. El rol Producción ahora ve costos estimados y reales de sus órdenes; Depósito no.
- **Segregación de funciones:** quien carga una OC o un ajuste por encima del umbral no puede aprobarlo.
