import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { getApiErrorMessage } from '../api';
import { ActionButtons, Card, DashboardGrid, KPICard, PageHeader, SectionContainer } from '../components/DesignSystem';
import { getUserDisplayName, isMasterAdmin, normalizeRoleValue, readUser } from '../constants';

const agendaColumns = [
  { key: 'todo', label: 'A fazer', helper: 'Ideias, pendencias e proximas acoes', eyebrow: 'Backlog' },
  { key: 'today', label: 'Hoje', helper: 'Prioridade do dia', eyebrow: 'Focus' },
  { key: 'doing', label: 'Em andamento', helper: 'Itens em execucao', eyebrow: 'Running' },
  { key: 'done', label: 'Concluido', helper: 'Finalizados', eyebrow: 'Closed' }
];

const priorityOptions = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' }
];

const agendaDashboardWindowOptions = [
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
  { value: '60', label: '60 dias' }
];

const recurrenceWeekdayOptions = [
  { value: 1, shortLabel: 'Seg', fullLabel: 'Segunda' },
  { value: 2, shortLabel: 'Ter', fullLabel: 'Terca' },
  { value: 3, shortLabel: 'Qua', fullLabel: 'Quarta' },
  { value: 4, shortLabel: 'Qui', fullLabel: 'Quinta' },
  { value: 5, shortLabel: 'Sex', fullLabel: 'Sexta' },
  { value: 6, shortLabel: 'Sab', fullLabel: 'Sabado' },
  { value: 0, shortLabel: 'Dom', fullLabel: 'Domingo' }
];

const emptyDraft = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'normal',
  due_at: '',
  reminder_at: '',
  assigned_user_id: '',
  tags: '',
  is_daily_recurring: false,
  requires_completion: true,
  recurrence_base_status: 'todo',
  recurrence_weekdays: []
};

const emptyImportDraft = {
  file: null,
  clinic_id: '',
  default_assigned_user_id: '',
  create_tasks: true,
  dispatch_whatsapp: false,
  message_text: ''
};

function toDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function isOverdue(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function normalizeDraftFromItem(item = {}) {
  return {
    title: item.title || '',
    description: item.description || '',
    status: item.status || 'todo',
    priority: item.priority || 'normal',
    due_at: toDatetimeLocal(item.due_at),
    reminder_at: toDatetimeLocal(item.reminder_at),
    assigned_user_id: item.assigned_user_id ? String(item.assigned_user_id) : '',
    tags: Array.isArray(item.tags) ? item.tags.join(', ') : '',
    is_daily_recurring: Boolean(item.is_daily_recurring),
    requires_completion: item.requires_completion !== false,
    recurrence_base_status: item.recurrence_base_status || 'todo',
    recurrence_weekdays: normalizeAgendaRecurrenceWeekdays(item.recurrence_weekdays)
  };
}

function normalizeAgendaRecurrenceWeekdays(value = []) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
  )).sort((left, right) => left - right);
}

function formatAgendaAssignee(item = {}) {
  return item.assigned_user_name || item.assignedUser?.name || item.owner_name || 'Sem responsavel';
}

function formatAgendaUserOption(user = {}) {
  const name = user.name || user.email || `Usuario ${user.id}`;
  const detail = user.position || user.role || user.department || user.email;
  return detail ? `${name} - ${detail}` : name;
}

function formatExecutionStamp(item = {}) {
  if (!item?.completed_at) return '';
  const actor = item.completed_by_name ? ` por ${item.completed_by_name}` : '';
  return `Executado em ${formatDateTime(item.completed_at)}${actor}`;
}

function formatRecurrenceWeekdaySummary(weekdays = []) {
  const normalizedWeekdays = normalizeAgendaRecurrenceWeekdays(weekdays);
  if (!normalizedWeekdays.length) return 'Todos os dias';
  return normalizedWeekdays
    .map((weekday) => recurrenceWeekdayOptions.find((option) => option.value === weekday)?.shortLabel || '')
    .filter(Boolean)
    .join(', ');
}

function formatAgendaRecurrenceSummary(item = {}) {
  if (!item?.is_daily_recurring) return '';
  const recurrenceDaysLabel = formatRecurrenceWeekdaySummary(item.recurrence_weekdays);
  return `Volta para A fazer: ${recurrenceDaysLabel}`;
}

