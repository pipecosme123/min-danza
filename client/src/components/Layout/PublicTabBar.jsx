import { Link } from 'react-router-dom';
import { CalendarIcon, HomeIcon, LeaderIcon, TeamsIcon } from './NavIcons.jsx';
import './PublicTabBar.css';

const TABS = [
  { key: 'inicio', to: '/', label: 'Inicio', Icon: HomeIcon },
  { key: 'horario', to: '/?vista=horario', label: 'Horario', Icon: CalendarIcon },
  { key: 'equipos', to: '/?vista=equipos', label: 'Equipos', Icon: TeamsIcon },
  { key: 'lider', to: '/lider', label: 'Líder', Icon: LeaderIcon },
];

/**
 * Barra de pestañas inferior de la parte pública en el teléfono (< 768px):
 * Inicio · Horario · Equipos · Líder, como en el mockup de la propuesta A.
 * Las tres primeras cambian la vista de la página pública vía `?vista=`
 * (decisión 2026-11-09, Fase 10 §9.1); «Líder» lleva al portal de líderes
 * (que pide iniciar sesión si hace falta). Desde 768px no se muestra: en
 * pantallas grandes la página pública se ve completa.
 *
 * @param {{ active: 'inicio'|'horario'|'equipos'|'lider' }} props
 */
export function PublicTabBar({ active }) {
  return (
    <nav className="public-tab-bar" aria-label="Secciones">
      <ul className="public-tab-bar__list">
        {TABS.map(({ key, to, label, Icon }) => (
          <li key={key}>
            <Link
              to={to}
              className={`public-tab-bar__link${active === key ? ' public-tab-bar__link--active' : ''}`}
              aria-current={active === key ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
