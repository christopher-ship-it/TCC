import type React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore } from './store/StoreContext';
import LoginPage from './pages/LoginPage';
import Launcher from './pages/agent/Launcher';
import Workspace from './pages/agent/Workspace';
import AgentTelephony from './components/agent/AgentTelephony';
import TeamPerformance from './pages/supervisor/TeamPerformance';
import TeamAccess from './pages/supervisor/TeamAccess';
import Allocation from './pages/supervisor/Allocation';
import Escalations from './pages/supervisor/Escalations';
import Dashboard from './pages/owner/Dashboard';
import Geography from './pages/owner/Geography';
import type { Role } from './data/types';

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { currentAgent, ready } = useStore();
  if (!ready) return <LoadingScreen />;
  if (!currentAgent) return <Navigate to="/" replace />;
  if (!roles.includes(currentAgent.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--color-neutral-700)', fontSize: 13 }}>
      Connecting to TCC…
    </div>
  );
}

function Routed() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/launcher" element={<RequireRole roles={['agent']}><Launcher /></RequireRole>} />
      <Route path="/work/:appId" element={<RequireRole roles={['agent']}><AgentTelephony><Workspace /></AgentTelephony></RequireRole>} />
      <Route path="/supervisor" element={<RequireRole roles={['supervisor']}><TeamPerformance /></RequireRole>} />
      <Route path="/supervisor/team" element={<RequireRole roles={['supervisor']}><TeamAccess /></RequireRole>} />
      <Route path="/supervisor/allocation" element={<RequireRole roles={['supervisor']}><Allocation /></RequireRole>} />
      <Route path="/supervisor/escalations" element={<RequireRole roles={['supervisor']}><Escalations /></RequireRole>} />
      <Route path="/owner" element={<RequireRole roles={['admin']}><Dashboard /></RequireRole>} />
      <Route path="/owner/geography" element={<RequireRole roles={['admin']}><Geography /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
    </StoreProvider>
  );
}
