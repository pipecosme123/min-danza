import { formatMonthYear } from '../../utils/dates.js';
import './MonthOccupancyCalendar.css';

const WEEKDAY_HEADERS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Arma la grilla de semanas (lunes a domingo) que cubre el mes completo,
 * con `null` en las celdas de relleno de la primera/última semana. Usa
 * `Date.UTC` solo como calculadora de calendario (sin zona horaria), mismo
 * criterio que `server/src/utils/dates.js`.
 * @returns {Array<Array<{ day: number, dateStr: string } | null>>}
 */
function buildMonthWeeks(year, month) {
  const firstWeekdayUTC = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=domingo..6=sábado
  const leadingBlanks = (firstWeekdayUTC + 6) % 7; // lunes=0..domingo=6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, dateStr: `${year}-${pad(month)}-${pad(day)}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Indicadores compactos de un turno para una celda del día: uno por equipo
 * asignado (`FIXED`/`YOUTH_SERVICE`), o uno solo con el título
 * (`EXTRAORDINARY`). El color del uniforme, si tiene, es solo un acento
 * visual (borde) — el texto siempre está presente, nunca es la única señal.
 *
 * `highlightTeamIds`, si se pasa (`Set<string>` no vacío), marca cada
 * indicador como resaltado cuando el equipo al que pertenece (o, para
 * `EXTRAORDINARY`, alguno de los equipos del turno) está en el set.
 */
function slotIndicators(slot, highlightTeamIds) {
  const hasHighlightSet = Boolean(highlightTeamIds && highlightTeamIds.size > 0);
  const colorHex = slot.uniform?.colorHex || null;
  if (slot.slotType === 'EXTRAORDINARY') {
    const highlighted = hasHighlightSet && (slot.teams || []).some((team) => highlightTeamIds.has(team.id));
    const cancelled = Boolean(slot.cancelledAt);
    return [{ key: slot.id, text: slot.title || 'Evento', colorHex, highlighted, cancelled }];
  }
  if (!slot.teams || slot.teams.length === 0) {
    return [{ key: slot.id, text: 'Sin equipo asignado', colorHex, highlighted: false, cancelled: false }];
  }
  return slot.teams.map((team) => ({
    key: `${slot.id}-${team.assignmentId || team.id}`,
    text: team.label,
    colorHex,
    highlighted: hasHighlightSet && highlightTeamIds.has(team.id),
    cancelled: false,
  }));
}

/**
 * Vista de calendario mensual real (grilla de 7 columnas, lunes a domingo)
 * de solo lectura: complementa a `CalendarGrid` (vista de lista agrupada
 * por fecha que sigue usando `EventsManager`), no la reemplaza. Las
 * acciones de edición (uniforme, bloqueo, reasignación) viven únicamente en
 * la vista de lista. Contrato:
 * `docs/architecture/phase4b-schedule-refinements-contract.md` §6.
 *
 * `highlightTeamIds` (opcional): ids de equipo a resaltar visualmente (ver
 * `slotIndicators`). Sin este prop, el comportamiento es idéntico al
 * anterior — no afecta el uso existente en `EventsManager`.
 *
 * @param {{ year: number, month: number, slots: Array, highlightTeamIds?: Set<string>|string[] }} props
 */
export function MonthOccupancyCalendar({ year, month, slots, highlightTeamIds }) {
  const highlightSet =
    highlightTeamIds instanceof Set ? highlightTeamIds : highlightTeamIds ? new Set(highlightTeamIds) : null;
  const hasHighlight = Boolean(highlightSet && highlightSet.size > 0);

  const slotsByDate = new Map();
  slots.forEach((slot) => {
    if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, []);
    slotsByDate.get(slot.date).push(slot);
  });

  const weeks = buildMonthWeeks(year, month);

  return (
    <div className="month-occupancy-calendar">
      <div className="month-occupancy-calendar__scroll">
        <table className="month-occupancy-calendar__table">
          <caption className="visually-hidden">
            Calendario de {formatMonthYear(year, month)} con los turnos y eventos del mes
          </caption>
          <thead>
            <tr>
              {WEEKDAY_HEADERS.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, weekIndex) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={weekIndex}>
                {week.map((cell, cellIndex) => {
                  if (!cell) {
                    return (
                      <td
                        // eslint-disable-next-line react/no-array-index-key
                        key={cellIndex}
                        className="month-occupancy-calendar__cell month-occupancy-calendar__cell--empty"
                        aria-hidden="true"
                      />
                    );
                  }
                  const daySlots = slotsByDate.get(cell.dateStr) || [];
                  return (
                    <td key={cell.dateStr} className="month-occupancy-calendar__cell">
                      <span className="month-occupancy-calendar__day-number">{cell.day}</span>
                      {daySlots.length > 0 ? (
                        <ul className="month-occupancy-calendar__indicators">
                          {daySlots
                            .flatMap((slot) => slotIndicators(slot, highlightSet))
                            .map((indicator) => (
                              <li
                                key={indicator.key}
                                className={[
                                  'month-occupancy-calendar__indicator',
                                  indicator.highlighted ? 'month-occupancy-calendar__indicator--highlighted' : '',
                                  hasHighlight && !indicator.highlighted
                                    ? 'month-occupancy-calendar__indicator--dimmed'
                                    : '',
                                  indicator.cancelled ? 'month-occupancy-calendar__indicator--cancelled' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                style={indicator.colorHex ? { borderLeftColor: indicator.colorHex } : undefined}
                                title={indicator.cancelled ? `${indicator.text} (cancelado)` : indicator.text}
                              >
                                {indicator.text}
                              </li>
                            ))}
                        </ul>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
