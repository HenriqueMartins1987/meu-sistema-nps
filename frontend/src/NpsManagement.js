import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from './api';
import { hasActionPermission, isMasterAdmin, normalizeRoleValue, readUser } from './constants';

const profileLabels = {
  detrator: 'Detrator',
  neutro: 'Neutro',
  promotor: 'Promotor'
};

const statusLabels = {
  registrado: 'Registrado',
  em_tratativa: 'Em tratamento',
  tratado: 'Tratado'
};

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function formatDate(value) {
  if (!value) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function profileFromScore(score) {
  const value = Number(score || 0);
  if (value >= 9) return 'promotor';
  if (value >= 7) return 'neutro';
  return 'detrator';
}

function profileWeight(profile) {
  if (profile === 'detrator') return 0;
  if (profile === 'neutro') return 1;
  return 2;
}

function buildWhatsappUrl(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}`;
}

function getNpsStatus(item) {
  return item?.nps_status || 'registrado';
}

function canFinalizeNps(item) {
  if (!item || item.deleted_at) return false;
  const profile = item.nps_profile || profileFromScore(item.score);
  return profile === 'detrator' && getNpsStatus(item) !== 'tratado';
}

function protocolLabel(item) {
  if (item?.nps_protocol) return item.nps_protocol;

  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function parseReasons(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(value)];
  } catch (error) {
    return [String(value)];
  }
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function buildBriefText(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function buildNpsNextAction(item) {
  if (!item) return 'Validar o registro e direcionar o atendimento.';
  const profile = item.nps_profile || profileFromScore(item.score);
  const status = getNpsStatus(item);

  if (item.deleted_at) return 'Registro excluído da operação ativa. Consultar apenas para histórico.';
  if (status === 'tratado') return 'Tratativa concluída. Confirmar se o retorno final ficou devidamente registrado.';
  if (profile === 'detrator' && !String(item.nps_treatment_comment || '').trim()) return 'Registrar a tratativa do detrator com objetividade e evidência do contato.';
  if (profile === 'detrator') return 'Concluir o retorno ao paciente e finalizar a tratativa quando o caso estiver resolvido.';
  if (profile === 'neutro') return 'Avaliar oportunidade de melhoria operacional e registrar eventual ação preventiva.';
  return 'Manter o registro para acompanhamento de satisfação e relacionamento.';
}

function buildNpsExecutiveSummary(item) {
  if (!item) return [];

  const profile = item.nps_profile || profileFromScore(item.score);
  const lastLog = Array.isArray(item.logs) && item.logs.length ? item.logs[0] : null;
  const mainFeedback = buildBriefText(
    item.detractor_feedback || item.improvement_comment || item.comment,
    220
  ) || 'Sem comentário detalhado na pesquisa.';
  const reasons = parseReasons(item.detractor_reasons);
  const lastMovement = lastLog
    ? `${formatDate(lastLog.created_at)} · ${lastLog.actor_name || 'Usuário'} · ${buildBriefText(lastLog.message, 170)}`
    : 'Sem movimentações de tratativa registradas até o momento.';

  return [
    `Pesquisa ${protocolLabel(item)} registrada para ${item.patient_name || 'paciente não informado'} na unidade ${item.clinic_name || 'não informada'}, com nota ${item.score || 'não informada'} e perfil ${profileLabels[profile] || profile}.`,
    `Percepção principal do paciente: ${mainFeedback}`,
    reasons.length ? `Motivos sinalizados pelo paciente: ${reasons.join(', ')}.` : 'O paciente não informou motivos estruturados adicionais na resposta.',
    `Situação atual: ${statusLabels[getNpsStatus(item)] || getNpsStatus(item)}. Última movimentação: ${lastMovement}`,
    `Próxima ação recomendada: ${buildNpsNextAction(item)}`
  ];
}

function NpsManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const focusNpsId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const rawId = params.get('abrir') || params.get('id');
    const parsedId = Number(rawId);
    return Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null;
  }, [location.search]);
  const currentUser = readUser();
  const currentUserRole = normalizeRoleValue(currentUser?.role);
  const canViewDeleted = isMasterAdmin(currentUser);
  const canDeleteRecords = isMasterAdmin(currentUser) || currentUserRole === 'supervisor_crc';
  const canFinishNps = hasActionPermission(currentUser, 'nps_finish');
  const canManageAutomation = ['admin', 'master_admin', 'supervisor_crc'].includes(currentUserRole) || isMasterAdmin(currentUser);
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [viewMode, setViewMode] = useState('active');
  const [filters, setFilters] = useState({
    profile: '',
    clinic: '',
    state: '',
    region: '',
    coordinator: '',
    status: '',
    search: ''
  });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [selectedNps, setSelectedNps] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showExecutiveSummary, setShowExecutiveSummary] = useState(false);
  const [treatmentText, setTreatmentText] = useState('');
  const [treatmentStatus, setTreatmentStatus] = useState('em_tratativa');
  const [bulkFile, setBulkFile] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [bulkSending, setBulkSending] = useState(false);
  const [automationOverview, setAutomationOverview] = useState(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationRunning, setAutomationRunning] = useState(false);
  const [automationTesting, setAutomationTesting] = useState(false);
  const [automationReprocessing, setAutomationReprocessing] = useState(false);
  const autoOpenNpsRef = useRef(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [npsRes, clinicsRes] = await Promise.all([
        api.get('/nps/responses', {
          params: canViewDeleted ? { include_deleted: 1 } : undefined
        }),
        api.get('/clinics')
      ]);
      setRows(Array.isArray(npsRes.data) ? npsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar as pesquisas NPS.');
    } finally {
      setLoading(false);
    }
  }, [canViewDeleted]);

  const loadAutomationOverview = useCallback(async () => {
    setAutomationLoading(true);

    try {
      const overviewRes = await api.get('/nps/automation/overview');
      setAutomationOverview(overviewRes.data || null);
    } catch (error) {
      setAutomationOverview(null);
    } finally {
      setAutomationLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
    loadAutomationOverview();
  }, [loadAutomationOverview, loadRows]);

  useEffect(() => {
    autoOpenNpsRef.current = false;
  }, [focusNpsId]);

  useEffect(() => {
    if (!canViewDeleted && viewMode === 'deleted') {
      setViewMode('active');
    }
  }, [canViewDeleted, viewMode]);

  useEffect(() => {
    if (!focusNpsId || autoOpenNpsRef.current || !rows.length) {
      return;
    }

    const targetNps = rows.find((item) => item.id === focusNpsId);

    if (!targetNps) {
      return;
    }

    autoOpenNpsRef.current = true;
    setSelectedNps(targetNps);
    setTreatmentText('');
    setTreatmentStatus(getNpsStatus(targetNps) === 'tratado' ? 'tratado' : 'em_tratativa');
    setShowDeleteModal(false);
    navigate(location.pathname, { replace: true });
  }, [focusNpsId, location.pathname, navigate, rows]);

  const operationalRows = useMemo(() => rows.filter((item) => !item.deleted_at), [rows]);
  const activeRows = useMemo(() => (
    operationalRows.filter((item) => getNpsStatus(item) !== 'tratado')
  ), [operationalRows]);
  const finishedRows = useMemo(() => (
    operationalRows.filter((item) => getNpsStatus(item) === 'tratado')
  ), [operationalRows]);
  const deletedRows = useMemo(() => rows.filter((item) => item.deleted_at), [rows]);
  const scopedRows = useMemo(() => {
    if (viewMode === 'finished') return finishedRows;
    if (viewMode === 'deleted' && canViewDeleted) return deletedRows;
    return activeRows;
  }, [activeRows, canViewDeleted, deletedRows, finishedRows, viewMode]);

  const filterOptions = useMemo(() => ({
    clinics: uniqueList([...rows.map((item) => item.clinic_name), ...clinics.map((clinic) => clinic.name)]),
    states: uniqueList([...rows.map((item) => item.state), ...clinics.map((clinic) => clinic.state)]),
    regions: uniqueList([...rows.map((item) => item.region), ...clinics.map((clinic) => clinic.region)]),
    coordinators: uniqueList([...rows.map((item) => item.coordinator_name), ...clinics.map((clinic) => clinic.coordinator_name)])
  }), [rows, clinics]);

  const filteredRows = useMemo(() => scopedRows
    .filter((item) => {
      const profile = item.nps_profile || profileFromScore(item.score);
      const status = getNpsStatus(item);
      const searchable = [
        protocolLabel(item),
        item.patient_name,
        item.patient_phone,
        item.clinic_name,
        item.city,
        item.state,
        item.region,
        item.detractor_feedback,
        item.improvement_comment,
        item.comment,
        item.nps_treatment_comment,
        ...(item.logs || []).map((log) => log.message)
      ].map(normalizeText).join(' ');

      return (
        (!filters.profile || profile === filters.profile)
        && (!filters.clinic || item.clinic_name === filters.clinic)
        && (!filters.state || item.state === filters.state)
        && (!filters.region || item.region === filters.region)
        && (!filters.coordinator || item.coordinator_name === filters.coordinator)
        && (!filters.status || status === filters.status)
        && (!filters.search || searchable.includes(normalizeText(filters.search)))
      );
    })
    .sort((a, b) => {
      const profileDiff = profileWeight(a.nps_profile || profileFromScore(a.score))
        - profileWeight(b.nps_profile || profileFromScore(b.score));

      if (profileDiff !== 0) return profileDiff;

      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }), [filters, scopedRows]);

  const metrics = useMemo(() => {
    const total = operationalRows.length;
    const promoters = operationalRows.filter((item) => Number(item.score) >= 9).length;
    const neutrals = operationalRows.filter((item) => Number(item.score) >= 7 && Number(item.score) <= 8).length;
    const detractors = operationalRows.filter((item) => Number(item.score) <= 6).length;
    const inTreatment = activeRows.filter((item) => getNpsStatus(item) === 'em_tratativa').length;
    const treated = finishedRows.length;
    const pendingDetractors = activeRows.filter((item) => Number(item.score) <= 6 && getNpsStatus(item) !== 'tratado').length;
    const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return { total, promoters, neutrals, detractors, inTreatment, treated, pendingDetractors, nps };
  }, [activeRows, finishedRows, operationalRows]);
  const selectedNpsExecutiveSummary = useMemo(
    () => buildNpsExecutiveSummary(selectedNps),
    [selectedNps]
  );

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const applyQuickFilter = (nextViewMode, nextFilters = {}) => {
    setViewMode(nextViewMode);
    setFilters((prev) => ({
      ...prev,
      profile: '',
      state: '',
      region: '',
      coordinator: '',
      status: '',
      clinic: prev.clinic,
      search: prev.search,
      ...nextFilters
    }));
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/nps/bulk-template', { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'template-envio-nps.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      const backendMessage = typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.data?.error;
      setFeedback(backendMessage || error.message || 'Não foi possível baixar o template de envio em massa.');
    }
  };

  const handleBulkDispatch = async () => {
    if (!bulkFile) {
      setFeedback('Selecione a planilha para envio em massa do link NPS.');
      return;
    }

    setBulkSending(true);
    setFeedback('');

    try {
      const formData = new FormData();
      formData.append('file', bulkFile);
      const response = await api.post('/nps/bulk-dispatch', formData);
      const sessionLabel = response.data?.sessionId ? ` Sessao WhatsApp usada: ${response.data.sessionId}.` : '';
      setFeedback((response.data?.message || 'Envio em massa preparado com sucesso.') + sessionLabel);
      setBulkFile(null);
    } catch (error) {
      const backendMessage = typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.data?.error;
      setFeedback(backendMessage || error.message || 'Não foi possível processar a planilha de envio em massa.');
    } finally {
      setBulkSending(false);
    }
  };

  const handleRunAutomation = async () => {
    setAutomationRunning(true);
    setFeedback('');

    try {
      const response = await api.post('/nps/automation/run', {});
      setFeedback(response.data?.message || 'Robô Ecuro executado com sucesso.');
      await loadAutomationOverview();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível executar o robô Ecuro / NPS automática.');
    } finally {
      setAutomationRunning(false);
    }
  };

  const handleTestAutomationLogin = async () => {
    setAutomationTesting(true);
    setFeedback('');

    try {
      const response = await api.post('/nps/automation/test-login', {});
      setFeedback(response.data?.message || 'Login do robô Ecuro validado.');
      await loadAutomationOverview();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível validar o login do robô Ecuro.');
    } finally {
      setAutomationTesting(false);
    }
  };

  const handleReprocessAutomationFailures = async () => {
    setAutomationReprocessing(true);
    setFeedback('');

    try {
      const response = await api.post('/nps/automation/reprocess-failures', {});
      setFeedback(response.data?.message || 'Falhas da automação NPS reprocessadas.');
      await loadAutomationOverview();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível reprocessar as falhas da automação NPS.');
    } finally {
      setAutomationReprocessing(false);
    }
  };

  const automationSummary = automationOverview?.summary || {};
  const automationRobot = automationOverview?.robot || {};
  const automationJobs = Array.isArray(automationOverview?.recentJobs) ? automationOverview.recentJobs : [];
  const usesSharedSession = automationRobot.sessionId && automationRobot.sessionId !== 'nps';
  const robotStatusLabel = automationRobot.serviceStatus === 'online'
    ? 'Robô online'
    : automationRobot.serviceStatus === 'unreachable'
      ? 'Robô indisponível'
      : automationRobot.serviceStatus === 'api_key_missing'
        ? 'Chave do robô ausente'
        : 'Robô aguardando configuração';
  const sessionStatusLabel = automationRobot.sessionConnected
    ? 'Sessão conectada'
    : 'Sessão não conectada';

  const openTreatment = (item) => {
    setSelectedNps(item);
    setTreatmentText('');
    setTreatmentStatus(getNpsStatus(item) === 'tratado' ? 'tratado' : 'em_tratativa');
    setFeedback('');
    setShowExecutiveSummary(false);
  };

  const closeTreatment = () => {
    setSelectedNps(null);
    setShowDeleteModal(false);
    setTreatmentText('');
    setTreatmentStatus('em_tratativa');
    setShowExecutiveSummary(false);
  };

  const handleSaveTreatment = async () => {
    const comment = treatmentText.trim();

    if (!comment) {
      setFeedback('Descreva a tratativa realizada antes de salvar.');
      return;
    }

    setSavingId(selectedNps.id);
    setFeedback('');

    try {
      const res = await api.patch(`/nps/responses/${selectedNps.id}/treatment`, {
        treatment_comment: comment,
        status: treatmentStatus
      });
      const updated = res.data?.response;

      if (updated) {
        setRows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        await loadRows();
      }

      setFeedback(`Tratativa salva no protocolo ${res.data?.protocol || protocolLabel(selectedNps)}.`);
      closeTreatment();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar a tratativa NPS.');
    } finally {
      setSavingId(null);
    }
  };

  const handleFinalizeNps = async (item = selectedNps) => {
    if (!item || !canFinalizeNps(item)) return;

    const isCurrentSelection = selectedNps?.id === item.id;
    const comment = (isCurrentSelection ? treatmentText : '').trim() || String(item.nps_treatment_comment || '').trim();

    if (!comment) {
      setSelectedNps(item);
      setTreatmentStatus('tratado');
      setFeedback('Descreva a tratativa antes de finalizar o NPS.');
      return;
    }

    setSavingId(item.id);
    setFeedback('');

    try {
      const res = await api.patch(`/nps/responses/${item.id}/treatment`, {
        treatment_comment: comment,
        status: 'tratado'
      });
      const updated = res.data?.response;

      if (updated) {
        setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        if (isCurrentSelection) {
          setSelectedNps(updated);
        }
      } else {
        await loadRows();
      }

      setFeedback(`NPS finalizado no protocolo ${res.data?.protocol || protocolLabel(item)}.`);
      if (isCurrentSelection) {
        closeTreatment();
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível finalizar a tratativa NPS.');
    } finally {
      setSavingId(null);
    }
  };

  const handleConvertToComplaint = async () => {
    setSavingId(selectedNps.id);
    setFeedback('');

    try {
      const res = await api.post(`/nps/responses/${selectedNps.id}/convert-complaint`);
      await loadRows();
      closeTreatment();
      setFeedback(`Detrator migrado para reclamação no protocolo ${res.data?.protocol || ''}.`);

      if (res.data?.complaintId) {
        navigate(`/gestao/${res.data.complaintId}`);
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível migrar este NPS para reclamação.');
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteNps = async () => {
    if (!selectedNps || !canDeleteRecords) return;

    setSavingId(selectedNps.id);
    setFeedback('');

    try {
      await api.delete(`/nps/responses/${selectedNps.id}`, {
        data: { reason: 'Exclusão administrativa pela tela de gestão NPS.' }
      });
      await loadRows();
      setShowDeleteModal(false);
      closeTreatment();
      setFeedback('Pesquisa NPS excluída com lastro de auditoria.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir a pesquisa NPS.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Gestão NPS</p>
          <h1>Painel de Gestão NPS</h1>
          <p>Trate clientes detratores em protocolo próprio, sem misturar com a gestão de reclamações.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/dashboard-nps')}>
            Dashboard NPS
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      <section className="kpi-grid management-kpi-grid" aria-label="Resumo NPS">
        <button type="button" className="kpi-card kpi-button" onClick={() => applyQuickFilter('active')}>
          <span>NPS</span>
          <strong>{metrics.nps}</strong>
          <p>ÍNDICE ATUAL</p>
        </button>
        <button type="button" className="kpi-card success kpi-button" onClick={() => applyQuickFilter('active', { profile: 'promotor' })}>
          <span>Promotores</span>
          <strong>{metrics.promoters}</strong>
          <p>NOTAS 9 E 10</p>
        </button>
        <button type="button" className="kpi-card progress kpi-button" onClick={() => applyQuickFilter('active', { profile: 'neutro' })}>
          <span>Neutros</span>
          <strong>{metrics.neutrals}</strong>
          <p>NOTAS 7 E 8</p>
        </button>
        <button type="button" className="kpi-card danger kpi-button" onClick={() => applyQuickFilter('active', { profile: 'detrator' })}>
          <span>Detratores</span>
          <strong>{metrics.detractors}</strong>
          <p>NOTAS 1 A 6</p>
        </button>
        <button type="button" className="kpi-card warning kpi-button" onClick={() => applyQuickFilter('active', { profile: 'detrator' })}>
          <span>Pendentes</span>
          <strong>{metrics.pendingDetractors}</strong>
          <p>DETRATORES EM ABERTO</p>
        </button>
        <button type="button" className="kpi-card kpi-button" onClick={() => applyQuickFilter('finished', { status: 'tratado' })}>
          <span>Tratados</span>
          <strong>{metrics.treated}</strong>
          <p>PROTOCOLOS NPS</p>
        </button>
      </section>

      <section className="management-panel nps-automation-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Robô Ecuro / NPS automática</p>
            <h2>Monitoramento do disparo automático da pesquisa NPS</h2>
            <p className="base-subtitle">
              Verificação de pacientes concluídos no Ecuro, fila profissional de convites e envio pela VPS com a sessão configurada.
            </p>
          </div>
          <div className="heading-actions">
            <button type="button" className="outline-action" onClick={loadAutomationOverview} disabled={automationLoading}>
              {automationLoading ? 'Atualizando...' : 'Atualizar painel'}
            </button>
            <button type="button" className="outline-action" onClick={handleTestAutomationLogin} disabled={!canManageAutomation || automationTesting || automationRunning}>
              {automationTesting ? 'Testando...' : 'Testar login Ecuro'}
            </button>
            <button type="button" className="outline-action" onClick={handleReprocessAutomationFailures} disabled={!canManageAutomation || automationReprocessing || automationRunning}>
              {automationReprocessing ? 'Reprocessando...' : 'Reprocessar falhas'}
            </button>
            <button type="button" className="primary-action" onClick={handleRunAutomation} disabled={!canManageAutomation || automationRunning}>
              {automationRunning ? 'Executando...' : 'Executar agora'}
            </button>
          </div>
        </div>

        <div className="nps-automation-hero">
          <article className="nps-automation-status-card">
            <span>Status do robô</span>
            <strong>{robotStatusLabel}</strong>
            <p>{automationRobot.browserMode ? 'Modo browser com Playwright' : 'Modo aguardando serviço externo'}</p>
          </article>
          <article className="nps-automation-status-card">
            <span>Sessão usada</span>
            <strong>{automationRobot.sessionId || 'nps'}</strong>
            <p>{sessionStatusLabel}</p>
          </article>
          <article className="nps-automation-status-card">
            <span>Última execução</span>
            <strong>{automationSummary.lastExecutionAt ? formatDate(automationSummary.lastExecutionAt) : 'Sem execução'}</strong>
            <p>Cron: {automationRobot.cron || 'não configurado'}</p>
          </article>
          <article className="nps-automation-status-card">
            <span>Último envio</span>
            <strong>{automationSummary.lastSentAt ? formatDate(automationSummary.lastSentAt) : 'Sem envio'}</strong>
            <p>{automationRobot.dryRun ? 'Dry-run ativo' : 'Disparo habilitado'}</p>
          </article>
        </div>

        {usesSharedSession && (
          <div className="nps-automation-warning">
            <strong>Atenção:</strong> a NPS está utilizando temporariamente a sessão <strong>{automationRobot.sessionId}</strong>. Recomenda-se voltar para a sessão dedicada <strong>nps</strong> após a homologação.
          </div>
        )}

        <div className="kpi-grid nps-automation-metrics">
          <article className="kpi-card">
            <span>Pacientes verificados</span>
            <strong>{automationSummary.totalChecked || 0}</strong>
            <p>últimos 7 dias</p>
          </article>
          <article className="kpi-card success">
            <span>Concluídos</span>
            <strong>{automationSummary.totalCompleted || 0}</strong>
            <p>atendimentos elegíveis</p>
          </article>
          <article className="kpi-card progress">
            <span>NPS enviadas</span>
            <strong>{automationSummary.sentInvites || 0}</strong>
            <p>convites disparados</p>
          </article>
          <article className="kpi-card warning">
            <span>Pendentes</span>
            <strong>{automationSummary.pendingInvites || 0}</strong>
            <p>aguardando fila</p>
          </article>
          <article className="kpi-card danger">
            <span>Falhas</span>
            <strong>{automationSummary.failedInvites || 0}</strong>
            <p>necessitam revisão</p>
          </article>
          <article className="kpi-card">
            <span>Sem telefone</span>
            <strong>{automationSummary.patientsWithoutPhone || 0}</strong>
            <p>sem dado de contato</p>
          </article>
          <article className="kpi-card">
            <span>Ambíguos</span>
            <strong>{automationSummary.totalAmbiguous || 0}</strong>
            <p>revisão manual</p>
          </article>
          <article className="kpi-card">
            <span>Respondidas</span>
            <strong>{automationSummary.respondedInvites || 0}</strong>
            <p>pesquisas concluídas</p>
          </article>
        </div>

        <div className="nps-automation-jobs">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Histórico recente</p>
              <h3>Jobs do Ecuro</h3>
            </div>
          </div>

          {automationJobs.length ? (
            <div className="nps-automation-job-grid">
              {automationJobs.map((job) => (
                <article className={`nps-automation-job-card ${String(job.status || '').toLowerCase()}`} key={job.id}>
                  <div className="nps-automation-job-head">
                    <strong>{job.clinic_name || 'Clínica não informada'}</strong>
                    <span>{String(job.status || 'pending').replace(/_/g, ' ')}</span>
                  </div>
                  <p>Data da agenda: {job.appointment_date || 'não informada'}</p>
                  <small>
                    Verificados: {job.total_checked || 0} · Concluídos: {job.total_completed || 0} · Falhas: {job.total_failed || 0}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">Ainda não há jobs Ecuro registrados para este painel.</p>
          )}
        </div>
      </section>

      <section className="management-panel bulk-dispatch-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Envio em massa</p>
            <h2>Link da pesquisa NPS para pacientes</h2>
            <p className="base-subtitle">Mensagem padrão: Sua opinião é fundamental para melhorarmos nossos processos. Poderia dedicar 1 minuto para avaliar sua experiência conosco?</p>
          </div>
          <button type="button" className="outline-action" onClick={handleDownloadTemplate}>
            Baixar template Excel
          </button>
        </div>

        <div className="bulk-dispatch-actions">
          <label className="field bulk-dispatch-field">
            <span>Planilha CSV</span>
            <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" onChange={(event) => setBulkFile(event.target.files?.[0] || null)} />
          </label>
          <button type="button" className="primary-action" onClick={handleBulkDispatch} disabled={bulkSending}>
            {bulkSending ? 'Processando...' : 'Enviar links em massa'}
          </button>
        </div>

        {bulkFile && <small className="bulk-file-name">Arquivo selecionado: {bulkFile.name}</small>}
      </section>

      <section className="management-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Pesquisas</p>
            <h2>
              {viewMode === 'deleted'
                ? 'Pesquisas NPS excluídas com auditoria'
                : viewMode === 'finished'
                  ? 'Pesquisas NPS finalizadas'
                  : 'Lista de respostas NPS'}
            </h2>
            <p className="base-subtitle">O envio usa a sessão configurada no backend para NPS e pode ser alternado entre <strong>reclamacoes</strong> e <strong>nps</strong> apenas por variável de ambiente.</p>
          </div>

          <div className="patient-tabs" role="tablist" aria-label="Visões da gestão NPS">
            <button
              type="button"
              className={viewMode === 'active' ? 'active' : ''}
              onClick={() => setViewMode('active')}
            >
              Ativos ({activeRows.length})
            </button>
            <button
              type="button"
              className={viewMode === 'finished' ? 'active' : ''}
              onClick={() => setViewMode('finished')}
            >
              Finalizados ({finishedRows.length})
            </button>
            {canViewDeleted && (
              <button
                type="button"
                className={viewMode === 'deleted' ? 'active' : ''}
                onClick={() => setViewMode('deleted')}
              >
                Excluídos ({deletedRows.length})
              </button>
            )}
          </div>

          <div className="filters nps-management-filters">
            <input
              className="field"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Buscar protocolo, paciente, unidade, telefone ou relato"
            />
            <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
              <option value="">Todas as unidades</option>
              {filterOptions.clinics.map((clinic) => (
                <option key={clinic} value={clinic}>{clinic}</option>
              ))}
            </select>
            <select className="field" value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
              <option value="">Todas as regiões</option>
              {filterOptions.regions.map((region) => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
            <select className="field" value={filters.state} onChange={(event) => updateFilter('state', event.target.value)}>
              <option value="">Todos os estados</option>
              {filterOptions.states.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            <select className="field" value={filters.coordinator} onChange={(event) => updateFilter('coordinator', event.target.value)}>
              <option value="">Todos os coordenadores</option>
              {filterOptions.coordinators.map((coordinator) => (
                <option key={coordinator} value={coordinator}>{coordinator}</option>
              ))}
            </select>
            <select className="field" value={filters.profile} onChange={(event) => updateFilter('profile', event.target.value)}>
              <option value="">Todos os perfis</option>
              <option value="detrator">Detratores</option>
              <option value="neutro">Neutros</option>
              <option value="promotor">Promotores</option>
            </select>
            <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">Todos os status</option>
              <option value="registrado">Registrado</option>
              <option value="em_tratativa">Em tratamento</option>
              <option value="tratado">Tratado</option>
            </select>
          </div>
        </div>

        {feedback && <p className="form-feedback">{feedback}</p>}

        {loading ? (
          <p className="empty-state">Carregando pesquisas NPS...</p>
        ) : filteredRows.length === 0 ? (
          <p className="empty-state">Nenhuma pesquisa encontrada com os filtros atuais.</p>
        ) : (
          <div className="nps-list">
            {filteredRows.map((item) => {
              const profile = item.nps_profile || profileFromScore(item.score);
              const status = getNpsStatus(item);
              const reasons = parseReasons(item.detractor_reasons);
              const isDetractor = profile === 'detrator';
              const isDeleted = Boolean(item.deleted_at);
              const canFinalize = canFinishNps && canFinalizeNps(item);

              return (
                <article className={`nps-list-item ${profile}`} key={item.id}>
                  <div className="nps-score-block">
                    <span className={`nps-score-pill ${profile}`}>{item.score}</span>
                    <strong>{profileLabels[profile]}</strong>
                    <small>{formatDate(item.created_at)}</small>
                  </div>

                  <div className="nps-list-content">
                    <div className="nps-list-headline">
                      <span className="nps-protocol-label">{protocolLabel(item)}</span>
                      <span className={`nps-status-chip ${status}`}>{statusLabels[status] || status}</span>
                    </div>
                    <span className="person-label">Paciente</span>
                    <h3>{item.patient_name || 'Paciente não informado'}</h3>
                    <p>{item.clinic_name || 'Unidade não informada'} · {item.city || 'Cidade'} / {item.state || 'UF'}</p>

                    {item.detractor_feedback && <p className="nps-relato">{item.detractor_feedback}</p>}
                    {item.improvement_comment && <p className="nps-relato">{item.improvement_comment}</p>}
                    {item.comment && <p className="nps-relato">{item.comment}</p>}
                    {reasons.length > 0 && (
                      <div className="nps-reason-row">
                        {reasons.map((reason) => <span key={reason}>{reason}</span>)}
                      </div>
                    )}
                  </div>

                  <div className="nps-action-stack">
                    <span className={`deadline-chip ${isDeleted ? 'closed' : status === 'tratado' ? 'closed' : isDetractor ? 'danger' : 'neutral'}`}>
                      {isDeleted ? 'Excluída da operação' : isDetractor ? 'Relato para tratamento' : 'Registro NPS'}
                    </span>
                    {isDeleted ? (
                      <small>Excluída por {item.deleted_by || 'Usuário não informado'}</small>
                    ) : item.nps_treatment_at && (
                      <small>Última tratativa: {formatDate(item.nps_treatment_at)}</small>
                    )}
                    <button
                      className={isDetractor ? 'primary-action' : 'outline-action'}
                      onClick={() => openTreatment(item)}
                    >
                      {isDetractor ? 'Abrir relato para tratamento' : 'Abrir avaliação'}
                    </button>
                    {canFinalize && (
                      <button
                        className="outline-action"
                        onClick={() => handleFinalizeNps(item)}
                        disabled={savingId === item.id}
                      >
                        {savingId === item.id ? 'Finalizando...' : 'Finalizar'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedNps && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeTreatment}>
          <section className="modal-panel nps-treatment-modal" onClick={(event) => event.stopPropagation()}>
            <div className="nps-modal-title">
              <div>
                <p className="eyebrow">Tratativa NPS</p>
                <h2>{protocolLabel(selectedNps)}</h2>
              </div>
              <span className={`nps-status-chip ${getNpsStatus(selectedNps)}`}>
                {statusLabels[getNpsStatus(selectedNps)] || getNpsStatus(selectedNps)}
              </span>
            </div>

            <div className="nps-treatment-summary">
              <div>
                <span>Paciente</span>
                <strong>{selectedNps.patient_name || 'Não informado'}</strong>
              </div>
              <div>
                <span>Telefone</span>
                <strong>{selectedNps.patient_phone || 'Não informado'}</strong>
              </div>
              <div>
                <span>Unidade</span>
                <strong>{selectedNps.clinic_name || 'Não informada'}</strong>
              </div>
              <div>
                <span>Nota</span>
                <strong>{selectedNps.score}</strong>
              </div>
            </div>

            <div className="heading-actions inline-summary-actions">
              <button className="outline-action" type="button" onClick={() => setShowExecutiveSummary((prev) => !prev)}>
                {showExecutiveSummary ? 'Ocultar resumo' : 'Resumo rápido'}
              </button>
            </div>

            {showExecutiveSummary && (
              <div className="nps-executive-summary">
                <strong>Resumo executivo do NPS</strong>
                <div className="executive-summary-list">
                  {selectedNpsExecutiveSummary.map((item, index) => (
                    <article className="executive-summary-item" key={`nps-summary-${index}`}>
                      <span>{index + 1}</span>
                      <p>{item}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}

            <div className="nps-treatment-relato">
              <strong>Relato do cliente</strong>
              <p>{selectedNps.detractor_feedback || selectedNps.improvement_comment || selectedNps.comment || 'Sem comentário detalhado.'}</p>
              {parseReasons(selectedNps.detractor_reasons).length > 0 && (
                <div className="nps-reason-row">
                  {parseReasons(selectedNps.detractor_reasons).map((reason) => <span key={reason}>{reason}</span>)}
                </div>
              )}
              {selectedNps.recommend_yes ? (
                <p className="history-note">
                  Houve indicação: {selectedNps.referral_name || 'nome não informado'} · {selectedNps.referral_phone || 'telefone não informado'}
                </p>
              ) : (
                <p className="history-note">Sem indicação registrada.</p>
              )}
              {selectedNps.deleted_at && (
                <p className="history-note">
                  Excluída por {selectedNps.deleted_by || 'Usuário não informado'} em {formatDate(selectedNps.deleted_at)}.
                </p>
              )}
            </div>

            {!selectedNps.deleted_at && (selectedNps.nps_profile || profileFromScore(selectedNps.score)) === 'detrator' && (
              <>
                <label>
                  Status da tratativa
                  <select className="field" value={treatmentStatus} onChange={(event) => setTreatmentStatus(event.target.value)}>
                    <option value="em_tratativa">Em tratamento</option>
                    <option value="tratado">Tratado</option>
                  </select>
                </label>

                <label>
                  Descrição da tratativa
                  <textarea
                    className="field textarea treatment-textarea"
                    value={treatmentText}
                    onChange={(event) => setTreatmentText(event.target.value.slice(0, 5000))}
                    placeholder="Registre a ação realizada, contato feito, retorno dado ao cliente e próximos passos."
                    maxLength={5000}
                  />
                  <small className="field-counter">{treatmentText.length}/5000 caracteres</small>
                </label>
              </>
            )}

            <div className="nps-treatment-history">
              <strong>Histórico do protocolo</strong>
              {selectedNps.logs?.length ? (
                <div className="history-list">
                  {selectedNps.logs.map((log) => (
                    <article className="history-item" key={log.id}>
                      <div className="history-item-head">
                        <strong>{log.actor_name || 'Usuário'}</strong>
                        <span>{formatDate(log.created_at)}</span>
                      </div>
                      <small>{log.actor_role || 'Perfil não informado'} · {log.action}</small>
                      <p>{log.message}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-mini">Ainda não há tratativas registradas.</p>
              )}
            </div>

            <div className="heading-actions">
              {buildWhatsappUrl(selectedNps.patient_phone) && (
                <a className="primary-action whatsapp-action" href={buildWhatsappUrl(selectedNps.patient_phone)} target="_blank" rel="noreferrer">
                  Chamar no WhatsApp
                </a>
              )}
              {canDeleteRecords && !selectedNps.deleted_at && (
                <button
                  className="outline-action danger-action"
                  onClick={() => setShowDeleteModal(true)}
                  disabled={savingId === selectedNps.id}
                >
                  Excluir NPS
                </button>
              )}
              <button className="outline-action" onClick={closeTreatment} disabled={savingId === selectedNps.id}>
                Fechar
              </button>
              {selectedNps.converted_complaint_id ? (
                <button className="outline-action" onClick={() => navigate(`/gestao/${selectedNps.converted_complaint_id}`)}>
                  Abrir reclamação vinculada
                </button>
              ) : (selectedNps.nps_profile || profileFromScore(selectedNps.score)) === 'detrator' && (
                <button className="secondary-action" onClick={handleConvertToComplaint} disabled={savingId === selectedNps.id}>
                  Migrar para reclamação
                </button>
              )}
              {canFinishNps && canFinalizeNps(selectedNps) && (
                <button className="outline-action" onClick={() => handleFinalizeNps()} disabled={savingId === selectedNps.id}>
                  {savingId === selectedNps.id ? 'Finalizando...' : 'Finalizar'}
                </button>
              )}
              {!selectedNps.deleted_at && (selectedNps.nps_profile || profileFromScore(selectedNps.score)) === 'detrator' && (
                <button className="primary-action" onClick={handleSaveTreatment} disabled={savingId === selectedNps.id}>
                  {savingId === selectedNps.id ? 'Salvando...' : 'Salvar tratativa'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {showDeleteModal && selectedNps && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar exclusão do NPS" onClick={() => setShowDeleteModal(false)}>
          <section className="modal-panel modal-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Excluir NPS</p>
            <h2>Tem certeza que deseja excluir?</h2>
            <div className="row-actions">
              <button
                className="outline-action"
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={savingId === selectedNps.id}
              >
                Cancelar
              </button>
              <button
                className="outline-action danger-action"
                type="button"
                onClick={handleDeleteNps}
                disabled={savingId === selectedNps.id}
              >
                {savingId === selectedNps.id ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default NpsManagement;
