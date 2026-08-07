import { getUniforms } from '../api/uniforms.js';
import { useApi } from '../hooks/useApi.js';
import { Table } from '../components/ui/Table.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { UniformBadge } from '../components/domain/UniformBadge.jsx';

const COLUMNS = [
  {
    key: 'name',
    header: 'Uniforme',
    render: (row) => <UniformBadge name={row.name} colorHex={row.colorHex} />,
  },
  { key: 'description', header: 'Descripción', render: (row) => row.description || '—' },
];

export function UniformsManager() {
  const { data, loading, error, execute } = useApi(getUniforms, { immediate: true });

  return (
    <div>
      <header className="page-header">
        <h1>Uniformes</h1>
        <p className="page-header__description">
          Define los uniformes disponibles y cuál corresponde a cada día de la semana (por ejemplo, todos los
          miércoles usan un uniforme y todos los domingos otro).
        </p>
      </header>

      {loading ? <Spinner label="Cargando uniformes..." /> : null}

      {error ? (
        <ErrorMessage
          message="No se pudo cargar el listado de uniformes. Es esperado si el servidor todavía no está disponible."
          onRetry={execute}
        />
      ) : null}

      {!loading && !error ? (
        <Table
          columns={COLUMNS}
          data={data || []}
          caption="Uniformes configurados"
          emptyState={
            <EmptyState
              title="Todavía no hay uniformes configurados"
              description="Cuando el servidor esté disponible podrás crear uniformes y asignarlos a cada día de la semana."
            />
          }
        />
      ) : null}
    </div>
  );
}
