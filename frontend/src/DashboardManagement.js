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

const pageSize = 50;

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

function ComplaintListItem({ item, onOpen }) {
  const deadline = buildDeadlineInfo(item);
  const stage = buildOperationalStage(item);
  const stoppedDays = daysSince(stage.since);
  const isDeleted = Boolean(item.deleted_at);

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
  }, [filters, viewMode]);

  const activeComplaints = useMemo(() => complaints.filter((item) => !item.deleted_at), [complaints]);
  const deletedComplaints = useMemo(() => complaints.filter((item) => item.deleted_at), [complaints]);
  const scopedComplaints = useMemo(() => (
    viewMode === 'deleted' && canViewDeleted ? deletedComplaints : activeComplaints
  ), [activeComplaints, canViewDeleted, deletedComplaints, viewMode]);

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
    const total = activeComplaints.length;
    const open = activeComplaints.filter((item) => item.status === 'aberta').length;
    const inProgress = activeComplaints.filter((item) => item.status === 'em_andamento').length;
    const resolved = activeComplaints.filter((item) => item.status === 'resolvida').length;
    const overdue = activeComplaints.filter((item) => buildDeadlineInfo(item).state === 'overdue').length;
    const warning = activeComplaints.filter((item) => buildDeadlineInfo(item).state === 'warning').length;
    return { total, open, inProgress, resolved, overdue, warning };
  }, [activeComplaints]);

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
      clinica: item.clinic_name || 'Não informado',
      cidade: item.city || 'Não informado',
      estado: item.state || 'Não informado',
      regiao: item.region || 'Não informado',
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
      clinica: '',
      cidade: '',
      estado: '',
      regiao: '',
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
    const headers = ['Protocolo', 'Paciente', 'Clínica', 'Origem', 'Status', 'Financeiro', 'Valor', 'SLA', 'Parado com', 'Dias'];
    const rows = summaryRows.map((row) => [
      row.protocolo,
      row.paciente,
      row.clinica,
      row.origem,
      row.status,
      row.financeiro,
      row.valor_financeiro,
      row.sla,
      row.parado_com,
      row.dias_parado
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
            body { font-family: Arial, sans-serif; color: #102033; padding: 24px; }
            h1 { margin: 0 0 6px; font-size: 22px; }
            p { margin: 0 0 18px; color: #64748b; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #d8e3df; padding: 7px; text-align: left; }
            th { background: #f4f8f6; }
          </style>
        </head>
        <body>
          <h1>Relatório sintético de protocolos</h1>
          <p>${summaryRows.length} registros filtrados em ${new Date().toLocaleString('pt-BR')}</p>
          <table>
            <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
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
        <article className="kpi-card">
          <span>Total</span>
          <strong>{metrics.total}</strong>
          <p>PROTOCOLOS REGISTRADOS</p>
        </article>
        <article className="kpi-card warning">
          <span>Abertas</span>
          <strong>{metrics.open}</strong>
          <p>AGUARDANDO TRATATIVA</p>
        </article>
        <article className="kpi-card progress">
          <span>Em andamento</span>
          <strong>{metrics.inProgress}</strong>
          <p>COM ACOMPANHAMENTO</p>
        </article>
        <article className="kpi-card danger">
          <span>Vencidas</span>
          <strong>{metrics.overdue}</strong>
          <p>FORA DO SLA</p>
        </article>
        <article className="kpi-card warning">
          <span>Perto de vencer</span>
          <strong>{metrics.warning}</strong>
          <p>RETORNO CRÍTICO</p>
        </article>
        <article className="kpi-card success">
          <span>Fechadas</span>
          <strong>{metrics.resolved}</strong>
          <p>PROTOCOLOS ENCERRADOS</p>
        </article>
      </section>

      <section className="management-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Protocolos</p>
            <h2>{viewMode === 'deleted' ? 'Protocolos excluídos com auditoria' : 'Lista priorizada para tratativa'}</h2>
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

          {canViewDeleted && (
            <div className="patient-tabs" role="tablist" aria-label="Visões da gestão de reclamações">
              <button
                type="button"
                className={viewMode === 'active' ? 'active' : ''}
                onClick={() => setViewMode('active')}
              >
                Ativos
              </button>
              <button
                type="button"
                className={viewMode === 'deleted' ? 'active' : ''}
                onClick={() => setViewMode('deleted')}
              >
                Excluídos
              </button>
            </div>
          )}

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
              <span>
                Mostrando {pageStart + 1} a {Math.min(pageStart + pageSize, filteredComplaints.length)} de {filteredComplaints.length}
              </span>
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
