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

const tabs = [
  { id: 'users', label: 'Usuarios' },
  { id: 'permissions', label: 'Permissoes' },
  { id: 'system', label: 'Sistema' },
  { id: 'financial', label: 'Financeiro' }
];

const permissionGroups = [
  { key: 'core', title: 'Sistema', match: (value) => ['home', 'admin_panel'].includes(value) },
  { key: 'complaints', title: 'Reclamacoes e protocolos', match: (value) => value.startsWith('complaints') },
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
    title: 'Outras permissoes'
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

function roleLabel(value) {
  return roleOptions.find((role) => role.value === value)?.label || value || 'Perfil nao definido';
}

function MasterControlCenter() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [users, setUsers] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [activeTab, setActiveTab] = useState('users');
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
      setFeedback(error.response?.data?.error || 'Nao foi possivel carregar o Centro Master.');
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
    const statusOk = !filters.status || (filters.status === 'active' ? user.active : !user.active);
    return searchOk && roleOk && statusOk;
  }), [filters, users]);

  const selectedUser = useMemo(
    () => users.find((user) => String(user.id) === String(selectedUserId)) || filteredUsers[0] || null,
    [filteredUsers, selectedUserId, users]
  );

  const selectedClinicIds = normalizeClinicIds(selectedUser || {});
  const selectedPermissionCount = selectedUser?.permissions?.length || 0;

  const summary = useMemo(() => ({
    users: users.length,
    active: users.filter((user) => user.active).length,
    inactive: users.filter((user) => !user.active).length,
    master: users.filter((user) => user.role === 'master_admin').length,
    permissions: screenPermissions.length,
    clinics: clinics.length,
    collaborators: collaborators.length
  }), [clinics.length, collaborators.length, users]);

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
      setFeedback(`Usuario ${user.name} atualizado com sucesso.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel salvar o usuario.');
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
      setFeedback(error.response?.data?.error || 'Nao foi possivel salvar as regras financeiras.');
    } finally {
      setSavingSettings(false);
    }
  };

  const clearFinancialTests = async () => {
    if (!window.confirm('Confirma remover definitivamente registros financeiros marcados como teste ou ja excluidos?')) return;
    setClearingTests(true);
    setFeedback('');

    try {
      const { data } = await api.post('/admin/financial-maintenance/clear-test-records');
      setFeedback(`${data.deleted || 0} registro(s) de teste removidos definitivamente.`);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel limpar os registros de teste.');
    } finally {
      setClearingTests(false);
    }
  };

  const deleteCollaborator = async (collaborator) => {
    if (!window.confirm(`Confirma excluir o colaborador ${collaborator.name}?`)) return;
    setFeedback('');

    try {
      await api.delete(`/crc-collaborators/${collaborator.id}`);
      setFeedback(`Colaborador ${collaborator.name} excluido.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel excluir o colaborador.');
    }
  };

  if (!isMasterAdmin(currentUser)) return null;

  return (
    <main className="app-page master-control-page master-console-page">
      <header className="page-heading master-console-heading">
        <div>
          <p className="eyebrow">Painel Gerencial</p>
          <h1>Centro Master do Sistema</h1>
          <p>Controle executivo de usuarios, permissoes, clinicas, rotinas administrativas e regras financeiras do sistema.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/admin')}>Gestao de usuarios</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback master-console-feedback">{feedback}</p>}
      {loading && <section className="management-panel master-console-shell"><p className="empty-state">Carregando Centro Master...</p></section>}

      {!loading && (
        <section className="master-console-shell">
          <div className="master-console-summary">
            <article><span>Usuarios</span><strong>{summary.users}</strong><small>{summary.active} ativos</small></article>
            <article><span>Perfis Master</span><strong>{summary.master}</strong><small>{summary.inactive} inativos</small></article>
            <article><span>Telas controladas</span><strong>{summary.permissions}</strong><small>Autorizacao por usuario</small></article>
            <article><span>Clinicas</span><strong>{summary.clinics}</strong><small>Vinculo operacional</small></article>
            <article><span>Colaboradores CRC</span><strong>{summary.collaborators}</strong><small>Base financeira</small></article>
          </div>

          {selectedUser && (
            <div className="master-selected-strip">
              <article>
                <span>Usuario em edicao</span>
                <strong>{selectedUser.name}</strong>
                <small>{selectedUser.email}</small>
              </article>
              <article>
                <span>Perfil</span>
                <strong>{roleLabel(selectedUser.role)}</strong>
                <small>{selectedUser.position || selectedUser.department || 'Sem cargo informado'}</small>
              </article>
              <article>
                <span>Permissoes</span>
                <strong>{selectedPermissionCount}/{screenPermissions.length}</strong>
                <small>Telas liberadas</small>
              </article>
              <article>
                <span>Clinicas</span>
                <strong>{selectedClinicIds.length}</strong>
                <small>{selectedClinicIds.length ? 'Acesso limitado por unidade' : 'Sem clinica vinculada'}</small>
              </article>
            </div>
          )}

          <nav className="master-console-tabs" aria-label="Seções do Centro Master">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === 'users' && (
            <section className="master-console-panel master-users-panel">
              <aside className="master-user-directory">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Usuarios</p>
                    <h2>Lista de acesso</h2>
                  </div>
                </div>
                <div className="master-filter-stack">
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
                <div className="master-scroll-list">
                  {filteredUsers.map((user) => (
                    <button
                      type="button"
                      key={user.id}
                      className={`master-user-option ${String(selectedUser?.id) === String(user.id) ? 'selected' : ''}`}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                      <em>{roleLabel(user.role)} | {user.active ? 'Ativo' : 'Inativo'}</em>
                    </button>
                  ))}
                  {!filteredUsers.length && <p className="empty-state">Nenhum usuario encontrado.</p>}
                </div>
              </aside>

              {selectedUser && (
                <article className="master-user-workspace">
                  <div className="master-section-heading">
                    <div>
                      <p className="eyebrow">Cadastro e perfil</p>
                      <h2>{selectedUser.name}</h2>
                    </div>
                    <button className="primary-action" onClick={() => saveUser(selectedUser)} disabled={savingUserId === String(selectedUser.id)}>
                      {savingUserId === String(selectedUser.id) ? 'Salvando...' : 'Salvar usuario'}
                    </button>
                  </div>
                  <div className="master-form-grid">
                    <label>Nome<input className="field" value={selectedUser.name || ''} onChange={(event) => patchUser(selectedUser.id, { name: event.target.value })} /></label>
                    <label>E-mail<input className="field" value={selectedUser.email || ''} onChange={(event) => patchUser(selectedUser.id, { email: event.target.value })} /></label>
                    <label>Perfil<select className="field" value={selectedUser.role || ''} onChange={(event) => patchUser(selectedUser.id, { role: event.target.value })}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                    <label>Status<select className="field" value={selectedUser.active ? 'active' : 'inactive'} onChange={(event) => patchUser(selectedUser.id, { active: event.target.value === 'active' })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
                    <label>Cargo/Funcao<input className="field" value={selectedUser.position || ''} onChange={(event) => patchUser(selectedUser.id, { position: event.target.value })} /></label>
                    <label>Departamento<input className="field" value={selectedUser.department || ''} onChange={(event) => patchUser(selectedUser.id, { department: event.target.value })} /></label>
                    <label>Telefone<input className="field" value={selectedUser.phone || ''} onChange={(event) => patchUser(selectedUser.id, { phone: event.target.value })} /></label>
                    <label>WhatsApp<input className="field" value={selectedUser.whatsapp || ''} onChange={(event) => patchUser(selectedUser.id, { whatsapp: event.target.value })} /></label>
                  </div>
                </article>
              )}
            </section>
          )}

          {activeTab === 'permissions' && selectedUser && (
            <section className="master-console-panel master-permissions-panel">
              <div className="master-permission-command">
                <div>
                  <p className="eyebrow">Autorizacoes</p>
                  <h2>{selectedUser.name}</h2>
                  <p>Controle quais telas, botoes principais e areas operacionais ficam disponiveis para este usuario.</p>
                </div>
                <div className="master-command-actions">
                  <button className="outline-action" onClick={() => applyAllPermissions(selectedUser.id)}>Liberar tudo</button>
                  <button className="outline-action" onClick={() => clearPermissions(selectedUser.id)}>Somente Home</button>
                  <button className="primary-action" onClick={() => saveUser(selectedUser)} disabled={savingUserId === String(selectedUser.id)}>Salvar permissoes</button>
                </div>
              </div>

              <div className="master-permission-board">
                {permissionsByGroup.map((group) => (
                  <article className="master-permission-card" key={group.key}>
                    <header>
                      <strong>{group.title}</strong>
                      <span>{group.permissions.filter((permission) => selectedUser.permissions?.includes(permission.value)).length}/{group.permissions.length}</span>
                    </header>
                    <div>
                      {group.permissions.map((permission) => (
                        <label className="master-check-row" key={permission.value}>
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

              <article className="master-clinic-card">
                <header>
                  <div>
                    <p className="eyebrow">Clinicas vinculadas</p>
                    <h2>Acesso por unidade</h2>
                    <p>Use para limitar a visualizacao operacional por clinica quando o perfil exigir esse controle.</p>
                  </div>
                </header>
                <div className="master-clinic-board">
                  {clinics.map((clinic) => (
                    <label className="master-check-row" key={clinic.id}>
                      <input
                        type="checkbox"
                        checked={normalizeClinicIds(selectedUser).includes(String(clinic.id))}
                        onChange={() => toggleClinic(selectedUser.id, clinic.id)}
                      />
                      <span>{clinic.name}</span>
                    </label>
                  ))}
                  {!clinics.length && <p className="empty-state">Nenhuma clinica encontrada.</p>}
                </div>
              </article>
            </section>
          )}

          {activeTab === 'system' && (
            <section className="master-console-panel master-system-panel">
              <article className="master-action-card">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Rotina administrativa</p>
                    <h2>Acoes rapidas</h2>
                    <p>Acessos uteis para manutencao diaria, monitoria e auditoria operacional.</p>
                  </div>
                </div>
                <div className="master-action-grid">
                  <button className="outline-action" onClick={() => navigate('/admin/monitoria')}>Monitoria Master</button>
                  <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard Financeiro</button>
                  <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestao Financeira</button>
                  <button className="outline-action danger-action" onClick={clearFinancialTests} disabled={clearingTests}>{clearingTests ? 'Limpando...' : 'Limpar testes financeiros'}</button>
                </div>
              </article>

              <article className="master-action-card">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Colaboradores CRC</p>
                    <h2>Exclusao controlada</h2>
                    <p>Remocao restrita ao Administrador Master para preservar a base financeira.</p>
                  </div>
                </div>
                <div className="master-collaborator-scroll">
                  {collaborators.map((collaborator) => (
                    <div className="master-collaborator-row" key={collaborator.id}>
                      <strong>{collaborator.name}<small>{collaborator.function_name || 'Funcao nao informada'}</small></strong>
                      <button className="outline-action danger-action mini-action" onClick={() => deleteCollaborator(collaborator)}>Excluir</button>
                    </div>
                  ))}
                  {!collaborators.length && <p className="empty-state">Nenhum colaborador cadastrado.</p>}
                </div>
              </article>
            </section>
          )}

          {activeTab === 'financial' && settings && (
            <section className="master-console-panel master-financial-panel">
              <div className="master-section-heading">
                <div>
                  <p className="eyebrow">Regras de calculo</p>
                  <h2>Inteligencia Financeira CRC</h2>
                  <p>Parametros usados para status, diagnosticos, margens e comparativos do painel financeiro. A SELIC permanece travada em 15% ao ano.</p>
                </div>
                <button className="primary-action" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Salvando...' : 'Salvar regras'}</button>
              </div>

              <div className="master-form-grid compact">
                <label>ROI CRC excelente (%)<input className="field" type="number" step="0.01" value={settings.crcRoiExcellent ?? ''} onChange={(event) => updateSetting('crcRoiExcellent', event.target.value)} /></label>
                <label>Margem liquida minima (%)<input className="field" type="number" step="0.01" value={settings.netMarginHealthyMin ?? ''} onChange={(event) => updateSetting('netMarginHealthyMin', event.target.value)} /></label>
                <label>Tolerancia ROI vs SELIC (%)<input className="field" type="number" step="0.01" value={settings.selicComparisonTolerance ?? ''} onChange={(event) => updateSetting('selicComparisonTolerance', event.target.value)} /></label>
              </div>

              <div className="master-margin-board">
                {Object.entries(settings.expectedMargins || {}).map(([key, item]) => (
                  <article key={key}>
                    <strong>{item.label}</strong>
                    <label>Minimo<input className="field" type="number" step="0.01" value={item.min ?? ''} onChange={(event) => updateMargin(key, 'min', event.target.value)} /></label>
                    <label>Maximo<input className="field" type="number" step="0.01" value={item.max ?? ''} onChange={(event) => updateMargin(key, 'max', event.target.value)} /></label>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>
      )}
    </main>
  );
}

export default MasterControlCenter;
