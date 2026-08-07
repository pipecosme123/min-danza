import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Envuelve las rutas de `/admin/*`. Si no hay sesión, redirige a
 * `/admin/login` conservando la ruta original en `location.state.from`
 * para poder volver ahí después de iniciar sesión.
 */
export function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return children;
}
