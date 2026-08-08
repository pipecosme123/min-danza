import { Badge } from '../ui/Badge.jsx';
import { Table } from '../ui/Table.jsx';
import './ImportReport.css';

/**
 * Muestra el resultado de `POST /api/people/import` en lenguaje llano:
 * un resumen con los totales y el detalle de las filas que fallaron o se
 * omitieron (nunca el JSON crudo — el admin promedio no debe interpretar
 * códigos, solo leer mensajes). Ver `docs/architecture/phase2-people-contract.md` §P15.
 *
 * @param {{ result: {
 *   fileName: string,
 *   summary: { totalRows: number, created: number, updated: number, skipped: number, failed: number, blankRowsIgnored: number, ignoredColumns: string[] },
 *   skipped: Array<{ row: number, code: string, message: string }>,
 *   errors: Array<{ row: number, column: string|null, value: unknown, code: string, message: string }>,
 *   truncated: boolean,
 * } }} props
 */
export function ImportReport({ result }) {
  const { fileName, summary, skipped, errors, truncated } = result;

  return (
    <div className="import-report">
      <p className="import-report__file">
        Archivo procesado: <strong>{fileName}</strong>
      </p>

      <ul className="import-report__summary" aria-label="Resumen de la importación">
        <li>
          <Badge variant="success">{summary.created} creadas</Badge>
        </li>
        <li>
          <Badge variant="primary">{summary.updated} actualizadas</Badge>
        </li>
        <li>
          <Badge variant="warning">{summary.skipped} omitidas</Badge>
        </li>
        <li>
          <Badge variant="danger">{summary.failed} con error</Badge>
        </li>
        <li>
          <Badge variant="neutral">{summary.blankRowsIgnored} filas vacías ignoradas</Badge>
        </li>
      </ul>

      {summary.ignoredColumns.length > 0 ? (
        <p className="import-report__note">
          Estas columnas del archivo no se reconocieron y se ignoraron: {summary.ignoredColumns.join(', ')}. Revisa
          si tienen un error de escritura.
        </p>
      ) : null}

      {truncated ? (
        <p className="import-report__note" role="status">
          El detalle de abajo muestra como máximo 200 filas por lista. Los totales del resumen sí son exactos.
        </p>
      ) : null}

      {errors.length > 0 ? (
        <section className="import-report__section">
          <h3>Filas con error ({summary.failed})</h3>
          <p className="import-report__hint">Estas filas no se importaron. Corrígelas en el archivo y vuelve a intentarlo.</p>
          <Table
            caption="Detalle de filas con error"
            columns={[
              { key: 'row', header: 'Fila' },
              { key: 'column', header: 'Columna', render: (r) => r.column || '—' },
              { key: 'message', header: 'Motivo' },
            ]}
            data={errors}
            getRowKey={(row, index) => `${row.row}-${index}`}
          />
        </section>
      ) : null}

      {skipped.length > 0 ? (
        <section className="import-report__section">
          <h3>Filas omitidas ({summary.skipped})</h3>
          <p className="import-report__hint">
            Estas filas no se crearon ni se modificaron porque ya existía la persona o no había cambios.
          </p>
          <Table
            caption="Detalle de filas omitidas"
            columns={[
              { key: 'row', header: 'Fila' },
              { key: 'message', header: 'Motivo' },
            ]}
            data={skipped}
            getRowKey={(row, index) => `${row.row}-${index}`}
          />
        </section>
      ) : null}
    </div>
  );
}
