# Despliegue en Vercel con base de datos en Supabase

La plataforma se despliega como **un solo proyecto de Vercel con dos servicios** (`vercel.json`):

| Servicio | Carpeta | Ruta pública | Qué es |
|---|---|---|---|
| `web` | `apps/web` | `/` (todo lo que no sea `/api`) | Next.js: las pantallas |
| `api` | `apps/api` | `/api/*` | NestJS: corre como función de Vercel |

El navegador llama a `/api` en el mismo dominio, así que las cookies de sesión funcionan sin CORS. No hay
llamadas internas entre servicios, por eso no hay *bindings*. De la API solo son públicas sin sesión
`GET /api/health`, `POST /api/auth/login` y `GET /api/cron/alerts` (este último exige el secreto
`CRON_SECRET`); todo lo demás exige usuario y permisos.

## 1. Supabase (una sola vez)

1. **Rol de la aplicación.** En *SQL Editor*, crear el rol que usa la API. Queda sujeto a RLS: cada
   consulta ve solo los datos de su empresa. Usá una contraseña larga **sin** caracteres especiales (o
   codificala en la URL).

   ```sql
   CREATE ROLE erp_app LOGIN PASSWORD 'una-contraseña-larga-y-aleatoria';
   ```

2. **Desactivar la Data API** (recomendado). En *Project Settings → Data API*, apagarla (o quitar
   `public` de los esquemas expuestos). El ERP no la usa. Además, la migración
   `20261110000000_supabase_hardening` les quita a los roles `anon` y `authenticated` todo acceso a las
   tablas, pero conviene no dejar la puerta abierta.

3. **Cadenas de conexión.** En *Connect* (botón arriba en el panel del proyecto) están las URLs del
   *pooler*. Reemplazá `[REF]`, `[REGION]` y las contraseñas:

   - **`DATABASE_URL`** (la usa la API en cada consulta). *Transaction pooler*, puerto **6543**, usuario
     **`erp_app.[REF]`**:

     ```
     postgresql://erp_app.[REF]:[PASS_ERP_APP]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
     ```

   - **`DATABASE_MIGRATION_URL`** (migraciones, con el usuario dueño). *Session pooler*, puerto **5432**,
     usuario **`postgres.[REF]`**:

     ```
     postgresql://postgres.[REF]:[PASS_POSTGRES]@aws-0-[REGION].pooler.supabase.com:5432/postgres
     ```

   `pgbouncer=true` es obligatorio en el puerto 6543 (Prisma deja de usar *prepared statements*).

   Usá el **Shared Pooler** (host `aws-0-[REGION].pooler.supabase.com`), no el *Dedicated Pooler* ni la
   conexión directa (host `db.[REF].supabase.co`): esos solo aceptan IPv6 salvo que contrates el add-on de
   IPv4, y Vercel se conecta por IPv4.

   Son **dos usuarios distintos con contraseñas distintas**: `[PASS_POSTGRES]` es la contraseña de la base
   que elegiste al crear el proyecto (la que Supabase muestra como `[YOUR-PASSWORD]`); `[PASS_ERP_APP]` es
   la que inventaste en el `CREATE ROLE` del paso 1.1.

## 2. Vercel

1. *Add New → Project*, importar el repositorio de GitHub. **Root Directory: la raíz del repositorio**
   (no `apps/web`). Vercel lee `vercel.json` y arma los dos servicios.
