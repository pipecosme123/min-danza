import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';

export function NotFound() {
  return (
    <main id="main-content" className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)', textAlign: 'center' }}>
      <h1>Página no encontrada</h1>
      <p>La dirección a la que intentaste ir no existe o cambió de lugar.</p>
      <Link to="/">
        <Button>Volver al inicio</Button>
      </Link>
    </main>
  );
}
