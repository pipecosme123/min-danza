import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createMonth, deleteYouthTeam, generateTeams, getMonths, getMonthTeams, updateTeam } from '../api/months.js';
import { getPeople } from '../api/people.js';
import { describeApiError } from '../utils/apiError.js';
import { formatMonthYear, isMonthCurrentOrFuture, MONTH_LABELS } from '../utils/dates.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { Button } from '../components/ui/Button.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Checkbox } from '../components/ui/Checkbox.jsx';
import { TeamCard } from '../components/domain/TeamCard.jsx';
import { ROLE_LABELS, sortMembers } from '../components/domain/MemberList.jsx';
import './TeamGenerator.css';

const CATEGORY_LABELS = {
  INSTRUCTOR: 'Instructor',
  MINISTRO: 'Ministro',
};

// Mismas etiquetas que `MemberList` (Líder/Apoyo/Ministro), reutilizadas acá
// para los selects de edición manual en vez de duplicar el mapeo.
const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

// El equipo de jóvenes (`teamType: "YOUTH"`) solo admite Líder/Ministro
// (colaborador): nunca "Apoyo", no tiene un pool de apoyo separado como los
// equipos regulares (ver §9 del contrato de Fase 3).
const YOUTH_ROLE_OPTIONS = ROLE_OPTIONS.filter((opt) => opt.value !== 'SUPPORT');

const DEFAULT_YOUTH_SIZE = '10';

/** Traduce los códigos de error nuevos del equipo de jóvenes a lenguaje llano. */
function describeGenerateError(info) {
  if (info.code === 'POOL_INSTRUCTOR_INSUFICIENTE') {
    return `Se necesitan al menos ${info.details.needed} instructores activos para formar ${
      info.details.needed
    } ${info.details.needed === 1 ? 'equipo' : 'equipos'}, pero solo hay ${
      info.details.available
    } disponible${info.details.available === 1 ? '' : 's'}. Agrega más instructores en «Personas» antes de sortear.`;
  }
  if (info.code === 'POOL_JOVENES_INSUFICIENTE') {
    return `No hay suficientes personas marcadas como «Joven» para armar ese equipo (hay ${info.details.available}, se necesitan ${info.details.needed}). Marca a más personas como «Joven» en «Personas», o reduce la cantidad.`;
  }
  if (info.code === 'LIDER_JOVENES_INVALIDO') {
    return 'La persona elegida como líder del equipo de jóvenes no es válida: debe estar activa y marcada como «Joven». Elige otra persona.';
  }
  if (info.code === 'SORTEO_EN_CURSO') {
    return 'Ya se está generando el sorteo de este mes desde otra pestaña o solicitud. Esperá a que termine y volvé a intentar.';
  }
  return info.message;
}

/** Traduce los códigos de error de "Eliminar equipo de jóvenes" a lenguaje llano. */
function describeDeleteYouthTeamError(info) {
  if (info.code === 'EQUIPO_JOVENES_NO_ENCONTRADO') {
    return 'Este mes ya no tiene equipo de jóvenes.';
  }
  if (info.code === 'MES_PASADO') {
    return 'Este mes ya pasó, no se puede eliminar el equipo de jóvenes.';
  }
  return info.message;
}

const now = new Date();
const EMPTY_MONTH_FORM = {
  year: String(now.getFullYear()),
  month: String(now.getMonth() + 1),
  teamCount: '4',
};

/**
 * Pantalla de administración de la Fase 3: elegir/crear el mes en curso,
 * sortear (o re-sortear) sus equipos y ajustar manualmente el roster de
 * cada uno. Ver `docs/architecture/phase3-teams-contract.md` para el
 * contrato exacto de la API que consume.
 */
