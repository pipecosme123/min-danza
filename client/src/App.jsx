import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { ToastViewport } from './components/ui/Toast.jsx';

import { PublicSchedule } from './pages/PublicSchedule.jsx';
import { AdminLogin } from './pages/AdminLogin.jsx';
import { AdminDashboard } from './pages/AdminDashboard.jsx';
import { PeopleManager } from './pages/PeopleManager.jsx';
import { TeamGenerator } from './pages/TeamGenerator.jsx';
import { EventsManager } from './pages/EventsManager.jsx';
import { SpecialSaturdayManager } from './pages/SpecialSaturdayManager.jsx';
import { UniformsManager } from './pages/UniformsManager.jsx';
import { NotFound } from './pages/NotFound.jsx';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
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
              <Route path="sabado-especial" element={<SpecialSaturdayManager />} />
              <Route path="uniformes" element={<UniformsManager />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <ToastViewport />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
