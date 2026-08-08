import { useState } from 'react';
import { getUniforms, createUniform, updateUniform } from '../api/uniforms.js';
import { describeApiError } from '../utils/apiError.js';
import { useApi } from '../hooks/useApi.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useToast } from '../hooks/useToast.js';
import { Table } from '../components/ui/Table.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Checkbox } from '../components/ui/Checkbox.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { ColorPalettePicker, UNIFORM_COLOR_PALETTE } from '../components/ui/ColorPalettePicker.jsx';
import { UniformBadge } from '../components/domain/UniformBadge.jsx';
import './UniformsManager.css';

const EMPTY_UNIFORM_FORM = { name: '', colorHex: '', description: '' };

/**
 * Nombre legible de un `colorHex` si coincide con la paleta fija; si no
 * coincide (color personalizado), devuelve el hex tal cual para no perder
 * la referencia visual en el filtro.
 */
function colorFilterLabel(hex) {
  return UNIFORM_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;
}

export function UniformsManager() {
  const { showSuccess } = useToast();

  // ---- Listado de uniformes ----
  const { data: uniforms, loading: uniformsLoading, error: uniformsError, execute: fetchUniforms } = useApi(
    getUniforms,
    { immediate: true },
  );
  const uniformList = uniforms ?? [];

  // ---- Filtros (todos del lado del cliente, la lista ya está completa) ----
  const [nameFilter, setNameFilter] = useState('');
  const debouncedNameFilter = useDebouncedValue(nameFilter, 400);
  const [colorFilter, setColorFilter] = useState('');
  // 'active' (default) | 'inactive' | 'all' — mismo patrón que "Estado" en PeopleManager.
  const [statusFilter, setStatusFilter] = useState('all');

  const colorOptions = Array.from(new Set(uniformList.map((u) => u.colorHex).filter(Boolean))).map((hex) => ({
    hex,
    label: colorFilterLabel(hex),
  }));

  const filteredUniforms = uniformList.filter((u) => {
    if (debouncedNameFilter.trim() && !u.name.toLowerCase().includes(debouncedNameFilter.trim().toLowerCase())) {
      return false;
    }
    if (colorFilter && (u.colorHex ?? '').toLowerCase() !== colorFilter.toLowerCase()) return false;
    if (statusFilter === 'active' && !u.active) return false;
    if (statusFilter === 'inactive' && u.active) return false;
    return true;
  });

  const hasActiveFilters = Boolean(debouncedNameFilter.trim()) || Boolean(colorFilter) || statusFilter !== 'all';

  // ---- Alta / edición ----
  const [modalMode, setModalMode] = useState(null); // null | 'create' | 'edit'
  const [uniformForm, setUniformForm] = useState(EMPTY_UNIFORM_FORM);
  const [uniformActive, setUniformActive] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  function openCreateModal() {
    setUniformForm(EMPTY_UNIFORM_FORM);
    setUniformActive(true);
    setEditingId(null);
    setFormError(null);
    setModalMode('create');
  }

  function openEditModal(row) {
    setUniformForm({ name: row.name, colorHex: row.colorHex || '', description: row.description || '' });
    setUniformActive(row.active);
    setEditingId(row.id);
    setFormError(null);
    setModalMode('edit');
  }

  function closeModal() {
    setModalMode(null);
  }

  function updateFormField(key, value) {
    setUniformForm((form) => ({ ...form, [key]: value }));
    setFormError(null);
  }

  async function submitUniform(event) {
    event.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: uniformForm.name.trim(),
        colorHex: uniformForm.colorHex.trim() || undefined,
        description: uniformForm.description.trim() || undefined,
      };
      if (modalMode === 'edit') {
        await updateUniform(editingId, { ...payload, active: uniformActive });
        showSuccess('Se actualizó el uniforme.');
      } else {
        await createUniform(payload);
        showSuccess('Se creó el uniforme.');
      }
      closeModal();
      fetchUniforms();
    } catch (err) {
      const info = describeApiError(err);
      setFormError(info.code === 'UNIFORME_DUPLICADO' ? 'Ya existe un uniforme con ese nombre.' : info.message);
    } finally {
      setFormSubmitting(false);
    }
  }

  const columns = [
    {
      key: '__index',
      header: '#',
      // Numeración absoluta sobre la lista filtrada: hoy no hay paginación,
      // así que coincide siempre con el orden visible.
      render: (row, index) => index + 1,
    },
    { key: 'name', header: 'Uniforme', render: (row) => <UniformBadge name={row.name} colorHex={row.colorHex} /> },
    { key: 'description', header: 'Descripción', render: (row) => row.description || '—' },
    {
      key: 'active',
      header: 'Estado',
      render: (row) => <Badge variant={row.active ? 'success' : 'neutral'}>{row.active ? 'Activo' : 'Inactivo'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => openEditModal(row)}>
          Editar
        </Button>
      ),
    },
  ];

  return (
    <div>
      <header className="page-header">
        <h1>Uniformes</h1>
        <p className="page-header__description">
          Define los uniformes disponibles. El uniforme de cada turno se asigna por fecha desde «Horario y
          eventos», no acá.
        </p>
      </header>

      <div className="uniforms-manager__toolbar">
        <Button onClick={openCreateModal}>Nuevo uniforme</Button>
      </div>

      <div className="uniforms-manager__filters">
        <Field
          label="Buscar por nombre"
          value={nameFilter}
          onChange={(event) => setNameFilter(event.target.value)}
          placeholder="Ej. Uniforme A"
        />
        <Field label="Color" as="select" value={colorFilter} onChange={(event) => setColorFilter(event.target.value)}>
          <option value="">Todos los colores</option>
          {colorOptions.map((option) => (
            <option key={option.hex} value={option.hex}>
              {option.label}
            </option>
          ))}
        </Field>
        <Field
          label="Estado"
          as="select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">Todas</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </Field>
      </div>

      {uniformsLoading ? <Spinner label="Cargando uniformes..." /> : null}

      {!uniformsLoading && uniformsError ? (
        <ErrorMessage message={uniformsError.message} onRetry={fetchUniforms} />
      ) : null}

      {!uniformsLoading && !uniformsError ? (
        <Table
          columns={columns}
          data={filteredUniforms}
          caption="Uniformes configurados"
          emptyState={
            <EmptyState
              title={hasActiveFilters ? 'No hay uniformes que coincidan con los filtros' : 'Todavía no hay uniformes configurados'}
              description={
                hasActiveFilters
                  ? 'Prueba con otro nombre o color, o quita los filtros aplicados.'
                  : 'Crea el primer uniforme con el botón «Nuevo uniforme».'
              }
            />
          }
        />
      ) : null}

      {/* Alta / edición de uniforme */}
      <Modal open={Boolean(modalMode)} onClose={closeModal} title={modalMode === 'edit' ? 'Editar uniforme' : 'Nuevo uniforme'}>
        <form onSubmit={submitUniform} noValidate>
          <Field
            label="Nombre"
            required
            maxLength={100}
            value={uniformForm.name}
            onChange={(event) => updateFormField('name', event.target.value)}
          />
          <ColorPalettePicker
            label="Color"
            hint="Opcional. Se usa como referencia visual del uniforme."
            value={uniformForm.colorHex}
            onChange={(hex) => updateFormField('colorHex', hex)}
          />
          <Field
            as="textarea"
            label="Descripción"
            hint="Opcional."
            rows={3}
            value={uniformForm.description}
            onChange={(event) => updateFormField('description', event.target.value)}
          />

          {modalMode === 'edit' ? (
            <Checkbox
              label="Uniforme activo"
              hint="Los uniformes inactivos dejan de estar disponibles para elegir, pero no se borran."
              checked={uniformActive}
              onChange={setUniformActive}
            />
          ) : null}

          {formError ? <ErrorMessage message={formError} /> : null}

          <div className="uniforms-manager__form-actions">
            <Button type="button" variant="secondary" onClick={closeModal} disabled={formSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={formSubmitting} disabled={!uniformForm.name.trim()}>
              {modalMode === 'edit' ? 'Guardar cambios' : 'Crear uniforme'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
