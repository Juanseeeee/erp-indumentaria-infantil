# Requisitos funcionales

> Prioridad: **MVP** = primera puesta en marcha · **F2** = segunda ola · **F3** = posterior.
> Cada requisito tiene un ID estable (`RF-<módulo>-NN`) que se usa en los tests y en los PR.

## Mapa de módulos

| # | Módulo | Submódulos | Prioridad |
|---|---|---|---|
| 0 | Plataforma | Empresa, sucursales, usuarios, roles y permisos, auditoría, numeración, adjuntos, notificaciones, configuración, importadores | MVP |
| 1 | Tableros | Dirección, administración, producción, comercial | MVP básico / F2 completo |
| 2 | Catálogo | Modelos, variantes (matriz), escalas de talles, colores, colecciones y temporadas, imágenes, códigos de barras | MVP |
| 3 | Materiales | Materias primas e insumos, unidades y conversiones, lotes y rollos, proveedor habitual | MVP |
| 4 | Compras | Solicitudes, OC, recepciones, comprobantes de proveedor, devoluciones, *three-way match* | MVP (sin cotizaciones) |
| 5 | Producción | Fichas técnicas versionadas, explosión de materiales, OP, etapas configurables, avances, talleres externos, control de calidad, cierre y costo real | MVP (núcleo) / F2 (liquidación avanzada y tiempos) |
| 6 | Inventario | Depósitos y ubicaciones, movimientos, transferencias, reservas, ajustes, conteos, kardex, valorización | MVP |
| 7 | Ventas | Clientes, presupuestos, pedidos en grilla, reservas, preparación, remitos, facturas, devoluciones, listas de precios, descuentos, comisiones | MVP (comisiones y promos en F2) |
| 8 | Cuentas corrientes | Clientes, proveedores y talleres; imputaciones N:M, antigüedad, estados de cuenta | MVP |
| 9 | Tesorería | Cajas, bancos, cobros, pagos, transferencias, arqueos, conciliación | MVP (conciliación asistida en F2) |
| 10 | Cheques | Propios y de terceros, físicos y ECHEQ (registro), cartera, endoso, depósito, rechazo, calendario | MVP |
| 11 | Gastos y costos | Gastos por categoría y centro de costos, costo estimado y real, prorrateo de indirectos | MVP gastos / F2 costos reales completos |
| 12 | Reportes y BI | Reportes comerciales, productivos, de inventario, financieros y gerenciales con exportación | MVP (set mínimo) / F2 |
| 13 | Alertas y automatizaciones | Centro de notificaciones, reglas, email | MVP (in-app) / F2 (email) / F3 (WhatsApp) |
| 14 | Integraciones | ARCA (WSFE), padrón, extractos bancarios, Mercado Pago, etiquetas | F2 / F3 tras investigación |

## 0. Plataforma

- **RF-PLT-01** Login con email y contraseña; sesión con cookie httpOnly; cierre de sesión y cierre remoto de todas las sesiones.
- **RF-PLT-02** 2FA TOTP opcional por usuario y obligatorio por rol si se configura.
- **RF-PLT-03** Roles predefinidos (Superadmin, Dirección, Administración, Compras, Producción, Depósito, Ventas, Tesorería, Contabilidad, Auditor), roles personalizados y una matriz de permisos `ver / crear / editar / aprobar / anular / exportar / ver sensible` por recurso.
- **RF-PLT-04** Alcances por usuario: un vendedor ve solo sus clientes, un operario solo sus órdenes o etapas, un depósito solo su almacén.
- **RF-PLT-05** Auditoría de toda operación crítica (crear, editar, aprobar, anular), consultable por entidad y por usuario.
- **RF-PLT-06** Numeración configurable por tipo de documento y punto de venta.
- **RF-PLT-07** Reglas de aprobación configurables por monto o tipo de operación.
- **RF-PLT-08** Adjuntos (PDF e imágenes) en cualquier documento, con acceso según los permisos del documento.
- **RF-PLT-09** Buscador global (Ctrl+K) de clientes, proveedores, productos, SKU, documentos y acciones.
- **RF-PLT-10** Importadores CSV y Excel con validación previa, vista de errores, detección de duplicados, confirmación y reversa del lote.
- **RF-PLT-11** Activación o desactivación de funcionalidades por empresa (talleres externos, venta minorista, lotes, ubicaciones, multimoneda, cotizaciones…).

