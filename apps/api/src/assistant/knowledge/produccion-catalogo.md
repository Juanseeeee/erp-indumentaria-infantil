# Producción, catálogo y materiales

Base de conocimiento del módulo de catálogo (modelos y variantes), materias primas y producción (fichas técnicas, órdenes, talleres, calidad, costos y liquidación de talleres). Los nombres entre «» son textos exactos de la pantalla.

## Conceptos básicos

- **Modelo**: un producto comercial (p. ej. «Body manga larga»). Tiene código, escala de talles y colores. Genera automáticamente sus **variantes** (una por combinación talle × color), cada una con SKU, código de barras y stock propios.
- **Material**: materia prima o insumo (telas, hilos, avíos, packaging). Se usa en las fichas técnicas y tiene stock propio.
- **Ficha técnica**: lista de materiales de un modelo con consumo por prenda (por talle si hace falta), merma y recorrido de etapas. Es versionada.
- **Orden de producción (OP)**: numeración `OP-00001`. Indica qué modelo y cuántas prendas por talle y color fabricar.
- **Envío a taller**: numeración `ET-000001`. **Ingreso de producción**: `IP-000001`. **Liquidación de taller**: `LT-000001`.
- Cada **taller** (tercero con rol Taller) tiene un depósito virtual propio («Taller <razón social>», código `TALLER-<código>`), que se crea solo al darlo de alta en Terceros. Lo que se le envía queda como stock en ese depósito.

## Permisos del módulo

| Permiso | Para qué |
|---|---|
| `catalog.view` / `catalog.create` / `catalog.edit` | Ver / crear / editar modelos y variantes |
| `materials.view` / `materials.create` / `materials.edit` | Ver / crear / editar materias primas |
| `production.view` | Ver tablero y órdenes de producción, configuración (lectura) |
| `production.plan` | Crear, liberar, cerrar y cancelar órdenes |
| `production.materials` | Entregar y devolver materiales, «Consumir según ficha», registrar devolución del taller |
| `production.report` | Informar avances (Mis tareas, pestaña Etapas) |
| `production.qc` | Registrar ingresos con control de calidad |
| `production.workshop` | Enviar a talleres y registrar faltantes en taller |
| `production.settle` | Liquidar talleres |
| `techsheets.view` / `techsheets.edit` | Ver / crear y activar versiones de fichas técnicas |
| `settings.production` | Configurar etapas, motivos de falla y tarifas de taller |
| `settings.master.manage` | Configuración general: talles, colores, categorías, temporadas y colecciones, unidades |
| `costs.view` | Ver costos (pestaña Costos de la OP, costo estimado de la ficha, último costo de materiales) |
| `purchasing.order` | Botón «Pedir faltantes a Compras» de una OP |

Roles predefinidos relevantes: **Producción** (casi todo producción, fichas, config. de producción, costos, `purchasing.order`; no liquida talleres), **Depósito** (materiales, calidad, talleres; no planifica), **Operario de planta** (solo `production.view` y `production.report`), **Administración** (ve producción y liquida talleres), **Compras** (materiales y ve producción y fichas). Si a alguien no le aparece un botón, casi siempre es porque le falta el permiso correspondiente.

---

## Temporadas, colecciones, talles y colores (Configuración)

- **Ruta**: `/configuracion` (menú Administración → «Configuración»). **Permiso**: `settings.master.manage`.
- Pestañas relevantes: «Talles», «Colores», «Categorías», «Temporadas y colecciones», «Unidades».
- Solo se pueden **agregar** registros (botón «Agregar»); esta pantalla no tiene edición ni borrado.

### Cómo crear una temporada y una colección
1. Andá a «Configuración» → pestaña «Temporadas y colecciones».
2. En la primera tarjeta completá «Temporada» (p. ej. «Primavera-Verano 2027») y «Año», y tocá «Agregar».
3. En la segunda tarjeta completá «Colección», elegí la «Temporada» y tocá «Agregar».
4. La colección queda disponible en el campo «Colección» del modelo (se muestra como «Colección · Temporada»).

### Cómo crear una escala de talles
Pestaña «Talles»: «Nombre de la escala» y «Talles (en orden, separados por coma)», p. ej. `RN, 0-3, 3-6, 6-9, 9-12`. «Agregar».

### Cómo crear un color
Pestaña «Colores»: «Código» (se usa en el SKU), «Nombre» y «Muestra» (color). «Agregar».

### Categorías
Pestaña «Categorías»: «Nombre» y «Para» (Productos / Materiales / Gastos). Las de Productos se usan en modelos; las de Materiales, en materiales.

---

## Modelos (catálogo)

