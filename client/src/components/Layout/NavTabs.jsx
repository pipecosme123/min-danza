import { NavLink } from 'react-router-dom';
import './NavTabs.css';

const ADMIN_SECTIONS = [
  { to: '/admin/personas', label: 'Personas' },
  { to: '/admin/equipos', label: 'Equipos' },
  { to: '/admin/eventos', label: 'Eventos' },
  { to: '/admin/sabado-especial', label: 'Sábado especial' },
  { to: '/admin/uniformes', label: 'Uniformes' },
];

/**
 * Navegación principal del panel de administración. Usa `NavLink` de
 * react-router para que la sección activa quede marcada automáticamente
 * (estado del sistema visible) y sea navegable por teclado como cualquier
 * enlace.
 */
export function NavTabs() {
  return (
    <nav className="nav-tabs" aria-label="Secciones del panel de administración">
      <ul className="nav-tabs__list">
        {ADMIN_SECTIONS.map((section) => (
          <li key={section.to}>
            <NavLink
              to={section.to}
              className={({ isActive }) => `nav-tabs__link${isActive ? ' nav-tabs__link--active' : ''}`}
            >
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
