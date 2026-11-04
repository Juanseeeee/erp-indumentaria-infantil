# Arquitectura técnica

> Estado: **propuesta Fase 0**. Las decisiones marcadas como ADR quedan registradas en `docs/adr/` una vez aprobadas.

## 1. Resumen de la decisión

**Monolito modular** dentro de un monorepo TypeScript, con:

- `apps/web`: **Next.js (App Router)**, solo como interfaz y BFF liviano (sesión y proxy).
- `apps/api`: **NestJS**, que concentra toda la lógica de dominio, la API REST documentada con OpenAPI y la autorización.
- `apps/worker`: el mismo código de dominio que la API, corriendo en un proceso separado para trabajos asíncronos (alertas, reportes pesados, importaciones, ARCA, conciliaciones).
- `packages/contracts`: esquemas **Zod** compartidos. Son el contrato de la API: se usan para validar en el front, en el back y para generar OpenAPI.
- `packages/domain-*`: reglas puras (cálculos de dinero, conversiones de unidades, máquinas de estado de cheques y órdenes) sin dependencias de infraestructura. Es lo más testeado.
- **PostgreSQL 16** como única base de datos y **Prisma** como ORM, con SQL explícito en las operaciones críticas.
- **pg-boss** para colas sobre PostgreSQL. No hace falta Redis en la primera etapa.

Todo se despliega como **una imagen Docker** con dos comandos de arranque (`api`, `worker`) más la app web. Se evitan los microservicios a propósito.

## 2. ¿Next.js monolítico o NestJS separado?

| Criterio | Solo Next.js (Server Actions y Route Handlers) | **Next.js + NestJS (elegido)** |
|---|---|---|
| Velocidad inicial | Más rápido para arrancar | Un poco más de estructura al principio |
| Transacciones largas y bloqueos | Posibles, pero mezclados con código de UI y con riesgo de lógica en componentes | Servicios de dominio claros con una unidad de trabajo por caso de uso |
| API REST documentada para integraciones, app móvil o SaaS | Hay que construirla aparte | OpenAPI nativo |
| Procesos persistentes (worker, cron, colas) | Next no está pensado para eso; requiere otro proceso igual | El worker reutiliza los módulos de Nest |
| Límites entre módulos | Por convención | Módulos de Nest con dependencias explícitas y verificadas con lint (dependency-cruiser) |
| Hosting | Tienta a Vercel o serverless, que choca con transacciones largas y conexiones a PostgreSQL | Contenedores persistentes (Railway, Render, Fly, una VPS con Docker) |

**Justificación:** en un ERP el riesgo principal es la **integridad transaccional** (stock, saldos, cheques), no la velocidad de la UI. Separar el dominio en NestJS evita que las reglas terminen repartidas en Server Actions. También deja una API reutilizable para integraciones, lectores y una futura app móvil para operarios. El costo extra son un deploy más y un cliente HTTP tipado, que se mitiga con los contratos Zod compartidos.

*Alternativa válida si se prioriza velocidad sobre todo:* Next.js con la capa de dominio en `packages/` y un worker separado. Se puede migrar a Nest más adelante sin reescribir el dominio. **Se pide confirmación** (ver OPEN_QUESTIONS, sección T).

## 3. Diagrama lógico

```
 Navegador (escritorio / tablet / celular de planta)
        │  HTTPS, cookie httpOnly de sesión
        ▼
 ┌──────────────┐    REST/JSON (contracts Zod)   ┌──────────────────────────────┐
 │  apps/web    │ ─────────────────────────────▶ │  apps/api  (NestJS)          │
 │  Next.js     │                                │  ├ auth / rbac / auditoría   │
 │  TanStack Q. │ ◀───────────────────────────── │  ├ módulos de dominio        │
 └──────────────┘                                │  └ outbox de eventos         │
                                                 └──────────┬───────────────────┘
                                                            │ Prisma + SQL
                     ┌─────────────────────┐                ▼
                     │ apps/worker         │◀──── pg-boss ── PostgreSQL 16 (RLS por company_id)
                     │ alertas, reportes,  │
                     │ importaciones, ARCA │──▶ Almacenamiento S3-compatible (adjuntos, PDF)
                     └─────────────────────┘──▶ Servicios externos (ARCA, bancos, Mercado Pago, mail)
```

## 4. Organización del código

```
apps/
  web/          Next.js: app/(auth), app/(erp)/[modulo]/..., componentes, hooks de query
  api/          NestJS: src/modules/<modulo>/{controller,service,repository,dto}
  worker/       entrypoint de jobs (importa módulos de api)
packages/
  contracts/    esquemas Zod por módulo (request/response) + tipos inferidos
  domain-core/  Money, Quantity, UnitConversion, DocumentNumber, errores de dominio
  domain-stock/ reglas de movimientos, reservas, valorización
  domain-finance/ imputaciones, máquinas de estado de cheques, conciliación
  ui/           componentes shadcn/ui propios (DataTable, VariantGrid, MoneyInput…)
  config/       eslint, tsconfig, tailwind preset
prisma/         schema.prisma, migrations/, seed/ (demo)
e2e/            Playwright
docs/
```