- **Ruta**: `/catalogo` (menú Catálogo → «Modelos»). **Permiso**: `catalog.view`; crear `catalog.create`; editar `catalog.edit`.
- Listado con columnas «Código», «Modelo», «Categoría», «Colección», «Variantes», «Físico», «Disponible», «Estado». Búsqueda «Buscar por código o nombre…». Filtros «Todas las categorías» y estado: «Activos y borradores» (por defecto, oculta discontinuados), «Activos», «Borradores», «Discontinuados».
- Estados de un modelo: **Borrador**, **Activo**, **Discontinuado**. Solo los modelos **Activos** aparecen al crear una orden de producción.
- Botón «Nuevo modelo».

### Cómo crear un modelo con sus variantes
1. «Modelos» → «Nuevo modelo» (ruta `/catalogo/nuevo`).
2. Completá «Código del modelo» (se pasa a mayúsculas; es el prefijo del SKU, p. ej. `BODY-ML`), «Nombre comercial», «Categoría» (opcional), «Colección» (opcional), «Material principal» (texto descriptivo; la ficha técnica real se arma en Producción), «Estado» («Activo» o «Borrador») y «Descripción».
3. Elegí la «Escala de talles». Aparecen los «Talles a generar»: por defecto están todos seleccionados; tocá un talle para excluirlo.
4. En «Colores» marcá uno o más colores (obligatorio: «Elegí al menos un color»).
5. La pantalla muestra «Se van a generar N variantes (talles × colores)».
6. «Crear modelo». Aviso: «Modelo creado con N variantes.» y te lleva al detalle.

### SKU y código de barras
- El SKU de cada variante se arma con el patrón `{MODELO}-{COLOR}-{TALLE}` usando el código del modelo, el **código** del color y el código del talle; se normaliza a mayúsculas, sin acentos, y cualquier carácter que no sea letra o número se reemplaza por guion.
- El código de barras es un EAN-13 interno generado automáticamente (empieza con `200`).
- El nombre de cada variante es «<nombre del modelo> <color> <talle>».
- El código del modelo y la escala de talles **no se pueden cambiar** después de crearlo (la edición no los incluye).

### Detalle del modelo
- **Ruta**: `/catalogo/<id>`.
- Grilla talle × color con vistas (pestañas): «Disponible», «Físico», «Reservado», «SKU», «Código de barras». Selector de depósito («Todos los depósitos» o uno). En «Disponible», la celda se resalta si está por debajo del stock mínimo. Cada número lleva al stock/kardex de la variante.
- «Editar datos» (`catalog.edit`): «Nombre», «Estado» (Activo / Borrador / Discontinuado), «Categoría», «Colección», «Material principal» → «Guardar». Cambiar el nombre renombra las variantes; los SKU y códigos de barras no cambian.
- «Editar stock mínimo» → grilla editable (se puede pegar desde Excel) → «Guardar mínimos». El mínimo dispara la alerta de stock crítico.
- «Activar o desactivar variantes»: un checkbox por SKU. Una variante inactiva no se ofrece en pedidos ni producción, pero conserva su historial.
- «Agregar colores»: elegí los colores que el modelo todavía no tiene y tocá «Generar N variantes». Crea las combinaciones con todos los talles actuales del modelo; no duplica las existentes.
- La pantalla no permite agregar talles nuevos a un modelo ya creado ni editar el código de barras a mano.

### Errores frecuentes en catálogo
- «Otro usuario modificó el modelo. Recargá.» → alguien guardó cambios mientras editabas; recargá la página y volvé a editar.
- «Los talles elegidos no pertenecen a la escala.» / «Hay colores inexistentes.»
- «Falta configurar la unidad "un" (unidades).» → debe existir una unidad con código `un` (Configuración → «Unidades»).
- «Ya existe un registro con ese valor (…)» → código o SKU repetido (por ejemplo, otro modelo con el mismo código).

**Importante**: si agregás un color a un modelo que ya tiene ficha técnica con líneas «Según el color de la prenda», tenés que crear una nueva versión de la ficha indicando el material para ese color; si no, al liberar una orden con ese color aparece «La ficha técnica no indica qué material usar para el color X.»

---

## Materiales (materias primas e insumos)

- **Ruta**: `/materiales` (menú Catálogo → «Materiales»). **Permiso**: `materials.view`; crear `materials.create`; editar `materials.edit`.
- Listado «Materias primas e insumos»: columnas «Código», «Descripción», «Categoría», «Unidad», «Mínimo», «Lotes» (badge «Por partida»), y «Último costo» (solo con `costs.view`). Búsqueda por código, descripción o código de barras exacto. Filtro por categoría de materiales. Solo muestra materiales activos.
- El stock y el kardex de un material se consultan desde Stock (botón «Ver stock y kardex» en el detalle).

