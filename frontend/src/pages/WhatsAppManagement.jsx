import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io as createSocket } from 'socket.io-client';

import api, { apiBaseUrl } from '../api';
import { hasActionPermission, hasPermission, isMasterAdmin, normalizeRoleValue, readUser } from '../constants';
import { readToken } from '../session';

const sections = [
  { id: 'dashboard', label: 'Dashboard', path: '/home/whatsapp-management/dashboard', permission: 'whatsapp_dashboard', leader: true },
  { id: 'instances', label: 'Cadastro de Numero', path: '/home/whatsapp-management/instances', permission: 'whatsapp_instances', leader: true },
  { id: 'attendance', label: 'Atendimento', path: '/home/whatsapp-management/attendance', permission: 'whatsapp_attendance', operator: true },
  { id: 'send', label: 'Envio manual', path: '/home/whatsapp-management/send', permission: 'whatsapp_send', operator: true },
  { id: 'templates', label: 'Mensagens padrao', path: '/home/whatsapp-management/templates', permission: 'whatsapp_templates', operator: true },
  { id: 'chatbot', label: 'Chatbot', path: '/home/whatsapp-management/chatbot', permission: 'whatsapp_chatbot', operator: true },
  { id: 'absent', label: 'Ausentes', path: '/home/whatsapp-management/absent', permission: 'whatsapp_absent', operator: true },
  { id: 'history', label: 'Historico', path: '/home/whatsapp-management/history', permission: 'whatsapp_history', operator: true },
  { id: 'reports', label: 'Relatorios', path: '/home/whatsapp-management/reports', permission: 'whatsapp_reports', leader: true },
  { id: 'settings', label: 'Configuracoes', path: '/home/whatsapp-management/settings', permission: 'whatsapp_settings', masterOnly: true }
];

