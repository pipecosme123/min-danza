import { Badge } from '../ui/Badge.jsx';
import './BalanceSummary.css';

/**
 * Muestra cuántas participaciones (turnos fijos + eventos extraordinarios)
 * acumula cada equipo en el mes, para que el administrador vea de un
 * vistazo si el balance está parejo. El evento especial del último sábado
 * NUNCA debe incluirse en `teams[].count` (regla de negocio).
 *
 * @param {{ teams: Array<{ id: string, label: string, count: number }> }} props
 */
export function BalanceSummary({ teams }) {
  if (!teams || teams.length === 0) return null;

  const counts = teams.map((team) => team.count);
  const maxCount = Math.max(...counts, 1);
  const spread = Math.max(...counts) - Math.min(...counts);

  return (
    <div className="balance-summary">
      <div className="balance-summary__header">
        <h3 className="balance-summary__title">Balance de participaciones</h3>
        <Badge variant={spread <= 1 ? 'success' : 'warning'}>
          {spread <= 1 ? 'Balance parejo' : `Diferencia de ${spread} participaciones`}
        </Badge>
      </div>

      <ul className="balance-summary__list">
        {teams.map((team) => (
          <li key={team.id} className="balance-summary__row">
            <span className="balance-summary__label">{team.label}</span>
            <span className="balance-summary__bar-track">
              <span
                className="balance-summary__bar-fill"
                style={{ width: `${(team.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="balance-summary__count">
              {team.count} {team.count === 1 ? 'participación' : 'participaciones'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
