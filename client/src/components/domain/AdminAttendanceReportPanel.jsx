import { useCallback, useEffect, useState } from 'react';
import {
  getAttendanceReport,
  editAttendanceReport,
  reopenAttendanceReport,
  getAttendanceWhatsappText,
  getAttendancePeople,
} from '../../api/attendance.js';
import { Spinner } from '../ui/Spinner.jsx';
import { ErrorMessage } from '../ui/ErrorMessage.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx';
import { AttendanceReportForm } from './AttendanceReportForm.jsx';
import { useToast } from '../../hooks/useToast.js';
import { describeApiError } from '../../utils/apiError.js';
import { shareReportByWhatsapp } from '../../pages/leader/whatsappShare.js';
import { formatSlotWhen } from '../../pages/leader/leaderFormat.js';

/**
 * Panel del admin para un reporte de asistencia ENVIADO: ver, editar y
 * reabrir a borrador. Contrato §5.3.
 *
 * @param {{ reportId: string, onBack: () => void, onChanged: () => void }} props
 */
export function AdminAttendanceReportPanel({ reportId, onBack, onChanged }) {
  const { showError, showSuccess } = useToast();
  const [report, setReport] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportData, peopleData] = await Promise.all([
        getAttendanceReport(reportId),
        getAttendancePeople(),
      ]);
      setReport(reportData);
      setPeople(peopleData.people ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(body) {
    setSaving(true);
    try {
      const updated = await editAttendanceReport(reportId, body);
      setReport(updated);
      setEditing(false);
      showSuccess('Reporte actualizado.');
      onChanged?.();
    } catch (err) {
      showError(describeApiError(err).message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen() {
    setConfirmReopen(false);
    setBusy('reopen');
    try {
      await reopenAttendanceReport(reportId);
      showSuccess('El reporte volvió a borrador; el líder puede corregirlo.');
      onChanged?.();
      onBack();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    setBusy('share');
    try {
      const { text } = await getAttendanceWhatsappText(reportId);
      await shareReportByWhatsapp(text, showSuccess);
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Cargando el reporte..." />;
  if (error) return <ErrorMessage message={describeApiError(error).message} onRetry={load} />;

  const { slot, team, report: meta } = report;

  return (
    <div className="attendance-panel">
      <button type="button" className="attendance-panel__back" onClick={onBack}>
        ← Volver a la lista
      </button>

      <header className="leader-report__header">
        <div>
          <h2>{slot.label}</h2>
          <p className="leader-report__when">{formatSlotWhen(slot)}</p>
          <p className="leader-report__team">{team.displayLabel}</p>
        </div>
        <div className="leader-report__badges">
          <Badge variant="success">Enviado</Badge>
          {meta.lastEditedByAdmin ? <Badge variant="neutral">Editado por admin</Badge> : null}
        </div>
      </header>

      <AttendanceReportForm
        key={`${reportId}:${editing}`}
        report={report}
        people={people}
        readOnly={!editing}
        saving={saving}
        onSave={handleSave}
      />

      <div className="attendance-panel__actions">
        {!editing ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Editar contenido
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            Cancelar edición
          </Button>
        )}
        <Button variant="secondary" onClick={() => setConfirmReopen(true)} loading={busy === 'reopen'}>
          Reabrir a borrador
        </Button>
        <Button variant="secondary" onClick={handleShare} loading={busy === 'share'}>
          Compartir por WhatsApp
        </Button>
      </div>

      <ConfirmDialog
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        onConfirm={handleReopen}
        title="Reabrir el reporte"
        confirmLabel="Reabrir"
        loading={busy === 'reopen'}
        description="El reporte vuelve a borrador y el líder podrá editarlo de nuevo, incluso si la ventana ya se cerró. Vas a dejar de ver su contenido hasta que lo reenvíe."
      />
    </div>
  );
}
