# Compras y finanzas

Circuito: Solicitud de compra → Orden de compra (OC) → Recepción (entra el stock) → Comprobante del proveedor (genera la deuda) → Orden de pago (cancela la deuda y saca el dinero de caja, banco o cartera de cheques). Aparte: Tesorería (cuentas, cheques, transferencias, arqueos, conciliación), Gastos, Flujo de fondos y Cierre de período.

Reglas clave:
- **La orden de compra no mueve stock.** El stock entra solo con la **recepción**.
- **La recepción no genera deuda.** La deuda con el proveedor nace al cargar el **comprobante** (factura) en Compras → Comprobantes.
- **El dinero sale con la orden de pago** (Pagos) o con un gasto (Gastos), no con la factura.

Permisos del área (los otorga un administrador desde los roles de usuario):
- `purchasing.view`: ver solicitudes, órdenes, recepciones y comprobantes.
- `purchasing.order`: crear órdenes de compra, cancelar solicitudes y órdenes, pedir faltantes desde producción.
- `purchasing.approve`: aprobar órdenes de compra.
- `purchasing.receive`: registrar recepciones.
- `purchasing.invoice`: cargar comprobantes de proveedores.
- `accounts.payable.view`: ver Cuentas a pagar y Pagos.
- `payables.pay`: crear y anular órdenes de pago.
- `payables.approve`: aprobar o rechazar órdenes de pago pendientes.
- `treasury.view`: ver Tesorería, Gastos y Flujo de fondos.
- `treasury.accounts.manage`: crear cuentas de tesorería.
- `treasury.move`: registrar movimientos, transferencias, arqueos, operar cheques, gastos y conciliación.
- `periods.close` / `periods.reopen`: cerrar o reabrir períodos.
- `costs.view`: ver costos unitarios (por ejemplo, la columna «Costo unit.» de una recepción).

Roles de sistema de referencia: «Compras» puede ver, pedir, recibir y cargar comprobantes, pero no aprobar OC ni pagar. «Depósito» puede ver y recibir. «Tesorería» y «Administración» pueden pagar (`payables.pay`) pero no aprobar pagos. Solo «Propietario / Dirección» (y Superadministrador) tienen `purchasing.approve`, `payables.approve` y `periods.reopen` por defecto. Si un botón no aparece, casi siempre falta el permiso.

---

## Solicitudes de compra

- **Ruta:** Compras → Solicitudes (`/compras/solicitudes`). Permiso: `purchasing.view`.
- **Para qué sirve:** necesidades de materiales detectadas por producción. Se eligen líneas del mismo proveedor y se genera la orden de compra.
- **Cómo se crean:** desde una orden de producción liberada/en curso/terminada que tiene faltantes, con el botón «Pedir faltantes a Compras» (requiere `purchasing.order`). Se crea una solicitud `SC-xxxxxx` con origen «Faltante de producción», fecha «necesaria para» = inicio planificado de la orden y nota «Faltantes de OP…». La cantidad pedida es lo que falta descontando reservas y stock libre del depósito de materiales. Si no hay faltantes: «La orden no tiene faltantes de materiales.» **No hay botón para crear una solicitud a mano** en esta pantalla; para comprar algo que no viene de producción, creá la orden de compra directamente.
- Cada línea toma como proveedor el **proveedor habitual** del material (si no tiene, muestra «Sin proveedor habitual»).
- Filtro «Estado»: «Abiertas», «Con orden de compra», «Todas».
- Estados: «Abierta» (OPEN), «Pedida» (ORDERED: todas sus líneas ya están en una OC), «Cancelada». Las líneas ya incluidas en una OC muestran la etiqueta «En OC».
- Botones: «Generar orden de compra (N)» y «Cancelar» (por solicitud; solo en abiertas). Ambos requieren `purchasing.order`. Al cancelar una que no está abierta: «Solo se pueden cancelar solicitudes abiertas.»

### Cómo generar una orden de compra desde faltantes
1. En la orden de producción, tocá «Pedir faltantes a Compras».
2. Andá a Compras → Solicitudes (filtro «Abiertas»).
3. Tildá las líneas a pedir. **Todas deben ser del mismo proveedor**: si mezclás proveedores el botón queda deshabilitado («Elegí líneas de un solo proveedor»).
4. Tocá «Generar orden de compra (N)». Se abre «Nueva orden de compra» con las líneas y el proveedor precargados (la cantidad viene de la solicitud; el precio queda vacío y hay que completarlo).
5. Completá «Recibir en», precios, y «Crear orden de compra». Las líneas de solicitud quedan vinculadas; cuando todas las líneas de una solicitud están en OC, la solicitud pasa a «Pedida».

---

## Órdenes de compra

- **Ruta:** Compras → Órdenes de compra (`/compras/ordenes`). Permiso: `purchasing.view`. Crear: `purchasing.order` (botón «Nueva orden»).
- Lista con columnas «Número», «Proveedor», «Fecha», «Entrega esperada», «Neto», «Estado». Filtro: «Pendientes de recibir» (aprobadas y recibidas parcial), «Pendientes de aprobación», «Recibidas», «Todas».
- Numeración: `OC-xxxxxx`.

