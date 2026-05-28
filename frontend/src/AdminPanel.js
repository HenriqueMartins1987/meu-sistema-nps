import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import {
  accessProfiles,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone,
  isMasterAdmin,
  readUser,
  screenPermissions
} from './constants';

const masterAdminEmail = 'henrique.martins@grcconsultoria.net.br';
const adminPanelTabs = [
  { id: 'users', label: 'Usuários cadastrados' },
  { id: 'authorizations', label: 'Autorizações de cadastro' }
];

function buildNewUserDraft() {
  return {
    name: '',
    email: '',
    role: 'viewer',
    position: '',
    phone: defaultBrazilPhone,
    whatsapp: defaultBrazilPhone,
    department: ''
  };
}

function buildBulkEmailDraft() {
  return {
    subject: 'Cadastro Obrigatório',
    message: [
      'Este comunicado substitui a mensagem anterior.',
      '',
      'Para visualizar e acompanhar suas demandas, é necessário acessar a plataforma e alterar sua senha de acesso.',
      '',
      'Após concluir a alteração, faça login novamente e verifique as pendências vinculadas ao seu usuário.',
      '',
      'Se você já realizou a troca de senha, basta acessar a plataforma e confirmar o andamento das suas demandas.'
    ].join('\n')
  };
}

function roleLabel(role) {
  if (role === 'master_admin') return 'Administrador Master';
  return accessProfiles.find((profile) => profile.value === role)?.label || role || 'Perfil não informado';
}

function normalizeAuthorizationStatus(item) {
  const explicitStatus = String(item?.authorization_status || item?.status || '').trim().toLowerCase();
  if (explicitStatus) return explicitStatus;
  if (item?.active) return 'aprovado';
  return item?.role === 'crc_operator' ? 'pendente' : 'bloqueado';
}

function authorizationStatusLabel(status) {
  const normalized = normalizeAuthorizationStatus({ status });
  if (normalized === 'aprovado') return 'Aprovado';
  if (normalized === 'bloqueado') return 'Bloqueado';
  if (normalized === 'rejeitado') return 'Rejeitado';
  return 'Pendente';
}

