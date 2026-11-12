# Inventario, análisis, administración y uso general

Base de conocimiento del asistente. Describe solo lo que el sistema hace hoy. Los nombres entre «» son textos literales de la pantalla.

## Uso general de la interfaz

### Menú lateral (barra izquierda)
Solo muestra las opciones para las que tu rol tiene permiso; si una sección no tiene ninguna opción habilitada, no aparece. En el celular o en pantallas chicas se abre con el botón «Abrir menú» (ícono ☰ arriba a la izquierda). Las secciones con título (Ventas, Producción, etc.) se pliegan y despliegan tocando su nombre (la flecha › indica que está plegada). La sección de la pantalla en la que estás se abre sola; las demás quedan como las dejaste y el navegador lo recuerda. Si una sección plegada contiene la pantalla actual, muestra un punto de color. Las opciones de una sección plegada siguen disponibles con Ctrl+K y los atajos G + tecla. Secciones y opciones (con el permiso que piden):

- (sin título): «Inicio» (todos), «Alertas» (todos).
- **Ventas**: «Pedidos», «Remitos», «Comprobantes», «Listas de precios», «Promociones», «Comisiones» (`sales.view`); «Cobros», «Cuentas a cobrar» (`accounts.receivable.view`).
- **Producción**: «Mis tareas» (`production.report`), «Tablero» y «Órdenes» (`production.view`), «Fichas técnicas» (`techsheets.view`), «Liquidación de talleres» (`production.settle`).
- **Compras**: «Solicitudes», «Órdenes de compra», «Recepciones», «Comprobantes» (`purchasing.view`), «Cuentas a pagar» (`accounts.payable.view`).
- **Finanzas**: «Tesorería», «Gastos», «Flujo de fondos» (`treasury.view`), «Pagos» (`accounts.payable.view`), «Cierre de período» (`periods.close`).
- **Análisis**: «Reportes» (todos; cada reporte filtra por permiso), «Rentabilidad» (`sales.view` y `costs.view`, los dos).
- **Catálogo**: «Modelos» (`catalog.view`), «Materiales» (`materials.view`).
- **Inventario**: «Stock», «Movimientos», «Inventarios físicos» (`inventory.view`).
- **Terceros**: «Clientes», «Proveedores», «Talleres» (`parties.view`).
- **Administración**: «Configuración» (`settings.master.manage`), «Config. de producción» (`settings.production`), «Usuarios» y «Roles y permisos» (`users.view`), «Auditoría» (`audit.view`).

### Barra superior
- Buscador «Buscar o ejecutar una acción…» (abre la paleta de comandos, igual que Ctrl+K).
- Campana de alertas: muestra la cantidad de alertas **nuevas** dirigidas a vos (hasta «99+»). El globito es rojo si tenés alguna alerta crítica abierta. Se actualiza sola cada minuto y al volver a la pestaña. Al tocarla vas a «Alertas».
- Tu nombre y tus roles: llevan a «Mi cuenta».
- Botón «Cerrar sesión» (ícono de salida).

### Paleta de comandos (Ctrl+K)
- Se abre con **Ctrl+K** (Cmd+K en Mac) o tocando el buscador de la barra superior. Se cierra con **Esc**. Volver a apretar Ctrl+K la cierra.
- Texto guía: «Buscar clientes, modelos, SKU, CUIT, documentos o acciones…».
- Con 2 o más caracteres busca en el sistema, solo en lo que tu rol puede ver:
  - Clientes/proveedores/talleres (por nombre, código o CUIT) si tenés `parties.view`.
  - Modelos si tenés `catalog.view`.
  - Artículos (variantes y materiales, por SKU, nombre o código de barras exacto) y documentos de stock (por número, p. ej. «AJ-…») si tenés `inventory.view`. Una variante abre su detalle de stock; un material abre su ficha.
- Grupo «Acciones»: atajos «Nuevo modelo» (`catalog.create`), «Nuevo material» (`materials.create`), «Nuevo cliente / proveedor / taller» (`parties.create`), «Nuevo ajuste de stock» (`inventory.adjust`), «Nueva transferencia» (`inventory.transfer`), «Cargar stock inicial» (`inventory.opening`), más «Ir a …» para cada pantalla del menú que tengas habilitada. Sin texto se muestran las primeras 8; escribiendo se filtran.
- Si no hay coincidencias: «Sin resultados para "…"».

