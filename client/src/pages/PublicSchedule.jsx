import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/Layout/AppHeader.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { SearchableSelect } from '../components/ui/SearchableSelect.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Button } from '../components/ui/Button.jsx';
import { TeamCard } from '../components/domain/TeamCard.jsx';
import { CalendarGrid } from '../components/domain/CalendarGrid.jsx';
import { MonthOccupancyCalendar } from '../components/domain/MonthOccupancyCalendar.jsx';
import { getLatestPublicSchedule, getPublicScheduleFor, getScheduleHistory } from '../api/publicSchedule.js';
import { describeApiError } from '../utils/apiError.js';
import { formatMonthYear } from '../utils/dates.js';
import { groupSlotsByDate } from '../utils/schedule.js';
import { useApi } from '../hooks/useApi.js';
import './PublicSchedule.css';

/** Valor del select que representa "sin filtro" (ver a todas las personas). */
const NO_FILTER = '';

/**
 * Arma las opciones del combobox de personas a partir de todos los equipos
 * del mes, deduplicadas por `personId` (una persona puede estar en su equipo
 * regular y también en el equipo de jóvenes), ordenadas alfabéticamente, en
 * la forma `{ value, label }` que espera `SearchableSelect`.
 * @param {Array<{ members: Array<{ personId: string, fullName: string }> }>} teams
 */
function buildPersonOptions(teams) {
  const byPersonId = new Map();
  teams.forEach((team) => {
    team.members.forEach((member) => {
      if (!byPersonId.has(member.personId)) {
        byPersonId.set(member.personId, { value: member.personId, label: member.fullName });
      }
    });
  });
  return Array.from(byPersonId.values()).sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
}

/** Calcula el (year, month) civil inmediatamente siguiente a uno dado. */
function nextCalendarMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * Formatea la fecha/hora de publicación (`finalizedAt`) en un texto corto de
 * referencia, ej. "Publicado el 8 de agosto de 2026". No es información
 * crítica, solo contexto adicional para quien consulta.
 * @param {string} finalizedAt ISO date string.
 */
