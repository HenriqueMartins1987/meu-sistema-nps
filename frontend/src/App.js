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
import PatientManagement from './PatientManagementPage';
import './App.css';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/primeiro-cadastro" element={<Register />} />
      <Route path="/home" element={<Home />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/gestao" element={<DashboardManagement />} />
      <Route path="/gestao/:id" element={<ComplaintDetail />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/bi" element={<BI />} />
      <Route path="/perfil" element={<Profile />} />
      <Route path="/marketing" element={<MarketingIntake />} />
      <Route path="/registro-marketing" element={<MarketingIntake />} />
      <Route path="/pesquisa-nps" element={<NpsSurveyPage />} />
      <Route path="/gestao-nps" element={<NpsManagement />} />
      <Route path="/dashboard-nps" element={<NpsDashboard />} />
      <Route path="/admin" element={<AdminPanel />} />
      <Route path="/pacientes" element={<PatientManagement />} />
      <Route path="/pacientes/dashboard" element={<PatientManagement />} />
    </Routes>
  );
}

export default App;
