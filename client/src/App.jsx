import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { LeaderAuthProvider } from './context/LeaderAuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { LeaderProtectedRoute } from './components/LeaderProtectedRoute.jsx';
import { ToastViewport } from './components/ui/Toast.jsx';

import { PublicSchedule } from './pages/PublicSchedule.jsx';
import { AdminLogin } from './pages/AdminLogin.jsx';
import { AdminDashboard } from './pages/AdminDashboard.jsx';
import { PeopleManager } from './pages/PeopleManager.jsx';
import { TeamGenerator } from './pages/TeamGenerator.jsx';
import { EventsManager } from './pages/EventsManager.jsx';
import { UniformsManager } from './pages/UniformsManager.jsx';
import { AttendanceManager } from './pages/AttendanceManager.jsx';
import { LeaderAccountsManager } from './pages/LeaderAccountsManager.jsx';
import { NotFound } from './pages/NotFound.jsx';

import { LeaderLogin } from './pages/leader/LeaderLogin.jsx';
import { LeaderLayout } from './pages/leader/LeaderLayout.jsx';
import { LeaderServices } from './pages/leader/LeaderServices.jsx';
import { LeaderReportEditor } from './pages/leader/LeaderReportEditor.jsx';
import { LeaderChangePassword } from './pages/leader/LeaderChangePassword.jsx';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LeaderAuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<PublicSchedule />} />
              <Route path="/admin/login" element={<AdminLogin />} />

              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/admin/personas" replace />} />
                <Route path="personas" element={<PeopleManager />} />
                <Route path="equipos" element={<TeamGenerator />} />
                <Route path="eventos" element={<EventsManager />} />
                <Route path="uniformes" element={<UniformsManager />} />
                <Route path="asistencia" element={<AttendanceManager />} />
                <Route path="accesos" element={<LeaderAccountsManager />} />
              </Route>

              <Route path="/lider/login" element={<LeaderLogin />} />
              <Route
                path="/lider"
                element={
                  <LeaderProtectedRoute>
                    <LeaderLayout />
                  </LeaderProtectedRoute>
                }
              >
                <Route index element={<LeaderServices />} />
                <Route path="clave" element={<LeaderChangePassword />} />
                <Route path="reportes/:reportId" element={<LeaderReportEditor />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </LeaderAuthProvider>
      </AuthProvider>
      <ToastViewport />
    </ThemeProvider>
  );
}

export default App;
