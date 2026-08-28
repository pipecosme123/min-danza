# Equipos y Turnos de Servicio

Aplicación web para organizar personas en equipos mensuales balanceados (líder + apoyo +
colaboradores, más un equipo opcional de "Servicio de jóvenes") y rotarlos entre turnos fijos
de servicio y eventos extraordinarios, manteniendo el balance de participaciones entre
equipos. Incluye una página pública sin login para consultar la organización del mes.

Las reglas de negocio completas (cómo se sortean líderes, la excepción del último domingo,
el Servicio de jóvenes, uniformes, el ciclo de vida de un mes, etc.) están documentadas en
[`CLAUDE.md`](./CLAUDE.md) — es la fuente de verdad del dominio, léelo antes de tocar lógica
de negocio. El diseño técnico de cada fase (esquema de datos, contratos de API, catálogo de
errores) está en `docs/architecture/`:

- [`docs/architecture/phase1-schema-design.md`](./docs/architecture/phase1-schema-design.md) — esquema de datos base.
- [`docs/architecture/phase2-people-contract.md`](./docs/architecture/phase2-people-contract.md) y [`docs/api/people.md`](./docs/api/people.md) — CRUD + import masivo de personas (referencia de API completa).
- [`docs/architecture/phase3-teams-contract.md`](./docs/architecture/phase3-teams-contract.md) — ciclo mensual y sorteo de equipos.
- [`docs/architecture/phase4-schedule-contract.md`](./docs/architecture/phase4-schedule-contract.md) — horario y balance de participaciones.
- [`docs/architecture/phase4b-schedule-refinements-contract.md`](./docs/architecture/phase4b-schedule-refinements-contract.md) — uniformes por fecha, balance por semana, eventos editables, vista de calendario.
- [`docs/architecture/phase4c-post-publish-edits-contract.md`](./docs/architecture/phase4c-post-publish-edits-contract.md) — qué se puede seguir editando después de publicar un mes.
- [`docs/architecture/phase5-public-page-contract.md`](./docs/architecture/phase5-public-page-contract.md) — finalizar un mes y la página pública.
- [`docs/architecture/css-framework-comparison.md`](./docs/architecture/css-framework-comparison.md) — por qué el frontend usa CSS propio en vez de un framework.

Stack: Node.js + Express + Prisma + PostgreSQL en `/server`; Vite + React (SPA) en `/client`.

## Estado actual del proyecto (importante, léelo antes de asumir nada)

Las **Fases 1 a 5 del plan están completas y funcionando** (base del proyecto, personas,
ciclo mensual y generación de equipos, horario y balance, página pública), más dos ajustes
posteriores hechos tras probar la app en el navegador:

- **Fase 4b** (uniformes por fecha concreta en vez de por día de semana, preferencia de
  balance para no repetir equipo en la misma semana ISO, eventos extraordinarios editables
  sin borrar y recrear, paleta de colores para uniformes, vista de calendario mensual).
- **Fase 4c** (después de publicar/finalizar un mes que sea el actual o uno futuro, sigue
  permitido agregar, cancelar, eliminar y **editar por completo** eventos extraordinarios,
  cambiar el uniforme de un turno puntual, **bloquear/desbloquear y reasignar a mano el equipo
  de cualquier turno**, **editar la composición de un equipo**, y **cancelar/eliminar el
  Servicio de jóvenes** — ventana ampliada el 2026-08-25, ver
  [`CLAUDE.md`](./CLAUDE.md) y
  [`docs/architecture/phase4c-post-publish-edits-contract.md`](./docs/architecture/phase4c-post-publish-edits-contract.md).
  Lo único que sigue exigiendo el mes en `DRAFT` sin ninguna excepción es generar/regenerar el
  horario y (re)sortear equipos).

El **Servicio de jóvenes** reemplazó por completo al viejo "evento especial del último
sábado": ya no es un roster manual aparte (no queda ningún `SpecialSaturdayManager` ni
pantalla de "Sábado especial"). Hoy es un equipo más (`Team.teamType = YOUTH`) que se sortea
junto con los equipos regulares del mes, con líder elegido a mano por el admin y colaboradores
sorteados del pool de personas marcadas `isJoven`, y **sí cuenta** en el balance de
participaciones (antes no contaba).

Lo que existe hoy, verificado contra el código real (`server/src/routes/`) y no solo contra la
documentación:

- **Backend**, todo funcional contra la base de datos real, ningún endpoint responde ya `501`:
  - `GET /health` — confirma conexión real a la base de datos.
  - `POST /api/auth/login` — JWT (expira a las 8 horas) + rate limiting.
  - `/api/people` completo: `GET`, `POST`, `PATCH /:id`, `DELETE /:id` (`?purge=true`),
    `POST /import` (`.csv`/`.xlsx`, incluida la columna opcional "Joven"). Ver
    [`docs/api/people.md`](./docs/api/people.md).
  - Ciclo mensual: `GET`/`POST /api/months`, `GET /api/months/:id`,
    `POST /api/months/:id/generate-teams` (sortea líder/apoyo/ministros y, si se pide, el
    equipo `YOUTH`), `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId`,
    `POST /api/months/:id/finalize`.
  - Horario y balance: `POST /api/months/:id/generate-schedule` (turnos fijos de
    miércoles/domingo con la excepción del último domingo, y el turno `YOUTH_SERVICE` del
    último sábado si aplica; regenerar preserva los eventos extraordinarios ya creados),
    `GET /api/months/:id/schedule`.
  - Eventos extraordinarios: `POST /api/months/:id/events`, `PATCH /api/events/:eventId`
    (edición completa), `DELETE /api/events/:eventId`,
    `POST /api/events/:eventId/cancel` (cancelar es distinto de eliminar: el evento queda
    visible, marcado como cancelado).
  - `POST /api/months/:id/youth-team/cancel` y `DELETE /api/months/:id/youth-team` (agregados
    2026-08-25) — cancelar o eliminar el Servicio de jóvenes sin re-sortear todo el mes;
    cancelar deja el equipo `YOUTH` intacto, eliminar lo borra por completo.
  - `PATCH /api/assignments/:id` — bloquear/desbloquear o reasignar a mano una asignación.
  - `PATCH /api/slots/:id` — asignar o limpiar el uniforme de un turno puntual (cualquier
    tipo de turno).
  - Todas las acciones de esta lista (menos `generate-teams`/`generate-schedule`) siguen
    disponibles después de publicar un mes, si es el mes actual o uno futuro (`409 MES_PASADO`
    si ya pasó) — ver "Fase 4c" arriba.
  - `/api/uniforms` — CRUD puro: `GET`, `POST`, `PATCH /:id`. Ya no expone ninguna
    "configuración automática" por día de semana ni para el Servicio de jóvenes (se eliminó
    en la Fase 4b).
  - `GET /api/schedule/latest` y `GET /api/schedule/:year/:month` — **públicos, sin
    autenticación**, devuelven la organización del mes `FINALIZED` más reciente (equipos +
    horario, sin el balance de participaciones, que es solo herramienta de administración).
- **Frontend**: routing completo (`/`, `/admin/login`, `/admin/personas`, `/admin/equipos`,
  `/admin/eventos`, `/admin/uniformes`), login funcional contra el backend, sesión persistida
  en `localStorage`, tema claro/oscuro real. Todas las pantallas administrativas son
  funcionales de punta a punta contra el backend real (`PeopleManager`, `TeamGenerator`,
  `EventsManager` con vista de lista y de calendario mensual, `UniformsManager`). La página
  pública (`PublicSchedule.jsx`, en `/`) es real y funcional: muestra el mes finalizado más
  reciente, con un filtro por persona.

En resumen: **no queda ningún endpoint ni pantalla en estado "placeholder"**. Lo que sigue
pendiente es explícitamente de alcance (ver la siguiente sección), no un bug ni una fase
a medio construir.

## Qué NO funciona todavía (o está fuera de alcance a propósito)

Confirmado contra `server/src/routes/` (ningún router responde `501`) y contra la sección
"Explícitamente fuera de alcance" de [`CLAUDE.md`](./CLAUDE.md):

| Falta | Detalle |
|---|---|
| **Des-finalizar un mes** | No existe ninguna forma de volver un `MonthCycle` de `FINALIZED` a `DRAFT`. Si algo se publicó mal, hoy no hay manera de corregirlo salvo el margen de edición post-publicación de la Fase 4c (agregar/cancelar/eliminar/editar eventos, cambiar el uniforme de un turno, bloquear/reasignar un turno, editar la composición de un equipo, cancelar/eliminar el Servicio de jóvenes — todo solo si el mes es el actual o uno futuro; generar/regenerar horario y (re)sortear equipos siguen bloqueados sin excepción). Pendiente sin fase asignada todavía. |
| **Historial de meses en la página pública** | La página pública muestra únicamente el mes `FINALIZED` más reciente; no hay selector ni listado de meses anteriores. Decisión confirmada con el usuario, no es un bug. |
| **Formulario de auto-inscripción de personas** | Las personas solo se cargan por el admin (CRUD o import masivo). Fuera de alcance por ahora. |
| **Login de usuarios finales** | No hay cuentas para líderes/colaboradores; solo existe la página pública sin login y el login único de administrador. Fuera de alcance por ahora. |
| **Múltiples administradores** | Un único `AdminUser`, sembrado por `prisma/seed.js`. Fuera de alcance por ahora. |
| **Reporte de asistencia/excusas por parte de los líderes** | El modelo de datos está preparado para no bloquear esto a futuro (`Team`/`TeamMember`/`ServiceSlot` son entidades independientes), pero no hay ninguna funcionalidad construida todavía. |

El próximo paso planeado es la **Fase 7 (pulido)**: validaciones de borde adicionales,
reintentos y estilos finales — sin un alcance cerrado todavía, ver el plan en
`.claude/plans/resilient-humming-lampson.md` y la sección "Estado" de `CLAUDE.md`.

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

