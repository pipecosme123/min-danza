import { Navigate, useLocation } from 'react-router-dom';
import { useLeaderAuth } from '../context/LeaderAuthContext.jsx';

/**
 * Envuelve las rutas de `/lider/*` que exigen sesión de líder. Sin sesión,
 * redirige a `/lider/login` conservando la ruta original.
 */
export function LeaderProtectedRoute({ children }) {
  const { isAuthenticated } = useLeaderAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/lider/login" state={{ from: location }} replace />;
  }
  return children;
}
