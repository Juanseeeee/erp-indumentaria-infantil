# Ventas, cobranzas y terceros

Circuito completo: **Pedido** (reserva stock) → **Remito** (descuenta stock) → **Factura** (pide CAE a ARCA y genera la deuda en la cuenta corriente del cliente) → **Cobro** (recibo que se imputa a las facturas y devenga la comisión del vendedor). Las devoluciones y ajustes se hacen con **notas de crédito/débito** sobre una factura autorizada.

Menú lateral, sección «Ventas»: «Pedidos», «Remitos», «Comprobantes», «Cobros», «Cuentas a cobrar», «Listas de precios», «Promociones», «Comisiones». Sección «Terceros»: «Clientes», «Proveedores», «Talleres». Si una opción no aparece en el menú, al usuario le falta el permiso de ver esa pantalla.

## Permisos del área

| Código | Qué habilita |
|---|---|
| `sales.view` | Ver pedidos, remitos, comprobantes, listas de precios, promociones y «Mis comisiones» |
| `sales.order` | Cargar, confirmar, reservar y cancelar pedidos |
| `sales.credit.override` | Autorizar pedidos que superan el límite de crédito |
| `sales.deliver` | Preparar, emitir y anular remitos |
| `sales.invoice` | Emitir facturas, notas de crédito y débito, reintentar autorización |
| `sales.prices.manage` | Crear listas, cargar precios, aumentos masivos, promociones; dar descuentos por encima del tope |
| `sales.commissions.manage` | Configurar vendedores y su %, ver todas las comisiones y liquidarlas |
| `accounts.receivable.view` | Ver «Cobros» y «Cuentas a cobrar» |
| `receivables.collect` | Registrar y anular cobros, imputar y revertir imputaciones |
| `parties.view` / `parties.create` / `parties.edit` | Ver / crear / editar clientes, proveedores y talleres |
| `parties.credit.view` | Ver y definir límite de crédito y descuento general del cliente |

Roles predefinidos relevantes: **Ventas** (ver terceros y crear, ver catálogo y stock, ver y cargar pedidos, ver cuentas a cobrar; NO puede confirmar por encima del crédito, ni emitir remitos, ni facturar, ni cobrar). **Depósito** (`sales.view` + `sales.deliver`: emite remitos). **Tesorería** (cobra e imputa, ve ventas). **Administración** y **Propietario** tienen todo el circuito.

Si el sistema responde «No tenés permiso para esta acción (código)», hay que pedirle a quien administra usuarios que agregue ese permiso al rol (Administración → «Roles y permisos»).

---

## Cómo hacer una venta (de punta a punta)

Una venta se hace en cuatro pasos, cada uno en su pantalla:

1. **Pedido** (`/ventas/pedidos` → «Nuevo pedido»): cliente, lista de precios y cantidades en la grilla talle × color; «Guardar y confirmar» controla el crédito y reserva el stock. Permiso `sales.order`.
2. **Remito** (desde el pedido, «Preparar remito»): es la salida de la mercadería; puede ser parcial. Permiso `sales.deliver`.
3. **Factura** (desde el remito o en «Comprobantes» → nuevo): se factura uno o varios remitos del cliente y se pide el CAE. Permiso `sales.invoice`.
4. **Cobro** (desde la factura, «Cobrar», o en «Cobros»): efectivo, transferencia o cheques, imputado a las facturas. Permiso `receivables.collect`.

En el asistente, el recorrido guiado «Hacer una venta completa» lleva por las cuatro pantallas y marca dónde tocar.

---

## Pedidos de venta (lista)

- Ruta: `/ventas/pedidos` · Permiso: `sales.view` (botón «Nuevo pedido» requiere `sales.order`).
- Muestra: Pedido, Cliente, Vendedor, Fecha, Entrega, Prendas, Pendientes, Total, Estado.
- Filtro de estado (por defecto «Con entregas pendientes»): «Con entregas pendientes» (Confirmado + Entregado parcial), «Borradores», «Entregados», «Cancelados», «Todos».
- Numeración automática: `PV-000001`.

### Estados del pedido

| Estado (UI) | Significado | Qué permite |
|---|---|---|
| Borrador | Guardado sin confirmar; no reserva stock ni se controla crédito | «Confirmar y reservar», «Cancelar pedido» |
| Confirmado | Pasó el control de crédito y reservó lo que había disponible | «Reservar pendientes», «Preparar remito», «Cancelar pedido» |
| Entregado parcial | Tiene remitos pero quedan unidades pendientes | «Reservar pendientes», «Preparar remito», «Cancelar pendientes» |
| Entregado | No queda nada pendiente (todo entregado, o se cancelaron los pendientes después de entregar algo) | Solo consulta; sus remitos se facturan |
| Cancelado | Se canceló sin haber entregado nada | Solo consulta |