### Cómo crear un material
1. «Materiales» → «Nuevo material» (`/materiales/nuevo`).
2. Campos: «Código» (se guarda en mayúsculas, ej. `TELA-INTERLOCK-BLA`), «Descripción», «Categoría», «Proveedor habitual», «Unidad de stock» (obligatoria: en esta unidad se lleva el stock y el costo), «Unidad de compra» (opcional; «Igual a la de stock» por defecto), «Stock mínimo», «Cantidad de reposición sugerida», «Código de barras», casilla «Controlar por lote / partida (recomendado en telas)».
3. Si la unidad de stock es de longitud (p. ej. metros), aparece «Datos de tela (opcionales)»: «Ancho (cm)», «Gramaje (g/m²)», «Composición», «Color».
4. «Crear material». Aviso «Material creado.»

### Editar un material
En `/materiales/<id>`, con `materials.edit`, el mismo formulario y «Guardar cambios». Sin ese permiso se ve «Solo lectura.».
- Error: «No se puede cambiar la unidad base de un material con movimientos de stock.» → la unidad de stock queda fija una vez que el material tuvo movimientos.

### Reglas útiles
- Los materiales cuya unidad de stock es de tipo «Unidades» (broches, etiquetas, etc.) se redondean **hacia arriba** al calcular los requerimientos de una orden y los consumos según ficha.
- El costo que usa producción es el **costo promedio** del material en el depósito de materiales; si es cero, usa el «último costo» del material.

---

## Fichas técnicas

- **Ruta**: `/produccion/fichas` (menú Producción → «Fichas técnicas»), detalle en `/produccion/fichas/<id del modelo>`. **Permiso**: `techsheets.view`; editar/activar `techsheets.edit`.
- El listado muestra los modelos (no discontinuados) con «Ver ficha →».
- Versiones: cada ficha tiene versiones con estado **borrador**, **vigente** (activa) o **archivada**, que se ven como etiquetas `vN · vigente/borrador/archivada`. Una versión vigente no se modifica: para cambiarla se crea una versión nueva. Solo puede haber un borrador a la vez.
- Si no hay versión vigente, el encabezado dice «Sin versión activa: no se pueden liberar órdenes de este modelo.»
- Las órdenes ya liberadas conservan la versión con la que se liberaron; activar una versión nueva no las cambia.

### Cómo cargar (o modificar) una ficha técnica
1. Entrá a la ficha del modelo. Tocá «Cargar ficha» (si no tiene ninguna), «Nueva versión» (si hay una vigente; se precarga con su contenido) o «Editar borrador» (si ya hay un borrador).
2. Tocá «Agregar material» por cada línea. En cada línea:
   - Tipo: «Material fijo» (elegís un material) o «Según el color de la prenda» (elegís un material para cada color del modelo, p. ej. tela blanca para la prenda blanca).
   - «Consumo base»: consumo por prenda en la **unidad de stock** del material.
   - Una columna por talle: consumo específico de ese talle; si queda vacía, usa el consumo base.
   - «Merma %»: entre 0 y 99. El consumo real por prenda = consumo × (1 + merma/100).
   - Ícono de papelera para quitar la línea.
3. «Recorrido de etapas»: con «Agregar etapa…» armás el orden de etapas; flechas para subir/bajar y papelera para quitar. Si no se define ninguna, la orden usa **todas las etapas activas** («Todas las etapas activas.»).
4. «Instrucciones»: texto libre.
5. «Guardar borrador» (o «Descartar cambios»). Aviso «Borrador guardado.»
6. «Activar vN» para que pase a ser la vigente. Aviso «Versión N activa. Las órdenes ya liberadas conservan su versión.» La anterior queda archivada.

### Costo estimado de la ficha
Con `costs.view` se ve «Costo estimado de materiales por prenda (versión vigente)» por SKU, a costo promedio actual (no incluye taller). Si algún material no tiene costo: «Hay materiales sin costo cargado: el estimado está incompleto.»

### Errores al guardar o activar la ficha
- «La ficha necesita al menos un material» / «Elegí el material» / «Indicá el material para cada color de prenda» / «La merma debe estar entre 0 y 99 %».
- «La ficha usa artículos que no son materias primas.» → solo se pueden usar materiales dados de alta en Materiales.
- «Hay consumos por talle para talles de otra escala.» / «Hay etapas inexistentes.»
- «No hay un borrador de ficha para activar.» → primero guardá un borrador.
- «La ficha no tiene materiales.»
- «Falta indicar el material para: <colores>.» → en una línea «Según el color de la prenda» falta asignar material a algún color del modelo.

---

## Configuración de producción

- **Ruta**: `/produccion/configuracion` (menú Administración → «Config. de producción»). **Permiso**: `settings.production` (lectura con `production.view`).
- Pestañas: «Tarifas de talleres», «Etapas», «Motivos de falla».

### Cómo cargar la tarifa de un taller
1. Pestaña «Tarifas de talleres».
2. Elegí «Taller», «Modelo», «Precio por prenda ($)» y «Vigente desde». «Agregar tarifa».
3. Una tarifa nueva no pisa la anterior: queda el historial y cada recepción usa la tarifa vigente a la fecha en que se recibe.
- Error «El tercero elegido no es un taller.»
- Sin tarifa vigente para ese taller y modelo **no se pueden recibir prendas** de ese taller (ver Ingresos).

