import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { hasPermission, isMasterAdmin, normalizeRoleValue, readUser } from './constants';
import { clearSession } from './session';
import grcLogo from './assets/logo3.png';
import api from './api';
import './AuthenticatedLayout.css';

function Icon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

  if (name === 'home') return <svg {...common}><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10.5V20h12v-9.5" /><path d="M10 20v-5h4v5" /></svg>;
  if (name === 'agenda') return <svg {...common}><path d="M7 3v4M17 3v4" /><path d="M4 8h16" /><path d="M5 5h14a2 2 0 0 1 2 2v14H3V7a2 2 0 0 1 2-2Z" /><path d="m8 15 2 2 5-5" /></svg>;
  if (name === 'dashboard') return <svg {...common}><path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" /></svg>;
  if (name === 'finance') return <svg {...common}><path d="M4 18 9 13l4 3 7-9" /><path d="M16 7h4v4" /></svg>;
  if (name === 'complaints') return <svg {...common}><path d="M6 4h9l5 5v11H6z" /><path d="M15 4v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
  if (name === 'nps') return <svg {...common}><path d="M4 18 9.5 12.5l4 4L20 8" /><path d="M16 8h4v4" /></svg>;
  if (name === 'patients') return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>;
  if (name === 'clinics') return <svg {...common}><path d="M4 20V8l8-4 8 4v12" /><path d="M9 20v-6h6v6" /><path d="M9 10h.01M15 10h.01" /></svg>;
  if (name === 'whatsapp') return <svg {...common}><path d="M20 11.5A8.5 8.5 0 0 1 7.4 19l-3.4 1 1.1-3.2A8.5 8.5 0 1 1 20 11.5Z" /><path d="M9 9.5c.4 2 2 3.6 4 4" /></svg>;
  if (name === 'reports') return <svg {...common}><path d="M5 19V5" /><path d="M10 19V9" /><path d="M15 19v-6" /><path d="M20 19V7" /></svg>;
  if (name === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-.4-1.08 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.9a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.08-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6c.39 0 .76-.14 1-.4.26-.27.4-.64.4-1.01V3a2 2 0 1 1 4 0v.09c0 .38.14.75.4 1.01.24.26.61.4 1 .4a1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .39.14.76.4 1 .27.26.64.4 1.01.4H21a2 2 0 1 1 0 4h-.09c-.38 0-.75.14-1.01.4-.26.24-.4.61-.4 1Z" /></svg>;
  if (name === 'users') return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>;
  if (name === 'account') return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>;
  if (name === 'logout') return <svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>;

  return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
}

function canOpenWeeklyComplaintReport(user) {
  if (isMasterAdmin(user)) return true;
  return ['admin', 'supervisor_crc', 'sac_operator', 'manager'].includes(normalizeRoleValue(user?.role));
}

function canAccessWhatsApp(user) {
  const role = normalizeRoleValue(user?.role);
  return hasPermission(user, 'whatsapp_management') || ['crc_leader', 'crc_manager', 'crc_operator', 'nps_operator', 'admin', 'supervisor_crc', 'sac_operator'].includes(role);
}

