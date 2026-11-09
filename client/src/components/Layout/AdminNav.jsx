import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Modal } from '../ui/Modal.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';
import {
  AttendanceIcon,
  CalendarIcon,
  KeyIcon,
  LogoutIcon,
  MoreIcon,
  PeopleIcon,
  TeamsIcon,
  UniformIcon,
} from './NavIcons.jsx';
import './AdminNav.css';

/**
 * `primary`: visibles en la barra inferior del teléfono. El resto solo se
 * ven en el menú lateral de escritorio; en el teléfono se llega a ellas
 * desde «Más» (igual que en el mockup de la propuesta A).
 */
const ADMIN_SECTIONS = [
  { to: '/admin/personas', label: 'Personas', Icon: PeopleIcon, primary: true },
  { to: '/admin/equipos', label: 'Equipos', Icon: TeamsIcon, primary: true },
  { to: '/admin/eventos', label: 'Eventos', Icon: CalendarIcon, primary: true },
  { to: '/admin/uniformes', label: 'Uniformes', Icon: UniformIcon, primary: true },
  { to: '/admin/asistencia', label: 'Asistencia', Icon: AttendanceIcon, primary: false },
  { to: '/admin/accesos', label: 'Accesos', Icon: KeyIcon, primary: false },
];

const SECONDARY_SECTIONS = ADMIN_SECTIONS.filter((section) => !section.primary);

/**
 * Navegación del panel de administración. Es UN solo `<nav>` cuya
 * disposición cambia por CSS: barra de pestañas flotante abajo (< 1024px)
 * o menú lateral (>= 1024px). Así no se duplican los enlaces para lectores
 * de pantalla ni para las pruebas.
 *
 * «Más» (solo teléfono/tablet) abre una hoja con las secciones secundarias,
 * el cambio de tema y cerrar sesión.
 *
 * @param {{ onLogout: () => void }} props
 */
export function AdminNav({ onLogout }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const inSecondarySection = SECONDARY_SECTIONS.some((section) =>
    location.pathname.startsWith(section.to),
  );

  return (
    <>
      <nav className="admin-nav" aria-label="Secciones del panel de administración">
        <ul className="admin-nav__list">
          {ADMIN_SECTIONS.map(({ to, label, Icon, primary }) => (
            <li key={to} className={primary ? undefined : 'admin-nav__item--secondary'}>
              <NavLink
                to={to}
                className={({ isActive }) => `admin-nav__link${isActive ? ' admin-nav__link--active' : ''}`}
              >
                <Icon />
                <span className="admin-nav__label">{label}</span>
              </NavLink>
            </li>
          ))}
          <li className="admin-nav__item--more">
            <button
              type="button"
              className={`admin-nav__link${inSecondarySection ? ' admin-nav__link--active' : ''}`}
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
            >
              <MoreIcon />
              <span className="admin-nav__label">Más</span>
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Más opciones">
        <ul className="admin-nav-more">
          {SECONDARY_SECTIONS.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `admin-nav-more__item${isActive ? ' admin-nav-more__item--active' : ''}`
                }
                onClick={() => setMoreOpen(false)}
              >
                <Icon />
                {label}
              </NavLink>
            </li>
          ))}
          <li className="admin-nav-more__theme">
            <ThemeToggle />
          </li>
          <li>
            <button
              type="button"
              className="admin-nav-more__item admin-nav-more__item--danger"
              onClick={() => {
                setMoreOpen(false);
                onLogout();
              }}
            >
              <LogoutIcon />
              Cerrar sesión
            </button>
          </li>
        </ul>
      </Modal>
    </>
  );
}
