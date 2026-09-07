# Fase 9 — Reportes de asistencia por líderes de equipo

> Estado: **implementado** (2026-09-06). Backend + frontend + pruebas de punta
> a punta, ambas suites en verde. Este documento fija las decisiones acordadas
> con el usuario y sirve de referencia de la API real. Las desviaciones
> respecto del plan original están en §12 al final.

---

## 0. Qué se construye

Un **módulo nuevo, con login propio, para los líderes de equipo**. Cada líder
(de un equipo `REGULAR` o del equipo `YOUTH`) entra a registrar, servicio por
servicio, qué pasó con su equipo:

- **Asistencia** de cada integrante del equipo.
- **Inasistencias** (con o sin excusa).
- **Remplazos** y **cambios** (dos estados distintos, ver §3).
- **Apoyos** (personas que participaron por voluntad propia, sin estar ligadas
  a un remplazo/cambio).
- **Novedades / comentarios** libres del servicio.

El líder trabaja en **borrador** y luego **envía** el reporte. Al enviarlo puede
**compartirlo por WhatsApp** en texto plano (§8).

El reporte **no es público todavía** (se contempla que lo sea a futuro). Sólo el
**administrador** puede ver el contenido, y **únicamente una vez enviado** (§7).

Todo lo que se registra es **por servicio puntual**: un remplazo, un cambio, una
inasistencia o un apoyo valen sólo para ese turno, **no alteran el equipo del
mes** ni ninguna otra asignación.

---

## 1. Decisiones cerradas con el usuario

| # | Tema | Decisión |
|---|------|----------|
| D1 | **Login de líderes** | Credenciales **por persona**: `usuario + contraseña`, cuenta ligada a un `Person`. La cuenta **persiste mes a mes** (no se recrea). El acceso a un servicio concreto se **deriva** de que esa persona sea `LEADER` de un equipo asignado a ese turno — no se otorga permiso a mano. |
| D2 | **Alta de cuenta** | **Automática al finalizar el mes**: al pasar un `MonthCycle` a `FINALIZED` se crea (si no existe) una cuenta para cada líder regular y de jóvenes, con **contraseña temporal** que el admin le comunica. En el **primer ingreso** el líder define su contraseña definitiva (`mustChangePassword`). |
| D3 | **Remplazo vs cambio** | Ambos = un integrante del equipo no pudo ir y **otra persona externa al equipo** lo cubrió. **Cambio** = hubo un **acuerdo de contraprestación** entre el ausente y quien lo cubrió (le devuelve el favor otro día). **Remplazo** = sólo lo cubrieron, sin acuerdo de devolución. Misma estructura de datos, distinta etiqueta de estado. |
| D4 | **Personas que cubren / apoyan** | **Siempre del padrón** (`Person` activo, elegido de un buscador). Si alguien no está cargado, no se puede registrar hasta que el admin lo agregue. Nunca texto libre. |
| D5 | **Estados por integrante** | `ASISTIO` · `NO_ASISTIO_CON_EXCUSA` · `NO_ASISTIO_SIN_EXCUSA` · `REMPLAZADO` · `CAMBIO`. `REMPLAZADO`/`CAMBIO` exigen elegir quién cubrió. Cada integrante admite además una **nota corta opcional**. |
| D6 | **Alcance** | **Todos** los equipos `REGULAR` **y** el equipo `YOUTH`, en **todo turno asignado** (fijo, extraordinario, turno de Congreso, Servicio de jóvenes). En turnos con 2 equipos (último domingo, Vigilia, Congreso) **cada equipo hace su propio reporte por separado**. |
| D7 | **Ventana de registro** | **Abre** 1 hora antes de la hora de inicio del servicio. **Cierra** al **final del 3.º día calendario posterior** a la fecha del servicio (23:59:59.999 en `APP_TIMEZONE` = `America/Bogota`). Ej.: servicio domingo → cierra el miércoles 23:59. |
| D8 | **Tras enviar** | Mientras la **ventana siga abierta**, el líder puede **volver su propio reporte a borrador**, corregirlo y **reenviarlo** cuantas veces necesite. Al cerrarse la ventana queda **bloqueado** para el líder. |
| D9 | **Rol del admin** | Ve el **contenido** de un reporte **sólo cuando fue enviado**. Ve el **estado** (sin empezar / borrador / enviado) de todos, pero **no el contenido de los borradores**. Sobre un reporte enviado puede: **reabrirlo a borrador** (incluso pasada la ventana) y **editar** directamente cualquier dato. |
| D10 | **Texto de WhatsApp — faltas sin cubrir** | Un integrante que no asistió y **nadie lo cubrió** se **omite de la lista principal** y se agrupa en una sección **`No asistieron:`** (orden alfabético) antes de `Apoyos:`. Ver §8 para el formato completo. |
| D11 | **Visibilidad pública** | **No público todavía.** El payload público (`GET /api/schedule/*`) **no cambia**. Se deja el modelo preparado para exponerlo a futuro (campo/estado explícito), pero sin ruta pública ahora. |

