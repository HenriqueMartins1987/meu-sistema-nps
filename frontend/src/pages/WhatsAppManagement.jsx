import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import api from '../api';
import { hasPermission, isMasterAdmin, readUser } from '../constants';

const sections = [
  { id: 'dashboard', label: 'Dashboard', path: '/home/whatsapp-management/dashboard' },
  { id: 'instances', label: 'Instâncias', path: '/home/whatsapp-management/instances' },
  { id: 'attendance', label: 'Atendimento', path: '/home/whatsapp-management/attendance' },
  { id: 'send', label: 'Envio manual', path: '/home/whatsapp-management/send' },
  { id: 'templates', label: 'Mensagens padrão', path: '/home/whatsapp-management/templates' },
  { id: 'chatbot', label: 'Chatbot', path: '/home/whatsapp-management/chatbot' },
  { id: 'absent', label: 'Ausentes', path: '/home/whatsapp-management/absent' },
  { id: 'history', label: 'Histórico', path: '/home/whatsapp-management/history' },
  { id: 'reports', label: 'Relatórios', path: '/home/whatsapp-management/reports' }
];

const sectors = ['CRC', 'SAC', 'Comercial', 'NPS', 'Reclamações', 'Pós-venda', 'Dentistas Parceiros'];
const attendanceStatuses = ['Novo', 'Em atendimento', 'Aguardando paciente', 'Agendado', 'Compareceu', 'Não compareceu', 'Ausente', 'Retornar depois', 'Encerrado', 'Reclamação', 'NPS', 'Urgente'];
const absentStatuses = ['Ausente primeira tentativa', 'Ausente segunda tentativa', 'Ausente terceira tentativa', 'Sem retorno', 'Retornar em 12h', 'Retornar em 24h', 'Retornar em 48h', 'Encerrado sem contato', 'Recuperado'];
const templateCategories = ['Primeiro contato', 'Confirmação de consulta', 'Lembrete de avaliação', 'Retorno de ausente', 'NPS', 'Reclamação', 'Pós-atendimento', 'Reagendamento', 'Cobrança', 'Dentista parceiro', 'Campanha comercial'];
const triggerTypes = ['palavra-chave', 'novo lead', 'paciente ausente', 'NPS', 'reclamação', 'confirmação de consulta', 'lembrete', 'pós-atendimento'];
const COLORS = ['#4c956c', '#d4a764', '#c44536', '#1f7a8c', '#8e6731', '#5d6d7e'];

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits.slice(0, 13);
  return `55${digits}`.slice(0, 13);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function statusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text.includes('erro') || text.includes('venc') || text.includes('desconect') || text.includes('urgente')) return 'danger';
  if (text.includes('pend') || text.includes('aguard') || text.includes('retornar') || text.includes('ausente')) return 'warning';
  if (text.includes('conect') || text.includes('lida') || text.includes('recuper') || text.includes('agend')) return 'success';
  return 'neutral';
}

function emptyInstance() {
  return { instance_name: '', display_name: '', sector: 'CRC', clinic_id: '', unit_name: '', phone_number: '', notes: '' };
}

function emptyTemplate() {
  return {
    title: '',
    category: 'Primeiro contato',
    sector: 'CRC',
    message_text: 'Olá, {{nome_paciente}}! Tudo bem?\nAqui é {{nome_operador}}, do Grupo Sorria Goiás.',
    variables: ['nome_paciente', 'clinica', 'nome_operador'],
    status: 'ativo'
  };
}

function emptySend(user) {
  return {
    instance_name: '',
    patient_phone: '',
    patient_name: '',
    clinic_id: '',
    unit_name: '',
    operator_name: user?.name || '',
    message_type: 'manual',
    template_id: '',
    message_text: '',
    notes: ''
  };
}

function emptyFlow() {
  return {
    flow_name: '',
    instance_name: '',
    sector: 'CRC',
    trigger_type: 'palavra-chave',
    trigger_value: '',
    initial_message: '',
    status: 'ativo',
    steps: []
  };
}