### Etapas
Campos «Código», «Nombre», «Orden», casilla «La hace un taller» y «Guardar etapa». Si guardás con un código que ya existe, se actualizan nombre, orden y la marca de taller. Las etapas marcadas como de taller muestran «Taller externo». No hay opción para borrar etapas desde la pantalla.

### Motivos de falla
Campo «Motivo» y «Agregar». Se usan al informar prendas con falla y en el control de calidad.

---

## Tablero de producción

- **Ruta**: `/produccion` (menú Producción → «Tablero»). **Permiso**: `production.view`.
- Indicadores: «Borrador» (para planificar), «Liberada» (materiales reservados), «En curso», «Terminada» (listas para cerrar), «Atrasadas».
- Paneles: «Órdenes atrasadas» (liberadas o en curso con fecha de entrega vencida), «Materiales faltantes» (por orden y material, lo que falta después de lo reservado y lo disponible), «Trabajo en talleres» (envíos abiertos con prendas pendientes, fecha esperada y «demorado» si se pasó). Link «Ver todas las órdenes».
- Además, el centro de Alertas puede avisar de faltantes de materiales en órdenes y de órdenes atrasadas.

---

## Órdenes de producción (listado)

- **Ruta**: `/produccion/ordenes`. **Permiso**: `production.view`; «Nueva orden» requiere `production.plan`.
- Columnas: «Orden», «Modelo», «Avance» (ingresadas / planificadas), «Prioridad», «Entrega» (marca «atrasada»), «Estado». Búsqueda por número de orden. Filtro de estado: «Activas» (Liberada, En curso y Terminada; es el filtro por defecto), «Borradores», «Cerradas», «Canceladas», «Todas».

### Estados de una orden y transiciones
| Estado (pantalla) | Código | Significado |
|---|---|---|
| Borrador | DRAFT | Recién creada; no reserva nada |
| Liberada | RELEASED | Ficha congelada, materiales calculados y reservados, recorrido de etapas creado |
| En curso | IN_PROGRESS | Ya se entregaron materiales, se envió a taller, se informó avance o se ingresaron prendas |
| Terminada | COMPLETED | Se ingresó (aprobadas + segunda + descarte) todo lo planificado; lista para cerrar |
| Cerrada | CLOSED | Costo real calculado; reservas liberadas |
| Cancelada | CANCELLED | Anulada con motivo |

- Borrador → Liberada (botón «Liberar orden») o Cancelada.
- Liberada → En curso automáticamente con la primera entrega de materiales, envío a taller, avance o ingreso.
- En curso → Terminada automáticamente cuando se ingresó todo lo planificado.
- En curso o Terminada → Cerrada («Cerrar y calcular costo»).
- Borrador, Liberada o En curso → Cancelada («Cancelar»). Una orden Terminada no se puede cancelar; se cierra.
- Cerrada y Cancelada son finales. Error genérico de transición: «Una orden en estado X no puede pasar a Y.» y, para operaciones sobre órdenes no activas, «La orden está en estado X: no admite esta operación.»

### Cómo crear una orden de producción
1. «Órdenes» → «Nueva orden» (`/produccion/ordenes/nueva`).
2. «Modelo» (solo modelos activos).
3. «Materiales desde» (depósito de donde salen los materiales), «Ingresa producto terminado a» (depósito del producto terminado), «Segunda selección a» (opcional; «Sin segunda selección»; debe ser distinto del de producto terminado). Solo se listan depósitos propios activos (no de talleres).
4. «Inicio previsto», «Entrega comprometida», «Prioridad» (Alta / Normal / Baja), «Observaciones».
5. Cargá las cantidades en la grilla talle × color (en gris se ve el stock disponible de cada variante; se puede pegar desde Excel).
6. «Crear orden (N prendas)». Queda en **Borrador**: «Orden creada en borrador. Revisala y liberala para reservar materiales.»
- Errores: «Hay variantes que no pertenecen al modelo.», «La variante <SKU> está inactiva.», «La segunda selección debe ir a un depósito distinto del de producto terminado.», «Cargá al menos una cantidad».
- Si no elegís segunda selección, después no vas a poder ingresar prendas de segunda en esa orden (la columna queda deshabilitada).
- La pantalla de detalle no tiene edición de cantidades del borrador: si necesitás otras cantidades, cancelá el borrador y creá una orden nueva.

---

## Detalle de la orden

