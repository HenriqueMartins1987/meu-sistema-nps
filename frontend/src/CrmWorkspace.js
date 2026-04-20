import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';

const chartColors = ['#0b6f5f', '#d08c31', '#c44536', '#1f7a8c', '#4c956c', '#8a4f7d', '#7d6847'];

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom'
    }
  }
};

const initialFilters = {
  search: '',
  clinic: '',
  source: '',
  stage: '',
  coordinator: ''
};

function formatDateTime(value) {
  if (!value) return 'Não informado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function profileFromScore(score) {
  const value = Number(score || 0);
  if (value >= 9) return 'Promotor';
  if (value >= 7) return 'Neutro';
  return 'Detrator';
}

function complaintStage(item) {
  if (item?.status === 'resolvida') return 'Encerrado';
  if (item?.patient_contacted_at) return 'Retorno final';
  if (item?.treatment_at) return 'Em acompanhamento';
  return 'Primeiro atendimento';
}

function npsStage(item) {
  const profile = profileFromScore(item?.score);

  if (item?.nps_status === 'tratado') return 'Encerrado';
  if (profile === 'Detrator') return 'Recuperação ativa';
  if (profile === 'Promotor') return 'Promotor';
  return 'Relacionamento';
}

function patientStage(item) {
  if (item?.status === 'Cancelado') return 'Cancelado';
  if (item?.status === 'Encerrado') return 'Encerrado';

  const scheduledAt = item?.scheduledAt ? new Date(item.scheduledAt) : null;
  const today = new Date().toISOString().slice(0, 10);

  if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.toISOString().slice(0, 10) === today) {
    return 'Agenda do dia';
  }

  return 'Em acompanhamento';
}