## 2. Catálogo

- **RF-CAT-01** Alta de un modelo con escala de talles y colores. El sistema **genera todas las variantes** (SKU = `MODELO-COLOR-TALLE`, con patrón configurable) y permite desactivar combinaciones puntuales.
- **RF-CAT-02** Vista matricial talle × color para ver stock físico, reservado, disponible y en producción, precios y estado. Se puede editar en la grilla: precio por talle, código de barras, activar o desactivar.
- **RF-CAT-03** Códigos de barras propios (EAN-13 interno o Code128) generados automáticamente e impresión de etiquetas por variante y cantidad.
- **RF-CAT-04** Imágenes por modelo y por color.
- **RF-CAT-05** Estado comercial: borrador, activo o discontinuado. Un discontinuado no aparece en la grilla de pedidos pero conserva el historial.
- **RF-CAT-06** Duplicar un modelo, con su ficha y sus precios, para la siguiente temporada.

## 3. Materiales

- **RF-MAT-01** Alta de material con categoría, UoM base, UoM de compra y conversión, proveedor habitual, stock mínimo y punto de pedido.
- **RF-MAT-02** Atributos de tela opcionales: ancho, composición, gramaje, color.
- **RF-MAT-03** Control por lote o rollo opcional por material; la recepción captura el lote y los metros o kilos de cada rollo.
- **RF-MAT-04** Las conversiones solo se permiten entre dimensiones compatibles o con un factor específico por material (por ejemplo, 1 rollo = 50 m de *esta* tela; 1 kg de morley ≈ X m, con advertencia de que es un rendimiento estimado).

## 4. Compras

- **RF-COM-01** Solicitud de compra manual, generada desde stock mínimo o desde faltantes de producción.
- **RF-COM-02** Orden de compra con aprobación según regla, envío por PDF o email y estado de recepción por línea.
- **RF-COM-03** Recepción total o parcial contra OC o sin OC (compra directa). **Solo la recepción mueve stock.**
- **RF-COM-04** Registro de la factura del proveedor con control de duplicado (proveedor, tipo, punto de venta y número), emparejamiento contra recepción y OC y alerta por diferencias de precio o cantidad fuera de tolerancia.
- **RF-COM-05** Percepciones, IVA por alícuota, descuentos y gastos asociados (flete), que se pueden prorratear al costo del material.
- **RF-COM-06** Devolución al proveedor (movimiento de stock) y nota de crédito.
- **RF-COM-07** **Circuito simplificado:** "compra rápida", es decir proveedor, ítems y factura en una sola pantalla, que genera la recepción y el comprobante.

## 5. Producción

- **RF-PRO-01** Ficha técnica por modelo, con materiales (consumo base y consumo por talle opcional), regla color de prenda → material, % de merma, operaciones con tiempos y tarifa de taller, instrucciones y adjuntos.
- **RF-PRO-02** Versionado de la ficha. Una OP liberada **congela** la versión, y modificar la ficha no altera las OP existentes ni los costos históricos.
- **RF-PRO-03** Crear una OP cargando cantidades en la grilla talle × color, o desde pedidos pendientes o faltantes de stock.
- **RF-PRO-04** Explosión de materiales: requerido, disponible, reservado para otras OP, faltante y compra sugerida, con un botón para "generar solicitud de compra".
- **RF-PRO-05** Liberar la OP reserva los materiales disponibles. La entrega a corte o a taller los consume (movimiento a depósito de taller o consumo directo).
- **RF-PRO-06** Etapas configurables por recorrido (*routing*). Cada OP sigue el recorrido del modelo y admite saltear o agregar etapas con permiso.
- **RF-PRO-07** Informe de avance por etapa, variante y cantidad (buenas, falladas, descarte), pensado para celular.
- **RF-PRO-08** Talleres: remito de envío (materiales o piezas cortadas), materiales en poder del taller, recepción de prendas con aprobadas, rechazadas y faltantes, devolución de sobrantes, liquidación de servicios que genera el comprobante en la cuenta corriente del taller y descuentos por faltantes o fallas.
- **RF-PRO-09** Control de calidad: inspección con motivos de defecto, reproceso que vuelve a una etapa y descarte. **Solo lo aprobado ingresa al depósito de producto terminado.**
- **RF-PRO-10** Consumo real distinto al teórico, registrado con motivo, y reporte de desvíos.
- **RF-PRO-11** Cierre de la OP: calcula el costo real (materiales al costo de salida, mano de obra o taller, indirectos prorrateados, merma) y el costo unitario por variante. El ingreso al depósito se hace a ese costo y se ajusta al cierre si cambió.
- **RF-PRO-12** Cancelación de una OP con materiales entregados: obliga a registrar devolución, consumo o pérdida antes de cerrar.

