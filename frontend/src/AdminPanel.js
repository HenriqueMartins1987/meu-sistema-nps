import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import {
  accessProfiles,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isAdmin,
  isCompleteBrazilPhone,
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
    if (!isAdmin(currentUser)) {
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

    if (!isCompleteBrazilPhone(draft.phone) || !isCompleteBrazilPhone(draft.whatsapp)) {
      setFeedback('Informe telefone e WhatsApp completos no formato +55DDDNÃƒÅ¡MERO.');
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

  if (!isAdmin(currentUser)) {
    return null;
  }

  const isSelectedMaster = String(selectedUser?.email || '').toLowerCase() === masterAdminEmail;

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Painel Gerencial</p>
          <h1>GestÃƒÂ£o de UsuÃƒÂ¡rios</h1>
          <p>Controle quem acessa cada tela e quais clÃƒÂ­nicas ficam sob responsabilidade do colaborador.</p>
        </div>

        <div className="heading-actions">
          <button className="primary-action" onClick={() => setCreateOpen(true)}>Cadastrar novo usuÃƒÂ¡rio</button>
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
                <h2>UsuÃƒÂ¡rios cadastrados</h2>
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
                    {user.name} Ã‚Â· {user.email}
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
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">AlÃƒÂ§ada</p>
                  <h2>{selectedUser.name}</h2>
                </div>
                <div className="heading-actions">
                  {!isSelectedMaster && <button className="outline-action" onClick={disableUser}>Desabilitar</button>}
                  {!isSelectedMaster && <button className="outline-action" onClick={resetPassword}>Reiniciar senha</button>}
                  {!isSelectedMaster && <button className="outline-action danger-action" onClick={deleteUser}>Excluir</button>}
                  <button className="primary-action" onClick={saveUser}>Salvar alteraÃƒÂ§ÃƒÂµes</button>
                </div>
              </div>

              <div className="admin-form-grid">
                <label>
                  Nome completo
                  <input className="field" value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
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
                  ÃƒÂrea ou unidade
                  <input className="field" value={draft.department} onChange={(event) => updateDraft('department', event.target.value)} />
                </label>
              </div>

              <div className="admin-switch-row">
                <label>
                  <input
                    type="checkbox"
                    checked={isSelectedMaster ? true : draft.active}
                    onChange={(event) => updateDraft('active', event.target.checked)}
                    disabled={isSelectedMaster}
                  />
                  UsuÃƒÂ¡rio habilitado
                </label>
              </div>

              <section className="admin-check-section">
                <div>
                  <p className="eyebrow">Telas liberadas</p>
                  <h3>Fluxo de alÃƒÂ§ada por tela</h3>
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
                <div>
                  <p className="eyebrow">ClÃƒÂ­nicas vinculadas</p>
                  <h3>Responsabilidade por unidade</h3>
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
                      {clinic.name} Ã‚Â· {clinic.city || 'Cidade'} / {clinic.state || 'UF'}
                    </label>
                  ))}
                </div>
              </section>
            </section>
          )}
        </section>
      )}

      {createOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel create-user-modal">
            <div>
              <p className="eyebrow">Novo usuÃƒÂ¡rio</p>
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
                ÃƒÂrea ou unidade
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
