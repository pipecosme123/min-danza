import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/Layout/AppHeader.jsx';
import { PublicTabBar } from '../components/Layout/PublicTabBar.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorMessage } from '../components/ui/ErrorMessage.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { SearchableSelect } from '../components/ui/SearchableSelect.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Button } from '../components/ui/Button.jsx';
import { TeamCard } from '../components/domain/TeamCard.jsx';
import { SlotCard } from '../components/domain/SlotCard.jsx';
import { UniformBadge } from '../components/domain/UniformBadge.jsx';
import { CalendarGrid } from '../components/domain/CalendarGrid.jsx';
import { MonthOccupancyCalendar } from '../components/domain/MonthOccupancyCalendar.jsx';
import { getLatestPublicSchedule, getPublicScheduleFor, getScheduleHistory } from '../api/publicSchedule.js';
import { describeApiError } from '../utils/apiError.js';
import { MONTH_LABELS, formatCivilDate, formatMonthYear, formatTimeLabel } from '../utils/dates.js';
import { groupSlotsByDate } from '../utils/schedule.js';
import { daysUntil, findNextServiceFor, findTeamIdsOf, slotHasAnyTeam, upcomingSlots } from '../utils/myServices.js';
import { useApi } from '../hooks/useApi.js';
import { useRememberedPerson } from '../hooks/useRememberedPerson.js';
import './PublicSchedule.css';

/** Valor del select que representa "sin filtro" (ver a todas las personas). */
const NO_FILTER = '';

/**
 * Vistas de la página pública en el teléfono (decisión 2026-11-09, Fase 10
 * §9.1): cada una muestra solo sus bloques (`data-views` de cada panel, ver
 * PublicSchedule.css). Desde 768px se ven todos a la vez, así que la vista
 * solo cambia la presentación, nunca qué datos se cargan.
 */
const VIEWS = ['inicio', 'horario', 'equipos'];

const PERSON_FILTER_ID = 'public-person-filter';

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

/** "Hoy", "Mañana", "En 4 días" — para el próximo servicio. */
function describeDaysUntil(days) {
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

function firstName(fullName) {
  return fullName ? fullName.split(' ')[0] : '';
}

/** "mié", "dom"... para el bloque de fecha de «Esta semana». */
function shortWeekday(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '');
}

