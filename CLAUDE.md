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
- Fecha: último sábado del mes, hora fija `18:50`. El horario se genera automáticamente junto con los turnos fijos (Fase 4, ver más abajo); el equipo asignado a ese slot **no se elige por evento**, es directamente el equipo `YOUTH` ya sorteado/armado del mes. Su uniforme se asigna a mano por fecha desde la vista de Eventos, igual que cualquier otro turno (ver "Uniformes" más abajo — ya no hay una configuración automática separada para este evento).
- El viejo modelo `SpecialSaturdayMember` (roster manual del "evento especial del último sábado") **se eliminó por completo** del esquema y de la interfaz — no queda ningún rastro de "Sábado especial" en el sistema, fue reemplazado enteramente por este flujo.

**Eventos extraordinarios**
- El administrador los crea indicando fecha, hora, título y cuántos equipos se necesitan (1 o 2), después de que el horario base del mes ya se generó. Se pueden **editar** después de creados (fecha/hora/título/cantidad de equipos/uniforme) sin tener que borrar y recrear el evento.
- El sistema asigna automáticamente el/los equipos que mantengan el balance (misma función `recomputeBalance` que arma el balance inicial).
- **Sí cuentan** dentro del balance de participaciones mensual.
- Regenerar el horario del mes (turnos fijos + Servicio de jóvenes) **no borra** los eventos extraordinarios ya creados — ajustado el 2026-08-08, antes sí se borraban. Solo re-sortear los EQUIPOS del mes (Fase 3) sigue borrando todo el horario, porque cambia de raíz quiénes son los equipos.

**Balance de participaciones**
- La suma de turnos fijos + eventos extraordinarios debe quedar lo más pareja posible entre todos los equipos del mes (menor conteo acumulado gana).
- Además, **se prefiere (sin ser una restricción dura) que un equipo no repita dos o más veces en la misma semana** — ajustado el 2026-08-08. Al elegir equipo para un turno, primero se agrupan los candidatos en "no usados esta semana ISO" vs "ya usados"; se elige del primer grupo si tiene alguno, y solo se cae al segundo cuando no queda alternativa. Dentro de cada grupo manda el menor conteo acumulado (desempate aleatorio). "Semana" = semana ISO (lunes a domingo), lo que agrupa naturalmente el turno de miércoles con el domingo inmediato siguiente.
- El slot del último domingo, al requerir 2 equipos, suma 1 participación para cada uno de los dos equipos asignados ese día.

**Uniformes**
- Se asignan **por fecha concreta**, no por día de la semana — ajustado el 2026-08-08 (antes había una configuración automática por día de semana y otra para el Servicio de jóvenes; **se eliminaron ambas por completo**, sin dejar ni una sugerencia automática). Cada turno generado (fijo, Servicio de jóvenes, extraordinario) nace sin uniforme; el administrador lo asigna a mano desde la vista de Eventos. Al asignar el uniforme de un turno fijo (miércoles o domingo), se aplica a **ambos servicios de esa fecha** a la vez.
- La vista de Uniformes es **solo CRUD** de uniformes (alta, edición, activar/desactivar, con paleta de colores predefinidos + opción de color personalizado) — ya no asigna uniformes a nada, eso vive enteramente en la vista de Eventos.
- Cambiar el uniforme de un turno **no reescribe** turnos de otras fechas ni de meses distintos — es una asignación puntual, no una configuración global.

**Acceso**
- Un único administrador con login (JWT). No hay múltiples cuentas admin por ahora.
- Los usuarios finales **no tienen login** todavía; existe una **página pública** (sin autenticación) donde cualquiera puede ver la organización completa del mes: equipos, integrantes y horarios asignados.

## Explícitamente fuera de alcance ahora (pero a tener en cuenta para no bloquear el diseño)

- Formulario de auto-inscripción de personas.
- Login de usuarios finales (hoy solo consultan la página pública).
- Múltiples administradores.
- Que los líderes reporten asistencia, excusas, inasistencias de su equipo, o apoyos puntuales de colaboradores externos a su equipo — funcionalidad prevista a futuro, el modelo de datos no debe cerrarle la puerta a esto (por eso `Team`/`TeamMember`/`ServiceSlot` están modelados como entidades independientes y no como campos sueltos).

## Modelo de datos (resumen — ver plan para el detalle completo)

`Person` (incluye `isJoven`), `AdminUser`, `MonthCycle` (incluye `youthTeamEnabled`/`youthTeamSize`, solo como default precargado en el form), `Team` (`teamType` REGULAR/YOUTH), `TeamMember` (rol LEADER/SUPPORT/COLLABORATOR + `manualOverride`, `teamType` denormalizado desde `Team`), `ServiceSlot` (tipo FIXED/EXTRAORDINARY/YOUTH_SERVICE — antes `SPECIAL`, renombrado en Fase 4 —, `teamsNeeded`, `countsTowardBalance`, `uniformId` asignado por fecha, sin default automático), `SlotAssignment` (con `locked` para fijar asignaciones manuales), `Uniform`. `SpecialSaturdayMember` (Fase 4) y `WeekdayUniform`/`YouthServiceUniform` (Fase 4b, 2026-08-08) **se eliminaron del esquema** — el equipo de jóvenes y los uniformes ya no usan configuración automática recurrente, todo se asigna a mano por fecha/evento concreto.

## Estado