---

## 2. Modelo de datos (Prisma)

Tablas nuevas. Nada de lo existente cambia de forma (sólo se **agregan**
relaciones y un par de guardas de servicio).

### 2.1 `LeaderAccount` — cuenta de un líder (reutilizable entre meses)

```prisma
model LeaderAccount {
  id                 String    @id @default(cuid())
  personId           String    @unique @map("person_id")
  username           String    @unique
  passwordHash       String    @map("password_hash")
  /// true tras el alta automática y tras un reset de contraseña por el admin.
  /// Mientras sea true, la única acción permitida es cambiar la contraseña.
  mustChangePassword Boolean   @default(true) @map("must_change_password")
  active             Boolean   @default(true)
  lastLoginAt        DateTime? @map("last_login_at")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  person Person @relation(fields: [personId], references: [id], onDelete: Restrict)

  @@map("leader_account")
}
```

- **`username`**: sugerencia por defecto al crear = documento normalizado si
  existe; si no, `nombre` + inicial de apellido, desambiguado con sufijo
  numérico. El admin puede editarlo desde la pantalla «Accesos» (§6).
- **Contraseña temporal**: se genera al crear la cuenta, se **devuelve una sola
  vez** en la respuesta del alta (para que el admin la copie y la comunique) y
  **nunca** se persiste en claro. Sólo se guarda el `bcrypt` hash.
- **`Person` gana** `leaderAccount LeaderAccount?` (relación inversa).
- Baja: `active = false` (nunca se borra una cuenta que ya firmó reportes).

### 2.2 `AttendanceReport` — un reporte por (servicio, equipo)

```prisma
enum AttendanceReportStatus {
  DRAFT
  SUBMITTED
  @@map("attendance_report_status")
}

model AttendanceReport {
  id            String                 @id @default(cuid())
  serviceSlotId String                 @map("service_slot_id")
  teamId        String                 @map("team_id")
  /// Compartido por ambas FK compuestas (mismo patrón que SlotAssignment):
  /// hace imposible ligar un equipo de un mes a un slot de otro.
  monthCycleId  String                 @map("month_cycle_id")
  status        AttendanceReportStatus  @default(DRAFT)
  /// Novedades / comentarios generales del servicio (D: campo libre).
  generalNotes  String?                @map("general_notes") @db.Text
  submittedAt   DateTime?              @map("submitted_at")
  /// Última vez que se reabrió a borrador (por el líder o el admin).
  reopenedAt    DateTime?             @map("reopened_at")
  /// Auditoría mínima: quién lo creó y quién lo tocó por última vez.
  createdByLeaderId String?           @map("created_by_leader_id")
  lastEditedByAdmin Boolean           @default(false) @map("last_edited_by_admin")
  createdAt     DateTime               @default(now()) @map("created_at")
  updatedAt     DateTime               @updatedAt @map("updated_at")

  serviceSlot ServiceSlot        @relation(fields: [serviceSlotId, monthCycleId], references: [id, monthCycleId], onDelete: Cascade)
  team        Team               @relation(fields: [teamId, monthCycleId], references: [id, monthCycleId], onDelete: Cascade)
  entries     AttendanceEntry[]
  supports    AttendanceSupport[]

  @@unique([serviceSlotId, teamId])
  @@index([monthCycleId, status])
  @@index([teamId])
  @@map("attendance_report")
}
```

**Por qué se clava en `(serviceSlotId, teamId)` y no en `SlotAssignment.id`**
(pese a la nota histórica del §7 de `phase1-schema-design.md`): `updateAssignment`
**muta `teamId` en la misma fila** al reasignar un turno a mano — colgar de
`SlotAssignment.id` dejaría el reporte apuntando a un equipo equivocado.
`(serviceSlotId, teamId)` es estable e históricamente correcto. Ver la guarda de
`updateAssignment` en §5.

### 2.3 `AttendanceEntry` — estado de cada integrante del equipo

```prisma
enum AttendanceEntryStatus {
  ASISTIO
  NO_ASISTIO_CON_EXCUSA
  NO_ASISTIO_SIN_EXCUSA
  REMPLAZADO
  CAMBIO
  @@map("attendance_entry_status")
}

model AttendanceEntry {
  id                String                @id @default(cuid())
  reportId          String                @map("report_id")
  /// Integrante del equipo (snapshot del roster al crear el borrador, ver §4).
  personId          String                @map("person_id")
  status            AttendanceEntryStatus?
  /// Obligatorio SII status ∈ {REMPLAZADO, CAMBIO}. Persona del padrón,
  /// distinta de personId. NO se agrega al equipo del mes (D: sólo este turno).
  coveredByPersonId String?               @map("covered_by_person_id")
  note              String?               @db.Text
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  report        AttendanceReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  person        Person           @relation("AttendanceEntryPerson", fields: [personId], references: [id], onDelete: Restrict)
  coveredBy     Person?          @relation("AttendanceEntryCoveredBy", fields: [coveredByPersonId], references: [id], onDelete: Restrict)

  @@unique([reportId, personId])
  @@map("attendance_entry")
}
```

