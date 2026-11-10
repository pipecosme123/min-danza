import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeaderAuth } from '../../context/LeaderAuthContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import { changeLeaderPassword } from '../../api/leader.js';
import { Field } from '../../components/ui/Field.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ErrorMessage } from '../../components/ui/ErrorMessage.jsx';
import { describeApiError } from '../../utils/apiError.js';

const MIN_LENGTH = 8;

/**
 * Cambio de contraseña del líder. Se muestra forzado en el primer ingreso
 * (`mustChangePassword`), pero también es accesible después desde aquí.
 */
export function LeaderChangePassword() {
  const { mustChangePassword, clearMustChangePassword } = useLeaderAuth();
  const navigate = useNavigate();
  const { execute, loading, error } = useApi(changeLeaderPassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError(null);
    if (newPassword.length < MIN_LENGTH) {
      setLocalError(`La contraseña nueva debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirm) {
      setLocalError('La confirmación no coincide con la contraseña nueva.');
      return;
    }
    try {
      await execute({ currentPassword, newPassword });
      clearMustChangePassword();
      navigate('/lider', { replace: true });
    } catch {
      // error queda en `error`
    }
  }

  const serverError = error ? describeApiError(error).message : null;

  return (
    <div className="container--narrow" style={{ marginInline: 'auto' }}>
      <header className="page-header">
        <h1>{mustChangePassword ? 'Definí tu contraseña' : 'Cambiar contraseña'}</h1>
        <p className="page-header__description">
          {mustChangePassword
            ? 'Estás usando una contraseña temporal. Elegí una contraseña propia para continuar.'
            : 'Elegí una contraseña nueva. La necesitarás la próxima vez que ingreses.'}
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="leader-auth-card">
        <Field
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <Field
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          required
          hint={`Mínimo ${MIN_LENGTH} caracteres.`}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <Field
          label="Repetí la contraseña nueva"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {localError || serverError ? (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <ErrorMessage message={localError || serverError} />
          </div>
        ) : null}

        <Button type="submit" loading={loading} fullWidth>
          Guardar contraseña
        </Button>
      </form>
    </div>
  );
}
