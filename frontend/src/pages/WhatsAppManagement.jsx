import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { io as createSocket } from 'socket.io-client';

import api, { apiBaseUrl } from '../api';
import { hasActionPermission, hasPermission, isMasterAdmin, normalizeRoleValue, readUser } from '../constants';
import { readToken } from '../session';

const sections = [
  { id: 'dashboard', label: 'Visao geral', path: '/home/whatsapp-management/dashboard', permission: 'whatsapp_dashboard', leader: true, group: 'Operacao' },
  { id: 'instances', label: 'Cadastro de Numero', path: '/home/whatsapp-management/instances', permission: 'whatsapp_instances', leader: true, group: 'Operacao' },
  { id: 'attendance', label: 'Atendimento', path: '/home/whatsapp-management/attendance', permission: 'whatsapp_attendance', operator: true, group: 'Operacao' },
  { id: 'send', label: 'Envio manual', path: '/home/whatsapp-management/send', permission: 'whatsapp_send', operator: true, group: 'Mensagens' },
  { id: 'templates', label: 'Mensagens padrao', path: '/home/whatsapp-management/templates', permission: 'whatsapp_templates', operator: true, group: 'Mensagens' },
  { id: 'campaigns', label: 'Disparos em massa', path: '/home/whatsapp-management/campaigns', permission: 'whatsapp_send', operator: true, group: 'Mensagens' },
  { id: 'chatbot', label: 'Chatbot', path: '/home/whatsapp-management/chatbot', permission: 'whatsapp_chatbot', operator: true, group: 'Mensagens' },
  { id: 'absent', label: 'Ausentes', path: '/home/whatsapp-management/absent', permission: 'whatsapp_absent', operator: true, group: 'Parceiros' },
  { id: 'history', label: 'Historico', path: '/home/whatsapp-management/history', permission: 'whatsapp_history', operator: true, group: 'Relatorios' },
  { id: 'confirmation', label: 'Confirmacao e Agendamento', path: '/home/whatsapp-management/confirmation', permission: 'whatsapp_reports', leader: true, group: 'Parceiros' },
  { id: 'reports', label: 'Relatorios', path: '/home/whatsapp-management/reports', permission: 'whatsapp_reports', leader: true, group: 'Relatorios' },
  { id: 'settings', label: 'Configuracoes', path: '/admin/controle-master', permission: 'whatsapp_settings', masterOnly: true, group: 'Configuracoes' }
];

const sectionDescriptions = {
  dashboard: 'Visao executiva das sessoes, filas, operadores e ritmo operacional do WhatsApp.',
  instances: 'Cadastro, vinculo e governanca dos numeros que operam na central.',
  attendance: 'Operacao em tempo real para assumir, responder, transferir e finalizar atendimentos.',
  send: 'Disparo individual com padronizacao de sessao, paciente, clinica e mensagem.',
  templates: 'Biblioteca oficial de mensagens para manter padrao, velocidade e qualidade.',
  campaigns: 'Campanhas em massa com fila progressiva, anti-ban e controle por template.',
  chatbot: 'Fluxos conversacionais para captura estruturada de respostas e automacao.',
  absent: 'Retomada dos pacientes sem resposta com controle simples de tentativa e retorno.',
  history: 'Historico operacional para auditoria, rastreio e exportacao das mensagens.',
  confirmation: 'Painel dedicado a confirmacao, agendamento e rotina dos parceiros.',
  reports: 'Exportacoes e leituras gerenciais para acompanhamento da operacao.',
  settings: 'Configuracao tecnica do servico, limites de envio e diagnostico da integracao.'
};

const DEFAULT_CAMPAIGN_MESSAGES = {
  confirmacao: 'Ola, {{nome_paciente}}! Tudo bem? Sou a assistente de confirmacao da unidade {{clinica}} no Grupo Sorria. Passando para confirmar seu atendimento. Se estiver tudo certo, responda SIM. Se quiser remarcar, escreva REMARCAR. Se preferir falar com nossa equipe, responda ATENDENTE.',
  nps: 'Ola, {{nome_paciente}}! Sua opiniao e essencial para nos. Em uma escala de 0 a 10, qual nota voce da para sua experiencia na unidade {{clinica}}? Se preferir, tambem pode responder pela pesquisa: {{link_nps}}'
};

const sectors = ['CRC', 'SAC', 'Comercial', 'NPS', 'Reclamacoes', 'Pos-venda', 'Dentistas Parceiros', 'Confirmacao e Agendamento'];
const attendanceStatuses = ['Novo', 'Em atendimento', 'Aguardando paciente', 'Agendado', 'Compareceu', 'Nao compareceu', 'Ausente', 'Retornar depois', 'Encerrado', 'Reclamacao', 'NPS', 'Urgente'];
const operatorStatuses = [
  { value: 'online', label: 'Online' },
  { value: 'almoco', label: 'Almoco' },
  { value: 'treinamento', label: 'Treinamento' },
  { value: 'reuniao', label: 'Reuniao' },
  { value: 'ausente', label: 'Ausente' },
  { value: 'pausa', label: 'Pausa' },
  { value: 'offline', label: 'Offline' }
];
const templateCategories = ['Primeiro contato', 'Confirmacao de consulta', 'Lembrete de avaliacao', 'Retorno de ausente', 'NPS', 'Reclamacao', 'Pos-atendimento', 'Reagendamento', 'Cobranca', 'Dentista parceiro', 'Campanha comercial'];
const triggerTypes = ['palavra-chave', 'novo lead', 'paciente ausente', 'NPS', 'reclamacao', 'confirmacao de consulta', 'lembrete', 'pos-atendimento'];
const partnerVideoWeekdays = [
  { value: 1, label: 'Seg', fullLabel: 'Segunda-feira' },
  { value: 2, label: 'Ter', fullLabel: 'Terça-feira' },
  { value: 3, label: 'Qua', fullLabel: 'Quarta-feira' },
  { value: 4, label: 'Qui', fullLabel: 'Quinta-feira' },
  { value: 5, label: 'Sex', fullLabel: 'Sexta-feira' },
  { value: 6, label: 'Sab', fullLabel: 'Sábado' },
  { value: 0, label: 'Dom', fullLabel: 'Domingo' }
];

function formatPartnerWeekdayLabels(values = []) {
  const days = Array.isArray(values) ? values.map(Number).filter((item) => item >= 0 && item <= 6) : [];
  const ordered = Array.from(new Set(days)).sort((a, b) => a - b);
  if (ordered.length === 6 && [1, 2, 3, 4, 5, 6].every((day) => ordered.includes(day))) {
    return 'Segunda a sábado, durante o mês inteiro';
  }
  if (!ordered.length) return 'Nenhum dia selecionado';
  return ordered
    .map((value) => partnerVideoWeekdays.find((day) => day.value === value)?.fullLabel || value)
    .join(', ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits.slice(0, 13);
  return `55${digits}`.slice(0, 13);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatLoadWarningKey(key) {
  const labels = {
    config: 'status do servico',
    adminSettings: 'configuracoes administrativas',
    dashboard: 'visao geral',
    instances: 'instancias',
    operators: 'operadores',
    clinics: 'clinicas',
    templates: 'templates',
    conversations: 'atendimentos',
    queue: 'fila',
    absent: 'ausentes',
    history: 'historico',
    flows: 'chatbot',
    chatbotSessions: 'sessoes do chatbot',
    confirmationResponses: 'confirmacoes do chatbot',
    partnersVideo: 'painel de confirmacao'
  };
  return labels[key] || key;
}

function sectionBadgeValue(sectionId, context = {}) {
  if (sectionId === 'instances') return context.instances?.length || 0;
  if (sectionId === 'attendance') return context.queue?.length || 0;
  if (sectionId === 'templates') return context.templates?.length || 0;
  if (sectionId === 'chatbot') return context.flows?.length || 0;
  if (sectionId === 'absent') return context.absent?.length || 0;
  if (sectionId === 'history') return context.history?.length || 0;
  return null;
}

function statusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text.includes('erro') || text.includes('desconect') || text.includes('venc')) return 'danger';
  if (text.includes('reconect') || text.includes('aguard') || text.includes('pend') || text.includes('ausente') || text.includes('iniciando')) return 'warning';
  if (text.includes('conect') || text.includes('enviada') || text.includes('lida') || text.includes('ativo')) return 'success';
  return 'neutral';
}

function getErrorMessage(error, fallback) {
  const status = error?.response?.status;
  const url = error?.config?.url || '';
  if (status === 404) {
    return `Rota nao encontrada (404): ${url || 'endpoint nao informado'}. Atualize a pagina e tente novamente.`;
  }
  const rawMessage = error?.response?.data?.error
    || error?.response?.data?.message
    || error?.message
    || fallback;
  if (String(rawMessage || '').toLowerCase().includes('evolution api ausente')) {
    return 'Configuracao antiga da Evolution ignorada. A central usa somente whatsapp-service; atualize a pagina e tente novamente.';
  }
  const normalizedMessage = String(rawMessage || '').toLowerCase();
  if (normalizedMessage.includes('sendiq called before startcomms') || normalizedMessage.includes('[comms]') || normalizedMessage.includes('startcomms')) {
    return 'A sessao do WhatsApp esta conectada, mas ainda nao esta pronta para envio. Clique em Reconectar, aguarde alguns segundos e tente novamente.';
  }
  return error?.response?.data?.error
    || error?.response?.data?.message
    || error?.message
    || fallback;
}

function campaignRowsContainClinic(rawText = '') {
  return String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line, index) => {
      const columns = line.split(/[;,|\t]+/).map((item) => item.trim()).filter(Boolean);
      if (!columns.length) return false;
      if (index === 0 && columns.some((column) => /clinica|clinic|unidade/i.test(column))) return true;
      return columns.length >= 3 && !/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(columns[2]) && !/^\d{4}-\d{2}-\d{2}$/.test(columns[2]);
    });
}