function parseTemplateVariables(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function exportCsv(filename, rows = []) {
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const csv = [
    keys.join(';'),
    ...rows.map((row) => keys.map((key) => `"${String(row?.[key] ?? '').replace(/"/g, '""')}"`).join(';'))
  ].join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ChartCard({ title, children, className = '' }) {
  return (
    <article className={`whatsapp-chart-card ${className}`}>
      <header><strong>{title}</strong></header>
      <div>{children}</div>
    </article>
  );
}

function WhatsAppManagement() {
  const navigate = useNavigate();
  const { section } = useParams();
  const user = useMemo(() => readUser(), []);
  const currentSection = sections.some((item) => item.id === section) ? section : 'dashboard';
  const canConfigure = isMasterAdmin(user) || ['admin', 'manager', 'supervisor_crc'].includes(String(user?.role || ''));
  const allowed = hasPermission(user, 'whatsapp_management');

  const [dashboard, setDashboard] = useState(null);
  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [absent, setAbsent] = useState([]);
  const [history, setHistory] = useState([]);
  const [flows, setFlows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [instanceDraft, setInstanceDraft] = useState(emptyInstance());
  const [templateDraft, setTemplateDraft] = useState(emptyTemplate());
  const [sendDraft, setSendDraft] = useState(emptySend(user));
  const [flowDraft, setFlowDraft] = useState(emptyFlow());
  const [attendanceMessage, setAttendanceMessage] = useState('');
  const [historyFilters, setHistoryFilters] = useState({ startDate: todayDate(), endDate: todayDate(), status: '', patient: '' });
  const [qrResult, setQrResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const selectedConversation = useMemo(
    () => conversations.find((item) => String(item.id) === String(selectedConversationId)) || conversations[0] || null,
    [conversations, selectedConversationId]
  );

  const loadBaseData = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setFeedback('');
    try {
      const [dashboardRes, instancesRes, templatesRes, conversationsRes, absentRes, historyRes, flowsRes, clinicsRes] = await Promise.all([
        api.get('/api/whatsapp/dashboard'),
        api.get('/api/whatsapp/instances'),
        api.get('/api/whatsapp/templates'),
        api.get('/api/whatsapp/conversations'),
        api.get('/api/whatsapp/absent'),
        api.get('/api/whatsapp/history', { params: historyFilters }),
        api.get('/api/whatsapp/chatbot/flows'),
        api.get('/clinics').catch(() => ({ data: [] }))
      ]);
      setDashboard(dashboardRes.data || null);
      setInstances(Array.isArray(instancesRes.data) ? instancesRes.data : []);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
      setConversations(Array.isArray(conversationsRes.data) ? conversationsRes.data : []);
      setAbsent(Array.isArray(absentRes.data) ? absentRes.data : []);
      setHistory(Array.isArray(historyRes.data) ? historyRes.data : []);
      setFlows(Array.isArray(flowsRes.data) ? flowsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a Gestão WhatsApp CRC.');
    } finally {
      setLoading(false);
    }
  }, [allowed, historyFilters]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    try {
      const { data } = await api.get(`/api/whatsapp/conversations/${conversationId}/messages`);
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar as mensagens.');
    }
  }, []);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    if (!allowed) return undefined;
    const refreshTimer = window.setInterval(() => {
      loadBaseData();
      if (selectedConversationId) loadMessages(selectedConversationId);
    }, 60000);
    return () => window.clearInterval(refreshTimer);
  }, [allowed, loadBaseData, loadMessages, selectedConversationId]);

  useEffect(() => {
    if (selectedConversation?.id) {
      setSelectedConversationId(String(selectedConversation.id));
      loadMessages(selectedConversation.id);
    }
  }, [selectedConversation?.id, loadMessages]);

  const saveInstance = async () => {
    setSaving(true);
    setFeedback('');
    try {
      const payload = { ...instanceDraft, phone_number: normalizePhone(instanceDraft.phone_number) };
      const { data } = await api.post('/api/whatsapp/instances', payload);
      setFeedback(data?.warning ? `Instância salva, mas Evolution retornou: ${data.warning}` : 'Instância criada com sucesso.');
      setInstanceDraft(emptyInstance());
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível criar a instância.');
    } finally {
      setSaving(false);
    }
  };

  const checkInstanceStatus = async (instanceName) => {
    try {
      const { data } = await api.get(`/api/whatsapp/instances/${instanceName}/status`);
      setFeedback(`Status atualizado: ${data.status || 'verificado'}.`);
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível verificar o status.');
    }
  };

  const generateQrCode = async (instanceName) => {
    try {
      const { data } = await api.get(`/api/whatsapp/instances/${instanceName}/qrcode`);
      setQrResult({ instanceName, data });
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível gerar o QR Code.');
    }
  };

  const logoutInstance = async (instanceName) => {
    try {
      const { data } = await api.post(`/api/whatsapp/instances/${instanceName}/logout`);
      setFeedback(data?.warning ? `Instância desconectada com alerta: ${data.warning}` : 'Instância desconectada.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível desconectar.');
    }
  };

  const deleteInstance = async (instanceName) => {
    if (!window.confirm(`Excluir a instância ${instanceName}?`)) return;
    try {
      await api.delete(`/api/whatsapp/instances/${instanceName}`);
      setFeedback('Instância excluída.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir.');
    }
  };

  const testInstanceMessage = async (instanceName) => {
    const phone = window.prompt('Informe o telefone para mensagem teste com DDI e DDD:', '');
    const patientPhone = normalizePhone(phone);
    if (!patientPhone) return;
    try {
      await api.post('/api/whatsapp/send', {
        instance_name: instanceName,
        patient_phone: patientPhone,
        patient_name: 'Teste operacional',
        message_type: 'teste',
        message_text: 'Envio de mensagem teste'
      });
      setFeedback('Mensagem teste enviada e registrada.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar a mensagem teste.');
    }
  };

  const saveTemplate = async () => {
    setSaving(true);
    setFeedback('');
    try {
      await api.post('/api/whatsapp/templates', templateDraft);
      setTemplateDraft(emptyTemplate());
      setFeedback('Mensagem padrão salva.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar a mensagem padrão.');
    } finally {
      setSaving(false);
    }
  };

  const duplicateTemplate = (template) => {
    setTemplateDraft({
      title: `${template.title} - cópia`,
      category: template.category || 'Primeiro contato',
      sector: template.sector || 'CRC',
      message_text: template.message_text || '',
      variables: parseTemplateVariables(template.variables),
      status: 'ativo'
    });
  };

  const deleteTemplate = async (templateId) => {
    if (!window.confirm('Excluir esta mensagem padrão?')) return;
    try {
      await api.delete(`/api/whatsapp/templates/${templateId}`);
      setFeedback('Mensagem padrão excluída.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir a mensagem.');
    }
  };

  const sendManualMessage = async (draft = sendDraft) => {
    setSaving(true);
    setFeedback('');
    try {
      const payload = { ...draft, patient_phone: normalizePhone(draft.patient_phone) };
      if (payload.template_id) {
        await api.post('/api/whatsapp/send-template', {
          ...payload,
          template_id: payload.template_id,
          variables: {
            nome_paciente: payload.patient_name,
            clinica: payload.clinic_name,
            nome_operador: payload.operator_name || user?.name
          }
        });
      } else {
        await api.post('/api/whatsapp/send', payload);
      }
      setFeedback('Mensagem enviada e registrada no histórico.');
      setSendDraft(emptySend(user));
      setAttendanceMessage('');
      await loadBaseData();
      if (selectedConversation?.id) await loadMessages(selectedConversation.id);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar a mensagem.');
    } finally {
      setSaving(false);
    }
  };

  const updateConversation = async (conversation, changes) => {
    if (!conversation) return;
    try {
      await api.put(`/api/whatsapp/conversations/${conversation.id}`, { ...conversation, ...changes });
      setFeedback('Atendimento atualizado.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar o atendimento.');
    }
  };

  const markAbsent = async (conversation) => {
    if (!conversation) return;
    try {
      await api.post('/api/whatsapp/absent', {
        conversation_id: conversation.id,
        patient_name: conversation.patient_name,
        patient_phone: conversation.patient_phone,
        clinic_id: conversation.clinic_id,
        clinic_name: conversation.clinic_name,
        reason: 'Paciente sem resposta',
        operator_id: conversation.operator_id,
        operator_name: conversation.operator_name,
        status: 'Ausente primeira tentativa'
      });
      setFeedback('Paciente marcado como ausente.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível marcar ausente.');
    }
  };

  const updateAbsentStatus = async (item, status) => {
    try {
      await api.put(`/api/whatsapp/absent/${item.id}`, { ...item, status });
      setFeedback('Paciente ausente atualizado.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar o paciente ausente.');
    }
  };

  const saveFlow = async () => {
    setSaving(true);
    setFeedback('');
    try {
      await api.post('/api/whatsapp/chatbot/flows', flowDraft);
      setFlowDraft(emptyFlow());
      setFeedback('Fluxo salvo.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o fluxo.');
    } finally {
      setSaving(false);
    }
  };

  const startAbsentReturn = (item) => {
    setSendDraft((current) => ({
      ...current,
      patient_name: item.patient_name,
      patient_phone: item.patient_phone,
      clinic_id: item.clinic_id || '',
      clinic_name: item.clinic_name || ''
    }));
    navigate('/home/whatsapp-management/send');
  };

  const renderDashboard = () => {
    const summary = dashboard?.summary || {};
    const cards = [
      ['WhatsApps conectados', summary.activeInstances, `${summary.totalInstances || 0} cadastrado(s)`, summary.disconnectedInstances ? 'warning' : 'success'],
      ['Mensagens enviadas hoje', summary.sentToday, 'Saída operacional', 'success'],
      ['Mensagens recebidas hoje', summary.receivedToday, 'Entrada de pacientes', 'neutral'],
      ['Respondidas', summary.answered, `${formatPercent(summary.responseRate)} taxa de resposta`, summary.responseRate >= 70 ? 'success' : 'warning'],
      ['Aguardando resposta', summary.waitingPatients, 'Fila operacional', summary.waitingPatients > 10 ? 'danger' : 'warning'],
      ['Pacientes ausentes', summary.absentPatients, 'Recuperação ativa', summary.absentPatients > 0 ? 'warning' : 'success'],
      ['SLA vencido', summary.slaExpired, `${summary.slaOk || 0} dentro do prazo`, summary.slaExpired > 0 ? 'danger' : 'success'],
      ['Taxa de leitura', formatPercent(summary.readRate), `${formatPercent(summary.errorRate)} erro`, summary.errorRate > 3 ? 'danger' : 'success']
    ];

    return (
      <>
        <section className="whatsapp-kpi-grid">
          {cards.map(([label, value, detail, tone]) => (
            <article className={`whatsapp-kpi ${tone}`} key={label}>
              <span>{label}</span>
              <strong>{typeof value === 'number' ? formatNumber(value) : value}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </section>
        <section className="whatsapp-chart-grid">
          <ChartCard title="Mensagens por dia" className="wide">
            <ResponsiveContainer><LineChart data={dashboard?.charts?.messagesByDay || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Line type="monotone" dataKey="messages" name="Mensagens" stroke="#1f7a8c" strokeWidth={3} /></LineChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Mensagens por operador">
            <ResponsiveContainer><BarChart data={dashboard?.charts?.messagesByOperator || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="messages" fill="#d4a764" /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Mensagens por instância">
            <ResponsiveContainer><BarChart data={dashboard?.charts?.messagesByInstance || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="messages" fill="#4c956c" /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Atendimentos por status">
            <ResponsiveContainer><PieChart><Pie data={dashboard?.charts?.attendanceByStatus || []} dataKey="attendances" nameKey="label" outerRadius={92}>{(dashboard?.charts?.attendanceByStatus || []).map((entry, index) => <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Ranking de operadores">
            <div className="whatsapp-ranking-list">{(dashboard?.charts?.rankingOperators || []).map((item, index) => <p key={item.label}><span>{index + 1}. {item.label}</span><strong>{item.messages}</strong></p>)}</div>
          </ChartCard>
        </section>
      </>
    );
  };

  const renderInstances = () => (
    <section className="whatsapp-two-column">
      {canConfigure && (
        <article className="whatsapp-panel">
          <h2>Nova instância</h2>
          <div className="whatsapp-form-grid">
            <label>Nome da instância<input className="field" value={instanceDraft.instance_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, instance_name: event.target.value }))} /></label>
            <label>Nome de exibição<input className="field" value={instanceDraft.display_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
            <label>Setor<select className="field" value={instanceDraft.sector} onChange={(event) => setInstanceDraft((current) => ({ ...current, sector: event.target.value }))}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Clínica<select className="field" value={instanceDraft.clinic_id} onChange={(event) => setInstanceDraft((current) => ({ ...current, clinic_id: event.target.value }))}><option value="">Sem vínculo</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
            <label>Unidade<input className="field" value={instanceDraft.unit_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
            <label>Número WhatsApp<input className="field" value={instanceDraft.phone_number} onChange={(event) => setInstanceDraft((current) => ({ ...current, phone_number: normalizePhone(event.target.value) }))} placeholder="5562999999999" /></label>
          </div>
          <label>Observações<textarea className="field textarea" value={instanceDraft.notes} onChange={(event) => setInstanceDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <button className="primary-action" onClick={saveInstance} disabled={saving}>Criar instância</button>
        </article>
      )}
      <article className="whatsapp-panel">
        <h2>WhatsApps conectados</h2>
        <div className="whatsapp-table-wrap">
          <table className="whatsapp-table">
            <thead><tr><th>Instância</th><th>Número</th><th>Setor</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {instances.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.display_name || item.instance_name}</strong><small>{item.instance_name}</small></td>
                  <td>{item.phone_number || '-'}</td>
                  <td>{item.sector || '-'}</td>
                  <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></td>
                  <td><div className="whatsapp-row-actions">
                    <button className="outline-action mini-action" onClick={() => checkInstanceStatus(item.instance_name)}>Status</button>
                    {canConfigure && <button className="outline-action mini-action" onClick={() => generateQrCode(item.instance_name)}>QR Code</button>}
                    <button className="outline-action mini-action" onClick={() => testInstanceMessage(item.instance_name)}>Teste</button>
                    {canConfigure && <button className="outline-action mini-action" onClick={() => logoutInstance(item.instance_name)}>Desconectar</button>}
                    {canConfigure && <button className="outline-action danger-action mini-action" onClick={() => deleteInstance(item.instance_name)}>Excluir</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );

  const renderAttendance = () => (
    <section className="whatsapp-attendance-layout">
      <aside className="whatsapp-conversation-list">
        <h2>Conversas</h2>
        {conversations.map((conversation) => (
          <button key={conversation.id} className={String(selectedConversation?.id) === String(conversation.id) ? 'active' : ''} onClick={() => setSelectedConversationId(String(conversation.id))}>
            <strong>{conversation.patient_name}</strong>
            <span>{conversation.patient_phone}</span>
            <em>{conversation.status}</em>
          </button>
        ))}
      </aside>
      <article className="whatsapp-chat-panel">
        <header>
          <div>
            <span>Atendimento</span>
            <strong>{selectedConversation?.patient_name || 'Selecione uma conversa'}</strong>
          </div>
          {selectedConversation && <span className={`whatsapp-badge ${statusTone(selectedConversation.status)}`}>{selectedConversation.status}</span>}
        </header>
        <div className="whatsapp-message-thread">
          {messages.map((message) => (
            <div key={message.id} className={`whatsapp-message-bubble ${message.direction === 'inbound' ? 'inbound' : 'outbound'}`}>
              <p>{message.message_text}</p>
              <small>{message.operator_name || message.direction} · {String(message.created_at || '').slice(0, 16).replace('T', ' ')}</small>
            </div>
          ))}
          {!messages.length && <p className="empty-state">Sem mensagens registradas.</p>}
        </div>
        {selectedConversation && (
          <div className="whatsapp-chat-composer">
            <textarea className="field textarea" value={attendanceMessage} onChange={(event) => setAttendanceMessage(event.target.value)} placeholder="Digite a resposta ao paciente" />
            <div className="row-actions">
              <select className="field" onChange={(event) => {
                const template = templates.find((item) => String(item.id) === event.target.value);
                if (template) setAttendanceMessage(template.message_text);
              }}>
                <option value="">Mensagem padrão</option>
                {templates.filter((item) => item.status === 'ativo').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <button className="primary-action" onClick={() => sendManualMessage({ ...sendDraft, conversation_id: selectedConversation.id, instance_name: selectedConversation.instance_name || instances[0]?.instance_name, patient_phone: selectedConversation.patient_phone, patient_name: selectedConversation.patient_name, message_text: attendanceMessage })}>Enviar</button>
            </div>
          </div>
        )}
      </article>
      <aside className="whatsapp-patient-panel">
        <h2>Paciente</h2>
        {selectedConversation ? (
          <>
            <p><span>Nome</span><strong>{selectedConversation.patient_name}</strong></p>
            <p><span>Telefone</span><strong>{selectedConversation.patient_phone}</strong></p>
            <p><span>Clínica</span><strong>{selectedConversation.clinic_name || '-'}</strong></p>
            <p><span>Operador</span><strong>{selectedConversation.operator_name || '-'}</strong></p>
            <label>Status<select className="field" value={selectedConversation.status} onChange={(event) => updateConversation(selectedConversation, { status: event.target.value })}>{attendanceStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Próximo retorno<input className="field" type="datetime-local" onBlur={(event) => updateConversation(selectedConversation, { next_follow_up_at: event.target.value })} /></label>
            <div className="whatsapp-quick-actions">
              <button className="outline-action" onClick={() => markAbsent(selectedConversation)}>Marcar ausente</button>
              <button className="outline-action" onClick={() => updateConversation(selectedConversation, { status: 'Retornar depois' })}>Retornar depois</button>
              <button className="primary-action" onClick={() => updateConversation(selectedConversation, { status: 'Encerrado' })}>Finalizar</button>
              <a className="outline-action" href={`https://wa.me/${selectedConversation.patient_phone}`} target="_blank" rel="noreferrer">WhatsApp externo</a>
            </div>
          </>
        ) : <p className="empty-state">Selecione uma conversa.</p>}
      </aside>
    </section>
  );

  const renderSend = () => (
    <section className="whatsapp-panel">
      <h2>Envio manual</h2>
      <div className="whatsapp-form-grid">
        <label>WhatsApp de envio<select className="field" value={sendDraft.instance_name} onChange={(event) => setSendDraft((current) => ({ ...current, instance_name: event.target.value }))}><option value="">Selecione</option>{instances.map((item) => <option key={item.id} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}</select></label>
        <label>Número do paciente<input className="field" value={sendDraft.patient_phone} onChange={(event) => setSendDraft((current) => ({ ...current, patient_phone: normalizePhone(event.target.value) }))} placeholder="5562999999999" /></label>
        <label>Nome do paciente<input className="field" value={sendDraft.patient_name} onChange={(event) => setSendDraft((current) => ({ ...current, patient_name: event.target.value }))} /></label>
        <label>Clínica<select className="field" value={sendDraft.clinic_id} onChange={(event) => setSendDraft((current) => ({ ...current, clinic_id: event.target.value, clinic_name: clinics.find((clinic) => String(clinic.id) === event.target.value)?.name || '' }))}><option value="">Selecione</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Mensagem padrão<select className="field" value={sendDraft.template_id} onChange={(event) => {
          const template = templates.find((item) => String(item.id) === event.target.value);
          setSendDraft((current) => ({ ...current, template_id: event.target.value, message_text: template?.message_text || current.message_text }));
        }}><option value="">Mensagem livre</option>{templates.filter((item) => item.status === 'ativo').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Operador responsável<input className="field" value={sendDraft.operator_name} onChange={(event) => setSendDraft((current) => ({ ...current, operator_name: event.target.value }))} /></label>
      </div>
      <label>Mensagem<textarea className="field textarea" value={sendDraft.message_text} onChange={(event) => setSendDraft((current) => ({ ...current, message_text: event.target.value }))} /></label>
      <label>Observações<textarea className="field textarea" value={sendDraft.notes} onChange={(event) => setSendDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      <button className="primary-action" onClick={() => sendManualMessage()} disabled={saving}>{saving ? 'Enviando...' : 'Enviar mensagem'}</button>
    </section>
  );

  const renderTemplates = () => (
    <section className="whatsapp-two-column">
      {canConfigure && (
        <article className="whatsapp-panel">
          <h2>Mensagem padrão</h2>
          <div className="whatsapp-form-grid">
            <label>Título<input className="field" value={templateDraft.title} onChange={(event) => setTemplateDraft((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Categoria<select className="field" value={templateDraft.category} onChange={(event) => setTemplateDraft((current) => ({ ...current, category: event.target.value }))}>{templateCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Setor<select className="field" value={templateDraft.sector} onChange={(event) => setTemplateDraft((current) => ({ ...current, sector: event.target.value }))}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Status<select className="field" value={templateDraft.status} onChange={(event) => setTemplateDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
          </div>
          <label>Texto<textarea className="field textarea" value={templateDraft.message_text} onChange={(event) => setTemplateDraft((current) => ({ ...current, message_text: event.target.value }))} /></label>
          <div className="whatsapp-variable-list">{['nome_paciente', 'clinica', 'data_consulta', 'hora_consulta', 'nome_operador', 'link_agendamento', 'telefone_clinica'].map((item) => <span key={item}>{`{{${item}}}`}</span>)}</div>
          <button className="primary-action" onClick={saveTemplate} disabled={saving}>Salvar mensagem</button>
        </article>
      )}
      <article className="whatsapp-panel">
        <h2>Biblioteca</h2>
        <div className="whatsapp-card-list">
          {templates.map((template) => (
            <article key={template.id}>
              <header><strong>{template.title}</strong><span className={`whatsapp-badge ${statusTone(template.status)}`}>{template.status}</span></header>
              <small>{template.category} · {template.sector}</small>
              <p>{template.message_text}</p>
              <div className="row-actions">
                <button className="outline-action mini-action" onClick={() => duplicateTemplate(template)}>Duplicar</button>
                {canConfigure && <button className="outline-action danger-action mini-action" onClick={() => deleteTemplate(template.id)}>Excluir</button>}
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );

  const renderChatbot = () => (
    <section className="whatsapp-two-column">
      {canConfigure && (
        <article className="whatsapp-panel">
          <h2>Novo fluxo</h2>
          <div className="whatsapp-form-grid">
            <label>Nome do fluxo<input className="field" value={flowDraft.flow_name} onChange={(event) => setFlowDraft((current) => ({ ...current, flow_name: event.target.value }))} /></label>
            <label>Instância<select className="field" value={flowDraft.instance_name} onChange={(event) => setFlowDraft((current) => ({ ...current, instance_name: event.target.value }))}><option value="">Todas</option>{instances.map((item) => <option key={item.id} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}</select></label>
            <label>Setor<select className="field" value={flowDraft.sector} onChange={(event) => setFlowDraft((current) => ({ ...current, sector: event.target.value }))}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Gatilho<select className="field" value={flowDraft.trigger_type} onChange={(event) => setFlowDraft((current) => ({ ...current, trigger_type: event.target.value }))}>{triggerTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Valor do gatilho<input className="field" value={flowDraft.trigger_value} onChange={(event) => setFlowDraft((current) => ({ ...current, trigger_value: event.target.value }))} /></label>
            <label>Status<select className="field" value={flowDraft.status} onChange={(event) => setFlowDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
          </div>
          <label>Mensagem inicial<textarea className="field textarea" value={flowDraft.initial_message} onChange={(event) => setFlowDraft((current) => ({ ...current, initial_message: event.target.value }))} /></label>
          <button className="primary-action" onClick={saveFlow} disabled={saving}>Salvar fluxo</button>
        </article>
      )}
      <article className="whatsapp-panel">
        <h2>Fluxos cadastrados</h2>
        <div className="whatsapp-card-list">
          {flows.map((flow) => (
            <article key={flow.id}>
              <header><strong>{flow.flow_name}</strong><span className={`whatsapp-badge ${statusTone(flow.status)}`}>{flow.status}</span></header>
              <small>{flow.trigger_type} · {flow.trigger_value || 'sem valor'}</small>
              <p>{flow.initial_message || 'Sem mensagem inicial'}</p>
            </article>
          ))}
        </div>
      </article>
    </section>
  );

  const renderAbsent = () => (
    <section className="whatsapp-panel">
      <h2>Pacientes ausentes</h2>
      <div className="whatsapp-card-list compact">
        {absent.map((item) => (
          <article key={item.id}>
            <header><strong>{item.patient_name}</strong><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></header>
            <small>{item.patient_phone} · {item.clinic_name || '-'}</small>
            <p>{item.reason || 'Sem motivo informado'} · Tentativas: {item.attempt_count}</p>
            <label className="whatsapp-inline-select">Status
              <select className="field" value={item.status || ''} onChange={(event) => updateAbsentStatus(item, event.target.value)}>
                {absentStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <div className="row-actions">
              <button className="outline-action mini-action" onClick={() => startAbsentReturn(item)}>Enviar retorno</button>
              <button className="outline-action mini-action" onClick={() => updateAbsentStatus(item, 'Recuperado')}>Recuperado</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const renderHistory = () => (
    <section className="whatsapp-panel">
      <h2>Histórico de mensagens</h2>
      <div className="whatsapp-filter-row">
        <label>Início<input className="field" type="date" value={historyFilters.startDate} onChange={(event) => setHistoryFilters((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label>Fim<input className="field" type="date" value={historyFilters.endDate} onChange={(event) => setHistoryFilters((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label>Status<select className="field" value={historyFilters.status} onChange={(event) => setHistoryFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option>{['enviada', 'entregue', 'lida', 'respondida', 'erro', 'pendente', 'recebida'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Paciente<input className="field" value={historyFilters.patient} onChange={(event) => setHistoryFilters((current) => ({ ...current, patient: event.target.value }))} /></label>
        <button className="outline-action" onClick={loadBaseData}>Filtrar</button>
      </div>
      <div className="whatsapp-table-wrap">
        <table className="whatsapp-table">
          <thead><tr><th>Data/hora</th><th>Paciente</th><th>Telefone</th><th>Instância</th><th>Operador</th><th>Tipo</th><th>Status</th><th>Mensagem</th></tr></thead>
          <tbody>{history.map((item) => <tr key={item.id}><td>{String(item.created_at || '').slice(0, 16).replace('T', ' ')}</td><td>{item.patient_name || '-'}</td><td>{item.patient_phone}</td><td>{item.instance_name || '-'}</td><td>{item.operator_name || '-'}</td><td>{item.direction}</td><td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></td><td>{item.message_text}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );

  const renderReports = () => (
    <section className="whatsapp-two-column">
      <article className="whatsapp-panel">
        <h2>Relatórios exportáveis</h2>
        <div className="whatsapp-report-actions">
          <button className="outline-action icon-action" onClick={() => exportCsv('whatsapp-historico.csv', history)}><span className="file-icon xls">XLS</span>Histórico Excel</button>
          <button className="outline-action icon-action" onClick={() => window.print()}><span className="file-icon pdf">PDF</span>Relatório PDF</button>
          <button className="outline-action icon-action" onClick={() => exportCsv('whatsapp-ausentes.csv', absent)}><span className="file-icon xls">XLS</span>Ausentes Excel</button>
        </div>
      </article>
      <article className="whatsapp-panel">
        <h2>Resumo operacional</h2>
        <div className="whatsapp-ranking-list">
          {(dashboard?.charts?.rankingOperators || []).map((item) => <p key={item.label}><span>{item.label}</span><strong>{item.messages} mensagens</strong></p>)}
        </div>
      </article>
    </section>
  );

  const renderSection = () => {
    if (loading && !dashboard) return <section className="whatsapp-panel"><p className="empty-state">Carregando Gestão WhatsApp CRC...</p></section>;
    if (currentSection === 'instances') return renderInstances();
    if (currentSection === 'attendance') return renderAttendance();
    if (currentSection === 'send') return renderSend();
    if (currentSection === 'templates') return renderTemplates();
    if (currentSection === 'chatbot') return renderChatbot();
    if (currentSection === 'absent') return renderAbsent();
    if (currentSection === 'history') return renderHistory();
    if (currentSection === 'reports') return renderReports();
    return renderDashboard();
  };

  if (!allowed) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Acesso restrito</p>
          <h1>Gestão WhatsApp CRC</h1>
          <p>Seu perfil não possui autorização para acessar esta central.</p>
          <button className="primary-action" onClick={() => navigate('/home')}>Voltar para Home</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page whatsapp-management-page">
      <header className="page-heading whatsapp-heading">
        <div>
          <p className="eyebrow">Central de Atendimento</p>
          <h1>Gestão WhatsApp CRC</h1>
          <p>Atendimento operacional, múltiplas instâncias, mensagens padrão, chatbot, ausentes, histórico e métricas.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={loadBaseData}>Atualizar</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <nav className="whatsapp-tabbar">
        {sections.map((item) => (
          <button key={item.id} className={currentSection === item.id ? 'active' : ''} onClick={() => navigate(item.path)}>{item.label}</button>
        ))}
      </nav>

      {feedback && <p className="form-feedback whatsapp-feedback">{feedback}</p>}
      {renderSection()}

      {qrResult && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setQrResult(null)}>
          <section className="modal-panel whatsapp-qr-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="eyebrow">QR Code</p>
              <h2>{qrResult.instanceName}</h2>
            </div>
            {String(qrResult.data?.base64 || qrResult.data?.qrcode || '').startsWith('data:image')
              ? <img src={qrResult.data.base64 || qrResult.data.qrcode} alt="QR Code WhatsApp" />
              : <pre>{qrResult.data?.code || qrResult.data?.pairingCode || JSON.stringify(qrResult.data, null, 2)}</pre>}
            <button className="primary-action" onClick={() => setQrResult(null)}>Fechar</button>
          </section>
        </div>
      )}
    </main>
  );
}

export default WhatsAppManagement;
