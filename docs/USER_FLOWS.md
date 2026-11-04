# Flujos de usuario y diseño de navegación / UX

## 1. Navegación

### Sidebar (colapsable; los ítems se ocultan según permisos y funcionalidades activas)

```
● Inicio                     (tablero según rol)
● Bandeja                    (tareas, aprobaciones, alertas)  [badge]
─ COMERCIAL
  Pedidos · Presupuestos · Remitos · Facturas · Clientes · Listas de precios
─ PRODUCCIÓN
  Órdenes · Planificación (necesidades) · Talleres · Control de calidad · Fichas técnicas
─ INVENTARIO
  Stock · Movimientos · Transferencias · Conteos · Depósitos
─ COMPRAS
  Solicitudes · Órdenes de compra · Recepciones · Comprobantes · Proveedores
─ FINANZAS
  Cobros · Pagos · Cheques · Caja y bancos · Cuentas corrientes · Gastos · Conciliación
─ CATÁLOGO
  Modelos · Materiales
─ REPORTES
─ CONFIGURACIÓN              (solo admin)
```

Las cuentas corrientes viven en Finanzas, pero también aparecen como pestaña dentro de cada cliente y proveedor.

### Barra superior

- **Buscador global / paleta de comandos (Ctrl+K):** busca entidades por nombre, código, SKU, CUIT o número de documento, y también ejecuta acciones ("nuevo pedido", "registrar cobro", "ir a cheques").
- **Botón "+ Nuevo"** con las acciones frecuentes del rol.
- Notificaciones, selector de sucursal (si hay más de una) y menú de usuario.

### Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+K` | Paleta de comandos |
| `N` | Nuevo (en un listado) |
| `/` | Foco en el filtro |
| `G` + `P` | Ir a Pedidos |
| `G` + `C` | Ir a Cheques |
| `G` + `S` | Ir a Stock |
| `Ctrl+Enter` | Guardar o confirmar |
| `Esc` | Cancelar o cerrar el panel |
| Flechas y `Tab` en grillas | Navegación como en una planilla |
| `?` | Ayuda de atajos |

## 2. Patrones de interfaz (sistema de diseño)

| Patrón | Uso |
|---|---|
| **Listado** (DataTable) | Filtros en chips, columnas configurables, vistas guardadas por usuario ("Mis pedidos pendientes"), paginación server-side, selección múltiple con acciones masivas y exportación |
| **Detalle de documento** | Cabecera con estado (badge), acciones principales a la derecha, pestañas (Detalle · Relacionados · Movimientos · Adjuntos · Historial). **"Relacionados"** muestra la cadena del documento (Pedido → Remitos → Facturas → Cobros) como línea de tiempo navegable |
| **Formulario de alta** | Página completa para documentos y *sheet* lateral para altas rápidas (un cliente desde el pedido). **Sin modales anidados** |
| **Grilla de variantes** (`VariantGrid`) | Componente central reutilizado en catálogo, pedidos, OP, conteos y precios. Filas = colores, columnas = talles. Cada celda muestra el dato contextual (disponible y cantidad). Totales por fila y columna, se completa con teclado y acepta pegar desde Excel |
| **Asistente paso a paso** | Solo en procesos con decisiones encadenadas: liberar OP, liquidación de taller, cierre mensual, importación |
| **Estados vacíos** | Explican qué es la pantalla y muestran la acción principal ("Todavía no hay cheques en cartera. Se cargan al registrar un cobro → Registrar cobro") |
| **Confirmaciones críticas** | Anular, rechazar cheque, ajustar stock o pagar requieren un resumen del impacto ("Esto generará una ND por $ 152.300 al cliente X y reabrirá la deuda con el proveedor Y") y un motivo obligatorio |
| **Feedback** | Validación en línea con Zod compartido, *toasts* con "Deshacer" solo donde es reversible sin efectos, y un banner si otro usuario modificó el documento |

**Estética:** neutros cálidos con un acento (por ejemplo, verde salvia o azul petróleo, a definir con la marca), tipografía Inter con números tabulares en importes, densidad "cómoda" con opción "compacta", modo oscuro opcional y contraste AA.

## 3. Recorridos por rol

### 3.1 Vendedor: pedido mayorista (objetivo: menos de 3 minutos)

1. `+ Nuevo` → Pedido, o `Ctrl+K` → "pedido para Pañalera Los Ositos".
2. Elige el cliente. Se precargan la lista de precios, la condición de pago, el domicilio de entrega y el descuento, y se ve el aviso de crédito si corresponde.
3. Busca un modelo ("body ml") y se abre la grilla talle × color con el disponible en gris en cada celda.
4. Tipea cantidades o aplica una curva: "2 por talle en todos los colores".
5. Las celdas que superan el disponible se marcan en ámbar, con la opción "dejar como pendiente" o "ajustar al disponible".
6. Repite con otros modelos. El resumen lateral muestra unidades, subtotal, descuento e IVA.
7. **Confirmar** (`Ctrl+Enter`): reserva el stock y queda en estado "Reservado" o "Parcialmente reservado".

### 3.2 Administración: compra con factura (objetivo: menos de 1 minuto)

- **Con OC:** Recepciones → "Recibir OC #123" → confirma cantidades (precargadas con lo pendiente) → Guardar → ofrece "Cargar factura del proveedor" con las líneas y precios precargados → solo ingresa el número, la fecha y las percepciones → el sistema muestra las diferencias contra la OC.
- **Compra rápida:** proveedor, ítems, cantidades y precios, y factura, en una sola pantalla. Genera la recepción y el comprobante.

