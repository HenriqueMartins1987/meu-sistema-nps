import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from './api';
import { hasPermission, isMasterAdmin, normalizeRoleValue, readUser, statusLabels } from './constants';

const pageSizeOptions = [10, 25, 50, 100];
const closedComplaintStatuses = new Set([
  'cancelada',
  'cancelado',
  'encerrada',
  'encerrado',
  'fechada',
  'fechado',
  'finalizada',
  'finalizado',
  'resolvida'
]);

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toMonthInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseDateInputValue(value, fallback = new Date()) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parseMonthInputValue(value, fallback = new Date()) {
  const [year, month] = String(value || '').split('-').map((part) => Number(part));
  if (!year || !month) return fallback;
  const parsed = new Date(year, month - 1, 15, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function getWeekRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function formatWeekRangeLabel(start, end) {
  return `${new Intl.DateTimeFormat('pt-BR').format(start)} a ${new Intl.DateTimeFormat('pt-BR').format(end)}`;
}

function formatMonthRangeLabel(start) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(start);
}

function capitalizeLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function formatProtocol(item) {
  if (item.protocol) return item.protocol;
  const year = item.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `GRC-${year}-${String(item.id).padStart(6, '0')}`;
}

function formatFullDateTime(value) {
  if (!value) return 'Não informado';
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Não informado';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatShortText(value, maxLength = 180) {
  const text = String(value || '').trim();

  if (!text) return 'Não informado';
  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isWeeklyComplaintReportAllowed(user) {
  if (isMasterAdmin(user)) return true;

  return ['admin', 'supervisor_crc', 'sac_operator', 'manager'].includes(normalizeRoleValue(user?.role));
}

function getWeeklyProfessionalLabel(item) {
  if (item.service_type_other) {
    return `${item.service_type || 'Outros'}: ${item.service_type_other}`;
  }

  return (
    item.service_type
    || item.assigned_responsible_name
    || item.coordinator_name
    || item.manager_name
    || 'Não informado'
  );
}

function getWeeklyReasonLabel(item) {
  if (item.complaint_type_other) {
    return formatShortText(`${item.complaint_type || 'Outros'}: ${item.complaint_type_other}`);
  }

  return formatShortText(item.description || item.complaint_type || 'Não informado');
}

function getCurrentResponsibleLabel(item) {
  return (
    item.assigned_responsible_name
    || item.assigned_coordinator_name
    || item.coordinator_name
    || item.manager_name
    || 'Não informado'
  );
}

function isComplaintClosedStatus(status) {
  return closedComplaintStatuses.has(String(status || '').trim().toLowerCase());
}

function getComplaintStatusLabel(item) {
  return statusLabels[item.status] || item.status || 'Aberta';
}

function getComplaintStatusTone(item) {
  if (isComplaintClosedStatus(item.status)) return 'closed';

  const deadlineState = deadlineTone(item);
  if (deadlineState === 'overdue') return 'overdue';
  if (deadlineState === 'warning') return 'warning';
  return 'active';
}

function deadlineTone(item) {
  if (isComplaintClosedStatus(item.status)) return 'closed';
  if (!item.due_at) return 'neutral';

  const dueAt = new Date(item.due_at);
  if (Number.isNaN(dueAt.getTime())) return 'neutral';

  const diffMs = dueAt.getTime() - Date.now();
  if (diffMs < 0) return 'overdue';
  if (diffMs <= 24 * 60 * 60 * 1000) return 'warning';
  return 'ontime';
}

function buildTopLabel(items) {
  if (!items.length) return null;

  const counts = items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([label, total]) => ({ label, total }))[0];
}

function buildSummaryRows(items) {
  return items.map((item) => ({
    id: item.id,
    protocolo: formatProtocol(item),
    data_cadastro: formatFullDateTime(item.created_at),
    paciente: item.patient_name || 'Não informado',
    clinica: item.clinic_name || 'Não informado',
    responsavel_atual: getCurrentResponsibleLabel(item),
    profissional_envolvido: getWeeklyProfessionalLabel(item),
    motivo: getWeeklyReasonLabel(item),
    detalhe_motivo: item.complaint_type_other || '',
    detalhe_servico: item.service_type_other || '',
    status: getComplaintStatusLabel(item),
    status_tone: getComplaintStatusTone(item)
  }));
}

function buildHighlights(items) {
  const clinics = new Set();
  const professionals = new Set();
  const openCount = items.filter((item) => !isComplaintClosedStatus(item.status)).length;
  const resolvedCount = items.filter((item) => isComplaintClosedStatus(item.status)).length;
  const overdueCount = items.filter((item) => deadlineTone(item) === 'overdue').length;
  const topClinic = buildTopLabel(items.map((item) => item.clinic_name).filter(Boolean));
  const topReason = buildTopLabel(items.map((item) => (
    item.complaint_type_other
      ? `${item.complaint_type || 'Outros'}: ${item.complaint_type_other}`
      : item.complaint_type || item.description
  )).filter(Boolean));

  items.forEach((item) => {
    if (item.clinic_name) clinics.add(item.clinic_name);
    professionals.add(getWeeklyProfessionalLabel(item));
  });

  return {
    total: items.length,
    clinics: clinics.size,
    professionals: professionals.size,
    openCount,
    resolvedCount,
    overdueCount,
    topClinic,
    topReason
  };
}

function buildExcelHeaders(rows) {
  return Object.keys(rows[0] || {
    protocolo: '',
    data_cadastro: '',
    paciente: '',
    clinica: '',
    responsavel_atual: '',
    profissional_envolvido: '',
    motivo: '',
    status: ''
  });
}

function exportComplaintReportExcel(rows, filenamePrefix) {
  const headers = buildExcelHeaders(rows);
  const html = `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportComplaintReportPdf({
  title,
  subtitle,
  periodLabel,
  periodBadge,
  highlights,
  rows
}) {
  const printDate = new Date();
  const printableRows = rows.map((row) => [
    row.protocolo,
    row.data_cadastro,
    row.paciente,
    row.clinica,
    row.responsavel_atual,
    row.profissional_envolvido,
    row.motivo,
    row.status
  ]);
  const reportWindow = window.open('', '_blank');

  if (!reportWindow) {
    return false;
  }

  reportWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Inter, Arial, sans-serif; color: #1f2937; background: #ffffff; }
          .report-shell { display: flex; flex-direction: column; gap: 18px; }
          .report-header { border: 1px solid #d9c4a0; border-radius: 14px; background: linear-gradient(135deg, #fffaf2 0%, #f6eddd 100%); padding: 20px 24px; }
          .report-header-top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
          .report-kicker { margin: 0 0 8px; color: #9a6b22; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
          h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.12; color: #111827; }
          .report-subtitle { margin: 0; color: #5b6472; font-size: 13px; }
          .report-meta, .summary-card { border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; padding: 14px 16px; }
          .report-meta strong, .summary-card strong { display: block; margin-bottom: 4px; color: #8a632d; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
          .report-meta span, .summary-card span { display: block; color: #111827; font-size: 14px; font-weight: 700; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
          .report-table-wrap { border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
          thead th { background: #132238; color: #f8fafc; padding: 10px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
          tbody td { border-top: 1px solid #e5e7eb; padding: 9px 8px; vertical-align: top; color: #1f2937; word-break: break-word; }
          tbody tr:nth-child(even) td { background: #faf7f2; }
        </style>
      </head>
      <body>
        <main class="report-shell">
          <section class="report-header">
            <div class="report-header-top">
              <div>
                <p class="report-kicker">Grupo Sorria · Gestão de reclamações</p>
                <h1>${escapeHtml(title)}</h1>
                <p class="report-subtitle">${escapeHtml(subtitle)}</p>
              </div>
              <div class="report-meta">
                <strong>Emitido em</strong>
                <span>${escapeHtml(printDate.toLocaleString('pt-BR'))}</span>
              </div>
            </div>
          </section>
          <section class="summary-grid">
            <article class="summary-card">
              <strong>Demandas no período</strong>
              <span>${escapeHtml(String(highlights.total))}</span>
            </article>
            <article class="summary-card">
              <strong>Clínicas envolvidas</strong>
              <span>${escapeHtml(String(highlights.clinics))}</span>
            </article>
            <article class="summary-card">
              <strong>Frentes envolvidas</strong>
              <span>${escapeHtml(String(highlights.professionals))}</span>
            </article>
            <article class="summary-card">
              <strong>Janela analisada</strong>
              <span>${escapeHtml(periodBadge || periodLabel)}</span>
            </article>
          </section>
          <section class="report-meta">
            <strong>Período de referência</strong>
            <span>${escapeHtml(periodLabel)}</span>
          </section>
          <section class="report-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Protocolo</th>
                  <th>Data de cadastro</th>
                  <th>Paciente</th>
                  <th>Clínica</th>
                  <th>Responsável atual</th>
                  <th>Profissional envolvido</th>
                  <th>Motivo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${printableRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </section>
        </main>
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
  return true;
}

function ComplaintReportSection({
  eyebrow,
  title,
  description,
  filterLabel,
  filterValue,
  filterType = 'date',
  onFilterChange,
  periodDescription,
  highlights,
  rows,
  loading,
  emptyLabel,
  rowContextLabel,
  exportExcel,
  exportPdf,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedRows = rows.slice(pageStart, pageStart + pageSize);

  return (
    <section className="management-panel weekly-report-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="panel-supporting-copy">{description}</p>
        </div>

        <div className="export-actions">
          <button className="outline-action" onClick={exportExcel} disabled={!rows.length}>
            <span className="export-badge excel">XLS</span>
            <span>Baixar Excel</span>
          </button>
          <button className="outline-action" onClick={exportPdf} disabled={!rows.length}>
            <span className="export-badge pdf">PDF</span>
            <span>Baixar PDF</span>
          </button>
        </div>
      </div>

      <div className="weekly-report-filter-bar">
        <label>
          {filterLabel}
          <input
            className="field"
            type={filterType}
            value={filterValue}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </label>
        <small>{periodDescription}</small>
      </div>

      <div className="weekly-report-metrics">
        <article className="weekly-report-card">
          <span>Demandas no período</span>
          <strong>{highlights.total}</strong>
          <p>Protocolos criados na janela selecionada</p>
        </article>
        <article className="weekly-report-card">
          <span>Clínicas envolvidas</span>
          <strong>{highlights.clinics}</strong>
          <p>Unidades com reclamações registradas</p>
        </article>
        <article className="weekly-report-card">
          <span>Frentes envolvidas</span>
          <strong>{highlights.professionals}</strong>
          <p>Responsaveis ou servicos citados nas demandas</p>
        </article>
        <article className="weekly-report-card">
          <span>Demandas abertas</span>
          <strong>{highlights.openCount}</strong>
          <p>Protocolos que seguem exigindo acompanhamento</p>
        </article>
        <article className="weekly-report-card">
          <span>Demandas finalizadas</span>
          <strong>{highlights.resolvedCount}</strong>
          <p>Protocolos do período que já foram encerrados</p>
        </article>
      </div>

      <div className="weekly-report-insights">
        <article className="weekly-report-insight-card">
          <span>Unidade com maior volume</span>
          <strong>{highlights.topClinic?.label || 'Não informado'}</strong>
          <p>{highlights.topClinic ? `${highlights.topClinic.total} registro(s) concentrados nessa unidade.` : 'Nenhuma unidade com registros no período selecionado.'}</p>
        </article>
        <article className="weekly-report-insight-card">
          <span>Motivo mais recorrente</span>
          <strong>{formatShortText(highlights.topReason?.label || 'Não informado', 72)}</strong>
          <p>{highlights.topReason ? `${highlights.topReason.total} ocorrência(s) concentradas nesse tema.` : 'Nenhum motivo recorrente identificado no período selecionado.'}</p>
        </article>
        <article className="weekly-report-insight-card">
          <span>Prazos vencidos</span>
          <strong>{highlights.overdueCount}</strong>
          <p>Demandas que ultrapassaram o prazo de retorno operacional</p>
        </article>
      </div>

      <div className="weekly-report-table-toolbar">
        <div>
          <span className="eyebrow">Base detalhada</span>
          <strong>{rows.length} protocolo(s) no período analisado</strong>
        </div>
        <p>Leitura rápida de paciente, unidade, dono atual, profissional envolvido e motivo principal.</p>
      </div>

      <div className="data-table-wrap weekly-report-table-wrap">
        <table className="data-table weekly-report-table">
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Data de cadastro</th>
              <th>Paciente</th>
              <th>Clínica</th>
              <th>Responsável atual</th>
              <th>Profissional envolvido</th>
              <th>Motivo</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8">Carregando relatório...</td>
              </tr>
            ) : paginatedRows.length ? (
              paginatedRows.map((row) => (
                <tr key={row.id || row.protocolo}>
                  <td>
                    <div className="weekly-report-primary-cell">
                      <strong>{row.protocolo}</strong>
                      <small>{rowContextLabel}</small>
                    </div>
                  </td>
                  <td>{row.data_cadastro}</td>
                  <td>
                    <div className="weekly-report-primary-cell">
                      <strong>{row.paciente}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="weekly-report-primary-cell">
                      <strong>{row.clinica}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="weekly-report-primary-cell">
                      <strong>{row.responsavel_atual}</strong>
                      <small>Dono atual da demanda</small>
                    </div>
                  </td>
                  <td>{row.profissional_envolvido}</td>
                  <td className="weekly-report-reason-cell">{row.motivo}</td>
                  <td>
                    <span className={`weekly-report-status-badge ${row.status_tone}`}>{row.status}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="8">{emptyLabel}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && rows.length > 0 && (
        <div className="pagination-bar">
          <div className="pagination-summary">
            <label className="pagination-page-size">
              <span>Por pagina</span>
              <select
                className="field"
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value) || 10)}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <span>
              Mostrando {pageStart + 1} a {Math.min(pageStart + pageSize, rows.length)} de {rows.length}
            </span>
          </div>
          <div className="pagination-actions">
            <button className="outline-action" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
              Anterior
            </button>
            <strong>Página {currentPage} de {totalPages}</strong>
            <button className="outline-action" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
              Próxima
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function WeeklyComplaintReport() {
  const navigate = useNavigate();
  const currentUser = readUser();
  const canAccess = hasPermission(currentUser, 'complaints_management') && isWeeklyComplaintReportAllowed(currentUser);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [dailyPage, setDailyPage] = useState(1);
  const [dailyPageSize, setDailyPageSize] = useState(10);
  const [weekPage, setWeekPage] = useState(1);
  const [weekPageSize, setWeekPageSize] = useState(10);
  const [monthPage, setMonthPage] = useState(1);
  const [monthPageSize, setMonthPageSize] = useState(10);
  const [selectedDay, setSelectedDay] = useState(() => toDateInputValue(new Date()));
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => toDateInputValue(getWeekRange().start));
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthInputValue(new Date()));

  useEffect(() => {
    if (!canAccess) return undefined;

    const loadComplaints = async () => {
      setLoading(true);
      setFeedback('');

      try {
        const res = await api.get('/complaints');
        setComplaints(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        setFeedback('Não foi possível carregar os relatórios de reclamações.');
      } finally {
        setLoading(false);
      }
    };

    loadComplaints();
    return undefined;
  }, [canAccess]);

  useEffect(() => {
    setDailyPage(1);
  }, [selectedDay, dailyPageSize]);

  useEffect(() => {
    setWeekPage(1);
  }, [selectedWeekStart, weekPageSize]);

  useEffect(() => {
    setMonthPage(1);
  }, [selectedMonth, monthPageSize]);

  const selectedDayRange = useMemo(() => {
    const start = parseDateInputValue(selectedDay);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [selectedDay]);
  const selectedWeekRange = useMemo(() => getWeekRange(parseDateInputValue(selectedWeekStart)), [selectedWeekStart]);
  const selectedMonthRange = useMemo(() => getMonthRange(parseMonthInputValue(selectedMonth)), [selectedMonth]);

  const dailyComplaints = useMemo(() => (
    complaints
      .filter((item) => !item.deleted_at)
      .filter((item) => {
        const createdAt = new Date(item.created_at || 0);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= selectedDayRange.start && createdAt <= selectedDayRange.end;
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  ), [complaints, selectedDayRange]);

  const weeklyComplaints = useMemo(() => (
    complaints
      .filter((item) => !item.deleted_at)
      .filter((item) => {
        const createdAt = new Date(item.created_at || 0);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= selectedWeekRange.start && createdAt <= selectedWeekRange.end;
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  ), [complaints, selectedWeekRange]);

  const monthlyComplaints = useMemo(() => (
    complaints
      .filter((item) => !item.deleted_at)
      .filter((item) => {
        const createdAt = new Date(item.created_at || 0);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= selectedMonthRange.start && createdAt <= selectedMonthRange.end;
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  ), [complaints, selectedMonthRange]);

  const dailySummaryRows = useMemo(() => buildSummaryRows(dailyComplaints), [dailyComplaints]);
  const weeklySummaryRows = useMemo(() => buildSummaryRows(weeklyComplaints), [weeklyComplaints]);
  const monthlySummaryRows = useMemo(() => buildSummaryRows(monthlyComplaints), [monthlyComplaints]);
  const dailyHighlights = useMemo(() => buildHighlights(dailyComplaints), [dailyComplaints]);
  const weeklyHighlights = useMemo(() => buildHighlights(weeklyComplaints), [weeklyComplaints]);
  const monthlyHighlights = useMemo(() => buildHighlights(monthlyComplaints), [monthlyComplaints]);

  const handleDailyPdfExport = () => {
    const opened = exportComplaintReportPdf({
      title: 'Relatório diário de reclamações',
      subtitle: 'Consolidado diário com paciente, clínica, responsável atual e motivo principal da demanda.',
      periodLabel: new Intl.DateTimeFormat('pt-BR').format(selectedDayRange.start),
      periodBadge: 'Consolidado diário',
      highlights: dailyHighlights,
      rows: dailySummaryRows
    });

    if (!opened) {
      setFeedback('Permita pop-ups para gerar o PDF.');
    }
  };

  const handleWeeklyPdfExport = () => {
    const opened = exportComplaintReportPdf({
      title: 'Relatório semanal de reclamações',
      subtitle: 'Consolidado semanal com paciente, clínica, profissional envolvido e motivo principal da demanda.',
      periodLabel: formatWeekRangeLabel(selectedWeekRange.start, selectedWeekRange.end),
      periodBadge: 'Semana selecionada',
      highlights: weeklyHighlights,
      rows: weeklySummaryRows
    });

    if (!opened) {
      setFeedback('Permita pop-ups para gerar o PDF.');
    }
  };

  const handleMonthlyPdfExport = () => {
    const opened = exportComplaintReportPdf({
      title: 'Relatório mensal de reclamações',
      subtitle: 'Consolidado mensal com paciente, clínica, profissional envolvido e motivo principal da demanda.',
      periodLabel: capitalizeLabel(formatMonthRangeLabel(selectedMonthRange.start)),
      periodBadge: 'Consolidado mensal',
      highlights: monthlyHighlights,
      rows: monthlySummaryRows
    });

    if (!opened) {
      setFeedback('Permita pop-ups para gerar o PDF.');
    }
  };

  if (!canAccess) {
    return <Navigate to="/home" replace />;
  }

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Visão diária, semanal e mensal</p>
          <h1>Relatórios de reclamações</h1>
          <p>Consolidado operacional e gerencial com seleção manual de data por paciente, unidade, responsável atual e motivo principal de cada protocolo.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/gestao')}>
            Painel de Gestão
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      {feedback && <p className="form-feedback page-form-feedback">{feedback}</p>}

      <ComplaintReportSection
        eyebrow="Consolidado diário"
        title="Reclamações registradas na data selecionada"
        description="Leitura diária para conferência operacional, acionamentos imediatos e acompanhamento de protocolos abertos no dia."
        filterLabel="Data de referência"
        filterValue={selectedDay}
        filterType="date"
        onFilterChange={setSelectedDay}
        periodDescription={`Período analisado: ${new Intl.DateTimeFormat('pt-BR').format(selectedDayRange.start)}. Selecione qualquer data manualmente para auditar o dia desejado.`}
        highlights={dailyHighlights}
        rows={dailySummaryRows}
        loading={loading}
        emptyLabel="Nenhuma reclamação registrada na data selecionada."
        rowContextLabel="Cadastro diário"
        exportExcel={() => exportComplaintReportExcel(dailySummaryRows, 'relatorio-diario-reclamacoes')}
        exportPdf={handleDailyPdfExport}
        page={dailyPage}
        pageSize={dailyPageSize}
        onPageChange={setDailyPage}
        onPageSizeChange={setDailyPageSize}
      />

      <ComplaintReportSection
        eyebrow="Segunda a domingo"
        title="Reclamações registradas na semana selecionada"
        description="Leitura consolidada da carteira semanal com foco em unidade, responsável atual e motivo central de cada protocolo."
        filterLabel="Data de referência da semana"
        filterValue={selectedWeekStart}
        filterType="date"
        onFilterChange={setSelectedWeekStart}
        periodDescription={`Período analisado: ${formatWeekRangeLabel(selectedWeekRange.start, selectedWeekRange.end)}. Selecione qualquer data; o sistema calcula automaticamente a semana de segunda a domingo.`}
        highlights={weeklyHighlights}
        rows={weeklySummaryRows}
        loading={loading}
        emptyLabel="Nenhuma reclamação registrada na semana selecionada."
        rowContextLabel="Cadastro semanal"
        exportExcel={() => exportComplaintReportExcel(weeklySummaryRows, 'relatorio-semanal-reclamacoes')}
        exportPdf={handleWeeklyPdfExport}
        page={weekPage}
        pageSize={weekPageSize}
        onPageChange={setWeekPage}
        onPageSizeChange={setWeekPageSize}
      />

      <ComplaintReportSection
        eyebrow="Consolidado mensal"
        title="Reclamações registradas no mês selecionado"
        description="Visão mensal para acompanhamento executivo do volume, recorrência de motivos e concentração por unidade."
        filterLabel="Mês de referência"
        filterValue={selectedMonth}
        filterType="month"
        onFilterChange={setSelectedMonth}
        periodDescription={`Período analisado: ${capitalizeLabel(formatMonthRangeLabel(selectedMonthRange.start))}. O comparativo mensal fica centralizado na mesma base do relatório semanal.`}
        highlights={monthlyHighlights}
        rows={monthlySummaryRows}
        loading={loading}
        emptyLabel="Nenhuma reclamação registrada no mês selecionado."
        rowContextLabel="Cadastro mensal"
        exportExcel={() => exportComplaintReportExcel(monthlySummaryRows, 'relatorio-mensal-reclamacoes')}
        exportPdf={handleMonthlyPdfExport}
        page={monthPage}
        pageSize={monthPageSize}
        onPageChange={setMonthPage}
        onPageSizeChange={setMonthPageSize}
      />
    </main>
  );
}

export default WeeklyComplaintReport;
