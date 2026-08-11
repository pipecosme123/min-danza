# Plan de despliegue en cPanel (hosting compartido)

**Estado:** propuesto, pendiente de confirmar algunos datos del hosting (§5) y de ejecutar. No implementado todavía.
**Fecha:** 2026-08-10
**Reemplaza a:** `docs/deployment/production-deployment-plan.md` (plan para Railway, descartado — el usuario decidió usar el cPanel al que ya tiene acceso).

Decisiones ya confirmadas con el usuario:
1. Hosting: **cPanel compartido**, con acceso confirmado a "Setup Node.js App" (Node.js Selector sobre Phusion Passenger), "PostgreSQL Databases" y creación de subdominios.
2. El repositorio ya está en GitHub.
3. Prioridad explícita: que los despliegues con cambios/actualizaciones futuras sean **lo más automatizados posible** desde `git push`.
4. **SSH confirmado disponible** en el plan de hosting → el pipeline completamente automatizado (§3.1, GitHub Actions → SSH) es la ruta a construir, sin necesidad del runbook manual de respaldo.
5. **Topología de dominios confirmada**: la página pública vive en un **subdominio dedicado** (ej. `app.midominio.com`), no en la raíz del dominio — el dominio raíz (`midominio.com`) queda libre para lo que ya aloja o vaya a alojar, sin tocar. El backend va en otro subdominio (`api.midominio.com`). Todo el documento usa `app.midominio.com`/`api.midominio.com` como placeholders de este esquema; reemplazar por los nombres reales al ejecutar.

Este documento fue elaborado por dos agentes especializados (arquitectura y DevOps) y consolidado acá. Con SSH ya confirmado, el resto de los puntos de la sección 4 (checklist) siguen pendientes de verificar con el hosting antes de construir el pipeline, pero ya no cambian la estrategia principal.

---

## 0. Resumen ejecutivo

- **Topología**: dos vhosts — frontend estático (`client/dist/`) servido directo por Apache/LiteSpeed en el dominio raíz (o un subdominio), y backend Express bajo Passenger en un subdominio dedicado (ej. `api.midominio.com`), con el código del backend **fuera** del document root por seguridad.
- **Passenger no tiene "start command"** como Railway: solo corre un *startup file*. Las migraciones de Prisma y el restart de la app pasan a ser pasos explícitos del pipeline, no automáticos al arrancar.
- **Automatización recomendada**: GitHub Actions con gate de tests → build → despliegue por SSH (rsync + comandos remotos) → migración → restart → smoke test — **si el plan de hosting tiene SSH**. El frontend se puede automatizar igual incluso sin SSH (FTP/SFTP alcanza, porque es solo archivos estáticos). El backend, sin SSH, cae a un runbook semi-manual documentado en §4.4.
- **Cambios de código necesarios**: 6 cambios quirúrgicos, ninguno toca reglas de negocio (tabla completa en §2).
- **Punto crítico de diseño**: el orden de operaciones en cada deploy tiene que ser *código nuevo → `npm install` → migrar → recién ahí reiniciar*. Nunca al revés — reiniciar antes de migrar dejaría código nuevo corriendo contra un schema viejo.

---

## 1. Arquitectura de despliegue

### 1.1 Topología (recomendada)

```
                    HTTPS (AutoSSL, un certificado por vhost)
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                             ▼
 app.midominio.com                          api.midominio.com
 (docroot del subdominio)                   (vhost solo con el .htaccess
 contenido de client/dist/,                  de Passenger; código NO vive acá)
 servido por Apache/LiteSpeed                        │
 SIN proceso Node                                     ▼
        │                                    Phusion Passenger
        │ fetch a VITE_API_URL (CORS)                 │
        └───────────────────────────────────▶ nodeapps/equipos-api/
                                               (Application Root,
                                                fuera del docroot)
                                                       │
                                                       ▼
                                              PostgreSQL (localhost,
                                              PostgreSQL Databases de cPanel)
```

Estructura de carpetas sugerida en la cuenta de cPanel:

```
/home/user/
├── app.midominio.com/            <- docroot del subdominio de la app = contenido de client/dist/
│   ├── index.html  assets/  .htaccess
├── api.midominio.com/           <- docroot del subdominio, SOLO el .htaccess de Passenger
│   └── .htaccess                (generado por cPanel, no tocar salvo el redirect a HTTPS)
└── nodeapps/equipos-api/        <- Application Root del backend (NO web-accessible)
    ├── app.cjs                  <- startup file (shim ESM→CJS, ver §1.3)
    ├── package.json  src/  prisma/  node_modules/  .env
    └── tmp/restart.txt
```

**Regla no negociable**: el *Application Root* del backend debe estar fuera del document root del subdominio. Si coincidieran, `https://api.midominio.com/.env`, `/package.json` y `/prisma/schema.prisma` quedarían descargables por cualquiera — Apache sirve archivos existentes antes de pasarle la request a Passenger.

Se descartaron dos alternativas: montar la API bajo `app.midominio.com/api` (mismo origen, sin CORS, pero Passenger no siempre estripa el base URI de forma consistente para apps Node, y `/health` se movería de lugar rompiendo el monitoreo — riesgo de puesta en marcha que no compensa la ventaja) y servir el frontend desde el mismo proceso Node con `express.static` (gasta recursos del plan compartido en algo que Apache/LiteSpeed hace gratis, y requiere código nuevo).

### 1.2 Cómo funciona Passenger/Node.js Selector (lo no obvio)

- **`app.listen()` funciona sin cambios**: Passenger intercepta el primer `http.Server` que llama a `listen()` y lo redirige a un socket Unix propio; el puerto que le pases es irrelevante. `server/src/index.js` no necesita tocarse en este aspecto. El log dirá `API escuchando en http://localhost:4000` aunque nadie escuche ahí — anotar esto en el runbook para que no confunda a nadie.
- **Startup file — cambio bloqueante**: `server/package.json` tiene `"type": "module"` (ESM). Passenger carga el startup file con `require()`, que no puede cargar ESM directo (`ERR_REQUIRE_ESM`). Hace falta un shim CommonJS (`server/app.cjs`, ver §2) que haga `import('./src/index.js')`.
- **Instalación de dependencias**: vía el botón "Run NPM Install" del panel (sin SSH) o por SSH activando el virtualenv propio del Selector (`source /home/user/nodevenv/nodeapps/equipos-api/<versión>/bin/activate && npm install`). **Nunca subir `node_modules/` armado en Windows** — `@prisma/client` y `bcrypt` tienen binarios nativos que deben resolverse en el host.
- **Trampa real**: el panel setea `NODE_ENV=production`, y con eso `npm install` omite `devDependencies`. Hoy `prisma` (el CLI) está en `devDependencies` → sin él no hay `prisma generate` ni `prisma migrate deploy` en el servidor. Ver cambio de código §2.
- **Restart**: tocar `tmp/restart.txt` dentro del Application Root (convención Passenger, la más automatizable), o el botón "Restart" del panel, o UAPI de cPanel. Obligatorio tras cambiar variables de entorno, `npm install`, o subir código nuevo.
- **Logs**: `stderr.log` del app root (o `~/logs/`) — confirmar la ruta exacta en el primer deploy, es el único observability disponible sin dashboard tipo Railway.

### 1.3 Frontend estático

- **Se construye en tu máquina o en el runner de GitHub Actions, nunca en el servidor** — `vite build` con Rollup puede consumir varios cientos de MB de RAM, riesgo de OOM en un plan con 1 GB de PMEM.
- Se sube el **contenido** de `client/dist/` al document root (zip + extraer, o rsync/FTP).
- `.htaccess` obligatorio para el fallback de `react-router-dom` (equivalente al flag `-s` de `serve` que usaba el plan de Railway) — sin esto, refrescar en `/admin/eventos` da 404 de Apache. Colocarlo en `client/public/.htaccess` para que Vite lo copie en cada build automáticamente (verificar que `dist/.htaccess` exista tras el primer build; si Vite no lo copia por ser dotfile, se sube a mano una sola vez).
- Incluye redirect forzado a HTTPS y cache headers agresivos para assets con hash, sin cache para `index.html`.

### 1.4 PostgreSQL

