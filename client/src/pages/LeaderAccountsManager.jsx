import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listLeaderAccounts,
  createLeaderAccount,
  updateLeaderAccount,
  resetLeaderPassword,
} from '../api/leaderAccounts.js';
import { getAttendancePeople } from '../api/attendance.js';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { SearchableSelect } from '../components/ui/SearchableSelect.jsx';
import { useToast } from '../hooks/useToast.js';
import { describeApiError } from '../utils/apiError.js';
import { formatMonthYear } from '../utils/dates.js';
import { formatDateTimeShort } from './leader/leaderFormat.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import './leader/leader.css';

export function LeaderAccountsManager() {
  const { showError, showSuccess } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newPersonId, setNewPersonId] = useState('');
  const [creating, setCreating] = useState(false);
  const [tempCredential, setTempCredential] = useState(null); // { fullName, username, tempPassword }
  const [editing, setEditing] = useState(null); // { id, username }
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accData, peopleData] = await Promise.all([listLeaderAccounts(), getAttendancePeople()]);
      setAccounts(accData.accounts ?? []);
      setPeople(peopleData.people ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const peopleWithoutAccount = useMemo(() => {
    const taken = new Set(accounts.map((a) => a.personId));
    return people.filter((p) => !taken.has(p.id)).map((p) => ({ value: p.id, label: p.fullName }));
  }, [accounts, people]);

  async function handleCreate() {
    if (!newPersonId) return;
    setCreating(true);
    try {
      const result = await createLeaderAccount(newPersonId);
      setTempCredential({
        fullName: result.account.fullName,
        username: result.account.username,
        tempPassword: result.tempPassword,
      });
      setNewPersonId('');
      showSuccess('Cuenta creada.');
      await load();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(account) {
    setBusyId(account.id);
    try {
      await updateLeaderAccount(account.id, { active: !account.active });
      showSuccess(account.active ? 'Cuenta desactivada.' : 'Cuenta reactivada.');
      await load();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReset(account) {
    setBusyId(account.id);
    try {
      const { tempPassword } = await resetLeaderPassword(account.id);
      setTempCredential({ fullName: account.fullName, username: account.username, tempPassword });
      showSuccess('Se generó una contraseña temporal nueva.');
      await load();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveUsername() {
    setSavingEdit(true);
    try {
      await updateLeaderAccount(editing.id, { username: editing.username.trim() });
      setEditing(null);
      showSuccess('Usuario actualizado.');
      await load();
    } catch (err) {
      showError(describeApiError(err).message);
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) return <Spinner label="Cargando accesos..." />;
  if (error) return <ErrorMessage message={describeApiError(error).message} onRetry={load} />;

  return (
    <div>
      <PageHeader
        title="Accesos de líderes"
        description="Cada líder recibe una cuenta al finalizar el mes. Acá podés crear una cuenta a mano, reiniciar una contraseña olvidada o desactivar un acceso."
      />

      <div className="leader-accounts__toolbar">
        <SearchableSelect
          label="Crear cuenta para una persona"
          options={peopleWithoutAccount}
          value={newPersonId}
          onChange={setNewPersonId}
          placeholder="Buscá a la persona..."
          clearLabel="— sin elegir —"
        />
        <Button onClick={handleCreate} loading={creating} disabled={!newPersonId}>
          Crear cuenta
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="Todavía no hay cuentas de líder"
          description="Se crean solas al finalizar un mes, o podés crear una a mano arriba."
        />
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Usuario</th>
                <th scope="col">Estado</th>
                <th scope="col">Último ingreso</th>
                <th scope="col">Meses como líder</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.fullName}
                    {!a.personActive ? <Badge variant="warning">Persona inactiva</Badge> : null}
                  </td>
                  <td>
                    <code>{a.username}</code>
                  </td>
                  <td>
                    {a.active ? (
                      <Badge variant="success">Activa</Badge>
                    ) : (
                      <Badge variant="neutral">Inactiva</Badge>
                    )}
                    {a.mustChangePassword ? (
                      <span className="attendance-cell__sub">Contraseña temporal sin cambiar</span>
                    ) : null}
                  </td>
                  <td>{a.lastLoginAt ? formatDateTimeShort(a.lastLoginAt) : 'Nunca'}</td>
                  <td>
                    {(a.ledMonths ?? []).length === 0
                      ? '—'
                      : a.ledMonths.map((m) => formatMonthYear(m.year, m.month)).join(', ')}
                  </td>
                  <td className="leader-accounts__row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ id: a.id, username: a.username })}
                    >
                      Editar usuario
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReset(a)}
                      loading={busyId === a.id}
                    >
                      Reiniciar contraseña
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggleActive(a)}
                      loading={busyId === a.id}
                    >
                      {a.active ? 'Desactivar' : 'Reactivar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TempCredentialModal credential={tempCredential} onClose={() => setTempCredential(null)} />

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Editar usuario"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={savingEdit}>
              Cancelar
            </Button>
            <Button onClick={handleSaveUsername} loading={savingEdit}>
              Guardar
            </Button>
          </>
        }
      >
        <Field
          label="Usuario"
          value={editing?.username ?? ''}
          hint="3 a 40 caracteres: letras, dígitos, punto, guion y guion bajo."
          onChange={(e) => setEditing((prev) => ({ ...prev, username: e.target.value }))}
        />
      </Modal>
    </div>
  );
}

/**
 * Modal que muestra una contraseña temporal recién generada. Se muestra una
 * sola vez: al cerrarlo ya no hay forma de volver a verla (hay que reiniciar).
 */
export function TempCredentialModal({ credential, onClose }) {
  const { showSuccess } = useToast();
  if (!credential) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `Usuario: ${credential.username}\nContraseña temporal: ${credential.tempPassword}`,
      );
      showSuccess('Copiado al portapapeles.');
    } catch {
      /* sin portapapeles: el admin la copia a mano */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Contraseña temporal"
      footer={
        <>
          <Button variant="secondary" onClick={copy}>
            Copiar
          </Button>
          <Button onClick={onClose}>Listo</Button>
        </>
      }
    >
      <p>
        Entregale estos datos a <strong>{credential.fullName}</strong>. La contraseña temporal{' '}
        <strong>no se vuelve a mostrar</strong>: si se pierde, hay que reiniciarla.
      </p>
      <table className="temp-credentials-table">
        <tbody>
          <tr>
            <th scope="row">Usuario</th>
            <td>
              <code>{credential.username}</code>
            </td>
          </tr>
          <tr>
            <th scope="row">Contraseña temporal</th>
            <td>
              <code>{credential.tempPassword}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