2. **Variables de entorno** (*Settings → Environment Variables*, para *Production*; también *Preview*
   si vas a usar despliegues de prueba):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | la del paso 1.3 (puerto 6543, `erp_app`) |
   | `DATABASE_MIGRATION_URL` | la del paso 1.3 (puerto 5432, `postgres`) |
   | `CRON_SECRET` | un texto aleatorio largo (Vercel lo envía en cada ejecución del cron) |
   | `GEMINI_API_KEY` | opcional: asistente con IA (sin ella, el asistente responde con la guía) |
   | `SMTP_URL`, `MAIL_FROM` | opcionales: correos de alertas (sin ellas no se envían correos) |
   | `SESSION_TTL_HOURS` | opcional (12 por defecto) |

   **No copies tal cual el `.env` local.** Estas variables locales no van o cambian en Vercel:

   - `DATABASE_URL`, `DATABASE_MIGRATION_URL`: apuntan a `localhost`, hay que reemplazarlas por las de Supabase.
   - `DATABASE_URL_TEST`, `DATABASE_MIGRATION_URL_TEST`: solo para pruebas locales, no van.
   - `API_PORT`, `API_INTERNAL_URL`: no van (Vercel asigna el puerto y rutea `/api`).
   - `WEB_ORIGIN`: no hace falta; se toma solo el dominio de producción de Vercel. Configurala únicamente si
     usás un dominio propio.
   - `COOKIE_SECURE`: no hace falta; en Vercel las cookies son siempre seguras (HTTPS).
   - `ALERTS_INTERVAL_MINUTES`: no hace falta; en Vercel las alertas las dispara el cron.
   - `LOGIN_RATE_LIMIT`: no la copies si en local la subiste para las pruebas (el valor normal es 20).
   - `SMTP_URL` local (Mailpit, `localhost:1025`): no sirve en Vercel. Usá un proveedor real o dejala vacía.

3. **Región de las funciones** (*Settings → Functions → Function Region*): elegí la más cercana a la
   región de Supabase (por ejemplo, São Paulo `gru1` si la base está en `sa-east-1`). Cada consulta va
   y vuelve a la base: la distancia se nota.
4. **Deploy.** En cada despliegue de **producción**, el build de la API aplica las migraciones pendientes
   (`prisma migrate deploy`) antes de compilar. Los despliegues de *Preview* no migran.

## 3. Datos iniciales

Después del primer despliegue la base tiene las tablas pero **ningún usuario ni empresa**: hay que
cargar los datos iniciales desde una computadora con el repositorio, apuntando a Supabase (ver la
sección correspondiente del README cuando esté definida la opción elegida).

## 4. Tareas programadas

`vercel.json` programa `GET /api/cron/alerts` todos los días a las 11:00 UTC (8:00 en Argentina): evalúa
las alertas de cada empresa y envía los correos pendientes. En el plan Hobby de Vercel los crons corren
como máximo una vez por día; en Pro se puede cambiar `schedule` (por ejemplo `*/15 * * * *`). Además,
cualquier usuario con permiso `alerts.manage` puede evaluar en el momento desde la pantalla de Alertas.

## Diferencias con el servidor propio

- **Límites en memoria.** Los límites de intentos de login y de consultas al asistente se guardan en la
  memoria de cada instancia. Vercel puede tener varias a la vez, así que son aproximados. Las sesiones
  están en la base y no se ven afectadas.
- **Duración máxima.** Cada pedido a la API puede durar hasta 300 s (`maxDuration`), lo que alcanza para
  reportes y para el asistente en *streaming*.
- **La API viaja en un solo archivo.** El empaquetado de Vercel no incluye las dependencias de un
  monorepo pnpm (la función fallaba con «Cannot find module»). Por eso el build corre
  `pnpm --filter @erp/api run bundle` (`apps/api/scripts/bundle.mjs`), que genera `apps/api/dist/vercel/`
  (Vercel publica `dist/` como función): `server.cjs` con toda la API, sus dependencias y la guía del
  asistente, y `natives.cjs` con los binarios de Prisma y argon2 comprimidos, que `src/main.ts` extrae a
  `/tmp` al arrancar. El paquete se usa solo en Vercel. Para probarlo en local, desde una carpeta sin
  `node_modules`: copiar `dist/main.js` y `dist/vercel/`, y ejecutar `API_BUNDLE=1 node main.js`.
  Si la API no arranca en Vercel, el log de la función muestra el error y los archivos que llegaron.
