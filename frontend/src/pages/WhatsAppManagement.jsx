import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io as createSocket } from 'socket.io-client';
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

import api, { apiBaseUrl } from '../api';
import { hasActionPermission, hasPermission, isMasterAdmin, readUser } from '../constants';
import { readToken } from '../session';

const sections = [
  { id: 'dashboard', label: 'Dashboard', path: '/home/whatsapp-management/dashboard', permission: 'whatsapp_dashboard', leader: true },
  { id: 'instances', label: 'Cadastro de Número', path: '/home/whatsapp-management/instances', permission: 'whatsapp_instances', leader: true },
  { id: 'attendance', label: 'Atendimento', path: '/home/whatsapp-management/attendance', permission: 'whatsapp_attendance', operator: true },
  { id: 'send', label: 'Envio manual', path: '/home/whatsapp-management/send', permission: 'whatsapp_send', operator: true },
  { id: 'templates', label: 'Mensagens padrão', path: '/home/whatsapp-management/templates', permission: 'whatsapp_templates', operator: true },
  { id: 'chatbot', label: 'Chatbot', path: '/home/whatsapp-management/chatbot', permission: 'whatsapp_chatbot', operator: true },
  { id: 'absent', label: 'Ausentes', path: '/home/whatsapp-management/absent', permission: 'whatsapp_absent', operator: true },
  { id: 'history', label: 'Histórico', path: '/home/whatsapp-management/history', permission: 'whatsapp_history', operator: true },
  { id: 'reports', label: 'Relatórios', path: '/home/whatsapp-management/reports', permission: 'whatsapp_reports', leader: true },
  { id: 'settings', label: 'Configurações', path: '/home/whatsapp-management/settings', permission: 'whatsapp_settings', masterOnly: true }
];

const sectors = ['CRC', 'SAC', 'Comercial', 'NPS', 'Reclamações', 'Pós-venda', 'Dentistas Parceiros'];
const attendanceStatuses = ['Novo', 'Em atendimento', 'Aguardando paciente', 'Agendado', 'Compareceu', 'Não compareceu', 'Ausente', 'Retornar depois', 'Encerrado', 'Reclamação', 'NPS', 'Urgente'];
const absentStatuses = ['Ausente primeira tentativa', 'Ausente segunda tentativa', 'Ausente terceira tentativa', 'Sem retorno', 'Retornar em 12h', 'Retornar em 24h', 'Retornar em 48h', 'Encerrado sem contato', 'Recuperado'];
const templateCategories = ['Primeiro contato', 'Confirmação de consulta', 'Lembrete de avaliação', 'Retorno de ausente', 'NPS', 'Reclamação', 'Pós-atendimento', 'Reagendamento', 'Cobrança', 'Dentista parceiro', 'Campanha comercial'];
const triggerTypes = ['palavra-chave', 'novo lead', 'paciente ausente', 'NPS', 'reclamação', 'confirmação de consulta', 'lembrete', 'pós-atendimento'];
const operatorStatuses = [
  { value: 'online', label: 'Online' },
  { value: 'almoco', label: 'Almoço' },
  { value: 'treinamento', label: 'Treinamento' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'ausente', label: 'Ausente' },
  { value: 'pausa', label: 'Pausa' },
  { value: 'offline', label: 'Offline' }
];
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

function getSocketBaseUrl() {
  if (apiBaseUrl && apiBaseUrl !== '/api') return String(apiBaseUrl).replace(/\/api\/?$/, '');
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'http://localhost:3001';
  }
  return 'https://meu-sistema-nps-backend.onrender.com';
}

function statusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text.includes('erro') || text.includes('venc') || text.includes('desconect') || text.includes('urgente')) return 'danger';
  if (text.includes('pend') || text.includes('aguard') || text.includes('retornar') || text.includes('ausente')) return 'warning';
  if (text.includes('conect') || text.includes('lida') || text.includes('recuper') || text.includes('agend')) return 'success';
  return 'neutral';
}

