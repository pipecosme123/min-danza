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
- **Cuenta como un evento obligatorio más** (a diferencia del diseño original, donde no contaba en el balance): su `ServiceSlot` (`slotType: YOUTH_SERVICE`, ex `SPECIAL`) nace con `countsTowardBalance: true` siempre.
- Pertenecer a este equipo **no excluye** a esas personas de su equipo regular del mes — pueden estar en ambos a la vez (protegido con un índice único parcial en base de datos, no con el `@@unique` original de "un equipo por persona y mes", que ahora solo aplica a equipos regulares).
- Fecha: último sábado del mes, hora fija `18:50`. El horario se genera automáticamente junto con los turnos fijos (Fase 4, ver más abajo); el equipo asignado a ese slot **no se elige por evento**, es directamente el equipo `YOUTH` ya sorteado/armado del mes. Su uniforme sale de una configuración fija reutilizable (`YouthServiceUniform`, análoga a `WeekdayUniform` pero para este evento recurrente en particular), no se elige al crear un evento porque este slot no se crea a mano.
- El viejo modelo `SpecialSaturdayMember` (roster manual del "evento especial del último sábado") **se eliminó por completo** del esquema y de la interfaz — no queda ningún rastro de "Sábado especial" en el sistema, fue reemplazado enteramente por este flujo.

**Eventos extraordinarios**
- El administrador los crea indicando fecha, hora, título y cuántos equipos se necesitan (1 o 2), después de que el horario base del mes ya se generó.
- El sistema asigna automáticamente el/los equipos que mantengan el balance (misma función `recomputeBalance` que arma el balance inicial).
- **Sí cuentan** dentro del balance de participaciones mensual.

**Balance de participaciones**
- La suma de turnos fijos + eventos extraordinarios debe quedar lo más pareja posible entre todos los equipos del mes.
- El slot del último domingo, al requerir 2 equipos, suma 1 participación para cada uno de los dos equipos asignados ese día.

**Uniformes**
- Cada día de franja fija tiene un uniforme asociado por **día de la semana** (ej. todo miércoles = Uniforme A, aplica a ambas franjas de ese día; todo domingo = Uniforme B), configurable por el administrador (`WeekdayUniform`).
- El "Servicio de jóvenes" tiene su propia configuración fija reutilizable (`YouthServiceUniform`, un solo valor global, se aplica automáticamente cada mes al generar el horario).
- Los eventos extraordinarios permiten asignar un uniforme al crearlos (con el uniforme del día de esa fecha precargado como sugerencia editable, no obligatoria).
- Cambiar cualquiera de estas configuraciones **no reescribe** los turnos ya generados de meses en curso — solo aplica la próxima vez que se genere/regenere el horario de un mes.

**Acceso**
- Un único administrador con login (JWT). No hay múltiples cuentas admin por ahora.
- Los usuarios finales **no tienen login** todavía; existe una **página pública** (sin autenticación) donde cualquiera puede ver la organización completa del mes: equipos, integrantes y horarios asignados.

## Explícitamente fuera de alcance ahora (pero a tener en cuenta para no bloquear el diseño)

- Formulario de auto-inscripción de personas.
- Login de usuarios finales (hoy solo consultan la página pública).
- Múltiples administradores.
- Que los líderes reporten asistencia, excusas, inasistencias de su equipo, o apoyos puntuales de colaboradores externos a su equipo — funcionalidad prevista a futuro, el modelo de datos no debe cerrarle la puerta a esto (por eso `Team`/`TeamMember`/`ServiceSlot` están modelados como entidades independientes y no como campos sueltos).

## Modelo de datos (resumen — ver plan para el detalle completo)

`Person` (incluye `isJoven`), `AdminUser`, `MonthCycle` (incluye `youthTeamEnabled`/`youthTeamSize`, solo como default precargado en el form), `Team` (`teamType` REGULAR/YOUTH), `TeamMember` (rol LEADER/SUPPORT/COLLABORATOR + `manualOverride`, `teamType` denormalizado desde `Team`), `ServiceSlot` (tipo FIXED/EXTRAORDINARY/YOUTH_SERVICE — antes `SPECIAL`, renombrado en Fase 4 —, `teamsNeeded`, `countsTowardBalance`, `uniformId`), `SlotAssignment` (con `locked` para fijar asignaciones manuales), `Uniform`, `WeekdayUniform` (config de uniforme por día de semana), `YouthServiceUniform` (config fija del uniforme del Servicio de jóvenes, singleton). `SpecialSaturdayMember` (roster manual del viejo "evento especial del último sábado") **se eliminó del esquema en Fase 4** — el equipo de jóvenes ya no usa ese mecanismo.

## Estado