- `status` es **nullable**: al materializar el borrador cada integrante nace
  «sin marcar»; **enviar** exige que todos tengan `status` (§4).

### 2.4 `AttendanceSupport` — apoyos voluntarios

```prisma
model AttendanceSupport {
  id        String   @id @default(cuid())
  reportId  String   @map("report_id")
  personId  String   @map("person_id")
  note      String?  @db.Text
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  report AttendanceReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  person Person           @relation("AttendanceSupportPerson", fields: [personId], references: [id], onDelete: Restrict)

  @@unique([reportId, personId])
  @@map("attendance_support")
}
```

### 2.5 `CHECK` a nivel de base (migración SQL cruda, estilo del resto del repo)

- `attendance_entry_covered_by_consistency`:
  `(status IN ('REMPLAZADO','CAMBIO')) = (covered_by_person_id IS NOT NULL)`.
- `attendance_entry_covered_by_distinct`: `covered_by_person_id IS DISTINCT FROM person_id`.
- Cascada: todo cae por `MonthCycle` → `ServiceSlot`/`Team` → reporte → entries/supports.
  Borrar un mes (`deleteMonthCycle`) sigue funcionando sin tocar código nuevo.

### 2.6 Enum de JWT / claim de rol

El token de admin actual **no lleva `role`**. Se agrega `role: "admin"` al
firmarlo (`auth.service.js`) y el token de líder lleva `role: "leader"`,
`sub: leaderAccountId`, `pid: personId`. `requireAuth` acepta `role === "admin"`
**o ausente** (compat con tokens de 8 h ya emitidos); `requireLeaderAuth` exige
`role === "leader"` estricto. Un token no sirve para el otro portal.

---

## 3. Semántica de estados (D3, D5)

Para el sistema, `REMPLAZADO` y `CAMBIO` son **idénticos en estructura**:
integrante ausente + `coveredByPersonId` obligatorio. La diferencia es
**puramente semántica / informativa** para el admin:

- **`CAMBIO`**: el ausente y quien lo cubre pactaron una **contraprestación**
  (se devuelven el favor). La UI del líder muestra un texto de ayuda que lo
  aclara.
- **`REMPLAZADO`**: alguien externo cubrió el puesto **sin** acuerdo de
  devolución.

Ninguno de los dos toca `TeamMember` ni `SlotAssignment`: **es sólo de este
servicio** (D11 / requisito explícito del usuario).

Los **apoyos** (`AttendanceSupport`) son independientes: personas que
participaron **por voluntad propia**, sin estar ligadas a ninguna ausencia.

---

## 4. Ciclo de vida de un reporte

```
(no existe)  --crear borrador-->  DRAFT  --enviar-->  SUBMITTED
                                    ^                     |
                                    |   --reabrir---------+   (líder, si ventana abierta)
                                    |   --reabrir (admin)-+   (admin, siempre)
```

### 4.1 Materialización del roster (al crear el borrador)

Se crea un `AttendanceEntry` (status `null`) por cada `TeamMember` del equipo
(cualquier rol: `LEADER`/`SUPPORT`/`COLLABORATOR`) **en el momento de crear el
borrador**. Es un **snapshot**.

### 4.2 Reconciliación (en cada `GET` del reporte, mientras sea `DRAFT`)

- **Integrante nuevo** en el equipo sin entry → se agrega uno con status `null`.
- **Entry cuya persona ya no está** en el equipo → se conserva, marcada
  `personYaNoEnEquipo: true` en la respuesta; el líder puede borrarla a mano.
- En `SUBMITTED` no se reconcilia (foto fija de lo enviado).

### 4.3 Reglas de transición

| Acción | Quién | Condición |
|--------|-------|-----------|
| Crear borrador | líder del equipo | ventana **abierta** (D7) |
| Editar borrador (entries/supports/notas) | líder | `DRAFT` **y** ventana abierta |
| Enviar (`DRAFT`→`SUBMITTED`) | líder | ventana abierta **y** todos los entries con `status` no nulo |
| Reabrir (`SUBMITTED`→`DRAFT`) | **líder** | ventana **abierta** (D8) |
| Reabrir (`SUBMITTED`→`DRAFT`) | **admin** | siempre (incluso ventana cerrada) (D9) |
| Editar contenido | **admin** | reporte `SUBMITTED` (queda `lastEditedByAdmin = true`) (D9) |
| Ver contenido | admin | reporte `SUBMITTED` (D9) — `409 REPORTE_EN_BORRADOR` si no |

Fuera de la ventana y sin reapertura del admin: el reporte es **inmutable**
(sólo lectura para el líder, contenido visible para el admin si estaba
`SUBMITTED`).

