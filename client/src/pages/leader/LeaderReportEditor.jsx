import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getLeaderReport,
  saveLeaderReport,
  submitLeaderReport,
  reopenLeaderReport,
  getLeaderWhatsappText,
  searchLeaderPeople,
} from '../../api/leader.js';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { ErrorMessage } from '../../components/ui/ErrorMessage.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { AttendanceReportForm } from '../../components/domain/AttendanceReportForm.jsx';
import { useToast } from '../../hooks/useToast.js';
import { describeApiError } from '../../utils/apiError.js';
import { shareReportByWhatsapp } from './whatsappShare.js';
import {
  formatSlotWhen,
  formatDateTimeShort,
  WINDOW_LABEL,
  WINDOW_BADGE_VARIANT,
  REPORT_STATUS_LABEL,
} from './leaderFormat.js';
import './leader.css';

export function LeaderReportEditor() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();

  const [report, setReport] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busyAction, setBusyAction] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [reportData, peopleData] = await Promise.all([
        getLeaderReport(reportId),
        searchLeaderPeople(''),
      ]);
      setReport(reportData);
      setPeople(peopleData.people ?? []);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    document.title = 'Reporte de asistencia — Portal de líderes';
  }, []);

  async function handleSave(body) {
    setSaving(true);
    try {
      const updated = await saveLeaderReport(reportId, body);
      setReport(updated);
      showSuccess('Borrador guardado.');
    } catch (err) {
      showError(describeApiError(err).message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setConfirmSubmit(false);
    setBusyAction('submit');
    try {
      const updated = await submitLeaderReport(reportId);
      setReport(updated);
      showSuccess('Reporte enviado al administrador.');
    } catch (err) {
      const info = describeApiError(err);
      if (info.code === 'REPORTE_INCOMPLETO') {
        const names = (info.details?.pending ?? []).map((p) => p.fullName).join(', ');
        showError(`Faltan integrantes por marcar: ${names}`);
      } else {
        showError(info.message);
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReopen() {
    setBusyAction('reopen');
    try {
      const updated = await reopenLeaderReport(reportId);
      setReport(updated);
      showSuccess('El reporte volvió a borrador.');
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleShare() {
    setBusyAction('share');
    try {
      const { text } = await getLeaderWhatsappText(reportId);
      await shareReportByWhatsapp(text, showSuccess);
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) return <Spinner label="Cargando el reporte..." />;
  if (loadError) {
    return <ErrorMessage message={describeApiError(loadError).message} onRetry={load} />;
  }

  const { report: meta, slot, team, window, permissions } = report;
  const windowClosed = window.state === 'CERRADA';

  return (
    <div className="leader-report">
      <button type="button" className="leader-report__back" onClick={() => navigate('/lider')}>
        ← Volver a mis servicios
      </button>

      <header className="leader-report__header">
        <div>
          <h1>{slot.label}</h1>
          <p className="leader-report__when">{formatSlotWhen(slot)}</p>
          <p className="leader-report__team">{team.displayLabel}</p>
        </div>
        <div className="leader-report__badges">
          <Badge variant={meta.status === 'SUBMITTED' ? 'success' : 'warning'}>
            {REPORT_STATUS_LABEL[meta.status]}
          </Badge>
          <Badge variant={WINDOW_BADGE_VARIANT[window.state]}>{WINDOW_LABEL[window.state]}</Badge>
          {window.state === 'ABIERTA' ? (
            <span className="leader-report__deadline">
              Cierra el {formatDateTimeShort(window.closesAt)}
            </span>
          ) : null}
        </div>
      </header>

      {windowClosed ? (
        <p className="leader-report__closed-notice" role="status">
          La ventana de registro ya se cerró. No podés modificar este reporte; si necesitás corregir
          algo, pedile al administrador que lo reabra.
        </p>
      ) : null}

      <AttendanceReportForm
        key={`${meta.id}:${meta.status}`}
        report={report}
        people={people}
        readOnly={!permissions.canEdit}
        saving={saving}
        onSave={handleSave}
      />

      <div className="leader-report__footer-actions">
        {permissions.canSubmit ? (
          <Button
            onClick={() => setConfirmSubmit(true)}
            loading={busyAction === 'submit'}
            disabled={saving}
          >
            Enviar al administrador
          </Button>
        ) : null}
        {permissions.canReopen ? (
          <Button variant="secondary" onClick={handleReopen} loading={busyAction === 'reopen'}>
            Volver a borrador
          </Button>
        ) : null}
        {meta.status === 'SUBMITTED' ? (
          <Button variant="secondary" onClick={handleShare} loading={busyAction === 'share'}>
            Compartir por WhatsApp
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        onConfirm={handleSubmit}
        title="Enviar el reporte"
        confirmLabel="Enviar"
        loading={busyAction === 'submit'}
        description="Al enviarlo, el administrador podrá verlo. Vas a poder volver a editarlo mientras la ventana siga abierta."
      />
    </div>
  );
}
