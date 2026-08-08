import { MemberList } from './MemberList.jsx';
import './TeamCard.css';

/**
 * Tarjeta de un equipo mensual: nombre, cantidad de integrantes y su
 * detalle (líder/apoyo/ministros). La usan `TeamGenerator` (vista de
 * administración) y, en fases futuras, la página pública.
 *
 * @param {{ team: { id: string, label: string, members: Array }, actions?: React.ReactNode }} props
 */
export function TeamCard({ team, actions }) {
  return (
    <article className="team-card">
      <header className="team-card__header">
        <h3 className="team-card__title">{team.label}</h3>
        <span className="team-card__count">
          {team.members.length} {team.members.length === 1 ? 'integrante' : 'integrantes'}
        </span>
      </header>

      <MemberList members={team.members} />

      {actions ? <div className="team-card__actions">{actions}</div> : null}
    </article>
  );
}