El estado se recalcula solo con cada remito emitido o anulado. Un pedido no se puede editar una vez guardado: la pantalla de detalle no tiene botón de edición (si hay que cambiarlo, se cancela y se carga uno nuevo).

## Nuevo pedido

- Ruta: `/ventas/pedidos/nuevo` · Permiso: `sales.order`.
- Campos: «Cliente», «Despachar desde» (depósitos propios activos), «Lista de precios», «Descuento manual %», «Entrega comprometida», «Domicilio de entrega», «Observaciones».
- Al elegir el cliente se completan solos: lista de precios del cliente, depósito sugerido y domicilio de entrega (el domicilio aparece como texto de ayuda; si se deja vacío se usa el del cliente). Panel lateral del cliente: «Vendedor», «Condición» (condición de pago; «Contado» si no tiene), «Saldo», «Pedidos abiertos», «Límite» («Sin límite» si no tiene), «Crédito disponible» (en rojo si el total del pedido lo supera).
- Carga de artículos: elegir «Modelo» y completar la grilla talle × color. En gris se ve el disponible en el depósito. Se puede pegar desde Excel (filas = colores, columnas = talles), moverse con flechas/Enter, y usar «Curva: unidades por celda» + «Aplicar a todo el modelo» para poner la misma cantidad en todas las celdas activas. Las variantes inactivas aparecen tachadas y no se pueden cargar.
- Tabla de líneas: Artículo, Cantidad, Disponible (en naranja si se pide más de lo disponible), Precio neto, Descuento (con el nombre de la promoción si aplica), y el tacho para quitar la línea.
- Totales: Prendas, Neto, IVA, Total. Los descuentos y promociones se calculan en el servidor en una vista previa.
- Botones: «Guardar y confirmar» y «Guardar borrador».

### Cómo cargar un pedido

1. Ventas → «Pedidos» → «Nuevo pedido».
2. Elegí el «Cliente». Revisá «Despachar desde» y «Lista de precios» (vienen sugeridos). Ojo: cambiar el cliente, el depósito o la lista **borra las líneas ya cargadas**.
3. Elegí un «Modelo» y cargá cantidades en la grilla (o pegá desde Excel, o usá la curva). Repetí con otros modelos.
4. Opcional: «Descuento manual %», «Entrega comprometida», «Domicilio de entrega», «Observaciones».
5. Revisá el panel: si aparece «N artículo(s) superan el disponible: lo que falte queda pendiente de entrega», el pedido se puede guardar igual; lo que no haya quedará pendiente (backorder).
6. «Guardar y confirmar» (reserva stock) o «Guardar borrador».

Los botones de guardar quedan deshabilitados si falta cliente, depósito, líneas, o si hay artículos sin precio en la lista.

### Precio, descuentos y promociones en el pedido

- **Lista de precios usada**: la elegida en el pedido → si no, la del cliente → si no, la lista predeterminada de la empresa. Si no hay ninguna: «El cliente no tiene lista de precios asignada: elegí una.»
- **Precio de cada variante**: precio propio de la variante (excepción) si existe; si no, el precio del modelo. Se toma el último precio con vigencia hasta hoy. Si la lista incluye IVA, el pedido guarda el precio neto (precio / 1,21). IVA de venta: 21 % (configurable por empresa).
- El precio de lista no se puede modificar desde la pantalla del pedido.
- **Descuento automático** (con «Descuento manual %» vacío): en cada línea rige el **mejor** entre el descuento general del cliente y la promoción vigente que le corresponda. **No se suman.**
- **Descuento manual**: un único % que se aplica a todas las líneas y reemplaza al automático (anula las promociones).
- **Tope de descuento**: sin el permiso `sales.prices.manage`, un descuento que no venga de una promoción no puede superar el máximo de la empresa (15 % por defecto). Error: «El descuento máximo sin autorización es 15 %.» Esto también aplica si el descuento general del cliente supera el tope. Las promociones no cuentan para el tope.
- El descuento debe estar entre 0 y 99,99 %.
- Los precios y descuentos quedan fijados en cada línea al guardar: cambiar después la lista o la promoción no modifica pedidos ya cargados.

### Vendedor del pedido

Se asigna solo: el vendedor del cliente; si el cliente no tiene, y quien carga el pedido es un vendedor activo (tiene % de comisión), queda esa persona.

### Cómo confirmar un pedido en borrador

1. Abrí el pedido (Ventas → «Pedidos», filtro «Borradores»).
2. «Confirmar y reservar». El sistema controla el crédito y reserva stock.
3. Mensajes: «Todo lo pedido quedó reservado.» o «Quedaron N artículo(s) sin stock suficiente: siguen pendientes.»

### Límite de crédito

