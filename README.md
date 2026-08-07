# Equipos y Turnos de Servicio

Aplicación web para organizar personas en equipos mensuales balanceados (líder + apoyo +
colaboradores) y rotarlos entre turnos fijos de servicio y eventos extraordinarios,
manteniendo el balance de participaciones entre equipos. Incluye una página pública sin
login para consultar la organización del mes.

Las reglas de negocio completas (cómo se sortean líderes, la excepción del último domingo,
el evento del último sábado, uniformes, etc.) están documentadas en [`CLAUDE.md`](./CLAUDE.md).
El diseño del esquema de datos de esta fase está en
[`docs/architecture/phase1-schema-design.md`](./docs/architecture/phase1-schema-design.md).

Stack: Node.js + Express + Prisma + PostgreSQL en `/server`; Vite + React (SPA) en `/client`.

## Estado actual del proyecto (importante, léelo antes de asumir nada)

Esto es **Fase 1** (scaffolding base) del plan. Lo que existe hoy:

- Esquema de Prisma completo (`server/prisma/schema.prisma`) con su migración inicial ya
  aplicada (`server/prisma/migrations/20260807223909_init/`).
- Seed idempotente del `AdminUser`, uniformes base y turnos fijos (`server/prisma/seed.js`).
- `POST /api/auth/login` **funcional de verdad**: valida contra la base, devuelve JWT (expira
  a las 8 horas), aplica rate limiting.
- `GET /health` **funcional**: confirma conexión real a la base de datos.
- Middlewares reales: `requireAuth` (JWT), `rateLimit` (login y endpoint público),
  `errorHandler` (nunca filtra stack traces ni detalles de Prisma al cliente).
- Frontend: routing completo (`/`, `/admin/login`, `/admin/*`), login funcional contra el
  backend, sesión persistida en `localStorage`, y las pantallas de administración
  (`PeopleManager`, `TeamGenerator`, `EventsManager`, `SpecialSaturdayManager`,
  `UniformsManager`) existen como UI navegable pero **muestran estados vacíos/placeholder**
  porque el backend detrás todavía no hace nada.