### Estados de la OC
| Estado (UI) | Significado | Qué permite |
|---|---|---|
| Pendiente de aprobación (DRAFT) | Supera el monto de aprobación | Aprobar (otra persona), Cancelar. **No se puede recibir.** |
| Aprobada | Lista para recibir | Registrar recepción, Cancelar |
| Recibida parcial | Llegó una parte | Registrar recepción, «Cerrar pendiente» |
| Recibida | Todo recibido | Nada (solo consulta) |
| Cerrada | Se dejó de esperar lo pendiente | Nada; la columna «Pendiente» pasa a llamarse «No entregado» |
| Cancelada | Anulada sin recepciones | Nada |

### Cómo crear una orden de compra
1. Compras → Órdenes de compra → «Nueva orden» (o desde Solicitudes).
2. Completá «Proveedor» (solo terceros con rol proveedor), «Recibir en» (depósitos propios activos), «Entrega esperada» (opcional) y «Observaciones».
3. Buscá materiales con el buscador para agregarlos. Por línea: «Cantidad», «Precio unit. neto», «IVA» (21 %, 10,5 %, 27 %, 0 %); se muestra el «Neto». El ícono de papelera quita la línea.
4. «Crear orden de compra». El botón se habilita con proveedor, depósito, al menos una línea, cantidades mayores a 0 y precios cargados.
5. Resultado: «OC-… creada y aprobada.» o «OC-… creada: supera el monto de aprobación y quedó pendiente.»

### Aprobación de órdenes de compra
- Una OC queda «Pendiente de aprobación» solo si: quien la carga **no** tiene `purchasing.approve`, existe una regla de aprobación activa para órdenes de compra y el **neto** de la OC supera ese monto. Si quien la carga puede aprobar, queda aprobada directamente.
- Botón «Aprobar» en el detalle: visible para quien tiene `purchasing.approve` y **no** cargó la orden. Quien la cargó ve el aviso «Supera el monto de aprobación: la tiene que aprobar otra persona con permiso.»
- Errores: «Una orden no puede aprobarla quien la cargó.» · «La orden no está pendiente de aprobación.»
- Nota: en Configuración → «Empresa y aprobaciones» hoy solo se ven las tarjetas de aprobación de ajustes de stock y de órdenes de pago; el monto para órdenes de compra no se edita desde esa pantalla.

### Cancelar o cerrar una OC
- Botón «Cancelar» (OC pendiente de aprobación o aprobada, sin recepciones) o «Cerrar pendiente» (OC recibida parcial). Requiere `purchasing.order` y un «Motivo (obligatorio)» (mínimo 3 caracteres; si no: «Indicá el motivo»).
- Sin recepciones → queda **Cancelada**. Con recepciones parciales → queda **Cerrada**: «Lo ya recibido se mantiene; lo pendiente deja de esperarse.»
- Error si ya terminó: «La orden ya está cerrada o cancelada.»
- No se pueden editar las líneas de una OC creada; si cambió el pedido, cancelala y creá otra.

---

## Recepciones

- **Ruta:** Compras → Recepciones (`/compras/recepciones`). Permiso para ver: `purchasing.view`; para registrar: `purchasing.receive`.
- Es **lo único que hace entrar stock de compras**. Numeración `RE-xxxxxx`. Cada recepción genera un movimiento de stock de tipo recepción de compra en el depósito, con el costo unitario, y actualiza el **último costo** del material.
- La lista muestra número, proveedor, fecha, remito, «sin OC» si fue compra directa, y «Facturada» / «Pendiente de factura».
- Dos formas de recibir: **contra una OC** (desde el detalle de la orden) o **«Compra directa (sin OC)»**.
- No hay botón para anular o editar una recepción en la pantalla.

### Cómo registrar una recepción contra una orden de compra (total o parcial)
1. Abrí la OC (estado «Aprobada» o «Recibida parcial») y tocá «Registrar recepción» (requiere `purchasing.receive`).
2. Aparecen las columnas «Recibir ahora» (precargada con lo pendiente) y «Partida». Cargá lo que **llegó realmente** (por ejemplo 2.500 de 3.000). Dejá en 0 las líneas que no llegaron.
3. Si el material se controla por partida/lote, la «Partida» es **obligatoria** (placeholder «Obligatoria»). Si no se controla, aparece «—».
4. Opcional: «Remito del proveedor» (por ejemplo 0001-00001234).
5. Si queda algo sin recibir, aparece la casilla **«El proveedor no va a entregar lo que falta: cerrar la orden.»** con el detalle «No entregado: SKU cantidad…».
   - **Sin tildar:** la OC queda «Recibida parcial» y podés registrar otra recepción cuando llegue el resto.
   - **Tildada (closePending):** la OC queda «Cerrada» con esta recepción; se registra en auditoría lo no entregado con el motivo «El proveedor no entrega el resto (RE-…)».
6. «Confirmar recepción». Mensaje: «Recepción RE-… registrada. El stock ya está disponible.»
7. Si con esto se completa todo lo pedido, la OC pasa a «Recibida».

