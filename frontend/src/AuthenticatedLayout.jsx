import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { hasPermission, isMasterAdmin, normalizeRoleValue, readUser } from './constants';
import { clearSession } from './session';
import './AuthenticatedLayout.css';

function Icon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'dashboard') {
    return <svg {...common}><path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" /></svg>;
  }
  if (name === 'complaints') {
    return <svg {...common}><path d="M6 4h9l5 5v11H6z" /><path d="M15 4v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
  }
  if (name === 'nps') {
    return <svg {...common}><path d="M4 18 9.5 12.5l4 4L20 8" /><path d="M16 8h4v4" /></svg>;
  }
  if (name === 'patients') {
    return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
  if (name === 'clinics') {
    return <svg {...common}><path d="M4 20V8l8-4 8 4v12" /><path d="M9 20v-6h6v6" /><path d="M9 10h.01M15 10h.01" /></svg>;
  }
  if (name === 'whatsapp') {
    return <svg {...common}><path d="M20 11.5A8.5 8.5 0 0 1 7.4 19l-3.4 1 1.1-3.2A8.5 8.5 0 1 1 20 11.5Z" /><path d="M9 9.5c.4 2 2 3.6 4 4" /></svg>;
  }
  if (name === 'reports') {
    return <svg {...common}><path d="M5 19V5" /><path d="M10 19V9" /><path d="M15 19v-6" /><path d="M20 19V7" /></svg>;
  }
  if (name === 'settings') {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-.4-1.08 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.9a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.08-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6c.39 0 .76-.14 1-.4.26-.27.4-.64.4-1.01V3a2 2 0 1 1 4 0v.09c0 .38.14.75.4 1.01.24.26.61.4 1 .4a1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .39.14.76.4 1 .27.26.64.4 1.01.4H21a2 2 0 1 1 0 4h-.09c-.38 0-.75.14-1.01.4-.26.24-.4.61-.4 1Z" /></svg>;
  }
  if (name === 'users') {
    return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
  if (name === 'logout') {
    return <svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
}

function canOpenWeeklyComplaintReport(user) {
  if (isMasterAdmin(user)) return true;
  return ['admin', 'supervisor_crc', 'sac_operator', 'manager'].includes(normalizeRoleValue(user?.role));
}

function buildMenuItems(user) {
  const master = isMasterAdmin(user);
  const items = [
    { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/home', visible: hasPermission(user, 'home') },
    { key: 'complaints', label: 'Reclamações', icon: 'complaints', path: '/gestao', visible: hasPermission(user, 'complaints_management') || hasPermission(user, 'complaints_register') || hasPermission(user, 'complaints_dashboard') },
    { key: 'nps', label: 'NPS', icon: 'nps', path: '/gestao-nps', visible: hasPermission(user, 'nps_management') || hasPermission(user, 'nps_dashboard') },
    { key: 'patients', label: 'Pacientes', icon: 'patients', path: '/pacientes', visible: hasPermission(user, 'patient_management') },
    { key: 'clinics', label: 'Clínicas', icon: 'clinics', path: '', visible: true, disabled: true, helper: 'Em preparação' },
    { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', path: '/home/whatsapp-management/dashboard', visible: hasPermission(user, 'whatsapp_management') || ['crc_leader', 'crc_manager', 'crc_operator', 'admin', 'supervisor_crc', 'sac_operator'].includes(normalizeRoleValue(user?.role)) },
    { key: 'reports', label: 'Relatórios', icon: 'reports', path: '/gestao/relatorio-semanal', visible: canOpenWeeklyComplaintReport(user) && hasPermission(user, 'complaints_management') },
    { key: 'settings', label: 'Configurações', icon: 'settings', path: master ? '/admin/configuracoes/whatsapp' : '/perfil', visible: master || hasPermission(user, 'home') },
    { key: 'users', label: 'Usuários', icon: 'users', path: '/admin', visible: master || hasPermission(user, 'admin_panel') },
    { key: 'logout', label: 'Sair', icon: 'logout', action: 'logout', visible: true, danger: true }
  ];
  return items.filter((item) => item.visible);
}

function matchPath(pathname, targetPath) {
  if (!targetPath) return false;
  if (pathname === targetPath) return true;
  return pathname.startsWith(`${targetPath}/`);
}

export default function AuthenticatedLayout({ remainingMsLabel, remainingWarning = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useMemo(() => readUser(), []);
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuItems = useMemo(() => buildMenuItems(user), [user]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = () => {
    clearSession();
    navigate('/', { replace: true });
  };

  const handleAction = (item) => {
    if (item.disabled) return;
    if (item.action === 'logout') {
      handleLogout();
      return;
    }
    if (item.path) {
      navigate(item.path);
    }
  };

  const isOpen = expanded || mobileOpen;

  return (
    <div className={`auth-shell ${isOpen ? 'expanded' : 'collapsed'} ${mobileOpen ? 'mobile-open' : ''}`}>
      <aside
        className="app-sidebar"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <div className="app-sidebar-top">
          <button
            type="button"
            className="app-sidebar-mobile-toggle"
            onClick={() => setMobileOpen((current) => !current)}
            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="app-sidebar-brand">
            <div className="app-sidebar-brand-mark">GS</div>
            <div className="app-sidebar-brand-copy">
              <strong>Grupo Sorria</strong>
              <span>Painel administrativo</span>
            </div>
          </div>
        </div>

        <nav className="app-sidebar-nav" aria-label="Menu principal do sistema">
          {menuItems.map((item) => {
            const active = item.path ? matchPath(location.pathname, item.path) : false;
            return (
              <button
                key={item.key}
                type="button"
                className={`app-sidebar-link ${active ? 'active' : ''} ${item.danger ? 'danger' : ''}`}
                onClick={() => handleAction(item)}
                disabled={item.disabled}
                title={item.disabled ? `${item.label} - ${item.helper || 'Indisponível'}` : item.label}
              >
                <span className="app-sidebar-icon"><Icon name={item.icon} /></span>
                <span className="app-sidebar-label-wrap">
                  <span className="app-sidebar-label">{item.label}</span>
                  {item.helper ? <small>{item.helper}</small> : null}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <div className={`app-sidebar-session ${remainingWarning ? 'warning' : ''}`}>
            <span className="app-sidebar-session-icon" />
            <div className="app-sidebar-session-copy">
              <strong>{remainingMsLabel}</strong>
              <span>sessão ativa</span>
            </div>
          </div>
        </div>
      </aside>

      <div
        className={`app-sidebar-backdrop ${isOpen ? 'visible' : ''}`}
        onClick={() => {
          setExpanded(false);
          setMobileOpen(false);
        }}
      />

      <div className="auth-shell-content">
        <Outlet />
      </div>
    </div>
  );
}