**Fases 1 a 4 completas y funcionando** (base del proyecto, personas, ciclo mensual y generación de equipos, horario y balance), más un ajuste post-Fase-4 (Fase 4b, 2026-08-08: uniformes por fecha, balance por semana, eventos editables, vista de calendario) tras probar la Fase 4 en el navegador. Repo con Git propio (aislado, commit inicial `c8d51ed`). Detalle del esquema y la estructura de carpetas en `docs/architecture/phase1-schema-design.md`; contrato de diseño de Fase 2 en `docs/architecture/phase2-people-contract.md`; referencia de API real de personas en `docs/api/people.md`; contrato de diseño de Fase 3 en `docs/architecture/phase3-teams-contract.md`; contratos de diseño de Fase 4 en `docs/architecture/phase4-schedule-contract.md` y `docs/architecture/phase4b-schedule-refinements-contract.md`.

- **Backend** (`/server`, Express + Prisma 6.x + PostgreSQL en contenedor Docker dedicado, puerto 5433): esquema completo migrado con las invariantes de negocio protegidas a nivel de base de datos, seed corrido. `GET /health`, `POST /api/auth/login` (JWT + rate limiting), `/api/people` completo (incluida la columna opcional "Joven" en el import), el ciclo mensual (`GET`/`POST /api/months`, `GET /api/months/:id`, `POST /api/months/:id/generate-teams`, `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId`) y el horario/balance funcionan de verdad contra la base real: `POST /api/months/:id/generate-schedule` (genera los turnos fijos de miércoles/domingo con la excepción del último domingo, y el slot `YOUTH_SERVICE` si el mes tiene equipo de jóvenes, todos SIN uniforme — se asigna después por fecha —, más el balance inicial; regenerar preserva los eventos `EXTRAORDINARY` ya creados), `GET /api/months/:id/schedule` (horario + balance por equipo), `POST/PATCH /api/months/:id/events`/`DELETE /api/events/:eventId` (eventos extraordinarios, editables sin borrar, recalculan balance; `EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO` si se intenta bajar `teamsNeeded` por debajo de asignaciones ya bloqueadas), `PATCH /api/assignments/:id` (bloquear/desbloquear o reasignar a mano una asignación), `PATCH /api/slots/:id` (asignar/limpiar el uniforme de un turno puntual, cualquier tipo), y `/api/uniforms` como CRUD puro (`GET`, `POST`, `PATCH /:id` — ya no hay endpoints de configuración automática). El sorteo de equipos (`services/teamGeneration.service.js`) sigue igual que en Fase 3 (líder/apoyo/ministros + equipo `YOUTH` opcional); si un mes ya tenía horario generado, re-sortear equipos lo sigue borrando todo y avisa con `HORARIO_BORRADO_POR_RESORTEO`. `recomputeBalance` (`services/balance.service.js`) prioriza no repetir equipo en la misma semana ISO, y dentro de eso el menor conteo acumulado (desempate aleatorio); el slot `YOUTH_SERVICE` nunca compite, siempre va directo al equipo `YOUTH` del mes. Página pública (`GET /api/schedule/:year/:month`) y el endpoint para finalizar un mes siguen sin implementar — es Fase 5.
- **Frontend** (`/client`, Vite + React, CSS plano propio con tokens centralizados — se evaluó migrar a Bootstrap/Tailwind/MUI y se decidió mantener el enfoque actual, ver `docs/architecture/css-framework-comparison.md`): estructura completa, tema claro/oscuro real, `AuthContext`/`ProtectedRoute` funcionando. `PeopleManager` y `TeamGenerator` son pantallas completas y funcionales. `EventsManager` ("Horario y eventos") es una pantalla completa y funcional: generar/regenerar horario, dos vistas intercambiables (lista agrupada por fecha con `CalendarGrid`/`ScheduleSlotCard`, y grilla mensual real con `MonthOccupancyCalendar`), lock/desbloqueo y reasignación manual de equipo por turno, asignación de uniforme por turno (sincronizada entre ambos servicios de una misma fecha para turnos fijos), alta y edición en el lugar de eventos extraordinarios (ya no hace falta borrar para corregir algo). `UniformsManager` volvió a ser una pantalla de CRUD puro de uniformes, con listado numerado, filtros (nombre/color/estado) y un selector de paleta de colores predefinidos + opción personalizada (`ColorPalettePicker`). La pantalla `SpecialSaturdayManager` y su entrada de navegación "Sábado especial" se eliminaron por completo — no queda ningún rastro en la interfaz.
- **Pruebas**: 176 pruebas de humo/integración en backend (14 archivos) + 72 en frontend (9 archivos), todas pasando. Incluye pruebas de regresión de bugs ya corregidos (ver historial de commits para el detalle completo, ya no se repite acá) — la más reciente: un bug real en `Modal.jsx` donde escribir en cualquier campo de un modal devolvía el foco al botón "Cerrar" después de cada letra (el efecto de foco dependía de `onClose`, que casi todos los llamadores recrean en cada render).
- **Documentación**: `README.md` con quick-start real (pendiente de actualizar la sección "Estado actual", todavía describe la Fase 2); `docs/api/people.md`, `docs/architecture/phase3-teams-contract.md`, `docs/architecture/phase4-schedule-contract.md`, `docs/architecture/phase4b-schedule-refinements-contract.md`.

Próximo paso: **Fase 5 (página pública)**, según el plan en `.claude/plans/resilient-humming-lampson.md` (fases: 1. base del proyecto ✅, 2. personas ✅, 3. ciclo mensual y generación de equipos ✅, 4. horario y balance ✅, 5. página pública, 6. auth admin ✅ adelantada, 7. pulido). Fase 5 necesita, además de la vista pública en sí, un endpoint para pasar un `MonthCycle` de `DRAFT` a `FINALIZED` (no existe todavía en ninguna fase) ya que la página pública solo debe mostrar meses finalizados.