Herramientas: **pnpm workspaces y Turborepo**, Vitest para tests unitarios y de integración, Playwright para E2E y Testcontainers para levantar PostgreSQL real en los tests de integración.

## 5. Módulos de backend y dependencias

```
platform  (tenancy, auth, users, rbac, audit, numbering, attachments, notifications, settings)
   ▲
master-data (parties: clientes/proveedores/talleres, catálogo, materiales, unidades, depósitos)
   ▲
inventory (movimientos, saldos, reservas, lotes, conteos)          pricing (listas, reglas)
   ▲            ▲                                                     ▲
purchasing   production (fichas, OP, etapas, talleres, QC)         sales (presupuesto, pedido, remito, factura)
   │            │                                                     │
   └────────────┴──────────────► accounts (cuentas corrientes, imputaciones) ◄┘
                                    ▲
                               treasury (cajas, bancos, cobros, pagos, cheques, conciliación)
                                    ▲
                     costing & analytics (costos reales, rentabilidad, reportes, dashboards)
```

Reglas:

- Un módulo solo llama a la **interfaz pública** (servicio exportado) de los módulos que están debajo. Nunca toca sus tablas directamente.
- Los efectos laterales entre módulos que no tienen que ser atómicos, como una alerta, la actualización de una proyección o un mail, viajan por **eventos de dominio** usando un *outbox* transaccional. El evento se guarda en la misma transacción y el worker lo despacha.
- Lo que **sí** tiene que ser atómico se resuelve dentro de la **misma transacción**, orquestado por el caso de uso. Ejemplo: emitir un remito descuenta el stock y libera la reserva en la misma transacción.

## 6. Integridad de datos y concurrencia

| Problema | Solución |
|---|---|
| Dinero y cantidades | `NUMERIC(18,2)` para importes, `NUMERIC(18,4)` para cantidades y `NUMERIC(18,6)` para costos unitarios y tipos de cambio. En TypeScript se usa `decimal.js` dentro de los value objects `Money` y `Quantity`. **Prohibido** usar `number` en lógica de dinero (regla de lint). |
| Saldos de stock | La tabla `stock_movements` es *append-only* y es la fuente de verdad. `stock_balances` es una proyección que se actualiza **en la misma transacción** con `SELECT … FOR UPDATE` sobre la fila del saldo. Un job nocturno reconcilia proyección contra movimientos y alerta si hay diferencias. |
| Último artículo con dos vendedores | La reserva bloquea la fila `stock_balances` y valida `disponible = físico − reservado ≥ pedido`. El segundo vendedor recibe un error de negocio claro y ofrece alternativas (otro depósito, en producción, backorder). |
| Doble envío o reintentos | Header `Idempotency-Key` obligatorio en los POST que crean documentos. Una tabla `idempotency_keys` guarda la respuesta. Además, hay restricciones únicas de negocio, por ejemplo proveedor + tipo + punto de venta + número de su factura. |
| Edición concurrente de un documento | Bloqueo optimista con columna `version`. Si cambió, se devuelve 409 y la UI ofrece recargar. |
| Numeración de comprobantes | Tabla `document_sequences` con `FOR UPDATE`. Sin huecos para comprobantes fiscales y con huecos permitidos para documentos internos. |
| Stock negativo | `CHECK` a nivel base de datos sobre el saldo, salvo en depósitos o artículos con flag `allow_negative`. Ese flag requiere un permiso específico y queda auditado. |
| Operación interrumpida | Cada caso de uso corre en **una transacción** con aislamiento `READ COMMITTED` más bloqueos explícitos, o en `SERIALIZABLE` con reintento automático en conflictos de imputación. Las integraciones externas como ARCA se hacen **fuera** de la transacción con un patrón de estados (`PENDIENTE_CAE → AUTORIZADA / RECHAZADA`) y reintentos idempotentes. |
| Aislamiento multiempresa | `company_id` en todas las tablas de negocio, Row-Level Security de PostgreSQL con `SET app.company_id` por request y tests automáticos que intentan leer datos de otra empresa. |

## 7. Seguridad

