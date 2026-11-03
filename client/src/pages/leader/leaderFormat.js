/** Helpers de presentación compartidos por las pantallas del portal de líderes. */

import { formatCivilDate, formatTimeLabel } from '../../utils/dates.js';

/** "Domingo 28 de septiembre · 8:00 a. m." a partir de un slot serializado. */
export function formatSlotWhen(slot) {
  return `${formatCivilDate(slot.date)} · ${formatTimeLabel(slot.startTime)}`;
}

/**
 * ["Equipo 1"] -> "Equipo 1"; ["Equipo 1","Equipo 3"] -> "Equipo 1 y Equipo
 * 3"; 3+ -> "Equipo 1, Equipo 3 y Equipo 5". Mismo formato que usa el backend
 * para el encabezado del texto de WhatsApp (turno compartido entre equipos).
 */
export function joinTeamLabels(teams) {
  const labels = teams.map((t) => t.displayLabel);
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

/** ISO -> "28/09/2026 23:59" (hora local del navegador). */
export function formatDateTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const WINDOW_LABEL = {
  PENDIENTE: 'Aún no se puede registrar',
  ABIERTA: 'Registro abierto',
  CERRADA: 'Registro cerrado',
};

export const WINDOW_BADGE_VARIANT = {
  PENDIENTE: 'neutral',
  ABIERTA: 'success',
  CERRADA: 'warning',
};

export const REPORT_STATUS_LABEL = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviado',
};

/** Estado del reporte tal como lo devuelve la matriz del admin. */
export const ADMIN_STATUS_LABEL = {
  SIN_EMPEZAR: 'Sin empezar',
  BORRADOR: 'Borrador',
  ENVIADO: 'Enviado',
};

export const ADMIN_STATUS_VARIANT = {
  SIN_EMPEZAR: 'neutral',
  BORRADOR: 'warning',
  ENVIADO: 'success',
};

export const ENTRY_STATUS_OPTIONS = [
  { value: 'ASISTIO', label: 'Asistió' },
  { value: 'NO_ASISTIO_CON_EXCUSA', label: 'No asistió (con excusa)' },
  { value: 'NO_ASISTIO_SIN_EXCUSA', label: 'No asistió (sin excusa)' },
  { value: 'REMPLAZADO', label: 'Remplazado' },
  { value: 'CAMBIO', label: 'Cambio' },
];

export const ENTRY_STATUS_LABEL = Object.fromEntries(
  ENTRY_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

export const COVERED_STATUSES = new Set(['REMPLAZADO', 'CAMBIO']);

/**
 * Único estado que muestra el campo de texto individual (la excusa) en el
 * formulario editable. "Sin excusa" no tiene nada más que decir por
 * definición, así que no lleva campo de texto propio.
 */
export const NOTE_VISIBLE_STATUSES = new Set(['NO_ASISTIO_CON_EXCUSA']);

/**
 * Radio principal del formulario del líder: agrupa los dos estados
 * "no asistió" (con/sin excusa) bajo una sola opción "No asistió", que
 * despliega el radio secundario de `EXCUSE_OPTIONS`.
 */
export const PRIMARY_STATUS_OPTIONS = [
  { value: 'ASISTIO', label: 'Asistió' },
  { value: 'NO_ASISTIO', label: 'No asistió' },
  { value: 'REMPLAZADO', label: 'Remplazo' },
  { value: 'CAMBIO', label: 'Cambio' },
];

/** Radio secundario, sólo visible cuando el primario es "No asistió". */
export const EXCUSE_OPTIONS = [
  { value: 'NO_ASISTIO_CON_EXCUSA', label: 'Con excusa' },
  { value: 'NO_ASISTIO_SIN_EXCUSA', label: 'Sin excusa' },
];

/** El radio principal que corresponde a un status real (o '' = pendiente de elegir excusa). */
export function primaryStatusOf(status) {
  if (status === 'REMPLAZADO' || status === 'CAMBIO') return status;
  if (status === '' || status === 'NO_ASISTIO_CON_EXCUSA' || status === 'NO_ASISTIO_SIN_EXCUSA') {
    return 'NO_ASISTIO';
  }
  return 'ASISTIO';
}
