import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from './api';
import { hasPermission, isMasterAdmin, readUser, statusLabels } from './constants';

function formatProtocol(item) {
  if (item.protocol) return item.protocol;
  const year = item.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `GRC-${year}-${String(item.id).padStart(6, '0')}`;
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

function formatShortText(value, maxLength = 180) {
  const text = String(value || '').trim();

  if (!text) return 'Nao informado';
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

  return ['admin', 'supervisor_crc', 'sac_operator', 'manager'].includes(String(user?.role || ''));
}

function getWeeklyProfessionalLabel(item) {
  return (
    item.service_type
    || item.assigned_responsible_name
    || item.coordinator_name
    || item.manager_name
    || 'Nao informado'
  );
}

function getWeeklyReasonLabel(item) {
  return formatShortText(item.description || item.complaint_type || 'Nao informado');
}

function WeeklyComplaintReport() {
  const navigate = useNavigate();
  const currentUser = readUser();
  const canAccess = hasPermission(currentUser, 'complaints_management') && isWeeklyComplaintReportAllowed(currentUser);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!canAccess) return undefined;

    const loadComplaints = async () => {
      setLoading(true);
      setFeedback('');

      try {
        const res = await api.get('/complaints');
        setComplaints(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        setFeedback('Nao foi possivel carregar o relatorio semanal.');
      } finally {
        setLoading(false);
      }
    };

    loadComplaints();
    return undefined;
  }, [canAccess]);

  const weeklyComplaints = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);

    return complaints
      .filter((item) => !item.deleted_at)
      .filter((item) => {
        const createdAt = new Date(item.created_at || 0);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= start;
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [complaints]);

  const summaryRows = useMemo(() => weeklyComplaints.map((item) => ({
    protocolo: formatProtocol(item),
    data_cadastro: formatFullDateTime(item.created_at),
    paciente: item.patient_name || 'Nao informado',
    clinica: item.clinic_name || 'Nao informado',
    profissional_envolvido: getWeeklyProfessionalLabel(item),
    motivo: getWeeklyReasonLabel(item),
    status: statusLabels[item.status] || item.status || 'Aberta'
  })), [weeklyComplaints]);

  const highlights = useMemo(() => {
    const clinics = new Set();
    const professionals = new Set();

    weeklyComplaints.forEach((item) => {
      if (item.clinic_name) clinics.add(item.clinic_name);
      professionals.add(getWeeklyProfessionalLabel(item));
    });

    return {
      total: weeklyComplaints.length,
      clinics: clinics.size,
      professionals: professionals.size
    };
  }, [weeklyComplaints]);

  const exportWeeklyExcel = () => {
    const headers = Object.keys(summaryRows[0] || {
      protocolo: '',
      data_cadastro: '',
      paciente: '',
      clinica: '',
      profissional_envolvido: '',
      motivo: '',
      status: ''
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
    link.download = `relatorio-semanal-reclamacoes-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportWeeklyPdf = () => {
    const printDate = new Date();
    const rows = summaryRows.map((row) => [
      row.protocolo,
      row.data_cadastro,
      row.paciente,
      row.clinica,
      row.profissional_envolvido,
      row.motivo,
      row.status
    ]);
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF.');
      return;
    }

    reportWindow.document.write(`
      <html>
        <head>
          <title>Relatorio semanal de reclamacoes</title>
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
                  <p class="report-kicker">Grupo Sorria · Gestao de reclamacoes</p>
                  <h1>Relatorio semanal de reclamacoes</h1>
                  <p class="report-subtitle">Consolidado semanal com paciente, clinica, profissional envolvido e motivo principal da demanda.</p>
                </div>
                <div class="report-meta">
                  <strong>Emitido em</strong>
                  <span>${escapeHtml(printDate.toLocaleString('pt-BR'))}</span>
                </div>
              </div>
            </section>
            <section class="summary-grid">
              <article class="summary-card">
                <strong>Reclamacoes na semana</strong>
                <span>${escapeHtml(String(highlights.total))}</span>
              </article>
              <article class="summary-card">
                <strong>Clinicas envolvidas</strong>
                <span>${escapeHtml(String(highlights.clinics))}</span>
              </article>
              <article class="summary-card">
                <strong>Frentes envolvidas</strong>
                <span>${escapeHtml(String(highlights.professionals))}</span>
              </article>
              <article class="summary-card">
                <strong>Janela analisada</strong>
                <span>Ultimos 7 dias</span>
              </article>
            </section>
            <section class="report-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Protocolo</th>
                    <th>Data de cadastro</th>
                    <th>Paciente</th>
                    <th>Clinica</th>
                    <th>Profissional envolvido</th>
                    <th>Motivo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
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

  if (!canAccess) {
    return <Navigate to="/home" replace />;
  }

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Relatorio semanal</p>
          <h1>Reclamacoes da semana</h1>
          <p>Consolidado operacional com paciente, clinica, profissional envolvido e motivo principal da demanda.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/gestao')}>
            Painel de Gestao
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      {feedback && <p className="form-feedback page-form-feedback">{feedback}</p>}

      <section className="management-panel weekly-report-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ultimos 7 dias</p>
            <h2>Reclamacoes registradas na semana atual</h2>
            <p className="panel-supporting-copy">
              Tela disponivel apenas para Administrador Master, Administrador, Supervisor de CRC, Operador de SAC e Gerente.
            </p>
          </div>

          <div className="export-actions">
            <button className="outline-action" onClick={exportWeeklyExcel} disabled={!summaryRows.length}>
              <span className="export-badge excel">XLS</span>
              <span>Baixar Excel</span>
            </button>
            <button className="outline-action" onClick={exportWeeklyPdf} disabled={!summaryRows.length}>
              <span className="export-badge pdf">PDF</span>
              <span>Baixar PDF</span>
            </button>
          </div>
        </div>

        <div className="weekly-report-metrics">
          <article className="weekly-report-card">
            <span>Reclamacoes na semana</span>
            <strong>{highlights.total}</strong>
            <p>Registros criados na janela atual</p>
          </article>
          <article className="weekly-report-card">
            <span>Clinicas envolvidas</span>
            <strong>{highlights.clinics}</strong>
            <p>Unidades com demanda registrada</p>
          </article>
          <article className="weekly-report-card">
            <span>Frentes envolvidas</span>
            <strong>{highlights.professionals}</strong>
            <p>Servicos ou responsaveis citados</p>
          </article>
          <article className="weekly-report-card">
            <span>Status da tela</span>
            <strong>{loading ? 'Carregando' : 'Atualizado'}</strong>
            <p>Base refletindo a visibilidade do usuario logado</p>
          </article>
        </div>

        <div className="data-table-wrap weekly-report-table-wrap">
          <table className="data-table weekly-report-table">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Data de cadastro</th>
                <th>Paciente</th>
                <th>Clinica</th>
                <th>Profissional envolvido</th>
                <th>Motivo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7">Carregando relatorio semanal...</td>
                </tr>
              ) : summaryRows.length ? (
                summaryRows.map((row) => (
                  <tr key={row.protocolo}>
                    <td>{row.protocolo}</td>
                    <td>{row.data_cadastro}</td>
                    <td>{row.paciente}</td>
                    <td>{row.clinica}</td>
                    <td>{row.profissional_envolvido}</td>
                    <td>{row.motivo}</td>
                    <td>{row.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7">Nenhuma reclamacao registrada nos ultimos 7 dias.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default WeeklyComplaintReport;
