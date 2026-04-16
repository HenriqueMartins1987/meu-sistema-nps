import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';

const initialForm = {
  patient: '',
  phone: '+55',
  channel: 'whatsapp',
  clinic: '',
  type: 'confirmacao',
  scheduledAt: '',
  note: ''
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

function PatientManagement() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [records, setRecords] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const res = await api.get('/patient-interactions');
      const data = Array.isArray(res.data) ? res.data : [];
      setRecords(data);
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

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveRecord = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback('');

    try {
      await api.post('/patient-interactions', form);
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
            Telefone com WhatsApp <span className="whatsapp-symbol">☎</span>
            <input className="field" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} required />
          </label>
          <label>
            Canal de entrada
            <select className="field" value={form.channel} onChange={(event) => updateForm('channel', event.target.value)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="telefone">Telefone</option>
              <option value="email">E-mail</option>
              <option value="presencial">Presencial</option>
              <option value="site">Site</option>
              <option value="outros">Outros</option>
            </select>
          </label>
          <label>
            Unidade
            <input className="field" value={form.clinic} onChange={(event) => updateForm('clinic', event.target.value)} required />
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
