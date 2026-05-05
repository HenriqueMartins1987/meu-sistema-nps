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

function ExecutiveStatus({ label, status, value, detail }) {
  return (
    <article className="monitor-executive-card">
      <div>
        <span>{label}</span>
        <strong>{value || statusLabels[status] || 'N/D'}</strong>
      </div>
      <em className={statusClass(status)}>{statusLabels[status] || status || 'N/D'}</em>
      {detail && <small>{detail}</small>}
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
  const memoryUsagePercent = runtime.memory?.systemTotalBytes
    ? (runtime.memory.systemTotalBytes - runtime.memory.systemFreeBytes) / runtime.memory.systemTotalBytes * 100
    : null;
  const emailTotal24h = Number(email.summary?.last24h || overview.communications?.emails24h || 0);
  const emailFailed24h = Number(overview.communications?.emailsFailed24h || 0);
  const emailSuccessPercent = emailTotal24h ? ((emailTotal24h - emailFailed24h) / emailTotal24h) * 100 : 100;
  const resendNote = Array.isArray(providers.resend?.notes) ? providers.resend.notes[0] : '';

  return (
    <main className="app-page master-monitoring-page">
      <header className="topbar monitoring-topbar">
        <div>
          <p className="eyebrow">Administrador Master</p>
          <h1>Monitoria do sistema</h1>
        </div>
        <div className="heading-actions">
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
              <p className="eyebrow">Atualização contínua</p>
              <h2>Saúde operacional, infraestrutura e auditoria</h2>
              <p>Dados atualizados a cada {Math.round((data?.refreshMs || 15000) / 1000)} segundos. Última leitura: {formatDateTime(data?.generatedAt)}.</p>
            </div>
            <div className="monitor-health-score">
              <span>Índice de saúde</span>
              <strong>{formatNumber(overview.healthScore || 0)}</strong>
              <small>baseado em falhas, atrasos e comunicação</small>
            </div>
          </section>

          <section className="monitor-executive-strip" aria-label="Resumo executivo da monitoria">
            <ExecutiveStatus
              label="API"
              status={runtime.status}
              value={formatPercent(runtime.processCpuPercent)}
              detail={`CPU atual · uptime ${formatDuration(runtime.uptimeSeconds)}`}
            />
            <ExecutiveStatus
              label="MySQL Railway"
              status={database.status}
              value={`${formatNumber(database.latencyMs)} ms`}
              detail={`${formatBytes(database.capacity?.totalBytes)} de storage monitorado`}
            />
            <ExecutiveStatus
              label="Vercel"
              status={providers.vercel?.status}
              value={providers.vercel?.metrics?.latestState || 'Deploys'}
              detail={providers.vercel?.metrics?.latestUrl || providers.vercel?.publicStatus || 'Status de frontend'}
            />
            <ExecutiveStatus
              label="Resend"
              status={providers.resend?.status}
              value={`${formatNumber(email.summary?.last24h)} e-mails`}
              detail={`${formatNumber(email.summary?.failed)} falhas registradas`}
            />
          </section>

          <section className="monitor-kpi-grid">
            <GaugeCard label="Saúde geral" percent={overview.healthScore} value={formatPercent(overview.healthScore)} detail={`${formatNumber(overview.activities24h)} ações em 24h`} tone="gold" />
            <GaugeCard label="CPU API" percent={runtime.processCpuPercent} value={formatPercent(runtime.processCpuPercent)} detail={`${runtime.cpuCount || 0} núcleos monitorados`} />
            <GaugeCard label="Memória host" percent={memoryUsagePercent} value={formatPercent(memoryUsagePercent)} detail={`${formatBytes(runtime.memory?.rssBytes)} em uso no Node`} />
            <GaugeCard label="Conexões MySQL" percent={database.connections?.usagePercent} value={formatPercent(database.connections?.usagePercent)} detail={`${formatNumber(database.connections?.current)} de ${formatNumber(database.connections?.max)}`} />
            <GaugeCard label="Entrega de e-mail" percent={emailSuccessPercent} value={formatPercent(emailSuccessPercent)} detail={`${formatNumber(emailTotal24h)} envios em 24h · ${formatNumber(emailFailed24h)} falhas`} tone={emailFailed24h ? 'danger' : 'neutral'} />
            <GaugeCard label="Resend API" percent={percentFromStatus(providers.resend?.status)} value={statusLabels[providers.resend?.status] || 'N/D'} detail={resendNote || 'Monitoria do provedor de e-mail'} tone={providers.resend?.status === 'error' ? 'danger' : 'neutral'} />
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
                  <h2>Recursos do servidor</h2>
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
                  <h2>Banco de dados</h2>
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
          </section>

          <section className="management-panel monitor-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Movimentações</p>
                <h2>Auditoria em tempo real</h2>
              </div>
            </div>
            <div className="monitor-source-strip">
              {(activity.bySource24h || []).map((item) => (
                <span key={item.source}>{item.source}: <strong>{formatNumber(item.total)}</strong></span>
              ))}
            </div>
            <div className="table-wrap">
              <table className="dashboard-clean-table monitor-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Origem</th>
                    <th>Ação</th>
                    <th>Usuário</th>
                    <th>Resumo</th>
                  </tr>
                </thead>
                <tbody>
                  {(activity.recent || []).slice(0, 40).map((item, index) => (
                    <tr key={`${item.source}-${item.created_at}-${index}`}>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>{item.source}</td>
                      <td>{item.action}</td>
                      <td>{item.actor_name || item.actor_role || 'Sistema'}</td>
                      <td>{item.summary || item.context || 'Sem detalhe adicional'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="management-panel monitor-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Capacidade</p>
                <h2>Maiores tabelas do MySQL</h2>
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
