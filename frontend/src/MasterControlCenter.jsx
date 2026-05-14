import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from './api';
import {
  accessProfiles,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isMasterAdmin,
  readUser,
  screenPermissions
} from './constants';

const roleOptions = [
  { value: 'master_admin', label: 'Administrador Master' },
  ...accessProfiles
];

const permissionGroups = [
  { key: 'core', title: 'Sistema', match: (value) => ['home', 'admin_panel'].includes(value) },
  { key: 'complaints', title: 'Reclamações e protocolos', match: (value) => value.startsWith('complaints') },
  { key: 'nps', title: 'NPS', match: (value) => value.startsWith('nps') },
  { key: 'patients', title: 'Pacientes e CRM', match: (value) => ['patient_management', 'crm_relationship'].includes(value) },
  { key: 'financial', title: 'Financeiro CRC', match: (value) => value.startsWith('financial') }
];

function toNumber(value) {
  const parsed = Number(String(value || 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function permissionCategory(permission) {
  return permissionGroups.find((group) => group.match(permission.value)) || {
    key: 'other',
    title: 'Outras permissões'
  };
}

function normalizeClinicIds(user = {}) {
  if (Array.isArray(user.clinicIds)) {
    return user.clinicIds.map((id) => String(id));
  }

  if (Array.isArray(user.clinics)) {
    return user.clinics
      .map((clinic) => clinic.clinic_id || clinic.id)
      .filter(Boolean)
      .map((id) => String(id));
  }

  return [];
}

function normalizeUser(user = {}) {
  return {
    ...user,
    active: Boolean(user.active),
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    clinicIds: normalizeClinicIds(user)
  };
}

function MasterControlCenter() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [users, setUsers] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [filters, setFilters] = useState({ search: '', role: '', status: '' });
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [clearingTests, setClearingTests] = useState(false);

  const permissionsByGroup = useMemo(() => {
    const grouped = new Map();
    screenPermissions.forEach((permission) => {
      const group = permissionCategory(permission);
      const current = grouped.get(group.key) || { ...group, permissions: [] };
      current.permissions.push(permission);
      grouped.set(group.key, current);
    });
    return Array.from(grouped.values());
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [usersRes, settingsRes, collaboratorsRes, clinicsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/financial-settings'),
        api.get('/crc-collaborators'),
        api.get('/clinics').catch(() => ({ data: [] }))
      ]);
      const loadedUsers = Array.isArray(usersRes.data) ? usersRes.data.map(normalizeUser) : [];
      setUsers(loadedUsers);
      setSettings(settingsRes.data || null);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setSelectedUserId((current) => current || loadedUsers[0]?.id || '');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o Centro Master.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isMasterAdmin(currentUser)) {
      navigate('/home');
      return;
    }
    loadData();
  }, [currentUser, loadData, navigate]);

  const filteredUsers = useMemo(() => users.filter((user) => {
    const text = [user.name, user.email, user.role, user.position, user.department].join(' ').toLowerCase();
    const searchOk = !filters.search || text.includes(filters.search.toLowerCase());
    const roleOk = !filters.role || user.role === filters.role;
    const statusOk = !filters.status
      || (filters.status === 'active' ? user.active : !user.active);
    return searchOk && roleOk && statusOk;
  }), [filters, users]);

  const selectedUser = useMemo(
    () => users.find((user) => String(user.id) === String(selectedUserId)) || filteredUsers[0] || null,
    [filteredUsers, selectedUserId, users]
  );

  const summary = useMemo(() => ({
    users: users.length,
    active: users.filter((user) => user.active).length,
    inactive: users.filter((user) => !user.active).length,
    controlledPermissions: screenPermissions.length
  }), [users]);

  const selectedRoleLabel = roleOptions.find((role) => role.value === selectedUser?.role)?.label || selectedUser?.role || 'Perfil não definido';
  const selectedClinicIds = normalizeClinicIds(selectedUser || {});
  const selectedPermissionCount = selectedUser?.permissions?.length || 0;

  const patchUser = (userId, changes) => {
    setUsers((current) => current.map((user) => (
      String(user.id) === String(userId) ? { ...user, ...changes } : user
    )));
  };

  const toggleUserPermission = (userId, permission) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const permissions = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
    permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
    patchUser(userId, { permissions: Array.from(permissions) });
  };

  const toggleClinic = (userId, clinicId) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const ids = new Set(normalizeClinicIds(user));
    const normalizedId = String(clinicId);
    ids.has(normalizedId) ? ids.delete(normalizedId) : ids.add(normalizedId);
    patchUser(userId, { clinicIds: Array.from(ids) });
  };

  const applyAllPermissions = (userId) => {
    patchUser(userId, { permissions: screenPermissions.map((permission) => permission.value) });
  };

  const clearPermissions = (userId) => {
    patchUser(userId, { permissions: ['home'] });
  };

  const saveUser = async (user) => {
    setSavingUserId(String(user.id));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${user.id}`, {
        name: user.name,
        email: user.email,
        role: user.role,
        position: user.position,
        phone: user.phone ? formatBrazilPhoneInput(user.phone) : defaultBrazilPhone,
        whatsapp: user.whatsapp ? formatBrazilPhoneInput(user.whatsapp) : defaultBrazilPhone,
        department: user.department,
        active: Boolean(user.active),
        permissions: user.permissions || [],
        clinicIds: normalizeClinicIds(user)
      });
      setFeedback(`Usuário ${user.name} atualizado com sucesso.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o usuário.');
    } finally {
      setSavingUserId('');
    }
  };

  const updateSetting = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const updateMargin = (key, field, value) => {
    setSettings((current) => ({
      ...current,
      expectedMargins: {
        ...(current?.expectedMargins || {}),
        [key]: {
          ...(current?.expectedMargins?.[key] || {}),
          [field]: value
        }
      }
    }));
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setFeedback('');

    try {
      const payload = {
        ...settings,
        crcRoiExcellent: toNumber(settings?.crcRoiExcellent),
        netMarginHealthyMin: toNumber(settings?.netMarginHealthyMin),
        selicComparisonTolerance: toNumber(settings?.selicComparisonTolerance)
      };
      const { data } = await api.put('/admin/financial-settings', payload);
      setSettings(data);
      setFeedback('Regras financeiras atualizadas.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar as regras financeiras.');
    } finally {
      setSavingSettings(false);
    }
  };

  const clearFinancialTests = async () => {
    if (!window.confirm('Confirma remover definitivamente registros financeiros marcados como teste ou já excluídos?')) return;
    setClearingTests(true);
    setFeedback('');

    try {
      const { data } = await api.post('/admin/financial-maintenance/clear-test-records');
      setFeedback(`${data.deleted || 0} registro(s) de teste removidos definitivamente.`);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível limpar os registros de teste.');
    } finally {
      setClearingTests(false);
    }
  };

  const deleteCollaborator = async (collaborator) => {
    if (!window.confirm(`Confirma excluir o colaborador ${collaborator.name}?`)) return;
    setFeedback('');

    try {
      await api.delete(`/crc-collaborators/${collaborator.id}`);
      setFeedback(`Colaborador ${collaborator.name} excluído.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o colaborador.');
    }
  };

  if (!isMasterAdmin(currentUser)) return null;

  return (
    <main className="app-page master-control-page">
      <header className="page-heading master-control-heading">
        <div>
          <p className="eyebrow">Painel Gerencial</p>
          <h1>Centro Master do Sistema</h1>
          <p>Controle de usuários, telas, clínicas, regras financeiras e ações administrativas em um único painel.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/admin')}>Gestão de usuários</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback">{feedback}</p>}
      {loading && <section className="management-panel"><p className="empty-state">Carregando Centro Master...</p></section>}

      {!loading && (
        <>
          <section className="master-summary-grid">
            <article><span>Usuários</span><strong>{summary.users}</strong></article>
            <article><span>Ativos</span><strong>{summary.active}</strong></article>
            <article><span>Inativos</span><strong>{summary.inactive}</strong></article>
            <article><span>Telas controladas</span><strong>{summary.controlledPermissions}</strong></article>
          </section>

          {selectedUser && (
            <section className="master-operational-map">
              <article>
                <span>Usuário selecionado</span>
                <strong>{selectedUser.name}</strong>
                <small>{selectedUser.email}</small>
              </article>
              <article>
                <span>Perfil de acesso</span>
                <strong>{selectedRoleLabel}</strong>
                <small>{selectedUser.position || selectedUser.department || 'Sem cargo vinculado'}</small>
              </article>
              <article>
                <span>Autorizações</span>
                <strong>{selectedPermissionCount}/{screenPermissions.length}</strong>
                <small>Telas liberadas no sistema</small>
              </article>
              <article>
                <span>Clínicas vinculadas</span>
                <strong>{selectedClinicIds.length}</strong>
                <small>{selectedClinicIds.length ? 'Acesso por unidade definido' : 'Sem limitação por clínica'}</small>
              </article>
            </section>
          )}

          <section className="master-user-control-layout">
            <aside className="management-panel master-user-list-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Usuários</p>
                  <h2>Seleção e filtros</h2>
                </div>
              </div>
              <div className="master-user-filters">
                <input className="field" placeholder="Buscar por nome, e-mail ou perfil" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
                <select className="field" value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}>
                  <option value="">Todos os perfis</option>
                  {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="">Todos os status</option>
                  <option value="active">Ativos</option>
                  <option value="inactive">Inativos</option>
                </select>
              </div>
              <div className="master-user-list">
                {filteredUsers.map((user) => (
                  <button
                    type="button"
                    key={user.id}
                    className={`master-user-list-item ${String(selectedUser?.id) === String(user.id) ? 'selected' : ''}`}
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <em>{roleOptions.find((role) => role.value === user.role)?.label || user.role}</em>
                  </button>
                ))}
                {!filteredUsers.length && <p className="empty-state">Nenhum usuário encontrado.</p>}
              </div>
            </aside>

            {selectedUser && (
              <section className="management-panel master-user-editor">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Controle de acesso</p>
                    <h2>{selectedUser.name}</h2>
                    <p className="base-subtitle">Edite dados, perfil, status, telas autorizadas e clínicas vinculadas.</p>
                  </div>
                  <button className="primary-action" onClick={() => saveUser(selectedUser)} disabled={savingUserId === String(selectedUser.id)}>
                    {savingUserId === String(selectedUser.id) ? 'Salvando...' : 'Salvar usuário'}
                  </button>
                </div>

                <div className="master-user-form-grid">
                  <label>Nome<input className="field" value={selectedUser.name || ''} onChange={(event) => patchUser(selectedUser.id, { name: event.target.value })} /></label>
                  <label>E-mail<input className="field" value={selectedUser.email || ''} onChange={(event) => patchUser(selectedUser.id, { email: event.target.value })} /></label>
                  <label>Perfil<select className="field" value={selectedUser.role || ''} onChange={(event) => patchUser(selectedUser.id, { role: event.target.value })}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                  <label>Cargo/Função<input className="field" value={selectedUser.position || ''} onChange={(event) => patchUser(selectedUser.id, { position: event.target.value })} /></label>
                  <label>Departamento<input className="field" value={selectedUser.department || ''} onChange={(event) => patchUser(selectedUser.id, { department: event.target.value })} /></label>
                  <label>Telefone<input className="field" value={selectedUser.phone || ''} onChange={(event) => patchUser(selectedUser.id, { phone: event.target.value })} /></label>
                  <label>WhatsApp<input className="field" value={selectedUser.whatsapp || ''} onChange={(event) => patchUser(selectedUser.id, { whatsapp: event.target.value })} /></label>
                  <label>Status<select className="field" value={selectedUser.active ? 'active' : 'inactive'} onChange={(event) => patchUser(selectedUser.id, { active: event.target.value === 'active' })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
                </div>

                <div className="master-permission-toolbar">
                  <button className="outline-action mini-action" onClick={() => applyAllPermissions(selectedUser.id)}>Liberar todas as telas</button>
                  <button className="outline-action mini-action" onClick={() => clearPermissions(selectedUser.id)}>Manter somente Home</button>
                  <span>{selectedUser.permissions?.length || 0} permissão(ões) marcada(s)</span>
                </div>

                <div className="master-permission-matrix">
                  {permissionsByGroup.map((group) => (
                    <article className="master-permission-group" key={group.key}>
                      <strong>{group.title}</strong>
                      <div>
                        {group.permissions.map((permission) => (
                          <label className="master-permission-chip" key={permission.value}>
                            <input
                              type="checkbox"
                              checked={Array.isArray(selectedUser.permissions) && selectedUser.permissions.includes(permission.value)}
                              onChange={() => toggleUserPermission(selectedUser.id, permission.value)}
                            />
                            <span>{permission.label}</span>
                          </label>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                <article className="master-clinic-access">
                  <div>
                    <strong>Clínicas vinculadas</strong>
                    <p>Use para limitar a visão operacional de coordenadores, gerentes e perfis com acesso por unidade.</p>
                  </div>
                  <div className="master-clinic-grid">
                    {clinics.map((clinic) => (
                      <label className="master-permission-chip" key={clinic.id}>
                        <input
                          type="checkbox"
                          checked={normalizeClinicIds(selectedUser).includes(String(clinic.id))}
                          onChange={() => toggleClinic(selectedUser.id, clinic.id)}
                        />
                        <span>{clinic.name}</span>
                      </label>
                    ))}
                    {!clinics.length && <p className="empty-state">Nenhuma clínica encontrada.</p>}
                  </div>
                </article>
              </section>
            )}

          </section>

          <section className="master-control-sidebar">
              <article className="management-panel master-actions-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Ações imediatas</p>
                    <h2>Administração</h2>
                  </div>
                </div>
                <div className="master-shortcut-grid">
                  <button className="outline-action" onClick={() => navigate('/admin/monitoria')}>Monitoria Master</button>
                  <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard Financeiro</button>
                  <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestão Financeira</button>
                  <button className="outline-action danger-action" onClick={clearFinancialTests} disabled={clearingTests}>
                    {clearingTests ? 'Limpando...' : 'Limpar testes financeiros'}
                  </button>
                </div>
              </article>

              <article className="management-panel master-actions-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Colaboradores CRC</p>
                    <h2>Exclusão Master</h2>
                  </div>
                </div>
                <div className="master-collaborator-list">
                  {collaborators.slice(0, 12).map((collaborator) => (
                    <div className="master-collaborator-row" key={collaborator.id}>
                      <strong>{collaborator.name}<small>{collaborator.function_name || 'Função não informada'}</small></strong>
                      <button className="outline-action danger-action mini-action" onClick={() => deleteCollaborator(collaborator)}>Excluir</button>
                    </div>
                  ))}
                  {!collaborators.length && <p className="empty-state">Nenhum colaborador cadastrado.</p>}
                </div>
              </article>
          </section>

          {settings && (
            <section className="management-panel master-financial-rules">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Regras de cálculo</p>
                  <h2>Parâmetros da Inteligência Financeira CRC</h2>
                  <p className="base-subtitle">A SELIC está travada em 15% ao ano. Aqui ficam as margens e tolerâncias do painel.</p>
                </div>
                <button className="primary-action" onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? 'Salvando...' : 'Salvar regras'}
                </button>
              </div>

              <div className="admin-form-grid">
                <label>ROI CRC excelente (%)
                  <input className="field" type="number" step="0.01" value={settings.crcRoiExcellent ?? ''} onChange={(event) => updateSetting('crcRoiExcellent', event.target.value)} />
                </label>
                <label>Margem líquida saudável mínima (%)
                  <input className="field" type="number" step="0.01" value={settings.netMarginHealthyMin ?? ''} onChange={(event) => updateSetting('netMarginHealthyMin', event.target.value)} />
                </label>
                <label>Tolerância ROI vs SELIC (%)
                  <input className="field" type="number" step="0.01" value={settings.selicComparisonTolerance ?? ''} onChange={(event) => updateSetting('selicComparisonTolerance', event.target.value)} />
                </label>
              </div>

              <div className="master-margin-grid">
                {Object.entries(settings.expectedMargins || {}).map(([key, item]) => (
                  <article key={key}>
                    <strong>{item.label}</strong>
                    <label>Mínimo<input className="field" type="number" step="0.01" value={item.min ?? ''} onChange={(event) => updateMargin(key, 'min', event.target.value)} /></label>
                    <label>Máximo<input className="field" type="number" step="0.01" value={item.max ?? ''} onChange={(event) => updateMargin(key, 'max', event.target.value)} /></label>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

export default MasterControlCenter;