### 4.4 Cálculo de la ventana (`server/src/services/attendanceWindow.js`)

```
opensAt  = instante( slot.date , slot.startTime , APP_TIMEZONE ) − 1 hora
closesAt = instante( slot.date + 3 días , 23:59:59.999 , APP_TIMEZONE )
state    = now < opensAt  → 'PENDIENTE'
           now ≤ closesAt → 'ABIERTA'
           si no          → 'CERRADA'
```

- `America/Bogota` no tiene horario de verano (offset fijo `−05:00`), pero el
  helper se implementa **tz-aware** vía `Intl.DateTimeFormat` (mismo criterio
  que `currentCivilDate` en `dates.js`) para no clavar el offset.
- `dates.js` gana un helper `civilDateTimeToInstant({year,month,day}, "HH:mm", tz)`
  y `addCivilDays({year,month,day}, n)`. El resto de `dates.js` (aritmética de
  calendario sin tz) **no se toca**.
- **Turnos cancelados** (`cancelledAt` no nulo): **sin ventana**, no llevan
  reporte. Se excluyen de todas las listas.

---

## 5. API — backend (`/server`)

Servicios nuevos: `leaderAuth.service.js`, `attendance.service.js`,
`attendanceWindow.js` (util), `attendanceText.service.js` (armador del texto §8),
`leaderAccounts.service.js` (alta/gestión desde el admin).
Routers nuevos: `leader.routes.js`, `attendance.routes.js`. `leaderAccounts`
cuelga de `months.routes.js` / un router `leader-accounts.routes.js`.
Middleware nuevo: `requireLeaderAuth`.
Rate limit nuevo: `leaderLoginLimiter` (como `loginLimiter`) y `leaderApiLimiter`
(como `adminLimiter`) en `rateLimit.js`.

### 5.1 Portal del líder — sin auth previa

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/leader/login` | `{ username, password }` → `{ token, leader: {id, fullName}, mustChangePassword }`. Mensaje genérico ante usuario/clave incorrectos. `leaderLoginLimiter`. |

### 5.2 Portal del líder — `requireLeaderAuth`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/leader/change-password` | `{ currentPassword, newPassword }`. Único endpoint permitido mientras `mustChangePassword = true`. `newPassword` mín. 8 caracteres. Limpia el flag. |
| `GET` | `/api/leader/me` | Perfil + `mustChangePassword`. |
| `GET` | `/api/leader/services` | Turnos asignados a **cualquier equipo que este líder lidera**, en meses `FINALIZED`, cuya ventana esté `ABIERTA` o `CERRADA` (para seguir viendo/compartiendo lo ya enviado). Cada ítem: `{ slot: {date, startTime, type, title, uniform}, team: {id, label, orderIndex}, window: {opensAt, closesAt, state}, report: {id?, status} }`. Ordena por fecha. Los `PENDIENTE` se listan pero sin acción de crear. |
| `GET` | `/api/leader/reports/:reportId` | Reporte completo (roster reconciliado si `DRAFT`) + datos del equipo + servicio. `403` si el reporte no es de un equipo de este líder. |
| `POST` | `/api/leader/services/:slotId/:teamId/report` | Crea el borrador (materializa roster). `409 VENTANA_CERRADA` / `409 VENTANA_NO_ABIERTA`. `409 REPORTE_YA_EXISTE` si ya hay uno. |
| `PATCH` | `/api/leader/reports/:reportId` | Guarda borrador: `{ entries: [{personId, status, coveredByPersonId?, note?}], supports: [{personId, note?}], generalNotes? }`. Reemplazo total de entries/supports (no incremental). Valida `coveredByPersonId` (padrón activo, ≠ personId, no exigido/no permitido según status). `409` si no es `DRAFT` o ventana cerrada. |
| `POST` | `/api/leader/reports/:reportId/submit` | `DRAFT`→`SUBMITTED`. `409 REPORTE_INCOMPLETO` con la lista de `personId` sin `status`. `409 VENTANA_CERRADA`. |
| `POST` | `/api/leader/reports/:reportId/reopen` | `SUBMITTED`→`DRAFT`. `409 VENTANA_CERRADA` (el líder ya no puede; debe pedirle al admin). |
| `GET` | `/api/leader/reports/:reportId/whatsapp-text` | `{ text }` en texto plano (§8). Sólo si `SUBMITTED` (`409 REPORTE_NO_ENVIADO`). |
| `GET` | `/api/leader/people?query=` | Buscador acotado para los selectores de «cubrió» / «apoyo»: `[{id, fullName}]` de `Person` activos, máx. ~20, filtrado por texto. No expone el resto de la gestión de personas. |

