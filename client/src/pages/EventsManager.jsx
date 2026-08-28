import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMonthTeams, deleteMonth } from '../api/months.js';
import {
  generateSchedule,
  getMonthSchedule,
  createEvent,
  updateEvent,
  deleteEvent,
  cancelEvent,
  cancelYouthService,
  updateAssignment,
  updateSlotUniform,
  finalizeMonth,
} from '../api/schedule.js';
import { getUniforms } from '../api/uniforms.js';
import { describeApiError } from '../utils/apiError.js';
import { describeEventError } from '../utils/eventErrors.js';
import { formatMonthYear, formatCivilDate, formatTimeLabel, isMonthCurrentOrFuture } from '../utils/dates.js';
import { groupSlotsByDate } from '../utils/schedule.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { useMonthSelector } from '../hooks/useMonthSelector.js';
import { Button } from '../components/ui/Button.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { Field } from '../components/ui/Field.jsx';
import { CalendarGrid } from '../components/domain/CalendarGrid.jsx';
import { ScheduleSlotCard } from '../components/domain/ScheduleSlotCard.jsx';
import { MonthOccupancyCalendar } from '../components/domain/MonthOccupancyCalendar.jsx';
import { BalanceSummary } from '../components/domain/BalanceSummary.jsx';
import { EventGroupsSection } from '../components/domain/EventGroupsSection.jsx';
import { MonthVersesSection } from '../components/domain/MonthVersesSection.jsx';
import './EventsManager.css';

const EMPTY_EVENT_FORM = { date: '', startTime: '', title: '', teamsNeeded: '1', uniformId: '' };

/** Traduce los códigos de error de "Eliminar mes" a lenguaje llano. */
function describeDeleteMonthError(info) {
  if (info.code === 'MES_PASADO') {
    return 'Este mes ya pasó, no se puede eliminar.';
  }
  return info.message;
}

/** Traduce los códigos de error de "Finalizar mes" a lenguaje llano. Contrato: `docs/architecture/phase5-public-page-contract.md` §1. */
function describeFinalizeError(info) {
  if (info.code === 'MES_YA_FINALIZADO') {
    return 'Este mes ya estaba finalizado.';
  }
  if (info.code === 'MES_INCOMPLETO') {
    const { hasTeams, hasSchedule } = info.details || {};
    if (!hasTeams && !hasSchedule) {
      return 'Todavía falta generar los equipos y el horario de este mes.';
    }
    if (!hasTeams) {
      return 'Todavía falta generar los equipos de este mes.';
    }
    if (!hasSchedule) {
      return 'Todavía falta generar el horario de este mes.';
    }
  }
  if (info.code === 'TURNOS_SIN_UNIFORME') {
    const count = info.details?.slots?.length ?? 0;
    return `Hay ${count} turno${count === 1 ? '' : 's'} sin uniforme asignado. Asigná el uniforme de cada turno antes de finalizar.`;
  }
  return info.message;
}

/**
 * Campos del formulario de evento extraordinario (fecha, hora, título,
 * cantidad de equipos, uniforme), compartidos entre "Nuevo evento" y
 * "Editar evento" para no duplicar el JSX. Contrato:
 * `docs/architecture/phase4b-schedule-refinements-contract.md` §5.1.
 *
 * @param {{ form: Object, onFieldChange: (key: string, value: string) => void, uniforms: Array, maxTeams: number }} props
 */
