/** Helpers de presentación compartidos por las pantallas del portal de líderes. */

import { formatCivilDate, formatTimeLabel } from '../../utils/dates.js';

/** "Domingo 28 de septiembre · 8:00 a. m." a partir de un slot serializado. */
export function formatSlotWhen(slot) {
  return `${formatCivilDate(slot.date)} · ${formatTimeLabel(slot.startTime)}`;
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
