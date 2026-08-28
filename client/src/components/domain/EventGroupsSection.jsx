import { useEffect, useRef, useState } from 'react';
import {
  createEventGroup,
  listEventGroups,
  updateEventGroupTitle,
  addEventGroupTurno,
  updateEventGroupTurno,
  deleteEventGroupTurno,
  cancelEventGroup,
  deleteEventGroup,
} from '../../api/eventGroups.js';
import { describeApiError } from '../../utils/apiError.js';
import { describeEventGroupError } from '../../utils/eventErrors.js';
import { formatCivilDate, formatTimeLabel } from '../../utils/dates.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../hooks/useToast.js';
import { Button } from '../ui/Button.jsx';
import { Spinner } from '../ui/Spinner.jsx';
import { ErrorMessage } from '../ui/ErrorMessage.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { Modal } from '../ui/Modal.jsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx';
import { Field } from '../ui/Field.jsx';
import { Checkbox } from '../ui/Checkbox.jsx';
import { Badge } from '../ui/Badge.jsx';
import { UniformBadge } from './UniformBadge.jsx';
import './EventGroupsSection.css';

/**
 * Un turno vacío del formulario de creación/edición: hora + equipos +
 * uniforme opcional. `key` es solo para React (identidad de fila), nunca se
 * envía al servidor.
 */
function emptyTurno(key) {
  return { key, startTime: '', teamIds: [], uniformId: '' };
}

/** Un bloque de fecha vacío del formulario de creación, con un turno inicial. */
function emptyDateBlock(key, turnoKey) {
  return { key, date: '', turnos: [emptyTurno(turnoKey)] };
}

/**
 * Campos compartidos de un turno (hora, equipos elegidos a mano, uniforme
 * opcional) — usados tanto dentro de cada bloque de fecha del formulario de
 * creación como en los modales de "Agregar turno"/"Editar turno" de un grupo
 * ya existente. La fecha se maneja aparte por cada llamador porque en el
 * formulario de creación agrupa varios turnos bajo un mismo bloque de fecha.
 *
 * @param {{
 *   startTime: string,
 *   onStartTimeChange: (value: string) => void,
 *   teamIds: string[],
 *   onToggleTeam: (teamId: string) => void,
 *   uniformId: string,
 *   onUniformChange: (value: string) => void,
 *   regularTeamOptions: Array<{ id: string, label: string }>,
 *   uniforms: Array<{ id: string, name: string }>,
 *   idPrefix: string,
 * }} props
 */
