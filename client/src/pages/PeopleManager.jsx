import { useState } from 'react';
import { getPeople } from '../api/people.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { Table } from '../components/ui/Table.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { FileUpload } from '../components/ui/FileUpload.jsx';

const CATEGORY_LABELS = {
  ELEGIBLE_LIDER: 'Elegible a líder',
  COLABORADOR: 'Colaborador',
};

const COLUMNS = [
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
];

export function PeopleManager() {
  const { data, loading, error, execute } = useApi(getPeople, { immediate: true });
  const { showInfo } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  function handleImportSubmit() {
    setImportOpen(false);
    setSelectedFile(null);
    showInfo('La carga masiva de personas estará disponible cuando el servidor esté conectado.');
  }

  return (
    <div>
      <header className="page-header">
        <h1>Personas</h1>
        <p className="page-header__description">
          Administra el padrón de personas elegibles para liderar y colaboradoras. Desde aquí se hará la carga
          masiva inicial por archivo y, más adelante, la edición individual.
        </p>
      </header>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Button onClick={() => setImportOpen(true)}>Importar personas</Button>
      </div>

      {loading ? <Spinner label="Cargando personas..." /> : null}

      {error ? (
        <ErrorMessage
          message="No se pudo cargar el listado de personas. Es esperado si el servidor todavía no está disponible."
          onRetry={execute}
        />
      ) : null}

      {!loading && !error ? (
        <Table
          columns={COLUMNS}
          data={data || []}
          caption="Listado de personas registradas"
          emptyState={
            <EmptyState
              title="Todavía no hay personas registradas"
              description="Usa el botón «Importar personas» para cargar el primer listado desde un archivo CSV o Excel."
            />
          }
        />
      ) : null}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar personas">
        <p>
          Selecciona un archivo CSV o Excel con las columnas nombre, documento (opcional) y categoría. Esta
          función se activará por completo cuando el servidor esté conectado.
        </p>
        <FileUpload
          label="Elegir archivo"
          accept=".csv,.xlsx"
          hint="Formatos admitidos: .csv, .xlsx"
          onFileSelected={setSelectedFile}
        />
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setImportOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleImportSubmit} disabled={!selectedFile}>
            Importar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
