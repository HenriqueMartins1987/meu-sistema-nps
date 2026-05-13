import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from './api';
import {
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isMasterAdmin,
  readUser,
  screenPermissions
} from './constants';

const financialPermissionIds = new Set(['financial_dashboard', 'financial_campaigns', 'financial_management']);

function toNumber(value) {
  const parsed = Number(String(value || 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function MasterControlCenter() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [users, setUsers] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [settings, setSettings] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [clearingTests, setClearingTests] = useState(false);

  const financialPermissions = useMemo(
    () => screenPermissions.filter((permission) => financialPermissionIds.has(permission.value)),
    []
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [usersRes, settingsRes, collaboratorsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/financial-settings'),
        api.get('/crc-collaborators')
      ]);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setSettings(settingsRes.data || null);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o centro de controle master.');
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

  const toggleUserPermission = (userId, permission) => {
    setUsers((current) => current.map((user) => {
      if (String(user.id) !== String(userId)) return user;
      const permissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
      permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
      return { ...user, permissions: Array.from(permissions) };
    }));
  };

  const saveUserPermissions = async (user) => {
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
        clinicIds: Array.isArray(user.clinics) ? user.clinics.map((clinic) => clinic.clinic_id) : []
      });
      setFeedback(`Autorizações atualizadas para ${user.name}.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar as autorizações do usuário.');
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
      setFeedback('Regras de cálculo financeiro atualizadas.');
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
      <header className="page-heading">
        <div>
          <p className="eyebrow">Painel Gerencial</p>
          <h1>Centro Master do Sistema</h1>
          <p>Autorizações, regras financeiras e ações administrativas imediatas em um único local.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/admin')}>Gestão de usuários</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback">{feedback}</p>}
      {loading && <section className="management-panel"><p className="empty-state">Carregando centro master...</p></section>}

      {!loading && (
        <>
          <section className="master-control-grid">
            <article className="management-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Autorizações</p>
                  <h2>Acesso financeiro por usuário</h2>
                  <p className="base-subtitle">Marque as telas financeiras e salve diretamente na linha do usuário.</p>
                </div>
              </div>
              <div className="master-permission-table">
                <div className="master-permission-row header">
                  <span>Usuário</span>
                  {financialPermissions.map((permission) => <span key={permission.value}>{permission.label.replace('Financeiro CRC - ', '')}</span>)}
                  <span>Ação</span>
                </div>
                {users.map((user) => (
                  <div className="master-permission-row" key={user.id}>
                    <strong>{user.name}<small>{user.email}</small></strong>
                    {financialPermissions.map((permission) => (
                      <label key={permission.value}>
                        <input
                          type="checkbox"
                          checked={Array.isArray(user.permissions) && user.permissions.includes(permission.value)}
                          onChange={() => toggleUserPermission(user.id, permission.value)}
                        />
                      </label>
                    ))}
                    <button className="outline-action mini-action" onClick={() => saveUserPermissions(user)} disabled={savingUserId === String(user.id)}>
                      {savingUserId === String(user.id) ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                ))}
              </div>
            </article>

            <article className="management-panel master-actions-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Controle imediato</p>
                  <h2>Ações do Administrador Master</h2>
                  <p className="base-subtitle">Atalhos e manutenção sensível do sistema.</p>
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
                  <h2>Exclusão administrativa</h2>
                  <p className="base-subtitle">Remova colaboradores que não devem compor os custos mensais do ROI.</p>
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
                  <p className="base-subtitle">Altere taxas, margens e percentuais usados para status, diagnóstico e comparativos.</p>
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
