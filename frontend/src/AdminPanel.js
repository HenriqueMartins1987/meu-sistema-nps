import React, { useEffect, useMemo, useState } from 'react';
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

function roleLabel(role) {
  if (role === 'master_admin') return 'Administrador Master';
  return accessProfiles.find((profile) => profile.value === role)?.label || role || 'Perfil não informado';
}

function AdminPanel() {
  const navigate = useNavigate();
  const currentUser = readUser();
  const [users, setUsers] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  const selectedUser = useMemo(() => (
    users.find((user) => String(user.id) === String(selectedUserId)) || null
  ), [users, selectedUserId]);

  const loadData = async () => {
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
  };

  useEffect(() => {
    if (!isAdmin(currentUser)) {
      navigate('/home');
      return;
    }

    loadData();
  }, []);

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

  const saveUser = async () => {
    setFeedback('');

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
      await api.post(`/admin/users/${selectedUser.id}/reset-password`);
      setFeedback('Senha reiniciada para 123456789.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível reiniciar a senha.');
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
          <h1>Gestão de Usuários</h1>
          <p>Controle quem acessa cada tela e quais clínicas ficam sob responsabilidade do colaborador.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback">{feedback}</p>}

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
              <select className="field" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                {users.map((user) => (
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
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Alçada</p>
                  <h2>{selectedUser.name}</h2>
                </div>
                <div className="heading-actions">
                  {!isSelectedMaster && <button className="outline-action" onClick={disableUser}>Desabilitar</button>}
                  {!isSelectedMaster && <button className="outline-action" onClick={resetPassword}>Reiniciar senha</button>}
                  {!isSelectedMaster && <button className="outline-action danger-action" onClick={deleteUser}>Excluir</button>}
                  <button className="primary-action" onClick={saveUser}>Salvar alterações</button>
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
                  WhatsApp <span className="whatsapp-symbol">☎</span>
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

              <div className="admin-switch-row">
                <label>
                  <input type="checkbox" checked={draft.active} onChange={(event) => updateDraft('active', event.target.checked)} />
                  Usuário habilitado
                </label>
              </div>

              <section className="admin-check-section">
                <div>
                  <p className="eyebrow">Telas liberadas</p>
                  <h3>Fluxo de alçada por tela</h3>
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
                  <p className="eyebrow">Clínicas vinculadas</p>
                  <h3>Responsabilidade por unidade</h3>
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
            </section>
          )}
        </section>
      )}
    </main>
  );
}

export default AdminPanel;
