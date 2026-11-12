# Fase 5: gestión avanzada

Estado al 30/10/2026: **en curso**. Están hechos el tablero de Dirección, la rentabilidad (margen bruto estimado) el centro de reportes con exportación a Excel y PDF, las alertas con aviso por correo y las promociones. Faltan el padrón ARCA, Mercado Pago, las etiquetas ZPL y los manuales por rol.

## Qué incluye hasta ahora

| Área | Funcionalidad |
|---|---|
| Tablero de Dirección | En **Inicio**, para Dirección, Administración y Auditoría (permiso nuevo `executive.view`). Muestra seis indicadores: vendido y cobrado en el mes (contra el mismo tramo del mes anterior), disponible real (contra la misma fecha del mes anterior), cheques en cartera a 30 días, deuda de clientes vencida y deuda con proveedores a 30 días. Cada indicador **lleva a su listado** y tiene un **ⓘ** con su definición, fórmula y comparación. |
| Flujo a 8 semanas | Ingresos y egresos esperados por semana y saldo al final, con enlace al flujo de fondos completo |
| Atención | Cheques rechazados en 30 días, OP atrasadas, requerimientos de materiales sin stock y clientes sobre su límite de crédito, cada uno con enlace |
| Productos | Top 10 modelos por neto facturado en 30 días y modelos con stock sin ventas en 90 días |
| Producción en curso | Por etapa, unidades terminadas sobre planificadas, con barra de avance accesible |
| Rentabilidad | **Análisis → Rentabilidad** · margen bruto estimado del período **por modelo, categoría, cliente, pedido o vendedor** · vendido neto, costo de lo vendido, margen y margen % con su ⓘ · tabla ordenable con totales · márgenes negativos en rojo · aviso cuando hay **unidades vendidas sin costo cargado** (el margen queda sobreestimado) · enlaces al modelo, la cuenta del cliente o el pedido. La ven quienes ven **ventas y costos** (Dirección, Administración, Contabilidad); Ventas, Producción y Auditoría no |
| Centro de reportes | **Análisis → Reportes** (atajo G R) · los 16 reportes del set mínimo de RF §12, agrupados en Ventas, Inventario, Producción, Cuentas corrientes y Tesorería, con buscador · cada rol ve **solo los reportes que le corresponden** · parámetros con valores por defecto (mes en curso, hoy) · tabla con totales y notas que explican el cálculo · descarga en **Excel** (números y fechas reales, encabezado fijo, autofiltro) y **PDF** A4 apaisado (encabezado repetido y número de página), con permiso `data.export` |
| Alertas | Menú **Alertas** (atajo G A) y **campana** en el encabezado con las nuevas (roja si hay alguna crítica) · las 11 alertas de RF §13: stock bajo el mínimo, falta de material para una OP, OP atrasada, pedido sin preparar, cliente con deuda vencida, cheque por vencer, cheque rechazado, aprobación pendiente (ajustes de stock y pagos), diferencia de inventario (inventario físico en revisión y **saldo de stock que no coincide con sus movimientos**), conciliación atrasada y error de integración (ARCA y correos) · cada una con prioridad, estado (nueva, vista, resuelta) y **enlace a la operación** · se revisan solas cada 15 minutos y **se resuelven solas** cuando la situación se normaliza · resolverla a mano (con nota) la silencia mientras la situación siga igual · cada usuario ve las de sus roles; Administración puede ver las de todos |
| Reglas de alertas | **Alertas → Reglas** (permiso nuevo `alerts.manage`, Administración y Dirección) · activar o desactivar, prioridad, umbral en días, roles destinatarios y aviso por correo · "Revisar ahora" · los cambios quedan en auditoría |
| Correo | Las alertas nuevas llegan en **un resumen por persona** (no un correo por alerta), con enlaces directos · cola de envío (*outbox*) con reintentos: tras 5 fallas el correo queda con error y se avisa como alerta de integración · en desarrollo llegan a **Mailpit** (http://localhost:8025) |
| Promociones | **Ventas → Promociones** · % de descuento con **vigencia** (desde y hasta, o sin vencimiento) · **por volumen** (mínimo de unidades del pedido dentro del alcance: "12 bodies de cualquier talle y color") · alcance: todos los modelos, modelos elegidos, categorías o colecciones · opcionalmente solo para ciertos clientes o listas de precios · estados vigente, programada, vencida y pausada · **uso**: pedidos, unidades y descuento otorgado · pausar, reactivar y editar (en auditoría) · las ve Ventas; las administra quien maneja precios (`sales.prices.manage`) |
| Promociones en el pedido | El descuento del pedido pasa a ser **automático**: en cada línea rige el mejor entre el descuento del cliente y las promociones vigentes (**no se suman**) · el formulario lo muestra **antes de guardar** (vista previa del servidor) con el nombre de la promoción por línea · un **descuento manual** la reemplaza y sigue sujeto al tope del vendedor; la promoción no, porque ya está autorizada · el pedido guarda qué promoción aplicó y su detalle la muestra |
| Definiciones | `docs/METRICS.md`, la misma fuente que el ⓘ (`packages/contracts/src/metrics.ts`) |

## Decisiones técnicas

- **Una sola definición por indicador**: el texto del ⓘ, el documento y el cálculo se mantienen juntos. Las ventas se miden netas de IVA; lo cobrado y lo adeudado, con IVA.
- **Sin comparación donde no es confiable**: cheques a 30 días, deuda vencida y deuda a 30 días muestran la cantidad en lugar de una variación. Reconstruir esos saldos a una fecha pasada requiere recorrer eventos e imputaciones; se suma si los dueños lo piden.
- **El gráfico del flujo es uno solo**: la página de flujo de fondos y el tablero usan el mismo componente (`components/cashflow-charts.tsx`).
- **Costo de lo vendido = costo de salida del remito.** Cada línea facturada apunta a su línea de remito, que guarda el costo promedio del depósito al entregar. Las notas de crédito con devolución restan unidades y costo al mismo costo; las de bonificación (o por cantidades sin devolución) solo restan venta. Las prendas producidas entran al costo estimado de su ficha (ADR-013), por eso el margen es **estimado**.
- **Un solo resultado para pantalla, Excel y PDF**: cada reporte devuelve una tabla tipada (columnas con tipo dinero, cantidad, fecha o %) y los tres formatos salen de ahí; no hay forma de que el archivo diga otra cosa que la pantalla.
- **El catálogo de reportes es compartido** (`packages/contracts/src/reports.ts`): la API valida parámetros y permisos con él y la web arma los formularios. Sumar un reporte es agregarlo al catálogo y escribir su consulta.
- **Archivos generados en la API, sin navegador**: `exceljs` y `pdfkit`. Cada descarga queda en **auditoría** (reporte, formato, parámetros y cantidad de filas).
- **Los costos siguen protegidos**: el kardex y los materiales en talleres muestran costos y valores solo con `costs.view`; el stock valorizado y la rentabilidad lo exigen.
- **Las alertas miran el estado, no eventos sueltos**: cada regla es una consulta sobre los datos actuales, así que no hay que tocar los módulos de negocio y no se pierden avisos si algo se carga por otro camino. La evaluación es idempotente y tiene un candado por empresa.
- **Una alerta por operación** (stock de un artículo, una OP, un cheque): si sigue vigente se actualiza su texto (importes, días de atraso) en lugar de duplicarse.
- **Los correos salen por una cola** que se escribe en la misma transacción que las alertas, así no se pierde un aviso si el servidor de correo está caído. Sin `SMTP_URL` no se envía nada.
- **La evaluación periódica corre dentro de la API** (`ALERTS_INTERVAL_MINUTES`, 15 por defecto). Cuando exista `apps/worker` (ARCHITECTURE.md) se muda ahí sin cambios.
- **Control de integridad del stock**: la regla de diferencia de inventario compara el saldo proyectado contra la suma de movimientos. Si alguna vez aparece, es un error del sistema y hay que avisar a soporte.
- **Las promociones no se acumulan**: entre el descuento del cliente y las promociones, gana el mayor por línea. Es la regla más fácil de explicar al cliente y evita descuentos que nadie decidió; si los dueños quieren combinarlas, se cambia en un solo lugar (`applyPromotions`, en `packages/domain-sales`).
- **El precio se fija al armar el pedido**: editar o pausar una promoción no toca pedidos ya cargados; cada línea guarda su descuento y la promoción aplicada. La vigencia se mide en el día en que se arma o edita el pedido.
- **Auditoría no ve márgenes**: su rol excluye `costs.view` desde la Fase 1 y se mantiene.
- **El menú puede exigir varios permisos**: Rentabilidad pide `sales.view` y `costs.view`, así Producción (que ve costos) no ve un enlace que le daría error.
- **Todo se calcula al momento** sobre datos reales, en una transacción con aislamiento por empresa (RLS).

## Pruebas automatizadas

- **134 de integración** (todas en verde): 6 en `promotions.test.ts` (validaciones y permisos, volumen por todas las variantes, pedido guardado con su promoción, tope del vendedor, vigencia/cliente/lista y la mejor gana, pausa y uso); 8 en `alerts.test.ts` (creación idempotente, destinatarios por rol, campana, vista y resolución con permisos, silencio mientras siga la condición y alerta nueva si vuelve, resolución automática, saldo de stock inconsistente, configuración de reglas, resumen por correo verificado en Mailpit, reintentos y error de integración); 3 en `executive.test.ts`, 4 en `profitability.test.ts` y 6 en `reports-center.test.ts` (los 16 reportes corren; ventas por mes y modelo, ranking ABC, pendientes, stock valorizado y crítico, kardex con saldo, antigüedad, cheques, caja y bancos, flujo a 13 semanas; validación y permisos por reporte; Excel leído de vuelta y PDF de una hoja; auditoría de descargas) (costo de salida, devolución al mismo costo, bonificación sin costo, unidades sin costo, las cinco agrupaciones suman lo mismo, fechas y permisos).
- Tablero: Arman ventas reales (pedido, remito, factura, cobro) y comprueban:
  - vendido, cobrado y disponible del mes, con su comparación;
  - clientes sobre su límite, top de modelos y modelos sin ventas;
  - cheques a 30 días, deuda vencida y deuda con proveedores;
  - quién ve el tablero.
- **4 unitarias nuevas** de dominio (`applyPromotions`): 22 en `domain-sales`.
- **44 E2E**, 10 en `e2e/tests/fase5.spec.ts`: Dirección ve los seis indicadores, abre un ⓘ y navega al detalle; Ventas no ve el tablero; Administración analiza la rentabilidad por modelo y por cliente (ordena y navega); Ventas y Producción no la ven; Administración busca un reporte, lo reagrupa y descarga Excel y PDF; Ventas ve solo sus reportes y no puede descargarlos; Administración revisa las alertas, ve las de todos y cambia una regla; Producción entra por la campana y va a la OP atrasada; Administración ve, valida y edita promociones; un pedido de 20 bodies toma solo la promoción por volumen y un descuento manual la reemplaza.

## Cómo demostrarla

1. Ingresar como `direccion@ositos.demo`: el Inicio muestra el tablero.
2. Tocar el ⓘ de "Disponible real" para ver cómo se calcula, y el número de "Vendido en el mes" para ir a los comprobantes.
3. En "Atención", abrir la OP atrasada. En "Producción en curso", ver el avance por etapa.
4. Ingresar como `administracion@ositos.demo` → **Análisis → Rentabilidad**: el "Gorrito con nudo" aparece con margen negativo (se vende por debajo de su costo). Cambiar a "Por cliente" y ordenar por margen %.
5. **Análisis → Reportes** → "Cuentas a cobrar por antigüedad" → **PDF**; "Stock valorizado" → **Excel** (se puede sumar y filtrar).
6. Ingresar como `produccion@ositos.demo`: la **campana** marca la OP atrasada. Abrir http://localhost:8025 para ver el correo que le llegó.
7. Como `administracion@ositos.demo` → **Alertas → Reglas**: cambiar los días de "Pedido sin preparar" y tocar "Revisar ahora".
8. Como `ventas@ositos.demo` → **Nuevo pedido** para "Valeria Gómez (Boutique Mimitos)", modelo Body manga larga, curva 1: la tabla muestra "Bodies por 12 o más" (10 %) en cada línea. **Ventas → Promociones** muestra las tres del demo.

## Correcciones tras las pruebas de los dueños (04/11)

- Filtros sí/no de las pantallas: `false` se leía como verdadero. Stock mostraba solo lo crítico, y Terceros y Catálogo incluían inactivos. Ahora todos los filtros usan `zQueryBool`.
- Listados de catálogo, materiales, terceros, stock y órdenes de producción: lo más nuevo primero.
- Recepción de compra: casilla «El proveedor no va a entregar lo que falta». La OC queda cerrada y lo no entregado queda auditado. La OC muestra la columna Pendiente / No entregado.
- Comprobantes de proveedor:
  - Punto de venta predeterminado, configurable en Configuración → Empresa (`purchasing.pointsOfSale`, por defecto 1).
  - Número sugerido: el último cargado de ese proveedor, tipo y punto de venta, más uno.
  - Fecha: la de la recepción, editable.
- Producción:
  - Al ingresar prendas hechas en planta, los materiales no entregados se consumen según la ficha (backflush).
  - Si falta stock, el consumo queda pendiente con aviso y botón «Consumir según ficha».
  - La orden no se cierra con consumo pendiente, salvo que se indique un motivo (queda auditado). Así el costo real no queda sin materiales cuando la compra se registra después.

## Pendiente en esta fase

- **Integraciones**: padrón ARCA, Mercado Pago y etiquetas ZPL.
- **Manuales por rol.**

## Asistente de IA (06/11)

Panel lateral «Asistente» (botón en la barra superior, Ctrl+J o «Preguntarle al asistente» en Ctrl+K) que orienta al usuario sobre cómo usar la plataforma.

- **Motores** (`ASSISTANT_PROVIDER`, por defecto `auto`):
  - **Modo guía** (sin IA, gratis, local): busca la pregunta en la guía (BM25 con raíces en español y sinónimos, `assistant.guide.ts`) y muestra la sección más útil con enlaces y preguntas relacionadas clickeables; detecta números de documento y preguntas de stock y los consulta. Es el modo cuando no hay ninguna clave, y el respaldo automático si la IA falla, se agota el cupo o se supera el límite por usuario.
  - **Gemini** (`GEMINI_API_KEY`, plan gratuito de Google AI Studio; modelo por defecto `gemini-3.8-flash`) vía `@google/genai`. En el plan gratuito Google puede usar el contenido enviado: usar con datos de demo o pasar a un plan pago.
  - **Claude** (`ANTHROPIC_API_KEY`; `claude-opus-5-5`, esfuerzo `low`) vía `@anthropic-ai/sdk`, con fallback del servidor ante rechazos.
  - Respuesta en streaming (SSE) por `POST /api/assistant/chat`; `GET /api/assistant/status` informa el modo y el panel lo muestra.
- **Conocimiento:** `apps/api/src/assistant/knowledge/*.md` (≈ 23.000 palabras, escrita leyendo el código de cada pantalla y servicio). Va en el prompt de sistema con caché. **Al cambiar una pantalla o una regla, actualizar el .md correspondiente**: es la única fuente del asistente.
- **Contexto por mensaje:** nombre, roles, permisos y pantalla actual del usuario, para responder según lo que puede ver y hacer.
- **Consultas (solo lectura, con RLS y permisos del usuario):** `buscar` (buscador global), `consultar_stock` (físico/reservado/disponible por depósito), `consultar_documento` (estado de pedidos, remitos, comprobantes, recibos, OC, recepciones, OP, órdenes de pago y movimientos por número). El asistente nunca crea ni modifica datos.
- **Límites:** 30 mensajes por usuario cada 10 minutos (`ASSISTANT_RATE_LIMIT`), últimos 20 mensajes de historial, hasta 6 rondas de consultas por respuesta. La conversación vive en la pestaña (sessionStorage), no en el servidor.
- **Privacidad:** con Claude o Gemini, las preguntas, la guía y los resultados de las consultas se envían a ese proveedor. El modo guía no envía nada.
- **Pruebas:** `apps/api/test/assistant.test.ts` (Claude) y `assistant-modes.test.ts` (Gemini, cupo agotado → guía, modo guía) contra servidores falsos con el protocolo de streaming de cada API.