- Se crea desde "PostgreSQL Databases" del panel (base + usuario, ambos prefijados con el nombre de cuenta: `usuario_equipos`, `usuario_app`). Contraseña larga **alfanumérica sin símbolos** (evita percent-encoding en la URL de conexión).
- `DATABASE_URL` resultante, **local** (mejora de seguridad real respecto a Railway: sin latencia de red ni credenciales viajando por internet):
  ```
  postgresql://usuario_app:PASSWORD@localhost:5432/usuario_equipos?schema=public&connection_limit=3&pool_timeout=20&connect_timeout=10
  ```
- **`connection_limit` es obligatorio, no cosmético**: Prisma calcula el pool por defecto según `os.cpus()`, que en shared hosting reporta los núcleos del servidor físico completo (no la cuota de la cuenta) — sin fijarlo, un solo proceso puede intentar abrir decenas de conexiones contra un `max_connections` compartido con todos los demás usuarios del servidor, causando `too many connections` intermitente. `connection_limit=3` sobra para esta app (un admin, tráfico bajo).
- **PostgreSQL 15+**: el esquema `public` ya no otorga `CREATE` a todos por defecto. Si la primera migración falla con `permission denied for schema public`, hace falta que el hoster corra `ALTER DATABASE usuario_equipos OWNER TO usuario_app;` o `GRANT ALL ON SCHEMA public TO usuario_app;`. Verificar esto **antes** de dar la arquitectura por cerrada — es la falla más común de este stack.
- **Backups**: los backups automáticos de cPanel a veces cubren solo MySQL. Confirmar explícitamente con el hoster si PostgreSQL está incluido; si no, un `pg_dump` diario vía Cron Job (si está disponible, ver §5) resuelve.

### 1.5 Variables de entorno

**Backend** (mapeo desde las que ya documentaba el plan de Railway):

| Variable | Valor en cPanel | Notas |
|---|---|---|
| `DATABASE_URL` | Ver §1.4, con `connection_limit` | Se arma a mano, no la genera la plataforma |
| `JWT_SECRET` | Nuevo, 64 hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | Sin símbolos — la UI de variables de cPanel puede tener problemas con `$`, comillas, espacios |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Reales de producción | Los lee `prisma/seed.js`, no la app en runtime |
| `CLIENT_ORIGIN` | `https://app.midominio.com` (exacto, con esquema, sin barra final) | `app.js` lo pasa literal a `cors()` |
| `APP_TIMEZONE` | `America/Bogota` (o la que corresponda) | Ver riesgo ICU en §1.6 |
| `PORT` | Omitir | Passenger lo ignora; `config/env.js` ya tiene default `4000` |
| `NODE_ENV` | `production` vía "Application mode" del panel | Ver trampa de `devDependencies` en §1.2 |

**Fuente única recomendada: archivo `.env`** en el Application Root (fuera del docroot, `chmod 600`), no las variables del panel — porque no está garantizado que "Run JS script"/comandos remotos propaguen las variables del panel a los scripts de migración/seed, y `dotenv` no sobrescribe `process.env` (si se usan ambos, el panel gana silenciosamente). Con `.env` como única fuente, la app y los comandos de migración/seed ven exactamente las mismas variables, igual que en el Docker local de desarrollo.

**Frontend** — `VITE_API_URL` se "hornea" en build time (`client/src/api/client.js`), y sin un dashboard tipo Railway que la inyecte, la fuente de verdad pasa a ser un archivo comiteado:
```
# client/.env.production
VITE_API_URL=https://api.midominio.com/api
```
Verificado: el `.gitignore` raíz no matchea `.env.production` (solo `.env`/`.env.*.local`), así que se puede comitear sin conflicto — no es un secreto, es una URL pública, y comitearlo hace el build reproducible desde cualquier máquina o desde CI.

### 1.6 SSL