- **Ruta**: `/produccion/ordenes/<id>`. **Permiso**: `production.view`.
- Encabezado: «OP-xxxxx · Modelo», fecha de entrega, prioridad, depósitos («materiales de X → Y») y versión de ficha («ficha vN»). Badge de estado.
- Botones del encabezado (según estado y permisos): «Liberar orden» (Borrador, `production.plan`), «Pedir faltantes a Compras» (orden activa con faltantes, `purchasing.order`), «Cerrar y calcular costo» (En curso o Terminada, `production.plan`), «Cancelar» (Borrador, Liberada o En curso, `production.plan`).
- Pestañas: «Prendas», «Materiales», «Etapas», «Talleres (N)», «Ingresos y calidad (N)» y «Costos» (solo con `costs.view`).

### Cómo liberar una orden (reserva de materiales)
1. En la orden en Borrador tocá «Liberar orden».
2. El sistema: toma la versión **vigente** de la ficha técnica y la congela en la orden; calcula los materiales requeridos (consumo por talle, con merma, con el material según el color de la prenda; los materiales por unidad se redondean hacia arriba); **reserva** en el depósito de materiales lo disponible de cada uno; crea el recorrido de etapas (las de la ficha o, si no definió, todas las activas) y calcula el **costo estimado**.
3. Aviso: «Orden liberada: ficha congelada y materiales reservados.»
- **Se puede liberar con faltante de materiales**: reserva lo que hay y el resto queda como faltante. Aparece el aviso «Faltan materiales: <SKU (cantidad)>…» y la columna «Faltante» de la pestaña Materiales.
- Error «El modelo no tiene una ficha técnica activa. Cargala y activala antes de liberar la orden.» → andá a Fichas técnicas, cargá y activá una versión.
- Error «La ficha técnica no indica qué material usar para el color X.» → creá una nueva versión de la ficha asignando material a ese color y activala.

### Cómo pedir los faltantes a Compras
Con faltantes, tocá «Pedir faltantes a Compras» (permiso `purchasing.order`). Se crea una solicitud de compra (origen Producción) con las cantidades que faltan (requerido pendiente − reservado − disponible libre), con fecha necesaria = inicio previsto de la orden y nota «Faltantes de OP-xxxxx». Aviso «Se creó la solicitud de compra <número>.» Si no falta nada: «La orden no tiene faltantes de materiales.» La solicitud sigue su circuito en Compras → «Solicitudes».

Cuando la compra se recibe, el material entra como stock **libre** al depósito de la recepción; no se reserva automáticamente para la orden, pero queda disponible para entregarlo a planta, enviarlo al taller o consumirlo con «Consumir según ficha» (siempre que se haya recibido en el depósito de materiales de la orden).

### Pestaña «Prendas»
Grilla con selector de vista «Planificado», «Aprobado (1ra)», «Pendiente» y totales «Planificadas · aprobadas · segunda · descarte». Muestra las observaciones.

### Pestaña «Materiales» (distribución de materiales de la orden)
Columnas por material: «Requerido» (según ficha), «Reservado» (reserva pendiente), «Entregado», «En taller» (en poder de talleres, de esta orden), «Consumido», «Devuelto», «Faltante», «Desvío». El nombre del material lleva a su stock.
- «Desvío»: con la orden terminada/cerrada/cancelada = consumido − requerido (negativo en verde = se usó menos; positivo en rojo = se usó más). En curso solo se muestra si ya se entregó más de lo requerido.
- Antes de liberar: «Los materiales se calculan al liberar la orden, a partir de la ficha técnica.»

### Cómo entregar materiales a planta (corte propio)
1. Pestaña «Materiales» → «Entregar a planta (corte propio)» (permiso `production.materials`, orden activa).
2. Se agrega la columna «Entregar», precargada con lo pendiente (requerido − entregado). Ajustá las cantidades (hasta 4 decimales).
3. «Confirmar entrega». Aviso «Materiales entregados a planta.»
- Descuenta del depósito de materiales (consumo de producción, toma primero la reserva de la orden y por FIFO) y lo registra como entregado y consumido.
- Si entregás más de lo previsto queda registrado como desvío.
- Si el material no alcanza: «Stock insuficiente de <SKU>: disponible X, se intenta descontar Y.» → registrá antes la recepción de la compra o entregá menos.
- La orden pasa a En curso si estaba Liberada.

### Cómo devolver sobrante de planta
«Devolver sobrante de planta» → columna «Devolver» → «Confirmar devolución». Reingresa al depósito de materiales al costo con el que salió. Aviso «Devolución registrada.» No se puede devolver más de lo consumido en planta: «Se devuelve más de lo entregado a planta.» Se permite también en órdenes Canceladas (por API); errores: «Ese material no se entregó para esta orden.», «La orden no admite devoluciones.»

### Pestaña «Etapas» e informe de avance
Lista el recorrido con estado de cada etapa: «Pendiente», «En curso», «Terminada», «Salteada», cantidades «ok» y «con falla», y el taller asignado si corresponde («Taller: …»).
Formulario (permiso `production.report`, orden activa, con etapas abiertas): «Etapa», «Prendas OK», «Con falla», «Motivo de falla» (se habilita si hay fallas), casilla «Etapa terminada», botón «Informar». Aviso «Avance informado.»
- El avance es informativo: no mueve stock ni ingresa prendas. Las prendas entran al stock solo con el ingreso de calidad.