function canAccessAgendaAnalytics(user) {
  if (isMasterAdmin(user)) return true;
  return ['admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'manager'].includes(normalizeRoleValue(user?.role));
}

function formatAgendaDashboardDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function canExecuteAgendaItem(currentUserId, item = {}) {
  const responsibleId = String(item.assigned_user_id || item.owner_user_id || '');
  return responsibleId && String(currentUserId || '') === responsibleId;
}

function getPriorityLabel(priority = 'normal') {
  if (priority === 'urgente') return 'Urgente';
  if (priority === 'alta') return 'Alta';
  if (priority === 'baixa') return 'Baixa';
  return 'Normal';
}

function getAgendaDeadlineState(item = {}) {
  if (item.status === 'done') {
    return { label: 'Concluido', tone: 'done' };
  }

  if (!item?.due_at) {
    return { label: 'Sem prazo', tone: 'neutral' };
  }

  const dueAt = new Date(item.due_at);
  if (Number.isNaN(dueAt.getTime())) {
    return { label: 'Prazo invalido', tone: 'neutral' };
  }

  const diffMs = dueAt.getTime() - Date.now();
  if (diffMs < 0) {
    return { label: 'Atrasado', tone: 'late' };
  }

  if (diffMs <= 24 * 60 * 60 * 1000) {
    return { label: 'Vence hoje', tone: 'today' };
  }

  if (diffMs <= 48 * 60 * 60 * 1000) {
    return { label: 'Em 48h', tone: 'warning' };
  }

  return { label: 'No prazo', tone: 'ok' };
}

function buildAgendaGroupIdentity(item = {}) {
  const assignedUserId = item.assigned_user_id || item.assignedUser?.id || null;
  const ownerUserId = item.owner_user_id || null;

  if (assignedUserId) {
    return {
      key: `assigned-${assignedUserId}`,
      label: formatAgendaAssignee(item),
      userId: Number(assignedUserId) || null,
      mode: 'assigned',
      helper: ownerUserId && Number(ownerUserId) !== Number(assignedUserId)
        ? `Acompanhamento mantido por ${item.owner_name || 'quem atribuiu'}`
        : 'Demandas atuais do responsavel'
    };
  }

  if (ownerUserId) {
    return {
      key: `owner-${ownerUserId}`,
      label: item.owner_name || 'Sem responsavel definido',
      userId: Number(ownerUserId) || null,
      mode: 'owner',
      helper: 'Criado sem atribuicao formal'
    };
  }

  return {
    key: 'unassigned',
    label: 'Sem responsavel definido',
    userId: null,
    mode: 'unassigned',
    helper: 'Item sem proprietario operacional'
  };
}

function AgendaCard({ item, currentUserId, onOpen, onStatus, onDragStart }) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const deadline = getAgendaDeadlineState(item);
  const ownerFollowUp = item.owner_name && item.owner_user_id && item.assigned_user_id && Number(item.owner_user_id) !== Number(item.assigned_user_id)
    ? `Acompanhamento mantido por ${item.owner_name}`
    : '';
  const executionStamp = formatExecutionStamp(item);
  const canExecute = canExecuteAgendaItem(currentUserId, item);
  const recurrenceSummary = formatAgendaRecurrenceSummary(item);
  return (
    <article
      className={`agenda-task-card priority-${item.priority || 'normal'} ${isOverdue(item.due_at) && item.status !== 'done' ? 'overdue' : ''}`}
      draggable
      onDragStart={() => onDragStart(item.id)}
    >
      <div className="agenda-card-topline">
        <span className={`agenda-priority priority-${item.priority || 'normal'}`}>{getPriorityLabel(item.priority)}</span>
        <span className={`agenda-deadline-pill ${deadline.tone}`}>{deadline.label}</span>
      </div>
      <button type="button" className="agenda-task-main" onClick={() => onOpen(item)}>
        <strong>{item.title}</strong>
        {item.description ? <p>{item.description}</p> : null}
      </button>
      <div className="agenda-card-secondary-meta">
        {recurrenceSummary ? <small>{recurrenceSummary}</small> : null}
        {item.requires_completion ? <small>Execução obrigatória</small> : null}
      </div>
      <div className="agenda-assignee">
        <div>
          <span>Responsavel principal</span>
          <strong>{formatAgendaAssignee(item)}</strong>
        </div>
        {ownerFollowUp ? <small>{ownerFollowUp}</small> : null}
      </div>
      <div className="agenda-task-meta">
        <span>{item.due_at ? `Prazo ${formatDateTime(item.due_at)}` : 'Sem prazo definido'}</span>
        {item.reminder_at ? <span>Lembrete {formatDateTime(item.reminder_at)}</span> : null}
        {item.clinic_name ? <span>Unidade {item.clinic_name}</span> : null}
        {item.patient_name ? <span>Paciente {item.patient_name}</span> : null}
        {executionStamp ? <span>{executionStamp}</span> : null}
      </div>
      {tags.length ? (
        <div className="agenda-tag-row">
          {tags.map((tag) => <small key={tag}>{tag}</small>)}
        </div>
      ) : null}
      <div className="agenda-card-actions">
        {item.status !== 'doing' && item.status !== 'done' ? (
          <button type="button" onClick={() => onStatus(item, 'doing')}>Iniciar</button>
        ) : null}
        {item.status !== 'done' ? (
          <button type="button" onClick={() => onStatus(item, 'done', { markExecuted: true })} disabled={!canExecute}>
            {canExecute ? 'Registrar execução' : 'Aguardando responsável'}
          </button>
        ) : (
          <button type="button" onClick={() => onStatus(item, item.is_daily_recurring ? (item.recurrence_base_status || 'today') : 'todo')}>
            {item.is_daily_recurring ? 'Reabrir ciclo' : 'Reabrir'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function AgendaPage() {
  const currentUser = useMemo(() => readUser(), []);
  const currentUserId = String(currentUser?.id || '');
  const canDeleteAgendaItem = isMasterAdmin(currentUser);
  const canUseAgendaAnalytics = canAccessAgendaAnalytics(currentUser);
  const [items, setItems] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [clinicOptions, setClinicOptions] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardDays, setDashboardDays] = useState('30');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [exportingReport, setExportingReport] = useState('');
  const [importDraft, setImportDraft] = useState(emptyImportDraft);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('');
  const [activeAssignee, setActiveAssignee] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reminderItem, setReminderItem] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const notifiedReminderIds = useRef(new Set());
  const titleInputRef = useRef(null);

  const loadItems = async () => {
    setLoading(true);
    setFeedback('');
    try {
      const response = await api.get('/api/agenda/items', {
        params: {
          search: search.trim() || undefined,
          status: activeStatus || undefined
        }
      });
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel carregar a agenda.'));
    } finally {
      setLoading(false);
    }
  };

  const loadAssignableUsers = async () => {
    try {
      const response = await api.get('/api/agenda/users');
      setAssignableUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setAssignableUsers(currentUser?.id ? [{
        id: currentUser.id,
        name: getUserDisplayName(currentUser),
        email: currentUser.email || null,
        role: currentUser.role || null
      }] : []);
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel carregar usuarios para atribuicao.'));
    }
  };

  const loadClinics = async () => {
    if (!canUseAgendaAnalytics) {
      setClinicOptions([]);
      return;
    }

    try {
      const response = await api.get('/clinics');
      setClinicOptions(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setClinicOptions([]);
    }
  };

  const loadDashboard = async () => {
    if (!canUseAgendaAnalytics) {
      setDashboard(null);
      return;
    }

    setDashboardLoading(true);
    try {
      const response = await api.get('/api/agenda/dashboard', {
        params: {
          days: dashboardDays
        }
      });
      setDashboard(response.data || null);
    } catch (error) {
      setDashboard(null);
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel carregar o dashboard da agenda.'));
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  useEffect(() => {
    loadAssignableUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadClinics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAgendaAnalytics]);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAgendaAnalytics, dashboardDays]);

  useEffect(() => {
    const timer = window.setTimeout(loadItems, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const evaluateReminders = () => {
      const dueReminder = items
        .filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at)
        .filter((item) => new Date(item.reminder_at).getTime() <= Date.now())
        .sort((a, b) => new Date(a.reminder_at) - new Date(b.reminder_at))[0];

      if (!dueReminder) return;
      setReminderItem(dueReminder);

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && !notifiedReminderIds.current.has(dueReminder.id)) {
        new Notification('Lembrete da Agenda', {
          body: dueReminder.title,
          tag: `agenda-${dueReminder.id}`
        });
        notifiedReminderIds.current.add(dueReminder.id);
      }
    };

    evaluateReminders();
    const timer = window.setInterval(evaluateReminders, 60000);
    return () => window.clearInterval(timer);
  }, [items]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [editorOpen]);

  const availableAssignees = useMemo(() => {
    const byKey = new Map();
    items.forEach((item) => {
      const identity = buildAgendaGroupIdentity(item);
      if (!byKey.has(identity.key)) {
        byKey.set(identity.key, identity);
      }
    });
    return Array.from(byKey.values());
  }, [items]);

  useEffect(() => {
    if (!activeAssignee) return;
    if (availableAssignees.some((item) => item.key === activeAssignee)) return;
    setActiveAssignee('');
  }, [activeAssignee, availableAssignees]);

  const filteredItems = useMemo(() => (
    activeAssignee
      ? items.filter((item) => buildAgendaGroupIdentity(item).key === activeAssignee)
      : items
  ), [activeAssignee, items]);
  const stats = useMemo(() => {
    const open = filteredItems.filter((item) => item.status !== 'done').length;
    const overdue = filteredItems.filter((item) => item.status !== 'done' && isOverdue(item.due_at)).length;
    const reminders = filteredItems.filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at).length;
    const done = filteredItems.filter((item) => item.status === 'done').length;
    return { total: filteredItems.length, open, overdue, reminders, done };
  }, [filteredItems]);

  const agendaGroups = useMemo(() => {
    const groups = new Map();

    filteredItems.forEach((item) => {
      const identity = buildAgendaGroupIdentity(item);
      if (!groups.has(identity.key)) {
        groups.set(identity.key, {
          ...identity,
          items: []
        });
      }
      groups.get(identity.key).items.push(item);
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        total: group.items.length,
        open: group.items.filter((item) => item.status !== 'done').length,
        overdue: group.items.filter((item) => item.status !== 'done' && isOverdue(item.due_at)).length,
        done: group.items.filter((item) => item.status === 'done').length,
        columns: agendaColumns.reduce((acc, column) => {
          acc[column.key] = group.items.filter((item) => item.status === column.key);
          return acc;
        }, {})
      }))
      .sort((a, b) => {
        const aIsCurrent = a.key === `assigned-${currentUserId}` || a.key === `owner-${currentUserId}`;
        const bIsCurrent = b.key === `assigned-${currentUserId}` || b.key === `owner-${currentUserId}`;
        if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
        if (a.open !== b.open) return b.open - a.open;
        return a.label.localeCompare(b.label, 'pt-BR');
      });
  }, [currentUserId, filteredItems]);

  const assigneeOptions = useMemo(() => {
    const byId = new Map();
    if (currentUser?.id) {
      byId.set(String(currentUser.id), {
        id: currentUser.id,
        name: getUserDisplayName(currentUser),
        email: currentUser.email || null,
        role: currentUser.role || null,
        position: currentUser.position || null,
        department: currentUser.department || null
      });
    }
    assignableUsers.forEach((user) => {
      if (user?.id) byId.set(String(user.id), user);
    });
    return Array.from(byId.values());
  }, [assignableUsers, currentUser]);

  const dashboardSummaryCards = useMemo(() => ([
    { label: 'Demandas totais', value: dashboard?.summary?.total || 0, helper: 'base visível no período', tone: 'neutral' },
    { label: 'Abertas', value: dashboard?.summary?.open || 0, helper: 'em acompanhamento', tone: 'progress' },
    { label: 'Atrasadas', value: dashboard?.summary?.overdue || 0, helper: 'fora do prazo', tone: 'danger' },
    { label: 'Vencendo em 24h', value: dashboard?.summary?.due_24h || 0, helper: 'ação imediata', tone: 'warning' },
    { label: 'Concluídas em 7 dias', value: dashboard?.summary?.completed_7d || 0, helper: 'produtividade recente', tone: 'success' },
    { label: 'Rotinas recorrentes', value: dashboard?.summary?.recurring || 0, helper: 'voltam automaticamente ao fluxo', tone: 'neutral' }
  ]), [dashboard]);

  const openCreate = (status = 'todo', assignedUserId = currentUserId || '') => {
    setSelectedItem(null);
    setDraft({
      ...emptyDraft,
      status,
      assigned_user_id: assignedUserId,
      recurrence_base_status: 'todo'
    });
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setSelectedItem(item);
    setDraft(normalizeDraftFromItem(item));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setSelectedItem(null);
    setDraft(emptyDraft);
  };

  const toggleRecurrenceWeekday = (weekdayValue) => {
    setDraft((current) => {
      const currentWeekdays = normalizeAgendaRecurrenceWeekdays(current.recurrence_weekdays);
      const hasWeekday = currentWeekdays.includes(weekdayValue);
      return {
        ...current,
        recurrence_weekdays: hasWeekday
          ? currentWeekdays.filter((weekday) => weekday !== weekdayValue)
          : [...currentWeekdays, weekdayValue].sort((left, right) => left - right)
      };
    });
  };

  const saveItem = async () => {
    if (!draft.title.trim()) {
      setFeedback('Informe um titulo para o item da agenda.');
      return;
    }

    setSaving(true);
    setFeedback('');

    const payload = {
      title: draft.title,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      due_at: draft.due_at || null,
      reminder_at: draft.reminder_at || null,
      assigned_user_id: draft.assigned_user_id || null,
      tags: draft.tags,
      is_daily_recurring: Boolean(draft.is_daily_recurring),
      requires_completion: Boolean(draft.is_daily_recurring || draft.requires_completion),
      recurrence_base_status: draft.is_daily_recurring ? (draft.recurrence_base_status || 'todo') : null,
      recurrence_weekdays: draft.is_daily_recurring ? normalizeAgendaRecurrenceWeekdays(draft.recurrence_weekdays) : []
    };

    try {
      if (selectedItem?.id) {
        await api.patch(`/api/agenda/items/${selectedItem.id}`, payload);
      } else {
        await api.post('/api/agenda/items', payload);
      }
      closeEditor();
      await Promise.all([loadItems(), loadDashboard()]);
      setFeedback('Agenda atualizada com sucesso.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel salvar o item da agenda.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async () => {
    if (!selectedItem?.id) return;
    const confirmed = window.confirm(`Excluir "${selectedItem.title}" da agenda?`);
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.delete(`/api/agenda/items/${selectedItem.id}`);
      closeEditor();
      await Promise.all([loadItems(), loadDashboard()]);
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel excluir o item.'));
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (item, status, extraPayload = {}) => {
    try {
      const response = await api.patch(`/api/agenda/items/${item.id}`, { status, ...extraPayload });
      const updatedItem = response.data;
      setItems((current) => current.map((row) => row.id === item.id ? updatedItem : row));
      if (canUseAgendaAnalytics) {
        loadDashboard();
      }
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel mover o item.'));
    }
  };

  const handleDrop = async (status) => {
    const item = items.find((row) => row.id === draggingId);
    setDraggingId(null);
    if (!item || item.status === status) return;
    await updateStatus(item, status);
  };

  const acknowledgeReminder = async () => {
    if (!reminderItem?.id) return;
    try {
      await api.patch(`/api/agenda/items/${reminderItem.id}`, { ackReminder: true });
      setReminderItem(null);
      await loadItems();
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel confirmar o lembrete.'));
    }
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setFeedback('Este navegador nao suporta notificacoes nativas.');
      return;
    }
    const permission = await Notification.requestPermission();
    setFeedback(permission === 'granted' ? 'Notificacoes da Agenda ativadas.' : 'Notificacoes nao foram autorizadas.');
  };

  const updateImportDraft = (field, value) => {
    setImportDraft((current) => ({ ...current, [field]: value }));
  };

  const downloadReport = async (format) => {
    setExportingReport(format);
    try {
      const response = await api.get(`/api/agenda/report/${format}`, {
        params: { days: dashboardDays },
        responseType: 'blob'
      });
      downloadBlob(
        response.data,
        format === 'pdf'
          ? `agenda-dashboard-${dashboardDays}d.pdf`
          : `agenda-dashboard-${dashboardDays}d.xlsx`
      );
    } catch (error) {
      setFeedback(getApiErrorMessage(error, `Nao foi possivel exportar o relatorio da agenda em ${format.toUpperCase()}.`));
    } finally {
      setExportingReport('');
    }
  };

  const downloadImportTemplate = async () => {
    setExportingReport('template');
    try {
      const response = await api.get('/api/agenda/import-template', {
        responseType: 'blob'
      });
      downloadBlob(response.data, 'template-importacao-agenda.xlsx');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel baixar o template da agenda.'));
    } finally {
      setExportingReport('');
    }
  };

  const submitImport = async () => {
    if (!importDraft.file) {
      setFeedback('Selecione a planilha para importar a agenda.');
      return;
    }

    setImporting(true);
    setFeedback('');
    setImportSummary(null);

    try {
      const formData = new FormData();
      formData.append('file', importDraft.file);
      formData.append('create_tasks', importDraft.create_tasks ? 'true' : 'false');
      formData.append('dispatch_whatsapp', importDraft.dispatch_whatsapp ? 'true' : 'false');
      if (importDraft.clinic_id) {
        formData.append('campaign_clinic_id', importDraft.clinic_id);
      }
      if (importDraft.default_assigned_user_id) {
        formData.append('default_assigned_user_id', importDraft.default_assigned_user_id);
      }
      if (importDraft.message_text.trim()) {
        formData.append('message_text', importDraft.message_text.trim());
      }

      const response = await api.post('/api/agenda/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setImportSummary(response.data || null);
      setImportDraft(emptyImportDraft);
      await Promise.all([loadItems(), loadDashboard()]);
      setFeedback(response.data?.message || 'Importacao da agenda concluida.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel importar a planilha da agenda.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <main className="app-page agenda-page">
      <PageHeader
        eyebrow="Workspace"
        title="Agenda"
        description="Quadro executivo para organizar tarefas, compromissos, follow-ups e lembretes operacionais com fluxo visual no estilo ClickUp."
        actions={(
          <>
            <button type="button" className="outline-action" onClick={requestNotifications}>Ativar lembretes</button>
            <button type="button" className="primary-action" onClick={() => openCreate('today')}>Novo item</button>
          </>
        )}
      />

      {reminderItem ? (
        <section className="agenda-reminder-toast">
          <div>
            <span>Lembrete ativo</span>
            <strong>{reminderItem.title}</strong>
            <small>{formatDateTime(reminderItem.reminder_at)}</small>
          </div>
          <ActionButtons>
            <button type="button" className="outline-action" onClick={() => openEdit(reminderItem)}>Abrir</button>
            <button type="button" className="secondary-action" onClick={acknowledgeReminder}>Marcar como visto</button>
          </ActionButtons>
        </section>
      ) : null}

      {canUseAgendaAnalytics ? (
        <section className="agenda-intelligence-stack">
          <SectionContainer className="agenda-intelligence-panel">
            <div className="agenda-intelligence-head">
              <div>
                <span className="agenda-panel-kicker">Dashboard executivo</span>
                <strong>Visibilidade operacional da equipe CRC</strong>
                <small>Leitura rápida de produtividade, vencimentos e entregas por colaborador.</small>
              </div>
              <div className="agenda-intelligence-actions">
                <select className="field" value={dashboardDays} onChange={(event) => setDashboardDays(event.target.value)}>
                  {agendaDashboardWindowOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button type="button" className="outline-action" onClick={loadDashboard}>Atualizar painel</button>
                <button type="button" className="outline-action" onClick={() => downloadReport('excel')} disabled={exportingReport === 'excel'}>
                  Excel
                </button>
                <button type="button" className="outline-action" onClick={() => downloadReport('pdf')} disabled={exportingReport === 'pdf'}>
                  PDF
                </button>
              </div>
            </div>

            <DashboardGrid className="agenda-intelligence-kpis">
              {dashboardSummaryCards.map((card) => (
                <KPICard key={card.label} label={card.label} value={card.value} helper={card.helper} tone={card.tone} />
              ))}
            </DashboardGrid>

            <div className="agenda-intelligence-grid">
              <Card className="agenda-collaborator-panel">
                <div className="agenda-panel-headline">
                  <div>
                    <strong>Métricas por colaborador</strong>
                    <span>Produtividade individual, vencimentos e execução obrigatória.</span>
                  </div>
                  <small>{dashboardLoading ? 'Atualizando...' : `${dashboard?.collaborators?.length || 0} colaborador(es)`}</small>
                </div>
                <div className="agenda-collaborator-table-wrap">
                  <table className="agenda-collaborator-table">
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Abertas</th>
                        <th>Atrasadas</th>
                        <th>24h</th>
                        <th>48h</th>
                        <th>Concl. 7d</th>
                        <th>Índice</th>
                        <th>Última execução</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboard?.collaborators || []).map((item) => (
                        <tr key={item.key}>
                          <td>
                            <strong>{item.name}</strong>
                            <small>{item.role || 'Equipe CRC'}</small>
                          </td>
                          <td>{item.open}</td>
                          <td className={item.overdue ? 'danger-cell' : ''}>{item.overdue}</td>
                          <td>{item.due_24h}</td>
                          <td>{item.due_48h}</td>
                          <td>{item.completed_7d}</td>
                          <td>{item.productivity_index}%</td>
                          <td>{formatAgendaDashboardDate(item.last_completed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!dashboardLoading && !(dashboard?.collaborators || []).length ? <p className="empty-state">Nenhuma métrica de colaborador disponível.</p> : null}
                </div>
              </Card>

              <div className="agenda-insight-column">
                <Card className="agenda-ranking-panel">
                  <div className="agenda-panel-headline">
                    <div>
                      <strong>Destaques de entrega</strong>
                      <span>Quem mais executou no período selecionado.</span>
                    </div>
                  </div>
                  <div className="agenda-ranking-list">
                    {(dashboard?.top_performers || []).map((item, index) => (
                      <article key={`${item.key}-top`}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.completed_7d} entrega(s) nos últimos 7 dias</small>
                        </div>
                      </article>
                    ))}
                    {!dashboardLoading && !(dashboard?.top_performers || []).length ? <p className="empty-state">Sem destaques ainda.</p> : null}
                  </div>
                </Card>

                <Card className="agenda-urgent-panel">
                  <div className="agenda-panel-headline">
                    <div>
                      <strong>Demandas críticas</strong>
                      <span>Itens vencidos ou prestes a vencer para acompanhamento imediato.</span>
                    </div>
                  </div>
                  <div className="agenda-urgent-list">
                    {(dashboard?.urgent_items || []).map((item) => (
                      <article key={`urgent-${item.id}`} className={getAgendaDeadlineState(item).tone === 'late' ? 'late' : ''}>
                        <strong>{item.title}</strong>
                        <small>{item.assigned_user_name || 'Sem responsável'} · {item.clinic_name || 'Sem unidade'}</small>
                        <span>{item.due_at ? `Prazo ${formatAgendaDashboardDate(item.due_at)}` : 'Sem prazo definido'}</span>
                      </article>
                    ))}
                    {!dashboardLoading && !(dashboard?.urgent_items || []).length ? <p className="empty-state">Sem demandas críticas na janela atual.</p> : null}
                  </div>
                </Card>
              </div>
            </div>
          </SectionContainer>

          <SectionContainer className="agenda-import-panel">
            <div className="agenda-intelligence-head">
              <div>
                <span className="agenda-panel-kicker">Importação profissional</span>
                <strong>Planilha para demandas e confirmação via WhatsApp</strong>
                <small>Use a mesma base para cadastrar tarefas por colaborador e disparar confirmações em massa com unidade selecionada.</small>
              </div>
              <div className="agenda-intelligence-actions">
                <button type="button" className="outline-action" onClick={downloadImportTemplate} disabled={exportingReport === 'template'}>
                  Baixar template
                </button>
              </div>
            </div>

            <div className="agenda-import-grid">
              <label>
                Planilha
                <input
                  className="field"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => updateImportDraft('file', event.target.files?.[0] || null)}
                />
              </label>
              <label>
                Unidade da planilha
                <select className="field" value={importDraft.clinic_id} onChange={(event) => updateImportDraft('clinic_id', event.target.value)}>
                  <option value="">Selecione a unidade</option>
                  {clinicOptions.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Responsável padrão
                <select className="field" value={importDraft.default_assigned_user_id} onChange={(event) => updateImportDraft('default_assigned_user_id', event.target.value)}>
                  <option value="">Usar colaborador da planilha</option>
                  {assigneeOptions.map((user) => (
                    <option key={user.id} value={user.id}>{formatAgendaUserOption(user)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="agenda-import-options">
              <label className="agenda-toggle-card">
                <input type="checkbox" checked={importDraft.create_tasks} onChange={(event) => updateImportDraft('create_tasks', event.target.checked)} />
                <div>
                  <strong>Cadastrar demandas</strong>
                  <small>Cria as tarefas da agenda por colaborador, mantendo prazo, rotina diária e unidade.</small>
                </div>
              </label>
              <label className="agenda-toggle-card">
                <input type="checkbox" checked={importDraft.dispatch_whatsapp} onChange={(event) => updateImportDraft('dispatch_whatsapp', event.target.checked)} />
                <div>
                  <strong>Enviar confirmação via WhatsApp</strong>
                  <small>Usa a mesma planilha para enfileirar as mensagens padrão de confirmação para os pacientes.</small>
                </div>
              </label>
            </div>

            {importDraft.dispatch_whatsapp ? (
              <label>
                Mensagem padrão de confirmação
                <textarea
                  className="field agenda-import-message"
                  value={importDraft.message_text}
                  onChange={(event) => updateImportDraft('message_text', event.target.value)}
                  placeholder="Deixe em branco para usar a mensagem padrão profissional de confirmação."
                />
              </label>
            ) : null}

            <div className="agenda-import-actions">
              <button type="button" className="primary-action" onClick={submitImport} disabled={importing}>
                {importing ? 'Importando...' : 'Importar planilha'}
              </button>
            </div>

            {importSummary ? (
              <div className="agenda-import-summary">
                <article>
                  <span>Demandas criadas</span>
                  <strong>{importSummary.created || 0}</strong>
                </article>
                <article>
                  <span>WhatsApp enfileirado</span>
                  <strong>{importSummary.whatsappQueued || 0}</strong>
                </article>
                <article>
                  <span>Bloqueios</span>
                  <strong>{importSummary.invalid || 0}</strong>
                </article>
                <article>
                  <span>Lote</span>
                  <strong>{importSummary.batchId || '-'}</strong>
                </article>
              </div>
            ) : null}

            {importSummary?.invalidRows?.length ? (
              <div className="agenda-import-issues">
                <strong>Linhas com pendência</strong>
                <div className="agenda-import-issue-list">
                  {importSummary.invalidRows.map((item, index) => (
                    <p key={`${item.line || index}-${item.reason}`}>{item.reason}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </SectionContainer>
        </section>
      ) : null}

      <DashboardGrid className="agenda-kpis">
        <KPICard label="Total" value={stats.total} helper="itens na agenda" tone="neutral" />
        <KPICard label="Abertos" value={stats.open} helper="em acompanhamento" tone="progress" />
        <KPICard label="Lembretes" value={stats.reminders} helper="ativos ou programados" tone="warning" />
        <KPICard label="Atrasados" value={stats.overdue} helper="fora do prazo" tone="danger" />
        <KPICard label="Concluidos" value={stats.done} helper="finalizados" tone="success" />
      </DashboardGrid>

      <SectionContainer className="agenda-control-panel">
        <div className="agenda-toolbar">
          <div className="agenda-toolbar-copy">
            <strong>Controle operacional</strong>
            <span>Filtre, acompanhe e mova as tarefas entre etapas.</span>
          </div>
          <div className="agenda-toolbar-filters">
            <input
              className="field"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar item, paciente, unidade, descricao ou tag"
            />
            <select className="field" value={activeStatus} onChange={(event) => setActiveStatus(event.target.value)}>
              <option value="">Todos os status</option>
              {agendaColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
            </select>
            <select className="field" value={activeAssignee} onChange={(event) => setActiveAssignee(event.target.value)}>
              <option value="">Todos os usuarios</option>
              {availableAssignees.map((assignee) => (
                <option key={assignee.key} value={assignee.key}>{assignee.label}</option>
              ))}
            </select>
            <button type="button" className="outline-action" onClick={loadItems}>Atualizar</button>
          </div>
        </div>
      </SectionContainer>

      {feedback && !editorOpen ? <p className="form-feedback">{feedback}</p> : null}

      <section className="agenda-workspace">
        <div className="agenda-user-groups">
          {agendaGroups.map((group) => (
            <section key={group.key} className="agenda-user-section">
              <header className="agenda-user-header">
                <div className="agenda-user-copy">
                  <span className="agenda-user-kicker">Responsavel</span>
                  <strong>{group.label}</strong>
                  <small>{group.helper}</small>
                </div>
                <div className="agenda-user-stats">
                  <article>
                    <span>Total</span>
                    <strong>{group.total}</strong>
                  </article>
                  <article>
                    <span>Abertos</span>
                    <strong>{group.open}</strong>
                  </article>
                  <article>
                    <span>Atrasados</span>
                    <strong>{group.overdue}</strong>
                  </article>
                  <article>
                    <span>Concluidos</span>
                    <strong>{group.done}</strong>
                  </article>
                </div>
              </header>

              <div className="agenda-board-scroller">
                <div className="agenda-board">
                  {agendaColumns.map((column) => (
                    <section
                      key={`${group.key}-${column.key}`}
                      className={`agenda-column agenda-column-${column.key}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(column.key)}
                    >
                      <header>
                        <div>
                          <p className="agenda-column-kicker">{column.eyebrow}</p>
                          <strong>{column.label}</strong>
                          <small>{column.helper}</small>
                        </div>
                        <span>{group.columns[column.key]?.length || 0}</span>
                      </header>
                      <button
                        type="button"
                        className="agenda-add-card"
                        onClick={() => openCreate(column.key, group.userId ? String(group.userId) : '')}
                      >
                        + adicionar
                      </button>
                      <div className="agenda-card-list">
                        {loading ? <p className="empty-mini">Carregando agenda...</p> : null}
                        {!loading && group.columns[column.key]?.length ? group.columns[column.key].map((item) => (
                          <AgendaCard
                            key={item.id}
                            item={item}
                            currentUserId={currentUserId}
                            onOpen={openEdit}
                            onStatus={updateStatus}
                            onDragStart={setDraggingId}
                          />
                        )) : null}
                        {!loading && !group.columns[column.key]?.length ? <p className="empty-mini">Sem itens nesta etapa.</p> : null}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </section>
          ))}
          {!loading && agendaGroups.length === 0 ? <p className="empty-state">Nenhum item encontrado para os filtros selecionados.</p> : null}
        </div>
      </section>

      {editorOpen ? (
        <section className="agenda-editor-shell" role="dialog" aria-modal="true" aria-label={selectedItem?.id ? 'Editar item da agenda' : 'Criar item da agenda'}>
          <button type="button" className="agenda-editor-backdrop" aria-label="Fechar agenda" onClick={closeEditor} />
          <aside className="agenda-editor-panel">
            <header className="agenda-editor-hero">
              <div>
                <p className="eyebrow">{selectedItem?.id ? 'Detalhe da tarefa' : 'Novo item'}</p>
                <h2>{selectedItem?.id ? selectedItem.title : 'Criar item na agenda'}</h2>
                <span>Cadastre a tarefa com prazo, prioridade, lembrete e contexto operacional.</span>
              </div>
              <button type="button" className="agenda-editor-close" onClick={closeEditor} aria-label="Fechar">×</button>
            </header>

            {feedback ? <p className="form-feedback agenda-editor-feedback">{feedback}</p> : null}

            <div className="agenda-editor-body">
              <div className="agenda-editor-main">
                <label>
                  Titulo da tarefa
                  <input
                    ref={titleInputRef}
                    className="field agenda-title-field"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ex.: Retornar paciente, revisar protocolo, cobrar evidência"
                  />
                </label>
                <label>
                  Descricao
                  <textarea
                    className="field agenda-textarea"
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Descreva o objetivo, contexto, combinados e qualquer detalhe importante."
                  />
                </label>
                <label>
                  Tags
                  <input
                    className="field"
                    value={draft.tags}
                    onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="Ex.: CRC, urgente, retorno"
                  />
                </label>
              </div>

              <Card className="agenda-editor-side">
                <div className="agenda-editor-side-head">
                  <strong>Propriedades</strong>
                  <span>{selectedItem?.id ? `ID ${selectedItem.id}` : 'Novo'}</span>
                </div>
                <label>
                  Responsavel
                  <select
                    className="field"
                    value={draft.assigned_user_id}
                    onChange={(event) => setDraft((current) => ({ ...current, assigned_user_id: event.target.value }))}
                  >
                    <option value="">Sem responsavel definido</option>
                    {assigneeOptions.map((user) => (
                      <option key={user.id} value={String(user.id)}>{formatAgendaUserOption(user)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select className="field" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                    {agendaColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                  </select>
                </label>
                <label>
                  Prioridade
                  <select className="field" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}>
                    {priorityOptions.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
                  </select>
                </label>
                <label>
                  Prazo
                  <input className="field" type="datetime-local" value={draft.due_at} onChange={(event) => setDraft((current) => ({ ...current, due_at: event.target.value }))} />
                </label>
                <label>
                  Lembrete
                  <input className="field" type="datetime-local" value={draft.reminder_at} onChange={(event) => setDraft((current) => ({ ...current, reminder_at: event.target.value }))} />
                </label>
                <div className="agenda-property-grid">
                  <label className="agenda-toggle-card">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.is_daily_recurring)}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        is_daily_recurring: event.target.checked,
                        requires_completion: event.target.checked ? true : current.requires_completion,
                        recurrence_base_status: event.target.checked ? (current.recurrence_base_status || 'todo') : current.recurrence_base_status
                      }))}
                    />
                    <div>
                      <strong>Rotina recorrente</strong>
                      <small>Reabre automaticamente a tarefa e preserva o histórico de entrega do responsável.</small>
                    </div>
                  </label>
                  <label className="agenda-toggle-card">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.is_daily_recurring || draft.requires_completion)}
                      disabled={Boolean(draft.is_daily_recurring)}
                      onChange={(event) => setDraft((current) => ({ ...current, requires_completion: event.target.checked }))}
                    />
                    <div>
                      <strong>Execução obrigatória</strong>
                      <small>O trabalho só entra na medição quando o responsável registrar a execução.</small>
                    </div>
                  </label>
                </div>
                {draft.is_daily_recurring ? (
                  <>
                    <div className="agenda-weekday-picker">
                      <div className="agenda-weekday-head">
                        <strong>Dias para voltar ao A fazer</strong>
                        <small>Se nenhum dia for marcado, a tarefa retorna todos os dias.</small>
                      </div>
                      <div className="agenda-weekday-chips">
                        {recurrenceWeekdayOptions.map((weekday) => {
                          const isActive = normalizeAgendaRecurrenceWeekdays(draft.recurrence_weekdays).includes(weekday.value);
                          return (
                            <button
                              key={weekday.value}
                              type="button"
                              className={`agenda-weekday-chip ${isActive ? 'active' : ''}`}
                              onClick={() => toggleRecurrenceWeekday(weekday.value)}
                              aria-pressed={isActive}
                              title={weekday.fullLabel}
                            >
                              {weekday.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label>
                      Coluna de retorno
                      <select
                        className="field"
                        value={draft.recurrence_base_status}
                        onChange={(event) => setDraft((current) => ({ ...current, recurrence_base_status: event.target.value }))}
                      >
                        {agendaColumns.filter((column) => column.key !== 'done').map((column) => (
                          <option key={column.key} value={column.key}>{column.label}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {selectedItem?.completed_at ? (
                  <div className="agenda-completion-note">
                    <strong>Última execução registrada</strong>
                    <small>{formatExecutionStamp(selectedItem)}</small>
                  </div>
                ) : null}
                <div className="agenda-editor-guide">
                  <strong>Fluxo recomendado</strong>
                  <small>Use os dias da semana para definir quando a tarefa volta para A fazer e manter a cobrança de execução do responsável.</small>
                </div>
              </Card>
            </div>

            <footer className="agenda-editor-footer">
              <div>
                {canDeleteAgendaItem && selectedItem?.id ? <button type="button" className="outline-action" onClick={deleteItem} disabled={saving}>Excluir item</button> : null}
              </div>
              <ActionButtons>
                <button type="button" className="secondary-action" onClick={closeEditor} disabled={saving}>Cancelar</button>
                <button type="button" className="primary-action" onClick={saveItem} disabled={saving}>{saving ? 'Salvando...' : 'Salvar na agenda'}</button>
              </ActionButtons>
            </footer>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
