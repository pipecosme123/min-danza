import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMonthTeams } from '../api/months.js';
import { generateSchedule, getMonthSchedule, createEvent, deleteEvent, updateAssignment } from '../api/schedule.js';
import { getUniforms, getWeekdayUniforms } from '../api/uniforms.js';
import { describeApiError } from '../utils/apiError.js';
import { formatMonthYear, formatCivilDate } from '../utils/dates.js';
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
import { BalanceSummary } from '../components/domain/BalanceSummary.jsx';
import './EventsManager.css';

const EMPTY_EVENT_FORM = { date: '', startTime: '', title: '', teamsNeeded: '1', uniformId: '' };

/** Agrupa los turnos por fecha civil, en el mismo orden en que llegan (ya vienen ordenados por fecha/hora del backend). */
function groupSlotsByDate(slots) {
  const map = new Map();
  slots.forEach((slot) => {
    if (!map.has(slot.date)) map.set(slot.date, []);
    map.get(slot.date).push(slot);
  });
  return Array.from(map.entries()).map(([date, dateSlots]) => ({
    key: date,
    heading: formatCivilDate(date),
    slots: dateSlots,
  }));
}

/** Traduce los códigos de error del formulario de evento extraordinario a lenguaje llano. */
function describeEventError(info) {
  if (info.code === 'FECHA_FUERA_DE_MES') {
    return 'La fecha del evento debe caer dentro del mes elegido.';
  }
  if (info.code === 'UNIFORME_NO_VALIDO') {
    return 'El uniforme elegido no existe o está inactivo. Elige otro.';
  }
  if (info.code === 'HORARIO_NO_GENERADO') {
    return 'Todavía no se generó el horario base de este mes. Generalo antes de agregar eventos.';
  }
  if (info.code === 'MES_FINALIZADO') {
    return 'Este mes ya está finalizado y no admite cambios.';
  }
  return info.message;
}

/** Sugiere el uniforme configurado para el día de semana de `dateStr` (miércoles/domingo), sin forzar la elección. */
function suggestUniformForDate(dateStr, weekdayUniforms) {
  if (!dateStr) return '';
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  const weekdayName = weekday === 3 ? 'WEDNESDAY' : weekday === 0 ? 'SUNDAY' : null;
  if (!weekdayName) return '';
  return weekdayUniforms.find((w) => w.weekday === weekdayName)?.uniformId ?? '';
}