### Atajos de teclado
No funcionan mientras estás escribiendo en un campo.
- **Ctrl+K**: paleta de comandos.
- **/**: pone el cursor en el buscador de la tabla de la pantalla (si la tabla tiene buscador).
- **G y luego una letra** (dentro de menos de un segundo): ir a una pantalla. G+I «Inicio», G+A «Alertas», G+P «Pedidos», G+F «Comprobantes» de venta, G+T «Mis tareas», G+O «Órdenes» de producción, G+R «Reportes», G+M «Modelos», G+S «Stock», G+C «Clientes». Si no tenés permiso para esa pantalla, el atajo no hace nada.

### Tablas de datos
- Buscador arriba a la izquierda (cuando la pantalla lo tiene); la búsqueda es en el servidor.
- Filtros propios de cada pantalla al lado del buscador.
- Botón «Columnas»: mostrar u ocultar columnas. La elección se recuerda en ese navegador para tu usuario.
- Paginación abajo: «N registros · página X de Y» con flechas «Página anterior»/«Página siguiente».
- Tocar una fila abre su detalle (cuando la pantalla lo permite).
- Las tablas generales **no** se ordenan tocando los encabezados y **no** tienen botón de exportar. Para descargar datos a Excel o PDF se usa «Reportes» (ver más abajo). La única tabla con orden por columna es la de «Rentabilidad».

## Inicio (tablero)
- Ruta: `/`. Permiso: ninguno para entrar; cada bloque aparece según permisos.
- Saludo «Hola, <nombre>».
- **Tablero de Dirección** (solo con `executive.view`): seis indicadores — «Vendido en el mes», «Cobrado en el mes», «Disponible real», «Cheques en cartera a 30 días», «Deuda de clientes vencida», «Deuda con proveedores a 30 días». Cada número lleva a su listado y el ícono ⓘ explica cómo se calcula. «Vendido» y «Cobrado» se comparan con el mismo tramo del mes anterior; «Disponible real» con la misma fecha del mes anterior. Además: «Flujo proyectado a 8 semanas» (con «Ver detalle»), recuadro «Atención» (cheques rechazados, OP atrasadas, materiales faltantes, clientes sobre su límite), «Top 10 modelos» (facturado, últimos 30 días), «Sin ventas en 90 días» (modelos con stock) y «Producción en curso».
- **Catálogo e inventario**: «Modelos activos» (`catalog.view`); «Prendas terminadas en stock», «Stock crítico» (artículos con disponible por debajo del mínimo), «Ajustes por aprobar» (con `inventory.view`); «Valor producto terminado» y «Valor materias primas» (solo con `costs.view`; costo promedio, estimado, no contable).
- Tarjetas «Stock crítico» (hasta 8 artículos, «Ver todo» abre Stock filtrado por crítico) y «Últimos movimientos de stock» (últimos 8 documentos manuales, «Ver todo» abre Movimientos).

## Stock
- Ruta: `/stock`. Menú: Inventario › «Stock» (atajo G+S). Permiso: `inventory.view`.
- Para qué: ver por artículo el «Físico», «Reservado» y «Disponible» (físico − reservado).
- Columnas: «SKU», «Artículo», «Tipo» (Prenda/Material), «Físico», «Reservado», «Disponible», «Unidad», «Mínimo», «Valorizado» (solo con `costs.view`), «Estado» (etiqueta «Crítico» cuando el disponible es menor al mínimo). Disponible en rojo = negativo; en naranja = crítico.
- Filtros: buscador «SKU, nombre o código de barras…», «Todos los depósitos»/un depósito, «Todo»/«Prendas»/«Materiales», casilla «Solo crítico». Con «Todos los depósitos» los números suman todos los depósitos (incluidos los de talleres); eligiendo un depósito se ven solo los de ese depósito.
- Botones: «Transferir» (`inventory.transfer`) y «Ajuste» (`inventory.adjust`).
- El stock mínimo no se carga acá: en prendas se define por variante en la ficha del modelo (Catálogo); en materiales, en la ficha del material.
- Lo «Reservado» lo generan otros procesos (por ejemplo pedidos o producción); no se edita a mano.

## Detalle de stock y kardex de un artículo
- Ruta: `/stock/<artículo>` (tocando una fila de Stock, o desde la paleta). Permiso: `inventory.view`.
- Encabezado: nombre, SKU, código de barras, unidad y mínimo; enlace «Ver modelo» o «Ver material».
- Tabla de saldos por «Depósito» y «Lote / partida»: «Físico», «Reservado», «Disponible» y «Costo promedio» (solo con `costs.view`). Sin stock: «Sin stock en ningún depósito.»
- **Kardex**: todos los movimientos del artículo con «Fecha», «Movimiento» (y el motivo debajo), «Documento» (enlace al documento o al «Inventario»), «Depósito», «Cantidad» (verde entra, rojo sale), «Saldo» (saldo del depósito después del movimiento), «Costo unit.» (con `costs.view`) y «Usuario».
- Tipos de movimiento: «Stock inicial», «Recepción de compra», «Devolución a proveedor», «Entrega (remito)», «Devolución de cliente», «Consumo de producción», «Ingreso de producción», «Descarte de producción», «Transferencia (salida)», «Transferencia (entrada)», «Ajuste», «Ajuste por inventario».

### Cómo ver el kardex de un artículo
1. Andá a «Stock» (G+S) y buscá por SKU, nombre o código de barras (o usá Ctrl+K).
2. Tocá la fila del artículo.
3. Bajá a «Kardex». Para ver un solo depósito elegilo en el selector «Todos los depósitos» de la derecha. Con todos los depósitos, el saldo de cada fila corresponde al depósito de ese movimiento.
4. Para descargarlo a Excel/PDF usá el reporte «Kardex» en «Reportes» (pide el SKU y fechas).

## Movimientos de stock (documentos manuales)
- Ruta: `/stock/documentos`. Menú: Inventario › «Movimientos». Permiso para ver: `inventory.view`.
- Tres tipos de documento: «Stock inicial» (número `SI-…`, permiso `inventory.opening`), «Ajuste» (`AJ-…`, `inventory.adjust`), «Transferencia» (`TR-…`, `inventory.transfer`).
- Columnas: «Número», «Tipo», «Depósito» (origen → destino en transferencias), «Motivo», «Líneas», «Valor» (con `costs.view`), «Estado», «Fecha». Filtro «Todos los tipos»/«Stock inicial»/«Ajustes»/«Transferencias».
- Botones según permiso: «Stock inicial», «Transferencia», «Ajuste».
- Estados: «Borrador», «Pendiente de aprobación», «Confirmado», «Anulado». Desde la pantalla los documentos se confirman en el mismo paso (no quedan en borrador).
- Regla: nada se borra. Anular genera movimientos de reversa y el documento original se conserva.

### Cómo cargar el stock inicial
1. «Movimientos» › «Stock inicial» (o Ctrl+K › «Cargar stock inicial»). Requiere `inventory.opening`.
2. Elegí el «Depósito».
3. Agregá artículos con el buscador («Buscar por SKU, nombre o escanear código de barras…») o con «Cargar prendas por grilla talle × color…» (elegís un modelo y cargás cantidades en la grilla).
4. En cada línea completá «Cantidad» (positiva) y «Costo unitario» (obligatorio). «Lote / partida» es opcional (si no existe, se crea).
5. «Confirmar (N líneas)».

### Cómo hacer un ajuste de stock
1. «Stock» › «Ajuste», o «Movimientos» › «Ajuste», o Ctrl+K › «Nuevo ajuste de stock». Requiere `inventory.adjust`.
2. Elegí «Depósito» y «Motivo» (obligatorio): «Rotura / daño», «Diferencia de inventario», «Muestra / regalo», «Vencimiento / obsolescencia», «Error de carga», «Otro». «Observaciones» es opcional.
3. Agregá artículos (buscador o grilla). Se ve el «Disponible» de cada uno en ese depósito.
4. «Cantidad»: positiva **suma**, negativa **resta** (ej.: `-3`). Hasta 4 decimales. Las líneas en cero se ignoran.
5. «Confirmar». Mensaje: «AJ-… confirmado.» o «AJ-… quedó pendiente de aprobación.».
- El botón «Confirmar» queda deshabilitado hasta elegir depósito, motivo y al menos una línea con cantidad.

### Aprobación de ajustes
- Si en «Configuración» › «Empresa y aprobaciones» hay una regla «Aprobación de ajustes de stock» activa, el ajuste se valoriza (|cantidad| × costo promedio del depósito) y, si supera el umbral, queda «Pendiente de aprobación» sin mover stock.
- Si quien carga el ajuste tiene `inventory.adjust.approve`, nunca queda pendiente: se aplica directo.
- Para aprobar: abrí el documento y tocá «Aprobar» (requiere `inventory.adjust.approve`). Mensaje: «Ajuste aprobado y aplicado.».
- Quien cargó el ajuste no lo puede aprobar; a esa persona le aparece: «Este ajuste supera el umbral configurado y tiene que aprobarlo otra persona con permiso de aprobación.».
- No hay botón «Rechazar»: para descartar un ajuste pendiente se lo anula (no movió stock; solo cambia el estado).
- Los ajustes pendientes generan la alerta «Aprobación pendiente» y se cuentan en «Ajustes por aprobar» del Inicio.
- Entre los roles iniciales, solo «Superadministrador» y «Propietario / Dirección» tienen `inventory.adjust.approve`.

### Cómo transferir mercadería entre depósitos
1. «Stock» › «Transferir», «Movimientos» › «Transferencia» o Ctrl+K › «Nueva transferencia». Requiere `inventory.transfer`.
2. Elegí «Depósito origen» y «Depósito destino» (distinto del origen). Se puede transferir a depósitos de talleres.
3. Agregá artículos y cantidades (siempre positivas).
4. «Confirmar». Se generan «Transferencia (salida)» en origen y «Transferencia (entrada)» en destino, al mismo costo. Las transferencias no piden aprobación.

### Cómo anular un documento de stock
1. Abrí el documento desde «Movimientos».
2. «Anular» (requiere el mismo permiso que el tipo de documento: `inventory.opening`, `inventory.adjust` o `inventory.transfer`).
3. Escribí el «Motivo (obligatorio)» (mínimo 3 caracteres) y tocá «Anular documento».
4. Si estaba confirmado se generan movimientos de reversa (marcados «reversa»); el mensaje es «Documento anulado. Se generaron los movimientos de reversa.».

### Detalle de un documento
Muestra «Creado», «Confirmado», «Motivo», «Valor» (con `costs.view`), «Observaciones», la tabla «Líneas» y «Movimientos generados». Si no movió stock: «Este documento todavía no movió stock.».

### Errores frecuentes en movimientos de stock
- «Stock insuficiente de <SKU>: disponible X, se intenta descontar Y.» — la salida dejaría el disponible en negativo (lo reservado por otros documentos no se puede tocar). Revisá el depósito elegido, la cantidad o primero ingresá/transferí el stock. También aparece al anular un documento cuya mercadería ya salió.
- «La operación dejaría el stock en negativo.» — mismo caso, detectado por la base de datos.
- «El lote <código> no existe para este artículo.» — en una resta indicaste un lote inexistente; dejá el lote vacío o corregilo.
- «El depósito está inactivo.» — el depósito fue desactivado.
- «El motivo del ajuste es obligatorio», «Elegí el depósito destino», «El destino debe ser distinto del origen», «La cantidad no puede ser cero», «La cantidad debe ser positiva» (stock inicial y transferencias), «Indicá el costo unitario» (stock inicial), «Cargá al menos una línea».
- «No tenés permiso para este tipo de movimiento.» / «No tenés permiso para registrar este tipo de movimiento.» — falta el permiso del tipo de documento.
- «No tenés permiso para aprobar ajustes.», «Un ajuste no puede ser aprobado por quien lo cargó.», «El documento no está pendiente de aprobación.», «El documento ya está anulado.».
- Período cerrado: «El período está cerrado hasta el dd/mm/aaaa: no se registran operaciones con fecha anterior. Usá una fecha posterior o pedí que se reabra.».

## Inventarios físicos
- Ruta: `/stock/inventarios`. Menú: Inventario › «Inventarios físicos». Ver: `inventory.view`. Abrir y cargar conteos: `inventory.count`. Confirmar: `inventory.count` **y** `inventory.adjust`.
- Funcionamiento: al abrir un inventario se toma una "foto" del stock físico de cada artículo activo en ese depósito («Esperado»). Al confirmarlo, se ajusta solo la diferencia entre lo contado y lo esperado; los artículos sin contar no se tocan. Supone que el depósito no se mueve durante el conteo: si hubo movimientos entre la apertura y la confirmación, no se recalculan.
- Número `INV-…`. Estados visibles: «Abierto» y «Confirmado».
- Los ajustes por inventario («Ajuste por inventario» en el kardex) no pasan por la aprobación por umbral.

### Cómo hacer un inventario físico
1. «Inventarios físicos»: elegí «Depósito» y «Alcance» («Todos los artículos», «Solo prendas», «Solo materiales») y tocá «Abrir inventario».
2. En la pantalla del inventario, cargá el «Contado» de cada artículo a mano, o usá el campo «Escaneá un código de barras (suma 1 por lectura)»: cada lectura (Enter) suma 1 al artículo con ese código de barras o SKU. Si no está: «El código <X> no está en este inventario.».
3. Usá «Filtrar por SKU o nombre…» y «Solo con diferencia» para revisar. Se muestran hasta 500 filas a la vez («Usá el filtro»).
4. Tocá «Guardar conteo (N)» para grabar lo cargado (se puede guardar varias veces; mensaje «Conteo guardado.»).
5. Cuando esté todo, «Confirmar inventario» (solo habilitado si no quedan cambios sin guardar y hay al menos un artículo contado) › «Confirmar y ajustar». Mensaje: «Inventario confirmado: N artículos ajustados.». No se puede deshacer, salvo con un ajuste nuevo.
- El encabezado muestra «X de Y contados · Z con diferencia».
- Errores: «El inventario ya no admite cambios.» (ya confirmado), «El inventario ya fue posteado o cancelado.», «Hay artículos que no forman parte de este inventario.».

## Alertas
- Ruta: `/alertas` (atajo G+A, o la campana). Permiso: ninguno para ver las propias; `alerts.manage` para ver las de todos y configurar reglas.
- El sistema revisa las reglas solo cada 15 minutos (valor por defecto). Una alerta se resuelve sola cuando la situación se normaliza («Se resolvió sola: la condición ya no se cumple.»).
- Cada alerta va a los **roles** destinatarios de su regla: ves las alertas de las reglas dirigidas a alguno de tus roles.
- Pestañas: «Abiertas», «Resueltas» y, con `alerts.manage`, «Reglas». Con `alerts.manage` aparece la casilla «Ver las alertas de todos los usuarios».
- Cada alerta muestra prioridad («Crítica», «Alta», «Normal», «Baja»), la regla, «Nueva» si no fue vista, título (enlace a lo que hay que mirar), detalle, «Desde el …», «vista por …», «resuelta el … por …» y la nota. Las abiertas se ordenan por prioridad.
- Estados: «Nueva», «Vista», «Resuelta».

### Cómo gestionar una alerta
1. Tocá el título para ir al documento (eso también la marca como vista) o tocá «Marcar vista».
2. Para cerrarla: «Resolver», completá «Qué se hizo (opcional)» y «Confirmar». Mensaje: «Alerta resuelta. No vuelve a aparecer mientras la situación siga igual.». Si la situación se normaliza y más adelante vuelve a ocurrir, se crea una alerta nueva.
- Errores: «Esta alerta no está dirigida a vos.», «La alerta ya está resuelta.», «No tenés permiso para ver las alertas de todos.».

### Reglas de alerta (pestaña «Reglas», requiere `alerts.manage`)
| Regla | Qué la dispara | Prioridad y destinatarios por defecto |
|---|---|---|
| Stock bajo el mínimo | Un artículo tiene en los depósitos propios menos que su stock mínimo | Normal · Compras, Depósito |
| Falta material para una OP | Una OP liberada o en proceso necesita un material que no alcanza en el depósito de materiales | Alta · Producción, Compras |
| OP atrasada | Una OP liberada o en proceso pasó su fecha de entrega | Alta · Producción, Propietario |
| Pedido sin preparar | Pedido confirmado sin remito hace más de N días (def. 3) | Normal · Ventas, Depósito |
| Cliente con deuda vencida | Facturas vencidas hace más de N días (def. 15) | Normal · Administración, Tesorería |
| Cheque por vencer | Cheque de terceros en cartera que vence en N días o menos (def. 3) | Normal · Tesorería |
| Cheque rechazado | Cheque de terceros rechazado sin gestionar | Crítica · Tesorería, Administración, Propietario |
| Aprobación pendiente | Un ajuste de stock o un pago a proveedor espera aprobación | Alta · Administración, Propietario |
| Diferencia de inventario | Inventario físico en revisión con diferencias, o saldo de stock que no coincide con sus movimientos | Alta · Administración, Depósito |
| Conciliación atrasada | Extracto bancario con líneas sin conciliar hace más de N días (def. 7) | Normal · Tesorería |
| Error de integración | ARCA rechazó o no autorizó un comprobante en una hora, o falló un correo del sistema | Alta · Administración |

### Cómo configurar una regla de alerta
1. «Alertas» › pestaña «Reglas».
2. En la tarjeta de la regla: «Activa», «Prioridad», el campo de días (si la regla lo usa), «Avisar por correo» y «Destinatarios» (casillas por rol).
3. «Guardar» (se habilita solo si cambiaste algo). Mensaje: «Regla "<nombre>" guardada.».
4. «Revisar ahora» corre la evaluación al instante y muestra cuántas alertas nuevas, resueltas y abiertas hay.
- Desactivar una regla resuelve sus alertas abiertas («Regla desactivada.»).
- Los correos se mandan como un resumen por persona. Si aparece «El envío de correos no está configurado (falta SMTP_URL)…», las alertas se ven en el sistema y los correos quedan en espera; lo resuelve el administrador técnico del servidor.
- Errores: «Elegí al menos un rol o usuario que reciba la alerta.» (regla activa sin destinatarios), «<etiqueta de días>: entre <mín> y <máx>.».

## Reportes
- Ruta: `/reportes` (atajo G+R). Permiso: ninguno para entrar; se listan solo los reportes cuyos permisos tenés todos. Si no hay ninguno: «Tu rol no tiene reportes disponibles.». Buscador «Buscar reporte…».
- Cada reporte se ve en pantalla y, con `data.export`, se descarga en Excel o PDF.

| Categoría | Reporte | Permisos | Parámetros |
|---|---|---|---|
| Ventas | Ventas por período | sales.view | Desde, Hasta, Agrupar por (Mes/Cliente/Vendedor/Modelo) |
| Ventas | Ranking de productos (curva ABC) | sales.view | Desde, Hasta |
| Ventas | Productos de baja rotación | sales.view + inventory.view | Días sin ventas (7–730, def. 90) |
| Ventas | Pedidos pendientes | sales.view | — |
| Ventas | Rentabilidad (margen bruto estimado) | sales.view + costs.view | Desde, Hasta, Agrupar por (Modelo/Categoría/Cliente/Pedido/Vendedor) |
| Inventario | Stock valorizado | inventory.view + costs.view | Depósito (o Todos) |
| Inventario | Stock crítico (con reposición sugerida, depósitos propios) | inventory.view | — |
| Inventario | Kardex | inventory.view | SKU (obligatorio), Desde, Hasta, Depósito |
| Producción | Órdenes de producción abiertas | production.view | — |
| Producción | Materiales en talleres | production.view + inventory.view | — |
| Cuentas corrientes | Cuentas a cobrar por antigüedad | accounts.receivable.view | — |
| Cuentas corrientes | Cuentas a pagar por antigüedad | accounts.payable.view | — |
| Tesorería | Cartera de cheques | treasury.view | Estado (En cartera/Depositados/Entregados a terceros/Rechazados/Todos) |
| Tesorería | Caja y bancos | treasury.view | Desde, Hasta |
| Tesorería | Flujo proyectado a 90 días | treasury.view | — |
| Tesorería | Gastos por categoría | treasury.view | Desde, Hasta, Agrupar por (Categoría/Centro de costo) |

Por defecto «Desde» es el 1 del mes y «Hasta» es hoy.

### Cómo ver y exportar un reporte
1. «Reportes» › tocá la tarjeta del reporte.
2. Completá los parámetros y tocá «Ver reporte» (los reportes sin parámetros obligatorios cargan solos; el Kardex espera a que pongas el SKU: «Completá los datos»).
3. Arriba se ve un resumen de los parámetros y la cantidad de filas; puede haber totales al pie y notas.
4. Con el resultado en pantalla, tocá «Excel» o «PDF» (solo aparecen con `data.export`). Mensaje: «Descargado: <archivo>». El archivo se llama `<código>-<fecha>.xlsx/.pdf`, lleva empresa, título, parámetros y «Generado el … por …»; en Excel los números y fechas son valores reales con autofiltro.
- Cada exportación queda registrada en «Auditoría».
- Errores: «La fecha desde no puede ser posterior a la fecha hasta.», «Indicá SKU», «No existe un artículo con SKU <X>.», «No tenés permiso para ver este reporte.», «El reporte no existe.», «No se pudo generar el archivo.».
- Si no ves los botones «Excel»/«PDF»: te falta `data.export`.

## Rentabilidad
- Ruta: `/rentabilidad`. Menú: Análisis › «Rentabilidad». Permiso: `sales.view` y `costs.view`. Sin ellos: «No tenés permiso para ver la rentabilidad (requiere ver ventas y costos).».
- Muestra el **margen bruto estimado**: vendido neto de IVA menos costo de salida de la mercadería. No descuenta gastos, comisiones, fletes ni impuestos: no es el resultado contable.
- Filtros «Desde» y «Hasta» (por defecto, del 1 del mes a hoy). Indicadores «Vendido neto» (con unidades), «Costo de lo vendido», «Margen bruto estimado» (con % sobre lo vendido), cada uno con ⓘ.
- Pestañas «Por modelo», «Por categoría», «Por cliente», «Por pedido», «Por vendedor». Columnas «Unidades», «Vendido neto», «Costo», «Margen bruto est.», «Margen %»; tocando el encabezado se ordena (otro toque invierte). Fila «Total» al pie.
- Cálculo: vendido = facturas + notas de débito − notas de crédito vigentes. Costo = costo de salida tomado del remito (promedio ponderado del depósito al entregar; las prendas producidas entran al costo estimado de su ficha). Notas de crédito con devolución restan el mismo costo; las de bonificación no tienen costo.
- Aviso «N unidades vendidas no tienen costo cargado: su margen figura al 100 % y el total está sobreestimado»: revisá el costo de esos modelos en su stock inicial o su ficha técnica. Cada fila afectada muestra «N u. sin costo».
- Sin ventas: «Sin ventas en el período». Esta pantalla no exporta; para Excel/PDF usá el reporte «Rentabilidad (margen bruto estimado)».

## Configuración
- Ruta: `/configuracion`. Menú: Administración › «Configuración» (aparece con `settings.master.manage`). Agregar datos maestros requiere `settings.master.manage`; la pestaña de empresa se carga con `settings.company.view` y se edita con `settings.company.edit`. Todos los cambios quedan auditados.
- Pestañas: «Empresa y aprobaciones», «Depósitos», «Talles», «Colores», «Categorías», «Centros de costo», «Temporadas y colecciones», «Unidades», «Condiciones de pago y zonas».
- En las pestañas de maestros la pantalla **solo permite agregar** (botón «Agregar»): no hay botones para editar, borrar ni desactivar registros existentes.

### Empresa y aprobaciones
- Campos «Razón social», «Nombre de fantasía», «Domicilio» y botón «Guardar». «CUIT» no se puede cambiar: «Para modificarlo, contactá al administrador del sistema.».
- **Puntos de venta de proveedores**: números de punto de venta que se ofrecen al cargar facturas de proveedores. El primero es el «Predeterminado». Agregar: «Punto de venta» (hasta 5 dígitos) › «Agregar». En los demás: «Hacer predeterminado» y «Quitar».
- **Aprobación de ajustes de stock**: «Umbral ($)» › «Guardar regla». Ajustes valorizados por encima de ese monto quedan pendientes. «Actual: …» muestra el monto o «sin regla (no se piden aprobaciones)».
- **Aprobación de órdenes de pago**: igual, para órdenes de pago a proveedores.
- Sin `settings.company.edit` los campos se ven deshabilitados y no aparecen los botones.

### Datos maestros
- **Depósitos**: «Código», «Nombre», «Tipo» («Propio», «Cuarentena», «En tránsito»). Los depósitos de taller se crean solos al dar de alta un taller.
- **Talles**: «Nombre de la escala» y «Talles (en orden, separados por coma)», p. ej. «RN, 0-3, 3-6». Error: «Hay talles repetidos en la escala.».
- **Colores**: «Código» (se usa en el SKU), «Nombre», «Muestra» (color).
- **Categorías**: «Nombre» y «Para» («Productos», «Materiales», «Gastos»).
- **Centros de costo**: «Código» (corto, hasta 20) y «Nombre».
- **Temporadas y colecciones**: «Temporada» + «Año»; luego «Colección» + «Temporada».
- **Unidades**: «Código», «Nombre», «Mide» («Unidades», «Longitud», «Peso», «Superficie»). Conversiones: «1 [unidad] equivale a [factor] de [unidad]». Solo se convierten unidades que miden lo mismo (m ↔ cm); rollo → metros se define por tela. Errores: «Las unidades deben ser distintas.», «<A> y <B> miden cosas distintas: solo se pueden convertir con un factor específico por artículo.».
- **Condiciones de pago y zonas**: «Condición» (p. ej. 30/60) y «Días de cada cuota» (p. ej. «30, 60»); «Zona».
- Código repetido: «Ya existe un registro con ese valor (…).».

### Cómo cambiar el umbral de aprobación de ajustes
1. «Configuración» › «Empresa y aprobaciones» (requiere `settings.company.edit`).
2. En «Aprobación de ajustes de stock», escribí el monto en «Umbral ($)».
3. «Guardar regla». Mensaje «Guardado.».

## Usuarios
- Ruta: `/configuracion/usuarios`. Menú: Administración › «Usuarios». Ver: `users.view`. Crear, cambiar roles, desactivar: `users.manage`.
- Tabla: «Usuario» (nombre, email, «Inactivo» si corresponde), «Roles», «Último ingreso».
- Entre los roles iniciales, solo «Superadministrador» tiene `users.manage` (Propietario / Dirección ve la lista pero no puede crear ni modificar usuarios).

### Cómo crear un usuario y asignarle un rol
1. «Usuarios» › «Nuevo usuario».
2. Completá «Nombre», «Email» y «Contraseña inicial» (mínimo 10 caracteres, con letras y números).
3. Marcá uno o más «Roles» (obligatorio; «Crear usuario» está deshabilitado sin rol).
4. «Crear usuario». Mensaje «Usuario creado.». Pasale al usuario su email y contraseña inicial.
- Si el email ya existía como usuario del sistema, se lo vuelve a habilitar en la empresa con los roles elegidos y conserva su contraseña anterior (la contraseña inicial cargada no se aplica).
- Errores: «Mínimo 10 caracteres», «Debe incluir letras», «Debe incluir números», «Asigná al menos un rol», «Hay roles inexistentes.».

### Cómo cambiar los roles de un usuario
En la columna «Roles» hay una lista de selección múltiple: elegí los roles (Ctrl+clic para marcar varios). Se guarda al cambiar («Roles actualizados.»). No se puede dejar sin roles. Los permisos nuevos rigen en la siguiente acción del usuario (puede necesitar recargar la página para ver el menú actualizado).

### Cómo desactivar o reactivar un usuario
Botón «Desactivar» / «Reactivar» en su fila. Al desactivar se cierran todas sus sesiones y no puede volver a entrar («El usuario no tiene acceso a ninguna empresa.»). No podés desactivarte a vos mismo (el botón no aparece; error «No podés desactivar tu propio usuario.»). Los usuarios no se borran.

## Roles y permisos (pantalla)
- Ruta: `/configuracion/roles`. Ver: `users.view`. Crear/editar: `roles.manage` (entre los roles iniciales, solo Superadministrador).
- Lista de roles con la cantidad de usuarios; al elegir uno se ven sus permisos agrupados por módulo, con la descripción y el código de cada permiso.
- «Rol inicial» marca los roles que vienen con el sistema (se pueden editar). El «Superadministrador» muestra «No editable» («El rol Superadministrador no se puede modificar.»).
- Los permisos se validan siempre en el servidor: aunque un botón se vea, si el rol no tiene el permiso la operación se rechaza con «No tenés permiso para esta acción (<códigos>).».

### Cómo crear un rol personalizado
1. «Roles y permisos» › «Nuevo rol».
2. «Código» (mayúsculas, letras, números y guion bajo, 2 a 30; p. ej. «CORTE») y «Nombre».
3. Marcá los permisos.
4. «Guardar rol» («Rol guardado.»).
- Ojo: si usás el código de un rol que ya existe, se sobrescriben el nombre y los permisos de ese rol.
- No hay opción para borrar roles. Para editar uno existente, elegilo, cambiá nombre o casillas y «Guardar rol».

## Auditoría
- Ruta: `/configuracion/auditoria`. Permiso: `audit.view`.
- Registro de solo inserción (no se puede modificar ni borrar): «Fecha», «Usuario», «Entidad», «Acción» (con «Motivo:» si hubo), «Detalle» («Ver cambios» / «Ocultar» muestra los datos del cambio).
- Filtro «Todas las entidades» o una: Terceros, Modelos, Variantes, Materiales, Documentos de stock, Inventarios, Usuarios, Roles, Sesiones, Depósitos, Empresa, Reglas de aprobación. Otras entidades (alertas, exportaciones de reportes, etc.) se ven con «Todas las entidades».
- Acciones con su código técnico, por ejemplo: `create`, `update`, `post` (confirmar), `approve`, `request_approval`, `void` (anular), `set_roles`, `activate`, `deactivate`, `upsert`, `resolve`, `export`.
- 100 registros por página, botones «Anterior» / «Siguiente».

### Cómo revisar quién hizo un cambio
1. «Auditoría».
2. Elegí la entidad (p. ej. «Documentos de stock»).
3. Buscá por fecha/usuario y tocá «Ver cambios» para el detalle.

## Mi cuenta
- Ruta: `/cuenta` (tocando tu nombre arriba a la derecha). Permiso: ninguno.
- Muestra nombre, email y «Roles», y la lista «Sesiones abiertas» (dispositivo/navegador, IP, inicio y última actividad).
- «Cerrar» cierra una sesión (si es la actual, te desconecta). «Cerrar todas las demás» cierra todas menos la actual. Mensaje «N sesión(es) cerrada(s).».

### Cambiar o recuperar la contraseña
El sistema **no tiene** hoy pantalla para cambiar la contraseña, ni opción «olvidé mi contraseña», ni forma de que un administrador la restablezca desde la aplicación. Si necesitás cambiarla, pedíselo al responsable técnico del sistema.

## Ingreso (login)
- Ruta: `/login`. Campos «Email» y «Contraseña», botón «Ingresar». Tras ingresar vuelve a la página que intentabas abrir.
- La sesión dura 12 horas desde la última actividad (valor por defecto) y se renueva mientras usás el sistema.
- Errores:
  - «Email o contraseña incorrectos.»
  - «El usuario está bloqueado temporalmente por intentos fallidos. Probá de nuevo en unos minutos.» — tras 5 intentos fallidos seguidos se bloquea 15 minutos.
  - «Demasiados intentos de ingreso. Esperá unos minutos.» — demasiados intentos desde la misma conexión en 15 minutos.
  - «El usuario no tiene acceso a ninguna empresa.» — el usuario fue desactivado; pedí a un administrador que lo reactive.
  - «La sesión expiró. Volvé a ingresar.» / «Sin acceso a la empresa.» — volvé a ingresar o consultá al administrador.
  - «No se pudo conectar con el servidor.»

## Roles y permisos

### Roles iniciales del sistema
Son los roles con los que se crea cada empresa. Todos menos Superadministrador se pueden editar en «Roles y permisos», así que en tu empresa pueden diferir.

- **Superadministrador**: todos los permisos. Único rol inicial que crea usuarios y administra roles. No editable.
- **Propietario / Dirección**: todo salvo crear/editar usuarios (`users.manage`) y administrar roles (`roles.manage`). Ve el tablero de Dirección, costos, aprueba ajustes y pagos, carga stock inicial, cierra y reabre períodos.
- **Administración**: terceros (ver, crear, editar, crédito), ver catálogo, materiales e inventario, costos, exportar e importar, compras (ver y comprobantes), cuentas a pagar, ver producción y liquidar talleres, ventas completas (pedidos, autorizar crédito, facturar, precios, comisiones), cobros, tesorería, pagos, cierre de período, tablero de Dirección, configurar alertas, ver datos de la empresa. No aprueba ajustes ni pagos, no ajusta stock.
- **Compras**: terceros, materiales (ver, crear, editar), ver inventario y costos, exportar, solicitudes y órdenes de compra, recepciones, comprobantes de proveedores, cuentas a pagar, ver producción y fichas técnicas. No aprueba órdenes de compra.
- **Producción**: ver catálogo, materiales, inventario y terceros, órdenes de producción completas (planificar, materiales, avances, calidad, talleres), fichas técnicas (ver y editar), crear solicitudes/órdenes de compra, configuración de producción, ver costos.
- **Depósito**: ver catálogo, materiales e inventario; transferencias, ajustes e inventarios físicos; recepciones de compra; entregar materiales, control de calidad y envíos a talleres; ver ventas y emitir remitos. No carga stock inicial ni aprueba ajustes.
- **Operario de planta**: ver órdenes de producción e informar avances («Mis tareas»).
- **Ventas**: ver y crear clientes, ver catálogo e inventario, ver ventas y cargar pedidos, ver cuentas a cobrar.
- **Tesorería**: ver terceros y crédito, exportar, cuentas a pagar y a cobrar, cobros, ver ventas, tesorería completa (ver, crear cuentas, movimientos), pagos.
- **Contabilidad**: consulta amplia (empresa, terceros, crédito, catálogo, materiales, inventario, costos, compras, cuentas a pagar y cobrar, producción, fichas, ventas, tesorería), auditoría, exportar y cerrar períodos.
- **Auditor / Consulta**: todos los permisos de "ver" excepto costos (incluye usuarios, auditoría y tablero de Dirección). No modifica nada y no exporta.

Quién tiene permisos clave (roles iniciales): aprobar ajustes de stock → Superadministrador, Propietario. Stock inicial → Superadministrador, Propietario. Ajustes, transferencias e inventarios físicos → Superadministrador, Propietario, Depósito. Exportar reportes → Superadministrador, Propietario, Administración, Compras, Tesorería, Contabilidad. Ver costos → Superadministrador, Propietario, Administración, Compras, Producción, Contabilidad. Configurar alertas → Superadministrador, Propietario, Administración. Configuración de maestros y empresa → Superadministrador, Propietario. Auditoría → Superadministrador, Propietario, Contabilidad, Auditor.

### "No veo el menú X" / "no me deja Y"
Los menús y botones aparecen solo con el permiso correspondiente (ver tabla). Si falta, pedile a un administrador (alguien con `users.manage` o `roles.manage`) que te asigne un rol que lo incluya o que agregue el permiso a tu rol. Ejemplos: no ves «Configuración» → `settings.master.manage`; no ves «Rentabilidad» → `sales.view` y `costs.view`; no ves los botones «Excel»/«PDF» → `data.export`; no ves la columna «Valorizado» ni costos → `costs.view`; no ves «Aprobar» en un ajuste → `inventory.adjust.approve` (y no podés ser quien lo cargó); no ves la pestaña «Reglas» en Alertas → `alerts.manage`.

### Tabla de permisos
| Código | Qué permite |
|---|---|
| settings.company.view | Ver datos de la empresa |
| settings.company.edit | Editar datos de la empresa, puntos de venta de proveedores y umbrales de aprobación |
| settings.master.manage | Administrar datos maestros (unidades, talles, colores, categorías, depósitos, etc.) y ver el menú «Configuración» |
| users.view | Ver usuarios y la pantalla de roles |
| users.manage | Crear usuarios, cambiar sus roles, desactivarlos |
| roles.manage | Crear y editar roles y sus permisos |
| audit.view | Consultar la auditoría |
| alerts.manage | Configurar reglas de alerta y ver las alertas de todos |
| executive.view | Ver el tablero de Dirección en Inicio |
| parties.view | Ver clientes, proveedores y talleres |
| parties.create | Crear clientes, proveedores y talleres |
| parties.edit | Editar clientes, proveedores y talleres |
| parties.credit.view | Ver condiciones comerciales y límites de crédito |
| catalog.view | Ver catálogo de productos |
| catalog.create | Crear modelos y variantes |
| catalog.edit | Editar modelos y variantes |
| materials.view | Ver materias primas e insumos |
| materials.create | Crear materias primas |
| materials.edit | Editar materias primas |
| inventory.view | Ver stock, kardex, movimientos e inventarios físicos |
| inventory.opening | Registrar stock inicial |
| inventory.adjust | Registrar ajustes de stock (y, junto con inventory.count, confirmar inventarios) |
| inventory.adjust.approve | Aprobar ajustes de stock sobre el umbral |
| inventory.transfer | Registrar transferencias entre depósitos |
| inventory.count | Abrir inventarios físicos y cargar conteos |
| purchasing.view | Ver solicitudes y órdenes de compra |
| purchasing.order | Crear solicitudes y órdenes de compra |
| purchasing.approve | Aprobar órdenes de compra |
| purchasing.receive | Registrar recepciones de mercadería |
| purchasing.invoice | Registrar comprobantes de proveedores |
| accounts.payable.view | Ver cuentas corrientes de proveedores y talleres |
| production.view | Ver órdenes de producción |
| production.plan | Crear, liberar, cerrar y cancelar órdenes de producción |
| production.materials | Entregar y devolver materiales de producción |
| production.report | Informar avances de producción («Mis tareas») |
| production.qc | Registrar ingresos y control de calidad |
| production.workshop | Enviar y recibir de talleres |
| production.settle | Liquidar servicios de talleres |
| techsheets.view | Ver fichas técnicas |
| techsheets.edit | Crear y activar versiones de fichas técnicas |
| settings.production | Configurar etapas de producción, motivos de falla y tarifas de taller |
| sales.view | Ver pedidos, remitos y comprobantes de venta |
| sales.order | Cargar y confirmar pedidos de venta |
| sales.credit.override | Autorizar pedidos que superan el límite de crédito |
| sales.deliver | Preparar y emitir remitos |
| sales.invoice | Emitir facturas y notas de crédito y débito |
| sales.prices.manage | Administrar listas de precios y cambiar precios en pedidos |
| sales.commissions.manage | Configurar vendedores y liquidar comisiones |
| accounts.receivable.view | Ver cuentas corrientes de clientes |
| receivables.collect | Registrar cobros e imputaciones |
| treasury.view | Consultar cajas, bancos y movimientos de tesorería |
| treasury.accounts.manage | Crear cuentas de tesorería |
| treasury.move | Registrar movimientos de tesorería |
| payables.pay | Registrar órdenes de pago a proveedores y talleres |
| payables.approve | Aprobar órdenes de pago sobre el umbral |
| periods.close | Cerrar períodos (bloquear operaciones con fecha anterior) |
| periods.reopen | Reabrir períodos cerrados |
| costs.view | Ver costos y valorizaciones (información sensible) |
| data.export | Exportar reportes a Excel/PDF |
| data.import | Importar información masiva |
