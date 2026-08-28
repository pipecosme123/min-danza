/**
 * Traduce los códigos de error de las acciones sobre el horario/eventos
 * (sueltos y agrupados) a lenguaje llano. Centralizado acá (en vez de vivir
 * dentro de `pages/EventsManager.jsx`) para que tanto `EventsManager` como
 * `components/domain/EventGroupsSection.jsx` puedan importarlo sin generar
 * una dependencia circular entre una página y un componente que ella misma
 * monta. Contrato de `MES_PASADO`/`EVENTO_YA_CANCELADO`:
 * `docs/architecture/phase4c-post-publish-edits-contract.md` §0/§8; códigos
 * de evento agrupado: plan `wise-noodling-hickey.md` Parte 2.
 */

/** @param {import('./apiError.js').ApiErrorInfo} info */
export function describeEventError(info) {
  if (info.code === 'FECHA_FUERA_DE_MES') {
    return 'La fecha del evento debe caer dentro del mes elegido.';
  }
  if (info.code === 'UNIFORME_NO_VALIDO') {
    return 'El uniforme elegido no existe o está inactivo. Elige otro.';
  }
  if (info.code === 'HORARIO_NO_GENERADO') {
    return 'Todavía no se generó el horario base de este mes. Generalo antes de agregar eventos.';
  }
  if (info.code === 'MES_FINALIZADO') {
    return 'Este mes ya está finalizado y no admite cambios.';
  }
  if (info.code === 'MES_PASADO') {
    return 'Este mes ya pasó, no se puede modificar.';
  }
  if (info.code === 'EVENTO_NO_ENCONTRADO') {
    return 'Este evento ya no existe. Es posible que se haya eliminado o que el horario se haya regenerado.';
  }
  if (info.code === 'EVENTO_YA_CANCELADO') {
    return 'Este evento ya está cancelado.';
  }
  if (info.code === 'SERVICIO_JOVENES_NO_ENCONTRADO') {
    return 'Todavía no hay un turno de Servicio de jóvenes generado para este mes.';
  }
  if (info.code === 'SERVICIO_JOVENES_YA_CANCELADO') {
    return 'El Servicio de jóvenes ya está cancelado.';
  }
  if (info.code === 'EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO') {
    const locked = info.details?.locked ?? 0;
    return `No se puede bajar la cantidad de equipos: ya hay ${locked} equipo${locked === 1 ? '' : 's'} bloqueado${
      locked === 1 ? '' : 's'
    } en este turno. Desbloqueá alguno primero.`;
  }
  if (info.code === 'TEAMSNEEDED_EXCEDE_EQUIPOS') {
    return 'No podés pedir más equipos de los que tiene el mes.';
  }
  return info.message;
}

/**
 * Traduce los códigos de error propios de un evento agrupado (Congreso,
 * etc.), reutilizando `describeEventError` para los códigos que comparte con
 * un evento suelto (fecha fuera de mes, uniforme inválido, horario no
 * generado, mes finalizado/pasado).
 * @param {import('./apiError.js').ApiErrorInfo} info
 */
export function describeEventGroupError(info) {
  if (info.code === 'CONGRESO_MINIMO_DOS_FECHAS') {
    return 'Un evento agrupado necesita al menos 2 fechas distintas.';
  }
  if (info.code === 'EQUIPO_NO_VALIDO') {
    return 'Uno de los equipos elegidos no es válido para este mes.';
  }
  if (info.code === 'CONGRESO_YA_CANCELADO') {
    return 'Este evento agrupado ya está cancelado.';
  }
  if (info.code === 'EVENTO_AGRUPADO_NO_ENCONTRADO') {
    return 'Este evento agrupado ya no existe. Es posible que se haya eliminado.';
  }
  if (info.code === 'TURNO_NO_ENCONTRADO') {
    return 'Este turno ya no existe. Es posible que se haya eliminado.';
  }
  return describeEventError(info);
}
