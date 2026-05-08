import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import {
  complaintTypes,
  isMasterAdmin,
  priorityOptions,
  readUser,
  statusLabels,
  statusOptions
} from './constants';

const pageSizeOptions = [10, 25, 50, 100];

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function formatProtocol(item) {
  if (item.protocol) return item.protocol;
  const year = item.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `GRC-${year}-${String(item.id).padStart(6, '0')}`;
}

function formatShortDate(value) {
  if (!value) return 'Sem prazo';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatFullDateTime(value) {
  if (!value) return 'Nao informado';
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Nao informado';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatCurrency(value) {
  const number = Number(value || 0);

  if (!number) return 'Sem valor';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(number);
}

function priorityLabel(value) {
  return priorityOptions.find((option) => option.value === value)?.label || 'Média';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function daysSince(value) {
  if (!value) return 0;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 0;

  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function buildDeadlineInfo(item) {
  if (item.status === 'resolvida') {
    return {
      state: 'closed',
      label: 'Fechada',
      detail: item.closed_at ? formatShortDate(item.closed_at) : 'Sem data'
    };
  }

  const dueAt = item.due_at ? new Date(item.due_at) : null;

  if (!dueAt || Number.isNaN(dueAt.getTime())) {
    return {
      state: 'neutral',
      label: 'Sem SLA',
      detail: 'Sem prazo'
    };
  }

  const diffMs = dueAt.getTime() - Date.now();
  const hours = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60));

  if (diffMs < 0) {
    return {
      state: 'overdue',
      label: 'Vencida',
      detail: `${hours}h em atraso`
    };
  }

  if (diffMs <= 12 * 60 * 60 * 1000) {
    return {
      state: 'warning',
      label: 'Perto de vencer',
      detail: `Restam ${Math.max(hours, 1)}h`
    };
  }

  return {
    state: 'ontime',
    label: 'No prazo',
    detail: `Vence ${formatShortDate(item.due_at)}`
  };
}

function deadlineRank(item) {
  const deadline = buildDeadlineInfo(item);

  if (deadline.state === 'overdue') return 0;
  if (deadline.state === 'warning') return 1;
  if (deadline.state === 'ontime') return 2;
  if (deadline.state === 'neutral') return 3;
  return 4;
}

function buildOperationalStage(item) {
  if (item.status === 'resolvida') {
    return {
      owner: 'protocolo encerrado',
      label: 'Fechada pelo SAC',
      since: item.closed_at || item.updated_at || item.created_at
    };
  }

  if (!item.treatment_at) {
    return {
      owner: 'coordenador, gerente ou Supervisor CRC',
      label: 'Aguardando tratativa da gestão',
      since: item.created_at
    };
  }

  if (item.priority === 'alta' && !item.supervisor_approval_at) {
    return {
      owner: 'Supervisor do CRC',
      label: 'Aguardando aceite de prioridade alta',
      since: item.treatment_at
    };
  }

  if (!item.patient_contacted_at) {
    return {
      owner: 'Operador de SAC',
      label: 'Aguardando contato com paciente',
      since: item.supervisor_approval_at || item.treatment_at
    };
  }

  return {
    owner: 'Operador de SAC',
    label: 'Aguardando fechamento do protocolo',
    since: item.patient_contacted_at
  };
}

function buildTreatmentBalloon(item) {
  if (!item?.treatment_at) {
    return null;
  }

  const summary = String(item.operator_comment || item.treatment_comment || '').trim() || 'Tratativa registrada sem resumo descritivo.';
  const actor = item.treatment_by_name || item.treatment_by_role || 'Usuário não informado';
  const date = formatFullDateTime(item.treatment_at);

  return { summary, actor, date };
}

function ComplaintListItem({ item, onOpen }) {
  const deadline = buildDeadlineInfo(item);
  const stage = buildOperationalStage(item);
  const stoppedDays = daysSince(stage.since);
  const isDeleted = Boolean(item.deleted_at);
  const treatmentBalloon = buildTreatmentBalloon(item);

  return (
    <button
      type="button"
      className={`complaint-list-item deadline-${deadline.state}`}
      onClick={onOpen}
    >
      <div className="complaint-list-main">
        <div className="complaint-list-title">
          <span className={`status-pill ${item.status || 'aberta'}`}>
            {statusLabels[item.status] || 'Aberta'}
          </span>
          <strong>{formatProtocol(item)}</strong>
        </div>
        <div>
          <span className="person-label">Paciente</span>
          <h3>{item.patient_name || 'Paciente não informado'}</h3>
          <p>{item.clinic_name || 'Clínica não informada'} · {item.city || 'Cidade'} / {item.state || 'UF'}</p>
        </div>
      </div>

      <div className="complaint-list-meta">
        <span>{item.complaint_type || 'Tipo não informado'}</span>
        <span>{item.channel || 'Canal não informado'}</span>
        <span>Origem {item.created_origin || 'Interno'}</span>
        <span>Prioridade {priorityLabel(item.priority)}</span>
        {Boolean(item.financial_involved) && <span>Financeiro {formatCurrency(item.financial_amount)}</span>}
        <span>{item.region || 'Região não informada'}</span>
      </div>

      <div className="operational-flow">
        {isDeleted ? (
          <>
            <span className="deadline-chip closed">
              Excluído em {formatShortDate(item.deleted_at)}
            </span>
            <span className="stage-chip">
              Excluído por {item.deleted_by || 'Usuário não informado'}
            </span>
            <small>{item.deletion_reason || 'Sem motivo informado.'}</small>
          </>
        ) : (
          <>
            <span className={`deadline-chip ${deadline.state}`}>
              {deadline.label} · {deadline.detail}
            </span>
            <span className="stage-chip">
              Parada com {stage.owner} há {stoppedDays} {stoppedDays === 1 ? 'dia' : 'dias'}
            </span>
            <small>{stage.label}</small>
            {treatmentBalloon && (
              <span
                className="treatment-balloon-trigger"
                tabIndex={0}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              >
                Última tratativa
                <span className="treatment-balloon">
                  <strong>Resumo tratado</strong>
                  <span>{treatmentBalloon.summary}</span>
                  <small>Por {treatmentBalloon.actor}</small>
                  <small>Em {treatmentBalloon.date}</small>
                </span>
              </span>
            )}
          </>
        )}
      </div>

      <span className="list-arrow">{isDeleted ? 'Consultar' : 'Abrir'}</span>
    </button>
  );
}

function DashboardManagement() {
  const navigate = useNavigate();
  const currentUser = readUser();
  const canViewDeleted = isMasterAdmin(currentUser);
  const [complaints, setComplaints] = useState([]);
  const [viewMode, setViewMode] = useState('active');
  const [filters, setFilters] = useState({
    status: '',
    type: '',
    sla: '',
    clinic: '',
    search: ''
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const loadComplaints = async () => {
      setLoading(true);
      setFeedback('');

      try {
        const res = await api.get('/complaints', {
          params: canViewDeleted ? { include_deleted: 1 } : undefined
        });
        setComplaints(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        setFeedback('Não foi possível carregar os protocolos.');
      } finally {
        setLoading(false);
      }
    };

    loadComplaints();
  }, [canViewDeleted]);

  useEffect(() => {
    if (!canViewDeleted && viewMode === 'deleted') {
      setViewMode('active');
    }
  }, [canViewDeleted, viewMode]);

  useEffect(() => {
    setPage(1);
  }, [filters, viewMode, pageSize]);

  const operationalComplaints = useMemo(() => complaints.filter((item) => !item.deleted_at), [complaints]);
  const activeComplaints = useMemo(() => (
    operationalComplaints.filter((item) => item.status !== 'resolvida')
  ), [operationalComplaints]);
  const finishedComplaints = useMemo(() => (
    operationalComplaints.filter((item) => item.status === 'resolvida')
  ), [operationalComplaints]);
  const deletedComplaints = useMemo(() => complaints.filter((item) => item.deleted_at), [complaints]);
  const scopedComplaints = useMemo(() => {
    if (viewMode === 'finished') return finishedComplaints;
    if (viewMode === 'deleted' && canViewDeleted) return deletedComplaints;
    return activeComplaints;
  }, [activeComplaints, canViewDeleted, deletedComplaints, finishedComplaints, viewMode]);

  const filteredComplaints = useMemo(() => scopedComplaints.filter((item) => {
    const matchesStatus = !filters.status || item.status === filters.status;
    const matchesType = !filters.type || item.complaint_type === filters.type;
    const matchesClinic = !filters.clinic || item.clinic_name === filters.clinic;
    const deadline = buildDeadlineInfo(item);
    const matchesSla = !filters.sla || deadline.state === filters.sla;
    const searchable = [
      item.protocol,
      item.patient_name,
      item.patient_phone,
      item.description,
      item.clinic_name,
      item.city,
      item.state,
      item.region
    ].map(normalizeText).join(' ');
    const matchesSearch = !filters.search || searchable.includes(normalizeText(filters.search));

    return matchesStatus && matchesType && matchesClinic && matchesSla && matchesSearch;
  }).sort((a, b) => {
    const rankDiff = deadlineRank(a) - deadlineRank(b);

    if (rankDiff !== 0) return rankDiff;

    const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;

    if (aDue !== bDue) return aDue - bDue;

    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  }), [filters, scopedComplaints]);

  const clinicOptions = useMemo(() => (
    Array.from(new Set(complaints.map((item) => item.clinic_name).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
  ), [complaints]);

  const metrics = useMemo(() => {
    const total = operationalComplaints.length;
    const open = activeComplaints.filter((item) => item.status === 'aberta').length;
    const inProgress = activeComplaints.filter((item) => item.status === 'em_andamento').length;
    const resolved = finishedComplaints.length;
    const overdue = activeComplaints.filter((item) => buildDeadlineInfo(item).state === 'overdue').length;
    const warning = activeComplaints.filter((item) => buildDeadlineInfo(item).state === 'warning').length;
    return { total, open, inProgress, resolved, overdue, warning };
  }, [activeComplaints, finishedComplaints, operationalComplaints]);

  const applyQuickFilter = (nextViewMode, nextFilters = {}) => {
    setViewMode(nextViewMode);
    setFilters((prev) => ({
      ...prev,
      status: '',
      type: '',
      sla: '',
      clinic: prev.clinic,
      search: prev.search,
      ...nextFilters
    }));
  };

  const totalPages = Math.max(1, Math.ceil(filteredComplaints.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedComplaints = filteredComplaints.slice(pageStart, pageStart + pageSize);
  const summaryRows = useMemo(() => filteredComplaints.map((item) => {
    const deadline = buildDeadlineInfo(item);
    const stage = buildOperationalStage(item);

    return {
      protocolo: formatProtocol(item),
      paciente: item.patient_name || 'Não informado',
      data_cadastro: formatFullDateTime(item.created_at),
      clinica: item.clinic_name || 'Não informado',
      cidade: item.city || 'Não informado',
      estado: item.state || 'Não informado',
      regiao: item.region || 'Não informado',
      coordenador_responsavel: item.coordinator_name || 'Não informado',
      gerente_responsavel: item.manager_name || 'Não informado',
      tipo: item.complaint_type || 'Não informado',
      origem: item.created_origin || 'Interno',
      status: statusLabels[item.status] || item.status || 'Aberta',
      prioridade: priorityLabel(item.priority),
      financeiro: item.financial_involved ? 'Sim' : 'Não',
      valor_financeiro: item.financial_involved ? formatCurrency(item.financial_amount) : 'Não envolve',
      sla: `${deadline.label} - ${deadline.detail}`,
      parado_com: stage.owner,
      dias_parado: daysSince(stage.since),
      cadastro: formatShortDate(item.created_at)
    };
  }), [filteredComplaints]);

  const exportSyntheticExcel = () => {
    const headers = Object.keys(summaryRows[0] || {
      protocolo: '',
      paciente: '',
      data_cadastro: '',
      clinica: '',
      cidade: '',
      estado: '',
      regiao: '',
      coordenador_responsavel: '',
      gerente_responsavel: '',
      tipo: '',
      origem: '',
      status: '',
      prioridade: '',
      financeiro: '',
      valor_financeiro: '',
      sla: '',
      parado_com: '',
      dias_parado: '',
      cadastro: ''
    });
    const html = `
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>
          ${summaryRows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-sintetico-protocolos-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportSyntheticPdf = () => {
    const printDate = new Date();
    const headers = [
      'Protocolo',
      'Data de cadastro',
      'Paciente',
      'Clínica',
      'Coordenador responsável',
      'Gerente responsável',
      'Origem',
      'Status',
      'Prioridade',
      'SLA',
      'Parado com'
    ];
    const rows = summaryRows.map((row) => [
      row.protocolo,
      row.data_cadastro,
      row.paciente,
      row.clinica,
      row.coordenador_responsavel,
      row.gerente_responsavel,
      row.origem,
      row.status,
      row.prioridade,
      row.sla,
      row.parado_com
    ]);
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF.');
      return;
    }

    reportWindow.document.write(`
      <html>
        <head>
          <title>Relatório sintético de protocolos</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Inter, Arial, sans-serif;
              color: #1f2937;
              background: #ffffff;
            }
            .report-shell {
              display: flex;
              flex-direction: column;
              gap: 18px;
            }
            .report-header {
              border: 1px solid #d9c4a0;
              border-radius: 14px;
              background: linear-gradient(135deg, #fffaf2 0%, #f6eddd 100%);
              padding: 20px 24px;
            }
            .report-header-top {
              display: flex;
              justify-content: space-between;
              gap: 24px;
              align-items: flex-start;
            }
            .report-kicker {
              margin: 0 0 8px;
              color: #9a6b22;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            h1 {
              margin: 0 0 6px;
              font-size: 26px;
              line-height: 1.12;
              color: #111827;
            }
            .report-subtitle {
              margin: 0;
              color: #5b6472;
              font-size: 13px;
            }
            .report-meta {
              min-width: 250px;
              border: 1px solid #e6d6bd;
              border-radius: 12px;
              background: rgba(255, 255, 255, 0.9);
              padding: 14px 16px;
            }
            .report-meta strong,
            .summary-card strong {
              display: block;
              margin-bottom: 4px;
              color: #8a632d;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            .report-meta span,
            .summary-card span {
              display: block;
              color: #111827;
              font-size: 14px;
              font-weight: 700;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 12px;
            }
            .summary-card {
              border: 1px solid #e5e7eb;
              border-radius: 12px;
              background: #ffffff;
              padding: 14px 16px;
            }
            .report-table-wrap {
              border: 1px solid #e5e7eb;
              border-radius: 14px;
              overflow: hidden;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              font-size: 10px;
            }
            thead th {
              background: #132238;
              color: #f8fafc;
              padding: 10px 8px;
              text-align: left;
              font-size: 9px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            tbody td {
              border-top: 1px solid #e5e7eb;
              padding: 9px 8px;
              vertical-align: top;
              color: #1f2937;
              word-break: break-word;
            }
            tbody tr:nth-child(even) td {
              background: #faf7f2;
            }
            .report-footer {
              display: flex;
              justify-content: space-between;
              gap: 18px;
              color: #6b7280;
              font-size: 11px;
            }
          </style>
        </head>
        <body>
          <main class="report-shell">
            <section class="report-header">
              <div class="report-header-top">
                <div>
                  <p class="report-kicker">Grupo Sorria · Gestão de Reclamações</p>
                  <h1>Relatório sintético de protocolos</h1>
                  <p class="report-subtitle">Visão consolidada para acompanhamento executivo das reclamações filtradas no painel.</p>
                </div>
                <div class="report-meta">
                  <strong>Emitido em</strong>
                  <span>${escapeHtml(printDate.toLocaleString('pt-BR'))}</span>
                </div>
              </div>
            </section>

            <section class="summary-grid">
              <article class="summary-card">
                <strong>Total de registros</strong>
                <span>${escapeHtml(String(summaryRows.length))}</span>
              </article>
              <article class="summary-card">
                <strong>Status da visão</strong>
                <span>${escapeHtml(viewMode === 'deleted' ? 'Excluídos' : viewMode === 'finished' ? 'Finalizados' : 'Ativos')}</span>
              </article>
              <article class="summary-card">
                <strong>Filtro textual</strong>
                <span>${escapeHtml(filters.search || 'Sem filtro textual')}</span>
              </article>
              <article class="summary-card">
                <strong>Clínica filtrada</strong>
                <span>${escapeHtml(filters.clinic || 'Todas as unidades')}</span>
              </article>
            </section>

            <section class="report-table-wrap">
              <table>
                <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
            </section>

            <footer class="report-footer">
              <span>O relatório destaca a data inicial do cadastro da reclamação no sistema, além do coordenador e do gerente responsáveis pela unidade.</span>
              <span>Documento gerado automaticamente pelo sistema.</span>
            </footer>
          </main>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Gestão de reclamações</p>
          <h1>Painel de Gestão de Reclamações</h1>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      <section className="kpi-grid management-kpi-grid" aria-label="Resumo operacional">
        <button type="button" className="kpi-card kpi-button" onClick={() => applyQuickFilter('active')}>
          <span>Total</span>
          <strong>{metrics.total}</strong>
          <p>PROTOCOLOS REGISTRADOS</p>
        </button>
        <button type="button" className="kpi-card warning kpi-button" onClick={() => applyQuickFilter('active', { status: 'aberta' })}>
          <span>Abertas</span>
          <strong>{metrics.open}</strong>
          <p>AGUARDANDO TRATATIVA</p>
        </button>
        <button type="button" className="kpi-card progress kpi-button" onClick={() => applyQuickFilter('active', { status: 'em_andamento' })}>
          <span>Em andamento</span>
          <strong>{metrics.inProgress}</strong>
          <p>COM ACOMPANHAMENTO</p>
        </button>
        <button type="button" className="kpi-card danger kpi-button" onClick={() => applyQuickFilter('active', { sla: 'overdue' })}>
          <span>Vencidas</span>
          <strong>{metrics.overdue}</strong>
          <p>FORA DO SLA</p>
        </button>
        <button type="button" className="kpi-card warning kpi-button" onClick={() => applyQuickFilter('active', { sla: 'warning' })}>
          <span>Perto de vencer</span>
          <strong>{metrics.warning}</strong>
          <p>RETORNO CRÍTICO</p>
        </button>
        <button type="button" className="kpi-card success kpi-button" onClick={() => applyQuickFilter('finished')}>
          <span>Fechadas</span>
          <strong>{metrics.resolved}</strong>
          <p>PROTOCOLOS ENCERRADOS</p>
        </button>
      </section>

      <section className="management-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Protocolos</p>
            <h2>
              {viewMode === 'deleted'
                ? 'Protocolos excluídos com auditoria'
                : viewMode === 'finished'
                  ? 'Protocolos finalizados'
                  : 'Lista priorizada para tratativa'}
            </h2>
          </div>

          <div className="export-actions">
            <button className="outline-action" onClick={exportSyntheticExcel} disabled={!filteredComplaints.length}>
              <span className="export-badge excel">XLS</span>
              <span>Baixar Excel</span>
            </button>
            <button className="outline-action" onClick={exportSyntheticPdf} disabled={!filteredComplaints.length}>
              <span className="export-badge pdf">PDF</span>
              <span>Baixar PDF</span>
            </button>
          </div>

          <div className="patient-tabs" role="tablist" aria-label="Visões da gestão de reclamações">
            <button
              type="button"
              className={viewMode === 'active' ? 'active' : ''}
              onClick={() => setViewMode('active')}
            >
              Ativos ({activeComplaints.length})
            </button>
            <button
              type="button"
              className={viewMode === 'finished' ? 'active' : ''}
              onClick={() => setViewMode('finished')}
            >
              Finalizados ({finishedComplaints.length})
            </button>
            {canViewDeleted && (
              <button
                type="button"
                className={viewMode === 'deleted' ? 'active' : ''}
                onClick={() => setViewMode('deleted')}
              >
                Excluídos ({deletedComplaints.length})
              </button>
            )}
          </div>

          <div className="filters management-filters">
            <input
              className="field"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              placeholder="Buscar protocolo, paciente, clínica ou descrição"
            />
            <select
              className="field"
              value={filters.clinic}
              onChange={(event) => setFilters({ ...filters, clinic: event.target.value })}
            >
              <option value="">Todas as unidades</option>
              {clinicOptions.map((clinic) => (
                <option key={clinic} value={clinic}>{clinic}</option>
              ))}
            </select>
            <select
              className="field"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">Todos os status</option>
              {statusOptions.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            <select
              className="field"
              value={filters.sla}
              onChange={(event) => setFilters({ ...filters, sla: event.target.value })}
            >
              <option value="">Todos os prazos</option>
              <option value="overdue">Vencidas</option>
              <option value="warning">Perto de vencer</option>
              <option value="ontime">No prazo</option>
              <option value="closed">Fechadas</option>
            </select>
            <select
              className="field"
              value={filters.type}
              onChange={(event) => setFilters({ ...filters, type: event.target.value })}
            >
              <option value="">Todos os tipos</option>
              {complaintTypes.map((type) => (
                <option key={type.value} value={type.label}>{type.label}</option>
              ))}
            </select>
          </div>
        </div>

        {feedback && <p className="form-feedback">{feedback}</p>}

        {loading ? (
          <p className="empty-state">Carregando protocolos...</p>
        ) : filteredComplaints.length === 0 ? (
          <p className="empty-state">Nenhum protocolo encontrado com os filtros atuais.</p>
        ) : (
          <>
            <div className="complaint-list management-list">
              {paginatedComplaints.map((item) => (
                <ComplaintListItem
                  item={item}
                  key={item.id}
                  onOpen={() => navigate(`/gestao/${item.id}`)}
                />
              ))}
            </div>

            <div className="pagination-bar">
              <div className="pagination-summary">
                <label className="pagination-page-size">
                  <span>Por página</span>
                  <select
                    className="field"
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value) || 10)}
                  >
                    {pageSizeOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <span>
                  Mostrando {pageStart + 1} a {Math.min(pageStart + pageSize, filteredComplaints.length)} de {filteredComplaints.length}
                </span>
              </div>
              <div className="pagination-actions">
                <button className="outline-action" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                  Anterior
                </button>
                <strong>Página {currentPage} de {totalPages}</strong>
                <button className="outline-action" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default DashboardManagement;