function groupCount(items, keySelector) {
  const map = new Map();

  items.forEach((item) => {
    const value = keySelector(item) || 'Não informado';
    map.set(value, (map.get(value) || 0) + 1);
  });

  return Array.from(map.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function buildBarData(rows, label, color = '#0b6f5f') {
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

function complaintProtocol(item) {
  if (item?.protocol) return item.protocol;
  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `GRC-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function npsProtocol(item) {
  if (item?.nps_protocol) return item.nps_protocol;
  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function stageWeight(stage) {
  const weights = {
    'Recuperação ativa': 0,
    'Primeiro atendimento': 1,
    'Agenda do dia': 2,
    'Em acompanhamento': 3,
    'Retorno final': 4,
    'Relacionamento': 5,
    'Promotor': 6,
    'Encerrado': 7,
    'Cancelado': 8
  };

  return weights[stage] ?? 99;
}

function buildLastActor(source, item) {
  if (source === 'Reclamação') {
    return item?.patient_contacted_by
      || item?.treatment_by_name
      || item?.first_attendance_by
      || item?.assigned_coordinator_name
      || item?.coordinator_name
      || 'Sem responsável';
  }

  if (source === 'NPS') {
    const logs = Array.isArray(item?.logs) ? item.logs : [];

    return item?.nps_treatment_by
      || item?.coordinator_name
      || logs[logs.length - 1]?.actor_name
      || 'Sem responsável';
  }

  const history = Array.isArray(item?.history) ? item.history : [];

  return item?.lastActorName
    || history[history.length - 1]?.actor_name
    || 'Sem responsável';
}

function buildRecords(complaints, npsRows, patientRows, clinics) {
  const clinicMap = new Map(
    (Array.isArray(clinics) ? clinics : [])
      .filter((clinic) => clinic?.name)
      .map((clinic) => [clinic.name, clinic])
  );

  const complaintRecords = (Array.isArray(complaints) ? complaints : []).map((item) => {
    const clinic = clinicMap.get(item.clinic_name) || {};

    return {
      id: `complaint-${item.id}`,
      rawId: item.id,
      source: 'Reclamação',
      protocol: complaintProtocol(item),
      patientName: item.patient_name || 'Paciente não informado',
      phone: item.patient_phone || '',
      clinicName: item.clinic_name || 'Unidade não informada',
      coordinatorName: item.assigned_coordinator_name || item.coordinator_name || clinic.coordinator_name || 'Não vinculado',
      stage: complaintStage(item),
      lastInteractionAt: item.updated_at || item.patient_contacted_at || item.treatment_at || item.created_at,
      lastActor: buildLastActor('Reclamação', item),
      summary: item.description || item.complaint_type || 'Sem descrição detalhada.',
      priority: item.priority || 'media',
      nextAction: item.status === 'resolvida'
        ? 'Protocolo encerrado'
        : item.patient_contacted_at
          ? 'Validar fechamento pelo SAC'
          : item.treatment_at
            ? 'Dar retorno ao paciente'
            : 'Registrar primeira tratativa',
      link: `/gestao/${item.id}`
    };
  });

  const npsRecords = (Array.isArray(npsRows) ? npsRows : []).map((item) => {
    const clinic = clinicMap.get(item.clinic_name) || {};
    const profile = profileFromScore(item.score);

    return {
      id: `nps-${item.id}`,
      rawId: item.id,
      source: 'NPS',
      protocol: npsProtocol(item),
      patientName: item.patient_name || 'Paciente não informado',
      phone: item.patient_phone || '',
      clinicName: item.clinic_name || 'Unidade não informada',
      coordinatorName: item.coordinator_name || clinic.coordinator_name || 'Não vinculado',
      stage: npsStage(item),
      lastInteractionAt: item.nps_treatment_at || item.updated_at || item.created_at,
      lastActor: buildLastActor('NPS', item),
      summary: item.detractor_feedback || item.improvement_comment || item.comment || `Perfil ${profile}`,
      priority: profile === 'Detrator' ? 'alta' : profile === 'Neutro' ? 'media' : 'baixa',
      nextAction: item.nps_status === 'tratado'
        ? 'Registro concluído'
        : profile === 'Detrator'
          ? 'Executar recuperação do cliente'
          : profile === 'Promotor'
            ? 'Fortalecer relacionamento'
            : 'Acompanhar percepção',
      link: `/gestao-nps?abrir=${item.id}`
    };
  });

  const patientRecords = (Array.isArray(patientRows) ? patientRows : []).map((item) => {
    const clinic = clinicMap.get(item.clinic) || {};

    return {
      id: `patient-${item.id}`,
      rawId: item.id,
      source: 'Paciente',
      protocol: item.protocol || `PAC-${String(item.id || 0).padStart(6, '0')}`,
      patientName: item.patient || 'Paciente não informado',
      phone: item.phone || '',
      clinicName: item.clinic || 'Unidade não informada',
      coordinatorName: clinic.coordinator_name || 'Não vinculado',
      stage: patientStage(item),
      lastInteractionAt: item.updatedAt || item.createdAt || item.scheduledAt,
      lastActor: buildLastActor('Paciente', item),
      summary: item.note || item.status || 'Sem observação detalhada.',
      priority: item.status === 'Cancelado' ? 'baixa' : 'media',
      nextAction: item.status === 'Cancelado'
        ? 'Registro cancelado'
        : item.scheduledAt
          ? `Agenda em ${formatDateTime(item.scheduledAt)}`
          : 'Acompanhar contato',
      link: `/pacientes?abrir=${item.id}`
    };
  });

  return [...complaintRecords, ...npsRecords, ...patientRecords];
}

function CrmWorkspace() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  const loadCrm = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [complaintsRes, npsRes, patientsRes, clinicsRes] = await Promise.all([
        api.get('/complaints'),
        api.get('/nps/responses'),
        api.get('/patient-interactions'),
        api.get('/clinics')
      ]);

      const nextClinics = Array.isArray(clinicsRes.data) ? clinicsRes.data : [];
      setClinics(nextClinics);
      setRecords(buildRecords(complaintsRes.data, npsRes.data, patientsRes.data, nextClinics));
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o CRM.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCrm();
  }, [loadCrm]);

  const filterOptions = useMemo(() => ({
    clinics: uniqueList([...records.map((item) => item.clinicName), ...clinics.map((clinic) => clinic.name)]),
    sources: uniqueList(records.map((item) => item.source)),
    stages: uniqueList(records.map((item) => item.stage)),
    coordinators: uniqueList([...records.map((item) => item.coordinatorName), ...clinics.map((clinic) => clinic.coordinator_name)])
  }), [records, clinics]);

  const filteredRecords = useMemo(() => records
    .filter((item) => {
      const searchable = [
        item.protocol,
        item.patientName,
        item.phone,
        item.clinicName,
        item.coordinatorName,
        item.summary,
        item.nextAction,
        item.source,
        item.stage
      ].map(normalizeText).join(' ');

      return (
        (!filters.search || searchable.includes(normalizeText(filters.search)))
        && (!filters.clinic || item.clinicName === filters.clinic)
        && (!filters.source || item.source === filters.source)
        && (!filters.stage || item.stage === filters.stage)
        && (!filters.coordinator || item.coordinatorName === filters.coordinator)
      );
    })
    .slice()
    .sort((a, b) => {
      const stageDiff = stageWeight(a.stage) - stageWeight(b.stage);
      if (stageDiff !== 0) return stageDiff;
      return new Date(b.lastInteractionAt || 0) - new Date(a.lastInteractionAt || 0);
    }), [records, filters]);

  const metrics = useMemo(() => {
    const total = filteredRecords.length;
    const activeRecovery = filteredRecords.filter((item) => item.stage === 'Recuperação ativa').length;
    const firstAttendance = filteredRecords.filter((item) => item.stage === 'Primeiro atendimento').length;
    const todayAgenda = filteredRecords.filter((item) => item.stage === 'Agenda do dia').length;
    const closed = filteredRecords.filter((item) => item.stage === 'Encerrado').length;
    const highPriority = filteredRecords.filter((item) => item.priority === 'alta').length;

    return { total, activeRecovery, firstAttendance, todayAgenda, closed, highPriority };
  }, [filteredRecords]);

  const stageHighlights = useMemo(() => ([
    {
      label: 'Recuperação ativa',
      total: metrics.activeRecovery,
      detail: 'Clientes que exigem ação imediata de retenção.',
      tone: 'danger'
    },
    {
      label: 'Primeiro atendimento',
      total: metrics.firstAttendance,
      detail: 'Relacionamentos aguardando abordagem inicial.',
      tone: 'warning'
    },
    {
      label: 'Agenda do dia',
      total: metrics.todayAgenda,
      detail: 'Interações com compromisso operacional no dia.',
      tone: 'teal'
    },
    {
      label: 'Encerrado',
      total: metrics.closed,
      detail: 'Históricos concluídos e preservados para consulta.',
      tone: 'leaf'
    }
  ]), [metrics]);

  const bySource = useMemo(() => groupCount(filteredRecords, (item) => item.source), [filteredRecords]);
  const byClinic = useMemo(() => groupCount(filteredRecords, (item) => item.clinicName).slice(0, 8), [filteredRecords]);
  const byStage = useMemo(() => groupCount(filteredRecords, (item) => item.stage), [filteredRecords]);
  const byCoordinator = useMemo(() => groupCount(filteredRecords, (item) => item.coordinatorName).slice(0, 8), [filteredRecords]);

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">CRM</p>
          <h1>CRM de Relacionamento</h1>
          <p>Consolide reclamações, NPS e agenda do paciente em uma visão única para retenção, acompanhamento e priorização comercial.</p>
        </div>

        <div className="heading-actions crm-heading-actions">
          <button className="outline-action" onClick={() => navigate('/gestao')}>Painel de Gestão</button>
          <button className="outline-action" onClick={() => navigate('/pacientes')}>Gestão do Paciente</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="dashboard-filter-panel crm-filter-panel">
        <div className="dashboard-filter-heading">
          <div>
            <p className="eyebrow">Carteira ativa</p>
            <h2>Base estratégica do relacionamento</h2>
            <p className="base-subtitle">Filtre por unidade, origem, estágio e coordenador para acompanhar a carteira operacional e comercial.</p>
          </div>
          <div className="heading-actions crm-filter-actions">
            <button className="outline-action" onClick={() => setFilters(initialFilters)}>
              Limpar filtros
            </button>
            <button className="outline-action" onClick={loadCrm}>
              Atualizar CRM
            </button>
          </div>
        </div>

        <div className="dashboard-filters">
          <input
            className="field"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder="Buscar protocolo, cliente, clínica, coordenador ou observação"
          />
          <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
            <option value="">Todas as unidades</option>
            {filterOptions.clinics.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="field" value={filters.source} onChange={(event) => updateFilter('source', event.target.value)}>
            <option value="">Todas as origens</option>
            {filterOptions.sources.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="field" value={filters.stage} onChange={(event) => updateFilter('stage', event.target.value)}>
            <option value="">Todos os estágios</option>
            {filterOptions.stages.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="field" value={filters.coordinator} onChange={(event) => updateFilter('coordinator', event.target.value)}>
            <option value="">Todos os coordenadores</option>
            {filterOptions.coordinators.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
      </section>

      {feedback && <p className="form-feedback page-form-feedback">{feedback}</p>}

      <section className="kpi-grid crm-kpi-grid" aria-label="Resumo do CRM">
        <article className="kpi-card">
          <span>Carteira</span>
          <strong>{metrics.total}</strong>
          <p>REGISTROS CONSOLIDADOS</p>
        </article>
        <article className="kpi-card danger">
          <span>Recuperação</span>
          <strong>{metrics.activeRecovery}</strong>
          <p>CASOS CRÍTICOS</p>
        </article>
        <article className="kpi-card warning">
          <span>Primeiro contato</span>
          <strong>{metrics.firstAttendance}</strong>
          <p>ABORDAGENS PENDENTES</p>
        </article>
        <article className="kpi-card progress">
          <span>Agenda do dia</span>
          <strong>{metrics.todayAgenda}</strong>
          <p>ATENDIMENTOS PROGRAMADOS</p>
        </article>
        <article className="kpi-card success">
          <span>Encerrados</span>
          <strong>{metrics.closed}</strong>
          <p>HISTÓRICOS CONCLUÍDOS</p>
        </article>
        <article className="kpi-card">
          <span>Alta prioridade</span>
          <strong>{metrics.highPriority}</strong>
          <p>TRATATIVAS SENSÍVEIS</p>
        </article>
      </section>

      <section className="crm-stage-grid" aria-label="Estágios do CRM">
        {stageHighlights.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`crm-stage-card ${item.tone} ${filters.stage === item.label ? 'active' : ''}`}
            onClick={() => updateFilter('stage', filters.stage === item.label ? '' : item.label)}
          >
            <span>{item.label}</span>
            <strong>{item.total}</strong>
            <p>{item.detail}</p>
          </button>
        ))}
      </section>

      {loading ? (
        <section className="management-panel">
          <p className="empty-state">Carregando CRM de relacionamento...</p>
        </section>
      ) : (
        <>
          <section className="chart-grid crm-chart-grid">
            <article className="chart-card">
              <h2>Origem da carteira</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(bySource)} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Estágio do relacionamento</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byStage)} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Volume por unidade</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byClinic, 'Relacionamentos', '#d08c31')} options={chartOptions} />
              </div>
            </article>
            <article className="chart-card">
              <h2>Carteira por coordenador</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byCoordinator, 'Relacionamentos', '#1f7a8c')} options={chartOptions} />
              </div>
            </article>
          </section>

          <section className="management-panel crm-base-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Carteira detalhada</p>
                <h2>Fila operacional e comercial</h2>
                <p className="base-subtitle">Exibindo {filteredRecords.length} registros priorizados para acompanhamento.</p>
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <p className="empty-state">Nenhum registro encontrado para os filtros atuais.</p>
            ) : (
              <div className="data-table-wrap dashboard-table-wrap">
                <table className="data-table dashboard-clean-table crm-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Origem</th>
                      <th>Protocolo</th>
                      <th>Clínica</th>
                      <th>Coordenador</th>
                      <th>Estágio</th>
                      <th>Última interação</th>
                      <th>Responsável</th>
                      <th>Próxima ação</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.slice(0, 50).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="crm-person-cell">
                            <strong>{item.patientName}</strong>
                            <small>{item.phone || 'Telefone não informado'}</small>
                          </div>
                        </td>
                        <td>{item.source}</td>
                        <td>{item.protocol}</td>
                        <td>{item.clinicName}</td>
                        <td>{item.coordinatorName}</td>
                        <td><span className={`crm-stage-pill ${normalizeText(item.stage).replace(/\s+/g, '-')}`}>{item.stage}</span></td>
                        <td>{formatDateTime(item.lastInteractionAt)}</td>
                        <td>{item.lastActor}</td>
                        <td>{item.nextAction}</td>
                        <td>
                          <button className="outline-action compact-action" onClick={() => navigate(item.link)}>
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default CrmWorkspace;
