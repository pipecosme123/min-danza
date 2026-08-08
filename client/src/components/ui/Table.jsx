import './Table.css';

/**
 * Tabla genérica reutilizable (usada por PeopleManager, TeamGenerator,
 * EventsManager, UniformsManager, ...). Recibe la forma de los datos vía
 * `columns`, nunca conoce el dominio: así una misma `Table` sirve para
 * personas, equipos o eventos sin reescribirse (principio Open/Closed).
 *
 * @param {{
 *   columns: Array<{ key: string, header: string, render?: (row: any, index: number) => React.ReactNode }>,
 *   data: Array<any>,
 *   getRowKey?: (row: any, index: number) => string|number,
 *   caption?: string,
 *   emptyState?: React.ReactNode,
 * }} props
 */
export function Table({ columns, data, getRowKey = (row, index) => row.id ?? index, caption, emptyState }) {
  return (
    <div className="table-wrapper">
      <table className="table">
        {caption ? <caption className="table__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table__empty-cell">
                {emptyState}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr key={getRowKey(row, index)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render ? column.render(row, index) : row[column.key]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