function TurnoFields({
  startTime,
  onStartTimeChange,
  teamIds,
  onToggleTeam,
  uniformId,
  onUniformChange,
  regularTeamOptions,
  uniforms,
  idPrefix,
}) {
  return (
    <>
      <Field
        label="Hora"
        type="time"
        required
        value={startTime}
        onChange={(event) => onStartTimeChange(event.target.value)}
      />

      <fieldset className="event-groups__team-fieldset">
        <legend className="field__label">
          Equipos de este turno <span aria-hidden="true"> *</span>
        </legend>
        {regularTeamOptions.length === 0 ? (
          <p className="event-groups__team-empty">Todavía no hay equipos regulares en este mes.</p>
        ) : (
          <div className="event-groups__team-checkboxes">
            {regularTeamOptions.map((team) => (
              <Checkbox
                key={team.id}
                id={`${idPrefix}-team-${team.id}`}
                label={team.label}
                checked={teamIds.includes(team.id)}
                onChange={() => onToggleTeam(team.id)}
              />
            ))}
          </div>
        )}
      </fieldset>

      <Field
        as="select"
        label="Uniforme"
        hint="Opcional."
        value={uniformId}
        onChange={(event) => onUniformChange(event.target.value)}
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
 * Sección "Eventos agrupados" (Congreso, etc.): un evento con 2 o más
 * fechas, cada una con uno o más turnos (hora + equipos elegidos a mano +
 * uniforme opcional). A diferencia de un evento suelto, los equipos NO se
 * auto-balancean: el admin los elige de una lista. Cada turno es, por
 * dentro, un `ServiceSlot` normal, así que también aparece en el horario
 * general y en el balance del mes (por eso `onChanged` refresca el horario
 * del componente padre después de cualquier cambio acá). Contrato: plan
 * `wise-noodling-hickey.md` Parte 2.
 *
 * @param {{
 *   monthId: string,
 *   regularTeamOptions: Array<{ id: string, label: string }>,
 *   uniforms: Array<{ id: string, name: string }>,
 *   disabled: boolean,
 *   onChanged: () => void,
 * }} props
 */
export function EventGroupsSection({ monthId, regularTeamOptions, uniforms, disabled, onChanged }) {
  const { showSuccess, showError } = useToast();
  const keyCounterRef = useRef(0);
  function nextKey() {
    keyCounterRef.current += 1;
    return `eg-${keyCounterRef.current}`;
  }

  // ---- Listado de grupos del mes ----
  const { data, loading, error, execute: fetchGroups } = useApi(listEventGroups);

  useEffect(() => {
    if (monthId) fetchGroups(monthId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthId]);

  const groups = data?.groups ?? [];

  function refreshAfterChange() {
    if (monthId) fetchGroups(monthId).catch(() => {});
    onChanged();
  }

  // ---- Crear evento agrupado ----
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [dateBlocks, setDateBlocks] = useState([]);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);

  function openCreateModal() {
    setCreateTitle('');
    setDateBlocks([emptyDateBlock(nextKey(), nextKey()), emptyDateBlock(nextKey(), nextKey())]);
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
  }

  function addDateBlock() {
    setDateBlocks((blocks) => [...blocks, emptyDateBlock(nextKey(), nextKey())]);
  }

  function removeDateBlock(blockKey) {
    setDateBlocks((blocks) => blocks.filter((b) => b.key !== blockKey));
  }

  function setBlockDate(blockKey, value) {
    setDateBlocks((blocks) => blocks.map((b) => (b.key === blockKey ? { ...b, date: value } : b)));
  }

  function addTurnoToBlock(blockKey) {
    setDateBlocks((blocks) =>
      blocks.map((b) => (b.key === blockKey ? { ...b, turnos: [...b.turnos, emptyTurno(nextKey())] } : b)),
    );
  }

  function removeTurnoFromBlock(blockKey, turnoKey) {
    setDateBlocks((blocks) =>
      blocks.map((b) => (b.key === blockKey ? { ...b, turnos: b.turnos.filter((t) => t.key !== turnoKey) } : b)),
    );
  }

  function updateBlockTurno(blockKey, turnoKey, updater) {
    setDateBlocks((blocks) =>
      blocks.map((b) =>
        b.key === blockKey
          ? { ...b, turnos: b.turnos.map((t) => (t.key === turnoKey ? updater(t) : t)) }
          : b,
      ),
    );
  }

  /** Turnos válidos (fecha + hora + al menos un equipo), listos para mandar al servidor. */
  function collectValidTurnos() {
    return dateBlocks.flatMap((block) => {
      if (!block.date) return [];
      return block.turnos
        .filter((t) => t.startTime && t.teamIds.length > 0)
        .map((t) => ({
          date: block.date,
          startTime: t.startTime,
          teamIds: t.teamIds,
          ...(t.uniformId ? { uniformId: t.uniformId } : {}),
        }));
    });
  }

  const validTurnos = collectValidTurnos();
  const distinctDateCount = new Set(validTurnos.map((t) => t.date)).size;
  const createDisabled = !createTitle.trim() || distinctDateCount < 2 || validTurnos.length === 0;

  async function submitCreate(event) {
    event.preventDefault();
    if (!monthId) return;
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      await createEventGroup(monthId, { title: createTitle.trim(), turnos: collectValidTurnos() });
      showSuccess('Se creó el evento agrupado.');
      closeCreateModal();
      refreshAfterChange();
    } catch (err) {
      setCreateError(describeEventGroupError(describeApiError(err)));
    } finally {
      setCreateSubmitting(false);
    }
  }

  // ---- Renombrar grupo ----
  const [renameTarget, setRenameTarget] = useState(null); // group | null
  const [renameTitle, setRenameTitle] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState(null);

  function openRenameModal(group) {
    setRenameTarget(group);
    setRenameTitle(group.title);
    setRenameError(null);
  }

  async function submitRename(event) {
    event.preventDefault();
    if (!renameTarget) return;
    setRenameSubmitting(true);
    setRenameError(null);
    try {
      await updateEventGroupTitle(renameTarget.id, renameTitle.trim());
      showSuccess('Se renombró el evento agrupado.');
      setRenameTarget(null);
      refreshAfterChange();
    } catch (err) {
      setRenameError(describeEventGroupError(describeApiError(err)));
    } finally {
      setRenameSubmitting(false);
    }
  }

  // ---- Agregar / editar un turno de un grupo ya existente ----
  const [turnoModal, setTurnoModal] = useState(null); // { mode: 'add'|'edit', group, slot? } | null
  const [turnoForm, setTurnoForm] = useState({ date: '', startTime: '', teamIds: [], uniformId: '' });
  const [turnoSubmitting, setTurnoSubmitting] = useState(false);
  const [turnoError, setTurnoError] = useState(null);

  function openAddTurnoModal(group) {
    setTurnoForm({ date: '', startTime: '', teamIds: [], uniformId: '' });
    setTurnoError(null);
    setTurnoModal({ mode: 'add', group });
  }

  function openEditTurnoModal(group, slot) {
    setTurnoForm({
      date: slot.date,
      startTime: slot.startTime,
      teamIds: (slot.teams || []).map((t) => t.id),
      uniformId: slot.uniform?.id || '',
    });
    setTurnoError(null);
    setTurnoModal({ mode: 'edit', group, slot });
  }

  function closeTurnoModal() {
    setTurnoModal(null);
  }

  function toggleTurnoFormTeam(teamId) {
    setTurnoForm((form) => ({
      ...form,
      teamIds: form.teamIds.includes(teamId) ? form.teamIds.filter((id) => id !== teamId) : [...form.teamIds, teamId],
    }));
  }

  async function submitTurnoForm(event) {
    event.preventDefault();
    if (!turnoModal) return;
    setTurnoSubmitting(true);
    setTurnoError(null);
    try {
      if (turnoModal.mode === 'edit') {
        await updateEventGroupTurno(turnoModal.slot.id, {
          date: turnoForm.date,
          startTime: turnoForm.startTime,
          teamIds: turnoForm.teamIds,
          uniformId: turnoForm.uniformId || null,
        });
        showSuccess('Se actualizó el turno.');
      } else {
        await addEventGroupTurno(turnoModal.group.id, {
          date: turnoForm.date,
          startTime: turnoForm.startTime,
          teamIds: turnoForm.teamIds,
          ...(turnoForm.uniformId ? { uniformId: turnoForm.uniformId } : {}),
        });
        showSuccess('Se agregó el turno al evento agrupado.');
      }
      closeTurnoModal();
      refreshAfterChange();
    } catch (err) {
      setTurnoError(describeEventGroupError(describeApiError(err)));
    } finally {
      setTurnoSubmitting(false);
    }
  }

  const turnoFormInvalid = !turnoForm.date.trim() || !turnoForm.startTime.trim() || turnoForm.teamIds.length === 0;

  // ---- Eliminar un turno suelto de un grupo ----
  const [deleteTurnoTarget, setDeleteTurnoTarget] = useState(null); // slot | null
  const [deleteTurnoLoading, setDeleteTurnoLoading] = useState(false);

  async function confirmDeleteTurno() {
    if (!deleteTurnoTarget) return;
    setDeleteTurnoLoading(true);
    try {
      await deleteEventGroupTurno(deleteTurnoTarget.id);
      showSuccess('Se eliminó el turno.');
      setDeleteTurnoTarget(null);
      refreshAfterChange();
    } catch (err) {
      showError(describeEventGroupError(describeApiError(err)));
    } finally {
      setDeleteTurnoLoading(false);
    }
  }

  // ---- Cancelar un grupo completo ----
  const [cancelGroupTarget, setCancelGroupTarget] = useState(null); // group | null
  const [cancelGroupLoading, setCancelGroupLoading] = useState(false);

  async function confirmCancelGroup() {
    if (!cancelGroupTarget) return;
    setCancelGroupLoading(true);
    try {
      await cancelEventGroup(cancelGroupTarget.id);
      showSuccess('Se canceló el evento agrupado.');
      setCancelGroupTarget(null);
      refreshAfterChange();
    } catch (err) {
      showError(describeEventGroupError(describeApiError(err)));
    } finally {
      setCancelGroupLoading(false);
    }
  }

  // ---- Eliminar un grupo completo ----
  const [deleteGroupTarget, setDeleteGroupTarget] = useState(null); // group | null
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false);

  async function confirmDeleteGroup() {
    if (!deleteGroupTarget) return;
    setDeleteGroupLoading(true);
    try {
      await deleteEventGroup(deleteGroupTarget.id);
      showSuccess('Se eliminó el evento agrupado.');
      setDeleteGroupTarget(null);
      refreshAfterChange();
    } catch (err) {
      showError(describeEventGroupError(describeApiError(err)));
    } finally {
      setDeleteGroupLoading(false);
    }
  }

  return (
    <section className="event-groups" aria-labelledby="event-groups-heading">
      <div className="event-groups__header">
        <div>
          <h3 id="event-groups-heading" className="events-manager__action-summary">
            Eventos agrupados
          </h3>
          <p className="event-groups__hint">
            Para eventos con varias fechas (ej. un Congreso), donde vos elegís a mano el o los equipos de cada turno.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={openCreateModal} disabled={disabled}>
          Nuevo evento agrupado
        </Button>
      </div>

      {loading ? <Spinner label="Cargando eventos agrupados..." /> : null}

      {!loading && error ? (
        <ErrorMessage message={error.message} onRetry={() => fetchGroups(monthId)} />
      ) : null}

      {!loading && !error && groups.length === 0 ? (
        <EmptyState
          title="Todavía no hay eventos agrupados este mes"
          description="Usa «Nuevo evento agrupado» para un evento con varias fechas, como un Congreso."
        />
      ) : null}

      {!loading && !error && groups.length > 0 ? (
        <ul className="event-groups__list">
          {groups.map((group) => {
            const slots = group.slots || [];
            const isFullyCancelled = slots.length > 0 && slots.every((s) => s.cancelledAt);
            return (
              <li key={group.id} className="event-groups__card">
                <header className="event-groups__card-header">
                  <div>
                    <h4 className="event-groups__card-title">{group.title}</h4>
                    {isFullyCancelled ? <Badge variant="danger">Cancelado</Badge> : null}
                  </div>
                  <div className="event-groups__card-actions">
                    <Button type="button" variant="secondary" size="sm" onClick={() => openRenameModal(group)} disabled={disabled}>
                      Renombrar
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openAddTurnoModal(group)}
                      disabled={disabled}
                    >
                      Agregar turno
                    </Button>
                    {!isFullyCancelled ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setCancelGroupTarget(group)}
                        disabled={disabled}
                      >
                        Cancelar completo
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteGroupTarget(group)}
                      disabled={disabled}
                    >
                      Eliminar completo
                    </Button>
                  </div>
                </header>

                <ul className="event-groups__turno-list">
                  {slots.map((slot) => {
                    const slotCancelled = Boolean(slot.cancelledAt);
                    return (
                      <li key={slot.id} className="event-groups__turno-row">
                        <div className="event-groups__turno-info">
                          <span className="event-groups__turno-date">
                            {formatCivilDate(slot.date)} · {formatTimeLabel(slot.startTime)}
                          </span>
                          {slotCancelled ? (
                            <Badge variant="danger">Cancelado</Badge>
                          ) : (
                            <>
                              <span className="event-groups__turno-teams">
                                {(slot.teams || []).map((t) => t.label).join(', ') || 'Sin equipo asignado'}
                              </span>
                              {slot.uniform ? <UniformBadge name={slot.uniform.name} colorHex={slot.uniform.colorHex} /> : null}
                            </>
                          )}
                        </div>
                        <div className="event-groups__turno-actions">
                          {!slotCancelled ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => openEditTurnoModal(group, slot)}
                              disabled={disabled}
                            >
                              Editar
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => setDeleteTurnoTarget(slot)}
                            disabled={disabled}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Crear evento agrupado: título + 2 o más fechas, cada una con uno o más turnos */}
      <Modal open={createOpen} onClose={closeCreateModal} title="Nuevo evento agrupado" size="lg">
        <form onSubmit={submitCreate} noValidate>
          <Field
            label="Título"
            required
            maxLength={100}
            hint="Ej. «Congreso de danza»."
            value={createTitle}
            onChange={(event) => setCreateTitle(event.target.value)}
          />

          <p className="event-groups__form-hint">
            Necesitás al menos 2 fechas distintas, cada una con al menos un turno (hora + equipo).
          </p>

          {dateBlocks.map((block, blockIndex) => (
            <fieldset key={block.key} className="event-groups__date-block">
              <legend className="field__label">Fecha {blockIndex + 1}</legend>

              <Field
                label="Fecha"
                type="date"
                required
                value={block.date}
                onChange={(event) => setBlockDate(block.key, event.target.value)}
              />

              {block.turnos.map((turno, turnoIndex) => (
                <div key={turno.key} className="event-groups__turno-fields">
                  <p className="event-groups__turno-label">Turno {turnoIndex + 1}</p>
                  <TurnoFields
                    idPrefix={`create-${block.key}-${turno.key}`}
                    startTime={turno.startTime}
                    onStartTimeChange={(value) =>
                      updateBlockTurno(block.key, turno.key, (t) => ({ ...t, startTime: value }))
                    }
                    teamIds={turno.teamIds}
                    onToggleTeam={(teamId) =>
                      updateBlockTurno(block.key, turno.key, (t) => ({
                        ...t,
                        teamIds: t.teamIds.includes(teamId)
                          ? t.teamIds.filter((id) => id !== teamId)
                          : [...t.teamIds, teamId],
                      }))
                    }
                    uniformId={turno.uniformId}
                    onUniformChange={(value) => updateBlockTurno(block.key, turno.key, (t) => ({ ...t, uniformId: value }))}
                    regularTeamOptions={regularTeamOptions}
                    uniforms={uniforms}
                  />
                  {block.turnos.length > 1 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => removeTurnoFromBlock(block.key, turno.key)}
                    >
                      Quitar este turno
                    </Button>
                  ) : null}
                </div>
              ))}

              <div className="event-groups__block-actions">
                <Button type="button" variant="secondary" size="sm" onClick={() => addTurnoToBlock(block.key)}>
                  Agregar otro turno a esta fecha
                </Button>
                {dateBlocks.length > 1 ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => removeDateBlock(block.key)}>
                    Quitar esta fecha
                  </Button>
                ) : null}
              </div>
            </fieldset>
          ))}

          <Button type="button" variant="secondary" onClick={addDateBlock}>
            Agregar otra fecha
          </Button>

          {createError ? <ErrorMessage message={createError} /> : null}

          <div className="events-manager__form-actions">
            <Button type="button" variant="secondary" onClick={closeCreateModal} disabled={createSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={createSubmitting} disabled={createDisabled}>
              Crear evento agrupado
            </Button>
          </div>
        </form>
      </Modal>

      {/* Renombrar grupo */}
      <Modal open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title="Renombrar evento agrupado">
        <form onSubmit={submitRename} noValidate>
          <Field
            label="Título"
            required
            maxLength={100}
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.target.value)}
          />
          {renameError ? <ErrorMessage message={renameError} /> : null}
          <div className="events-manager__form-actions">
            <Button type="button" variant="secondary" onClick={() => setRenameTarget(null)} disabled={renameSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={renameSubmitting} disabled={!renameTitle.trim()}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </Modal>

      {/* Agregar / editar un turno de un grupo ya existente */}
      <Modal
        open={Boolean(turnoModal)}
        onClose={closeTurnoModal}
        title={turnoModal?.mode === 'edit' ? 'Editar turno' : 'Agregar turno'}
      >
        <form onSubmit={submitTurnoForm} noValidate>
          <Field
            label="Fecha"
            type="date"
            required
            value={turnoForm.date}
            onChange={(event) => setTurnoForm((f) => ({ ...f, date: event.target.value }))}
          />
          <TurnoFields
            idPrefix="turno-modal"
            startTime={turnoForm.startTime}
            onStartTimeChange={(value) => setTurnoForm((f) => ({ ...f, startTime: value }))}
            teamIds={turnoForm.teamIds}
            onToggleTeam={toggleTurnoFormTeam}
            uniformId={turnoForm.uniformId}
            onUniformChange={(value) => setTurnoForm((f) => ({ ...f, uniformId: value }))}
            regularTeamOptions={regularTeamOptions}
            uniforms={uniforms}
          />
          {turnoError ? <ErrorMessage message={turnoError} /> : null}
          <div className="events-manager__form-actions">
            <Button type="button" variant="secondary" onClick={closeTurnoModal} disabled={turnoSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={turnoSubmitting} disabled={turnoFormInvalid}>
              {turnoModal?.mode === 'edit' ? 'Guardar cambios' : 'Agregar turno'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Eliminar un turno suelto de un grupo */}
      <ConfirmDialog
        open={Boolean(deleteTurnoTarget)}
        onClose={() => setDeleteTurnoTarget(null)}
        onConfirm={confirmDeleteTurno}
        title="Eliminar turno"
        description={
          deleteTurnoTarget
            ? `Se eliminará el turno del ${formatCivilDate(deleteTurnoTarget.date)} a las ${formatTimeLabel(
                deleteTurnoTarget.startTime,
              )}. Si era el último turno del evento agrupado, el evento completo también desaparece. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={deleteTurnoLoading}
      />

      {/* Cancelar el grupo completo: todos sus turnos quedan marcados como cancelados */}
      <ConfirmDialog
        open={Boolean(cancelGroupTarget)}
        onClose={() => setCancelGroupTarget(null)}
        onConfirm={confirmCancelGroup}
        title="Cancelar evento agrupado"
        description={
          cancelGroupTarget
            ? `Se marcarán TODOS los turnos de "${cancelGroupTarget.title}" como cancelados. Quedan registrados y visibles, pero ya no necesitan equipo ni cuentan en el balance. Hoy no existe una forma de deshacer esto.`
            : ''
        }
        confirmLabel="Sí, cancelar evento agrupado"
        variant="danger"
        loading={cancelGroupLoading}
      />

      {/* Eliminar el grupo completo: todos sus turnos desaparecen */}
      <ConfirmDialog
        open={Boolean(deleteGroupTarget)}
        onClose={() => setDeleteGroupTarget(null)}
        onConfirm={confirmDeleteGroup}
        title="Eliminar evento agrupado"
        description={
          deleteGroupTarget
            ? `Se eliminará "${deleteGroupTarget.title}" por completo, con todos sus turnos. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={deleteGroupLoading}
      />
    </section>
  );
}
