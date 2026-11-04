# Registro de decisiones de arquitectura (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| 001 | Monolito modular: NestJS (API y dominio) + Next.js (interfaz) en monorepo pnpm/Turborepo | Aceptada (28/10/2026) |
| 002 | PostgreSQL + Prisma; SQL explícito para bloqueos (`FOR UPDATE`) y restricciones avanzadas en migraciones manuales | Aceptada |
| 003 | Movimientos *append-only* como fuente de verdad; saldos proyectados en la misma transacción y reconciliables | Aceptada |
| 004 | Multiempresa por columna `company_id` + Row-Level Security; la app usa el rol `erp_app` sin privilegios de superusuario | Aceptada |
| 005 | Colas con pg-boss sobre PostgreSQL (sin Redis inicial) | Aceptada; se implementa en la Fase 2 |
| 006 | Decimales `NUMERIC` + `decimal.js`; importes viajan como string; prohibido `float` en dinero | Aceptada |
| 007 | Valuación de inventario por costo promedio ponderado por depósito | Provisoria: confirmar con el contador |
| 008 | Idempotencia: la `Idempotency-Key` se registra dentro de la transacción del caso de uso (la PK serializa los reintentos concurrentes) | Aceptada |
| 009 | Talleres externos modelados como depósitos virtuales (`type = WORKSHOP`) | Aceptada |
| 010 | Sesiones en base de datos con cookie httpOnly + CSRF de doble envío; el front accede a la API por proxy de mismo origen | Aceptada |

| 011 | Saldos con fila cabecera por artículo y depósito (reservas y bloqueo) más filas por lote; salidas sin lote en FIFO | Aceptada (Fase 2) |
| 012 | Fecha de negocio en la zona `America/Argentina/Buenos_Aires` para vencimientos y atrasos | Aceptada (Fase 2) |
| 013 | Costo de ingreso de producción = estimado; costo real por orden al cierre, sin revaluar stock | Provisoria: revisar en la Fase 5 |
| 014 | Imputaciones de cuenta corriente append-only (la reversa es otra fila); `open_amount` es la proyección | Aceptada (Fase 3) |
| 015 | Comprobante de venta en dos pasos (pendiente de CAE → autorizado o rechazado) con numeración serializada por punto de venta y tipo | Aceptada (Fase 3) |
| 016 | Comisiones devengadas por imputación de cobros, con reversa negativa (regla del cliente: sobre lo cobrado) | Aceptada (Fase 3) |
| 017 | Proveedor de ARCA intercambiable: modo simulado para desarrollo; homologación y producción bloqueadas hasta probarlas con certificado real | Aceptada (Fase 3) |

El contexto y las alternativas de cada decisión están en [ARCHITECTURE.md](../ARCHITECTURE.md).