function getRealtimeSocketUrl() {
  const base = String(apiBaseUrl || '').trim();
  if (/^https?:\/\//i.test(base)) {
    return base.replace(/\/api\/?$/i, '');
  }
  if (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return process.env.REACT_APP_API_URL || 'https://meu-sistema-nps-backend.onrender.com';
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return undefined;
}

function emptyInstance() {
  return {
    instance_name: '',
    display_name: '',
    sector: 'CRC',
    clinic_id: '',
    unit_name: '',
    phone_number: '',
    operator_id: '',
    notes: ''
  };
}

function emptyTemplate() {
  return {
    title: '',
    category: 'Primeiro contato',
    sector: 'CRC',
    message_text: 'Ola, {{nome_paciente}}! Tudo bem?\nAqui e {{nome_operador}}, do Grupo Sorria Goias.',
    variables: ['nome_paciente', 'clinica', 'nome_operador'],
    status: 'ativo'
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

function emptyCampaignDraft() {
  return {
    campaign_type: 'confirmacao',
    session_id: 'confirmacao-agendamento',
    campaign_clinic_id: '',
    campaign_clinic_name: '',
    template_id: '',
    message_text: DEFAULT_CAMPAIGN_MESSAGES.confirmacao,
    recipients: 'nome_paciente;telefone;data_consulta;hora_consulta\nPaciente Exemplo;5562999999999;26/05/2026;14:30'
  };
}

function generateClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptySend(user) {
  return {
    instance_name: '',
    patient_phone: '',
    patient_name: '',
    clinic_id: '',
    clinic_name: '',
    unit_name: '',
    operator_name: user?.name || '',
    message_type: 'manual',
    template_id: '',
    message_text: '',
    notes: ''
  };
}

function emptyPartnerVideoContact() {
  return {
    clinic_name: '',
    partner_name: '',
    phone_number: '',
    specialty: '',
    active: true,
    receives_automatic_message: true,
    default_send_time: '08:00',
    allowed_weekdays: '1,2,3,4,5,6',
    notes: ''
  };
}

function normalizePartnerVideoSettingsDraft(settings = {}) {
  const allowedTimes = Array.isArray(settings.allowedTimes)
    ? settings.allowedTimes.join('\n')
    : (settings.allowedTimes || settings.allowed_times || '08:00\n18:00');
  return {
    automationEnabled: Boolean(settings.automationEnabled),
    standardTime: settings.standardTime || '08:00',
    allowedTimes,
    allowedWeekdays: Array.isArray(settings.allowedWeekdays) ? settings.allowedWeekdays.map(Number) : [1, 2, 3, 4, 5, 6],
    sessionId: settings.sessionId || 'confirmacao-agendamento',
    senderPhone: settings.senderPhone || '5562998647043',
    minDelaySeconds: Number(settings.minDelaySeconds || 20),
    maxDelaySeconds: Number(settings.maxDelaySeconds || 60),
    limitPerMinute: Number(settings.limitPerMinute || 2),
    limitPerHour: Number(settings.limitPerHour || 60),
    testMode: Boolean(settings.testMode),
    testNumbers: Array.isArray(settings.testNumbers) ? settings.testNumbers.join('\n') : '5562999669966\n5562998852865\n5564981598113',
    template: settings.template || ''
  };
}

function parseVariables(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function canAccessSection(user, item) {
  if (isMasterAdmin(user)) return true;
  if (item.masterOnly) return false;
  const role = normalizeRoleValue(user?.role);
  if (role === 'crc_operator') return Boolean(item.operator);
  if (role === 'crc_leader' || role === 'crc_manager') return item.id !== 'settings';
  if (hasPermission(user, item.permission)) return true;
  return ['admin', 'supervisor_crc', 'sac_operator'].includes(role) && item.id !== 'settings';
}

function operatorLabel(operator) {
  const clinics = Array.isArray(operator?.clinics) ? operator.clinics.map((clinic) => clinic.name).filter(Boolean) : [];
  const suffix = clinics.length ? ` - ${clinics.slice(0, 2).join(', ')}${clinics.length > 2 ? '...' : ''}` : '';
  return `${operator?.name || 'Operador CRC'}${suffix}`;
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

function WhatsAppManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const { section } = useParams();
  const user = useMemo(() => readUser(), []);
  const role = normalizeRoleValue(user?.role);
  const allowedSections = useMemo(() => sections.filter((item) => canAccessSection(user, item)), [user]);
  const currentSection = allowedSections.some((item) => item.id === section) ? section : (allowedSections[0]?.id || 'dashboard');
  const groupedAllowedSections = useMemo(() => allowedSections.reduce((acc, item) => {
    const group = item.group || 'Geral';
    acc[group] = acc[group] || [];
    acc[group].push(item);
    return acc;
  }, {}), [allowedSections]);
  const allowed = hasPermission(user, 'whatsapp_management') || isMasterAdmin(user) || ['admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator'].includes(role);
  const canConfigure = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_config_manage') || ['admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager'].includes(role);
  const canRouteAttendance = canConfigure && role !== 'crc_operator';
  const canDeleteWhatsappItems = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_instance_delete');
  const canDeleteTemplates = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_template_delete');
  const canDeleteFlows = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_chatbot_delete');

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [loadWarnings, setLoadWarnings] = useState([]);
  const [configStatus, setConfigStatus] = useState(null);
  const [adminSettings, setAdminSettings] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [instances, setInstances] = useState([]);
  const [operators, setOperators] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [queue, setQueue] = useState([]);
  const [absent, setAbsent] = useState([]);
  const [history, setHistory] = useState([]);
  const [flows, setFlows] = useState([]);
  const [chatbotSessions, setChatbotSessions] = useState([]);
  const [confirmationResponses, setConfirmationResponses] = useState([]);
  const [partnersVideo, setPartnersVideo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [qrResult, setQrResult] = useState(null);
  const [dashboardView, setDashboardView] = useState('overview');

  const [instanceDraft, setInstanceDraft] = useState(emptyInstance());
  const [editingInstanceName, setEditingInstanceName] = useState('');
  const [operatorClinicEditorId, setOperatorClinicEditorId] = useState('');
  const [operatorClinicIds, setOperatorClinicIds] = useState([]);
  const [sendDraft, setSendDraft] = useState(emptySend(user));
  const [attendanceMessage, setAttendanceMessage] = useState('');
  const [templateDraft, setTemplateDraft] = useState(emptyTemplate());
  const [editingTemplateId, setEditingTemplateId] = useState('');
  const [flowDraft, setFlowDraft] = useState(emptyFlow());
  const [editingFlowId, setEditingFlowId] = useState('');
  const [campaignDraft, setCampaignDraft] = useState(emptyCampaignDraft());
  const [campaignFile, setCampaignFile] = useState(null);
  const [campaignPreview, setCampaignPreview] = useState([]);
  const [campaignPreviewSummary, setCampaignPreviewSummary] = useState(null);
  const [campaignInvalidRows, setCampaignInvalidRows] = useState([]);
  const [campaignSelection, setCampaignSelection] = useState([]);
  const [partnerSettingsDraft, setPartnerSettingsDraft] = useState(null);
  const [partnerContactDraft, setPartnerContactDraft] = useState(emptyPartnerVideoContact());
  const [editingPartnerContactId, setEditingPartnerContactId] = useState('');
  const [partnerNoVideoSelection, setPartnerNoVideoSelection] = useState([]);
  const [confirmationTab, setConfirmationTab] = useState('daily');
  const [partnerVideoFilters, setPartnerVideoFilters] = useState({ clinic: '', partner: '', status: '', phone: '', date: '' });
  const [partnerHistoryContact, setPartnerHistoryContact] = useState(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [settingsDraft, setSettingsDraft] = useState({ baseUrl: '', apiKey: '', antiBan: {} });
  const [historyFilters, setHistoryFilters] = useState({ search: '', status: '', instanceName: '' });
  const [dashboardFilters] = useState({ operatorId: '', clinicId: '', instanceName: '', status: '', campaign: '' });
  const selectedConversationIdRef = useRef('');
  const instanceEditorRef = useRef(null);
  const instancePhoneInputRef = useRef(null);
  const partnerVideoEditorRef = useRef(null);
  const actionInFlightRef = useRef(new Set());

  const selectedQueueConversation = useMemo(
    () => queue.find((item) => String(item.conversation_id) === String(selectedConversationId)) || null,
    [queue, selectedConversationId]
  );

  useEffect(() => {
    if (currentSection !== 'confirmation') return;
    const tab = new URLSearchParams(location.search).get('tab');
    if (['daily', 'partners', 'shipments', 'logs', 'settings'].includes(tab)) {
      setConfirmationTab(tab);
    }
  }, [currentSection, location.search]);
  const selectedConversation = useMemo(() => {
    const found = conversations.find((item) => String(item.id) === String(selectedConversationId));
    if (found) return found;
    if (selectedQueueConversation) {
      return {
        id: selectedQueueConversation.conversation_id,
        patient_name: selectedQueueConversation.patient_name,
        patient_phone: selectedQueueConversation.patient_phone,
        clinic_id: selectedQueueConversation.clinic_id,
        clinic_name: selectedQueueConversation.clinic_name,
        instance_name: selectedQueueConversation.instance_name,
        operator_id: selectedQueueConversation.operator_id,
        operator_name: selectedQueueConversation.operator_name,
        status: selectedQueueConversation.conversation_status || selectedQueueConversation.status || 'Novo'
      };
    }
    return selectedConversationId ? null : conversations[0] || null;
  }, [conversations, selectedConversationId, selectedQueueConversation]);

  const preferredInstance = useMemo(
    () => instances.find((item) => item.instance_name === 'reclamacoes')
      || instances.find((item) => String(item.status || '').toLowerCase() === 'conectado')
      || instances[0]
      || null,
    [instances]
  );
  const selectedSendInstance = useMemo(
    () => instances.find((item) => item.instance_name === sendDraft.instance_name) || null,
    [instances, sendDraft.instance_name]
  );
  const selectedSendInstanceStatus = String(selectedSendInstance?.status || '').toLowerCase();
  const selectedSendInstanceBlocked = Boolean(selectedSendInstance)
    && selectedSendInstanceStatus
    && selectedSendInstanceStatus !== 'conectado'
    && selectedSendInstanceStatus !== 'connected';
  const currentSectionMeta = allowedSections.find((item) => item.id === currentSection) || allowedSections[0] || null;
  const headerMetrics = useMemo(() => {
    const connectedSessions = instances.filter((item) => String(item.status || '').toLowerCase() === 'conectado').length;
    if (currentSection === 'confirmation') {
      const summary = partnersVideo?.summary || {};
      return [
        { label: 'Sessoes conectadas', value: formatNumber(connectedSessions), tone: connectedSessions ? 'success' : 'warning' },
        { label: 'Fila aberta', value: formatNumber(queue.length), tone: queue.length ? 'warning' : 'neutral' },
        { label: 'Mensagens hoje', value: formatNumber(summary.sentToday || dashboard?.summary?.sentToday || 0), tone: 'neutral' },
        { label: 'Parceiros ativos', value: formatNumber(summary.activeContacts || 0), tone: 'success' },
        { label: 'Pendencias do dia', value: formatNumber(summary.pendingToday || 0), tone: summary.pendingToday ? 'warning' : 'success' },
        { label: 'Falhas de envio', value: formatNumber(summary.failuresToday || 0), tone: summary.failuresToday ? 'danger' : 'success' }
      ];
    }
    return [
      { label: 'Sessoes conectadas', value: formatNumber(connectedSessions), tone: 'success' },
      { label: 'Fila aberta', value: formatNumber(queue.length), tone: queue.length ? 'warning' : 'neutral' },
      { label: 'Mensagens hoje', value: formatNumber(dashboard?.summary?.sentToday || 0), tone: 'neutral' },
      { label: 'Operadores', value: formatNumber(operators.length), tone: 'neutral' }
    ];
  }, [currentSection, dashboard?.summary?.sentToday, instances, operators.length, partnersVideo?.summary, queue.length]);

  const setSuccess = (message) => setFeedback({ type: 'success', message });
  const setError = (message) => setFeedback({ type: 'error', message });

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    try {
      const response = await api.get(`/api/whatsapp/conversations/${conversationId}/messages`);
      setMessages(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setError(getErrorMessage(error, 'Nao foi possivel carregar as mensagens.'));
    }
  }, []);

  const loadBaseData = useCallback(async ({ silent = false } = {}) => {
    if (!allowed) return;
    if (!silent) setLoading(true);
    const requests = {
      config: api.get('/api/whatsapp/config/status'),
      adminSettings: isMasterAdmin(user) ? api.get('/api/admin/whatsapp-settings') : Promise.resolve({ data: null }),
      dashboard: api.get('/api/whatsapp/dashboard', { params: dashboardFilters }),
      instances: api.get('/api/whatsapp/instances'),
      operators: api.get('/api/whatsapp/operators'),
      clinics: api.get('/clinics').catch(() => ({ data: [] })),
      templates: api.get('/api/whatsapp/templates'),
      conversations: api.get('/api/whatsapp/conversations'),
      queue: api.get('/api/whatsapp/queue'),
      absent: api.get('/api/whatsapp/absent'),
      history: api.get('/api/whatsapp/history', { params: historyFilters }),
      flows: api.get('/api/whatsapp/chatbot/flows'),
      chatbotSessions: api.get('/api/whatsapp/chatbot/sessions'),
      confirmationResponses: api.get('/api/whatsapp/confirmation/responses'),
      partnersVideo: api.get('/api/partners-video/dashboard')
    };
    const entries = Object.entries(requests);
    const results = await Promise.allSettled(entries.map(([, request]) => request));
    const failed = [];

    results.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status !== 'fulfilled') {
        failed.push(key);
        return;
      }
      const data = result.value.data;
      if (key === 'config') setConfigStatus(data || null);
      if (key === 'adminSettings') {
        setAdminSettings(data || null);
        if (data) setSettingsDraft({ baseUrl: data.baseUrl || '', apiKey: '', antiBan: data.antiBan || {} });
      }
      if (key === 'dashboard') setDashboard(data || null);
      if (key === 'instances') setInstances(Array.isArray(data) ? data : []);
      if (key === 'operators') setOperators(Array.isArray(data) ? data : []);
      if (key === 'clinics') setClinics(Array.isArray(data) ? data : []);
      if (key === 'templates') setTemplates(Array.isArray(data) ? data : []);
      if (key === 'conversations') setConversations(Array.isArray(data) ? data : []);
      if (key === 'queue') setQueue(Array.isArray(data) ? data : []);
      if (key === 'absent') setAbsent(Array.isArray(data) ? data : []);
      if (key === 'history') setHistory(Array.isArray(data) ? data : []);
      if (key === 'flows') setFlows(Array.isArray(data) ? data : []);
      if (key === 'chatbotSessions') setChatbotSessions(Array.isArray(data) ? data : []);
      if (key === 'confirmationResponses') setConfirmationResponses(Array.isArray(data) ? data : []);
      if (key === 'partnersVideo') setPartnersVideo(data || null);
    });

    if (!silent) {
      setLoadWarnings(failed);
      if (failed.length === entries.length) {
        setError('Nao foi possivel carregar a Gestao de WhatsApp. Atualize a pagina e tente novamente.');
      }
    }
    if (!silent) setLoading(false);
  }, [allowed, dashboardFilters, historyFilters, user]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?.id ? String(selectedConversation.id) : '';
  }, [selectedConversation?.id]);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    if (!partnersVideo?.settings || partnerSettingsDraft) return;
    setPartnerSettingsDraft(normalizePartnerVideoSettingsDraft(partnersVideo.settings));
  }, [partnersVideo?.settings, partnerSettingsDraft]);

  useEffect(() => {
    if (selectedConversation?.id) {
      setSelectedConversationId(String(selectedConversation.id));
      loadMessages(selectedConversation.id);
    }
  }, [selectedConversation?.id, loadMessages]);

  useEffect(() => {
    const timer = window.setInterval(() => loadBaseData({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [loadBaseData]);

  useEffect(() => {
    if (!selectedConversation?.id) return undefined;
    const timer = window.setInterval(() => loadMessages(selectedConversation.id), 5000);
    return () => window.clearInterval(timer);
  }, [selectedConversation?.id, loadMessages]);

  useEffect(() => {
    if (!allowed) return undefined;
    const token = readToken();
    if (!token) return undefined;

    const socket = createSocket(getRealtimeSocketUrl(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token }
    });
    let refreshTimer = null;

    const scheduleRefresh = (conversationId = null) => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        await loadBaseData({ silent: true });
        const currentConversationId = selectedConversationIdRef.current;
        if (conversationId && currentConversationId && String(conversationId) === String(currentConversationId)) {
          await loadMessages(currentConversationId);
        }
      }, 250);
    };

    socket.on('whatsapp:conversation:changed', (payload = {}) => {
      if (payload.conversation?.id) {
        setConversations((current) => {
          const exists = current.some((item) => String(item.id) === String(payload.conversation.id));
          if (exists) {
            return current.map((item) => (String(item.id) === String(payload.conversation.id) ? { ...item, ...payload.conversation } : item));
          }
          return [payload.conversation, ...current];
        });
      }
      scheduleRefresh(payload.conversation?.id);
    });

    socket.on('whatsapp:message:changed', (payload = {}) => {
      const conversationId = payload.conversationId || payload.message?.conversation_id;
      scheduleRefresh(conversationId);
    });

    socket.on('whatsapp:queue:changed', () => scheduleRefresh());
    socket.on('whatsapp:session:changed', () => scheduleRefresh());
    socket.on('whatsapp:dashboard:refresh', (payload = {}) => scheduleRefresh(payload.conversationId));
    socket.on('connect_error', (error) => {
      setError(`Tempo real WhatsApp indisponivel: ${error.message || 'falha de conexao'}. Mantive atualizacao automatica a cada 15 segundos.`);
    });

    return () => {
      window.clearTimeout(refreshTimer);
      socket.disconnect();
    };
  }, [allowed, loadBaseData, loadMessages]);

  useEffect(() => {
    if (!qrResult?.instanceName || qrResult?.data?.connected) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get(`/api/whatsapp/instances/${qrResult.instanceName}/qrcode`);
        setQrResult({ instanceName: qrResult.instanceName, data: response.data });
      } catch (error) {
        setError(getErrorMessage(error, 'Nao foi possivel atualizar o QR Code.'));
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [qrResult?.instanceName, qrResult?.data?.connected]);

  useEffect(() => {
    if (preferredInstance && !sendDraft.instance_name) {
      setSendDraft((current) => ({
        ...current,
        instance_name: preferredInstance.instance_name,
        clinic_id: preferredInstance.clinic_id || current.clinic_id || '',
        clinic_name: preferredInstance.clinic_name || current.clinic_name || '',
        unit_name: preferredInstance.unit_name || current.unit_name || ''
      }));
    }
  }, [preferredInstance, sendDraft.instance_name]);

  useEffect(() => {
    setCampaignDraft((current) => {
      const nextSession = current.campaign_type === 'nps' ? 'nps' : 'confirmacao-agendamento';
      const defaultMessage = DEFAULT_CAMPAIGN_MESSAGES[current.campaign_type] || DEFAULT_CAMPAIGN_MESSAGES.confirmacao;
      const shouldApplyDefaultMessage = !String(current.message_text || '').trim()
        || Object.values(DEFAULT_CAMPAIGN_MESSAGES).includes(current.message_text);
      if (current.session_id === nextSession && !shouldApplyDefaultMessage) return current;
      return {
        ...current,
        session_id: nextSession,
        message_text: shouldApplyDefaultMessage ? defaultMessage : current.message_text
      };
    });
  }, [campaignDraft.campaign_type]);

  useEffect(() => {
    if (clinics.length !== 1 || campaignDraft.campaign_clinic_id) return;
    const [clinic] = clinics;
    setCampaignDraft((current) => ({
      ...current,
      campaign_clinic_id: String(clinic.id),
      campaign_clinic_name: clinic.name || ''
    }));
  }, [campaignDraft.campaign_clinic_id, clinics]);

  const runAction = async (key, action, successMessage, fallbackMessage) => {
    if (actionInFlightRef.current.has(key)) return null;
    actionInFlightRef.current.add(key);
    setSavingKey(key);
    setFeedback(null);
    try {
      const result = await action();
      if (successMessage) setSuccess(typeof successMessage === 'function' ? successMessage(result?.data || result) : successMessage);
      return result;
    } catch (error) {
      setError(getErrorMessage(error, fallbackMessage));
      return null;
    } finally {
      actionInFlightRef.current.delete(key);
      setSavingKey('');
    }
  };

  const saveInstance = () => runAction('save-instance', async () => {
    const payload = { ...instanceDraft, phone_number: normalizePhone(instanceDraft.phone_number) };
    const response = editingInstanceName
      ? await api.put(`/api/whatsapp/instances/${editingInstanceName}`, payload)
      : await api.post('/api/whatsapp/instances', payload);
    setEditingInstanceName('');
    setInstanceDraft(emptyInstance());
    await loadBaseData({ silent: true });
    return response;
  }, editingInstanceName ? 'Numero atualizado.' : 'Numero cadastrado.', 'Nao foi possivel salvar o numero.');

  const editInstance = (instance) => {
    setEditingInstanceName(instance.instance_name);
    setInstanceDraft({
      instance_name: instance.instance_name || '',
      display_name: instance.display_name || '',
      sector: instance.sector || 'CRC',
      clinic_id: instance.clinic_id || '',
      unit_name: instance.unit_name || '',
      phone_number: instance.phone_number || '',
      operator_id: instance.operator_id || '',
      notes: instance.notes || ''
    });
    setSuccess(`Editando ${instance.display_name || instance.instance_name}.`);
    window.setTimeout(() => {
      instanceEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        instancePhoneInputRef.current?.focus({ preventScroll: true });
        instancePhoneInputRef.current?.select();
      }, 180);
    }, 0);
  };

  const cancelInstanceEdit = () => {
    setEditingInstanceName('');
    setInstanceDraft(emptyInstance());
  };

  const generateQrCode = (instanceName) => runAction(`qr-${instanceName}`, async () => {
    const response = await api.get(`/api/whatsapp/instances/${instanceName}/qrcode`);
    setQrResult({ instanceName, data: response.data });
    await loadBaseData({ silent: true });
    return response;
  }, 'QR Code carregado.', 'Nao foi possivel carregar o QR Code.');

  const reconnectInstance = (instanceName) => runAction(`reconnect-${instanceName}`, async () => {
    const response = await api.post(`/api/whatsapp/instances/${instanceName}/reconnect`);
    await loadBaseData({ silent: true });
    return response;
  }, 'Reconexao solicitada.', 'Nao foi possivel reconectar.');

  const logoutInstance = (instanceName) => runAction(`logout-${instanceName}`, async () => {
    const response = await api.post(`/api/whatsapp/instances/${instanceName}/logout`);
    await loadBaseData({ silent: true });
    return response;
  }, 'Numero desconectado.', 'Nao foi possivel desconectar.');

  const deleteInstance = (instanceName) => {
    if (!window.confirm(`Excluir o cadastro ${instanceName}?`)) return null;
    return runAction(`delete-${instanceName}`, async () => {
      const response = await api.delete(`/api/whatsapp/instances/${instanceName}`);
      if (editingInstanceName === instanceName) cancelInstanceEdit();
      await loadBaseData({ silent: true });
      return response;
    }, 'Cadastro excluido.', 'Nao foi possivel excluir.');
  };

  const testInstanceMessage = (instanceName) => {
    const phone = normalizePhone(window.prompt('Telefone para teste com DDI e DDD:', '') || '');
    if (!phone) {
      setError('Informe um telefone valido.');
      return null;
    }
    return runAction(`test-${instanceName}`, async () => {
      const response = await api.post(`/api/whatsapp/instances/${instanceName}/test`, {
        patient_phone: phone,
        message_text: 'Envio de mensagem teste'
      });
      await loadBaseData({ silent: true });
      return response;
    }, (data) => data?.providerMessageId
      ? `Mensagem teste enviada pela VPS. ID: ${data.providerMessageId}`
      : 'Mensagem teste enviada pela VPS.', 'Nao foi possivel enviar a mensagem teste pela VPS.');
  };

  const sendPartnerVideoTests = () => runAction('partner-video-test', async () => {
    const draft = partnerSettingsDraft || normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {});
    const response = await api.post('/api/partners-video/test-send', {
      numbers: String(draft.testNumbers || '').split(/\n|,|;/).map((item) => item.trim()).filter(Boolean)
    });
    await loadBaseData({ silent: true });
    return response;
  }, (data) => `${data?.queued || 0} teste(s) enfileirado(s) para Confirmação e Agendamento.`, 'Nao foi possivel enviar o teste de Confirmacao e Agendamento.');

  const sendPartnerVideoDailyReminders = () => {
    if (!window.confirm('Enfileirar agora a cobranca diaria de videos para todos os parceiros ativos?')) return null;
    return runAction('partner-video-daily', async () => {
      const response = await api.post('/api/partners-video/send-daily-reminders');
      await loadBaseData({ silent: true });
      return response;
    }, (data) => `${data?.queued || 0} cobranca(s) enfileirada(s) com intervalo anti-ban.`, 'Nao foi possivel enfileirar cobrancas de video.');
  };

  const togglePartnerVideoAutomation = () => runAction('partner-video-settings', async () => {
    const current = partnersVideo?.settings || {};
    const response = await api.put('/api/partners-video/settings', {
      ...current,
      automationEnabled: !current.automationEnabled
    });
    setPartnerSettingsDraft(normalizePartnerVideoSettingsDraft(response.data || current));
    await loadBaseData({ silent: true });
    return response;
  }, (data) => data?.automationEnabled ? 'Rotina automatica ativada.' : 'Rotina automatica pausada.', 'Nao foi possivel alterar a rotina automatica.');

  const updatePartnerVideoControl = (controlId, action, message) => runAction(`partner-video-${action}-${controlId}`, async () => {
    const response = await api.post(`/api/partners-video/${controlId}/${action}`);
    await loadBaseData({ silent: true });
    return response;
  }, message, 'Nao foi possivel atualizar o controle de video.');

  const togglePartnerNoVideoSelection = (key) => {
    setPartnerNoVideoSelection((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  };

  const markSelectedPartnerVideosNotSent = () => {
    if (!partnerNoVideoSelection.length) {
      setError('Selecione ao menos uma unidade que nao enviou o video.');
      return null;
    }
    return runAction('partner-video-bulk-not-sent', async () => {
      const items = partnerNoVideoSelection.map((key) => {
        const [type, id] = String(key).split(':');
        return type === 'control' ? { controlId: id } : { contactId: id };
      });
      const response = await api.post('/api/partners-video/mark-not-sent-bulk', { items });
      setPartnerNoVideoSelection([]);
      await loadBaseData({ silent: true });
      return response;
    }, 'Unidades marcadas como video nao enviado.', 'Nao foi possivel registrar as unidades sem video.');
  };

  const resendPartnerVideoControl = (controlId) => runAction(`partner-video-resend-${controlId}`, async () => {
    const response = await api.post(`/api/partners-video/${controlId}/resend`);
    await loadBaseData({ silent: true });
    return response;
  }, 'Cobranca reenfileirada com anti-ban.', 'Nao foi possivel reenviar a cobranca.');

  const updatePartnerSettingsDraft = (field, value) => {
    setPartnerSettingsDraft((current) => ({
      ...normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {}),
      ...(current || {}),
      [field]: value
    }));
  };

  const togglePartnerSettingsWeekday = (weekday) => {
    setPartnerSettingsDraft((current) => {
      const draft = { ...normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {}), ...(current || {}) };
      const days = Array.isArray(draft.allowedWeekdays) ? draft.allowedWeekdays.map(Number) : [];
      return {
        ...draft,
        allowedWeekdays: days.includes(weekday) ? days.filter((item) => item !== weekday) : [...days, weekday].sort((a, b) => a - b)
      };
    });
  };

  const savePartnerVideoSettings = () => runAction('partner-video-settings-save', async () => {
    const draft = partnerSettingsDraft || normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {});
    const response = await api.put('/api/partners-video/settings', {
      ...draft,
      minDelaySeconds: Number(draft.minDelaySeconds || 20),
      maxDelaySeconds: Number(draft.maxDelaySeconds || 60),
      limitPerMinute: Number(draft.limitPerMinute || 2),
      limitPerHour: Number(draft.limitPerHour || 60),
      allowedTimes: String(draft.allowedTimes || '').split(/\n|,|;/).map((item) => item.trim()).filter(Boolean),
      testNumbers: String(draft.testNumbers || '').split(/\n|,|;/).map((item) => item.trim()).filter(Boolean)
    });
    setPartnerSettingsDraft(normalizePartnerVideoSettingsDraft(response.data || draft));
    await loadBaseData({ silent: true });
    return response;
  }, 'Configuracoes de Confirmacao e Agendamento salvas.', 'Nao foi possivel salvar as configuracoes.');

  const updatePartnerContactDraft = (field, value) => {
    setPartnerContactDraft((current) => ({ ...current, [field]: value }));
  };

  const editPartnerVideoContact = (contact) => {
    setEditingPartnerContactId(String(contact.id));
    setPartnerContactDraft({
      clinic_name: contact.clinic_name || '',
      partner_name: contact.partner_name || '',
      phone_number: contact.phone_number || '',
      specialty: contact.specialty || '',
      active: Boolean(contact.active),
      receives_automatic_message: Boolean(contact.receives_automatic_message),
      default_send_time: String(contact.default_send_time || '08:00').slice(0, 5),
      allowed_weekdays: contact.allowed_weekdays || '1,2,3,4,5,6',
      notes: contact.notes || ''
    });
    setSuccess(`Editando parceiro ${contact.partner_name || ''}.`);
  };

  const cancelPartnerVideoContactEdit = () => {
    setEditingPartnerContactId('');
    setPartnerContactDraft(emptyPartnerVideoContact());
  };

  const startPartnerVideoContactForClinic = (clinicName) => {
    const normalizedClinic = String(clinicName || '').trim();
    setConfirmationTab('partners');
    setEditingPartnerContactId('');
    setPartnerContactDraft({
      ...emptyPartnerVideoContact(),
      clinic_name: normalizedClinic,
      specialty: 'Parceiro clinico'
    });
    setPartnerVideoFilters((current) => ({ ...current, clinic: normalizedClinic, partner: '', status: '', phone: '', date: '' }));
    setSuccess(`Cadastro de parceiro aberto para ${normalizedClinic}.`);
    window.setTimeout(() => {
      partnerVideoEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const savePartnerVideoContact = () => {
    const normalizedPhone = normalizePhone(partnerContactDraft.phone_number);
    if (normalizedPhone && !/^55\d{10,11}$/.test(normalizedPhone)) {
      setError('Telefone invalido. Use DDI + DDD + numero, por exemplo 5562999999999.');
      return null;
    }
    const duplicatePhone = normalizedPhone && (partnersVideo?.contacts || []).find((contact) => (
      String(contact.id) !== String(editingPartnerContactId || '')
      && normalizePhone(contact.phone_number) === normalizedPhone
    ));
    const allowDuplicatePhone = Boolean(duplicatePhone);
    if (duplicatePhone) {
      const confirmed = window.confirm(`O telefone ja esta vinculado a ${duplicatePhone.partner_name || 'outro parceiro'}. Deseja continuar mesmo assim?`);
      if (!confirmed) return null;
    }
    return runAction('partner-video-contact-save', async () => {
      const payload = {
        ...partnerContactDraft,
        phone_number: normalizedPhone,
        default_send_time: partnerContactDraft.default_send_time || '08:00',
        allowed_weekdays: partnerContactDraft.allowed_weekdays || '1,2,3,4,5,6',
        allow_duplicate_phone: allowDuplicatePhone
      };
      const response = editingPartnerContactId
        ? await api.put(`/api/partners-video/contacts/${editingPartnerContactId}`, payload)
        : await api.post('/api/partners-video/contacts', payload);
      cancelPartnerVideoContactEdit();
      await loadBaseData({ silent: true });
      return response;
    }, editingPartnerContactId ? 'Parceiro atualizado.' : 'Parceiro cadastrado.', 'Nao foi possivel salvar o parceiro.');
  };

  const togglePartnerVideoContactActive = (contact) => runAction(`partner-video-contact-active-${contact.id}`, async () => {
    const response = await api.put(`/api/partners-video/contacts/${contact.id}`, {
      ...contact,
      active: !Number(contact.active),
      receives_automatic_message: Boolean(contact.receives_automatic_message),
      phone_number: normalizePhone(contact.phone_number)
    });
    await loadBaseData({ silent: true });
    return response;
  }, Number(contact.active) ? 'Parceiro inativado.' : 'Parceiro ativado.', 'Nao foi possivel alterar o status do parceiro.');

  const sendPartnerVideoContactTest = (contact) => runAction(`partner-video-contact-test-${contact.id}`, async () => {
    const response = await api.post(`/api/partners-video/contacts/${contact.id}/test-send`);
    await loadBaseData({ silent: true });
    return response;
  }, 'Teste enfileirado para o parceiro.', 'Nao foi possivel enviar teste para este parceiro.');

  const resendPartnerVideoContact = (contact) => runAction(`partner-video-contact-resend-${contact.id}`, async () => {
    const response = await api.post(`/api/partners-video/contacts/${contact.id}/resend`);
    await loadBaseData({ silent: true });
    return response;
  }, 'Cobranca reenfileirada para o parceiro.', 'Nao foi possivel reenviar a cobranca para este parceiro.');

  const deletePartnerVideoContact = (contactId) => {
    if (!window.confirm('Excluir este parceiro da rotina de videos?')) return null;
    return runAction(`partner-video-contact-delete-${contactId}`, async () => {
      const response = await api.delete(`/api/partners-video/contacts/${contactId}`);
      if (String(editingPartnerContactId) === String(contactId)) cancelPartnerVideoContactEdit();
      await loadBaseData({ silent: true });
      return response;
    }, 'Parceiro removido.', 'Nao foi possivel excluir o parceiro.');
  };

  const updatePartnerVideoFilter = (field, value) => {
    setPartnerVideoFilters((current) => ({ ...current, [field]: value }));
  };

  const clearPartnerVideoFilters = () => {
    setPartnerVideoFilters({ clinic: '', partner: '', status: '', phone: '', date: '' });
  };

  const assignInstanceOperator = (instanceName, operatorId) => runAction(`assign-${instanceName}`, async () => {
    const response = await api.put(`/api/whatsapp/instances/${instanceName}/assignment`, { operator_id: operatorId || null });
    await loadBaseData({ silent: true });
    return response;
  }, operatorId ? 'Numero direcionado ao operador.' : 'Numero devolvido para a fila.', 'Nao foi possivel direcionar o numero.');

  const openOperatorClinicEditor = (operatorId) => {
    const operator = operators.find((item) => String(item.id) === String(operatorId));
    setOperatorClinicEditorId(operatorId || '');
    setOperatorClinicIds(Array.isArray(operator?.clinicIds) ? operator.clinicIds.map(String) : []);
  };

  const toggleOperatorClinic = (clinicId) => {
    const id = String(clinicId);
    setOperatorClinicIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const saveOperatorClinics = () => {
    if (!operatorClinicEditorId) {
      setError('Selecione um Operador CRC.');
      return null;
    }
    return runAction('operator-clinics', async () => {
      const response = await api.put(`/api/whatsapp/operators/${operatorClinicEditorId}/clinics`, { clinicIds: operatorClinicIds });
      await loadBaseData({ silent: true });
      return response;
    }, 'Clinicas do operador atualizadas.', 'Nao foi possivel atualizar as clinicas.');
  };

  const updateOperatorStatus = (status) => runAction('operator-status', async () => {
    const response = await api.put('/api/whatsapp/operator-status', { status, reason: operatorStatuses.find((item) => item.value === status)?.label || status });
    await loadBaseData({ silent: true });
    return response;
  }, 'Status atualizado.', 'Nao foi possivel alterar seu status.');

  const runAutoAssign = () => runAction('auto-assign', async () => {
    const response = await api.post('/api/whatsapp/queue/auto-assign');
    await loadBaseData({ silent: true });
    return response;
  }, (data) => `${data?.assigned?.length || 0} atendimento(s) distribuido(s).`, 'Nao foi possivel distribuir a fila.');

  const claimConversation = (conversationId) => runAction(`claim-${conversationId}`, async () => {
    if (!conversationId) throw new Error('Selecione uma conversa antes de assumir o atendimento.');
    const response = await api.post(`/api/whatsapp/conversations/${conversationId}/claim`);
    setSelectedConversationId(String(response.data?.conversation?.id || conversationId));
    await loadBaseData({ silent: true });
    await loadMessages(conversationId);
    return response;
  }, 'Atendimento assumido.', 'Nao foi possivel assumir o atendimento.');

  const transferConversation = (conversationId, operatorId = transferTargetId) => runAction(`transfer-${conversationId}`, async () => {
    if (!conversationId) throw new Error('Selecione uma conversa antes de transferir o atendimento.');
    const response = await api.post(`/api/whatsapp/conversations/${conversationId}/transfer`, { operator_id: operatorId || null });
    setTransferTargetId('');
    await loadBaseData({ silent: true });
    await loadMessages(conversationId);
    return response;
  }, operatorId ? 'Atendimento transferido.' : 'Atendimento devolvido para a fila.', 'Nao foi possivel transferir o atendimento.');

  const updateConversation = (conversation, changes) => runAction(`conversation-${conversation?.id}`, async () => {
    if (!conversation?.id) throw new Error('Selecione uma conversa antes de alterar o atendimento.');
    const response = await api.put(`/api/whatsapp/conversations/${conversation.id}`, { ...conversation, ...changes });
    await loadBaseData({ silent: true });
    return response;
  }, 'Atendimento atualizado.', 'Nao foi possivel atualizar o atendimento.');

  const sendMessage = (draft = sendDraft) => {
    const payload = {
      ...draft,
      patient_phone: normalizePhone(draft.patient_phone),
      patient_name: String(draft.patient_name || '').trim().toUpperCase(),
      operator_name: user?.name || draft.operator_name,
      client_request_id: generateClientRequestId()
    };
    if (!payload.patient_phone || !payload.message_text) {
      setError('Informe telefone e mensagem.');
      return null;
    }
    const selectedInstance = instances.find((item) => item.instance_name === payload.instance_name);
    const selectedStatus = String(selectedInstance?.status || '').toLowerCase();
    if (selectedInstance && selectedStatus && !['conectado', 'connected'].includes(selectedStatus)) {
      setError(`A sessao ${selectedInstance.display_name || selectedInstance.instance_name} esta com status "${selectedInstance.status}". Reconecte o numero antes de enviar.`);
      return null;
    }
    return runAction('send-message', async () => {
      const response = payload.template_id
        ? await api.post('/api/whatsapp/send-template', {
          ...payload,
          variables: {
            nome_paciente: String(payload.patient_name || '').toUpperCase(),
            clinica: payload.clinic_name,
            nome_operador: payload.operator_name
          }
        })
        : await api.post('/api/whatsapp/send', payload);
      setSendDraft(emptySend(user));
      setAttendanceMessage('');
      await loadBaseData({ silent: true });
      if (selectedConversation?.id) await loadMessages(selectedConversation.id);
      return response;
    }, 'Mensagem enviada ou enfileirada.', 'Nao foi possivel enviar a mensagem.');
  };

  const saveTemplate = () => runAction('template', async () => {
    const response = editingTemplateId
      ? await api.put(`/api/whatsapp/templates/${editingTemplateId}`, templateDraft)
      : await api.post('/api/whatsapp/templates', templateDraft);
    setEditingTemplateId('');
    setTemplateDraft(emptyTemplate());
    await loadBaseData({ silent: true });
    return response;
  }, editingTemplateId ? 'Mensagem padrao atualizada.' : 'Mensagem padrao criada.', 'Nao foi possivel salvar a mensagem padrao.');

  const editTemplate = (template) => {
    setEditingTemplateId(String(template.id));
    setTemplateDraft({
      title: template.title || '',
      category: template.category || 'Primeiro contato',
      sector: template.sector || 'CRC',
      message_text: template.message_text || '',
      variables: parseVariables(template.variables),
      status: template.status || 'ativo'
    });
  };

  const duplicateTemplate = (template) => {
    setEditingTemplateId('');
    setTemplateDraft({
      title: `${template.title || 'Mensagem'} - copia`,
      category: template.category || 'Primeiro contato',
      sector: template.sector || 'CRC',
      message_text: template.message_text || '',
      variables: parseVariables(template.variables),
      status: 'ativo'
    });
  };

  const deleteTemplate = (templateId) => {
    if (!window.confirm('Excluir esta mensagem padrao?')) return null;
    return runAction(`template-delete-${templateId}`, async () => {
      const response = await api.delete(`/api/whatsapp/templates/${templateId}`);
      await loadBaseData({ silent: true });
      return response;
    }, 'Mensagem padrao excluida.', 'Nao foi possivel excluir a mensagem.');
  };

  const saveFlow = () => runAction('flow', async () => {
    const response = editingFlowId
      ? await api.put(`/api/whatsapp/chatbot/flows/${editingFlowId}`, flowDraft)
      : await api.post('/api/whatsapp/chatbot/flows', flowDraft);
    setEditingFlowId('');
    setFlowDraft(emptyFlow());
    await loadBaseData({ silent: true });
    return response;
  }, editingFlowId ? 'Fluxo atualizado.' : 'Fluxo criado.', 'Nao foi possivel salvar o fluxo.');

  const editFlow = (flow) => {
    setEditingFlowId(String(flow.id));
    setFlowDraft({
      flow_name: flow.flow_name || '',
      instance_name: flow.instance_name || '',
      sector: flow.sector || 'CRC',
      trigger_type: flow.trigger_type || 'palavra-chave',
      trigger_value: flow.trigger_value || '',
      initial_message: flow.initial_message || '',
      status: flow.status || 'ativo',
      steps: Array.isArray(flow.steps) ? flow.steps : []
    });
  };

  const deleteFlow = (flowId) => {
    if (!window.confirm('Excluir este fluxo?')) return null;
    return runAction(`flow-delete-${flowId}`, async () => {
      const response = await api.delete(`/api/whatsapp/chatbot/flows/${flowId}`);
      await loadBaseData({ silent: true });
      return response;
    }, 'Fluxo excluido.', 'Nao foi possivel excluir o fluxo.');
  };

  const bootstrapProfessionalChatbot = () => runAction('chatbot-bootstrap', async () => {
    const response = await api.post('/api/whatsapp/chatbot/bootstrap-defaults');
    await loadBaseData({ silent: true });
    return response;
  }, 'Fluxos profissionais atualizados.', 'Nao foi possivel atualizar os fluxos profissionais.');

  const resetCampaignPreview = () => {
    setCampaignPreview([]);
    setCampaignPreviewSummary(null);
    setCampaignInvalidRows([]);
    setCampaignSelection([]);
  };

  const previewCampaignFile = async (file, nextCampaignType = campaignDraft.campaign_type, draftOverride = {}) => {
    if (!file) {
      resetCampaignPreview();
      return;
    }
    const nextDraft = { ...campaignDraft, ...draftOverride };
    const formData = new FormData();
    formData.append('file', file);
    formData.append('campaign_type', nextCampaignType);
    formData.append('session_id', nextDraft.session_id || '');
    formData.append('campaign_clinic_id', nextDraft.campaign_clinic_id || '');
    formData.append('campaign_clinic_name', nextDraft.campaign_clinic_name || '');
    try {
      const response = await api.post('/api/whatsapp/campaigns/preview', formData);
      const recipients = Array.isArray(response.data?.recipients) ? response.data.recipients : [];
      setCampaignPreview(recipients);
      setCampaignPreviewSummary(response.data?.summary || null);
      setCampaignInvalidRows([...(response.data?.invalidRows || []), ...(response.data?.skippedRows || [])]);
      setCampaignSelection(recipients.filter((item) => item.selected).map((item) => item.preview_id));
    } catch (error) {
      resetCampaignPreview();
      setError(getErrorMessage(error, 'Nao foi possivel analisar a planilha da campanha.'));
    }
  };

  const handleCampaignFileChange = async (file) => {
    setCampaignFile(file || null);
    await previewCampaignFile(file || null);
  };

  const applyCampaignPreviewResponse = (data = {}) => {
    const recipients = Array.isArray(data?.recipients) ? data.recipients : [];
    setCampaignPreview(recipients);
    setCampaignPreviewSummary(data?.summary || null);
    setCampaignInvalidRows([...(data?.invalidRows || []), ...(data?.skippedRows || [])]);
    setCampaignSelection(recipients.filter((item) => item.selected).map((item) => item.preview_id));
  };

  const previewCampaignTextList = () => runAction('campaign-preview-text', async () => {
    const response = await api.post('/api/whatsapp/campaigns/preview', {
      campaign_type: campaignDraft.campaign_type,
      session_id: campaignDraft.session_id || '',
      campaign_clinic_id: campaignDraft.campaign_clinic_id || '',
      campaign_clinic_name: campaignDraft.campaign_clinic_name || '',
      recipients: campaignDraft.recipients || ''
    });
    setCampaignFile(null);
    applyCampaignPreviewResponse(response.data);
    return response;
  }, 'Lista conferida. Agora selecione os telefones para o lote.', 'Nao foi possivel conferir a lista digitada.');

  const handleCampaignClinicChange = async (clinicId) => {
    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    const nextClinic = {
      campaign_clinic_id: clinic ? String(clinic.id) : '',
      campaign_clinic_name: clinic?.name || ''
    };
    setCampaignDraft((current) => ({ ...current, ...nextClinic }));
    resetCampaignPreview();
    if (campaignFile) {
      await previewCampaignFile(campaignFile, campaignDraft.campaign_type, nextClinic);
    }
  };

  const toggleCampaignRecipientSelection = (previewId) => {
    if (!previewId) return;
    setCampaignSelection((current) => current.includes(previewId)
      ? current.filter((item) => item !== previewId)
      : [...current, previewId]);
  };

  const selectAllCampaignRecipients = () => {
    setCampaignSelection(campaignPreview
      .filter((item) => item.preview_id && item.patient_phone)
      .map((item) => item.preview_id));
  };

  const clearCampaignRecipientSelection = () => {
    setCampaignSelection([]);
  };

  const sendMassCampaign = () => runAction('mass-campaign', async () => {
    const payload = {
      ...campaignDraft,
      session_id: campaignDraft.session_id || (campaignDraft.campaign_type === 'nps' ? 'nps' : 'confirmacao-agendamento')
    };
    const selectedRecipients = campaignPreview.filter((item) => campaignSelection.includes(item.preview_id));
    if (campaignPreview.length && !selectedRecipients.length) {
      throw new Error('Selecione ao menos um paciente da prévia da planilha para enfileirar a campanha.');
    }
    const readySelectedRecipients = selectedRecipients.filter((item) => item.resolved);
    if (campaignPreview.length && !readySelectedRecipients.length) {
      const firstBlocked = selectedRecipients.find((item) => !item.resolved);
      throw new Error(firstBlocked?.routing_error || 'Nenhum telefone selecionado esta apto para envio. Selecione a clinica de envio e confira se o WhatsApp da clinica esta conectado.');
    }
    if (
      payload.campaign_type === 'confirmacao'
      && !payload.campaign_clinic_id
      && !campaignRowsContainClinic(payload.recipients)
    ) {
      throw new Error('Selecione a clinica de envio antes de disparar uma lista que possui apenas telefone.');
    }
    const response = selectedRecipients.length
      ? await api.post('/api/whatsapp/campaigns/mass-send', {
          ...payload,
          selected_recipients: readySelectedRecipients
        })
      : campaignFile
        ? await (() => {
            const formData = new FormData();
            formData.append('file', campaignFile);
            formData.append('campaign_type', payload.campaign_type);
            formData.append('session_id', payload.session_id);
            formData.append('campaign_clinic_id', payload.campaign_clinic_id || '');
            formData.append('campaign_clinic_name', payload.campaign_clinic_name || '');
            formData.append('template_id', payload.template_id || '');
            formData.append('message_text', payload.message_text || '');
            return api.post('/api/whatsapp/campaigns/mass-send', formData);
          })()
        : await api.post('/api/whatsapp/campaigns/mass-send', payload);
    setCampaignFile(null);
    resetCampaignPreview();
    await loadBaseData({ silent: true });
    return response;
  }, (data) => {
    const sessionLabel = data?.sessionId ? ` Sessao usada: ${data.sessionId}.` : '';
    return `${data?.message || 'Campanha enfileirada com sucesso.'}${sessionLabel}`;
  }, 'Nao foi possivel enfileirar a campanha em massa.');

  const downloadCampaignTemplate = (campaignType = campaignDraft.campaign_type) => runAction(`campaign-template-${campaignType}`, async () => {
    const response = await api.get('/api/whatsapp/campaigns/template', {
      params: { campaign_type: campaignType },
      responseType: 'blob'
    });
    const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = campaignType === 'nps' ? 'template-whatsapp-nps.xlsx' : 'template-whatsapp-confirmacao.xlsx';
    link.click();
    window.URL.revokeObjectURL(url);
    return response;
  }, 'Template Excel baixado.', 'Nao foi possivel baixar o template Excel.');

  const markAbsent = (conversation) => runAction(`absent-${conversation?.id}`, async () => {
    if (!conversation?.id) throw new Error('Selecione uma conversa antes de marcar paciente ausente.');
    const response = await api.post('/api/whatsapp/absent', {
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
    await loadBaseData({ silent: true });
    return response;
  }, 'Paciente marcado como ausente.', 'Nao foi possivel marcar ausente.');

  const updateAbsentStatus = (item, status) => runAction(`absent-status-${item.id}`, async () => {
    const response = await api.put(`/api/whatsapp/absent/${item.id}`, { status });
    await loadBaseData({ silent: true });
    return response;
  }, 'Paciente ausente atualizado.', 'Nao foi possivel atualizar ausente.');

  const sendAbsentReturn = (item) => runAction(`absent-return-${item.id}`, async () => {
    const response = await api.post('/api/whatsapp/send', {
      instance_name: item.instance_name || preferredInstance?.instance_name,
      patient_phone: item.patient_phone,
      patient_name: item.patient_name,
      clinic_id: item.clinic_id,
      clinic_name: item.clinic_name,
      message_type: 'retorno_ausente',
      message_text: `Ola, ${item.patient_name || 'tudo bem'}! Estamos tentando contato para dar continuidade ao seu atendimento. Podemos ajudar?`
    });
    await loadBaseData({ silent: true });
    return response;
  }, 'Retorno enviado ao paciente.', 'Nao foi possivel enviar retorno.');

  const saveAdminSettings = () => runAction('settings', async () => {
    const response = await api.put('/api/admin/whatsapp-settings', settingsDraft);
    await loadBaseData({ silent: true });
    return response;
  }, 'Configuracoes salvas.', 'Nao foi possivel salvar configuracoes.');

  const testAdminSettings = () => runAction('settings-test', async () => {
    const response = await api.post('/api/admin/whatsapp-settings/test');
    setConfigStatus(response.data || null);
    return response;
  }, 'Conexao testada.', 'Nao foi possivel testar a conexao.');

  const clearWhatsAppManagementData = () => {
    const confirmation = window.prompt('Digite LIMPAR para apagar os dados de teste e recriar a base WhatsApp.');
    if (confirmation !== 'LIMPAR') return null;
    return runAction('clear-data', async () => {
      const response = await api.delete('/api/admin/whatsapp-management/data');
      setQrResult(null);
      await loadBaseData({ silent: true });
      return response;
    }, 'Base WhatsApp limpa e recriada.', 'Nao foi possivel limpar a base.');
  };

  const sendDailyOpenDemandReminders = () => {
    if (!window.confirm('Enviar agora os avisos diarios via WhatsApp?')) return null;
    return runAction('daily-reminders', async () => {
      const response = await api.post('/api/admin/whatsapp-reminders/daily-open-demands/run');
      await loadBaseData({ silent: true });
      return response;
    }, 'Avisos diarios enfileirados.', 'Nao foi possivel enviar avisos diarios.');
  };

  const sendWeeklyAdminComplaintReport = () => {
    if (!window.confirm('Enviar agora o relatorio semanal via WhatsApp?')) return null;
    return runAction('weekly-report', async () => {
      const response = await api.post('/api/admin/whatsapp-reports/weekly-complaints/run');
      await loadBaseData({ silent: true });
      return response;
    }, 'Relatorio semanal enfileirado.', 'Nao foi possivel enviar relatorio semanal.');
  };

  const printWhatsAppReport = () => {
    window.print();
  };

  const getPartnerVideoReportRows = () => {
    const controls = Array.isArray(partnersVideo?.controls) ? partnersVideo.controls : [];
    const contacts = Array.isArray(partnersVideo?.contacts) ? partnersVideo.contacts : [];
    const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
    return controls.map((item) => {
      const contact = contactById.get(String(item.partner_id)) || {};
      return {
        data: String(item.date || '').slice(0, 10),
        unidade: item.clinic_name || contact.clinic_name || '',
        parceiro: item.partner_name || contact.partner_name || '',
        telefone: item.phone_number || contact.phone_number || '',
        status_video: item.status || '',
        status_mensagem: item.message_status || '',
        envio_mensagem: item.message_sent_at ? String(item.message_sent_at).slice(0, 16).replace('T', ' ') : '',
        video_recebido: Number(item.video_received) ? 'Sim' : 'Não',
        recebido_em: item.video_received_at ? String(item.video_received_at).slice(0, 16).replace('T', ' ') : '',
        lider_acionado: item.leader_notified_at ? 'Sim' : 'Não',
        coordenador_acionado: item.coordinator_notified_at ? 'Sim' : 'Não',
        gerente_acionado: item.manager_notified_at ? 'Sim' : 'Não',
        observacoes: item.notes || ''
      };
    });
  };

  const exportPartnerVideoExcel = () => {
    const rows = getPartnerVideoReportRows();
    if (!rows.length) {
      setError('Nenhum controle diário encontrado para exportar.');
      return;
    }
    exportCsv('confirmacao-agendamento-videos.csv', rows);
    setSuccess('Relatório Excel de Confirmação e Agendamento gerado.');
  };

  const printPartnerVideoPdf = () => {
    const rows = getPartnerVideoReportRows();
    if (!rows.length) {
      setError('Nenhum controle diário encontrado para gerar PDF.');
      return;
    }
    const summary = partnersVideo?.summary || {};
    const generatedAt = new Date().toLocaleString('pt-BR');
    const htmlRows = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.unidade)}</td>
        <td>${escapeHtml(row.parceiro)}</td>
        <td>${escapeHtml(row.telefone)}</td>
        <td>${escapeHtml(row.status_video)}</td>
        <td>${escapeHtml(row.envio_mensagem)}</td>
        <td>${escapeHtml(row.video_recebido)}</td>
        <td>${escapeHtml(row.coordenador_acionado)}</td>
        <td>${escapeHtml(row.gerente_acionado)}</td>
      </tr>
    `).join('');
    const reportWindow = window.open('', '_blank', 'width=1120,height=780');
    if (!reportWindow) {
      setError('Não foi possível abrir a janela de PDF. Verifique o bloqueador de pop-up.');
      return;
    }
    reportWindow.document.write(`
      <html>
        <head>
          <title>Relatório Confirmação e Agendamento</title>
          <style>
            body { font-family: Arial, sans-serif; color: #211a16; margin: 32px; }
            header { border-bottom: 3px solid #8e6731; padding-bottom: 16px; margin-bottom: 20px; }
            h1 { margin: 0; font-size: 26px; }
            p { color: #5f5146; }
            .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .card { border: 1px solid #ddcfbc; border-radius: 8px; padding: 12px; background: #fbf8f2; }
            .card span { display: block; color: #8e6731; font-size: 11px; font-weight: 800; text-transform: uppercase; }
            .card strong { display: block; margin-top: 6px; font-size: 22px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border-bottom: 1px solid #ddcfbc; padding: 9px; text-align: left; vertical-align: top; font-size: 12px; }
            th { background: #f4ecdf; color: #6d573b; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <header>
            <h1>Relatório de vídeos dos parceiros</h1>
            <p>Confirmação e Agendamento · Emitido em ${escapeHtml(generatedAt)}</p>
          </header>
          <section class="cards">
            <div class="card"><span>Mensagens hoje</span><strong>${Number(summary.sentToday || 0)}</strong></div>
            <div class="card"><span>No prazo</span><strong>${Number(summary.receivedOnTime || 0)}</strong></div>
            <div class="card"><span>Regra 40%</span><strong>${Number(summary.complianceRate || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong></div>
            <div class="card"><span>Pendentes</span><strong>${Number(summary.pendingToday || 0)}</strong></div>
            <div class="card"><span>Não enviados</span><strong>${Number(summary.pendingAfter10 || 0)}</strong></div>
          </section>
          <table>
            <thead><tr><th>Unidade</th><th>Parceiro</th><th>Telefone</th><th>Status</th><th>Envio</th><th>Recebido</th><th>Coord.</th><th>Gerente</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    reportWindow.document.close();
    setSuccess('Relatório PDF de Confirmação e Agendamento preparado.');
  };

  const Button = ({ actionKey, children, className = 'outline-action', disabled = false, ...props }) => (
    <button type="button" className={className} disabled={Boolean(savingKey) || disabled} {...props}>
      {savingKey === actionKey ? 'Aguarde...' : children}
    </button>
  );

  const renderDashboard = () => {
    const summary = dashboard?.summary || {};
    const connectedCount = instances.filter((item) => String(item.status || '').toLowerCase() === 'conectado').length;
    const disconnectedCount = Math.max(0, instances.length - connectedCount);
    const sentToday = Number(summary.sentToday || 0);
    const receivedToday = Number(summary.receivedToday || 0);
    const totalMessagesToday = sentToday + receivedToday;
    const responseRate = Math.max(0, Math.min(100, Number(summary.responseRate || 0)));
    const healthScore = instances.length ? Math.round((connectedCount / instances.length) * 100) : 0;
    const queuePressure = Math.min(100, Math.round((queue.length / Math.max(1, queue.length + operators.length)) * 100));
    const topInstances = [...instances]
      .map((item) => ({
        ...item,
        volume: Number(item.message_count || item.messages_today || item.sent_today || item.received_today || 0)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8);
    const sectorMap = instances.reduce((map, item) => {
      const key = String(item.sector || 'Geral').trim() || 'Geral';
      const current = map.get(key) || { total: 0, connected: 0 };
      current.total += 1;
      if (String(item.status || '').toLowerCase() === 'conectado') current.connected += 1;
      map.set(key, current);
      return map;
    }, new Map());
    const sectorRows = Array.from(sectorMap.entries()).map(([label, value]) => ({
      label,
      total: value.total,
      connected: value.connected,
      percent: value.total ? Math.round((value.connected / value.total) * 100) : 0
    }));

    const cards = [
      { title: 'Saude das sessoes', value: `${healthScore}%`, helper: `${connectedCount} conectadas de ${instances.length}`, tone: healthScore >= 80 ? 'success' : healthScore >= 50 ? 'warning' : 'danger', progress: healthScore },
      { title: 'Mensagens hoje', value: totalMessagesToday, helper: `${sentToday} enviadas / ${receivedToday} recebidas`, tone: 'neutral', progress: Math.min(100, totalMessagesToday) },
      { title: 'Fila aberta', value: queue.length, helper: 'Atendimentos pendentes', tone: queue.length ? 'warning' : 'success', progress: queuePressure },
      { title: 'Taxa resposta', value: `${responseRate.toLocaleString('pt-BR')}%`, helper: 'Indicador operacional', tone: responseRate >= 80 ? 'success' : responseRate >= 50 ? 'warning' : 'danger', progress: responseRate }
    ];

    return (
      <>
        <section className="whatsapp-bi-command">
          <div>
            <p className="eyebrow">BI operacional</p>
            <h2>Central WhatsApp CRC</h2>
            <p>Indicadores em tempo real para acompanhar sessoes, fila, mensagens e risco operacional.</p>
          </div>
          <div className="whatsapp-bi-toggle" role="tablist" aria-label="Visao do dashboard WhatsApp">
            {[
              ['overview', 'Operacao'],
              ['sessions', 'Sessoes'],
              ['queue', 'Fila']
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={dashboardView === key ? 'active' : ''}
                onClick={() => setDashboardView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="whatsapp-kpi-grid whatsapp-bi-kpi-grid">
          {cards.map((card) => (
            <article className={`whatsapp-kpi ${card.tone}`} key={card.title}>
              <span>{card.title}</span>
              <strong>{card.value}</strong>
              <small>{card.helper}</small>
              <div className="whatsapp-kpi-progress"><i style={{ width: `${card.progress}%` }} /></div>
            </article>
          ))}
        </section>

        {dashboardView === 'overview' && (
          <section className="whatsapp-bi-grid">
            <article className="whatsapp-panel whatsapp-bi-panel">
              <h2>Capacidade da central</h2>
              <div className="whatsapp-bi-meter">
                <strong>{healthScore}%</strong>
                <span>saude das conexoes</span>
                <i><b style={{ width: `${healthScore}%` }} /></i>
              </div>
              <div className="whatsapp-bi-mini-list">
                <span><strong>{connectedCount}</strong> sessoes conectadas</span>
                <span><strong>{disconnectedCount}</strong> sessoes sem conexao</span>
                <span><strong>{operators.length}</strong> operadores habilitados</span>
              </div>
            </article>

            <article className="whatsapp-panel whatsapp-bi-panel">
              <h2>Movimento do dia</h2>
              <div className="whatsapp-bi-bars">
                <label><span>Enviadas</span><i><b style={{ width: `${Math.min(100, sentToday)}%` }} /></i><strong>{sentToday}</strong></label>
                <label><span>Recebidas</span><i><b style={{ width: `${Math.min(100, receivedToday)}%` }} /></i><strong>{receivedToday}</strong></label>
                <label><span>Ausentes</span><i><b style={{ width: `${Math.min(100, absent.length * 8)}%` }} /></i><strong>{absent.length}</strong></label>
              </div>
            </article>

            <article className="whatsapp-panel whatsapp-bi-panel">
              <h2>Leitura por setor</h2>
              <div className="whatsapp-bi-sector-list">
                {sectorRows.length ? sectorRows.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}<small>{item.connected}/{item.total} conectadas</small></span>
                    <i><b style={{ width: `${item.percent}%` }} /></i>
                  </div>
                )) : <p className="whatsapp-panel-note">Nenhuma sessao cadastrada ainda.</p>}
              </div>
            </article>
          </section>
        )}

        {dashboardView === 'sessions' && (
          <section className="whatsapp-panel whatsapp-bi-panel">
            <div className="whatsapp-panel-head">
              <div>
                <h2>Sessoes monitoradas</h2>
                <p className="whatsapp-panel-note">Status das conexoes, clinica vinculada e volume recente quando disponivel.</p>
              </div>
            </div>
            <div className="whatsapp-bi-session-grid">
              {topInstances.map((item) => {
                const connected = String(item.status || '').toLowerCase() === 'conectado';
                return (
                  <article key={item.instance_name} className={connected ? 'online' : 'offline'}>
                    <span>{item.display_name || item.instance_name}</span>
                    <strong>{connected ? 'Conectada' : (item.status || 'sem status')}</strong>
                    <p>{item.clinic_name || item.phone_number || 'Sem clinica vinculada'}</p>
                    <i><b style={{ width: `${Math.min(100, item.volume || (connected ? 60 : 18))}%` }} /></i>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {dashboardView === 'queue' && (
          <section className="whatsapp-panel whatsapp-bi-panel">
            <div className="whatsapp-panel-head">
              <div>
                <h2>Fila e retorno</h2>
                <p className="whatsapp-panel-note">Pacientes aguardando atendimento ou retorno ativo no WhatsApp.</p>
              </div>
            </div>
            <div className="whatsapp-bi-queue-list">
              {queue.slice(0, 10).map((item, index) => (
                <article key={item.id || `${item.phone || item.patient_phone}-${index}`}>
                  <span>{item.patient_name || item.name || 'Paciente nao identificado'}</span>
                  <strong>{item.status || item.queue_status || 'pendente'}</strong>
                  <small>{item.clinic_name || item.instance_name || item.phone || item.patient_phone || '-'}</small>
                </article>
              ))}
              {!queue.length && <p className="whatsapp-panel-note">Nenhum atendimento pendente neste momento.</p>}
            </div>
          </section>
        )}
      </>
    );
  };

  const renderInstances = () => (
    <section className="whatsapp-two-column">
      {canConfigure && (
        <article ref={instanceEditorRef} className={`whatsapp-panel whatsapp-campaign-side-panel ${editingInstanceName ? 'whatsapp-instance-editor-active' : ''}`}>
          <div className="whatsapp-panel-head">
            <div>
              <h2>{editingInstanceName ? 'Editar numero' : 'Novo numero'}</h2>
              <p className="whatsapp-panel-note">
                {editingInstanceName
                  ? 'Modo edicao ativo. Altere o telefone, confira clinica/unidade e clique em Salvar alteracoes.'
                  : 'Cadastre ou vincule um numero WhatsApp a uma clinica para liberar roteamento e campanhas.'}
              </p>
            </div>
            {editingInstanceName && <span className="whatsapp-editing-pill">Editando</span>}
          </div>
          <div className="whatsapp-form-grid">
            <label>Identificacao<input className="field" value={instanceDraft.instance_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, instance_name: event.target.value }))} disabled={Boolean(editingInstanceName)} /></label>
            <label>Nome de exibicao<input className="field" value={instanceDraft.display_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
            <label>Setor<select className="field" value={instanceDraft.sector} onChange={(event) => setInstanceDraft((current) => ({ ...current, sector: event.target.value }))}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Clinica<select className="field" value={instanceDraft.clinic_id} onChange={(event) => setInstanceDraft((current) => ({ ...current, clinic_id: event.target.value }))}><option value="">Sem vinculo</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
            <label>Unidade<input className="field" value={instanceDraft.unit_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
            <label>Numero WhatsApp<input ref={instancePhoneInputRef} className="field" value={instanceDraft.phone_number} onChange={(event) => setInstanceDraft((current) => ({ ...current, phone_number: normalizePhone(event.target.value) }))} placeholder="5562999999999" /></label>
            {canRouteAttendance && (
              <label>Atendente responsavel
                <select className="field" value={instanceDraft.operator_id} onChange={(event) => setInstanceDraft((current) => ({ ...current, operator_id: event.target.value }))}>
                  <option value="">Fila automatica</option>
                  {operators.map((operator) => <option key={operator.id} value={operator.id}>{operatorLabel(operator)}</option>)}
                </select>
              </label>
            )}
          </div>
          <label>Observacoes<textarea className="field textarea" value={instanceDraft.notes} onChange={(event) => setInstanceDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <div className="row-actions">
            <Button actionKey="save-instance" className="primary-action" onClick={saveInstance}>{editingInstanceName ? 'Salvar alteracoes' : 'Cadastrar numero'}</Button>
            {editingInstanceName && <button type="button" className="outline-action" onClick={cancelInstanceEdit}>Cancelar</button>}
          </div>
        </article>
      )}

      {canRouteAttendance && (
        <article className="whatsapp-panel">
          <h2>Clinicas do Operador CRC</h2>
          <p className="whatsapp-panel-note">Selecione o operador e marque as clinicas que ele pode atender.</p>
          <label>Operador
            <select className="field" value={operatorClinicEditorId} onChange={(event) => openOperatorClinicEditor(event.target.value)}>
              <option value="">Selecione</option>
              {operators.map((operator) => <option key={operator.id} value={operator.id}>{operatorLabel(operator)}</option>)}
            </select>
          </label>
          <div className="whatsapp-clinic-check-grid">
            {clinics.map((clinic) => (
              <label key={clinic.id}>
                <input type="checkbox" checked={operatorClinicIds.includes(String(clinic.id))} onChange={() => toggleOperatorClinic(clinic.id)} disabled={!operatorClinicEditorId} />
                <span>{clinic.name}<small>{clinic.city || 'Cidade'} / {clinic.state || 'UF'}</small></span>
              </label>
            ))}
          </div>
          <Button actionKey="operator-clinics" className="primary-action" onClick={saveOperatorClinics} disabled={!operatorClinicEditorId}>Salvar clinicas</Button>
        </article>
      )}

      <article className="whatsapp-panel whatsapp-instances-list-panel">
        <h2>Numeros cadastrados</h2>
        <div className="whatsapp-instances-card-grid">
          {instances.map((item) => (
            <article className="whatsapp-instance-card" key={item.id || item.instance_name}>
              <header className="whatsapp-instance-card-header">
                <div>
                  <span>{item.instance_name}</span>
                  <strong>{item.display_name || item.instance_name}</strong>
                  <small>{item.clinic_name || item.unit_name || 'Sem clinica vinculada'}</small>
                </div>
                <em className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status || 'sem status'}</em>
              </header>
              <dl className="whatsapp-instance-meta">
                <div><dt>Numero</dt><dd>{item.phone_number || '-'}</dd></div>
                <div><dt>Setor</dt><dd>{item.sector || '-'}</dd></div>
                <div><dt>Fila</dt><dd>{formatNumber(item.queue_count || 0)}</dd></div>
                <div><dt>Mensagens</dt><dd>{formatNumber(item.message_count || 0)}</dd></div>
                <div><dt>Ultima atividade</dt><dd>{String(item.last_activity_at || item.last_status_check_at || '-').slice(0, 16).replace('T', ' ')}</dd></div>
                <div>
                  <dt>Atendente</dt>
                  <dd>{canRouteAttendance ? (
                    <select className="field compact-select" value={item.operator_id || ''} onChange={(event) => assignInstanceOperator(item.instance_name, event.target.value)}>
                      <option value="">Fila automatica</option>
                      {operators.map((operator) => <option key={operator.id} value={operator.id}>{operatorLabel(operator)}</option>)}
                    </select>
                  ) : (item.operator_name || 'Fila automatica')}</dd>
                </div>
              </dl>
              <div className="whatsapp-instance-actions">
                {canConfigure && <Button actionKey={`qr-${item.instance_name}`} className="outline-action mini-action" onClick={() => generateQrCode(item.instance_name)}>QR Code</Button>}
                {canConfigure && <Button actionKey={`reconnect-${item.instance_name}`} className="outline-action mini-action" onClick={() => reconnectInstance(item.instance_name)}>Reconectar</Button>}
                <Button actionKey={`test-${item.instance_name}`} className="outline-action mini-action" onClick={() => testInstanceMessage(item.instance_name)}>Teste</Button>
                {canConfigure && <Button actionKey={`logout-${item.instance_name}`} className="outline-action mini-action" onClick={() => logoutInstance(item.instance_name)}>Desconectar</Button>}
                {canConfigure && <button type="button" className="outline-action mini-action" onClick={() => editInstance(item)}>Editar</button>}
                {canDeleteWhatsappItems && <Button actionKey={`delete-${item.instance_name}`} className="outline-action danger-action mini-action" onClick={() => deleteInstance(item.instance_name)}>Excluir</Button>}
              </div>
            </article>
          ))}
          {!instances.length && <p className="empty-state">Nenhum numero cadastrado.</p>}
        </div>
      </article>
    </section>
  );

  const renderAttendance = () => (
    <section className="whatsapp-attendance-layout">
      <aside className="whatsapp-conversation-list">
        <div className="whatsapp-operator-status-card">
          <span>Seu status</span>
          <select className="field" onChange={(event) => updateOperatorStatus(event.target.value)} defaultValue="online">
            {operatorStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        {canRouteAttendance && <Button actionKey="auto-assign" className="outline-action mini-action" onClick={runAutoAssign}>Distribuir fila</Button>}
        <h3>Fila</h3>
        <div className="whatsapp-list-scroll">
          {queue.map((item) => {
            const queueConversationId = item.conversation_id;
            return (
              <button
                key={item.id || queueConversationId}
                type="button"
                disabled={!queueConversationId}
                onClick={() => queueConversationId && setSelectedConversationId(String(queueConversationId))}
              >
                <strong>{item.patient_name || 'Paciente'}</strong>
                <span>{item.patient_phone}</span>
                <small>{item.status}</small>
              </button>
            );
          })}
          {!queue.length && <p className="empty-state">Fila vazia.</p>}
        </div>
        <h3>Conversas</h3>
        <div className="whatsapp-list-scroll">
          {conversations.map((item) => (
            <button key={item.id} type="button" className={String(selectedConversation?.id) === String(item.id) ? 'active' : ''} onClick={() => setSelectedConversationId(String(item.id))}>
              <strong>{item.patient_name || 'Paciente'}</strong>
              <span>{item.patient_phone}</span>
              <small>{item.status || 'Novo'}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="whatsapp-chat-panel">
        <header><strong>{selectedConversation?.patient_name || 'Selecione uma conversa'}</strong><span>{selectedConversation?.patient_phone || '-'}</span></header>
        <div className="whatsapp-message-thread">
          {messages.map((message) => (
            <div key={message.id} className={`whatsapp-message-bubble ${String(message.direction || '').includes('out') ? 'outbound' : 'inbound'}`}>
              <p>{message.message_text || message.message}</p>
              <small>{message.operator_name || message.direction} - {String(message.created_at || '').slice(0, 16).replace('T', ' ')}</small>
            </div>
          ))}
          {!messages.length && <p className="empty-state">Sem mensagens carregadas.</p>}
        </div>
        <div className="whatsapp-chat-composer">
          <textarea
            className="field textarea"
            value={attendanceMessage}
            onChange={(event) => setAttendanceMessage(event.target.value)}
            placeholder={selectedConversation ? 'Digite a resposta ao paciente' : 'Selecione uma conversa para responder'}
            disabled={!selectedConversation}
          />
          <Button actionKey="send-message" className="primary-action" onClick={() => sendMessage({
            ...sendDraft,
            conversation_id: selectedConversation?.id,
            instance_name: selectedConversation?.instance_name || preferredInstance?.instance_name,
            patient_phone: selectedConversation?.patient_phone,
            patient_name: selectedConversation?.patient_name,
            clinic_id: selectedConversation?.clinic_id,
            clinic_name: selectedConversation?.clinic_name,
            message_text: attendanceMessage
          })} disabled={!selectedConversation || !attendanceMessage}>Enviar</Button>
        </div>
      </section>

      <aside className="whatsapp-patient-panel">
        <h3>Dados do paciente</h3>
        <p><span>Paciente</span><strong>{selectedConversation?.patient_name || '-'}</strong></p>
        <p><span>Telefone</span><strong>{selectedConversation?.patient_phone || '-'}</strong></p>
        <p><span>Clinica</span><strong>{selectedConversation?.clinic_name || '-'}</strong></p>
        <p><span>Operador</span><strong>{selectedConversation?.operator_name || '-'}</strong></p>
        <label>Status
          <select
            className="field"
            value={selectedConversation?.status || 'Novo'}
            disabled={!selectedConversation}
            onChange={(event) => selectedConversation && updateConversation(selectedConversation, { status: event.target.value })}
          >
            {attendanceStatuses.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        {canRouteAttendance && (
          <label>Transferir para
            <select className="field" value={transferTargetId} disabled={!selectedConversation} onChange={(event) => setTransferTargetId(event.target.value)}>
              <option value="">Fila automatica</option>
              {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
            </select>
          </label>
        )}
        <div className="row-actions">
          <Button actionKey={`claim-${selectedConversation?.id}`} onClick={() => claimConversation(selectedConversation?.id)} disabled={!selectedConversation}>Assumir</Button>
          {canRouteAttendance && <Button actionKey={`transfer-${selectedConversation?.id}`} onClick={() => transferConversation(selectedConversation?.id)} disabled={!selectedConversation}>Transferir</Button>}
          <Button actionKey={`absent-${selectedConversation?.id}`} onClick={() => markAbsent(selectedConversation)} disabled={!selectedConversation}>Marcar ausente</Button>
          <Button actionKey={`conversation-${selectedConversation?.id}`} className="primary-action" onClick={() => updateConversation(selectedConversation, { status: 'Encerrado' })} disabled={!selectedConversation}>Finalizar</Button>
        </div>
      </aside>
    </section>
  );

  const renderSend = () => (
    <section className="whatsapp-two-column">
      <article className="whatsapp-panel">
        <div className="whatsapp-panel-head">
          <div>
            <h2>Envio manual</h2>
            <p className="whatsapp-panel-note">Envie uma mensagem individual com sessao, paciente e clinica definidos para manter rastreabilidade.</p>
          </div>
          <span className={`whatsapp-badge ${selectedSendInstanceBlocked ? 'danger' : 'success'}`}>
            {selectedSendInstanceBlocked ? 'Sessao bloqueada' : 'Pronto para envio'}
          </span>
        </div>
        <div className="whatsapp-form-grid">
          <label>Sessao<select className="field" value={sendDraft.instance_name} onChange={(event) => setSendDraft((current) => ({ ...current, instance_name: event.target.value }))}><option value="">Selecione</option>{instances.map((item) => <option key={item.instance_name} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}</select></label>
          <label>Telefone<input className="field" value={sendDraft.patient_phone} onChange={(event) => setSendDraft((current) => ({ ...current, patient_phone: normalizePhone(event.target.value) }))} placeholder="5562999999999" /></label>
          <label>Paciente<input className="field" value={sendDraft.patient_name} onChange={(event) => setSendDraft((current) => ({ ...current, patient_name: event.target.value }))} /></label>
          <label>Clinica<select className="field" value={sendDraft.clinic_id} onChange={(event) => {
            const clinic = clinics.find((item) => String(item.id) === String(event.target.value));
            setSendDraft((current) => ({ ...current, clinic_id: event.target.value, clinic_name: clinic?.name || '' }));
          }}><option value="">Selecione</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
          <label>Mensagem padrao<select className="field" value={sendDraft.template_id} onChange={(event) => {
            const template = templates.find((item) => String(item.id) === String(event.target.value));
            setSendDraft((current) => ({ ...current, template_id: event.target.value, message_text: template?.message_text || current.message_text }));
          }}><option value="">Mensagem livre</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Operador<input className="field" value={user?.name || ''} readOnly /></label>
        </div>
        {selectedSendInstanceBlocked && (
          <p className="form-feedback error">
            A sessao {selectedSendInstance?.display_name || selectedSendInstance?.instance_name} esta com status "{selectedSendInstance?.status}". Reconecte o numero antes de enviar.
          </p>
        )}
        <label>Mensagem<textarea className="field textarea" value={sendDraft.message_text} onChange={(event) => setSendDraft((current) => ({ ...current, message_text: event.target.value }))} /></label>
        <div className="row-actions">
          <Button actionKey="send-message" className="primary-action" onClick={() => sendMessage(sendDraft)} disabled={selectedSendInstanceBlocked}>Enviar mensagem</Button>
        </div>
      </article>
      <article className="whatsapp-panel whatsapp-guidance-panel">
        <div className="whatsapp-panel-head">
          <div>
            <h2>Checklist de qualidade</h2>
            <p className="whatsapp-panel-note">Leitura rapida para o operador validar antes de disparar.</p>
          </div>
        </div>
        <div className="whatsapp-guidance-list">
          <article>
            <span>Sessao</span>
            <strong>{selectedSendInstance?.display_name || 'Selecione uma sessao'}</strong>
            <p>Use o numero certo para o contexto de atendimento, confirmacao ou NPS.</p>
          </article>
          <article>
            <span>Paciente</span>
            <strong>{sendDraft.patient_name ? String(sendDraft.patient_name).toUpperCase() : 'Nao informado'}</strong>
            <p>O nome segue padronizado em CAIXA ALTA para manter consistencia visual.</p>
          </article>
          <article>
            <span>Template</span>
            <strong>{templates.find((item) => String(item.id) === String(sendDraft.template_id))?.title || 'Mensagem livre'}</strong>
            <p>Prefira mensagem padrao quando o contato exigir historico, auditoria ou repeticao.</p>
          </article>
          <article>
            <span>Destino</span>
            <strong>{sendDraft.patient_phone || 'Sem telefone'}</strong>
            <p>Revise DDI, DDD e clinica antes de confirmar o disparo.</p>
          </article>
        </div>
      </article>
    </section>
  );

  const renderTemplates = () => (
    <section className="whatsapp-two-column">
      <article className="whatsapp-panel">
        <h2>{editingTemplateId ? 'Editar mensagem' : 'Nova mensagem padrao'}</h2>
        <div className="whatsapp-form-grid">
          <label>Titulo<input className="field" value={templateDraft.title} onChange={(event) => setTemplateDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label>Categoria<select className="field" value={templateDraft.category} onChange={(event) => setTemplateDraft((current) => ({ ...current, category: event.target.value }))}>{templateCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Status<select className="field" value={templateDraft.status} onChange={(event) => setTemplateDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
        </div>
        <label>Texto<textarea className="field textarea" value={templateDraft.message_text} onChange={(event) => setTemplateDraft((current) => ({ ...current, message_text: event.target.value }))} /></label>
        <div className="row-actions">
          <Button actionKey="template" className="primary-action" onClick={saveTemplate}>{editingTemplateId ? 'Salvar alteracoes' : 'Salvar mensagem'}</Button>
          {editingTemplateId && <button type="button" className="outline-action" onClick={() => { setEditingTemplateId(''); setTemplateDraft(emptyTemplate()); }}>Cancelar</button>}
        </div>
      </article>
      <article className="whatsapp-panel">
        <h2>Mensagens cadastradas</h2>
        <div className="whatsapp-card-list">
          {templates.map((template) => (
            <article key={template.id}>
              <span>{template.category}</span>
              <strong>{template.title}</strong>
              <p>{String(template.message_text || '').slice(0, 160)}</p>
              <div className="row-actions">
                <button type="button" className="outline-action mini-action" onClick={() => editTemplate(template)}>Editar</button>
                <button type="button" className="outline-action mini-action" onClick={() => duplicateTemplate(template)}>Duplicar</button>
                {canDeleteTemplates && <Button actionKey={`template-delete-${template.id}`} className="outline-action danger-action mini-action" onClick={() => deleteTemplate(template.id)}>Excluir</Button>}
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );

  const renderChatbot = () => (
    <section className="whatsapp-two-column">
      <article className="whatsapp-panel">
        <h2>{editingFlowId ? 'Editar fluxo' : 'Novo fluxo'}</h2>
        <div className="whatsapp-form-grid">
          <label>Nome<input className="field" value={flowDraft.flow_name} onChange={(event) => setFlowDraft((current) => ({ ...current, flow_name: event.target.value }))} /></label>
          <label>Sessao<select className="field" value={flowDraft.instance_name} onChange={(event) => setFlowDraft((current) => ({ ...current, instance_name: event.target.value }))}><option value="">Todas</option>{instances.map((item) => <option key={item.instance_name} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}</select></label>
          <label>Gatilho<select className="field" value={flowDraft.trigger_type} onChange={(event) => setFlowDraft((current) => ({ ...current, trigger_type: event.target.value }))}>{triggerTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Valor<input className="field" value={flowDraft.trigger_value} onChange={(event) => setFlowDraft((current) => ({ ...current, trigger_value: event.target.value }))} /></label>
        </div>
        <label>Mensagem inicial<textarea className="field textarea" value={flowDraft.initial_message} onChange={(event) => setFlowDraft((current) => ({ ...current, initial_message: event.target.value }))} /></label>
        <div className="row-actions">
          <Button actionKey="flow" className="primary-action" onClick={saveFlow}>{editingFlowId ? 'Salvar alteracoes' : 'Salvar fluxo'}</Button>
          <Button actionKey="chatbot-bootstrap" onClick={bootstrapProfessionalChatbot}>Preparar NPS e confirmacao</Button>
          {editingFlowId && <button type="button" className="outline-action" onClick={() => { setEditingFlowId(''); setFlowDraft(emptyFlow()); }}>Cancelar</button>}
        </div>
      </article>
      <article className="whatsapp-panel">
        <h2>Fluxos cadastrados</h2>
        <div className="whatsapp-card-list">
          {flows.map((flow) => (
            <article key={flow.id}>
              <span>{flow.trigger_type}</span>
              <strong>{flow.flow_name}</strong>
              <p>{String(flow.initial_message || '').slice(0, 160)}</p>
              <div className="row-actions">
                <button type="button" className="outline-action mini-action" onClick={() => editFlow(flow)}>Editar</button>
                {canDeleteFlows && <Button actionKey={`flow-delete-${flow.id}`} className="outline-action danger-action mini-action" onClick={() => deleteFlow(flow.id)}>Excluir</Button>}
              </div>
            </article>
          ))}
        </div>
        <h2 style={{ marginTop: 24 }}>Sessoes recentes do chatbot</h2>
        <div className="whatsapp-card-list compact">
          {chatbotSessions.map((session) => (
            <article key={session.id}>
              <span>{session.flow_name || `Fluxo #${session.flow_id}`}</span>
              <strong>{session.patient_name || session.patient_phone}</strong>
              <p>{session.patient_phone} - {session.status} - passo {session.current_step_order || 1}</p>
            </article>
          ))}
          {!chatbotSessions.length && <p className="empty-state">Nenhuma sessao conversacional registrada ainda.</p>}
        </div>
      </article>
    </section>
  );

  const renderCampaigns = () => {
    const matchingTemplates = templates.filter((item) => (
      campaignDraft.campaign_type === 'nps'
        ? String(item.category || '').toLowerCase() === 'nps'
        : String(item.category || '').toLowerCase().includes('confirma')
    ));
    const selectedTemplate = matchingTemplates.find((item) => String(item.id) === String(campaignDraft.template_id)) || null;
    const selectedPreviewRows = campaignPreview.filter((item) => campaignSelection.includes(item.preview_id));
    const selectedReadyRows = selectedPreviewRows.filter((item) => item.resolved);
    const selectedBlockedRows = selectedPreviewRows.filter((item) => !item.resolved);
    const allowedClinicNames = clinics
      .map((clinic) => String(clinic.name || clinic.nome || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    const remainingClinicCount = Math.max(0, clinics.length - allowedClinicNames.length);
    const selectedCampaignClinic = clinics.find((clinic) => String(clinic.id) === String(campaignDraft.campaign_clinic_id)) || null;
    const selectedCampaignClinicInstance = selectedCampaignClinic
      ? instances.find((item) => String(item.clinic_id) === String(selectedCampaignClinic.id) && String(item.sector || '').toLowerCase().includes('confirma'))
        || instances.find((item) => String(item.clinic_id) === String(selectedCampaignClinic.id))
      : null;
    const selectedCampaignClinicStatus = String(selectedCampaignClinicInstance?.status || '').trim().toLowerCase();
    const selectedCampaignClinicReady = Boolean(selectedCampaignClinicInstance) && ['conectado', 'connected'].includes(selectedCampaignClinicStatus);

    return (
      <section className="whatsapp-campaigns-layout">
        <article className="whatsapp-panel whatsapp-campaign-builder-card">
          <div className="whatsapp-panel-head">
            <div>
              <h2>Campanhas em massa</h2>
              <p className="whatsapp-panel-note">Monte o lote, importe a base e valide a conferencia antes do envio. A fila respeita anti-ban, aquecimento e rastreabilidade por paciente.</p>
            </div>
            <Button actionKey={`campaign-template-${campaignDraft.campaign_type}`} className="outline-action" onClick={() => downloadCampaignTemplate(campaignDraft.campaign_type)}>Baixar template Excel</Button>
          </div>
          <section className="whatsapp-campaign-hero whatsapp-campaign-command-grid">
            <article className="campaign-command-card is-primary">
              <span>Canal do lote</span>
              <strong>{campaignDraft.campaign_type === 'confirmacao' ? 'WhatsApp da clinica logada' : 'Sessao central NPS'}</strong>
              <p>{campaignDraft.campaign_type === 'confirmacao' ? 'A clinica selecionada define o numero de envio do lote; se ficar em branco, vale a clinica informada na base.' : 'Os disparos de NPS seguem pela sessao central configurada para satisfacao.'}</p>
            </article>
            <article className="campaign-command-card is-template">
              <span>Template em uso</span>
              <strong>{selectedTemplate?.title || 'Mensagem livre'}</strong>
              <p>{String(selectedTemplate?.message_text || campaignDraft.message_text || '').slice(0, 180) || 'Defina o texto base da campanha para liberar o lote.'}</p>
            </article>
            <article className="campaign-command-card is-pattern">
              <span>Padrao da base</span>
              <strong>nome_paciente;telefone</strong>
              <p>Campos extras aceitos: clinica;data_consulta;hora_consulta. O nome sempre sai em CAIXA ALTA na mensagem final.</p>
            </article>
          </section>
          <section className="whatsapp-campaign-clinic-card">
            <div className="whatsapp-campaign-clinic-copy">
              <span>Clinica de envio</span>
              <h3>Escolha a unidade responsavel pelo lote</h3>
              <p>A clinica selecionada sera aplicada aos pacientes da campanha e o envio usara o WhatsApp vinculado a essa unidade. Deixe em branco apenas quando a planilha ja trouxer a coluna clinica por paciente.</p>
            </div>
            <label className="campaign-clinic-select-card">Clinica
              <select className="field" value={campaignDraft.campaign_clinic_id} onChange={(event) => handleCampaignClinicChange(event.target.value)}>
                <option value="">Usar clinica informada na lista</option>
                {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
              </select>
              <small className="whatsapp-field-hint">{clinics.length ? `${clinics.length} clinica(s) disponiveis para seu perfil.` : 'Nenhuma clinica disponivel para o seu perfil.'}</small>
            </label>
            <div className={`whatsapp-campaign-clinic-status ${selectedCampaignClinicReady ? 'ready' : 'blocked'}`}>
              <span>Status do WhatsApp</span>
              <strong>{selectedCampaignClinic ? (selectedCampaignClinicInstance?.display_name || selectedCampaignClinicInstance?.instance_name || 'Sem sessao vinculada') : 'Aguardando selecao'}</strong>
              <p>{selectedCampaignClinic ? (selectedCampaignClinicReady ? 'Sessao conectada para envio pela clinica.' : `Status: ${selectedCampaignClinicInstance?.status || 'sem conexao cadastrada'}.`) : 'Selecione uma clinica para conferir a sessao antes do envio.'}</p>
            </div>
          </section>
          <div className="whatsapp-campaign-control-grid whatsapp-campaign-form-surface">
            <label className="campaign-type-field">Tipo
              <select className="field" value={campaignDraft.campaign_type} onChange={(event) => {
                const nextType = event.target.value;
                setCampaignDraft((current) => ({
                  ...current,
                  campaign_type: nextType,
                  template_id: '',
                  message_text: DEFAULT_CAMPAIGN_MESSAGES[nextType] || DEFAULT_CAMPAIGN_MESSAGES.confirmacao
                }));
                resetCampaignPreview();
                setCampaignFile(null);
              }}>
                <option value="confirmacao">Confirmacao de atendimento</option>
                <option value="nps">NPS por WhatsApp</option>
              </select>
            </label>
            <label className="campaign-session-field">Sessao
              <select className="field" value={campaignDraft.session_id} onChange={(event) => setCampaignDraft((current) => ({ ...current, session_id: event.target.value }))} disabled={campaignDraft.campaign_type === 'confirmacao'}>
                {instances.map((item) => <option key={item.instance_name} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}
              </select>
              <small className="whatsapp-field-hint">
                {campaignDraft.campaign_type === 'confirmacao'
                  ? 'Confirmacao usa sempre o WhatsApp vinculado a clinica do paciente.'
                  : 'NPS usa a sessao central selecionada para o lote.'}
              </small>
            </label>
            <label className="campaign-template-field">Template
              <select className="field" value={campaignDraft.template_id} onChange={(event) => {
                const template = matchingTemplates.find((item) => String(item.id) === String(event.target.value));
                setCampaignDraft((current) => ({ ...current, template_id: event.target.value, message_text: template?.message_text || current.message_text }));
              }}>
                <option value="">Selecionar template</option>
                {matchingTemplates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <label className="campaign-message-field">Texto base
              <textarea className="field textarea" rows="5" value={campaignDraft.message_text} onChange={(event) => setCampaignDraft((current) => ({ ...current, message_text: event.target.value }))} placeholder="Use variaveis como {{nome_paciente}}, {{clinica}}, {{data_consulta}}, {{hora_consulta}} e {{link_nps}}." />
            </label>
          </div>
          <section className="whatsapp-allowed-clinic-strip">
            <div>
              <span>Clinicas liberadas para este operador</span>
              <strong>{clinics.length || 0}</strong>
            </div>
            <div className="whatsapp-allowed-clinic-tags">
              {allowedClinicNames.length ? allowedClinicNames.map((name) => <em key={name}>{name}</em>) : <em>Nenhuma clinica vinculada</em>}
              {remainingClinicCount > 0 ? <em>+{remainingClinicCount}</em> : null}
            </div>
          </section>
          <section className="whatsapp-campaign-import-grid whatsapp-campaign-workbench">
            <div className="campaign-recipient-field campaign-workbench-main">
              <div className="campaign-workbench-head">
                <div>
                  <span>Base operacional</span>
                  <strong>Lista para disparo</strong>
                </div>
                <button type="button" className="outline-action mini-action campaign-preview-text-action" onClick={previewCampaignTextList}>
                  Conferir lista digitada
                </button>
              </div>
              <textarea className="field textarea" rows="11" value={campaignDraft.recipients} onChange={(event) => {
                setCampaignDraft((current) => ({ ...current, recipients: event.target.value }));
                resetCampaignPreview();
                setCampaignFile(null);
              }} />
              <small className="whatsapp-field-hint">Cole uma linha por paciente ou importe o Excel padrao. A conferencia valida telefone, clinica, sessao e bloqueios antes do envio.</small>
            </div>
            <div className="whatsapp-campaign-upload-box campaign-upload-field campaign-workbench-side">
              <label>Upload da lista
                <input className="field" type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(event) => handleCampaignFileChange(event.target.files?.[0] || null)} />
              </label>
              <div className="whatsapp-campaign-upload-help">
                <article>
                  <span>Leitura suportada</span>
                  <strong>Excel, CSV e TXT</strong>
                  <p>Use a planilha padrao para reduzir falhas de estrutura e divergencia de clinica.</p>
                </article>
                <article>
                  <span>Conferencia</span>
                  <strong>Preview antes do disparo</strong>
                  <p>O sistema valida nome, telefone, clinica, sessao resolvida e itens bloqueados antes de enfileirar.</p>
                </article>
              </div>
            </div>
          </section>
          {campaignFile && <small className="bulk-file-name">Arquivo selecionado: {campaignFile.name}</small>}
          {campaignPreviewSummary && (
            <section className="whatsapp-panel whatsapp-campaign-preview-panel">
              <div className="whatsapp-panel-head">
                <div>
                  <h2>Conferencia da planilha</h2>
                  <p className="whatsapp-panel-note">Revise os pacientes importados antes do disparo. Na confirmação, cada linha segue pelo WhatsApp da clínica vinculada.</p>
                </div>
                <div className="whatsapp-row-actions">
                  <button type="button" className="outline-action mini-action" onClick={selectAllCampaignRecipients}>Selecionar todos os telefones</button>
                  <button type="button" className="outline-action mini-action" onClick={clearCampaignRecipientSelection}>Desmarcar</button>
                </div>
              </div>
              <div className="whatsapp-card-list compact">
                <article>
                  <span>Prontos</span>
                  <strong>{campaignPreviewSummary.ready || 0}</strong>
                  <p>Linhas com roteamento validado.</p>
                </article>
                <article>
                  <span>Bloqueados</span>
                  <strong>{campaignPreviewSummary.blocked || 0}</strong>
                  <p>Linhas sem clínica/sessão válida.</p>
                </article>
                <article>
                  <span>Selecionados</span>
                  <strong>{selectedPreviewRows.length}</strong>
                  <p>{selectedReadyRows.length} apto(s) para fila; {selectedBlockedRows.length} precisa(m) de correcao.</p>
                </article>
                <article>
                  <span>Inválidos</span>
                  <strong>{campaignPreviewSummary.invalid || 0}</strong>
                  <p>Linhas com falha de estrutura.</p>
                </article>
              </div>
              <div className="whatsapp-campaign-preview-list">
                {campaignPreview.map((item) => (
                  <label key={item.preview_id} className={`whatsapp-campaign-preview-item ${item.resolved ? '' : 'blocked'} ${campaignSelection.includes(item.preview_id) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={campaignSelection.includes(item.preview_id)}
                      onChange={() => toggleCampaignRecipientSelection(item.preview_id)}
                    />
                    <div>
                      <span>{item.patient_name}</span>
                      <strong>{item.patient_phone}</strong>
                      <p>{item.clinic_name || 'Clínica não informada'}</p>
                      <small>{item.resolved ? `Sessão: ${item.resolved_instance_display_name || item.resolved_instance_name}` : item.routing_error}</small>
                    </div>
                  </label>
                ))}
              </div>
              {campaignInvalidRows.length ? (
                <div className="whatsapp-campaign-invalid-list">
                  {campaignInvalidRows.slice(0, 8).map((item, index) => (
                    <p key={`${item.line || index}-${index}`}>Linha {item.line || index + 1}: {item.reason || item.content || 'Registro inválido.'}</p>
                  ))}
                </div>
              ) : null}
            </section>
          )}
          <div className="row-actions">
            <Button actionKey="mass-campaign" className="primary-action" onClick={sendMassCampaign}>Enfileirar campanha</Button>
          </div>
        </article>
        <article className="whatsapp-panel whatsapp-campaign-summary-panel">
          <div className="whatsapp-panel-head">
            <div>
              <h2>Operacao pronta</h2>
              <p className="whatsapp-panel-note">Resumo rapido para validar governanca, texto e comportamento antes do lote sair.</p>
            </div>
          </div>
          <div className="whatsapp-card-list compact campaign-readiness-stack">
            <article className="campaign-readiness-card is-featured">
              <span>Roteamento</span>
              <strong>{campaignDraft.campaign_type === 'confirmacao' ? 'Automatico por clinica' : 'Sessao central NPS'}</strong>
              <p>{campaignDraft.campaign_type === 'confirmacao' ? 'Cada paciente segue pelo WhatsApp vinculado à própria clínica.' : 'Os disparos de NPS seguem pela sessão central configurada.'}</p>
            </article>
            <article className="campaign-readiness-card">
              <span>Fluxo conversacional</span>
              <strong>{campaignDraft.campaign_type === 'nps' ? 'NPS' : 'Confirmacao'}</strong>
              <p>{campaignDraft.campaign_type === 'nps' ? 'A resposta pode ser capturada pelo fluxo NPS quando o paciente interagir no numero dedicado.' : 'A assistente registra SIM, reagendamento ou pedido de atendimento humano direto no sistema.'}</p>
            </article>
            <article className="campaign-readiness-card">
              <span>Escopo do operador</span>
              <strong>{normalizeRoleValue(user?.role) === 'crc_operator' ? 'Clinicas vinculadas' : 'Gestao ampliada'}</strong>
              <p>{normalizeRoleValue(user?.role) === 'crc_operator' ? 'O operador CRC nao consegue visualizar nem disparar para clinicas fora do proprio cadastro.' : 'Liderancas e perfis administrativos mantem visao consolidada da operacao.'}</p>
            </article>
            <article className="campaign-readiness-card">
              <span>Persistencia</span>
              <strong>Lote auditavel</strong>
              <p>Pacientes enviados ficam registrados com lote, clinica, sessao e status no banco para rastreabilidade posterior.</p>
            </article>
          </div>
        </article>
      </section>
    );
  };

  const renderAbsent = () => (
    <section className="whatsapp-panel">
      <h2>Pacientes ausentes</h2>
      <div className="whatsapp-card-list compact">
        {absent.map((item) => (
          <article key={item.id}>
            <span>{item.patient_phone}</span>
            <strong>{item.patient_name || 'Paciente'}</strong>
            <p>{item.reason || 'Sem resposta'} - Tentativas: {item.attempt_count || 0}</p>
            <div className="row-actions">
              <Button actionKey={`absent-return-${item.id}`} onClick={() => sendAbsentReturn(item)}>Enviar retorno</Button>
              <Button actionKey={`absent-status-${item.id}`} onClick={() => updateAbsentStatus(item, 'Recuperado')}>Recuperado</Button>
            </div>
          </article>
        ))}
        {!absent.length && <p className="empty-state">Nenhum paciente ausente.</p>}
      </div>
    </section>
  );

  const renderHistory = () => (
    <section className="whatsapp-panel">
      <h2>Historico de mensagens</h2>
      <div className="whatsapp-filter-row">
        <label>Busca<input className="field" value={historyFilters.search} onChange={(event) => setHistoryFilters((current) => ({ ...current, search: event.target.value }))} /></label>
        <label>Status<input className="field" value={historyFilters.status} onChange={(event) => setHistoryFilters((current) => ({ ...current, status: event.target.value }))} /></label>
        <label>Sessao<select className="field" value={historyFilters.instanceName} onChange={(event) => setHistoryFilters((current) => ({ ...current, instanceName: event.target.value }))}><option value="">Todas</option>{instances.map((item) => <option key={item.instance_name} value={item.instance_name}>{item.display_name || item.instance_name}</option>)}</select></label>
        <button type="button" className="outline-action" onClick={loadBaseData}>Filtrar</button>
      </div>
      <div className="whatsapp-table-wrap">
        <table className="whatsapp-table">
          <thead><tr><th>Data</th><th>Paciente</th><th>Telefone</th><th>Sessao</th><th>Operador</th><th>Status</th><th>Mensagem</th></tr></thead>
          <tbody>{history.map((item) => (
            <tr key={item.id}>
              <td>{String(item.created_at || '').slice(0, 16).replace('T', ' ')}</td>
              <td>{item.patient_name || '-'}</td>
              <td>{item.patient_phone || item.phone || '-'}</td>
              <td>{item.instance_name || item.session_id || '-'}</td>
              <td>{item.operator_name || '-'}</td>
              <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status || '-'}</span></td>
              <td>{item.message_text || item.message || '-'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );

  const renderReports = () => (
    <section className="whatsapp-panel">
      <h2>Relatorios</h2>
      <div className="whatsapp-report-actions">
        <button type="button" className="outline-action icon-action" onClick={() => exportCsv('whatsapp-historico.csv', history)}><span className="file-icon xls">XLS</span>Historico Excel</button>
        <button type="button" className="outline-action icon-action" onClick={() => exportCsv('whatsapp-ausentes.csv', absent)}><span className="file-icon xls">XLS</span>Ausentes Excel</button>
        <button type="button" className="outline-action icon-action" onClick={printWhatsAppReport}><span className="file-icon pdf">PDF</span>Relatorio PDF</button>
      </div>
      {renderDashboard()}
    </section>
  );

  const renderConfirmationScheduling = () => {
    const summary = partnersVideo?.summary || {};
    const controls = Array.isArray(partnersVideo?.controls) ? partnersVideo.controls : [];
    const contacts = Array.isArray(partnersVideo?.contacts) ? partnersVideo.contacts : [];
    const logs = Array.isArray(partnersVideo?.logs) ? partnersVideo.logs : [];
    const session = partnersVideo?.session || instances.find((item) => item.instance_name === 'confirmacao-agendamento') || {};
    const settings = partnerSettingsDraft || normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {});
    const allowedTimeList = String(settings.allowedTimes || '08:00\n18:00').split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
    const unitsWithoutPartnerNames = Array.isArray(summary.unitsWithoutPartnerNames) ? summary.unitsWithoutPartnerNames : [];
    const complianceRate = Number(summary.complianceRate || 0);
    const complianceGoal = Number(summary.complianceGoal || 40);
    const weekdayDescription = formatPartnerWeekdayLabels(settings.allowedWeekdays || [1, 2, 3, 4, 5, 6]);
    const controlsByPartnerId = new Set(controls.map((item) => String(item.partner_id || '')));
    const noVideoOptions = [
      ...controls.map((item) => ({
        key: `control:${item.id}`,
        clinicName: item.clinic_name,
        partnerName: item.partner_name,
        status: item.status || 'controle diario',
        phone: item.phone_number || ''
      })),
      ...contacts
        .filter((item) => Number(item.active) && !controlsByPartnerId.has(String(item.id)))
        .map((item) => ({
          key: `contact:${item.id}`,
          clinicName: item.clinic_name,
          partnerName: item.partner_name,
          status: 'sem controle no dia',
          phone: item.phone_number || ''
        }))
    ];
    const nonComplianceRows = controls.filter((item) => {
      const status = String(item.status || '').toLowerCase();
      return !Number(item.video_received) || status.includes('não enviado') || status.includes('nao enviado') || status.includes('acionado');
    });
    const confirmationConfirmed = confirmationResponses.filter((item) => item.confirmation_confirmed);
    const confirmationReschedule = confirmationResponses.filter((item) => item.confirmation_decision === 'reagendar');
    const confirmationHuman = confirmationResponses.filter((item) => item.confirmation_decision === 'humano');
    const qrUrl = `${(configStatus?.baseUrl || adminSettings?.baseUrl || 'http://2.24.101.6:3005').replace(/\/+$/, '')}/public/sessions/confirmacao-agendamento/qr-image`;
    const formatDateTime = (value) => String(value || '-').slice(0, 16).replace('T', ' ');
    const cards = [
      ['Sessao', session.status || 'nao_iniciada', 'confirmacao-agendamento', statusTone(session.status)],
      ['Parceiros ativos', summary.activeContacts || 0, `${summary.withoutPhone || 0} sem telefone`, 'success'],
      ['Mensagens hoje', summary.sentToday || 0, 'Cobrancas enfileiradas/enviadas', 'neutral'],
      ['Pendencias ate 09:30', summary.pendingUntil930 || 0, 'Aguardando baixa do video', summary.pendingUntil930 ? 'warning' : 'success'],
      ['Pendencias apos 10:00', summary.pendingAfter10 || 0, 'Fora do fluxo ideal', summary.pendingAfter10 ? 'danger' : 'success'],
      ['No prazo', summary.receivedOnTime || 0, 'Videos recebidos no prazo', 'success'],
      ['Regra 40%', `${complianceRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, `Meta minima: ${complianceGoal}% no prazo${summary.complianceMissing ? ` - faltam ${summary.complianceMissing}` : ''}`, complianceRate >= complianceGoal ? 'success' : 'danger'],
      ['Acionamentos coord.', summary.coordinatorActions || 0, 'Escalada ate 11:00', summary.coordinatorActions ? 'warning' : 'neutral'],
      ['Acionamentos gerente', summary.managerActions || 0, 'Escalada ate 12:00', summary.managerActions ? 'danger' : 'neutral'],
      ['Falhas', summary.failuresToday || 0, 'Erros registrados hoje', summary.failuresToday ? 'danger' : 'success'],
      ['Unidades sem parceiro', summary.unitsWithoutPartner || 0, unitsWithoutPartnerNames.join(', ') || 'Todas cobertas', summary.unitsWithoutPartner ? 'warning' : 'success'],
      ['Confirmados no WhatsApp', confirmationConfirmed.length, 'Pacientes que responderam SIM', confirmationConfirmed.length ? 'success' : 'neutral'],
      ['Pediram reagendamento', confirmationReschedule.length, 'Pacientes que precisam de novo horario', confirmationReschedule.length ? 'warning' : 'neutral'],
      ['Pediram atendimento humano', confirmationHuman.length, 'Encaminhados para a equipe', confirmationHuman.length ? 'danger' : 'neutral']
    ];

    return (
      <section className="whatsapp-confirmation-page">
        <div className="whatsapp-kpi-grid">
          {cards.map(([title, value, helper, tone]) => (
            <article className={`whatsapp-kpi ${tone || 'neutral'}`} key={title}>
              <span>{title}</span>
              <strong>{value}</strong>
              <small>{helper}</small>
            </article>
          ))}
        </div>

        <section className="whatsapp-panel partner-video-report-toolbar">
          <div>
            <h2>Relatórios e métricas de cobrança</h2>
            <p className="whatsapp-panel-note">Acompanhe quem enviou, quem ficou pendente e quais unidades precisam de cobrança operacional.</p>
          </div>
          <div className="whatsapp-report-actions">
            <button type="button" className="outline-action icon-action" onClick={exportPartnerVideoExcel}><span className="file-icon xls">XLS</span>Relatório Excel</button>
            <button type="button" className="outline-action icon-action" onClick={printPartnerVideoPdf}><span className="file-icon pdf">PDF</span>Relatório PDF</button>
          </div>
        </section>

        <section className="whatsapp-two-column">
          <article className="whatsapp-panel">
            <h2>Canal Confirmação e Agendamento</h2>
            <div className="whatsapp-card-list compact">
              <article>
                <span>Status</span>
                <strong>{session.status || 'nao_iniciada'}</strong>
                <p>Numero remetente preparado: {session.phone_number || settings.senderPhone || '5562998647043'}</p>
              </article>
              <article>
                <span>QR Code</span>
                <strong>Link da VPS</strong>
                <p>{qrUrl}</p>
              </article>
            </div>
            <div className="row-actions">
              <Button actionKey="qr-confirmacao-agendamento" className="outline-action" onClick={() => generateQrCode('confirmacao-agendamento')}>QR Code</Button>
              <Button actionKey="reconnect-confirmacao-agendamento" className="outline-action" onClick={() => reconnectInstance('confirmacao-agendamento')}>Reiniciar sessao</Button>
              <Button actionKey="partner-video-test" className="outline-action" onClick={sendPartnerVideoTests}>Teste obrigatorio</Button>
              <Button actionKey="partner-video-daily" className="primary-action" onClick={sendPartnerVideoDailyReminders}>Enviar cobranca diaria</Button>
              <Button actionKey="partner-video-settings" className="outline-action" onClick={togglePartnerVideoAutomation}>
                {partnersVideo?.settings?.automationEnabled ? 'Pausar rotina' : 'Ativar rotina'}
              </Button>
            </div>
          </article>

          <article className="whatsapp-panel">
            <h2>Parametros operacionais</h2>
            <div className="whatsapp-card-list compact">
              <article><span>Horarios</span><strong>{allowedTimeList.join(' e ')}</strong><p>Disparo automatico apenas nas janelas de 08:00 e 18:00.</p></article>
              <article><span>Calendario</span><strong>Segunda a sabado</strong><p>{weekdayDescription}</p></article>
              <article><span>Automacao</span><strong>{settings.automationEnabled ? 'Ativa' : 'Pausada'}</strong><p>Ative somente apos teste e QR conectado</p></article>
              <article><span>Anti-ban</span><strong>{settings.minDelaySeconds || 20}s - {settings.maxDelaySeconds || 60}s</strong><p>Fila com atraso aleatorio por mensagem</p></article>
              <article><span>Limite</span><strong>{settings.limitPerMinute || 2}/min</strong><p>{settings.limitPerHour || 60}/hora</p></article>
            </div>
          </article>
        </section>

        <section className="whatsapp-two-column">
          <article className="whatsapp-panel">
            <div className="whatsapp-panel-head">
              <div>
                <h2>Pacientes que confirmaram</h2>
                <p className="whatsapp-panel-note">Lista viva das confirmações registradas pela assistente conversacional.</p>
              </div>
            </div>
            <div className="whatsapp-card-list compact">
              {confirmationConfirmed.slice(0, 18).map((item) => (
                <article key={item.id}>
                  <span>{item.clinic_name || 'Unidade'}</span>
                  <strong>{item.patient_name || item.patient_phone}</strong>
                  <p>{item.patient_phone || '-'} - {item.confirmation_label}</p>
                  <small>{String(item.completed_at || item.last_interaction_at || item.started_at || '').slice(0, 16).replace('T', ' ')}</small>
                </article>
              ))}
              {!confirmationConfirmed.length && <p className="empty-state">Nenhuma confirmação concluída ainda.</p>}
            </div>
          </article>

          <article className="whatsapp-panel">
            <div className="whatsapp-panel-head">
              <div>
                <h2>Ajustes e atendimento humano</h2>
                <p className="whatsapp-panel-note">Pacientes que pediram reagendamento ou falar com a equipe.</p>
              </div>
            </div>
            <div className="whatsapp-card-list compact">
              {[...confirmationReschedule, ...confirmationHuman].slice(0, 18).map((item) => (
                <article key={item.id}>
                  <span>{item.clinic_name || 'Unidade'}</span>
                  <strong>{item.patient_name || item.patient_phone}</strong>
                  <p>{item.patient_phone || '-'} - {item.confirmation_label}</p>
                  <small>{item.operator_name || item.conversation_status || 'Encaminhado pela assistente'}</small>
                </article>
              ))}
              {!confirmationReschedule.length && !confirmationHuman.length && <p className="empty-state">Nenhum ajuste de confirmação pendente.</p>}
            </div>
          </article>
        </section>

        <section className="whatsapp-two-column partner-video-config-grid">
          <article className="whatsapp-panel">
            <h2>Configuracoes da rotina</h2>
            <div className="whatsapp-form-grid">
              <label>Horario de referencia<input className="field" type="time" value={settings.standardTime || '08:00'} onChange={(event) => updatePartnerSettingsDraft('standardTime', event.target.value)} /></label>
              <label>Sessao WhatsApp<input className="field" value={settings.sessionId || 'confirmacao-agendamento'} onChange={(event) => updatePartnerSettingsDraft('sessionId', event.target.value)} /></label>
              <label>Numero remetente<input className="field" value={settings.senderPhone || ''} onChange={(event) => updatePartnerSettingsDraft('senderPhone', event.target.value)} /></label>
              <label>Limite por minuto<input className="field" type="number" min="1" value={settings.limitPerMinute || 2} onChange={(event) => updatePartnerSettingsDraft('limitPerMinute', event.target.value)} /></label>
              <label>Intervalo minimo (s)<input className="field" type="number" min="20" value={settings.minDelaySeconds || 20} onChange={(event) => updatePartnerSettingsDraft('minDelaySeconds', event.target.value)} /></label>
              <label>Intervalo maximo (s)<input className="field" type="number" min="20" value={settings.maxDelaySeconds || 60} onChange={(event) => updatePartnerSettingsDraft('maxDelaySeconds', event.target.value)} /></label>
              <label>Limite por hora<input className="field" type="number" min="1" value={settings.limitPerHour || 60} onChange={(event) => updatePartnerSettingsDraft('limitPerHour', event.target.value)} /></label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(settings.automationEnabled)} onChange={(event) => updatePartnerSettingsDraft('automationEnabled', event.target.checked)} /> Rotina automatica ativa</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(settings.testMode)} onChange={(event) => updatePartnerSettingsDraft('testMode', event.target.checked)} /> Modo teste</label>
            </div>
            <label>Horarios permitidos<textarea className="field" rows="2" value={settings.allowedTimes || '08:00\n18:00'} onChange={(event) => updatePartnerSettingsDraft('allowedTimes', event.target.value)} /></label>
            <p className="whatsapp-panel-note">A rotina automatica so dispara dentro da janela configurada para 08:00 e 18:00. Fora desses horarios, apenas envios manuais e testes ficam liberados.</p>
            <div className="partner-video-weekdays">
              {partnerVideoWeekdays.map((day) => (
                <label key={day.value} className="checkbox-line compact-check">
                  <input type="checkbox" checked={(settings.allowedWeekdays || []).map(Number).includes(day.value)} onChange={() => togglePartnerSettingsWeekday(day.value)} />
                  {day.label}
                </label>
              ))}
            </div>
            <label>Numeros de teste<textarea className="field" rows="3" value={settings.testNumbers || ''} onChange={(event) => updatePartnerSettingsDraft('testNumbers', event.target.value)} /></label>
            <label>Template editavel<textarea className="field partner-video-template-field" rows="10" value={settings.template || ''} onChange={(event) => updatePartnerSettingsDraft('template', event.target.value)} /></label>
            <div className="row-actions">
              <Button actionKey="partner-video-settings-save" className="primary-action" onClick={savePartnerVideoSettings}>Salvar parametros</Button>
              <Button actionKey="partner-video-test" className="outline-action" onClick={sendPartnerVideoTests}>Testar numeros informados</Button>
              <button type="button" className="outline-action" onClick={() => setPartnerSettingsDraft(normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {}))}>Restaurar tela</button>
            </div>
          </article>

          <article className="whatsapp-panel">
            <h2>{editingPartnerContactId ? 'Editar parceiro' : 'Cadastrar parceiro'}</h2>
            <div className="whatsapp-form-grid">
              <label>Unidade<input className="field" value={partnerContactDraft.clinic_name} onChange={(event) => updatePartnerContactDraft('clinic_name', event.target.value)} placeholder="Ex.: Garavelo" /></label>
              <label>Parceiro<input className="field" value={partnerContactDraft.partner_name} onChange={(event) => updatePartnerContactDraft('partner_name', event.target.value)} placeholder="Nome do dentista/parceiro" /></label>
              <label>Telefone<input className="field" value={partnerContactDraft.phone_number} onChange={(event) => updatePartnerContactDraft('phone_number', event.target.value)} placeholder="5562999999999" /></label>
              <label>Horario<input className="field" type="time" value={partnerContactDraft.default_send_time || '08:00'} onChange={(event) => updatePartnerContactDraft('default_send_time', event.target.value)} /></label>
              <label>Dias permitidos<input className="field" value={partnerContactDraft.allowed_weekdays} onChange={(event) => updatePartnerContactDraft('allowed_weekdays', event.target.value)} placeholder="1,2,3,4,5,6" /></label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(partnerContactDraft.active)} onChange={(event) => updatePartnerContactDraft('active', event.target.checked)} /> Parceiro ativo</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(partnerContactDraft.receives_automatic_message)} onChange={(event) => updatePartnerContactDraft('receives_automatic_message', event.target.checked)} /> Recebe mensagem automatica</label>
            </div>
            <label>Observacoes<textarea className="field" rows="4" value={partnerContactDraft.notes || ''} onChange={(event) => updatePartnerContactDraft('notes', event.target.value)} /></label>
            <div className="row-actions">
              <Button actionKey="partner-video-contact-save" className="primary-action" onClick={savePartnerVideoContact}>{editingPartnerContactId ? 'Salvar alteracao' : 'Cadastrar parceiro'}</Button>
              {editingPartnerContactId && <button type="button" className="outline-action" onClick={cancelPartnerVideoContactEdit}>Cancelar edicao</button>}
            </div>
          </article>
        </section>

        <section className="whatsapp-panel partner-video-noncompliance-panel">
          <div className="partner-video-panel-heading">
            <div>
              <h2>Baixa operacional dos vídeos não enviados</h2>
              <p className="whatsapp-panel-note">Selecione as unidades que não enviaram vídeo para alimentar o relatório e as métricas de cobrança.</p>
            </div>
            <div className="row-actions">
              <Button actionKey="partner-video-bulk-not-sent" className="primary-action" onClick={markSelectedPartnerVideosNotSent} disabled={!partnerNoVideoSelection.length}>
                Marcar selecionados como não enviados
              </Button>
            </div>
          </div>
          <div className="partner-video-noncompliance-grid">
            {noVideoOptions.map((item) => (
              <label key={item.key} className="partner-video-noncompliance-item">
                <input
                  type="checkbox"
                  checked={partnerNoVideoSelection.includes(item.key)}
                  onChange={() => togglePartnerNoVideoSelection(item.key)}
                />
                <span>
                  <strong>{item.clinicName}</strong>
                  <small>{item.partnerName || 'Parceiro não informado'} · {item.phone || 'sem telefone'} · {item.status}</small>
                </span>
              </label>
            ))}
            {!noVideoOptions.length && <p className="empty-state">Nenhuma unidade/parceiro disponível para baixa no momento.</p>}
          </div>
        </section>

        <section className="whatsapp-panel">
          <h2>Relatório analítico de não envio</h2>
          <div className="whatsapp-table-wrap compact-report-table">
            <table className="whatsapp-table">
              <thead><tr><th>Unidade</th><th>Parceiro</th><th>Status</th><th>Mensagem</th><th>Recebido</th><th>Acionamentos</th></tr></thead>
              <tbody>{nonComplianceRows.map((item) => (
                <tr key={item.id}>
                  <td>{item.clinic_name}</td>
                  <td>{item.partner_name}<small>{item.phone_number || '-'}</small></td>
                  <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></td>
                  <td>{formatDateTime(item.message_sent_at)}<small>{item.message_status || 'pendente'}</small></td>
                  <td>{item.video_received ? formatDateTime(item.video_received_at) : 'Não recebido'}</td>
                  <td>
                    <small>
                      {item.leader_notified_at ? 'Líder ' : ''}
                      {item.coordinator_notified_at ? 'Coordenador ' : ''}
                      {item.manager_notified_at ? 'Gerente' : ''}
                      {!item.leader_notified_at && !item.coordinator_notified_at && !item.manager_notified_at ? '-' : ''}
                    </small>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!nonComplianceRows.length && <p className="empty-state">Nenhuma pendência de vídeo registrada no período atual.</p>}
          </div>
        </section>

        <section className="whatsapp-panel">
          <h2>Controle de Videos dos Parceiros</h2>
          <div className="whatsapp-table-wrap">
            <table className="whatsapp-table">
              <thead><tr><th>Unidade</th><th>Parceiro</th><th>Telefone</th><th>Status</th><th>Envio</th><th>Recebido</th><th>Acionado</th><th>Acoes</th></tr></thead>
              <tbody>{controls.map((item) => (
                <tr key={item.id}>
                  <td>{item.clinic_name}</td>
                  <td>{item.partner_name}</td>
                  <td>{item.phone_number || '-'}</td>
                  <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></td>
                  <td>{formatDateTime(item.message_sent_at)}</td>
                  <td>{item.video_received ? formatDateTime(item.video_received_at) : 'Pendente'}</td>
                  <td>
                    <small>
                      {item.leader_notified_at ? 'Lider ' : ''}
                      {item.coordinator_notified_at ? 'Coord. ' : ''}
                      {item.manager_notified_at ? 'Gerente' : ''}
                      {!item.leader_notified_at && !item.coordinator_notified_at && !item.manager_notified_at ? '-' : ''}
                    </small>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button actionKey={`partner-video-resend-${item.id}`} className="outline-action mini-action" onClick={() => resendPartnerVideoControl(item.id)}>Reenviar</Button>
                      <Button actionKey={`partner-video-mark-video-received-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'mark-video-received', 'Video recebido registrado.')}>Recebido</Button>
                      <Button actionKey={`partner-video-mark-not-sent-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'mark-not-sent', 'Pendencia registrada.')}>Nao enviado</Button>
                      <Button actionKey={`partner-video-notify-leader-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'notify-leader', 'Lider acionado.')}>Lider</Button>
                      <Button actionKey={`partner-video-notify-coordinator-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'notify-coordinator', 'Coordenador acionado.')}>Coordenador</Button>
                      <Button actionKey={`partner-video-notify-manager-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'notify-manager', 'Gerente acionado.')}>Gerente</Button>
                      {item.phone_number && <a className="outline-action mini-action" href={`https://wa.me/${normalizePhone(item.phone_number)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                      <button type="button" className="outline-action mini-action" onClick={() => document.getElementById('partner-video-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Historico</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!controls.length && <p className="empty-state">Nenhum controle diario gerado ainda. Use "Enviar cobranca diaria" para iniciar o dia.</p>}
          </div>
        </section>

        <section className="whatsapp-two-column partner-video-coverage-grid">
          <article className="whatsapp-panel">
            <h2>Parceiros cadastrados</h2>
            <div className="partner-video-contact-list">
              {contacts.map((item) => (
                <article key={item.id} className="partner-video-contact-card">
                  <div>
                    <span>{item.clinic_name}</span>
                    <strong>{item.partner_name}</strong>
                    <p>{item.phone_number || 'Sem telefone'} - {item.active ? 'Ativo' : 'Inativo'} - {item.receives_automatic_message ? 'Automatico' : 'Manual'}</p>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="outline-action mini-action" onClick={() => editPartnerVideoContact(item)}>Editar</button>
                    {canDeleteWhatsappItems && <Button actionKey={`partner-video-contact-delete-${item.id}`} className="outline-action danger-action mini-action" onClick={() => deletePartnerVideoContact(item.id)}>Excluir</Button>}
                  </div>
                </article>
              ))}
            </div>
          </article>
          <article className="whatsapp-panel">
            <h2>Unidades sem parceiro</h2>
            <p className="whatsapp-panel-note">Relação para completar o cadastro e evitar unidades sem cobrança automática de vídeo.</p>
            <div className="partner-video-missing-list">
              {unitsWithoutPartnerNames.map((name) => (
                <article key={name} className="partner-video-missing-card">
                  <span>Sem parceiro ativo</span>
                  <strong>{name}</strong>
                  <p>Cadastre parceiro, telefone e rotina para incluir a unidade nos disparos.</p>
                </article>
              ))}
              {!unitsWithoutPartnerNames.length && <p className="empty-state">Todas as unidades ativas possuem parceiro cadastrado.</p>}
            </div>
          </article>
        </section>

        <section className="whatsapp-panel" id="partner-video-logs">
            <h2>Logs recentes</h2>
            <div className="whatsapp-card-list compact">
              {logs.slice(0, 12).map((item) => (
                <article key={item.id}>
                  <span>{item.event_type}</span>
                  <strong>{item.status}</strong>
                  <p>{formatDateTime(item.created_at)} - {item.error_message || item.recipient_phone || '-'}</p>
                </article>
              ))}
              {!logs.length && <p className="empty-state">Nenhum log registrado ainda.</p>}
            </div>
        </section>
      </section>
    );
  };

  void renderConfirmationScheduling;

  const renderConfirmationSchedulingPro = () => {
    const summary = partnersVideo?.summary || {};
    const controls = Array.isArray(partnersVideo?.controls) ? partnersVideo.controls : [];
    const contacts = Array.isArray(partnersVideo?.contacts) ? partnersVideo.contacts : [];
    const logs = Array.isArray(partnersVideo?.logs) ? partnersVideo.logs : [];
    const session = partnersVideo?.session || instances.find((item) => item.instance_name === 'confirmacao-agendamento') || {};
    const settings = partnerSettingsDraft || normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {});
    const allowedTimeList = String(settings.allowedTimes || '08:00\n18:00').split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
    const unitsWithoutPartnerNames = Array.isArray(summary.unitsWithoutPartnerNames) ? summary.unitsWithoutPartnerNames : [];
    const formatDateTime = (value) => String(value || '-').slice(0, 16).replace('T', ' ');
    const cleanText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const statusIsFailure = (value) => cleanText(value).includes('erro') || cleanText(value).includes('falh');
    const statusIsSent = (value) => cleanText(value).includes('envi') || cleanText(value).includes('entreg') || cleanText(value).includes('lido') || cleanText(value).includes('fila');
    const activeContacts = contacts.filter((item) => Number(item.active));
    const plannedMessages = activeContacts.filter((item) => Number(item.receives_automatic_message)).length;
    const sentControls = controls.filter((item) => item.message_sent_at || statusIsSent(item.message_status || item.status));
    const failedControls = controls.filter((item) => statusIsFailure(`${item.message_status || ''} ${item.status || ''}`));
    const pendingControls = controls.filter((item) => !Number(item.video_received) && !failedControls.some((failed) => String(failed.id) === String(item.id)));
    const controlsByPartnerId = new Map();
    controls.forEach((item) => {
      const key = String(item.partner_id || '');
      const current = controlsByPartnerId.get(key);
      const currentDate = String(current?.message_sent_at || current?.updated_at || '');
      const nextDate = String(item.message_sent_at || item.updated_at || '');
      if (!current || nextDate > currentDate) controlsByPartnerId.set(key, item);
    });
    const contactRows = contacts.map((contact) => {
      const lastControl = controlsByPartnerId.get(String(contact.id)) || null;
      const contactLogs = logs.filter((log) => String(log.contact_id || '') === String(contact.id));
      const lastLog = contactLogs[0] || null;
      return {
        ...contact,
        specialty: contact.specialty || contact.role || contact.function || 'Parceiro clinico',
        lastControl,
        lastLog,
        last_send_at: lastControl?.message_sent_at || lastLog?.created_at || null,
        last_send_status: lastControl?.message_status || lastControl?.status || lastLog?.status || (Number(contact.active) ? 'pendente' : 'inativo')
      };
    });
    const clinicOptions = Array.from(new Set([
      ...clinics.map((clinic) => clinic.name).filter(Boolean),
      ...contacts.map((contact) => contact.clinic_name).filter(Boolean),
      ...controls.map((control) => control.clinic_name).filter(Boolean)
    ])).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const contactById = new Map(contactRows.map((item) => [String(item.id), item]));
    const decoratedLogs = logs.map((item) => {
      const contact = contactById.get(String(item.contact_id || '')) || {};
      return {
        ...item,
        clinic_name: item.clinic_name || contact.clinic_name || '',
        partner_name: item.partner_name || contact.partner_name || '',
        phone_number: item.recipient_phone || contact.phone_number || '',
        status: item.status || item.event_type || ''
      };
    });
    const statusMatches = (row = {}, type = 'control') => {
      const selected = partnerVideoFilters.status;
      const status = cleanText(row.status || row.message_status || row.last_send_status || row.event_type);
      const phone = normalizePhone(row.phone_number || row.recipient_phone || '');
      if (!selected) return true;
      if (selected === 'sem_telefone') return !phone;
      if (selected === 'inativo') return type === 'contact' && !Number(row.active);
      if (selected === 'falhou') return status.includes('erro') || status.includes('falh');
      if (selected === 'enviado') return status.includes('envi') || status.includes('entreg') || status.includes('lido') || Boolean(row.message_sent_at || row.last_send_at);
      if (selected === 'pendente') return status.includes('pend') || status.includes('aguard') || status.includes('fila') || status.includes('nao enviado') || status.includes('acionado');
      return status.includes(cleanText(selected));
    };
    const rowMatches = (row = {}, type = 'control') => {
      const clinic = cleanText(row.clinic_name);
      const partner = cleanText(row.partner_name);
      const phone = normalizePhone(row.phone_number || row.recipient_phone || '');
      const rowDate = String(row.date || row.created_at || row.message_sent_at || row.last_send_at || '').slice(0, 10);
      if (partnerVideoFilters.clinic && clinic !== cleanText(partnerVideoFilters.clinic)) return false;
      if (partnerVideoFilters.partner && !partner.includes(cleanText(partnerVideoFilters.partner))) return false;
      if (partnerVideoFilters.phone && !phone.includes(normalizePhone(partnerVideoFilters.phone))) return false;
      if (partnerVideoFilters.date && rowDate && rowDate !== partnerVideoFilters.date) return false;
      return statusMatches(row, type);
    };
    const filteredContacts = contactRows.filter((item) => rowMatches(item, 'contact'));
    const filteredControls = controls.filter((item) => rowMatches(item, 'control'));
    const filteredLogs = decoratedLogs.filter((item) => rowMatches(item, 'log'));
    const completionPercent = plannedMessages ? Math.round((sentControls.length / plannedMessages) * 100) : 0;
    const pendingPercent = plannedMessages ? Math.round((pendingControls.length / plannedMessages) * 100) : 0;
    const failurePercent = plannedMessages ? Math.round((failedControls.length / plannedMessages) * 100) : 0;
    const withoutPhonePercent = activeContacts.length ? Math.round(((summary.withoutPhone || 0) / activeContacts.length) * 100) : 0;
    const lastSend = [...controls].filter((item) => item.message_sent_at).sort((a, b) => String(b.message_sent_at).localeCompare(String(a.message_sent_at)))[0];
    const weekdayDescription = formatPartnerWeekdayLabels(settings.allowedWeekdays || [1, 2, 3, 4, 5, 6]);
    const qrUrl = `${(configStatus?.baseUrl || adminSettings?.baseUrl || 'http://2.24.101.6:3005').replace(/\/+$/, '')}/public/sessions/confirmacao-agendamento/qr-image`;
    const noVideoOptions = [
      ...controls.map((item) => ({
        key: `control:${item.id}`,
        clinicName: item.clinic_name,
        partnerName: item.partner_name,
        status: item.status || 'controle diario',
        phone: item.phone_number || ''
      })),
      ...contacts
        .filter((item) => Number(item.active) && !controlsByPartnerId.has(String(item.id)))
        .map((item) => ({
          key: `contact:${item.id}`,
          clinicName: item.clinic_name,
          partnerName: item.partner_name,
          status: 'sem controle no dia',
          phone: item.phone_number || ''
        }))
    ];
    const confirmationConfirmed = confirmationResponses.filter((item) => item.confirmation_confirmed);
    const confirmationReschedule = confirmationResponses.filter((item) => item.confirmation_decision === 'reagendar');
    const confirmationHuman = confirmationResponses.filter((item) => item.confirmation_decision === 'humano');
    const reportRows = filteredControls.map((item) => ({
      data: String(item.date || '').slice(0, 10),
      unidade: item.clinic_name || '',
      parceiro: item.partner_name || '',
      telefone: item.phone_number || '',
      tipo: 'cobranca_video',
      status: item.message_status || item.status || '',
      tentativas: item.attempts || item.retry_count || 1,
      erro: item.error_message || '',
      enviado_em: formatDateTime(item.message_sent_at),
      recebido_em: item.video_received ? formatDateTime(item.video_received_at) : '',
      origem: item.created_by || 'automatico/manual'
    }));
    const unitRanking = Object.values(filteredControls.reduce((acc, item) => {
      const key = item.clinic_name || 'Sem unidade';
      acc[key] = acc[key] || { label: key, total: 0 };
      if (!Number(item.video_received)) acc[key].total += 1;
      return acc;
    }, {})).filter((item) => item.total).sort((a, b) => b.total - a.total).slice(0, 6);
    const failureRanking = Object.values(filteredLogs.reduce((acc, item) => {
      if (!statusIsFailure(item.status)) return acc;
      const key = item.partner_name || item.recipient_phone || 'Sem parceiro';
      acc[key] = acc[key] || { label: key, total: 0 };
      acc[key].total += 1;
      return acc;
    }, {})).sort((a, b) => b.total - a.total).slice(0, 6);
    const pendingReportRows = reportRows.filter((item) => cleanText(item.status).includes('pend') || cleanText(item.status).includes('aguard') || cleanText(item.status).includes('fila'));
    const failureReportRows = reportRows.filter((item) => statusIsFailure(item.status || item.erro));
    const unitReportRows = Object.values(reportRows.reduce((acc, item) => {
      const key = item.unidade || 'Sem unidade';
      acc[key] = acc[key] || { unidade: key, previstos: 0, enviados: 0, pendentes: 0, falhas: 0 };
      acc[key].previstos += 1;
      if (statusIsSent(item.status) || item.enviado_em !== '-') acc[key].enviados += 1;
      if (cleanText(item.status).includes('pend') || cleanText(item.status).includes('aguard')) acc[key].pendentes += 1;
      if (statusIsFailure(item.status || item.erro)) acc[key].falhas += 1;
      return acc;
    }, {}));
    const printFilteredPartnerVideoPdf = () => {
      if (!reportRows.length) {
        setError('Nenhum envio encontrado nos filtros atuais para gerar PDF.');
        return;
      }
      const htmlRows = reportRows.map((row) => `
        <tr>
          <td>${escapeHtml(row.unidade)}</td>
          <td>${escapeHtml(row.parceiro)}</td>
          <td>${escapeHtml(row.telefone)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${escapeHtml(row.enviado_em)}</td>
          <td>${escapeHtml(row.erro || '-')}</td>
        </tr>
      `).join('');
      const reportWindow = window.open('', '_blank', 'width=1120,height=780');
      if (!reportWindow) {
        setError('Nao foi possivel abrir a janela de PDF. Verifique o bloqueador de pop-up.');
        return;
      }
      reportWindow.document.write(`
        <html>
          <head>
            <title>Relatorio filtrado - Confirmacao e Agendamento</title>
            <style>
              body { font-family: Arial, sans-serif; color: #211a16; margin: 32px; }
              header { border-bottom: 3px solid #8e6731; padding-bottom: 16px; margin-bottom: 20px; }
              h1 { margin: 0; font-size: 26px; }
              p { color: #5f5146; }
              table { width: 100%; border-collapse: collapse; margin-top: 16px; }
              th, td { border-bottom: 1px solid #ddcfbc; padding: 9px; text-align: left; vertical-align: top; font-size: 12px; }
              th { background: #f4ecdf; color: #6d573b; text-transform: uppercase; }
            </style>
          </head>
          <body>
            <header>
              <h1>Relatorio filtrado de envios</h1>
              <p>Confirmacao e Agendamento - Emitido em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</p>
            </header>
            <table>
              <thead><tr><th>Unidade</th><th>Parceiro</th><th>Telefone</th><th>Status</th><th>Envio</th><th>Erro</th></tr></thead>
              <tbody>${htmlRows}</tbody>
            </table>
            <script>window.onload = () => { window.print(); };</script>
          </body>
        </html>
      `);
      reportWindow.document.close();
    };
    const historyLogs = partnerHistoryContact
      ? decoratedLogs.filter((item) => String(item.contact_id || '') === String(partnerHistoryContact.id))
      : [];
    const operationalCards = [
      ['Parceiros ativos', summary.activeContacts || activeContacts.length, 'Base apta para rotina diaria', 'success'],
      ['Mensagens previstas', plannedMessages, 'Ativos com automacao ligada', 'neutral'],
      ['Mensagens enviadas', sentControls.length || summary.sentToday || 0, `${completionPercent}% da base prevista`, sentControls.length ? 'success' : 'neutral'],
      ['Pendentes', pendingControls.length || summary.pendingToday || 0, `${pendingPercent}% aguardando acao`, pendingControls.length ? 'warning' : 'success'],
      ['Falhas', failedControls.length || summary.failuresToday || 0, `${failurePercent}% com erro`, failedControls.length ? 'danger' : 'success'],
      ['Sem telefone', summary.withoutPhone || 0, `${withoutPhonePercent}% dos ativos`, summary.withoutPhone ? 'warning' : 'success'],
      ['Unidades sem parceiro ativo', summary.unitsWithoutPartner || 0, unitsWithoutPartnerNames.slice(0, 2).join(', ') || 'Cobertura completa', summary.unitsWithoutPartner ? 'warning' : 'success'],
      ['Ultimo envio', lastSend ? formatDateTime(lastSend.message_sent_at) : '-', lastSend?.partner_name || 'Sem envio hoje', lastSend ? 'success' : 'neutral'],
      ['Proximo envio', allowedTimeList.join(' / ') || settings.standardTime || '08:00', weekdayDescription, settings.automationEnabled ? 'success' : 'warning']
    ];
    const statusOptions = [
      ['enviado', 'Enviado'],
      ['pendente', 'Pendente'],
      ['falhou', 'Falhou'],
      ['sem_telefone', 'Sem telefone'],
      ['inativo', 'Inativo']
    ];
    const confirmationTabs = [
      ['daily', 'Painel diario'],
      ['partners', 'Parceiros'],
      ['shipments', 'Envios'],
      ['logs', 'Logs'],
      ['settings', 'Configuracoes']
    ];
    const missingUnitCount = unitsWithoutPartnerNames.length;

    const renderFilters = () => (
      <div className="partner-video-filter-grid">
        <label>Unidade
          <select className="field" value={partnerVideoFilters.clinic} onChange={(event) => updatePartnerVideoFilter('clinic', event.target.value)}>
            <option value="">Todas</option>
            {clinicOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>Parceiro<input className="field" value={partnerVideoFilters.partner} onChange={(event) => updatePartnerVideoFilter('partner', event.target.value)} placeholder="Buscar nome" /></label>
        <label>Status
          <select className="field" value={partnerVideoFilters.status} onChange={(event) => updatePartnerVideoFilter('status', event.target.value)}>
            <option value="">Todos</option>
            {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Data<input className="field" type="date" value={partnerVideoFilters.date} onChange={(event) => updatePartnerVideoFilter('date', event.target.value)} /></label>
        <label>Telefone<input className="field" value={partnerVideoFilters.phone} onChange={(event) => updatePartnerVideoFilter('phone', event.target.value)} placeholder="5562..." /></label>
        <button type="button" className="outline-action" onClick={clearPartnerVideoFilters}>Limpar filtros</button>
      </div>
    );

    return (
      <section className="whatsapp-confirmation-page">
        <nav className="partner-video-subtabs" aria-label="Subabas de Confirmacao e Agendamento">
          {confirmationTabs.map(([key, label]) => (
            <button key={key} type="button" className={confirmationTab === key ? 'active' : ''} onClick={() => setConfirmationTab(key)}>{label}</button>
          ))}
        </nav>

        {confirmationTab === 'daily' && (
          <>
            <section className="whatsapp-kpi-grid partner-video-kpi-grid">
              {operationalCards.map(([title, value, helper, tone]) => (
                <article className={`whatsapp-kpi ${tone || 'neutral'}`} key={title}>
                  <span>{title}</span>
                  <strong>{value}</strong>
                  <small>{helper}</small>
                </article>
              ))}
            </section>

            <section className="whatsapp-panel partner-video-actionbar">
              <div>
                <p className="eyebrow">Barra operacional</p>
                <h2>Controle diario de envios</h2>
                <p className="whatsapp-panel-note">Acoes sensiveis exigem confirmacao e respeitam a fila anti-ban configurada.</p>
              </div>
              <div className="row-actions">
                <Button actionKey="qr-confirmacao-agendamento" className="outline-action" onClick={() => generateQrCode('confirmacao-agendamento')}>QR Code</Button>
                <Button actionKey="reconnect-confirmacao-agendamento" className="outline-action" onClick={() => {
                  if (window.confirm('Reiniciar a sessao de Confirmacao e Agendamento?')) reconnectInstance('confirmacao-agendamento');
                }}>Reiniciar sessao</Button>
                <Button actionKey="partner-video-test" className="outline-action" onClick={sendPartnerVideoTests}>Enviar teste</Button>
                <Button actionKey="partner-video-daily" className="primary-action" onClick={sendPartnerVideoDailyReminders}>Enviar cobranca diaria</Button>
                <Button actionKey="partner-video-settings" className="outline-action" onClick={() => {
                  if (window.confirm('Alterar o estado da rotina automatica?')) togglePartnerVideoAutomation();
                }}>
                  {partnersVideo?.settings?.automationEnabled ? 'Pausar rotina' : 'Ativar rotina'}
                </Button>
                <button type="button" className="outline-action" onClick={() => loadBaseData()}>Atualizar dados</button>
              </div>
            </section>

            <section className="whatsapp-panel partner-video-control-panel">
              <div className="partner-video-panel-heading">
                <div>
                  <h2>Painel de controle de envios</h2>
                  <p className="whatsapp-panel-note">Filtros por unidade, parceiro, status, data, telefone e resultado do envio.</p>
                </div>
                <div className="whatsapp-report-actions">
                  <button type="button" className="outline-action icon-action" onClick={() => exportCsv('confirmacao-agendamento-envios.csv', reportRows)}><span className="file-icon xls">XLS</span>Excel filtrado</button>
                  <button type="button" className="outline-action icon-action" onClick={printFilteredPartnerVideoPdf}><span className="file-icon pdf">PDF</span>PDF filtrado</button>
                  <button type="button" className="outline-action icon-action" onClick={() => exportCsv('parceiros-pendentes-confirmacao.csv', pendingReportRows)}><span className="file-icon xls">XLS</span>Pendentes</button>
                  <button type="button" className="outline-action icon-action" onClick={() => exportCsv('falhas-confirmacao-agendamento.csv', failureReportRows)}><span className="file-icon xls">XLS</span>Falhas</button>
                  <button type="button" className="outline-action icon-action" onClick={() => exportCsv('envios-por-unidade-confirmacao.csv', unitReportRows)}><span className="file-icon xls">XLS</span>Por unidade</button>
                </div>
              </div>
              {renderFilters()}
            </section>

            <section className="partner-video-dashboard-grid">
              <article className="whatsapp-panel partner-video-progress-panel">
                <h2>Dashboard operacional</h2>
                {[
                  ['% cobrados', completionPercent, 'success'],
                  ['% pendentes', pendingPercent, 'warning'],
                  ['% falhas', failurePercent, 'danger'],
                  ['% sem telefone', withoutPhonePercent, withoutPhonePercent ? 'warning' : 'success']
                ].map(([label, value, tone]) => (
                  <div className="partner-video-progress-row" key={label}>
                    <span>{label}</span>
                    <strong>{value}%</strong>
                    <i><b className={tone} style={{ width: `${Math.min(100, Number(value) || 0)}%` }} /></i>
                  </div>
                ))}
              </article>
              <article className="whatsapp-panel">
                <h2>Unidades com mais pendencias</h2>
                <div className="whatsapp-ranking-list">
                  {unitRanking.map((item) => <p key={item.label}><span>{item.label}</span><strong>{item.total}</strong></p>)}
                  {!unitRanking.length && <p className="empty-state">Sem pendencias nos filtros atuais.</p>}
                </div>
              </article>
              <article className="whatsapp-panel">
                <h2>Parceiros com mais falhas</h2>
                <div className="whatsapp-ranking-list">
                  {failureRanking.map((item) => <p key={item.label}><span>{item.label}</span><strong>{item.total}</strong></p>)}
                  {!failureRanking.length && <p className="empty-state">Sem falhas registradas.</p>}
                </div>
              </article>
            </section>

            <section className="whatsapp-two-column">
              <article className="whatsapp-panel">
                <div className="whatsapp-panel-head">
                  <div>
                    <h2>Pacientes que confirmaram</h2>
                    <p className="whatsapp-panel-note">Respostas SIM registradas pela assistente conversacional.</p>
                  </div>
                  <span className="whatsapp-badge success">{confirmationConfirmed.length}</span>
                </div>
                <div className="whatsapp-table-wrap compact-report-table">
                  <table className="whatsapp-table">
                    <thead><tr><th>Paciente</th><th>Unidade</th><th>Telefone</th><th>Confirmacao</th></tr></thead>
                    <tbody>{confirmationConfirmed.slice(0, 18).map((item) => (
                      <tr key={item.id}>
                        <td>{item.patient_name || '-'}</td>
                        <td>{item.clinic_name || '-'}</td>
                        <td>{item.patient_phone || '-'}</td>
                        <td>{formatDateTime(item.completed_at || item.last_interaction_at || item.started_at)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!confirmationConfirmed.length && <p className="empty-state">Nenhuma confirmacao concluida ainda.</p>}
                </div>
              </article>
              <article className="whatsapp-panel">
                <div className="whatsapp-panel-head">
                  <div>
                    <h2>Ajustes e atendimento humano</h2>
                    <p className="whatsapp-panel-note">Reagendamentos e pedidos de atendimento humano.</p>
                  </div>
                  <span className="whatsapp-badge warning">{confirmationReschedule.length + confirmationHuman.length}</span>
                </div>
                <div className="whatsapp-table-wrap compact-report-table">
                  <table className="whatsapp-table">
                    <thead><tr><th>Paciente</th><th>Telefone</th><th>Decisao</th><th>Status</th></tr></thead>
                    <tbody>{[...confirmationReschedule, ...confirmationHuman].slice(0, 18).map((item) => (
                      <tr key={item.id}>
                        <td>{item.patient_name || '-'}</td>
                        <td>{item.patient_phone || '-'}</td>
                        <td>{item.confirmation_label || item.confirmation_decision}</td>
                        <td>{item.operator_name || item.conversation_status || 'Encaminhado'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!confirmationReschedule.length && !confirmationHuman.length && <p className="empty-state">Nenhum ajuste pendente.</p>}
                </div>
              </article>
            </section>
          </>
        )}

        {confirmationTab === 'partners' && (
          <section className="partner-video-partners-layout">
            <article className="whatsapp-panel partner-video-editor-card" ref={partnerVideoEditorRef}>
              <div className="whatsapp-panel-head">
                <div>
                  <h2>{editingPartnerContactId ? 'Editar parceiro' : 'Novo parceiro'}</h2>
                  <p className="whatsapp-panel-note">Atualize unidade, telefone, funcao e regra de cobranca automatica. Ao clicar em uma unidade sem parceiro, este formulario ja abre preenchido.</p>
                </div>
                {editingPartnerContactId && <span className="whatsapp-editing-pill">Editando</span>}
              </div>
              <div className="whatsapp-form-grid">
                <label>Unidade vinculada
                  <select className="field" value={partnerContactDraft.clinic_name} onChange={(event) => updatePartnerContactDraft('clinic_name', event.target.value)}>
                    <option value="">Selecione</option>
                    {partnerContactDraft.clinic_name && !clinicOptions.includes(partnerContactDraft.clinic_name) && <option value={partnerContactDraft.clinic_name}>{partnerContactDraft.clinic_name}</option>}
                    {clinicOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label>Nome do parceiro<input className="field" value={partnerContactDraft.partner_name} onChange={(event) => updatePartnerContactDraft('partner_name', event.target.value)} placeholder="Nome do dentista/parceiro" /></label>
                <label>Telefone WhatsApp<input className="field" value={partnerContactDraft.phone_number} onChange={(event) => updatePartnerContactDraft('phone_number', event.target.value)} placeholder="5562999999999" /></label>
                <label>Especialidade / funcao<input className="field" value={partnerContactDraft.specialty || ''} onChange={(event) => updatePartnerContactDraft('specialty', event.target.value)} placeholder="Ex.: Implantodontia, avaliador, parceiro" /></label>
                <label>Horario preferencial<input className="field" type="time" value={partnerContactDraft.default_send_time || '08:00'} onChange={(event) => updatePartnerContactDraft('default_send_time', event.target.value)} /></label>
                <label>Dias permitidos<input className="field" value={partnerContactDraft.allowed_weekdays} onChange={(event) => updatePartnerContactDraft('allowed_weekdays', event.target.value)} placeholder="1,2,3,4,5,6" /></label>
                <label className="checkbox-line"><input type="checkbox" checked={Boolean(partnerContactDraft.active)} onChange={(event) => updatePartnerContactDraft('active', event.target.checked)} /> Parceiro ativo</label>
                <label className="checkbox-line"><input type="checkbox" checked={Boolean(partnerContactDraft.receives_automatic_message)} onChange={(event) => updatePartnerContactDraft('receives_automatic_message', event.target.checked)} /> Recebe cobranca automatica</label>
              </div>
              <label>Observacoes internas<textarea className="field" rows="4" value={partnerContactDraft.notes || ''} onChange={(event) => updatePartnerContactDraft('notes', event.target.value)} /></label>
              <div className="row-actions">
                <Button actionKey="partner-video-contact-save" className="primary-action" onClick={savePartnerVideoContact}>{editingPartnerContactId ? 'Salvar alteracao' : 'Cadastrar parceiro'}</Button>
                {editingPartnerContactId && <button type="button" className="outline-action" onClick={cancelPartnerVideoContactEdit}>Cancelar edicao</button>}
              </div>
            </article>

            <article className="whatsapp-panel partner-video-table-card">
              <div className="partner-video-panel-heading">
                <div>
                  <h2>Parceiros cadastrados</h2>
                  <p className="whatsapp-panel-note">Tabela operacional com edicao, status, teste, reenvio e historico por parceiro.</p>
                </div>
                <button type="button" className="outline-action icon-action" onClick={() => exportCsv('parceiros-confirmacao-agendamento.csv', filteredContacts)}><span className="file-icon xls">XLS</span>Exportar parceiros</button>
              </div>
              {renderFilters()}
              <div className="whatsapp-table-wrap partner-video-table-wrap">
                <table className="whatsapp-table partner-video-table">
                  <thead><tr><th>Nome do parceiro</th><th>Telefone</th><th>Unidade</th><th>Especialidade/funcao</th><th>Status</th><th>Automatico</th><th>Ultimo envio</th><th>Status ultimo envio</th><th>Acoes</th></tr></thead>
                  <tbody>{filteredContacts.map((item) => (
                    <tr key={item.id}>
                      <td>{item.partner_name || '-'}</td>
                      <td>{item.phone_number || <span className="whatsapp-badge warning">sem telefone</span>}</td>
                      <td>{item.clinic_name || '-'}</td>
                      <td>{item.specialty || '-'}</td>
                      <td><span className={`whatsapp-badge ${Number(item.active) ? 'success' : 'neutral'}`}>{Number(item.active) ? 'Ativo' : 'Inativo'}</span></td>
                      <td>{Number(item.receives_automatic_message) ? 'Sim' : 'Nao'}</td>
                      <td>{item.last_send_at ? formatDateTime(item.last_send_at) : '-'}</td>
                      <td><span className={`whatsapp-badge ${statusTone(item.last_send_status)}`}>{item.last_send_status || '-'}</span></td>
                      <td>
                        <div className="row-actions partner-video-row-actions">
                          <button type="button" className="outline-action mini-action" onClick={() => editPartnerVideoContact(item)}>Editar</button>
                          <Button actionKey={`partner-video-contact-active-${item.id}`} className="outline-action mini-action" onClick={() => togglePartnerVideoContactActive(item)}>{Number(item.active) ? 'Inativar' : 'Ativar'}</Button>
                          <Button actionKey={`partner-video-contact-test-${item.id}`} className="outline-action mini-action" onClick={() => sendPartnerVideoContactTest(item)} disabled={!item.phone_number}>Teste</Button>
                          <Button actionKey={`partner-video-contact-resend-${item.id}`} className="outline-action mini-action" onClick={() => resendPartnerVideoContact(item)} disabled={!item.phone_number}>Reenviar</Button>
                          <button type="button" className="outline-action mini-action" onClick={() => setPartnerHistoryContact(item)}>Historico</button>
                          {canDeleteWhatsappItems && <Button actionKey={`partner-video-contact-delete-${item.id}`} className="outline-action danger-action mini-action" onClick={() => deletePartnerVideoContact(item.id)}>Excluir</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
                {!filteredContacts.length && <p className="empty-state">Nenhum parceiro encontrado nos filtros atuais.</p>}
              </div>
            </article>
          </section>
        )}

        {confirmationTab === 'shipments' && (
          <section className="whatsapp-panel">
            <div className="partner-video-panel-heading">
              <div>
                <h2>Controle de Envios</h2>
                <p className="whatsapp-panel-note">Rastreio de cada envio com status, tentativa, origem e erro retornado.</p>
              </div>
              <button type="button" className="outline-action icon-action" onClick={() => exportCsv('controle-envios-confirmacao-agendamento.csv', reportRows)}><span className="file-icon xls">XLS</span>Exportar envios</button>
            </div>
            {renderFilters()}
            <div className="whatsapp-table-wrap partner-video-table-wrap">
              <table className="whatsapp-table">
                <thead><tr><th>Data/hora</th><th>Parceiro</th><th>Unidade</th><th>Telefone</th><th>Tipo</th><th>Status</th><th>Tentativas</th><th>Erro</th><th>Origem</th><th>Acoes</th></tr></thead>
                <tbody>{filteredControls.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.message_sent_at || item.updated_at || item.created_at)}</td>
                    <td>{item.partner_name || '-'}</td>
                    <td>{item.clinic_name || '-'}</td>
                    <td>{item.phone_number || <span className="whatsapp-badge warning">sem telefone</span>}</td>
                    <td>cobranca_video</td>
                    <td><span className={`whatsapp-badge ${statusTone(item.message_status || item.status)}`}>{item.message_status || item.status || '-'}</span></td>
                    <td>{item.attempts || item.retry_count || 1}</td>
                    <td>{item.error_message || '-'}</td>
                    <td>{item.created_by || 'automatico/manual'}</td>
                    <td>
                      <div className="row-actions partner-video-row-actions">
                        <Button actionKey={`partner-video-resend-${item.id}`} className="outline-action mini-action" onClick={() => resendPartnerVideoControl(item.id)}>Reenviar</Button>
                        <Button actionKey={`partner-video-mark-video-received-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'mark-video-received', 'Video recebido registrado.')}>Recebido</Button>
                        <Button actionKey={`partner-video-mark-not-sent-${item.id}`} className="outline-action mini-action" onClick={() => updatePartnerVideoControl(item.id, 'mark-not-sent', 'Pendencia registrada.')}>Nao enviado</Button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              {!filteredControls.length && <p className="empty-state">Nenhum envio encontrado nos filtros atuais.</p>}
            </div>
          </section>
        )}

        {confirmationTab === 'logs' && (
          <section className="whatsapp-panel" id="partner-video-logs">
            <div className="partner-video-panel-heading">
              <div>
                <h2>Logs organizados</h2>
                <p className="whatsapp-panel-note">Auditoria de envios, testes, edicoes, falhas, baixas e acionamentos.</p>
              </div>
              <div className="whatsapp-report-actions">
                <button type="button" className="outline-action" onClick={clearPartnerVideoFilters}>Limpar filtros</button>
                <button type="button" className="outline-action icon-action" onClick={() => exportCsv('logs-confirmacao-agendamento.csv', filteredLogs)}><span className="file-icon xls">XLS</span>Exportar logs</button>
              </div>
            </div>
            {renderFilters()}
            <div className="whatsapp-table-wrap partner-video-table-wrap">
              <table className="whatsapp-table">
                <thead><tr><th>Data/hora</th><th>Evento</th><th>Parceiro</th><th>Telefone</th><th>Status</th><th>Detalhe</th><th>Origem</th></tr></thead>
                <tbody>{filteredLogs.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td>{item.event_type || '-'}</td>
                    <td>{item.partner_name || '-'}</td>
                    <td>{item.recipient_phone || item.phone_number || '-'}</td>
                    <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status || '-'}</span></td>
                    <td className="partner-video-log-detail">{String(item.error_message || item.message_text || item.response_payload || '-').slice(0, 180)}</td>
                    <td>{item.created_by || item.channel || '-'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!filteredLogs.length && <p className="empty-state">Nenhum log encontrado nos filtros atuais.</p>}
            </div>
          </section>
        )}

        {confirmationTab === 'settings' && (
          <section className="whatsapp-two-column partner-video-config-grid">
            <article className="whatsapp-panel">
              <h2>Canal Confirmacao e Agendamento</h2>
              <div className="whatsapp-card-list compact">
                <article><span>Status</span><strong>{session.status || 'nao_iniciada'}</strong><p>Numero remetente: {session.phone_number || settings.senderPhone || '5562998647043'}</p></article>
                <article><span>QR Code</span><strong>Link da VPS</strong><p>{qrUrl}</p></article>
                <article><span>Calendario</span><strong>{weekdayDescription}</strong><p>Rotina de segunda a sabado, entre 08:00 e 18:00.</p></article>
                <article><span>Anti-ban</span><strong>{settings.minDelaySeconds || 20}s - {settings.maxDelaySeconds || 60}s</strong><p>{settings.limitPerMinute || 2}/min e {settings.limitPerHour || 60}/hora.</p></article>
              </div>
            </article>
            <article className="whatsapp-panel">
              <h2>Configuracoes da rotina</h2>
              <div className="whatsapp-form-grid">
                <label>Horario de referencia<input className="field" type="time" value={settings.standardTime || '08:00'} onChange={(event) => updatePartnerSettingsDraft('standardTime', event.target.value)} /></label>
                <label>Sessao WhatsApp<input className="field" value={settings.sessionId || 'confirmacao-agendamento'} onChange={(event) => updatePartnerSettingsDraft('sessionId', event.target.value)} /></label>
                <label>Numero remetente<input className="field" value={settings.senderPhone || ''} onChange={(event) => updatePartnerSettingsDraft('senderPhone', event.target.value)} /></label>
                <label>Limite por minuto<input className="field" type="number" min="1" value={settings.limitPerMinute || 2} onChange={(event) => updatePartnerSettingsDraft('limitPerMinute', event.target.value)} /></label>
                <label>Intervalo minimo (s)<input className="field" type="number" min="20" value={settings.minDelaySeconds || 20} onChange={(event) => updatePartnerSettingsDraft('minDelaySeconds', event.target.value)} /></label>
                <label>Intervalo maximo (s)<input className="field" type="number" min="20" value={settings.maxDelaySeconds || 60} onChange={(event) => updatePartnerSettingsDraft('maxDelaySeconds', event.target.value)} /></label>
                <label>Limite por hora<input className="field" type="number" min="1" value={settings.limitPerHour || 60} onChange={(event) => updatePartnerSettingsDraft('limitPerHour', event.target.value)} /></label>
                <label className="checkbox-line"><input type="checkbox" checked={Boolean(settings.automationEnabled)} onChange={(event) => updatePartnerSettingsDraft('automationEnabled', event.target.checked)} /> Rotina automatica ativa</label>
                <label className="checkbox-line"><input type="checkbox" checked={Boolean(settings.testMode)} onChange={(event) => updatePartnerSettingsDraft('testMode', event.target.checked)} /> Modo teste</label>
              </div>
              <label>Horarios permitidos<textarea className="field" rows="2" value={settings.allowedTimes || '08:00\n18:00'} onChange={(event) => updatePartnerSettingsDraft('allowedTimes', event.target.value)} /></label>
              <div className="partner-video-weekdays">
                {partnerVideoWeekdays.map((day) => (
                  <label key={day.value} className="checkbox-line compact-check">
                    <input type="checkbox" checked={(settings.allowedWeekdays || []).map(Number).includes(day.value)} onChange={() => togglePartnerSettingsWeekday(day.value)} />
                    {day.label}
                  </label>
                ))}
              </div>
              <label>Numeros de teste<textarea className="field" rows="3" value={settings.testNumbers || ''} onChange={(event) => updatePartnerSettingsDraft('testNumbers', event.target.value)} /></label>
              <label>Template editavel<textarea className="field partner-video-template-field" rows="10" value={settings.template || ''} onChange={(event) => updatePartnerSettingsDraft('template', event.target.value)} /></label>
              <div className="row-actions">
                <Button actionKey="partner-video-settings-save" className="primary-action" onClick={savePartnerVideoSettings}>Salvar parametros</Button>
                <Button actionKey="partner-video-test" className="outline-action" onClick={sendPartnerVideoTests}>Testar numeros informados</Button>
                <button type="button" className="outline-action" onClick={() => setPartnerSettingsDraft(normalizePartnerVideoSettingsDraft(partnersVideo?.settings || {}))}>Restaurar tela</button>
              </div>
            </article>
          </section>
        )}

        {confirmationTab !== 'settings' && (
          <section className="whatsapp-panel partner-video-noncompliance-panel">
            <div className="partner-video-panel-heading">
              <div>
                <h2>Baixa operacional dos videos nao enviados</h2>
                <p className="whatsapp-panel-note">Selecione unidades/parceiros para alimentar as metricas de cobranca e os escalonamentos do dia.</p>
              </div>
              <div className="row-actions">
                <Button actionKey="partner-video-bulk-not-sent" className="primary-action" onClick={markSelectedPartnerVideosNotSent} disabled={!partnerNoVideoSelection.length}>Marcar selecionados</Button>
              </div>
            </div>
            <div className="partner-video-noncompliance-grid">
              {noVideoOptions.map((item) => (
                <label key={item.key} className="partner-video-noncompliance-item">
                  <input type="checkbox" checked={partnerNoVideoSelection.includes(item.key)} onChange={() => togglePartnerNoVideoSelection(item.key)} />
                  <span>
                    <strong>{item.clinicName}</strong>
                    <small>{item.partnerName || 'Parceiro nao informado'} - {item.phone || 'sem telefone'} - {item.status}</small>
                  </span>
                </label>
              ))}
              {!noVideoOptions.length && <p className="empty-state">Nenhuma unidade/parceiro disponivel para baixa no momento.</p>}
            </div>
          </section>
        )}

        {Boolean(missingUnitCount) && (
          <section className="whatsapp-panel partner-video-missing-section">
            <div className="partner-video-panel-heading">
              <div>
                <p className="eyebrow">Cobertura cadastral</p>
                <h2>Unidades sem parceiro ativo</h2>
                <p className="whatsapp-panel-note">Clique em uma unidade para abrir o cadastro de parceiro ja vinculado a ela.</p>
              </div>
              <span className="whatsapp-badge warning">{missingUnitCount}</span>
            </div>
            <div className="partner-video-missing-list">
              {unitsWithoutPartnerNames.map((name) => (
                <button key={name} type="button" className="partner-video-missing-card" onClick={() => startPartnerVideoContactForClinic(name)}>
                  <span>Sem parceiro ativo</span>
                  <strong>{name}</strong>
                  <p>Cadastre parceiro, telefone e rotina para incluir a unidade nos disparos.</p>
                  <b>Adicionar parceiro</b>
                </button>
              ))}
            </div>
          </section>
        )}

        {partnerHistoryContact && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPartnerHistoryContact(null)}>
            <section className="modal-panel partner-video-history-modal" onClick={(event) => event.stopPropagation()}>
              <div className="whatsapp-panel-head">
                <div>
                  <p className="eyebrow">Historico do parceiro</p>
                  <h2>{partnerHistoryContact.partner_name}</h2>
                  <p className="whatsapp-panel-note">{partnerHistoryContact.clinic_name} - {partnerHistoryContact.phone_number || 'sem telefone'}</p>
                </div>
                <button type="button" className="outline-action" onClick={() => setPartnerHistoryContact(null)}>Fechar</button>
              </div>
              <div className="whatsapp-table-wrap">
                <table className="whatsapp-table">
                  <thead><tr><th>Data/hora</th><th>Evento</th><th>Status</th><th>Mensagem/detalhe</th><th>Usuario</th></tr></thead>
                  <tbody>{historyLogs.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>{item.event_type}</td>
                      <td><span className={`whatsapp-badge ${statusTone(item.status)}`}>{item.status}</span></td>
                      <td className="partner-video-log-detail">{String(item.error_message || item.message_text || item.response_payload || '-').slice(0, 220)}</td>
                      <td>{item.created_by || '-'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {!historyLogs.length && <p className="empty-state">Nenhum historico registrado para este parceiro.</p>}
              </div>
            </section>
          </div>
        )}
      </section>
    );
  };

  const updateSettingsDraft = (field, value) => {
    if (field.startsWith('antiBan.')) {
      const key = field.replace('antiBan.', '');
      setSettingsDraft((current) => ({ ...current, antiBan: { ...(current.antiBan || {}), [key]: value } }));
      return;
    }
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };

  const renderSettings = () => (
    <section className="whatsapp-settings-grid">
      <article className="whatsapp-panel">
        <h2>Configuracoes WhatsApp</h2>
        <label>WhatsApp Service URL<input className="field" value={settingsDraft.baseUrl || ''} onChange={(event) => updateSettingsDraft('baseUrl', event.target.value)} placeholder="http://2.24.101.6:3005" /></label>
        <label>WhatsApp Service API Key<input className="field" value={settingsDraft.apiKey || ''} onChange={(event) => updateSettingsDraft('apiKey', event.target.value)} placeholder={adminSettings?.apiKeyMasked || 'Nao alterar'} /></label>
        <div className="whatsapp-form-grid">
          <label>Delay minimo<input className="field" type="number" value={settingsDraft.antiBan?.minDelayMs || ''} onChange={(event) => updateSettingsDraft('antiBan.minDelayMs', event.target.value)} /></label>
          <label>Delay maximo<input className="field" type="number" value={settingsDraft.antiBan?.maxDelayMs || ''} onChange={(event) => updateSettingsDraft('antiBan.maxDelayMs', event.target.value)} /></label>
          <label>Limite por minuto<input className="field" type="number" value={settingsDraft.antiBan?.rateLimitPerMinute || ''} onChange={(event) => updateSettingsDraft('antiBan.rateLimitPerMinute', event.target.value)} /></label>
          <label>Atendimentos simultaneos<input className="field" type="number" value={settingsDraft.antiBan?.defaultMaxSimultaneous || ''} onChange={(event) => updateSettingsDraft('antiBan.defaultMaxSimultaneous', event.target.value)} /></label>
        </div>
        <div className="row-actions">
          <Button actionKey="settings" className="primary-action" onClick={saveAdminSettings}>Salvar configuracoes</Button>
          <Button actionKey="settings-test" onClick={testAdminSettings}>Testar conexao</Button>
          <Button actionKey="daily-reminders" onClick={sendDailyOpenDemandReminders}>Enviar avisos diarios</Button>
          <Button actionKey="weekly-report" onClick={sendWeeklyAdminComplaintReport}>Enviar relatorio semanal</Button>
          <Button actionKey="clear-data" className="outline-action danger-action" onClick={clearWhatsAppManagementData}>Limpar base</Button>
        </div>
      </article>
      <article className="whatsapp-panel">
        <h2>Diagnostico</h2>
        <div className="whatsapp-card-list compact">
          <article><span>Configuracao</span><strong>{configStatus?.configured ? 'Operacional' : 'Pendente'}</strong><p>{configStatus?.message || '-'}</p></article>
          <article><span>Base URL</span><strong>{configStatus?.baseUrl || settingsDraft.baseUrl || '-'}</strong><p>Rota do whatsapp-service</p></article>
          <article><span>Servico</span><strong>{configStatus?.serviceReachable ? 'Online' : 'Sem resposta'}</strong><p>{configStatus?.providerLabel || 'whatsapp-service VPS'}</p></article>
          <article><span>Sessoes</span><strong>{instances.length}</strong><p>{instances.filter((item) => String(item.status || '').toLowerCase() === 'conectado').length} conectada(s)</p></article>
          <article><span>Webhook de recebimento</span><strong>{configStatus?.webhook?.tokenConfigured ? 'Protegido' : 'Sem token'}</strong><p>{configStatus?.webhook?.url || '-'}</p></article>
          <article><span>Ultimo evento recebido</span><strong>{configStatus?.webhook?.lastInboundEventAt ? String(configStatus.webhook.lastInboundEventAt).slice(0, 16).replace('T', ' ') : 'Sem evento'}</strong><p>{configStatus?.webhook?.lastError || configStatus?.webhook?.lastEventType || 'Aguardando mensagens da VPS'}</p></article>
        </div>
      </article>
    </section>
  );

  const renderSection = () => {
    if (currentSection === 'dashboard') return renderDashboard();
    if (currentSection === 'instances') return renderInstances();
    if (currentSection === 'attendance') return renderAttendance();
    if (currentSection === 'send') return renderSend();
    if (currentSection === 'templates') return renderTemplates();
    if (currentSection === 'campaigns') return renderCampaigns();
    if (currentSection === 'chatbot') return renderChatbot();
    if (currentSection === 'absent') return renderAbsent();
    if (currentSection === 'history') return renderHistory();
    if (currentSection === 'confirmation') return renderConfirmationSchedulingPro();
    if (currentSection === 'reports') return renderReports();
    if (currentSection === 'settings') return renderSettings();
    return renderDashboard();
  };

  if (!allowed) {
    return (
      <main className="whatsapp-management-page">
        <section className="whatsapp-panel">
          <h1>Gestao WhatsApp CRC</h1>
          <p>Seu perfil nao possui acesso a este modulo.</p>
          <button type="button" className="primary-action" onClick={() => navigate('/home')}>Voltar</button>
        </section>
      </main>
    );
  }

  return (
    <main className="whatsapp-management-page">
      <header className="whatsapp-heading">
        <div>
          <p className="eyebrow">Central de atendimento</p>
          <h1>Gestao WhatsApp CRC</h1>
          <p>{sectionDescriptions[currentSectionMeta?.id] || 'Atendimento operacional, numeros conectados, mensagens padrao, chatbot, ausentes, historico e metricas.'}</p>
          <div className="whatsapp-heading-meta">
            <span className={`whatsapp-badge ${configStatus?.serviceReachable ? 'success' : 'warning'}`}>{configStatus?.serviceReachable ? 'whatsapp-service online' : 'verificando servico'}</span>
            {currentSectionMeta ? <span className="whatsapp-section-pill">{currentSectionMeta.label}</span> : null}
          </div>
        </div>
        <div className="heading-actions">
          <button type="button" className="outline-action" onClick={() => loadBaseData()}>Atualizar</button>
          <button type="button" className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="whatsapp-hero-metrics">
        {headerMetrics.map((item) => (
          <article key={item.label} className={`whatsapp-hero-metric ${item.tone || 'neutral'}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <nav className="whatsapp-tabbar whatsapp-tabbar-grouped">
        {Object.entries(groupedAllowedSections).map(([group, items]) => (
          <section className="whatsapp-tab-group" key={group}>
            <strong>{group}</strong>
            <div>
              {items.map((item) => (
                <button key={item.id} type="button" className={currentSection === item.id ? 'active' : ''} onClick={() => navigate(item.path)}>
                  <span>{item.label}</span>
                  {sectionBadgeValue(item.id, { instances, queue, templates, flows, absent, history }) ? (
                    <small>{sectionBadgeValue(item.id, { instances, queue, templates, flows, absent, history })}</small>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>

      {Boolean(loadWarnings.length) && (
        <section className="whatsapp-load-warning-strip" aria-label="Itens com carga parcial">
          <div>
            <strong>Carga parcial de dados</strong>
            <p>Alguns modulos nao responderam nesta atualizacao. A operacao principal continua disponivel.</p>
          </div>
          <div className="whatsapp-load-warning-list">
            {loadWarnings.map((item) => (
              <span key={item}>{formatLoadWarningKey(item)}</span>
            ))}
          </div>
        </section>
      )}

      {feedback && <p className={`form-feedback whatsapp-feedback ${feedback.type === 'error' ? 'error' : 'success'}`}>{feedback.message}</p>}
      {loading ? <p className="form-feedback whatsapp-feedback">Carregando Gestao WhatsApp CRC...</p> : renderSection()}

      {qrResult && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setQrResult(null)}>
          <section className="modal-panel whatsapp-qr-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="eyebrow">QR Code</p>
              <h2>{qrResult.instanceName}</h2>
              <p>{qrResult.data?.message || 'Abra o WhatsApp no celular, acesse aparelhos conectados e escaneie este codigo.'}</p>
            </div>
            {String(qrResult.data?.base64 || qrResult.data?.qrcode || qrResult.data?.qr || '').startsWith('data:image')
              ? <img src={qrResult.data.base64 || qrResult.data.qrcode || qrResult.data.qr} alt="QR Code WhatsApp" />
              : qrResult.data?.connected
                ? <div className="whatsapp-qr-connected">Conectado</div>
                : <pre>{qrResult.data?.code || qrResult.data?.pairingCode || JSON.stringify(qrResult.data, null, 2)}</pre>}
            <div className="row-actions">
              <Button actionKey={`qr-${qrResult.instanceName}`} onClick={() => generateQrCode(qrResult.instanceName)}>Atualizar QR Code</Button>
              {qrResult.data?.qrImageUrl && <a className="outline-action" href={qrResult.data.qrImageUrl} target="_blank" rel="noreferrer">Abrir na VPS</a>}
              <button type="button" className="primary-action" onClick={() => setQrResult(null)}>Fechar</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default WhatsAppManagement;