AutoSSL (Let's Encrypt/Sectigo) emite por vhost, sin distinguir sitio estático de app Node — Apache/LiteSpeed termina TLS antes de pasarle la request a Passenger. Cubre `app.midominio.com` y `api.midominio.com` igual, siempre que el DNS de ambos ya apunte al servidor cuando corre AutoSSL. Forzar HTTPS con el redirect del `.htaccess` (§1.3) en el sitio estático, y un redirect equivalente en el vhost de la API sin borrar el bloque `PassengerAppRoot` generado por cPanel. Si `VITE_API_URL` quedara en `http://`, el navegador bloquea las llamadas por mixed content — está en el checklist post-deploy (§6).

### 1.7 Riesgos específicos de shared hosting (para tener en cuenta, no bloqueantes hoy)

- **`bcrypt` es un módulo nativo**: puede fallar al compilar en el host según la combinación de versión de Node y glibc de CloudLinux. Plan B ya identificado: reemplazar por `bcryptjs` (JS puro, hashes intercambiables) — probar en el primer `npm install` real.
- **Engine nativo de Prisma**: generarlo en el servidor (`postinstall`) normalmente autodetecta bien; si falla, fijar `binaryTargets` explícito en `schema.prisma` (ej. `rhel-openssl-3.0.x`).
- **Idle shutdown / cold start**: Passenger apaga apps sin tráfico (~5 min típico); la primera visita después paga 1-3s de arranque. Tolerable para esta app; un ping externo periódico a `/health` lo evita y de paso sirve de monitoreo (§4.5).
- **Caché en memoria de un solo proceso** (`server/src/lib/cache.js`, usado por la página pública): asume un solo proceso Node. Passenger puede escalar a más de uno sin avisar, y el caché público hoy no tiene TTL — un escenario real: se cancela un evento extraordinario de un mes publicado, un segundo proceso Passenger nunca se entera de la invalidación y sigue sirviendo el evento como vigente indefinidamente. Mitigación de una línea en §2 (TTL de 60s al caché público) sin tocar ninguna invariante de negocio.
- **`trust proxy` bajo socket Unix**: verificar en el primer deploy que `req.ip` resuelva la IP real del cliente (no `undefined`) — si no, los tres rate limiters (`login`/`public`/`admin`) colapsan a un solo bucket global y pueden bloquear al admin real.
- **ICU/zona horaria**: `utils/dates.js` usa `Intl.DateTimeFormat` con `APP_TIMEZONE`, de donde sale todo el cálculo del calendario (último domingo con 2 equipos, último sábado del Servicio de jóvenes, `409 MES_PASADO`). Verificar con un one-liner en el primer deploy que el Node del host tenga full-ICU — si no, las fechas se corren sin ningún error visible.
- **Sin root, sin Docker, sin systemd, sin procesos en segundo plano** fuera de la app Passenger — hoy no hace falta ninguno, pero cierra la puerta a un worker futuro sin evaluarlo aparte.
- **Límites LVE** (CPU%, PMEM típico 1GB, NPROC, entry processes) e inodos — irrelevantes a esta escala, pero un `npm install` pesado + tráfico simultáneo podría rozarlos en planes chicos.
- **Sin rollback de un click** como en un PaaS — ver estrategia en §4.3.

---

## 2. Cambios de código necesarios

Todos quirúrgicos, ninguno toca reglas de negocio:

| # | Archivo | Cambio | Motivo |
|---|---|---|---|
| 1 | `server/src/app.js` | `app.set('trust proxy', 1)` antes de los middlewares | Rate limiting correcto detrás del proxy del hosting |
| 2 | `server/app.cjs` (**nuevo**) | Shim CJS: `import('./src/index.js').catch(err => { console.error(err); process.exit(1); })` | Passenger usa `require()`, el proyecto es ESM — bloqueante, sin esto no arranca |
| 3 | `server/package.json` | Mover `prisma` de `devDependencies` a `dependencies`; agregar scripts `postinstall: "prisma generate"`, `deploy:migrate: "prisma migrate deploy"`, `deploy:seed: "node prisma/seed.js"` | Con `NODE_ENV=production`, `npm install` omite `devDependencies` — sin esto no hay CLI de Prisma en el servidor |
| 4 | `client/.env.production` (**nuevo, comiteado**) | `VITE_API_URL=https://api.midominio.com/api` | No hay dashboard que la inyecte en build time |
| 5 | `client/public/.htaccess` (**nuevo**) | Fallback SPA + redirect HTTPS + cache headers (contenido en §1.3) | Sin esto, rutas de `react-router-dom` dan 404 al refrescar |
| 6 | `server/src/services/publicSchedule.service.js` (línea del `setCached` del caché público) | Agregar TTL de 60s | Defensa en profundidad ante Passenger corriendo más de un proceso — acota la ventana de inconsistencia sin tocar la invalidación explícita existente |
| 7 | *(condicional)* `server/package.json` | `bcrypt` → `bcryptjs` | Solo si falla la compilación nativa en el primer `npm install` real |
| 8 | *(condicional)* `server/prisma/schema.prisma` | `binaryTargets` explícitos | Solo si falla la autodetección del engine de Prisma |

Los ítems 1-6 son diseño cerrado, listos para pasarle a `backend-developer`/`frontend-developer`. Los ítems 7-8 se deciden con el resultado del primer deploy real.

---

## 3. Pipeline de CI/CD (GitHub → cPanel)

### 3.1 Estrategia principal

**Recomendada: GitHub Actions → SSH directo (rsync + comandos remotos)**, condicionada a que el plan de hosting tenga SSH (ver checklist §5, es la variable que decide todo el diseño).

Se evaluó la función nativa "Git™ Version Control" de cPanel con `.cpanel.yml` como alternativa — se descarta como motor principal: si hay SSH para hacer `git push` a un repo alojado en el cPanel, ese mismo SSH permite correr los comandos de deploy directo desde Actions, sin la capa intermedia de `.cpanel.yml` (poco documentada, variable entre versiones de cPanel). Se conserva igual como **mecanismo manual de respaldo** (§3.6): tenerlo configurado en el panel permite al admin, en una emergencia, apretar "Update from Remote" + "Deploy HEAD Commit" sin laptop ni credenciales SSH a mano.

**Nota clave: frontend y backend no dependen igual de SSH.** El frontend es solo archivos estáticos — se puede automatizar por FTP/SFTP incluso sin SSH interactivo (acción tipo `FTP-Deploy-Action`). El backend sí necesita ejecutar comandos remotos (`npm install`, migrar, restart), eso es lo que realmente requiere SSH. Por eso conviene diseñar los dos flujos por separado:

- **Frontend**: automatizado siempre, con o sin SSH.
- **Backend**: automatizado de punta a punta solo con SSH. Sin SSH ni Cron, cae a runbook semi-manual (§3.4).

### 3.2 Estructura del workflow de GitHub Actions

Un workflow (`.github/workflows/deploy.yml`), disparado en `push`/`pull_request` a `main`:

```
jobs:
  test-backend:
    - checkout, servicio postgres:16-alpine (mismo patrón que ya usan las
      pruebas reales del backend, que golpean una base real)
    - npm ci en server/
    - npx prisma migrate deploy   # valida las migraciones versionadas reales,
                                    # no `db push`
    - npm test  (vitest run)

  test-frontend:
    - checkout, npm ci en client/
    - npm run lint (oxlint, ya existe)
    - npm test (vitest run)
    - npm run build con VITE_API_URL de producción inyectada

  deploy:
    needs: [test-backend, test-frontend]
    if: push a main
    concurrency: { group: deploy-production, cancel-in-progress: false }
    steps:
      - build del frontend (o reusar artifact) con VITE_API_URL de producción
      - subir client/dist/ al docroot estático (rsync-ssh o sftp)
      - subir server/ (sin node_modules, sin .git, EXCLUYENDO explícitamente
        .env con --exclude=.env) al Application Root del backend
      - por SSH: activar el virtualenv del Node Selector && npm install
        (dispara postinstall -> prisma generate; si falla, el job se corta acá)
      - por SSH: npm run deploy:migrate
        (si falla, el job se corta acá — nunca se llega al restart)
      - por SSH: touch tmp/restart.txt
        (solo si el paso anterior salió con código 0)
      - smoke test: GET https://api.midominio.com/health, con reintentos
        cortos (Passenger tarda unos segundos en levantar el proceso nuevo)
```

`server/package.json` hoy no tiene ningún script de lint — no es bloqueante para este pipeline, pero es una tarea aparte a considerar.

### 3.3 Orden seguro de migraciones (punto crítico)

Passenger no permite encadenar "migrar y arrancar" como hacía el comando de arranque de Railway. Orden obligatorio:

1. **Subir código nuevo** — no interrumpe el proceso Passenger corriendo actualmente (solo se recicla al tocar `restart.txt`), así que el proceso viejo sigue sirviendo tráfico con código y schema viejos, consistentes entre sí.
2. **`npm install`** (con el `.env` de producción intacto) → dispara `postinstall: prisma generate`, regenerando el cliente para el schema nuevo, todavía sin aplicar.
3. **`npm run deploy:migrate`** → aplica las migraciones pendientes contra la base real. `prisma migrate deploy` tiene su propio lock interno (`_prisma_migrations`) contra migraciones concurrentes; el `concurrency: group: deploy-production` del workflow es una segunda barrera.
4. **Gate no negociable**: si el paso 3 falla, el job se corta ahí — nunca se llega al restart. El proceso viejo sigue corriendo sin downtime ni corrupción; el código nuevo queda en disco pero inerte hasta el próximo deploy exitoso; el fallo queda visible como ❌ en Actions.
5. **Solo si el paso 3 fue exitoso**: `touch tmp/restart.txt` → Passenger recicla el proceso con código + cliente Prisma + schema ya alineados.
6. **Smoke test** (`GET /health`) como confirmación final.

Si el pipeline se corta a mitad de camino (ej. se cae la conexión SSH), el próximo deploy reintenta desde el paso 1 sin problema — rsync, `npm install` y `prisma migrate deploy` son todos idempotentes.

### 3.4 Fallback si NO hay SSH (ni Cron)

Documentado como runbook explícito, no como automatización disfrazada:

1. Actions sigue corriendo el gate de tests + build en cada push (no depende del hosting).
2. Si pasa, sube `client/dist/` por FTP/SFTP automáticamente — el frontend queda resuelto igual.
3. Para el backend, Actions publica un artifact/Release descargable (zip de `server/` sin `node_modules` ni `.env`).
4. Pasos manuales irreductibles: subir el zip por File Manager (o vía Git Version Control con "Deploy HEAD Commit"), apretar "Run NPM Install", correr `npm run deploy:migrate` con el botón "Run JS script" del panel, tocar `restart.txt` (o botón "Restart").
5. Es operativamente aceptable para esta app (bajo tráfico, un admin, cambios poco frecuentes) pero no cumple la prioridad de "lo más automatizado posible" — si el hosting no ofrece SSH ni Cron, vale la pena evaluar un tier superior del mismo hosting antes de resignarse a este runbook.

**Intermedio, si hay Cron pero no SSH entrante**: un Cron Job (cada 5-15 min) que consulta el estado de checks del último commit de `main` vía la API de GitHub (token de solo lectura), y si está verde hace `git pull` + `npm install` + `deploy:migrate` + `restart` usando una llave SSH *saliente* del propio servidor hacia GitHub (dirección opuesta a la que el hosting podría estar bloqueando). Es polling, no push-triggered (latencia de minutos), pero mejor que el runbook 100% manual.

### 3.5 Manejo de secretos

**En GitHub Secrets** (solo lo que Actions necesita para conectarse y operar):

| Secret | Uso |
|---|---|
| `CPANEL_SSH_HOST` / `CPANEL_SSH_USER` / `CPANEL_SSH_PORT` | conexión SSH |
| `CPANEL_SSH_PRIVATE_KEY` | llave dedicada a este propósito, generada en "SSH Access" del panel — nunca la llave personal del admin |
| `VITE_API_URL` (producción) | para hornear el build del frontend en CI — no es secreto, pero conviene como variable de repo en vez de hardcodeada en el YAML |

**Lo que NUNCA va a GitHub Secrets**: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME`/`ADMIN_PASSWORD` reales de producción. Viven únicamente en el `.env` del Application Root del servidor. GitHub Actions nunca los necesita: no corre la app ni el seed contra producción, solo dispara comandos remotos que ya tienen esas variables disponibles vía `.env` en el propio servidor. El `--exclude=.env` del rsync (§3.2) es la protección concreta de que ningún deploy pisa ese archivo.

### 3.6 Rollback

**Recomendado: revertir el commit en GitHub y dejar correr el mismo pipeline**, con una red de seguridad barata adicional — no un sistema de releases versionadas estilo Capistrano (agrega complejidad que no se justifica para el volumen de esta app: una organización, bajo tráfico, un admin, y el Application Root de Node.js Selector está fijado en la config del panel, no pensado para apuntar a un symlink rotativo).

- **Primario**: `git revert` → push a `main` → mismo pipeline (tests, build, migrar, restart) corre de punta a punta. Minutos, reproducible, sin procedimiento especial que recordar.
- **Red de seguridad barata**: antes de sobrescribir el Application Root en cada deploy, el step de rsync guarda una copia (`tar.gz` con timestamp, reteniendo solo 1-2 backups por la cuota de disco). Si hace falta estar arriba ya, sin esperar el pipeline: reponer esa carpeta por SSH y tocar `restart.txt`.
- **Advertencia explícita, no automatizable**: un rollback de código nunca revierte el schema de base de datos solo. `prisma migrate deploy` no genera migraciones "down". Si el commit revertido incluía una migración ya aplicada, hay que evaluar a mano si hace falta una migración correctiva — automatizar un "down" mal escrito es más peligroso que no automatizarlo.

### 3.7 Monitoreo

- `GET /health` (ya existe, confirma conexión real a la base) es la base de todo.
- Smoke test dentro del propio pipeline (§3.2, último step) — la señal más directa de si un deploy rompió algo.
- Uptime externo gratuito (UptimeRobot, cron-job.org, Better Uptime) pegándole a `/health` cada 1-5 min, y opcionalmente a la página pública y a `GET /api/schedule/latest` — alerta por email/Slack.
- Sin dashboard de métricas nativo (limitación real del hosting, no se finge una solución que no existe). Si hay SSH/Cron, se puede agregar más adelante un resumen periódico de logs de error de Apache/Passenger — mejora futura, no parte de este primer despliegue.

---

## 4. Checklist a confirmar con el hosting ANTES de construir el pipeline

Bloqueante — varias partes del diseño de arriba cambian según las respuestas:

1. ~~¿El plan incluye SSH Access?~~ **Confirmado: sí.** Falta verificar el detalle: ¿permite agregar una llave pública sin restricción de IP de origen, o exige allowlisting? Los runners de GitHub Actions tienen IPs dinámicas — si el host exige IP fija, la estrategia principal (§3.1) queda bloqueada salvo runner autoalojado (fuera de alcance de este plan).
2. **¿Hay Cron Jobs?** Habilita el escenario intermedio de §3.4 si SSH entrante está bloqueado. Confirmar intervalo mínimo permitido.
3. **Límite de conexiones SSH concurrentes.**
4. **¿`rsync` está disponible en el servidor vía SSH?** Si no, cae a `scp`/`sftp`.
5. **Límite real de conexiones concurrentes de PostgreSQL del plan** — para fijar `connection_limit` con margen real, no un número arbitrario.
6. **Qué hace exactamente el botón "Run JS script" (o equivalente) del Node.js Selector**: si corre `npm run <script>` arbitrario y si muestra código de salida/stdout/stderr — de esto depende si el fallback de §3.4 es viable sin SSH.
7. **¿El SSH del panel permite conexiones salientes hacia GitHub?** (para Git Version Control como respaldo manual, §3.1, y para el modelo de Cron de §3.4).
8. **Cuota de disco** — para decidir cuántos backups de "release anterior" retener sin arriesgar la cuota.
9. **Versión de Node ofrecida por el Selector** — `server/package.json` declara `"node": ">=20"`; si el host solo ofrece ≤18, revisar compatibilidad de `bcrypt@6`, `express-rate-limit@8` y Prisma 6 antes de nada.
10. **Apache vs LiteSpeed** — ambos honran `.htaccess` y `tmp/restart.txt`, pero logs y mensajes de error difieren.
11. **¿Los backups automáticos de cPanel cubren PostgreSQL** o solo MySQL?
12. **Confirmar que `.env` en el Application Root queda realmente fuera del docroot** en la instalación concreta del hoster — verificar con `curl https://api.midominio.com/.env` tras el primer deploy (debe dar 404).
13. ~~¿Qué dominio va a la raíz?~~ **Confirmado: la página pública vive en un subdominio dedicado** (`app.midominio.com`), el dominio raíz queda libre. Falta solo definir los nombres reales de los dos subdominios a usar.

---

## 5. Checklist post-deploy (probar en el sitio real)

- [ ] `curl https://api.midominio.com/.env` responde 404 (Application Root no expuesto).
- [ ] `GET https://api.midominio.com/health` responde `{"status":"ok","database":"connected"}`.
- [ ] Página pública carga en `https://app.midominio.com` (esperado: "Todavía no hay un mes publicado" hasta finalizar el primer mes real).
- [ ] Refrescar directo en una ruta de admin (ej. `/admin/eventos`) no da 404 (confirma el `.htaccess` SPA).
- [ ] Login admin funciona con credenciales reales de producción.
- [ ] Crear una persona de prueba, importar un CSV de prueba.
- [ ] Crear un mes, sortear equipos, generar horario, finalizar el mes; confirmar que la página pública lo muestra.
- [ ] Verificar ICU/timezone con el one-liner de §1.7 y confirmar que el último domingo/sábado del mes calculan bien.
- [ ] Confirmar `req.ip` real (no `undefined`) para que el rate limiting no bloquee al admin.
- [ ] Borrar los datos de prueba si no correspondían a datos reales.

---

## 6. Seguridad — checklist antes de anunciar la URL a la organización

- [ ] `JWT_SECRET` y `ADMIN_PASSWORD` de producción nuevos, fuertes, distintos a cualquier valor de desarrollo.
- [ ] `trust proxy` configurado y verificado (§1.7).
- [ ] `CLIENT_ORIGIN` apunta exactamente a la URL real del frontend, nunca `*`.
- [ ] HTTPS activo en ambos vhosts (AutoSSL, confirmar igual).
- [ ] `.env` de producción con permisos `600`, fuera del docroot, nunca en el repo ni en GitHub Secrets.
- [ ] Backups de PostgreSQL confirmados activos (§4.11).
- [ ] Rate limiting confirmado activo en login y rutas admin, con `trust proxy` correcto detrás del proxy del hosting.

---

## 7. Fuera de alcance de este plan (a propósito)

- **Dominio propio**: si aún no está decidido, se resuelve apuntando el DNS al hosting cPanel — el mecanismo es independiente de este plan.
- **Alta disponibilidad / múltiples instancias del backend**: innecesario para el volumen de esta app; si algún día hiciera falta, primero hay que resolver el caché en memoria (ya mitigado con TTL en §2, ítem 6).
- **Ambientes de staging separados**: posible (segundo subdominio + segunda base) pero duplica consumo del plan — decisión del usuario, no asumida acá.
- **Sistema de releases versionadas estilo Capistrano**: evaluado y descartado en §3.6 por complejidad desproporcionada al volumen de esta app.
- **Des-finalizar un mes, historial en la página pública, y el resto de lo ya anotado como fuera de alcance en `CLAUDE.md`**: decisiones de producto, no de despliegue.

---

## Fuentes consultadas

- [Passenger — Reverse port binding (Node.js)](https://www.phusionpassenger.com/library/indepth/nodejs/reverse_port_binding.html)
- [CloudLinux — ERR_REQUIRE_ESM: Must use import to load ES Module](https://cloudlinux.zendesk.com/hc/en-us/articles/6719280681884--ERR-REQUIRE-ESM-Must-use-import-to-load-ES-Module)
- [CloudLinux — Node.js Selector](https://cloudlinux.com/getting-started-with-cloudlinux-os/42-profitability-and-php-features/959-nodejs-selector/)
- [InMotion Hosting — How To Setup Node.js App in cPanel](https://www.inmotionhosting.com/support/edu/cpanel/setup-node-js-app/)
- [DEV — CI/CD de Node.js en cPanel con Passenger y `tmp/restart.txt`](https://dev.to/msnmongare/how-to-set-up-a-nodejs-cicd-pipeline-on-cpanel-using-github-actions-and-passenger-208k)
- [LiteSpeed Docs — CloudLinux setup for cPanel con LSWS](https://docs.litespeedtech.com/lsws/cp/cpanel/cloudlinux/)
- [Prisma Docs — Deploy to a different OS (binaryTargets)](https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-to-a-different-os)
- [Rad Web Hosting — Guía de gestión de PostgreSQL en cPanel](https://blog.radwebhosting.com/full-guide-to-postgresql-database-management-in-cpanel/)