function buildMenuSections(user) {
  const master = isMasterAdmin(user);
  const role = normalizeRoleValue(user?.role);
  const isNpsOperator = role === 'nps_operator';
  const whatsappVisible = canAccessWhatsApp(user);
  const showReports = canOpenWeeklyComplaintReport(user)
    || hasPermission(user, 'complaints_dashboard')
    || hasPermission(user, 'nps_dashboard')
    || hasPermission(user, 'financial_dashboard')
    || whatsappVisible;

  const sections = [
    {
      key: 'agenda',
      label: 'Agenda',
      items: [
        { key: 'agenda', label: 'Agenda', icon: 'agenda', path: '/agenda', exact: true, visible: hasPermission(user, 'home') }
      ]
    },
    {
      key: 'dashboard',
      label: 'Dashboard',
      items: [
        { key: 'home', label: 'Home', icon: 'home', path: '/home', exact: true, visible: hasPermission(user, 'home') },
        { key: 'crc-executive', label: 'Dashboard Executivo CRC', icon: 'dashboard', path: '/home/financial-intelligence', visible: hasPermission(user, 'financial_dashboard') },
        { key: 'crc-campaigns', label: 'Produtividade x Campanha', icon: 'finance', path: '/home/financial-intelligence/campaigns', visible: hasPermission(user, 'financial_campaigns') },
        { key: 'crc-finance', label: 'Gestao Financeira CRC', icon: 'finance', path: '/home/financial-intelligence/manage', visible: hasPermission(user, 'financial_management') }
      ]
    },
    {
      key: 'attendance',
      label: 'Atendimento',
      items: [
        { key: 'new-protocol', label: 'Novo Protocolo', icon: 'complaints', path: '/cadastro', visible: hasPermission(user, 'complaints_register') },
        { key: 'complaints-panel', label: 'Painel de Reclamacoes', icon: 'complaints', path: '/gestao', exact: true, visible: hasPermission(user, 'complaints_management') },
        { key: 'weekly-report', label: 'Relatorio Semanal e Mensal', icon: 'reports', path: '/gestao/relatorio-semanal', visible: canOpenWeeklyComplaintReport(user) && hasPermission(user, 'complaints_management') },
        { key: 'complaints-dashboard', label: 'Dashboard de Reclamacoes', icon: 'dashboard', path: '/dashboard', visible: hasPermission(user, 'complaints_dashboard') }
      ]
    },
    {
      key: 'nps',
      label: 'NPS',
      items: [
        { key: 'nps-management', label: 'Painel de Gestao NPS', icon: 'nps', path: '/gestao-nps', visible: hasPermission(user, 'nps_management') },
        { key: 'nps-dashboard', label: 'Dashboard NPS', icon: 'dashboard', path: '/dashboard-nps', visible: hasPermission(user, 'nps_dashboard') },
        { key: 'nps-survey', label: 'Pesquisas NPS', icon: 'reports', path: '/pesquisa-nps', visible: hasPermission(user, 'nps_management') }
      ]
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      items: [
        { key: 'whatsapp-management', label: 'Gestao WhatsApp CRC', icon: 'whatsapp', path: '/home/whatsapp-management/dashboard', visible: whatsappVisible },
        { key: 'whatsapp-confirmation', label: 'Confirmacao e Agendamento', icon: 'whatsapp', path: '/home/whatsapp-management/confirmation', visible: whatsappVisible && !isNpsOperator && hasPermission(user, 'whatsapp_reports') },
        { key: 'whatsapp-instances', label: 'Sessoes / QR Code', icon: 'settings', path: '/home/whatsapp-management/instances', visible: whatsappVisible && hasPermission(user, 'whatsapp_instances') }
      ]
    },
    {
      key: 'reports',
      label: 'Relatorios',
      items: [
        { key: 'reports-hub', label: 'Central de Relatorios', icon: 'reports', path: '/home/relatorios', visible: showReports }
      ]
    },
    {
      key: 'records',
      label: 'Cadastros',
      items: [
        { key: 'clinics', label: 'Clinicas', icon: 'clinics', path: '', visible: true, disabled: true, helper: 'Em preparacao' },
        { key: 'patients', label: 'Pacientes', icon: 'patients', path: '/pacientes', visible: hasPermission(user, 'patient_management') },
        { key: 'partners', label: 'Parceiros', icon: 'users', path: '/home/whatsapp-management/confirmation?tab=partners', visible: whatsappVisible },
        { key: 'users', label: 'Usuarios', icon: 'users', path: '/admin', visible: master || hasPermission(user, 'admin_panel') }
      ]
    },
    {
      key: 'system',
      label: 'Sistema',
      items: [
        { key: 'settings', label: 'Configuracoes', icon: 'settings', path: master ? '/admin/controle-master' : '/perfil', visible: master || hasPermission(user, 'home') },
        { key: 'account', label: 'Minha Conta', icon: 'account', path: '/perfil', visible: hasPermission(user, 'home') },
        { key: 'logout', label: 'Sair', icon: 'logout', action: 'logout', visible: true, danger: true }
      ]
    }
  ];

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.visible)
    }))
    .filter((section) => section.items.length);
}