### Cómo informar avance desde «Mis tareas» (operarios)
- **Ruta**: `/produccion/tareas` (menú Producción → «Mis tareas»). **Permiso**: `production.report`. Pensada para celular; se actualiza sola cada minuto.
- Muestra una tarjeta por orden Liberada o En curso cuya **próxima etapa abierta** es interna (si la etapa está asignada a un taller no aparece), ordenadas por prioridad y fecha de entrega. Cada tarjeta muestra la etapa, el modelo, el número de orden, la entrega, «Urgente» si la prioridad es Alta y «hechas / planificadas».
1. Tocá la tarjeta.
2. Usá los contadores «Prendas OK» y «Con falla» (botones + y −, o escribí el número). Si hay fallas, elegí el «Motivo de la falla…».
3. «Informar» (requiere alguna cantidad) o «Informar y terminar etapa» (marca la etapa como terminada; entonces la orden pasa a mostrar la etapa siguiente).
- Si no hay tarjetas: «No hay tareas pendientes. Cuando se libere una orden, sus etapas internas aparecen acá.»
- Errores: «La etapa ya está cerrada.», «Informá alguna cantidad.», «La etapa no forma parte del recorrido de esta orden.», «Las cantidades no pueden ser negativas.»

### Cómo enviar a un taller (con materiales y avíos)
1. Pestaña «Talleres» → «Nuevo envío a taller» (permiso `production.workshop`, orden activa).
2. Elegí «Taller» y «Fecha esperada de entrega».
3. «Prendas a confeccionar (precargado: lo pendiente de enviar)»: grilla talle × color.
4. «Materiales que viajan con el envío (pasan al depósito del taller)»: una fila por material de la orden (telas, avíos, etiquetas, etc.), precargada con lo pendiente de entregar, mostrando lo reservado. Poné en 0 lo que no viaja.
5. «Confirmar envío». Aviso «Envío al taller registrado (remito generado).» con número `ET-…`.
- Los materiales se **transfieren** del depósito de materiales al depósito del taller (no se consumen todavía): quedan en la columna «En taller». Se consumen recién al recibir las prendas.
- Las etapas marcadas «La hace un taller» que no tenían taller quedan asignadas a este taller y en curso.
- Errores: «Se envían más prendas que las pendientes de enviar (N).», «Hay prendas que no son de esta orden.», «El taller no tiene depósito asociado. Revisá que esté dado de alta como taller.», o stock insuficiente del material en el depósito de materiales.
- Cada envío se lista con «Prendas: X recibidas de Y enviadas · N pendientes» (o «N faltantes al cierre» si se cerró) y los materiales enviados.

### Devolución o faltante de materiales del taller
Si quedan materiales de la orden en poder de talleres aparece «Materiales de esta orden en poder de talleres»:
- «Registrar devolución de <taller>» (permiso `production.materials`): cargá cantidades por material → «Confirmar». Vuelven al depósito de materiales. Aviso «Devolución del taller registrada.» Error: «Se devuelve más de lo que el taller tiene de esta orden (N).»
- «Registrar faltante» (requiere `production.materials` y `production.workshop`): cantidades + «Motivo del faltante» (mínimo 3 caracteres) → «Confirmar». Se da de baja del depósito del taller y se carga como consumo de la orden (suma al costo). Aviso «Faltante registrado.» Error: «La cantidad supera lo que el taller tiene de esta orden.»

