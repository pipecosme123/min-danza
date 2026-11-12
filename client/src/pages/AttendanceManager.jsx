import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useMonthSelector } from '../hooks/useMonthSelector.js';
import { getMonthAttendance } from '../api/attendance.js';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Field } from '../components/ui/Field.jsx';
import { AdminAttendanceReportPanel } from '../components/domain/AdminAttendanceReportPanel.jsx';
import { describeApiError } from '../utils/apiError.js';
import { formatMonthYear } from '../utils/dates.js';
import {
  formatSlotWhen,
  joinTeamLabels,
  ADMIN_STATUS_LABEL,
  ADMIN_STATUS_VARIANT,
  WINDOW_LABEL,
  WINDOW_BADGE_VARIANT,
} from './leader/leaderFormat.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import './leader/leader.css';

export function AttendanceManager() {
  const { months, monthsLoading, monthsError, selectedMonthId, setSelectedMonthId } =
    useMonthSelector();
  const { data, loading, error, execute } = useApi(getMonthAttendance);
  const [openReportId, setOpenReportId] = useState(null);

  useEffect(() => {
    if (selectedMonthId) {
      setOpenReportId(null);
      execute(selectedMonthId);
    }
  }, [selectedMonthId, execute]);

  if (monthsLoading) return <Spinner label="Cargando meses..." />;
  if (monthsError) {
    return <ErrorMessage message={describeApiError(monthsError).message} />;
  }
  if (months.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay meses"
        description="Creá y publicá un mes desde «Equipos» y «Horario y eventos» para registrar asistencia."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Asistencia"
        description="Estado de los reportes de cada líder. Podés ver el contenido de un reporte solo cuando el líder lo envió."
      />

      {!openReportId ? (
        <Field
          as="select"
          label="Mes"
          value={selectedMonthId}
          onChange={(e) => setSelectedMonthId(e.target.value)}
        >
          {months.map((m) => (
            <option key={m.id} value={m.id}>
              {formatMonthYear(m.year, m.month)}
              {m.status === 'FINALIZED' ? ' · Finalizado' : ' · Borrador'}
            </option>
          ))}
        </Field>
      ) : null}

      {openReportId ? (
        <AdminAttendanceReportPanel
          reportId={openReportId}
          onBack={() => setOpenReportId(null)}
          onChanged={() => execute(selectedMonthId)}
        />
      ) : loading ? (
        <Spinner label="Cargando asistencia..." />
      ) : error ? (
        <ErrorMessage
          message={describeApiError(error).message}
          onRetry={() => execute(selectedMonthId)}
        />
      ) : (
        <AttendanceMatrix items={data?.items ?? []} onOpen={setOpenReportId} />
      )}
    </div>
  );
}

function AttendanceMatrix({ items, onOpen }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Sin turnos para este mes"
        description="Generá el horario del mes para ver los reportes por turno y equipo."
      />
    );
  }

  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Turno</th>
            <th scope="col">Equipo</th>
            <th scope="col">Ventana</th>
            <th scope="col">Reporte</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.slotId}>
              <td>
                <span className="attendance-cell__title">{item.slot.label}</span>
                <span className="attendance-cell__sub">{formatSlotWhen(item.slot)}</span>
              </td>
              <td>
                {joinTeamLabels(item.teams)}
                {item.shared ? <span className="attendance-cell__sub"> (turno compartido)</span> : null}
              </td>
              <td>
                <Badge variant={WINDOW_BADGE_VARIANT[item.window.state]}>
                  {WINDOW_LABEL[item.window.state]}
                </Badge>
              </td>
              <td>
                <Badge variant={ADMIN_STATUS_VARIANT[item.status]}>
                  {ADMIN_STATUS_LABEL[item.status]}
                </Badge>
                {item.lastEditedByAdmin ? (
                  <span className="attendance-cell__sub">Editado por admin</span>
                ) : null}
              </td>
              <td>
                {item.status === 'ENVIADO' ? (
                  <Button size="sm" variant="secondary" onClick={() => onOpen(item.reportId)}>
                    Ver
                  </Button>
                ) : (
                  <span className="attendance-cell__sub">
                    {item.status === 'BORRADOR' ? 'El líder aún no lo envió' : '—'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
