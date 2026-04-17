import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';

const initialForm = {
  patient: '',
  phone: '+55',
  channel: 'whatsapp',
  channelOther: '',
  clinic: '',
  type: 'confirmacao',
  scheduledAt: '',
  note: ''
};

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
  outros: 'Outros'
};

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

function PatientManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname.includes('/dashboard');
  const [form, setForm] = useState(initialForm);
  const [records, setRecords] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a gestão do paciente.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const grouped = useMemo(() => records.reduce((acc, record) => {
    acc[record.type] = (acc[record.type] || 0) + 1;
    return acc;
  }, {}), [records]);

  const channelGrouped = useMemo(() => records.reduce((acc, record) => {
    acc[record.channel] = (acc[record.channel] || 0) + 1;
    return acc;
  }, {}), [records]);

  const statusGrouped = useMemo(() => records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {}), [records]);

  const byType = useMemo(() => groupCount(records, (record) => typeLabels[record.type] || record.type), [records]);
  const byChannel = useMemo(() => groupCount(records, (record) => channelLabels[record.channel] || record.channel), [records]);
  const byClinic = useMemo(() => groupCount(records, (record) => record.clinic).slice(0, 10), [records]);
  const byStatus = useMemo(() => groupCount(records, (record) => record.status), [records]);
  const nextRecords = useMemo(() => records
    .filter((record) => record.scheduledAt)
    .slice()
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, 10), [records]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
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

    try {
      if (form.channel === 'outros' && !form.channelOther.trim()) {
        setFeedback('Informe o canal de entrada quando selecionar Outros.');
        setSaving(false);
        return;
      }

      const payload = {
        ...form,
        channel: form.channel === 'outros' ? form.channelOther.trim() : form.channel
      };
      delete payload.channelOther;

      await api.post('/patient-interactions', payload);
      setForm(initialForm);
      await loadRecords();
      setFeedback('Movimento do paciente salvo com rastreabilidade.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o movimento.');
    } finally {
      setSaving(false);
    }
  };

  const updateSelectedStatus = async (status, action) => {
    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/patient-interactions/${selectedRecord.id}`, { status, action });
      const data = await loadRecords();
      setSelectedRecord(data.find((record) => record.id === selectedRecord.id) || null);
      setFeedback('Movimento atualizado com histórico.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar o movimento.');
    } finally {
      setSaving(false);
    }
  };

  if (isDashboard) {
    return (
      <main className="app-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Dashboard do Paciente</p>
            <h1>BI de confirmações, agendamentos e reagendamentos</h1>
            <p>Acompanhe volume por tipo, canal, unidade, status e próximos contatos.</p>
          </div>

          <div className="heading-actions">
            <button className="outline-action" onClick={() => navigate('/pacientes')}>Gestão do Paciente</button>
            <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
          </div>
        </header>

        {feedback && <p className="form-feedback">{feedback}</p>}

        <section className="kpi-grid management-kpi-grid" aria-label="Resumo do paciente">
          <article className="kpi-card">
            <span>Total</span>
            <strong>{records.length}</strong>
            <p>REGISTROS</p>
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
          <article className="kpi-card">
            <span>Encerrados</span>
            <strong>{statusGrouped.Encerrado || 0}</strong>
            <p>FINALIZADOS</p>
          </article>
        </section>

        {loading ? (
          <section className="management-panel">
            <p className="empty-state">Carregando dashboard do paciente...</p>
          </section>
        ) : (
          <>
            <section className="chart-grid patient-dashboard-grid">
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

            <section className="management-panel dashboard-base-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Base filtrada</p>
                  <h2>Próximos movimentos do paciente</h2>
                </div>
              </div>

              <div className="data-table-wrap dashboard-table-wrap">
                <table className="data-table dashboard-clean-table">
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th>Tipo</th>
                      <th>Canal</th>
                      <th>Unidade</th>
                      <th>Status</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nextRecords.map((record) => (
                      <tr key={record.id}>
                        <td>{record.patient}</td>
                        <td>{typeLabels[record.type] || record.type}</td>
                        <td>{channelLabels[record.channel] || record.channel}</td>
                        <td>{record.clinic}</td>
                        <td>{record.status}</td>
                        <td>{formatDateTime(record.scheduledAt)}</td>
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
          <p className="eyebrow">Gestão do Paciente</p>
          <h1>Confirmação, agendamento e reagendamento</h1>
          <p>Registre contatos e movimentos do paciente com histórico operacional.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/pacientes/dashboard')}>Dashboard do Paciente</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="kpi-grid nps-kpi-grid">
        <article className="kpi-card">
          <span>Total</span>
          <strong>{records.length}</strong>
          <p>REGISTROS NA SESSÃO</p>
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
        <article className="kpi-card">
          <span>WhatsApp</span>
          <strong>{channelGrouped.whatsapp || 0}</strong>
          <p>CANAL DE ENTRADA</p>
        </article>
      </section>

      <section className="management-panel patient-management-grid">
        <form className="public-form" onSubmit={saveRecord}>
          <div>
            <p className="eyebrow">Novo registro</p>
            <h2>Movimento do paciente</h2>
          </div>

          <label>
            Paciente
            <input className="field" value={form.patient} onChange={(event) => updateForm('patient', event.target.value)} required />
          </label>
          <label>
              Telefone com WhatsApp
            <input className="field" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} required />
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
            Data e horário
            <input className="field" type="datetime-local" value={form.scheduledAt} onChange={(event) => updateForm('scheduledAt', event.target.value)} required />
          </label>
          <label>
            Observação
            <textarea className="field textarea" value={form.note} onChange={(event) => updateForm('note', event.target.value)} />
          </label>

          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar movimento'}
          </button>
        </form>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Tipo</th>
                <th>Canal</th>
                <th>Unidade</th>
                <th>Data</th>
                <th>Registro</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {!loading && records.map((record) => (
                <tr key={record.id}>
                  <td>{record.patient}</td>
                  <td>{typeLabels[record.type]}</td>
                  <td>{channelLabels[record.channel] || record.channel}</td>
                  <td>{record.clinic}</td>
                  <td>{record.scheduledAt}</td>
                  <td>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(record.createdAt))}</td>
                  <td>
                    <button className="outline-action compact-action" onClick={() => setSelectedRecord(record)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && <p className="empty-state">Carregando movimentos do paciente...</p>}
          {!loading && records.length === 0 && <p className="empty-state">Nenhum movimento registrado.</p>}
        </div>
      </section>

      {selectedRecord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel patient-modal">
            <div className="nps-modal-title">
              <div>
                <p className="eyebrow">Ficha do paciente</p>
                <h2>{selectedRecord.patient}</h2>
              </div>
              <span className="mini-badge">{selectedRecord.status}</span>
            </div>

            <dl className="meta-grid">
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
                <dd>{typeLabels[selectedRecord.type]}</dd>
              </div>
              <div>
                <dt>Data</dt>
                <dd>{selectedRecord.scheduledAt}</dd>
              </div>
            </dl>

            <div className="nps-treatment-relato">
              <strong>Observação</strong>
              <p>{selectedRecord.note || 'Sem observação registrada.'}</p>
            </div>

            <div className="row-actions">
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
            </div>

            <div className="history-list">
              {(selectedRecord.history || []).map((item, index) => (
                <article className="history-item" key={`${item.at}-${index}`}>
                  <div className="history-item-head">
                    <strong>{item.action}</strong>
                    <span>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.at))}</span>
                  </div>
                  <small>{item.actor_name || 'Usuário do sistema'} · {item.actor_role || 'Perfil não informado'}</small>
                  <p>{item.note}</p>
                </article>
              ))}
            </div>

            <div className="heading-actions">
              <button className="outline-action" onClick={() => setSelectedRecord(null)}>Fechar</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default PatientManagement;
