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
 * @param {{
 *   members: Array<{ id: string, fullName: string, role: 'LEADER'|'SUPPORT'|'COLLABORATOR', isAdultoMayor?: boolean }>,
 *   onlyShowLeaderRole?: boolean,
 * }} props
 */
export function MemberList({ members, onlyShowLeaderRole = false }) {
  if (!members || members.length === 0) {
    return <p className="member-list__empty">Este equipo todavía no tiene integrantes.</p>;
  }

  return (
    <ol className="member-list">
      {sortMembers(members).map((member, index) => {
        // "Ministro" (rol COLLABORATOR) nunca se muestra como insignia --
        // decisión estética confirmada con el usuario: no aporta información
        // que no se pueda inferir (todo integrante sin insignia de Líder/Apoyo
        // es, por descarte, un ministro), y evita el ruido visual de dos
        // insignias por persona cuando además es adulto mayor.
        const showRoleBadge =
          member.role !== 'COLLABORATOR' && (!onlyShowLeaderRole || member.role === 'LEADER');
        // "Adulto mayor" es exclusivo de la vista de administración -- nunca
        // aparece en la página pública, ni siquiera para el líder (a
        // diferencia del rol, que el líder sí muestra ahí).
        const showAdultoMayor = !onlyShowLeaderRole && member.isAdultoMayor;
        return (
          <li
            key={member.id}
            className={`member-list__item${member.role === 'LEADER' ? ' member-list__item--leader' : ''}`}
          >
            <span className="member-list__index" aria-hidden="true">
              {index + 1}.
            </span>
            <span className="member-list__name">{member.fullName}</span>
            {showRoleBadge ? (
              <Badge variant={ROLE_BADGE_VARIANTS[member.role] || 'neutral'}>
                {ROLE_LABELS[member.role] || member.role}
              </Badge>
            ) : null}
            {showAdultoMayor ? <Badge variant="warning">Adulto mayor</Badge> : null}
          </li>
        );
      })}
    </ol>
  );
}
