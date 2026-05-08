import React from 'react';
import { Routes, Route } from 'react-router-dom';

import Login from './Login';
import Home from './HomeShellFixed';
import Cadastro from './Cadastro';
import Dashboard from './Dashboard';
import DashboardManagement from './DashboardManagement';
import BI from './BI';
import Register from './Register';
import Profile from './Profile';
import ComplaintDetail from './ComplaintDetail';
import MarketingIntake from './MarketingIntakePage';
import NpsSurveyPage from './NpsSurveyPage';
import NpsManagement from './NpsManagement';
import NpsDashboard from './NpsDashboard';
import AdminPanel from './AdminPanel';
import MasterMonitoring from './MasterMonitoring';
import PatientManagement from './PatientManagementPage';
import CrmWorkspace from './CrmWorkspace';
import { PermissionRoute, ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute';
import './App.css';

function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/" element={<Login />} />
      </Route>
      <Route path="/primeiro-cadastro" element={<Register />} />
      <Route path="/marketing" element={<MarketingIntake />} />
      <Route path="/registro-marketing" element={<MarketingIntake />} />
      <Route path="/pesquisa-nps" element={<NpsSurveyPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<PermissionRoute permission="home" />}>
          <Route path="/home" element={<Home />} />
          <Route path="/perfil" element={<Profile />} />
        </Route>
        <Route element={<PermissionRoute permission="complaints_register" />}>
          <Route path="/cadastro" element={<Cadastro />} />
        </Route>
        <Route element={<PermissionRoute permission="complaints_management" />}>
          <Route path="/gestao" element={<DashboardManagement />} />
          <Route path="/gestao/:id" element={<ComplaintDetail />} />
        </Route>
        <Route element={<PermissionRoute permission="complaints_dashboard" />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/bi" element={<BI />} />
        </Route>
        <Route element={<PermissionRoute permission="nps_management" />}>
          <Route path="/gestao-nps" element={<NpsManagement />} />
        </Route>
        <Route element={<PermissionRoute permission="nps_dashboard" />}>
          <Route path="/dashboard-nps" element={<NpsDashboard />} />
        </Route>
        <Route element={<PermissionRoute permission="crm_relationship" />}>
          <Route path="/crm" element={<CrmWorkspace />} />
        </Route>
        <Route element={<PermissionRoute masterOnly />}>
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/admin/monitoria" element={<MasterMonitoring />} />
        </Route>
        <Route element={<PermissionRoute permission="patient_management" />}>
          <Route path="/pacientes" element={<PatientManagement />} />
          <Route path="/pacientes/cadastro" element={<PatientManagement />} />
          <Route path="/pacientes/dashboard" element={<PatientManagement />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
