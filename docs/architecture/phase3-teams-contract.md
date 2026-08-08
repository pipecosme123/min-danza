# Fase 3 — Contrato cerrado de ciclo mensual y generación de equipos

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08
**Alcance:** `GET /api/months`, `POST /api/months`, `GET /api/months/:id`, `POST /api/months/:id/generate-teams`, `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId`. La generación de `ServiceSlot` (horario/balance) es Fase 4 y no se toca aquí — a esta altura un `MonthCycle` recién creado no tiene slots.

Fuentes: `CLAUDE.md` §Equipos mensuales, `docs/architecture/phase1-schema-design.md` (esquema `MonthCycle`/`Team`/`TeamMember` ya migrado), stubs reales en `server/src/routes/months.routes.js` y `teams.routes.js`.

---

## 0. Invariantes que esta fase debe proteger

| # | Invariante | Cómo se protege |
|---|---|---|
| B1 | Un solo `MonthCycle` por `(year, month)` | `@@unique([year, month])` + chequeo previo → 409 `MES_YA_EXISTE` |
| B2 | Exactamente 1 `LEADER` por equipo (o ninguno si el equipo está vacío) | Validado en `generate-teams` y en `PATCH /teams/:teamId` |
| B3 | Una persona, un solo equipo por mes | `@@unique([monthCycleId, personId])`; `PATCH` mueve a la persona de su equipo anterior en la misma transacción |
| B4 | `manualOverride` solo lo escribe una acción manual, nunca el sorteo automático | `generate-teams` siempre persiste `manualOverride: false`; `PATCH` lo calcula según P16 de abajo |
| B5 | Mientras `status = DRAFT` se puede re-sortear y editar; `FINALIZED` congela el mes | `generate-teams` y `PATCH /teams/:teamId` devuelven 409 `MES_FINALIZADO` si no es `DRAFT` |

No existe todavía un endpoint que pase un mes a `FINALIZED` (llega en una fase posterior); por ahora todo `MonthCycle` nace y queda en `DRAFT`.

---

## 1. `GET /api/months`

Lista simple, sin paginación (volumen esperado: unas pocas decenas de meses en la vida del sistema).

**200 →**
```json
{ "data": [ { "id": "clx…", "year": 2026, "month": 8, "teamCount": 4, "status": "DRAFT", "finalizedAt": null, "createdAt": "…", "updatedAt": "…" } ] }
```
Orden: `year desc, month desc` (más reciente primero).

## 2. `POST /api/months`

Body: `{ "year": 2026, "month": 8, "teamCount": 4 }`

| Campo | Reglas |
|---|---|
| `year` | entero, `2000..2100` |
| `month` | entero, `1..12` |
| `teamCount` | entero, `1..50` |

- **201** → DTO `MonthCycle` (igual forma que un elemento de `GET /api/months`), `status: "DRAFT"`.
- **409** `MES_YA_EXISTE` si ya hay un `MonthCycle` para ese `(year, month)` → `details: { monthCycleId }`.
- **400** validación zod estándar.

No se generan `Team` ni `ServiceSlot` al crear el mes; eso es explícitamente un paso posterior (sorteo manual del admin / Fase 4).

## 3. `GET /api/months/:id`

- **404** si no existe.
- **200** → mismo DTO que arriba.

## 4. `POST /api/months/:id/generate-teams`

Sortea (o re-sortea) líder/apoyo/ministros de todos los equipos del mes. Idempotente en el sentido de que se puede volver a llamar mientras `status = DRAFT`: cada llamada **reemplaza por completo** el sorteo anterior (incluidas ediciones manuales previas — es una operación destructiva a propósito, "re-sortear" significa empezar de cero).

- **404** si el mes no existe.
- **409** `MES_FINALIZADO` si `status !== "DRAFT"`.
- **409** `POOL_INSTRUCTOR_INSUFICIENTE` si `count(Person activo, category=INSTRUCTOR) < teamCount` → `details: { available, needed }`. Sin instructores suficientes no hay forma de poner un líder por equipo; esto es un error duro, no un warning.

### Algoritmo (`teamGeneration.service.js`)

1. `instructorPool` = personas activas `category = INSTRUCTOR`. `ministroPool` = personas activas `category = MINISTRO`.
2. `previousCycle` = el `MonthCycle` más reciente con `(year, month)` estrictamente anterior al actual (si existe).
3. `previousLeaderIds` = `personId` de los `TeamMember` con `role = LEADER` de `previousCycle` (si `previousCycle` existe; si no, conjunto vacío).
4. `preferredLeaderPool` = `instructorPool` menos `previousLeaderIds`.
   - Si `preferredLeaderPool.length >= teamCount` → se sortea de ahí, sin warning.
   - Si no alcanza → se sortea del `instructorPool` completo (se relaja la restricción) y se agrega un warning `LIDER_REPETIDO_POSIBLE` explicando que no había suficientes instructores fuera del liderazgo del mes anterior.