- Se controla **solo al confirmar**. Exposición = saldo de cuenta corriente del cliente + pendiente de entregar (con IVA) de sus otros pedidos confirmados/parciales + remitos entregados sin facturar + total de este pedido. Si supera el «Límite de crédito» del cliente, se frena. Cliente sin límite = sin control.
- Sin permiso `sales.credit.override`: error «El pedido supera el límite de crédito del cliente por $ X. Tiene que autorizarlo Administración.» y aparece el cuadro «Límite de crédito excedido» con «El pedido queda en borrador hasta que Administración lo autorice.» Si se usó «Guardar y confirmar», el pedido igual queda guardado en borrador («Pedido guardado en borrador. …»).
- Con el permiso: en el cuadro aparece «Motivo de la autorización» (mínimo 3 caracteres) y el botón «Autorizar y confirmar». En el pedido queda registrado «Crédito excedido autorizado por <usuario>: <motivo>».
- Soluciones para el vendedor: pedir a Administración que lo autorice, que el cliente pague (baja el saldo), o que suban el límite del cliente en su ficha.

### Reservas y faltantes

- Al confirmar, cada línea reserva hasta el disponible del depósito; lo que falta queda pendiente. En el detalle: columnas Pedido, Precio neto, Desc., Importe, Entregado, Pendiente, Reservado (en naranja si es menor al pendiente), Disponible.
- «Reservar pendientes»: vuelve a intentar reservar lo que falta (usalo cuando entra mercadería de producción o compras). Las reservas no se asignan solas cuando entra stock.
- Lo reservado por un pedido deja de estar disponible para otros pedidos y movimientos.

### Cómo cancelar un pedido o sus pendientes

1. En el pedido: «Cancelar pedido» (sin entregas) o «Cancelar pendientes» (si ya hubo remitos).
2. Completá «Motivo (obligatorio)» y confirmá con el botón rojo «Cancelar» (el botón gris «Cancelar» de al lado solo cierra el panel).
3. Se liberan todas las reservas. Sin entregas → «Cancelado». Con entregas → queda «Entregado» con las unidades pendientes marcadas como canceladas («(N canc.)»).
- Error si ya está entregado/cancelado: «El pedido ya está entregado, cerrado o cancelado.»

---

## Remitos

- Lista: `/ventas/remitos` · Permiso `sales.view`. Filtro: «Pendientes de facturar» (por defecto) o «Todos». Columnas: Remito, Cliente, Pedido, Fecha, Prendas, A facturar, Estado («Sin facturar», «Anulado» o el número de factura).
- Detalle: `/ventas/remitos/<id>`. Botones: «Facturar» (`sales.invoice`), «Anular» (`sales.deliver`) — ambos solo si el remito está emitido y sin facturar —, e «Imprimir». El impreso dice «Documento no válido como factura» y tiene lugar para firma y fecha de recepción.
- Numeración automática: `R-00000001`. Los remitos siempre salen de un pedido; no hay remitos sueltos.

### Cómo preparar y emitir un remito

Permiso: `sales.deliver`. El pedido tiene que estar Confirmado o Entregado parcial y con pendientes.
1. Abrí el pedido → «Preparar remito».
2. Aparece la columna «A entregar», precargada con lo reservado más lo disponible (sin superar lo pendiente). Ajustá cantidades; las líneas en 0 no se incluyen.
3. Opcional: «Bultos» (número entero) y «Transporte».
4. «Emitir remito». Mensaje: «Remito R-… emitido.»
- El remito **descuenta el stock** del depósito del pedido (consume la reserva y, si hace falta, stock libre) y registra el costo de salida. La fecha es la del día.
- La factura se hace después, desde el remito o desde «Comprobantes».

Errores frecuentes:
- «Confirmá el pedido antes de despachar.» — el pedido está en borrador.
- «El pedido no tiene pendientes de entrega.»
- «<SKU>: se entregan X y quedan Y pendientes.» — se quiso entregar más de lo pendiente.
- «Stock insuficiente de <SKU>: disponible X, se intenta descontar Y.» — no hay stock libre suficiente (lo reservado por otros pedidos no se toca). Bajá la cantidad o esperá a que ingrese mercadería.
- «Indicá qué se entrega» — todas las cantidades en 0.

### Cómo anular un remito

1. Abrí el remito → «Anular» → «Motivo (obligatorio)» → «Anular remito».
2. La mercadería vuelve al depósito con su lote y costo, y las cantidades vuelven a quedar pendientes en el pedido (que recalcula su estado).
3. Ojo: la reserva no se recrea sola; si querés volver a reservar, usá «Reservar pendientes» en el pedido.
- Solo se anulan remitos sin facturar. Error: «El remito ya está facturado: la devolución se hace con una nota de crédito.» / «El remito ya está anulado.»

