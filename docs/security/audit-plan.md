# Plan de auditoría de seguridad — Organización de equipos y turnos de servicio

Estado: **plan, sin ejecutar**. Este documento define el alcance, el marco de referencia y las fases de la auditoría de seguridad del proyecto (server + client + CI/CD + despliegue en cPanel). No contiene hallazgos todavía — la ejecución es un trabajo posterior, fase por fase, que sí producirá un reporte con evidencia reproducible.

Elaborado a partir de la lectura de `CLAUDE.md`, la estructura real de `/server` y `/client`, `.github/workflows/deploy.yml`, `docs/deployment/cpanel-deployment-plan.md` y `server/package.json`/`client/package.json` (2026-09-05).

---

## 1. Alcance y objetivos

### Objetivo
Encontrar vulnerabilidades reales y accionables en el sistema completo — código, dependencias, configuración y cadena de entrega — priorizando la superficie de mayor sensibilidad de este proyecto en particular:

- **Datos de personas** (`Person`: `fullName`, `documentId` opcional, `category`, `isJoven`, `isAdultoMayor`) cargados manualmente o vía import masivo CSV/XLSX.
- **Autenticación de un único administrador** vía JWT (`server/src/services/auth.service.js`, `server/src/middleware/auth.js`), sin MFA, sin múltiples cuentas.
- **Página pública sin login** (`GET /api/schedule/latest`, `/history`, `/:year/:month` — `server/src/routes/schedule.routes.js` + `server/src/services/publicSchedule.service.js`) que expone equipos, integrantes y horario del mes vigente y hasta 12 meses de historial.
- **Import masivo de personas** (`server/src/services/importPeople.service.js`, CSV/XLSX vía `multer` en memoria + `papaparse`/`exceljs`).
- **Scraping saliente a un tercero** (`server/src/services/bibleSource.service.js`, BibleGateway) — única llamada de red saliente del backend a un dominio externo no controlado.
- **Pipeline CI/CD → cPanel** (`.github/workflows/deploy.yml`, `docs/deployment/cpanel-deployment-plan.md`) con acceso SSH real a producción y `rsync --delete`.

### Dentro de alcance
- Código fuente completo de `/server` (rutas, servicios, middlewares, `prisma/schema.prisma`, migraciones) y `/client` (páginas, componentes, llamadas `api/*.js`).
- Dependencias declaradas en `server/package.json` y `client/package.json` (y su árbol transitivo vía `package-lock.json`).
- Working tree y **historial completo de git** (`git log -p --all`) en busca de secretos.
- `.github/workflows/deploy.yml` y el proceso de despliegue documentado en `docs/deployment/cpanel-deployment-plan.md` y `docs/deployment/production-deployment-plan.md`.
- Pruebas dinámicas (DAST manual + herramientas si están disponibles) contra una instancia **local** del server (`npm run dev` en `/server` + Postgres local, puerto 5433 según README) o un entorno de staging equivalente.

### Fuera de alcance (por ahora / requiere autorización explícita)
- **Cualquier prueba activa contra `mindanza.lluviasdebendiciones.com` / `server.mindanza.lluviasdebendiciones.com` (producción real)** — sin autorización explícita del usuario, ni siquiera un escaneo "pasivo" agresivo. Como mucho, verificación de solo lectura de bajo impacto (`curl -I` puntual a un endpoint público, una vez) si el usuario ya lo autorizó en una sesión previa.
- Scraping intensivo o repetido contra `biblegateway.com` — cualquier prueba de `bibleSource.service.js` en DAST se hace contra un HTML de prueba capturado (ver `server/tests/bibleSource.test.js` como precedente) o con un número mínimo de requests reales, nunca en bucle.
- Ataques de denegación de servicio (volumétricos o de agotamiento de recursos) contra cualquier entorno, local o remoto.
- Ingeniería social, phishing, o pruebas contra la infraestructura del hosting (cPanel) más allá de lo que el pipeline documentado ya expone.
- Revisión de licencias de dependencias (solo si el usuario lo pide explícitamente después).
- Implementación de fixes de lógica de negocio o arquitectura — la auditoría entrega hallazgos + remediación concreta para `backend-developer`/`frontend-developer`/`devops-engineer`; solo se aplican en el momento fixes triviales y de bajo riesgo (headers, `.gitignore`, dependencias sin breaking changes).

---

## 2. Marco de referencia

Cada hallazgo de la ejecución se clasificará contra los tres ejes siguientes, siempre los tres cuando aplique. Esta sección mapea de antemano qué categorías son más probables en cada fase de este proyecto en particular, para enfocar la revisión.

| Fase | OWASP Top 10 (2021) / API Security Top 10 | NIST SSDF | Disciplina DevSecOps |
|---|---|---|---|
| 1. Reconocimiento | A05 (Misconfiguration), A01 (Broken Access Control) como hipótesis a validar | PW.1 (arquitectura), PO.5 (superficie de ataque documentada) | Mapeo manual (insumo para todas las demás) |
| 2. Secretos | A02 (Cryptographic Failures — gestión de claves), A05 | PS.2, PS.3 (protección de artefactos y secretos) | Secret scanning |
| 3. SCA | A06 (Vulnerable and Outdated Components) | PW.4 (componentes de terceros), RV.1 | SCA |
| 4. SAST | A01, A03 (Injection), A04 (Insecure Design), A07 (Auth Failures), A08 (Integrity Failures) | PW.5, PW.6, PW.7 (revisión de código) | SAST |
| 5. Config/Hardening | A02, A05, A07 | PW.6, PW.9 (configuración segura por defecto) | Config review |
| 6. DAST | A01 (BOLA/IDOR), A03, A07, API3:2023 (Excessive Data Exposure), API4:2023 (Lack of Resources & Rate Limiting) | PW.8 (pruebas), RV.1 | DAST |
| 7. Pipeline/CI-CD | A05, A08 (Software Supply Chain Integrity) | PS.1, PS.2, PS.3, PO.3 | Config review + secretos |
| 8. Consolidación | — (síntesis) | RV.1, RV.2, RV.3 | — |