## 6. Inventario

- **RF-INV-01** Múltiples depósitos (propio, taller, tránsito, cuarentena) y ubicaciones opcionales.
- **RF-INV-02** Stock físico, reservado, disponible, en producción y en talleres, por item, depósito y lote.
- **RF-INV-03** Transferencias entre depósitos con remito interno; opcionalmente en dos pasos (enviado y recibido).
- **RF-INV-04** Ajustes con motivo obligatorio y aprobación sobre umbral.
- **RF-INV-05** Inventario físico total o cíclico con hoja de conteo (con lector), revisión de diferencias y posteo de ajustes.
- **RF-INV-06** Kardex por item con trazabilidad al documento origen, y valorización a costo promedio ponderado.
- **RF-INV-07** Stock negativo bloqueado salvo configuración explícita.
- **RF-INV-08** Alertas de stock mínimo y punto de pedido.

## 7. Ventas

- **RF-VEN-01** Ficha de cliente: datos fiscales (con autocompletado por padrón en F2), domicilios de entrega, contactos, zona, vendedor, lista de precios, condición de pago, límite de crédito y descuento general.
- **RF-VEN-02** **Pedido en grilla:** buscar un modelo y cargar cantidades por talle × color en una matriz que muestra el disponible en cada celda. Admite atajos para "curva" (por ejemplo, 2-2-2-1-1) y para "repetir el último pedido".
- **RF-VEN-03** Validación de crédito: saldo + pedidos abiertos + cheques en cartera del cliente comparados con el límite. Si se excede, bloquea o pide aprobación.
- **RF-VEN-04** Reserva al confirmar, total o parcial. Lo que falta queda como *backorder* o se vincula a una OP.
- **RF-VEN-05** Preparación (*picking*) con lector y emisión de remito. Admite entregas parciales.
- **RF-VEN-06** Factura desde uno o varios remitos, o directa. NC y ND vinculadas. Una NC por devolución ofrece reingresar el stock.
- **RF-VEN-07** Listas de precios (minorista, mayorista, especiales), precio por modelo con excepción por variante, listas derivadas (+ o − %), actualización masiva por % o importación, e historial.
- **RF-VEN-08** Descuentos por volumen, por cliente y promociones con vigencia.
- **RF-VEN-09** Presupuestos convertibles en pedido.
- **RF-VEN-10** Comisiones por vendedor sobre lo facturado o lo cobrado (a definir).

## 8. Cuentas corrientes

- **RF-CC-01** Libro de movimientos por cliente, proveedor y taller, con saldo, vencimientos y antigüedad (0-30, 31-60, 61-90, +90).
- **RF-CC-02** Imputación N:M con sugerencia automática (FIFO por vencimiento) y edición manual.
- **RF-CC-03** Anticipos y saldos a favor que luego se imputan.
- **RF-CC-04** Reversa de imputaciones con motivo e historial.
- **RF-CC-05** Estado de cuenta imprimible y exportable, con envío por email.
- **RF-CC-06** Saldos iniciales por migración (comprobante a comprobante o saldo único por tercero).

## 9. Tesorería