### 5.3 Admin — `requireAuth` + `adminLimiter`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/months/:id/attendance` | Matriz de todos los `(turno, equipo)` que necesitan reporte ese mes, con `status` (`SIN_EMPEZAR` / `BORRADOR` / `ENVIADO`), fecha/hora, equipo, estado de ventana. **Sin contenido de borradores** (D9). |
| `GET` | `/api/attendance/reports/:reportId` | Contenido completo. `409 REPORTE_EN_BORRADOR` si aún no fue enviado (D9). |
| `PATCH` | `/api/attendance/reports/:reportId` | Edición directa del admin (mismo body que 5.2 PATCH). Sólo sobre `SUBMITTED`. Marca `lastEditedByAdmin`. |
| `POST` | `/api/attendance/reports/:reportId/reopen` | `SUBMITTED`→`DRAFT`, **sin** chequeo de ventana (D9). |
| `GET` | `/api/attendance/reports/:reportId/whatsapp-text` | Igual que la del líder, para que el admin también pueda compartir. |
| `POST` | `/api/leader-accounts` | Alta manual de una cuenta para un `personId`. Devuelve **la contraseña temporal una sola vez**. `409 CUENTA_YA_EXISTE`. |
| `GET` | `/api/leader-accounts` | Lista de cuentas: persona, username, `active`, `mustChangePassword`, `lastLoginAt`, y en qué meses fue líder. |
| `PATCH` | `/api/leader-accounts/:id` | Cambiar `username` o `active`. |
| `POST` | `/api/leader-accounts/:id/reset-password` | Regenera contraseña temporal (devuelta una vez), pone `mustChangePassword = true`. |

### 5.4 Provisionamiento automático (`ensureLeaderAccounts(monthCycleId)`)

- Se llama **al final de `finalizeMonthCycle`** (dentro o justo después de la
  transacción; el alta de cuentas no necesita ser atómica con el cambio de
  status, igual que la invalidación de caché).
- Se llama también desde `updateTeam` cuando, en un mes ya `FINALIZED`
  (actual/futuro), aparece un `TeamMember` `LEADER` nuevo (p. ej. el admin
  promueve un ministro a líder post-publicación).
- Idempotente: si la persona ya tiene `LeaderAccount`, no hace nada.
- Registra las contraseñas temporales generadas y las devuelve en la respuesta
  de `finalize` (`{ ..., newLeaderAccounts: [{personId, fullName, username, tempPassword}] }`)
  para que el admin las vea y comunique. **Se muestran una sola vez.**

### 5.5 Guardas en servicios existentes

- **`updateAssignment`** (`assignments.service.js`): si existe un
  `AttendanceReport` para `(serviceSlotId, teamId)` actual y se pide
  `wantsTeamChange`, rechazar con `409 ASIGNACION_CON_REPORTE` (“hay un reporte
  de asistencia para este equipo en este turno; reasignar cambiaría de equipo”).
  El admin debe reabrir/eliminar el reporte primero. Reasignaciones sin reporte:
  sin cambios.
- **`generateSchedule` / `generateTeams`**: sólo corren en `DRAFT`; en `DRAFT`
  no hay reportes (las cuentas y reportes nacen recién en `FINALIZED`), así que
  **no hay conflicto**. Documentarlo, sin código extra.
- **`deleteMonthCycle`**: la cascada de base ya arrastra reportes/entries/supports.
  Las `LeaderAccount` **no** se borran (son transversales a los meses).
- **`cancelEvent` / `cancelYouthService`**: al cancelar un turno, si tiene
  reportes, se **conservan** pero el turno deja de aparecer en `/leader/services`
  (ventana suprimida). No se borran (historial). Nota: si el turno se
  **elimina** (`deleteEvent`), la cascada borra sus reportes.

### 5.6 Caché público

Sin cambios: los reportes **no** entran en `GET /api/schedule/*` (D11). No hay
que invalidar nada. Cuando a futuro se exponga, será un endpoint aparte con su
propia clave de caché.

---

## 6. Frontend (`/client`)

### 6.1 Portal del líder — **árbol de rutas separado** `/lider/*`

- `LeaderAuthContext` propio, token en `localStorage['app_leader_token']`
  (distinto de `app_auth_token`). `apiClient.request()` gana una opción
  `auth: 'admin' | 'leader'` (default `'admin'`); `api/leader/*.js` pasan
  `auth: 'leader'`. El evento `app:unauthorized` se diferencia por portal
  (`app:unauthorized:leader`) para no desloguear al admin y viceversa.
