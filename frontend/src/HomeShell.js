import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import logo from './assets/logo.png';
import { hasPermission, isAdmin, isMasterAdmin, readUser } from './constants';

function HomeShell() {
  const navigate = useNavigate();
  const user = readUser();
  const adminUser = isAdmin(user);
  const masterUser = isMasterAdmin(user);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [registrationRequests, setRegistrationRequests] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const npsLink = `${window.location.origin}/pesquisa-nps`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(npsLink)}`;

  const menuSections = useMemo(() => ([
    {
      title: 'Reclamações',
      items: [
        { label: 'Novo protocolo', path: '/cadastro', permission: 'complaints_register' },
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

  const loadNotifications = async () => {
    try {
      const [notificationRes, registrationRes] = await Promise.all([
        api.get('/notifications'),
        masterUser ? api.get('/admin/registration-requests?status=pendente') : Promise.resolve({ data: [] })
      ]);

      setNotifications(Array.isArray(notificationRes.data) ? notificationRes.data : []);
      setRegistrationRequests(Array.isArray(registrationRes.data) ? registrationRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar as notificações.');
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

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

  const totalAlerts = notifications.length + registrationRequests.length;

  const handleNavigate = (path) => {
    setDrawerOpen(false);
    navigate(path);
  };

  const shareText = `Pesquisa de Satisfação Grupo Sorria: ${npsLink}`;

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

  const openNotification = async (notification) => {
    try {
      await api.post(`/notifications/${notification.id}/read`);
      setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível baixar a notificação.');
    }

    if (notification.link) {
      navigate(notification.link);
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
          <div className="home-notification-row">
            <button className="notification-button" onClick={() => setNotificationsOpen((prev) => !prev)}>
              <span className="bell-icon" aria-hidden="true">🔔</span>
              <span className="sr-only">Notificações</span>
              <strong>{totalAlerts}</strong>
            </button>
          </div>
          <div className="home-account-row">
            {adminUser && (
              <button className="gear-action" onClick={() => navigate('/admin')} aria-label="Painel gerencial">
                ⚙
              </button>
            )}
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
              <strong>Notificações</strong>
              <button className="ghost-action" onClick={loadNotifications}>Atualizar</button>
            </div>

            {feedback && <p className="form-feedback">{feedback}</p>}

            {masterUser && registrationRequests.map((request) => (
              <article className="notification-item" key={request.id}>
                <span>Novo cadastro</span>
                <strong>{request.name}</strong>
                <p>{request.email} · {request.position || request.role}</p>
                <div className="notification-actions">
                  <button className="primary-action" onClick={() => handleRegistrationDecision(request.id, 'approve')}>
                    Aceitar
                  </button>
                  <button className="outline-action" onClick={() => handleRegistrationDecision(request.id, 'reject')}>
                    Rejeitar
                  </button>
                </div>
              </article>
            ))}

            {notifications.map((notification) => (
              <article className="notification-item" key={notification.id}>
                <span>{notification.type}</span>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
                <button className="outline-action" onClick={() => openNotification(notification)}>
                  Abrir
                </button>
              </article>
            ))}

            {totalAlerts === 0 && <p className="empty-mini">Nenhuma nova notificação.</p>}
          </section>
        )}
      </header>

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
            <button className="primary-action" onClick={() => navigate('/cadastro')}>
              Novo Protocolo
            </button>
          )}
          {hasPermission(user, 'complaints_management') && (
            <button className="secondary-action" onClick={() => navigate('/gestao')}>
              Painel de Gestão de Reclamações
            </button>
          )}
          {hasPermission(user, 'nps_management') && (
            <button className="outline-action" onClick={() => navigate('/gestao-nps')}>
              Painel de Gestão NPS
            </button>
          )}
          {hasPermission(user, 'nps_dashboard') && (
            <button className="outline-action" onClick={() => navigate('/dashboard-nps')}>
              Dashboard NPS
            </button>
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
          <button className="outline-action" onClick={() => navigate('/pesquisa-nps')}>
            Abrir pesquisa NPS
          </button>
          <div className="share-popover-wrap">
            <button className="primary-action" onClick={() => setShareOpen((prev) => !prev)}>
              Compartilhar
            </button>
            {shareOpen && (
              <div className="share-popover">
                <button type="button" onClick={handleShareNps}>Compartilhamento do aparelho</button>
                <button type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')}>WhatsApp</button>
                <a href={`mailto:?subject=Pesquisa de Satisfação&body=${encodeURIComponent(shareText)}`}>E-mail</a>
                <button type="button" onClick={() => navigator.clipboard.writeText(npsLink).then(() => setFeedback('Link da pesquisa copiado.'))}>
                  Copiar link
                </button>
              </div>
            )}
          </div>
        </div>
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
          <h2>Confirmação, agendamento e reagendamento</h2>
          <p>Área preparada para registrar os contatos e movimentos do paciente com lastro.</p>
          <strong className="quick-highlight">A rotina fica no menu por permissão.</strong>
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
    </main>
  );
}

export default HomeShell;
