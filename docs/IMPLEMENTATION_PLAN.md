# Plan de implementación y roadmap

## 1. Criterio de ordenamiento

Las fases del pedido original están casi bien, pero propongo un ajuste guiado por **dependencias técnicas** y por **riesgo de puesta en marcha**:

1. **El motor de stock va en la Fase 1, no en la 2.** Catálogo, compras, producción y ventas escriben movimientos. Si el motor no está sólido desde el principio, todo lo demás se rehace.
2. **Primero se pone en marcha la producción.** Es lo que el sistema actual no resuelve (hoy, según suponemos, se maneja en planillas) y es **aditivo**: puede funcionar sin que la empresa deje SISAGO, porque no toca la facturación. Da valor temprano con bajo riesgo.
3. **Ventas, cuentas corrientes y finanzas se lanzan juntas**, porque reemplazan al sistema actual y no conviene operar cobros en un sistema y facturas en otro. Requieren **facturación electrónica con ARCA probada**; ese es el camino crítico.

> ⚠️ Hay una tensión que confirmar: si la producción sale primero, el **stock de producto terminado** vive en el ERP nuevo mientras las ventas se descuentan en SISAGO. Opciones: (a) en la puesta en marcha 1 solo se gestionan materiales y producción, y el PT se "entrega" a SISAGO por remito interno; (b) se adelanta la venta con facturación todavía en SISAGO, con doble carga temporal. **Recomiendo (a).** Ver OPEN_QUESTIONS, pregunta T3.

## 2. Fases

| Fase | Contenido | Entregable demostrable | Tamaño estimado* |
|---|---|---|---|
| **0. Discovery** | Este paquete de documentos y entrevistas con los dueños | Documentos aprobados y preguntas respondidas | 1–2 semanas |
| **1. Base y núcleo de stock** ✅ *(implementada 28/10/2026, ver FASE1.md)* | Monorepo, CI, Docker, auth, sesiones, RBAC, auditoría, layout y navegación, Ctrl+K, configuración (empresa, sucursales, depósitos, unidades, talles, colores, categorías, numeración), terceros, **catálogo con matriz de variantes**, materiales, **motor de stock** (movimientos, saldos, reservas, transferencias, ajustes, kardex, conteos), importadores (terceros, productos, stock inicial), datos demo | Alta de la colección, conteo inicial importado, kardex auditable y tests de concurrencia en verde | 5–7 semanas |
| **2. Operación industrial** → *Puesta en marcha 1* ✅ *(implementada 28/10/2026, ver FASE2.md)* | Compras (solicitud, OC, recepción, comprobante de proveedor y CC de proveedores, básica), fichas técnicas versionadas, explosión de materiales y sugerencia de compras, OP, etapas y recorridos, avances desde el celular, talleres (envío, recepción y liquidación), QC, ingreso de PT, costo estimado y real (versión 1), tablero de producción, alertas in-app | Flujo A y Flujo D de punta a punta con datos reales del cliente | 7–9 semanas |
| **3. Comercial** ✅ *(implementada 29/10/2026, ver FASE3.md; ARCA en modo simulado hasta tener el certificado)* | Listas de precios, pedidos en grilla, crédito, reservas, preparación, remitos, facturas y NC/ND (registro interno), devoluciones, CC de clientes con imputaciones, estados de cuenta, **ARCA WSFE en homologación** | Flujo B completo en staging, comprobantes homologados | 6–8 semanas |
| **4. Finanzas** → *Puesta en marcha 2 (reemplazo de SISAGO)* 🟡 *(implementada salvo migración de SISAGO, extractos propios de cada banco y ARCA en producción, que dependen de información de los dueños; ver FASE4.md)* | Cajas y bancos, recibos, órdenes de pago, cheques propios y de terceros (y registro de ECHEQ), calendario y flujo proyectado, gastos y centros de costo, arqueos, importación de extractos y conciliación asistida, migración de saldos, cheques y pedidos abiertos, ARCA en producción, operación en paralelo | Flujo C y Flujo E, un mes en paralelo conciliado contra el sistema anterior | 6–8 semanas |
| **5. Gestión avanzada** 🟡 *(en curso: tablero de Dirección, rentabilidad, centro de reportes, alertas y promociones hechos, ver FASE5.md)* | Rentabilidad por producto, cliente y pedido, tablero de Dirección completo, centro de reportes, alertas por email, comisiones, promociones, padrón ARCA, Mercado Pago, etiquetas ZPL, manuales por rol | KPIs documentados y validados por los dueños | 4–6 semanas, continuo |

\* Orientativo, para 1 o 2 desarrolladores full stack con asistencia de IA. Se recalcula al cerrar la Fase 0 y después de cada fase.

## 3. MVP (definición propuesta)

**MVP = Fases 1 a 4.** Es el mínimo que permite dejar de usar el sistema anterior **sin pérdida de funcionalidad** y con el diferencial productivo.

Queda **fuera del MVP**, para no demorar la puesta en marcha:

- cotizaciones de proveedores;
- comisiones;
- promociones complejas;
- WhatsApp;
- Mercado Pago;
- APIs bancarias (se usa importación de archivos);
- contabilidad con asientos;
- multimoneda avanzada (se carga la cotización manual);
- tiempos estándar y productividad por operario;
- portal de clientes y talleres.

## 4. Fase 1 en detalle (para aprobar)