---

## Comprobantes de venta

- Lista: `/ventas/comprobantes` · Permiso `sales.view`. Botón «Facturar remitos» (`sales.invoice`). Filtro: «Todos los tipos», «Facturas», «Notas de crédito», «Notas de débito». Columnas: Comprobante, Cliente, Fecha, Vence, Total, Pendiente (lo que falta cobrar/aplicar), Estado.
- Si aparece el aviso «La conexión con ARCA está en modo simulado…», los CAE son de prueba y los comprobantes no tienen validez fiscal (el impreso dice «COMPROBANTE DE PRUEBA · CAE SIMULADO · SIN VALIDEZ FISCAL»).

### Estados del comprobante

| Estado (UI) | Significado |
|---|---|
| Autorizado | ARCA dio CAE: tiene número, impactó en la cuenta corriente (y en stock si es devolución) |
| Esperando CAE | Registrado pero sin autorización (error de comunicación o conexión no configurada). Sin número ni efectos. Botón «Reintentar autorización» |
| Rechazado por ARCA | Sin número ni efectos. Se muestran los motivos. Los remitos quedan libres para volver a facturar |

### Tipo y letra

Se determinan solos según la condición frente al IVA:
- Empresa Responsable inscripto → **A** a clientes Responsable inscripto o Monotributo; **B** al resto (consumidor final, exento, no alcanzado).
- Empresa Monotributo o Exenta → **C**.
- Notas de crédito/débito llevan la misma letra y punto de venta que la factura.
- En A se discrimina neto e IVA; en B y C los precios se muestran con IVA incluido, y la B muestra «IVA contenido» (Ley 27.743).

### Cómo facturar remitos

Permiso: `sales.invoice`.
1. Desde el remito: «Facturar» (abre la pantalla con cliente y remito ya marcados). O desde Ventas → «Comprobantes» → «Facturar remitos» (`/ventas/comprobantes/nuevo`).
2. Elegí el «Cliente»: se listan sus remitos pendientes de facturar (Remito, Pedido, Fecha, Prendas, Total).
3. Tildá uno o varios (o «Elegir todos»). Se emite **una sola factura** con todos los remitos elegidos; cada línea indica de qué remito viene.
4. Revisá «N remito(s) · Neto … · Total …» y tocá «Emitir factura».
5. Resultado: «Factura autorizada.» / «ARCA rechazó la factura: los remitos quedaron libres para volver a facturar.» / «La factura quedó esperando el CAE: reintentá desde el comprobante.»
- Precios, descuentos e IVA salen de los remitos (que los heredan del pedido); no se editan al facturar.
- Fecha: la del día. Vencimiento: fecha + días de la primera cuota de la condición de pago del pedido/cliente (sin condición = vence el mismo día).
- Vendedor y % de comisión vigente del vendedor quedan fijados en la factura («Vendedor: X (N %)»).

Errores:
- «El remito R-… es de otro cliente.» / «El remito R-… está anulado.» / «El remito R-… ya está facturado.»
- «No hay remitos pendientes de facturar» — primero hay que emitir remitos desde pedidos confirmados.
- «Configurá el punto de venta de ARCA de la sucursal antes de facturar.» — falta configuración de la empresa (pedir a Administración).
- «La conexión con ARCA (producción/homologación) todavía no está configurada: falta el certificado digital de la empresa.» — el comprobante queda «Esperando CAE».
- «La condición fiscal de la empresa no permite emitir comprobantes.»
- «El comprobante no puede quedar en cero.»
- «La fecha del comprobante puede estar como máximo 5 días antes o después de hoy.»

### Cómo reintentar un comprobante «Esperando CAE»

Abrí el comprobante → «Reintentar autorización» (`sales.invoice`). Es seguro reintentar: no duplica números. Si ya no está pendiente, solo muestra el estado actual.

### Detalle del comprobante

`/ventas/comprobantes/<id>`. Muestra el comprobante imprimible (CAE y vencimiento del CAE), remitos asociados, «Sobre <factura>» en notas, y abajo «Notas asociadas» e «Imputaciones» (cobros y notas aplicadas). Badges: estado y «Pendiente $ X» o «Cancelada». Botones (solo facturas autorizadas): «Nota de crédito», «Nota de débito», «Cobrar» (si tiene saldo pendiente; requiere `receivables.collect`, abre el nuevo cobro con el cliente elegido), «Imprimir».

### Cómo hacer una nota de crédito (devolución, anulación parcial o bonificación)