const sectors = ['CRC', 'SAC', 'Comercial', 'NPS', 'Reclamacoes', 'Pos-venda', 'Dentistas Parceiros'];
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

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits.slice(0, 13);
  return `55${digits}`.slice(0, 13);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
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
  const { section } = useParams();
  const user = useMemo(() => readUser(), []);
  const role = normalizeRoleValue(user?.role);
  const allowedSections = useMemo(() => sections.filter((item) => canAccessSection(user, item)), [user]);
  const currentSection = allowedSections.some((item) => item.id === section) ? section : (allowedSections[0]?.id || 'dashboard');
  const allowed = hasPermission(user, 'whatsapp_management') || isMasterAdmin(user) || ['admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator'].includes(role);
  const canConfigure = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_config_manage') || ['admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager'].includes(role);
  const canRouteAttendance = canConfigure && role !== 'crc_operator';
  const canDeleteWhatsappItems = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_instance_delete');
  const canDeleteTemplates = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_template_delete');
  const canDeleteFlows = isMasterAdmin(user) || hasActionPermission(user, 'whatsapp_chatbot_delete');

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [feedback, setFeedback] = useState(null);
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
  const [messages, setMessages] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [qrResult, setQrResult] = useState(null);

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
  const [transferTargetId, setTransferTargetId] = useState('');
  const [settingsDraft, setSettingsDraft] = useState({ baseUrl: '', apiKey: '', antiBan: {} });
  const [historyFilters, setHistoryFilters] = useState({ search: '', status: '', instanceName: '' });
  const [dashboardFilters] = useState({ operatorId: '', clinicId: '', instanceName: '', status: '', campaign: '' });
  const selectedConversationIdRef = useRef('');

  const selectedQueueConversation = useMemo(
    () => queue.find((item) => String(item.conversation_id) === String(selectedConversationId)) || null,
    [queue, selectedConversationId]
  );
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
      flows: api.get('/api/whatsapp/chatbot/flows')
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
    });

    if (failed.length && !silent) {
      setError(`Algumas informacoes nao carregaram: ${failed.join(', ')}. Use Atualizar para tentar novamente; os botoes exibem a rota exata em caso de 404.`);
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

  const runAction = async (key, action, successMessage, fallbackMessage) => {
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
      const response = await api.post('/api/whatsapp/send', {
        instance_name: instanceName,
        patient_phone: phone,
        patient_name: 'Teste operacional',
        message_type: 'teste',
        message_text: 'Envio de mensagem teste'
      });
      await loadBaseData({ silent: true });
      return response;
    }, 'Mensagem teste enviada ou enfileirada.', 'Nao foi possivel enviar a mensagem teste.');
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
    const payload = { ...draft, patient_phone: normalizePhone(draft.patient_phone), operator_name: user?.name || draft.operator_name };
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
            nome_paciente: payload.patient_name,
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

  const Button = ({ actionKey, children, className = 'outline-action', disabled = false, ...props }) => (
    <button type="button" className={className} disabled={Boolean(savingKey) || disabled} {...props}>
      {savingKey === actionKey ? 'Aguarde...' : children}
    </button>
  );

  const renderDashboard = () => {
    const summary = dashboard?.summary || {};
    const cards = [
      ['Sessoes', instances.length, 'Numeros cadastrados'],
      ['Conectadas', instances.filter((item) => String(item.status || '').toLowerCase() === 'conectado').length, 'Status via VPS'],
      ['Mensagens hoje', summary.sentToday || 0, 'Historico do dia'],
      ['Recebidas hoje', summary.receivedToday || 0, 'Entradas do dia'],
      ['Fila aberta', queue.length, 'Atendimentos pendentes'],
      ['Ausentes', absent.length, 'Retorno pendente'],
      ['Operadores', operators.length, 'Equipe habilitada'],
      ['Taxa resposta', `${Number(summary.responseRate || 0).toLocaleString('pt-BR')}%`, 'Indicador operacional']
    ];

    return (
      <>
        <section className="whatsapp-kpi-grid">
          {cards.map(([title, value, helper]) => (
            <article className="whatsapp-kpi" key={title}>
              <span>{title}</span>
              <strong>{value}</strong>
              <small>{helper}</small>
            </article>
          ))}
        </section>
        <section className="whatsapp-panel">
          <h2>Leitura operacional</h2>
          <div className="whatsapp-card-list compact">
            {instances.slice(0, 12).map((item) => (
              <article key={item.instance_name}>
                <span>{item.display_name || item.instance_name}</span>
                <strong>{item.status || 'sem status'}</strong>
                <small>{item.phone_number || item.clinic_name || '-'}</small>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  };

  const renderInstances = () => (
    <section className="whatsapp-two-column">
      {canConfigure && (
        <article className="whatsapp-panel">
          <h2>{editingInstanceName ? 'Editar numero' : 'Novo numero'}</h2>
          <div className="whatsapp-form-grid">
            <label>Identificacao<input className="field" value={instanceDraft.instance_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, instance_name: event.target.value }))} disabled={Boolean(editingInstanceName)} /></label>
            <label>Nome de exibicao<input className="field" value={instanceDraft.display_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
            <label>Setor<select className="field" value={instanceDraft.sector} onChange={(event) => setInstanceDraft((current) => ({ ...current, sector: event.target.value }))}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Clinica<select className="field" value={instanceDraft.clinic_id} onChange={(event) => setInstanceDraft((current) => ({ ...current, clinic_id: event.target.value }))}><option value="">Sem vinculo</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
            <label>Unidade<input className="field" value={instanceDraft.unit_name} onChange={(event) => setInstanceDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
            <label>Numero WhatsApp<input className="field" value={instanceDraft.phone_number} onChange={(event) => setInstanceDraft((current) => ({ ...current, phone_number: normalizePhone(event.target.value) }))} placeholder="5562999999999" /></label>
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
    <section className="whatsapp-panel">
      <h2>Envio manual</h2>
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
      <Button actionKey="send-message" className="primary-action" onClick={() => sendMessage(sendDraft)} disabled={selectedSendInstanceBlocked}>Enviar mensagem</Button>
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
      </article>
    </section>
  );

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
    if (currentSection === 'chatbot') return renderChatbot();
    if (currentSection === 'absent') return renderAbsent();
    if (currentSection === 'history') return renderHistory();
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
          <p>Atendimento operacional, numeros conectados, mensagens padrao, chatbot, ausentes, historico e metricas.</p>
          <span className={`whatsapp-badge ${configStatus?.serviceReachable ? 'success' : 'warning'}`}>{configStatus?.serviceReachable ? 'whatsapp-service online' : 'verificando servico'}</span>
        </div>
        <div className="heading-actions">
          <button type="button" className="outline-action" onClick={() => loadBaseData()}>Atualizar</button>
          <button type="button" className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <nav className="whatsapp-tabbar">
        {allowedSections.map((item) => (
          <button key={item.id} type="button" className={currentSection === item.id ? 'active' : ''} onClick={() => navigate(item.path)}>{item.label}</button>
        ))}
      </nav>

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
