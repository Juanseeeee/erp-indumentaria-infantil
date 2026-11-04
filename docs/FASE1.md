# Fase 1: base del sistema y núcleo de stock

Estado al 28/10/2026: **implementada y probada en entorno local**. Pendiente de revisión con los dueños.

## Qué incluye

| Área | Funcionalidad | Requisitos |
|---|---|---|
| Plataforma | Login con sesión en cookie httpOnly, CSRF de doble envío, bloqueo tras 5 intentos fallidos, rate limit de login, cierre remoto de sesiones | RF-PLT-01 |
| | RBAC con 10 roles iniciales, roles personalizados y matriz de permisos editable; validación siempre en backend; permisos de dato sensible (`costs.view`, `parties.credit.view`) | RF-PLT-03 |
| | Multiempresa con aislamiento por Row-Level Security en PostgreSQL | ADR-004 |
| | Auditoría *append-only* de toda operación crítica, consultable | RF-PLT-05 |
| | Numeración de documentos con bloqueo de fila; idempotencia de POST (`Idempotency-Key`) dentro de la transacción | RF-PLT-06 |
| | Reglas de aprobación configurables (ajustes de stock sobre un umbral) con segregación de funciones | RF-PLT-07 |
| | Buscador global y paleta de acciones (Ctrl+K); atajos `G`+tecla y `/` | RF-PLT-09 |
| Configuración | Empresa, depósitos, escalas de talles, colores, categorías, temporadas y colecciones, unidades y conversiones, condiciones de pago y zonas | RF-PLT-11 |
| Terceros | Clientes, proveedores y talleres en una sola ficha con roles; CUIT validado por dígito verificador y sin duplicados; condiciones comerciales protegidas por permiso; bloqueo optimista; cada taller recibe un depósito virtual | RF-VEN-01 |
| Catálogo | Modelos con generación automática de variantes talle × color, SKU por patrón y EAN-13 interno; matriz con disponible, físico, reservado, SKU y código; alta de colores; activar o desactivar variantes; mínimos por variante en grilla (acepta pegar desde Excel) | RF-CAT-01/02/03/05 |
| Materiales | Telas, avíos, hilos y packaging; unidad de stock y de compra; datos de tela; control por lote o partida | RF-MAT-01/02/03 |
| Inventario | Motor de stock con movimientos *append-only* como fuente de verdad; saldos proyectados en la misma transacción; costo promedio ponderado; reservas; stock inicial, ajustes y transferencias; anulación por reversa; kardex con documento origen y usuario; inventario físico con lector de códigos; stock crítico; valorización visible solo con permiso | RF-INV-01…08 |
| Inicio | Tablero con indicadores reales de catálogo e inventario (sin datos inventados) | Módulo 1 (parcial) |
| Demo | Seed de "Ositos Algodón SRL" (ficticia): 8 modelos, 111 variantes con stock, 14 materiales, 6 clientes, 4 proveedores, 2 talleres, un usuario por rol | §12 |

## Pruebas automatizadas (todas en verde)

- **22 unitarias de dominio:** decimales exactos (0,1 + 0,2; prorrateo sin perder centavos; IVA 10,5 %), conversiones de unidades, SKU y EAN-13, costo promedio, stock negativo, reservas.
- **41 de integración contra PostgreSQL real:** autenticación y bloqueo, CSRF, permisos por rol, aislamiento entre empresas (RLS), dos vendedores sobre la última unidad, 20 reservas sobre 10 unidades, transferencias cruzadas sin interbloqueo, numeración concurrente, idempotencia secuencial y concurrente, aprobación de ajustes, reversa por anulación, triggers *append-only*, lotes, inventario físico, bloqueo optimista. Al terminar cada suite se verifica la invariante **saldo = Σ movimientos**.
- **9 E2E con Playwright** (escritorio y celular): login, tablero, alta de modelo, matriz, ajuste y kardex, restricciones del rol Ventas, Ctrl+K, validación de CUIT y menú en celular.

## Cómo demostrarla (10 minutos)

1. Ingresar como `direccion@ositos.demo` y revisar el tablero: stock crítico y valorización etiquetada como estimada.
2. Catálogo → *Body manga larga*: matriz de disponible por talle y color; pestañas SKU y código de barras.
3. Crear un modelo nuevo con 5 talles × 4 colores y ver las 20 variantes generadas.
4. Ingresar como `deposito@ositos.demo` y registrar un ajuste de −40 m de interlock blanco (≈ $ 194.000): queda **pendiente de aprobación** por superar el umbral de $ 150.000.
5. Ingresar como `direccion@ositos.demo` y aprobarlo; ver el kardex con documento y usuario.
6. Anular el ajuste y ver los movimientos de reversa: el stock vuelve, nada se borra.
7. Ingresar como `ventas@ositos.demo`: no ve configuración, ni costos, ni puede ajustar stock (y la API lo rechaza aunque se llame directo).
8. Configuración → Auditoría: todo lo anterior queda registrado.

## Fuera de la Fase 1 (a propósito)

- Importadores CSV y Excel: se hacen junto con la migración real, cuando tengamos una muestra de las exportaciones de SISAGO (pregunta H44).
- Adjuntos de archivos (MinIO ya está en el `docker-compose`): llegan con fichas técnicas y comprobantes.
- 2FA TOTP, documentación OpenAPI generada y outbox de eventos: a principios de la Fase 2.
- El rate limit de login vive en memoria: hay que moverlo a PostgreSQL antes de correr más de una instancia de la API.

## Decisiones tomadas en la Fase 1 (revisables)

- **Valuación:** costo promedio ponderado por depósito (ADR-007, a confirmar con el contador).
- **Inventario físico:** ajusta la diferencia entre lo contado y la foto tomada al abrir el conteo. Supone que el depósito no tiene movimientos durante el conteo.
- **SKU:** patrón `{MODELO}-{COLOR}-{TALLE}`, configurable por empresa (`catalog.skuPattern`). El SKU no cambia si se renombra el modelo.
- **Reservas:** por artículo y depósito, todavía no por lote. Las usarán pedidos (Fase 3) y órdenes de producción (Fase 2).