- Rutas:
  - `/lider/login` → `LeaderLogin`.
  - `/lider` (protegida) → `LeaderLayout` con:
    - Si `mustChangePassword` → fuerza `LeaderChangePassword` (bloquea el resto).
    - `LeaderServices`: lista de turnos con badge de ventana
      (`Pendiente` / `Abierta — cierra <fecha>` / `Cerrada`), estado del reporte
      (`Sin empezar` / `Borrador` / `Enviado`), botón contextual
      (`Registrar` / `Continuar` / `Ver`).
    - `LeaderReportEditor` (`/lider/reportes/:reportId`):
      - **Grilla de integrantes**: líder primero, resto alfabético; por fila un
        `<select>` de estado (5 opciones D5) + `SearchableSelect` «cubrió» que
        aparece sólo con `REMPLAZADO`/`CAMBIO` + input de nota corta.
      - **Sección Apoyos**: filas agregables/quitables con `SearchableSelect`
        (buscador `/api/leader/people`) + nota.
      - **Novedades / comentarios**: `<textarea>`.
      - Acciones: `Guardar borrador`, `Enviar`, `Reabrir` (si enviado y ventana
        abierta), `Compartir por WhatsApp` (si enviado).
      - Todo deshabilitado con motivo visible si la ventana está cerrada.
- Reusa `SearchableSelect`, `Modal`, `Button`, `Field`, `Badge`, `Toast`,
  `useApi`, `apiError`. Tema claro/oscuro heredado.
- WhatsApp: botón que hace `GET .../whatsapp-text` y abre
  `https://wa.me/?text=${encodeURIComponent(text)}` en pestaña nueva (o
  `navigator.share({ text })` si está disponible en móvil). Fallback: copiar al
  portapapeles + toast.

### 6.2 Admin — pestaña nueva «Asistencia»

- Ruta `/admin/asistencia` (nueva entrada en `NavTabs` + `AdminDashboard`).
- Selector de mes (reusa `useMonthSelector`).
- Tabla `(turno × equipo)` con estado (`Sin empezar` / `Borrador` / `Enviado`) y
  estado de ventana. Fila `Enviado` → abre panel de sólo lectura con:
  - roster con estados, cubridores, notas; apoyos; novedades.
  - Botones: `Editar` (form igual al del líder), `Reabrir a borrador`,
    `Compartir por WhatsApp`.
  - Filas `Borrador` / `Sin empezar` no son clicables (sin contenido, D9).
- Pantalla «Accesos» (§5.3): puede ser una sub-sección de esta pestaña o de
  «Equipos». Lista de `LeaderAccount`, alta manual, reset de contraseña
  (muestra la temporal en un `Modal` con botón de copiar), activar/desactivar,
  editar `username`.
- Al **finalizar un mes**, si `finalize` devuelve `newLeaderAccounts`, mostrar
  un `Modal` con la tabla `persona · usuario · contraseña temporal` y aviso de
  que **no se vuelven a mostrar**.

---

## 7. Texto plano para WhatsApp (§8 del requisito)

`attendanceText.service.js` arma un string. Formato:

```
Asistencia — <título del servicio o rótulo por tipo>
<día> <DD>/<MM>/<AAAA> · <HH:mm>
Equipo <orderIndex>            ← o "Servicio de jóvenes" para el equipo YOUTH

1. <Nombre del líder>
2. <Integrante>
3. <Integrante>  —  cubrió: <Nombre de quien remplazó / hizo cambio>
4. <Integrante>
...

No asistieron:
- <Integrante>
- <Integrante>

Apoyos:
- <Nombre>
- <Nombre>
```

Reglas exactas:

1. **Encabezado**: título del turno si tiene (`EXTRAORDINARY` / `YOUTH_SERVICE` /
   Congreso); si es `FIXED`, rótulo `"<Miércoles|Domingo> <hora>"` (mismo
   criterio que la UI). Luego fecha y hora del evento. Luego `Equipo <N>`
   (`Team.orderIndex`) o `"Servicio de jóvenes"` si `teamType = YOUTH`.
2. **Lista principal** = integrantes que **participaron**: los que `ASISTIO`,
   más los `REMPLAZADO`/`CAMBIO` (aparecen con el nombre del integrante
   titular y `— cubrió: <coveredBy>`).
   - **Líder primero** (posición 1), numeración explícita.
   - El **resto en orden alfabético** por `fullName` (`localeCompare('es',
     { sensitivity: 'base' })`).
3. **`No asistieron:`** (sólo si hay alguno) = integrantes
   `NO_ASISTIO_CON_EXCUSA` / `NO_ASISTIO_SIN_EXCUSA`, orden alfabético, viñetas.
   (D10. El texto **no** distingue con/sin excusa; esa distinción es sólo para
   la vista del admin.)
4. **`Apoyos:`** (sólo si hay alguno) = `AttendanceSupport`, orden alfabético,
   viñetas.
5. **No se incluyen** las notas por integrante ni las novedades generales en el
   texto de WhatsApp (son para el admin). *(Decisión por defecto; si el usuario
   quiere las novedades al final del texto, es un cambio de una línea.)*

---

## 8. Migraciones

Una sola migración a mano (estilo del repo), carpeta
`20260906000000_attendance_reports/`:

1. `CREATE TYPE attendance_report_status`, `attendance_entry_status`.
2. `CREATE TABLE leader_account`, `attendance_report`, `attendance_entry`,
   `attendance_support` con sus índices y FK compuestas.
