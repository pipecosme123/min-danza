# Plan de despliegue a producción (Railway) — REEMPLAZADO

**Estado:** obsoleto. El usuario decidió el 2026-08-10 usar en cambio el hosting compartido con cPanel al que ya tiene acceso (Node.js Selector/Passenger + PostgreSQL + subdominios), no Railway. El plan vigente es `docs/deployment/cpanel-deployment-plan.md`. Este documento queda solo como referencia histórica de la decisión descartada.
**Fecha:** 2026-08-08

Decisiones ya confirmadas con el usuario:
1. Hosting: **PaaS simple y económico** (no una nube grande tipo AWS/GCP, no un servidor propio).
2. Dominio: **por ahora sin dominio propio** — se publica con la URL gratuita que dé el hosting; un dominio propio queda como mejora opcional a futuro, no bloqueante.

---

## 0. Resumen de la propuesta

- **Todo en [Railway](https://railway.app)**: un solo servicio de PostgreSQL administrado + un servicio para el backend (Express) + un servicio para el frontend (build estático de Vite servido por un contenedor liviano). Una sola plataforma, un solo dashboard, una sola factura — la opción más simple dado que ya elegiste "PaaS económico".
- **Costo estimado**: el plan Hobby de Railway cuesta USD 5/mes, con USD 5 de crédito de uso incluido; para una app de este tamaño (una sola organización, tráfico bajo, un solo admin) el consumo real de Postgres + backend + frontend suele rondar USD 5-10/mes en total ([fuente](https://www.oploy.eu/blog/postgresql-railway/), [fuente](https://thesoftwarescout.com/railway-pricing-2026-plans-costs-is-it-worth-it/)). Verificá el pricing vigente al momento de desplegar, cambia con el tiempo.
- **Alternativa para ahorrar más**: mover solo el frontend (archivos estáticos) a Cloudflare Pages o Netlify (gratis, sin las restricciones de "uso no comercial" que sí tiene el plan gratuito de Vercel) y dejar backend + Postgres en Railway. Ahorra unos dólares al mes a cambio de administrar dos plataformas en vez de una. Lo dejo como nota, no como plan principal — para simplicidad, priorizá todo-en-Railway primero.
- **Automatización**: Railway despliega automáticamente cada vez que hacés `git push` a `main` (nativo de la plataforma, no hace falta un pipeline propio). Se agrega además un workflow de GitHub Actions que corre las 220+108 pruebas en cada push/PR — no bloquea el deploy de Railway, pero te avisa en GitHub si algo rompió antes de que llegue a producción.

---

## 1. Cambios de código necesarios ANTES de desplegar

Encontrados al revisar el código real contra los requisitos de un PaaS — ningún endpoint ni funcionalidad cambia, son ajustes de infraestructura:

### 1.1 `app.set('trust proxy', 1)` — obligatorio

`server/src/app.js` no lo tiene hoy. Railway (como cualquier PaaS) pone tu app detrás de un proxy inverso: sin esta línea, `express-rate-limit` (ya usado en `loginLimiter`/`publicLimiter`/`adminLimiter`) puede fallar o, peor, tratar a **todos** los visitantes como si vinieran de la misma IP (rompiendo el propósito del rate limiting). Es un cambio de una línea, cero riesgo, bien documentado en la documentación oficial de Express para despliegues detrás de proxy.

### 1.2 Variables de entorno de producción — nunca reusar las de desarrollo

`server/.env.example` ya documenta todas las variables necesarias. Para producción:

| Variable | Qué cambiar respecto a dev |
|---|---|
| `DATABASE_URL` | La que te da Railway al crear el servicio de Postgres (la genera automáticamente, se copia del dashboard). |
| `JWT_SECRET` | Uno **nuevo**, largo y aleatorio — nunca el mismo que uses en tu `.env` local. Generalo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Credenciales **reales** del admin de producción — nunca `ChangeMe_DevOnly123!` ni ninguna que hayas usado en pruebas. |
| `PORT` | Railway lo inyecta automáticamente; no hace falta fijarlo a mano (el código ya lee `env.PORT` con default, compatible). |
| `CLIENT_ORIGIN` | La URL pública real del frontend en Railway (ej. `https://equipos-turnos-frontend.up.railway.app`), no `http://localhost:5173`. |
| `APP_TIMEZONE` | `America/Bogota` (o la que corresponda a la organización real) — confirmá que sigue siendo correcta. |

Y para el frontend (`client/.env` en build time, no en runtime — ver 1.3):

| Variable | Qué poner |
|---|---|
| `VITE_API_URL` | La URL pública real del backend en Railway (ej. `https://equipos-turnos-backend.up.railway.app/api`). |

### 1.3 Ojo: las variables de Vite se "hornean" en el build, no se leen en runtime

`VITE_API_URL` (`client/src/api/client.js`, línea `import.meta.env.VITE_API_URL`) queda fijo dentro del JavaScript compilado en el momento de correr `npm run build` — no es como una variable de entorno de un servidor Node que se lee cada vez que arranca. Esto significa que el `VITE_API_URL` de producción tiene que estar configurado en Railway **antes** de que el build del frontend corra ahí (Railway inyecta las variables de entorno del servicio durante el build automáticamente si están configuradas en el dashboard de ese servicio — solo hay que asegurarse de configurarlas ahí, no en el servicio del backend).

### 1.4 CORS

`server/src/app.js` ya usa `cors({ origin: env.CLIENT_ORIGIN, credentials: true })` — no hace falta cambiar código, solo el valor de `CLIENT_ORIGIN` (ver 1.2). Nunca se necesita `origin: "*"` acá porque solo hay un frontend real consumiendo la API.

### 1.5 Nada que hacer con el manejo de archivos subidos

El import masivo de personas (`multer.memoryStorage()`, `people.routes.js`) ya guarda el archivo en memoria, nunca en disco — compatible tal cual con un filesystem efímero de PaaS (Railway reinicia el filesystem del contenedor en cada deploy). No hace falta ningún cambio acá.

### 1.6 Límite conocido, no bloqueante: caché en memoria de un solo proceso

`server/src/lib/cache.js` (usado por la página pública, `publicSchedule.service.js`) es un `Map` en memoria del proceso Node — funciona perfecto mientras el backend corra en **una sola instancia**, que es exactamente lo que este plan propone. Si en el futuro hiciera falta escalar horizontalmente a 2+ instancias del backend, este caché quedaría inconsistente entre instancias (cada una vería su propia copia) y habría que migrarlo a algo compartido (Redis, típicamente). Anotado para el futuro, no bloquea este despliegue.

### 1.7 Dockerfile: no hace falta, pero es una mejora opcional

Railway puede construir el backend y el frontend sin ningún `Dockerfile` (usa Nixpacks, que detecta un proyecto Node automáticamente a partir de `package.json`). No es un bloqueante. Si más adelante querés control explícito del proceso de build (versión exacta de la imagen base, pasos de build reproducibles fuera de Railway), se puede agregar un `Dockerfile` por servicio — lo dejo fuera de este plan por simplicidad, ya que el pedido fue justamente "simple y económico".

---

## 2. Arquitectura de despliegue

```
                         ┌─────────────────────────┐
   Usuario/Admin  ──────▶│  Frontend (Railway)      │
                         │  Vite build servido      │
                         │  como archivos estáticos │
                         └──────────┬───────────────┘
                                    │ fetch a VITE_API_URL (CORS)
                                    ▼
                         ┌─────────────────────────┐
                         │  Backend (Railway)        │
                         │  Express + Prisma          │
                         │  PORT inyectado por Railway│
                         └──────────┬───────────────┘
                                    │ DATABASE_URL
                                    ▼
                         ┌─────────────────────────┐
                         │  PostgreSQL (Railway)      │
                         │  administrado, con backups │
                         └─────────────────────────┘
```

Tres servicios Railway dentro de un mismo proyecto:

1. **`postgres`** — plugin administrado de Railway. Railway genera `DATABASE_URL` automáticamente y lo puede inyectar como variable de referencia en el servicio del backend (no hay que copiarlo a mano si usás la sintaxis de referencia de variables de Railway, `${{Postgres.DATABASE_URL}}`).
2. **`backend`** — build desde `/server`. Comando de arranque: `npx prisma migrate deploy && npm start` (ver §3.4 — las migraciones corren automáticamente en cada deploy, nunca a mano contra producción).
3. **`frontend`** — build desde `/client` (`npm run build`, genera `dist/`), servido con un servidor de archivos estáticos liviano (ver §3.5 para la opción concreta).

---

## 3. Pasos de despliegue, en orden

### 3.1 Preparar el código

1. Agregar `app.set('trust proxy', 1)` en `server/src/app.js` (§1.1).
2. Confirmar que `.env` (ambos, `server/` y `client/`) están en `.gitignore` (ya deberían estarlo — nunca comitear secretos reales).
3. Correr `npm test` en `server/` y `client/` una vez más para confirmar que se parte de verde (220 + 108 hoy).
4. Commitear y pushear estos cambios a `main`.

### 3.2 Crear la cuenta y el proyecto en Railway

1. Crear cuenta en [railway.app](https://railway.app) (podés entrar con GitHub directamente, simplifica el paso siguiente).
2. Crear un proyecto nuevo, conectarlo al repositorio de GitHub de este proyecto (Railway pide autorización para leer el repo — es la única forma de que el auto-deploy en cada push funcione).

### 3.3 Servicio de PostgreSQL

1. Dentro del proyecto Railway, "New" → "Database" → "PostgreSQL". Railway lo aprovisiona solo, con backups automáticos incluidos en el plan (confirmá la retención exacta en el dashboard al momento de crearlo, Railway la documenta ahí).
2. Anotar/usar la variable de referencia `DATABASE_URL` que Railway genera para este servicio — se referencia desde el backend, no hace falta copiarla a mano.

### 3.4 Servicio del backend

1. "New" → "GitHub Repo" → elegir este repo, configurar **Root Directory: `server`** (importante — es un monorepo con `/server` y `/client`, Railway necesita saber cuál construir en cada servicio).
2. Variables de entorno (panel "Variables" del servicio): todas las de la tabla de §1.2, con `DATABASE_URL` referenciando al servicio de Postgres (`${{Postgres.DATABASE_URL}}`, Railway autocompleta esta sintaxis).
3. Comando de build: por defecto Railway corre `npm install` (o `npm ci` si detecta `package-lock.json`, que este repo tiene) — no hace falta tocarlo. Verificar que además corra `npx prisma generate` (agregalo como parte del comando de build si Nixpacks no lo detecta solo: `npm ci && npx prisma generate`).
4. Comando de arranque (Custom Start Command): `npx prisma migrate deploy && npm start`. Esto aplica cualquier migración pendiente ANTES de arrancar el servidor, en cada deploy — así nunca hay que correr una migración a mano contra la base de producción (mismo mecanismo que ya usa `npm run prisma:deploy` en local, que ya existe en `server/package.json`).
5. Confirmar el health check: Railway puede usar `GET /health` (ya existe, ya confirma conexión real a la base) para saber si el deploy está sano antes de enrutarle tráfico — configurable en "Settings" → "Healthcheck Path" → `/health`.
6. Deploy. Confirmar en los logs que dice `API escuchando en http://localhost:<PORT> (NODE_ENV=production)` (asegurate de que `NODE_ENV=production` quede seteado — Railway normalmente lo hace solo, confirmalo en Variables si no).

### 3.5 Sembrar el admin de producción (una sola vez)

El seed (`server/prisma/seed.js`) ya es idempotente (podés correrlo de nuevo sin duplicar nada). Para la primera carga:

1. Desde el dashboard de Railway, abrí una shell del servicio del backend ("Settings" → algo como "Connect"/shell remoto, según lo que ofrezca el plan) o corré el seed localmente apuntando a la `DATABASE_URL` de producción (con cuidado: usá temporalmente esa URL en tu `.env` local, corré `npm run prisma:seed`, y **borrala de tu `.env` local apenas termines** para no dejarla ahí por error).
2. Confirmá que el `AdminUser` se creó con las credenciales reales de producción (§1.2), no las de desarrollo.

### 3.6 Servicio del frontend

El frontend es un build estático (`vite build` genera `client/dist/`), así que necesita algo que sirva esos archivos — Railway no tiene un producto "sitio estático" de un clic como Vercel/Netlify, así que se sirve con un servidor mínimo:

1. "New" → "GitHub Repo" → mismo repo, **Root Directory: `client`**.
2. Variables de entorno: `VITE_API_URL` = URL pública del backend + `/api` (ver §1.2/§1.3 — tiene que estar seteada ANTES del build).
3. Comando de build: `npm ci && npm run build`.
4. Comando de arranque: servir `dist/` con un servidor estático simple. La forma más simple sin agregar infraestructura nueva es usar el paquete `serve` (`npx serve -s dist -l $PORT`) como comando de arranque — no hace falta instalarlo como dependencia del proyecto, `npx` lo resuelve al vuelo. La flag `-s` (single-page-app) es importante: hace que cualquier ruta que no sea un archivo real (ej. `/admin/personas`, que solo existe del lado del cliente vía `react-router-dom`) devuelva `index.html` en vez de un 404 — sin esto, refrescar la página en `/admin/personas` directamente rompe.
5. Deploy. Confirmar que abre la página pública ("Ministerio de danza"/"Lluvias de Bendiciones") y que el login en `/admin/login` conecta contra el backend real (revisá la consola del navegador por errores de CORS si algo falla — normalmente es `CLIENT_ORIGIN` mal seteado en el backend).

### 3.7 HTTPS

Automático: Railway da un dominio `*.up.railway.app` con certificado HTTPS (Let's Encrypt) para cada servicio, sin configuración extra. No hace falta ningún paso manual acá mientras no se agregue un dominio propio.

### 3.8 GitHub Actions — gate de calidad (no reemplaza el deploy de Railway)

Nuevo `.github/workflows/ci.yml`, corre en cada push/PR a `main`: instala dependencias de `server/` y `client/`, corre `npm test` en ambos. Esto NO despliega nada (Railway ya lo hace solo al detectar el push) — es una señal visible en GitHub (✅/❌ en cada PR) de que las pruebas siguen pasando, para no enterarte de una regresión recién cuando ya está en producción. Requiere levantar un Postgres de servicio en el job de CI (mismo patrón que el Docker local, `postgres:16-alpine` como servicio del workflow) ya que los tests de backend golpean una base real.

### 3.9 Checklist post-deploy (probar en el sitio real, no solo local)

- [ ] `GET https://<backend>/health` responde `{"status":"ok","database":"connected"}`.
- [ ] Página pública carga en `https://<frontend>` (esperado: "Todavía no hay un mes publicado" hasta que finalices el primer mes real).
- [ ] Login admin funciona con las credenciales de producción.
- [ ] Crear una persona de prueba, importar un CSV de prueba.
- [ ] Crear un mes, sortear equipos, generar horario, finalizar el mes.
- [ ] La página pública ahora muestra ese mes.
- [ ] Borrar los datos de prueba (persona/mes) si no correspondían a datos reales de la organización.

---

## 4. Seguridad — checklist antes de anunciar la URL a la organización

- [ ] `JWT_SECRET` y `ADMIN_PASSWORD` de producción son nuevos, fuertes, y distintos a cualquier valor usado en desarrollo/pruebas.
- [ ] `trust proxy` configurado (§1.1) — sin esto el rate limiting no protege de verdad.
- [ ] `CLIENT_ORIGIN` apunta exactamente a la URL real del frontend, nunca `*`.
- [ ] HTTPS activo en ambos servicios (automático en Railway, confirmar igual).
- [ ] Nadie tiene acceso al `DATABASE_URL` de producción salvo quien administra el despliegue (no queda en ningún commit, chat, o archivo compartido).
- [ ] Backups de Postgres confirmados activos (Railway los incluye; revisar frecuencia/retención en el dashboard).
- [ ] Rate limiting confirmado activo en login (`loginLimiter`) y en rutas admin (`adminLimiter`, agregado en la Fase 7 de pulido) — ya implementado en código, solo falta que `trust proxy` esté bien para que funcione correctamente detrás del proxy de Railway.

---

## 5. Operación continua (después del primer despliegue)

- **Logs**: dashboard de Railway, por servicio, en tiempo real.
- **Rollback**: Railway guarda los deploys anteriores de cada servicio; volver a uno anterior es un click en el dashboard, sin tocar código ni base de datos (ojo: si el rollback es a una versión con un esquema de base de datos distinto, revisar que las migraciones sean compatibles hacia atrás antes de asumir que un rollback de código alcanza).
- **Nuevas migraciones a futuro**: no hace falta ningún paso manual — cada `git push` a `main` con una migración nueva en `server/prisma/migrations/` la aplica automáticamente el comando de arranque (`npx prisma migrate deploy`, §3.4) en el próximo deploy.
- **Monitoreo básico**: el endpoint `GET /health` ya existe y confirma conexión real a la base — se puede apuntar un servicio gratuito de uptime externo (ej. UptimeRobot, cron-job.org) para que avise por email/Slack si deja de responder. No es parte de Railway, es una capa externa opcional pero barata de agregar.
- **Costos**: revisar el uso mensual en el dashboard de Railway; si crece mucho más de lo esperado (tráfico inusual, algo mal configurado), el dashboard muestra el desglose por servicio.

---

## 6. Fuera de alcance de este plan (a propósito)

- **Dominio propio**: decisión confirmada con el usuario de dejarlo para después. Cuando se quiera agregar, es: comprar el dominio (cualquier registrador), apuntar un registro DNS al servicio de Railway correspondiente (Railway lo guía paso a paso desde "Settings" → "Domains" de cada servicio), Railway emite el certificado HTTPS automáticamente para el dominio propio también.
- **Alta disponibilidad / múltiples instancias del backend**: innecesario para el volumen de esta app (una sola organización). Si algún día hiciera falta, primero hay que resolver el caché en memoria de un solo proceso (§1.6).
- **Ambientes de staging separados** (un Railway/base de datos de prueba antes de producción): se puede agregar después clonando el proyecto de Railway si hace falta probar cambios grandes sin tocar producción — no es parte de este primer despliegue.
- **Des-finalizar un mes, historial en la página pública, y el resto de lo ya anotado como fuera de alcance en `CLAUDE.md`** — son decisiones de producto, no de despliegue, no cambian por este plan.

---

## Sources

- [Railway Pricing 2026: Plans, Costs & Is It Worth It?](https://thesoftwarescout.com/railway-pricing-2026-plans-costs-is-it-worth-it/)
- [railway postgres pricing 2025–2026 — Oploy](https://www.oploy.eu/blog/postgresql-railway/)
- [Vercel Pricing 2026: Full Breakdown (Hobby, Pro, Enterprise)](https://temps.sh/blog/vercel-pricing-complete-guide-2026)