### Cómo registrar el ingreso con control de calidad (interno o recibido del taller)
1. Pestaña «Ingresos y calidad» → «Registrar ingreso con control de calidad» (permiso `production.qc`, orden activa).
2. «Origen»: «Producción interna» o «Recepción de <taller> (ET-…)» (solo envíos abiertos; por defecto se preselecciona el primero abierto).
3. Por variante con pendiente: «Aprobadas», «Segunda», «Descarte» y «Motivo». «Pendiente» = lo enviado y no recibido (si es de taller) o lo planificado no ingresado (si es interno).
4. «Confirmar ingreso». Aviso «Ingreso registrado: lo aprobado ya está en stock.» Número `IP-…`.
- **Aprobadas** → entran al depósito de producto terminado. **Segunda** → al depósito de segunda selección (si la orden no tiene, la columna está deshabilitada: «La orden no tiene depósito para segunda selección.»). **Descarte** → solo se registra, no entra a stock.
- Las prendas entran al stock valuadas al **costo estimado** de la prenda (materiales a costo promedio actual según ficha + tarifa del taller si corresponde).
- **Recepción de taller**: requiere tarifa vigente; si no hay: «No hay tarifa cargada para este taller y modelo. Cargala en Configuración de producción.» Al confirmar se **consume del depósito del taller** el material que indica la ficha para las prendas recibidas (aprobadas + segunda + descarte). Si la ficha pide más de lo que el taller tenía de esa orden, consume lo que había y avisa: «<SKU>: la ficha indica X y el taller tenía Y de esta orden.» El envío pasa a recibido parcial o recibido.
- **Producción interna** (backflush): lo que la planta no retiró explícitamente con «Entregar a planta» se consume solo según la ficha desde el depósito de materiales (primero lo reservado para la orden, después el libre). Si falta material, consume lo que hay y avisa: «<SKU>: faltan N en el depósito de materiales; el consumo queda pendiente. Cuando lo recibas, usá «Consumir según ficha».»
- Cuando se ingresó todo lo planificado, la orden pasa a **Terminada**.
- Errores: «Se ingresan más prendas que las planificadas (N). Ajustá la orden antes de ingresar el excedente.», «Se reciben más prendas que las enviadas al taller y pendientes (N).», «El envío ya está cerrado.», «El envío no corresponde a esta orden.», «La orden no está liberada.», «Hay prendas que no son de esta orden.»
- Cada ingreso se lista con número, fecha, «recepción de taller» o «producción interna», cantidades, «costo est.» (con `costs.view`) y badge «Liquidado» si ya se liquidó al taller.

### Consumo pendiente y «Consumir según ficha»
Si hay prendas ingresadas cuyo consumo de materiales según ficha todavía no se registró (por ejemplo, porque faltaba material), la orden muestra el aviso amarillo: «Consumo de materiales pendiente por las prendas ya ingresadas: <SKU (cantidad)>. Cuando el material esté en stock (recepción de compra registrada), registralo para que el costo real lo incluya.» con el botón «Consumir según ficha» (permiso `production.materials`).
- El pendiente = consumo teórico de las prendas ingresadas − lo ya consumido − lo que está en poder de talleres.
- «Consumir según ficha» descuenta todo el pendiente del depósito de materiales. Si no alcanza el stock falla con «Stock insuficiente de <SKU>: disponible X, se intenta descontar Y.» → registrá primero la recepción de la compra en ese depósito.
- Si no hay nada pendiente: «No hay consumos pendientes: lo entregado cubre la ficha de las prendas ingresadas.»
- Aviso de éxito: «Consumo de materiales registrado según la ficha.»

### Cómo cerrar una orden
1. Con la orden En curso o Terminada, tocá «Cerrar y calcular costo» (permiso `production.plan`).
2. Requisitos:
   - **No puede haber materiales de la orden en poder de talleres**. Si hay: «Hay materiales de esta orden en poder de talleres: <SKU (cantidad)>. Registrá la devolución o el faltante antes de continuar.» → en la pestaña Talleres usá «Registrar devolución de …» o «Registrar faltante».
   - **Consumo pendiente**: si hay consumo según ficha sin registrar, se abre el panel «Cerrar OP-… sin registrar todo el consumo», que explica lo que falta. Lo recomendado es registrar la recepción de la compra y tocar «Consumir según ficha». Si igual querés cerrar (por ejemplo, porque realmente se usó menos), completá «Motivo (obligatorio)» (mínimo 3 caracteres) y tocá «Cerrar igual»: el costo real no incluye ese material. Errores asociados: «Falta registrar el consumo de materiales según la ficha: …» y «Indicá el motivo para cerrar sin registrar todo el consumo de materiales.»
3. Al cerrar: se liberan las reservas que quedaban, se cierran los envíos a taller, se calcula el **costo real** y la orden queda Cerrada. Aviso «Orden cerrada. Se calculó el costo real.»
- Error si el estado no corresponde: «Solo se cierran órdenes en curso o terminadas.» (una orden solo Liberada, sin actividad, no se cierra: se cancela).
- Se puede cerrar una orden En curso con prendas pendientes; lo no ingresado simplemente no se produce.

### Cómo cancelar una orden
«Cancelar» → panel «Cancelar OP-…» con el impacto: se liberan las reservas; si hay materiales en talleres primero hay que registrar su devolución o faltante; lo ya consumido queda como costo de la orden cancelada. Completá «Motivo (obligatorio)» (mínimo 3 caracteres) → «Cancelar orden». Aviso «Orden cancelada.» Los envíos abiertos se cierran.

