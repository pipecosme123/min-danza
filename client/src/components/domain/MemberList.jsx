import { Badge } from '../ui/Badge.jsx';
import './MemberList.css';

/** Traduce el rol técnico (TeamRole) al lenguaje del dominio que ve el usuario. */
export const ROLE_LABELS = {
  LEADER: 'Líder',
  SUPPORT: 'Apoyo',
  COLLABORATOR: 'Colaborador',
};

const ROLE_BADGE_VARIANTS = {
  LEADER: 'primary',
  SUPPORT: 'success',
  COLLABORATOR: 'neutral',
};

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
    <ul className="member-list">
      {members.map((member) => (
        <li key={member.id} className="member-list__item">
          <span className="member-list__name">{member.fullName}</span>
          <Badge variant={ROLE_BADGE_VARIANTS[member.role] || 'neutral'}>
            {ROLE_LABELS[member.role] || member.role}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