function matchPath(pathname, targetPath, exact = false) {
  if (!targetPath) return false;
  const normalizedTargetPath = String(targetPath).split('?')[0];
  if (pathname === normalizedTargetPath) return true;
  return !exact && pathname.startsWith(`${normalizedTargetPath}/`);
}

export default function AuthenticatedLayout({ remainingMsLabel, remainingWarning = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useMemo(() => readUser(), []);
  const sidebarUserName = useMemo(
    () => user?.name || user?.full_name || user?.username || user?.email || 'Usuario logado',
    [user]
  );
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuSections = useMemo(() => buildMenuSections(user), [user]);

  useEffect(() => {
    setMobileOpen(false);
    setExpanded(false);
  }, [location.pathname, location.search]);

  const handleLogout = async () => {
    try {
      await api.post('/logout');
    } catch (error) {
      // O logout local deve continuar funcionando mesmo se a sessao ja expirou no servidor.
    } finally {
      clearSession();
      navigate('/', { replace: true });
    }
  };

  const handleAction = (item) => {
    if (item.disabled) return;
    if (item.action === 'logout') {
      handleLogout();
      return;
    }
    if (item.path) navigate(item.path);
  };

  const isOpen = expanded || mobileOpen;

  return (
    <div className={`auth-shell ${isOpen ? 'expanded' : 'collapsed'} ${mobileOpen ? 'mobile-open' : ''}`}>
      <button
        type="button"
        className="app-sidebar-mobile-trigger"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menu"
      >
        <span />
        <span />
        <span />
      </button>

      <aside
        className="app-sidebar"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <div className="app-sidebar-brand">
          <div className="app-sidebar-brand-mark">GS</div>
          <div className="app-sidebar-brand-copy">
            <strong>Grupo Sorria</strong>
            <span>Painel administrativo</span>
          </div>
        </div>

        <nav className="app-sidebar-nav" aria-label="Menu principal do sistema">
          {menuSections.map((section) => (
            <section className="app-sidebar-section" key={section.key}>
              <p className="app-sidebar-section-title">{section.label}</p>
              <div className="app-sidebar-section-links">
                {section.items.map((item) => {
                  const active = item.path ? matchPath(location.pathname, item.path, item.exact) : false;
                  const title = item.disabled ? `${item.label} - ${item.helper || 'Indisponivel'}` : item.label;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`app-sidebar-link ${active ? 'active' : ''} ${item.danger ? 'danger' : ''}`}
                      onClick={() => handleAction(item)}
                      disabled={item.disabled}
                      title={title}
                      aria-label={title}
                    >
                      <span className="app-sidebar-icon"><Icon name={item.icon} /></span>
                      <span className="app-sidebar-label-wrap">
                        <span className="app-sidebar-label">{item.label}</span>
                        {item.helper ? <small>{item.helper}</small> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-sidebar-powered" title="Powered by GRC Consultoria" aria-label="Powered by GRC Consultoria">
            <span className="app-sidebar-powered-logo">
              <img src={grcLogo} alt="GRC Consultoria" />
            </span>
            <span className="app-sidebar-powered-copy">
              <small>Powered by</small>
              <strong>GRC Consultoria</strong>
            </span>
          </div>
          <div className={`app-sidebar-session ${remainingWarning ? 'warning' : ''}`}>
            <span className="app-sidebar-session-icon" />
            <div className="app-sidebar-session-copy">
              <strong>{remainingMsLabel}</strong>
              <span>sessao ativa</span>
              <strong className="app-sidebar-session-user" title={sidebarUserName}>{sidebarUserName}</strong>
            </div>
          </div>
        </div>
      </aside>

      <div className={`app-sidebar-backdrop ${mobileOpen ? 'visible' : ''}`} onClick={() => setMobileOpen(false)} />

      <main className="auth-shell-content">
        <Outlet />
      </main>
    </div>
  );
}
