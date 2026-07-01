import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from './api';
import { isMasterAdmin, readUser } from './constants';

const tabs = [
  { id: 'nps', label: 'NPS Automatica' },
  { id: 'excel', label: 'Exportacao Excel Ecuro' },
  { id: 'network', label: 'Descoberta Network/F12' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'logs', label: 'Logs' },
  { id: 'mapping', label: 'Mapeamento Ecuro' },
  { id: 'artifacts', label: 'Artefatos' },
  { id: 'visual', label: 'Visualizacao / VNC' },
  { id: 'settings', label: 'Configuracoes' }
];

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return 'N/D';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const totalSeconds = Number(seconds || 0);
  if (!totalSeconds) return 'N/D';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
}

function statusLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const labels = {
    online: 'Online',
    offline: 'Offline',
    executando: 'Executando',
    erro: 'Erro',
    aguardando_acao_manual: 'Acao manual',
    running: 'Executando',
    completed: 'Concluido',
    partial: 'Parcial',
    failed: 'Falhou',
    manual_action_required: 'Acao manual',
    pending: 'Pendente',
    disabled: 'Desabilitado',
    configured: 'Configurado'
  };
  return labels[normalized] || value || 'N/D';
}

function compactText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function MetricCard({ label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`robot-master-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function StatusChip({ status }) {
  return <span className={`robot-master-chip ${String(status || 'unknown').toLowerCase()}`}>{statusLabel(status)}</span>;
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="robot-master-section-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {description && <p className="base-subtitle">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="robot-master-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function renderJson(value) {
  if (!value) return 'Sem dados adicionais.';
  return JSON.stringify(value, null, 2);
}

function RobotMasterMonitor() {
  const currentUser = useMemo(() => readUser(), []);
  const isAllowed = isMasterAdmin(currentUser);
  const [activeTab, setActiveTab] = useState('nps');
  const [overview, setOverview] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [mappingPages, setMappingPages] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [vncStatus, setVncStatus] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedJobDetail, setSelectedJobDetail] = useState(null);
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionState, setActionState] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadOverview = useCallback(async () => {
    const response = await api.get('/admin/robot/master/overview');
    setOverview(response.data || null);
    return response.data || null;
  }, []);

  const loadJobs = useCallback(async () => {
    const response = await api.get('/admin/robot/master/jobs');
    const nextJobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
    setJobs(nextJobs);
    setSelectedJobId((current) => current || nextJobs[0]?.id || null);
    return nextJobs;
  }, []);

  const loadLogs = useCallback(async () => {
    const response = await api.get('/admin/robot/master/logs', {
      params: {
        limit: 120
      }
    });
    setLogs(Array.isArray(response.data?.logs) ? response.data.logs : []);
  }, []);

  const loadMapping = useCallback(async () => {
    const [summaryRes, pagesRes] = await Promise.all([
      api.get('/admin/robot/master/mapping'),
      api.get('/admin/robot/master/mapping/pages', {
        params: { limit: 60 }
      })
    ]);
    setMapping(summaryRes.data || null);
    setMappingPages(Array.isArray(pagesRes.data?.pages) ? pagesRes.data.pages : []);
  }, []);

  const loadArtifacts = useCallback(async () => {
    const response = await api.get('/admin/robot/master/artifacts', {
      params: { limit: 60 }
    });
    setArtifacts(Array.isArray(response.data?.artifacts) ? response.data.artifacts : []);
  }, []);

  const loadVncStatus = useCallback(async () => {
    const response = await api.get('/admin/robot/master/vnc-status');
    setVncStatus(response.data?.status || response.data || null);
  }, []);

  const loadJobDetail = useCallback(async (jobId, reveal = false) => {
    if (!jobId) {
      setSelectedJobDetail(null);
      return null;
    }
    const response = await api.get(`/admin/robot/master/jobs/${jobId}`, {
      params: reveal ? { reveal: 1 } : undefined
    });
    setSelectedJobDetail(response.data || null);
    return response.data || null;
  }, []);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!isAllowed) return;
    quiet ? setRefreshing(true) : setLoading(true);
    setFeedback('');

    try {
      const loadedJobs = await Promise.all([
        loadOverview(),
        loadJobs(),
        loadLogs(),
        loadMapping(),
        loadArtifacts(),
        loadVncStatus()
      ]);
      const jobRows = loadedJobs[1] || [];
      const activeJobId = selectedJobId || jobRows[0]?.id || null;
      if (activeJobId) {
        await loadJobDetail(activeJobId, revealSensitive);
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel carregar o Monitor Master do Robo Ecuro.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAllowed, loadArtifacts, loadJobDetail, loadJobs, loadLogs, loadMapping, loadOverview, loadVncStatus, revealSensitive, selectedJobId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!isAllowed) return undefined;
    const interval = window.setInterval(async () => {
      try {
        await loadOverview();
        if (activeTab === 'jobs') {
          const nextJobs = await loadJobs();
          const liveJobId = selectedJobId || nextJobs[0]?.id || null;
          if (liveJobId) {
            await loadJobDetail(liveJobId, revealSensitive);
          }
        }
        if (activeTab === 'logs') {
          await loadLogs();
        }
        if (activeTab === 'mapping') {
          await loadMapping();
        }
        if (activeTab === 'artifacts' || activeTab === 'visual') {
          await loadArtifacts();
          await loadVncStatus();
        }
      } catch (_error) {
        // Silent background refresh.
      }
    }, 10000);
    return () => window.clearInterval(interval);
  }, [activeTab, isAllowed, loadArtifacts, loadJobDetail, loadJobs, loadLogs, loadMapping, loadOverview, loadVncStatus, revealSensitive, selectedJobId]);

  useEffect(() => {
    if (selectedJobId) {
      loadJobDetail(selectedJobId, revealSensitive).catch(() => null);
    }
  }, [loadJobDetail, revealSensitive, selectedJobId]);

  const runAction = useCallback(async (key, request) => {
    setActionState(key);
    setFeedback('');
    try {
      const result = await request();
      const message = result?.data?.message || result?.data?.error || 'Acao concluida.';
      setFeedback(message);
      await loadDashboard(true);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel concluir a acao solicitada.');
    } finally {
      setActionState('');
    }
  }, [loadDashboard]);

  const selectedJob = selectedJobDetail?.job || jobs.find((item) => item.id === selectedJobId) || null;
  const lastArtifacts = useMemo(
    () => artifacts.filter((item) => item.artifact_type === 'screenshot' || item.artifact_type === 'html').slice(0, 8),
    [artifacts]
  );
  const networkJobs = useMemo(
    () => jobs.filter((item) => String(item.job_type || '').includes('network')).slice(0, 8),
    [jobs]
  );
  const excelJobs = useMemo(
    () => jobs.filter((item) => String(item.job_type || '').includes('excel_export')).slice(0, 8),
    [jobs]
  );
  const excelArtifacts = useMemo(
    () => artifacts.filter((item) => ['excel_export', 'normalized_json', 'import_summary'].includes(String(item.artifact_type || ''))).slice(0, 12),
    [artifacts]
  );

  if (!isAllowed) {
    return (
      <main className="app-page robot-master-page">
        <section className="management-panel robot-master-forbidden">
          <p className="eyebrow">Area restrita</p>
          <h1>Monitor Master do Robo Ecuro</h1>
          <p>Area restrita ao Administrador Master.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page robot-master-page">
      <section className="management-panel robot-master-shell">
        <header className="robot-master-hero">
          <div>
            <p className="eyebrow">Administracao Master</p>
            <h1>Monitor Master do Robo Ecuro</h1>
            <p className="base-subtitle">
              Supervisao exclusiva do robo Ecuro, da NPS automatica e da rotina noturna de mapeamento.
            </p>
          </div>
          <div className="robot-master-hero-actions">
            <StatusChip status={overview?.status || 'offline'} />
            <button type="button" className="outline-action" onClick={() => loadDashboard(true)} disabled={refreshing}>
              {refreshing ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </header>

        {overview?.alert && (
          <div className="form-feedback info robot-master-alert">
            {overview.alert}
          </div>
        )}
        {feedback && <div className="form-feedback success">{feedback}</div>}

        <div className="robot-master-metrics-grid">
          <MetricCard label="Status atual do robo" value={statusLabel(overview?.status)} detail={`Sessao WhatsApp: ${overview?.cards?.whatsappSessionId || 'N/D'}`} tone="primary" />
          <MetricCard label="Ultima execucao NPS" value={formatDateTime(overview?.cards?.lastNpsExecutionAt)} detail={`Proxima: ${formatDateTime(overview?.cards?.nextNpsExecutionAt)}`} />
          <MetricCard label="Ultimo mapeamento" value={formatDateTime(overview?.cards?.lastMappingExecutionAt)} detail={`Proximo: ${formatDateTime(overview?.cards?.nextMappingExecutionAt)}`} />
          <MetricCard label="Pacientes lidos hoje" value={formatNumber(overview?.cards?.patientsReadToday)} detail={`Elegiveis: ${formatNumber(overview?.cards?.eligibleToday)}`} />
          <MetricCard label="NPS enviadas hoje" value={formatNumber(overview?.cards?.invitesToday)} detail={`Respondidas: ${formatNumber(overview?.cards?.responsesToday)}`} tone="success" />
          <MetricCard label="Falhas e bloqueios" value={formatNumber(overview?.cards?.failuresTotal)} detail={`Sem telefone: ${formatNumber(overview?.cards?.patientsWithoutPhone)}`} tone="warning" />
          <MetricCard label="Duplicidades bloqueadas" value={formatNumber(overview?.cards?.duplicateBlocked)} detail={`Paginas mapeadas: ${formatNumber(overview?.cards?.mappedPagesTotal)}`} />
          <MetricCard label="Rotas identificadas" value={formatNumber(overview?.cards?.routesTotal)} detail={`Erros de navegacao: ${formatNumber(overview?.cards?.navigationErrorsTotal)}`} />
        </div>

        <div className="robot-master-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTab ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <EmptyState title="Carregando monitor master" detail="Estamos reunindo os dados do robo, dos jobs e das rotinas vinculadas." />
        ) : (
          <>
            {activeTab === 'nps' && (
              <section className="robot-master-panel">
                <SectionHeader
                  eyebrow="NPS Automatica"
                  title="Operacao controlada"
                  description="Monitore a coleta no Ecuro, a fila de convites e o disparo via WhatsApp da VPS."
                  action={(
                    <div className="robot-master-inline-actions">
                      <button type="button" className="outline-action" disabled={actionState === 'test-login'} onClick={() => runAction('test-login', () => api.post('/nps/automation/test-login', {}))}>
                        {actionState === 'test-login' ? 'Testando...' : 'Testar login Ecuro'}
                      </button>
                      <button type="button" className="outline-action" disabled={actionState === 'dry-run'} onClick={() => runAction('dry-run', () => api.post('/admin/robot/master/run-nps-dry-run'))}>
                        {actionState === 'dry-run' ? 'Executando...' : 'Rodar dry-run'}
                      </button>
                      <button type="button" className="primary-action" disabled={actionState === 'send'} onClick={() => runAction('send', () => api.post('/admin/robot/master/run-nps-send'))}>
                        {actionState === 'send' ? 'Executando...' : 'Envio controlado'}
                      </button>
                    </div>
                  )}
                />

                <div className="robot-master-two-column">
                  <article className="robot-master-card">
                    <h3>Resumo operacional</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Elegiveis</dt><dd>{formatNumber(overview?.nps?.summary?.totalEligible)}</dd></div>
                      <div><dt>Enviadas</dt><dd>{formatNumber(overview?.nps?.summary?.sentInvites)}</dd></div>
                      <div><dt>Respondidas</dt><dd>{formatNumber(overview?.nps?.summary?.respondedInvites)}</dd></div>
                      <div><dt>Pendentes</dt><dd>{formatNumber(overview?.nps?.summary?.pendingInvites)}</dd></div>
                      <div><dt>Falhas</dt><dd>{formatNumber(overview?.nps?.summary?.failedInvites)}</dd></div>
                      <div><dt>Sessao</dt><dd>{overview?.nps?.robot?.sessionId || 'N/D'}</dd></div>
                      <div><dt>Status da sessao</dt><dd>{statusLabel(overview?.nps?.robot?.sessionStatus)}</dd></div>
                      <div><dt>Ultimo envio</dt><dd>{formatDateTime(overview?.nps?.summary?.lastSentAt)}</dd></div>
                    </dl>
                  </article>

                  <article className="robot-master-card">
                    <h3>Execucao em tempo real</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Etapa atual</dt><dd>{overview?.live?.currentStep || 'idle'}</dd></div>
                      <div><dt>URL atual</dt><dd className="break-all">{overview?.live?.currentUrl || 'N/D'}</dd></div>
                      <div><dt>Clinica</dt><dd>{overview?.live?.clinicName || 'N/D'}</dd></div>
                      <div><dt>Acao</dt><dd>{overview?.live?.action || 'idle'}</dd></div>
                      <div><dt>Progresso</dt><dd>{formatNumber(overview?.live?.pageProgress?.current)} / {formatNumber(overview?.live?.pageProgress?.total)}</dd></div>
                      <div><dt>Registros lidos</dt><dd>{formatNumber(overview?.live?.recordsRead)}</dd></div>
                      <div><dt>Elegiveis encontrados</dt><dd>{formatNumber(overview?.live?.eligibleFound)}</dd></div>
                    </dl>
                  </article>
                </div>

                <article className="robot-master-card">
                  <h3>Eventos recentes</h3>
                  {Array.isArray(overview?.live?.recentEvents) && overview.live.recentEvents.length ? (
                    <div className="robot-master-log-stream">
                      {overview.live.recentEvents.slice().reverse().map((event) => (
                        <div key={event.id || `${event.createdAt}-${event.message}`} className="robot-master-log-line">
                          <span>{formatDateTime(event.createdAt)}</span>
                          <strong>{event.step || event.action || 'evento'}</strong>
                          <p>{compactText(event.message, 260)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Nenhum evento recente" detail="A execucao em tempo real vai aparecer aqui quando o robo estiver ativo." />
                  )}
                </article>
              </section>
            )}

            {activeTab === 'excel' && (
              <section className="robot-master-panel">
                <SectionHeader
                  eyebrow="Exportacao Excel Ecuro"
                  title="Coleta principal por planilha exportada"
                  description="O robo seleciona a clinica, exporta o Excel de pacientes, normaliza colunas e filtra somente ULTIMA CONSULTA igual a data atual. O envio permanece bloqueado enquanto dry-run estiver ativo."
                  action={(
                    <div className="robot-master-inline-actions">
                      <button type="button" className="outline-action" disabled={actionState === 'excel-discover'} onClick={() => runAction('excel-discover', () => api.post('/admin/robot/master/run-excel-discover-export'))}>
                        {actionState === 'excel-discover' ? 'Descobrindo...' : 'Descobrir exportacao'}
                      </button>
                      <button type="button" className="outline-action" disabled={actionState === 'excel-one'} onClick={() => runAction('excel-one', () => api.post('/admin/robot/master/run-excel-dry-run-one'))}>
                        {actionState === 'excel-one' ? 'Processando...' : 'Dry-run uma clinica'}
                      </button>
                      <button type="button" className="primary-action" disabled={actionState === 'excel-all'} onClick={() => runAction('excel-all', () => api.post('/admin/robot/master/run-excel-dry-run'))}>
                        {actionState === 'excel-all' ? 'Executando...' : 'Dry-run todas'}
                      </button>
                    </div>
                  )}
                />

                <div className="robot-master-two-column">
                  <article className="robot-master-card">
                    <h3>Ultimo job Excel</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Status</dt><dd><StatusChip status={excelJobs[0]?.status || 'pending'} /></dd></div>
                      <div><dt>Tipo</dt><dd>{excelJobs[0]?.job_type || 'N/D'}</dd></div>
                      <div><dt>Linhas lidas</dt><dd>{formatNumber(excelJobs[0]?.total_checked)}</dd></div>
                      <div><dt>Elegiveis</dt><dd>{formatNumber(excelJobs[0]?.total_eligible)}</dd></div>
                      <div><dt>Falhas</dt><dd>{formatNumber(excelJobs[0]?.total_failed)}</dd></div>
                      <div><dt>Ultima execucao</dt><dd>{formatDateTime(excelJobs[0]?.started_at || excelJobs[0]?.created_at)}</dd></div>
                    </dl>
                  </article>

                  <article className="robot-master-card">
                    <h3>Configuracao segura</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Modo de coleta</dt><dd>{overview?.config?.robot?.collectionMode || 'excel_export'}</dd></div>
                      <div><dt>Modo Excel</dt><dd>{overview?.config?.robot?.excelExportMode || 'click_download'}</dd></div>
                      <div><dt>Timeout download</dt><dd>{formatNumber(overview?.config?.robot?.excelDownloadTimeoutMs)}ms</dd></div>
                      <div><dt>Dry-run NPS</dt><dd>{overview?.config?.nps?.dryRun ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Envio automatico</dt><dd>{overview?.config?.nps?.dispatchEnabled ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Regra de data</dt><dd>Somente ULTIMA CONSULTA = hoje</dd></div>
                    </dl>
                  </article>
                </div>

                <article className="robot-master-card">
                  <h3>Jobs Excel recentes</h3>
                  {excelJobs.length ? (
                    <div className="robot-master-page-list">
                      {excelJobs.map((job) => (
                        <div key={job.id} className="robot-master-page-item" onClick={() => { setSelectedJobId(job.id); setActiveTab('jobs'); }}>
                          <div>
                            <strong>#{job.id} - {job.job_type}</strong>
                            <span>{compactText(job.error_message || job.current_url || 'Sem erro registrado.', 220)}</span>
                          </div>
                          <div className="robot-master-page-meta">
                            <StatusChip status={job.status} />
                            <em>{formatNumber(job.total_checked)} linhas</em>
                            <em>{formatNumber(job.total_eligible)} elegiveis</em>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Nenhum job Excel ainda" detail="Execute um dry-run Excel para validar download, parser e elegibilidade antes de qualquer envio." />
                  )}
                </article>

                <article className="robot-master-card">
                  <h3>Artefatos Excel e JSON</h3>
                  {excelArtifacts.length ? (
                    <div className="robot-master-artifact-grid">
                      {excelArtifacts.map((artifact) => (
                        <article key={artifact.id} className="robot-master-artifact-card">
                          <span>{artifact.artifact_type}</span>
                          <strong>{artifact.file_name || `Artefato #${artifact.id}`}</strong>
                          <small>{formatDateTime(artifact.created_at)}</small>
                          <a href={artifact.file_url} target="_blank" rel="noreferrer">Abrir artefato</a>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Sem artefatos Excel" detail="Os arquivos exportados, JSON normalizado e resumo de importacao vao aparecer aqui apos o dry-run." />
                  )}
                </article>
              </section>
            )}

            {activeTab === 'network' && (
              <section className="robot-master-panel">
                <SectionHeader
                  eyebrow="Descoberta Network/F12"
                  title="Endpoints internos capturados com sessao autenticada"
                  description="O robo observa XHR/Fetch da tela de pacientes, identifica candidatos e executa dry-run sem enviar WhatsApp."
                  action={(
                    <div className="robot-master-inline-actions">
                      <button type="button" className="outline-action" disabled={actionState === 'network-discovery'} onClick={() => runAction('network-discovery', () => api.post('/admin/robot/master/run-network-discovery'))}>
                        {actionState === 'network-discovery' ? 'Descobrindo...' : 'Executar descoberta Network'}
                      </button>
                      <button type="button" className="primary-action" disabled={actionState === 'network-dry-run'} onClick={() => runAction('network-dry-run', () => api.post('/admin/robot/master/run-network-dry-run'))}>
                        {actionState === 'network-dry-run' ? 'Executando...' : 'Dry-run por API capturada'}
                      </button>
                    </div>
                  )}
                />

                <div className="robot-master-two-column">
                  <article className="robot-master-card">
                    <h3>Ultimo job Network</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Status</dt><dd><StatusChip status={networkJobs[0]?.status || 'pending'} /></dd></div>
                      <div><dt>Tipo</dt><dd>{networkJobs[0]?.job_type || 'N/D'}</dd></div>
                      <div><dt>Pacientes encontrados</dt><dd>{formatNumber(networkJobs[0]?.total_checked)}</dd></div>
                      <div><dt>Elegiveis</dt><dd>{formatNumber(networkJobs[0]?.total_eligible)}</dd></div>
                      <div><dt>Falhas</dt><dd>{formatNumber(networkJobs[0]?.total_failed)}</dd></div>
                      <div><dt>Ultima execucao</dt><dd>{formatDateTime(networkJobs[0]?.started_at || networkJobs[0]?.created_at)}</dd></div>
                    </dl>
                  </article>

                  <article className="robot-master-card">
                    <h3>Modo seguro</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Discovery mode</dt><dd>{overview?.config?.robot?.discoveryMode || 'network'}</dd></div>
                      <div><dt>Captura Network</dt><dd>{overview?.config?.robot?.captureNetwork ? 'Ativa' : 'Inativa'}</dd></div>
                      <div><dt>Mascaramento</dt><dd>{overview?.config?.robot?.networkMaskSensitive !== false ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Dry-run NPS</dt><dd>{overview?.config?.nps?.dryRun ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Envio automatico</dt><dd>{overview?.config?.nps?.dispatchEnabled ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Regra de data</dt><dd>Somente ULTIMA CONSULTA = hoje</dd></div>
                    </dl>
                  </article>
                </div>

                <article className="robot-master-card">
                  <h3>Jobs Network recentes</h3>
                  {networkJobs.length ? (
                    <div className="robot-master-page-list">
                      {networkJobs.map((job) => (
                        <div key={job.id} className="robot-master-page-item" onClick={() => { setSelectedJobId(job.id); setActiveTab('jobs'); }}>
                          <div>
                            <strong>#{job.id} - {job.job_type}</strong>
                            <span>{compactText(job.error_message || job.current_url || 'Sem erro registrado.', 220)}</span>
                          </div>
                          <div className="robot-master-page-meta">
                            <StatusChip status={job.status} />
                            <em>{formatNumber(job.total_checked)} lidos</em>
                            <em>{formatNumber(job.total_eligible)} elegiveis</em>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Nenhuma descoberta Network ainda" detail="Use os botoes acima para capturar endpoints e testar a extracao via JSON." />
                  )}
                </article>
              </section>
            )}

            {activeTab === 'jobs' && (
              <section className="robot-master-panel">
                <SectionHeader
                  eyebrow="Jobs"
                  title="Historico operacional"
                  description="Acompanhe cada job, duracao, resultados, logs e artefatos vinculados."
                  action={selectedJob ? (
                    <div className="robot-master-inline-actions">
                      <label className="robot-master-toggle">
                        <input type="checkbox" checked={revealSensitive} onChange={(event) => setRevealSensitive(event.target.checked)} />
                        <span>Revelar dados sensiveis</span>
                      </label>
                      <button type="button" className="outline-action" disabled={actionState === 'reprocess'} onClick={() => runAction('reprocess', () => api.post('/admin/robot/master/reprocess-job', { jobId: selectedJob.id, dryRun: selectedJob.job_type !== 'ecuro_mapping' }))}>
                        {actionState === 'reprocess' ? 'Reprocessando...' : 'Reprocessar job'}
                      </button>
                    </div>
                  ) : null}
                />

                <div className="robot-master-grid-layout">
                  <div className="robot-master-table-card">
                    <table className="robot-master-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tipo</th>
                          <th>Status</th>
                          <th>Clinica</th>
                          <th>Inicio</th>
                          <th>Duracao</th>
                          <th>Lidos</th>
                          <th>Elegiveis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.map((job) => (
                          <tr key={job.id} className={job.id === selectedJobId ? 'selected' : ''} onClick={() => setSelectedJobId(job.id)}>
                            <td>#{job.id}</td>
                            <td>{job.job_type}</td>
                            <td><StatusChip status={job.status} /></td>
                            <td>{job.clinic_name || 'N/D'}</td>
                            <td>{formatDateTime(job.started_at || job.created_at)}</td>
                            <td>{formatDuration(job.duration_seconds)}</td>
                            <td>{formatNumber(job.total_checked)}</td>
                            <td>{formatNumber(job.total_eligible)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <article className="robot-master-card robot-master-detail-card">
                    {selectedJobDetail ? (
                      <>
                        <div className="robot-master-detail-heading">
                          <div>
                            <p className="eyebrow">Detalhe do job</p>
                            <h3>Job #{selectedJobDetail.job?.id}</h3>
                          </div>
                          <StatusChip status={selectedJobDetail.job?.status} />
                        </div>
                        <dl className="robot-master-definition-list">
                          <div><dt>Tipo</dt><dd>{selectedJobDetail.job?.job_type}</dd></div>
                          <div><dt>Usuario</dt><dd>{selectedJobDetail.job?.triggered_by_name || selectedJobDetail.job?.created_by || 'Sistema'}</dd></div>
                          <div><dt>Clinica</dt><dd>{selectedJobDetail.job?.clinic_name || 'N/D'}</dd></div>
                          <div><dt>Payload</dt><dd className="break-all">{compactText(renderJson(selectedJobDetail.job?.payload), 220)}</dd></div>
                          <div><dt>URL atual</dt><dd className="break-all">{selectedJobDetail.job?.current_url || 'N/D'}</dd></div>
                          <div><dt>Logs</dt><dd>{formatNumber(selectedJobDetail.logs?.length)}</dd></div>
                          <div><dt>Artefatos</dt><dd>{formatNumber(selectedJobDetail.artifacts?.length)}</dd></div>
                          <div><dt>Convites NPS</dt><dd>{formatNumber(selectedJobDetail.invites?.length)}</dd></div>
                        </dl>

                        <div className="robot-master-subsection">
                          <h4>Extracao e convites</h4>
                          <div className="robot-master-mini-grid">
                            {(selectedJobDetail.completions || []).slice(0, 6).map((item) => (
                              <article key={item.id} className="robot-master-mini-card">
                                <strong>{item.patient_name || 'Paciente nao informado'}</strong>
                                <span>{item.patient_phone || 'Sem telefone'}</span>
                                <span>{item.eligibility_status || item.completion_status || 'N/D'}</span>
                              </article>
                            ))}
                          </div>
                        </div>

                        <div className="robot-master-subsection">
                          <h4>Artefatos do job</h4>
                          <div className="robot-master-inline-links">
                            {(selectedJobDetail.artifacts || []).slice(0, 8).map((artifact) => (
                              <a key={artifact.id} href={artifact.file_url} target="_blank" rel="noreferrer">
                                {artifact.artifact_type} #{artifact.id}
                              </a>
                            ))}
                          </div>
                        </div>

                        <div className="robot-master-subsection">
                          <h4>Ultimos logs</h4>
                          <div className="robot-master-log-stream compact">
                            {(selectedJobDetail.logs || []).slice(-10).reverse().map((item) => (
                              <div key={item.id} className="robot-master-log-line">
                                <span>{formatDateTime(item.created_at)}</span>
                                <strong>{item.step || item.level}</strong>
                                <p>{compactText(item.message, 220)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmptyState title="Selecione um job" detail="O painel de detalhe exibira payload, logs, artefatos e convites vinculados." />
                    )}
                  </article>
                </div>
              </section>
            )}

            {activeTab === 'logs' && (
              <section className="robot-master-panel">
                <SectionHeader eyebrow="Logs" title="Rastro estruturado" description="Acompanhe inicio, navegacao, coleta, envio, erros e artefatos do robo." />
                <article className="robot-master-card">
                  {logs.length ? (
                    <div className="robot-master-log-stream">
                      {logs.map((entry) => (
                        <div key={entry.id} className="robot-master-log-line">
                          <span>{formatDateTime(entry.created_at)}</span>
                          <strong>{entry.level} / {entry.step || 'evento'}</strong>
                          <p>{compactText(entry.message, 260)}</p>
                          {entry.url && <code>{entry.url}</code>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Sem logs recentes" detail="Os eventos estruturados do robo aparecerao aqui conforme as rotinas forem executadas." />
                  )}
                </article>
              </section>
            )}

            {activeTab === 'mapping' && (
              <section className="robot-master-panel">
                <SectionHeader
                  eyebrow="Mapeamento Ecuro"
                  title="Rotina noturna somente leitura"
                  description="Inventario de telas, rotas, filtros, tabelas e relatorios identificados para analise futura."
                  action={(
                    <button type="button" className="primary-action" disabled={actionState === 'mapping'} onClick={() => runAction('mapping', () => api.post('/admin/robot/master/run-mapping', { maxPages: 10 }))}>
                      {actionState === 'mapping' ? 'Mapeando...' : 'Executar mapeamento'}
                    </button>
                  )}
                />

                <div className="robot-master-two-column">
                  <article className="robot-master-card">
                    <h3>Resumo do mapeamento</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Jobs</dt><dd>{formatNumber(mapping?.summary?.totalJobs)}</dd></div>
                      <div><dt>Paginas</dt><dd>{formatNumber(mapping?.summary?.totalPages)}</dd></div>
                      <div><dt>Rotas</dt><dd>{formatNumber(mapping?.summary?.totalRoutes)}</dd></div>
                      <div><dt>Erros</dt><dd>{formatNumber(mapping?.summary?.totalErrors)}</dd></div>
                      <div><dt>Ultima execucao</dt><dd>{formatDateTime(mapping?.summary?.lastExecutionAt)}</dd></div>
                      <div><dt>Cron</dt><dd>{overview?.config?.mapping?.cron || 'N/D'}</dd></div>
                    </dl>
                  </article>

                  <article className="robot-master-card">
                    <h3>Paginas mapeadas</h3>
                    <div className="robot-master-mini-grid">
                      {mappingPages.slice(0, 6).map((page) => (
                        <article key={page.id} className="robot-master-mini-card">
                          <strong>{page.title || page.menu_label || 'Tela Ecuro'}</strong>
                          <span>{page.page_type || 'N/D'}</span>
                          <span>{page.risk_level || 'read_only'}</span>
                        </article>
                      ))}
                    </div>
                  </article>
                </div>

                <article className="robot-master-card">
                  <h3>Inventario recente</h3>
                  <div className="robot-master-page-list">
                    {mappingPages.map((page) => (
                      <div key={page.id} className="robot-master-page-item">
                        <div>
                          <strong>{page.title || page.menu_label || 'Tela Ecuro'}</strong>
                          <span>{page.url}</span>
                        </div>
                        <div className="robot-master-page-meta">
                          <StatusChip status={page.risk_level || 'read_only'} />
                          <em>{page.table_headers?.length || 0} colunas</em>
                          <em>{page.routes?.length || 0} rotas</em>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              </section>
            )}

            {activeTab === 'artifacts' && (
              <section className="robot-master-panel">
                <SectionHeader eyebrow="Artefatos" title="Screenshots, HTML e evidencias do robo" description="Acesse os artefatos capturados durante diagnostico, falha ou mapeamento." />
                <div className="robot-master-artifact-grid">
                  {artifacts.length ? artifacts.map((artifact) => (
                    <article key={artifact.id} className="robot-master-artifact-card">
                      <span>{artifact.artifact_type}</span>
                      <strong>{artifact.file_name || `Artefato #${artifact.id}`}</strong>
                      <small>{formatDateTime(artifact.created_at)}</small>
                      <a href={artifact.file_url} target="_blank" rel="noreferrer">Abrir artefato</a>
                    </article>
                  )) : (
                    <EmptyState title="Sem artefatos recentes" detail="Quando o robo gerar screenshot ou HTML, eles aparecerao aqui." />
                  )}
                </div>
              </section>
            )}

            {activeTab === 'visual' && (
              <section className="robot-master-panel">
                <SectionHeader
                  eyebrow="Visualizacao / VNC"
                  title="Homologacao visual segura"
                  description="Quando o VNC estiver desabilitado, o painel trabalha com screenshots e HTML capturados."
                  action={(
                    <div className="robot-master-inline-actions">
                      <button type="button" className="outline-action" disabled={actionState === 'vnc-start'} onClick={() => runAction('vnc-start', () => api.post('/admin/robot/master/vnc/start'))}>
                        {actionState === 'vnc-start' ? 'Iniciando...' : 'Iniciar VNC'}
                      </button>
                      <button type="button" className="outline-action" disabled={actionState === 'vnc-stop'} onClick={() => runAction('vnc-stop', () => api.post('/admin/robot/master/vnc/stop'))}>
                        {actionState === 'vnc-stop' ? 'Encerrando...' : 'Parar VNC'}
                      </button>
                    </div>
                  )}
                />

                <article className="robot-master-card">
                  <dl className="robot-master-definition-list">
                    <div><dt>Modo</dt><dd>{vncStatus?.mode || 'screenshots_only'}</dd></div>
                    <div><dt>Disponivel</dt><dd>{vncStatus?.available ? 'Sim' : 'Nao'}</dd></div>
                    <div><dt>Host</dt><dd>{vncStatus?.host || '127.0.0.1'}</dd></div>
                    <div><dt>Porta</dt><dd>{vncStatus?.port || 'N/D'}</dd></div>
                    <div><dt>Mensagem</dt><dd>{vncStatus?.message || 'N/D'}</dd></div>
                  </dl>
                </article>

                <div className="robot-master-artifact-grid">
                  {lastArtifacts.length ? lastArtifacts.map((artifact) => (
                    <article key={artifact.id} className="robot-master-artifact-card">
                      <span>{artifact.artifact_type}</span>
                      <strong>{artifact.file_name || `Artefato #${artifact.id}`}</strong>
                      <small>{artifact.step || 'captura'}</small>
                      <a href={artifact.file_url} target="_blank" rel="noreferrer">Abrir captura</a>
                    </article>
                  )) : (
                    <EmptyState title="Sem capturas recentes" detail="As ultimas screenshots e HTML do robo serao listadas aqui." />
                  )}
                </div>
              </section>
            )}

            {activeTab === 'settings' && (
              <section className="robot-master-panel">
                <SectionHeader eyebrow="Configuracoes" title="Estado inicial seguro" description="Referencia operacional sem expor credenciais, tokens ou segredos." />
                <div className="robot-master-two-column">
                  <article className="robot-master-card">
                    <h3>NPS automatica</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Dry-run</dt><dd>{overview?.config?.nps?.dryRun ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Envio automatico</dt><dd>{overview?.config?.nps?.dispatchEnabled ? 'Ativo' : 'Inativo'}</dd></div>
                      <div><dt>Janela</dt><dd>{overview?.config?.nps?.dispatchWindowStart} - {overview?.config?.nps?.dispatchWindowEnd}</dd></div>
                      <div><dt>Intervalo</dt><dd>{overview?.config?.nps?.dispatchIntervalSeconds}s</dd></div>
                      <div><dt>Limite diario</dt><dd>{overview?.config?.nps?.maxDailyPerSession}</dd></div>
                      <div><dt>Bloqueio de duplicidade</dt><dd>{overview?.config?.nps?.duplicateBlockHours}h</dd></div>
                    </dl>
                  </article>

                  <article className="robot-master-card">
                    <h3>Robo e mapeamento</h3>
                    <dl className="robot-master-definition-list">
                      <div><dt>Modo</dt><dd>{overview?.config?.robot?.mode || 'browser'}</dd></div>
                      <div><dt>Coleta principal</dt><dd>{overview?.config?.robot?.collectionMode || 'excel_export'}</dd></div>
                      <div><dt>Exportacao Excel</dt><dd>{overview?.config?.robot?.excelExportMode || 'click_download'}</dd></div>
                      <div><dt>Endpoint direto Excel</dt><dd>{overview?.config?.robot?.patientsExportUrlConfigured ? 'Configurado' : 'Nao configurado'}</dd></div>
                      <div><dt>Timeout Excel</dt><dd>{formatNumber(overview?.config?.robot?.excelDownloadTimeoutMs)}ms</dd></div>
                      <div><dt>Headless</dt><dd>{overview?.config?.robot?.headless ? 'Sim' : 'Nao'}</dd></div>
                      <div><dt>Visual mode</dt><dd>{overview?.config?.robot?.visualMode ? 'Sim' : 'Nao'}</dd></div>
                      <div><dt>Mapeamento habilitado</dt><dd>{overview?.config?.mapping?.enabled ? 'Sim' : 'Nao'}</dd></div>
                      <div><dt>Cron do mapeamento</dt><dd>{overview?.config?.mapping?.cron || 'N/D'}</dd></div>
                      <div><dt>Paginas por execucao</dt><dd>{overview?.config?.mapping?.maxPages}</dd></div>
                    </dl>
                  </article>
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default RobotMasterMonitor;