**Fases 1 a 4 completas y funcionando** (base del proyecto, personas, ciclo mensual y generación de equipos, horario y balance). Repo con Git propio (aislado, commit inicial `c8d51ed`). Detalle del esquema y la estructura de carpetas en `docs/architecture/phase1-schema-design.md`; contrato de diseño de Fase 2 en `docs/architecture/phase2-people-contract.md`; referencia de API real de personas en `docs/api/people.md`; contrato de diseño de Fase 3 en `docs/architecture/phase3-teams-contract.md`; contrato de diseño de Fase 4 en `docs/architecture/phase4-schedule-contract.md`.

- **Backend** (`/server`, Express + Prisma 6.x + PostgreSQL en contenedor Docker dedicado, puerto 5433): esquema completo migrado con las invariantes de negocio protegidas a nivel de base de datos, seed corrido. `GET /health`, `POST /api/auth/login` (JWT + rate limiting), `/api/people` completo (incluida la columna opcional "Joven" en el import), el ciclo mensual (`GET`/`POST /api/months`, `GET /api/months/:id`, `POST /api/months/:id/generate-teams`, `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId`) y ahora también el horario y el balance funcionan de verdad contra la base real: `POST /api/months/:id/generate-schedule` (genera los turnos fijos de miércoles/domingo con la excepción del último domingo, y el slot `YOUTH_SERVICE` del equipo de jóvenes si ese mes lo tiene, más el balance inicial), `GET /api/months/:id/schedule` (horario + balance por equipo), `POST /api/months/:id/events`/`DELETE /api/events/:eventId` (eventos extraordinarios, recalculan balance), `PATCH /api/assignments/:id` (bloquear/desbloquear o reasignar a mano una asignación), y `/api/uniforms` completo (CRUD, config por día de semana, config del Servicio de jóvenes). El sorteo de equipos (`services/teamGeneration.service.js`) sigue igual que en Fase 3 (líder/apoyo/ministros + equipo `YOUTH` opcional), y ahora además: si un mes ya tenía horario generado, re-sortear equipos lo borra y avisa con el warning `HORARIO_BORRADO_POR_RESORTEO`. `recomputeBalance` (`services/balance.service.js`) implementa el algoritmo ya fijado en Fase 1 (menor conteo acumulado, respeta `locked`, desempate aleatorio); el slot `YOUTH_SERVICE` nunca compite por balance, siempre va directo al equipo `YOUTH` del mes. El modelo `SpecialSaturdayMember` y su router se eliminaron por completo (ver arriba). Página pública (`GET /api/schedule/:year/:month`) y el endpoint para finalizar un mes siguen sin implementar — es Fase 5.
- **Frontend** (`/client`, Vite + React, CSS plano propio con tokens centralizados — se evaluó migrar a Bootstrap/Tailwind/MUI y se decidió mantener el enfoque actual, ver `docs/architecture/css-framework-comparison.md`): estructura completa, tema claro/oscuro real, `AuthContext`/`ProtectedRoute` funcionando. `PeopleManager` y `TeamGenerator` son pantallas completas y funcionales (ver detalle de Fase 3 abajo). `EventsManager` ("Horario y eventos") es ahora una pantalla completa y funcional: generar/regenerar horario (con confirmación para la acción destructiva), calendario del mes vía `CalendarGrid`/`ScheduleSlotCard` con lock/desbloqueo y reasignación manual de equipo por turno (deshabilitado para el slot `YOUTH_SERVICE`), resumen de balance por equipo, alta y borrado de eventos extraordinarios con validación de fecha dentro del mes. `UniformsManager` es una pantalla completa y funcional: CRUD de uniformes, configuración de miércoles/domingo y del Servicio de jóvenes. La pantalla `SpecialSaturdayManager` y su entrada de navegación "Sábado especial" se eliminaron por completo — no queda ningún rastro en la interfaz.
- **Pruebas**: 164 pruebas de humo/integración en backend (13 archivos, incluye `scheduleGeneration.test.js`, `events.test.js`, `assignments.test.js`, `uniforms.test.js` nuevos de Fase 4, además de todo lo de fases anteriores) + 56 en frontend (7 archivos, incluye `EventsManager.test.jsx` y `UniformsManager.test.jsx` nuevos), todas pasando. Incluye pruebas de regresión de bugs ya corregidos (ver historial de commits para el detalle completo, ya no se repite acá).
- **Documentación**: `README.md` con quick-start real (pendiente de actualizar la sección "Estado actual", todavía describe la Fase 2); `docs/api/people.md`, `docs/architecture/phase3-teams-contract.md`, `docs/architecture/phase4-schedule-contract.md`.

Próximo paso: **Fase 5 (página pública)**, según el plan en `.claude/plans/resilient-humming-lampson.md` (fases: 1. base del proyecto ✅, 2. personas ✅, 3. ciclo mensual y generación de equipos ✅, 4. horario y balance ✅, 5. página pública, 6. auth admin ✅ adelantada, 7. pulido). Fase 5 necesita, además de la vista pública en sí, un endpoint para pasar un `MonthCycle` de `DRAFT` a `FINALIZED` (no existe todavía en ninguna fase) ya que la página pública solo debe mostrar meses finalizados.