| # | Épica | Criterio de "terminado" |
|---|---|---|
| 1.1 | Monorepo, Turborepo, Docker Compose (PostgreSQL y MinIO), lint (incluida la regla anti-`number` en dinero), CI con tests | `pnpm dev` levanta todo; el CI corre en cada PR |
| 1.2 | Prisma schema de plataforma, terceros, catálogo y stock; RLS y triggers *append-only* | Las migraciones se aplican en limpio; hay un test de aislamiento entre empresas |
| 1.3 | Auth (login, sesiones, cierre remoto, política de contraseñas, rate limit) y 2FA | E2E de login; tests de sesión revocada |
| 1.4 | RBAC: permisos, roles predefinidos, alcances, guard de backend y helpers `can()` en la UI | Matriz de tests de permisos por endpoint |
| 1.5 | Auditoría, numeración, adjuntos, idempotencia y outbox | Tests unitarios y de integración |
| 1.6 | Layout, sidebar, Ctrl+K, DataTable (filtros, columnas, vistas guardadas), formularios base y `VariantGrid` | Revisión de UX con el cliente sobre staging |
| 1.7 | Configuración: empresa, sucursales, depósitos, ubicaciones, unidades y conversiones, escalas de talles, colores, categorías y temporadas | CRUD completo con validaciones y auditoría |
| 1.8 | Clientes, proveedores y talleres (`parties`) | Importador CSV con detección de duplicados por CUIT |
| 1.9 | Modelos y variantes (generación, matriz, códigos de barras) y materiales | Alta del "Body manga larga" con 20 SKU en menos de 1 minuto |
| 1.10 | Motor de stock: movimientos, saldos, reservas, transferencias, ajustes con aprobación, conteo y kardex | Tests de concurrencia (último artículo) y reconciliación en verde |
| 1.11 | Importación de stock inicial y datos demo | Seed demo reproducible con usuarios por rol |

## 5. Estrategia de migración y puesta en marcha

1. **Relevamiento de exportaciones:** qué permite exportar SISAGO (Excel o CSV de clientes, proveedores, productos, stock, saldos y cheques). **No se asume acceso a su base de datos.**
2. **Plantillas de importación** propias, una por entidad, con validación, vista previa de errores, detección de duplicados (CUIT, SKU, número de cheque) y **conciliación de totales** (la suma de saldos importados tiene que coincidir con el total del reporte de origen).
3. **Fecha de corte:** se fija un día de cierre. Se importan los saldos iniciales por comprobante abierto (recomendado) o como saldo único por tercero, los cheques en cartera, los pedidos abiertos y el stock contado físicamente.
4. **Paralelo:** de 2 a 4 semanas cargando en ambos sistemas las operaciones clave (o al menos los cobros, pagos y facturas), con conciliación semanal de saldos.
5. **Reversión:** mientras dure el paralelo, el sistema anterior sigue siendo el oficial. El criterio de *go / no-go* está escrito: conciliación sin diferencias durante 2 semanas, CAE funcionando y usuarios capacitados.
6. **Puesta en marcha por módulo y por rol**, empezando por Producción y Depósito (puesta en marcha 1) y siguiendo con Administración, Ventas y Tesorería (puesta en marcha 2).

## 6. Riesgos

| # | Riesgo | Tipo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|---|
| R1 | Procesos reales distintos a las hipótesis (por ejemplo, no hay talleres, o se corta por tizada y no por prenda) | Funcional | Alta | Alto | Fase 0 con entrevistas y observación en planta; configuración por funcionalidad |
| R2 | Homologación de ARCA más lenta de lo previsto (certificados, puntos de venta, comprobantes A/B, percepciones) | Técnico/fiscal | Media | Alto | Empezar la homologación en la Fase 3; seguir facturando en SISAGO hasta validar; asesoría del contador |
| R3 | Calidad de los datos exportables del sistema anterior | Migración | Alta | Medio | Importadores con validación y limpieza asistida; conteo físico de stock en lugar de importarlo |
| R4 | Consumo de tela por prenda poco conocido o variable (tizada, ancho, encogimiento) | Funcional | Alta | Medio | Consumos por talle con % de merma y registro de consumo real para recalibrar; reporte de desvío |
| R5 | Resistencia al cambio o baja adopción en planta | Organizacional | Media | Alto | UX para celular, capacitación por rol, puesta en marcha gradual, referentes internos |
| R6 | Errores de concurrencia o saldo (stock, cheques, imputaciones) | Técnico | Media | Crítico | Movimientos como fuente de verdad, bloqueos, idempotencia, tests de concurrencia y reconciliación nocturna |
| R7 | Alcance excesivo (16 módulos) | Proyecto | Alta | Alto | MVP explícito, fases con entregables reales y backlog priorizado con los dueños |
| R8 | Confundir margen estimado con resultado contable | Funcional | Media | Medio | Etiquetado obligatorio, definiciones de KPI y validación con el contador |
| R9 | Seguridad de datos financieros y personales | Técnico | Media | Alto | RBAC, cifrado de CBU y certificados, 2FA, auditoría, backups probados |
| R10 | Dependencia de una sola persona desarrolladora | Proyecto | Media | Alto | Documentación, ADRs, tests y código convencional |
| R11 | ECHEQ sin integración automática | Técnico | Cierta | Bajo | Registro manual con validación de duplicados; integración solo si el banco la provee |
| R12 | Valuación de inventario y costos no alineada con el criterio del contador | Funcional | Media | Medio | Confirmar el método (promedio ponderado) antes de la Fase 2 |
