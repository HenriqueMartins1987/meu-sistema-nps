import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from './api';
import { hasActionPermission, isMasterAdmin, normalizeRoleValue, readUser } from './constants';
import {
  NPS_PROFILE_LABELS,
  NPS_STATUS_LABELS,
  PRIORITY_LABELS,
  buildExecutiveAlerts,
  buildPriorityQueue,
  calculateMetrics,
  calculateRisk,
  classifyNps,
  derivePriority,
  getNpsStatus,
  getSlaState,
  normalizeText
} from './npsEnterpriseAnalytics';
import './NpsEnterprise.css';

const initialFilters = {
  search: '', clinic: '', region: '', state: '', coordinator: '', profile: '',
  status: '', priority: '', sla: '', recovery: ''
};

const SUBSTATUS_LABELS = {
  aguardando_retorno_paciente: 'Aguardando retorno do paciente',
  aguardando_unidade: 'Aguardando unidade',
  aguardando_area_interna: 'Aguardando área interna',
  resolvido: 'Resolvido'
};

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function formatDate(value) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatHours(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value);
  if (numeric < 0) return `${Math.abs(numeric).toFixed(1)}h vencido`;
  return `${numeric.toFixed(1)}h restantes`;
}

function protocolLabel(item) {
  if (item?.nps_protocol) return item.nps_protocol;
  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function buildWhatsappUrl(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}`;
}

function ManagementChip({ children, type = 'default' }) {
  return <span className={`nps-management-chip ${type}`}>{children}</span>;
}

function NpsManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = readUser();
  const currentUserRole = normalizeRoleValue(currentUser?.role);
  const canViewDeleted = isMasterAdmin(currentUser);
  const canDeleteRecords = isMasterAdmin(currentUser) || currentUserRole === 'supervisor_crc';
  const canFinishNps = hasActionPermission(currentUser, 'nps_finish');
  const canManageAutomation = ['admin', 'master_admin', 'supervisor_crc'].includes(currentUserRole) || isMasterAdmin(currentUser);
  const focusNpsId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const parsed = Number(params.get('abrir') || params.get('id'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [location.search]);

  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [causes, setCauses] = useState([]);
  const [automationOverview, setAutomationOverview] = useState(null);
  const [viewMode, setViewMode] = useState('active');
  const [filters, setFilters] = useState(initialFilters);
  const [selectedNps, setSelectedNps] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [automationBusy, setAutomationBusy] = useState('');
  const [managementForm, setManagementForm] = useState({
    operational_priority: 'normal', management_substatus: '', cause_category: '', cause_subcategory: '',
    root_cause: '', responsible_name: '', sla_due_at: '', recovery_status: 'nao_iniciado',
    nps_status: 'registrado', treatment_comment: ''
  });
  const autoOpenRef = useRef(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setFeedback('');
    try {
      const [npsRes, clinicsRes, overviewRes, causesRes] = await Promise.all([
        api.get('/nps/responses', { params: canViewDeleted ? { include_deleted: 1 } : undefined }),
        api.get('/clinics'),
        api.get('/nps/automation/overview').catch(() => ({ data: null })),
        api.get('/nps/enterprise/causes').catch(() => ({ data: [] }))
      ]);
      setRows(Array.isArray(npsRes.data) ? npsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setAutomationOverview(overviewRes.data || null);
      setCauses(Array.isArray(causesRes.data) ? causesRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a central de gestão NPS.');
    } finally {
      setLoading(false);
    }
  }, [canViewDeleted]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const operationalRows = useMemo(() => rows.filter((item) => !item.deleted_at), [rows]);
  const activeRows = useMemo(() => operationalRows.filter((item) => getNpsStatus(item) !== 'tratado'), [operationalRows]);
  const finishedRows = useMemo(() => operationalRows.filter((item) => getNpsStatus(item) === 'tratado'), [operationalRows]);
  const deletedRows = useMemo(() => rows.filter((item) => item.deleted_at), [rows]);
  const baseRows = viewMode === 'finished' ? finishedRows : viewMode === 'deleted' ? deletedRows : activeRows;

  const filterOptions = useMemo(() => ({
    clinics: uniqueList([...rows.map((item) => item.clinic_name), ...clinics.map((item) => item.name)]),
    regions: uniqueList([...rows.map((item) => item.region), ...clinics.map((item) => item.region)]),
    states: uniqueList([...rows.map((item) => item.state), ...clinics.map((item) => item.state)]),
    coordinators: uniqueList([...rows.map((item) => item.coordinator_name), ...clinics.map((item) => item.coordinator_name)])
  }), [rows, clinics]);

  const filteredRows = useMemo(() => baseRows.filter((item) => {
    const profile = item.nps_profile || classifyNps(item.score);
    const status = getNpsStatus(item);
    const priority = derivePriority(item);
    const sla = getSlaState(item);
    const searchable = normalizeText([
      protocolLabel(item), item.patient_name, item.patient_phone, item.clinic_name, item.region,
      item.coordinator_name, item.detractor_feedback, item.improvement_comment, item.comment,
      item.nps_treatment_comment, item.cause_category, item.cause_subcategory, item.responsible_name
    ].filter(Boolean).join(' '));

    return (
      (!filters.search || searchable.includes(normalizeText(filters.search)))
      && (!filters.clinic || item.clinic_name === filters.clinic)
      && (!filters.region || item.region === filters.region)
      && (!filters.state || item.state === filters.state)
      && (!filters.coordinator || item.coordinator_name === filters.coordinator)
      && (!filters.profile || profile === filters.profile)
      && (!filters.status || status === filters.status)
      && (!filters.priority || priority === filters.priority)
      && (!filters.sla || sla.code === filters.sla)
      && (!filters.recovery || String(item.recovery_status || 'nao_iniciado') === filters.recovery)
    );
  }).sort((left, right) => {
    const priorityOrder = { critica: 4, alta: 3, media: 2, normal: 1 };
    const priorityDiff = priorityOrder[derivePriority(right)] - priorityOrder[derivePriority(left)];
    if (priorityDiff !== 0) return priorityDiff;
    return calculateRisk(right).score - calculateRisk(left).score;
  }), [baseRows, filters]);

  const metrics = useMemo(() => calculateMetrics(operationalRows, automationOverview?.summary || {}), [automationOverview, operationalRows]);
  const priorityQueue = useMemo(() => buildPriorityQueue(operationalRows), [operationalRows]);
  const alerts = useMemo(() => buildExecutiveAlerts(operationalRows), [operationalRows]);

  const loadTimeline = useCallback(async (id) => {
    try {
      const response =
        await api.get(
          `/nps/enterprise/responses/${id}/timeline`
        );

      setTimeline(
        Array.isArray(response.data)
          ? response.data
          : []
      );

    } catch (_error) {
      setTimeline([]);
    }
  }, []);

  const openManagement = useCallback((item) => {
    const slaDue =
      item.sla_due_at
        ? new Date(item.sla_due_at)
            .toISOString()
            .slice(0, 16)
        : '';

    setSelectedNps(item);

    setManagementForm({
      operational_priority:
        item.operational_priority
        || derivePriority(item),

      management_substatus:
        item.management_substatus
        || '',

      cause_category:
        item.cause_category
        || '',

      cause_subcategory:
        item.cause_subcategory
        || '',

      root_cause:
        item.root_cause
        || '',

      responsible_name:
        item.responsible_name
        || item.nps_treatment_by
        || '',

      sla_due_at:
        slaDue,

      recovery_status:
        item.recovery_status
        || 'nao_iniciado',

      nps_status:
        getNpsStatus(item),

      treatment_comment:
        ''
    });

    setFeedback('');

    loadTimeline(item.id);

  }, [loadTimeline]);

  useEffect(() => {
    if (
      !focusNpsId
      || autoOpenRef.current
      || !rows.length
    ) {
      return;
    }

    const target =
      rows.find(
        item =>
          Number(item.id)
          === focusNpsId
      );

    if (!target) {
      return;
    }

    autoOpenRef.current = true;

    openManagement(target);

    navigate(
      location.pathname,
      {
        replace: true
      }
    );

  }, [
    focusNpsId,
    rows,
    navigate,
    location.pathname,
    openManagement
  ]);

  function closeManagement() {
    setSelectedNps(null);
    setTimeline([]);
    setShowDeleteModal(false);
  }

  const setManagementField = (field, value) => {
    setManagementForm((previous) => ({ ...previous, [field]: value }));
  };

  const selectedCategoryOptions = useMemo(
    () => uniqueList(causes.map((item) => item.category)),
    [causes]
  );
  const selectedSubcategories = useMemo(
    () => causes.filter((item) => item.category === managementForm.cause_category),
    [causes, managementForm.cause_category]
  );

  const saveManagement = async () => {
    if (!selectedNps) return;
    setSaving(true);
    setFeedback('');

    try {
      const payload = {
        ...managementForm,
        cause_category: managementForm.cause_category || null,
        cause_subcategory: managementForm.cause_subcategory || null,
        management_substatus: managementForm.management_substatus || null,
        root_cause: managementForm.root_cause || null,
        responsible_name: managementForm.responsible_name || null,
        sla_due_at: managementForm.sla_due_at ? new Date(managementForm.sla_due_at).toISOString() : null,
        treatment_comment: managementForm.treatment_comment || null
      };
      const response = await api.patch(`/nps/enterprise/responses/${selectedNps.id}/management`, payload);
      const updated = response.data?.response;
      if (updated) {
        setRows((previous) => previous.map((item) => Number(item.id) === Number(updated.id) ? { ...item, ...updated } : item));
        setSelectedNps((previous) => ({ ...previous, ...updated }));
      } else {
        await loadRows();
      }
      await loadTimeline(selectedNps.id);
      setManagementField('treatment_comment', '');
      setFeedback(`Gestão atualizada no protocolo ${protocolLabel(selectedNps)}.`);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar a gestão NPS. Verifique se o módulo enterprise está habilitado no backend.');
    } finally {
      setSaving(false);
    }
  };

  const extendSla = async () => {
    if (!selectedNps || !managementForm.sla_due_at) {
      setFeedback('Informe um novo prazo para prorrogação do SLA.');
      return;
    }
    const reason = window.prompt('Justificativa obrigatória para a prorrogação do SLA:');
    if (!reason || reason.trim().length < 10) {
      setFeedback('A justificativa precisa ter pelo menos 10 caracteres.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/nps/enterprise/responses/${selectedNps.id}/sla-extension`, {
        new_due_at: new Date(managementForm.sla_due_at).toISOString(),
        reason: reason.trim()
      });
      await loadRows();
      await loadTimeline(selectedNps.id);
      setFeedback('SLA prorrogado com justificativa e trilha de auditoria.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível prorrogar o SLA.');
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToComplaint = async () => {
    if (!selectedNps) return;
    setSaving(true);
    try {
      const response = await api.post(`/nps/responses/${selectedNps.id}/convert-complaint`);
      await loadRows();
      setFeedback(`Detrator migrado para reclamação no protocolo ${response.data?.protocol || ''}.`);
      if (response.data?.complaintId) navigate(`/gestao/${response.data.complaintId}`);
      closeManagement();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível migrar este NPS para reclamação.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNps = async () => {
    if (!selectedNps || !canDeleteRecords) return;
    setSaving(true);
    try {
      await api.delete(`/nps/responses/${selectedNps.id}`, { data: { reason: 'Exclusão administrativa pela Central de Gestão NPS.' } });
      await loadRows();
      closeManagement();
      setFeedback('Pesquisa NPS excluída com lastro de auditoria.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir a pesquisa NPS.');
    } finally {
      setSaving(false);
    }
  };

  const handleAutomation = async (action) => {
    if (!canManageAutomation) return;
    setAutomationBusy(action);
    setFeedback('');
    const endpoint = action === 'run' ? '/nps/automation/run' : action === 'test' ? '/nps/automation/test-login' : '/nps/automation/reprocess-failures';
    try {
      const response = await api.post(endpoint, {});
      setFeedback(response.data?.message || 'Ação concluída.');
      await loadRows();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível executar a ação da automação NPS.');
    } finally {
      setAutomationBusy('');
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/nps/bulk-template', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'template-envio-nps.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível baixar o template NPS.');
    }
  };

  const handleBulkDispatch = async () => {
    if (!bulkFile) {
      setFeedback('Selecione a planilha para envio em massa.');
      return;
    }
    setBulkSending(true);
    try {
      const formData = new FormData();
      formData.append('file', bulkFile);
      const response = await api.post('/nps/bulk-dispatch', formData);
      setFeedback(response.data?.message || 'Envio em massa preparado com sucesso.');
      setBulkFile(null);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível processar a planilha NPS.');
    } finally {
      setBulkSending(false);
    }
  };

  return (
    <main className="app-page nps-enterprise-page">
      <header className="page-heading nps-enterprise-heading">
        <div>
          <p className="eyebrow">Gestão de experiência</p>
          <h1>Central Operacional NPS</h1>
          <p>Tratativa de detratores, SLA, causa raiz, recuperação, prioridades e relacionamento.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" type="button" onClick={() => navigate('/dashboard-nps')}>Cockpit Executivo</button>
          <button className="outline-action" type="button" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="nps-enterprise-kpi-grid">
        <article className="nps-enterprise-kpi featured"><span>NPS</span><strong>{metrics.nps}</strong><small>Índice atual da base operacional</small></article>
        <article className="nps-enterprise-kpi negative"><span>Detratores pendentes</span><strong>{metrics.pendingDetractors}</strong><small>{metrics.overdue} SLA(s) vencido(s)</small></article>
        <article className="nps-enterprise-kpi"><span>Em tratamento</span><strong>{metrics.inTreatment}</strong><small>{metrics.treated} tratado(s)</small></article>
        <article className="nps-enterprise-kpi"><span>Conformidade SLA</span><strong>{metrics.slaCompliance}%</strong><small>Casos dentro do prazo</small></article>
        <article className="nps-enterprise-kpi positive"><span>Taxa de reversão</span><strong>{metrics.recoveryRate}%</strong><small>{metrics.recovered} detrator(es) recuperado(s)</small></article>
      </section>

      <section className="nps-enterprise-grid two-columns">
        <article className="nps-enterprise-panel">
          <div className="nps-enterprise-section-head"><div><p className="eyebrow">Prioridades do dia</p><h2>Fila de risco</h2></div><span className="nps-enterprise-note">{priorityQueue.length} caso(s) em aberto</span></div>
          <div className="nps-enterprise-compact-list">
            {priorityQueue.slice(0, 8).map((item) => (
              <div key={item.id}>
                <span><b>{protocolLabel(item)}</b><small>{item.patient_name || 'Paciente não informado'} · {item.clinic_name || 'Unidade não informada'}</small></span>
                <span><ManagementChip type={item.enterprisePriority}>{PRIORITY_LABELS[item.enterprisePriority]}</ManagementChip> <ManagementChip type={item.enterpriseSla.code}>{item.enterpriseSla.label}</ManagementChip></span>
              </div>
            ))}
            {!priorityQueue.length && <p className="empty-state">Nenhum detrator pendente.</p>}
          </div>
        </article>

        <article className="nps-enterprise-panel">
          <div className="nps-enterprise-section-head"><div><p className="eyebrow">Alertas</p><h2>Riscos gerenciais</h2></div></div>
          <div className="nps-enterprise-alert-list">
            {alerts.length ? alerts.map((alert) => <div key={alert.type} className={`nps-enterprise-alert ${alert.severity}`}><strong>{alert.title}</strong><span>Ação requerida</span></div>) : <p className="empty-state">Nenhum alerta crítico.</p>}
          </div>
        </article>
      </section>

      <section className="nps-enterprise-panel">
        <div className="nps-enterprise-section-head">
          <div><p className="eyebrow">Base operacional</p><h2>Gestão das pesquisas NPS</h2></div>
          <div className="patient-tabs" role="tablist">
            <button type="button" className={viewMode === 'active' ? 'active' : ''} onClick={() => setViewMode('active')}>Ativos ({activeRows.length})</button>
            <button type="button" className={viewMode === 'finished' ? 'active' : ''} onClick={() => setViewMode('finished')}>Finalizados ({finishedRows.length})</button>
            {canViewDeleted && <button type="button" className={viewMode === 'deleted' ? 'active' : ''} onClick={() => setViewMode('deleted')}>Excluídos ({deletedRows.length})</button>}
          </div>
        </div>

        <div className="nps-enterprise-filters">
          <input className="field" value={filters.search} onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))} placeholder="Buscar protocolo, paciente, unidade, relato ou responsável" />
          <select className="field" value={filters.clinic} onChange={(event) => setFilters((previous) => ({ ...previous, clinic: event.target.value }))}><option value="">Todas as unidades</option>{filterOptions.clinics.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select className="field" value={filters.region} onChange={(event) => setFilters((previous) => ({ ...previous, region: event.target.value }))}><option value="">Todas as regiões</option>{filterOptions.regions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select className="field" value={filters.coordinator} onChange={(event) => setFilters((previous) => ({ ...previous, coordinator: event.target.value }))}><option value="">Todos os coordenadores</option>{filterOptions.coordinators.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select className="field" value={filters.profile} onChange={(event) => setFilters((previous) => ({ ...previous, profile: event.target.value }))}><option value="">Todos os perfis</option><option value="detrator">Detratores</option><option value="neutro">Neutros</option><option value="promotor">Promotores</option></select>
          <select className="field" value={filters.status} onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}><option value="">Todos os status</option><option value="registrado">Registrado</option><option value="em_tratativa">Em tratamento</option><option value="tratado">Tratado</option></select>
          <select className="field" value={filters.priority} onChange={(event) => setFilters((previous) => ({ ...previous, priority: event.target.value }))}><option value="">Todas as prioridades</option><option value="critica">Crítica</option><option value="alta">Alta</option><option value="media">Média</option><option value="normal">Normal</option></select>
          <select className="field" value={filters.sla} onChange={(event) => setFilters((previous) => ({ ...previous, sla: event.target.value }))}><option value="">Todos os SLA</option><option value="overdue">Vencido</option><option value="warning">Próximo do vencimento</option><option value="on_time">Dentro do prazo</option><option value="closed">Concluído</option></select>
          <select className="field" value={filters.recovery} onChange={(event) => setFilters((previous) => ({ ...previous, recovery: event.target.value }))}><option value="">Todas as recuperações</option><option value="nao_iniciado">Não iniciado</option><option value="em_tratativa">Em tratativa</option><option value="recuperado">Recuperado</option><option value="nao_recuperado">Não recuperado</option><option value="sem_retorno">Sem retorno</option></select>
        </div>

        {feedback && <p className="form-feedback">{feedback}</p>}
        {loading ? <p className="empty-state">Carregando central NPS...</p> : (
          <div className="nps-enterprise-table-wrap">
            <table className="nps-enterprise-table">
              <thead><tr><th>Protocolo</th><th>Paciente</th><th>Clínica</th><th>Nota</th><th>Prioridade</th><th>SLA</th><th>Status</th><th>Responsável</th><th>Risco</th><th>Ação</th></tr></thead>
              <tbody>
                {filteredRows.map((item) => {
                  const priority = derivePriority(item);
                  const sla = getSlaState(item);
                  const risk = calculateRisk(item);
                  const profile = item.nps_profile || classifyNps(item.score);
                  return (
                    <tr key={item.id}>
                      <td><strong>{protocolLabel(item)}</strong><small>{formatDate(item.responded_at || item.created_at)}</small></td>
                      <td><strong>{item.patient_name || 'Não informado'}</strong><small>{item.patient_phone || 'Sem telefone'}</small></td>
                      <td>{item.clinic_name || 'Não informada'}<small>{item.region || 'Região não informada'}</small></td>
                      <td><span className={`nps-enterprise-score ${profile}`}>{item.score}</span><small>{NPS_PROFILE_LABELS[profile]}</small></td>
                      <td><ManagementChip type={priority}>{PRIORITY_LABELS[priority]}</ManagementChip></td>
                      <td><ManagementChip type={sla.code}>{sla.label}</ManagementChip><small>{formatHours(sla.remainingHours)}</small></td>
                      <td>{NPS_STATUS_LABELS[getNpsStatus(item)] || getNpsStatus(item)}</td>
                      <td>{item.responsible_name || item.nps_treatment_by || 'Não atribuído'}</td>
                      <td><strong>{risk.score}/100</strong><small>{risk.level}</small></td>
                      <td><button className="primary-action small-action" type="button" onClick={() => openManagement(item)}>Abrir gestão</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="nps-enterprise-grid two-columns">
        <article className="nps-enterprise-panel">
          <div className="nps-enterprise-section-head"><div><p className="eyebrow">Automação</p><h2>Ecuro e disparo NPS</h2></div></div>
          <div className="heading-actions">
            <button className="outline-action" type="button" onClick={() => handleAutomation('test')} disabled={!canManageAutomation || automationBusy}>Testar login</button>
            <button className="outline-action" type="button" onClick={() => handleAutomation('retry')} disabled={!canManageAutomation || automationBusy}>Reprocessar falhas</button>
            <button className="primary-action" type="button" onClick={() => handleAutomation('run')} disabled={!canManageAutomation || automationBusy}>{automationBusy === 'run' ? 'Executando...' : 'Executar agora'}</button>
          </div>
          <div className="nps-enterprise-compact-list">
            <div><span><b>Status do robô</b><small>{automationOverview?.robot?.browserMode ? 'Modo browser' : 'Aguardando status'}</small></span><strong>{automationOverview?.robot?.serviceStatus || '—'}</strong></div>
            <div><span><b>Última execução</b><small>Automação NPS</small></span><strong>{formatDate(automationOverview?.summary?.lastExecutionAt)}</strong></div>
            <div><span><b>Dry-run</b><small>Proteção de envio</small></span><strong>{automationOverview?.robot?.dryRun ? 'Ativo' : 'Inativo'}</strong></div>
          </div>
        </article>

        <article className="nps-enterprise-panel">
          <div className="nps-enterprise-section-head"><div><p className="eyebrow">Envio em massa</p><h2>Campanha NPS controlada</h2></div><button className="outline-action" type="button" onClick={handleDownloadTemplate}>Baixar template</button></div>
          <label className="field"><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setBulkFile(event.target.files?.[0] || null)} /></label>
          {bulkFile && <p className="nps-enterprise-note">Arquivo: {bulkFile.name}</p>}
          <button className="primary-action" type="button" onClick={handleBulkDispatch} disabled={bulkSending}>{bulkSending ? 'Processando...' : 'Preparar envio'}</button>
        </article>
      </section>

      {selectedNps && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeManagement}>
          <section className="modal-panel nps-enterprise-management-modal" onClick={(event) => event.stopPropagation()}>
            <div className="nps-enterprise-section-head">
              <div><p className="eyebrow">Gestão do protocolo</p><h2>{protocolLabel(selectedNps)}</h2><p>{selectedNps.patient_name || 'Paciente não informado'} · {selectedNps.clinic_name || 'Unidade não informada'}</p></div>
              <div><ManagementChip type={derivePriority(selectedNps)}>{PRIORITY_LABELS[derivePriority(selectedNps)]}</ManagementChip></div>
            </div>

            <div className="nps-enterprise-thermometer modal-summary">
              <article><span>Nota</span><strong>{selectedNps.score}</strong></article>
              <article><span>Perfil</span><strong>{NPS_PROFILE_LABELS[selectedNps.nps_profile || classifyNps(selectedNps.score)]}</strong></article>
              <article><span>Status</span><strong>{NPS_STATUS_LABELS[getNpsStatus(selectedNps)]}</strong></article>
              <article><span>SLA</span><strong>{getSlaState(selectedNps).label}</strong></article>
              <article><span>Risco</span><strong>{calculateRisk(selectedNps).score}/100</strong></article>
            </div>

            <section className="nps-management-voice">
              <h3>Voz do paciente</h3>
              <p>{selectedNps.detractor_feedback || selectedNps.improvement_comment || selectedNps.comment || 'Sem comentário detalhado.'}</p>
            </section>

            <div className="nps-enterprise-form-grid">
              <label>Prioridade operacional<select className="field" value={managementForm.operational_priority} onChange={(event) => setManagementField('operational_priority', event.target.value)}><option value="normal">Normal</option><option value="media">Média</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></label>
              <label>Status principal<select className="field" value={managementForm.nps_status} onChange={(event) => setManagementField('nps_status', event.target.value)}><option value="registrado">Registrado</option><option value="em_tratativa">Em tratamento</option><option value="tratado">Tratado</option></select></label>
              <label>Substatus<select className="field" value={managementForm.management_substatus} onChange={(event) => setManagementField('management_substatus', event.target.value)}><option value="">Sem substatus</option>{Object.entries(SUBSTATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>Responsável<input className="field" value={managementForm.responsible_name} onChange={(event) => setManagementField('responsible_name', event.target.value)} placeholder="Nome do responsável" /></label>
              <label>Categoria da causa<select className="field" value={managementForm.cause_category} onChange={(event) => { setManagementField('cause_category', event.target.value); setManagementField('cause_subcategory', ''); }}><option value="">Não classificada</option>{selectedCategoryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Subcategoria<select className="field" value={managementForm.cause_subcategory} onChange={(event) => setManagementField('cause_subcategory', event.target.value)}><option value="">Não classificada</option>{selectedSubcategories.map((item) => <option key={item.id || item.subcategory} value={item.subcategory}>{item.subcategory}</option>)}</select></label>
              <label>Prazo SLA<input className="field" type="datetime-local" value={managementForm.sla_due_at} onChange={(event) => setManagementField('sla_due_at', event.target.value)} /></label>
              <label>Recuperação<select className="field" value={managementForm.recovery_status} onChange={(event) => setManagementField('recovery_status', event.target.value)}><option value="nao_iniciado">Não iniciado</option><option value="em_tratativa">Em tratativa</option><option value="recuperado">Recuperado</option><option value="nao_recuperado">Não recuperado</option><option value="sem_retorno">Sem retorno</option></select></label>
            </div>

            <label>Causa raiz<textarea className="field textarea" value={managementForm.root_cause} onChange={(event) => setManagementField('root_cause', event.target.value.slice(0, 5000))} placeholder="Registre a causa raiz identificada, com base em fatos e evidências." /></label>
            <label>Registro da tratativa<textarea className="field textarea treatment-textarea" value={managementForm.treatment_comment} onChange={(event) => setManagementField('treatment_comment', event.target.value.slice(0, 5000))} placeholder="Ação realizada, contato, retorno ao paciente, evidências e próximos passos." /></label>

            <section className="nps-management-timeline">
              <h3>Timeline do protocolo</h3>
              {timeline.length ? timeline.map((event) => <article key={event.id}><div><strong>{event.action}</strong><span>{formatDate(event.created_at)}</span></div><small>{event.actor_name || 'Usuário'} · {event.actor_role || 'Perfil não informado'}</small><p>{event.message || 'Movimentação gerencial registrada.'}</p></article>) : <p className="empty-state">Ainda não há eventos enterprise registrados.</p>}
            </section>

            <div className="heading-actions">
              {buildWhatsappUrl(selectedNps.patient_phone) && <a className="primary-action" href={buildWhatsappUrl(selectedNps.patient_phone)} target="_blank" rel="noreferrer">Chamar no WhatsApp</a>}
              <button className="outline-action" type="button" onClick={extendSla} disabled={saving}>Prorrogar SLA</button>
              {(selectedNps.nps_profile || classifyNps(selectedNps.score)) === 'detrator' && !selectedNps.converted_complaint_id && <button className="outline-action" type="button" onClick={handleConvertToComplaint} disabled={saving}>Migrar para reclamação</button>}
              {canFinishNps && (selectedNps.nps_profile || classifyNps(selectedNps.score)) === 'detrator' && <button className="outline-action" type="button" onClick={() => { setManagementField('nps_status', 'tratado'); setManagementField('recovery_status', managementForm.recovery_status === 'nao_iniciado' ? 'nao_recuperado' : managementForm.recovery_status); }} disabled={saving}>Preparar finalização</button>}
              {canDeleteRecords && !selectedNps.deleted_at && <button className="outline-action danger-action" type="button" onClick={() => setShowDeleteModal(true)} disabled={saving}>Excluir NPS</button>}
              <button className="outline-action" type="button" onClick={closeManagement} disabled={saving}>Fechar</button>
              <button className="primary-action" type="button" onClick={saveManagement} disabled={saving}>{saving ? 'Salvando...' : 'Salvar gestão'}</button>
            </div>
          </section>
        </div>
      )}

      {showDeleteModal && selectedNps && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowDeleteModal(false)}>
          <section className="modal-panel modal-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Excluir NPS</p><h2>Confirma a exclusão lógica?</h2><p>O registro permanecerá disponível para auditoria conforme as regras atuais do sistema.</p>
            <div className="row-actions"><button className="outline-action" type="button" onClick={() => setShowDeleteModal(false)}>Cancelar</button><button className="outline-action danger-action" type="button" onClick={handleDeleteNps} disabled={saving}>{saving ? 'Excluindo...' : 'Confirmar exclusão'}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

export default NpsManagement;
