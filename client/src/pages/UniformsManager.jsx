import { useState } from 'react';
import {
  getUniforms,
  createUniform,
  updateUniform,
  getWeekdayUniforms,
  updateWeekdayUniform,
  getYouthServiceUniform,
  updateYouthServiceUniform,
} from '../api/uniforms.js';
import { describeApiError } from '../utils/apiError.js';
import { useApi } from '../hooks/useApi.js';
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
import { UniformBadge } from '../components/domain/UniformBadge.jsx';
import './UniformsManager.css';

const EMPTY_UNIFORM_FORM = { name: '', colorHex: '', description: '' };

const WEEKDAY_OPTIONS = [
  { value: 'WEDNESDAY', label: 'Miércoles' },
  { value: 'SUNDAY', label: 'Domingo' },
];

export function UniformsManager() {
  const { showSuccess, showError } = useToast();

  // ---- Listado de uniformes ----
  const { data: uniforms, loading: uniformsLoading, error: uniformsError, execute: fetchUniforms } = useApi(
    getUniforms,
    { immediate: true },
  );
  const uniformList = uniforms ?? [];
  const activeUniforms = uniformList.filter((u) => u.active);

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

  // ---- Config por día de semana ----
  const { data: weekdayData, loading: weekdayLoading, error: weekdayError, execute: fetchWeekday } = useApi(
    getWeekdayUniforms,
    { immediate: true },
  );
  const weekdayRows = weekdayData ?? [];
  const [savingWeekday, setSavingWeekday] = useState(null);

  function weekdayUniformId(weekday) {
    return weekdayRows.find((row) => row.weekday === weekday)?.uniformId ?? '';
  }

  async function handleWeekdayChange(weekday, uniformId) {
    if (!uniformId) return;
    setSavingWeekday(weekday);
    try {
      await updateWeekdayUniform(weekday, uniformId);
      const label = weekday === 'WEDNESDAY' ? 'miércoles' : 'domingo';
      showSuccess(`Se actualizó el uniforme de ${label}.`);
      fetchWeekday();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setSavingWeekday(null);
    }
  }

  // ---- Config del Servicio de jóvenes ----
  const { data: youthData, loading: youthLoading, error: youthError, execute: fetchYouth } = useApi(
    getYouthServiceUniform,
    { immediate: true },
  );
  const youthUniformId = youthData?.uniformId ?? '';
  const [savingYouth, setSavingYouth] = useState(false);

  async function handleYouthChange(uniformId) {
    if (!uniformId) return;
    setSavingYouth(true);
    try {
      await updateYouthServiceUniform(uniformId);
      showSuccess('Se actualizó el uniforme del Servicio de jóvenes.');
      fetchYouth();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setSavingYouth(false);
    }
  }

  const noActiveUniforms = !uniformsLoading && !uniformsError && activeUniforms.length === 0;

  return (
    <div>
      <header className="page-header">
        <h1>Uniformes</h1>
        <p className="page-header__description">
          Define los uniformes disponibles y cuál corresponde a cada día de la semana (por ejemplo, todos los
          miércoles usan un uniforme y todos los domingos otro) y al Servicio de jóvenes.
        </p>
      </header>

      <div className="uniforms-manager__toolbar">
        <Button onClick={openCreateModal}>Nuevo uniforme</Button>
      </div>

      {uniformsLoading ? <Spinner label="Cargando uniformes..." /> : null}

      {!uniformsLoading && uniformsError ? (
        <ErrorMessage message={uniformsError.message} onRetry={fetchUniforms} />
      ) : null}

      {!uniformsLoading && !uniformsError ? (
        <Table
          columns={columns}
          data={uniformList}
          caption="Uniformes configurados"
          emptyState={
            <EmptyState
              title="Todavía no hay uniformes configurados"
              description="Crea el primer uniforme con el botón «Nuevo uniforme»."
            />
          }
        />
      ) : null}

      <section className="uniforms-manager__config-section" aria-labelledby="weekday-config-heading">
        <h2 id="weekday-config-heading" className="uniforms-manager__config-title">
          Uniforme por día de semana
        </h2>
        <p className="uniforms-manager__config-description">
          Todos los turnos fijos de ese día de la semana usan este uniforme, hasta que vuelvas a generar el
          horario del mes.
        </p>

        {weekdayLoading ? <Spinner label="Cargando configuración..." /> : null}
        {!weekdayLoading && weekdayError ? (
          <ErrorMessage message={weekdayError.message} onRetry={fetchWeekday} />
        ) : null}

        {!weekdayLoading && !weekdayError ? (
          <div className="uniforms-manager__config-grid">
            {WEEKDAY_OPTIONS.map((option) => (
              <Field
                key={option.value}
                as="select"
                label={option.label}
                value={weekdayUniformId(option.value)}
                onChange={(event) => handleWeekdayChange(option.value, event.target.value)}
                disabled={noActiveUniforms || savingWeekday === option.value}
              >
                <option value="">{noActiveUniforms ? 'No hay uniformes activos' : 'Sin configurar'}</option>
                {activeUniforms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Field>
            ))}
          </div>
        ) : null}
      </section>

      <section className="uniforms-manager__config-section" aria-labelledby="youth-config-heading">
        <h2 id="youth-config-heading" className="uniforms-manager__config-title">
          Uniforme del Servicio de jóvenes
        </h2>
        <p className="uniforms-manager__config-description">
          Se usa en el turno del último sábado del mes, cuando el mes tiene equipo de jóvenes.
        </p>

        {youthLoading ? <Spinner label="Cargando configuración..." /> : null}
        {!youthLoading && youthError ? <ErrorMessage message={youthError.message} onRetry={fetchYouth} /> : null}

        {!youthLoading && !youthError ? (
          <div className="uniforms-manager__config-grid">
            <Field
              as="select"
              label="Servicio de jóvenes"
              value={youthUniformId}
              onChange={(event) => handleYouthChange(event.target.value)}
              disabled={noActiveUniforms || savingYouth}
            >
              <option value="">{noActiveUniforms ? 'No hay uniformes activos' : 'Sin configurar'}</option>
              {activeUniforms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Field>
          </div>
        ) : null}
      </section>

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
          <Field
            label="Color"
            type="color"
            hint="Opcional. Se usa como referencia visual del uniforme."
            value={uniformForm.colorHex || '#1d4ed8'}
            onChange={(event) => updateFormField('colorHex', event.target.value)}
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