ASVS se usa como checklist de profundidad en las fases 4 (SAST), 5 (Config) y 6 (DAST) — capítulos V2 (Autenticación), V4 (Control de acceso), V5 (Validación de entrada), V7/V14 (Configuración) — sin exigir cobertura completa de los ~280 ítems, priorizando lo relevante a este stack (JWT, Express, Prisma, React).

---

## 3. Fases del plan

### Fase 1 — Reconocimiento y mapeo de superficie de ataque

**Objetivo:** tener un inventario exacto de endpoints (públicos vs. admin), inputs externos y puntos de confianza cruzada, antes de escanear nada.

**Qué se revisa:**
- Inventario de rutas montadas en `server/src/routes/index.js`: confirmar cuáles llevan `requireAuth`/`adminLimiter` y cuáles no. Público sin auth: `POST /api/auth/login` (con `loginLimiter`) y todo `GET /api/schedule/*` (con `publicLimiter`, `server/src/routes/schedule.routes.js`). Todo lo demás debería ser admin.
- Casos especiales a verificar con lupa: `teams.routes.js`, `events.routes.js`, `eventGroups.routes.js`, `verses.routes.js` están montados en `"/"` (no con prefijo propio) y aplican `requireAuth`/`adminLimiter` **por ruta**, no con `router.use()` — el propio código lo señala como riesgo de diseño ("un `router.use` sin filtro de path... correría como middleware global"); hay que confirmar que **ninguna ruta nueva** en esos 4 archivos se haya agregado sin `requireAuth` por descuido (fácil de introducir en el futuro, dado el patrón).
- Inputs externos identificados:
  - Import CSV/XLSX de personas: `POST /api/people/import` (`server/src/services/importPeople.service.js`, `server/src/routes/people.routes.js` líneas de configuración de `multer`).
  - Referencia bíblica hacia scraping saliente: `book`/`chapter`/`verses` en `POST/PATCH /api/months/:id/verses` y `/api/verses/:verseId` (`server/src/routes/verses.routes.js`) → `server/src/services/bibleSource.service.js` → `biblegateway.com`.
  - Formularios del cliente que llegan a la API: alta/edición de personas (`client/src/pages/PeopleManager.jsx`), eventos y Congresos (`client/src/pages/EventsManager.jsx`, `client/src/components/domain/EventGroupsSection.jsx`), versículos (`client/src/components/domain/MonthVersesSection.jsx`).
  - Filtro por persona en la página pública (`client/src/pages/PublicSchedule.jsx`, `client/src/components/ui/SearchableSelect.jsx`) — confirmar que es client-side puro y no dispara una query server-side con el término crudo.
- Endpoints con parámetros de ruta candidatos a IDOR/BOLA: `/api/teams/:teamId`, `/api/events/:eventId`, `/api/event-groups/:groupId`, `/api/event-groups/turnos/:slotId`, `/api/verses/:verseId`, `/api/assignments/:id`, `/api/slots/:id`, `/api/months/:id/*` — documentar la relación real `id → monthCycleId` en `prisma/schema.prisma` para saber qué significa "otro mes" en cada uno.
- Modelo de datos sensible: `Person.documentId` (único, opcional), `isAdultoMayor`/`isJoven` (`server/prisma/schema.prisma`, modelo `Person`) — confirmar contra `CLAUDE.md` qué campos NO deberían salir en la respuesta pública (`isAdultoMayor` explícitamente no debe verse en público según reglas de negocio).

**Herramientas/comandos:** lectura manual + `Grep`/`Glob` (ya usado para este plan); sin herramientas automáticas en esta fase.

**Criterio de "hecho":** documento/tabla (puede vivir en el reporte final de ejecución) con: lista completa de endpoints, método, archivo:línea de definición, `requireAuth` sí/no, `adminLimiter`/`publicLimiter`/ninguno, y los 3-4 puntos de input externo con su archivo de entrada.

---

### Fase 2 — Escaneo de secretos

**Objetivo:** confirmar que ningún secreto real (JWT_SECRET, credenciales de BD, credenciales de cPanel/SSH) esté o haya estado en el repositorio, ni en el working tree ni en el historial.

**Qué se revisa:**
- Working tree: `server/.env.example`, `client/.env.example`, `client/.env.production` (**comprobar que este último, que sí está comiteado a propósito según `CLAUDE.md`/comentarios del propio workflow, solo contenga `VITE_API_URL` — una URL pública, no un secreto**), y confirmar que no exista ningún `server/.env` ni `client/.env` real trackeado (`git ls-files | grep -i env`).
- `.gitignore` (raíz): ya cubre `.env`, `.env.*.local`, `server/prisma/dev.db` — confirmar que sigue vigente y que no se agregó ningún archivo de credenciales real antes de que existiera esa entrada (revisar con `git log --follow` sobre cualquier `.env` que aparezca en el historial).
- Historial completo: `git log -p --all` buscando patrones `JWT_SECRET\s*=`, `postgresql://\S+:\S+@`, `PASSWORD\s*=`, `BEGIN (RSA|OPENSSH|PRIVATE) KEY`, `ADMIN_PASSWORD`, tokens de GitHub (`ghp_`, `github_pat_`), claves de API sueltas. Nota de reconocimiento previo (a re-verificar formalmente en la ejecución): una primera pasada con `grep` sobre `git log -p --all` solo encontró **placeholders de ejemplo** (`server/.env.example`, tablas de `README.md`) y una constante de test `REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!"` (fallback de desarrollo en tests, no un secreto de producción) — a confirmar con una herramienta dedicada, no dar por cerrado con un `grep` manual.
- `.github/workflows/deploy.yml`: confirmar que las credenciales de despliegue (`CPANEL_SSH_PRIVATE_KEY`, `CPANEL_SSH_HOST`, `CPANEL_SSH_PORT`, `CPANEL_SSH_USER`) se leen exclusivamente vía `secrets.*` de GitHub Actions y que ningún `run:` las imprime (`echo $SECRET` sin enmascarar) — la clave SSH ya viaja en base64 a propósito (documentado en el propio workflow), confirmar que el `echo` de esa línea no quede en el log de Actions en texto plano si algo falla.
- Confirmar en GitHub (con `gh secret list` si el usuario da acceso) que los secretos usados (`CPANEL_SSH_*`) existen como Repository/Environment secrets y no como variables de entorno del workflow en texto plano.

