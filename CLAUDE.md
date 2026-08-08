# Proyecto: Organización de equipos y turnos de servicio

## Qué es esto

Aplicación web para organizar personas en equipos mensuales balanceados (líder + apoyo + colaboradores) y rotarlos entre turnos fijos de servicio y eventos extraordinarios, garantizando que todos los equipos acumulen aproximadamente la misma cantidad de participaciones en el mes.

Repositorio nuevo (greenfield) al momento de escribir esto. Stack elegido: **Node.js + React + PostgreSQL**, API Express separada (`/server`) + SPA Vite/React (`/client`), ORM **Prisma**.

El plan de implementación completo (fases, estructura de carpetas, verificación) está en `C:\Users\Usuario\.claude\plans\resilient-humming-lampson.md`. Este archivo documenta las **reglas de negocio y decisiones** acordadas con el usuario para que cualquier sesión futura tenga el contexto sin tener que re-preguntar.

## Reglas de negocio (confirmadas con el usuario)

**Personas**
- Categoría `INSTRUCTOR` o `MINISTRO` (obligatoria).
- `isJoven` (booleano, opcional, default `false`): **independiente** de la categoría — una persona puede ser `INSTRUCTOR`/`MINISTRO` y además `isJoven`. Es el pool de elegibilidad para el "Servicio de jóvenes" (ver más abajo). Se marca manualmente al crear o editar la persona, y también puede venir en el import masivo.
- Carga inicial masiva vía CSV/Excel (nombre, documento opcional, categoría, y opcionalmente la columna "Joven"). Un formulario de auto-inscripción queda para una fase futura, no ahora.

**Equipos mensuales**
- Se conforman **una sola vez al mes**; ese mismo equipo rota de horario/servicio durante todo el mes (no se vuelve a sortear por evento).
- Cantidad de personas y de equipos es dinámica: el administrador define cuántos equipos se forman ese mes; el sistema reparte a las personas de forma equitativa.
- **Líder**: exactamente 1 por equipo, sorteado del pool `INSTRUCTOR`, evitando repetir al líder del mes inmediatamente anterior cuando sea posible (si el pool no alcanza para excluir a todos, se relaja la restricción).
- **Apoyo**: los `INSTRUCTOR` que no salieron sorteados como líder se reparten equitativamente entre los equipos.
- **Ministros**: se reparten equitativamente; **no pueden ser líder** salvo que el administrador los promueva manualmente en un equipo puntual (excepción manual, no ocurre por sorteo automático).
- El sistema elige líderes/apoyo/ministros aleatoriamente; el admin puede re-sortear antes de finalizar y editar manualmente cualquier equipo después (incluida la promoción manual de un ministro a líder).

**Turnos fijos semanales**
- Miércoles 5:00pm y 7:00pm, Domingo 8:00am y 10:30am — **un solo equipo por turno**.
- Excepción: el **último domingo del mes** solo tiene servicio a las **8:00am** (no hay turno de 10:30am ese día), y a ese único servicio se le asignan **2 equipos** en lugar de uno.

**Servicio de jóvenes (antes "evento especial del último sábado", 6:50pm)** — regla ajustada el 2026-08-08
- Es un equipo aparte (`Team.teamType = YOUTH`), **no** es uno de los equipos regulares del mes, pero a diferencia del diseño original **ahora se arma junto con los equipos regulares**, en el mismo paso de sorteo/generación mensual — no es una pantalla ni un flujo separado. Al generar equipos, el admin elige cuántos equipos regulares se forman y además si el equipo de jóvenes está habilitado ese mes (**habilitado por defecto**).
- Pool de elegibilidad: personas activas con `isJoven = true`, sin importar su categoría (`INSTRUCTOR` o `MINISTRO`).
- Solo tiene **líder** y **ministros (colaboradores)** — nunca apoyo.
- El **líder se elige manualmente** por el admin como parte del mismo formulario de generación (nunca por sorteo). Los colaboradores se sortean del pool `isJoven`, priorizando a quienes no participaron en el equipo de jóvenes del mes calendario anterior (se relaja si el pool no alcanza, igual que la exclusión del líder regular).
- Tamaño configurable por el admin, **10 por defecto** (el líder cuenta como uno de esos 10).
- **Ahora cuenta como un evento obligatorio más** (a diferencia del diseño original, donde no contaba en el balance).
- Pertenecer a este equipo **no excluye** a esas personas de su equipo regular del mes — pueden estar en ambos a la vez (protegido con un índice único parcial en base de datos, no con el `@@unique` original de "un equipo por persona y mes", que ahora solo aplica a equipos regulares).
- Fecha/hora (sigue siendo el último sábado del mes) y uniforme del evento quedan **fuera de esta fase**, se conectan recién en Fase 4 (`ServiceSlot`) — hoy esta regla solo cubre cómo se arma el `Team`, no su horario.

