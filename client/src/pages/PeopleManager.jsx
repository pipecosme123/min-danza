import { useEffect, useRef, useState } from 'react';
import { createPerson, deactivatePerson, getPeople, importPeople, updatePerson } from '../api/people.js';
import { ApiError } from '../api/client.js';
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
import { Pagination } from '../components/ui/Pagination.jsx';
import { ImportReport } from '../components/domain/ImportReport.jsx';
import './PeopleManager.css';

const PAGE_SIZE = 25;

const CATEGORY_LABELS = {
  INSTRUCTOR: 'Instructor',
  MINISTRO: 'Ministro',
};

const EMPTY_FORM = { fullName: '', documentId: '', category: '', notes: '' };

const INITIAL_LIST_PARAMS = { page: 1, pageSize: PAGE_SIZE, sort: 'fullName', active: true };

/**
 * Traduce un `ApiError` a un mensaje en lenguaje llano y, cuando el servidor
 * lo envía, al código de dominio (`DOCUMENTO_DUPLICADO`, `NOMBRE_DUPLICADO`,
 * ...). Centralizado acá para no repetir la misma rama if/else en cada
 * handler (alta, edición, baja, import).
 */
function describeApiError(err) {
  if (!(err instanceof ApiError)) {
    return { message: 'Ocurrió un problema inesperado. Intenta de nuevo.', code: null, details: null };
  }
  const { details } = err;
  if (details && !Array.isArray(details) && details.code) {
    return { message: err.message, code: details.code, details };
  }
  if (Array.isArray(details) && details.length > 0) {
    return { message: details.map((d) => d.message).join(' '), code: 'VALIDACION', details };
  }
  return { message: err.message, code: null, details: null };
}

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
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);

  function buildListParams() {
    const params = { page, pageSize: PAGE_SIZE, sort: 'fullName' };
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    if (category) params.category = category;
    if (!showInactive) params.active = true;
    return params;
  }

  function refetch() {
    execute(buildListParams()).catch(() => {});
  }

  // Cambiar cualquier filtro vuelve a la página 1.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, category, showInactive]);

  // La primera carga ya la hace `immediate: true` de arriba; este efecto
  // solo reacciona a cambios posteriores de filtros/página.
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    execute(buildListParams()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, category, showInactive]);

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
      showSuccess(`Se dio de baja a ${person.fullName}.`);
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
  const hasActiveFilters = Boolean(debouncedSearch.trim()) || Boolean(category);

  const columns = [
    { key: 'fullName', header: 'Nombre' },
    { key: 'documentId', header: 'Documento', render: (row) => row.documentId || '—' },
    {
      key: 'category',
      header: 'Categoría',
      render: (row) => <Badge variant="primary">{CATEGORY_LABELS[row.category] || row.category}</Badge>,
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
              aria-label={`Dar de baja a ${row.fullName}`}
            >
              Dar de baja
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
          Administra el padrón de instructores y ministros: carga masiva por archivo, alta, edición y baja
          individual.
        </p>
      </header>

      <div className="people-manager__toolbar">
        <Button onClick={openCreateModal}>Nueva persona</Button>
        <Button variant="secondary" onClick={openImportModal}>
          Importar personas
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
        <label className="people-manager__checkbox">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          Ver personas inactivas también
        </label>
      </div>

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
        title="Dar de baja a esta persona"
        description={
          deactivateTarget
            ? `${deactivateTarget.fullName} dejará de aparecer en los próximos sorteos, pero su historial se conserva. Puedes reactivarla cuando quieras desde el listado de inactivos.`
            : ''
        }
        confirmLabel="Dar de baja"
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
              Selecciona un archivo CSV o Excel (.xlsx) con las columnas nombre, documento (opcional) y categoría. El
              archivo no debe superar 2&nbsp;MB ni 2000 filas.
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
    </div>
  );
}
