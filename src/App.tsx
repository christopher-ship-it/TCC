import type React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore } from './store/StoreContext';
import { ToastProvider } from './ui/toast';
import AppShell from './shell/AppShell';
import { AgentCallSession } from './components/telephony/CallSession';
import LoginPage from './pages/LoginPage';
import Today from './pages/agent/Today';
import Workspace from './pages/agent/Workspace';
import Calls from './pages/Calls';
import CustomerPage from './pages/CustomerPage';
import Customers from './pages/Customers';
import Notes from './pages/Notes';
import FollowUps from './pages/FollowUps';
import CallDetail from './pages/CallDetail';
import TeamPerformance from './pages/team/TeamPerformance';
import Escalations from './pages/team/Escalations';
import Allocation from './pages/team/Allocation';
import People from './pages/admin/People';
import AuditLog from './pages/admin/AuditLog';
import CustomerImport from './pages/admin/CustomerImport';
import Overview from './pages/owner/Overview';
import Home from './pages/Overview';
import AgentDetail from './pages/team/AgentDetail';
import NewInstalls from './pages/team/NewInstalls';
import Geography from './pages/owner/Geography';
import System from './pages/admin/System';
import ApiDocs from './pages/admin/ApiDocs';
import AiAccuracy from './pages/admin/AiAccuracy';
import type { Role } from './data/types';
import { isActive } from './lib/access';
import { homeFor } from './lib/routes';

function LoadingScreen() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Connecting to Command Center…</div>;
}

/** Signed in and not suspended — then the agent's phone line wraps every page so calls survive navigation. */
function Protected() {
  const { currentAgent, ready, product } = useStore();
  if (!ready) return <LoadingScreen />;
  // Not signed in, or signed in but not into a product yet: the sign-in page has the product cards.
  if (!currentAgent || !isActive(currentAgent) || !product) return <Navigate to="/" replace />;
  const shell = <AppShell />;
  return currentAgent.role === 'agent' ? <AgentCallSession>{shell}</AgentCallSession> : shell;
}

function Only({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { currentAgent } = useStore();
  if (!currentAgent) return null;
  if (!roles.includes(currentAgent.role)) return <Navigate to={homeFor(currentAgent.role)} replace />;
  return <>{children}</>;
}

/** The Change log can be switched off for client admins by the super admin (System › Visibility). */
function LogGate({ children }: { children: React.ReactNode }) {
  const { currentAgent, visibility } = useStore();
  if (!currentAgent) return null;
  if (!currentAgent.superAdmin && visibility?.changeLog === false) return <Navigate to={homeFor(currentAgent.role)} replace />;
  return <>{children}</>;
}

function SuperOnly({ children }: { children: React.ReactNode }) {
  const { currentAgent } = useStore();
  if (!currentAgent) return null;
  if (!currentAgent.superAdmin) return <Navigate to={homeFor(currentAgent.role)} replace />;
  return <>{children}</>;
}

function Routed() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route path="/home" element={<Only roles={['agent']}><Today /></Only>} />
        <Route path="/work/:appId" element={<Only roles={['agent']}><Workspace /></Only>} />
        <Route path="/calls" element={<Calls />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerPage />} />
        <Route path="/customers/:id/calls/:entryId" element={<CallDetail />} />
        <Route path="/team" element={<Only roles={['supervisor', 'admin']}><Home /></Only>} />
        <Route path="/installs" element={<Only roles={['supervisor', 'admin']}><NewInstalls /></Only>} />
        <Route path="/agents/:id" element={<Only roles={['supervisor', 'admin']}><AgentDetail /></Only>} />
        <Route path="/team/performance" element={<Only roles={['supervisor', 'admin']}><TeamPerformance /></Only>} />
        <Route path="/escalations" element={<Only roles={['supervisor', 'admin']}><Escalations /></Only>} />
        <Route path="/allocation" element={<Only roles={['supervisor', 'admin']}><Allocation /></Only>} />
        <Route path="/people" element={<Only roles={['supervisor', 'admin']}><People /></Only>} />
        <Route path="/audit" element={<Only roles={['supervisor', 'admin']}><LogGate><AuditLog /></LogGate></Only>} />
        <Route path="/customers-import" element={<Only roles={['admin']}><CustomerImport /></Only>} />
        <Route path="/overview" element={<Only roles={['admin']}><Home /></Only>} />
        <Route path="/overview/business" element={<Only roles={['admin']}><Overview /></Only>} />
        <Route path="/system" element={<SuperOnly><System /></SuperOnly>} />
        <Route path="/system/api" element={<SuperOnly><ApiDocs /></SuperOnly>} />
        <Route path="/system/ai" element={<SuperOnly><AiAccuracy /></SuperOnly>} />
        <Route path="/geography" element={<Only roles={['admin']}><Geography /></Only>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <HashRouter>
          <Routed />
        </HashRouter>
      </ToastProvider>
    </StoreProvider>
  );
}
