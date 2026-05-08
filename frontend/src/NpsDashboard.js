import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';

const chartColors = ['#0b6f5f', '#d08c31', '#c44536', '#1f7a8c', '#4c956c', '#8a4f7d'];

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

const npsStatusLabels = {
  registrado: 'Registrado',
  em_tratativa: 'Em tratamento',
  tratado: 'Tratado'
};

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function profileFromScore(score) {
  const value = Number(score || 0);
  if (value >= 9) return 'promotor';
  if (value >= 7) return 'neutro';
  return 'detrator';
}

function getNpsStatus(item) {
  return item?.nps_status || 'registrado';
}

function protocolLabel(item) {
  if (item?.nps_protocol) return item.nps_protocol;

  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function profileLabel(profile) {
  const normalized = String(profile || '').trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Não informado';
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function groupCount(items, key) {
  const map = new Map();

  items.forEach((item) => {
    const value = key(item) || 'Não informado';
    map.set(value, (map.get(value) || 0) + 1);
  });

  return Array.from(map.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function buildBarData(rows, label = 'Total', color = '#0b6f5f') {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      label,
      data: rows.map((row) => row.total),
      backgroundColor: color,
      borderRadius: 6
    }]
  };
}

function buildDoughnutData(rows) {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      data: rows.map((row) => row.total),
      backgroundColor: rows.map((_, index) => chartColors[index % chartColors.length]),
      borderWidth: 0
    }]
  };
}

function percentOf(total, value) {
  return total ? `${Math.round((value / total) * 100)}%` : '0%';
}

function formatShortDate(value) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function lastNpsActor(item) {
  return item?.logs?.[0]?.actor_name
    || item?.nps_treatment_by
    || item?.converted_by
    || 'Sem tratativa';
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom'
    }
  }
};