function AdminPanel() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [users, setUsers] = useState([]);
  const [registrationRequests, setRegistrationRequests] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [registrationSearch, setRegistrationSearch] = useState('');
  const [activeAdminTab, setActiveAdminTab] = useState('users');
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState(buildNewUserDraft);
  const [testingChannels, setTestingChannels] = useState(false);
  const [testMenuOpen, setTestMenuOpen] = useState(false);
  const [bulkEmailDraft, setBulkEmailDraft] = useState(buildBulkEmailDraft);
  const [bulkEmailUserIds, setBulkEmailUserIds] = useState([]);
  const [sendingBulkEmail, setSendingBulkEmail] = useState(false);
  const [exportingUsers, setExportingUsers] = useState(false);
  const [processingRegistrationId, setProcessingRegistrationId] = useState(null);

  const selectedUser = useMemo(() => (
    users.find((user) => String(user.id) === String(selectedUserId)) || null
  ), [users, selectedUserId]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();

    if (!term) return users;

    return users.filter((user) => [
      user.name,
      user.username,
      user.email,
      user.position,
      roleLabel(user.role),
      user.authorization_status
    ].join(' ').toLowerCase().includes(term));
  }, [users, userSearch]);

  const authorizationItems = useMemo(() => {
    const registrationItems = registrationRequests.map((request) => ({
      ...request,
      itemKey: `registration:${request.id}`,
      source: 'registration',
      sourceLabel: 'Cadastro pela tela inicial',
      status: normalizeAuthorizationStatus(request)
    }));
    const crcUserItems = users
      .filter((user) => user.role === 'crc_operator' && (!user.active || ['pendente', 'bloqueado'].includes(String(user.authorization_status || '').toLowerCase())))
      .map((user) => ({
        id: user.id,
        itemKey: `user:${user.id}`,
        userId: user.id,
        source: 'user',
        sourceLabel: 'Cadastro Operador CRC pelo login',
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        position: user.position || 'Operador de CRC',
        phone: user.phone,
        whatsapp: user.whatsapp,
        department: user.department,
        status: normalizeAuthorizationStatus(user),
        created_at: user.created_at
      }));

    return [...registrationItems, ...crcUserItems];
  }, [registrationRequests, users]);

  const filteredRegistrationRequests = useMemo(() => {
    const term = registrationSearch.trim().toLowerCase();
    const pendingFirst = [...authorizationItems].sort((a, b) => {
      const statusWeight = { pendente: 0, bloqueado: 1, rejeitado: 2, aprovado: 3 };
      const left = statusWeight[normalizeAuthorizationStatus(a)] ?? 4;
      const right = statusWeight[normalizeAuthorizationStatus(b)] ?? 4;
      if (left !== right) return left - right;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    if (!term) return pendingFirst;

    return pendingFirst.filter((request) => [
      request.name,
      request.username,
      request.email,
      request.position,
      request.department,
      request.sourceLabel,
      roleLabel(request.role),
      request.status
    ].join(' ').toLowerCase().includes(term));
  }, [authorizationItems, registrationSearch]);

  const pendingRegistrationCount = useMemo(
    () => authorizationItems.filter((request) => normalizeAuthorizationStatus(request) === 'pendente').length,
    [authorizationItems]
  );

  const bulkEmailEligibleUsers = useMemo(() => {
    const seen = new Set();

    return users.filter((user) => {
      if (!user?.active) return false;
      const email = String(user.email || '').trim().toLowerCase();
      if (!email || seen.has(email)) return false;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
      seen.add(email);
      return true;
    });
  }, [users]);

  const bulkEmailRecipients = bulkEmailEligibleUsers.length;
  const selectedBulkEmailCount = bulkEmailUserIds.length;

  const loadData = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [usersRes, clinicsRes, registrationRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/clinics'),
        api.get('/admin/registration-requests', { params: { status: 'todos' } }).catch(() => ({ data: [] }))
      ]);
      const userRows = Array.isArray(usersRes.data) ? usersRes.data : [];
      setUsers(userRows);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setRegistrationRequests(Array.isArray(registrationRes.data) ? registrationRes.data : []);

      if (!selectedUserId && userRows.length) {
        setSelectedUserId(String(userRows[0].id));
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o painel gerencial.');
    } finally {
      setLoading(false);
    }
  }, [selectedUserId]);

  useEffect(() => {
    if (!isMasterAdmin(currentUser)) {
      navigate('/home');
      return;
    }

    loadData();
  }, [currentUser, navigate, loadData]);

  useEffect(() => {
    if (!selectedUser) {
      setDraft(null);
      return;
    }

    setDraft({
      name: selectedUser.name || '',
      username: selectedUser.username || '',
      email: selectedUser.email || '',
      role: selectedUser.role || 'viewer',
      position: selectedUser.position || '',
      phone: selectedUser.phone ? formatBrazilPhoneInput(selectedUser.phone) : defaultBrazilPhone,
      whatsapp: selectedUser.whatsapp ? formatBrazilPhoneInput(selectedUser.whatsapp) : defaultBrazilPhone,
      department: selectedUser.department || '',
      active: Boolean(selectedUser.active),
      authorizationStatus: selectedUser.authorization_status || (selectedUser.active ? 'aprovado' : 'pendente'),
      permissions: Array.isArray(selectedUser.permissions) ? selectedUser.permissions : [],
      clinicIds: Array.isArray(selectedUser.clinics) ? selectedUser.clinics.map((clinic) => clinic.clinic_id) : []
    });
  }, [selectedUser]);

  useEffect(() => {
    setTestMenuOpen(false);
  }, [selectedUserId]);

  useEffect(() => {
    const eligibleIds = bulkEmailEligibleUsers.map((user) => String(user.id));

    setBulkEmailUserIds((prev) => {
      const prevIds = prev.map((value) => String(value));
      const stillValid = prevIds.filter((value) => eligibleIds.includes(value));

      if (stillValid.length > 0) {
        return stillValid;
      }

      return eligibleIds;
    });
  }, [bulkEmailEligibleUsers]);

  const updateDraft = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateNewUser = (field, value) => {
    setNewUser((prev) => ({ ...prev, [field]: value }));
  };

  const togglePermission = (permission) => {
    setDraft((prev) => {
      const permissions = new Set(prev.permissions || []);
      permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
      return { ...prev, permissions: Array.from(permissions) };
    });
  };

  const toggleClinic = (clinicId) => {
    setDraft((prev) => {
      const clinicIds = new Set(prev.clinicIds || []);
      clinicIds.has(clinicId) ? clinicIds.delete(clinicId) : clinicIds.add(clinicId);
      return { ...prev, clinicIds: Array.from(clinicIds) };
    });
  };

  const selectAllPermissions = () => {
    setDraft((prev) => ({ ...prev, permissions: screenPermissions.map((permission) => permission.value) }));
  };

  const clearPermissions = () => {
    setDraft((prev) => ({ ...prev, permissions: [] }));
  };

  const selectAllClinics = () => {
    setDraft((prev) => ({ ...prev, clinicIds: clinics.map((clinic) => clinic.id) }));
  };

  const clearClinics = () => {
    setDraft((prev) => ({ ...prev, clinicIds: [] }));
  };

  const saveUser = async () => {
    setFeedback('');

    if (!draft.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(draft.email).trim())) {
      setFeedback('Informe um e-mail válido para o usuário.');
      return;
    }

    if (!isCompleteBrazilPhone(draft.phone) || !isCompleteBrazilPhone(draft.whatsapp)) {
      setFeedback('Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.');
      return;
    }

    try {
      await api.patch(`/admin/users/${selectedUser.id}`, draft);
      await loadData();
      setFeedback('Usuário atualizado com sucesso.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar o usuário.');
    }
  };

  const disableUser = async () => {
    setFeedback('');

    try {
      await api.post(`/admin/users/${selectedUser.id}/block`);
      await loadData();
      setFeedback('Usuário bloqueado.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível bloquear o usuário.');
    }
  };

  const enableUser = async () => {
    setFeedback('');

    try {
      await api.post(`/admin/users/${selectedUser.id}/activate`);
      await loadData();
      setFeedback('Acesso liberado para o usuário.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível liberar o usuário.');
    }
  };

  const deleteUser = async () => {
    setFeedback('');

    try {
      await api.delete(`/admin/users/${selectedUser.id}`);
      setSelectedUserId('');
      await loadData();
      setFeedback('Usuário excluído com lastro de auditoria.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o usuário.');
    }
  };

  const handleRegistrationRequest = async (request, action) => {
    if (!request?.id) return;

    const actionLabels = {
      approve: 'liberar acesso',
      block: 'bloquear cadastro',
      delete: 'excluir cadastro'
    };

    if (action !== 'approve' && !window.confirm(`Confirma ${actionLabels[action]} de ${request.name}?`)) {
      return;
    }

    setProcessingRegistrationId(`${request.source}:${action}:${request.id}`);
    setFeedback('');

    try {
      if (request.source === 'user' && action === 'approve') {
        await api.post(`/admin/users/${request.id}/activate`);
        setFeedback(`Acesso liberado para ${request.name}.`);
      } else if (request.source === 'user' && action === 'block') {
        await api.post(`/admin/users/${request.id}/block`);
        setFeedback(`Usuário ${request.name} bloqueado.`);
      } else if (request.source === 'user' && action === 'delete') {
        await api.delete(`/admin/users/${request.id}`);
        setFeedback(`Usuário ${request.name} excluído da base.`);
      } else if (action === 'approve') {
        await api.post(`/admin/registration-requests/${request.id}/approve`);
        setFeedback(`Acesso liberado para ${request.name}.`);
      } else if (action === 'block') {
        await api.post(`/admin/registration-requests/${request.id}/reject`);
        setFeedback(`Cadastro de ${request.name} bloqueado.`);
      } else {
        await api.delete(`/admin/registration-requests/${request.id}`);
        setFeedback(`Cadastro de ${request.name} excluído da fila.`);
      }

      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível processar a autorização.');
    } finally {
      setProcessingRegistrationId(null);
    }
  };

  const resetPassword = async () => {
    setFeedback('');

    try {
      const response = await api.post(`/admin/users/${selectedUser.id}/reset-password`);
      const emailSent = response.data?.notifications?.emailSent;
      const whatsappSent = response.data?.notifications?.whatsappSent;
      setFeedback(
        `Senha reiniciada com sucesso. ${emailSent ? 'E-mail enviado.' : 'E-mail pendente.'} ${whatsappSent ? 'WhatsApp enviado.' : 'WhatsApp pendente.'}`
      );
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível reiniciar a senha.');
    }
  };

  const sendRecurringEmailTest = async () => {
    if (!selectedUser?.email) {
      setFeedback('Selecione um parceiro com e-mail válido para enviar o teste.');
      return;
    }

    setTestingChannels(true);
    setFeedback('');
    setTestMenuOpen(false);

    try {
      const response = await api.post('/api/test-email', {
        to: selectedUser.email,
        name: selectedUser.name,
        loginEmail: selectedUser.email
      });

      if (response.data?.success) {
        setFeedback(`E-mail de teste enviado para ${selectedUser.email}.`);
      } else {
        setFeedback(response.data?.warning || 'O teste de e-mail foi processado, mas o provedor não concluiu o envio.');
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar o e-mail de teste.');
    } finally {
      setTestingChannels(false);
    }
  };

  const sendRecurringWhatsAppTest = async () => {
    const phoneTarget = formatBrazilPhoneInput(selectedUser?.whatsapp || selectedUser?.phone);

    if (!phoneTarget || !isCompleteBrazilPhone(phoneTarget)) {
      setFeedback('Selecione um parceiro com WhatsApp válido para enviar o teste.');
      return;
    }

    setTestingChannels(true);
    setFeedback('');
    setTestMenuOpen(false);

    try {
      const response = await api.post('/api/test-whatsapp', {
        telefone: phoneTarget,
        mensagem: 'Envio de mensagem teste'
      });

      if (response.data?.success) {
        setFeedback(`WhatsApp de teste enviado para ${selectedUser.name || 'parceiro'}.`);
      } else {
        setFeedback(response.data?.warning || 'O teste de WhatsApp foi processado, mas o provedor não concluiu o envio.');
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar o WhatsApp de teste.');
    } finally {
      setTestingChannels(false);
    }
  };

  const createUser = async () => {
    setFeedback('');

    if (!newUser.name || !newUser.email || !newUser.position) {
      setFeedback('Preencha nome completo, e-mail e cargo para criar o usuário.');
      return;
    }

    if (!isCompleteBrazilPhone(newUser.phone) || !isCompleteBrazilPhone(newUser.whatsapp)) {
      setFeedback('Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.');
      return;
    }

    setCreating(true);

    try {
      const response = await api.post('/admin/users', newUser);
      await loadData();
      if (response.data?.id) {
        setSelectedUserId(String(response.data.id));
      }
      setCreateOpen(false);
      setNewUser(buildNewUserDraft());
      const emailSent = response.data?.notifications?.emailSent;
      const whatsappSent = response.data?.notifications?.whatsappSent;
      setFeedback(
        `Usuário criado com sucesso. Senha temporária gerada com envio ${emailSent ? 'por e-mail' : 'de e-mail pendente'} e ${whatsappSent ? 'por WhatsApp' : 'de WhatsApp pendente'}.`
      );
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível criar o usuário.');
    } finally {
      setCreating(false);
    }
  };

  const updateBulkEmailDraft = (field, value) => {
    setBulkEmailDraft((prev) => ({ ...prev, [field]: value }));
  };

  const sendBulkEmail = async () => {
    if (!bulkEmailDraft.subject || String(bulkEmailDraft.subject).trim().length < 3) {
      setFeedback('Informe um assunto válido para o comunicado em massa.');
      return;
    }

    if (!bulkEmailDraft.message || String(bulkEmailDraft.message).trim().length < 10) {
      setFeedback('Escreva a mensagem que será enviada aos usuários.');
      return;
    }

    if (!bulkEmailUserIds.length) {
      setFeedback('Selecione pelo menos um usuário para o disparo em massa.');
      return;
    }

    setSendingBulkEmail(true);
    setFeedback('');

    try {
      const response = await api.post('/api/admin/bulk-email', {
        ...bulkEmailDraft,
        userIds: bulkEmailUserIds
      });
      const summary = response.data?.summary || {};
      const failures = Array.isArray(response.data?.failures) ? response.data.failures : [];
      const failureSuffix = failures.length
        ? ` Falhas: ${failures.map((item) => item.email).join(', ')}.`
        : '';

      setFeedback(
        `Comunicado em massa processado. ${summary.sent || 0} enviados, ${summary.skipped || 0} ignorados e ${summary.failed || 0} falhas.${failureSuffix}`
      );
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar o comunicado em massa.');
    } finally {
      setSendingBulkEmail(false);
    }
  };

  const toggleBulkEmailUser = (userId) => {
    const normalizedId = String(userId);

    setBulkEmailUserIds((prev) => (
      prev.includes(normalizedId)
        ? prev.filter((value) => value !== normalizedId)
        : [...prev, normalizedId]
    ));
  };

  const selectAllBulkEmailUsers = () => {
    setBulkEmailUserIds(bulkEmailEligibleUsers.map((user) => String(user.id)));
  };

  const clearBulkEmailUsers = () => {
    setBulkEmailUserIds([]);
  };

  const exportUsers = async (format) => {
    setFeedback('');
    setExportingUsers(true);

    const isExcel = format === 'excel';
    const extension = isExcel ? 'xlsx' : 'pdf';
    const mimeType = isExcel
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    try {
      const response = await api.get(`/admin/users/export/${format}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `usuarios-cadastrados.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setFeedback(`Exportacao de usuarios em ${isExcel ? 'Excel' : 'PDF'} gerada com sucesso.`);
    } catch (error) {
      setFeedback(error.response?.data?.error || `Nao foi possivel exportar usuarios em ${isExcel ? 'Excel' : 'PDF'}.`);
    } finally {
      setExportingUsers(false);
    }
  };

  if (!isMasterAdmin(currentUser)) {
    return null;
  }

  const isSelectedMaster = String(selectedUser?.email || '').toLowerCase() === masterAdminEmail;

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Painel Gerencial</p>
          <h1>Gestão de Usuários</h1>
          <p>Controle quem acessa cada tela e quais clínicas ficam sob responsabilidade do parceiro.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/admin/controle-master')}>Centro Master</button>
          <button className="outline-action" onClick={() => navigate('/admin/configuracoes/whatsapp')}>Configurações WhatsApp</button>
          <button className="primary-action" onClick={() => setCreateOpen(true)}>Cadastrar novo usuário</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback">{feedback}</p>}

      <nav className="admin-panel-tabs" aria-label="Gestão de usuários">
        {adminPanelTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeAdminTab === tab.id ? 'active' : ''}
            onClick={() => setActiveAdminTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'authorizations' && pendingRegistrationCount > 0 ? <span>{pendingRegistrationCount}</span> : null}
          </button>
        ))}
      </nav>

      {activeAdminTab === 'authorizations' ? (
        <section className="management-panel admin-authorization-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Autorizações</p>
              <h2>Cadastros aguardando análise</h2>
              <p className="base-subtitle">Libere, bloqueie ou exclua solicitações de cadastro feitas pela tela inicial do sistema.</p>
            </div>
            <button className="outline-action" type="button" onClick={loadData}>Atualizar lista</button>
          </div>

          <div className="admin-authorization-summary">
            <article><span>Pendentes</span><strong>{pendingRegistrationCount}</strong><small>Aguardando liberação do Master</small></article>
            <article><span>Total na lista</span><strong>{authorizationItems.length}</strong><small>Inclui aprovados e bloqueados</small></article>
            <article><span>Usuários ativos</span><strong>{users.filter((item) => item.active).length}</strong><small>Base atual do sistema</small></article>
          </div>

          <label className="admin-selector">
            Buscar cadastro
            <input
              className="field"
              value={registrationSearch}
              onChange={(event) => setRegistrationSearch(event.target.value)}
              placeholder="Nome, e-mail, cargo, unidade ou status"
            />
          </label>

          <div className="admin-authorization-list">
            {filteredRegistrationRequests.length === 0 ? (
              <div className="empty-state">Nenhum cadastro encontrado para autorização.</div>
            ) : filteredRegistrationRequests.map((request) => {
              const status = normalizeAuthorizationStatus(request);
              const canApprove = request.source === 'user' ? status !== 'aprovado' : status === 'pendente';
              const canBlock = request.source === 'user' ? status !== 'bloqueado' : status === 'pendente';
              const processing = processingRegistrationId?.startsWith(`${request.source}:`) && processingRegistrationId?.endsWith(`:${request.id}`);

              return (
                <article key={request.itemKey || `${request.source}:${request.id}`} className={`admin-authorization-card ${status}`}>
                  <div>
                    <span className={`status-pill ${status === 'pendente' ? 'em_andamento' : status === 'aprovado' ? 'resolvida' : ''}`}>
                      {authorizationStatusLabel(status)}
                    </span>
                    <h3>{request.name}</h3>
                    <p>{request.email || request.username || '-'}</p>
                    <small>{request.sourceLabel}</small>
                    <small>{roleLabel(request.role)} · {request.position || 'Cargo não informado'} · {request.department || 'Sem unidade/área'}</small>
                    {request.username ? <small>Usuário: {request.username}</small> : null}
                    <small>Telefone: {request.phone || '-'} · WhatsApp: {request.whatsapp || '-'}</small>
                    <small>Solicitado em {request.created_at ? new Date(request.created_at).toLocaleString('pt-BR') : '-'}</small>
                  </div>

                  <div className="admin-authorization-actions">
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => handleRegistrationRequest(request, 'approve')}
                      disabled={!canApprove || processing}
                    >
                      Liberar acesso
                    </button>
                    <button
                      type="button"
                      className="outline-action"
                      onClick={() => handleRegistrationRequest(request, 'block')}
                      disabled={!canBlock || processing}
                    >
                      Bloquear usuário
                    </button>
                    <button
                      type="button"
                      className="outline-action danger-action"
                      onClick={() => handleRegistrationRequest(request, 'delete')}
                      disabled={processing}
                    >
                      Excluir
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <>
      <section className="admin-export-toolbar">
        <div>
          <p className="eyebrow">Exportacao</p>
          <strong>Relacao completa de usuarios</strong>
          <span>Inclui dados cadastrais, perfil, cargo, clinicas vinculadas, telas liberadas e botoes autorizados.</span>
        </div>
        <div className="row-actions">
          <button className="outline-action icon-action" onClick={() => exportUsers('excel')} disabled={exportingUsers}>
            <span className="file-icon xls">XLS</span>
            Exportar Excel
          </button>
          <button className="outline-action icon-action" onClick={() => exportUsers('pdf')} disabled={exportingUsers}>
            <span className="file-icon pdf">PDF</span>
            Exportar PDF
          </button>
        </div>
      </section>

      {loading ? (
        <section className="management-panel">
          <p className="empty-state">Carregando painel gerencial...</p>
        </section>
      ) : (
        <section className="admin-layout">
          <aside className="admin-user-list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Parceiros</p>
                <h2>Usuários cadastrados</h2>
              </div>
            </div>

            <label className="admin-selector">
              Selecionar parceiro
              <input
                className="field"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Pesquisar por nome, e-mail, cargo ou perfil"
              />
              <select className="field" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                {filteredUsers.length === 0 && <option value="">Nenhum parceiro encontrado</option>}
                {filteredUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.username || user.email || '-'} · {authorizationStatusLabel(normalizeAuthorizationStatus(user))}
                  </option>
                ))}
              </select>
            </label>

            {selectedUser && (
              <article className="admin-user-button active">
                <strong>{selectedUser.name}</strong>
                <span>{selectedUser.username || selectedUser.email}</span>
                <small>{selectedUser.active ? 'Ativo' : authorizationStatusLabel(normalizeAuthorizationStatus(selectedUser))} · {roleLabel(selectedUser.role)}</small>
              </article>
            )}
          </aside>

          {draft && selectedUser && (
            <section className="management-panel admin-detail-panel">
              <div className="panel-heading admin-detail-heading">
                <div>
                  <p className="eyebrow">Alçada</p>
                  <h2>{selectedUser.name}</h2>
                  <p className="base-subtitle">Defina dados cadastrais, acessos, clínicas vinculadas e testes operacionais.</p>
                </div>

                <div className="heading-actions admin-heading-actions">
                  <div className="admin-test-menu">
                    <button
                      className="outline-action"
                      type="button"
                      onClick={() => setTestMenuOpen((prev) => !prev)}
                      disabled={testingChannels}
                      aria-expanded={testMenuOpen}
                    >
                      {testingChannels ? 'Enviando...' : 'Teste'}
                    </button>

                    {testMenuOpen && (
                      <div className="admin-test-menu-panel">
                        <button className="ghost-action" type="button" onClick={sendRecurringEmailTest} disabled={testingChannels}>
                          E-mail
                        </button>
                        <button className="ghost-action" type="button" onClick={sendRecurringWhatsAppTest} disabled={testingChannels}>
                          WhatsApp
                        </button>
                      </div>
                    )}
                  </div>

                  {!isSelectedMaster && (
                    selectedUser.active
                      ? <button className="outline-action" onClick={disableUser}>Bloquear acesso</button>
                      : <button className="outline-action" onClick={enableUser}>Liberar acesso</button>
                  )}
                  {!isSelectedMaster && <button className="outline-action" onClick={resetPassword}>Reiniciar senha</button>}
                  {!isSelectedMaster && <button className="outline-action danger-action" onClick={deleteUser}>Excluir</button>}
                  <button className="primary-action" onClick={saveUser}>Salvar alterações</button>
                </div>
              </div>

              <section className="admin-identity-section">
                <div className="admin-section-heading">
                  <div>
                    <p className="eyebrow">Cadastro</p>
                    <h3>Dados do parceiro</h3>
                  </div>
                </div>

                <div className="admin-form-grid">
                  <label>
                    Nome completo
                    <input className="field" value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
                  </label>
                  <label>
                    E-mail
                    <input
                      className="field"
                      type="email"
                      value={draft.email}
                      onChange={(event) => updateDraft('email', event.target.value)}
                      disabled={isSelectedMaster}
                      required
                    />
                  </label>
                  <label>
                    Perfil
                    <select className="field" value={draft.role} onChange={(event) => updateDraft('role', event.target.value)} disabled={isSelectedMaster}>
                      {isSelectedMaster && <option value="master_admin">Administrador Master</option>}
                      {accessProfiles.map((profile) => (
                        <option key={profile.value} value={profile.value}>{profile.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cargo
                    <input className="field" value={draft.position} onChange={(event) => updateDraft('position', event.target.value)} />
                  </label>
                  <label>
                    Telefone
                    <input
                      className="field"
                      value={draft.phone || defaultBrazilPhone}
                      onChange={(event) => updateDraft('phone', formatBrazilPhoneInput(event.target.value))}
                      minLength={14}
                      maxLength={14}
                      required
                    />
                  </label>
                  <label>
                    WhatsApp
                    <input
                      className="field"
                      value={draft.whatsapp || defaultBrazilPhone}
                      onChange={(event) => updateDraft('whatsapp', formatBrazilPhoneInput(event.target.value))}
                      minLength={14}
                      maxLength={14}
                      required
                    />
                  </label>
                  <label>
                    Área ou unidade
                    <input className="field" value={draft.department} onChange={(event) => updateDraft('department', event.target.value)} />
                  </label>
                </div>
              </section>

              <div className="admin-switch-row">
                <label>
                  <input
                    type="checkbox"
                    checked={isSelectedMaster ? true : draft.active}
                    onChange={(event) => updateDraft('active', event.target.checked)}
                    disabled={isSelectedMaster}
                  />
                  Usuário habilitado
                </label>
              </div>

              <section className="admin-check-section">
                <div className="admin-section-heading">
                  <div>
                    <p className="eyebrow">Telas liberadas</p>
                    <h3>Fluxo de alçada por tela</h3>
                  </div>
                  <div className="mini-actions">
                    <button type="button" className="outline-action" onClick={selectAllPermissions}>Selecionar todas</button>
                    <button type="button" className="ghost-action" onClick={clearPermissions}>Limpar</button>
                  </div>
                </div>
                <div className="admin-check-grid">
                  {screenPermissions.map((permission) => (
                    <label key={permission.value}>
                      <input
                        type="checkbox"
                        checked={draft.permissions.includes(permission.value)}
                        onChange={() => togglePermission(permission.value)}
                      />
                      {permission.label}
                    </label>
                  ))}
                </div>
              </section>

              <section className="admin-check-section">
                <div className="admin-section-heading">
                  <div>
                    <p className="eyebrow">Clínicas vinculadas</p>
                    <h3>Responsabilidade por unidade</h3>
                  </div>
                  <div className="mini-actions">
                    <button type="button" className="outline-action" onClick={selectAllClinics}>Selecionar todas</button>
                    <button type="button" className="ghost-action" onClick={clearClinics}>Limpar</button>
                  </div>
                </div>
                <div className="admin-check-grid clinic-check-grid">
                  {clinics.map((clinic) => (
                    <label key={clinic.id}>
                      <input
                        type="checkbox"
                        checked={draft.clinicIds.includes(clinic.id)}
                        onChange={() => toggleClinic(clinic.id)}
                      />
                      {clinic.name} · {clinic.city || 'Cidade'} / {clinic.state || 'UF'}
                    </label>
                  ))}
                </div>
              </section>

              <section className="admin-check-section admin-broadcast-section">
                <div className="admin-section-heading">
                  <div>
                    <p className="eyebrow">Comunicação em massa</p>
                    <h3>Disparo administrativo por e-mail</h3>
                    <p className="base-subtitle">Envio direto para todos os usuários ativos com e-mail válido, usando o layout oficial do sistema.</p>
                  </div>
                  <div className="admin-broadcast-meta">
                    <strong>{selectedBulkEmailCount}</strong>
                    <span>selecionados de {bulkEmailRecipients}</span>
                  </div>
                </div>

                <div className="admin-section-heading">
                  <div>
                    <p className="eyebrow">Destinatários</p>
                    <h3>Selecionar usuários</h3>
                  </div>
                  <div className="mini-actions">
                    <button type="button" className="outline-action" onClick={selectAllBulkEmailUsers}>Selecionar todos</button>
                    <button type="button" className="ghost-action" onClick={clearBulkEmailUsers}>Limpar</button>
                  </div>
                </div>

                <div className="admin-broadcast-user-list">
                  {bulkEmailEligibleUsers.map((user) => (
                    <label key={user.id} className="admin-broadcast-user-item">
                      <input
                        type="checkbox"
                        checked={bulkEmailUserIds.includes(String(user.id))}
                        onChange={() => toggleBulkEmailUser(user.id)}
                      />
                      <span>
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="admin-form-grid">
                  <label className="admin-form-span">
                    Assunto
                    <input
                      className="field"
                      value={bulkEmailDraft.subject}
                      onChange={(event) => updateBulkEmailDraft('subject', event.target.value)}
                      maxLength={160}
                    />
                  </label>

                  <label className="admin-form-span">
                    Mensagem
                    <textarea
                      className="field admin-message-field"
                      value={bulkEmailDraft.message}
                      onChange={(event) => updateBulkEmailDraft('message', event.target.value)}
                      rows={8}
                    />
                  </label>
                </div>

                <div className="admin-broadcast-footer">
                  <p>O link da plataforma é anexado automaticamente no corpo do e-mail e no botão de acesso.</p>
                  <div className="heading-actions">
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => setBulkEmailDraft(buildBulkEmailDraft())}
                      disabled={sendingBulkEmail}
                    >
                      Restaurar texto padrão
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      onClick={sendBulkEmail}
                      disabled={sendingBulkEmail || bulkEmailRecipients === 0 || selectedBulkEmailCount === 0}
                    >
                      {sendingBulkEmail ? 'Enviando comunicado...' : 'Enviar comunicado'}
                    </button>
                  </div>
                </div>
              </section>
            </section>
          )}
        </section>
      )}
        </>
      )}

      {createOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => { setCreateOpen(false); setNewUser(buildNewUserDraft()); }}>
          <section className="modal-panel create-user-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="eyebrow">Novo usuário</p>
              <h2>Cadastrar parceiro</h2>
              <p>O sistema gerará uma senha temporária segura e enviará o acesso automaticamente para o parceiro.</p>
            </div>

            <div className="admin-form-grid">
              <label>
                Nome completo
                <input className="field" value={newUser.name} onChange={(event) => updateNewUser('name', event.target.value)} />
              </label>
              <label>
                E-mail
                <input className="field" type="email" value={newUser.email} onChange={(event) => updateNewUser('email', event.target.value)} />
              </label>
              <label>
                Perfil
                <select className="field" value={newUser.role} onChange={(event) => updateNewUser('role', event.target.value)}>
                  {accessProfiles.map((profile) => (
                    <option key={profile.value} value={profile.value}>{profile.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Cargo
                <input className="field" value={newUser.position} onChange={(event) => updateNewUser('position', event.target.value)} />
              </label>
              <label>
                Telefone
                <input className="field" value={newUser.phone} onChange={(event) => updateNewUser('phone', formatBrazilPhoneInput(event.target.value))} maxLength={14} />
              </label>
              <label>
                WhatsApp
                <input className="field" value={newUser.whatsapp} onChange={(event) => updateNewUser('whatsapp', formatBrazilPhoneInput(event.target.value))} maxLength={14} />
              </label>
              <label className="admin-form-span">
                Área ou unidade
                <input className="field" value={newUser.department} onChange={(event) => updateNewUser('department', event.target.value)} />
              </label>
            </div>

            <div className="heading-actions">
              <button className="outline-action" onClick={() => { setCreateOpen(false); setNewUser(buildNewUserDraft()); }} disabled={creating}>
                Cancelar
              </button>
              <button className="primary-action" onClick={createUser} disabled={creating}>
                {creating ? 'Cadastrando...' : 'Salvar usuário'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default AdminPanel;
