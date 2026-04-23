import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import logo from './assets/logo3.png';
import { hasPermission, isAdmin, isMasterAdmin, readUser } from './constants';
import { clearSession, updateStoredUser } from './session';

const notificationTypeLabels = {
  complaint_assigned: 'Protocolo',
  complaint_operational_alert: 'Alerta operacional',
  complaint_created: 'Novo protocolo',
  password_reset: 'Senha',
  registration_request: 'Cadastro',
  registration_approved: 'Cadastro',
  registration_rejected: 'Cadastro',
  nps_detractor_assigned: 'NPS detrator',
  nps_duplicate_phone: 'Alerta NPS'
};

const notificationPayloadLabels = {
  protocol: 'Protocolo',
  complaintId: 'Código da reclamação',
  npsId: 'Código da pesquisa NPS',
  interactionId: 'Código do atendimento',
  patientName: 'Paciente',
  patient_name: 'Paciente',
  clinicName: 'Clínica',
  clinic_name: 'Clínica',
  coordinatorName: 'Coordenador',
  coordinator_name: 'Coordenador',
  actorName: 'Usuário',
  actor_name: 'Usuário',
  score: 'Nota',
  source: 'Origem',
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reason: 'Motivo',
  status: 'Status',
  role: 'Perfil'
};

function parseNotificationPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;

  try {
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

function truncateText(value, limit = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Sem detalhes adicionais.';
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function formatNotificationDate(value) {
  if (!value) return '';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function notificationBadge(notification) {
  return notificationTypeLabels[notification.type] || 'Notificação';
}

function notificationSummary(notification) {
  const payload = parseNotificationPayload(notification.payload);
  const protocol = payload?.protocol;

  if (protocol) {
    return truncateText(`${protocol} - ${notification.message || notification.title}`);
  }

  return truncateText(notification.message || notification.title);
}

function formatNotificationPayloadValue(value) {
  if (value === null || value === undefined || value === '') return 'Não informado';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
}

function formatNotificationPayloadKey(key) {
  if (notificationPayloadLabels[key]) {
    return notificationPayloadLabels[key];
  }

  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function buildNotificationDetails(notification) {
  const payload = parseNotificationPayload(notification?.payload);

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const hiddenKeys = new Set(['link']);

  return Object.entries(payload)
    .filter(([key, value]) => !hiddenKeys.has(key) && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      label: formatNotificationPayloadKey(key),
      value: formatNotificationPayloadValue(value)
    }));
}

function formatDateTime(value) {
  if (!value) return 'Não informado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function complaintAgendaTone(item) {
  const dueAt = item?.due_at ? new Date(item.due_at) : null;

  if (!dueAt || Number.isNaN(dueAt.getTime())) return 'neutral';

  const diffMs = dueAt.getTime() - Date.now();

  if (diffMs < 0) return 'danger';
  if (diffMs <= 24 * 60 * 60 * 1000) return 'warning';
  return 'brand';
}

function HomeShellFixed() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const adminUser = isAdmin(user);
  const masterUser = isMasterAdmin(user);
  const canManageComplaints = hasPermission(user, 'complaints_management');
  const canManagePatients = hasPermission(user, 'patient_management');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState('unread');
  const [notificationGroups, setNotificationGroups] = useState({ unread: [], read: [] });
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [registrationRequests, setRegistrationRequests] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(user?.mustChangePassword));
  const [agendaItems, setAgendaItems] = useState([]);
  const [agendaAlerts, setAgendaAlerts] = useState([]);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaAlertOpen, setAgendaAlertOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });

  const npsLink = `${window.location.origin}/pesquisa-nps`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(npsLink)}`;

  const menuSections = useMemo(() => ([
    {
      title: 'Reclamações',
      items: [
        { label: 'Novo Protocolo', path: '/cadastro', permission: 'complaints_register' },
        { label: 'Painel de Gestão de Reclamações', path: '/gestao', permission: 'complaints_management' },
        { label: 'Dashboard de Reclamações', path: '/dashboard', permission: 'complaints_dashboard' }
      ]
    },
    {
      title: 'NPS',
      items: [
        { label: 'Painel de Gestão NPS', path: '/gestao-nps', permission: 'nps_management' },
        { label: 'Dashboard NPS', path: '/dashboard-nps', permission: 'nps_dashboard' },
        { label: 'Pesquisa NPS pública', path: '/pesquisa-nps', permission: 'nps_management' }
      ]
    },
    {
      title: 'Pacientes',
      items: [
        { label: 'Gestão do Paciente', path: '/pacientes', permission: 'patient_management' },
        { label: 'Dashboard do Paciente', path: '/pacientes/dashboard', permission: 'patient_management' }
      ]
    },
    {
      title: 'Relacionamento',
      items: [
        { label: 'CRM de Relacionamento', path: '/crm', permission: 'home' }
      ]
    },
    {
      title: 'Administração',
      items: [
        { label: 'Painel Gerencial', path: '/admin', permission: 'admin_panel', adminOnly: true },
        { label: 'Minha conta', path: '/perfil', permission: 'home' }
      ]
    }
  ]), []);

  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (!item.adminOnly || adminUser) && hasPermission(user, item.permission))
    }))
    .filter((section) => section.items.length);

  const loadNotifications = useCallback(async () => {
    try {
      const [unreadRes, readRes, registrationRes] = await Promise.all([
        api.get('/notifications?status=unread&limit=30'),
        api.get('/notifications?status=read&limit=500'),
        masterUser ? api.get('/admin/registration-requests?status=pendente') : Promise.resolve({ data: [] })
      ]);

      setNotificationGroups({
        unread: Array.isArray(unreadRes.data) ? unreadRes.data : [],
        read: Array.isArray(readRes.data) ? readRes.data : []
      });
      setRegistrationRequests(Array.isArray(registrationRes.data) ? registrationRes.data : []);

      if (Array.isArray(unreadRes.data) && unreadRes.data.some((item) => item.type === 'password_reset')) {
        setMustChangePassword(true);
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar as notificações.');
    }
  }, [masterUser]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!notificationGroups.unread.some((item) => item.type === 'nps_duplicate_phone')) {
      return;
    }

    setNotificationsOpen(true);
    setNotificationTab('unread');
  }, [notificationGroups.unread]);

  const loadAgenda = useCallback(async () => {
    if (!canManageComplaints && !canManagePatients) {
      setAgendaItems([]);
      setAgendaAlerts([]);
      return;
    }

    setAgendaLoading(true);

    try {
      const [complaintsRes, patientsRes] = await Promise.all([
        canManageComplaints ? api.get('/complaints') : Promise.resolve({ data: [] }),
        canManagePatients ? api.get('/patient-interactions') : Promise.resolve({ data: [] })
      ]);

      const complaints = Array.isArray(complaintsRes.data) ? complaintsRes.data : [];
      const patientInteractions = Array.isArray(patientsRes.data) ? patientsRes.data : [];
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);

      const complaintAgenda = complaints
        .filter((item) => item.status !== 'resolvida' && item.due_at)
        .map((item) => {
          const dueAt = new Date(item.due_at);

          if (Number.isNaN(dueAt.getTime())) return null;

          const tone = complaintAgendaTone(item);

          return {
            key: `complaint-${item.id}`,
            type: 'Reclamação',
            title: item.protocol || `GRC-${item.id}`,
            description: `${item.patient_name || 'Paciente'} · ${item.clinic_name || 'Unidade não informada'}`,
            detail: tone === 'danger'
              ? `Prazo vencido desde ${formatDateTime(item.due_at)}`
              : tone === 'warning'
                ? `Prazo próximo: ${formatDateTime(item.due_at)}`
                : `Prazo em ${formatDateTime(item.due_at)}`,
            when: dueAt.getTime(),
            tone,
            urgent: tone === 'danger' || tone === 'warning',
            link: `/gestao/${item.id}`
          };
        })
        .filter(Boolean);

      const patientAgenda = patientInteractions
        .filter((item) => item.status !== 'Cancelado' && item.scheduledAt)
        .map((item) => {
          const scheduledAt = new Date(item.scheduledAt);

          if (Number.isNaN(scheduledAt.getTime())) return null;
          if (scheduledAt.toISOString().slice(0, 10) !== todayKey) return null;

          return {
            key: `patient-${item.id}`,
            type: 'Paciente',
            title: item.protocol || `PAC-${item.id}`,
            description: `${item.patient || 'Paciente'} · ${item.clinic || 'Unidade não informada'}`,
            detail: `Agenda de hoje às ${formatDateTime(item.scheduledAt)}`,
            when: scheduledAt.getTime(),
            tone: 'teal',
            urgent: false,
            link: `/pacientes?abrir=${item.id}`
          };
        })
        .filter(Boolean);

      const nextAgenda = [...complaintAgenda, ...patientAgenda]
        .sort((a, b) => {
          const priorityA = a.urgent ? 0 : 1;
          const priorityB = b.urgent ? 0 : 1;
          if (priorityA !== priorityB) return priorityA - priorityB;
          return a.when - b.when;
        })
        .slice(0, 8);

      const nextAlerts = complaintAgenda.filter((item) => item.urgent).slice(0, 4);

      setAgendaItems(nextAgenda);
      setAgendaAlerts(nextAlerts);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a agenda operacional.');
    } finally {
      setAgendaLoading(false);
    }
  }, [canManageComplaints, canManagePatients]);

  useEffect(() => {
    loadAgenda();
  }, [loadAgenda]);

  useEffect(() => {
    if (!agendaAlerts.length) return;

    const alertKey = agendaAlerts.map((item) => item.key).join('|');

    if (sessionStorage.getItem('home-agenda-alert') === alertKey) return;

    sessionStorage.setItem('home-agenda-alert', alertKey);
    setAgendaAlertOpen(true);
  }, [agendaAlerts]);

  const totalAlerts = notificationGroups.unread.length + registrationRequests.length;
  const visibleNotifications = notificationTab === 'read' ? notificationGroups.read : notificationGroups.unread;
  const shareText = `Pesquisa de Satisfação Grupo Sorria: ${npsLink}`;
  const selectedNotificationDetails = useMemo(
    () => buildNotificationDetails(selectedNotification),
    [selectedNotification]
  );

  const openNotificationsModal = () => {
    setDrawerOpen(false);
    setShareOpen(false);
    setSelectedNotification(null);
    setNotificationsOpen(true);
  };

  const closeNotificationsModal = () => {
    setNotificationsOpen(false);
  };

  const openShareModal = () => {
    setDrawerOpen(false);
    setNotificationsOpen(false);
    setSelectedNotification(null);
    setShareOpen(true);
  };

  const closeShareModal = () => {
    setShareOpen(false);
  };

  const handleNavigate = (path) => {
    setDrawerOpen(false);
    setShareOpen(false);
    setNotificationsOpen(false);
    setSelectedNotification(null);
    navigate(path);
  };

  const handleRegistrationDecision = async (id, decision) => {
    setFeedback('');

    try {
      await api.post(`/admin/registration-requests/${id}/${decision}`);
      await loadNotifications();
      setFeedback(decision === 'approve' ? 'Cadastro aprovado.' : 'Cadastro rejeitado.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível analisar o cadastro.');
    }
  };

  const handleShareNps = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Pesquisa de Satisfação',
          text: 'Responda nossa pesquisa de satisfação.',
          url: npsLink
        });
        closeShareModal();
        return;
      }

      await navigator.clipboard.writeText(npsLink);
      setFeedback('Link da pesquisa copiado para compartilhamento.');
      closeShareModal();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setFeedback('Não foi possível compartilhar a pesquisa agora.');
      }
    }
  };

  const handleCopyNpsLink = async () => {
    try {
      await navigator.clipboard.writeText(npsLink);
      setFeedback('Link da pesquisa copiado.');
      closeShareModal();
    } catch (error) {
      setFeedback('Não foi possível copiar o link da pesquisa.');
    }
  };

  const openNpsSurveyPopup = () => {
    const width = 560;
    const height = 820;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    const popup = window.open(
      npsLink,
      'pesquisa-nps-popup',
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      window.location.assign(npsLink);
      return;
    }

    popup.focus();
  };

  const resolveNotificationLink = (notification) => {
    if (notification?.link) return notification.link;

    const payload = parseNotificationPayload(notification?.payload);

    if (payload?.complaintId) return `/gestao/${payload.complaintId}`;
    if (payload?.npsId) return `/gestao-nps?abrir=${payload.npsId}`;
    if (payload?.interactionId) return `/pacientes?abrir=${payload.interactionId}`;
    if (notification?.type === 'password_reset') return '/perfil';
    if (String(notification?.type || '').startsWith('registration_')) return '/admin';
    return '/home';
  };

  const openNotification = async (notification) => {
    let nextNotification = notification;

    try {
      if (notification.status !== 'read') {
        await api.post(`/notifications/${notification.id}/read`);
        nextNotification = { ...notification, status: 'read', read_at: new Date().toISOString() };
        setNotificationGroups((prev) => ({
          unread: prev.unread.filter((item) => item.id !== notification.id),
          read: [nextNotification, ...prev.read]
            .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
            .slice(0, 500)
        }));
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível abrir a notificação.');
    }

    setNotificationsOpen(false);
    setSelectedNotification(nextNotification);
  };

  const handleNotificationTarget = () => {
    if (!selectedNotification) return;

    const target = resolveNotificationLink(selectedNotification);
    setSelectedNotification(null);

    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }

    navigate(target);
  };

  const handleDeleteNotification = async (notificationId) => {
    try {
      await api.delete(`/notifications/${notificationId}`);
      setNotificationGroups((prev) => ({
        unread: prev.unread.filter((item) => item.id !== notificationId),
        read: prev.read.filter((item) => item.id !== notificationId)
      }));
      setFeedback('Notificação removida do histórico.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir a notificação.');
    }
  };

  const updatePasswordField = (field, value) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleForcedPasswordChange = async (event) => {
    event.preventDefault();
    setFeedback('');

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setFeedback('A confirmação da nova senha não confere.');
      return;
    }

    try {
      await api.post('/profile/change-password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password
      });

      await Promise.all(
        notificationGroups.unread
          .filter((notification) => notification.type === 'password_reset')
          .map((notification) => api.post(`/notifications/${notification.id}/read`))
      );

      const updatedUser = { ...(user || {}), mustChangePassword: false };
      updateStoredUser(updatedUser);
      setNotificationGroups((prev) => ({
        unread: prev.unread.filter((notification) => notification.type !== 'password_reset'),
        read: prev.read
      }));
      setMustChangePassword(false);
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setFeedback('Senha alterada com sucesso.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível alterar a senha.');
    }
  };

  return (
    <main className="app-page">
      <header className="topbar home-command-bar">
        <div className="home-brand-zone">
          <div className="brand-mark">
            <img src={logo} alt="GRC Consultoria Empresarial" />
          </div>
          <button className="ghost-action menu-trigger home-menu-top" onClick={() => setDrawerOpen(true)}>
            Menu
          </button>
        </div>

        <div className="home-command-actions">
          <div className="home-account-row">
            {adminUser && (
              <button type="button" className="gear-action" onClick={() => navigate('/admin')} aria-label="Painel gerencial">
                ⚙
              </button>
            )}
            <button type="button" className="notification-button" onClick={openNotificationsModal}>
              <span className="bell-icon" aria-hidden="true">🔔</span>
              <span className="sr-only">Notificações</span>
              <strong>{totalAlerts}</strong>
            </button>
            <button type="button" className="ghost-action account-action" onClick={() => navigate('/perfil')}>
              Minha conta
            </button>
            <button
              type="button"
              className="outline-action"
              onClick={() => {
                clearSession();
                navigate('/');
              }}
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {mustChangePassword && (
        <div className="modal-backdrop forced-password-backdrop" role="dialog" aria-modal="true">
          <form className="modal-panel forced-password-modal" onSubmit={handleForcedPasswordChange}>
            <p className="eyebrow">Segurança</p>
            <h2>Altere sua senha para continuar</h2>
            <p>Sua senha foi reiniciada. Por segurança, o acesso ao sistema só será liberado após cadastrar uma nova senha forte.</p>

            <label>
              Senha atual
              <input className="field" type="password" value={passwordForm.current_password} onChange={(event) => updatePasswordField('current_password', event.target.value)} autoComplete="current-password" required />
            </label>

            <label>
              Nova senha
              <input className="field" type="password" value={passwordForm.new_password} onChange={(event) => updatePasswordField('new_password', event.target.value)} autoComplete="new-password" required />
            </label>

            <label>
              Confirmar nova senha
              <input className="field" type="password" value={passwordForm.confirm_password} onChange={(event) => updatePasswordField('confirm_password', event.target.value)} autoComplete="new-password" required />
            </label>

            {feedback && <p className="form-feedback">{feedback}</p>}

            <button className="primary-action" type="submit">Alterar senha</button>
          </form>
        </div>
      )}

      {selectedNotification && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel notification-detail-modal">
            <div className="notification-item-top">
              <span>{notificationBadge(selectedNotification)}</span>
              <small>{formatNotificationDate(selectedNotification.read_at || selectedNotification.created_at)}</small>
            </div>

            <div className="notification-detail-copy">
              <h2>{selectedNotification.title || 'Atualização do sistema'}</h2>
              <p>{selectedNotification.message || notificationSummary(selectedNotification)}</p>
            </div>

            {selectedNotificationDetails.length > 0 && (
              <div className="notification-detail-grid">
                {selectedNotificationDetails.map((detail) => (
                  <article className="notification-detail-row" key={`${detail.label}-${detail.value}`}>
                    <span>{detail.label}</span>
                    <strong>{detail.value}</strong>
                  </article>
                ))}
              </div>
            )}

            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setSelectedNotification(null)}>
                Fechar
              </button>
              <button className="primary-action" type="button" onClick={handleNotificationTarget}>
                Abrir item relacionado
              </button>
            </div>
          </section>
        </div>
      )}

      {notificationsOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel notification-center-modal">
            <div className="notification-head">
              <strong>Notificações</strong>
              <button type="button" className="ghost-action" onClick={loadNotifications}>Atualizar</button>
            </div>

            <div className="notification-tabs">
              <button type="button" className={notificationTab === 'unread' ? 'active' : ''} onClick={() => setNotificationTab('unread')}>
                Não lidas ({totalAlerts})
              </button>
              <button type="button" className={notificationTab === 'read' ? 'active' : ''} onClick={() => setNotificationTab('read')}>
                Lidas ({notificationGroups.read.length})
              </button>
            </div>

            {feedback && <p className="form-feedback">{feedback}</p>}

            {notificationTab === 'unread' && masterUser && registrationRequests.map((request) => (
              <article className="notification-item" key={`request-${request.id}`}>
                <div className="notification-item-top">
                  <span>Cadastro pendente</span>
                  <small>{formatNotificationDate(request.created_at)}</small>
                </div>
                <strong>{request.name}</strong>
                <p>{truncateText(`${request.email} - ${request.position || request.role}`)}</p>
                <div className="notification-actions">
                  <button type="button" className="primary-action" onClick={() => handleRegistrationDecision(request.id, 'approve')}>Aceitar</button>
                  <button type="button" className="outline-action" onClick={() => handleRegistrationDecision(request.id, 'reject')}>Rejeitar</button>
                </div>
              </article>
            ))}

            {visibleNotifications.map((notification) => (
              <article className={`notification-item ${notification.status === 'read' ? 'read' : 'unread'}`} key={notification.id}>
                <div className="notification-item-top">
                  <span>{notificationBadge(notification)}</span>
                  <small>{formatNotificationDate(notification.read_at || notification.created_at)}</small>
                </div>
                <strong>{notification.title || 'Atualização do sistema'}</strong>
                <p>{notificationSummary(notification)}</p>
                <div className="notification-actions">
                  <button type="button" className="outline-action" onClick={() => openNotification(notification)}>
                    {notification.status === 'read' ? 'Abrir novamente' : 'Abrir'}
                  </button>
                  {notification.status === 'read' && (
                    <button type="button" className="outline-action subtle-action" onClick={() => handleDeleteNotification(notification.id)}>
                      Excluir
                    </button>
                  )}
                </div>
              </article>
            ))}

            {notificationTab === 'unread' && totalAlerts === 0 && <p className="empty-mini">Nenhuma nova notificação.</p>}
            {notificationTab === 'read' && notificationGroups.read.length === 0 && <p className="empty-mini">Nenhuma notificação lida no histórico.</p>}

            <div className="row-actions">
              <button type="button" className="outline-action" onClick={closeNotificationsModal}>
                Fechar
              </button>
            </div>
          </section>
        </div>
      )}

      {shareOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel share-modal">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Compartilhar</p>
                <h2>Divulgar pesquisa de satisfação</h2>
                <p className="base-subtitle">Escolha como deseja enviar o link da pesquisa.</p>
              </div>
            </div>

            <div className="share-modal-actions">
              <button type="button" className="primary-action" onClick={handleShareNps}>Compartilhar</button>
              <button type="button" className="outline-action" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer')}>WhatsApp</button>
              <a className="outline-action share-link-action" href={`mailto:?subject=Pesquisa de Satisfação&body=${encodeURIComponent(shareText)}`}>E-mail</a>
              <button type="button" className="outline-action" onClick={handleCopyNpsLink}>
                Copiar link
              </button>
            </div>

            <div className="row-actions">
              <button type="button" className="outline-action" onClick={closeShareModal}>
                Fechar
              </button>
            </div>
          </section>
        </div>
      )}
      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside className="menu-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <p className="eyebrow">Menu</p>
              </div>
              <button className="outline-action" onClick={() => setDrawerOpen(false)}>Fechar</button>
            </div>

            {visibleSections.map((section) => (
              <section className="drawer-section" key={section.title}>
                <h3>{section.title}</h3>
                {section.items.map((item) => (
                  <button key={item.path} onClick={() => handleNavigate(item.path)}>
                    {item.label}
                  </button>
                ))}
              </section>
            ))}
          </aside>
        </div>
      )}

      <section className="home-hero">
        <div className="home-copy">
          <p className="eyebrow">Sistema GRC</p>
          <h1>Gestão profissional da voz do cliente.</h1>
          <p>
            Centralize reclamações, NPS, elogios, sugestões e rotinas do paciente com trilhas separadas,
            permissões por perfil e rastreabilidade executiva.
          </p>
        </div>

        <div className="home-actions">
          {hasPermission(user, 'complaints_register') && (
            <button className="primary-action" onClick={() => navigate('/cadastro')}>Novo Protocolo</button>
          )}
          {hasPermission(user, 'complaints_management') && (
            <button className="secondary-action" onClick={() => navigate('/gestao')}>Painel de Gestão de Reclamações</button>
          )}
          {hasPermission(user, 'complaints_dashboard') && (
            <button className="secondary-action" onClick={() => navigate('/dashboard')}>Dashboard de Reclamações</button>
          )}
          {hasPermission(user, 'nps_management') && (
            <button className="outline-action" onClick={() => navigate('/gestao-nps')}>Painel de Gestão NPS</button>
          )}
          {hasPermission(user, 'nps_dashboard') && (
            <button className="outline-action" onClick={() => navigate('/dashboard-nps')}>Dashboard NPS</button>
          )}
          {hasPermission(user, 'patient_management') && (
            <button className="outline-action" onClick={() => navigate('/pacientes')}>Agendamento de Paciente</button>
          )}
        </div>
      </section>

      <section className="feedback-intake-panel home-qr-panel" aria-label="QR Code NPS">
        <div>
          <p className="eyebrow">Pesquisa de Satisfação</p>
          <h2>QR Code para pesquisa de Satisfação</h2>
          <p>Abra a câmera do celular e leia o código para acessar diretamente a pesquisa.</p>
          <strong className="quick-highlight">{npsLink}</strong>
        </div>

        <div className="qr-code-box">
          <img src={qrCodeUrl} alt="QR Code da pesquisa NPS" />
          <button type="button" className="outline-action" onClick={openNpsSurveyPopup}>Abrir pesquisa NPS</button>
          <button type="button" className="primary-action" onClick={openShareModal}>Compartilhar</button>
        </div>
      </section>

      <section className="management-panel home-agenda-panel" aria-label="Agenda operacional">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Agenda</p>
            <h2>Pendências do dia</h2>
            <p className="base-subtitle">Prazos críticos e agenda operacional para acompanhamento imediato.</p>
          </div>
          <button className="outline-action" type="button" onClick={loadAgenda}>
            Atualizar agenda
          </button>
        </div>

        {agendaLoading ? (
          <p className="empty-state">Carregando pendências do dia...</p>
        ) : agendaItems.length === 0 ? (
          <p className="empty-state">Nenhuma pendência crítica ou agenda do dia disponível.</p>
        ) : (
          <div className="home-agenda-list">
            {agendaItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`home-agenda-item ${item.tone}`}
                onClick={() => navigate(item.link)}
              >
                <div className="home-agenda-item-top">
                  <span>{item.type}</span>
                  <strong>{item.title}</strong>
                </div>
                <p>{item.description}</p>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="quick-grid" aria-label="Atalhos operacionais">
        <article className="quick-card accent-brand">
          <div className="quick-card-head">
            <span className="quick-number">Reclamações</span>
            <span className="quick-tag">Governança</span>
          </div>
          <h2>Gestão de protocolos com alçada e evidências</h2>
          <p>Cadastro, aceite, tratativa, anexos, prazos e histórico por usuário.</p>
          <strong className="quick-highlight">Cada usuário visualiza apenas o que sua alçada permite.</strong>
        </article>

        <article className="quick-card accent-teal">
          <div className="quick-card-head">
            <span className="quick-number">NPS</span>
            <span className="quick-tag">Satisfação</span>
          </div>
          <h2>Promotores, neutros e detratores em trilha própria</h2>
          <p>O detrator pode virar reclamação quando a operação decidir tratar como protocolo SAC.</p>
          <strong className="quick-highlight">A avaliação continua auditável no protocolo NPS.</strong>
        </article>

        <article className="quick-card accent-gold">
          <div className="quick-card-head">
            <span className="quick-number">Pacientes</span>
            <span className="quick-tag">Agenda</span>
          </div>
          <h2>Agendamento do Paciente com protocolo e histórico</h2>
          <p>Cadastre confirmações, agendamentos e reagendamentos com data atual, protocolo próprio e trilha de cancelados.</p>
          {hasPermission(user, 'patient_management') ? (
            <div className="quick-card-actions">
              <button className="primary-action" onClick={() => navigate('/pacientes')}>Cadastrar paciente</button>
              <button className="outline-action" onClick={() => navigate('/pacientes/dashboard')}>Dashboard Pacientes</button>
            </div>
          ) : (
            <strong className="quick-highlight">A rotina fica disponível conforme a alçada do usuário.</strong>
          )}
        </article>

        <article className="quick-card accent-leaf">
          <div className="quick-card-head">
            <span className="quick-number">Admin</span>
            <span className="quick-tag">Alçadas</span>
          </div>
          <h2>Painel gerencial para usuários, telas e unidades</h2>
          <p>Administrador e master ajustam acesso, vínculo com clínicas e status dos colaboradores.</p>
          <strong className="quick-highlight">Links sem permissão deixam de aparecer para o usuário.</strong>
        </article>
      </section>

      {agendaAlertOpen && agendaAlerts.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel agenda-alert-modal">
            <p className="eyebrow">Alertas do dia</p>
            <h2>Existem protocolos com prazo vencido ou próximo do vencimento.</h2>

            <div className="home-agenda-list compact">
              {agendaAlerts.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`home-agenda-item ${item.tone}`}
                  onClick={() => {
                    setAgendaAlertOpen(false);
                    navigate(item.link);
                  }}
                >
                  <div className="home-agenda-item-top">
                    <span>{item.type}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <p>{item.description}</p>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>

            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setAgendaAlertOpen(false)}>
                Fechar
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default HomeShellFixed;