function formatPublishedAt(finalizedAt) {
  const date = new Date(finalizedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Página pública, sin autenticación: muestra la organización del mes
 * `FINALIZED` más reciente por defecto (equipos, integrantes y horario
 * asignado), con la posibilidad de consultar meses anteriores hasta 1 año de
 * antigüedad (ajustado 2026-08-22). No distingue "no existe ningún mes" de
 * "el mes en preparación todavía no se publicó" ni de "el mes existe pero ya
 * pasó la ventana de 1 año" — los tres casos llegan como el mismo 404
 * `MES_NO_PUBLICADO` y se muestran con el mismo estado vacío. Contrato:
 * `docs/architecture/phase5-public-page-contract.md` §4.
 */
export function PublicSchedule() {
  const { data, loading, error, execute } = useApi(
    (selection) => (selection ? getPublicScheduleFor(selection.year, selection.month) : getLatestPublicSchedule()),
    { immediate: true, args: [null] },
  );
  const { data: historyData } = useApi(getScheduleHistory, { immediate: true });
  const historyMonths = historyData?.months ?? [];

  const [selectedMonthKey, setSelectedMonthKey] = useState('latest');
  const [selectedPersonId, setSelectedPersonId] = useState(NO_FILTER);
  const [scheduleView, setScheduleView] = useState('list'); // 'list' | 'calendar'

  // "Mes actual" real (el que devuelve /latest), fijado aparte de `data` para
  // que las tabs actual/siguiente no dependan de cuál de los dos esté viendo
  // el usuario en este momento -- sin esto, al entrar a la tab "mes
  // siguiente" `data.month` pasaría a ser ese mes y el cálculo de "el
  // siguiente al que se muestra" apuntaría dos meses para adelante en vez de
  // seguir comparando contra el mes actual real.
  const [anchorMonth, setAnchorMonth] = useState(null);
  useEffect(() => {
    if (data && selectedMonthKey === 'latest') {
      setAnchorMonth({ year: data.month.year, month: data.month.month });
    }
  }, [data, selectedMonthKey]);

  // El mes siguiente solo se ofrece como tab si ya apareció en /history (ahí
  // ya se aplicó del lado del servidor la ventana de "adelanto de los
  // últimos 8 días" -- ver publicSchedule.service.js). No hace falta
  // recalcular esa regla en el cliente.
  const nextMonthEntry = anchorMonth
    ? (() => {
        const { year, month } = nextCalendarMonth(anchorMonth.year, anchorMonth.month);
        return historyMonths.find((m) => m.year === year && m.month === month) ?? null;
      })()
    : null;

  const nextMonthKey = nextMonthEntry ? `${nextMonthEntry.year}-${nextMonthEntry.month}` : null;

  function handleMonthChange(value) {
    setSelectedMonthKey(value);
    // La persona filtrada de un mes anterior probablemente no exista (o no
    // tenga sentido) en el mes recién elegido.
    setSelectedPersonId(NO_FILTER);
    if (value === 'latest') {
      execute(null);
    } else {
      const [year, month] = value.split('-').map(Number);
      execute({ year, month });
    }
  }

  // "Ver otro mes" queda reservado a meses PASADOS (historial de hasta 1
  // año): el mes actual y, si corresponde, el mes siguiente ya tienen su
  // propia tab más arriba (ver `monthTabs`) -- no tiene sentido duplicarlos
  // acá. Si "latest" no encontró nada (ej. el mes actual todavía no se
  // publicó, sin `anchorMonth` para anclar ninguna tab) el historial completo
  // sigue cayendo acá, para no dejar al usuario sin forma de llegar a un mes
  // que sí esté disponible (ej. el mes siguiente ya adelantado).
  const otherMonths = data
    ? historyMonths.filter((m) => {
        const isCurrentlyShown = m.year === data.month.year && m.month === data.month.month;
        const isAnchor = anchorMonth && m.year === anchorMonth.year && m.month === anchorMonth.month;
        const isNextTab = nextMonthEntry && m.year === nextMonthEntry.year && m.month === nextMonthEntry.month;
        return !isCurrentlyShown && !isAnchor && !isNextTab;
      })
    : historyMonths;

  const errorInfo = error ? describeApiError(error) : null;
  const notPublished = errorInfo?.code === 'MES_NO_PUBLICADO';

  // Tabs "mes actual" / "mes siguiente": solo existen mientras haya un mes
  // siguiente ya publicado y revelado. Apenas el mes civil actual termina, lo
  // que era "el siguiente" pasa a ser el nuevo `anchorMonth` (vía /latest) y,
  // salvo que YA se haya publicado el mes de después, `nextMonthEntry` vuelve
  // a ser null y las tabs desaparecen solas -- sin ningún estado que limpiar
  // a mano.
  const monthTabs =
    anchorMonth && nextMonthEntry ? (
      <div className="public-schedule__month-tabs" role="group" aria-label="Elegir mes">
        <Button
          type="button"
          variant={selectedMonthKey === 'latest' ? 'primary' : 'secondary'}
          aria-pressed={selectedMonthKey === 'latest'}
          onClick={() => handleMonthChange('latest')}
        >
          {formatMonthYear(anchorMonth.year, anchorMonth.month)}
        </Button>
        <Button
          type="button"
          variant={selectedMonthKey === nextMonthKey ? 'primary' : 'secondary'}
          aria-pressed={selectedMonthKey === nextMonthKey}
          onClick={() => handleMonthChange(nextMonthKey)}
        >
          {formatMonthYear(nextMonthEntry.year, nextMonthEntry.month)}
        </Button>
      </div>
    ) : null;

  const monthSelector =
    otherMonths.length > 0 ? (
      <Field
        label="Ver otro mes"
        as="select"
        value={selectedMonthKey}
        onChange={(event) => handleMonthChange(event.target.value)}
      >
        <option value="latest">Más reciente</option>
        {otherMonths.map((m) => (
          <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
            {formatMonthYear(m.year, m.month)}
          </option>
        ))}
      </Field>
    ) : null;

  const allTeams = data ? [...data.teams].sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const publishedAt = data ? formatPublishedAt(data.month.finalizedAt) : null;

  const personOptions = useMemo(() => (data ? buildPersonOptions(data.teams) : []), [data]);

  // Equipo(s) de la persona filtrada: puede ser uno (su equipo regular) o
  // dos (regular + jóvenes, si también integra el Servicio de jóvenes).
  const filteredTeams = selectedPersonId
    ? allTeams.filter((team) => team.members.some((member) => member.personId === selectedPersonId))
    : allTeams;
  const filteredTeamIds = new Set(filteredTeams.map((team) => team.id));

  // La vista de lista SÍ se filtra por persona; la vista de calendario
  // siempre muestra todos los turnos del mes (pedido explícito), y en su
  // lugar resalta los que corresponden a la persona filtrada.
  const allSlots = data ? data.slots : [];
  const listSlots = selectedPersonId
    ? allSlots.filter((slot) => (slot.teams || []).some((team) => filteredTeamIds.has(team.id)))
    : allSlots;
  const scheduleGroups = groupSlotsByDate(listSlots);

  return (
    <div>
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader />

      <main id="main-content" className="container page-section">
        <header className="page-header">
          <h1>Ministerio de danza</h1>
          <p className="page-header__subtitle">Lluvias de Bendiciones</p>
        </header>

        {loading ? <Spinner label="Cargando el horario del mes..." /> : null}

        {!loading && error && !notPublished ? (
          <ErrorMessage
            message="No se pudo cargar el horario del mes. Verifica tu conexión e intenta de nuevo."
            onRetry={() => execute()}
          />
        ) : null}

        {!loading && notPublished ? (
          <EmptyState
            title="Todavía no hay un mes publicado"
            description="El administrador publica el horario del mes una vez que los equipos y turnos quedan confirmados. Vuelve a consultar más tarde."
            action={monthSelector}
          />
        ) : null}

        {!loading && data ? (
          <>
            <div className="public-schedule__month-header">
              <h2 className="public-schedule__month-title">
                {formatMonthYear(data.month.year, data.month.month)}
              </h2>
              {publishedAt ? (
                <p className="public-schedule__published-at">Publicado el {publishedAt}.</p>
              ) : null}
              {monthTabs}
              {monthSelector}
            </div>

            {data.verses && data.verses.length > 0 ? (
              <section aria-labelledby="public-schedule-verses-heading" className="public-schedule__verses">
                <h2 id="public-schedule-verses-heading" className="visually-hidden">
                  Versículo del mes
                </h2>
                {data.verses.map((verse) => (
                  <blockquote key={verse.id} className="public-schedule__verse">
                    <p className="public-schedule__verse-text">&ldquo;{verse.text}&rdquo;</p>
                    <cite className="public-schedule__verse-reference">{verse.reference}</cite>
                  </blockquote>
                ))}
              </section>
            ) : null}

            {personOptions.length > 0 ? (
              <div className="public-schedule__filter">
                <SearchableSelect
                  label="Buscar mi equipo"
                  hint="Escribe tu nombre para ver solo tu equipo y tus turnos."
                  options={personOptions}
                  value={selectedPersonId}
                  onChange={setSelectedPersonId}
                  placeholder="Escribe un nombre..."
                  clearLabel="Todas las personas"
                />
                {selectedPersonId ? (
                  <Button type="button" variant="secondary" onClick={() => setSelectedPersonId(NO_FILTER)}>
                    Ver todas las personas
                  </Button>
                ) : null}
              </div>
            ) : null}

            <section aria-labelledby="public-schedule-teams-heading" className="public-schedule__section">
              <h3 id="public-schedule-teams-heading" className="public-schedule__section-title">
                Equipos
              </h3>
              <div className="public-schedule__teams-grid">
                {filteredTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    className={team.teamType === 'YOUTH' ? 'team-card--youth' : ''}
                    onlyShowLeaderRole
                  />
                ))}
              </div>
            </section>

            <section aria-labelledby="public-schedule-slots-heading" className="public-schedule__section">
              <h3 id="public-schedule-slots-heading" className="public-schedule__section-title">
                Horario
              </h3>

              <div className="public-schedule__view-toggle" role="group" aria-label="Vista del horario">
                <Button
                  type="button"
                  variant={scheduleView === 'list' ? 'primary' : 'secondary'}
                  aria-pressed={scheduleView === 'list'}
                  onClick={() => setScheduleView('list')}
                >
                  Vista de lista
                </Button>
                <Button
                  type="button"
                  variant={scheduleView === 'calendar' ? 'primary' : 'secondary'}
                  aria-pressed={scheduleView === 'calendar'}
                  onClick={() => setScheduleView('calendar')}
                >
                  Vista de calendario
                </Button>
              </div>

              {scheduleView === 'list' ? (
                selectedPersonId && listSlots.length === 0 ? (
                  <EmptyState
                    title="Esta persona todavía no tiene turnos asignados"
                    description="No encontramos ningún turno para el equipo de esta persona en el horario publicado."
                  />
                ) : (
                  <CalendarGrid groups={scheduleGroups} />
                )
              ) : (
                <MonthOccupancyCalendar
                  year={data.month.year}
                  month={data.month.month}
                  slots={allSlots}
                  highlightTeamIds={selectedPersonId ? filteredTeamIds : undefined}
                />
              )}
            </section>
          </>
        ) : null}
      </main>

      <footer className="public-footer">
        <div className="container">
          <Link to="/admin/login" className="public-footer__admin-link">
            Acceso administrador
          </Link>
        </div>
      </footer>
    </div>
  );
}