Permiso `sales.invoice`. Solo sobre facturas en estado Autorizado.
1. Abrí la factura → «Nota de crédito».
2. Por cada línea de mercadería se ve «quedan N» (lo que falta acreditar). Cargá la cantidad a acreditar.
3. «Reingresar la mercadería devuelta a»: elegí un depósito propio si la mercadería vuelve físicamente; «No reingresa» si es solo ajuste de precio/cantidad.
4. Opcional, bonificación sin mercadería: «Bonificación (concepto)» (mínimo 3 caracteres), «Neto» e «IVA %» (21, 10,5, 27 o 0). Si falta el neto, el concepto se ignora.
5. «Motivo» (mínimo 3 caracteres) → «Emitir».
Efectos al autorizarse: reduce la deuda del cliente; se **aplica automáticamente** al saldo pendiente de la factura (si la factura ya estaba cobrada, el crédito queda como saldo a favor del cliente); si se eligió depósito, la mercadería reingresa al stock al costo con que salió en el remito. No toca el pedido ni los remitos.

Errores:
- «<descripción>: se acreditan X y quedan Y sin acreditar.»
- «La nota de crédito supera el saldo de la factura en $ X.» (no se puede acreditar más que la factura neta de notas previas y débitos).
- «Indicá qué se acredita» — sin cantidades ni bonificación.
- «La devolución necesita las cantidades devueltas» — se eligió depósito sin cargar cantidades.
- «Elegí un depósito propio para reingresar la mercadería.»
- «La factura todavía no está autorizada.» / «Las notas de crédito y débito se emiten sobre una factura.»

### Cómo hacer una nota de débito

1. Abrí la factura autorizada → «Nota de débito».
2. «Concepto» (mínimo 3 caracteres), «Neto» (mayor a cero), «IVA %», «Motivo» → «Emitir».
3. Al autorizarse suma deuda en la cuenta corriente con vencimiento el mismo día. No se aplica sola: queda pendiente para cobrar.

No existe anulación de facturas autorizadas: se revierten con nota de crédito.

---

## Cobros

- Lista: `/cobros` · Permiso `accounts.receivable.view`; «Nuevo cobro» requiere `receivables.collect`. Columnas: Recibo, Cliente, Fecha, Medios, Importe, Sin imputar, Estado («Registrado»/«Anulado»). Numeración: `RC-00000001`.
- Medios disponibles: Efectivo, Transferencia, Cheque, E-cheq, Tarjeta, Mercado Pago, Retención sufrida.

### Cómo registrar un cobro (transferencia, efectivo, cheque, etc.)

1. «Cobros» → «Nuevo cobro» (o desde una factura «Cobrar», o desde el estado de cuenta «Nuevo cobro»).
2. Elegí «Cliente» y «Fecha».
3. En «Medios de cobro», para cada medio: «Medio» e «Importe». Según el medio:
   - Transferencia, Tarjeta, Mercado Pago: «Referencia»; si hay más de una cuenta posible aparece «Ingresa en» (banco, billetera, etc.).
   - Cheque / E-cheq: «Número», «Banco», «Fecha de pago» (obligatorios) y «Librador (si no es el cliente)».
   - Efectivo: entra en la caja.
   - Retención sufrida: no mueve fondos.
   - «Agregar medio» suma otra fila (arranca como Cheque); el tacho quita una fila.
4. En «Comprobantes pendientes» cargá cuánto imputar a cada factura/débito en la columna «Imputar», o tocá «Imputar por vencimiento» (reparte el total cobrado empezando por lo que vence primero). Los vencidos se ven en rojo.
5. Revisá «Total cobrado», «Imputado» y «Saldo a favor». Lo no imputado queda como saldo a favor del cliente.
6. «Registrar cobro». Mensaje: «Recibo RC-… registrado.»

Dónde entra cada medio: Efectivo → caja; Transferencia → banco o billetera; Tarjeta → cuenta de tarjetas a acreditar o banco; Mercado Pago → billetera; Cheque/E-cheq → cartera de cheques (quedan «en cartera» para depositar o endosar desde Tesorería). Si no se elige cuenta, se usa la primera activa del tipo que corresponde.

Errores:
- «El cheque necesita banco, número y fecha de pago»
- «El cheque <banco> n.º <número> ya está registrado (…).» — cheque repetido.
- «Un cheque de pago diferido no puede superar los 360 días.» / «La fecha de pago no puede ser anterior a la de emisión.»
- «No hay un banco ni una billetera activa para registrar ese medio. Creala en Tesorería.» (el texto varía según el medio).
- «Se imputan $ X y el recibo es de $ Y.» / en pantalla «Se imputa más de lo cobrado.» (el botón queda deshabilitado).
- «<comprobante>: se imputan X y quedan Y pendientes.»
- «La caja <nombre> tiene un arqueo al dd/mm/aaaa: no admite movimientos con fecha anterior.»
- «El período está cerrado hasta el dd/mm/aaaa: … Usá una fecha posterior o pedí que se reabra.»
- «El tercero elegido no es cliente.»

