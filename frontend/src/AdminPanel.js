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

function AdminPanel() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [users, setUsers] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');
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

  const selectedUser = useMemo(() => (
    users.find((user) => String(user.id) === String(selectedUserId)) || null
  ), [users, selectedUserId]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();

    if (!term) return users;

    return users.filter((user) => [
      user.name,
      user.email,
      user.position,
      roleLabel(user.role)
    ].join(' ').toLowerCase().includes(term));
  }, [users, userSearch]);

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
      const [usersRes, clinicsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/clinics')
      ]);
      const userRows = Array.isArray(usersRes.data) ? usersRes.data : [];
      setUsers(userRows);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);

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
      email: selectedUser.email || '',
      role: selectedUser.role || 'viewer',
      position: selectedUser.position || '',
      phone: selectedUser.phone ? formatBrazilPhoneInput(selectedUser.phone) : defaultBrazilPhone,
      whatsapp: selectedUser.whatsapp ? formatBrazilPhoneInput(selectedUser.whatsapp) : defaultBrazilPhone,
      department: selectedUser.department || '',
      active: Boolean(selectedUser.active),
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
      await api.patch(`/admin/users/${selectedUser.id}`, { ...draft, active: false });
      await loadData();
      setFeedback('Usuário desabilitado.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível desabilitar o usuário.');
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
      setFeedback('Selecione um colaborador com e-mail válido para enviar o teste.');
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
      setFeedback('Selecione um colaborador com WhatsApp válido para enviar o teste.');
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
        setFeedback(`WhatsApp de teste enviado para ${selectedUser.name || 'colaborador'}.`);
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
          <p>Controle quem acessa cada tela e quais clínicas ficam sob responsabilidade do colaborador.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/admin/controle-master')}>Centro Master</button>
          <button className="outline-action" onClick={() => navigate('/admin/configuracoes/whatsapp')}>Configurações WhatsApp</button>
          <button className="primary-action" onClick={() => setCreateOpen(true)}>Cadastrar novo usuário</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback">{feedback}</p>}

      {loading ? (
        <section className="management-panel">
          <p className="empty-state">Carregando painel gerencial...</p>
        </section>
      ) : (
        <section className="admin-layout">
          <aside className="admin-user-list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Colaboradores</p>
                <h2>Usuários cadastrados</h2>
              </div>
            </div>

            <label className="admin-selector">
              Selecionar colaborador
              <input
                className="field"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Pesquisar por nome, e-mail, cargo ou perfil"
              />
              <select className="field" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                {filteredUsers.length === 0 && <option value="">Nenhum colaborador encontrado</option>}
                {filteredUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email}
                  </option>
                ))}
              </select>
            </label>

            {selectedUser && (
              <article className="admin-user-button active">
                <strong>{selectedUser.name}</strong>
                <span>{selectedUser.email}</span>
                <small>{selectedUser.active ? 'Ativo' : 'Desabilitado'} · {roleLabel(selectedUser.role)}</small>
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

                  {!isSelectedMaster && <button className="outline-action" onClick={disableUser}>Desabilitar</button>}
                  {!isSelectedMaster && <button className="outline-action" onClick={resetPassword}>Reiniciar senha</button>}
                  {!isSelectedMaster && <button className="outline-action danger-action" onClick={deleteUser}>Excluir</button>}
                  <button className="primary-action" onClick={saveUser}>Salvar alterações</button>
                </div>
              </div>

              <section className="admin-identity-section">
                <div className="admin-section-heading">
                  <div>
                    <p className="eyebrow">Cadastro</p>
                    <h3>Dados do colaborador</h3>
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

      {createOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => { setCreateOpen(false); setNewUser(buildNewUserDraft()); }}>
          <section className="modal-panel create-user-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="eyebrow">Novo usuário</p>
              <h2>Cadastrar colaborador</h2>
              <p>O sistema gerará uma senha temporária segura e enviará o acesso automaticamente para o colaborador.</p>
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
