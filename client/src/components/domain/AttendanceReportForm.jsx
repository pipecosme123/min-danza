import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '../ui/SearchableSelect.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import {
  ENTRY_STATUS_LABEL,
  COVERED_STATUSES,
  NOTE_VISIBLE_STATUSES,
  PRIMARY_STATUS_OPTIONS,
  EXCUSE_OPTIONS,
  primaryStatusOf,
} from '../../pages/leader/leaderFormat.js';
import './AttendanceReportForm.css';

let supportKeySeq = 0;

/**
 * Formulario del reporte de asistencia de un servicio. Lo comparten el portal
 * de líderes (editable mientras el reporte esté en borrador y la ventana
 * abierta) y la vista de admin (editable sobre un reporte ya enviado).
 *
 * @param {{
 *   report: object,            // payload serializado del backend
 *   people: Array<{id,fullName}>,
 *   readOnly?: boolean,
 *   saving?: boolean,
 *   onSave: (body: object) => Promise<void>,
 *   saveVariant?: 'primary'|'secondary', // el portal de líderes lo pasa en
 *     'secondary': "Guardar cambios" es un paso intermedio frente a "Enviar
 *     reporte", que es la acción importante y debe quedar como primary.
 *   onDraftChange?: (draft: { body: object, problems: string[] }) => void,
 *     // avisa el contenido actual en pantalla (sin guardar) cada vez que
 *     // cambia. El portal de líderes lo usa para que "Enviar reporte" guarde
 *     // primero lo que se ve -- incluido el "Asistió" por defecto, que hasta
 *     // entonces sólo existe acá y en la base sigue sin marcar.
 * }} props
 */