function EventFormFields({ form, onFieldChange, uniforms, maxTeams }) {
  // Desde 1 hasta la cantidad de equipos REGULAR del mes (antes fijo en 1/2):
  // un mes puede tener más de 2 equipos, y el admin debe poder pedirlos todos
  // para un evento puntual. Si por algún motivo todavía no hay equipos
  // cargados, se deja al menos la opción "1" para no dejar el select vacío.
  const teamOptions = Array.from({ length: Math.max(maxTeams || 1, 1) }, (_, index) => index + 1);

  return (
    <>
      <Field
        label="Fecha"
        type="date"
        required
        value={form.date}
        onChange={(event) => onFieldChange('date', event.target.value)}
      />
      <Field
        label="Hora"
        type="time"
        required
        value={form.startTime}
        onChange={(event) => onFieldChange('startTime', event.target.value)}
      />
      <Field
        label="Título"
        required
        maxLength={100}
        value={form.title}
        onChange={(event) => onFieldChange('title', event.target.value)}
      />
      <Field
        as="select"
        label="Cantidad de equipos"
        value={form.teamsNeeded}
        onChange={(event) => onFieldChange('teamsNeeded', event.target.value)}
      >
        {teamOptions.map((count) => (
          <option key={count} value={String(count)}>
            {count} equipo{count === 1 ? '' : 's'}
          </option>
        ))}
      </Field>
      <Field
        as="select"
        label="Uniforme"
        hint="Opcional."
        value={form.uniformId}
        onChange={(event) => onFieldChange('uniformId', event.target.value)}
      >
        <option value="">Sin uniforme específico</option>
        {uniforms.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Field>
    </>
  );
}

/**
 * Pantalla de la Fase 4 (ampliada por Fase 4b): elegir el mes en curso,
 * generar (o regenerar) su horario de turnos fijos + Servicio de jóvenes,
 * ajustar manualmente las asignaciones (bloquear/reasignar equipo, elegir
 * uniforme por turno) y administrar eventos extraordinarios (crear, editar,
 * eliminar). Ver `docs/architecture/phase4-schedule-contract.md` y
 * `docs/architecture/phase4b-schedule-refinements-contract.md` para el
 * contrato exacto de la API que consume.
 */
export function EventsManager() {
  const { showSuccess, showError, showWarning } = useToast();
  const { months, monthsLoading, monthsError, fetchMonths, selectedMonthId, setSelectedMonthId, selectedMonth } =
    useMonthSelector();

  // ---- Equipos del mes (para saber si ya hay equipos regulares sorteados) ----
  const { data: teamsData, loading: teamsLoading, error: teamsError, execute: fetchTeams } = useApi(getMonthTeams);

  useEffect(() => {
    if (selectedMonthId) fetchTeams(selectedMonthId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonthId]);

  const teams = teamsData?.teams ?? [];
  const hasRegularTeams = teams.some((t) => t.teamType === 'REGULAR');

  // ---- Horario del mes ----
  const {
    data: scheduleData,
    loading: scheduleLoading,
    error: scheduleError,
    execute: fetchSchedule,
  } = useApi(getMonthSchedule);

  useEffect(() => {
    if (selectedMonthId && hasRegularTeams) {
      fetchSchedule(selectedMonthId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonthId, hasRegularTeams]);

  function refetchSchedule() {
    if (selectedMonthId) fetchSchedule(selectedMonthId).catch(() => {});
  }

  const slots = scheduleData?.slots ?? [];
  const balance = scheduleData?.balance ?? [];
  const balanceForSummary = balance.map((b) => ({ id: b.teamId, label: b.label, count: b.count }));
  const regularTeamOptions = balance.map((b) => ({ id: b.teamId, label: b.label }));

  const monthFinalized = selectedMonth?.status === 'FINALIZED';

  // `monthIsPast` gobierna casi todo lo que sigue permitido tras publicar un
  // mes: agregar/cancelar/eliminar evento (o el Servicio de jóvenes),
  // cambiar el uniforme de un turno, bloquear/reasignar una asignación y
  // "Editar evento" completo — todo se deshabilita solo cuando el mes
  // finalizado ya pasó, no cuando está finalizado pero es el mes actual o
  // uno futuro. Lo único que sigue exigiendo `DRAFT` sin excepción es
  // (re)sortear equipos y generar/regenerar el horario base. Ver
  // `docs/architecture/phase4c-post-publish-edits-contract.md` §0/§8.
  const monthIsPast =
    monthFinalized && Boolean(selectedMonth) && !isMonthCurrentOrFuture(selectedMonth.year, selectedMonth.month);
  const eventActionsDisabled = monthIsPast;

  function handleMonthChange(id) {
    setSelectedMonthId(id);
  }

  // ---- Finalizar mes (publica el mes en la página pública; irreversible en esta fase) ----
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeLoading, setFinalizeLoading] = useState(false);

  // Turnos sin uniforme (excluidos los cancelados, que ya no lo necesitan) --
  // misma condición que exige el servidor (TURNOS_SIN_UNIFORME, 2026-08-22).
  const slotsWithoutUniform = slots.filter((s) => !s.uniform && !s.cancelledAt);

  // Mismas condiciones que exige el servidor (`MES_INCOMPLETO`/`TURNOS_SIN_UNIFORME`),
  // anticipadas en el cliente para no depender de un viaje al servidor para saber si
  // el botón debe estar habilitado. `teamsLoading`/`scheduleLoading` también
  // deshabilitan: mientras cargan, `hasRegularTeams`/`slots` todavía no reflejan el
  // estado real del mes.
  const finalizeDisabledReason = monthFinalized
    ? 'Este mes ya está finalizado.'
    : teamsLoading || scheduleLoading
      ? 'Cargando la información del mes...'
      : !hasRegularTeams && slots.length === 0
        ? 'Todavía falta generar los equipos y el horario de este mes.'
        : !hasRegularTeams
          ? 'Todavía falta generar los equipos de este mes.'
          : slots.length === 0
            ? 'Todavía falta generar el horario de este mes.'
            : slotsWithoutUniform.length > 0
              ? `Hay ${slotsWithoutUniform.length} turno${slotsWithoutUniform.length === 1 ? '' : 's'} sin uniforme asignado.`
              : null;

  async function handleFinalizeConfirm() {
    if (!selectedMonthId) return;
    setFinalizeLoading(true);
    try {
      await finalizeMonth(selectedMonthId);
      showSuccess('Se finalizó el mes: ya está visible en la página pública.');
      setFinalizeOpen(false);
      await fetchMonths();
    } catch (err) {
      showError(describeFinalizeError(describeApiError(err)));
    } finally {
      setFinalizeLoading(false);
    }
  }

  // ---- Eliminar mes (borra equipos, horario y asignaciones por completo) ----
  // DRAFT: sin restricción. FINALIZED: solo mes actual o futuro (mismo
  // `monthIsPast` que ya deshabilita agregar/cancelar eventos y el uniforme
  // tras publicar) -- 409 MES_PASADO si ya pasó. Ver
  // docs/architecture/phase3-teams-contract.md.
  const [deleteMonthOpen, setDeleteMonthOpen] = useState(false);
  const [deleteMonthLoading, setDeleteMonthLoading] = useState(false);
  const deleteMonthDisabledReason = monthIsPast ? 'Este mes ya pasó, no se puede eliminar.' : null;

  async function handleDeleteMonthConfirm() {
    if (!selectedMonthId) return;
    setDeleteMonthLoading(true);
    try {
      await deleteMonth(selectedMonthId);
      showSuccess('Se eliminó el mes.');
      setDeleteMonthOpen(false);
      // useMonthSelector solo reelige un mes cuando selectedMonthId está
      // vacío; si se deja el id del mes ya borrado, la lista se refresca
      // pero selectedMonth queda null con un id fantasma.
      setSelectedMonthId('');
      await fetchMonths();
    } catch (err) {
      showError(describeDeleteMonthError(describeApiError(err)));
    } finally {
      setDeleteMonthLoading(false);
    }
  }

  // ---- Uniformes activos (para el selector de uniforme de cada turno y del evento) ----
  const { data: uniformsData, error: uniformsError, execute: fetchUniforms } = useApi(getUniforms, {
    immediate: true,
  });
  const activeUniforms = (uniformsData ?? []).filter((u) => u.active);

  // ---- Vista: lista agrupada (por defecto) o calendario mensual ----
  const [scheduleView, setScheduleView] = useState('list'); // 'list' | 'calendar'

  // ---- Generar horario (primera vez, no destructivo) ----
  const [generateLoading, setGenerateLoading] = useState(false);

  async function handleGenerateSchedule() {
    if (!selectedMonthId) return;
    setGenerateLoading(true);
    try {
      const result = await generateSchedule(selectedMonthId, {});
      showSuccess('Se generó el horario del mes.');
      (result.warnings || []).forEach((warning) => showWarning(warning.message));
      refetchSchedule();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setGenerateLoading(false);
    }
  }

  // ---- Regenerar horario (destructivo solo para turnos fijos/jóvenes, con confirmación) ----
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);

  async function handleRegenerateConfirm() {
    if (!selectedMonthId) return;
    setRegenerateLoading(true);
    try {
      const result = await generateSchedule(selectedMonthId, { regenerate: true });
      showSuccess('Se regeneró el horario del mes.');
      (result.warnings || []).forEach((warning) => showWarning(warning.message));
      setRegenerateOpen(false);
      refetchSchedule();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setRegenerateLoading(false);
    }
  }

  // ---- Bloquear/desbloquear y reasignar una asignación ----
  const [busyAssignmentId, setBusyAssignmentId] = useState(null);

  async function handleToggleLock(assignmentId, currentLocked) {
    setBusyAssignmentId(assignmentId);
    try {
      await updateAssignment(assignmentId, { locked: !currentLocked });
      refetchSchedule();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusyAssignmentId(null);
    }
  }

  async function handleReassign(assignmentId, teamId) {
    setBusyAssignmentId(assignmentId);
    try {
      await updateAssignment(assignmentId, { teamId });
      showSuccess('Se reasignó el equipo del turno.');
      refetchSchedule();
    } catch (err) {
      const info = describeApiError(err);
      showError(info.code === 'EQUIPO_NO_VALIDO' ? 'Ese equipo no es válido para este turno.' : info.message);
    } finally {
      setBusyAssignmentId(null);
    }
  }

  // ---- Asignar/cambiar el uniforme de un turno puntual ----
  // No hay endpoint de "asignar a una fecha completa" en el backend: si el
  // turno es FIXED y el mes todavía está en borrador, se sincroniza a mano
  // llamando updateSlotUniform para cada ServiceSlot FIXED que comparta la
  // misma fecha (a lo sumo 2, ej. miércoles 17:00/19:00), en paralelo con
  // Promise.allSettled (mismo patrón de acciones en lote que ya usa
  // PeopleManager). Una vez que el mes está FINALIZED (aunque sea actual/
  // futuro y por lo tanto editable), esa sincronización se desactiva a
  // propósito: cambiar el uniforme de un turno ya publicado afecta
  // únicamente a ese turno puntual, nunca a su hermano del mismo día
  // (pedido explícito del usuario). Ver
  // `docs/architecture/phase4c-post-publish-edits-contract.md` §4/§8.
  const [uniformBusySlotIds, setUniformBusySlotIds] = useState(() => new Set());

  async function handleSlotUniformChange(slot, uniformId) {
    const shouldSyncSiblingDay = slot.slotType === 'FIXED' && !monthFinalized;
    const targets = shouldSyncSiblingDay ? slots.filter((s) => s.slotType === 'FIXED' && s.date === slot.date) : [slot];

    setUniformBusySlotIds(new Set(targets.map((t) => t.id)));
    const results = await Promise.allSettled(targets.map((t) => updateSlotUniform(t.id, uniformId)));
    setUniformBusySlotIds(new Set());

    const failures = results
      .map((result, index) => ({ result, target: targets[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length === 0) {
      showSuccess(targets.length > 1 ? 'Se actualizó el uniforme de ambos turnos de este día.' : 'Se actualizó el uniforme del turno.');
    } else if (failures.length === targets.length) {
      showError(`No se pudo actualizar el uniforme (${describeEventError(describeApiError(failures[0].result.reason))}).`);
    } else {
      const failedLabels = failures.map(({ target }) => formatTimeLabel(target.startTime)).join(', ');
      showWarning(`Se actualizó el uniforme, pero el turno de las ${failedLabels} no se pudo actualizar. Intentá de nuevo.`);
    }
    refetchSchedule();
  }

  // ---- Eliminar evento extraordinario ----
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteEvent(deleteTarget.id);
      showSuccess('Se eliminó el evento.');
      setDeleteTarget(null);
      refetchSchedule();
    } catch (err) {
      showError(describeEventError(describeApiError(err)));
    } finally {
      setDeleteLoading(false);
    }
  }

  // ---- Cancelar evento extraordinario o Servicio de jóvenes (distinto de
  // eliminar: el turno queda registrado y visible, marcado como cancelado).
  // `cancelTarget` puede ser un slot EXTRAORDINARY o el YOUTH_SERVICE; se
  // ramifica al endpoint correcto según su `slotType`. ----
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const cancelTargetIsYouth = cancelTarget?.slotType === 'YOUTH_SERVICE';

  async function handleCancelConfirm() {
    if (!cancelTarget || !selectedMonthId) return;
    setCancelLoading(true);
    try {
      if (cancelTargetIsYouth) {
        await cancelYouthService(selectedMonthId);
        showSuccess('Se canceló el Servicio de jóvenes.');
      } else {
        await cancelEvent(cancelTarget.id);
        showSuccess('Se canceló el evento.');
      }
      setCancelTarget(null);
      refetchSchedule();
    } catch (err) {
      showError(describeEventError(describeApiError(err)));
    } finally {
      setCancelLoading(false);
    }
  }

  // ---- Crear / editar evento extraordinario (mismo modal y formulario) ----
  const [eventModalMode, setEventModalMode] = useState(null); // null | 'create' | 'edit'
  const [eventTarget, setEventTarget] = useState(null); // slot en edición, solo cuando mode === 'edit'
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [eventError, setEventError] = useState(null);

  function openCreateEventModal() {
    setEventForm(EMPTY_EVENT_FORM);
    setEventTarget(null);
    setEventError(null);
    setEventModalMode('create');
  }

  function openEditEventModal(slot) {
    setEventForm({
      date: slot.date,
      startTime: slot.startTime,
      title: slot.title || '',
      teamsNeeded: String(slot.teamsNeeded),
      uniformId: slot.uniform?.id || '',
    });
    setEventTarget(slot);
    setEventError(null);
    setEventModalMode('edit');
  }

  function closeEventModal() {
    setEventModalMode(null);
  }

  function updateEventField(key, value) {
    setEventForm((form) => ({ ...form, [key]: value }));
    setEventError(null);
  }

  async function submitEventForm(event) {
    event.preventDefault();
    if (!selectedMonthId || !selectedMonth) return;

    const [year, month] = eventForm.date.split('-').map(Number);
    if (!eventForm.date || year !== selectedMonth.year || month !== selectedMonth.month) {
      setEventError(`La fecha debe estar dentro de ${formatMonthYear(selectedMonth.year, selectedMonth.month)}.`);
      return;
    }

    setEventSubmitting(true);
    setEventError(null);
    try {
      if (eventModalMode === 'edit') {
        await updateEvent(eventTarget.id, {
          date: eventForm.date,
          startTime: eventForm.startTime,
          title: eventForm.title.trim(),
          teamsNeeded: Number(eventForm.teamsNeeded),
          uniformId: eventForm.uniformId || null,
        });
        showSuccess('Se actualizó el evento.');
      } else {
        await createEvent(selectedMonthId, {
          date: eventForm.date,
          startTime: eventForm.startTime,
          title: eventForm.title.trim(),
          teamsNeeded: Number(eventForm.teamsNeeded),
          ...(eventForm.uniformId ? { uniformId: eventForm.uniformId } : {}),
        });
        showSuccess('Se creó el evento extraordinario.');
      }
      closeEventModal();
      refetchSchedule();
    } catch (err) {
      setEventError(describeEventError(describeApiError(err)));
    } finally {
      setEventSubmitting(false);
    }
  }

  const eventFormInvalid = !eventForm.date.trim() || !eventForm.startTime.trim() || !eventForm.title.trim();

  return (
    <div>
      <header className="page-header">
        <h1>Horario y eventos</h1>
        <p className="page-header__description">
          Genera el horario del mes (turnos fijos de miércoles y domingo, y el Servicio de jóvenes si corresponde),
          ajusta a mano las asignaciones y el uniforme de cada turno, y agrega eventos extraordinarios fuera de los
          turnos fijos.
        </p>
      </header>

      {monthsLoading ? <Spinner label="Cargando meses..." /> : null}

      {!monthsLoading && monthsError ? (
        <ErrorMessage message={monthsError.message} onRetry={() => fetchMonths()} />
      ) : null}

      {!monthsLoading && !monthsError && months.length === 0 ? (
        <EmptyState
          title="Todavía no hay ningún mes creado"
          description="Crea el primer mes desde la sección «Equipos» antes de generar un horario."
          action={
            <Link to="/admin/equipos">
              <Button type="button">Ir a Equipos</Button>
            </Link>
          }
        />
      ) : null}

      {!monthsLoading && !monthsError && months.length > 0 ? (
        <>
          <div className="events-manager__toolbar">
            <Field
              as="select"
              label="Mes"
              value={selectedMonthId}
              onChange={(event) => handleMonthChange(event.target.value)}
            >
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatMonthYear(m.year, m.month)}
                  {m.status === 'FINALIZED' ? ' · Finalizado' : ''}
                </option>
              ))}
            </Field>
            <Button
              variant="danger"
              onClick={() => setDeleteMonthOpen(true)}
              disabled={Boolean(deleteMonthDisabledReason)}
              title={deleteMonthDisabledReason || undefined}
            >
              Eliminar mes
            </Button>
          </div>

          {monthFinalized ? (
            <p className="events-manager__finalized-notice" role="status">
              {monthIsPast
                ? 'Este mes ya pasó y está finalizado: no admite ningún cambio.'
                : 'Este mes está finalizado: no se puede volver a sortear equipos ni regenerar el horario. Mientras sea el mes actual o uno futuro, todavía podés bloquear/reasignar turnos, editar, agregar, cancelar o eliminar eventos, cambiar el uniforme de un turno puntual, y editar la composición de los equipos desde «Equipos».'}
            </p>
          ) : null}

          <div className="events-manager__finalize-bar">
            <div>
              <p className="events-manager__finalize-summary">
                {monthFinalized
                  ? 'Este mes está publicado en la página pública.'
                  : 'Cuando los equipos y el horario estén listos, finaliza el mes para publicarlo.'}
              </p>
              {!monthFinalized && finalizeDisabledReason ? (
                <p className="events-manager__finalize-reason">{finalizeDisabledReason}</p>
              ) : null}
            </div>
            <Button
              variant="primary"
              onClick={() => setFinalizeOpen(true)}
              disabled={Boolean(finalizeDisabledReason)}
              title={finalizeDisabledReason || undefined}
            >
              Finalizar mes
            </Button>
          </div>

          <MonthVersesSection monthId={selectedMonthId} disabled={eventActionsDisabled} />

          {uniformsError ? (
            <ErrorMessage
              message="No se pudieron cargar los uniformes disponibles. Podés seguir sin asignar uniforme por ahora."
              onRetry={fetchUniforms}
            />
          ) : null}

          {teamsLoading ? <Spinner label="Cargando equipos del mes..." /> : null}

          {!teamsLoading && teamsError ? (
            <ErrorMessage message={teamsError.message} onRetry={() => fetchTeams(selectedMonthId)} />
          ) : null}

          {!teamsLoading && !teamsError && !hasRegularTeams ? (
            <EmptyState
              title="Primero generá los equipos de este mes"
              description="El horario reparte los turnos entre los equipos ya sorteados. Andá a «Equipos» para sortearlos."
              action={
                <Link to="/admin/equipos">
                  <Button type="button">Ir a Equipos</Button>
                </Link>
              }
            />
          ) : null}

          {!teamsLoading && !teamsError && hasRegularTeams ? (
            <>
              {scheduleLoading ? <Spinner label="Cargando horario..." /> : null}

              {!scheduleLoading && scheduleError ? (
                <ErrorMessage message={scheduleError.message} onRetry={refetchSchedule} />
              ) : null}

              {!scheduleLoading && !scheduleError && slots.length === 0 ? (
                <EmptyState
                  title="Este mes todavía no tiene horario generado"
                  description="Se generan los turnos de miércoles y domingo (y el Servicio de jóvenes, si el mes tiene ese equipo), con los equipos ya repartidos de forma pareja."
                  action={
                    <Button onClick={handleGenerateSchedule} loading={generateLoading} disabled={monthFinalized}>
                      Generar horario
                    </Button>
                  }
                />
              ) : null}

              {!scheduleLoading && !scheduleError && slots.length > 0 ? (
                <>
                  <div className="events-manager__action-bar">
                    <p className="events-manager__action-summary">
                      {slots.length} {slots.length === 1 ? 'turno generado' : 'turnos generados'} para este mes.
                    </p>
                    <div className="events-manager__action-bar-buttons">
                      <Button onClick={openCreateEventModal} variant="secondary" disabled={eventActionsDisabled}>
                        Agregar evento extraordinario
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setRegenerateOpen(true)}
                        disabled={monthFinalized}
                      >
                        Regenerar horario
                      </Button>
                    </div>
                  </div>

                  <BalanceSummary teams={balanceForSummary} />

                  <div className="events-manager__view-toggle" role="group" aria-label="Vista del horario">
                    <Button
                      type="button"
                      variant={scheduleView === 'list' ? 'primary' : 'secondary'}
                      aria-pressed={scheduleView === 'list'}
                      onClick={() => setScheduleView('list')}
                    >
                      Vista de lista
                    </Button>
                    <Button
                      type="button"
                      variant={scheduleView === 'calendar' ? 'primary' : 'secondary'}
                      aria-pressed={scheduleView === 'calendar'}
                      onClick={() => setScheduleView('calendar')}
                    >
                      Vista de calendario
                    </Button>
                  </div>

                  {scheduleView === 'list' ? (
                    <div className="events-manager__calendar">
                      <CalendarGrid
                        groups={groupSlotsByDate(slots)}
                        renderSlot={(slot) => (
                          <ScheduleSlotCard
                            slot={slot}
                            regularTeams={regularTeamOptions}
                            uniforms={activeUniforms}
                            disabled={monthIsPast}
                            eventActionsDisabled={eventActionsDisabled}
                            busyAssignmentId={busyAssignmentId}
                            uniformBusy={uniformBusySlotIds.has(slot.id)}
                            onToggleLock={handleToggleLock}
                            onReassign={handleReassign}
                            onUniformChange={handleSlotUniformChange}
                            onDeleteEvent={(s) => setDeleteTarget(s)}
                            onCancelEvent={(s) => setCancelTarget(s)}
                            onEditEvent={openEditEventModal}
                          />
                        )}
                      />
                    </div>
                  ) : (
                    <div className="events-manager__calendar">
                      <MonthOccupancyCalendar year={selectedMonth.year} month={selectedMonth.month} slots={slots} />
                    </div>
                  )}

                  <EventGroupsSection
                    monthId={selectedMonthId}
                    regularTeamOptions={regularTeamOptions}
                    uniforms={activeUniforms}
                    disabled={eventActionsDisabled}
                    onChanged={refetchSchedule}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {/* Finalizar mes: publica el mes en la página pública. Irreversible en esta fase (no hay "des-finalizar"). */}
      <ConfirmDialog
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        onConfirm={handleFinalizeConfirm}
        title="Finalizar el mes"
        description={`Se publicará ${
          selectedMonth ? formatMonthYear(selectedMonth.year, selectedMonth.month) : 'este mes'
        } en la página pública, con los equipos y el horario tal como están ahora mismo. A partir de ese momento no vas a poder volver a sortear equipos ni regenerar el horario; mientras el mes siga siendo el actual o uno futuro vas a poder seguir ajustando turnos y eventos puntuales. Hoy no existe una forma de deshacer esta acción.`}
        confirmLabel="Sí, finalizar mes"
        variant="danger"
        loading={finalizeLoading}
      />

      {/* Eliminar mes: borra equipos, horario y asignaciones por completo. DRAFT
          sin restricción; FINALIZED solo si es el mes actual o uno futuro. */}
      <ConfirmDialog
        open={deleteMonthOpen}
        onClose={() => setDeleteMonthOpen(false)}
        onConfirm={handleDeleteMonthConfirm}
        title="Eliminar el mes"
        description={`Se eliminará ${
          selectedMonth ? formatMonthYear(selectedMonth.year, selectedMonth.month) : 'este mes'
        } por completo: sus equipos, su horario y todas las asignaciones. ${
          monthFinalized ? 'Como ya estaba publicado, también desaparece de la página pública y de su historial. ' : ''
        }Esta acción no se puede deshacer.`}
        confirmLabel="Sí, eliminar mes"
        variant="danger"
        loading={deleteMonthLoading}
      />

      {/* Regenerar horario: solo turnos fijos y Servicio de jóvenes, los eventos extraordinarios se conservan */}
      <ConfirmDialog
        open={regenerateOpen}
        onClose={() => setRegenerateOpen(false)}
        onConfirm={handleRegenerateConfirm}
        title="Regenerar el horario del mes"
        description="Esto vuelve a generar los turnos fijos de miércoles y domingo y el Servicio de jóvenes de este mes desde cero. Los eventos extraordinarios que ya creaste NO se borran: se conservan tal cual, y el balance de participaciones se recalcula considerando también esos eventos. Esta acción no se puede deshacer."
        confirmLabel="Sí, regenerar"
        variant="danger"
        loading={regenerateLoading}
      />

      {/* Eliminar evento extraordinario */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Eliminar evento"
        description={
          deleteTarget
            ? `Se eliminará "${deleteTarget.title}" del ${formatCivilDate(deleteTarget.date)}. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={deleteLoading}
      />

      {/* Cancelar evento extraordinario o Servicio de jóvenes: a diferencia de
          eliminar, el turno queda registrado y visible, marcado como cancelado.
          No hay forma de "descancelarlo". */}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelConfirm}
        title={cancelTargetIsYouth ? 'Cancelar Servicio de jóvenes' : 'Cancelar evento'}
        description={
          cancelTarget
            ? cancelTargetIsYouth
              ? `Se marcará el Servicio de jóvenes del ${formatCivilDate(cancelTarget.date)} como cancelado. El turno queda registrado y visible (ya no necesita equipo asignado ni cuenta en el balance), pero el equipo de jóvenes y sus integrantes se conservan. Hoy no existe una forma de deshacer esto.`
              : `Se marcará "${cancelTarget.title}" del ${formatCivilDate(cancelTarget.date)} como cancelado. El evento queda registrado y visible (ya no necesita equipo asignado). Hoy no existe una forma de deshacer esto: si te equivocás, hay que crear un evento nuevo.`
            : ''
        }
        confirmLabel={cancelTargetIsYouth ? 'Sí, cancelar Servicio de jóvenes' : 'Sí, cancelar evento'}
        variant="danger"
        loading={cancelLoading}
      />

      {/* Nuevo evento / Editar evento extraordinario (mismo formulario compartido) */}
      <Modal
        open={Boolean(eventModalMode)}
        onClose={closeEventModal}
        title={eventModalMode === 'edit' ? 'Editar evento' : 'Nuevo evento extraordinario'}
      >
        <form onSubmit={submitEventForm} noValidate>
          <p className="events-manager__form-hint">
            {selectedMonth
              ? `La fecha debe caer dentro de ${formatMonthYear(selectedMonth.year, selectedMonth.month)}.`
              : ''}
          </p>

          <EventFormFields
            form={eventForm}
            onFieldChange={updateEventField}
            uniforms={activeUniforms}
            maxTeams={regularTeamOptions.length}
          />

          {eventError ? <ErrorMessage message={eventError} /> : null}

          <div className="events-manager__form-actions">
            <Button type="button" variant="secondary" onClick={closeEventModal} disabled={eventSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={eventSubmitting} disabled={eventFormInvalid}>
              {eventModalMode === 'edit' ? 'Guardar cambios' : 'Crear evento'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
