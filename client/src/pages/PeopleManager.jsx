import { useEffect, useRef, useState } from 'react';
import { createPerson, deactivatePerson, getPeople, importPeople, updatePerson } from '../api/people.js';
import { describeApiError } from '../utils/apiError.js';
import { useApi } from '../hooks/useApi.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useToast } from '../hooks/useToast.js';
import { Table } from '../components/ui/Table.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { FileUpload } from '../components/ui/FileUpload.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Checkbox } from '../components/ui/Checkbox.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ImportReport } from '../components/domain/ImportReport.jsx';
import './PeopleManager.css';

const PAGE_SIZE = 25;

const CATEGORY_LABELS = {
  INSTRUCTOR: 'Instructor',
  MINISTRO: 'Ministro',
};

const EMPTY_FORM = { fullName: '', documentId: '', category: '', isJoven: false, isAdultoMayor: false, notes: '' };

const INITIAL_LIST_PARAMS = { page: 1, pageSize: PAGE_SIZE, sort: 'fullName', active: true };

function toNullableTrimmed(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function PeopleManager() {
  const { data, loading, error, execute } = useApi(getPeople, { immediate: true, args: [INITIAL_LIST_PARAMS] });
  const { showSuccess, showError, showWarning } = useToast();
  const isFirstFilterRun = useRef(true);

  // ---- Filtros y paginación ----
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 400);
  const [category, setCategory] = useState('');
  // 'active' (default, igual que antes) | 'inactive' (solo inactivas) | 'all'.
  const [statusFilter, setStatusFilter] = useState('active');
  // 'all' (default) | 'yes' (solo jóvenes) | 'no' (solo no jóvenes).
  const [jovenFilter, setJovenFilter] = useState('all');
  // 'all' (default) | 'yes' (solo adultos mayores) | 'no' (solo no adultos mayores).
  const [adultoMayorFilter, setAdultoMayorFilter] = useState('all');
  const [page, setPage] = useState(1);

  function buildListParams() {
    const params = { page, pageSize: PAGE_SIZE, sort: 'fullName' };
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    if (category) params.category = category;
    if (statusFilter === 'active') params.active = true;
    else if (statusFilter === 'inactive') params.active = false;
    if (jovenFilter === 'yes') params.isJoven = true;
    else if (jovenFilter === 'no') params.isJoven = false;
    if (adultoMayorFilter === 'yes') params.isAdultoMayor = true;
    else if (adultoMayorFilter === 'no') params.isAdultoMayor = false;
    return params;
  }

  function refetch() {
    execute(buildListParams()).catch(() => {});
  }

  // Cambiar cualquier filtro vuelve a la página 1 y limpia la selección
  // (los ids seleccionados podrían dejar de estar entre los resultados).
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, category, statusFilter, jovenFilter, adultoMayorFilter]);

  // La primera carga ya la hace `immediate: true` de arriba; este efecto
  // solo reacciona a cambios posteriores de filtros/página.
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    execute(buildListParams()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, category, statusFilter, jovenFilter, adultoMayorFilter]);

  // Si una baja/edición deja vacía la página actual (y no es la primera),
  // retrocede una página automáticamente en vez de mostrar un vacío confuso.
  useEffect(() => {
    if (data && data.data.length === 0 && page > 1) {
      setPage((p) => Math.max(1, p - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function applyWarnings(warnings) {
    (warnings || []).forEach((warning) => showWarning(warning.message));
  }

  // ---- Alta ----
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [duplicateName, setDuplicateName] = useState(null);

  function openCreateModal() {
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setDuplicateName(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
  }

  function updateCreateField(key, value) {
    setCreateForm((form) => ({ ...form, [key]: value }));
    setCreateError(null);
    setDuplicateName(null);
  }

  async function submitCreate(confirmDuplicateName) {
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const payload = {
        fullName: createForm.fullName,
        documentId: toNullableTrimmed(createForm.documentId),
        category: createForm.category,
        isJoven: createForm.isJoven,
        isAdultoMayor: createForm.isAdultoMayor,
        notes: toNullableTrimmed(createForm.notes),
        ...(confirmDuplicateName ? { confirmDuplicateName: true } : {}),
      };
      await createPerson(payload);
      setCreateOpen(false);
      showSuccess(`Se creó a ${createForm.fullName.trim()} en el padrón.`);
      refetch();
    } catch (err) {
      const info = describeApiError(err);
      if (info.code === 'DOCUMENTO_DUPLICADO') {
        setDuplicateName(null);
        setCreateError(`Ya existe una persona registrada con ese documento: ${info.details.fullName}.`);
      } else if (info.code === 'NOMBRE_DUPLICADO') {
        setDuplicateName({ fullName: info.details.fullName });
        setCreateError(`Ya existe una persona registrada con el nombre «${info.details.fullName}».`);
      } else {
        setDuplicateName(null);
        setCreateError(info.message);
      }
    } finally {
      setCreateSubmitting(false);
    }
  }

  function handleCreateSubmit(event) {
    event.preventDefault();
    submitCreate(false);
  }

  const createDisabled = !createForm.fullName.trim() || !createForm.category;

  // ---- Edición ----
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);

  function openEditModal(person) {
    setEditTarget(person);
    setEditForm({
      fullName: person.fullName,
      documentId: person.documentId || '',
      category: person.category,
      isJoven: Boolean(person.isJoven),
      isAdultoMayor: Boolean(person.isAdultoMayor),
      notes: person.notes || '',
    });
    setEditError(null);
  }

  function closeEditModal() {
    setEditTarget(null);
  }

  function updateEditField(key, value) {
    setEditForm((form) => ({ ...form, [key]: value }));
    setEditError(null);
  }

  function buildEditChanges() {
    if (!editTarget) return {};
    const changes = {};
    const newFullName = editForm.fullName.trim().replace(/\s+/g, ' ');
    if (newFullName && newFullName !== editTarget.fullName) changes.fullName = editForm.fullName;
    const newDocument = toNullableTrimmed(editForm.documentId);
    if (newDocument !== (editTarget.documentId ?? null)) changes.documentId = newDocument;
    if (editForm.category !== editTarget.category) changes.category = editForm.category;
    if (editForm.isJoven !== Boolean(editTarget.isJoven)) changes.isJoven = editForm.isJoven;
    if (editForm.isAdultoMayor !== Boolean(editTarget.isAdultoMayor)) changes.isAdultoMayor = editForm.isAdultoMayor;
    const newNotes = toNullableTrimmed(editForm.notes);
    if (newNotes !== (editTarget.notes ?? null)) changes.notes = newNotes;
    return changes;
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    const changes = buildEditChanges();
    if (Object.keys(changes).length === 0) {
      // Nada cambió: cerramos sin llamar a la API (PATCH nunca se envía vacío).
      setEditTarget(null);
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { person, warnings } = await updatePerson(editTarget.id, changes);
      setEditTarget(null);
      showSuccess(`Se actualizó a ${person.fullName}.`);
      applyWarnings(warnings);
      refetch();
    } catch (err) {
      const info = describeApiError(err);
      if (info.code === 'DOCUMENTO_DUPLICADO') {
        setEditError(`Ya existe una persona registrada con ese documento: ${info.details.fullName}.`);
      } else {
        setEditError(info.message);
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  // ---- Baja / reactivación ----
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);
  const [reactivatingId, setReactivatingId] = useState(null);

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    setDeactivateSubmitting(true);
    try {
      const { person, warnings } = await deactivatePerson(deactivateTarget.id);
      setDeactivateTarget(null);
      showSuccess(`Se inactivó a ${person.fullName}.`);
      applyWarnings(warnings);
      refetch();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setDeactivateSubmitting(false);
    }
  }

  async function handleReactivate(person) {
    setReactivatingId(person.id);
    try {
      const { person: updated, warnings } = await updatePerson(person.id, { active: true });
      showSuccess(`Se reactivó a ${updated.fullName}.`);
      applyWarnings(warnings);
      refetch();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setReactivatingId(null);
    }
  }

  // ---- Selección múltiple y acciones en lote ----
  // La API no tiene un endpoint de bulk update: cada acción en lote dispara
  // un PATCH/DELETE por persona en paralelo y junta los resultados. No es
  // atómico (algunas filas pueden actualizarse y otras fallar), por eso el
  // resumen final siempre distingue éxitos de fallos en vez de asumir todo-o-nada.
  //
  // `selectionMode` empieza apagado a propósito: la columna de checkboxes ni
  // siquiera se agrega a `columns` mientras está en false (no solo
  // deshabilitada) — el admin la prende con un botón explícito en la barra
  // de herramientas.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState('INSTRUCTOR');
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState('active');
  const [bulkJovenOpen, setBulkJovenOpen] = useState(false);
  const [bulkJovenValue, setBulkJovenValue] = useState('true');
  const [bulkAdultoMayorOpen, setBulkAdultoMayorOpen] = useState(false);
  const [bulkAdultoMayorValue, setBulkAdultoMayorValue] = useState('true');

  function toggleSelectionMode() {
    setSelectionMode((prev) => !prev);
    clearSelection();
  }

  function toggleSelectOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runBulkAction(ids, action) {
    setBulkSubmitting(true);
    const results = await Promise.allSettled(ids.map((id) => action(id)));
    setBulkSubmitting(false);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    if (failed.length === 0) {
      showSuccess(`Se actualizó a ${succeeded.length} persona${succeeded.length === 1 ? '' : 's'}.`);
    } else if (succeeded.length === 0) {
      showError(`No se pudo actualizar a ninguna persona (${describeApiError(failed[0].reason).message}).`);
    } else {
      showWarning(
        `Se actualizó a ${succeeded.length} de ${ids.length} personas; ${failed.length} no se pudieron actualizar.`,
      );
    }
    applyWarnings(succeeded.flatMap((r) => r.value?.warnings || []));
    clearSelection();
    refetch();
  }

  function openBulkCategoryModal() {
    setBulkCategoryValue('INSTRUCTOR');
    setBulkCategoryOpen(true);
  }

  async function submitBulkCategory(event) {
    event.preventDefault();
    setBulkCategoryOpen(false);
    await runBulkAction(Array.from(selectedIds), (id) => updatePerson(id, { category: bulkCategoryValue }));
  }

  function openBulkStatusModal() {
    setBulkStatusValue('active');
    setBulkStatusOpen(true);
  }

  async function submitBulkStatus(event) {
    event.preventDefault();
    setBulkStatusOpen(false);
    const ids = Array.from(selectedIds);
    if (bulkStatusValue === 'active') {
      await runBulkAction(ids, (id) => updatePerson(id, { active: true }));
    } else {
      await runBulkAction(ids, (id) => deactivatePerson(id));
    }
  }

  function openBulkJovenModal() {
    setBulkJovenValue('true');
    setBulkJovenOpen(true);
  }

  async function submitBulkJoven(event) {
    event.preventDefault();
    setBulkJovenOpen(false);
    const isJoven = bulkJovenValue === 'true';
    await runBulkAction(Array.from(selectedIds), (id) => updatePerson(id, { isJoven }));
  }

  function openBulkAdultoMayorModal() {
    setBulkAdultoMayorValue('true');
    setBulkAdultoMayorOpen(true);
  }

  async function submitBulkAdultoMayor(event) {
    event.preventDefault();
    setBulkAdultoMayorOpen(false);
    const isAdultoMayor = bulkAdultoMayorValue === 'true';
    await runBulkAction(Array.from(selectedIds), (id) => updatePerson(id, { isAdultoMayor }));
  }

  // ---- Import masivo ----
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importStatus, setImportStatus] = useState('idle'); // idle | loading | error | done
  const [importResult, setImportResult] = useState(null);
  const [importErrorMessage, setImportErrorMessage] = useState(null);

  function openImportModal() {
    setImportFile(null);
    setImportStatus('idle');
    setImportResult(null);
    setImportErrorMessage(null);
    setImportOpen(true);
  }

  function closeImportModal() {
    const shouldRefetch = importStatus === 'done';
    setImportOpen(false);
    if (shouldRefetch) refetch();
  }

  async function handleImportSubmit() {
    if (!importFile) return;
    setImportStatus('loading');
    setImportErrorMessage(null);
    try {
      const result = await importPeople(importFile);
      setImportResult(result);
      setImportStatus('done');
    } catch (err) {
      setImportErrorMessage(describeApiError(err).message);
      setImportStatus('error');
    }
  }

  // ---- Tabla ----
  const people = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  const hasActiveFilters =
    Boolean(debouncedSearch.trim()) || Boolean(category) || jovenFilter !== 'all' || adultoMayorFilter !== 'all';

  const pageIds = people.map((p) => p.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = pageIds.some((id) => selectedIds.has(id));

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  const selectColumn = {
    key: '__select',
    header: (
      <input
        type="checkbox"
        className="people-manager__row-checkbox"
        aria-label="Seleccionar todas las personas de esta página"
        checked={allOnPageSelected}
        ref={(el) => {
          if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected;
        }}
        onChange={toggleSelectAllOnPage}
      />
    ),
    render: (row) => (
      <input
        type="checkbox"
        className="people-manager__row-checkbox"
        aria-label={`Seleccionar a ${row.fullName}`}
        checked={selectedIds.has(row.id)}
        onChange={() => toggleSelectOne(row.id)}
      />
    ),
  };

  const columns = [
    // La columna de checkboxes solo existe en el array de columnas mientras
    // `selectionMode` está prendido: cuando está apagado no hay rastro de
    // ella en el DOM, no solo deshabilitada.
    ...(selectionMode ? [selectColumn] : []),
    {
      key: '__index',
      header: '#',
      // Numeración absoluta (no reinicia en 1 en cada página), así una
      // persona tiene siempre el mismo número mientras no cambie el orden.
      render: (row, index) => (page - 1) * PAGE_SIZE + index + 1,
    },
    { key: 'fullName', header: 'Nombre' },
    { key: 'documentId', header: 'Documento', render: (row) => row.documentId || '—' },
    {
      key: 'category',
      header: 'Categoría',
      render: (row) => (
        <div className="people-manager__category-cell">
          <Badge variant="primary">{CATEGORY_LABELS[row.category] || row.category}</Badge>
          {row.isJoven ? <Badge variant="success">Joven</Badge> : null}
          {row.isAdultoMayor ? <Badge variant="warning">Adulto mayor</Badge> : null}
        </div>
      ),
    },
    {
      key: 'active',
      header: 'Estado',
      render: (row) => (
        <Badge variant={row.active ? 'success' : 'neutral'}>{row.active ? 'Activo' : 'Inactivo'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (row) => (
        <div className="people-manager__row-actions">
          <Button variant="secondary" size="sm" onClick={() => openEditModal(row)} aria-label={`Editar a ${row.fullName}`}>
            Editar
          </Button>
          {row.active ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setDeactivateTarget(row)}
              aria-label={`Inactivar a ${row.fullName}`}
            >
              Inactivar
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              loading={reactivatingId === row.id}
              onClick={() => handleReactivate(row)}
              aria-label={`Reactivar a ${row.fullName}`}
            >
              Reactivar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <header className="page-header">
        <h1>Personas</h1>
        <p className="page-header__description">
          Administra el padrón de instructores y ministros: carga masiva por archivo, alta, edición, inactivación
          y acciones en lote sobre varias personas a la vez.
        </p>
      </header>

      <div className="people-manager__toolbar">
        <Button onClick={openCreateModal}>Nueva persona</Button>
        <Button variant="secondary" onClick={openImportModal}>
          Importar personas
        </Button>
        <Button
          variant={selectionMode ? 'primary' : 'secondary'}
          onClick={toggleSelectionMode}
          aria-pressed={selectionMode}
        >
          {selectionMode ? 'Salir de selección múltiple' : 'Seleccionar varias'}
        </Button>
      </div>

      <div className="people-manager__filters">
        <Field
          label="Buscar por nombre o documento"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ej. María o 1234567"
        />
        <Field label="Categoría" as="select" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Todas las categorías</option>
          <option value="INSTRUCTOR">Instructor</option>
          <option value="MINISTRO">Ministro</option>
        </Field>
        <Field
          label="Estado"
          as="select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
          <option value="all">Todas</option>
        </Field>
        <Field label="Joven" as="select" value={jovenFilter} onChange={(event) => setJovenFilter(event.target.value)}>
          <option value="all">Todas</option>
          <option value="yes">Solo jóvenes</option>
          <option value="no">Solo no jóvenes</option>
        </Field>
        <Field
          label="Adulto mayor"
          as="select"
          value={adultoMayorFilter}
          onChange={(event) => setAdultoMayorFilter(event.target.value)}
        >
          <option value="all">Todas</option>
          <option value="yes">Solo adultos mayores</option>
          <option value="no">Solo no adultos mayores</option>
        </Field>
      </div>

      {selectionMode && selectedIds.size > 0 ? (
        <div className="people-manager__selection-bar" role="toolbar" aria-label="Acciones sobre la selección">
          <p className="people-manager__selection-count">
            {selectedIds.size} persona{selectedIds.size === 1 ? '' : 's'} seleccionada{selectedIds.size === 1 ? '' : 's'}
          </p>
          <div className="people-manager__selection-actions">
            <Button variant="secondary" size="sm" onClick={openBulkCategoryModal} disabled={bulkSubmitting}>
              Cambiar categoría
            </Button>
            <Button variant="secondary" size="sm" onClick={openBulkStatusModal} disabled={bulkSubmitting}>
              Cambiar estado
            </Button>
            <Button variant="secondary" size="sm" onClick={openBulkJovenModal} disabled={bulkSubmitting}>
              Cambiar Joven
            </Button>
            <Button variant="secondary" size="sm" onClick={openBulkAdultoMayorModal} disabled={bulkSubmitting}>
              Cambiar Adulto mayor
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={bulkSubmitting}>
              Cancelar selección
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? <Spinner label="Cargando personas..." /> : null}

      {!loading && error ? <ErrorMessage message={error.message} onRetry={refetch} /> : null}

      {!loading && !error ? (
        <>
          <Table
            columns={columns}
            data={people}
            caption="Listado de personas registradas"
            emptyState={
              <EmptyState
                title={hasActiveFilters ? 'No hay personas que coincidan con la búsqueda' : 'Todavía no hay personas registradas'}
                description={
                  hasActiveFilters
                    ? 'Prueba con otro nombre o documento, o quita los filtros aplicados.'
                    : 'Usa el botón «Nueva persona» o «Importar personas» para cargar el primer listado.'
                }
              />
            }
          />
          {pagination ? (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onPageChange={setPage}
            />
          ) : null}
        </>
      ) : null}

      {/* Alta */}
      <Modal open={createOpen} onClose={closeCreateModal} title="Nueva persona">
        <form onSubmit={handleCreateSubmit} noValidate>
          <Field
            label="Nombre completo"
            required
            maxLength={120}
            value={createForm.fullName}
            onChange={(event) => updateCreateField('fullName', event.target.value)}
          />
          <Field
            label="Documento (opcional)"
            hint="Cédula u otro documento de identidad."
            maxLength={30}
            value={createForm.documentId}
            onChange={(event) => updateCreateField('documentId', event.target.value)}
          />
          <Field
            label="Categoría"
            as="select"
            required
            value={createForm.category}
            onChange={(event) => updateCreateField('category', event.target.value)}
          >
            <option value="" disabled>
              Selecciona una categoría
            </option>
            <option value="INSTRUCTOR">Instructor</option>
            <option value="MINISTRO">Ministro</option>
          </Field>
          <Checkbox
            label="Joven"
            hint="Elegible para el equipo de jóvenes. Es independiente de la categoría de arriba."
            checked={createForm.isJoven}
            onChange={(checked) => {
              updateCreateField('isJoven', checked);
              if (checked) updateCreateField('isAdultoMayor', false);
            }}
          />
          <Checkbox
            label="Adulto mayor"
            hint="Independiente de la categoría. No se puede marcar junto con Joven."
            checked={createForm.isAdultoMayor}
            onChange={(checked) => {
              updateCreateField('isAdultoMayor', checked);
              if (checked) updateCreateField('isJoven', false);
            }}
          />
          <Field
            label="Notas (opcional)"
            as="textarea"
            maxLength={500}
            value={createForm.notes}
            onChange={(event) => updateCreateField('notes', event.target.value)}
          />

          {createError ? (
            <div className="people-manager__form-error">
              <ErrorMessage message={createError} />
              {duplicateName ? (
                <Button type="button" variant="secondary" onClick={() => submitCreate(true)} loading={createSubmitting}>
                  Crear de todos modos
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="people-manager__form-actions">
            <Button type="button" variant="secondary" onClick={closeCreateModal}>
              Cancelar
            </Button>
            <Button type="submit" loading={createSubmitting} disabled={createDisabled}>
              Crear persona
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edición */}
      <Modal open={Boolean(editTarget)} onClose={closeEditModal} title="Editar persona">
        {editTarget ? (
          <form onSubmit={handleEditSubmit} noValidate>
            <Field
              label="Nombre completo"
              required
              maxLength={120}
              value={editForm.fullName}
              onChange={(event) => updateEditField('fullName', event.target.value)}
            />
            <Field
              label="Documento (opcional)"
              hint="Cédula u otro documento de identidad."
              maxLength={30}
              value={editForm.documentId}
              onChange={(event) => updateEditField('documentId', event.target.value)}
            />
            <Field
              label="Categoría"
              as="select"
              required
              value={editForm.category}
              onChange={(event) => updateEditField('category', event.target.value)}
            >
              <option value="INSTRUCTOR">Instructor</option>
              <option value="MINISTRO">Ministro</option>
            </Field>
            <Checkbox
              label="Joven"
              hint="Elegible para el equipo de jóvenes. Es independiente de la categoría de arriba."
              checked={editForm.isJoven}
              onChange={(checked) => {
                updateEditField('isJoven', checked);
                if (checked) updateEditField('isAdultoMayor', false);
              }}
            />
            <Checkbox
              label="Adulto mayor"
              hint="Independiente de la categoría. No se puede marcar junto con Joven."
              checked={editForm.isAdultoMayor}
              onChange={(checked) => {
                updateEditField('isAdultoMayor', checked);
                if (checked) updateEditField('isJoven', false);
              }}
            />
            <Field
              label="Notas (opcional)"
              as="textarea"
              maxLength={500}
              value={editForm.notes}
              onChange={(event) => updateEditField('notes', event.target.value)}
            />

            {editError ? <ErrorMessage message={editError} /> : null}

            <div className="people-manager__form-actions">
              <Button type="button" variant="secondary" onClick={closeEditModal}>
                Cancelar
              </Button>
              <Button type="submit" loading={editSubmitting}>
                Guardar cambios
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* Baja lógica */}
      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title="Inactivar a esta persona"
        description={
          deactivateTarget
            ? `${deactivateTarget.fullName} dejará de aparecer en los próximos sorteos, pero su historial se conserva. Puedes reactivarla cuando quieras desde el listado de inactivas.`
            : ''
        }
        confirmLabel="Inactivar"
        cancelLabel="Cancelar"
        variant="danger"
        loading={deactivateSubmitting}
      />

      {/* Import masivo */}
      <Modal
        open={importOpen}
        onClose={closeImportModal}
        title={importStatus === 'done' ? 'Resultado de la importación' : 'Importar personas'}
      >
        {importStatus === 'done' && importResult ? (
          <>
            <ImportReport result={importResult} />
            <div className="people-manager__form-actions">
              <Button onClick={closeImportModal}>Cerrar</Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Selecciona un archivo CSV o Excel (.xlsx) con las columnas nombre, documento (opcional), categoría y,
              opcionalmente, si la persona es joven (columna «Joven», con «Sí» o «No») y/o adulto mayor (columna
              «Adulto mayor», con «Sí» o «No»). El archivo no debe superar 2&nbsp;MB ni 2000 filas.
            </p>
            <FileUpload
              label="Elegir archivo"
              accept=".csv,.xlsx"
              hint="Formatos admitidos: .csv, .xlsx"
              onFileSelected={setImportFile}
            />

            {importStatus === 'loading' ? <Spinner label="Importando personas..." /> : null}
            {importStatus === 'error' ? <ErrorMessage message={importErrorMessage} /> : null}

            <div className="people-manager__form-actions">
              <Button variant="secondary" onClick={closeImportModal} disabled={importStatus === 'loading'}>
                Cancelar
              </Button>
              <Button onClick={handleImportSubmit} disabled={!importFile} loading={importStatus === 'loading'}>
                Importar
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Cambiar categoría en lote */}
      <Modal open={bulkCategoryOpen} onClose={() => setBulkCategoryOpen(false)} title="Cambiar categoría">
        <form onSubmit={submitBulkCategory} noValidate>
          <p>
            Se va a cambiar la categoría de {selectedIds.size} persona{selectedIds.size === 1 ? '' : 's'}{' '}
            seleccionada{selectedIds.size === 1 ? '' : 's'}.
          </p>
          <Field
            label="Nueva categoría"
            as="select"
            value={bulkCategoryValue}
            onChange={(event) => setBulkCategoryValue(event.target.value)}
          >
            <option value="INSTRUCTOR">Instructor</option>
            <option value="MINISTRO">Ministro</option>
          </Field>
          <div className="people-manager__form-actions">
            <Button type="button" variant="secondary" onClick={() => setBulkCategoryOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={bulkSubmitting}>
              Aplicar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cambiar estado en lote */}
      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Cambiar estado">
        <form onSubmit={submitBulkStatus} noValidate>
          <p>
            Se va a cambiar el estado de {selectedIds.size} persona{selectedIds.size === 1 ? '' : 's'} seleccionada
            {selectedIds.size === 1 ? '' : 's'}.
          </p>
          <Field
            label="Nuevo estado"
            as="select"
            value={bulkStatusValue}
            onChange={(event) => setBulkStatusValue(event.target.value)}
          >
            <option value="active">Activar</option>
            <option value="inactive">Inactivar</option>
          </Field>
          {bulkStatusValue === 'inactive' ? (
            <p className="people-manager__bulk-warning">
              Estas personas dejarán de aparecer en los próximos sorteos. Su historial se conserva y podés
              reactivarlas cuando quieras.
            </p>
          ) : null}
          <div className="people-manager__form-actions">
            <Button type="button" variant="secondary" onClick={() => setBulkStatusOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant={bulkStatusValue === 'inactive' ? 'danger' : 'primary'} loading={bulkSubmitting}>
              Aplicar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cambiar Joven en lote */}
      <Modal open={bulkJovenOpen} onClose={() => setBulkJovenOpen(false)} title="Cambiar Joven">
        <form onSubmit={submitBulkJoven} noValidate>
          <p>
            Se va a cambiar la marca de Joven de {selectedIds.size} persona{selectedIds.size === 1 ? '' : 's'}{' '}
            seleccionada{selectedIds.size === 1 ? '' : 's'}. Es independiente de la categoría de cada persona.
          </p>
          <Field
            label="Marcar como"
            as="select"
            value={bulkJovenValue}
            onChange={(event) => setBulkJovenValue(event.target.value)}
          >
            <option value="true">Joven</option>
            <option value="false">No joven</option>
          </Field>
          <div className="people-manager__form-actions">
            <Button type="button" variant="secondary" onClick={() => setBulkJovenOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={bulkSubmitting}>
              Aplicar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cambiar Adulto mayor en lote */}
      <Modal open={bulkAdultoMayorOpen} onClose={() => setBulkAdultoMayorOpen(false)} title="Cambiar Adulto mayor">
        <form onSubmit={submitBulkAdultoMayor} noValidate>
          <p>
            Se va a cambiar la marca de Adulto mayor de {selectedIds.size} persona{selectedIds.size === 1 ? '' : 's'}{' '}
            seleccionada{selectedIds.size === 1 ? '' : 's'}. Es independiente de la categoría de cada persona.
          </p>
          <Field
            label="Marcar como"
            as="select"
            value={bulkAdultoMayorValue}
            onChange={(event) => setBulkAdultoMayorValue(event.target.value)}
          >
            <option value="true">Adulto mayor</option>
            <option value="false">No adulto mayor</option>
          </Field>
          <div className="people-manager__form-actions">
            <Button type="button" variant="secondary" onClick={() => setBulkAdultoMayorOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={bulkSubmitting}>
              Aplicar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
