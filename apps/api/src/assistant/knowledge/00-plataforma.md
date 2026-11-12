# Visión general de la plataforma

«ERP Indumentaria» es el sistema de gestión de una fábrica de indumentaria infantil: diseña modelos por temporada y colección, compra telas y avíos, produce en planta propia y con talleres externos, vende principalmente a mayoristas y administra cobros, pagos y tesorería. Todo pasa por la misma plataforma web; cada usuario ve solo los menús y acciones que habilitan sus roles (los permisos se controlan siempre en el servidor, no solo ocultando botones).

## Navegación general

- Menú lateral por secciones: Inicio y Alertas; Ventas; Producción; Compras; Finanzas; Análisis; Catálogo; Inventario; Terceros; Administración. Cada sección se pliega y despliega tocando su nombre; si no ves una opción, fijate que su sección esté desplegada. Un menú que no aparece aunque despliegues la sección suele ser falta de permiso.
- Arriba: el buscador «Buscar o ejecutar una acción…» (Ctrl+K), la campana de alertas, el nombre del usuario (lleva a [Mi cuenta](/cuenta)) y el botón para cerrar sesión.
- El botón «Asistente» (arriba a la derecha, atajo Ctrl+J, o «Preguntarle al asistente» en Ctrl+K) abre este panel de ayuda. La conversación dura mientras la pestaña esté abierta; «Nueva conversación» la reinicia.
- Las listas son las más recientes primero.
- Los documentos tienen numeración propia por tipo (por ejemplo PV- pedidos de venta, R- remitos, OC- órdenes de compra, RE- recepciones, OP- órdenes de producción, ET- envíos a taller, RC- recibos, OP- también para órdenes de pago con 8 dígitos). Las facturas y notas se identifican por tipo, punto de venta y número (por ejemplo FA 00001-00000004).
- Los documentos confirmados no se borran: se anulan o se compensan (por ejemplo, con una nota de crédito), y todo queda en la auditoría.

## Circuitos principales (de punta a punta)

1. **Producto:** temporada y colección → modelo con su grilla de talles × colores (cada variante tiene SKU y código de barras) → ficha técnica (materiales y consumos por talle, etapas) → lista de precios.
2. **Compras:** solicitud (manual o desde faltantes de producción) → orden de compra → aprobación → recepción (ingresa el stock, con partidas si el material las lleva; puede ser parcial) → comprobante del proveedor (genera la deuda) → orden de pago (con aprobación cuando corresponde) → cuenta a pagar saldada.
3. **Producción:** orden de producción con cantidades por talle y color → liberación (congela la ficha y reserva materiales) → entrega de materiales a planta / envío a taller → avance por etapa (Mis tareas) → ingreso de producto terminado con control de calidad (aprobadas, segunda, descarte) → cierre con costo real → liquidación del taller.
4. **Ventas:** pedido sobre la grilla del modelo con lista de precios y promociones → remito (única salida de stock por venta) → factura desde el remito → cuenta corriente del cliente → recibo de cobro (efectivo, transferencia, cheques) imputado a las facturas.
5. **Finanzas:** cajas y bancos, cheques en cartera (se pueden depositar o endosar a proveedores), gastos, conciliación bancaria, flujo de fondos proyectado y cierre de período.
6. **Control:** tablero de inicio, alertas automáticas, reportes exportables, rentabilidad por modelo y auditoría de quién hizo qué.

## Límites conocidos (no ofrecer como si existieran)

- La facturación electrónica con ARCA puede estar en **modo simulado** hasta que la empresa cargue su certificado: en ese caso el comprobante no tiene validez fiscal.
- Los talleres externos **no tienen usuario** en el sistema: sus envíos, entregas, devoluciones y faltantes los registra Producción.
- No hay portal ni app para clientes, ni integración con Mercado Pago (solo puede registrarse como medio o cuenta a mano), ni consulta automática del padrón de ARCA, ni impresión de etiquetas ZPL.
- El stock se maneja por depósito y partida; no hay ubicaciones dentro del depósito (estantería, pasillo) ni pantalla de picking separada.
- El asistente (vos) no ejecuta acciones: solo orienta y consulta datos.

## Glosario

- **Modelo:** el producto de catálogo (ej. «Conjunto Pintitas»). **Variante:** cada combinación talle × color, con su SKU.
- **Material / avío:** telas, ribs, elásticos, etiquetas, bolsas, etc. **Partida:** lote de un material (por ejemplo un rollo con su tono).
- **Ficha técnica:** receta del modelo; tiene versiones y solo una activa.
- **Físico / reservado / disponible:** disponible = físico − reservado (lo comprometido por pedidos u órdenes).
- **Segunda:** prenda con falla menor que se guarda aparte; **descarte:** no se vende.
- **Backflush / consumo según ficha:** descontar el material teórico de la ficha por las unidades producidas cuando no se entregó explícitamente.
- **Cuenta corriente:** saldo de un cliente o proveedor por documento; **imputar** es aplicar un cobro o pago a facturas puntuales.
- **Endoso:** entregar a un proveedor un cheque de terceros que está en cartera.