3. `CHECK` de §2.5.
4. Sin backfill (no hay datos previos).

`schema.prisma` se actualiza en paralelo (los `model` de §2 + relaciones
inversas en `Person`, `ServiceSlot`, `Team`).

---

## 9. Pruebas

**Backend** (nuevos archivos):

- `attendanceWindow.test.js`: abre 1 h antes; cierra fin del 3.º día;
  bordes de fin de mes (servicio 30/31 → cierra el mes siguiente); servicio
  último sábado (Servicio de jóvenes).
- `leaderAuth.test.js`: login OK / credenciales malas (mensaje genérico);
  `mustChangePassword` bloquea todo salvo change-password; un token de líder
  **no** entra a rutas de admin y un token de admin **no** entra a `/api/leader/*`.
- `attendance.authorization.test.js`: el líder A no puede leer/editar el reporte
  de un equipo que no lidera; sí el propio; equipo `YOUTH`.
- `attendance.lifecycle.test.js`: crear borrador (falla si ventana no abierta) →
  editar → enviar (falla si hay entries sin status) → reabrir (líder, falla si
  ventana cerrada) → reabrir (admin, OK con ventana cerrada) → editar admin.
- `attendance.rules.test.js`: `coveredByPersonId` obligatorio/prohibido según
  status; distinto de `personId`; persona del padrón activo; un remplazo **no**
  crea `TeamMember` ni `SlotAssignment`.
- `attendanceText.test.js`: líder primero, resto alfabético, `cubrió:`,
  `No asistieron:`, `Apoyos:`, equipo `YOUTH` rotulado, secciones ausentes
  cuando están vacías.
- `finalizeMonthCycle` extendido: crea `LeaderAccount` para cada líder,
  idempotente en refinalización (no aplica hoy pero sí si se agrega
  des-finalizar), devuelve `newLeaderAccounts` una vez.
- `updateAssignment` extendido: `409 ASIGNACION_CON_REPORTE` al reasignar un
  turno con reporte.

**Frontend** (nuevos archivos):

- `LeaderLogin.test.jsx`, `LeaderChangePassword.test.jsx` (forzado).
- `LeaderServices.test.jsx`: badges de ventana; botón contextual por estado.
- `LeaderReportEditor.test.jsx`: selector «cubrió» aparece sólo con
  `REMPLAZADO`/`CAMBIO`; agregar/quitar apoyos; guardar/enviar/reabrir
  deshabilitados con ventana cerrada; construye el link `wa.me` correcto.
- `AdminAttendance.test.jsx`: no muestra contenido de borradores; abre panel de
  enviados; editar y reabrir.
- `AdminLeaderAccounts.test.jsx`: alta muestra contraseña temporal en modal;
  reset; activar/desactivar.

---

## 10. Fases de implementación sugeridas

| Sub-fase | Alcance | Entregable verificable |
|----------|---------|------------------------|
| **9a — Cuentas y acceso** | Modelo `LeaderAccount` + migración; `leaderAuth.service.js` + `/api/leader/login` + change-password + `me`; `requireLeaderAuth`; claim `role` en ambos tokens; `ensureLeaderAccounts` enganchado a `finalize`; pantalla admin «Accesos»; portal `/lider/login` + cambio de contraseña forzado. | Un líder puede loguearse tras finalizar un mes y cambiar su contraseña. `npm test` verde en ambos paquetes. |
| **9b — Reportes** | `AttendanceReport/Entry/Support` + migración + `CHECK`; `attendanceWindow.js`; `attendance.service.js` (crear/editar/enviar/reabrir + reconciliación de roster); `/api/leader/services` + `/reports/*`; guarda en `updateAssignment`; `LeaderServices` + `LeaderReportEditor`. | Un líder registra un borrador, lo envía y lo reabre dentro de la ventana; la ventana cerrada bloquea. |
| **9c — Admin + WhatsApp + docs** | `attendanceText.service.js`; `/api/months/:id/attendance` + `/api/attendance/reports/*` (ver/editar/reabrir/whatsapp); pestaña admin «Asistencia»; botón compartir por WhatsApp; actualizar `CLAUDE.md`, `README.md`, catálogo de errores y este contrato → «implementado». | El admin ve y edita reportes enviados, los reabre, y comparte el texto por WhatsApp. Suite completa verde. |

---

## 11. Fuera de alcance de la Fase 9 (anotado para no cerrar puertas)

- **Reporte público** de asistencia (D11: se hará a futuro, con endpoint y caché
  propios; el modelo ya lo soporta).
- **Notificaciones** automáticas al líder cuando abre la ventana (hoy: el líder
  entra y ve sus turnos con ventana abierta).
- **Estadísticas / históricos** de asistencia por persona o por equipo a lo
  largo del año (el modelo lo permite: `AttendanceEntry` liga a `Person`).
- **Recuperación de contraseña autoservicio** del líder (hoy: el admin hace
  reset desde «Accesos»).
