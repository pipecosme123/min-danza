import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext.jsx';
import { LeaderAuthProvider } from '../context/LeaderAuthContext.jsx';
import { ToastViewport } from '../components/ui/Toast.jsx';

vi.mock('../api/leader.js', () => ({
  leaderLogin: vi.fn(),
  getLeaderProfile: vi.fn(),
  changeLeaderPassword: vi.fn(),
  getLeaderServices: vi.fn(),
  searchLeaderPeople: vi.fn(),
  createReportDraft: vi.fn(),
  getLeaderReport: vi.fn(),
  saveLeaderReport: vi.fn(),
  submitLeaderReport: vi.fn(),
  reopenLeaderReport: vi.fn(),
  getLeaderWhatsappText: vi.fn(),
}));

import {
  leaderLogin,
  changeLeaderPassword,
  getLeaderServices,
  getLeaderReport,
  searchLeaderPeople,
} from '../api/leader.js';
import { LeaderLogin } from '../pages/leader/LeaderLogin.jsx';
import { LeaderChangePassword } from '../pages/leader/LeaderChangePassword.jsx';
import { LeaderServices } from '../pages/leader/LeaderServices.jsx';
import { LeaderReportEditor } from '../pages/leader/LeaderReportEditor.jsx';

function renderWithProviders(ui, { route = '/' } = {}) {
  return render(
    <ThemeProvider>
      <LeaderAuthProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        <ToastViewport />
      </LeaderAuthProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('LeaderLogin', () => {
  it('tras un login con contraseña temporal, redirige a /lider/clave', async () => {
    leaderLogin.mockResolvedValueOnce({
      token: 'tok',
      leader: { id: 'l1', fullName: 'Marta Restrepo' },
      mustChangePassword: true,
    });

    renderWithProviders(
      <Routes>
        <Route path="/" element={<LeaderLogin />} />
        <Route path="/lider/clave" element={<div>Pantalla de clave</div>} />
      </Routes>,
    );

    await userEvent.type(screen.getByLabelText(/Usuario/), 'marta.r');
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'temp1234');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Pantalla de clave')).toBeInTheDocument();
    expect(leaderLogin).toHaveBeenCalledWith('marta.r', 'temp1234');
  });

  it('muestra el mensaje de error del servidor sin redirigir', async () => {
    leaderLogin.mockRejectedValueOnce(
      Object.assign(new Error('Usuario o contraseña incorrectos.'), { name: 'ApiError' }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/" element={<LeaderLogin />} />
      </Routes>,
    );
    await userEvent.type(screen.getByLabelText(/Usuario/), 'x');
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'y');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByText('Usuario o contraseña incorrectos.')).toBeInTheDocument();
  });
});

describe('LeaderChangePassword', () => {
  it('rechaza cuando la confirmación no coincide, sin llamar a la API', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/" element={<LeaderChangePassword />} />
      </Routes>,
    );
    await userEvent.type(screen.getByLabelText(/Contraseña actual/), 'temporal1');
    await userEvent.type(screen.getByLabelText(/Contraseña nueva/), 'nuevaClave1');
    await userEvent.type(screen.getByLabelText(/Repetí la contraseña nueva/), 'otraCosa');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    expect(await screen.findByText(/La confirmación no coincide/)).toBeInTheDocument();
    expect(changeLeaderPassword).not.toHaveBeenCalled();
  });

  it('rechaza una contraseña de menos de 8 caracteres', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/" element={<LeaderChangePassword />} />
      </Routes>,
    );
    await userEvent.type(screen.getByLabelText(/Contraseña actual/), 'temporal1');
    await userEvent.type(screen.getByLabelText(/Contraseña nueva/), 'corta');
    await userEvent.type(screen.getByLabelText(/Repetí la contraseña nueva/), 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    expect(await screen.findByText(/al menos 8 caracteres/)).toBeInTheDocument();
    expect(changeLeaderPassword).not.toHaveBeenCalled();
  });
});

