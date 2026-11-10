import { MemberList } from './MemberList.jsx';
import { Badge } from '../ui/Badge.jsx';
import './TeamCard.css';

/**
 * Tarjeta de un equipo mensual: nombre, cantidad de integrantes y su
 * detalle (líder/apoyo/ministros). La usan `TeamGenerator` (vista de
 * administración) y, en fases futuras, la página pública.
 *
 * @param {{
 *   team: { id: string, label: string, members: Array },
 *   actions?: React.ReactNode,
 *   className?: string,
 *   onlyShowLeaderRole?: boolean,
 *   highlightLabel?: string,
 * }} props
 *
 * `highlightLabel`: resalta la tarjeta con una etiqueta (ej. «Tu equipo» en
 * la página pública para la persona elegida).
 */
export function TeamCard({ team, actions, className = '', onlyShowLeaderRole = false, highlightLabel }) {
  const classes = ['team-card', highlightLabel ? 'team-card--highlight' : '', className].filter(Boolean).join(' ');
  return (
    <article className={classes}>
      {highlightLabel ? (
        <div className="team-card__highlight">
          <Badge variant="primary">{highlightLabel}</Badge>
        </div>
      ) : null}
      <header className="team-card__header">
        <h3 className="team-card__title">{team.label}</h3>
        <span className="team-card__count">
          {team.members.length} {team.members.length === 1 ? 'integrante' : 'integrantes'}
        </span>
      </header>

      <MemberList members={team.members} onlyShowLeaderRole={onlyShowLeaderRole} />

      {actions ? <div className="team-card__actions">{actions}</div> : null}
    </article>
  );
}
