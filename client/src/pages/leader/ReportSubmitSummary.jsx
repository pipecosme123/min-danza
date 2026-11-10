import { Modal } from '../../components/ui/Modal.jsx';
import { Button } from '../../components/ui/Button.jsx';

/**
 * Resumen previo al envío de un reporte: muestra, agrupado, lo que el líder
 * marcó en pantalla (todavía sin guardar) para que confirme o vuelva a
 * modificar. `draft.body` es el mismo body que se manda a `saveLeaderReport`.
 *
 * @param {{
 *   open: boolean,
 *   draft: { body: { entries: Array<{personId,status,coveredByPersonId,note}>, supports: Array<{personId}>, generalNotes: string|null } } | null,
 *   entryNames: Map<string,string>,   // personId -> nombre, de los integrantes del reporte
 *   people: Array<{id,fullName}>,     // padrón, para nombrar coberturas y apoyos
 *   loading?: boolean,
 *   onConfirm: () => void,
 *   onClose: () => void,              // "Modificar": vuelve al formulario sin perder nada
 * }} props
 */
export function ReportSubmitSummary({ open, draft, entryNames, people, loading = false, onConfirm, onClose }) {
  if (!draft) return null;
  const peopleNames = new Map(people.map((p) => [p.id, p.fullName]));
  const nameOf = (id) => entryNames.get(id) ?? peopleNames.get(id) ?? 'Persona sin nombre';
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');

  const { entries, supports, generalNotes } = draft.body;
  const group = (status) =>
    entries
      .filter((e) => e.status === status)
      .map((e) => ({ ...e, name: nameOf(e.personId) }))
      .sort(byName);

  const attended = group('ASISTIO');
  const withExcuse = group('NO_ASISTIO_CON_EXCUSA');
  const withoutExcuse = group('NO_ASISTIO_SIN_EXCUSA');
  const replaced = group('REMPLAZADO');
  const swapped = group('CAMBIO');
  const supportNames = supports.map((s) => ({ name: nameOf(s.personId) })).sort(byName);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Revisá el reporte antes de enviarlo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Modificar
          </Button>
          <Button onClick={onConfirm} loading={loading}>
            Confirmar y enviar
          </Button>
        </>
      }
    >
      <div className="submit-summary">
        <ul className="submit-summary__tiles" aria-label="Totales">
          <li className="submit-summary__tile submit-summary__tile--ok">
            <b>{attended.length}</b> presentes
          </li>
          <li className="submit-summary__tile submit-summary__tile--no">
            <b>{withExcuse.length + withoutExcuse.length}</b> faltas
          </li>
          <li className="submit-summary__tile submit-summary__tile--sw">
            <b>{replaced.length + swapped.length}</b> remplazos y cambios
          </li>
        </ul>
        <SummaryGroup title="Asistieron" items={attended} empty="Nadie." />
        <SummaryGroup
          title="No asistieron con excusa"
          items={withExcuse}
          detail={(e) => (e.note ? `Excusa: ${e.note}` : null)}
        />
        <SummaryGroup title="No asistieron sin excusa" items={withoutExcuse} />
        <SummaryGroup
          title="Remplazos"
          items={replaced}
          detail={(e) => `Lo cubrió: ${nameOf(e.coveredByPersonId)}`}
        />
        <SummaryGroup
          title="Cambios"
          items={swapped}
          detail={(e) => `Lo cubrió: ${nameOf(e.coveredByPersonId)}`}
        />
        <SummaryGroup title="Apoyos" items={supportNames} />

        <section className="submit-summary__group">
          <h3 className="submit-summary__title">Novedades y comentarios</h3>
          <p className="submit-summary__notes">{generalNotes || 'Sin novedades.'}</p>
        </section>

        <p className="submit-summary__hint">
          Al enviarlo, el administrador podrá verlo. Vas a poder volver a editarlo mientras la
          ventana siga abierta.
        </p>
      </div>
    </Modal>
  );
}

/** Un grupo del resumen; sin `empty`, un grupo vacío no se muestra. */
function SummaryGroup({ title, items, detail, empty }) {
  if (items.length === 0 && !empty) return null;
  return (
    <section className="submit-summary__group">
      <h3 className="submit-summary__title">
        {title} <span className="submit-summary__count">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="submit-summary__empty">{empty}</p>
      ) : (
        <ul className="submit-summary__list">
          {items.map((it, i) => {
            const extra = detail ? detail(it) : null;
            return (
              <li key={`${it.name}-${i}`}>
                {it.name}
                {extra ? <span className="submit-summary__detail"> — {extra}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
