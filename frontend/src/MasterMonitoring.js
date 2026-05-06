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

function percentFromStatus(status) {
  if (status === 'online') return 100;
  if (status === 'attention') return 68;
  if (status === 'not_configured') return 42;
  if (status === 'unknown') return 50;
  if (status === 'error') return 8;
  return 0;
}

function statusClass(status) {
  return `monitor-status ${status || 'unknown'}`;
}

function GaugeCard({ label, percent, value, detail, tone = 'neutral' }) {
  const safePercent = clampPercent(percent);
  const gaugeDeg = safePercent * 1.8;

  return (
    <article className={`monitor-gauge-card ${tone}`} style={{ '--gauge-deg': `${gaugeDeg}deg` }}>
      <div className="monitor-gauge-dial" aria-hidden="true">
        <span className="monitor-gauge-needle" />
        <span className="monitor-gauge-pin" />
      </div>
      <div className="monitor-gauge-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
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
          {notes.slice(0, 3).map((note) => <li key={note}>{note}</li>)}
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
  const whatsapp = data?.whatsapp || providers.twilio || {};
  const memoryUsagePercent = runtime.memory?.systemTotalBytes
    ? (runtime.memory.systemTotalBytes - runtime.memory.systemFreeBytes) / runtime.memory.systemTotalBytes * 100
    : null;
  const emailTotal24h = Number(email.summary?.last24h || overview.communications?.emails24h || 0);
  const emailFailed24h = Number(overview.communications?.emailsFailed24h || 0);
  const emailSuccessPercent = emailTotal24h ? ((emailTotal24h - emailFailed24h) / emailTotal24h) * 100 : 100;
  const resendNote = Array.isArray(providers.resend?.notes) ? providers.resend.notes[0] : '';
  const openComplaints = Number(overview.complaints?.open || 0);
  const overdueComplaints = Number(overview.complaints?.overdue || 0);
  const complaintSlaPercent = openComplaints ? ((openComplaints - overdueComplaints) / openComplaints) * 100 : 100;
  const mysqlLatencyHealth = Math.max(0, 100 - (Number(database.latencyMs || 0) / 500) * 100);
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

          <section className="monitor-kpi-grid" aria-label="Mostradores principais">
            <GaugeCard label="Saúde geral" percent={overview.healthScore} value={formatPercent(overview.healthScore)} detail={`${formatNumber(overview.activities24h)} movimentações em 24h`} tone="gold" />
            <GaugeCard label="SLA protocolos" percent={complaintSlaPercent} value={formatPercent(complaintSlaPercent)} detail={`${formatNumber(overdueComplaints)} atrasados de ${formatNumber(openComplaints)} abertos`} tone={overdueComplaints ? 'danger' : 'neutral'} />
            <GaugeCard label="CPU API" percent={runtime.processCpuPercent} value={formatPercent(runtime.processCpuPercent)} detail={`${runtime.cpuCount || 0} núcleos · uptime ${formatDuration(runtime.uptimeSeconds)}`} />
            <GaugeCard label="Memória host" percent={memoryUsagePercent} value={formatPercent(memoryUsagePercent)} detail={`${formatBytes(runtime.memory?.rssBytes)} em uso no Node`} />
            <GaugeCard label="Latência MySQL" percent={mysqlLatencyHealth} value={`${formatNumber(database.latencyMs)} ms`} detail={`${formatBytes(database.capacity?.totalBytes)} em storage`} tone={database.latencyMs > 250 ? 'danger' : 'neutral'} />
            <GaugeCard label="Conexões MySQL" percent={database.connections?.usagePercent} value={formatPercent(database.connections?.usagePercent)} detail={`${formatNumber(database.connections?.current)} de ${formatNumber(database.connections?.max)} conexões`} />
            <GaugeCard label="Entrega de e-mail" percent={emailSuccessPercent} value={formatPercent(emailSuccessPercent)} detail={`${formatNumber(emailTotal24h)} envios em 24h · ${formatNumber(emailFailed24h)} falhas`} tone={emailFailed24h ? 'danger' : 'neutral'} />
            <GaugeCard label="Resend API" percent={percentFromStatus(providers.resend?.status)} value={statusLabels[providers.resend?.status] || 'N/D'} detail={resendNote || 'Monitoria do provedor de e-mail'} tone={providers.resend?.status === 'error' ? 'danger' : 'neutral'} />
            <GaugeCard label="Twilio WhatsApp" percent={percentFromStatus(whatsapp?.status)} value={statusLabels[whatsapp?.status] || 'N/D'} detail={`${formatNumber(whatsapp?.metrics?.last24h)} envios em 24h · ${formatNumber(whatsapp?.metrics?.failed)} falhas`} tone={whatsapp?.status === 'error' || Number(whatsapp?.metrics?.failed || 0) ? 'danger' : 'neutral'} />
            <GaugeCard label="Vercel" percent={percentFromStatus(providers.vercel?.status)} value={statusLabels[providers.vercel?.status] || 'N/D'} detail={providers.vercel?.metrics?.latestState || providers.vercel?.publicStatus || 'Frontend'} tone={providers.vercel?.status === 'error' ? 'danger' : 'neutral'} />
            <GaugeCard label="Railway API" percent={percentFromStatus(providers.railway?.status)} value={statusLabels[providers.railway?.status] || 'N/D'} detail={providers.railway?.metrics?.projectName || 'Métricas do banco'} tone={providers.railway?.status === 'error' ? 'danger' : 'neutral'} />
          </section>

          {providers.resend?.status && providers.resend.status !== 'online' && (
            <section className="monitor-diagnostic-panel" aria-label="Diagnóstico Resend">
              <div>
                <p className="eyebrow">Diagnóstico Resend</p>
                <h2>{statusLabels[providers.resend.status] || 'Verificação do provedor'}</h2>
              </div>
              <p>{resendNote || 'A monitoria do Resend retornou uma condição que exige revisão da configuração.'}</p>
            </section>
          )}

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
                <div><dt>Node</dt><dd>{runtime.nodeVersion || 'N/D'}</dd></div>
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

          <section className="monitor-provider-grid">
            <ProviderCard provider={providers.vercel} />
            <ProviderCard provider={providers.railway} />
            <ProviderCard provider={providers.resend} />
            <ProviderCard provider={whatsapp} />
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