Todo lo demás — importar personas, generar equipos, generar el calendario del mes, eventos
extraordinarios, evento del último sábado, uniformes, página pública real — **todavía no está
implementado**. Ver la sección [Qué NO funciona todavía](#qué-no-funciona-todavía-fase-1) antes
de reportar algo como "bug": puede ser simplemente que esa fase no se ha construido.

## Requisitos previos

Verificado en esta máquina al escribir esta guía:

| Herramienta | Versión usada para verificar | Cómo se confirmó |
|---|---|---|
| Node.js | v22.18.0 (mínimo `>=20`, declarado en `server/package.json` → `engines`) | `node --version` |
| npm | 11.5.2 (viene con Node, no hay versión pineada en el repo) | `npm --version` |
| Docker | 28.4.0 (Docker Desktop o Docker Engine, cualquier versión reciente sirve) | `docker --version` |
| PostgreSQL | `postgres:16-alpine` (imagen de Docker, no requiere instalación nativa) | contenedor corriendo |

El `client` no declara `engines` en su `package.json`, pero usa Vite 8 + React 19, que
requieren el mismo rango de Node que el backend (`>=20`). Usa la misma versión de Node para
ambos.

## Puesta en marcha desde cero

Estos pasos levantan todo el proyecto en una máquina nueva. Cada bloque de comandos es
copiable y pegable (PowerShell o bash, según tu shell).

### 1. Clonar el repositorio

```bash
git clone https://github.com/<tu-usuario>/api-ejercicio.git
cd api-ejercicio
```

### 2. Levantar PostgreSQL con Docker

Este proyecto usa un contenedor Docker **dedicado**, en un puerto distinto al 5432 por
defecto de Postgres, para no interferir con una instalación nativa que pudiera existir en tu
máquina.

**Primera vez** (crea el contenedor):

```bash
docker run --name api-ejercicio-pg \
  -e POSTGRES_USER=api_ejercicio \
  -e POSTGRES_PASSWORD=<elige-una-password-de-desarrollo> \
  -e POSTGRES_DB=api_ejercicio \
  -p 5433:5432 \
  -d postgres:16-alpine
```

**Siguientes veces** (si el contenedor ya existe pero está detenido):

```bash
docker start api-ejercicio-pg
```

Verifica que quedó arriba y escuchando en el puerto 5433:

```bash
docker ps --filter "name=api-ejercicio-pg"
```

> **Nota / discrepancia con `.env.example`:** `server/.env.example` trae por defecto
> `DATABASE_URL="postgresql://user:password@localhost:5432/api_ejercicio?schema=public"`
> (puerto **5432**), asumiendo una instalación nativa genérica de Postgres. Si sigues esta
> guía y usas el contenedor Docker dedicado descrito arriba, tu `DATABASE_URL` real debe usar
> el puerto **5433** y las credenciales que elegiste en el `docker run`, no las del ejemplo.
> Ajusta esto al copiar el `.env` en el paso 4.

### 3. Instalar dependencias

```bash
cd server && npm install
cd ../client && npm install
cd ..
```

### 4. Configurar variables de entorno

**`server/.env`** — copia `server/.env.example` a `server/.env` y ajusta estos valores
(variables verificadas contra `server/src/config/env.js`, que valida el `.env` con `zod` y
**no arranca** si falta alguna o tiene formato inválido):

| Variable | Propósito | Qué poner |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión de Prisma a Postgres | `postgresql://api_ejercicio:<tu-password>@localhost:5433/api_ejercicio?schema=public` (puerto **5433** si usaste el Docker del paso 2) |
| `JWT_SECRET` | Firma los JWT del login admin | Genera uno propio, largo y aleatorio. Ejemplo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USERNAME` | Usuario del único `AdminUser` que crea el seed | El que quieras, ej. `admin` |
| `ADMIN_PASSWORD` | Password del `AdminUser` que crea el seed | Elige una password propia. **Obligatoria**: el seed (`prisma/seed.js`) y el arranque del servidor (`config/env.js`) fallan si no está definida — nunca hay una password por defecto hardcodeada |
| `PORT` | Puerto donde escucha la API Express | `4000` (valor por defecto si lo omites) |
| `CLIENT_ORIGIN` | Origen exacto permitido por CORS | `http://localhost:5173` (el puerto default de Vite en dev) |
| `APP_TIMEZONE` | Zona horaria para todo cálculo de calendario (último domingo/sábado del mes) | `America/Bogota` (default si lo omites; confirmado con el usuario en la Fase 1) |

```bash
cd server
cp .env.example .env
# edita server/.env con los valores de la tabla de arriba
```

**`client/.env`** — copia `client/.env.example` a `client/.env`:

```bash
cd ../client
cp .env.example .env
```

`VITE_API_URL=/api` (el valor del ejemplo) funciona sin cambios en desarrollo: `vite.config.js`
tiene un proxy que reenvía `/api` hacia `http://localhost:4000` (debe coincidir con el `PORT`
de `server/.env`; si cambias el puerto del backend, actualiza también el `target` del proxy en
`client/vite.config.js`).

### 5. Migrar y sembrar la base de datos

```bash
cd ../server
npm run prisma:migrate
```

Esto aplica la migración inicial ya versionada en `server/prisma/migrations/` y, por la config
`"prisma": { "seed": "node prisma/seed.js" }` en `server/package.json`, corre automáticamente
el seed después de migrar. El seed crea:

- El `AdminUser` único con las credenciales de tu `.env`.
- Dos uniformes base (`Uniforme A`, `Uniforme B`).
- La configuración de uniforme por día (miércoles → Uniforme A, domingo → Uniforme B).
- Los 4 turnos fijos semanales (miércoles 17:00/19:00, domingo 08:00/10:30).

Si necesitas volver a sembrar sin migrar (por ejemplo, tras editar `.env`):

```bash
npm run prisma:seed
```

### 6. Levantar el backend

```bash
npm run dev
```

Debe imprimir algo como `API escuchando en http://localhost:4000 (NODE_ENV=development)`.

### 7. Levantar el frontend

En otra terminal:

```bash
cd client
npm run dev
```

Vite imprime la URL local, normalmente `http://localhost:5173`.

### 8. Confirmar que todo quedó funcionando

1. **Backend + base de datos:**

   ```bash
   curl http://localhost:4000/health
   ```

   Respuesta esperada: `{"status":"ok","database":"connected"}` (si la base no responde, da
   `503` con `{"status":"error","database":"disconnected"}`).

2. **Login admin:**

   ```bash
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"<tu ADMIN_USERNAME>","password":"<tu ADMIN_PASSWORD>"}'
   ```

   Respuesta esperada: `{"token":"<jwt>","admin":{"id":"...","username":"...","displayName":"Administrador"}}`.

3. **Frontend:** abre `http://localhost:5173` en el navegador. Debe verse la página pública
   ("Horario del mes") con un estado vacío ("Todavía no hay un mes publicado" — esperado en
   esta fase). Ve a `/admin/login`, entra con las credenciales de tu `.env`, y confirma que te
   redirige a `/admin/personas` ya autenticado.

## Pruebas de humo (smoke tests)

**Todavía no existen.** Verificado en `server/package.json` y `client/package.json`:

- `server/package.json` → `"test": "echo \"Error: no test specified\" && exit 1"` (el
  placeholder que deja `npm init` por defecto, no una suite real).
- `client/package.json` no declara ningún script `test`.

Esto es trabajo pendiente de `qa-tester`, no algo que este quickstart pueda documentar todavía.
Cuando exista una suite real, esta sección debe actualizarse con el comando exacto (ej.
`npm test` o `npm run test:smoke`) en vez de inventarlo aquí.

## Qué NO funciona todavía (Fase 1)

Todos estos endpoints existen (montados y protegidos con `requireAuth` donde corresponde) pero
responden **`501 Not Implemented`** con un mensaje indicando la fase que los va a implementar
— confirmado leyendo cada router en `server/src/routes/`:

| Endpoint | Fase que lo implementa |
|---|---|
| `GET /api/people`, `POST /api/people`, `PATCH /api/people/:id`, `POST /api/people/import` | Fase 2 (personas / import CSV-Excel) |
| `GET /api/months`, `POST /api/months`, `GET /api/months/:id` | Fase 3 (ciclo mensual) |
| `POST /api/months/:id/generate-teams`, `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId` | Fase 3 (generación/edición de equipos) |
| `POST /api/months/:id/events`, `DELETE /api/events/:eventId` | Fase 4 (eventos extraordinarios) |
| `PATCH /api/assignments/:id` | Fase 4 (lock/unlock de asignaciones, balance) |
| `GET /api/months/:id/special-saturday`, `PUT /api/months/:id/special-saturday/members` | Fase 4 (evento del último sábado) |
| `GET /api/uniforms`, `POST /api/uniforms`, `GET/PUT /api/uniforms/weekday-config` | Fase 3-4 (uniformes) |
| `GET /api/schedule/:year/:month` | Fase 5 (página pública real) — hoy responde `501` incluso sin autenticación, aunque el `publicLimiter` (rate limit) ya está activo sobre esta ruta |

En el frontend, las pantallas correspondientes (`PeopleManager`, `TeamGenerator`,
`EventsManager`, `SpecialSaturdayManager`, `UniformsManager`, `PublicSchedule`) ya están
construidas como navegación y layout, pero muestran estados vacíos o mensajes de "esta función
se activará cuando el servidor esté conectado" — **no son bugs**, es el estado esperado de esta
fase.

Lo único end-to-end real hoy es: `POST /api/auth/login` (backend) ↔ pantalla de login
(frontend) ↔ sesión persistida y `ProtectedRoute` del router.

## Estructura del repositorio

```
server/    API Express + Prisma + PostgreSQL — ver server/.env.example para configuración
client/    SPA Vite + React — ver client/.env.example para configuración
docs/      Documentación de arquitectura y diseño (ver docs/architecture/)
CLAUDE.md  Reglas de negocio confirmadas — fuente de verdad del dominio
```