function teamLabels(slot) {
  return (slot.teams || []).map((team) => team.label).join(' + ');
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
 *
 * Fase 10 (propuesta A): en el teléfono se divide en tres vistas por
 * `?vista=` (Inicio · Horario · Equipos, con barra inferior) y el inicio
 * muestra «Tu próximo servicio» y «Esta semana» para la persona recordada.
 */
export function PublicSchedule() {
  const { data, loading, error, execute } = useApi(
    (selection) => (selection ? getPublicScheduleFor(selection.year, selection.month) : getLatestPublicSchedule()),
    { immediate: true, args: [null] },
  );
  const { data: historyData } = useApi(getScheduleHistory, { immediate: true });
  const historyMonths = historyData?.months ?? [];

  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('vista');
  const view = VIEWS.includes(requestedView) ? requestedView : 'inicio';
  const navigate = useNavigate();

  // «Soy yo»: la persona que el visitante eligió alguna vez en «Buscar mi
  // equipo», recordada en este navegador (Fase 10 §9.2). Es independiente
  // del filtro: el filtro se limpia al cambiar de mes; la persona recordada
  // no (es la misma `Person` todos los meses).
  const { personId: myPersonId, remember, forget } = useRememberedPerson();
  const [focusFilterRequested, setFocusFilterRequested] = useState(false);

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

  // «Ahora» se fija al cargar cada mes, para que el próximo servicio no
  // cambie de un render a otro mientras se navega por la página.
  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const myTeamIds = useMemo(() => (data ? findTeamIdsOf(data.teams, myPersonId) : new Set()), [data, myPersonId]);
  const myName = personOptions.find((option) => option.value === myPersonId)?.label ?? null;
  const nextService = data ? findNextServiceFor(data.slots, myTeamIds, now) : null;
  const weekSlots = data ? upcomingSlots(data.slots, now).slice(0, 4) : [];

  function handlePersonFilterChange(value) {
    setSelectedPersonId(value);
    if (value) remember(value);
  }

  // «Elegir mi nombre»: lleva al buscador (en el teléfono, a la vista
  // Horario, donde vive) y le pone el foco cuando ya está visible.
  function requestChooseName() {
    if (view === 'inicio') navigate('/?vista=horario');
    setFocusFilterRequested(true);
  }

  useEffect(() => {
    if (!focusFilterRequested) return;
    const input = document.getElementById(PERSON_FILTER_ID);
    if (input) {
      input.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      input.focus();
    }
    setFocusFilterRequested(false);
  }, [focusFilterRequested, view]);

  // La vista de lista SÍ se filtra por persona; la vista de calendario
  // siempre muestra todos los turnos del mes (pedido explícito), y en su
  // lugar resalta los que corresponden a la persona filtrada.
  const allSlots = data ? data.slots : [];
  const listSlots = selectedPersonId
    ? allSlots.filter((slot) => (slot.teams || []).some((team) => filteredTeamIds.has(team.id)))
    : allSlots;
  const scheduleGroups = groupSlotsByDate(listSlots);

  const monthName = data ? MONTH_LABELS[data.month.month - 1] : '';
  const hasVerses = Boolean(data?.verses?.length);

  // En «Equipos», el equipo propio (y el de jóvenes, si también lo integra) va primero.
  const teamsToShow = [...filteredTeams].sort(
    (a, b) => Number(myTeamIds.has(b.id)) - Number(myTeamIds.has(a.id)),
  );

  return (
    <div className="has-public-tab-bar">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader />

      <main id="main-content" className="container page-section public-schedule" data-vista={view}>
        <header className="page-header public-schedule__panel" data-views="inicio">
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
            <div className="public-schedule__panel public-schedule__month-header" data-views="inicio horario equipos">
              <h2 className="public-schedule__month-title">{formatMonthYear(data.month.year, data.month.month)}</h2>
              {publishedAt ? <p className="public-schedule__published-at">Publicado el {publishedAt}.</p> : null}
              {monthTabs}
              {monthSelector}
            </div>

            <div
              className={`public-schedule__panel public-schedule__home${hasVerses ? ' public-schedule__home--with-verse' : ''}`}
              data-views="inicio"
            >
              <section className="public-schedule__next" aria-labelledby="public-schedule-next-heading">
                <h2 id="public-schedule-next-heading" className="public-schedule__next-label">
                  {myName ? `Hola, ${firstName(myName)} · tu próximo servicio` : 'Tu próximo servicio'}
                </h2>

                {!myPersonId ? (
                  <>
                    <p className="public-schedule__next-text">
                      Elige tu nombre una vez y te mostramos cuándo te toca y qué uniforme llevar.
                    </p>
                    <button type="button" className="public-schedule__next-action" onClick={requestChooseName}>
                      Elegir mi nombre
                    </button>
                  </>
                ) : !myName ? (
                  <>
                    <p className="public-schedule__next-text">Tu nombre no aparece en los equipos de este mes.</p>
                    <button type="button" className="public-schedule__next-action" onClick={forget}>
                      Elegir otro nombre
                    </button>
                  </>
                ) : nextService ? (
                  <>
                    <p className="public-schedule__next-when">{describeDaysUntil(daysUntil(nextService, now))}</p>
                    <p className="public-schedule__next-day">{formatCivilDate(nextService.date)}</p>
                    <p className="public-schedule__next-time">
                      {formatTimeLabel(nextService.startTime)}
                      {nextService.title ? ` · ${nextService.title}` : ''}
                    </p>
                    <ul className="public-schedule__next-chips">
                      <li>{teamLabels(nextService)}</li>
                      <li>
                        {nextService.uniform ? (
                          <UniformBadge name={nextService.uniform.name} colorHex={nextService.uniform.colorHex} />
                        ) : (
                          'Uniforme por definir'
                        )}
                      </li>
                    </ul>
                    <button type="button" className="public-schedule__next-forget" onClick={forget}>
                      No soy {firstName(myName)}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="public-schedule__next-text">No tienes más servicios en {monthName}.</p>
                    <button type="button" className="public-schedule__next-forget" onClick={forget}>
                      No soy {firstName(myName)}
                    </button>
                  </>
                )}
              </section>

              {hasVerses ? (
                <section aria-labelledby="public-schedule-verses-heading" className="public-schedule__verses">
                  <h2 id="public-schedule-verses-heading" className="public-schedule__verses-label">
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

              {weekSlots.length > 0 ? (
                <section className="public-schedule__week" aria-labelledby="public-schedule-week-heading">
                  <div className="public-schedule__week-header">
                    <h2 id="public-schedule-week-heading" className="public-schedule__section-title">
                      Esta semana
                    </h2>
                    <Link to="/?vista=horario" className="public-schedule__week-more">
                      Ver horario
                    </Link>
                  </div>
                  <ul className="public-schedule__week-list">
                    {weekSlots.map((slot) => {
                      const mine = slotHasAnyTeam(slot, myTeamIds);
                      return (
                        <li
                          key={slot.id}
                          className={`public-schedule__week-item${mine ? ' public-schedule__week-item--mine' : ''}`}
                        >
                          <span className="public-schedule__week-date" aria-hidden="true">
                            <b>{Number(slot.date.slice(8, 10))}</b>
                            {shortWeekday(slot.date)}
                          </span>
                          <span className="public-schedule__week-main">
                            <span className="public-schedule__week-title">
                              <span className="visually-hidden">{formatCivilDate(slot.date)}, </span>
                              {formatTimeLabel(slot.startTime)} · {teamLabels(slot) || 'Sin equipo'}
                            </span>
                            {slot.title || slot.uniform ? (
                              <span className="public-schedule__week-sub">{slot.title ?? slot.uniform.name}</span>
                            ) : null}
                          </span>
                          {mine ? <span className="public-schedule__week-mine">Tú</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </div>

            {personOptions.length > 0 ? (
              <div className="public-schedule__panel public-schedule__filter" data-views="horario equipos">
                <SearchableSelect
                  id={PERSON_FILTER_ID}
                  label="Buscar mi equipo"
                  hint="Escribe tu nombre para ver solo tu equipo y tus turnos."
                  options={personOptions}
                  value={selectedPersonId}
                  onChange={handlePersonFilterChange}
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

            <section
              aria-labelledby="public-schedule-teams-heading"
              className="public-schedule__panel public-schedule__section"
              data-views="equipos"
            >
              <h3 id="public-schedule-teams-heading" className="public-schedule__section-title">
                Equipos
              </h3>
              <div className="public-schedule__teams-grid">
                {teamsToShow.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    className={team.teamType === 'YOUTH' ? 'team-card--youth' : ''}
                    onlyShowLeaderRole
                    highlightLabel={myTeamIds.has(team.id) ? 'Tu equipo' : undefined}
                  />
                ))}
              </div>
            </section>

            <section
              aria-labelledby="public-schedule-slots-heading"
              className="public-schedule__panel public-schedule__section"
              data-views="horario"
            >
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
                  <CalendarGrid
                    groups={scheduleGroups}
                    renderSlot={(slot) => <SlotCard slot={slot} isMine={slotHasAnyTeam(slot, myTeamIds)} />}
                  />
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
        <div className="container public-footer__links">
          <Link to="/lider/login" className="public-footer__admin-link">
            Acceso líderes
          </Link>
          <Link to="/admin/login" className="public-footer__admin-link">
            Acceso administrador
          </Link>
        </div>
      </footer>

      <PublicTabBar active={view} />
    </div>
  );
}
