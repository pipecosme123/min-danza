import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.js';
import { getLeaderServices, createReportDraft } from '../../api/leader.js';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { ErrorMessage } from '../../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { useToast } from '../../hooks/useToast.js';
import { describeApiError } from '../../utils/apiError.js';
import { formatMonthYear } from '../../utils/dates.js';
import {
  formatSlotWhen,
  formatDateTimeShort,
  joinTeamLabels,
  WINDOW_LABEL,
  WINDOW_BADGE_VARIANT,
  REPORT_STATUS_LABEL,
} from './leaderFormat.js';
import './leader.css';

/** Agrupa los servicios por "Mes AAAA" preservando el orden cronológico. */
function groupByMonth(services) {
  const groups = [];
  for (const svc of services) {
    const key = `${svc.month.year}-${svc.month.month}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: formatMonthYear(svc.month.year, svc.month.month), items: [] };
      groups.push(group);
    }
    group.items.push(svc);
  }
  return groups;
}

function actionFor(report) {
  if (!report) return { label: 'Registrar asistencia', kind: 'create' };
  if (report.status === 'DRAFT') return { label: 'Continuar', kind: 'open' };
  return { label: 'Ver reporte', kind: 'open' };
}

export function LeaderServices() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { data, loading, error, execute } = useApi(getLeaderServices, { immediate: true });
  const [busyKey, setBusyKey] = useState(null);

  useEffect(() => {
    document.title = 'Mis servicios — Portal de líderes';
  }, []);

  async function handleAction(svc) {
    const action = actionFor(svc.report);
    if (action.kind === 'open') {
      navigate(`/lider/reportes/${svc.report.id}`);
      return;
    }
    const key = `${svc.slotId}|${svc.teamId}`;
    setBusyKey(key);
    try {
      const result = await createReportDraft(svc.slotId, svc.teamId);
      navigate(`/lider/reportes/${result.report.id}`);
    } catch (err) {
      showError(describeApiError(err).message);
      execute();
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <Spinner label="Cargando tus servicios..." />;
  if (error) {
    return <ErrorMessage message={describeApiError(error).message} onRetry={() => execute()} />;
  }

  const services = data?.services ?? [];
  const groups = groupByMonth(services);

  return (
    <div className="leader-services">
      <header className="page-header">
        <h1>Mis servicios</h1>
        <p className="page-header__description">
          Estos son los turnos asignados a tu equipo. Podés registrar la asistencia desde una hora
          antes de cada servicio y hasta tres días después.
        </p>
      </header>

      {groups.length === 0 ? (
        <EmptyState
          title="No hay servicios para registrar"
          description="Cuando el administrador publique un mes con tu equipo, tus turnos aparecerán acá."
        />
      ) : (
        groups.map((group) => (
          <section key={group.key} className="leader-services__group">
            <h2 className="leader-services__month">{group.label}</h2>
            <ul className="leader-services__list">
              {group.items.map((svc) => {
                const key = `${svc.slotId}|${svc.teamId}`;
                const action = actionFor(svc.report);
                const canAct = svc.window.state === 'ABIERTA' || action.kind === 'open';
                return (
                  <li key={key} className="leader-service-card">
                    <div className="leader-service-card__main">
                      <p className="leader-service-card__title">{svc.slot.label}</p>
                      <p className="leader-service-card__when">{formatSlotWhen(svc.slot)}</p>
                      <p className="leader-service-card__team">{svc.team.displayLabel}</p>
                      {svc.shared ? (
                        <p className="leader-service-card__shared">
                          Turno compartido con{' '}
                          {joinTeamLabels(svc.teams.filter((t) => t.id !== svc.team.id))} — cualquiera de
                          los líderes puede completar el reporte.
                        </p>
                      ) : null}
                    </div>

                    <div className="leader-service-card__status">
                      <Badge variant={WINDOW_BADGE_VARIANT[svc.window.state]}>
                        {WINDOW_LABEL[svc.window.state]}
                      </Badge>
                      {svc.window.state === 'ABIERTA' ? (
                        <span className="leader-service-card__deadline">
                          Cierra el {formatDateTimeShort(svc.window.closesAt)}
                        </span>
                      ) : null}
                      {svc.window.state === 'PENDIENTE' ? (
                        <span className="leader-service-card__deadline">
                          Abre el {formatDateTimeShort(svc.window.opensAt)}
                        </span>
                      ) : null}
                      {svc.report ? (
                        <span className="leader-service-card__report">
                          Reporte: {REPORT_STATUS_LABEL[svc.report.status]}
                        </span>
                      ) : null}
                    </div>

                    <div className="leader-service-card__action">
                      <Button
                        variant={action.kind === 'create' ? 'primary' : 'secondary'}
                        size="sm"
                        disabled={!canAct}
                        loading={busyKey === key}
                        onClick={() => handleAction(svc)}
                      >
                        {action.label}
                      </Button>
                      {!canAct ? (
                        <span className="leader-service-card__hint">
                          {svc.window.state === 'PENDIENTE'
                            ? 'Todavía no abre'
                            : 'La ventana ya cerró'}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
