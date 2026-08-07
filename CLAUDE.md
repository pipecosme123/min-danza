# Proyecto: Organización de equipos y turnos de servicio

## Qué es esto

Aplicación web para organizar personas en equipos mensuales balanceados (líder + apoyo + colaboradores) y rotarlos entre turnos fijos de servicio y eventos extraordinarios, garantizando que todos los equipos acumulen aproximadamente la misma cantidad de participaciones en el mes.

Repositorio nuevo (greenfield) al momento de escribir esto. Stack elegido: **Node.js + React + PostgreSQL**, API Express separada (`/server`) + SPA Vite/React (`/client`), ORM **Prisma**.

El plan de implementación completo (fases, estructura de carpetas, verificación) está en `C:\Users\Usuario\.claude\plans\resilient-humming-lampson.md`. Este archivo documenta las **reglas de negocio y decisiones** acordadas con el usuario para que cualquier sesión futura tenga el contexto sin tener que re-preguntar.

## Reglas de negocio (confirmadas con el usuario)

**Personas**
- Categoría `ELEGIBLE_LIDER` o `COLABORADOR`.
- Carga inicial masiva vía CSV/Excel (nombre, documento opcional, categoría). Un formulario de auto-inscripción queda para una fase futura, no ahora.

**Equipos mensuales**
- Se conforman **una sola vez al mes**; ese mismo equipo rota de horario/servicio durante todo el mes (no se vuelve a sortear por evento).
- Cantidad de personas y de equipos es dinámica: el administrador define cuántos equipos se forman ese mes; el sistema reparte a las personas de forma equitativa.
- **Líder**: exactamente 1 por equipo, sorteado del pool `ELEGIBLE_LIDER`, evitando repetir al líder del mes inmediatamente anterior cuando sea posible (si el pool no alcanza para excluir a todos, se relaja la restricción).
- **Apoyo**: los `ELEGIBLE_LIDER` que no salieron sorteados como líder se reparten equitativamente entre los equipos.
- **Colaboradores**: se reparten equitativamente; **no pueden ser líder** salvo que el administrador los promueva manualmente en un equipo puntual (excepción manual, no ocurre por sorteo automático).
- El sistema elige líderes/apoyo/colaboradores aleatoriamente; el admin puede re-sortear antes de finalizar y editar manualmente cualquier equipo después (incluida la promoción manual de un colaborador a líder).

**Turnos fijos semanales**
- Miércoles 5:00pm y 7:00pm, Domingo 8:00am y 10:30am — **un solo equipo por turno**.
- Excepción: el **último domingo del mes** solo tiene servicio a las **8:00am** (no hay turno de 10:30am ese día), y a ese único servicio se le asignan **2 equipos** en lugar de uno.

**Evento especial del último sábado del mes (6:50pm)**
- Es un equipo aparte, **no** es uno de los equipos regulares del mes.
- Las personas se seleccionan **manualmente** por el administrador (no sorteo).
- **No cuenta** en el balance de participaciones mensual.
- Pertenecer a este equipo **no excluye** a esas personas de su equipo regular del mes.

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

`Person`, `AdminUser`, `MonthCycle`, `Team`, `TeamMember` (rol LEADER/SUPPORT/COLLABORATOR + `manualOverride`), `ServiceSlot` (tipo FIXED/EXTRAORDINARY/SPECIAL, `teamsNeeded`, `countsTowardBalance`, `uniformId`), `SlotAssignment` (con `locked` para fijar asignaciones manuales), `SpecialSaturdayMember`, `Uniform`, `WeekdayUniform` (config de uniforme por día de semana).

## Estado

Aún no se ha escrito código. Este documento y el plan en `.claude/plans/resilient-humming-lampson.md` son la referencia para arrancar la implementación por fases (ver plan: 1. base del proyecto, 2. personas, 3. ciclo mensual y generación de equipos, 4. horario y balance, 5. página pública, 6. auth admin, 7. pulido).