**Eventos extraordinarios**
- El administrador los crea indicando fecha, hora y cuántos equipos se necesitan (1 o 2).
- El sistema asigna automáticamente el/los equipos que mantengan el balance.
- **Sí cuentan** dentro del balance de participaciones mensual (a diferencia del evento del último sábado).

**Balance de participaciones**
- La suma de turnos fijos + eventos extraordinarios debe quedar lo más pareja posible entre todos los equipos del mes.
- El slot del último domingo, al requerir 2 equipos, suma 1 participación para cada uno de los dos equipos asignados ese día.

**Uniformes**
- Cada día de franja fija tiene un uniforme asociado por **día de la semana** (ej. todo miércoles = Uniforme A, aplica a ambas franjas de ese día; todo domingo = Uniforme B), configurable por el administrador.
- Los eventos extraordinarios y el evento especial del último sábado también permiten asignar un uniforme al crearlos.

**Acceso**
- Un único administrador con login (JWT). No hay múltiples cuentas admin por ahora.
- Los usuarios finales **no tienen login** todavía; existe una **página pública** (sin autenticación) donde cualquiera puede ver la organización completa del mes: equipos, integrantes y horarios asignados.

## Explícitamente fuera de alcance ahora (pero a tener en cuenta para no bloquear el diseño)

- Formulario de auto-inscripción de personas.
- Login de usuarios finales (hoy solo consultan la página pública).
- Múltiples administradores.
- Que los líderes reporten asistencia, excusas, inasistencias de su equipo, o apoyos puntuales de colaboradores externos a su equipo — funcionalidad prevista a futuro, el modelo de datos no debe cerrarle la puerta a esto (por eso `Team`/`TeamMember`/`ServiceSlot` están modelados como entidades independientes y no como campos sueltos).

## Modelo de datos (resumen — ver plan para el detalle completo)

`Person` (incluye `isJoven`), `AdminUser`, `MonthCycle` (incluye `youthTeamEnabled`/`youthTeamSize`, solo como default precargado en el form), `Team` (`teamType` REGULAR/YOUTH), `TeamMember` (rol LEADER/SUPPORT/COLLABORATOR + `manualOverride`, `teamType` denormalizado desde `Team`), `ServiceSlot` (tipo FIXED/EXTRAORDINARY/SPECIAL, `teamsNeeded`, `countsTowardBalance`, `uniformId`), `SlotAssignment` (con `locked` para fijar asignaciones manuales), `SpecialSaturdayMember` (modelo legado, ya no usado por el equipo de jóvenes — sigue existiendo sin tocar para otro propósito futuro), `Uniform`, `WeekdayUniform` (config de uniforme por día de semana).

## Estado

**Fase 1 (base del proyecto), Fase 2 (personas — import masivo + CRUD) y Fase 3 (ciclo mensual y generación de equipos) completas y funcionando.** Repo con Git propio (aislado, commit inicial `c8d51ed`). Detalle del esquema y la estructura de carpetas en `docs/architecture/phase1-schema-design.md`; contrato de diseño de Fase 2 en `docs/architecture/phase2-people-contract.md`; referencia de API real de personas en `docs/api/people.md`; contrato de diseño de Fase 3 en `docs/architecture/phase3-teams-contract.md`.