Reglas:
- **Tolerancia de sobre-recepción:** se puede recibir hasta un 5 % más de lo pedido (sobre la cantidad de la línea). Más que eso da: «Se recibe más de lo pedido (pendiente X, tolerancia 5 %). Ajustá la orden de compra o registrá la diferencia.»
- El costo de cada línea es el precio de la OC.
- La OC tiene que estar aprobada: «La orden de compra todavía no está aprobada.» Si está recibida, cerrada o cancelada: «La orden de compra ya no admite recepciones.»
- Partida faltante: «SKU se controla por partida: indicá el lote o partida recibida.» Si la partida no existe para ese material, se crea automáticamente; si existe, se suma a ella.
- Otros errores: «La orden de compra es de otro proveedor.» · «Hay líneas que no pertenecen a la orden de compra.» · «El proveedor está inactivo.» · «El tercero elegido no es proveedor.»

### Cómo registrar una compra directa (sin OC)
1. Compras → Recepciones → «Compra directa (sin OC)».
2. «Proveedor», «Depósito», «Remito del proveedor».
3. Agregá materiales con «Cantidad» y «Precio unit. neto»: **el precio neto es el costo con el que entra al stock** (obligatorio). Si falta: «Indicá el costo unitario de las líneas sin orden de compra.»
4. Debajo, un campo «Partida SKU» por línea («si controla lote»): obligatorio para materiales con partida.
5. «Registrar recepción». Mensaje: «Recepción RE-… registrada. Ahora podés cargar la factura.»

### Detalle de recepción
Muestra proveedor, fecha, depósito, remito, link a la OC, y por línea «Material», «Partida», «Cantidad», «Facturado» y «Costo unit.» (este último solo con `costs.view`). Si hay algo sin facturar y tenés `purchasing.invoice`, aparece «Cargar factura», que abre el comprobante nuevo con el proveedor elegido.

---

## Comprobantes de proveedores