function NpsDashboard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      setFeedback('');

      try {
        const [npsRes, clinicsRes] = await Promise.all([
          api.get('/nps/responses'),
          api.get('/clinics')
        ]);
        setRows(Array.isArray(npsRes.data) ? npsRes.data : []);
        setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      } catch (error) {
        setFeedback(error.response?.data?.error || 'Não foi possível carregar o dashboard NPS.');
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, []);

  const options = useMemo(() => ({
    clinics: uniqueList([...rows.map((row) => row.clinic_name), ...clinics.map((clinic) => clinic.name)]),
    states: uniqueList([...rows.map((row) => row.state), ...clinics.map((clinic) => clinic.state)]),
    regions: uniqueList([...rows.map((row) => row.region), ...clinics.map((clinic) => clinic.region)]),
    coordinators: uniqueList([...rows.map((row) => row.coordinator_name), ...clinics.map((clinic) => clinic.coordinator_name)])
  }), [rows, clinics]);

  const filteredRows = useMemo(() => rows.filter((item) => {
    const createdAt = item.created_at ? new Date(item.created_at) : null;
    const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
    const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
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
      item.coordinator_name,
      item.detractor_feedback,
      item.improvement_comment,
      item.comment,
      item.nps_treatment_comment
    ].map(normalizeText).join(' ');

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

  const metrics = useMemo(() => {
    const total = filteredRows.length;
    const promoters = filteredRows.filter((item) => Number(item.score) >= 9).length;
    const neutrals = filteredRows.filter((item) => Number(item.score) >= 7 && Number(item.score) <= 8).length;
    const detractors = filteredRows.filter((item) => Number(item.score) <= 6).length;
    const treated = filteredRows.filter((item) => getNpsStatus(item) === 'tratado').length;
    const pendingDetractors = filteredRows.filter((item) => Number(item.score) <= 6 && getNpsStatus(item) !== 'tratado').length;
    const detractorVsPromoter = promoters ? Math.round((detractors / promoters) * 100) : detractors ? 100 : 0;
    const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return { total, promoters, neutrals, detractors, treated, pendingDetractors, detractorVsPromoter, nps };
  }, [filteredRows]);

  const byProfile = useMemo(() => groupCount(filteredRows, (item) => {
    const profile = item.nps_profile || profileFromScore(item.score);
    if (profile === 'promotor') return 'Promotores';
    if (profile === 'neutro') return 'Neutros';
    return 'Detratores';
  }), [filteredRows]);
  const byScore = useMemo(() => groupCount(filteredRows, (item) => String(item.score)).sort((a, b) => Number(a.label) - Number(b.label)), [filteredRows]);
  const byClinic = useMemo(() => groupCount(filteredRows, (item) => item.clinic_name).slice(0, 10), [filteredRows]);
  const byRegion = useMemo(() => groupCount(filteredRows, (item) => item.region), [filteredRows]);
  const byCoordinator = useMemo(() => groupCount(filteredRows, (item) => item.coordinator_name).slice(0, 10), [filteredRows]);
  const byTreatmentStatus = useMemo(() => groupCount(filteredRows, (item) => npsStatusLabels[getNpsStatus(item)]), [filteredRows]);
  const baseRows = useMemo(() => filteredRows.slice(0, 100), [filteredRows]);
  const baseExportRows = useMemo(() => baseRows.map((item) => {
    const profile = item.nps_profile || profileFromScore(item.score);
    const status = getNpsStatus(item);

    return {
      paciente: item.patient_name || 'Não informado',
      telefone: item.patient_phone || 'Telefone não informado',
      unidade: item.clinic_name || 'Não informado',
      localizacao: `${item.state || 'UF'} - ${item.region || 'Região não informada'}`,
      nota: item.score,
      perfil: profileLabel(profile),
      status_nps: npsStatusLabels[status] || status,
      protocolo: protocolLabel(item),
      responsavel: item.coordinator_name || 'Não vinculado',
      fluxo: item.converted_complaint_protocol || 'Fluxo NPS',
      ultima_tratativa: lastNpsActor(item),
      relato: item.nps_treatment_comment || item.improvement_comment || item.detractor_feedback || 'Sem relato complementar',
      cadastro: formatShortDate(item.created_at)
    };
  }), [baseRows]);

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const applyFilters = (updates = {}) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const exportBaseExcel = () => {
    const headers = Object.keys(baseExportRows[0] || {
      paciente: '',
      telefone: '',
      unidade: '',
      localizacao: '',
      nota: '',
      perfil: '',
      status_nps: '',
      protocolo: '',
      responsavel: '',
      fluxo: '',
      ultima_tratativa: '',
      relato: '',
      cadastro: ''
    });
    const html = `
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${baseExportRows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-nps-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportBasePdf = () => {
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF.');
      return;
    }

    const printDate = new Date();
    const headers = ['Paciente', 'Unidade', 'Nota e perfil', 'Status NPS', 'Protocolo', 'Responsável', 'Cadastro'];
    const rowsToPrint = baseExportRows.map((row) => [
      `${row.paciente} | ${row.telefone}`,
      `${row.unidade} | ${row.localizacao}`,
      `${row.nota} | ${row.perfil}`,
      row.status_nps,
      row.protocolo,
      `${row.responsavel} | ${row.fluxo}`,
      row.cadastro
    ]);

    reportWindow.document.write(`
      <html>
        <head>
          <title>Dashboard NPS</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Inter, Arial, sans-serif; color: #1f2937; background: #fff; }
            .report-shell { display: flex; flex-direction: column; gap: 18px; }
            .report-header { border: 1px solid #d9c4a0; border-radius: 14px; background: linear-gradient(135deg, #fffaf2 0%, #f6eddd 100%); padding: 20px 24px; }
            .report-header-top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
            .report-kicker { margin: 0 0 8px; color: #9a6b22; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
            h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.12; color: #111827; }
            .report-subtitle { margin: 0; color: #5b6472; font-size: 13px; }
            .report-meta, .summary-card { border: 1px solid #e6d6bd; border-radius: 12px; background: rgba(255,255,255,.92); padding: 14px 16px; }
            .report-meta strong, .summary-card strong { display: block; margin-bottom: 4px; color: #8a632d; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
            .report-meta span, .summary-card span { display: block; color: #111827; font-size: 14px; font-weight: 700; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
            .report-table-wrap { border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
            thead th { background: #132238; color: #f8fafc; padding: 10px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
            tbody td { border-top: 1px solid #e5e7eb; padding: 9px 8px; vertical-align: top; word-break: break-word; }
            tbody tr:nth-child(even) td { background: #faf7f2; }
          </style>
        </head>
        <body>
          <main class="report-shell">
            <section class="report-header">
              <div class="report-header-top">
                <div>
                  <p class="report-kicker">Grupo Sorria · Dashboard NPS</p>
                  <h1>Relação analítica filtrada</h1>
                  <p class="report-subtitle">Exportação da base operacional exibida na parte inferior do dashboard NPS.</p>
                </div>
                <div class="report-meta">
                  <strong>Emitido em</strong>
                  <span>${escapeHtml(printDate.toLocaleString('pt-BR'))}</span>
                </div>
              </div>
            </section>
            <section class="summary-grid">
              <article class="summary-card"><strong>Registros exportados</strong><span>${escapeHtml(String(baseExportRows.length))}</span></article>
              <article class="summary-card"><strong>Base filtrada</strong><span>${escapeHtml(String(filteredRows.length))}</span></article>
              <article class="summary-card"><strong>Clínica</strong><span>${escapeHtml(filters.clinic || 'Todas')}</span></article>
              <article class="summary-card"><strong>Perfil</strong><span>${escapeHtml(filters.profile || 'Todos')}</span></article>
            </section>
            <section class="report-table-wrap">
              <table>
                <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                <tbody>${rowsToPrint.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
            </section>
          </main>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  return (
    <main className="app-page nps-dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Dashboard NPS</p>
          <h1>Dashboard NPS</h1>
          <p>Analise satisfação por unidade, região, coordenador, perfil e período.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/gestao-nps')}>
            Painel NPS
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      <section className="dashboard-filter-panel">
        <div className="dashboard-filter-heading">
          <div>
            <p className="eyebrow">Filtros</p>
          </div>
          <button className="outline-action" onClick={() => setFilters(initialFilters)}>
            Limpar filtros
          </button>
        </div>

        <div className="dashboard-filters">
          <div className="search-field">
            <input
              className="field"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Buscar paciente, unidade, telefone ou relato"
            />
            <button type="button" aria-label="Buscar" onClick={() => updateFilter('search', filters.search.trim())}>🔎</button>
          </div>
          <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
            <option value="">Todas as unidades</option>
            {options.clinics.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
            <option value="">Todas as regiões</option>
            {options.regions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.state} onChange={(event) => updateFilter('state', event.target.value)}>
            <option value="">Todos os estados</option>
            {options.states.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.coordinator} onChange={(event) => updateFilter('coordinator', event.target.value)}>
            <option value="">Todos os coordenadores</option>
            {options.coordinators.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.profile} onChange={(event) => updateFilter('profile', event.target.value)}>
            <option value="">Todos os perfis</option>
            <option value="detrator">Detratores</option>
            <option value="neutro">Neutros</option>
            <option value="promotor">Promotores</option>
          </select>
          <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Todos os status NPS</option>
            <option value="registrado">Registrados</option>
            <option value="em_tratativa">Em tratamento</option>
            <option value="tratado">Tratados</option>
          </select>
          <input className="field" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          <input className="field" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
        </div>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="kpi-grid dashboard-kpi-grid nps-kpi-grid" aria-label="Resumo NPS filtrado">
        <button className="kpi-card kpi-button" type="button" onClick={() => setFilters(initialFilters)}>
          <span>Detratores x Promotores</span>
          <strong>{metrics.detractorVsPromoter}%</strong>
          <p>COMPARATIVO DO CENÁRIO</p>
        </button>
        <button className="kpi-card kpi-button" type="button" onClick={() => updateFilter('profile', '')}>
          <span>Respostas</span>
          <strong>{metrics.total}</strong>
          <p>{percentOf(rows.length, metrics.total)} DA BASE</p>
        </button>
        <button className="kpi-card success kpi-button" type="button" onClick={() => updateFilter('profile', 'promotor')}>
          <span>Promotores</span>
          <strong>{metrics.promoters}</strong>
          <p>{percentOf(metrics.total, metrics.promoters)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card danger kpi-button" type="button" onClick={() => updateFilter('profile', 'detrator')}>
          <span>Detratores</span>
          <strong>{metrics.detractors}</strong>
          <p>{percentOf(metrics.total, metrics.detractors)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card progress kpi-button" type="button" onClick={() => updateFilter('profile', 'neutro')}>
          <span>NPS</span>
          <strong>{metrics.nps}</strong>
          <p>ÍNDICE FILTRADO</p>
        </button>
        <button className="kpi-card warning kpi-button" type="button" onClick={() => updateFilter('status', 'tratado')}>
          <span>Tratados</span>
          <strong>{metrics.treated}</strong>
          <p>{metrics.pendingDetractors} DETRATORES EM ABERTO</p>
        </button>
      </section>

      {loading ? (
        <section className="management-panel">
          <p className="empty-state">Carregando dashboard NPS...</p>
        </section>
      ) : (
        <>
          <section className="chart-grid dashboard-chart-grid">
            <article className="chart-card status-chart-card">
              <h2>Perfil NPS</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byProfile)} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card status-chart-card">
              <h2>Status das tratativas</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byTreatmentStatus)} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Distribuição por nota</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byScore, 'Respostas', '#1f7a8c')} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Volume por unidade</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byClinic, 'Respostas', '#4c956c')} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Volume por região</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byRegion)} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Volume por coordenador</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byCoordinator, 'Respostas', '#d08c31')} options={chartOptions} />
              </div>
            </article>
          </section>

          <section className="management-panel dashboard-base-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Base filtrada</p>
                <h2 className="table-title-with-help">
                  Respostas NPS do cenário selecionado
                  <span className="tooltip-help inline-help" tabIndex="0" aria-label="Horário de Brasília">
                    ?
                    <span>O horário exibido segue o horário oficial de Brasília.</span>
                  </span>
                </h2>
                <p className="base-subtitle">{filteredRows.length} respostas na seleção atual.</p>
              </div>
              <div className="export-actions">
                <button className="outline-action" onClick={exportBaseExcel} disabled={!baseExportRows.length}>
                  <span className="export-badge excel">XLS</span>
                  <span>Baixar Excel</span>
                </button>
                <button className="outline-action" onClick={exportBasePdf} disabled={!baseExportRows.length}>
                  <span className="export-badge pdf">PDF</span>
                  <span>Baixar PDF</span>
                </button>
              </div>
            </div>

            <div className="dashboard-base-summary">
              {[
                { label: 'Respostas', value: filteredRows.length },
                { label: 'Promotores', value: metrics.promoters },
                { label: 'Detratores', value: metrics.detractors },
                { label: 'Em tratamento', value: filteredRows.filter((item) => getNpsStatus(item) === 'em_tratativa').length },
                { label: 'Tratados', value: metrics.treated }
              ].map((item) => {
                let onClick = () => {};
                if (item.label === 'Respostas') onClick = () => applyFilters({ profile: '', status: '' });
                if (item.label === 'Promotores') onClick = () => applyFilters({ profile: 'promotor' });
                if (item.label === 'Detratores') onClick = () => applyFilters({ profile: 'detrator' });
                if (item.label === 'Em tratamento') onClick = () => applyFilters({ status: 'em_tratativa' });
                if (item.label === 'Tratados') onClick = () => applyFilters({ status: 'tratado' });

                return (
                <button className="dashboard-summary-card dashboard-summary-button" key={item.label} type="button" onClick={onClick}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </button>
                );
              })}
            </div>

            <div className="data-table-wrap dashboard-table-wrap">
              <table className="data-table dashboard-clean-table">
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Unidade</th>
                    <th>Nota e perfil</th>
                    <th>Status NPS</th>
                    <th>Protocolo</th>
                    <th>Responsável</th>
                    <th>Última tratativa por</th>
                    <th>Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {baseRows.map((item) => {
                    const profile = item.nps_profile || profileFromScore(item.score);
                    const status = getNpsStatus(item);

                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{item.patient_name || 'Não informado'}</span>
                            <span className="cell-secondary">{item.patient_phone || 'Telefone não informado'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{item.clinic_name || 'Não informado'}</span>
                            <span className="cell-secondary">{item.state || 'UF'} - {item.region || 'Região não informada'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span><span className={`nps-score-pill small ${profile}`}>{item.score}</span></span>
                            <span className="cell-secondary">{profileLabel(profile)}</span>
                          </div>
                        </td>
                        <td><span className={`nps-status-chip ${status}`}>{npsStatusLabels[status] || status}</span></td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{protocolLabel(item)}</span>
                            <span className="cell-secondary">{item.recommend_yes ? 'Indicou contato' : 'Sem indicação'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{item.coordinator_name || 'Não vinculado'}</span>
                            <span className="cell-secondary">{item.converted_complaint_protocol || 'Fluxo NPS'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{lastNpsActor(item)}</span>
                            <span className="cell-secondary">{item.nps_treatment_comment || item.improvement_comment || item.detractor_feedback || 'Sem relato complementar'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{formatShortDate(item.created_at)}</span>
                            <span className="cell-secondary">{item.created_origin || 'Pesquisa pública'}</span>
                          </div>
                        </td>
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