### Detalle del recibo y anulación

`/cobros/<id>`: recibo imprimible con medios (banco, número, fecha de pago, estado del cheque y cuenta donde ingresó) y «Aplicado a» (facturas) más «A cuenta (saldo a favor)». Botones: «Imputar saldo» (si tiene saldo sin imputar; lleva al estado de cuenta del cliente), «Anular» (`receivables.collect`), «Imprimir».

Cómo anular: «Anular» → «Motivo (obligatorio)» → «Anular recibo». Se revierten todas sus imputaciones (las facturas vuelven a quedar pendientes) y las comisiones que generó (comisión negativa), sale el dinero de cada cuenta y los cheques se devuelven.
- «El cheque … está <estado>: no se puede anular el cobro. Si fue rechazado, registralo desde Tesorería.» — un cheque del recibo ya no está en cartera (depositado, endosado, etc.).
- «La caja X tiene $ A y se quieren sacar $ B.» — no hay efectivo suficiente en la caja para revertir.
- «El recibo ya está anulado.»

---

## Cuentas a cobrar

- Ruta: `/cuentas-a-cobrar` · Permiso `accounts.receivable.view`.
- Indicadores: «Total a cobrar», «Vencido», «Vencido hace más de 60 días». Tabla por cliente: Saldo, Vencido, +60 días, Sin imputar (cobros/créditos a favor), Próximo vencimiento.

### Estado de cuenta de un cliente

`/cuentas-a-cobrar/<cliente>`: «Estado de cuenta · <cliente>». Botones «Nuevo cobro» e «Imprimir».
- Antigüedad: «Saldo», «A vencer», «1–30 días», «31–60 días», «61–90 días», «+90 días» (sobre lo pendiente de cada comprobante según su vencimiento).
- Movimientos: Fecha, Comprobante (tipo: Factura, Nota de crédito, Nota de débito, Recibo, Anulación, Saldo inicial), Vence, Debe (facturas y débitos), Haber (cobros y créditos), Saldo acumulado, Pendiente (lo que falta imputar). Cada comprobante enlaza a su documento.
- «Imputaciones vigentes»: cada aplicación «crédito → débito» con su importe y el ícono «Revertir imputación».

### Cómo imputar un saldo a favor (cobro o nota de crédito sin aplicar)

Permiso `receivables.collect`. Aparece solo si el cliente tiene a la vez créditos sin imputar y deuda pendiente.
1. En el estado de cuenta, cuadro «Hay $ X a favor del cliente sin imputar».
2. Elegí en «Elegí el cobro o crédito…» el recibo o la nota de crédito.
3. «Imputar por vencimiento»: aplica todo lo posible a los comprobantes que vencen primero. (En esta pantalla no se eligen importes a mano.)
Si el crédito es un recibo, la imputación a una factura devenga la comisión del vendedor.

### Cómo revertir una imputación

Ícono «Revertir imputación» → «Motivo (obligatorio)» → «Revertir». El comprobante vuelve a quedar pendiente y el cobro queda a favor; si había generado comisión, se descuenta.
- «Una reversa no se puede revertir.» / «La imputación ya fue revertida.» / «Es la compensación de un documento anulado: no se revierte.»

---

## Listas de precios

- Ruta: `/ventas/precios` · Ver: `sales.view`; crear y modificar: `sales.prices.manage`.
- Tabla: Lista (con badge «Inactiva» si corresponde), Tipo (Mayorista, Minorista, Especial), Precios («Propios» o «<base> +N %», «con IVA»/«sin IVA»), Clientes (cuántos clientes la tienen asignada).
- Precio por **modelo**, con posibles excepciones por variante. Cada cambio guarda una fila nueva (historial completo). Puede haber precios con vigencia futura.

### Cómo crear una lista de precios

1. «Listas de precios» → «Nueva lista».
2. «Nombre», «Tipo», «Deriva de» («Precios propios» o una lista base que tenga precios propios), y si es derivada «Porcentaje sobre la base» (ej.: 60 = +60 %, -10 = −10 %). Tildá «Los precios incluyen IVA» si corresponde.
3. «Crear».
- Una lista derivada no tiene precios propios: se calcula al momento como precio de la base × (1 + %), redondeado a centavos. Para cambiar sus precios hay que cambiar la base. La marca de IVA es la de la lista derivada.
- Errores: «Ya existe una lista con ese nombre.», «La lista base no puede ser derivada: elegí una lista con precios propios.», «Una lista derivada necesita la lista base y el porcentaje».
- La pantalla no permite editar una lista ya creada (nombre, tipo, base, %, activa/inactiva).

### Cómo cargar o cambiar precios