- **Ruta:** Compras → Comprobantes (`/compras/comprobantes`). Ver: `purchasing.view`. Cargar: `purchasing.invoice` (botón «Cargar comprobante»).
- Cada comprobante **genera su movimiento en la cuenta corriente del proveedor** (deuda). Las diferencias de precio o cantidad contra lo recibido quedan marcadas con la etiqueta «N diferencias».
- La lista también muestra las liquidaciones de talleres (etiqueta «Taller», «Liquidación interna #…»), que se generan desde Producción.
- Tipos: FA, FB, FC (facturas), NCA, NCB, NCC (notas de crédito), NDA, NDB, NDC (notas de débito). Las facturas y notas de débito aumentan la deuda; las notas de crédito la reducen.

### Cómo cargar un comprobante de proveedor
1. Compras → Comprobantes → «Cargar comprobante» (o «Cargar factura» desde una recepción).
2. Elegí «Proveedor». Aparece «Recepciones pendientes de facturar» con un botón «+ RE-… (fecha)» por cada recepción con algo sin facturar.
3. Tocá las recepciones que factura: se agregan sus líneas con la cantidad pendiente de facturar y el costo de la recepción como precio, IVA 21 % (editable).
4. Cabecera:
   - «Tipo»: por defecto FA.
   - «Punto de venta»: lista con los puntos de venta configurados (el primero es el predeterminado) y la opción «Otro…» para escribir uno distinto.
   - «Número»: se **sugiere** el siguiente al último comprobante cargado de ese proveedor, tipo y punto de venta (pista «Sigue al último cargado»). Si es el primero, queda vacío. Si lo escribís a mano, ya no se pisa.
   - «Fecha»: por defecto hoy; al agregar una recepción se **sugiere la fecha de la recepción** (pista «La de la recepción»). Si la cambiaste a mano, no se pisa.
   - «Vencimiento»: vacío = según la condición de pago del proveedor (primer plazo de la condición; si el proveedor no tiene condición, vence el mismo día de emisión).
   - «Percepciones / otros ($)»: se suma al total.
5. Podés editar «Descripción», «Cantidad», «Precio neto», «IVA» o quitar líneas. «Agregar línea libre» sirve para servicios o fletes sin recepción.
6. Se muestra «Neto · IVA · otros · Total».
7. «Registrar comprobante». Mensaje: «Comprobante registrado en la cuenta corriente del proveedor.» Si hubo diferencias aparecen avisos amarillos.

Reglas y avisos:
- **Duplicado:** no se puede cargar dos veces el mismo tipo + punto de venta + número del mismo proveedor: «El comprobante FA 00003-00001234 de PROVEEDOR ya está cargado.» Revisá el número o el punto de venta.
- **Avisos (no bloquean, quedan como «diferencias»):** «…: se factura X y quedaban Y recibidos sin facturar.» (facturar más de lo recibido) y «…: precio +N % respecto de lo recibido.» (el precio difiere más del 2 % del costo de la recepción).
- Las líneas vinculadas a recepciones suman a la columna «Facturado» de la recepción y de la OC; una nota de crédito vinculada la resta. Cuando todo está facturado, la recepción pasa a «Facturada».
- «Hay líneas vinculadas a recepciones de otro proveedor.» si se mezcla. Cambiar el proveedor vacía las líneas.
- Si la fecha cae en un período cerrado, se rechaza (ver Cierre de período).

### Puntos de venta de proveedores (configuración)
Configuración → «Empresa y aprobaciones» → tarjeta «Puntos de venta de proveedores» (editar requiere `settings.company.edit`). «Agregar» un número (hasta 5 dígitos), «Hacer predeterminado» o «Quitar». El primero es el predeterminado. Errores: «Dejá al menos un punto de venta», «Hay puntos de venta repetidos». Si no hay ninguno configurado, se ofrece 00001.

---

## Cuentas a pagar

- **Ruta:** Compras → Cuentas a pagar (`/cuentas-a-pagar`). Permiso: `accounts.payable.view`.
- Saldos con proveedores y talleres: «Proveedor / taller», «Saldo», «Vencido» (en rojo si hay), «Próximo vencimiento». Sin datos: «Sin deudas registradas».
- Al hacer clic en un proveedor se abre su **cuenta corriente** (`/cuentas-a-pagar/<id>`): «Fecha», «Comprobante» (Factura, Nota de crédito, Nota de débito, Pago, Anulación, Débito, Saldo inicial), «Vence», «Debe», «Haber», «Saldo». Haber = lo que le debemos (facturas); Debe = lo que reduce la deuda (notas de crédito y pagos).
- Botón «Pagar» (requiere `payables.pay`): abre una orden de pago nueva con ese proveedor.
- Un cheque de cartera endosado a un proveedor que después es rechazado vuelve a generar deuda con ese proveedor (movimiento «Débito», «Cheque endosado rechazado…»).

---

## Pagos (órdenes de pago)

- **Ruta:** Finanzas → Pagos (`/pagos`). Ver: `accounts.payable.view`. Crear: `payables.pay` («Nueva orden de pago»).
- Lista: «Orden de pago» (`OP-xxxxxxxx`), «Proveedor», «Fecha», «Medios», «Importe», «Sin imputar» (anticipo), «Estado». Casilla «Solo pendientes de aprobación».
- Estados: «Pendiente de aprobación», «Pagada» (POSTED), «Rechazada», «Anulada».
- Se paga a proveedores **y talleres**. Lo que no se imputa a facturas queda como **anticipo** al proveedor.

### Medios de pago
| Medio | De dónde sale | Datos |
|---|---|---|
| «Efectivo» | Una caja | «Sale de» (si hay más de una caja) |
| «Transferencia» | Banco o billetera | «Sale de», «Referencia» |
| «Cheque de cartera (endoso)» | Cartera de cheques | «Cheque» (lista de cheques de terceros en cartera); el importe es el del cheque y no se edita |
| «Cheque propio» / «E-cheq propio» | Un banco | «Banco», «Número», «Fecha de pago» (obligatorios) |
| «Retención practicada» | No mueve fondos | «Certificado» |

Si no elegís cuenta, se usa la primera cuenta activa del tipo correspondiente. Si no existe ninguna: «No hay una caja activa para registrar ese medio. Creala en Tesorería.» (o «un banco ni una billetera», según el medio).

### Cómo registrar una orden de pago (con endoso de cheque)
1. Pagos → «Nueva orden de pago» (o «Pagar» desde la cuenta corriente).
2. «Proveedor o taller» y «Fecha».
3. En «Comprobantes a pagar» aparecen las facturas con saldo pendiente («Comprobante», «Vence» en rojo si está vencida, «Pendiente», «Pagar»). Cargá cuánto pagás de cada una, o usá «Pagar todo». Si no hay deuda: «Sin deuda pendiente. El pago quedará como anticipo al proveedor.»
4. En «Medios de pago» elegí el «Medio» e «Importe». «Agregar medio» suma otra línea (por defecto un cheque de cartera); la papelera la quita.
5. Para endosar: elegí «Cheque de cartera (endoso)» y el cheque en «Cheque» (muestra fecha de pago, banco, número, importe y librador). O tocá «Sugerir cheques de cartera»: completa lo imputado no cubierto por los otros medios con los cheques que vencen primero sin pasarse (si ninguno entra, propone el más chico; el excedente queda como anticipo). **Los cheques se endosan por su importe total.**
6. Con medios cargados, «Imputar el total por vencimiento» reparte el total pagado entre las facturas, primero las que vencen antes.
7. Revisá «Total pagado», «Imputado» y «Anticipo». Si se imputa más de lo pagado aparece «Se imputa más de lo pagado.» y no deja guardar.
8. «Registrar pago». Mensajes: «Orden de pago OP-… registrada.» o «Orden de pago OP-… enviada a aprobación: todavía no se pagó.»

Al registrarse (o al aprobarse): cada medio sale de su cuenta (efectivo/transferencia como egreso de caja/banco; el cheque de cartera pasa a «Endosado»; el cheque propio queda «Emitido» y resta del saldo «Valor» del banco **a su fecha de pago**), se registra el pago en la cuenta corriente y se imputa a las facturas.

### Aprobación de órdenes de pago
- Queda «Pendiente de aprobación» si quien la carga **no** tiene `payables.approve`, hay una regla activa «Aprobación de órdenes de pago» (Configuración → «Empresa y aprobaciones») y el total la supera. Mientras está pendiente **no sale dinero ni se entregan cheques**; el detalle muestra las imputaciones previstas.
- Los cheques elegidos quedan reservados: otra orden con el mismo cheque da «Un cheque elegido ya está en la orden de pago OP-…, pendiente de aprobación.»
- En el detalle, quien tiene `payables.approve` ve «Aprobar y pagar» y «Rechazar». **No puede aprobarla quien la cargó:** «Una orden de pago no puede aprobarla quien la cargó.»
- Al aprobar se vuelve a validar todo (fondos en caja, cheque todavía en cartera, número de cheque propio libre, período abierto). Mensaje: «Orden de pago aprobada: se pagó y se imputó.»
- «Rechazar» pide «Motivo (obligatorio)»: no se paga nada, la deuda sigue pendiente y los cheques quedan libres. Queda «Rechazada» con el motivo.
- «La orden de pago no está pendiente de aprobación.» si ya se resolvió.

### Anular una orden de pago
- Botón «Anular» (solo en «Pagada», requiere `payables.pay`) con motivo obligatorio. Efecto: las facturas vuelven a quedar pendientes, el dinero vuelve a su caja o banco (con fecha de hoy), los cheques endosados vuelven a la cartera y los cheques propios se anulan.
- No se puede si un cheque propio ya fue debitado o un cheque endosado ya cambió de estado (por ejemplo, rechazado): «El cheque propio … está debitado: no se puede anular.» / «El cheque … está rechazado: no se puede anular el pago.»
- Una pendiente no se anula, se rechaza: «Solo se anula una orden de pago ya pagada; una pendiente se rechaza.» · «La orden de pago ya está anulada.»
- El detalle tiene «Cuenta corriente» e imprimir (formato «Orden de pago» con «Recibí conforme»).

Errores frecuentes al pagar:
- «La caja X tiene $ A y se quieren sacar $ B.» → no alcanza el efectivo; usá otro medio o ingresá fondos.
- «La caja X tiene un arqueo al dd/mm/aaaa: no admite movimientos con fecha anterior.» → usá una fecha posterior al último arqueo.
- «El cheque … no está en cartera (…).» → ya fue depositado, endosado o rechazado.
- «El cheque propio BANCO n.º N ya fue emitido.» → número repetido.
- «El cheque propio necesita banco, número y fecha de pago» · «Elegí el cheque de cartera» · «Indicá el importe» · «Indicá cómo se paga» · «Hay un cheque repetido en el pago.»
- «Se imputan $ X y el pago es de $ Y.» · «FA …: se imputan X y quedan Y pendientes.»
- «El tercero elegido no es proveedor ni taller.»

---

## Tesorería

- **Ruta:** Finanzas → Tesorería (`/tesoreria`). Permiso: `treasury.view`.
- Pestañas: «Cuentas», «Cartera de cheques», «Transferencias», «Arqueos», «Conciliación».
- Cada cuenta muestra dos saldos: **«Operación»** (todos los movimientos con fecha de operación hasta hoy) y **«Valor»** (lo realmente disponible a fecha de valor; por ejemplo, un cheque propio emitido resta en «Valor» recién en su fecha de pago).

### Pestaña Cuentas
- «Nueva cuenta» (`treasury.accounts.manage`): «Nombre», «Tipo» («Caja», «Banco», «Billetera», «Tarjetas a acreditar», «Cartera de cheques») y «Banco» si es banco → «Crear cuenta». La cartera de cheques se crea sola la primera vez que entra un cheque.
- «Registrar movimiento» (`treasury.move`): «Cuenta», «Tipo» («Ingreso» / «Egreso»), «Importe», «Fecha de operación», «Concepto» → «Guardar movimiento». Error en cuenta inactiva: «No se pueden registrar movimientos en una cuenta inactiva.»
- Al tocar una cuenta se ven sus «Movimientos recientes» (Fecha, Concepto, Valor, Importe; etiqueta «Conciliado» si ya se concilió con el extracto).
- En una caja nunca se puede sacar más efectivo del que hay ni registrar con fecha anterior al último arqueo.

### Pestaña Cartera de cheques
- Botones «De terceros» / «Propios». Resúmenes: en terceros «En cartera», «Depositados sin acreditar», «Rechazados»; en propios «Emitidos sin debitar», «Debitados».
- Filtros terceros: «En cartera», «Depositados», «Acreditados», «Endosados», «Rechazados», «Todos». Propios: «Emitidos», «Debitados», «Anulados», «Todos».
- Los cheques de terceros entran con los **cobros** a clientes; los propios se emiten **desde una orden de pago**. No se cargan a mano acá.
- Ciclo de terceros: En cartera → «Depositar» → Depositado → «Acreditado» → Acreditado. En cartera → endosado en un pago → Endosado. Desde En cartera, Depositado o Endosado se puede registrar «Rechazo». Propios: Emitido → «Debitado» (o Anulado si se anula el pago).
- Acciones (requieren `treasury.move`), todas con «Fecha» y «Confirmar»:
  - «Depositar»: elegí «Banco». Sale de la cartera y **suma al banco recién cuando se registra la acreditación**. Solo desde la fecha de pago y dentro de 30 días: «El cheque es de pago diferido: se puede depositar desde el dd/mm/aaaa.» / «Venció el plazo de presentación (30 días desde el …).» La lista avisa «en N días», «para depositar», «quedan N días para presentarlo» o «plazo vencido».
  - «Acreditado»: el importe pasa al saldo del banco.
  - «Rechazo»: «Motivo» (mín. 3 caracteres) y, si estaba depositado, «Gasto bancario». Se debita al cliente el importe más el gasto, con vencimiento en el día; si estaba endosado, **la deuda con el proveedor vuelve a quedar pendiente**. «El gasto bancario solo se registra si el cheque fue depositado.»
  - «Debitado» (propios): confirma que el banco lo pagó; el egreso ya figuraba a la fecha de pago.
- Para devolver un cheque al cliente hay que anular el cobro mientras siga en cartera.

### Pestaña Transferencias
- Entre cuentas propias (extracciones, depósitos de efectivo, acreditación de tarjetas). «Desde» (muestra saldo), «Hacia», «Importe», «Comisión» (se descuenta de lo que llega; muestra «Llegan $…»), «Fecha», «Disponible desde» (fecha de valor si se acredita otro día), «Concepto» → «Transferir».
- No se puede usar la cartera de cheques ni transferir hacia «Tarjetas a acreditar». Errores: «La cuenta de origen y la de destino son la misma.» · «Las cuentas tienen distinta moneda.» · «La comisión debe ser menor al importe transferido.» · «La fecha de valor no puede ser anterior a la de la transferencia.»
- «Anular» (con motivo): vuelve el importe al origen y sale lo recibido del destino, con fecha de hoy. «La transferencia ya está anulada.»

### Pestaña Arqueos
- Solo para cajas. «Nuevo arqueo»: «Caja», «Fecha» (no futura), «Efectivo contado», «Observaciones» → «Registrar arqueo».
- Muestra «Según sistema», «Diferencia» (Cuadra / Faltante / Sobrante), «Ingresos desde el último», «Egresos desde el último».
- La diferencia se registra automáticamente como movimiento de ajuste («Sobrante de arqueo» / «Faltante de arqueo»). **Después del arqueo la caja no admite movimientos con fecha anterior.**
- Errores: «No se puede arquear una fecha futura.» · «Ya hay un arqueo posterior a esa fecha.» · «El arqueo se hace sobre una caja.»
- Sin cajas: «Creá una caja en la pestaña Cuentas para poder arquearla.»

### Pestaña Conciliación (extractos bancarios)
- «Importar extracto»: «Cuenta» (bancos y billeteras activos), «Archivo CSV» → «Importar». El CSV del home banking debe tener columnas **Fecha** e **Importe** (o **Débito** y **Crédito**), y opcionalmente Concepto/Descripción/Detalle y Referencia/Comprobante/Nro. Separador «;», «,» o tabulación. Fechas tipo 29/10/2026, 29-10-26 o 2026-10-29. Máximo 1 MB.
- Las líneas ya importadas (aunque vengan en otro archivo) se omiten. Resultado: «Se importaron N líneas (M ya estaban importadas).» + link «Conciliar ahora»; las líneas ilegibles se listan como «Línea N: …».
- Errores: «El extracto necesita columnas "Fecha" e "Importe" (o "Débito" y "Crédito").» · «El archivo no tiene movimientos.» · «Todas las líneas de este archivo ya estaban importadas.» · «No se pudo leer ningún movimiento…» · «Importe ilegible…» / «Fecha ilegible…» · «Los extractos se importan en un banco o una billetera.»
- La lista de extractos muestra «N sin conciliar» o «Conciliado»; clic para abrir.

### Cómo conciliar un extracto
1. Abrí el extracto (`/tesoreria/extractos/<id>`). Arriba: «Líneas», «Sin conciliar», «Neto del extracto».
2. «Conciliar sugeridas»: concilia sola cada línea que tiene **un único** movimiento candidato (mismo importe, ±5 días de la fecha de valor) que no sea candidato de otra línea. Lo ambiguo queda para decidir a mano. Mensaje: «Se conciliaron N líneas.» o «No hubo coincidencias inequívocas.»
3. Para cada línea «Sin conciliar», tocá «Resolver». Tres opciones:
   - **Conciliar con un movimiento**: elegí una sugerencia. Si no hay: «No hay movimientos del mismo importe en ±5 días…».
   - **Registrar en el sistema**: para lo que solo está en el banco (comisiones, impuestos, intereses, débitos automáticos). «Concepto» y, en débitos, «Registrar como gasto» con «Categoría» y «Centro de costo». Se registra con la fecha del banco y queda «Registrada desde el extracto».
   - **Ignorar**: con «Motivo» (por ejemplo, una línea informativa).
4. «Deshacer» vuelve a pendiente una línea conciliada o ignorada. Una línea «Registrada desde el extracto» no se deshace: «El movimiento se registró desde el extracto: para corregirlo, anulá el gasto o registrá un contramovimiento.»
5. Abajo, «En el sistema y no en el banco»: movimientos del período sin conciliar (cheques propios sin debitar, depósitos en tránsito, errores de carga).
- Estados de línea: «Sin conciliar», «Conciliada», «Registrada desde el extracto», «Ignorada».
- Errores: «La línea ya fue resuelta.» · «Ese movimiento ya está conciliado con otra línea.» · «El importe del movimiento no coincide con el del banco.» · «Solo un débito del banco puede registrarse como gasto.» · «Para registrarlo como gasto indicá categoría y centro de costo».

---

## Gastos

- **Ruta:** Finanzas → Gastos (`/gastos`). Ver: `treasury.view`. Registrar/anular: `treasury.move`.
- Para gastos **pagados en el momento** desde caja, banco o billetera (fletes, servicios, librería, mantenimiento). **Las facturas de proveedores a plazo se cargan en Compras → Comprobantes** (van a cuenta corriente).
- Pestañas «Gastos» y «Recurrentes». Numeración `GA-xxxxxxxx`.
- Requisito: tener categorías de tipo «Gastos» (Configuración → «Categorías») y centros de costo (Configuración → «Centros de costo»). Si no: «Primero cargá categorías de gastos y centros de costo en Configuración.»

### Cómo registrar un gasto
1. «Nuevo gasto».
2. «Fecha», «Categoría», «Centro de costo», «Pagado desde» (cajas, bancos y billeteras activas; muestra el saldo), «Concepto», «Comprobante» (ticket o factura, opcional), «Importe».
3. «Registrar gasto». El dinero sale de la cuenta elegida en ese momento.
- Filtros «Desde», «Hasta», «Centro de costo». Resúmenes «Total del período» (sin anulados), «Por centro de costo», «Por categoría».
- «Anular» (con motivo): vuelven los fondos a la cuenta con fecha de hoy y el gasto deja de sumar. «El gasto ya está anulado.»
- Errores: «Elegí una categoría de gastos activa.» · «Elegí un centro de costo activo.» · «Un gasto se paga desde una caja, un banco o una billetera.» · los de caja sin fondos o con arqueo posterior.

### Cómo cargar y registrar un gasto recurrente
1. Gastos → pestaña «Recurrentes» → «Nuevo gasto recurrente».
2. «Nombre» (ej. Alquiler depósito), «Categoría», «Centro de costo», «Se paga desde», «Importe habitual» (se puede corregir cada mes), «Vence el día» (1 a 28: «Elegí un día del 1 al 28 (existe en todos los meses)»), «Desde» (primer mes que cubre) → «Crear».
3. Cada plantilla lista los meses pendientes hasta el mes en curso, con «Vence el …» y la etiqueta «Vencido» si pasó. Si no hay pendientes: «Al día.»
4. Para registrar un mes: ajustá «Importe» y «Comprobante» si hace falta y tocá «Registrar». Se crea un gasto «Nombre · AAAA-MM» con fecha el día de vencimiento de ese mes y sale el dinero.
5. «Desactivar» deja de pedir meses (no hay botón para reactivar en pantalla).
- **No se registra solo**: siempre hay que tocar «Registrar». Los meses sin registrar aparecen en el Flujo de fondos como «Gastos recurrentes sin registrar».
- Errores: «X de AAAA-MM ya está registrado (GA-…).» · «La plantilla está desactivada.»

---

## Flujo de fondos

- **Ruta:** Finanzas → Flujo de fondos (`/flujo-de-fondos`). Permiso: `treasury.view`. Solo consulta.
- Proyección semanal (lunes a domingo). «Horizonte»: 4, 8, 13 (90 días) o 26 semanas. Casilla «Incluir lo vencido en la primera semana».
- Parte del **disponible hoy** (cajas, bancos y billeteras a fecha de valor) y suma: facturas a cobrar y a pagar por vencimiento, cheques de terceros en cartera y depositados (por fecha de pago), tarjetas a acreditar, cheques propios a debitar, gastos recurrentes sin registrar y otros movimientos con fecha de valor futura.
- Indicadores: «Disponible hoy», «Saldo al final», «Saldo más bajo», «Vencido sin cobrar» (con «Vencido sin pagar»). Aviso «Saldo negativo desde la semana del …».
- Tabla «Semana», «Ingresos», «Egresos», «Saldo»; «Ver detalle» muestra las partidas de esa semana (marca «Vencido»).
- Para que una factura de proveedor aparezca en la semana correcta, su «Vencimiento» tiene que estar bien cargado.

---

## Cierre de período

- **Ruta:** Finanzas → Cierre de período (`/cierre-de-periodo`). Permiso: `periods.close` (reabrir: `periods.reopen`).
- Después de cerrar, **no se registra ninguna operación con fecha igual o anterior al último día cerrado**: cobros, pagos, facturas y comprobantes, gastos, movimientos de caja y banco, cheques, arqueos ni movimientos de stock (incluidas recepciones).
- Muestra «Cerrado hasta el …. Se puede operar desde el …» o «No hay períodos cerrados».

### Cómo cerrar un período
1. «Cerrar hasta el día» (inclusive; por defecto el último día del mes anterior).
2. Revisá los controles: «Extractos conciliados», «Cajas arqueadas al cierre», «Cheques propios vencidos debitados». Son **informativos**: «Se puede cerrar igual, pero conviene resolverlo antes.»
3. «Observaciones» opcional → «Cerrar período».
- Reglas: solo se puede cerrar hasta ayer («Solo se puede cerrar hasta ayer (dd/mm/aaaa sigue abierto).»); cerrar solo avanza («El período ya está cerrado hasta el …. Para retroceder, reabrilo.»).

### Cómo reabrir
- Tarjeta «Reabrir» (solo si hay un cierre y tenés `periods.reopen`): «Dejar cerrado hasta el día» (vacío reabre todo) y «Motivo (obligatorio)» de al menos 10 caracteres («Explicá por qué se reabre (mínimo 10 caracteres)») → «Reabrir período».
- Errores: «No hay ningún período cerrado.» · «Para reabrir, la nueva fecha tiene que ser anterior al ….»
- «Historial»: cada cierre y reapertura con fecha, «Cerrado hasta», quién y observaciones (no se puede borrar).

### Error de período cerrado
«El período está cerrado hasta el dd/mm/aaaa: no se registran operaciones con fecha anterior. Usá una fecha posterior o pedí que se reabra.» Solución: cargar con fecha posterior al cierre o pedir a alguien con `periods.reopen` que reabra. Ojo: las anulaciones (de pagos, gastos, transferencias) se registran con fecha de hoy, así que funcionan aunque el documento original esté en un período cerrado.

---

## Conexiones con otras áreas

- **Producción → Compras:** «Pedir faltantes a Compras» en una orden de producción crea la solicitud. Las liquidaciones de talleres aparecen en Comprobantes y en Cuentas a pagar, y se pagan con órdenes de pago como cualquier proveedor.
- **Compras → Stock:** la recepción suma stock en el depósito elegido, con partida si corresponde, al costo de la OC (o el cargado en compra directa), y actualiza el último costo del material. La OC por sí sola no mueve stock.
- **Compras → Cuentas a pagar:** el comprobante genera la deuda (factura/nota de débito) o la reduce (nota de crédito) en la cuenta corriente del proveedor, con vencimiento según su condición de pago (Configuración → «Condiciones de pago y zonas» y ficha del proveedor).
- **Pagos → Tesorería y Cuentas a pagar:** la orden de pago cancela facturas y saca fondos de cajas/bancos o endosa cheques de la cartera (que entraron con los cobros a clientes).
- **Cheques → Clientes/Proveedores:** un rechazo genera un débito al cliente y, si el cheque estaba endosado, la deuda con el proveedor vuelve.
- **Gastos y extractos → Tesorería:** cada gasto es un egreso de la cuenta; lo registrado desde un extracto queda conciliado.
- **Flujo de fondos** lee facturas abiertas, cheques, tarjetas, cheques propios y recurrentes.
- **Cierre de período** bloquea todo lo anterior a la fecha cerrada en todas las áreas.

## Preguntas frecuentes rápidas

- **«No me deja recibir la orden»**: ¿está «Pendiente de aprobación»? Tiene que aprobarla otra persona con `purchasing.approve`. ¿Falta el permiso `purchasing.receive`? ¿Está Recibida/Cerrada/Cancelada?
- **«No puedo aprobar mi propia orden / pago»**: por diseño, la aprueba otra persona.
- **«Llegó menos de lo pedido y no va a llegar más»**: en la recepción cargá lo recibido y tildá «El proveedor no va a entregar lo que falta: cerrar la orden.» Si ya registraste la recepción parcial sin tildar, usá «Cerrar pendiente» en la OC.
- **«Llegó más de lo pedido»**: hasta 5 % se acepta; más, no. Creá otra OC o una compra directa por la diferencia.
- **«Me pide partida»**: el material se controla por lote; cargá el código de partida del proveedor.
- **«El número de factura que sugiere no es el correcto»**: escribilo a mano; la sugerencia es el último cargado + 1 para ese proveedor, tipo y punto de venta.
- **«Pagué y la factura sigue pendiente»**: el pago puede estar «Pendiente de aprobación», o se registró sin imputar (quedó como anticipo, columna «Sin imputar»). Hoy no hay pantalla para imputar después un anticipo de proveedor: anulá la orden de pago y cargala de nuevo imputando.
- **«No aparece el cheque para endosar»**: solo se listan cheques de terceros «En cartera» que no estén en otra orden pendiente.
- **«El saldo del banco no coincide»**: mirá el saldo «Valor» vs «Operación», los cheques depositados sin acreditar y conciliá el extracto.