- **RF-TES-01** Cajas y cuentas bancarias con saldo por fecha de operación y por fecha de valor.
- **RF-TES-02** Recibo de cobro con múltiples medios (efectivo, transferencia, cheques, ECHEQ, retenciones sufridas) que se imputa en el mismo paso.
- **RF-TES-03** Orden de pago con múltiples medios (cheques de cartera, cheque propio, transferencia, efectivo), aprobación según regla y emisión de la orden de pago en PDF.
- **RF-TES-04** Transferencias entre cuentas, depósitos y extracciones.
- **RF-TES-05** Arqueo y cierre de caja con diferencia registrada.
- **RF-TES-06** Importación de extractos y conciliación con sugerencias por importe y fecha (F2).
- **RF-TES-07** Control de duplicados (misma cuenta, importe, fecha y referencia) con advertencia.
- **RF-TES-08** Movimientos varios de ingreso y egreso con concepto y centro de costo.

## 10. Cheques

- **RF-CHQ-01** Alta de un cheque de tercero desde el recibo. Detecta duplicados (banco, número y CUIT del librador, o ID de ECHEQ).
- **RF-CHQ-02** Cartera con filtros por vencimiento, banco, librador y cliente.
- **RF-CHQ-03** Endoso a proveedor desde la orden de pago, eligiendo de la cartera con suma automática para llegar al importe.
- **RF-CHQ-04** Depósito (boleta) y acreditación individual o masiva.
- **RF-CHQ-05** Rechazo: genera una ND al cliente por el importe más los gastos configurables; si el cheque estaba endosado, registra el reclamo del proveedor (deuda nuevamente abierta). Alerta inmediata.
- **RF-CHQ-06** Cheques propios: chequeras, emisión desde la orden de pago, débito al vencimiento (manual o por conciliación) y anulación.
- **RF-CHQ-07** Calendario financiero: cheques a cobrar y a pagar por fecha más el flujo proyectado.
- **RF-CHQ-08** Historial completo de eventos por cheque, con origen y destino.

## 11. Gastos y costos

- **RF-GAS-01** Registro de gasto con categoría, centro de costo, comprobante y medio de pago o cuenta corriente.
- **RF-GAS-02** Gastos recurrentes desde plantilla.
- **RF-COS-01** Costo estimado por modelo y variante a partir de la ficha activa y los últimos costos.
- **RF-COS-02** Costo real por OP.
- **RF-COS-03** Rentabilidad por producto, categoría, pedido y cliente, siempre etiquetada como "margen bruto estimado" o "real de producción", nunca como resultado contable.

## 12. Reportes

El set mínimo del MVP:

- ventas por período, cliente, vendedor y modelo;
- ranking de productos y productos de baja rotación;
- pedidos pendientes;
- stock valorizado y stock crítico;
- kardex;
- OP abiertas y atrasadas;
- materiales en talleres;
- cuentas a cobrar y a pagar con antigüedad;
- cartera de cheques;
- caja y bancos;
- flujo proyectado a 90 días;
- gastos por categoría.

Todos se exportan a Excel y PDF. Las definiciones están en `docs/METRICS.md`, que se escribe en la Fase 1.

## 13. Alertas

Eventos del MVP:

- stock mínimo;
- faltante de material para una OP liberada;
- OP atrasada;
- pedido sin preparar con más de N días;
- cliente con deuda vencida;
- cheque que vence en N días;
- cheque rechazado;
- aprobación pendiente;
- diferencia de inventario;
- falla de reconciliación;
- error de integración.

Cada alerta tiene destinatarios por rol o usuario, prioridad, estado (nueva, vista o resuelta) y un enlace a la operación.

## Requisitos no funcionales

| ID | Requisito |
|---|---|
| RNF-01 | P95 menor a 300 ms en las operaciones de carga habituales y listados paginados server-side de hasta 100.000 filas |
| RNF-02 | Disponibilidad objetivo del 99,5 % en horario laboral; RPO ≤ 15 min (PITR) y RTO ≤ 4 h |
| RNF-03 | Accesibilidad WCAG 2.1 AA en los flujos principales; navegación completa por teclado |
| RNF-04 | Responsive: escritorio para administración y tablet o celular para planta y depósito |
| RNF-05 | Toda la interfaz en español argentino: formato `dd/mm/aaaa`, `$ 1.234,56` y vos/usted (a definir; propuesta: voseo neutro en microcopy) |
| RNF-06 | Ninguna operación de stock o dinero sin documento y auditoría |