function emptyInstance() {
  return { instance_name: '', display_name: '', sector: 'CRC', clinic_id: '', unit_name: '', phone_number: '', operator_id: '', notes: '' };
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

function isAdminLike(user) {
  return isMasterAdmin(user) || ['admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'sac_operator'].includes(String(user?.role || ''));
}

function canAccessSection(user, item) {
  if (isMasterAdmin(user)) return true;
  if (item.masterOnly) return false;
  if (['crc_leader', 'crc_manager'].includes(String(user?.role || ''))) return item.id !== 'settings';
  if (String(user?.role || '') === 'crc_operator') return Boolean(item.operator);
  if (hasPermission(user, item.permission)) return true;
  return isAdminLike(user) && item.id !== 'settings';
}

function WhatsAppManagement() {
  const navigate = useNavigate();
  const { section } = useParams();
  const user = useMemo(() => readUser(), []);
  const allowedSections = useMemo(() => sections.filter((item) => canAccessSection(user, item)), [user]);
  const currentSection = allowedSections.some((item) => item.id === section) ? section : (allowedSections[0]?.id || 'dashboard');
  const userRole = String(user?.role || '');
  const isCrcOperator = userRole === 'crc_operator';
  const canConfigure = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_config_manage') || ['admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'sac_operator'].includes(userRole);
  const canRouteAttendance = canConfigure && !isCrcOperator;
  const canDeleteWhatsappItems = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_instance_delete');
  const canDeleteTemplates = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_template_delete');
  const canDeleteFlows = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_chatbot_delete');
  const allowed = hasPermission(user, 'whatsapp_management');

  const [dashboard, setDashboard] = useState(null);
  const [configStatus, setConfigStatus] = useState(null);
  const [adminSettings, setAdminSettings] = useState(null);
  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [queue, setQueue] = useState([]);
  const [operators, setOperators] = useState([]);
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
  const [settingsDraft, setSettingsDraft] = useState({ baseUrl: '', apiKey: '', antiBan: {} });
  const [operatorStatus, setOperatorStatus] = useState({ status: 'online', reason: '' });
  const [attendanceMessage, setAttendanceMessage] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [attendanceAudioFile, setAttendanceAudioFile] = useState(null);
  const [historyFilters, setHistoryFilters] = useState({ startDate: todayDate(), endDate: todayDate(), status: '', patient: '' });
  const [dashboardFilters, setDashboardFilters] = useState({ operatorId: '', clinicId: '', instanceName: '', status: '', campaign: '' });
  const [transferTargetId, setTransferTargetId] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState('Conectando tempo real');
  const [qrResult, setQrResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const socketRef = useRef(null);
  const selectedConversationIdRef = useRef('');

  const selectedConversation = useMemo(
    () => conversations.find((item) => String(item.id) === String(selectedConversationId)) || conversations[0] || null,
    [conversations, selectedConversationId]
  );
  const evolutionConfigured = Boolean(configStatus?.configured);

  const loadBaseData = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setFeedback('');
    try {
      const [configRes, adminSettingsRes, operatorStatusRes, dashboardRes, instancesRes, templatesRes, conversationsRes, queueRes, operatorsRes, absentRes, historyRes, flowsRes, clinicsRes] = await Promise.all([
        api.get('/api/whatsapp/config/status'),
        isMasterAdmin(user) ? api.get('/api/admin/whatsapp-settings') : Promise.resolve({ data: null }),
        api.get('/api/whatsapp/operator-status').catch(() => ({ data: { status: 'online' } })),
        api.get('/api/whatsapp/dashboard', { params: dashboardFilters }),
        api.get('/api/whatsapp/instances'),
        api.get('/api/whatsapp/templates'),
        api.get('/api/whatsapp/conversations'),
        api.get('/api/whatsapp/queue'),
        api.get('/api/whatsapp/operators'),
        api.get('/api/whatsapp/absent'),
        api.get('/api/whatsapp/history', { params: historyFilters }),
        api.get('/api/whatsapp/chatbot/flows'),
        api.get('/clinics').catch(() => ({ data: [] }))
      ]);
      setConfigStatus(configRes.data || null);
      setAdminSettings(adminSettingsRes.data || null);
      if (adminSettingsRes.data) {
        setSettingsDraft({
          baseUrl: adminSettingsRes.data.baseUrl || '',
          apiKey: '',
          antiBan: adminSettingsRes.data.antiBan || {}
        });
      }
      setOperatorStatus(operatorStatusRes.data || { status: 'online' });
      setDashboard(dashboardRes.data || null);
      setInstances(Array.isArray(instancesRes.data) ? instancesRes.data : []);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
      setConversations(Array.isArray(conversationsRes.data) ? conversationsRes.data : []);
      setQueue(Array.isArray(queueRes.data) ? queueRes.data : []);
      setOperators(Array.isArray(operatorsRes.data) ? operatorsRes.data : []);
      setAbsent(Array.isArray(absentRes.data) ? absentRes.data : []);
      setHistory(Array.isArray(historyRes.data) ? historyRes.data : []);
      setFlows(Array.isArray(flowsRes.data) ? flowsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a Gestão WhatsApp CRC.');
    } finally {
      setLoading(false);
    }
  }, [allowed, historyFilters, dashboardFilters, user]);

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
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!allowed) return undefined;
    const token = readToken();
    if (!token) {
      setRealtimeStatus('Tempo real sem sessão');
      return undefined;
    }

    const socket = createSocket(getSocketBaseUrl(), {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 8,
      reconnectionDelay: 1200
    });
    socketRef.current = socket;

    const refreshAll = () => {
      loadBaseData();
      if (selectedConversationIdRef.current) loadMessages(selectedConversationIdRef.current);
    };

    socket.on('connect', () => setRealtimeStatus('Tempo real ativo'));
    socket.on('disconnect', () => setRealtimeStatus('Tempo real desconectado'));
    socket.on('connect_error', (error) => setRealtimeStatus(`Tempo real indisponível: ${error.message}`));
    socket.on('whatsapp:dashboard:refresh', refreshAll);
    socket.on('whatsapp:conversation:changed', refreshAll);
    socket.on('whatsapp:message:changed', refreshAll);
    socket.on('whatsapp:queue:changed', refreshAll);
    socket.on('whatsapp:dispatch:queued', refreshAll);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [allowed, loadBaseData, loadMessages]);

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
      socketRef.current?.emit('whatsapp:join-conversation', selectedConversation.id);
      loadMessages(selectedConversation.id);
    }
  }, [selectedConversation?.id, loadMessages]);

  const saveInstance = async () => {
    if (!evolutionConfigured) {
      setFeedback('Configure EVOLUTION_BASE_URL e EVOLUTION_API_KEY antes de cadastrar números.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      const payload = { ...instanceDraft, phone_number: normalizePhone(instanceDraft.phone_number) };
      const { data } = await api.post('/api/whatsapp/instances', payload);
      setFeedback(data?.warning ? `Número salvo, mas Evolution retornou: ${data.warning}` : 'Número cadastrado com sucesso.');
      setInstanceDraft(emptyInstance());
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível cadastrar o número.');
    } finally {
      setSaving(false);
    }
  };

  const generateQrCode = async (instanceName) => {
    if (!evolutionConfigured) return setFeedback('Configuração Evolution API ausente. QR Code desabilitado.');
    try {
      const { data } = await api.get(`/api/whatsapp/instances/${instanceName}/qrcode`);
      setQrResult({ instanceName, data });
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível gerar o QR Code.');
    }
  };

  const logoutInstance = async (instanceName) => {
    if (!evolutionConfigured) return setFeedback('Configuração Evolution API ausente. Desconexão desabilitada.');
    try {
      const { data } = await api.post(`/api/whatsapp/instances/${instanceName}/logout`);
      setFeedback(data?.warning ? `Número desconectado com alerta: ${data.warning}` : 'Número desconectado.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível desconectar.');
    }
  };

  const reconnectInstance = async (instanceName) => {
    if (!evolutionConfigured) return setFeedback('Configuração Evolution API ausente. Reconexão desabilitada.');
    try {
      await api.post(`/api/whatsapp/instances/${instanceName}/reconnect`);
      setFeedback('Reconexão solicitada e registrada nos logs.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível reconectar.');
    }
  };

  const deleteInstance = async (instanceName) => {
    if (!window.confirm(`Excluir o cadastro de número ${instanceName}?`)) return;
    try {
      await api.delete(`/api/whatsapp/instances/${instanceName}`);
      setFeedback('Cadastro de número excluído.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir.');
    }
  };

  const testInstanceMessage = async (instanceName) => {
    if (!evolutionConfigured) return setFeedback('Configuração Evolution API ausente. Teste desabilitado.');
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
      setFeedback('Mensagem teste entrou na fila anti-ban.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível enviar a mensagem teste.');
    }
  };

  const assignInstanceOperator = async (instanceName, operatorId) => {
    try {
      await api.put(`/api/whatsapp/instances/${instanceName}/assignment`, { operator_id: operatorId || null });
      setFeedback(operatorId ? 'Numero direcionado ao atendente.' : 'Numero removido da carteira do atendente.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel direcionar o numero.');
    }
  };

  const updateSettingsDraft = (field, value) => {
    if (field.startsWith('antiBan.')) {
      const antiBanField = field.replace('antiBan.', '');
      setSettingsDraft((current) => ({
        ...current,
        antiBan: {
          ...(current.antiBan || {}),
          [antiBanField]: value
        }
      }));
      return;
    }
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };

  const saveAdminSettings = async () => {
    setSaving(true);
    setFeedback('');
    try {
      const payload = {
        baseUrl: settingsDraft.baseUrl,
        antiBan: settingsDraft.antiBan
      };
      if (settingsDraft.apiKey) payload.apiKey = settingsDraft.apiKey;
      const { data } = await api.put('/api/admin/whatsapp-settings', payload);
      setAdminSettings(data);
      setConfigStatus(data.diagnostics || null);
      setSettingsDraft({ baseUrl: data.baseUrl || '', apiKey: '', antiBan: data.antiBan || {} });
      setFeedback(data.diagnostics?.evolutionReachable ? 'Configurações WhatsApp salvas e Evolution API acessível.' : `Configuração salva, mas o teste retornou: ${data.diagnostics?.message || 'falha de conexão'}.`);
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar as configurações WhatsApp.');
    } finally {
      setSaving(false);
    }
  };

  const testAdminSettings = async () => {
    setSaving(true);
    setFeedback('');
    try {
      const { data } = await api.post('/api/admin/whatsapp-settings/test');
      setConfigStatus(data || null);
      setFeedback(data?.evolutionReachable ? 'Evolution API respondeu com sucesso.' : `Evolution API indisponível: ${data?.message || 'erro não informado'}.`);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível testar a Evolution API.');
    } finally {
      setSaving(false);
    }
  };

  const updateOperatorAvailability = async (status) => {
    try {
      const { data } = await api.put('/api/whatsapp/operator-status', {
        status,
        reason: operatorStatuses.find((item) => item.value === status)?.label || status
      });
      setOperatorStatus(data || { status });
      setFeedback(status === 'online' ? 'Status alterado para online.' : 'Status de ausência registrado. A fila automática não atribuirá novos atendimentos enquanto estiver ausente.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar seu status.');
    }
  };

  const claimConversation = async (conversationId) => {
    try {
      const { data } = await api.post(`/api/whatsapp/conversations/${conversationId}/claim`);
      setFeedback('Atendimento assumido com sucesso.');
      setSelectedConversationId(String(data?.conversation?.id || conversationId));
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível assumir o atendimento.');
    }
  };

  const transferConversation = async (conversationId, operatorId = transferTargetId) => {
    try {
      await api.post(`/api/whatsapp/conversations/${conversationId}/transfer`, { operator_id: operatorId || null });
      setFeedback(operatorId ? 'Atendimento transferido.' : 'Atendimento devolvido para a fila.');
      setTransferTargetId('');
      await loadBaseData();
      if (conversationId) await loadMessages(conversationId);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível transferir o atendimento.');
    }
  };

  const runAutoAssign = async () => {
    try {
      const { data } = await api.post('/api/whatsapp/queue/auto-assign');
      setFeedback(`${data?.assigned?.length || 0} atendimento(s) distribuído(s) automaticamente.`);
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível executar a fila automática.');
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
    if (!evolutionConfigured) {
      setFeedback('Configure a Evolution API antes de enviar mensagens.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      const payload = { ...draft, patient_phone: normalizePhone(draft.patient_phone), operator_name: user?.name || draft.operator_name };
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
      setFeedback('Mensagem registrada e colocada na fila anti-ban.');
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

  const sendAudioMessage = async (draft = sendDraft, file = audioFile) => {
    if (!evolutionConfigured) {
      setFeedback('Configure a Evolution API antes de enviar audio.');
      return;
    }
    if (!file) {
      setFeedback('Selecione um arquivo de audio para envio.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      const formData = new FormData();
      Object.entries({ ...draft, patient_phone: normalizePhone(draft.patient_phone), operator_name: user?.name || draft.operator_name }).forEach(([key, value]) => {
        if (value !== undefined && value !== null) formData.append(key, value);
      });
      formData.append('audio', file);
      await api.post('/api/whatsapp/send-audio', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFeedback('Audio registrado e colocado na fila anti-ban.');
      setAudioFile(null);
      setAttendanceAudioFile(null);
      setSendDraft(emptySend(user));
      await loadBaseData();
      if (selectedConversation?.id) await loadMessages(selectedConversation.id);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel enviar o audio.');
    } finally {
      setSaving(false);
    }
  };

  const deleteMessage = async (messageId) => {
    if (!window.confirm('Apagar esta mensagem tambem no WhatsApp quando a Evolution permitir?')) return;
    try {
      const { data } = await api.delete(`/api/whatsapp/messages/${messageId}`);
      setFeedback(data?.warning ? `Mensagem apagada no sistema. Alerta Evolution: ${data.warning}` : 'Mensagem apagada no sistema e solicitada na Evolution.');
      if (selectedConversation?.id) await loadMessages(selectedConversation.id);
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel apagar a mensagem.');
    }
  };

  const clearWhatsAppManagementData = async () => {
    const confirmation = window.prompt('Digite LIMPAR para apagar os dados da Gestao WhatsApp CRC e recriar os modelos iniciais.');
    if (confirmation !== 'LIMPAR') return;
    try {
      await api.delete('/api/admin/whatsapp-management/data');
      setFeedback('Base WhatsApp limpa. Mensagens padrao e fluxos iniciais foram recriados.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel limpar a base WhatsApp.');
    }
  };

  const printWhatsAppReport = () => {
    const reportWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!reportWindow) return setFeedback('O navegador bloqueou a abertura do relatorio.');
    const summary = dashboard?.summary || {};
    const rows = history.slice(0, 120).map((item) => `
      <tr>
        <td>${String(item.created_at || '').slice(0, 16).replace('T', ' ')}</td>
        <td>${item.patient_name || '-'}</td>
        <td>${item.patient_phone || '-'}</td>
        <td>${item.instance_name || '-'}</td>
        <td>${item.operator_name || '-'}</td>
        <td>${item.status || '-'}</td>
        <td>${String(item.message_text || '').slice(0, 180)}</td>
      </tr>
    `).join('');
    reportWindow.document.write(`<!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Relatorio WhatsApp CRC</title>
          <style>
            body { font-family: Arial, sans-serif; color: #1f2933; margin: 32px; }
            header { border-bottom: 3px solid #1f7a8c; padding-bottom: 16px; margin-bottom: 20px; }
            h1 { margin: 0; font-size: 28px; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
            .card { border: 1px solid #d8ccb9; border-radius: 8px; padding: 14px; background: #fbfaf7; }
            .card span { display: block; color: #6b7280; font-size: 11px; text-transform: uppercase; font-weight: 700; }
            .card strong { display: block; margin-top: 6px; font-size: 22px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { text-align: left; background: #f1ece4; color: #73532a; }
            th, td { border: 1px solid #ded2c0; padding: 8px; vertical-align: top; }
            @media print { body { margin: 18px; } }
          </style>
        </head>
        <body>
          <header>
            <h1>Relatorio WhatsApp CRC</h1>
            <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
          </header>
          <section class="grid">
            <div class="card"><span>Enviadas hoje</span><strong>${formatNumber(summary.sentToday)}</strong></div>
            <div class="card"><span>Recebidas hoje</span><strong>${formatNumber(summary.receivedToday)}</strong></div>
            <div class="card"><span>Aguardando</span><strong>${formatNumber(summary.waitingPatients)}</strong></div>
            <div class="card"><span>Taxa de resposta</span><strong>${formatPercent(summary.responseRate)}</strong></div>
          </section>
          <table>
            <thead><tr><th>Data/hora</th><th>Paciente</th><th>Telefone</th><th>Numero</th><th>Operador</th><th>Status</th><th>Mensagem</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7">Sem registros no periodo.</td></tr>'}</tbody>
          </table>
        </body>
      </html>`);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
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

  const deleteFlow = async (flowId) => {
    if (!window.confirm('Excluir este fluxo de chatbot?')) return;
    try {
      await api.delete(`/api/whatsapp/chatbot/flows/${flowId}`);
      setFeedback('Fluxo excluído.');
      await loadBaseData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o fluxo.');
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
      ['Taxa de leitura', formatPercent(summary.readRate), `${formatPercent(summary.errorRate)} erro`, summary.errorRate > 3 ? 'danger' : 'success'],
      ['Fila aguardando', summary.queueWaiting, `${summary.queueInProgress || 0} em atendimento`, summary.queueWaiting > 8 ? 'danger' : summary.queueWaiting > 0 ? 'warning' : 'success'],
      ['Fila de disparo', summary.dispatchPending, `${summary.dispatchSent24h || 0} enviados em 24h`, summary.dispatchErrors24h > 0 ? 'danger' : 'neutral'],
      ['Operadores online', summary.operatorsOnline || 0, `${summary.operatorsAbsent || 0} ausentes`, summary.operatorsOnline > 0 ? 'success' : 'warning'],
      ['CAC WhatsApp', `R$ ${Number(summary.cac || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Custo por fechamento', 'neutral'],
      ['CPL WhatsApp', `R$ ${Number(summary.cpl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Custo por lead', 'neutral'],
      ['EBITDA CRC', `R$ ${Number(summary.ebitdaCrc || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Indicador financeiro integrado', Number(summary.ebitdaCrc || 0) >= 0 ? 'success' : 'danger'],
      ['Anti-ban', `${summary.antiBan?.rateLimitPerMinute || 0}/min`, `${summary.antiBan?.minDelayMs || 0}-${summary.antiBan?.maxDelayMs || 0}ms`, 'neutral']
    ];

    return (
      <>
        <section className="whatsapp-filter-panel">
          <label>Operador
            <select className="field" value={dashboardFilters.operatorId} onChange={(event) => setDashboardFilters((current) => ({ ...current, operatorId: event.target.value }))}>
              <option value="">Todos</option>
              {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
            </select>
          </label>
          <label>Clínica
            <select className="field" value={dashboardFilters.clinicId} onChange={(event) => setDashboardFilters((current) => ({ ...current, clinicId: event.target.value }))}>
              <option value="">Todas</option>
              {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
            </select>
          </label>
          <label>Cadastro de número
            <select className="field" value={dashboardFilters.instanceName} onChange={(event) => setDashboardFilters((current) => ({ ...current, instanceName: event.target.value }))}>
              <option value="">Todas</option>
              {instances.map((item) => <option key={item.id} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}
            </select>
          </label>
          <label>Status
            <select className="field" value={dashboardFilters.status} onChange={(event) => setDashboardFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">Todos</option>
              {attendanceStatuses.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Campanha
            <input className="field" value={dashboardFilters.campaign} onChange={(event) => setDashboardFilters((current) => ({ ...current, campaign: event.target.value }))} placeholder="Buscar campanha" />
          </label>
          <button className="outline-action" onClick={() => setDashboardFilters({ operatorId: '', clinicId: '', instanceName: '', status: '', campaign: '' })}>Limpar filtros</button>
        </section>
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
          <ChartCard title="Mensagens por número">
            <ResponsiveContainer><BarChart data={dashboard?.charts?.messagesByInstance || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="messages" fill="#4c956c" /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Atendimentos por status">
            <ResponsiveContainer><PieChart><Pie data={dashboard?.charts?.attendanceByStatus || []} dataKey="attendances" nameKey="label" outerRadius={92}>{(dashboard?.charts?.attendanceByStatus || []).map((entry, index) => <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Fila de atendimento">
            <ResponsiveContainer><BarChart data={dashboard?.charts?.queueByStatus || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="attendances" fill="#1f7a8c" /></BarChart></ResponsiveContainer>
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
          <h2>Novo número</h2>
          {!evolutionConfigured && (
            <p className="whatsapp-config-alert">Configuração Evolution API ausente: {(configStatus?.missing || ['EVOLUTION_BASE_URL', 'EVOLUTION_API_KEY']).join(', ')}. Configure antes de cadastrar números ou gerar QR Code.</p>
          )}
          <div className="whatsapp-form-grid">
            <label>Identificação do número<input className="field" value={instanceDraft.instance_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, instance_name: event.target.value }))} /></label>
            <label>Nome de exibição<input className="field" value={instanceDraft.display_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
            <label>Setor<select className="field" value={instanceDraft.sector} onChange={(event) => setInstanceDraft((current) => ({ ...current, sector: event.target.value }))}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Clínica<select className="field" value={instanceDraft.clinic_id} onChange={(event) => setInstanceDraft((current) => ({ ...current, clinic_id: event.target.value }))}><option value="">Sem vínculo</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
            <label>Unidade<input className="field" value={instanceDraft.unit_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
            <label>Número WhatsApp<input className="field" value={instanceDraft.phone_number} onChange={(event) => setInstanceDraft((current) => ({ ...current, phone_number: normalizePhone(event.target.value) }))} placeholder="5562999999999" /></label>
            {canRouteAttendance && (
              <label>Atendente responsável
                <select className="field" value={instanceDraft.operator_id} onChange={(event) => setInstanceDraft((current) => ({ ...current, operator_id: event.target.value }))}>
                  <option value="">Fila automática</option>
                  {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <label>Observações<textarea className="field textarea" value={instanceDraft.notes} onChange={(event) => setInstanceDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <button className="primary-action" onClick={saveInstance} disabled={saving || !evolutionConfigured}>Cadastrar número</button>
        </article>
      )}
      <article className="whatsapp-panel">
        <h2>Números cadastrados</h2>
        <div className="whatsapp-table-wrap">
          <table className="whatsapp-table">
            <thead><tr><th>Cadastro</th><th>Número</th><th>Setor</th><th>Atendente</th><th>Status</th><th>Fila</th><th>Mensagens</th><th>Última atividade</th><th>Ações</th></tr></thead>
            <tbody>
              {instances.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.display_name || item.instance_name}</strong><small>{item.instance_name}</small></td>
                  <td>{item.phone_number || '-'}</td>
                  <td>{item.sector || '-'}</td>
                  <td>
                    {canRouteAttendance ? (
                      <select className="field compact-select" value={item.operator_id || ''} onChange={(event) => assignInstanceOperator(item.instance_name, event.target.value)}>
                        <option value="">Fila automática</option>
                        {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
                      </select>
                    ) : (item.operator_name || 'Fila automática')}
                  </td>
                  <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></td>
                  <td>{formatNumber(item.queue_count || 0)}</td>
                  <td>{formatNumber(item.message_count || 0)}</td>
                  <td>{String(item.last_activity_at || item.last_status_check_at || '-').slice(0, 16).replace('T', ' ')}</td>
                  <td><div className="whatsapp-row-actions">
                    {canConfigure && <button className="outline-action mini-action" onClick={() => generateQrCode(item.instance_name)} disabled={!evolutionConfigured}>QR Code</button>}
                    {canConfigure && <button className="outline-action mini-action" onClick={() => reconnectInstance(item.instance_name)} disabled={!evolutionConfigured}>Reconectar</button>}
                    <button className="outline-action mini-action" onClick={() => testInstanceMessage(item.instance_name)} disabled={!evolutionConfigured}>Teste</button>
                    {canConfigure && <button className="outline-action mini-action" onClick={() => logoutInstance(item.instance_name)} disabled={!evolutionConfigured}>Desconectar</button>}
                    {canDeleteWhatsappItems && <button className="outline-action danger-action mini-action" onClick={() => deleteInstance(item.instance_name)}>Excluir</button>}
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
        <div className="whatsapp-operator-status-card">
          <span>Seu status</span>
          <select className="field" value={operatorStatus?.status || 'online'} onChange={(event) => updateOperatorAvailability(event.target.value)}>
            {operatorStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <small>{(operatorStatus?.status || 'online') === 'online' ? 'Fila automática habilitada.' : 'Chatbot/fila assume novos atendimentos.'}</small>
        </div>
        <div className="whatsapp-side-heading">
          <h2>Fila</h2>
          {canRouteAttendance && <button className="outline-action mini-action" onClick={runAutoAssign}>Distribuir</button>}
        </div>
        <div className="whatsapp-queue-list">
          {queue.filter((item) => item.status === 'aguardando').slice(0, 8).map((item) => (
            <button key={item.id} onClick={() => setSelectedConversationId(String(item.conversation_id))}>
              <strong>{item.patient_name}</strong>
              <span>{item.patient_phone}</span>
              <em>{item.status}</em>
              <small>{item.clinic_name || 'Sem clínica'} · {String(item.queued_at || '').slice(0, 16).replace('T', ' ')}</small>
              <span className="whatsapp-claim-link" onClick={(event) => { event.stopPropagation(); claimConversation(item.conversation_id); }}>Assumir atendimento</span>
            </button>
          ))}
          {!queue.filter((item) => item.status === 'aguardando').length && <p className="empty-state">Fila sem pacientes aguardando.</p>}
        </div>
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
              {message.media_url && (
                <audio className="whatsapp-audio-player" controls src={message.media_url}>
                  Seu navegador não suporta reprodução de áudio.
                </audio>
              )}
              <small>{message.operator_name || message.direction} · {String(message.created_at || '').slice(0, 16).replace('T', ' ')}</small>
              {message.status !== 'apagada' && (
                <button className="whatsapp-message-delete" type="button" onClick={() => deleteMessage(message.id)}>Apagar</button>
              )}
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
              <button className="primary-action" onClick={() => sendManualMessage({ ...sendDraft, conversation_id: selectedConversation.id, instance_name: selectedConversation.instance_name || instances[0]?.instance_name, patient_phone: selectedConversation.patient_phone, patient_name: selectedConversation.patient_name, message_text: attendanceMessage })} disabled={!evolutionConfigured}>Enviar</button>
            </div>
            <div className="row-actions">
              <input className="field" type="file" accept="audio/*" onChange={(event) => setAttendanceAudioFile(event.target.files?.[0] || null)} />
              <button className="outline-action" onClick={() => sendAudioMessage({ ...sendDraft, conversation_id: selectedConversation.id, instance_name: selectedConversation.instance_name || instances[0]?.instance_name, patient_phone: selectedConversation.patient_phone, patient_name: selectedConversation.patient_name, message_text: attendanceMessage || 'Áudio enviado pelo CRC' }, attendanceAudioFile)} disabled={!evolutionConfigured || !attendanceAudioFile}>Enviar áudio</button>
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
            {canRouteAttendance && <div className="whatsapp-transfer-box">
              <button className="outline-action" onClick={() => claimConversation(selectedConversation.id)}>Assumir atendimento</button>
              <label>Transferir para
                <select className="field" value={transferTargetId} onChange={(event) => setTransferTargetId(event.target.value)}>
                  <option value="">Selecionar operador</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>{operator.name} · {operator.available}/{operator.maxSimultaneous}</option>
                  ))}
                </select>
              </label>
              <button className="outline-action" onClick={() => transferConversation(selectedConversation.id)} disabled={!transferTargetId}>Transferir atendimento</button>
              <button className="outline-action" onClick={() => transferConversation(selectedConversation.id, '')}>Devolver para fila</button>
            </div>}
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
        <label>Operador responsável<input className="field" value={user?.name || sendDraft.operator_name} readOnly /></label>
      </div>
      <label>Mensagem<textarea className="field textarea" value={sendDraft.message_text} onChange={(event) => setSendDraft((current) => ({ ...current, message_text: event.target.value }))} /></label>
      <label>Enviar áudio<input className="field" type="file" accept="audio/*" onChange={(event) => setAudioFile(event.target.files?.[0] || null)} /></label>
      <label>Observações<textarea className="field textarea" value={sendDraft.notes} onChange={(event) => setSendDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      <div className="row-actions">
        <button className="primary-action" onClick={() => sendManualMessage({ ...sendDraft, operator_name: user?.name || sendDraft.operator_name })} disabled={saving || !evolutionConfigured}>{saving ? 'Enviando...' : 'Enviar mensagem'}</button>
        <button className="outline-action" onClick={() => sendAudioMessage({ ...sendDraft, operator_name: user?.name || sendDraft.operator_name, message_text: sendDraft.message_text || 'Áudio enviado pelo CRC' })} disabled={saving || !evolutionConfigured || !audioFile}>Enviar áudio</button>
      </div>
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
                {canDeleteTemplates && <button className="outline-action danger-action mini-action" onClick={() => deleteTemplate(template.id)}>Excluir</button>}
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
            <label>Cadastro de número<select className="field" value={flowDraft.instance_name} onChange={(event) => setFlowDraft((current) => ({ ...current, instance_name: event.target.value }))}><option value="">Todos</option>{instances.map((item) => <option key={item.id} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}</select></label>
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
              {canDeleteFlows && <button className="outline-action danger-action mini-action" onClick={() => deleteFlow(flow.id)}>Excluir</button>}
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
          <thead><tr><th>Data/hora</th><th>Paciente</th><th>Telefone</th><th>Número</th><th>Operador</th><th>Tipo</th><th>Status</th><th>Mensagem</th></tr></thead>
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
          <button className="outline-action icon-action" onClick={printWhatsAppReport}><span className="file-icon pdf">PDF</span>Relatório PDF</button>
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

  const renderSettings = () => (
    <section className="whatsapp-two-column">
      <article className="whatsapp-panel whatsapp-settings-panel">
        <p className="eyebrow">Administrador Master</p>
        <h2>Configurações WhatsApp</h2>
        <div className="whatsapp-form-grid">
          <label>Evolution Base URL
            <input className="field" value={settingsDraft.baseUrl || ''} onChange={(event) => updateSettingsDraft('baseUrl', event.target.value)} placeholder="http://2.24.101.6:8080" />
          </label>
          <label>Evolution API Key
            <input className="field" type="password" value={settingsDraft.apiKey || ''} onChange={(event) => updateSettingsDraft('apiKey', event.target.value)} placeholder={adminSettings?.apiKeyMasked || 'Manter chave atual'} />
          </label>
          <label>Delay mínimo (ms)
            <input className="field" type="number" value={settingsDraft.antiBan?.minDelayMs || ''} onChange={(event) => updateSettingsDraft('antiBan.minDelayMs', Number(event.target.value))} />
          </label>
          <label>Delay máximo (ms)
            <input className="field" type="number" value={settingsDraft.antiBan?.maxDelayMs || ''} onChange={(event) => updateSettingsDraft('antiBan.maxDelayMs', Number(event.target.value))} />
          </label>
          <label>Limite por minuto
            <input className="field" type="number" value={settingsDraft.antiBan?.rateLimitPerMinute || ''} onChange={(event) => updateSettingsDraft('antiBan.rateLimitPerMinute', Number(event.target.value))} />
          </label>
          <label>Atendimentos simultâneos padrão
            <input className="field" type="number" value={settingsDraft.antiBan?.defaultMaxSimultaneous || ''} onChange={(event) => updateSettingsDraft('antiBan.defaultMaxSimultaneous', Number(event.target.value))} />
          </label>
        </div>
        <div className="row-actions">
          <button className="primary-action" onClick={saveAdminSettings} disabled={saving}>Salvar configurações</button>
          <button className="outline-action" onClick={testAdminSettings} disabled={saving}>Testar conexão</button>
          <button className="outline-action danger-action" onClick={clearWhatsAppManagementData}>Limpar base WhatsApp</button>
        </div>
      </article>
      <article className="whatsapp-panel whatsapp-monitor-panel">
        <p className="eyebrow">Monitor Hostinger / Evolution</p>
        <h2>Diagnóstico da integração</h2>
        <div className="whatsapp-diagnostic-grid">
          <p><span>Configuração</span><strong>{configStatus?.configured ? 'Completa' : 'Pendente'}</strong></p>
          <p><span>Base URL</span><strong>{configStatus?.baseUrlConfigured ? 'Configurada' : 'Ausente'}</strong></p>
          <p><span>API Key</span><strong>{configStatus?.apiKeyConfigured ? 'Configurada' : 'Ausente'}</strong></p>
          <p><span>Evolution API</span><strong>{configStatus?.evolutionReachable ? 'Acessível' : 'Indisponível'}</strong></p>
          <p><span>Versão</span><strong>{configStatus?.version || '-'}</strong></p>
          <p><span>Números</span><strong>{formatNumber(configStatus?.instanceCount || 0)}</strong></p>
        </div>
        {configStatus?.missing?.length ? <p className="whatsapp-config-alert">Variáveis ausentes: {configStatus.missing.join(', ')}</p> : null}
        <small>Esta tela usa somente o backend do CRC; a chave da Evolution não é exposta ao navegador.</small>
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
    if (currentSection === 'settings') return renderSettings();
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
          <p>Atendimento operacional, múltiplos números, mensagens padrão, chatbot, ausentes, histórico e métricas.</p>
          <span className={`whatsapp-realtime-pill ${realtimeStatus.includes('ativo') ? 'online' : 'offline'}`}>{realtimeStatus}</span>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={loadBaseData}>Atualizar</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <nav className="whatsapp-tabbar">
        {allowedSections.map((item) => (
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