1. Entrá a la lista (`/ventas/precios/<id>`). Podés usar «Filtrar modelos…».
2. Opcional: «Vigencia desde» (vacío = hoy; con fecha futura el precio aparece como «Desde <fecha>: $ X» y rige desde ese día).
3. Escribí el valor en la columna «Nuevo precio» de cada modelo.
4. «Guardar N cambio(s)». Mensaje: «N precio(s) guardados…».
- «Precio vigente» muestra «Sin precio» si el modelo no tiene; esos modelos no se pueden vender con esa lista.
- Las excepciones por variante se muestran («Excepciones: SKU $ …») pero no se cargan desde esta pantalla.
- El ícono «Historial» de cada modelo muestra precios anteriores, desde cuándo, quién y cuándo los cargó.
- En listas derivadas se ve: «Los precios de esta lista se calculan desde la lista base…» y no hay edición.
- Los modelos discontinuados no aparecen.

### Cómo hacer un aumento (o rebaja) masivo

1. En la lista: «Aumento %» (negativo para rebajar), opcional «Redondear a» (ej.: 10 o 100: redondea **hacia arriba** al múltiplo; vacío = centavos), opcional «Vigencia desde».
2. «Actualizar toda la lista». Aplica a todos los precios vigentes de la lista, incluidas las excepciones por variante. Mensaje: «N precio(s) actualizados.»
- Errores: «Porcentaje inválido» (0 o ≤ −100), «No hay precios cargados para actualizar.», «Es una lista derivada: sus precios salen de la lista base. Cambiá la base o el porcentaje.»
- Los pedidos ya cargados conservan su precio.

---

## Promociones

- Ruta: `/ventas/promociones` · Ver: `sales.view`; crear/editar/pausar: `sales.prices.manage`.
- Cada tarjeta muestra %, nombre, estado («Vigente», «Programada», «Vencida», «Pausada»), alcance, mínimo, clientes/listas, vigencia y uso («usada en N pedidos (u., $ de descuento)»). Botones «Editar» y «Pausar»/«Reactivar».

### Cómo crear una promoción

1. «Promociones» → «Nueva promoción».
2. «Nombre (se ve en el pedido)» (mínimo 3 caracteres, único), «Descuento %», «Mínimo de unidades por pedido» (0 = sin mínimo), «Vigente desde», «Hasta (inclusive)» (vacío = sin vencimiento), «Aplica a» («Todos los modelos», «Modelos elegidos», «Categorías», «Colecciones») y tildar los elementos, «Activa».
3. Opcional: «Solo para estos clientes» y «Solo con estas listas de precios» (ninguno elegido = vale para todos).
4. «Notas» opcional → «Crear promoción».

Reglas:
- Se aplica sola al cargar el pedido si está activa y vigente hoy, el cliente y la lista coinciden, y se cumple el mínimo. El mínimo cuenta **todas las unidades del pedido dentro del alcance** (ej.: 12 bodies de cualquier talle y color).
- En cada línea rige el mayor entre la promoción y el descuento general del cliente; no se acumulan. Entre varias promociones gana la de mayor %.
- Con «Descuento manual %» cargado en el pedido, no se aplican promociones.
- Editar o pausar no cambia pedidos ya armados («Los pedidos ya armados conservan su descuento.»). Pausar: «los pedidos nuevos ya no la toman».
- Errores: «Ya existe una promoción con ese nombre.», «Elegí a qué modelos, categorías o colecciones aplica», «La fecha hasta no puede ser anterior a la fecha desde», «Hasta 100 %». Nota: un descuento del 100 % no se puede usar en pedidos (el máximo por línea es 99,99 %).

---

## Comisiones

- Ruta: `/ventas/comisiones` · Con `sales.commissions.manage` se ve la pantalla «Comisiones» completa; con solo `sales.view` se ve «Mis comisiones» (únicamente lo propio, con «Pendiente de liquidar»).
- Regla: la comisión se calcula **sobre lo cobrado**, no sobre lo facturado. Se devenga cuando un **recibo** se imputa a una **factura** que tiene vendedor y % de comisión. Base por defecto: neto sin IVA (cobrar el 50 % de la factura = 50 % de su neto). Revertir la imputación o anular el recibo genera la comisión negativa.
- Las notas de crédito aplicadas a la factura no generan ni descuentan comisión.
- El % se toma del vendedor **al emitir la factura** y queda fijo en ella; cambiar el % solo rige para facturas futuras.

### Cómo configurar un vendedor

1. «Comisiones» → cuadro «Vendedores» (lista los usuarios activos de la empresa).
2. Escribí el % en la fila del usuario → «Guardar». Queda con badge «Vendedor» y aparece en el selector «Vendedor» de la ficha del cliente.
3. «Quitar» lo desactiva como vendedor.
- El % debe estar entre 0 y 99,99.