`server/.env.example` ya trae `DATABASE_URL` apuntando al puerto **5433** (el del contenedor
dedicado de arriba, no el 5432 por defecto de una instalación nativa de Postgres) — solo
tienes que reemplazar el usuario/password por los que elegiste en el `docker run`.

### 3. Instalar dependencias

```bash
cd server && npm install
cd ../client && npm install
cd ..
```

### 4. Configurar variables de entorno

**`server/.env`** — copia `server/.env.example` a `server/.env` y ajusta estos valores
(variables verificadas contra `server/src/config/env.js`, que valida el `.env` con `zod` y
**no arranca** si falta alguna obligatoria o tiene formato inválido):

| Variable | Propósito | Qué poner |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión de Prisma a Postgres | `postgresql://api_ejercicio:<tu-password>@localhost:5433/api_ejercicio?schema=public` (puerto **5433** si usaste el Docker del paso 2) |
| `JWT_SECRET` | Firma los JWT del login admin (mínimo 16 caracteres) | Genera uno propio, largo y aleatorio. Ejemplo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USERNAME` | Usuario del único `AdminUser` que crea el seed | El que quieras, ej. `admin` |
| `ADMIN_PASSWORD` | Password del `AdminUser` que crea el seed | Elige una password propia. **Obligatoria**: el seed (`prisma/seed.js`) y el arranque del servidor (`config/env.js`) fallan si no está definida — nunca hay una password por defecto hardcodeada |
| `PORT` | Puerto donde escucha la API Express | `4000` (valor por defecto si lo omites) |
| `CLIENT_ORIGIN` | Origen exacto permitido por CORS. Es **obligatoria** (el servidor no arranca sin ella) | `http://localhost:5173` (el puerto default de Vite en dev) |
| `APP_TIMEZONE` | Zona horaria para todo cálculo de calendario (último domingo/sábado del mes, y qué mes es "hoy" para decidir si un mes finalizado ya pasó) | `America/Bogota` (default si lo omites; confirmado con el usuario en la Fase 1) |

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

Esto aplica las migraciones ya versionadas en `server/prisma/migrations/` (a esta fecha, 6:
esquema inicial, renombrado de categoría de persona a `INSTRUCTOR`/`MINISTRO`, equipo de
jóvenes, horario/Servicio de jóvenes, eliminación de la configuración automática de
uniformes, y cancelación de eventos/guardas de mes pasado) y, por la config
`"prisma": { "seed": "node prisma/seed.js" }` en `server/package.json`, corre automáticamente
el seed después de migrar. El seed crea:

- El `AdminUser` único con las credenciales de tu `.env`.
- Dos uniformes base (`Uniforme A`, `Uniforme B`) — sin asignarlos a ningún día ni turno: la
  asignación de uniformes se hace a mano, por fecha concreta, desde la pantalla de Eventos.
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
   ("Ministerio de danza" / "Lluvias de Bendiciones") con un estado vacío ("Todavía no hay un
   mes publicado" — esperado hasta que finalices un mes desde el admin). Ve a
   `/admin/login`, entra con las credenciales de tu `.env`, y confirma que te redirige a
   `/admin/personas` ya autenticado. Desde ahí puedes cargar personas, ir a
   `/admin/equipos` para crear un mes y sortear equipos, `/admin/eventos` para generar el
   horario y finalizar el mes, y volver a `/` para verlo publicado en la página pública.

## Pruebas de humo (smoke tests)

Existen y pasan, verificado corriendo ambas suites contra la base de datos real (Docker
levantado como en el paso 2):

```bash
cd server && npm test   # vitest run — 205 pruebas, 17 archivos (contra el servidor y la
                         # base reales: personas, ciclo mensual, sorteo de equipos, horario,
                         # balance, eventos, asignaciones, uniformes, finalizar mes y página
                         # pública)
cd ../client && npm test  # vitest run — 107 pruebas, 11 archivos
```

Backend: incluye pruebas de regresión de bugs ya corregidos (ver el historial de commits para
el detalle completo). Las más recientes: un bug real en `Modal.jsx` donde escribir en
cualquier campo de un modal devolvía el foco al botón "Cerrar" después de cada letra, y un bug
en `useApi.js` donde cada refetch tras una acción desmontaba toda la vista detrás de un
spinner (se sentía como que la página se recargaba y saltaba al inicio). También cubre una
condición de carrera en `POST /api/people` (dos altas concurrentes con el mismo documento
nuevo podían devolver un 409 genérico sin `details.code` en vez del `409 DOCUMENTO_DUPLICADO`
estructurado) en `server/src/services/people.service.js`.

## Estructura del repositorio

```
server/    API Express + Prisma + PostgreSQL — ver server/.env.example para configuración
client/    SPA Vite + React — ver client/.env.example para configuración
docs/      Documentación de arquitectura/diseño (docs/architecture/) y referencia de API (docs/api/)
CLAUDE.md  Reglas de negocio confirmadas — fuente de verdad del dominio
```