- **Backend** (`/server`, Express + Prisma 6.x + PostgreSQL en contenedor Docker dedicado, puerto 5433): esquema completo migrado con las invariantes de negocio protegidas a nivel de base de datos, seed corrido. `GET /health`, `POST /api/auth/login` (JWT + rate limiting), el recurso `/api/people` completo (`GET`, `POST`, `PATCH /:id`, `DELETE /:id` con `?purge=true`, `POST /import` con `.csv`/`.xlsx`, incluida la columna opcional "Joven") y el ciclo mensual (`GET`/`POST /api/months`, `GET /api/months/:id`, `POST /api/months/:id/generate-teams`, `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId`) funcionan de verdad contra la base real — ver `docs/api/people.md` y `docs/architecture/phase3-teams-contract.md` (§9 para el equipo de jóvenes) para los contratos exactos. El sorteo de equipos (`services/teamGeneration.service.js`) sortea 1 líder por equipo del pool `INSTRUCTOR` (evitando repetir al líder del mes anterior cuando el pool alcanza, con warning `LIDER_REPETIDO_POSIBLE` si se relaja la restricción), reparte el resto de `INSTRUCTOR` como `SUPPORT` y todos los `MINISTRO` activos como `COLLABORATOR` de forma pareja (round-robin), admite re-sorteo destructivo mientras el mes esté `DRAFT`, y opcionalmente arma en la misma llamada el equipo `YOUTH` ("Servicio de jóvenes": líder manual + colaboradores sorteados del pool `isJoven`, con la misma lógica de exclusión/relajación del mes anterior, warning `JOVENES_REPETIDOS_POSIBLE`, y errores `LIDER_JOVENES_INVALIDO`/`POOL_JOVENES_INSUFICIENTE`). El resto de routers (`events`, `assignments`, `specialSaturday`, `uniforms`) existen, están correctamente protegidos por auth, pero responden `501` — son esqueleto a propósito, su lógica de negocio llega en Fase 4 (horario y balance de participaciones, incluida la generación de `ServiceSlot` y la fecha/uniforme del equipo de jóvenes).
- **Frontend** (`/client`, Vite + React, CSS plano propio con tokens centralizados — se evaluó migrar a Bootstrap/Tailwind/MUI y se decidió mantener el enfoque actual, ver `docs/architecture/css-framework-comparison.md`): estructura completa, tema claro/oscuro real, `AuthContext`/`ProtectedRoute` funcionando, ~20 componentes UI/dominio reutilizables y accesibles. `PeopleManager` es una pantalla completa y funcional (listado paginado, búsqueda, filtros, alta, edición, baja/reactivación, import masivo con reporte de errores, checkbox "Joven" en el form y badge en la tabla). `TeamGenerator` es una pantalla completa y funcional (crear/elegir mes, sortear/re-sortear equipos vía un modal único que incluye habilitar/deshabilitar el equipo de jóvenes con default `true`, elegir su líder y tamaño, edición manual del roster de cada equipo respetando la regla de exactamente un líder por equipo y restringiendo el rol "Apoyo" para el equipo de jóvenes, manejo explícito de `POOL_INSTRUCTOR_INSUFICIENTE`, `MES_YA_EXISTE`, `LIDER_JOVENES_INVALIDO` y `POOL_JOVENES_INSUFICIENTE`). Las páginas administrativas restantes (`EventsManager`, `SpecialSaturdayManager`) son placeholders a propósito, pendientes de Fase 4.
- **Pruebas**: 104 pruebas de humo/integración en backend (9 archivos, incluye `months.test.js` y `teamGeneration.test.js` contra la base real, cubriendo el algoritmo de sorteo, la exclusión/relajación del líder anterior, las invariantes B1-B5 de edición manual, y el equipo de jóvenes: pool `isJoven`, líder manual, priorización/relajación de repetidores, doble membresía regular+YOUTH, rechazo de `SUPPORT` en `PATCH`) + 35 en frontend (5 archivos, incluye `TeamGenerator.test.jsx` reescrito para el flujo con equipo de jóvenes), todas pasando. Incluye pruebas de regresión de bugs ya corregidos: un bug de auth, un *focus trap* de `Modal.jsx`, y una condición de carrera en `POST /api/people` (dos altas concurrentes con el mismo documento nuevo podían devolver un 409 genérico sin `details.code` en vez del `409 DOCUMENTO_DUPLICADO` estructurado — corregido capturando `P2002` de Prisma en `people.service.js`).
- **Documentación**: `README.md` con quick-start real y verificado; `docs/api/people.md` con la referencia completa de la API de personas; `docs/architecture/phase3-teams-contract.md` con el contrato de ciclo mensual y equipos.

Próximo paso: **Fase 4 (horario y balance)**, según el plan en `.claude/plans/resilient-humming-lampson.md` (fases: 1. base del proyecto ✅, 2. personas ✅, 3. ciclo mensual y generación de equipos ✅, 4. horario y balance, 5. página pública, 6. auth admin ✅ adelantada, 7. pulido).
