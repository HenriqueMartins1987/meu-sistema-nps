import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';
import { channels, complaintTypes, priorityOptions, statusLabels, statusOptions } from './constants';

const chartColors = ['#0b6f5f', '#1f7a8c', '#4c956c', '#d08c31', '#8a4f7d', '#5d6d7e', '#c44536', '#247ba0'];

const initialFilters = {
  clinic: '',
  city: '',
  state: '',
  region: '',
  coordinator: '',
  status: '',
  type: '',
  priority: '',
  channel: '',
  sla: '',
  startDate: '',
  endDate: '',
  search: ''
};

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function normalizeOptionKey(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function dedupeDisplayValues(values) {
  const seen = new Set();

  return values.filter((value) => {
    const key = normalizeOptionKey(value);

    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueValues(rows, key) {
  return Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function mergeValues(...lists) {
  return Array.from(new Set(lists.flat().filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function orderOtherLast(values) {
  const normalized = Array.from(new Set(values.filter(Boolean)));
  const others = normalized.filter((value) => normalizeText(value) === 'outros' || normalizeText(value) === 'outro');
  const regular = normalized
    .filter((value) => !others.includes(value))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

  return [...regular, ...others];
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

function buildBarData(rows, color = '#0b6f5f') {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      label: 'Reclamações',
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

function formatPercent(value) {
  return `${Math.round(value || 0)}%`;
}

function percentOf(total, value) {
  return total ? formatPercent((value / total) * 100) : '0%';
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

function buildDeadlineInfo(item) {
  if (item.status === 'resolvida') return 'closed';
  const dueAt = item.due_at ? new Date(item.due_at) : null;

  if (!dueAt || Number.isNaN(dueAt.getTime())) return 'neutral';

  const diffMs = dueAt.getTime() - Date.now();

  if (diffMs < 0) return 'overdue';
  if (diffMs <= 12 * 60 * 60 * 1000) return 'warning';
  return 'ontime';
}

function priorityLabel(value) {
  return priorityOptions.find((option) => option.value === value)?.label || value || 'Não informado';
}

function lastComplaintActor(item) {
  return item?.logs?.[0]?.actor_name
    || item?.treatment_by_name
    || item?.patient_contacted_by
    || item?.first_attendance_by
    || item?.sac_approval_by
    || item?.supervisor_approval_by
    || item?.forwarded_to_label
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

function Dashboard() {
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
        const [complaintsRes, clinicsRes] = await Promise.all([
          api.get('/complaints'),
          api.get('/clinics')
        ]);
        setRows(Array.isArray(complaintsRes.data) ? complaintsRes.data : []);
        setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      } catch (error) {
        setFeedback('Não foi possível carregar os indicadores.');
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, []);

  const options = useMemo(() => ({
    clinics: mergeValues(uniqueValues(clinics, 'name'), uniqueValues(rows, 'clinic_name')),
    cities: mergeValues(uniqueValues(clinics, 'city'), uniqueValues(rows, 'city')),
    states: mergeValues(uniqueValues(clinics, 'state'), uniqueValues(rows, 'state')),
    regions: mergeValues(uniqueValues(clinics, 'region'), uniqueValues(rows, 'region')),
    coordinators: mergeValues(uniqueValues(clinics, 'coordinator_name'), uniqueValues(rows, 'coordinator_name')),
    types: mergeValues(complaintTypes.map((item) => item.label), uniqueValues(rows, 'complaint_type')),
    channels: orderOtherLast(dedupeDisplayValues(mergeValues(channels.map((item) => item.label), uniqueValues(rows, 'channel'))))
  }), [clinics, rows]);

  const filteredRows = useMemo(() => rows.filter((item) => {
    const createdAt = item.created_at ? new Date(item.created_at) : null;
    const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
    const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
    const searchable = [
      item.protocol,
      item.patient_name,
      item.patient_phone,
      item.description,
      item.clinic_name,
      item.city,
      item.state,
      item.region,
      item.coordinator_name,
      item.complaint_type,
      item.channel
    ].map(normalizeText).join(' ');

    return (
      (!filters.clinic || item.clinic_name === filters.clinic)
      && (!filters.city || item.city === filters.city)
      && (!filters.state || item.state === filters.state)
      && (!filters.region || item.region === filters.region)
      && (!filters.coordinator || item.coordinator_name === filters.coordinator)
      && (!filters.status || item.status === filters.status)
      && (!filters.type || item.complaint_type === filters.type)
      && (!filters.priority || item.priority === filters.priority)
      && (!filters.channel || item.channel === filters.channel)
      && (!filters.sla || buildDeadlineInfo(item) === filters.sla)
      && (!startDate || (createdAt && createdAt >= startDate))
      && (!endDate || (createdAt && createdAt <= endDate))
      && (!filters.search || searchable.includes(normalizeText(filters.search)))
    );
  }), [rows, filters]);

  const metrics = useMemo(() => {
    const total = filteredRows.length;
    const closed = filteredRows.filter((item) => item.status === 'resolvida').length;
    const opened = filteredRows.filter((item) => item.status === 'aberta').length;
    const inProgress = filteredRows.filter((item) => item.status === 'em_andamento').length;
    const overdue = filteredRows.filter((item) => buildDeadlineInfo(item) === 'overdue').length;
    const warning = filteredRows.filter((item) => buildDeadlineInfo(item) === 'warning').length;
    const open = filteredRows.filter((item) => item.status !== 'resolvida').length;

    return {
      total,
      open,
      opened,
      inProgress,
      closed,
      overdue,
      warning,
      closeRate: total ? (closed / total) * 100 : 0
    };
  }, [filteredRows]);

  const searchSuggestions = useMemo(() => (
    mergeValues(
      uniqueValues(rows, 'protocol'),
      uniqueValues(rows, 'patient_name'),
      uniqueValues(rows, 'clinic_name'),
      uniqueValues(rows, 'city'),
      uniqueValues(rows, 'complaint_type')
    ).slice(0, 120)
  ), [rows]);

  const byStatus = useMemo(() => groupCount(filteredRows, (item) => statusLabels[item.status] || item.status), [filteredRows]);
  const byType = useMemo(() => groupCount(filteredRows, (item) => item.complaint_type).slice(0, 10), [filteredRows]);
  const byClinic = useMemo(() => groupCount(filteredRows, (item) => item.clinic_name).slice(0, 10), [filteredRows]);
  const byCity = useMemo(() => groupCount(filteredRows, (item) => item.city).slice(0, 10), [filteredRows]);
  const byState = useMemo(() => groupCount(filteredRows, (item) => item.state).slice(0, 10), [filteredRows]);
  const byRegion = useMemo(() => groupCount(filteredRows, (item) => item.region), [filteredRows]);
  const byPriority = useMemo(() => groupCount(filteredRows, (item) => priorityLabel(item.priority)), [filteredRows]);
  const byChannel = useMemo(() => groupCount(filteredRows, (item) => item.channel).slice(0, 10), [filteredRows]);
  const baseRows = useMemo(() => filteredRows.slice(0, 100), [filteredRows]);
  const baseTableHighlights = useMemo(() => {
    const units = new Set(filteredRows.map((item) => item.clinic_name).filter(Boolean)).size;
    const coordinators = new Set(filteredRows.map((item) => item.coordinator_name).filter(Boolean)).size;
    const highPriority = filteredRows.filter((item) => item.priority === 'alta').length;
    const overdue = filteredRows.filter((item) => buildDeadlineInfo(item) === 'overdue').length;

    return [
      { label: 'Protocolos', value: filteredRows.length },
      { label: 'Unidades', value: units },
      { label: 'Coordenadores', value: coordinators },
      { label: 'Alta prioridade', value: highPriority },
      { label: 'Vencidos', value: overdue }
    ];
  }, [filteredRows]);

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <main className="app-page complaints-dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Dashboard de Reclamações</h1>
          <p>Combine filtros para analisar por unidade, localidade, classificação, criticidade e prazo.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/gestao')}>
            Gestão
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
              placeholder="Buscar protocolo, paciente, clínica ou relato"
              list="dashboard-search-suggestions"
            />
            <button type="button" aria-label="Buscar" onClick={() => updateFilter('search', filters.search.trim())}>🔎</button>
            <datalist id="dashboard-search-suggestions">
              {searchSuggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
            <option value="">Todas as clínicas</option>
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
          <select className="field" value={filters.city} onChange={(event) => updateFilter('city', event.target.value)}>
            <option value="">Todas as cidades</option>
            {options.cities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.coordinator} onChange={(event) => updateFilter('coordinator', event.target.value)}>
            <option value="">Todos os coordenadores</option>
            {options.coordinators.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Todos os status</option>
            {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <select className="field" value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
            <option value="">Todos os tipos</option>
            {options.types.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.priority} onChange={(event) => updateFilter('priority', event.target.value)}>
            <option value="">Todas as prioridades</option>
            {priorityOptions.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
          </select>
          <select className="field" value={filters.channel} onChange={(event) => updateFilter('channel', event.target.value)}>
            <option value="">Todos os canais</option>
            {options.channels.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.sla} onChange={(event) => updateFilter('sla', event.target.value)}>
            <option value="">Todos os prazos</option>
            <option value="overdue">Vencidas</option>
            <option value="warning">Perto de vencer</option>
            <option value="ontime">No prazo</option>
            <option value="closed">Fechadas</option>
          </select>
          <input className="field" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          <input className="field" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
        </div>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="kpi-grid dashboard-kpi-grid" aria-label="Resumo filtrado">
        <button className="kpi-card kpi-button" type="button" onClick={() => setFilters(initialFilters)}>
          <span>Total filtrado</span>
          <strong>{metrics.total}</strong>
          <p>{percentOf(rows.length, metrics.total)} DA BASE TOTAL</p>
        </button>
        <button className="kpi-card warning kpi-button" type="button" onClick={() => updateFilter('status', 'aberta')}>
          <span>Abertas</span>
          <strong>{metrics.opened}</strong>
          <p>{percentOf(metrics.total, metrics.opened)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card progress kpi-button" type="button" onClick={() => updateFilter('status', 'em_andamento')}>
          <span>Em andamento</span>
          <strong>{metrics.inProgress}</strong>
          <p>{percentOf(metrics.total, metrics.inProgress)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card danger kpi-button" type="button" onClick={() => updateFilter('sla', 'overdue')}>
          <span>Vencidas</span>
          <strong>{metrics.overdue}</strong>
          <p>{percentOf(metrics.total, metrics.overdue)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card success kpi-button" type="button" onClick={() => updateFilter('status', 'resolvida')}>
          <span>Fechadas</span>
          <strong>{metrics.closed}</strong>
          <p>{formatPercent(metrics.closeRate)} DE RESOLUÇÃO</p>
        </button>
      </section>

      {loading ? (
        <section className="management-panel">
          <p className="empty-state">Carregando indicadores...</p>
        </section>
      ) : (
        <>
          <section className="chart-grid dashboard-chart-grid">
            <article className="chart-card status-chart-card">
              <h2>Status das reclamações</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byStatus)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Reclamações por tipo</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byType)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por clínica</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byClinic, '#1f7a8c')} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por cidade</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byCity, '#4c956c')} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por estado</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byState, '#d08c31')} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por região</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byRegion)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Prioridade</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byPriority)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Canal de entrada</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byChannel, '#5d6d7e')} options={chartOptions} />
              </div>
            </article>
          </section>

          <section className="management-panel dashboard-base-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Base filtrada</p>
                <h2 className="table-title-with-help">
                  Registros do cenário selecionado
                  <span className="tooltip-help inline-help" tabIndex="0" aria-label="Horário de Brasília">
                    ?
                    <span>O horário exibido segue o horário oficial de Brasília.</span>
                  </span>
                </h2>
                <p className="base-subtitle">{filteredRows.length} protocolos na seleção atual.</p>
              </div>
            </div>

            <div className="dashboard-base-summary">
              {baseTableHighlights.map((item) => (
                <article className="dashboard-summary-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>

            <div className="data-table-wrap dashboard-table-wrap">
              <table className="data-table dashboard-clean-table">
                <thead>
                  <tr>
                    <th>Protocolo</th>
                    <th>Paciente</th>
                    <th>Unidade e localizacao</th>
                    <th>Classificação</th>
                    <th>Status e prazo</th>
                    <th>Responsável</th>
                    <th>Última tratativa por</th>
                    <th>Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {baseRows.map((item) => {
                    const deadline = buildDeadlineInfo(item);

                    return (
                    <tr key={item.id}>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.protocol || item.id}</span>
                          <span className="cell-secondary">{item.channel || 'Canal não informado'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.patient_name || 'Não informado'}</span>
                          <span className="cell-secondary">{item.patient_phone || 'Telefone não informado'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.clinic_name || 'Unidade não informada'}</span>
                          <span className="cell-secondary">{item.city || 'Cidade não informada'} / {item.state || 'UF'} - {item.region || 'Região não informada'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.complaint_type || 'Não informado'}</span>
                          <span className="cell-secondary">{priorityLabel(item.priority)} - {item.created_origin || 'Interno'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className={`status-pill ${item.status || 'aberta'}`}>
                            {statusLabels[item.status] || item.status || 'Aberta'}
                          </span>
                          <span className={`deadline-chip ${deadline}`}>
                            {deadline === 'overdue' ? 'Vencida' : deadline === 'warning' ? 'Perto de vencer' : deadline === 'closed' ? 'Fechada' : 'No prazo'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.coordinator_name || 'Não vinculado'}</span>
                          <span className="cell-secondary">{item.forwarded_to_label || 'Sem encaminhamento'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{lastComplaintActor(item)}</span>
                          <span className="cell-secondary">{item.service_type || 'Sem especialidade informada'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{formatShortDate(item.created_at)}</span>
                          <span className="cell-secondary">{item.created_origin || 'Interno'}</span>
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

export default Dashboard;
