import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLeaderAuth } from '../../context/LeaderAuthContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import { AppHeader } from '../../components/Layout/AppHeader.jsx';
import { PublicTabBar } from '../../components/Layout/PublicTabBar.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ErrorMessage } from '../../components/ui/ErrorMessage.jsx';
import './leader.css';

/**
 * Acceso al portal de líderes (Fase 9). Distinto del acceso de administrador:
 * las credenciales las genera el sistema al finalizar el mes y las comunica el
 * admin. En el primer ingreso el líder define su contraseña definitiva.
 */
export function LeaderLogin() {
  const { login } = useLeaderAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { execute, loading, error } = useApi(login);

  const redirectTo = location.state?.from?.pathname || '/lider';

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      const result = await execute(username.trim(), password);
      navigate(result.mustChangePassword ? '/lider/clave' : redirectTo, { replace: true });
    } catch {
      // El error queda visible en `error`.
    }
  }

  return (
    <div className="has-public-tab-bar">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>
      <AppHeader />

      <main id="main-content" className="container container--narrow page-section">
        <header className="page-header">
          <h1>Acceso líderes de equipo</h1>
          <p className="page-header__description">
            Ingresa con el usuario y la contraseña que te dio el administrador para registrar la
            asistencia de tu equipo en cada servicio.
          </p>
        </header>

        <form onSubmit={handleSubmit} noValidate className="leader-auth-card">
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
      <PublicTabBar active="lider" />
    </div>
  );
}