/**
 * Pantalla de la Fase 4: elegir el mes en curso, generar (o regenerar) su
 * horario de turnos fijos + Servicio de jóvenes, ajustar manualmente las
 * asignaciones (bloquear/reasignar equipo) y administrar eventos
 * extraordinarios. Ver `docs/architecture/phase4-schedule-contract.md` para
 * el contrato exacto de la API que consume.
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

  function handleMonthChange(id) {
    setSelectedMonthId(id);
  }

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

  // ---- Regenerar horario (destructivo, con confirmación) ----
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
      showError(describeApiError(err).message);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ---- Crear evento extraordinario ----
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [eventError, setEventError] = useState(null);
  const [uniformTouched, setUniformTouched] = useState(false);

  const { data: uniformsData, execute: fetchUniforms } = useApi(getUniforms);
  const activeUniforms = (uniformsData ?? []).filter((u) => u.active);

  const { data: weekdayUniformsData, execute: fetchWeekdayUniforms } = useApi(getWeekdayUniforms);
  const weekdayUniforms = weekdayUniformsData ?? [];

  function openEventModal() {
    setEventForm(EMPTY_EVENT_FORM);
    setEventError(null);
    setUniformTouched(false);
    setEventModalOpen(true);
    fetchUniforms().catch(() => {});
    fetchWeekdayUniforms().catch(() => {});
  }

  function closeEventModal() {
    setEventModalOpen(false);
  }

  function updateEventDate(value) {
    setEventForm((form) => ({
      ...form,
      date: value,
      uniformId: uniformTouched ? form.uniformId : suggestUniformForDate(value, weekdayUniforms),
    }));
  }

  function updateEventField(key, value) {
    setEventForm((form) => ({ ...form, [key]: value }));
    if (key === 'uniformId') setUniformTouched(true);
    setEventError(null);
  }

  async function submitEvent(event) {
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
      await createEvent(selectedMonthId, {
        date: eventForm.date,
        startTime: eventForm.startTime,
        title: eventForm.title.trim(),
        teamsNeeded: Number(eventForm.teamsNeeded),
        ...(eventForm.uniformId ? { uniformId: eventForm.uniformId } : {}),
      });
      showSuccess('Se creó el evento extraordinario.');
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
          ajusta a mano las asignaciones y agrega eventos extraordinarios fuera de los turnos fijos.
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
          </div>

          {monthFinalized ? (
            <p className="events-manager__finalized-notice" role="status">
              Este mes está finalizado: ya no admite cambios de horario.
            </p>
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
                      <Button onClick={openEventModal} variant="secondary" disabled={monthFinalized}>
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

                  <div className="events-manager__calendar">
                    <CalendarGrid
                      groups={groupSlotsByDate(slots)}
                      renderSlot={(slot) => (
                        <ScheduleSlotCard
                          slot={slot}
                          regularTeams={regularTeamOptions}
                          disabled={monthFinalized}
                          busyAssignmentId={busyAssignmentId}
                          onToggleLock={handleToggleLock}
                          onReassign={handleReassign}
                          onDeleteEvent={(s) => setDeleteTarget(s)}
                        />
                      )}
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {/* Regenerar horario (destructivo) */}
      <ConfirmDialog
        open={regenerateOpen}
        onClose={() => setRegenerateOpen(false)}
        onConfirm={handleRegenerateConfirm}
        title="Regenerar el horario del mes"
        description="Esto borra TODO el horario actual de este mes, incluidos los eventos extraordinarios que hayas agregado a mano, y lo vuelve a generar desde cero. Esta acción no se puede deshacer."
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

      {/* Nuevo evento extraordinario */}
      <Modal open={eventModalOpen} onClose={closeEventModal} title="Nuevo evento extraordinario">
        <form onSubmit={submitEvent} noValidate>
          <p className="events-manager__form-hint">
            {selectedMonth
              ? `La fecha debe caer dentro de ${formatMonthYear(selectedMonth.year, selectedMonth.month)}.`
              : ''}
          </p>

          <Field
            label="Fecha"
            type="date"
            required
            value={eventForm.date}
            onChange={(event) => updateEventDate(event.target.value)}
          />
          <Field
            label="Hora"
            type="time"
            required
            value={eventForm.startTime}
            onChange={(event) => updateEventField('startTime', event.target.value)}
          />
          <Field
            label="Título"
            required
            maxLength={100}
            value={eventForm.title}
            onChange={(event) => updateEventField('title', event.target.value)}
          />
          <Field
            as="select"
            label="Cantidad de equipos"
            value={eventForm.teamsNeeded}
            onChange={(event) => updateEventField('teamsNeeded', event.target.value)}
          >
            <option value="1">1 equipo</option>
            <option value="2">2 equipos</option>
          </Field>
          <Field
            as="select"
            label="Uniforme"
            hint="Opcional. Si el día coincide con miércoles o domingo, se sugiere el uniforme configurado para ese día."
            value={eventForm.uniformId}
            onChange={(event) => updateEventField('uniformId', event.target.value)}
          >
            <option value="">Sin uniforme específico</option>
            {activeUniforms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Field>

          {eventError ? <ErrorMessage message={eventError} /> : null}

          <div className="events-manager__form-actions">
            <Button type="button" variant="secondary" onClick={closeEventModal} disabled={eventSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={eventSubmitting} disabled={eventFormInvalid}>
              Crear evento
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