- **Múltiples líderes** por equipo o delegación del registro a un apoyo.
- **Des-finalizar un mes**: sigue fuera de alcance; si se agrega, `finalize` ya
  deja `ensureLeaderAccounts` idempotente.

---

## 12. Desviaciones respecto del plan (al implementar, 2026-09-06)

1. **`GET /api/leader/people` devuelve TODAS las personas activas** (id + nombre),
   no un buscador acotado a 20. Los selectores «cubrió» / «apoyo» filtran del
   lado del cliente, igual que el filtro por persona de la página pública. Se
   agregó además `GET /api/attendance/people` (misma data, auth de admin) para
   cuando el admin edita un reporte. El padrón de una congregación es chico; no
   hace falta paginar.
2. **`leaderLoginLimiter` = 30 intentos / 15 min por IP** (el plan decía "como
   `loginLimiter`", que es 10). Varios líderes distintos suelen compartir una
   sola IP de salida (wifi del templo); 10 daría falsos positivos. 30 sigue
   frenando la fuerza bruta contra una cuenta concreta.
3. **Turno con ventana cerrada: sigue visible en `/api/leader/services` por 45
   días** (`RECENT_CLOSED_MS` en `attendance.service.js`), para que el líder
   pueda seguir consultando/compartiendo lo que envió. Después desaparece.
4. **Bug corregido en `attendanceWindow.js`** (`civilWallTimeToInstant`): el
   cálculo del offset de zona horaria vía `Intl.DateTimeFormat` truncaba los
   milisegundos, así que `closesAt` daba `…:00.997Z` en vez de `…:59.999Z`. Se
   compara a nivel de segundo (el offset siempre son minutos enteros). Test de
   regresión en `tests/attendanceWindow.test.js`.
5. **`LeaderAccount.person` quedó `onDelete: Restrict`** (como en el plan). Las
   limpiezas de 6 archivos de test que finalizan un mes (`finalize`, `months`,
   `phase4c-post-publish-edits`, `publicSchedule`, `youthTeam`, `teamGeneration`)
   ahora borran las `LeaderAccount` antes que las `Person` — sin este orden, el
   `afterAll` crasheaba en el `person.deleteMany` por la FK y **nunca llegaba a
   reactivar** las personas del seed que había desactivado en su `beforeAll`,
   dejando la base de desarrollo compartida con 0 personas activas (hazard
   preexistente del diseño de tests, no de la Fase 9; el fix del orden lo evita).
6. **Rutas del frontend**: portal `/lider` con hijos `clave` (cambio de
   contraseña) y `reportes/:reportId`; admin con pestañas nuevas
   `/admin/asistencia` y `/admin/accesos`. El formulario del reporte es un
   componente compartido (`AttendanceReportForm.jsx`) entre el editor del líder
   y el panel del admin. El modal de contraseñas temporales tras finalizar vive
   en `NewLeaderAccountsModal.jsx` (montado en `EventsManager`).
7. **`GET /api/leader/services` incluye `permissions`/`window` serializados**;
   `GET .../reports/:id` devuelve `permissions: { canEdit, canSubmit, canReopen }`
   ya calculados, para que la UI no reimplemente la regla de la ventana.
8. **No se creó un "catálogo de errores" separado**: el repo no tiene uno; este
   contrato (§4.3, §5) es la referencia de códigos (`VENTANA_CERRADA`,
   `VENTANA_NO_ABIERTA`, `REPORTE_YA_EXISTE`, `REPORTE_INCOMPLETO`,
   `REPORTE_EN_BORRADOR`, `REPORTE_NO_ENVIADO`, `REPORTE_NO_EN_BORRADOR`,
   `NO_ES_LIDER_DEL_EQUIPO`, `FALTA_QUIEN_CUBRIO`, `CUBRIO_ES_INTEGRANTE`,
   `CUBRIO_PERSONA_NO_VALIDA`, `CUBRIO_ES_LA_MISMA_PERSONA`,
   `ENTRY_PERSONA_NO_ES_INTEGRANTE`, `APOYO_ES_INTEGRANTE`, `APOYO_PERSONA_NO_VALIDA`,
   `ASIGNACION_CON_REPORTE`, `CUENTA_YA_EXISTE`, `USERNAME_EN_USO`,
   `CONTRASENA_SIN_CAMBIO`, `TURNO_NO_ASIGNADO`, `TURNO_CANCELADO`,
   `MES_NO_PUBLICADO`).
9. **Pruebas**: backend `tests/attendance.test.js` (22 casos: auth, provisión e
   idempotencia, ciclo de vida, autorización entre líderes, reglas de
   remplazo/cambio/apoyo, texto de WhatsApp, vistas de admin, guarda de
   reasignación) + `tests/attendanceWindow.test.js` (10). Frontend:
   `LeaderLogin`, `LeaderChangePassword`, `LeaderServices`, `LeaderReportEditor`,
   `AttendanceManager`.