export function TeamGenerator() {
  const { showSuccess, showWarning, showError } = useToast();

  // ---- Meses ----
  const {
    data: monthsData,
    loading: monthsLoading,
    error: monthsError,
    execute: fetchMonths,
  } = useApi(getMonths, { immediate: true });
  const months = monthsData?.data ?? [];

  const [selectedMonthId, setSelectedMonthId] = useState('');

  useEffect(() => {
    if (!selectedMonthId && months.length > 0) {
      setSelectedMonthId(months[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months]);

  const effectiveMonthId = selectedMonthId || months[0]?.id || '';
  const selectedMonth = months.find((m) => m.id === effectiveMonthId) || null;

  function handleMonthChange(id) {
    setSelectedMonthId(id);
    setGenerateError(null);
  }

  // ---- Equipos del mes elegido ----
  const {
    data: teamsData,
    loading: teamsLoading,
    error: teamsError,
    execute: fetchTeams,
    setData: setTeamsData,
  } = useApi(getMonthTeams);

  useEffect(() => {
    if (effectiveMonthId) {
      fetchTeams(effectiveMonthId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMonthId]);

  const teams = teamsData?.teams ?? [];
  // Defensivo: la API ya devuelve los equipos ordenados por `orderIndex`
  // (el equipo de jóvenes cae al final, `orderIndex = teamCount + 1`), pero
  // ordenamos también acá para no depender del orden exacto del backend.
  const sortedTeams = [...teams].sort((a, b) => a.orderIndex - b.orderIndex);

  function refetchTeams() {
    if (effectiveMonthId) fetchTeams(effectiveMonthId).catch(() => {});
  }

  // ---- Crear mes nuevo ----
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_MONTH_FORM);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [duplicateMonthId, setDuplicateMonthId] = useState(null);

  function openCreateModal() {
    setCreateForm(EMPTY_MONTH_FORM);
    setCreateError(null);
    setDuplicateMonthId(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
  }

  function updateCreateField(key, value) {
    setCreateForm((form) => ({ ...form, [key]: value }));
    setCreateError(null);
    setDuplicateMonthId(null);
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const month = await createMonth({
        year: Number(createForm.year),
        month: Number(createForm.month),
        teamCount: Number(createForm.teamCount),
      });
      setCreateOpen(false);
      showSuccess(`Se creó el mes ${formatMonthYear(month.year, month.month)}.`);
      await fetchMonths();
      setSelectedMonthId(month.id);
    } catch (err) {
      const info = describeApiError(err);
      if (info.code === 'MES_YA_EXISTE') {
        setCreateError('Ya existe un mes creado para ese año y mes.');
        setDuplicateMonthId(info.details.monthCycleId);
      } else {
        setCreateError(info.message);
      }
    } finally {
      setCreateSubmitting(false);
    }
  }

  function goToDuplicateMonth() {
    if (!duplicateMonthId) return;
    setSelectedMonthId(duplicateMonthId);
    closeCreateModal();
  }

  const createDisabled =
    !createForm.year.trim() || !createForm.month.trim() || !createForm.teamCount.trim();

  // ---- Sorteo / re-sorteo (incluye la configuración del equipo de jóvenes) ----
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateSubmitting, setGenerateSubmitting] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [youthEnabled, setYouthEnabled] = useState(true);
  const [youthSize, setYouthSize] = useState(DEFAULT_YOUTH_SIZE);
  const [youthLeaderId, setYouthLeaderId] = useState('');
  const [teamCountInput, setTeamCountInput] = useState('');

  const {
    data: youthPeopleData,
    loading: youthPeopleLoading,
    error: youthPeopleError,
    execute: fetchYouthPeople,
  } = useApi(getPeople);
  const youthLeaderOptions = youthPeopleData?.data ?? [];

  function loadYouthLeaderOptions() {
    fetchYouthPeople({ isJoven: true, active: true, pageSize: 100, sort: 'fullName' }).catch(() => {});
  }

  function openGenerateModal() {
    setGenerateError(null);
    setYouthEnabled(selectedMonth?.youthTeamEnabled ?? true);
    setYouthSize(String(selectedMonth?.youthTeamSize ?? DEFAULT_YOUTH_SIZE));
    setYouthLeaderId('');
    setTeamCountInput(String(selectedMonth?.teamCount ?? 4));
    setGenerateModalOpen(true);
    loadYouthLeaderOptions();
  }

  function closeGenerateModal() {
    setGenerateModalOpen(false);
  }

  const isResort = teams.length > 0;
  const youthSizeNumber = Number(youthSize);
  const teamCountNumber = Number(teamCountInput);
  const teamCountInvalid = !Number.isInteger(teamCountNumber) || teamCountNumber < 1 || teamCountNumber > 50;
  const youthFormInvalid = youthEnabled && (!youthLeaderId || !Number.isInteger(youthSizeNumber) || youthSizeNumber < 1);
  const generateFormInvalid = teamCountInvalid || youthFormInvalid;

  async function submitGenerate(event) {
    event.preventDefault();
    if (!effectiveMonthId || generateFormInvalid) return;
    setGenerateSubmitting(true);
    setGenerateError(null);
    try {
      const payload = {
        teamCount: teamCountNumber,
        youthTeam: youthEnabled
          ? { enabled: true, size: youthSizeNumber, leaderPersonId: youthLeaderId }
          : { enabled: false },
      };
      const result = await generateTeams(effectiveMonthId, payload);
      setTeamsData({ teams: result.teams });
      showSuccess(isResort ? 'Se volvieron a sortear los equipos del mes.' : 'Se sortearon los equipos del mes.');
      (result.warnings || []).forEach((warning) => showWarning(warning.message));
      setGenerateModalOpen(false);
      await fetchMonths(); // el teamCount pudo haber cambiado; refresca el selector de mes
    } catch (err) {
      setGenerateError(describeApiError(err));
    } finally {
      setGenerateSubmitting(false);
    }
  }

  // ---- Edición manual de un equipo ----
  const [editTeam, setEditTeam] = useState(null);
  const [editRoster, setEditRoster] = useState([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);
  const [addPersonId, setAddPersonId] = useState('');
  const [addRole, setAddRole] = useState('COLLABORATOR');

  const {
    data: peopleData,
    loading: peopleLoading,
    error: peopleError,
    execute: fetchPeople,
  } = useApi(getPeople);
  const activePeople = peopleData?.data ?? [];

  function loadPeopleForEdit() {
    fetchPeople({ active: true, pageSize: 100, sort: 'fullName' }).catch(() => {});
  }

  function openEditModal(team) {
    setEditTeam(team);
    setEditRoster(team.members.map((m) => ({ personId: m.personId, fullName: m.fullName, role: m.role })));
    setEditError(null);
    setAddPersonId('');
    setAddRole('COLLABORATOR');
    loadPeopleForEdit();
  }

  function closeEditModal() {
    setEditTeam(null);
  }

  function changeRosterRole(personId, role) {
    setEditRoster((roster) => roster.map((m) => (m.personId === personId ? { ...m, role } : m)));
  }

  function removeFromRoster(personId) {
    setEditRoster((roster) => roster.filter((m) => m.personId !== personId));
  }

  function handleAddPersonChange(personId) {
    setAddPersonId(personId);
    const person = activePeople.find((p) => p.id === personId);
    if (person) {
      // El equipo de jóvenes no tiene rol "Apoyo": cualquier persona que se
      // agregue ahí entra como colaboradora salvo que el admin la marque
      // como líder a mano.
      setAddRole(
        editTeam?.teamType === 'YOUTH' ? 'COLLABORATOR' : person.category === 'INSTRUCTOR' ? 'SUPPORT' : 'COLLABORATOR',
      );
    }
  }

  function addToRoster() {
    if (!addPersonId) return;
    const person = activePeople.find((p) => p.id === addPersonId);
    if (!person) return;
    setEditRoster((roster) => [...roster, { personId: person.id, fullName: person.fullName, role: addRole }]);
    setAddPersonId('');
    setAddRole('COLLABORATOR');
  }

  async function submitEditRoster(event) {
    event.preventDefault();
    if (!editTeam) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { team } = await updateTeam(editTeam.id, {
        members: editRoster.map(({ personId, role }) => ({ personId, role })),
      });
      showSuccess(`Se actualizó ${team.label}.`);
      setEditTeam(null);
      refetchTeams();
    } catch (err) {
      setEditError(describeApiError(err).message);
    } finally {
      setEditSubmitting(false);
    }
  }

  const rosterPersonIds = new Set(editRoster.map((m) => m.personId));
  const otherTeamByPersonId = new Map();
  teams.forEach((team) => {
    if (team.id !== editTeam?.id) {
      team.members.forEach((m) => otherTeamByPersonId.set(m.personId, team.label));
    }
  });
  const addOptions = activePeople
    .filter((p) => !rosterPersonIds.has(p.id))
    .map((p) => ({
      id: p.id,
      label: `${p.fullName} — ${CATEGORY_LABELS[p.category] || p.category}${
        otherTeamByPersonId.has(p.id) ? ` (actualmente en ${otherTeamByPersonId.get(p.id)})` : ''
      }`,
    }));

  const editLeaderCount = editRoster.filter((m) => m.role === 'LEADER').length;
  const rosterLeaderIssue = editRoster.length > 0 && editLeaderCount !== 1;
  // El equipo de jóvenes solo admite Líder/Ministro (colaborador), nunca Apoyo.
  const editRoleOptions = editTeam?.teamType === 'YOUTH' ? YOUTH_ROLE_OPTIONS : ROLE_OPTIONS;

  const monthFinalized = selectedMonth?.status === 'FINALIZED';
  // Igual que `monthIsPast` en `EventsManager.jsx`: un mes finalizado que
  // todavía es el actual o uno futuro sigue admitiendo edición manual
  // (integrantes, eliminar el equipo de jóvenes) — solo (re)sortear equipos
  // y "Crear mes nuevo" exigen `DRAFT` sin excepción.
  const monthIsPast =
    monthFinalized && Boolean(selectedMonth) && !isMonthCurrentOrFuture(selectedMonth.year, selectedMonth.month);

  // ---- Eliminar equipo de jóvenes (integrantes + turno YOUTH_SERVICE, sin tocar los equipos regulares) ----
  const [deleteYouthOpen, setDeleteYouthOpen] = useState(false);
  const [deleteYouthLoading, setDeleteYouthLoading] = useState(false);
  const deleteYouthDisabledReason = monthIsPast ? 'Este mes ya pasó, no se puede eliminar el equipo de jóvenes.' : null;

  async function handleDeleteYouthConfirm() {
    if (!effectiveMonthId) return;
    setDeleteYouthLoading(true);
    try {
      await deleteYouthTeam(effectiveMonthId);
      showSuccess('Se eliminó el equipo de jóvenes.');
      setDeleteYouthOpen(false);
      refetchTeams();
      await fetchMonths(); // youthTeamEnabled cambió, refresca el default precargado del próximo sorteo
    } catch (err) {
      showError(describeDeleteYouthTeamError(describeApiError(err)));
    } finally {
      setDeleteYouthLoading(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>Equipos</h1>
        <p className="page-header__description">
          Aquí se sortean los equipos del mes (líder, apoyo y ministros) y se pueden ajustar manualmente antes
          de publicar. Los equipos se forman una sola vez al mes y luego rotan de horario.
        </p>
      </header>

      {monthsLoading ? <Spinner label="Cargando meses..." /> : null}

      {!monthsLoading && monthsError ? (
        <ErrorMessage message={monthsError.message} onRetry={() => fetchMonths()} />
      ) : null}

      {!monthsLoading && !monthsError && months.length === 0 ? (
        <EmptyState
          title="Todavía no hay ningún mes creado"
          description="Crea el primer mes indicando el año, el mes y cuántos equipos se van a sortear."
          action={<Button onClick={openCreateModal}>Crear mes</Button>}
        />
      ) : null}

      {!monthsLoading && !monthsError && months.length > 0 ? (
        <>
          <div className="team-generator__toolbar">
            <Field
              as="select"
              label="Mes"
              value={effectiveMonthId}
              onChange={(event) => handleMonthChange(event.target.value)}
            >
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatMonthYear(m.year, m.month)} · {m.teamCount} {m.teamCount === 1 ? 'equipo' : 'equipos'}
                  {m.status === 'FINALIZED' ? ' · Finalizado' : ''}
                </option>
              ))}
            </Field>
            <Button variant="secondary" onClick={openCreateModal}>
              Crear mes nuevo
            </Button>
          </div>

          {monthFinalized ? (
            <p className="team-generator__finalized-notice" role="status">
              {monthIsPast
                ? 'Este mes ya pasó y está finalizado: no admite ningún cambio.'
                : 'Este mes está finalizado: ya no admite (re)sortear equipos. Mientras sea el mes actual o uno futuro, todavía podés editar la composición de cada equipo y eliminar el equipo de jóvenes.'}
            </p>
          ) : null}

          <div className="team-generator__action-bar">
            <p className="team-generator__action-summary">
              {teamsLoading
                ? 'Cargando equipos...'
                : teams.length === 0
                  ? `Todavía no se sortearon los ${selectedMonth?.teamCount ?? ''} equipos de este mes.`
                  : `${teams.length} ${teams.length === 1 ? 'equipo sorteado' : 'equipos sorteados'} para este mes.`}
            </p>
            <Button onClick={openGenerateModal} disabled={monthFinalized || teamsLoading}>
              {teams.length > 0 ? 'Re-sortear equipos' : 'Sortear equipos'}
            </Button>
          </div>

          {teamsLoading ? <Spinner label="Cargando equipos..." /> : null}

          {!teamsLoading && teamsError ? <ErrorMessage message={teamsError.message} onRetry={refetchTeams} /> : null}

          {!teamsLoading && !teamsError && teams.length === 0 ? (
            <EmptyState
              title="Este mes todavía no tiene equipos sorteados"
              description="Usa el botón «Sortear equipos» de arriba: el sistema elige un líder por equipo y reparte el resto de instructores y ministros de forma pareja."
            />
          ) : null}

          {!teamsLoading && !teamsError && teams.length > 0 ? (
            <div className="team-generator__grid">
              {sortedTeams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  className={team.teamType === 'YOUTH' ? 'team-card--youth' : ''}
                  actions={
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditModal(team)}
                        disabled={monthIsPast}
                      >
                        Editar integrantes
                      </Button>
                      {team.teamType === 'YOUTH' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setDeleteYouthOpen(true)}
                          disabled={Boolean(deleteYouthDisabledReason)}
                          title={deleteYouthDisabledReason || undefined}
                        >
                          Eliminar equipo de jóvenes
                        </Button>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* Crear mes */}
      <Modal open={createOpen} onClose={closeCreateModal} title="Crear mes nuevo">
        <form onSubmit={handleCreateSubmit} noValidate>
          <div className="team-generator__create-grid">
            <Field
              label="Año"
              type="number"
              required
              min={2000}
              max={2100}
              value={createForm.year}
              onChange={(event) => updateCreateField('year', event.target.value)}
            />
            <Field
              as="select"
              label="Mes"
              required
              value={createForm.month}
              onChange={(event) => updateCreateField('month', event.target.value)}
            >
              {MONTH_LABELS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label.charAt(0).toUpperCase()}
                  {label.slice(1)}
                </option>
              ))}
            </Field>
          </div>

          <Field
            label="Cantidad de equipos"
            type="number"
            required
            min={1}
            max={50}
            hint="El administrador define cuántos equipos se sortean este mes; el sistema reparte a las personas de forma equitativa."
            value={createForm.teamCount}
            onChange={(event) => updateCreateField('teamCount', event.target.value)}
          />

          {createError ? (
            <div className="team-generator__form-error">
              <ErrorMessage message={createError} />
              {duplicateMonthId ? (
                <Button type="button" variant="secondary" onClick={goToDuplicateMonth}>
                  Ver ese mes
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="team-generator__form-actions">
            <Button type="button" variant="secondary" onClick={closeCreateModal}>
              Cancelar
            </Button>
            <Button type="submit" loading={createSubmitting} disabled={createDisabled}>
              Crear mes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Sortear / re-sortear equipos (incluye el equipo de jóvenes) */}
      <Modal
        open={generateModalOpen}
        onClose={closeGenerateModal}
        title={isResort ? 'Volver a sortear los equipos' : 'Sortear los equipos del mes'}
      >
        <form onSubmit={submitGenerate} noValidate>
          {isResort ? (
            <p className="team-generator__resort-warning" role="alert">
              Esto reemplaza por completo el sorteo actual de{' '}
              {selectedMonth ? formatMonthYear(selectedMonth.year, selectedMonth.month) : 'este mes'}, incluida
              cualquier edición manual que hayas hecho. Esta acción no se puede deshacer.
            </p>
          ) : (
            <p className="team-generator__edit-hint">
              El sistema sortea un líder por equipo y reparte el resto de instructores y ministros de forma pareja.
            </p>
          )}

          <Field
            label="Cantidad de equipos"
            type="number"
            required
            min={1}
            max={50}
            hint={
              isResort
                ? 'Podés cambiar cuántos equipos formar en este re-sorteo.'
                : 'El sistema reparte a las personas de forma equitativa entre esta cantidad de equipos.'
            }
            value={teamCountInput}
            onChange={(event) => setTeamCountInput(event.target.value)}
          />

          <Checkbox
            label="Habilitar equipo de jóvenes"
            hint="Además de los equipos regulares, arma un equipo aparte para el servicio de jóvenes con personas marcadas como «Joven»."
            checked={youthEnabled}
            onChange={setYouthEnabled}
          />

          {youthEnabled ? (
            <div className="team-generator__youth-fields">
              <Field
                as="select"
                label="Líder del equipo de jóvenes"
                required
                value={youthLeaderId}
                onChange={(event) => setYouthLeaderId(event.target.value)}
                disabled={youthPeopleLoading}
              >
                <option value="">{youthPeopleLoading ? 'Cargando personas...' : 'Selecciona una persona'}</option>
                {youthLeaderOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Field>

              {youthPeopleError ? (
                <ErrorMessage message="No se pudo cargar el listado de jóvenes." onRetry={loadYouthLeaderOptions} />
              ) : null}

              {!youthPeopleLoading && !youthPeopleError && youthLeaderOptions.length === 0 ? (
                <p className="team-generator__youth-empty">
                  Todavía no hay personas activas marcadas como «Joven». Marca al menos una persona en «Personas»
                  antes de sortear este equipo.
                </p>
              ) : null}

              <Field
                label="Cantidad de personas"
                type="number"
                min={1}
                required
                hint="El líder cuenta como una de estas personas."
                value={youthSize}
                onChange={(event) => setYouthSize(event.target.value)}
              />
            </div>
          ) : null}

          {generateError ? (
            <div className="team-generator__generate-error">
              <ErrorMessage message={describeGenerateError(generateError)} />
              {generateError.code === 'POOL_INSTRUCTOR_INSUFICIENTE' ? (
                <Link to="/admin/personas">
                  <Button type="button" variant="secondary">
                    Ir a Personas
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="team-generator__form-actions">
            <Button type="button" variant="secondary" onClick={closeGenerateModal} disabled={generateSubmitting}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={isResort ? 'danger' : 'primary'}
              loading={generateSubmitting}
              disabled={generateFormInvalid}
            >
              {isResort ? 'Sí, volver a sortear' : 'Confirmar sorteo'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Eliminar equipo de jóvenes: a diferencia de cancelar su turno (que se hace
          desde «Horario y eventos»), acá desaparecen el equipo, sus integrantes y
          su turno YOUTH_SERVICE por completo. */}
      <ConfirmDialog
        open={deleteYouthOpen}
        onClose={() => setDeleteYouthOpen(false)}
        onConfirm={handleDeleteYouthConfirm}
        title="Eliminar equipo de jóvenes"
        description="Se eliminará el equipo de jóvenes por completo: sus integrantes y su turno de Servicio de jóvenes. Los equipos regulares del mes no se ven afectados. Esta acción no se puede deshacer."
        confirmLabel="Sí, eliminar equipo de jóvenes"
        variant="danger"
        loading={deleteYouthLoading}
      />

      {/* Editar integrantes de un equipo */}
      <Modal
        open={Boolean(editTeam)}
        onClose={closeEditModal}
        title={editTeam ? `Editar ${editTeam.label}` : 'Editar equipo'}
        size="lg"
      >
        {editTeam ? (
          <form onSubmit={submitEditRoster} noValidate>
            <p className="team-generator__edit-hint">
              Cambia el rol de cada integrante, quítalo del equipo o agrega a alguien nuevo. Si agregas a una
              persona que ya está en otro equipo de este mes, se quitará automáticamente de ese equipo.
            </p>

            {editRoster.length === 0 ? (
              <p className="team-generator__roster-empty">Este equipo se quedaría sin integrantes.</p>
            ) : (
              <ul className="roster-list">
                {sortMembers(editRoster).map((m) => (
                  <li
                    key={m.personId}
                    className={`roster-row${m.role === 'LEADER' ? ' roster-row--leader' : ''}`}
                  >
                    <span className="roster-row__name">{m.fullName}</span>
                    <label className="roster-row__role-label">
                      <span className="visually-hidden">Rol de {m.fullName}</span>
                      <select
                        className="field__control roster-row__role-select"
                        value={m.role}
                        onChange={(event) => changeRosterRole(m.personId, event.target.value)}
                      >
                        {editRoleOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => removeFromRoster(m.personId)}
                      aria-label={`Quitar a ${m.fullName} del equipo`}
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {rosterLeaderIssue ? (
              <ErrorMessage
                message={
                  editLeaderCount === 0
                    ? 'Este equipo necesita exactamente un líder. Marca a alguien como «Líder» antes de guardar.'
                    : 'Este equipo tiene más de un líder. Deja a una sola persona como «Líder» antes de guardar.'
                }
              />
            ) : null}

            <div className="roster-add-row">
              <Field
                as="select"
                label="Agregar integrante"
                value={addPersonId}
                onChange={(event) => handleAddPersonChange(event.target.value)}
                disabled={peopleLoading}
              >
                <option value="">{peopleLoading ? 'Cargando personas...' : 'Selecciona una persona'}</option>
                {addOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </Field>
              {addPersonId ? (
                <Field
                  as="select"
                  label="Rol"
                  value={addRole}
                  onChange={(event) => setAddRole(event.target.value)}
                >
                  {editRoleOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Field>
              ) : null}
              <Button type="button" variant="secondary" onClick={addToRoster} disabled={!addPersonId}>
                Agregar al equipo
              </Button>
            </div>

            {peopleError ? (
              <ErrorMessage message="No se pudo cargar el listado de personas." onRetry={loadPeopleForEdit} />
            ) : null}
            {editError ? <ErrorMessage message={editError} /> : null}

            <div className="team-generator__form-actions">
              <Button type="button" variant="secondary" onClick={closeEditModal}>
                Cancelar
              </Button>
              <Button type="submit" loading={editSubmitting} disabled={rosterLeaderIssue}>
                Guardar cambios
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
