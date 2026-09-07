/**
 * Recurso administrativo de los reportes de asistencia (Fase 9). Usa el token
 * de admin. El admin ve el contenido SÓLO de los reportes ya enviados.
 * Contrato: docs/architecture/phase9-attendance-reports-contract.md §5.3.
 */
import { apiClient } from './client.js';

/**
 * Matriz de todos los (turno × equipo) del mes con su estado de reporte
 * (SIN_EMPEZAR / BORRADOR / ENVIADO). Sin contenido de borradores.
 * @param {string} monthId
 */
export function getMonthAttendance(monthId) {
  return apiClient.get(`/months/${monthId}/attendance`);
}

/** Contenido completo de un reporte enviado. 409 REPORTE_EN_BORRADOR si aún no. */
export function getAttendanceReport(reportId) {
  return apiClient.get(`/attendance/reports/${reportId}`);
}

/**
 * Edición directa del admin sobre un reporte enviado.
 * @param {string} reportId
 * @param {{ entries?: any[], supports?: any[], generalNotes?: string|null }} body
 */
export function editAttendanceReport(reportId, body) {
  return apiClient.patch(`/attendance/reports/${reportId}`, body);
}

/** Reabre un reporte enviado a borrador (sin chequeo de ventana). */
export function reopenAttendanceReport(reportId) {
  return apiClient.post(`/attendance/reports/${reportId}/reopen`);
}

/** @returns {Promise<{ text: string }>} */
export function getAttendanceWhatsappText(reportId) {
  return apiClient.get(`/attendance/reports/${reportId}/whatsapp-text`);
}

/** Padrón mínimo (id + nombre) para los selectores del editor del admin. */
export function getAttendancePeople() {
  return apiClient.get('/attendance/people');
}