### Cómo liquidar comisiones

1. Cuadro «Pendiente de liquidar»: elegí «Cobros hasta» (fecha).
2. «Liquidar» en la fila del vendedor. Agrupa todas sus comisiones pendientes (incluidas las negativas) con cobro hasta esa fecha. Mensaje: «Liquidación LC-… por $ X.»
3. El pago se registra con los sueldos, fuera del sistema.
- Error: «No hay comisiones pendientes hasta esa fecha.»
- Tabla «Detalle» (filtro «Solo pendientes»): Cobro, Vendedor, Factura, Base cobrada, %, Comisión, Liquidación («Pendiente» o número LC).

---

## Terceros: clientes, proveedores y talleres

- Lista: `/terceros?rol=CUSTOMER` (Clientes), `?rol=SUPPLIER` (Proveedores), `?rol=WORKSHOP` (Talleres). Permiso `parties.view`. Búsqueda «Razón social, CUIT o código…», casilla «Incluir inactivos» (por defecto se ocultan). Botón «Nuevo» (`parties.create`).
- Columnas: Código, Razón social, CUIT / DNI, Condición, Teléfono, Email, Rol (y «Inactivo»).
- Un mismo tercero puede tener varios roles (ej.: cliente y proveedor). El código se asigna solo (`T-00001`).

### Cómo dar de alta un cliente

1. Terceros → «Clientes» → «Nuevo» (`/terceros/nuevo?rol=CUSTOMER`).
2. «Es…»: marcá «Cliente» (y otros roles si corresponde).
3. Datos: «Razón social» (obligatoria), «Nombre de fantasía», «Documento» (CUIT, CUIL, DNI, Otro) + «Número», «Condición fiscal» (Responsable inscripto, Monotributo, Exento, Consumidor final, No alcanzado — define la letra de factura), «Email», «Teléfono», «Domicilio fiscal» (opcional; si se carga se usa como domicilio de entrega por defecto), «Localidad», «Provincia», «Notas».
4. «Condiciones comerciales»: «Condición de pago» (define el vencimiento de las facturas), «Zona», «Lista de precios» y «Vendedor» (estos dos solo los ve quien tiene `sales.view`), «Límite de crédito ($)» y «Descuento general (%)» (solo con `parties.credit.view`; si no, se lee «El límite de crédito y los descuentos los define Administración.»).
5. «Guardar».

Para talleres: al marcar «Taller» se crea solo un depósito virtual «Taller <razón social>» con el stock en su poder; en la ficha aparece el enlace «Ver lo que tiene en su poder».

Las condiciones de pago y zonas se administran en Configuración, pestaña «Condiciones de pago y zonas».

### Cómo editar o desactivar

- Ficha `/terceros/<id>`: con `parties.edit` se edita el mismo formulario y «Guardar cambios»; sin permiso se ve «Solo lectura.».
- «Desactivar» / «Reactivar» (`parties.edit`). Un cliente inactivo no aparece en los selectores de pedidos, facturación y cobros, y no se le pueden cargar pedidos («El cliente está inactivo.»).
- Quitar un rol en la edición le saca ese rol al tercero.

Errores:
- «CUIT/CUIL inválido (dígito verificador)» / «DNI inválido» (7 u 8 dígitos) / «Email inválido» / «Requerido» / «Elegí al menos un rol».
- «Ya existe <razón social> con ese CUIT.» — el documento no puede repetirse; buscá el tercero existente y agregale el rol.
- «Otro usuario modificó este registro. Recargá para ver los cambios.»
- «No tenés permiso para definir condiciones de crédito.»

---

## Conexiones con otras áreas

- **Stock**: confirmar pedido reserva stock (baja el disponible, no el físico); el remito descuenta el stock físico del depósito del pedido (FIFO por lote, con costo de salida); anular el remito lo reingresa; la nota de crédito con depósito reingresa la devolución al costo original. Ver stock en «Stock».
- **Producción/Compras**: cuando ingresa mercadería, los pedidos con faltantes no se reservan solos: usar «Reservar pendientes».
- **Cuenta corriente**: la factura y la nota de débito autorizadas generan deuda; la nota de crédito y el recibo la reducen. Los remitos no generan deuda pero sí cuentan para el control de crédito mientras no se facturan.
- **Tesorería**: cada cobro ingresa en caja, banco, billetera o cartera de cheques. Los cheques recibidos se depositan, endosan o registran como rechazados desde Tesorería. Anular un cobro saca el dinero de la cuenta.
- **Comisiones**: nacen solo de imputar recibos a facturas.
- **Cierre de período**: si el período está cerrado, no se pueden registrar remitos, autorizar comprobantes ni registrar cobros con fecha dentro del período cerrado (error «El período está cerrado hasta el …»).
