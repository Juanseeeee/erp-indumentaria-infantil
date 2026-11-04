# ERP Indumentaria Infantil

ERP web para una PyME argentina que fabrica y comercializa ropa para bebés.

**Estado:** Fases 1 (base y stock), 2 (compras, producción, talleres) y 3 (ventas, facturación, cobros y comisiones) implementadas. La facturación electrónica está en **modo simulado** (sin validez fiscal) hasta homologar con ARCA. Fase 4 (finanzas) implementada salvo lo que depende de los dueños (migración de SISAGO, extractos propios de cada banco y ARCA en producción). Fase 5 en curso: tablero de Dirección, rentabilidad (margen bruto estimado), centro de reportes con Excel y PDF, alertas con aviso por correo y promociones. Detalle y demo en [docs/FASE1.md](docs/FASE1.md), [docs/FASE2.md](docs/FASE2.md), [docs/FASE3.md](docs/FASE3.md), [docs/FASE4.md](docs/FASE4.md) y [docs/FASE5.md](docs/FASE5.md); definiciones de indicadores en [docs/METRICS.md](docs/METRICS.md).

## Stack

Monorepo pnpm + Turborepo · **API** NestJS 11 + Prisma 6 + PostgreSQL 16 (RLS multiempresa) · **Web** Next.js 15 (App Router) + TanStack Query/Table + React Hook Form + Zod + Tailwind 4 · **Tests** Vitest (dominio e integración contra PostgreSQL real) + Playwright (E2E).

```
apps/api        NestJS: dominio, API REST, autorización, auditoría
apps/web        Next.js: interfaz (proxy /api → API, mismo origen)
packages/contracts     esquemas Zod + catálogo de permisos (compartidos front/back)
packages/domain-core   decimales exactos, unidades, SKU/EAN-13, errores de dominio
packages/domain-stock  reglas de stock: costo promedio, reservas, signos
packages/domain-production  explosión de fichas técnicas, costo estimado y real, estados de OP
packages/domain-sales  letra de comprobante, precios, crédito, imputación, comisiones, pedido de CAE (WSFEv1)
packages/domain-finance  cheques, medios de cobro, arqueo, extractos y conciliación, flujo proyectado
e2e/            Playwright
docs/           visión, requisitos, arquitectura, modelo de datos, plan, ADRs
```

## Puesta en marcha (desarrollo)

Requisitos: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env && cp .env apps/api/.env
docker compose up -d postgres mailpit    # PostgreSQL en :5433 (crea erp, erp_test y el rol erp_app) y buzón de prueba
pnpm --filter "./packages/*" build
cd apps/api && npx prisma migrate deploy && npx prisma generate && cd ../..
pnpm db:seed                              # datos demo ficticios (NO usar en producción)
pnpm --filter @erp/api dev                # API en http://localhost:4000/api
pnpm --filter @erp/web dev                # Web en http://localhost:3000
```

Los correos del sistema (alertas) llegan a **Mailpit**, un buzón de prueba que no envía nada afuera: http://localhost:8025. Sin `SMTP_URL` no se envían correos (quedan en espera).

Si el volumen de PostgreSQL ya existía antes de esta versión, habilitar el login del rol de aplicación:
`docker compose exec -T postgres psql -U erp -d erp < infra/postgres/dev-roles.sql`

### Usuarios demo (contraseña `Demo2026erp`)

| Email | Rol |
|---|---|
| admin@ositos.demo | Superadministrador |
| direccion@ositos.demo | Propietario / Dirección |
| administracion@ositos.demo | Administración |
| compras@ositos.demo | Compras |
| produccion@ositos.demo | Producción |
| operario@ositos.demo | Operario de planta (vista celular) |
| deposito@ositos.demo | Depósito |
| ventas@ositos.demo | Ventas |
| tesoreria@ositos.demo | Tesorería |
| contabilidad@ositos.demo | Contabilidad |
| auditor@ositos.demo | Auditor / Consulta |

## Tests

```bash
pnpm --filter "./packages/domain-*" test   # unitarios de dominio
pnpm --filter @erp/api test                # integración contra erp_test (aplica migraciones solo); las alertas usan Mailpit
pnpm --filter @erp/e2e test                # E2E: requiere API (con LOGIN_RATE_LIMIT=200) + web levantadas con el seed demo
```

## Reglas de trabajo con la base

- La app se conecta como `erp_app` (sujeto a RLS). Migraciones y seed usan el rol propietario (`DATABASE_MIGRATION_URL`).
- Hay restricciones que Prisma no modela (RLS, CHECKs, triggers *append-only*, índices `NULLS NOT DISTINCT` y GIN). Por eso **siempre** crear migraciones con `prisma migrate dev --create-only` y revisar el SQL: Prisma puede proponer borrar esos índices.
- Stock, auditoría y (en próximas fases) cuentas corrientes y tesorería **no se editan**: se corrigen con movimientos de reversa.

## Documentación

| Documento | Contenido |
|---|---|
| [PRODUCT_VISION](docs/PRODUCT_VISION.md) | Problema, propuesta, usuarios, principios |
| [FUNCTIONAL_REQUIREMENTS](docs/FUNCTIONAL_REQUIREMENTS.md) | Mapa de módulos y requisitos con ID |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Stack, dependencias, integridad, seguridad, infraestructura |
| [DATABASE_DESIGN](docs/DATABASE_DESIGN.md) | Modelo de datos |
| [USER_FLOWS](docs/USER_FLOWS.md) | Navegación, UX, recorridos por rol, flujos A–E |
| [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) | Fases, MVP, migración, riesgos |
| [TEST_STRATEGY](docs/TEST_STRATEGY.md) | Pirámide de tests, invariantes, casos obligatorios |
| [OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md) | Preguntas para los dueños |
| [FASE1](docs/FASE1.md) | Qué incluye la Fase 1, cómo demostrarla, pendientes |
| [FASE2](docs/FASE2.md) | Compras, producción y talleres: alcance, supuestos, limitaciones |
| [FASE3](docs/FASE3.md) | Ventas, facturación (ARCA simulado), cobros, cuentas a cobrar y comisiones |
| [FASE4](docs/FASE4.md) | Finanzas: tesorería, cheques, órdenes de pago con aprobación, transferencias, arqueos, gastos y recurrentes, conciliación, flujo de fondos, cierre de período |
| [FASE5](docs/FASE5.md) | Gestión avanzada (en curso): tablero de Dirección |
| [METRICS](docs/METRICS.md) | Definición y fórmula de cada indicador |
| [adr/](docs/adr/) | Registro de decisiones de arquitectura |
