import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';
import {
  NPS_PROFILE_LABELS,
  NPS_STATUS_LABELS,
  buildEntityRanking,
  buildExecutiveAlerts,
  buildPareto,
  buildPriorityQueue,
  buildTrendSeries,
  calculateMetrics,
  calculateRisk,
  classifyNps,
  getNpsStatus,
  normalizeText
} from './npsEnterpriseAnalytics';
import './NpsEnterprise.css';

const initialFilters = {
  clinic: '',
  state: '',
  region: '',
  coordinator: '',
  profile: '',
  status: '',
  startDate: '',
  endDate: '',
  search: ''
};

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' }
  },
  scales: {
    y: { beginAtZero: true }
  }
};

const npsChartOptions = {
  ...chartOptions,
  scales: {
    y: { min: -100, max: 100 }
  }
};

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function formatDate(value) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function protocolLabel(item) {
  if (item?.nps_protocol) return item.nps_protocol;
  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function scoreBadgeClass(score) {
  const profile = classifyNps(score);
  return profile ? `nps-enterprise-score ${profile}` : 'nps-enterprise-score';
}

function percent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function number(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function buildProfileChart(metrics) {
  return {
    labels: ['Promotores', 'Neutros', 'Detratores'],
    datasets: [{
      data: [metrics.promoters, metrics.neutrals, metrics.detractors],
      backgroundColor: ['#2f855a', '#b7791f', '#c53030'],
      borderWidth: 0
    }]
  };
}

function buildTrendChart(series) {
  return {
    labels: series.map((item) => item.period),
    datasets: [
      {
        label: 'NPS',
        data: series.map((item) => item.nps),
        borderColor: '#0b6f5f',
        backgroundColor: 'rgba(11,111,95,.12)',
        tension: 0.25
      },
      {
        label: '% Promotores',
        data: series.map((item) => item.promotersPercent),
        borderColor: '#2f855a',
        tension: 0.25
      },
      {
        label: '% Detratores',
        data: series.map((item) => item.detractorsPercent),
        borderColor: '#c53030',
        tension: 0.25
      }
    ]
  };
}

function buildParetoChart(rows) {
  return {
    labels: rows.slice(0, 10).map((item) => item.label),
    datasets: [{
      label: 'Ocorrências',
      data: rows.slice(0, 10).map((item) => item.total),
      backgroundColor: '#9a6b22',
      borderRadius: 6
    }]
  };
}

function NpsDashboard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [automationOverview, setAutomationOverview] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [granularity, setGranularity] = useState('month');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setFeedback('');

      try {
        const [npsRes, clinicsRes, overviewRes] = await Promise.all([
          api.get('/nps/responses'),
          api.get('/clinics'),
          api.get('/nps/automation/overview').catch(() => ({ data: null }))
        ]);

        if (cancelled) return;
        setRows(Array.isArray(npsRes.data) ? npsRes.data : []);
        setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
        setAutomationOverview(overviewRes.data || null);
      } catch (error) {
        if (!cancelled) {
          setFeedback(error.response?.data?.error || 'Não foi possível carregar o cockpit executivo NPS.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  const filterOptions = useMemo(() => ({
    clinics: uniqueList([...rows.map((item) => item.clinic_name), ...clinics.map((item) => item.name)]),
    states: uniqueList([...rows.map((item) => item.state), ...clinics.map((item) => item.state)]),
    regions: uniqueList([...rows.map((item) => item.region), ...clinics.map((item) => item.region)]),
    coordinators: uniqueList([...rows.map((item) => item.coordinator_name), ...clinics.map((item) => item.coordinator_name)])
  }), [rows, clinics]);

  const filteredRows = useMemo(() => rows.filter((item) => {
    const profile = item.nps_profile || classifyNps(item.score);
    const status = getNpsStatus(item);
    const createdAt = item.responded_at || item.created_at ? new Date(item.responded_at || item.created_at) : null;
    const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
    const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
    const searchable = normalizeText([
      protocolLabel(item),
      item.patient_name,
      item.patient_phone,
      item.clinic_name,
      item.city,
      item.state,
      item.region,
      item.coordinator_name,
      item.detractor_feedback,
      item.improvement_comment,
      item.comment,
      item.nps_treatment_comment,
      item.cause_category,
      item.cause_subcategory,
      item.responsible_name
    ].filter(Boolean).join(' '));

    return (
      (!filters.clinic || item.clinic_name === filters.clinic)
      && (!filters.state || item.state === filters.state)
      && (!filters.region || item.region === filters.region)
      && (!filters.coordinator || item.coordinator_name === filters.coordinator)
      && (!filters.profile || profile === filters.profile)
      && (!filters.status || status === filters.status)
      && (!startDate || (createdAt && createdAt >= startDate))
      && (!endDate || (createdAt && createdAt <= endDate))
      && (!filters.search || searchable.includes(normalizeText(filters.search)))
    );
  }), [rows, filters]);

  const metrics = useMemo(
    () => calculateMetrics(filteredRows, automationOverview?.summary || {}),
    [automationOverview, filteredRows]
  );

  const clinicRanking = useMemo(
    () => buildEntityRanking(filteredRows, (item) => item.clinic_name, 5),
    [filteredRows]
  );
  const regionRanking = useMemo(
    () => buildEntityRanking(filteredRows, (item) => item.region, 5),
    [filteredRows]
  );
  const coordinatorRanking = useMemo(
    () => buildEntityRanking(filteredRows, (item) => item.coordinator_name, 5),
    [filteredRows]
  );
  const trendSeries = useMemo(
    () => buildTrendSeries(filteredRows, granularity),
    [filteredRows, granularity]
  );
  const paretoRows = useMemo(() => buildPareto(filteredRows), [filteredRows]);
  const priorityQueue = useMemo(() => buildPriorityQueue(filteredRows), [filteredRows]);
  const alerts = useMemo(() => buildExecutiveAlerts(filteredRows), [filteredRows]);

  const averageRisk = useMemo(() => {
    if (!filteredRows.length) return 0;
    return Math.round(filteredRows.reduce((sum, item) => sum + calculateRisk(item).score, 0) / filteredRows.length);
  }, [filteredRows]);

  const npsGoal = Number(automationOverview?.goals?.nps ?? automationOverview?.summary?.npsGoal ?? 0) || null;
  const goalGap = npsGoal === null ? null : metrics.nps - npsGoal;
  const bestClinic = clinicRanking.find((item) => item.sampleStatus === 'adequada') || clinicRanking[0] || null;
  const worstClinic = [...clinicRanking]
    .filter((item) => item.sampleStatus === 'adequada')
    .sort((a, b) => a.nps - b.nps)[0] || null;

  const updateFilter = (field, value) => {
    setFilters((previous) => ({ ...previous, [field]: value }));
  };

  const toggleProfile = (profile) => {
    setFilters((previous) => ({ ...previous, profile: previous.profile === profile ? '' : profile }));
  };

  const exportCsv = () => {
    const headers = [
      'Protocolo', 'Paciente', 'Telefone', 'Clínica', 'Região', 'Coordenador',
      'Nota', 'Perfil', 'Status', 'Prioridade', 'Responsável', 'Causa', 'Data'
    ];
    const csvRows = filteredRows.map((item) => [
      protocolLabel(item),
      item.patient_name || '',
      item.patient_phone || '',
      item.clinic_name || '',
      item.region || '',
      item.coordinator_name || '',
      item.score,
      NPS_PROFILE_LABELS[item.nps_profile || classifyNps(item.score)] || '',
      NPS_STATUS_LABELS[getNpsStatus(item)] || getNpsStatus(item),
      item.operational_priority || '',
      item.responsible_name || item.nps_treatment_by || '',
      item.cause_category || item.cause_subcategory || '',
      item.responded_at || item.created_at || ''
    ]);
    const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const content = [headers, ...csvRows].map((row) => row.map(escapeCell).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nps-executivo-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-page nps-enterprise-page">
      <header className="page-heading nps-enterprise-heading">
        <div>
          <p className="eyebrow">Inteligência de experiência</p>
          <h1>Cockpit Executivo NPS</h1>
          <p>Visão integrada de satisfação, risco, SLA, causas, evolução e desempenho da rede.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" type="button" onClick={exportCsv}>Exportar CSV</button>
          <button className="outline-action" type="button" onClick={() => navigate('/gestao-nps')}>Central de Gestão</button>
          <button className="outline-action" type="button" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="nps-enterprise-filter-panel">
        <div className="nps-enterprise-section-head">
          <div>
            <p className="eyebrow">Filtros corporativos</p>
            <h2>Recorte analítico</h2>
          </div>
          <button className="outline-action" type="button" onClick={() => setFilters(initialFilters)}>Limpar filtros</button>
        </div>
        <div className="nps-enterprise-filters">
          <input className="field" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Buscar protocolo, paciente, unidade, relato ou responsável" />
          <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
            <option value="">Todas as unidades</option>
            {filterOptions.clinics.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
            <option value="">Todas as regiões</option>
            {filterOptions.regions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.state} onChange={(event) => updateFilter('state', event.target.value)}>
            <option value="">Todos os estados</option>
            {filterOptions.states.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.coordinator} onChange={(event) => updateFilter('coordinator', event.target.value)}>
            <option value="">Todos os coordenadores</option>
            {filterOptions.coordinators.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.profile} onChange={(event) => updateFilter('profile', event.target.value)}>
            <option value="">Todos os perfis</option>
            <option value="promotor">Promotores</option>
            <option value="neutro">Neutros</option>
            <option value="detrator">Detratores</option>
          </select>
          <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Todos os status</option>
            <option value="registrado">Registrados</option>
            <option value="em_tratativa">Em tratamento</option>
            <option value="tratado">Tratados</option>
          </select>
          <input className="field" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          <input className="field" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
        </div>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {loading && <p className="empty-state">Carregando inteligência NPS...</p>}

      {!loading && (
        <>
          <section className="nps-enterprise-kpi-grid" aria-label="Indicadores executivos NPS">
            <article className="nps-enterprise-kpi featured"><span>NPS Geral</span><strong>{metrics.nps}</strong><small>{npsGoal === null ? 'Meta não configurada' : `Meta ${npsGoal} · gap ${goalGap >= 0 ? '+' : ''}${goalGap}`}</small></article>
            <article className="nps-enterprise-kpi"><span>Pesquisas enviadas</span><strong>{number(metrics.sentInvites)}</strong><small>Convites efetivamente disparados</small></article>
            <article className="nps-enterprise-kpi"><span>Respostas válidas</span><strong>{number(metrics.total)}</strong><small>Taxa de resposta {percent(metrics.responseRate)}</small></article>
            <button className="nps-enterprise-kpi positive" type="button" onClick={() => toggleProfile('promotor')}><span>Promotores</span><strong>{number(metrics.promoters)}</strong><small>{percent(metrics.promotersPercent)}</small></button>
            <button className="nps-enterprise-kpi neutral" type="button" onClick={() => toggleProfile('neutro')}><span>Neutros</span><strong>{number(metrics.neutrals)}</strong><small>{percent(metrics.neutralsPercent)}</small></button>
            <button className="nps-enterprise-kpi negative" type="button" onClick={() => toggleProfile('detrator')}><span>Detratores</span><strong>{number(metrics.detractors)}</strong><small>{percent(metrics.detractorsPercent)}</small></button>
            <article className="nps-enterprise-kpi negative"><span>Detratores pendentes</span><strong>{number(metrics.pendingDetractors)}</strong><small>{metrics.inTreatment} em tratamento</small></article>
            <article className="nps-enterprise-kpi"><span>Conformidade SLA</span><strong>{percent(metrics.slaCompliance)}</strong><small>{metrics.overdue} vencido(s)</small></article>
            <article className="nps-enterprise-kpi"><span>Taxa de reversão</span><strong>{percent(metrics.recoveryRate)}</strong><small>{metrics.recovered} recuperado(s)</small></article>
            <article className="nps-enterprise-kpi"><span>Indicações</span><strong>{number(metrics.referrals)}</strong><small>{percent(metrics.referralConversionRate)} de conversão</small></article>
          </section>

          <section className="nps-enterprise-thermometer">
            <article><span>NPS da rede</span><strong>{metrics.nps}</strong></article>
            <article><span>Meta</span><strong>{npsGoal ?? '—'}</strong></article>
            <article><span>Melhor unidade</span><strong>{bestClinic ? `${bestClinic.name} · ${bestClinic.nps}` : '—'}</strong></article>
            <article><span>Pior unidade</span><strong>{worstClinic ? `${worstClinic.name} · ${worstClinic.nps}` : '—'}</strong></article>
            <article><span>Índice de risco</span><strong>{averageRisk}/100</strong></article>
          </section>

          <section className="nps-enterprise-grid two-columns">
            <article className="nps-enterprise-panel">
              <div className="nps-enterprise-section-head">
                <div><p className="eyebrow">Evolução</p><h2>Tendência do NPS</h2></div>
                <select className="field compact-field" value={granularity} onChange={(event) => setGranularity(event.target.value)}>
                  <option value="day">Diária</option>
                  <option value="week">Semanal</option>
                  <option value="month">Mensal</option>
                </select>
              </div>
              <div className="nps-enterprise-chart"><Line data={buildTrendChart(trendSeries)} options={npsChartOptions} /></div>
            </article>
            <article className="nps-enterprise-panel">
              <div className="nps-enterprise-section-head"><div><p className="eyebrow">Composição</p><h2>Perfis NPS</h2></div></div>
              <div className="nps-enterprise-chart"><Doughnut data={buildProfileChart(metrics)} options={{ ...chartOptions, scales: undefined }} /></div>
            </article>
          </section>

          <section className="nps-enterprise-grid two-columns">
            <article className="nps-enterprise-panel">
              <div className="nps-enterprise-section-head"><div><p className="eyebrow">Causa</p><h2>Pareto de detratores</h2></div></div>
              {paretoRows.length ? <div className="nps-enterprise-chart"><Bar data={buildParetoChart(paretoRows)} options={chartOptions} /></div> : <p className="empty-state">Sem causas de detratores no recorte atual.</p>}
            </article>
            <article className="nps-enterprise-panel">
              <div className="nps-enterprise-section-head"><div><p className="eyebrow">Prioridades do dia</p><h2>Alertas executivos</h2></div></div>
              <div className="nps-enterprise-alert-list">
                {alerts.length ? alerts.map((alert) => (
                  <div className={`nps-enterprise-alert ${alert.severity}`} key={alert.type}>
                    <strong>{alert.title}</strong><span>Exige acompanhamento gerencial.</span>
                  </div>
                )) : <p className="empty-state">Nenhum alerta crítico no recorte atual.</p>}
              </div>
            </article>
          </section>

          <section className="nps-enterprise-panel">
            <div className="nps-enterprise-section-head"><div><p className="eyebrow">Benchmark interno</p><h2>Ranking de clínicas</h2></div><span className="nps-enterprise-note">Amostras pequenas são sinalizadas e não ocultadas.</span></div>
            <div className="nps-enterprise-table-wrap">
              <table className="nps-enterprise-table">
                <thead><tr><th>Posição</th><th>Clínica</th><th>Amostra</th><th>NPS</th><th>Promotores</th><th>Neutros</th><th>Detratores</th><th>Pendentes</th><th>SLA</th><th>Risco</th></tr></thead>
                <tbody>
                  {clinicRanking.map((item, index) => (
                    <tr key={item.name}>
                      <td>{index + 1}</td>
                      <td><strong>{item.name}</strong>{item.sampleStatus === 'amostra_reduzida' && <small className="sample-warning">Amostra reduzida</small>}</td>
                      <td>{item.sample}</td><td><strong>{item.nps}</strong></td><td>{percent(item.promotersPercent)}</td><td>{percent(item.neutralsPercent)}</td><td>{percent(item.detractorsPercent)}</td><td>{item.pendingDetractors}</td><td>{percent(item.slaCompliance)}</td><td>{item.averageRisk}/100</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="nps-enterprise-grid three-columns">
            {[['Regiões', regionRanking], ['Coordenadores', coordinatorRanking], ['Fila de risco', priorityQueue.slice(0, 8)]].map(([title, data]) => (
              <article className="nps-enterprise-panel" key={title}>
                <div className="nps-enterprise-section-head"><div><p className="eyebrow">Drill-down</p><h2>{title}</h2></div></div>
                <div className="nps-enterprise-compact-list">
                  {title === 'Fila de risco'
                    ? data.map((item) => <div key={item.id || protocolLabel(item)}><span><b>{protocolLabel(item)}</b><small>{item.clinic_name || 'Unidade não informada'}</small></span><span className={scoreBadgeClass(item.score)}>{item.score}</span></div>)
                    : data.slice(0, 8).map((item) => <div key={item.name}><span><b>{item.name}</b><small>{item.sample} respostas</small></span><strong>{item.nps}</strong></div>)}
                </div>
              </article>
            ))}
          </section>

          <section className="nps-enterprise-panel">
            <div className="nps-enterprise-section-head"><div><p className="eyebrow">Base analítica</p><h2>Respostas NPS</h2></div><span className="nps-enterprise-note">{filteredRows.length} registro(s) no recorte.</span></div>
            <div className="nps-enterprise-table-wrap">
              <table className="nps-enterprise-table">
                <thead><tr><th>Protocolo</th><th>Paciente</th><th>Clínica</th><th>Nota</th><th>Perfil</th><th>Status</th><th>Responsável</th><th>Data</th><th>Ação</th></tr></thead>
                <tbody>
                  {filteredRows.slice(0, 100).map((item) => {
                    const profile = item.nps_profile || classifyNps(item.score);
                    return (
                      <tr key={item.id}>
                        <td>{protocolLabel(item)}</td>
                        <td><strong>{item.patient_name || 'Não informado'}</strong><small>{item.patient_phone || 'Sem telefone'}</small></td>
                        <td>{item.clinic_name || 'Não informada'}</td>
                        <td><span className={scoreBadgeClass(item.score)}>{item.score}</span></td>
                        <td>{NPS_PROFILE_LABELS[profile] || 'Não informado'}</td>
                        <td>{NPS_STATUS_LABELS[getNpsStatus(item)] || getNpsStatus(item)}</td>
                        <td>{item.responsible_name || item.nps_treatment_by || 'Não atribuído'}</td>
                        <td>{formatDate(item.responded_at || item.created_at)}</td>
                        <td><button className="outline-action small-action" type="button" onClick={() => navigate(`/gestao-nps?abrir=${item.id}`)}>Abrir</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default NpsDashboard;
