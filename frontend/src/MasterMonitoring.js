import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { isMasterAdmin, readUser } from './constants';

const statusLabels = {
  online: 'Online',
  attention: 'Atenção',
  error: 'Falha',
  not_configured: 'Configurar',
  unknown: 'Verificando'
};

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/D';
  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${units[index]}`;
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDateTime(value) {
  if (!value) return 'N/D';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(value));
}

function formatActorRole(value) {
  const role = String(value || '').trim();
  if (!role) return '';

  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildActorLine(item) {
  const name = String(item?.actor_name || '').trim();
  const email = String(item?.actor_email || '').trim();
  const role = formatActorRole(item?.actor_role);

  if (name) {
    return {
      primary: name,
      secondary: [role, email].filter(Boolean).join(' · ') || 'Usuário identificado'
    };
  }

  if (email) {
    return {
      primary: email,
      secondary: role || 'Destinatário identificado'
    };
  }

  if (role) {
    return {
      primary: role,
      secondary: 'Sem nome vinculado'
    };
  }

  return {
    primary: 'Sistema',
    secondary: 'Execução automática'
  };
}

function buildOriginLine(item) {
  const origin = String(item?.origin_detail || '').trim();
  const sourceDetail = String(item?.source_detail || '').trim();
  const context = String(item?.context || '').trim();

  return {
    primary: sourceDetail || item?.source || 'Origem não informada',
    secondary: [origin, context].filter(Boolean).join(' · ') || 'Sem detalhe complementar'
  };
}

function sourceToneClass(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'sistema') return 'system';
  if (normalized === 'protocolo') return 'complaint';
  if (normalized === 'nps') return 'nps';
  if (normalized === 'relacionamento') return 'relationship';
  if (normalized === 'whatsapp') return 'whatsapp';
  if (normalized === 'e-mail') return 'email';
  return 'neutral';
}

const LOGS_PAGE_SIZE = 10;

function clampPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function statusClass(status) {
  return `monitor-status ${status || 'unknown'}`;
}

function GaugeCard({ label, percent, value, detail, tone = 'neutral' }) {
  return (
    <article className={`monitor-metric-card ${tone}`}>
      <div className="monitor-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
      {percent !== null && percent !== undefined && (
        <div className="monitor-metric-progress" aria-hidden="true">
          <i style={{ width: `${clampPercent(percent)}%` }} />
        </div>
      )}
    </article>
  );
}

function ActionItem({ tone = 'neutral', title, detail, value }) {
  return (
    <article className={`monitor-action-item ${tone}`}>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {value !== undefined && <em>{value}</em>}
    </article>
  );
}

function ProviderCard({ provider }) {
  const notes = Array.isArray(provider?.notes) ? provider.notes : [];

  return (
    <article className="monitor-provider-card">
      <div className="monitor-provider-heading">
        <div>
          <span>{provider?.label || 'Provedor'}</span>
          <strong>{statusLabels[provider?.status] || provider?.status || 'N/D'}</strong>
        </div>
        <em className={statusClass(provider?.status)}>{provider?.configured ? 'Ativo' : 'Configurar'}</em>
      </div>
      <dl className="monitor-provider-metrics">
        {Object.entries(provider?.metrics || {}).slice(0, 6).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value || 'N/D')}</dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <ul className="monitor-note-list">
          {notes.slice(0, 2).map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
    </article>
  );
}

function MasterMonitoring() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [activityTab, setActivityTab] = useState('Todos');
  const [activityPage, setActivityPage] = useState(1);

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setFeedback('');

    try {
      const response = await api.get('/admin/master-monitoring');
      setData(response.data);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a monitoria master.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isMasterAdmin(currentUser)) {
      navigate('/home');
      return undefined;
    }

    loadData();
    const interval = window.setInterval(() => loadData(true), data?.refreshMs || 15000);
    return () => window.clearInterval(interval);
  }, [currentUser, data?.refreshMs, loadData, navigate]);

  const overview = data?.overview || {};
  const runtime = data?.runtime || {};
  const database = data?.database || {};
  const email = data?.email || {};
  const activity = data?.activity || {};
  const providers = data?.providers || {};
  const whatsapp = useMemo(() => data?.whatsapp || providers.twilio || {}, [data?.whatsapp, providers.twilio]);
  const whatsappService = useMemo(() => data?.evolution || providers.evolution || {}, [data?.evolution, providers.evolution]);
  const internalSla = overview.internalSla || {};
  const queue = overview.queue || {};
  const system = overview.system || {};
  const memoryUsagePercent = runtime.memory?.systemTotalBytes
    ? (runtime.memory.systemTotalBytes - runtime.memory.systemFreeBytes) / runtime.memory.systemTotalBytes * 100
    : null;
  const emailTotal24h = Number(email.summary?.last24h || overview.communications?.emails24h || 0);
  const emailFailed24h = Number(overview.communications?.emailsFailed24h || 0);
  const openComplaints = Number(overview.complaints?.open || 0);
  const overdueComplaints = Number(overview.complaints?.overdue || 0);
  const complaintSlaPercent = openComplaints ? ((openComplaints - overdueComplaints) / openComplaints) * 100 : 100;
  const mysqlLatencyHealth = Math.max(0, 100 - (Number(database.latencyMs || 0) / 500) * 100);
  const coordinatorOverdue = Number(internalSla.coordinatorOverdue || 0);
  const managerOverdue = Number(internalSla.managerOverdue || 0);
  const internalOverdueTotal = coordinatorOverdue + managerOverdue;
  const internalOpenTotal = Number(internalSla.coordinatorWaiting || 0)
    + Number(internalSla.managerWaiting || 0)
    + Number(internalSla.sacAuditWaiting || 0)
    + Number(internalSla.adminEscalated || 0);
  const internalSlaPercent = internalOpenTotal
    ? ((internalOpenTotal - internalOverdueTotal) / internalOpenTotal) * 100
    : 100;
  const dispatchPending = Number(queue.whatsappPending || 0);
  const dispatchFailed24h = Number(queue.whatsappFailed24h || 0);
  const dispatchLocked = Number(queue.whatsappLocked || 0);
  const campaignPending = Number(queue.campaignPending || 0);
  const whatsappErrors24h = Number(overview.communications?.whatsappFailed24h || 0) + dispatchFailed24h;
  const httpErrors24h = Number(system.httpErrors24h || 0);
  const communicationTotal24h = emailTotal24h + Number(overview.communications?.whatsapp24h || 0) + Number(whatsappService?.metrics?.messages24h || 0);
  const communicationFailures24h = emailFailed24h + whatsappErrors24h + Number(whatsappService?.metrics?.errors24h || 0);
  const communicationHealth = communicationTotal24h
    ? ((communicationTotal24h - communicationFailures24h) / communicationTotal24h) * 100
    : 100;
  const usefulProviders = useMemo(() => {
    const legacyWhatsAppHasUse = Boolean(whatsapp?.configured)
      || Number(whatsapp?.metrics?.total || 0) > 0
      || Number(whatsapp?.metrics?.last24h || 0) > 0
      || Number(whatsapp?.metrics?.failed || 0) > 0;

    return [
      whatsappService,
      providers.resend,
      providers.vercel,
      providers.railway,
      legacyWhatsAppHasUse ? whatsapp : null
    ].filter(Boolean);
  }, [providers.railway, providers.resend, providers.vercel, whatsapp, whatsappService]);
  const actionItems = useMemo(() => {
    const items = [];

    if (internalOverdueTotal > 0) {
      items.push({
        tone: 'danger',
        title: 'Prazos internos vencidos',
        detail: `${formatNumber(coordinatorOverdue)} no coordenador e ${formatNumber(managerOverdue)} no gerente.`,
        value: formatNumber(internalOverdueTotal)
      });
    }

    if (overdueComplaints > 0) {
      items.push({
        tone: 'danger',
        title: 'SLA inicial vencido',
        detail: 'Protocolos abertos acima do prazo de criticidade.',
        value: formatNumber(overdueComplaints)
      });
    }

    if (dispatchLocked > 0) {
      items.push({
        tone: 'warning',
        title: 'Fila WhatsApp com lock ativo',
        detail: 'Monitorar se os itens destravam no próximo ciclo automático.',
        value: formatNumber(dispatchLocked)
      });
    }

    if (dispatchFailed24h > 0 || whatsappErrors24h > 0) {
      items.push({
        tone: 'danger',
        title: 'Falhas WhatsApp nas últimas 24h',
        detail: 'Acompanhar logs recentes e reprocessar apenas quando necessário.',
        value: formatNumber(whatsappErrors24h)
      });
    }

    if (emailFailed24h > 0) {
      items.push({
        tone: 'warning',
        title: 'Falhas de e-mail',
        detail: 'Verificar destinatários, provedor e eventos de entrega.',
        value: formatNumber(emailFailed24h)
      });
    }

    if (httpErrors24h > 0) {
      items.push({
        tone: 'danger',
        title: 'Erros HTTP recentes',
        detail: 'Priorizar rotas com status 500 nos logs operacionais.',
        value: formatNumber(httpErrors24h)
      });
    }

    if (!items.length) {
      items.push({
        tone: 'success',
        title: 'Operação sem alerta crítico',
        detail: 'Monitoria não encontrou vencimentos ou falhas relevantes agora.',
        value: 'OK'
      });
    }

    return items.slice(0, 6);
  }, [
    coordinatorOverdue,
    dispatchFailed24h,
    dispatchLocked,
    emailFailed24h,
    httpErrors24h,
    internalOverdueTotal,
    managerOverdue,
    overdueComplaints,
    whatsappErrors24h
  ]);
  const recentActivity = useMemo(() => (
    Array.isArray(activity.recent) ? activity.recent.slice(0, 40) : []
  ), [activity.recent]);
  const activityTabs = useMemo(() => (
    ['Todos', ...Array.from(new Set(recentActivity.map((item) => item.source).filter(Boolean)))]
  ), [recentActivity]);
  const filteredActivity = useMemo(() => (
    activityTab === 'Todos'
      ? recentActivity
      : recentActivity.filter((item) => item.source === activityTab)
  ), [activityTab, recentActivity]);
  const activityTotalPages = Math.max(1, Math.ceil(filteredActivity.length / LOGS_PAGE_SIZE));
  const paginatedActivity = useMemo(() => {
    const start = (activityPage - 1) * LOGS_PAGE_SIZE;
    return filteredActivity.slice(start, start + LOGS_PAGE_SIZE);
  }, [activityPage, filteredActivity]);

  useEffect(() => {
    if (!activityTabs.includes(activityTab)) {
      setActivityTab('Todos');
    }
  }, [activityTab, activityTabs]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityTab, data?.generatedAt]);

  useEffect(() => {
    if (activityPage > activityTotalPages) {
      setActivityPage(activityTotalPages);
    }
  }, [activityPage, activityTotalPages]);

  return (
    <main className="app-page master-monitoring-page">
      <header className="topbar monitoring-topbar">
        <div>
          <p className="eyebrow">Administrador Master</p>
          <h1>Monitoria do sistema</h1>
        </div>
        <div className="heading-actions">
          <button type="button" className="ghost-action" onClick={() => navigate('/home')}>Home</button>
          <button type="button" className="outline-action" onClick={() => navigate('/admin')}>Painel gerencial</button>
          <button type="button" className="primary-action" onClick={() => loadData(true)} disabled={refreshing}>
            {refreshing ? 'Atualizando...' : 'Atualizar agora'}
          </button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback">{feedback}</p>}

      {loading && !data ? (
        <section className="management-panel">
          <p className="empty-state">Carregando monitoria em tempo real...</p>
        </section>
      ) : (
        <>
          <section className="monitor-hero-panel">
            <div>
              <p className="eyebrow">Monitoria online</p>
              <h2>Central executiva de saúde do sistema</h2>
              <p>Leitura em tempo real da operação, infraestrutura, banco de dados e canais de comunicação.</p>
            </div>
            <div className="monitor-hero-meta" aria-label="Estado da atualização">
              <span>Atualiza a cada {Math.round((data?.refreshMs || 15000) / 1000)}s</span>
              <strong>{formatDateTime(data?.generatedAt)}</strong>
              <small>última leitura consolidada</small>
            </div>
          </section>

          <section className="monitor-kpi-grid" aria-label="Indicadores principais">
            <GaugeCard label="Saúde geral" percent={overview.healthScore} value={formatPercent(overview.healthScore)} detail={`${formatNumber(overview.activities24h)} movimentações em 24h`} tone="gold" />
            <GaugeCard label="SLA de reclamações" percent={complaintSlaPercent} value={formatPercent(complaintSlaPercent)} detail={`${formatNumber(overdueComplaints)} vencidas de ${formatNumber(openComplaints)} abertas`} tone={overdueComplaints ? 'danger' : 'success'} />
            <GaugeCard label="Prazos internos" percent={internalSlaPercent} value={formatPercent(internalSlaPercent)} detail={`${formatNumber(internalOpenTotal)} em tratativa interna · ${formatNumber(internalOverdueTotal)} vencidas`} tone={internalOverdueTotal ? 'danger' : 'success'} />
            <GaugeCard label="Fila WhatsApp" percent={dispatchPending ? Math.max(15, 100 - dispatchPending) : 100} value={formatNumber(dispatchPending)} detail={`${formatNumber(campaignPending)} campanhas pendentes · ${formatNumber(dispatchLocked)} locks`} tone={dispatchFailed24h || dispatchLocked ? 'danger' : 'neutral'} />
            <GaugeCard label="Comunicação 24h" percent={communicationHealth} value={formatPercent(communicationHealth)} detail={`${formatNumber(communicationTotal24h)} eventos · ${formatNumber(communicationFailures24h)} falhas`} tone={communicationFailures24h ? 'danger' : 'success'} />
            <GaugeCard label="API e banco" percent={mysqlLatencyHealth} value={`${formatNumber(database.latencyMs)} ms`} detail={`CPU ${formatPercent(runtime.processCpuPercent)} · ${formatPercent(memoryUsagePercent)} memória`} tone={database.latencyMs > 250 || httpErrors24h ? 'danger' : 'neutral'} />
          </section>

          <section className="monitor-action-grid">
            <article className="management-panel monitor-panel monitor-priority-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Ações necessárias</p>
                  <h2>Fila de atenção da monitoria</h2>
                  <p className="base-subtitle">Mostra somente o que exige acompanhamento real, sem cards decorativos.</p>
                </div>
              </div>
              <div className="monitor-action-list">
                {actionItems.map((item) => (
                  <ActionItem key={`${item.title}-${item.value}`} {...item} />
                ))}
              </div>
            </article>

            <article className="management-panel monitor-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Reclamações</p>
                  <h2>SLA interno e auditoria SAC</h2>
                </div>
              </div>
              <dl className="monitor-detail-grid compact">
                <div><dt>Coordenador</dt><dd>{formatNumber(internalSla.coordinatorWaiting)}</dd><small>{formatNumber(coordinatorOverdue)} vencidas</small></div>
                <div><dt>Gerente</dt><dd>{formatNumber(internalSla.managerWaiting)}</dd><small>{formatNumber(managerOverdue)} vencidas</small></div>
                <div><dt>Auditoria SAC</dt><dd>{formatNumber(internalSla.sacAuditWaiting)}</dd><small>aguardando validação</small></div>
                <div><dt>Administração</dt><dd>{formatNumber(internalSla.adminEscalated)}</dd><small>escaladas</small></div>
                <div><dt>Próximas 48h</dt><dd>{formatNumber(internalSla.due48h)}</dd><small>SLA inicial a vencer</small></div>
                <div><dt>Abertas</dt><dd>{formatNumber(openComplaints)}</dd><small>{formatNumber(overdueComplaints)} fora do prazo</small></div>
              </dl>
            </article>
          </section>

          <section className="monitor-grid">
            <article className="management-panel monitor-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">API Node</p>
                  <h2>Capacidade da API</h2>
                </div>
                <span className={statusClass(runtime.status)}>{statusLabels[runtime.status] || 'Online'}</span>
              </div>
              <dl className="monitor-detail-grid">
                <div><dt>Uptime</dt><dd>{formatDuration(runtime.uptimeSeconds)}</dd></div>
                <div><dt>Heap usado</dt><dd>{formatBytes(runtime.memory?.heapUsedBytes)}</dd></div>
                <div><dt>RSS</dt><dd>{formatBytes(runtime.memory?.rssBytes)}</dd></div>
                <div><dt>Erros HTTP 24h</dt><dd>{formatNumber(httpErrors24h)}</dd></div>
              </dl>
            </article>

            <article className="management-panel monitor-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Railway MySQL</p>
                  <h2>Capacidade do banco</h2>
                </div>
                <span className={statusClass(database.status)}>{statusLabels[database.status] || 'Online'}</span>
              </div>
              <dl className="monitor-detail-grid">
                <div><dt>Storage</dt><dd>{formatBytes(database.capacity?.totalBytes)}</dd></div>
                <div><dt>Tabelas</dt><dd>{formatNumber(database.capacity?.tableCount)}</dd></div>
                <div><dt>Conexões</dt><dd>{formatNumber(database.connections?.current)} / {formatNumber(database.connections?.max)}</dd></div>
                <div><dt>Queries lentas</dt><dd>{formatNumber(database.traffic?.slowQueries)}</dd></div>
              </dl>
            </article>
          </section>

          <section className="monitor-provider-grid" aria-label="Serviços monitorados">
            {usefulProviders.map((provider) => (
              <ProviderCard key={provider?.label || provider?.metrics?.baseUrl || provider?.status} provider={provider} />
            ))}
          </section>

          <section className="management-panel monitor-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Movimentações</p>
                <h2>Linha do tempo operacional</h2>
                <p className="base-subtitle">Cada evento mostra a origem detalhada, o usuário vinculado e o resumo operacional consolidado.</p>
              </div>
            </div>
            <div className="monitor-source-strip">
              {(activity.bySource24h || []).map((item) => (
                <span key={item.source}>{item.source}: <strong>{formatNumber(item.total)}</strong></span>
              ))}
            </div>
            <div className="monitor-log-tabs" role="tablist" aria-label="Filtrar logs por origem">
              {activityTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={tab === activityTab ? 'active' : ''}
                  onClick={() => setActivityTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="monitor-timeline-list">
              {paginatedActivity.map((item, index) => {
                const actor = buildActorLine(item);
                const origin = buildOriginLine(item);

                return (
                  <article key={`${item.source}-${item.created_at}-${index}`} className={`monitor-timeline-item ${sourceToneClass(item.source)}`}>
                    <div className="monitor-timeline-rail" aria-hidden="true">
                      <span className="monitor-timeline-dot" />
                    </div>

                    <div className="monitor-timeline-card">
                      <div className="monitor-timeline-topline">
                        <div className="monitor-timeline-time">
                          <strong>{formatDateTime(item.created_at)}</strong>
                          <small>{item.duration_ms ? `${formatNumber(item.duration_ms)} ms` : (item.source || 'Evento')}</small>
                        </div>

                        <div className="monitor-timeline-badges">
                          <span className="monitor-source-badge">{item.source || 'Sistema'}</span>
                          <span className="monitor-action-badge">{item.action || 'Movimentação'}</span>
                        </div>
                      </div>

                      <div className="monitor-timeline-grid">
                        <section className="monitor-timeline-block">
                          <span className="monitor-block-label">Origem</span>
                          <strong>{origin.primary}</strong>
                          <small>{origin.secondary}</small>
                        </section>

                        <section className="monitor-timeline-block">
                          <span className="monitor-block-label">Usuário</span>
                          <strong>{actor.primary}</strong>
                          <small>{actor.secondary}</small>
                        </section>

                        <section className="monitor-timeline-block monitor-timeline-block-wide">
                          <span className="monitor-block-label">Detalhes</span>
                          <strong>{item.summary || 'Sem detalhe adicional'}</strong>
                          <small>
                            {[item.context, item.status_code ? `Status HTTP ${item.status_code}` : ''].filter(Boolean).join(' · ') || 'Sem contexto adicional'}
                          </small>
                        </section>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="pagination-bar">
              <span>
                Exibindo {paginatedActivity.length} de {filteredActivity.length} registros
              </span>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
                  disabled={activityPage <= 1}
                >
                  Anterior
                </button>
                <strong>Página {activityPage} de {activityTotalPages}</strong>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setActivityPage((page) => Math.min(activityTotalPages, page + 1))}
                  disabled={activityPage >= activityTotalPages}
                >
                  Próxima
                </button>
              </div>
            </div>
          </section>

          <section className="management-panel monitor-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Capacidade</p>
                <h2>Distribuição de storage MySQL</h2>
              </div>
            </div>
            <div className="monitor-table-grid">
              {(database.largestTables || []).map((table) => (
                <article key={table.tableName} className="monitor-table-card">
                  <span>{table.tableName}</span>
                  <strong>{formatBytes(table.totalBytes)}</strong>
                  <small>{formatNumber(table.estimatedRows)} linhas estimadas</small>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default MasterMonitoring;