5. Barajar (Fisher-Yates, `Math.random` — no hace falta CSPRNG acá) y tomar los primeros `teamCount` como líderes, uno por equipo.
6. El resto de `instructorPool` (los no sorteados como líder) se baraja y se reparte round-robin como `SUPPORT` (`i % teamCount`).
7. `ministroPool` se baraja y se reparte round-robin como `COLLABORATOR` (`i % teamCount`).
8. En una transacción: borrar los `Team` existentes del mes (cascada borra sus `TeamMember`; a esta altura del proyecto ningún `Team` tiene todavía `SlotAssignment`, así que no hay pérdida de horario — anotado para cuando exista Fase 4), crear `teamCount` equipos nuevos (`label: "Equipo 1"…"Equipo N"`, `orderIndex: 1..N`), crear los `TeamMember` (todos con `manualOverride: false`).

**200 →**
```json
{
  "teams": [
    { "id": "clx…", "label": "Equipo 1", "orderIndex": 1,
      "members": [
        { "id": "clxTM1", "personId": "clxP1", "fullName": "Ana Gómez", "role": "LEADER", "manualOverride": false }
      ] }
  ],
  "warnings": [ { "code": "LIDER_REPETIDO_POSIBLE", "message": "…" } ]
}
```
`warnings` siempre presente (puede ser `[]`).

## 5. `GET /api/months/:id/teams`

- **404** si el mes no existe.
- **200** → `{ "teams": [ /* mismo shape que arriba, sin "warnings" */ ] }`, ordenados por `orderIndex`. Si todavía no se sorteó, `teams: []` (no es error).

## 6. `PATCH /api/teams/:teamId`

Reemplaza el roster completo de un equipo puntual (mover gente entre equipos, cambiar roles, promover manualmente). Es la vía para "editar manualmente" del plan.

Body: `{ "members": [ { "personId": "clxP1", "role": "LEADER" }, … ] }`

- **404** `EQUIPO_NO_ENCONTRADO` si `teamId` no existe.
- **409** `MES_FINALIZADO` si el mes del equipo no está `DRAFT`.
- **400** validación:
  - `role` debe ser `LEADER | SUPPORT | COLLABORATOR`.
  - `personId` no puede repetirse dentro del body.
  - cada `personId` debe existir y estar `active: true` → si no, `PERSONA_NO_VALIDA` (`details: { personId }`).
  - si `members` no está vacío, debe haber **exactamente un** `LEADER` → `EQUIPO_SIN_LIDER` (cero) o `EQUIPO_MULTIPLES_LIDERES` (más de uno).

### Lógica (`teamGeneration.service.js`, misma transacción)

1. Cargar el `Team` + su `monthCycle`; 404 / 409 según arriba.
2. Para cada `personId` del body que hoy pertenezca a **otro** equipo del mismo mes, borrar esa fila (la persona "se muda" al equipo editado — así nunca choca con `@@unique([monthCycleId, personId])`).
3. Borrar del equipo editado los `TeamMember` que ya no están en el body.
4. Upsert (`create` o `update`) el resto con:
   `manualOverride = (role === "LEADER" || role === "SUPPORT") ? person.category !== "INSTRUCTOR" : person.category !== "MINISTRO"`
   — es decir: se marca override cuando el rol asignado a mano no es el que el sorteo automático habría producido para la categoría de esa persona.

**200 →** `{ "team": { "id", "label", "orderIndex", "members": [ … ] } }` (mismo shape que un elemento de `GET /api/months/:id/teams`).

---

## 7. Estructura de archivos a crear/tocar

```
server/src/
  services/teamGeneration.service.js   (nuevo)
  routes/months.routes.js              (reemplaza los 501)
  routes/teams.routes.js               (reemplaza los 501)
server/tests/
  months.test.js                       (nuevo) — POST/GET months, MES_YA_EXISTE
  teamGeneration.test.js               (nuevo) — sorteo, exclusión de líder anterior + relajación,
                                                  balance de reparto, PATCH manual, invariantes B1-B5
client/src/
  api/months.js                        (nuevo) — getMonths, createMonth, getMonth, getMonthTeams,
                                                  generateTeams, updateTeam
  pages/TeamGenerator.jsx              (reemplaza el placeholder)
client/src/tests/
  TeamGenerator.test.jsx               (nuevo)
```

`components/domain/TeamCard.jsx` y `MemberList.jsx` ya existen (de Fase 2, sin usar todavía) y ya calzan con el shape `{ id, fullName, role }` de arriba — reutilizarlos tal cual, no rehacerlos.

## 8. Fuera de alcance en esta fase (a propósito)

- Generación de `ServiceSlot` / balance de participaciones (Fase 4).
- Endpoint para pasar `MonthCycle` a `FINALIZED`.
- Edición de `teamCount` de un mes ya creado.
