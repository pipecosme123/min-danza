import { useEffect, useState } from 'react';
import { listVerses, addVerse, deleteVerse } from '../../api/verses.js';
import { describeApiError } from '../../utils/apiError.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../hooks/useToast.js';
import { Button } from '../ui/Button.jsx';
import { Spinner } from '../ui/Spinner.jsx';
import { ErrorMessage } from '../ui/ErrorMessage.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx';
import { Field } from '../ui/Field.jsx';
import './MonthVersesSection.css';

const EMPTY_FORM = { book: '', chapter: '', verses: '' };

/**
 * Traduce los códigos de error de `bibleSource.service.js` (backend) a
 * lenguaje llano: referencia inexistente vs. fuente externa no disponible.
 * Contrato: plan `wise-noodling-hickey.md` Parte 4.
 */
function describeVerseError(info) {
  if (info.code === 'VERSICULO_NO_ENCONTRADO') {
    return 'No encontramos esa referencia bíblica. Revisa el libro, el capítulo y los versículos.';
  }
  if (info.code === 'FUENTE_BIBLICA_NO_DISPONIBLE') {
    return 'No se pudo consultar el texto bíblico en este momento. Intenta de nuevo en unos minutos.';
  }
  if (info.code === 'MES_FINALIZADO' || info.code === 'MES_PASADO') {
    return 'Este mes ya no admite cambios.';
  }
  return info.message;
}

/**
 * Sección "Versículo del mes": uno o más pasajes (mismo libro/capítulo,
 * versión fija Reina Valera 1960) que se muestran en la página pública junto
 * al mes publicado. El texto se resuelve una sola vez, al agregarlo (el
 * backend hace scraping a BibleGateway), y queda guardado — esta pantalla
 * solo agrega/elimina referencias, nunca vuelve a pedir el texto por su
 * cuenta. Editable con el mismo criterio que el resto de `EventsManager`
 * (mientras el mes no haya pasado ya finalizado). Contrato: plan
 * `wise-noodling-hickey.md` Parte 4.
 *
 * @param {{ monthId: string, disabled: boolean }} props
 */
export function MonthVersesSection({ monthId, disabled }) {
  const { showSuccess, showError } = useToast();

  const { data, loading, error, execute: fetchVerses } = useApi(listVerses);

  useEffect(() => {
    if (monthId) fetchVerses(monthId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthId]);

  const verses = data?.verses ?? [];

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError(null);
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!monthId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await addVerse(monthId, {
        book: form.book.trim(),
        chapter: Number(form.chapter),
        verses: form.verses.trim(),
      });
      showSuccess('Se agregó el versículo del mes.');
      setForm(EMPTY_FORM);
      fetchVerses(monthId);
    } catch (err) {
      setFormError(describeVerseError(describeApiError(err)));
    } finally {
      setSubmitting(false);
    }
  }

  const formInvalid = !form.book.trim() || !form.chapter.trim() || !form.verses.trim();

  const [deleteTarget, setDeleteTarget] = useState(null); // verse | null
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteVerse(deleteTarget.id);
      showSuccess('Se eliminó el versículo.');
      setDeleteTarget(null);
      fetchVerses(monthId);
    } catch (err) {
      showError(describeVerseError(describeApiError(err)));
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <section className="month-verses" aria-labelledby="month-verses-heading">
      <h3 id="month-verses-heading" className="events-manager__action-summary">
        Versículo del mes
      </h3>
      <p className="month-verses__hint">
        Se muestra en la página pública junto al horario de este mes, en Reina Valera 1960.
      </p>

      {loading ? <Spinner label="Cargando versículos..." /> : null}

      {!loading && error ? <ErrorMessage message={error.message} onRetry={() => fetchVerses(monthId)} /> : null}

      {!loading && !error && verses.length === 0 ? (
        <EmptyState
          title="Todavía no hay ningún versículo agregado"
          description="Agrega uno con el formulario de abajo: libro, capítulo y versículos."
        />
      ) : null}

      {!loading && !error && verses.length > 0 ? (
        <ul className="month-verses__list">
          {verses.map((verse) => (
            <li key={verse.id} className="month-verses__item">
              <blockquote className="month-verses__quote">
                <p className="month-verses__text">"{verse.text}"</p>
                <cite className="month-verses__reference">{verse.reference}</cite>
              </blockquote>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setDeleteTarget(verse)}
                disabled={disabled}
              >
                Eliminar
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="month-verses__form" onSubmit={submitForm} noValidate>
        <div className="month-verses__form-fields">
          <Field
            label="Libro"
            required
            placeholder="Ej. Juan"
            value={form.book}
            onChange={(event) => updateField('book', event.target.value)}
            disabled={disabled}
          />
          <Field
            label="Capítulo"
            type="number"
            min={1}
            required
            placeholder="Ej. 3"
            value={form.chapter}
            onChange={(event) => updateField('chapter', event.target.value)}
            disabled={disabled}
          />
          <Field
            label="Versículos"
            required
            placeholder="Ej. 16-18"
            hint="Un número solo o un rango, ej. «16» o «16-18»."
            value={form.verses}
            onChange={(event) => updateField('verses', event.target.value)}
            disabled={disabled}
          />
        </div>

        {formError ? <ErrorMessage message={formError} /> : null}

        <Button type="submit" loading={submitting} disabled={disabled || formInvalid}>
          Buscar y agregar
        </Button>
      </form>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Eliminar versículo"
        description={deleteTarget ? `Se eliminará "${deleteTarget.reference}" de este mes.` : ''}
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={deleteLoading}
      />
    </section>
  );
}