- **Autenticación:** sesiones en base de datos, con cookie `httpOnly`, `Secure` y `SameSite=Lax`, rotación de ID y cierre remoto de sesiones. Contraseñas con argon2id y política configurable. 2FA TOTP opcional, que se recomienda obligatoria para Dirección y Tesorería.
- **CSRF:** token de doble envío en las mutaciones, además de `SameSite` y la verificación de `Origin`.
- **Autorización:** RBAC con permisos `modulo.recurso.accion` (por ejemplo `treasury.payment.approve`), más **alcances** (solo sus clientes, solo su depósito) y **permisos de campo sensible** (`costs.view`, `margins.view`, `bank_accounts.view`). Se valida en un guard de Nest y en el servicio; la UI solo oculta.
- **Aprobaciones:** reglas configurables del tipo "pagos mayores a X requieren `treasury.payment.approve`" y "ajustes de stock mayores a Y requieren aprobación".
- **Auditoría:** tabla `audit_log` *append-only* con quién, cuándo, IP, entidad, acción y diff en JSON. La escribe el mismo servicio dentro de la transacción.
- **Secretos:** variables de entorno con un gestor de secretos del hosting. El certificado de ARCA y los CBU se cifran en reposo (cifrado de aplicación con clave maestra en KMS o variable segura).
- **Rate limiting** en login y API, **cabeceras de seguridad** (CSP, HSTS) y validación Zod de toda entrada. Prisma y SQL parametrizado previenen las inyecciones.
- **Adjuntos:** bucket privado con URLs firmadas de vida corta, verificación de tipo MIME y tamaño, y antivirus (ClamAV en el worker) en una fase posterior.

## 8. Infraestructura y operación

- **Desarrollo:** `docker compose` con PostgreSQL, MinIO (S3 local) y Mailpit.
- **Entornos:** `dev` (local), `staging` (datos demo y homologación de ARCA) y `production`.
- **CI/CD (GitHub Actions):** lint, chequeo de tipos, tests unitarios, tests de integración con PostgreSQL, E2E sobre staging, build de imagen y migración con `prisma migrate deploy` antes del deploy.
- **Hosting sugerido:** un proveedor de contenedores persistentes (Railway, Render o Fly.io) o una VPS con Docker, con PostgreSQL gestionado y backups con PITR. Vercel no conviene para la API.
- **Backups:** PITR del proveedor más un `pg_dump` diario cifrado a otro proveedor. Hay una **prueba de restauración mensual** automatizada que levanta el dump y corre la reconciliación.
- **Observabilidad:** logs JSON con pino y `request_id`, tracing con OpenTelemetry, errores en Sentry, métricas de jobs y un *health check*.

## 9. Integraciones (preparadas, no asumidas)

| Integración | Mecanismo realista | Estado |
|---|---|---|
| ARCA: factura electrónica | Web services WSAA (autenticación con certificado) y WSFEv1 (comprobantes A/B/C, NC y ND), primero en homologación | Se investiga en la Fase 4. **No se afirma cumplimiento** hasta probarlo con CUIT y certificado reales |
| ARCA: padrón | Servicio de consulta de padrón (constancia de inscripción) para autocompletar los datos de clientes y proveedores | Opcional |
| Bancos | Importación de extractos (CSV, Excel, formatos propios de cada banco) y conciliación asistida. Las APIs bancarias solo si el banco las ofrece a la empresa | Fase 4 |
| ECHEQ | **Sin API pública.** Se registran manualmente los ECHEQ, con su ID y CUIT del emisor, con el mismo ciclo de vida que el cheque físico. La integración, solo vía banco o proveedor autorizado | Registro manual en el MVP |
| Mercado Pago | API de pagos y movimientos para conciliar cobros | Posterior |
| Lectores de código de barras | Funcionan como teclado (HID). La UI tiene campos "escaneables" que no requieren integración | MVP |
| Etiquetas | Generación de ZPL (Zebra) o PDF por variante | Fase 2 o 3 |
| Excel y PDF | ExcelJS para exportar e importar. PDF de comprobantes con plantillas HTML renderizadas por Playwright o Chromium en el worker | MVP |
| Email y WhatsApp | Abstracción `NotificationChannel`: email en el MVP, WhatsApp Business API más adelante | Preparado |

## 10. ADRs iniciales (a confirmar)

1. ADR-001: Monolito modular NestJS + Next.js en monorepo.
2. ADR-002: PostgreSQL + Prisma, con SQL explícito para bloqueos y restricciones avanzadas.
3. ADR-003: Movimientos *append-only* como fuente de verdad y saldos como proyecciones transaccionales reconciliables.
4. ADR-004: Multiempresa por columna con RLS.
5. ADR-005: Colas con pg-boss sobre PostgreSQL, sin Redis inicial.
6. ADR-006: Decimales con `NUMERIC` y `decimal.js`; prohibido `float` en dinero.
7. ADR-007: Valuación de inventario por **costo promedio ponderado** (a confirmar con el contador).
