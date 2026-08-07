import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useApi } from '../hooks/useApi.js';
import { AppHeader } from '../components/Layout/AppHeader.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Button } from '../components/ui/Button.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';

export function AdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { execute, loading, error } = useApi(login);

  const redirectTo = location.state?.from?.pathname || '/admin';

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      await execute(username, password);
      navigate(redirectTo, { replace: true });
    } catch {
      // El error ya queda visible a través de `error` (estado de useApi).
    }
  }

  return (
    <div>
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader />

      <main id="main-content" className="container container--narrow page-section">
        <header className="page-header">
          <h1>Acceso administrador</h1>
          <p className="page-header__description">
            Ingresa con tu usuario y contraseña para gestionar personas, equipos, eventos y uniformes.
          </p>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="Usuario"
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <Field
            label="Contraseña"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error ? (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <ErrorMessage message={error.message} />
            </div>
          ) : null}

          <Button type="submit" loading={loading} fullWidth>
            Iniciar sesión
          </Button>
        </form>
      </main>
    </div>
  );
}
