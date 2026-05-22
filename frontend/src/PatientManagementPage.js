import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';
import {
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isMasterAdmin,
  readUser,
  isCompleteBrazilPhone
} from './constants';

const chartColors = ['#0b6f5f', '#d08c31', '#c44536', '#1f7a8c', '#4c956c', '#8a4f7d'];
const pageSizeOptions = [10, 25, 50, 100];

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom'
    }
  }
};

const typeLabels = {
  confirmacao: 'Confirmação',
  agendamento: 'Agendamento',
  reagendamento: 'Reagendamento'
};

const channelLabels = {
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  email: 'E-mail',
  presencial: 'Presencial',
  site: 'Site',
  reclamacao: 'Reclamacao',
  outros: 'Outros'
};

const initialFilters = {
  search: '',
  clinic: '',
  channel: '',
  type: '',
  status: '',
  startDate: '',
  endDate: ''
};

function todayDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeInputValue(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return '08:00';
  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

function dateInputValue(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return todayDateValue();
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildInitialForm() {
  return {
    patient: '',
    phone: defaultBrazilPhone,
    channel: 'whatsapp',
    channelOther: '',
    clinic: '',
    type: 'agendamento',
    scheduledAt: todayDateValue(),
    note: ''
  };
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

function formatDateTime(value) {
  if (!value) return 'Não informado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
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

function PatientManagementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname.includes('/dashboard');
  const isRegister = location.pathname.includes('/cadastro');
  const focusRecordId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const rawId = params.get('abrir') || params.get('id');
    const parsedId = Number(rawId);
    return Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null;
  }, [location.search]);
  const currentUser = readUser();
  const canViewDeleted = isMasterAdmin(currentUser);
  const [form, setForm] = useState(buildInitialForm);
  const [records, setRecords] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [dashboardTablePage, setDashboardTablePage] = useState(1);
  const [dashboardTablePageSize, setDashboardTablePageSize] = useState(10);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [activeTab, setActiveTab] = useState('ativos');
  const [feedback, setFeedback] = useState('');
  const [savedProtocol, setSavedProtocol] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleDraft, setRescheduleDraft] = useState({ date: '', time: '08:00', note: '' });
  const autoOpenRecordRef = useRef(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [recordsRes, clinicsRes] = await Promise.all([
        api.get('/patient-interactions', {
          params: canViewDeleted ? { include_deleted: 1 } : undefined
        }),
        api.get('/clinics')
      ]);
      const data = Array.isArray(recordsRes.data) ? recordsRes.data : [];
      setRecords(data);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      return data;
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a gestão do paciente.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [canViewDeleted]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!canViewDeleted && activeTab === 'excluidos') {
      setActiveTab('ativos');
    }
  }, [activeTab, canViewDeleted]);

  useEffect(() => {
    autoOpenRecordRef.current = false;
  }, [focusRecordId]);

  useEffect(() => {
    if (isDashboard || isRegister || !focusRecordId || autoOpenRecordRef.current || !records.length) {
      return;
    }

    const targetRecord = records.find((record) => record.id === focusRecordId);

    if (!targetRecord) {
      return;
    }

    autoOpenRecordRef.current = true;
    if (targetRecord.status === 'Cancelado') {
      setActiveTab(canViewDeleted ? 'excluidos' : 'ativos');
    } else if (targetRecord.status === 'Encerrado') {
      setActiveTab('finalizados');
    } else {
      setActiveTab('ativos');
    }
    setSelectedRecord(targetRecord);
    setShowCancelModal(false);
    navigate(location.pathname, { replace: true });
  }, [canViewDeleted, focusRecordId, isDashboard, isRegister, location.pathname, navigate, records]);

  const activeRecords = useMemo(() => (
    records.filter((record) => record.status !== 'Cancelado' && record.status !== 'Encerrado')
  ), [records]);
  const finishedRecords = useMemo(() => records.filter((record) => record.status === 'Encerrado'), [records]);
  const deletedRecords = useMemo(() => records.filter((record) => record.status === 'Cancelado'), [records]);
  const visibleRecords = activeTab === 'excluidos'
    ? deletedRecords
    : activeTab === 'finalizados'
      ? finishedRecords
      : activeRecords;

  const grouped = useMemo(() => activeRecords.reduce((acc, record) => {
    acc[record.type] = (acc[record.type] || 0) + 1;
    return acc;
  }, {}), [activeRecords]);

  const statusGrouped = useMemo(() => records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {}), [records]);

  const byType = useMemo(() => groupCount(activeRecords, (record) => typeLabels[record.type] || record.type), [activeRecords]);
  const byChannel = useMemo(() => groupCount(activeRecords, (record) => channelLabels[record.channel] || record.channel), [activeRecords]);
  const byClinic = useMemo(() => groupCount(activeRecords, (record) => record.clinic).slice(0, 10), [activeRecords]);
  const byStatus = useMemo(() => groupCount(records, (record) => record.status), [records]);
  const dashboardSourceRecords = useMemo(() => {
    if (filters.status === 'Encerrado') return finishedRecords;
    if (filters.status === 'Cancelado' && canViewDeleted) return deletedRecords;
    return activeRecords;
  }, [activeRecords, canViewDeleted, deletedRecords, filters.status, finishedRecords]);

  const upcomingRecords = useMemo(() => dashboardSourceRecords
    .filter((record) => {
      const searchable = [
        record.protocol,
        record.patient,
        record.phone,
        record.note,
        record.procedureName,
        record.clinic,
        record.channel,
        record.type,
        record.status
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      const scheduledAt = record.scheduledAt ? new Date(record.scheduledAt) : null;
      const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
      const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;

      return (
        (!filters.search || searchable.includes(String(filters.search || '').toLowerCase()))
        && (!filters.clinic || record.clinic === filters.clinic)
        && (!filters.channel || record.channel === filters.channel)
        && (!filters.type || record.type === filters.type)
        && (!filters.status || record.status === filters.status)
        && (!startDate || (scheduledAt && scheduledAt >= startDate))
        && (!endDate || (scheduledAt && scheduledAt <= endDate))
      );
    })
    .slice()
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)), [dashboardSourceRecords, filters]);
  const dashboardReportRecords = useMemo(() => records
    .filter((record) => {
      if (record.status === 'Cancelado') return false;

      const searchable = [
        record.protocol,
        record.patient,
        record.phone,
        record.note,
        record.procedureName,
        record.clinic,
        record.channel,
        record.type,
        record.status
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      const scheduledAt = record.scheduledAt ? new Date(record.scheduledAt) : null;
      const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
      const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;

      return (
        (!filters.search || searchable.includes(String(filters.search || '').toLowerCase()))
        && (!filters.clinic || record.clinic === filters.clinic)
        && (!filters.channel || record.channel === filters.channel)
        && (!filters.type || record.type === filters.type)
        && (!filters.status || record.status === filters.status)
        && (!startDate || (scheduledAt && scheduledAt >= startDate))
        && (!endDate || (scheduledAt && scheduledAt <= endDate))
      );
    })
    .slice()
    .sort((a, b) => {
      const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }), [records, filters]);
  const dashboardExportRows = useMemo(() => dashboardReportRecords.map((record) => ({
    protocolo: record.protocol,
    paciente: record.patient,
    telefone: record.phone || 'Telefone não informado',
    unidade: record.clinic,
    canal: channelLabels[record.channel] || record.channel || 'Canal não informado',
    tipo: typeLabels[record.type] || record.type,
    procedimento: record.procedureName || 'Nao informado',
    status: record.status,
    data_horario: formatDateTime(record.scheduledAt),
    ultima_tratativa: record.lastActorName || 'Sem tratativa',
    perfil_ultima_tratativa: record.lastActorRole || 'Perfil não informado'
  })), [dashboardReportRecords]);

  useEffect(() => {
    setDashboardTablePage(1);
  }, [upcomingRecords]);

  const totalDashboardTablePages = Math.max(1, Math.ceil(upcomingRecords.length / dashboardTablePageSize));
  const currentDashboardTablePage = Math.min(dashboardTablePage, totalDashboardTablePages);
  const paginatedUpcomingRecords = useMemo(() => {
    const start = (currentDashboardTablePage - 1) * dashboardTablePageSize;
    return upcomingRecords.slice(start, start + dashboardTablePageSize);
  }, [currentDashboardTablePage, dashboardTablePageSize, upcomingRecords]);
  const dashboardTableStart = upcomingRecords.length ? (currentDashboardTablePage - 1) * dashboardTablePageSize + 1 : 0;
  const dashboardTableEnd = upcomingRecords.length ? Math.min(currentDashboardTablePage * dashboardTablePageSize, upcomingRecords.length) : 0;

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const applyFilters = (updates = {}) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const exportDashboardExcel = () => {
    const headers = Object.keys(dashboardExportRows[0] || {
      protocolo: '',
      paciente: '',
      telefone: '',
      unidade: '',
      canal: '',
      tipo: '',
      procedimento: '',
      status: '',
      data_horario: '',
      ultima_tratativa: '',
      perfil_ultima_tratativa: ''
    });
    const html = `
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${dashboardExportRows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-pacientes-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportDashboardPdf = () => {
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF.');
      return;
    }

    const printDate = new Date();
    const headers = ['Protocolo', 'Paciente', 'Unidade e canal', 'Tipo, procedimento e status', 'Data e horário', 'Última tratativa'];
    const rowsToPrint = dashboardExportRows.map((row) => [
      row.protocolo,
      `${row.paciente} | ${row.telefone}`,
      `${row.unidade} | ${row.canal}`,
      `${row.tipo} | ${row.procedimento} | ${row.status}`,
      row.data_horario,
      `${row.ultima_tratativa} | ${row.perfil_ultima_tratativa}`
    ]);

    reportWindow.document.write(`
      <html>
        <head>
          <title>Dashboard de Pacientes</title>
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
                  <p class="report-kicker">Grupo Sorria · Dashboard de Pacientes</p>
                  <h1>Agenda operacional filtrada</h1>
                  <p class="report-subtitle">Exportação da relação exibida na parte inferior do dashboard de pacientes.</p>
                </div>
                <div class="report-meta">
                  <strong>Emitido em</strong>
                  <span>${escapeHtml(printDate.toLocaleString('pt-BR'))}</span>
                </div>
              </div>
            </section>
            <section class="summary-grid">
              <article class="summary-card"><strong>Registros exportados</strong><span>${escapeHtml(String(dashboardExportRows.length))}</span></article>
              <article class="summary-card"><strong>Ativos</strong><span>${escapeHtml(String(activeRecords.length))}</span></article>
              <article class="summary-card"><strong>Clínica</strong><span>${escapeHtml(filters.clinic || 'Todas')}</span></article>
              <article class="summary-card"><strong>Canal</strong><span>${escapeHtml(filters.channel || 'Todos')}</span></article>
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

  const handlePhoneChange = (value) => {
    updateForm('phone', formatBrazilPhoneInput(value));
  };

  const handleChannelChange = (value) => {
    setForm((prev) => ({
      ...prev,
      channel: value,
      channelOther: value === 'outros' ? prev.channelOther : ''
    }));
  };

  const saveRecord = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback('');
    setSavedProtocol('');

    try {
      if (!isCompleteBrazilPhone(form.phone)) {
        setFeedback('Informe o telefone completo no formato +55DDDNÚMERO.');
        setSaving(false);
        return;
      }

      if (form.channel === 'outros' && !form.channelOther.trim()) {
        setFeedback('Informe o canal de entrada quando selecionar Outros.');
        setSaving(false);
        return;
      }

      const payload = {
        ...form,
        phone: formatBrazilPhoneInput(form.phone),
        channel: form.channel === 'outros' ? form.channelOther.trim() : form.channel
      };
      delete payload.channelOther;

      const response = await api.post('/patient-interactions', payload);
      const protocol = response.data?.protocol || '';
      setForm(buildInitialForm());
      await loadRecords();
      setSavedProtocol(protocol);
      setFeedback(protocol ? `Agendamento salvo com sucesso. Protocolo ${protocol}` : 'Agendamento salvo com sucesso.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o agendamento.');
    } finally {
      setSaving(false);
    }
  };

  const openRecord = (record) => {
    setSelectedRecord(record);
    setShowCancelModal(false);
    setShowRescheduleModal(false);
  };

  const refreshSelectedRecord = async (id) => {
    const data = await loadRecords();
    setSelectedRecord(data.find((record) => record.id === id) || null);
  };

  const updateSelectedStatus = async (status, action) => {
    if (!selectedRecord) return;

    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/patient-interactions/${selectedRecord.id}`, { status, action });
      await refreshSelectedRecord(selectedRecord.id);
      setFeedback('Agendamento atualizado com histórico.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar o agendamento.');
    } finally {
      setSaving(false);
    }
  };

  const openRescheduleModal = () => {
    if (!selectedRecord) return;
    setRescheduleDraft({
      date: dateInputValue(selectedRecord.scheduledAt),
      time: timeInputValue(selectedRecord.scheduledAt),
      note: ''
    });
    setShowRescheduleModal(true);
  };

  const saveReschedule = async () => {
    if (!selectedRecord) return;
    if (!rescheduleDraft.date || !rescheduleDraft.time) {
      setFeedback('Informe a nova data e horario do reagendamento.');
      return;
    }

    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/patient-interactions/${selectedRecord.id}`, {
        status: 'Reagendar',
        action: 'Reagendamento registrado',
        scheduledAt: `${rescheduleDraft.date}T${rescheduleDraft.time}:00`,
        note: rescheduleDraft.note
      });
      setShowRescheduleModal(false);
      await refreshSelectedRecord(selectedRecord.id);
      setFeedback('Reagendamento salvo com nova data e horario.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel reagendar o atendimento.');
    } finally {
      setSaving(false);
    }
  };

  const cancelSelectedRecord = async () => {
    if (!selectedRecord) return;

    setSaving(true);
    setFeedback('');

    try {
      await api.delete(`/patient-interactions/${selectedRecord.id}`);
      setShowCancelModal(false);
      await refreshSelectedRecord(selectedRecord.id);
      setActiveTab(canViewDeleted ? 'excluidos' : 'ativos');
      setFeedback('Agendamento movido para a aba de excluídos.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível cancelar o agendamento.');
    } finally {
      setSaving(false);
    }
  };

  if (isRegister) {
    return (
      <main className="app-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Paciente</p>
            <h1>Cadastrar Paciente</h1>
            <p>Registre o agendamento com protocolo, data atual e rastreabilidade operacional.</p>
          </div>

          <div className="heading-actions">
            <button className="outline-action" onClick={() => navigate('/pacientes')}>Gestão do Paciente</button>
            <button className="outline-action" onClick={() => navigate('/pacientes/dashboard')}>Dashboard Pacientes</button>
            <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
          </div>
        </header>

        {savedProtocol && (
          <section className="protocol-success-card" aria-live="polite">
            <span>Agendamento salvo com sucesso</span>
            <strong>{savedProtocol}</strong>
          </section>
        )}
        {feedback && !savedProtocol && <p className="form-feedback">{feedback}</p>}

        <section className="management-panel">
          <form className="public-form patient-intake-form patient-register-form" onSubmit={saveRecord}>
            <div>
              <p className="eyebrow">Novo agendamento</p>
              <h2>Cadastrar Paciente</h2>
            </div>

            <label>
              Paciente
              <input className="field" value={form.patient} onChange={(event) => updateForm('patient', event.target.value)} required />
            </label>

            <label>
              Telefone com WhatsApp
              <input className="field" value={form.phone} onChange={(event) => handlePhoneChange(event.target.value)} required />
            </label>

            <label>
              Canal de entrada
              <select className="field" value={form.channel} onChange={(event) => handleChannelChange(event.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="telefone">Telefone</option>
                <option value="email">E-mail</option>
                <option value="presencial">Presencial</option>
                <option value="site">Site</option>
                <option value="outros">Outros</option>
              </select>
            </label>

            {form.channel === 'outros' && (
              <label>
                Descreva o canal
                <input
                  className="field"
                  value={form.channelOther}
                  onChange={(event) => updateForm('channelOther', event.target.value.slice(0, 120))}
                  placeholder="Informe o canal de entrada"
                  maxLength={120}
                  required
                />
              </label>
            )}

            <label>
              Unidade
              <select className="field" value={form.clinic} onChange={(event) => updateForm('clinic', event.target.value)} required>
                <option value="">Selecione a unidade</option>
                {clinics
                  .filter((clinic) => clinic?.name && String(clinic.active ?? 1) !== '0' && !String(clinic.name).includes('INATIVA'))
                  .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
                  .map((clinic) => (
                    <option key={clinic.id} value={clinic.name}>
                      {clinic.name} ({clinic.city || 'Cidade'}/{clinic.state || 'UF'})
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Tipo
              <select className="field" value={form.type} onChange={(event) => updateForm('type', event.target.value)}>
                <option value="confirmacao">Confirmação</option>
                <option value="agendamento">Agendamento</option>
                <option value="reagendamento">Reagendamento</option>
              </select>
            </label>

            <label>
              Data
              <input className="field" type="date" value={form.scheduledAt} onChange={(event) => updateForm('scheduledAt', event.target.value)} required />
            </label>

            <label>
              Observações
              <textarea className="field textarea" value={form.note} onChange={(event) => updateForm('note', event.target.value)} />
            </label>

            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => navigate('/pacientes')}>
                Voltar para gestão
              </button>
              <button className="primary-action" type="submit" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar agendamento'}
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (isDashboard) {
    return (
      <main className="app-page patient-dashboard-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Dashboard do Paciente</p>
            <h1>Dashboard de Pacientes</h1>
            <p>Acompanhe confirmações, agendamentos, reagendamentos, cancelamentos e o responsável pela última tratativa.</p>
          </div>

          <div className="heading-actions patient-dashboard-actions">
            <button className="outline-action" onClick={() => navigate('/pacientes')}>Gestão do Paciente</button>
            <button className="outline-action" onClick={() => navigate('/pacientes/cadastro')}>Cadastrar Paciente</button>
            <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
          </div>
        </header>

        <section className="dashboard-filter-panel patient-dashboard-panel">
          <div className="dashboard-filter-heading">
            <div>
              <p className="eyebrow">Filtros</p>
              <h2>Base de acompanhamento</h2>
              <p className="base-subtitle">Refine a visão operacional por unidade, canal, tipo, status e período.</p>
            </div>
            <button className="outline-action" onClick={() => setFilters(initialFilters)}>
              Limpar filtros
            </button>
          </div>

          <div className="dashboard-filters">
            <input
              className="field"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Buscar protocolo, paciente, unidade ou observação"
            />
            <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
              <option value="">Todas as unidades</option>
              {clinics
                .filter((clinic) => clinic?.name && String(clinic.active ?? 1) !== '0' && !String(clinic.name).includes('INATIVA'))
                .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
                .map((clinic) => (
                  <option key={clinic.id} value={clinic.name}>{clinic.name}</option>
                ))}
            </select>
            <select className="field" value={filters.channel} onChange={(event) => updateFilter('channel', event.target.value)}>
              <option value="">Todos os canais</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telefone">Telefone</option>
              <option value="email">E-mail</option>
              <option value="presencial">Presencial</option>
              <option value="site">Site</option>
              <option value="outros">Outros</option>
            </select>
            <select className="field" value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
              <option value="">Todos os tipos</option>
              <option value="confirmacao">Confirmação</option>
              <option value="agendamento">Agendamento</option>
              <option value="reagendamento">Reagendamento</option>
            </select>
            <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">Todos os status</option>
              {Array.from(new Set(activeRecords.map((record) => record.status).filter(Boolean))).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <input className="field" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
            <input className="field" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
          </div>
        </section>

        {feedback && <p className="form-feedback">{feedback}</p>}

        <section className="kpi-grid dashboard-kpi-grid patient-dashboard-kpis" aria-label="Resumo do paciente">
          <button className="kpi-card kpi-button" type="button" onClick={() => setFilters(initialFilters)}>
            <span>Total</span>
            <strong>{records.length}</strong>
            <p>REGISTROS</p>
          </button>
          <button className="kpi-card success kpi-button" type="button" onClick={() => applyFilters({ type: 'confirmacao', status: '' })}>
            <span>Confirmações</span>
            <strong>{grouped.confirmacao || 0}</strong>
            <p>CONTATOS</p>
          </button>
          <button className="kpi-card progress kpi-button" type="button" onClick={() => applyFilters({ type: 'agendamento', status: '' })}>
            <span>Agendamentos</span>
            <strong>{grouped.agendamento || 0}</strong>
            <p>NOVOS HORÁRIOS</p>
          </button>
          <button className="kpi-card warning kpi-button" type="button" onClick={() => applyFilters({ type: 'reagendamento', status: '' })}>
            <span>Reagendamentos</span>
            <strong>{grouped.reagendamento || 0}</strong>
            <p>ALTERAÇÕES</p>
          </button>
          <button className="kpi-card success kpi-button" type="button" onClick={() => applyFilters({ status: 'Encerrado', type: '' })}>
            <span>Finalizados</span>
            <strong>{finishedRecords.length}</strong>
            <p>REGISTROS ENCERRADOS</p>
          </button>
          {canViewDeleted && (
            <button className="kpi-card danger kpi-button" type="button" onClick={() => applyFilters({ status: 'Cancelado', type: '' })}>
              <span>Excluídos</span>
              <strong>{statusGrouped.Cancelado || 0}</strong>
              <p>LASTRO PRESERVADO</p>
            </button>
          )}
        </section>

        {loading ? (
          <section className="management-panel">
            <p className="empty-state">Carregando dashboard do paciente...</p>
          </section>
        ) : (
          <>
            <section className="chart-grid dashboard-chart-grid patient-dashboard-grid">
              <article className="chart-card">
                <h2>Volume por tipo</h2>
                <div className="chart-box">
                  <Bar data={buildBarData(byType, 'Registros')} options={chartOptions} />
                </div>
              </article>
              <article className="chart-card">
                <h2>Canal de entrada</h2>
                <div className="chart-box">
                  <Doughnut data={buildDoughnutData(byChannel)} options={chartOptions} />
                </div>
              </article>
              <article className="chart-card">
                <h2>Volume por unidade</h2>
                <div className="chart-box">
                  <Bar data={buildBarData(byClinic, 'Registros', '#d08c31')} options={chartOptions} />
                </div>
              </article>
              <article className="chart-card">
                <h2>Status operacional</h2>
                <div className="chart-box">
                  <Doughnut data={buildDoughnutData(byStatus)} options={chartOptions} />
                </div>
              </article>
            </section>

            <section className="management-panel dashboard-base-panel patient-dashboard-base">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Base filtrada</p>
                  <h2 className="table-title-with-help">
                    Agenda operacional de pacientes
                    <span className="tooltip-help inline-help" tabIndex="0" aria-label="Horário de Brasília">
                      ?
                      <span>O horário exibido segue o horário oficial de Brasília.</span>
                    </span>
                  </h2>
                  <p className="base-subtitle">Exibindo {upcomingRecords.length} pacientes da agenda operacional.</p>
                </div>
                <div className="export-actions">
                  <button className="outline-action" onClick={exportDashboardExcel} disabled={!dashboardExportRows.length}>
                    <span className="export-badge excel">XLS</span>
                    <span>Baixar Excel</span>
                  </button>
                  <button className="outline-action" onClick={exportDashboardPdf} disabled={!dashboardExportRows.length}>
                    <span className="export-badge pdf">PDF</span>
                    <span>Baixar PDF</span>
                  </button>
                </div>
              </div>

              <div className="dashboard-base-summary patient-dashboard-summary">
                {[
                  { label: 'Agenda filtrada', value: upcomingRecords.length },
                  { label: 'Ativos', value: activeRecords.length },
                  { label: 'Finalizados', value: finishedRecords.length },
                  ...(canViewDeleted ? [{ label: 'Excluídos', value: deletedRecords.length }] : []),
                  { label: 'Confirmações', value: grouped.confirmacao || 0 },
                  { label: 'Agendamentos', value: grouped.agendamento || 0 }
                ].map((item) => {
                  let onClick = () => {};
                  if (item.label === 'Agenda filtrada') onClick = () => setFilters(initialFilters);
                  if (item.label === 'Ativos') onClick = () => applyFilters({ status: '', type: '' });
                  if (item.label === 'Finalizados') onClick = () => applyFilters({ status: 'Encerrado', type: '' });
                  if (item.label === 'Excluídos') onClick = () => applyFilters({ status: 'Cancelado', type: '' });
                  if (item.label === 'Confirmações') onClick = () => applyFilters({ type: 'confirmacao', status: '' });
                  if (item.label === 'Agendamentos') onClick = () => applyFilters({ type: 'agendamento', status: '' });

                  return (
                  <button className="dashboard-summary-card dashboard-summary-button" key={item.label} type="button" onClick={onClick}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </button>
                  );
                })}
              </div>

              <div className="data-table-wrap dashboard-table-wrap">
                <table className="data-table dashboard-clean-table patient-dashboard-table">
                  <thead>
                    <tr>
                      <th>Protocolo</th>
                      <th>Paciente</th>
                      <th>Unidade e canal</th>
                      <th>Tipo, procedimento e status</th>
                      <th>Data e horario</th>
                      <th>Última tratativa por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedUpcomingRecords.map((record) => (
                      <tr key={record.id}>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{record.protocol}</span>
                            <span className="cell-secondary">{record.createdByName || 'Sistema'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{record.patient}</span>
                            <span className="cell-secondary">{record.phone || 'Telefone não informado'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{record.clinic}</span>
                            <span className="cell-secondary">{channelLabels[record.channel] || record.channel || 'Canal não informado'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{typeLabels[record.type] || record.type}</span>
                            <span className="cell-secondary">{record.procedureName || 'Procedimento nao informado'} | {record.status}</span>
                          </div>
                        </td>
                        <td>{formatDateTime(record.scheduledAt)}</td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{record.lastActorName || 'Sem tratativa'}</span>
                            <span className="cell-secondary">{record.lastActorRole || 'Perfil não informado'}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination-bar">
                <div className="pagination-summary">
                  <label className="pagination-page-size">
                    <span>Por pagina</span>
                    <select
                      className="field"
                      value={dashboardTablePageSize}
                      onChange={(event) => {
                        setDashboardTablePageSize(Number(event.target.value));
                        setDashboardTablePage(1);
                      }}
                    >
                      {pageSizeOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <span>Mostrando {dashboardTableStart} a {dashboardTableEnd} de {upcomingRecords.length} registros</span>
                </div>

                <div className="pagination-actions">
                  <button
                    className="outline-action"
                    type="button"
                    onClick={() => setDashboardTablePage((prev) => Math.max(1, prev - 1))}
                    disabled={currentDashboardTablePage <= 1}
                  >
                    Anterior
                  </button>
                  <strong>Página {currentDashboardTablePage} de {totalDashboardTablePages}</strong>
                  <button
                    className="outline-action"
                    type="button"
                    onClick={() => setDashboardTablePage((prev) => Math.min(totalDashboardTablePages, prev + 1))}
                    disabled={currentDashboardTablePage >= totalDashboardTablePages}
                  >
                    Proxima
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Gestão do Paciente</p>
          <h1>Gestão do Paciente</h1>
          <p>Consulte protocolos ativos e finalizados, acompanhe o histórico e acesse o cadastro em uma tela dedicada.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/pacientes/cadastro')}>Cadastrar Paciente</button>
          <button className="outline-action" onClick={() => navigate('/pacientes/dashboard')}>Dashboard Pacientes</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {savedProtocol && (
        <section className="protocol-success-card" aria-live="polite">
          <span>Agendamento salvo com sucesso</span>
          <strong>{savedProtocol}</strong>
        </section>
      )}
      {feedback && !savedProtocol && <p className="form-feedback">{feedback}</p>}

      <section className="kpi-grid nps-kpi-grid">
        <article className="kpi-card">
          <span>Total</span>
          <strong>{records.length}</strong>
          <p>REGISTROS NA OPERAÇÃO</p>
        </article>
        <article className="kpi-card success">
          <span>Confirmações</span>
          <strong>{grouped.confirmacao || 0}</strong>
          <p>CONTATOS</p>
        </article>
        <article className="kpi-card progress">
          <span>Agendamentos</span>
          <strong>{grouped.agendamento || 0}</strong>
          <p>NOVOS HORÁRIOS</p>
        </article>
        <article className="kpi-card warning">
          <span>Reagendamentos</span>
          <strong>{grouped.reagendamento || 0}</strong>
          <p>ALTERAÇÕES</p>
        </article>
        <article className="kpi-card success">
          <span>Finalizados</span>
          <strong>{finishedRecords.length}</strong>
          <p>REGISTROS ENCERRADOS</p>
        </article>
        {canViewDeleted && (
          <article className="kpi-card danger">
            <span>Excluídos</span>
            <strong>{deletedRecords.length}</strong>
            <p>LASTRO DISPONÍVEL</p>
          </article>
        )}
      </section>

      <section className="management-panel">
        <section className="patient-records-panel">
          <div className="patient-records-head">
            <div>
              <p className="eyebrow">Painel operacional</p>
              <h2>Agendamentos do paciente</h2>
            </div>

            <div className="patient-tabs">
              <button type="button" className={activeTab === 'ativos' ? 'active' : ''} onClick={() => setActiveTab('ativos')}>
                Ativos ({activeRecords.length})
              </button>
              <button type="button" className={activeTab === 'finalizados' ? 'active' : ''} onClick={() => setActiveTab('finalizados')}>
                Finalizados ({finishedRecords.length})
              </button>
              {canViewDeleted && (
                <button type="button" className={activeTab === 'excluidos' ? 'active' : ''} onClick={() => setActiveTab('excluidos')}>
                  Excluídos ({deletedRecords.length})
                </button>
              )}
            </div>
          </div>

          <div className="data-table-wrap dashboard-table-wrap">
            <table className="data-table dashboard-clean-table patient-dashboard-table">
              <thead>
                <tr>
                  <th>Protocolo</th>
                  <th>Paciente</th>
                  <th>Tipo</th>
                  <th>Unidade</th>
                  <th>Data e horário</th>
                  <th>{activeTab === 'excluidos' ? 'Excluído por' : 'Última tratativa por'}</th>
                  <th>Leitura rápida</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.protocol}</td>
                    <td>{record.patient}</td>
                    <td>
                      <div className="table-cell-stack">
                        <span className="cell-primary">{typeLabels[record.type] || record.type}</span>
                        <span className="cell-secondary">{record.procedureName || 'Procedimento nao informado'}</span>
                      </div>
                    </td>
                    <td>{record.clinic}</td>
                    <td>{formatDateTime(record.scheduledAt)}</td>
                    <td>
                      {activeTab === 'excluidos'
                        ? (record.cancelledByName || record.lastActorName || 'Sem registro')
                        : (record.lastActorName || 'Sem tratativa')}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="outline-action compact-action patient-note-trigger"
                        onClick={() => openRecord(record)}
                      >
                        Consultar
                      </button>
                    </td>
                    <td>
                      <button className="outline-action compact-action" onClick={() => openRecord(record)}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {loading && <p className="empty-state">Carregando agendamentos do paciente...</p>}
            {!loading && visibleRecords.length === 0 && <p className="empty-state">Nenhum registro encontrado nesta aba.</p>}
          </div>
        </section>
      </section>

      {selectedRecord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => { setSelectedRecord(null); setShowCancelModal(false); }}>
          <section className="modal-panel patient-modal" onClick={(event) => event.stopPropagation()}>
            <div className="nps-modal-title">
              <div>
                <p className="eyebrow">Ficha do paciente</p>
                <h2>{selectedRecord.protocol}</h2>
              </div>
              <span className="mini-badge">{selectedRecord.status}</span>
            </div>

            <dl className="meta-grid">
              <div>
                <dt>Paciente</dt>
                <dd>{selectedRecord.patient}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{selectedRecord.phone}</dd>
              </div>
              <div>
                <dt>Canal</dt>
                <dd>{channelLabels[selectedRecord.channel] || selectedRecord.channel}</dd>
              </div>
              <div>
                <dt>Unidade</dt>
                <dd>{selectedRecord.clinic}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{typeLabels[selectedRecord.type] || selectedRecord.type}</dd>
              </div>
              <div>
                <dt>Data e horário</dt>
                <dd>{formatDateTime(selectedRecord.scheduledAt)}</dd>
              </div>
            </dl>

            <div className="nps-treatment-relato">
              <strong>Observações do usuário</strong>
              <p>{selectedRecord.note || 'Sem observação registrada.'}</p>
            </div>

            <div className="row-actions">
              {selectedRecord.status !== 'Cancelado' && selectedRecord.status !== 'Encerrado' && (
                <>
                  <button className="outline-action" onClick={() => updateSelectedStatus('Contato realizado', 'Contato realizado')} disabled={saving}>
                    Contato realizado
                  </button>
                  <button className="outline-action" onClick={() => updateSelectedStatus('Confirmado', 'Agenda confirmada')} disabled={saving}>
                    Confirmar
                  </button>
                  <button className="secondary-action" onClick={openRescheduleModal} disabled={saving}>
                    Reagendar
                  </button>
                  <button className="primary-action" onClick={() => updateSelectedStatus('Encerrado', 'Registro encerrado')} disabled={saving}>
                    Encerrar
                  </button>
                  <button className="outline-action danger-action" onClick={() => setShowCancelModal(true)} disabled={saving}>
                    Excluir agendamento
                  </button>
                </>
              )}
            </div>

            <div className="history-list">
              {(selectedRecord.history || []).map((item, index) => (
                <article className="history-item" key={`${item.at}-${index}`}>
                  <div className="history-item-head">
                    <strong>{item.action}</strong>
                    <span>{formatDateTime(item.at)}</span>
                  </div>
                  <small>{item.actor_name || 'Usuário do sistema'} · {item.actor_role || 'Perfil não informado'}</small>
                  <p>{item.note}</p>
                </article>
              ))}
            </div>

            <div className="heading-actions">
              <button className="outline-action" onClick={() => { setSelectedRecord(null); setShowCancelModal(false); }}>Fechar</button>
            </div>
          </section>
        </div>
      )}

      {showCancelModal && selectedRecord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowCancelModal(false)}>
          <section className="modal-panel modal-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Cancelar agendamento</p>
            <h2>Tem certeza que deseja excluir?</h2>
            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setShowCancelModal(false)} disabled={saving}>
                Voltar
              </button>
              <button className="outline-action danger-action" type="button" onClick={cancelSelectedRecord} disabled={saving}>
                {saving ? 'Cancelando...' : 'Confirmar exclusão'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showRescheduleModal && selectedRecord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowRescheduleModal(false)}>
          <section className="modal-panel modal-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Reagendar atendimento</p>
            <h2>{selectedRecord.patient}</h2>
            <div className="financial-editor-grid">
              <label>
                Nova data
                <input
                  className="field"
                  type="date"
                  value={rescheduleDraft.date}
                  onChange={(event) => setRescheduleDraft((current) => ({ ...current, date: event.target.value }))}
                />
              </label>
              <label>
                Novo horario
                <input
                  className="field"
                  type="time"
                  value={rescheduleDraft.time}
                  onChange={(event) => setRescheduleDraft((current) => ({ ...current, time: event.target.value }))}
                />
              </label>
              <label className="wide-field">
                Observacao
                <textarea
                  className="field"
                  rows={3}
                  value={rescheduleDraft.note}
                  onChange={(event) => setRescheduleDraft((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Informe o motivo ou detalhe do reagendamento."
                />
              </label>
            </div>
            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setShowRescheduleModal(false)} disabled={saving}>
                Voltar
              </button>
              <button className="primary-action" type="button" onClick={saveReschedule} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar reagendamento'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default PatientManagementPage;

