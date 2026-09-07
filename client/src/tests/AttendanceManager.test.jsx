import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext.jsx';
import { ToastViewport } from '../components/ui/Toast.jsx';

vi.mock('../api/months.js', () => ({ getMonths: vi.fn() }));
vi.mock('../api/attendance.js', () => ({
  getMonthAttendance: vi.fn(),
  getAttendanceReport: vi.fn(),
  editAttendanceReport: vi.fn(),
  reopenAttendanceReport: vi.fn(),
  getAttendanceWhatsappText: vi.fn(),
  getAttendancePeople: vi.fn(),
}));

import { getMonths } from '../api/months.js';
import { getMonthAttendance, getAttendanceReport } from '../api/attendance.js';
import { AttendanceManager } from '../pages/AttendanceManager.jsx';

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AttendanceManager />
      </MemoryRouter>
      <ToastViewport />
    </ThemeProvider>,
  );
}

const MONTH = { id: 'm1', year: 2026, month: 9, status: 'FINALIZED' };

function item(overrides = {}) {
  return {
    slotId: 's1',
    teamId: 't1',
    slot: { id: 's1', date: '2026-09-06', startTime: '08:00', slotType: 'FIXED', label: 'Domingo 08:00' },
    team: { id: 't1', label: 'Equipo 1', orderIndex: 1, teamType: 'REGULAR', displayLabel: 'Equipo 1' },
    window: { opensAt: '2026-09-06T12:00:00Z', closesAt: '2026-09-09T04:59:59Z', state: 'CERRADA' },
    status: 'SIN_EMPEZAR',
    reportId: null,
    submittedAt: null,
    lastEditedByAdmin: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getMonths.mockResolvedValue({ data: [MONTH] });
});

describe('AttendanceManager', () => {
  it('muestra la matriz con el estado de cada (turno, equipo)', async () => {
    getMonthAttendance.mockResolvedValue({
      month: MONTH,
      items: [
        item({ status: 'ENVIADO', reportId: 'r1' }),
        item({ slotId: 's2', teamId: 't2', team: { ...item().team, id: 't2', displayLabel: 'Equipo 2' }, status: 'BORRADOR', reportId: 'r2' }),
      ],
    });
    renderPage();

    expect(await screen.findByText('Enviado')).toBeInTheDocument();
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    // El borrador no ofrece acción de ver contenido.
    expect(screen.getByText('El líder aún no lo envió')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver' })).toBeInTheDocument();
  });

  it('al abrir un reporte enviado, pide su contenido al backend', async () => {
    getMonthAttendance.mockResolvedValue({
      month: MONTH,
      items: [item({ status: 'ENVIADO', reportId: 'r1' })],
    });
    getAttendanceReport.mockResolvedValue({
      report: { id: 'r1', status: 'SUBMITTED', generalNotes: 'ok', lastEditedByAdmin: false },
      month: MONTH,
      slot: item().slot,
      team: item().team,
      window: item().window,
      entries: [],
      supports: [],
      permissions: { canEdit: false, canSubmit: false, canReopen: false },
    });
    const { getAttendancePeople } = await import('../api/attendance.js');
    getAttendancePeople.mockResolvedValue({ people: [] });

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ver' }));

    expect(getAttendanceReport).toHaveBeenCalledWith('r1');
    expect(await screen.findByRole('button', { name: 'Editar contenido' })).toBeInTheDocument();
  });
});
