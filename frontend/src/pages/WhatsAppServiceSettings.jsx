import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api';
import { formatBrazilPhoneInput, isMasterAdmin, readUser } from '../constants';

const emptySession = {
  sessionId: '',
  display_name: '',
  clinic_id: '',
  unit_name: '',
  notes: ''
};

const emptyMessage = {
  sessionId: '',
  patient_phone: '+55',
  message: 'Mensagem de teste enviada pelo sistema CRC.'
};

const statusLabels = {
  conectado: 'Conectado',
  desconectado: 'Desconectado',
  aguardando_qrcode: 'Aguardando QR Code',
  iniciando: 'Iniciando'
};

function statusTone(status) {
  if (status === 'conectado') return 'success';
  if (status === 'aguardando_qrcode' || status === 'iniciando') return 'warning';
  return 'danger';
}

function formatDateTime(value) {
  if (!value) return '-';
  return String(value).slice(0, 16).replace('T', ' ');
}

function WhatsAppServiceSettings() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const [config, setConfig] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [history, setHistory] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [sessionDraft, setSessionDraft] = useState(emptySession);
  const [messageDraft, setMessageDraft] = useState(emptyMessage);
  const [qrModal, setQrModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setFeedback('');
    try {
      const [sessionsRes, historyRes, clinicsRes] = await Promise.all([
        api.get('/api/admin/whatsapp-service/sessions'),
        api.get('/api/admin/whatsapp-service/messages/history?limit=50'),
        api.get('/clinics').catch(() => ({ data: [] }))
      ]);
      setConfig(sessionsRes.data?.config || null);
      const nextSessions = Array.isArray(sessionsRes.data?.sessions) ? sessionsRes.data.sessions : [];
      setSessions(nextSessions);
      setHistory(Array.isArray(historyRes.data) ? historyRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setMessageDraft((current) => ({
        ...current,
        sessionId: current.sessionId || nextSessions[0]?.session_id || ''
      }));
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar as configurações do WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => () => {
    if (qrModal?.imageUrl) URL.revokeObjectURL(qrModal.imageUrl);
  }, [qrModal]);

  const summary = useMemo(() => {
    const connected = sessions.filter((item) => item.status === 'conectado').length;
    const qr = sessions.filter((item) => item.status === 'aguardando_qrcode').length;
    return {
      total: sessions.length,
      connected,
      waitingQr: qr,
      sent: history.filter((item) => item.status === 'enviado').length
    };
  }, [sessions, history]);

  if (!isMasterAdmin(user)) return null;

  const updateSessionDraft = (field, value) => {
    setSessionDraft((current) => ({ ...current, [field]: value }));
  };

  const updateClinic = (clinicId) => {
    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    setSessionDraft((current) => ({
      ...current,
      clinic_id: clinicId,
      display_name: current.display_name || clinic?.name || '',
      unit_name: clinic?.city || current.unit_name || ''
    }));
  };

  const createSession = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback('');
    try {
      const { data } = await api.post('/api/admin/whatsapp-service/sessions', sessionDraft);
      setFeedback(data.warning ? `Sessão salva. Retorno do serviço: ${data.warning}` : 'Sessão criada e inicializada.');
      setSessionDraft(emptySession);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível criar a sessão.');
    } finally {
      setSaving(false);
    }
  };

  const refreshStatus = async (sessionId) => {
    setFeedback('');
    try {
      const { data } = await api.get(`/api/admin/whatsapp-service/sessions/${sessionId}/status`);
      setFeedback(`Status da sessão ${sessionId}: ${statusLabels[data.status] || data.status}.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível verificar o status.');
    }
  };

  const openQr = async (sessionId) => {
    setFeedback('');
    try {
      const response = await api.get(`/api/admin/whatsapp-service/sessions/${sessionId}/qr-image?ts=${Date.now()}`, {
        responseType: 'blob'
      });
      const imageUrl = URL.createObjectURL(response.data);
      if (qrModal?.imageUrl) URL.revokeObjectURL(qrModal.imageUrl);
      setQrModal({
        sessionId,
        imageUrl,
        sourceUrl: (config?.qrRoutePattern || '').replace('{sessionId}', sessionId)
      });
      await refreshStatus(sessionId);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o QR Code.');
    }
  };

  const closeQr = () => {
    if (qrModal?.imageUrl) URL.revokeObjectURL(qrModal.imageUrl);
    setQrModal(null);
  };

  const sendTestMessage = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback('');
    try {
      const { data } = await api.post('/api/admin/whatsapp-service/messages/send', messageDraft);
      setFeedback(data.message || 'Mensagem de teste enviada.');
      setMessageDraft((current) => ({ ...current, patient_phone: '+55', message: emptyMessage.message }));
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar a mensagem de teste.');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-page whatsapp-service-settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>WhatsApp</h1>
          <p>Gerencie sessões do whatsapp-service da VPS, QR Code, status e mensagens de teste por clínica ou unidade.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" type="button" onClick={loadData}>Atualizar</button>
          <button className="outline-action" type="button" onClick={() => navigate('/admin')}>Painel Gerencial</button>
          <button className="outline-action" type="button" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="whatsapp-service-summary">
        <article><span>Sessões</span><strong>{summary.total}</strong><small>Múltiplos números por clínica</small></article>
        <article><span>Conectadas</span><strong>{summary.connected}</strong><small>Status em tempo real via VPS</small></article>
        <article><span>Aguardando QR</span><strong>{summary.waitingQr}</strong><small>Prontas para pareamento</small></article>
        <article><span>Mensagens enviadas</span><strong>{summary.sent}</strong><small>Histórico salvo no banco</small></article>
      </section>

      <section className="whatsapp-service-layout">
        <article className="management-panel whatsapp-service-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Serviço VPS</p>
              <h2>Conexão do whatsapp-service</h2>
            </div>
            <span className={`whatsapp-service-status ${config?.configured ? 'success' : 'danger'}`}>
              {config?.configured ? 'Configurado' : 'Pendente'}
            </span>
          </div>
          <div className="whatsapp-service-config-list">
            <p><span>Base URL</span><strong>{config?.baseUrl || 'http://2.24.101.6:3005'}</strong></p>
            <p><span>API Key</span><strong>{config?.apiKeyConfigured ? 'Configurada no backend' : 'Ausente no backend'}</strong></p>
            <p><span>Rota QR Code</span><strong>{config?.qrRoutePattern || 'http://2.24.101.6:3005/public/sessions/{sessionId}/qr-image'}</strong></p>
          </div>
          {!config?.apiKeyConfigured && (
            <p className="whatsapp-service-warning">
              Configure `WHATSAPP_SERVICE_API_KEY` no backend para consultar status e enviar mensagens usando o header `x-api-key`.
            </p>
          )}
        </article>

        <form className="management-panel whatsapp-service-card" onSubmit={createSession}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Nova sessão</p>
              <h2>Criar sessionId</h2>
            </div>
          </div>
          <div className="whatsapp-service-form-grid">
            <label>SessionId<input className="field" value={sessionDraft.sessionId} onChange={(event) => updateSessionDraft('sessionId', event.target.value)} placeholder="ex.: crc-anapolis-01" required /></label>
            <label>Nome de exibição<input className="field" value={sessionDraft.display_name} onChange={(event) => updateSessionDraft('display_name', event.target.value)} placeholder="CRC Anápolis" /></label>
            <label>Clínica<select className="field" value={sessionDraft.clinic_id} onChange={(event) => updateClinic(event.target.value)}><option value="">Sem vínculo</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
            <label>Unidade<input className="field" value={sessionDraft.unit_name} onChange={(event) => updateSessionDraft('unit_name', event.target.value)} placeholder="Cidade/unidade" /></label>
          </div>
          <label>Observações<textarea className="field textarea" value={sessionDraft.notes} onChange={(event) => updateSessionDraft('notes', event.target.value)} /></label>
          <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar sessão'}</button>
        </form>
      </section>

      <section className="management-panel whatsapp-service-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sessões</p>
            <h2>WhatsApps cadastrados</h2>
          </div>
        </div>
        {loading ? <p className="empty-state">Carregando sessões...</p> : (
          <div className="whatsapp-service-table-wrap">
            <table className="whatsapp-service-table">
              <thead>
                <tr><th>Sessão</th><th>Clínica / Unidade</th><th>Status</th><th>Mensagens</th><th>Última verificação</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id}>
                    <td><strong>{session.display_name || session.session_id}</strong><small>{session.session_id}</small></td>
                    <td><strong>{session.clinic_name || '-'}</strong><small>{session.unit_name || '-'}</small></td>
                    <td>
                      <span className={`whatsapp-service-status ${statusTone(session.status)}`}>{statusLabels[session.status] || session.status}</span>
                      {session.status_error && <small className="whatsapp-service-error">{session.status_error}</small>}
                    </td>
                    <td>{Number(session.message_count || 0).toLocaleString('pt-BR')}</td>
                    <td>{formatDateTime(session.last_status_check_at)}</td>
                    <td>
                      <div className="whatsapp-service-row-actions">
                        <button className="outline-action mini-action" type="button" onClick={() => openQr(session.session_id)}>QR Code</button>
                        <button className="outline-action mini-action" type="button" onClick={() => refreshStatus(session.session_id)}>Status</button>
                        <button className="outline-action mini-action" type="button" onClick={() => setMessageDraft((current) => ({ ...current, sessionId: session.session_id }))}>Usar no teste</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!sessions.length && <tr><td colSpan="6"><p className="empty-state">Nenhuma sessão cadastrada.</p></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="whatsapp-service-layout">
        <form className="management-panel whatsapp-service-card" onSubmit={sendTestMessage}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Teste operacional</p>
              <h2>Enviar mensagem de teste</h2>
            </div>
          </div>
          <div className="whatsapp-service-form-grid">
            <label>Sessão<select className="field" value={messageDraft.sessionId} onChange={(event) => setMessageDraft((current) => ({ ...current, sessionId: event.target.value }))} required><option value="">Selecione</option>{sessions.map((session) => <option key={session.session_id} value={session.session_id}>{session.display_name || session.session_id}</option>)}</select></label>
            <label>Número do paciente<input className="field" value={messageDraft.patient_phone} onChange={(event) => setMessageDraft((current) => ({ ...current, patient_phone: formatBrazilPhoneInput(event.target.value) }))} placeholder="+5562999999999" required /></label>
          </div>
          <label>Mensagem<textarea className="field textarea" value={messageDraft.message} onChange={(event) => setMessageDraft((current) => ({ ...current, message: event.target.value }))} required /></label>
          <button className="primary-action" type="submit" disabled={saving || !config?.configured}>{saving ? 'Enviando...' : 'Enviar mensagem de teste'}</button>
        </form>

        <article className="management-panel whatsapp-service-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Histórico</p>
              <h2>Últimas mensagens</h2>
            </div>
          </div>
          <div className="whatsapp-service-history">
            {history.map((item) => (
              <p key={item.id}>
                <span><strong>{item.session_id}</strong><small>{item.patient_phone} · {formatDateTime(item.created_at)}</small></span>
                <em className={`whatsapp-service-status ${item.status === 'enviado' ? 'success' : item.status === 'erro' ? 'danger' : 'warning'}`}>{item.status}</em>
              </p>
            ))}
            {!history.length && <p className="empty-state">Nenhuma mensagem enviada ainda.</p>}
          </div>
        </article>
      </section>

      {qrModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeQr}>
          <section className="modal-panel whatsapp-service-qr-modal" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">QR Code</p>
            <h2>{qrModal.sessionId}</h2>
            <img src={qrModal.imageUrl} alt={`QR Code da sessão ${qrModal.sessionId}`} />
            <small>{qrModal.sourceUrl}</small>
            <button className="primary-action" type="button" onClick={closeQr}>Fechar</button>
          </section>
        </div>
      )}
    </main>
  );
}

export default WhatsAppServiceSettings;
