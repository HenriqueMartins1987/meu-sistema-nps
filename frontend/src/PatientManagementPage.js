import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';
import {
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone
} from './constants';

const chartColors = ['#0b6f5f', '#d08c31', '#c44536', '#1f7a8c', '#4c956c', '#8a4f7d'];

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
  confirmacao: 'ConfirmaÃƒÂ§ÃƒÂ£o',
  agendamento: 'Agendamento',
  reagendamento: 'Reagendamento'
};

const channelLabels = {
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  email: 'E-mail',
  presencial: 'Presencial',
  site: 'Site',
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
    const value = key(item) || 'NÃƒÂ£o informado';
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
  if (!value) return 'NÃƒÂ£o informado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
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
  const [form, setForm] = useState(buildInitialForm);
  const [records, setRecords] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [activeTab, setActiveTab] = useState('ativos');
  const [feedback, setFeedback] = useState('');
  const [savedProtocol, setSavedProtocol] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const autoOpenRecordRef = useRef(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [recordsRes, clinicsRes] = await Promise.all([
        api.get('/patient-interactions'),
        api.get('/clinics')
      ]);
      const data = Array.isArray(recordsRes.data) ? recordsRes.data : [];
      setRecords(data);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      return data;
    } catch (error) {
      setFeedback(error.response?.data?.error || 'NÃƒÂ£o foi possÃƒÂ­vel carregar a gestÃƒÂ£o do paciente.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

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
    setActiveTab(targetRecord.status === 'Cancelado' ? 'cancelados' : 'ativos');
    setSelectedRecord(targetRecord);
    setShowCancelModal(false);
    navigate(location.pathname, { replace: true });
  }, [focusRecordId, isDashboard, isRegister, location.pathname, navigate, records]);

  const activeRecords = useMemo(() => records.filter((record) => record.status !== 'Cancelado'), [records]);
  const cancelledRecords = useMemo(() => records.filter((record) => record.status === 'Cancelado'), [records]);
  const visibleRecords = activeTab === 'cancelados' ? cancelledRecords : activeRecords;

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

  const upcomingRecords = useMemo(() => activeRecords
    .filter((record) => {
      const searchable = [
        record.protocol,
        record.patient,
        record.phone,
        record.note,
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
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, 50), [activeRecords, filters]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
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
        setFeedback('Informe o telefone completo no formato +55DDDNÃƒÅ¡MERO.');
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
      setFeedback(error.response?.data?.error || 'NÃƒÂ£o foi possÃƒÂ­vel salvar o agendamento.');
    } finally {
      setSaving(false);
    }
  };

  const openRecord = (record) => {
    setSelectedRecord(record);
    setShowCancelModal(false);
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
      setFeedback('Agendamento atualizado com histÃƒÂ³rico.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'NÃƒÂ£o foi possÃƒÂ­vel atualizar o agendamento.');
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
      setActiveTab('cancelados');
      setFeedback('Agendamento movido para a aba de cancelados.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'NÃƒÂ£o foi possÃƒÂ­vel cancelar o agendamento.');
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
            <button className="outline-action" onClick={() => navigate('/pacientes')}>GestÃƒÂ£o do Paciente</button>
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
                <option value="confirmacao">ConfirmaÃƒÂ§ÃƒÂ£o</option>
                <option value="agendamento">Agendamento</option>
                <option value="reagendamento">Reagendamento</option>
              </select>
            </label>

            <label>
              Data
              <input className="field" type="date" value={form.scheduledAt} onChange={(event) => updateForm('scheduledAt', event.target.value)} required />
            </label>

            <label>
              ObservaÃƒÂ§ÃƒÂµes
              <textarea className="field textarea" value={form.note} onChange={(event) => updateForm('note', event.target.value)} />
            </label>

            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => navigate('/pacientes')}>
                Voltar para gestÃƒÂ£o
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
            <p>Acompanhe confirmaÃƒÂ§ÃƒÂµes, agendamentos, reagendamentos, cancelamentos e o responsÃƒÂ¡vel pela ÃƒÂºltima tratativa.</p>
          </div>

          <div className="heading-actions patient-dashboard-actions">
            <button className="outline-action" onClick={() => navigate('/pacientes')}>GestÃƒÂ£o do Paciente</button>
            <button className="outline-action" onClick={() => navigate('/pacientes/cadastro')}>Cadastrar Paciente</button>
            <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
          </div>
        </header>

        <section className="dashboard-filter-panel patient-dashboard-panel">
          <div className="dashboard-filter-heading">
            <div>
              <p className="eyebrow">Filtros</p>
              <h2>Base de acompanhamento</h2>
              <p className="base-subtitle">Refine a visÃƒÂ£o operacional por unidade, canal, tipo, status e perÃƒÂ­odo.</p>
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
              placeholder="Buscar protocolo, paciente, unidade ou observaÃƒÂ§ÃƒÂ£o"
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
              <option value="confirmacao">ConfirmaÃƒÂ§ÃƒÂ£o</option>
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
          <article className="kpi-card">
            <span>Total</span>
            <strong>{records.length}</strong>
            <p>REGISTROS</p>
          </article>
          <article className="kpi-card success">
            <span>ConfirmaÃƒÂ§ÃƒÂµes</span>
            <strong>{grouped.confirmacao || 0}</strong>
            <p>CONTATOS</p>
          </article>
          <article className="kpi-card progress">
            <span>Agendamentos</span>
            <strong>{grouped.agendamento || 0}</strong>
            <p>NOVOS HORÃƒÂRIOS</p>
          </article>
          <article className="kpi-card warning">
            <span>Reagendamentos</span>
            <strong>{grouped.reagendamento || 0}</strong>
            <p>ALTERAÃƒâ€¡Ãƒâ€¢ES</p>
          </article>
          <article className="kpi-card danger">
            <span>Cancelados</span>
            <strong>{statusGrouped.Cancelado || 0}</strong>
            <p>LASTRO PRESERVADO</p>
          </article>
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
                    <span className="tooltip-help inline-help" tabIndex="0" aria-label="HorÃƒÂ¡rio de BrasÃƒÂ­lia">
                      ?
                      <span>O horÃƒÂ¡rio exibido segue o horÃƒÂ¡rio oficial de BrasÃƒÂ­lia.</span>
                    </span>
                  </h2>
                  <p className="base-subtitle">Exibindo {upcomingRecords.length} pacientes da agenda operacional.</p>
                </div>
              </div>

              <div className="dashboard-base-summary patient-dashboard-summary">
                {[
                  { label: 'Agenda filtrada', value: upcomingRecords.length },
                  { label: 'Ativos', value: activeRecords.length },
                  { label: 'Cancelados', value: cancelledRecords.length },
                  { label: 'ConfirmaÃ§Ãµes', value: grouped.confirmacao || 0 },
                  { label: 'Agendamentos', value: grouped.agendamento || 0 }
                ].map((item) => (
                  <article className="dashboard-summary-card" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>

              <div className="data-table-wrap dashboard-table-wrap">
                <table className="data-table dashboard-clean-table patient-dashboard-table">
                  <thead>
                    <tr>
                      <th>Protocolo</th>
                      <th>Paciente</th>
                      <th>Unidade e canal</th>
                      <th>Tipo e status</th>
                      <th>Data e horario</th>
                      <th>Ultima tratativa por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingRecords.map((record) => (
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
                            <span className="cell-secondary">{record.phone || 'Telefone nao informado'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{record.clinic}</span>
                            <span className="cell-secondary">{channelLabels[record.channel] || record.channel || 'Canal nao informado'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{typeLabels[record.type] || record.type}</span>
                            <span className="cell-secondary">{record.status}</span>
                          </div>
                        </td>
                        <td>{formatDateTime(record.scheduledAt)}</td>
                        <td>
                          <div className="table-cell-stack">
                            <span className="cell-primary">{record.lastActorName || 'Sem tratativa'}</span>
                            <span className="cell-secondary">{record.lastActorRole || 'Perfil nao informado'}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
          <p className="eyebrow">GestÃƒÂ£o do Paciente</p>
          <h1>GestÃƒÂ£o do Paciente</h1>
          <p>Consulte protocolos ativos e cancelados, acompanhe o histÃƒÂ³rico e acesse o cadastro em uma tela dedicada.</p>
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
          <p>REGISTROS NA OPERAÃƒâ€¡ÃƒÆ’O</p>
        </article>
        <article className="kpi-card success">
          <span>ConfirmaÃƒÂ§ÃƒÂµes</span>
          <strong>{grouped.confirmacao || 0}</strong>
          <p>CONTATOS</p>
        </article>
        <article className="kpi-card progress">
          <span>Agendamentos</span>
          <strong>{grouped.agendamento || 0}</strong>
          <p>NOVOS HORÃƒÂRIOS</p>
        </article>
        <article className="kpi-card warning">
          <span>Reagendamentos</span>
          <strong>{grouped.reagendamento || 0}</strong>
          <p>ALTERAÃƒâ€¡Ãƒâ€¢ES</p>
        </article>
        <article className="kpi-card danger">
          <span>Cancelados</span>
          <strong>{cancelledRecords.length}</strong>
          <p>LASTRO DISPONÃƒÂVEL</p>
        </article>
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
              <button type="button" className={activeTab === 'cancelados' ? 'active' : ''} onClick={() => setActiveTab('cancelados')}>
                Cancelados ({cancelledRecords.length})
              </button>
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
                  <th>Data e horÃƒÂ¡rio</th>
                  <th>{activeTab === 'cancelados' ? 'Cancelado por' : 'ÃƒÅ¡ltima tratativa por'}</th>
                  <th>Leitura rÃƒÂ¡pida</th>
                  <th>AÃƒÂ§ÃƒÂ£o</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.protocol}</td>
                    <td>{record.patient}</td>
                    <td>{typeLabels[record.type] || record.type}</td>
                    <td>{record.clinic}</td>
                    <td>{formatDateTime(record.scheduledAt)}</td>
                    <td>
                      {activeTab === 'cancelados'
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
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel patient-modal">
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
                <dt>Data e horÃƒÂ¡rio</dt>
                <dd>{formatDateTime(selectedRecord.scheduledAt)}</dd>
              </div>
            </dl>

            <div className="nps-treatment-relato">
              <strong>ObservaÃƒÂ§ÃƒÂµes do usuÃƒÂ¡rio</strong>
              <p>{selectedRecord.note || 'Sem observaÃƒÂ§ÃƒÂ£o registrada.'}</p>
            </div>

            <div className="row-actions">
              {selectedRecord.status !== 'Cancelado' && (
                <>
                  <button className="outline-action" onClick={() => updateSelectedStatus('Contato realizado', 'Contato realizado')} disabled={saving}>
                    Contato realizado
                  </button>
                  <button className="outline-action" onClick={() => updateSelectedStatus('Confirmado', 'Agenda confirmada')} disabled={saving}>
                    Confirmar
                  </button>
                  <button className="secondary-action" onClick={() => updateSelectedStatus('Reagendar', 'Solicitado reagendamento')} disabled={saving}>
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
                  <small>{item.actor_name || 'UsuÃƒÂ¡rio do sistema'} Ã‚Â· {item.actor_role || 'Perfil nÃƒÂ£o informado'}</small>
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
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel modal-confirm-panel">
            <p className="eyebrow">Cancelar agendamento</p>
            <h2>Tem certeza que deseja excluir?</h2>
            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setShowCancelModal(false)} disabled={saving}>
                Voltar
              </button>
              <button className="outline-action danger-action" type="button" onClick={cancelSelectedRecord} disabled={saving}>
                {saving ? 'Cancelando...' : 'Confirmar exclusÃƒÂ£o'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default PatientManagementPage;