export function AttendanceReportForm({
  report,
  people,
  readOnly = false,
  saving = false,
  onSave,
  saveVariant = 'primary',
  onDraftChange,
}) {
  const teamMemberIds = useMemo(
    () => new Set(report.entries.filter((e) => !e.personYaNoEnEquipo).map((e) => e.personId)),
    [report.entries],
  );

  // Sin marcar (null) arranca en "Asistió": la mayoría del equipo asiste, así
  // el líder solo toca las excepciones. '' queda libre como estado interno
  // para "eligió No asistió pero todavía no dice si con o sin excusa".
  const [entries, setEntries] = useState(() =>
    report.entries.map((e) => ({
      personId: e.personId,
      fullName: e.fullName,
      role: e.role,
      personYaNoEnEquipo: e.personYaNoEnEquipo,
      status: e.status || 'ASISTIO',
      coveredByPersonId: e.coveredByPersonId ?? '',
      note: e.note ?? '',
    })),
  );
  const [supports, setSupports] = useState(() =>
    report.supports.map((s) => ({ _key: ++supportKeySeq, personId: s.personId, note: s.note ?? '' })),
  );
  const [generalNotes, setGeneralNotes] = useState(report.report.generalNotes ?? '');

  // Opciones para "cubrió" y "apoyo": personas del padrón que NO son
  // integrantes del equipo (el backend rechaza lo contrario).
  const externalPeopleOptions = useMemo(
    () =>
      people
        .filter((p) => !teamMemberIds.has(p.id))
        .map((p) => ({ value: p.id, label: p.fullName })),
    [people, teamMemberIds],
  );
  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.fullName])), [people]);

  function updateEntry(personId, patch) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.personId !== personId) return e;
        const next = { ...e, ...patch };
        if (patch.status !== undefined) {
          if (!COVERED_STATUSES.has(patch.status)) next.coveredByPersonId = '';
          if (!NOTE_VISIBLE_STATUSES.has(patch.status)) next.note = '';
        }
        return next;
      }),
    );
  }

  // Radio principal: Asistió / No asistió / Remplazo / Cambio.
  function setPrimaryStatus(personId, primary) {
    if (primary === 'NO_ASISTIO') {
      updateEntry(personId, { status: '' }); // pendiente: falta elegir con/sin excusa
    } else {
      updateEntry(personId, { status: primary });
    }
  }

  // Radio secundario, sólo visible cuando el primario es "No asistió".
  function setExcuseStatus(personId, excuseStatus) {
    updateEntry(personId, { status: excuseStatus });
  }

  function removeEntry(personId) {
    setEntries((prev) => prev.filter((e) => e.personId !== personId));
  }

  function addSupportRow() {
    setSupports((prev) => [...prev, { _key: ++supportKeySeq, personId: '', note: '' }]);
  }
  function updateSupport(key, patch) {
    setSupports((prev) => prev.map((s) => (s._key === key ? { ...s, ...patch } : s)));
  }
  function removeSupport(key) {
    setSupports((prev) => prev.filter((s) => s._key !== key));
  }

  const supportPeopleTaken = new Set(supports.map((s) => s.personId).filter(Boolean));

  function buildBody() {
    return {
      entries: entries.map((e) => ({
        personId: e.personId,
        status: e.status || null,
        coveredByPersonId: COVERED_STATUSES.has(e.status) ? e.coveredByPersonId || null : null,
        note: e.note.trim() || null,
      })),
      supports: supports
        .filter((s) => s.personId)
        .map((s) => ({ personId: s.personId, note: s.note.trim() || null })),
      generalNotes: generalNotes.trim() || null,
    };
  }

  // Validación local ligera para no mandar un guardado que el backend rechazará.
  const localProblems = [];
  for (const e of entries) {
    if (e.status === '') {
      localProblems.push(`Elegí si ${e.fullName} tiene excusa o no.`);
    }
    if (COVERED_STATUSES.has(e.status) && !e.coveredByPersonId) {
      localProblems.push(`Indicá quién cubrió a ${e.fullName}.`);
    }
  }
  const missingSupportPerson = supports.some((s) => !s.personId && s.note.trim());
  if (missingSupportPerson) localProblems.push('Elegí la persona de cada apoyo o quitá la fila.');

  async function handleSave() {
    if (localProblems.length > 0) return;
    await onSave(buildBody());
  }

  // Ref para no re-disparar el efecto si el padre pasa un callback nuevo en
  // cada render; sólo importa que cambie el contenido.
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const problemsKey = localProblems.join('\n');
  useEffect(() => {
    onDraftChangeRef.current?.({ body: buildBody(), problems: problemsKey ? problemsKey.split('\n') : [] });
    // buildBody lee exactamente estos tres estados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, supports, generalNotes, problemsKey]);

  const showActions = !readOnly;

  return (
    <div className="attendance-form">
      <section className="attendance-form__section">
        <h2 className="attendance-form__section-title">Integrantes del equipo</h2>
        <ul className="attendance-form__roster">
          {entries.map((e) => (
            <li key={e.personId} className="roster-row">
              <div className="roster-row__person">
                <span className="roster-row__name">{e.fullName}</span>
                {e.role === 'LEADER' ? <Badge variant="primary">Líder</Badge> : null}
                {e.personYaNoEnEquipo ? <Badge variant="warning">Ya no en el equipo</Badge> : null}
              </div>

              {readOnly ? (
                <div className="roster-row__readonly">
                  <span>{e.status ? ENTRY_STATUS_LABEL[e.status] : 'Sin marcar'}</span>
                  {COVERED_STATUSES.has(e.status) && e.coveredByPersonId ? (
                    <span className="roster-row__cover">
                      cubrió: {nameById.get(e.coveredByPersonId) ?? '—'}
                    </span>
                  ) : null}
                  {e.note ? <span className="roster-row__note-text">“{e.note}”</span> : null}
                </div>
              ) : (
                <div className="roster-row__controls">
                  {(() => {
                    const primary = primaryStatusOf(e.status);
                    return (
                      <>
                        <div
                          className="attendance-radio-group"
                          role="radiogroup"
                          aria-label={`Estado de ${e.fullName}`}
                        >
                          {PRIMARY_STATUS_OPTIONS.map((o) => (
                            <label key={o.value} className="attendance-radio">
                              <input
                                type="radio"
                                name={`status-${e.personId}`}
                                value={o.value}
                                checked={primary === o.value}
                                onChange={() => setPrimaryStatus(e.personId, o.value)}
                              />
                              {o.label}
                            </label>
                          ))}
                        </div>

                        {primary === 'NO_ASISTIO' ? (
                          <div
                            className="attendance-radio-group attendance-radio-group--sub"
                            role="radiogroup"
                            aria-label={`¿${e.fullName} tiene excusa?`}
                          >
                            {EXCUSE_OPTIONS.map((o) => (
                              <label key={o.value} className="attendance-radio">
                                <input
                                  type="radio"
                                  name={`excuse-${e.personId}`}
                                  value={o.value}
                                  checked={e.status === o.value}
                                  onChange={() => setExcuseStatus(e.personId, o.value)}
                                />
                                {o.label}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}

                  {COVERED_STATUSES.has(e.status) ? (
                    <div className="roster-row__cover-picker">
                      <SearchableSelect
                        label={`Quién cubrió a ${e.fullName}`}
                        options={externalPeopleOptions}
                        value={e.coveredByPersonId}
                        onChange={(v) => updateEntry(e.personId, { coveredByPersonId: v })}
                        placeholder="Buscá a la persona..."
                        clearLabel="— sin elegir —"
                      />
                    </div>
                  ) : null}

                  {NOTE_VISIBLE_STATUSES.has(e.status) ? (
                    <input
                      type="text"
                      className="field__control roster-row__note"
                      placeholder="Escribí la excusa"
                      aria-label={`Excusa de ${e.fullName}`}
                      maxLength={500}
                      value={e.note}
                      onChange={(ev) => updateEntry(e.personId, { note: ev.target.value })}
                    />
                  ) : null}

                  {e.personYaNoEnEquipo ? (
                    <button
                      type="button"
                      className="roster-row__remove"
                      onClick={() => removeEntry(e.personId)}
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="attendance-form__section">
        <h2 className="attendance-form__section-title">Apoyos</h2>
        <p className="attendance-form__hint">
          Personas ajenas al equipo que participaron por voluntad propia, sin cubrir a nadie.
        </p>
        {supports.length === 0 && readOnly ? (
          <p className="attendance-form__empty">Sin apoyos registrados.</p>
        ) : null}
        <ul className="attendance-form__supports">
          {supports.map((s) => (
            <li key={s._key} className="support-row">
              {readOnly ? (
                <span className="roster-row__name">{nameById.get(s.personId) ?? '—'}</span>
              ) : (
                <div className="support-row__picker">
                  <SearchableSelect
                    label="Persona de apoyo"
                    options={externalPeopleOptions.filter(
                      (o) => o.value === s.personId || !supportPeopleTaken.has(o.value),
                    )}
                    value={s.personId}
                    onChange={(v) => updateSupport(s._key, { personId: v })}
                    placeholder="Buscá a la persona..."
                    clearLabel="— sin elegir —"
                  />
                </div>
              )}
              {readOnly ? (
                s.note ? <span className="roster-row__note-text">“{s.note}”</span> : null
              ) : (
                <button
                  type="button"
                  className="roster-row__remove"
                  onClick={() => removeSupport(s._key)}
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly ? (
          <Button variant="ghost" size="sm" onClick={addSupportRow}>
            + Agregar apoyo
          </Button>
        ) : null}
      </section>

      <section className="attendance-form__section">
        <h2 className="attendance-form__section-title">Novedades y comentarios</h2>
        {readOnly ? (
          <p className="attendance-form__notes-readonly">
            {generalNotes ? generalNotes : 'Sin novedades.'}
          </p>
        ) : (
          <textarea
            className="field__control attendance-form__notes-input"
            rows={4}
            maxLength={4000}
            placeholder="Anotá cualquier novedad del servicio (opcional)."
            value={generalNotes}
            onChange={(ev) => setGeneralNotes(ev.target.value)}
          />
        )}
      </section>

      {showActions ? (
        <div className="attendance-form__actions">
          {localProblems.length > 0 ? (
            <ul className="attendance-form__problems" role="alert">
              {localProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <Button
            variant={saveVariant}
            onClick={handleSave}
            loading={saving}
            disabled={localProblems.length > 0}
          >
            Guardar cambios
          </Button>
        </div>
      ) : null}
    </div>
  );
}
