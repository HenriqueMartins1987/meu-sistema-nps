import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import logo from './assets/logo3.png';
import { hasPermission, isAdmin, isMasterAdmin, readUser } from './constants';

const notificationTypeLabels = {
  complaint_assigned: 'Protocolo',
  complaint_operational_alert: 'Alerta operacional',
  complaint_created: 'Novo protocolo',
  password_reset: 'Senha',
  registration_request: 'Cadastro',
  registration_approved: 'Cadastro',
  registration_rejected: 'Cadastro',
  nps_detractor_assigned: 'NPS detrator'
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

function HomeShellPage() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const adminUser = isAdmin(user);
  const masterUser = isMasterAdmin(user);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState('unread');
  const [notificationGroups, setNotificationGroups] = useState({ unread: [], read: [] });
  const [registrationRequests, setRegistrationRequests] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(user?.mustChangePassword));
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });

  const npsLink = `${window.location.origin}/pesquisa-nps`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(npsLink)}`;

  const menuSections = useMemo(() => ([
    {
      title: 'Reclamacoes',
      items: [
        { label: 'Novo Protocolo', path: '/cadastro', permission: 'complaints_register' },
        { label: 'Painel de Gestao de Reclamacoes', path: '/gestao', permission: 'complaints_management' },
        { label: 'Dashboard de Reclamacoes', path: '/dashboard', permission: 'complaints_dashboard' }
      ]
    },
    {
      title: 'NPS',
      items: [
        { label: 'Painel de Gestao NPS', path: '/gestao-nps', permission: 'nps_management' },
        { label: 'Dashboard NPS', path: '/dashboard-nps', permission: 'nps_dashboard' },
        { label: 'Pesquisa NPS publica', path: '/pesquisa-nps', permission: 'nps_management' }
      ]
    },
    {
      title: 'Pacientes',
      items: [
        { label: 'Gestao do Paciente', path: '/pacientes', permission: 'patient_management' },
        { label: 'Dashboard do Paciente', path: '/pacientes/dashboard', permission: 'patient_management' }
      ]
    },
    {
      title: 'Administracao',
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
        api.get('/notifications?status=read&limit=200'),
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

  const totalAlerts = notificationGroups.unread.length + registrationRequests.length;
  const visibleNotifications = notificationTab === 'read' ? notificationGroups.read : notificationGroups.unread;
  const shareText = `Pesquisa de Satisfacao Grupo Sorria: ${npsLink}`;

  const handleNavigate = (path) => {
    setDrawerOpen(false);
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
    if (navigator.share) {
      await navigator.share({
        title: 'Pesquisa de Satisfação',
        text: 'Responda nossa pesquisa de satisfação.',
        url: npsLink
      });
      return;
    }

    await navigator.clipboard.writeText(npsLink);
    setFeedback('Link da pesquisa copiado para compartilhamento.');
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

  const openNotification = async (notification) => {
    try {
      if (notification.status !== 'read') {
        await api.post(`/notifications/${notification.id}/read`);
        setNotificationGroups((prev) => ({
          unread: prev.unread.filter((item) => item.id !== notification.id),
          read: [{ ...notification, status: 'read', read_at: new Date().toISOString() }, ...prev.read]
            .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
            .slice(0, 200)
        }));
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível abrir a notificação.');
    }

    if (notification.link) {
      navigate(notification.link);
    }
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
      setFeedback('A confirmacao da nova senha nao confere.');
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
      localStorage.setItem('user', JSON.stringify(updatedUser));
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
              <button className="gear-action" onClick={() => navigate('/admin')} aria-label="Painel gerencial">
                ⚙
              </button>
            )}
            <button className="notification-button" onClick={() => setNotificationsOpen((prev) => !prev)}>
              <span className="bell-icon" aria-hidden="true">🔔</span>
              <span className="sr-only">Notificacoes</span>
              <strong>{totalAlerts}</strong>
            </button>
            <button className="ghost-action account-action" onClick={() => navigate('/perfil')}>
              Minha conta
            </button>
            <button
              className="outline-action"
              onClick={() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                navigate('/');
              }}
            >
              Sair
            </button>
          </div>
        </div>

        {notificationsOpen && (
          <section className="notification-popover">
            <div className="notification-head">
              <strong>Notificacoes</strong>
              <button className="ghost-action" onClick={loadNotifications}>Atualizar</button>
            </div>

            <div className="notification-tabs">
              <button type="button" className={notificationTab === 'unread' ? 'active' : ''} onClick={() => setNotificationTab('unread')}>
                Nao lidas ({totalAlerts})
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
                  <button className="primary-action" onClick={() => handleRegistrationDecision(request.id, 'approve')}>Aceitar</button>
                  <button className="outline-action" onClick={() => handleRegistrationDecision(request.id, 'reject')}>Rejeitar</button>
                </div>
              </article>
            ))}

            {visibleNotifications.map((notification) => (
              <article className={`notification-item ${notification.status === 'read' ? 'read' : 'unread'}`} key={notification.id}>
                <div className="notification-item-top">
                  <span>{notificationBadge(notification)}</span>
                  <small>{formatNotificationDate(notification.read_at || notification.created_at)}</small>
                </div>
                <strong>{notification.title || 'Atualizacao do sistema'}</strong>
                <p>{notificationSummary(notification)}</p>
                <div className="notification-actions">
                  <button className="outline-action" onClick={() => openNotification(notification)}>
                    {notification.link ? 'Abrir' : notification.status === 'read' ? 'Ver' : 'Marcar como lida'}
                  </button>
                </div>
              </article>
            ))}

            {notificationTab === 'unread' && totalAlerts === 0 && <p className="empty-mini">Nenhuma nova notificacao.</p>}
            {notificationTab === 'read' && notificationGroups.read.length === 0 && <p className="empty-mini">Nenhuma notificacao lida no historico.</p>}
          </section>
        )}
      </header>

      {mustChangePassword && (
        <div className="modal-backdrop forced-password-backdrop" role="dialog" aria-modal="true">
          <form className="modal-panel forced-password-modal" onSubmit={handleForcedPasswordChange}>
            <p className="eyebrow">Seguranca</p>
            <h2>Altere sua senha para continuar</h2>
            <p>Sua senha foi reiniciada. Por seguranca, o acesso ao sistema so sera liberado apos cadastrar uma nova senha forte.</p>

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
          <h1>Gestao profissional da voz do cliente.</h1>
          <p>
            Centralize reclamacoes, NPS, elogios, sugestoes e rotinas do paciente com trilhas separadas,
            permissoes por perfil e rastreabilidade executiva.
          </p>
        </div>

        <div className="home-actions">
          {hasPermission(user, 'complaints_register') && (
            <button className="primary-action" onClick={() => navigate('/cadastro')}>Novo Protocolo</button>
          )}
          {hasPermission(user, 'complaints_management') && (
            <button className="secondary-action" onClick={() => navigate('/gestao')}>Painel de Gestao de Reclamacoes</button>
          )}
          {hasPermission(user, 'complaints_dashboard') && (
            <button className="secondary-action" onClick={() => navigate('/dashboard')}>Dashboard de Reclamacoes</button>
          )}
          {hasPermission(user, 'nps_management') && (
            <button className="outline-action" onClick={() => navigate('/gestao-nps')}>Painel de Gestao NPS</button>
          )}
          {hasPermission(user, 'nps_dashboard') && (
            <button className="outline-action" onClick={() => navigate('/dashboard-nps')}>Dashboard NPS</button>
          )}
        </div>
      </section>

      <section className="feedback-intake-panel home-qr-panel" aria-label="QR Code NPS">
        <div>
          <p className="eyebrow">Pesquisa de Satisfacao</p>
          <h2>QR Code para pesquisa de Satisfacao</h2>
          <p>Abra a camera do celular e leia o codigo para acessar diretamente a pesquisa.</p>
          <strong className="quick-highlight">{npsLink}</strong>
        </div>

        <div className="qr-code-box">
          <img src={qrCodeUrl} alt="QR Code da pesquisa NPS" />
          <button className="outline-action" onClick={openNpsSurveyPopup}>Abrir pesquisa NPS</button>
          <div className="share-popover-wrap">
            <button className="primary-action" onClick={() => setShareOpen((prev) => !prev)}>Compartilhar</button>
            {shareOpen && (
              <div className="share-popover">
                <button type="button" onClick={handleShareNps}>Compartilhar</button>
                <button type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')}>WhatsApp</button>
                <a href={`mailto:?subject=Pesquisa de Satisfacao&body=${encodeURIComponent(shareText)}`}>E-mail</a>
                <button type="button" onClick={() => navigator.clipboard.writeText(npsLink).then(() => setFeedback('Link da pesquisa copiado.'))}>Copiar link</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="quick-grid" aria-label="Atalhos operacionais">
        <article className="quick-card accent-brand">
          <div className="quick-card-head">
            <span className="quick-number">Reclamacoes</span>
            <span className="quick-tag">Governanca</span>
          </div>
          <h2>Gestao de protocolos com alcada e evidencias</h2>
          <p>Cadastro, aceite, tratativa, anexos, prazos e historico por usuario.</p>
          <strong className="quick-highlight">Cada usuario visualiza apenas o que sua alcada permite.</strong>
        </article>

        <article className="quick-card accent-teal">
          <div className="quick-card-head">
            <span className="quick-number">NPS</span>
            <span className="quick-tag">Satisfacao</span>
          </div>
          <h2>Promotores, neutros e detratores em trilha propria</h2>
          <p>O detrator pode virar reclamacao quando a operacao decidir tratar como protocolo SAC.</p>
          <strong className="quick-highlight">A avaliacao continua auditavel no protocolo NPS.</strong>
        </article>

        <article className="quick-card accent-gold">
          <div className="quick-card-head">
            <span className="quick-number">Pacientes</span>
            <span className="quick-tag">Agenda</span>
          </div>
          <h2>Confirmacao, agendamento e reagendamento</h2>
          <p>Area preparada para registrar os contatos e movimentos do paciente com lastro.</p>
          <strong className="quick-highlight">A rotina fica no menu por permissao.</strong>
        </article>

        <article className="quick-card accent-leaf">
          <div className="quick-card-head">
            <span className="quick-number">Admin</span>
            <span className="quick-tag">Alcadas</span>
          </div>
          <h2>Painel gerencial para usuarios, telas e unidades</h2>
          <p>Administrador e master ajustam acesso, vinculo com clinicas e status dos colaboradores.</p>
          <strong className="quick-highlight">Links sem permissao deixam de aparecer para o usuario.</strong>
        </article>
      </section>
    </main>
  );
}

export default HomeShellPage;