### Pestaña «Costos» (permiso `costs.view`)
Tabla con cada cálculo: «Estimado al liberar», «Real al cerrar» o «Consumido (orden cancelada)», con «Materiales», «Talleres», «Indirectos», «Total», «Unidades», «Costo unitario».
- **Costo estimado** (al liberar): materiales según ficha × costo promedio actual en el depósito de materiales (o último costo si no hay promedio), dividido por las prendas planificadas. No incluye taller.
- **Costo real** (al cerrar): materiales efectivamente consumidos (entregas a planta, consumos por ficha, consumos en taller y faltantes en taller, menos devoluciones, a su costo de salida) + tarifa del taller × prendas aprobadas y de segunda + indirectos por unidad si están configurados. Se divide por las unidades buenas (aprobadas + segunda): el descarte no suma unidades, así que su costo lo cargan las prendas buenas.
- Es un costo de gestión, no un resultado contable. Sin `costs.view` no se ven costos en ninguna parte de la orden.

---

## Liquidación de talleres

- **Ruta**: `/produccion/liquidaciones` (menú Producción → «Liquidación de talleres»). **Permiso**: `production.settle`.
- El taller cobra por prenda terminada según la tarifa del modelo vigente al momento de cada recepción. Se pagan las prendas **aprobadas y de segunda**; el descarte no se paga.

### Cómo liquidar un taller
1. Elegí el «Taller». Aparecen las «Recepciones sin liquidar» (número de ingreso, orden, modelo, fecha, «N prendas × tarifa», descartadas, importe).
2. Marcá las recepciones a liquidar.
3. Opcional: «Agregar descuento» (Concepto y $) por faltantes o fallas imputables al taller.
4. Si el taller emitió factura, dejá marcado «El taller emitió factura» y completá «Tipo» (FC, FB, FA), «Punto de venta», «Número», «IVA %» (0 monotributo, 21, 10,5). Si no, desmarcalo y queda como liquidación interna.
5. «Fecha» y «Vencimiento» (vacío: según la condición de pago del taller).
6. Revisá «Bruto − descuentos = neto (+ IVA)» y tocá «Registrar liquidación».
7. Aviso «Liquidación LT-… registrada por $X. Quedó en la cuenta corriente del taller.» Se crea el comprobante de compra y la deuda en Cuentas a pagar del taller; se paga desde Pagos. Las recepciones quedan marcadas «Liquidado».
- Errores: «Los descuentos superan el importe a liquidar.», «Alguna de las recepciones ya fue liquidada.», «Ese comprobante del taller ya está cargado.», «Hay recepciones de otro taller.», «Elegí al menos una recepción».
- Abajo: «Liquidaciones registradas» con número, taller, fecha, total y descuentos.

---

## Conexiones con stock, compras y costos

- **Stock de materiales**: liberar una orden **reserva** material en el depósito «Materiales desde» (baja el disponible, no el físico). Entregar a planta, consumir según ficha y el consumo en taller generan movimientos de consumo de producción; devolver genera reingreso; los envíos a taller son transferencias al depósito del taller. Todo se ve en el kardex del material (Stock).
- **Stock de producto terminado**: solo el ingreso con control de calidad suma stock (aprobadas al depósito de producto terminado, segunda al de segunda), valuado al costo estimado de la prenda.
- **Depósitos de taller**: el stock en poder de cada taller es un saldo más en su depósito virtual; se puede consultar en Stock.
- **Compras**: «Pedir faltantes a Compras» genera una solicitud de compra vinculada a la orden. Al registrar la recepción, el material queda disponible (libre) para entregar o «Consumir según ficha».
- **Cuentas a pagar**: la liquidación de talleres crea el comprobante y la deuda con el taller.
- **Costos**: el costo promedio de los materiales (que se actualiza con las recepciones de compra) alimenta el costo estimado de fichas y órdenes; el costo real se calcula al cerrar la orden.
- **Alertas y reportes**: el centro de Alertas avisa faltantes de materiales en órdenes liberadas/en curso y órdenes atrasadas.

## Preguntas frecuentes rápidas

- **«No me deja liberar la orden»** → falta ficha técnica activa del modelo, o la ficha no tiene material para algún color de la orden. No es necesario tener todo el stock: se puede liberar con faltantes.
- **«No veo el botón Liberar / Cerrar / Cancelar»** → necesitás `production.plan`; además Liberar solo aparece en Borrador, Cerrar en En curso/Terminada y Cancelar en Borrador/Liberada/En curso.
- **«No me deja recibir del taller»** → falta la tarifa del taller para ese modelo (Config. de producción → «Tarifas de talleres»), o estás recibiendo más de lo enviado y pendiente.
- **«No me deja cerrar»** → hay materiales en poder del taller (registrá devolución o faltante) o consumo pendiente según ficha (usá «Consumir según ficha» o cerrá con motivo).
- **«La orden no aparece en Mis tareas»** → la orden no está Liberada/En curso, todas sus etapas están cerradas, o la próxima etapa está asignada a un taller.
- **«No puedo cargar segunda»** → la orden se creó sin depósito de segunda selección.
- **«Cambié la ficha y la orden sigue con la anterior»** → es así a propósito: la orden congela la versión vigente al liberarse.
- **«No aparece el modelo al crear la orden»** → solo se listan modelos en estado Activo.