### 3.3 Administración / Tesorería: cobro con imputación

1. Cobros → Nuevo → cliente.
2. Panel izquierdo: comprobantes pendientes ordenados por vencimiento, con check y monto editable.
3. Panel derecho: medios (efectivo, transferencia a la cuenta X, cheques). El cheque se carga en línea con banco, número, fecha de pago, importe y librador; el CUIT se autocompleta si ya existe.
4. La imputación automática FIFO se puede corregir. Si sobra, queda como anticipo.
5. Confirmar: se generan el recibo en PDF, los cheques en cartera, el movimiento de caja o banco y la cuenta corriente actualizada.

### 3.4 Operario: informar avance (celular, 3 toques)

1. "Mis tareas" muestra las OP o etapas asignadas, como tarjetas ordenadas por fecha comprometida.
2. Toca una tarjeta y ve la grilla de lo pendiente en su etapa.
3. Ingresa las buenas y falladas (con motivo de falla en un desplegable) → **Informar**.

Sin precios ni costos (permiso `costs.view` ausente) y con botones grandes.

### 3.5 Dirección: el negocio en 10 segundos

El tablero tiene una fila de 6 KPIs, cada uno con su comparación contra el período anterior:

1. vendido (facturado) en el mes;
2. cobrado;
3. disponible real (caja + bancos, sin cheques);
4. cheques en cartera con vencimiento en 30 días;
5. deuda de clientes vencida;
6. deuda con proveedores a 30 días.

Debajo:

- flujo proyectado a 8 semanas en barras (ingresos y egresos esperados más el saldo línea);
- "Atención": cheques rechazados, OP atrasadas, materiales faltantes, clientes sobre su límite;
- top 10 de productos y productos sin movimiento en 90 días;
- producción en curso (unidades por etapa).

Cada número es un enlace al listado filtrado que lo explica, y un `ⓘ` muestra la definición y la fórmula.

## 4. Flujos integrales (circuito de documentos y efectos)

### Flujo A: compra → producción → costo

| Paso | Documento / acción | Efectos |
|---|---|---|
| 1 | Alerta "Stock bajo: Interlock blanco" o faltante al liberar una OP | Notificación a Compras |
| 2 | Solicitud de compra (automática o desde la explosión de la OP) | — |
| 3 | OC aprobada y enviada | Compromiso; no mueve stock |
| 4 | Recepción (parcial o total, con lotes o rollos) | `stock_movements +`, costo estimado y OC parcialmente recibida |
| 5 | Factura del proveedor | `fiscal_document` + `account_entry` (deuda) y ajuste de costo si el precio difiere |
| 6 | Liberar OP | Ficha congelada, reserva de materiales |
| 7 | Entrega a corte o envío a taller | Movimiento `PROD_ISSUE` o transferencia al depósito del taller |
| 8 | Avances, QC y recepción del taller | `production_reports`, inspecciones |
| 9 | Ingreso de terminado (solo aprobado) | `PROD_OUTPUT +` en el depósito de PT |
| 10 | Cierre de OP | Consumos reales finales, devolución de sobrantes y snapshot de costo real |

### Flujo B: venta mayorista

Pedido → reserva → preparación → remito (`SALE_DELIVERY −`, libera la reserva) → factura (con CAE cuando esté la integración) → `account_entry +` → recibo parcial (imputación, `open_amount` baja) → recibo final (saldo 0, pedido "Cerrado").

### Flujo C: cheque de tercero

Recibo con cheque (cheque `EN_CARTERA`, crédito al cliente) → orden de pago con endoso (cheque `ENTREGADO`, débito al proveedor) **o** depósito (`DEPOSITADO` → `ACREDITADO`, ingreso al banco con fecha de valor).

**Rechazo:** el cheque pasa a `RECHAZADO`; se crea una ND al cliente que reabre su deuda; si estaba endosado, se crea un registro de deuda reabierta con el proveedor; alerta. **Recupero:** el cliente lo reemplaza o paga, y se imputa contra la ND.

En ningún punto el cheque cuenta como "disponible" antes de `ACREDITADO`.

### Flujo D: taller externo

OP liberada → remito al taller (transferencia al depósito del taller) → el taller produce → recepción (aprobadas, rechazadas y faltantes) → QC → ingreso de PT → devolución de sobrantes → **liquidación**: cantidades aprobadas × tarifa − descuentos por faltantes o fallas → comprobante del taller en su cuenta corriente → pago.

Reporte de "materiales en poder de talleres" y de "consumo esperado contra devuelto".

### Flujo E: cierre mensual (asistente)

Lista de verificación con estado y enlace:

1. Remitos sin facturar.
2. Recepciones sin comprobante.
3. Conciliación de bancos pendiente.
4. Arqueos de caja.
5. Cheques vencidos sin depositar o sin novedad.
6. Cuentas corrientes con imputaciones pendientes.
7. OP abiertas con consumo pendiente.
8. Diferencias de reconciliación de stock.
9. Cálculo del costo real del período.

Al final: reportes gerenciales, **bloqueo del período** (no se aceptan movimientos con fecha anterior salvo con permiso y reapertura auditada) y exportación para el estudio contable.