**Herramientas/comandos:**
- Ideal: `gitleaks detect --source . --log-opts="--all"` o `trufflehog git file://. --since-commit <primer-commit>` — **no instalados en este entorno** (confirmado: `gitleaks`/`trufflehog` no están en `PATH`). Si `docker` está disponible (confirmado que sí lo está en este entorno), correr como alternativa sin instalar nada localmente: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source=/repo --log-opts="--all"`.
- Sustituto manual si ni docker ni las herramientas están disponibles en el momento de ejecutar: `git log -p --all | grep -inE "<patrones de arriba>"` — documentado explícitamente como hallazgo de proceso (`PW.7`/`PS.1`) si se termina dependiendo solo de esto, porque un grep manual tiene falsos negativos que gitleaks no tiene (patrones de entropía, formatos de clave que no matchean un regex simple).

**Criterio de "hecho":** reporte explícito de qué herramienta corrió (o por qué no pudo), resultado (secretos encontrados o no), y si se encontró alguno: si sigue activo en el working tree actual, o solo en historial (en cuyo caso la recomendación es **rotar igual**, nunca solo "borrar el commit").

---

### Fase 3 — SCA (análisis de composición de software)

**Objetivo:** identificar CVEs conocidas y paquetes sin mantenimiento en las dependencias reales de `/server` y `/client`.

**Qué se revisa — dependencias declaradas hoy:**
- `/server` (`server/package.json`): `@prisma/client`/`prisma` ^6.19.1, `bcrypt` ^6.0.0, `cheerio` ^1.2.0 (parsea HTML no confiable de BibleGateway — atención prioritaria), `cors` ^2.8.6, `dotenv` ^17.4.2, `exceljs` ^4.4.0 (parseo de XLSX del import masivo — atención prioritaria, históricamente con CVEs de ReDoS/prototype pollution en el ecosistema de parsers de Office), `express` ^4.22.2, `express-rate-limit` ^8.6.2, `helmet` ^8.3.0, `jsonwebtoken` ^9.0.3 (atención prioritaria — algoritmo/verificación), `multer` ^2.2.0 (atención prioritaria — recibe el archivo del import), `papaparse` ^5.5.4 (parseo de CSV — atención prioritaria), `zod` ^4.4.3.
- `/client` (`client/package.json`): `react`/`react-dom` ^19.2.8, `react-router-dom` ^7.18.2, y devDependencies (`vite` ^8.2.0, `oxlint` ^1.75.0, `vitest`/`@testing-library/*`) — menor prioridad al no llegar a producción, pero igual auditables por si afectan la cadena de build.
- Revisar `package-lock.json` de ambos paquetes (no solo `package.json`) para ver versiones resueltas reales del árbol transitivo.

**Herramientas/comandos:**
- `cd server && npm audit --production` (y sin `--production` aparte, para ver también devDependencies como `supertest`/`vitest` — menor riesgo pero igual reportable).
- `cd client && npm audit --production`.
- Si hay hallazgos con fix disponible: evaluar `npm audit fix` (sin `--force` primero) y documentar si el fix es breaking (major bump) comparando el rango semver actual vs. el sugerido.
- Complemento si está disponible: `docker run --rm -v "$PWD:/src" returntocorp/semgrep semgrep ci` no aplica a SCA — para SCA complementario usar `snyk test` si el usuario tiene cuenta/token (**no confirmado disponible en este entorno**), o `dependency-check` vía Docker (`owasp/dependency-check`) como segunda fuente de CVEs distinta a la de npm.

**Criterio de "hecho":** tabla de hallazgos por paquete (severidad de `npm audit`, CVE si aplica, versión afectada → versión con fix, breaking sí/no), con foco explícito en el resultado de `cheerio`, `exceljs`, `multer`, `papaparse`, `jsonwebtoken`.

---

### Fase 4 — SAST (análisis estático de código)

**Objetivo:** revisar manualmente y con herramienta el código de mayor riesgo de `/server` y `/client`.

**Qué se revisa (prioridad, ya explorado parcialmente en el reconocimiento):**
1. **Prisma / queries**: confirmado en el reconocimiento que el único `$queryRaw` de todo `/server` es `SELECT 1` sin interpolación en `server/src/app.js` (`/health`) — sin inyección SQL evidente por esta vía. Igual, en la ejecución: `grep -rn "\$queryRaw\|\$executeRaw"` de nuevo sobre el estado real del código en el momento de auditar (por si se agregó algo nuevo desde este reconocimiento) y revisar cada uso del cliente Prisma normal en los `services/*.js` en busca de algún `where` construido con concatenación de strings en vez de objetos tipados (no debería haber, Prisma normal parametriza, pero se verifica).
2. **JWT** (`server/src/services/auth.service.js`, `server/src/middleware/auth.js`): algoritmo usado por `jwt.sign`/`jwt.verify` (confirmar que no se acepta `alg: none` ni se deja que el cliente elija algoritmo — `jsonwebtoken` por defecto firma HS256 y no fue configurado explícito, verificar), expiración (`TOKEN_TTL = "8h"`, confirmar que aplica y no hay refresh silencioso), dónde vive `JWT_SECRET` (`server/src/config/env.js`, validado con zod `min(16)` — evaluar si 16 caracteres mínimos es suficiente entropía para HS256 en un sistema con datos de personas), y que `verifyToken` no trague excepciones de forma insegura.
3. **Middleware de autenticación/autorización**: confirmar que **todas** las rutas administrativas nuevas (Congreso `eventGroups.routes.js`, versículos `verses.routes.js`, Servicio de jóvenes en `teams.routes.js`) llevan `requireAuth` en cada handler — patrón de riesgo ya señalado en Fase 1 por estar montadas en `"/"` con auth por ruta en vez de por router.
4. **Import CSV/XLSX** (`server/src/services/importPeople.service.js`): revisar `FULLNAME_REGEX`/`DOCUMENT_REGEX` y el manejo de encoding (UTF-8 → latin1 fallback documentado en `CLAUDE.md`) en busca de ReDoS en las regex; buscar explícitamente si algún campo de texto libre (`notes`, `fullName`) se reexpone después en un CSV de exportación o en el cliente sin sanitizar los caracteres `=`, `+`, `-`, `@` iniciales (CSV injection / fórmula maliciosa al reabrir en Excel) — **a confirmar si existe alguna función de exportación** (no vista en el reconocimiento inicial, verificar si `PeopleManager.jsx` u otra pantalla ofrece "descargar CSV"). Revisar también límites ya presentes (`MAX_DATA_ROWS = 2000`, `multer` limitado a 2 MB / 1 archivo, `fileFilter` por extensión+mimetype) como controles ya existentes a confirmar que siguen activos.
5. **Scraping a BibleGateway** (`server/src/services/bibleSource.service.js`): confirmado en el reconocimiento que `book`/`chapter`/`verses` se validan con zod (`VERSES_REGEX`, `chapter` entero, `book` string libre hasta 50 caracteres) antes de armar la URL con `encodeURIComponent` hacia un host fijo (`biblegateway.com`) — sin SSRF hacia hosts arbitrarios. **Hallazgo candidato a confirmar en la ejecución**: el `fetch()` de `fetchVerseText` no tiene ningún timeout/`AbortController` configurado — si BibleGateway no responde, la request queda colgada solo limitada por el timeout por defecto de Node/`fetch` (potencialmente largo), lo que combinado con que este endpoint es admin-only y de bajo volumen reduce el impacto, pero sigue siendo una dependencia externa sin cota de tiempo explícita en un flujo síncrono de request/response. Revisar también el uso de `cheerio` (`extractPassageText`) por si algún selector permite que HTML controlado indirectamente (no es el caso aquí, el HTML viene de BibleGateway, no del usuario) dispare algo — riesgo bajo, documentar igual por ser la única dependencia de parseo de HTML no confiable del proyecto.
6. **Cliente React**: confirmado en el reconocimiento que no hay ningún `dangerouslySetInnerHTML` en `/client/src`. Revisar además: `eval`/`new Function()` dinámico (no visto, confirmar con grep en la ejecución), comparaciones de token/contraseña sin tiempo constante (backend usa `bcrypt.compare`, que sí es de tiempo constante — confirmar que no hay ninguna comparación `===` de tokens en otro lado), y `AuthContext.jsx`/`client/src/api/client.js` para ver dónde se guarda el JWT en el navegador (`localStorage` vs. cookie) y las implicancias de XSS si lo primero.
7. **CORS/Helmet** (`server/src/app.js`): confirmado `helmet()` con defaults y `cors({ origin: env.CLIENT_ORIGIN, credentials: true })` — no hay `origin: "*"` con credenciales (sería crítico combinado). Confirmar en la ejecución qué CSP efectiva deja Helmet por defecto (Helmet 8 trae CSP básica activada por defecto) y si alcanza para una SPA servida desde otro dominio/subdominio, o si conviene una CSP explícita.

**Herramientas/comandos:**
- **Semgrep no está instalado en este entorno** (confirmado, no está en PATH). Alternativa sin instalar nada: correrlo vía Docker (disponible): `docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep --config=p/owasp-top-ten --config=p/nodejsscan --config=p/react /src`. Si Docker tampoco es viable en el momento de ejecutar, documentarlo como hallazgo de proceso (`PW.7`: falta de SAST automatizado en el proyecto) y apoyarse en la revisión manual de esta fase + `oxlint`/reglas propias.
- `/client` ya tiene lint instalado y corriendo en CI (`client/package.json` script `"lint": "oxlint"`, usado en `test-frontend` de `deploy.yml`) — correrlo también en la auditoría (`cd client && npm run lint`) y revisar si sus reglas cubren algo de seguridad (oxlint es principalmente correctness/estilo, no seguridad — documentar la brecha).
- `/server` **no tiene ningún script de lint** en `server/package.json` — hallazgo de proceso a documentar (`PW.7`) independientemente de lo que encuentre el resto del SAST. Como mínimo aceptable para esta auditoría: `npx eslint server/src --no-eslintrc --plugin security --rule '{"security/detect-object-injection":"warn", ...}'` requiere instalar `eslint` + `eslint-plugin-security` ad-hoc (no instalados) — evaluar en el momento si instalar temporalmente (sin commitear el cambio) es aceptable, o quedarse con la revisión manual guiada por los 7 puntos de arriba.

**Criterio de "hecho":** cada uno de los 7 puntos de arriba con veredicto explícito (confirmado seguro / hallazgo con severidad), más el resultado de `oxlint` y de Semgrep si pudo correr (o la nota de que no pudo y por qué).

---

### Fase 5 — Revisión de configuración y hardening

**Objetivo:** confirmar la configuración de seguridad efectiva del server (no solo que el código "debería" ser seguro, sino que la config activa lo es).

**Qué se revisa:**
- Headers de seguridad reales: levantar el server local (`cd server && npm run dev`) y `curl -I http://localhost:4000/health` y `curl -I http://localhost:4000/api/schedule/latest` — confirmar qué manda `helmet()` con su configuración por defecto (`X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors` vía CSP, `Strict-Transport-Security` — este último no aplica en HTTP local, sí a confirmar en producción vía HTTPS si el usuario autoriza esa verificación puntual).
- CORS efectivo: confirmar con un request `Origin` distinto al configurado que el navegador (o `curl` simulando el preflight) recibe rechazo, y que `CLIENT_ORIGIN` en producción (`docs/deployment/cpanel-deployment-plan.md` §1.5) apunta exactamente al dominio público, no a `*` ni a un valor de desarrollo olvidado.
- `NODE_ENV`: confirmar que `env.js` no tiene ningún branch que relaje validaciones si `NODE_ENV !== "production"` de forma que pudiera colarse a producción, y que el mensaje de error de `server/src/middleware/errorHandler.js` no filtra stack traces al cliente cuando corre en modo producción (revisar ese archivo específicamente, no visto aún en el reconocimiento).
- Rate limiting configurado (`server/src/middleware/rateLimit.js`): tres limitadores (`loginLimiter` 10/15min, `publicLimiter` 60/min, `adminLimiter` 300/min) — confirmar en Fase 6 (DAST) que efectivamente cortan, acá solo se revisa que estén montados en los puntos correctos (`routes/index.js`, `auth.routes.js`, `schedule.routes.js`, y por-ruta en `teams.routes.js`/`events.routes.js`/`eventGroups.routes.js`/`verses.routes.js`).
- Variables de entorno: `server/src/config/env.js` valida con zod y falla al arrancar si falta algo — confirmar que esta validación cubre TODO lo sensible (`JWT_SECRET`, `DATABASE_URL`, `ADMIN_PASSWORD`) y no hay ningún valor sensible con default hardcodeado como fallback silencioso en el código de producción (distinto de los fallbacks de test, ya identificados en Fase 2).
- `.gitignore` (ver también Fase 2): confirmar cobertura de `.env`, `*.pem`, certificados, y cualquier archivo de credenciales real.
- Revisar `server/src/middleware/validate.js` (no explorado aún) para confirmar el mecanismo genérico de validación de `body`/`params`/`query` con zod que usan todas las rutas — es el control central de entrada del backend, vale la pena confirmar que no tiene ningún bypass (ej. rutas que reciben `req.body` sin pasar por `validate()`).

**Herramientas/comandos:** `curl -I`/`curl -v` contra localhost; lectura de `server/src/middleware/errorHandler.js` y `server/src/middleware/validate.js` (pendientes de leer en la ejecución); sin herramientas automáticas nuevas más allá de lo ya cubierto.

**Criterio de "hecho":** checklist de headers presentes/ausentes contra localhost, confirmación de CORS restrictivo, confirmación de que errores no filtran stack traces en modo producción, y inventario de qué variables de entorno son verdaderamente rotable-sin-tocar-código (todas deberían serlo, según `CLAUDE.md`).

---

### Fase 6 — DAST contra entorno local/staging

**Objetivo:** verificar en runtime (no en el código) que las protecciones de autenticación, autorización y rate limiting funcionan de verdad, y buscar inyección real en los inputs identificados en Fase 1.

**Precondición:** server local corriendo (`cd server && npm run dev`, Postgres en Docker puerto 5433 según README) con `prisma/seed.js` corrido — **nunca contra producción sin autorización explícita** (ver §5 Riesgos).

**Qué se prueba:**
- **Autenticación**: `POST /api/auth/login` con credenciales inválidas repetidas → confirmar que `loginLimiter` corta a partir del intento 11 dentro de la ventana de 15 min (`server/src/middleware/rateLimit.js`); mensaje de error genérico igual para usuario inexistente vs. password incorrecta (ya confirmado en el código de `auth.service.js`, verificar en runtime que el tiempo de respuesta no delata cuál de las dos fue — timing side-channel, dado que `bcrypt.compare` no corre si el usuario no existe).
- **Autorización — endpoints admin sin token / token inválido / token expirado**: para cada endpoint del inventario de Fase 1 marcado como admin, request sin header `Authorization`, con un JWT manipulado (firma inválida), y con un JWT expirado (generable con `jsonwebtoken` y `expiresIn: "-1s"` en un script de prueba) → confirmar `401` en los tres casos, incluidos explícitamente los 4 routers "montados en `/`" (`teams.routes.js`, `events.routes.js`, `eventGroups.routes.js`, `verses.routes.js`) por ser el patrón de mayor riesgo de que una ruta nueva quede desprotegida.
- **BOLA/IDOR**: crear (o usar del seed) dos `MonthCycle` distintos, y probar cruzar IDs: `PATCH /api/teams/:teamId` de un mes contra el token válido pero pidiendo un `teamId` de otro contexto no relacionado; `GET/PATCH` de `/api/events/:eventId`, `/api/event-groups/:groupId`, `/api/verses/:verseId`, `/api/slots/:id`, `/api/assignments/:id` con IDs válidos pero de otro mes — el modelo es de un solo admin, así que el riesgo de IDOR clásico "otro usuario" no aplica, pero sí aplica el riesgo de **lógica de negocio cruzada** (ej. ¿un `PATCH /api/assignments/:id` puede reasignar una asignación a un `teamId` que no pertenece al mes de ese slot? ¿un turno de un mes `FINALIZED` y pasado se puede editar igual pese a `409 MES_PASADO` esperado?) — probar explícitamente el `409 MES_PASADO` documentado en `CLAUDE.md` contra un mes realmente pasado.
- **Exposición de datos en endpoints públicos**: `GET /api/schedule/latest`, `/history`, `/:year/:month` — comparar el JSON real devuelto campo por campo contra lo que `CLAUDE.md` dice que debe verse: **no debe aparecer** `isAdultoMayor` en ningún integrante (regla explícita: "nunca aparece en la página pública, ni siquiera para el líder"), no debe aparecer `documentId`, no deben aparecer los roles "Apoyo"/"Ministro" (solo "Líder", según `CLAUDE.md`) ni ningún campo de `AdminUser`. Confirmar contra el `TEAM_SELECT` real de `server/src/services/teamGeneration.service.js` (que sí incluye `isAdultoMayor` puertas adentro para el sorteo — el riesgo concreto es que ese mismo `select` u otro compartido se reutilice sin filtrar para el payload público).
- **Rate limiting de `publicLimiter`**: ráfaga controlada (60+ requests/min) contra `GET /api/schedule/latest` en local → confirmar `429` a partir del umbral.
- **Inyección con payloads básicos**:
  - Nombre de persona con `<script>alert(1)</script>` vía `POST /api/people` y vía el import CSV → confirmar que el backend lo rechaza (`FULLNAME_REGEX` ya exige solo letras/espacios/`'.-`) y que si algo pasara, el cliente no lo interpreta como HTML (ya confirmado sin `dangerouslySetInnerHTML`, pero validar en runtime el render real de `MemberList.jsx`/`TeamCard.jsx`).
  - Referencia bíblica con caracteres de control o intento de path traversal (`book: "../../etc"`, `verses: "1 OR 1=1"`) vía `POST /api/months/:id/verses` → confirmar que `VERSES_REGEX`/límite de 50 caracteres en `book` lo rechazan con `400` antes de llegar a `bibleSource.service.js`.
  - CSV de import con una celda que empiece con `=`, `+`, `-`, `@` (CSV injection / fórmula) → confirmar si el dato se persiste tal cual y si existe algún flujo de re-exportación a CSV que reabra ese riesgo en Excel (a confirmar en Fase 4 si existe exportación).
- **Servicio caído / mensajes de error**: forzar un 500 real (ej. desconectando Postgres momentáneamente en local) y confirmar que `server/src/middleware/errorHandler.js` no devuelve el stack trace ni detalles internos al cliente.

**Herramientas/comandos:** `curl`/scripts de bash reproducibles (documentar cada comando exacto usado, no solo el resultado); **OWASP ZAP no está instalado en este entorno** — si Docker es viable en el momento de ejecutar: `docker run --rm -t owasp/zap2docker-stable zap-baseline.py -t http://host.docker.internal:4000` contra el server local únicamente, nunca contra producción. Si no es viable, las pruebas manuales con `curl` documentadas arriba son el sustituto y deben quedar reproducibles.

**Criterio de "hecho":** cada uno de los puntos de arriba con resultado PASS/FAIL y el comando/request exacto usado; particular atención a que el payload público de `/api/schedule/*` se haya comparado campo por campo contra la regla de negocio, no solo "se ve razonable".

---

### Fase 7 — Revisión del pipeline CI/CD y del proceso de despliegue

**Objetivo:** auditar la cadena de entrega como superficie de ataque, no solo el código de la aplicación.

**Qué se revisa (`.github/workflows/deploy.yml`, `docs/deployment/cpanel-deployment-plan.md`):**
- **Permisos del `GITHUB_TOKEN`**: el workflow no declara ningún bloque `permissions:` explícito → corre con los permisos por defecto del repositorio (potencialmente de escritura amplia). Confirmar el default configurado a nivel de repo/organización y recomendar `permissions: contents: read` (o el mínimo necesario) explícito a nivel de workflow o de cada job, en particular porque el trigger incluye `pull_request` (jobs `test-backend`/`test-frontend` corren sobre PRs, incluidos los de forks si el repo lo permite — confirmar si el repo acepta PRs de forks y si eso importa dado que esos dos jobs no usan `secrets.*`).
- **Acciones de terceros no fijadas a SHA**: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4` — todas fijadas a un tag mayor (`@v4`), no a un SHA de commit concreto ni siquiera a una versión de parche exacta. Es una acción first-party de GitHub (menor riesgo que una acción de un tercero desconocido), pero sigue siendo una superficie de supply-chain: un tag puede reapuntarse. Evaluar si fijar a SHA es proporcional para este proyecto o si el riesgo residual es aceptable dado que son acciones oficiales de `actions/`.
- **Gate de seguridad antes de desplegar**: confirmar que el pipeline hoy corre `npm ci` + `prisma migrate deploy` + `npm test` (backend) y `npm ci` + `npm run lint` + `npm test` + `npm run build` (frontend) **pero ningún `npm audit` ni escaneo de dependencias/secretos** antes de `deploy` — hallazgo de proceso esperable (confirmar y documentar formalmente), con recomendación concreta: agregar un step `npm audit --audit-level=high` (o equivalente) como gate no bloqueante inicialmente, o un job de Semgrep/gitleaks vía Docker, antes del job `deploy`.
- **Secretos del pipeline**: `CPANEL_SSH_PRIVATE_KEY` (viajando en base64 dentro del secret, documentado a propósito en el propio workflow para evitar corrupción de saltos de línea), `CPANEL_SSH_HOST`, `CPANEL_SSH_PORT`, `CPANEL_SSH_USER` — confirmar que ninguno se imprime en un log (`echo "${{ secrets.X }}"` sin redirigir a un archivo, o cualquier `set -x` que los exponga) y que GitHub Actions efectivamente enmascara su valor en el log si accidentalmente aparecieran.
- **Integridad del artifact**: el bug histórico ya documentado en `CLAUDE.md`/el propio `deploy.yml` (`actions/upload-artifact@v4` excluía dotfiles por defecto → `.htaccess` se perdía en cada deploy → 404 en rutas `/admin/*`, corregido con `include-hidden-files: true`) es el antecedente directo a **no repetir**: confirmar que ese flag sigue presente y considerar si hace falta una verificación adicional (ej. un paso que liste el contenido del artifact/`client/dist` esperado — `.htaccess`, `index.html`, assets — antes de subirlo) para detectar una regresión de este tipo automáticamente en vez de depender de reportes manuales de usuarios en producción.
- **Smoke test post-deploy**: el único smoke test actual es `GET /health` con reintentos (`deploy.yml`, step final) — confirma que el proceso levantó y la base conecta, pero **no verifica nada de seguridad** (headers presentes, que `/admin` no devuelva 404 — justamente el bug histórico que motivó el fix del `.htaccess` — ni que no haya quedado expuesto algún endpoint de debug). Evaluar agregar al smoke test: un `curl -I` a la URL pública del frontend confirmando código 200 en una ruta profunda tipo `/admin/people` (para detectar el próximo bug de SPA fallback antes de que un usuario lo reporte) y un `curl -I` al backend confirmando la presencia de al menos un header de Helmet.
- **Orden de migración/despliegue**: confirmar contra `docs/deployment/cpanel-deployment-plan.md §3.3` que si la migración de base de datos falla, el job se corta antes del restart (ya documentado como comportamiento buscado) — validar que sigue siendo así leyendo el YAML actual (`deploy.yml`, paso "Migrar base de datos" seguido del comentario explícito sobre este comportamiento).
- **Acceso SSH sin restricción de IP** (`docs/deployment/cpanel-deployment-plan.md §8.5`, ya documentado como hallazgo del primer deploy real) — confirmar si sigue siendo así hoy y si el hosting cPanel permite restringir por IP de origen (los runners de GitHub Actions usan rangos de IP dinámicos, así que puede no ser trivial, pero vale la pena confirmar qué opciones ofrece el hosting: allowlist de rango, IP fija de un runner autohospedado, etc.).
- **`ignore-scripts` en el install de producción**: `npm install --ignore-scripts` en el paso de deploy — confirmar que esto no rompe algo necesario (ya que `postinstall` normalmente corre `prisma generate`, y el paso siguiente lo corre aparte a mano con `npx prisma generate`) y evaluar si `--ignore-scripts` es además una mitigación deliberada contra scripts maliciosos de postinstall en dependencias comprometidas (buena práctica de supply-chain si es intencional — confirmar con el equipo si lo fue).

**Herramientas/comandos:** lectura manual de `.github/workflows/deploy.yml` y `docs/deployment/cpanel-deployment-plan.md`; `gh secret list`/`gh api repos/:owner/:repo/actions/permissions` si el usuario da acceso vía `gh` CLI para confirmar configuración real del repo (permisos por defecto del token, secretos existentes) en vez de solo inferir del YAML.

**Criterio de "hecho":** checklist de los 9 puntos de arriba con veredicto (conforme / hallazgo), y confirmación explícita de que el flag `include-hidden-files: true` sigue presente en el YAML vigente al momento de auditar.

---

### Fase 8 — Consolidación de hallazgos y priorización

**Objetivo:** convertir el trabajo de las fases 1-7 en un reporte único, priorizable, no una lista plana.

**Qué se hace:**
- Consolidar todos los hallazgos de las fases 2-7 (Fase 1 es insumo, no genera hallazgos propios) en una única lista, cada uno con el formato de la sección 4.
- Matriz de priorización **severidad × esfuerzo de remediación** (2 ejes: Crítica/Alta/Media/Baja/Informativa vs. Trivial/Bajo/Medio/Alto esfuerzo) — los hallazgos Crítica/Trivial y Crítica/Bajo van primero sin excepción; el resto se ordena por severidad y luego por esfuerzo ascendente dentro de cada nivel.
- Distinguir explícitamente hallazgos ya remediados en el momento de la auditoría (fixes triviales aplicados directamente, ej. un header faltante agregado) de los que quedan pendientes de asignar a `backend-developer`/`frontend-developer`/`devops-engineer`.
- Registrar también lo que **sí pasó** cada prueba (rate limiting, ausencia de SQL injection vía `$queryRaw`, ausencia de `dangerouslySetInnerHTML`, CORS no-wildcard, etc.) — evita que un lector confunda "no revisado" con "revisado y correcto".

**Criterio de "hecho":** documento de reporte final (no este plan) con resumen ejecutivo (conteo por severidad + top 2-3 hallazgos urgentes) y detalle completo hallazgo por hallazgo.

---

## 4. Cronograma / orden de ejecución sugerido

```
Fase 1 (Reconocimiento) ──┬──> Fase 2 (Secretos)         [independiente, puede ir en paralelo con 3]
                          ├──> Fase 3 (SCA)               [independiente, puede ir en paralelo con 2]
                          └──> Fase 4 (SAST)               [depende del inventario de Fase 1]
                                     │
                                     ▼
                          Fase 5 (Config/Hardening)        [depende de hallazgos de Fase 4 sobre env/CORS/JWT]
                                     │
                                     ▼
                          Fase 6 (DAST local)              [depende de 1, 4 y 5: necesita el inventario de
                                                             endpoints y saber qué esperar antes de probar en runtime]
                                     │
                          Fase 7 (Pipeline/CI-CD) ─────────┘ [independiente del resto, puede correr en paralelo
                                                               con 2-6 en cualquier momento después de la Fase 1]
                                     │
                                     ▼
                          Fase 8 (Consolidación)           [depende de que 2-7 estén cerradas]
```

- **Fase 1** siempre primero, es insumo del resto.
- **Fases 2, 3 y 7** son independientes entre sí y de 4/5/6 — pueden ejecutarse en paralelo apenas termina la Fase 1 si hay más de una persona/sesión disponible.
- **Fase 4 (SAST)** debería preceder a **Fase 5 (Config)** y **Fase 6 (DAST)**: encontrar en código dónde vive el JWT, el CORS y la validación de entrada informa qué probar en runtime, evita DAST "a ciegas".
- **Fase 6 (DAST)** va al final del bloque técnico porque requiere tener el server local corriendo y el inventario + hallazgos estáticos ya en mano, para saber exactamente qué confirmar en runtime (evita repetir descubrimiento que ya se hizo leyendo código).
- **Fase 8** cierra, una sola vez, cuando el resto está terminado.

Estimación de esfuerzo relativo (no tiempo en horas, orden de magnitud entre fases): Fase 1 y Fase 2 son las más rápidas; Fase 4 (SAST manual, sin Semgrep instalado) y Fase 6 (DAST manual con `curl`, sin ZAP instalado) son las más largas por depender de revisión/pruebas manuales en vez de herramienta automatizada.

---

## 5. Formato de reporte final (a usar en la ejecución)

Cada hallazgo de la ejecución de este plan seguirá el mismo formato ya establecido como estándar de trabajo:

1. **Qué es y dónde** — archivo:línea o endpoint/comando exacto, con evidencia real (output de comando, request/response, snippet de código). Nunca "podría haber un problema de X".
2. **Severidad** (Crítica/Alta/Media/Baja/Informativa) con justificación de impacto × explotabilidad en el contexto real de este proyecto.
3. **Clasificación**: categoría OWASP (Top 10 y/o API Security Top 10), práctica NIST SSDF (PO/PS/PW/RV), y disciplina DevSecOps que lo detecta (SAST/DAST/SCA/secretos/config).
4. **Remediación concreta** — cambio específico; si es trivial y de bajo riesgo (header, `.gitignore`, dependencia sin breaking) se implementa directamente durante la ejecución y se documenta; si toca lógica de negocio/arquitectura, se entrega a `backend-developer`/`frontend-developer`/`devops-engineer` con contexto suficiente para no re-investigar desde cero.
5. Registro explícito de lo que **sí** se revisó y pasó la prueba, no solo lo que falló.

El reporte final incluye además un **resumen ejecutivo** (conteo de hallazgos por severidad + los 2-3 más urgentes) antes del detalle completo.

---

## 6. Riesgos y salvaguardas de la propia auditoría

- **Nunca** ejecutar DAST agresivo, fuzzing, o pruebas con efecto de denegación de servicio contra `mindanza.lluviasdebendiciones.com` / `server.mindanza.lluviasdebendiciones.com` sin autorización explícita del usuario en el momento de la ejecución — el plan asume entorno local (`npm run dev` + Postgres Docker puerto 5433) como target de DAST por defecto.
- **Nunca** hacer scraping repetido/intensivo contra `biblegateway.com` — cualquier prueba de `bibleSource.service.js` se limita a un puñado de requests reales (idealmente reutilizando el HTML de prueba ya capturado en `server/tests/bibleSource.test.js`) para no generar carga sobre un tercero ni arriesgar que bloquee la IP del proyecto.
- Si en algún momento de la ejecución se necesita correr algo contra producción (ej. confirmar headers reales servidos, o el smoke test de la Fase 7), debe ser **de solo lectura, una sola vez, y con confirmación explícita del usuario en esa sesión** — no basta con que este plan lo mencione como posible.
- Ningún fix de lógica de negocio o arquitectura se implementa por cuenta propia durante la ejecución — solo remediaciones triviales de bajo riesgo (headers, `.gitignore`, bump de dependencia sin cambio de API), siempre documentadas explícitamente en el reporte.
- Si alguna herramienta planeada (Semgrep, gitleaks, ZAP, Snyk) no está disponible al momento de ejecutar y tampoco es viable vía Docker en ese momento, se documenta explícitamente como hallazgo de proceso (`PW.7`) y se usa el sustituto manual descrito en cada fase — nunca se omite la disciplina en silencio.
- Cualquier credencial real que aparezca durante la Fase 2 (secretos) se reporta con recomendación de **rotación inmediata**, incluso si ya no está en el HEAD actual del repositorio — un secreto commiteado y luego borrado sigue expuesto en el historial de git.

---

## 7. Herramientas: inventario de disponibilidad (confirmado 2026-09-05)

| Herramienta | Disponible en este entorno | Alternativa si no está |
|---|---|---|
| `npm audit` | Sí (viene con Node/npm, usado en ambos paquetes) | — |
| `oxlint` (client) | Sí (`client/package.json`, ya corre en CI) | — |
| ESLint + `eslint-plugin-security` (server) | No instalado, `/server` no tiene script de lint | Instalar ad-hoc sin commitear, o revisión manual guiada (Fase 4) |
| Semgrep | No en PATH | `docker run ... semgrep/semgrep` (Docker sí disponible) |
| gitleaks / trufflehog | No en PATH | `docker run ... zricethezav/gitleaks` o `grep` manual sobre `git log -p --all` |
| OWASP ZAP | No en PATH | `docker run ... owasp/zap2docker-stable` contra localhost únicamente |
| Snyk | No en PATH / sin cuenta confirmada | `npm audit` como única fuente de SCA si no se resuelve |
| OWASP Dependency-Check | No en PATH | `docker run ... owasp/dependency-check` como segunda fuente de CVEs |
| Docker | **Sí disponible** — habilita todas las alternativas de arriba sin instalar nada en el host | — |

---

*Fin del plan. La ejecución fase por fase debe producir un reporte separado con hallazgos, evidencia y remediaciones — este documento no se actualiza con resultados, solo con cambios de alcance/metodología si el usuario los pide.*
