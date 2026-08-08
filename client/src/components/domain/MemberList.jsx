import { Badge } from '../ui/Badge.jsx';
import './MemberList.css';

/** Traduce el rol técnico (TeamRole) al lenguaje del dominio que ve el usuario. */
export const ROLE_LABELS = {
  LEADER: 'Líder',
  SUPPORT: 'Apoyo',
  COLLABORATOR: 'Ministro',
};

const ROLE_BADGE_VARIANTS = {
  LEADER: 'primary',
  SUPPORT: 'success',
  COLLABORATOR: 'neutral',
};

const ROLE_ORDER = { LEADER: 0, SUPPORT: 1, COLLABORATOR: 2 };

/**
 * Orden de presentación acordado con el usuario: el líder siempre primero,
 * y dentro de cada rol (apoyo, ministros) alfabético por nombre. No muta el
 * array recibido.
 *
 * @param {Array<{ fullName: string, role: string }>} members
 */
export function sortMembers(members) {
  return [...members].sort((a, b) => {
    const roleDiff = (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    return a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' });
  });
}

/**
 * Lista de integrantes de un equipo con su rol. Se usa dentro de `TeamCard`
 * y también podrá reutilizarse sola en vistas de detalle.
 *
 * @param {{ members: Array<{ id: string, fullName: string, role: 'LEADER'|'SUPPORT'|'COLLABORATOR' }> }} props
 */
export function MemberList({ members }) {
  if (!members || members.length === 0) {
    return <p className="member-list__empty">Este equipo todavía no tiene integrantes.</p>;
  }

  return (
    <ol className="member-list">
      {sortMembers(members).map((member, index) => (
        <li
          key={member.id}
          className={`member-list__item${member.role === 'LEADER' ? ' member-list__item--leader' : ''}`}
        >
          <span className="member-list__index" aria-hidden="true">
            {index + 1}.
          </span>
          <span className="member-list__name">{member.fullName}</span>
          <Badge variant={ROLE_BADGE_VARIANTS[member.role] || 'neutral'}>
            {ROLE_LABELS[member.role] || member.role}
          </Badge>
        </li>
      ))}
    </ol>
  );
}