describe('LeaderServices', () => {
  function service(overrides = {}) {
    return {
      slotId: 's1',
      teamId: 't1',
      slot: { id: 's1', date: '2026-09-20', startTime: '08:00', slotType: 'FIXED', label: 'Domingo 08:00' },
      team: { id: 't1', displayLabel: 'Equipo 3', orderIndex: 3, teamType: 'REGULAR' },
      month: { id: 'm1', year: 2026, month: 9 },
      window: {
        opensAt: '2026-09-20T12:00:00.000Z',
        closesAt: '2026-09-23T04:59:59.999Z',
        state: 'ABIERTA',
      },
      report: null,
      ...overrides,
    };
  }

  it('lista un turno con ventana abierta y botón "Registrar asistencia"', async () => {
    getLeaderServices.mockResolvedValueOnce({ services: [service()] });
    renderWithProviders(<LeaderServices />);

    expect(await screen.findByText('Domingo 08:00')).toBeInTheDocument();
    expect(screen.getByText('Registro abierto')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Registrar asistencia' });
    expect(btn).toBeEnabled();
  });

  it('un turno con ventana PENDIENTE deshabilita el botón', async () => {
    getLeaderServices.mockResolvedValueOnce({
      services: [service({ window: { ...service().window, state: 'PENDIENTE' } })],
    });
    renderWithProviders(<LeaderServices />);
    await screen.findByText('Domingo 08:00');
    expect(screen.getByRole('button', { name: 'Registrar asistencia' })).toBeDisabled();
  });

  it('un turno con reporte enviado muestra "Ver reporte"', async () => {
    getLeaderServices.mockResolvedValueOnce({
      services: [service({ report: { id: 'r1', status: 'SUBMITTED' } })],
    });
    renderWithProviders(<LeaderServices />);
    expect(await screen.findByRole('button', { name: 'Ver reporte' })).toBeInTheDocument();
    expect(screen.getByText('Reporte: Enviado')).toBeInTheDocument();
  });
});

describe('LeaderReportEditor', () => {
  function reportPayload(overrides = {}) {
    return {
      report: { id: 'r1', status: 'DRAFT', generalNotes: null, submittedAt: null, reopenedAt: null, lastEditedByAdmin: false },
      month: { id: 'm1', year: 2026, month: 9, status: 'FINALIZED' },
      slot: { id: 's1', date: '2026-09-20', startTime: '08:00', slotType: 'FIXED', label: 'Domingo 08:00', uniform: null },
      team: { id: 't1', label: 'Equipo 3', orderIndex: 3, teamType: 'REGULAR', displayLabel: 'Equipo 3' },
      window: { opensAt: '2026-09-20T12:00:00.000Z', closesAt: '2026-09-23T04:59:59.999Z', state: 'ABIERTA' },
      entries: [
        { id: 'e1', personId: 'p1', fullName: 'Marta Restrepo', role: 'LEADER', personYaNoEnEquipo: false, status: null, coveredByPersonId: null, coveredByFullName: null, note: null },
        { id: 'e2', personId: 'p2', fullName: 'Andrés Gil', role: 'COLLABORATOR', personYaNoEnEquipo: false, status: null, coveredByPersonId: null, coveredByFullName: null, note: null },
      ],
      supports: [],
      permissions: { canEdit: true, canSubmit: true, canReopen: false },
      ...overrides,
    };
  }

  it('el selector "quién cubrió" aparece sólo al elegir REMPLAZADO', async () => {
    getLeaderReport.mockResolvedValue(reportPayload());
    searchLeaderPeople.mockResolvedValue({
      people: [{ id: 'x1', fullName: 'Luisa Peña' }],
    });

    renderWithProviders(
      <Routes>
        <Route path="/lider/reportes/:reportId" element={<LeaderReportEditor />} />
      </Routes>,
      { route: '/lider/reportes/r1' },
    );

    await screen.findByText('Integrantes del equipo');
    const andresRow = screen.getByText('Andrés Gil').closest('li');
    expect(within(andresRow).queryByLabelText(/Quién cubrió/)).not.toBeInTheDocument();

    await userEvent.selectOptions(
      within(andresRow).getByRole('combobox'),
      'REMPLAZADO',
    );
    expect(within(andresRow).getByLabelText(/Quién cubrió a Andrés Gil/)).toBeInTheDocument();
  });

  it('con la ventana CERRADA muestra el aviso y no permite editar', async () => {
    getLeaderReport.mockResolvedValue(
      reportPayload({
        window: { opensAt: '2026-09-20T12:00:00.000Z', closesAt: '2026-09-23T04:59:59.999Z', state: 'CERRADA' },
        permissions: { canEdit: false, canSubmit: false, canReopen: false },
      }),
    );
    searchLeaderPeople.mockResolvedValue({ people: [] });

    renderWithProviders(
      <Routes>
        <Route path="/lider/reportes/:reportId" element={<LeaderReportEditor />} />
      </Routes>,
      { route: '/lider/reportes/r1' },
    );

    expect(await screen.findByText(/La ventana de registro ya se cerró/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });
});
